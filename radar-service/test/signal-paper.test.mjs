// 모의매매(페이퍼) 성과 추적 테스트. 주문·Telegram·네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PAPER, blankPaper, normalizePaper, openTrade, advanceTrade, paperStep, paperSummary, paperLine, closedRecord } from '../signal/paper.mjs';
import { pathOutcome } from '../signal/backtest.mjs';
import { evaluateSignal, M15 } from '../signal/evaluate.mjs';
import { signalStep } from '../signal/step.mjs';
import { runSignalAfterCycle } from '../signal/integrate.mjs';
import { T, NOW, mkA, mk15, sender, store, collectors, oppState } from './signal-fixture.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const lcg = seed => { let x = seed >>> 0; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296; };
const close = (a, b, e = 1e-9) => (a === b) || Math.abs(a - b) < e;

// 무작위 15분봉 경로(랜덤 워크, 가끔 갭). 인덱스 0은 신호 봉, 체결은 1번 봉 시가.
function randomPath(seed, n = 260, start = 100) {
  const r = lcg(seed), bars = []; let p = start;
  for (let k = 0; k < n; k++) {
    const gap = r() < 0.03 ? (r() - 0.5) * 3 : 0, o = p + gap, ch = (r() - 0.5) * 1.4, c = o + ch, h = Math.max(o, c) + r() * 0.5, l = Math.min(o, c) - r() * 0.5;
    bars.push({ t: T + k * M15, o, h, l, c, q: 1000 }); p = c;
  }
  return bars;
}
const fakeEv = (bars, dir, stop, t1, t2) => ({ dir, stop, t1: { price: t1, rr: 2, net: 1.9 }, t2: t2 === null ? null : { price: t2 }, zoneKey: `${dir}:z`, triggerT: bars[0].t, triggerCloseT: bars[1].t, volRel: 2, score: 70, btcAlign: '일치' });
const sameResult = (a, b, tag) => { for (const k of ['kind', 'entry', 'risk', 'riskPct', 'gross', 'net', 'netStress', 'mae', 'maePct', 'mfe', 'bars']) assert.ok(typeof a[k] === 'number' ? close(a[k], b[k]) : a[k] === b[k], `${tag} ${k}: ${a[k]} vs ${b[k]}`); };

test('동치: 증분 모의 추적기는 백테스트 pathOutcome과 800개 무작위 경로(LONG·SHORT, 세 모형)에서 필드 단위로 같다', () => {
  let compared = 0, kinds = { target: 0, stop: 0, time: 0, skipped: 0 };
  for (let seed = 1; seed <= 400; seed++) for (const dir of ['LONG', 'SHORT']) {
    const bars = randomPath(seed * 7 + (dir === 'LONG' ? 0 : 3)), s = dir === 'LONG' ? 1 : -1, r = lcg(seed), entryRef = bars[1].o;
    const risk = 0.5 + r() * 3, stop = entryRef - s * risk * (r() < 0.05 ? -0.3 : 1), t1 = entryRef + s * risk * (0.7 + r() * 3), t2 = r() < 0.6 ? t1 + s * risk * (0.5 + r() * 2) : null;
    const trade = openTrade('ETHUSDT', fakeEv(bars, dir, stop, t1, t2), 0);
    // 무작위 크기 조각으로 먹여도 결과는 같아야 한다
    let i = 1, st = 'open'; const rr = lcg(seed + 99);
    while (st === 'open' && i < bars.length) { const step = 1 + Math.floor(rr() * 12); st = advanceTrade(trade, bars.slice(0, i + step)); i += step; }
    assert.equal(st, 'closed', `seed ${seed} ${dir} 닫히지 않음`);
    for (const [model, stopModel, target] of [['wick', 'wick', t1], ['close', 'close', t1], ['wickT2', 'wick', t2 ?? t1]]) {
      const ref = pathOutcome(bars, 0, dir, stop, target, { stopModel }), m = trade.m[model];
      if (ref.skipped) { assert.equal(m.kind, 'skipped'); kinds.skipped++; continue; }
      const mine = { kind: m.kind, entry: m.entry, risk: m.risk, riskPct: m.risk / m.entry * 100, gross: (m.exit - m.entry) * s / m.risk, net: (m.exit - m.entry) * s / m.risk - m.entry * 0.0015 / m.risk, netStress: (m.exit - m.entry) * s / m.risk - m.entry * 0.003 / m.risk, mae: m.mae, maePct: m.mae * m.risk / m.entry * 100, mfe: m.mfe, bars: m.n };
      sameResult(mine, ref, `seed ${seed} ${dir} ${model}`); compared++; kinds[m.kind]++;
    }
  }
  assert.ok(compared > 1000); assert.ok(kinds.target > 100 && kinds.stop > 100 && kinds.time >= 5, JSON.stringify(kinds));
});
test('추적기: 같은 봉을 두 번 먹여도 중복 반영되지 않고, 체결은 신호 다음 봉 시가이며, 신호 이전 봉은 무시한다', () => {
  const bars = path => path.map((r, k) => ({ t: T + k * M15, o: r[0], h: r[1], l: r[2], c: r[3], q: 1 })), b = bars([[100, 100, 100, 100], [100.5, 101, 100, 100.8], [100.8, 105.5, 100.6, 105], [105, 105, 105, 105]]);
  const tr = openTrade('ETHUSDT', fakeEv(b, 'LONG', 98, 105, null), 0);
  assert.equal(advanceTrade(tr, b.slice(0, 2)), 'open'); assert.equal(tr.m.wick.entry, 100.5, '체결 = 신호 다음 봉 시가'); const n1 = tr.m.wick.n;
  assert.equal(advanceTrade(tr, b.slice(0, 2)), 'open'); assert.equal(tr.m.wick.n, n1, '같은 봉 재투입 무시');
  assert.equal(advanceTrade(tr, b), 'closed'); assert.equal(tr.m.wick.kind, 'target'); assert.equal(tr.m.wick.exit, 105);
  const t2 = openTrade('ETHUSDT', fakeEv(b, 'LONG', 98, 105, null), 0); advanceTrade(t2, [{ ...b[0], t: b[0].t - M15 }, ...b.slice(0, 2)]); assert.equal(t2.m.wick.entry, 100.5, '신호 이전 봉 무시');
});
test('추적기: 봉이 끊기면 공백으로 닫아 통계에서 뺀다, 아직 체결 봉이 없으면 대기, JSON 저장·복원 뒤에도 이어서 진행', () => {
  const b = randomPath(5, 40), tr = openTrade('ETHUSDT', fakeEv(b, 'LONG', 90, 120, null), 0);
  assert.equal(advanceTrade(tr, b.slice(0, 1)), 'open', '체결 봉 대기'); assert.equal(tr.m.wick.entry, null);
  assert.equal(advanceTrade(tr, b.slice(0, 10)), 'open');
  const revived = JSON.parse(JSON.stringify(tr)); assert.equal(advanceTrade(revived, b.slice(0, 25)), 'open'); assert.equal(revived.lastBarT, b[24].t); assert.equal(revived.m.wick.n, 24);
  const gapped = openTrade('ETHUSDT', fakeEv(b, 'LONG', 90, 120, null), 0); assert.equal(advanceTrade(gapped, [b[0], b[1], b[3]]), 'gap');
  const late = openTrade('ETHUSDT', fakeEv(b, 'LONG', 90, 120, null), 0); assert.equal(advanceTrade(late, [b[0], b[2]]), 'gap', '체결 봉이 없는데 그 뒤 봉이 오면 공백');
});
test('기록: 같은 신호는 한 번만, 쿨다운·상한·보관 한도, 종료된 신호는 다시 열지 않는다', () => {
  const paper = blankPaper(), a = mkA(), c15 = mk15(), ev = evaluateSignal({ a, c15, now: NOW }, { minRR: 1.5, validMin: 45 });
  assert.equal(ev.status, 'CANDIDATE');
  let r = paperStep(paper, { evaluations: [{ symbol: 'ETHUSDT', ev, a, c15 }], bars: {}, now: NOW }); assert.deepEqual(r, { opened: 1, closed: 0 });
  r = paperStep(paper, { evaluations: [{ symbol: 'ETHUSDT', ev, a, c15 }], bars: {}, now: NOW + 60000 }); assert.equal(r.opened, 0); assert.equal(paper.open.length, 1);
  assert.equal(paper.open[0].id, `ETHUSDT:LONG:${ev.zoneKey}:${ev.triggerT}`); assert.equal(paper.since, NOW);
  // 상한
  const full = blankPaper(); for (let k = 0; k < PAPER.maxOpen; k++) full.open.push({ ...paper.open[0], id: `X${k}`, symbol: 'SOLUSDT' });
  paperStep(full, { evaluations: [{ symbol: 'ETHUSDT', ev, a, c15 }], bars: {}, now: NOW }); assert.equal(full.open.length, PAPER.maxOpen); assert.equal(full.skipped, 1);
  // 보관 한도
  const many = blankPaper(); many.closed = Array.from({ length: PAPER.keepClosed + 7 }, (_, k) => ({ id: `C${k}`, t: k, res: {} })); paperStep(many, { evaluations: [], bars: {}, now: NOW });
  assert.equal(many.closed.length, PAPER.keepClosed); assert.equal(many.dropped, 7); assert.equal(many.closed[0].id, 'C7');
});
test('성과 요약: 표본 30건 미만이면 결론 금지, 신뢰구간이 0을 넘을 때만 양/음, 아니면 미확정', () => {
  const mk = (net, n) => ({ ...blankPaper(), since: 0, closed: Array.from({ length: n }, (_, k) => ({ id: `t${k}`, t: 86400000 * (k % 20), res: { wick: { kind: net > 0 ? 'target' : 'stop', net, netStress: net - 0.075, mae: 0.5, maePct: 1.5, mfe: 1 }, close: { kind: 'stop', net: -1, netStress: -1.1, mae: 1, maePct: 3, mfe: 0 }, wickT2: { kind: 'time', net: 0, netStress: -0.1, mae: 0.5, maePct: 1, mfe: 0.5 } } })) });
  assert.equal(paperSummary(mk(1, 10), 86400000 * 30).verdict, '표본 부족(결론 금지)'); assert.equal(paperSummary(mk(1, 10), 0).sufficient, false);
  assert.match(paperSummary(mk(1, 40), 86400000 * 30).verdict, /양\(95% 신뢰구간이 0 초과\)/); assert.match(paperSummary(mk(-1, 40), 86400000 * 30).verdict, /음\(95% 신뢰구간이 0 미만\)/);
  const mixed = mk(1, 40); mixed.closed.forEach((t, k) => { if (k % 2) { t.res.wick.net = -1; t.res.wick.kind = 'stop'; } }); const s = paperSummary(mixed, 86400000 * 30); assert.equal(s.verdict, '0과 구별되지 않음(미확정)'); assert.equal(s.models.wick.n, 40); assert.ok(Math.abs(s.models.wick.target - 0.5) < 1e-9);
  const line = paperLine(s); for (const need of ['모의·미검증', '열림 0', '종료 40', '판정: 0과 구별되지 않음']) assert.ok(line.includes(need), need);
  assert.deepEqual(normalizePaper(undefined).open, []); assert.deepEqual(normalizePaper({ v: 2 }).closed, []); assert.equal(normalizePaper({ v: 1, open: [{ id: 'x' }, null], closed: 3 }).open.length, 0);
});

// ── 실행 단계 연결 ──
const ext = (base, rows) => [...base, ...rows.map((r, k) => ({ t: base.at(-1).t + (k + 1) * M15, o: r[0], h: r[1], l: r[2], c: r[3], q: 1000 }))];
const one = [{ price: 105, source: '4H 스윙 고점' }];
function pr(o = {}) {
  const st = o.state ?? oppState(), sd = o.sender ?? sender(), sv = o.store ?? store(), env = { RADAR_SIGNAL: o.mode ?? 'preview', RADAR_SIGNAL_PAPER: o.paper === false ? 'off' : 'on', ...(o.env ?? {}) };
  return { st, sd, sv, run: (now, c15, extra = {}) => signalStep({ now, state: st, env, send: sd.send, save: sv.save, analyze: () => mkA({ obstacles: one }), ...collectors({ c15 }), ...extra }) };
}
test('실행: 모의 추적 off(기본)이면 preview는 상태를 전혀 쓰지 않는다 / on이면 paper만 기록하고 전송·신호 상태는 그대로', async () => {
  const off = pr({ paper: false }); await off.run(NOW, mk15()); assert.equal(off.st.signal, undefined); assert.equal(off.sv.log.length, 0); assert.equal(off.sd.calls, 0);
  const on = pr(); const out = await on.run(NOW, mk15());
  assert.equal(on.sd.calls, 0, 'Telegram 전송 없음'); assert.equal(out.candidates, 1); assert.equal(on.st.signal.paper.open.length, 1); assert.equal(out.paper.open, 1);
  assert.deepEqual({ ...on.st.signal, paper: undefined }, { ...normalizeBase(), paper: undefined }, 'paper 외 신호 상태는 그대로(비어 있음)');
  assert.equal(on.st.signal.slot, null); assert.equal(on.st.signal.inflight, null); assert.deepEqual(on.st.signal.coins, {});
  assert.ok(on.sv.log.length >= 1);
});
const normalizeBase = () => ({ v: 1, coins: {}, slot: null, retryAt: 0, failures: 0, lastError: null, inflight: null, daily: {}, health: null });
test('실행: 같은 봉을 여러 번 평가해도 모의 거래는 하나, 이후 확정 봉으로 목표 도달까지 추적해 종료·요약, 재시작 후에도 이어짐', async () => {
  const p = pr(), base = mk15();
  await p.run(NOW, base); const dup = await p.run(NOW + 60000, base); assert.equal(dup.skipped, 'not-due', '같은 15분 슬롯의 반복 수집 방지'); assert.equal(p.st.signal.paper.slot, Math.floor(NOW / M15) * M15); assert.equal(p.st.signal.paper.open.length, 1);
  // 다음 슬롯들: 체결 봉(T+15m 시가)과 이후 봉 — 마지막에 1차 목표(105) 터치
  const slot = k => T + (k + 1) * M15 + 60000;
  let c15 = ext(base, [[100.1, 100.6, 99.9, 100.4]]);                                    // 체결 봉(시가 100.1)
  await p.run(slot(1), c15); assert.equal(p.st.signal.paper.open[0].m.wick.entry, 100.1); assert.equal(p.st.signal.paper.open.length, 1);
  p.st = JSON.parse(JSON.stringify(p.st));                                                  // 캐시 저장·복원(재시작)
  const again = pr({ state: p.st, sender: p.sd, store: p.sv });
  c15 = ext(c15, [[100.4, 102, 100.2, 101.8]]); await again.run(slot(2), c15); assert.equal(again.st.signal.paper.open.length, 1);
  c15 = ext(c15, [[101.8, 105.6, 101.5, 105.2]]); const out = await again.run(slot(3), c15);
  assert.equal(again.st.signal.paper.open.length, 0); assert.equal(again.st.signal.paper.closed.length, 1); assert.equal(again.st.signal.paper.closed[0].res.wick.kind, 'target');
  assert.equal(out.paper.closed, 1); assert.equal(out.paper.models.wick.target, 1); assert.equal(out.paper.sufficient, false); assert.equal(out.paper.verdict, '표본 부족(결론 금지)');
  const rec = again.st.signal.paper.closed[0], r = rec.res.wick, gross = (105 - 100.1) / (100.1 - 97.5), cost = 100.1 * 0.0015 / (100.1 - 97.5); assert.ok(close(r.net, gross - cost, 1e-4) && close(r.netStress, gross - 2 * cost, 1e-4) && r.mae >= 0 && close(rec.entry, 100.1) && close(rec.riskPct, 2.6 / 100.1 * 100, 1e-3));   // 저장 정밀도: 소수 4자리
  assert.equal(again.sd.calls, 0);
});
test('실행: 모의 거래가 열려 있는 코인은 관찰 후보에서 빠져도 15분봉을 계속 받아 결과를 확정한다', async () => {
  const p = pr(), base = mk15(); await p.run(NOW, base);
  p.st.opportunity.coins = {};                                                                  // 기회 레이더 후보가 사라진 상태
  const calls = []; const col = collectors({ c15: ext(base, [[100.1, 100.6, 99.9, 100.4]]), calls });
  const out = await signalStep({ now: T + 2 * M15 + 60000, state: p.st, env: { RADAR_SIGNAL: 'preview', RADAR_SIGNAL_PAPER: 'on' }, send: p.sd.send, save: p.sv.save, analyze: () => mkA({ obstacles: one, stage: 0, dir: null, zone: null, plan: null, invalidation: null }), ...col });
  assert.notEqual(out.skipped, 'no-watchlist'); assert.ok(calls.some(c => c[0] === 'm15'), '15분봉 수집'); assert.equal(p.st.signal.paper.open[0].m.wick.entry, 100.1);
});
test('실행: live(on)에서는 실제 신호 전송과 모의 기록이 함께 동작하고, 모의 기록의 예외는 전송을 막지 않는다', async () => {
  const live = pr({ mode: 'on' }); const out = await live.run(NOW, mk15()); assert.equal(live.sd.calls, 1); assert.equal(live.st.signal.paper.open.length, 1); assert.equal(live.st.signal.coins.ETHUSDT.status, 'active');
  const bad = pr({ mode: 'on' }); const o2 = await bad.run(NOW, mk15(), { paperRunner: () => { throw new Error('paper boom'); } });
  assert.equal(bad.sd.calls, 1, '모의 기록이 실패해도 실제 신호는 전송'); assert.match(o2.paperError, /paper boom/); assert.equal(bad.st.signal.paper, undefined); assert.equal(bad.st.signal.coins.ETHUSDT.status, 'active');
});
test('연결부: 모의 성과 한 줄과 미검증 안내를 로그로 출력하고, 꺼져 있으면 아무것도 출력하지 않는다', async () => {
  const p = pr(), logs = []; await runSignalAfterCycle({ state: p.st, save: p.sv.save, send: p.sd.send, env: { RADAR_SIGNAL: 'preview', RADAR_SIGNAL_PAPER: 'on' }, out: m => logs.push(m), now: NOW, elapsedMs: 1000, analyze: () => mkA({ obstacles: one }), ...collectors({ c15: mk15() }) });
  assert.ok(logs.some(l => l.startsWith('SIGNAL-PAPER [모의·미검증]')), logs.join('\n')); assert.ok(logs.some(l => l.includes('미검증 규칙'))); assert.ok(logs.every(l => !l.includes('"paper"')), '요약 JSON에 paper 본문이 섞이지 않음');
  const q = []; await runSignalAfterCycle({ state: {}, save: async () => {}, env: { RADAR_SIGNAL: 'off', RADAR_SIGNAL_PAPER: 'on' }, out: m => q.push(m) }); assert.deepEqual(q, []);
});
test('모의 추적은 주문·계정·전송 경로가 없다', () => {
  const src = readFileSync(new URL('../signal/paper.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/fetch\(|jsonRequest|sendText|process\.env|TELEGRAM|\/trade\/|\/account\/|order/i.test(src));
});

test('저장 크기: 종료 기록이 가득 차도(보관 한도) 상태 파일 증가분은 100KB 이하', () => {
  const bars = randomPath(3, 260), paper = blankPaper();
  for (let i = 0; i < PAPER.keepClosed; i++) { const tr = openTrade('ETHUSDT', fakeEv(bars, 'LONG', 99.0, 101.5, 103), 0); tr.id += `:${i}`; assert.equal(advanceTrade(tr, bars), 'closed'); paper.closed.push(closedRecord(tr)); }
  const bytes = JSON.stringify(paper).length; assert.ok(bytes < 100000, `크기 ${bytes}B`); console.log(`paper 보관 한도(${PAPER.keepClosed}건) 크기 ${bytes}B`);
});
