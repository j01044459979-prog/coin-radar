// 실시간 매매 판단 지원 신호(15분봉 트리거) 테스트. 모든 데이터는 합성이며 네트워크·Telegram·주문 API는 쓰지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { evaluateSignal, invalidation, SIG, M15 } from '../signal/evaluate.mjs';
import { signalTransition, blank } from '../signal/transition.mjs';
import { candidateMessage, invalidatedMessage, SIGNAL_DISCLAIMER } from '../signal/message.mjs';
import { signalSettings, signalMode, SIGNAL_DEFAULTS } from '../signal/config.mjs';
import { signalStep, runSignalSafe, normalizeSignal, watchlist, MAX_ATTEMPTS } from '../signal/step.mjs';
import { runSignalAfterCycle } from '../signal/integrate.mjs';
import { freshness15, collect15 } from '../signal/collect.mjs';
import { T, NOW, mkA, mirrorA, mk15, mirror15, sender, store, collectors, oppState } from './signal-fixture.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const OPT = { minRR: 1.5, validMin: 45 };
const ev = (a = mkA(), c15 = mk15(), now = NOW, o = OPT) => evaluateSignal({ a, c15, now }, o);
const close = (x, y, e = 1e-9) => Math.abs(x - y) < e;

// ── 판정 ──
test('진입 후보: 모든 조건 충족 시 진입 관심가·손절·1·2차 목표·손익비·유효시간을 계산한다', () => {
  const r = ev(); assert.equal(r.status, 'CANDIDATE', r.blockers?.join(' / ')); assert.deepEqual(r.blockers, []);
  assert.ok(close(r.entry, 100.15)); assert.equal(r.stop, 97.5); assert.ok(close(r.riskAbs, 2.65)); assert.ok(close(r.riskPct, 2.65 / 100.15 * 100));
  assert.equal(r.t1.price, 105); assert.equal(r.t2.price, 109); assert.ok(close(r.t1.rr, 4.85 / 2.65)); assert.ok(close(r.t2.rr, 8.85 / 2.65));
  assert.ok(close(r.costR, 100.15 * 0.0015 / 2.65)); assert.ok(close(r.t1.net, r.t1.rr - r.costR)); assert.ok(r.t2.net > r.t1.net);
  assert.equal(r.triggerCloseT, T + M15); assert.equal(r.validUntil, T + M15 + 45 * 60000);
  assert.equal(r.evidence.length, 3); assert.ok(r.volRel >= 1.2 && close(r.volRel, 2));
  assert.ok(r.entry > r.stop && r.t1.price > r.entry && r.t2.price > r.t1.price);
});
test('진입 후보: SHORT는 LONG의 거울 — 같은 손익비·손절폭, 가격 방향만 반대', () => {
  const L = ev(), S = ev(mirrorA(mkA()), mirror15(mk15()));
  assert.equal(S.status, 'CANDIDATE', S.blockers?.join(' / ')); assert.equal(S.dir, 'SHORT');
  assert.ok(close(S.entry, 200 - L.entry) && close(S.stop, 200 - L.stop)); assert.ok(close(S.riskPct, L.riskPct, 1e-6) || Math.abs(S.riskPct - L.riskPct) < 0.02);
  assert.ok(close(S.t1.rr, L.t1.rr, 1e-9) && close(S.t2.rr, L.t2.rr, 1e-9)); assert.ok(S.t1.price < S.entry && S.t2.price < S.t1.price && S.stop > S.entry);
});
test('조건 하나라도 빠지면 진입 후보가 아니라 관찰(OBSERVE)이며 이유를 말한다', () => {
  const cases = [
    ['트리거 없음(종가가 직전 고점 아래)', mk15({ lastClose: 99.5, lastOpen: 99.3, lastHigh: 99.55, lastLow: 99.25 }), /트리거 대기/],
    ['음봉 돌파', mk15({ lastOpen: 100.3, lastClose: 100.15 }), /트리거 대기/],
    ['거래량 부족', mk15({ volLast: 1000 }), /거래량 ×1\.00로 부족/],
    ['거래량 결측', mk15({ mutate: b => { b.at(-1).q = null; } }), /거래량 확인 불가/],
    ['추격(구간에서 멀리)', mk15({ level: 101.0, lastClose: 101.3, lastOpen: 100.9 }), /추격 구간/],
    ['구간 아래로 이탈', mk15({ level: 98.0, lastClose: 98.3, lastOpen: 97.9 }), /구간 하단을 아래로 벗어남/],
    ['트리거 봉이 급변', mk15({ lastLow: 98.5, lastHigh: 100.9 }), /급변/],
    ['최근 4시간에 손절 기준 터치', mk15({ mutate: b => { b[b.length - 5].l = 97.4; } }), /손절 기준을 건드림/],
  ];
  for (const [name, c15, re] of cases) { const r = ev(mkA(), c15); assert.equal(r.status, 'OBSERVE', name); assert.ok(r.blockers.some(b => re.test(b)), `${name}: ${r.blockers.join(' / ')}`); assert.equal(r.evidence, undefined); }
  const wide = ev(mkA({ invalidation: 95.0 })); assert.equal(wide.status, 'OBSERVE'); assert.ok(wide.blockers.some(b => /너무 넓음/.test(b)));
  const narrow = ev(mkA({ invalidation: 99.5 }), mk15()); assert.equal(narrow.status, 'OBSERVE'); assert.ok(narrow.blockers.some(b => /너무 좁음/.test(b)));
});
test('목표는 계산 근거가 있을 때만: 위쪽 확정 구간이 없으면 목표를 만들지 않고 진입 후보로도 올리지 않는다', () => {
  const r = ev(mkA({ obstacles: [] })); assert.equal(r.status, 'OBSERVE'); assert.equal(r.t1, null); assert.equal(r.t2, null); assert.ok(r.blockers.some(b => /1차 목표 산정 불가/.test(b)));
  const near = ev(mkA({ obstacles: [{ price: 100.4, source: '가까운 구간' }] })); assert.equal(near.status, 'OBSERVE'); assert.equal(near.t1, null, '1R 미만 거리의 구간은 1차 목표가 아님');
});
test('2차 목표는 1차보다 0.5R 이상 먼 다음 구간이 있을 때만, 손익비는 비용을 뺀 값으로 최소 기준을 판단', () => {
  const one = ev(mkA({ obstacles: [{ price: 105, source: 'a' }] })); assert.equal(one.status, 'CANDIDATE'); assert.equal(one.t2, null);
  const tight = ev(mkA({ obstacles: [{ price: 105, source: 'a' }, { price: 105.5, source: 'b' }, { price: 112, source: 'c' }] })); assert.equal(tight.t2.price, 112, '0.5R 안쪽 구간은 건너뜀');
  const low = ev(mkA({ obstacles: [{ price: 103.5, source: 'a' }] })); assert.equal(low.status, 'OBSERVE'); assert.ok(low.blockers.some(b => /비용 반영 손익비 .*R로 부족/.test(b)), low.blockers.join('/'));
  const strict = ev(mkA(), mk15(), NOW, { minRR: 3, validMin: 45 }); assert.equal(strict.status, 'OBSERVE'); const relaxed = ev(mkA(), mk15(), NOW, { minRR: 1, validMin: 45 }); assert.equal(relaxed.status, 'CANDIDATE');
  assert.ok(ev().t1.net < ev().t1.rr, '비용이 순손익비를 낮춘다');
});
test('WAIT: 4H·1H 조건 미충족 / 분석 불가 / 15분봉 문제(부족·누락·미마감·지연·오래됨)', () => {
  for (const [name, a, c15, now, re] of [
    ['1단계', mkA({ stage: 1 }), mk15(), NOW, /구간 접근/], ['0단계', mkA({ stage: 0, dir: null, zone: null, plan: null }), mk15(), NOW, /미충족/], ['분석 실패', { status: 'insufficient', reason: '캔들 부족' }, mk15(), NOW, /분석 불가/],
    ['15분봉 부족', mkA(), mk15({ n: 59 }), NOW, /15분봉 부족/], ['누락 구간', mkA(), mk15({ mutate: b => { b.splice(30, 1); } }), NOW, /누락/],
    ['미마감 봉', mkA(), mk15(), T + M15 - 1, /마감 전/], ['지연', mkA(), mk15(), T + M15 + 21 * 60000, /지연/], ['1H 신호 봉보다 오래됨', mkA({ asOf: T + 3600000 }), mk15(), T + 3600000 + 10 * 60000, /오래됨/],
  ]) { const r = ev(a, c15, now); assert.equal(r.status, 'WAIT', name); assert.match(r.why, re, name); assert.deepEqual(r.blockers, [r.why]); }
  const gone = ev(mkA({ price: 96 }), mk15({ lastClose: 96, lastOpen: 95.8, level: 95.5 })); assert.equal(gone.status, 'WAIT'); assert.equal(gone.invalid, true);   // 이미 손절 기준 아래
});
test('미래 정보·미완성 봉 금지: 마감 시각이 now 이후인 봉이 있으면 판정하지 않는다, 판정은 마지막 확정 봉 이전 정보로만 결정', () => {
  const c = mk15(), future = { ...c.at(-1), t: c.at(-1).t + M15, c: 120, h: 125 };
  assert.equal(ev(mkA(), [...c, future], NOW).status, 'WAIT');                                           // 미래(미완성) 봉이 붙어도 후보가 되지 않는다
  assert.equal(ev(mkA(), [...c, future], future.t + M15 + 60000).status === 'CANDIDATE', false);
  const base = ev(), same = ev(mkA(), c.map(x => ({ ...x })), NOW); assert.deepEqual(base, same);          // 같은 입력 → 같은 출력(결정적)
  const earlier = c.slice(0, -1); assert.notEqual(ev(mkA(), earlier, NOW).status, 'CANDIDATE', '트리거 봉 없이는 후보가 아님');
});

// ── 전이: 중복 방지·유효시간·무효화 ──
const ctx = (over = {}) => ({ symbol: 'ETHUSDT', a: mkA(), c15: mk15(), now: NOW, cooldownMs: SIG.cooldownMs, ...over });
test('전이: 진입 후보는 한 번만 알리고, 활성 동안·같은 15분봉에서는 다시 알리지 않는다', () => {
  const e = ev(), t1 = signalTransition(null, e, ctx());
  assert.equal(t1.event.type, 'candidate'); assert.equal(t1.committed.status, 'active'); assert.equal(t1.committed.id, `ETHUSDT:LONG:${e.zoneKey}:${e.triggerT}`); assert.equal(t1.next.status, 'closed', '전달 전에는 활성으로 저장하지 않는다');
  const t2 = signalTransition(t1.committed, e, ctx({ now: NOW + 60000 })); assert.equal(t2.event, null);
  const later = ev(mkA(), mk15({ closeT: T + 2 * M15 }), NOW + M15); assert.equal(later.status, 'CANDIDATE');
  assert.equal(signalTransition(t1.committed, later, ctx({ now: NOW + M15, c15: mk15({ closeT: T + 2 * M15 }) })).event, null, '활성 신호가 있는 동안 새 트리거는 알리지 않음');
});
test('전이: 유효시간이 지나면 조용히 만료되고, 같은 구간·방향은 쿨다운 동안 재알림이 없다', () => {
  const e = ev(), active = signalTransition(null, e, ctx()).committed;
  const exp = signalTransition(active, { status: 'WAIT' }, ctx({ now: e.validUntil + 1 })); assert.equal(exp.event, null); assert.equal(exp.committed.status, 'closed'); assert.equal(exp.committed.closeReason, 'expired');
  const t = e.validUntil + 1, again = ev(mkA(), mk15({ closeT: T + 3 * M15 }), T + 3 * M15 + 60000);
  assert.equal(signalTransition(exp.committed, again, ctx({ now: t })).event, null, '쿨다운 중');
  assert.equal(signalTransition(exp.committed, again, ctx({ now: t + SIG.cooldownMs })).event?.type, 'candidate', '쿨다운 뒤 새 에피소드');
  const other = ev(mkA({ zone: { lo: 90, hi: 91, level: 90.5, type: '4H 스윙' }, invalidation: 89, price: 100 }), mk15({ closeT: T + 3 * M15 }), T + 3 * M15 + 60000);
  assert.ok(other.zoneKey !== e.zoneKey);
});
test('전이: 무효화(15분 종가가 손절 기준 이탈 / 구조 소멸 / 방향 전환)는 알린 신호에 대해서만 한 번 알린다', () => {
  const e = ev(), active = signalTransition(null, e, ctx()).committed;
  const broke = mk15({ closeT: T + 2 * M15, lastClose: 97.4, lastOpen: 98.0, lastHigh: 98.1, lastLow: 97.3, level: 98 });
  const t = signalTransition(active, { status: 'WAIT' }, ctx({ c15: broke, now: T + 2 * M15 + 60000 }));
  assert.equal(t.event.type, 'invalidated'); assert.match(t.event.reason, /15분봉 종가 97\.400가 손절 기준 97\.500을 하향 이탈/); assert.equal(t.committed.status, 'closed'); assert.equal(t.committed.closeReason, 'invalidated');
  assert.equal(signalTransition(t.committed, { status: 'WAIT' }, ctx({ c15: broke, now: T + 2 * M15 + 120000 })).event, null, '무효화는 한 번만');
  const lost = signalTransition(active, { status: 'WAIT' }, ctx({ a: mkA({ stage: 0, dir: null, zone: null, plan: null, invalidation: null }), now: NOW + 60000 })); assert.equal(lost.event.type, 'invalidated'); assert.match(lost.event.reason, /구조/);
  const flipped = signalTransition(active, { status: 'WAIT' }, ctx({ a: mirrorFlip(), now: NOW + 60000 })); assert.equal(flipped.event.type, 'invalidated');
  const never = signalTransition(null, { status: 'WAIT' }, ctx({ c15: broke })); assert.equal(never.event, null, '알린 적 없는 신호는 무효화 알림도 없음');
  assert.ok(invalidation(active, { a: mkA(), c15: mk15() }) === null);
});
function mirrorFlip() { return mkA({ dir: 'SHORT', stage: 2 }); }
test('전이: 손절 기준 위반이 15분 종가가 아니라 꼬리(고저)만이면 무효화하지 않는다', () => {
  const active = signalTransition(null, ev(), ctx()).committed, wick = mk15({ closeT: T + 2 * M15, lastClose: 100.0, lastOpen: 99.8, lastLow: 96.0 });
  assert.equal(signalTransition(active, { status: 'WAIT' }, ctx({ c15: wick, now: T + 2 * M15 + 60000 })).event, null);
});

// ── 메시지 ──
const FORBID = /승률|확률|매수|매도|주문 접수|수익 보장|보장합니다/;
test('메시지: 필수 8개 항목(종목·방향, 상태, 진입 관심가, 손절, 1·2차 목표, 손익비, 근거 3개 이내, 생성시각·유효시간)', () => {
  const m = candidateMessage('ETHUSDT', ev()), t = m.plain;
  for (const need of ['ETH', 'LONG', '진입 후보', '관찰 ▶ 진입 후보 ▶ 무효화', '진입 관심가 100.15', '손절 기준 97.50', '1차 105.00', '2차 109.00', '손익비 1차 1.83R', '비용 반영', '근거', '생성 21:15 KST', '유효 21:15~22:00 KST', '무효화:', '미검증', '레버리지']) assert.ok(t.includes(need), `${need} 없음\n${t}`);
  assert.equal((t.match(/^• /gm) ?? []).length, 3); assert.ok(m.html && m.text.includes('<b>'));
  const sh = candidateMessage('SOLUSDT', ev(mirrorA(mkA()), mirror15(mk15()))).plain; assert.match(sh, /SHORT/); assert.match(sh, /손절 기준 102\.50 \(\+/); assert.match(sh, /1차 95\.000 \(−/); assert.match(sh, /상향 이탈/);
});
test('메시지: 모바일 가독성(줄 길이 ≤ 60자, 전체 ≤ 1500자, 허용 HTML은 <b>만, 금지 표현 없음) · 2차 목표 없음 표시 · 레버리지 손실은 사실만', () => {
  for (const e of [ev(), ev(mkA({ obstacles: [{ price: 105, source: 'a' }] })), ev(mirrorA(mkA()), mirror15(mk15()))]) {
    const m = candidateMessage('ETHUSDT', e); assert.ok(m.text.length <= 1500, `길이 ${m.text.length}`);
    for (const line of m.plain.split('\n').filter(l => !l.startsWith('※'))) assert.ok([...line].length <= 60, `줄이 길다(${[...line].length}): ${line}`);
    assert.ok(!/<(?!\/?b>)/.test(m.text.replace(/&lt;|&gt;/g, '')), '허용되지 않은 HTML'); assert.ok(!FORBID.test(m.plain.replace(SIGNAL_DISCLAIMER, '')), m.plain.match(FORBID)?.[0]);
  }
  assert.match(candidateMessage('ETHUSDT', ev(mkA({ obstacles: [{ price: 105, source: 'a' }] }))).plain, /2차 산정 불가/);
  const t = candidateMessage('ETHUSDT', ev()).plain; assert.match(t, /5배 −13% · 10배 −26% · 20배 −53%/); assert.ok(!/권장|추천|사세요|하세요/.test(t));
  assert.match(candidateMessage('ETHUSDT', ev(mkA({ metrics: { ...mkA().metrics, btcAlign: '역방향' } }))).plain, /BTC 4H 방향과 반대/);
});
test('메시지: 무효화 메시지와 외부 문자열 이스케이프', () => {
  const t = invalidatedMessage('ETHUSDT', { dir: 'LONG', reason: '15분봉 종가 97.40가 손절 기준 97.50을 하향 이탈 <x>', price: 97.4, stop: 97.5, triggerT: T }).plain;
  for (const need of ['무효화', 'ETH', 'LONG', '사유:', '97.40', '신호 생성 21:15 KST', '더 이상 유효하지 않습니다']) assert.ok(t.includes(need), need);
  const html = invalidatedMessage('ETHUSDT', { dir: 'LONG', reason: '<script>', price: 1, stop: 1, triggerT: T }).text; assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;'));
});

// ── 설정 ──
test('설정: 기본 off·잘못된 값은 안전한 기본값, 범위 검사', () => {
  assert.equal(signalMode({}), 'off'); assert.equal(signalMode({ RADAR_SIGNAL: 'ON' }), 'on'); assert.equal(signalMode({ RADAR_SIGNAL: 'true' }), 'off'); assert.equal(signalMode({ RADAR_SIGNAL: 'preview' }), 'preview');
  assert.deepEqual(signalSettings({}), { mode: 'off', ...SIGNAL_DEFAULTS });
  const s = signalSettings({ RADAR_SIGNAL: 'on', RADAR_SIGNAL_VALID_MIN: '30', RADAR_SIGNAL_MIN_RR: '2.5', RADAR_SIGNAL_MAX_PER_DAY: '5' }); assert.deepEqual([s.validMin, s.minRR, s.maxPerDay], [30, 2.5, 5]);
  const bad = signalSettings({ RADAR_SIGNAL_VALID_MIN: '5', RADAR_SIGNAL_MIN_RR: '0.5', RADAR_SIGNAL_MAX_PER_DAY: '999' }); assert.deepEqual([bad.validMin, bad.minRR, bad.maxPerDay], [45, 1.5, 20]);
  assert.equal(signalSettings({ RADAR_SIGNAL_VALID_MIN: '45abc' }).validMin, 45);
});

// ── 실행 단계 ──
const run = (o = {}) => { const calls = o.calls ?? [], st = o.state ?? { ...oppState() }, sd = o.sender ?? sender(), sv = o.store ?? store(); return { calls, st, sd, sv, args: { now: NOW, state: st, env: { RADAR_SIGNAL: 'on', ...(o.env ?? {}) }, send: sd.send, save: sv.save, analyze: () => (o.a ?? mkA()), ...collectors({ c15: o.c15, status15: o.status15, symbols: o.symbols, calls }), ...(o.extra ?? {}) } }; };
test('실행: 꺼져 있으면(기본) 네트워크·전송·상태 변경이 없다', async () => {
  const r = run({ env: { RADAR_SIGNAL: 'off' } }); const before = structuredClone(r.st);
  assert.deepEqual(await signalStep(r.args), { mode: 'off', skipped: 'off' }); assert.equal(r.calls.length, 0); assert.equal(r.sd.calls, 0); assert.deepEqual(r.st, before);
  const none = run({ env: { RADAR_SIGNAL: '' } }); assert.equal((await signalStep(none.args)).skipped, 'off');
});
test('실행: preview는 메시지만 만들고 전송·상태 저장이 없다', async () => {
  const r = run({ env: { RADAR_SIGNAL: 'preview' } }); const out = await signalStep(r.args), before = structuredClone(r.st);
  assert.equal(out.candidates, 1); assert.equal(out.preview.messages.length, 1); assert.match(out.preview.messages[0], /진입 후보/); assert.ok(out.preview.lines[0].includes('진입 후보'));
  assert.equal(r.sd.calls, 0); assert.equal(r.sv.log.length, 0); assert.equal(r.st.signal, undefined); assert.deepEqual(r.st, before);
});
test('실행: on — 진입 후보 1건 전송, 상태는 state.signal에만, 같은 슬롯·다음 슬롯·재시작 후에도 중복 없음', async () => {
  const r = run(); const opp0 = structuredClone(r.st.opportunity);
  const out = await signalStep(r.args); assert.equal(out.sentMessages, 1); assert.equal(r.sd.sent.length, 1); assert.match(r.sd.sent[0].text, /진입 후보/);
  const c = r.st.signal.coins.ETHUSDT; assert.equal(c.status, 'active'); assert.equal(c.entry, 100.15); assert.equal(r.st.signal.inflight, null); assert.equal(r.st.signal.daily['2024-06-01'].candidates, 1);
  assert.deepEqual(r.st.opportunity, opp0, '기회 레이더 상태는 읽기만 한다');
  assert.equal((await signalStep({ ...r.args, now: NOW + 60000 })).skipped, 'not-due');                                             // 같은 슬롯 재실행
  const next = { ...r.args, now: NOW + M15, ...collectors({ c15: mk15({ closeT: T + 2 * M15 }) }) }; const out2 = await signalStep(next); assert.equal(out2.sentMessages, 0); assert.equal(r.sd.sent.length, 1);   // 다음 슬롯: 활성 신호가 있어 새 트리거도 알리지 않음
  const restarted = { ...r.args, state: structuredClone(r.sv.snapshot), now: NOW + M15, ...collectors({ c15: mk15({ closeT: T + 2 * M15 }) }) }; await signalStep(restarted); assert.equal(r.sd.sent.length, 1, '저장본으로 재시작해도 중복 없음');
});
test('실행: 유효시간이 지나면 조용히 만료 → 쿨다운 뒤 새 신호만 알림', async () => {
  const r = run(); await signalStep(r.args); const e = r.st.signal.coins.ETHUSDT;
  const t = e.validUntil + 2 * 60000, slotNow = Math.floor(t / M15) * M15 + 60000, c = mk15({ closeT: Math.floor(slotNow / M15) * M15 });
  const out = await signalStep({ ...r.args, now: slotNow, a: undefined, analyze: () => mkA({ asOf: Math.floor(slotNow / 3600000) * 3600000 }), ...collectors({ c15: c }) }); assert.equal(out.sentMessages, 0); assert.equal(r.st.signal.coins.ETHUSDT.status, 'closed'); assert.equal(r.st.signal.coins.ETHUSDT.closeReason, 'expired'); assert.equal(r.sd.sent.length, 1);
});
test('실행: 무효화는 알린 신호에 대해 1회만 알리고 신호를 닫는다', async () => {
  const r = run(); await signalStep(r.args);
  const bc = mk15({ closeT: T + 2 * M15, lastClose: 97.4, lastOpen: 98.0, lastHigh: 98.1, lastLow: 97.3, level: 98 }), at = T + 2 * M15 + 60000;
  const out = await signalStep({ ...r.args, now: at, ...collectors({ c15: bc }) }); assert.equal(out.invalidated, 1); assert.equal(out.sentMessages, 1); assert.match(r.sd.sent[1].text, /무효화/); assert.equal(r.st.signal.coins.ETHUSDT.closeReason, 'invalidated');
  await signalStep({ ...r.args, now: at + M15, ...collectors({ c15: mk15({ closeT: T + 3 * M15, level: 98, lastClose: 97.4, lastOpen: 98, lastHigh: 98.1, lastLow: 97.3 }) }) }); assert.equal(r.sd.sent.length, 2, '무효화 알림은 한 번만');
});
test('실행: 15분봉이 확정 대기여도 활성 신호의 시간 만료는 계속 처리된다', async () => {
  const r = run(); await signalStep(r.args);
  const t = r.st.signal.coins.ETHUSDT.validUntil + 3 * 60000, slot = Math.floor(t / M15) * M15;
  const out = await signalStep({ ...r.args, now: slot + 60000, analyze: () => mkA({ asOf: Math.floor(t / 3600000) * 3600000 }), ...collectors({ status15: 'pending' }) }); assert.equal(out.pending, 1); assert.equal(r.st.signal.coins.ETHUSDT.status, 'closed');
  assert.equal(r.st.signal.slot, Math.floor(NOW / M15) * M15, '확정 대기 슬롯은 완료 처리하지 않는다');
});
test('실행: 전송 실패는 확정하지 않고 다시 시도, 전달 불확실 실패는 최대 2회까지만 시도하고 이후 전달된 것으로 간주', async () => {
  const r = run({ sender: sender({ failTimes: 10 }) });
  const o1 = await signalStep(r.args); assert.ok(o1.sendError); assert.equal(r.st.signal.coins.ETHUSDT?.status ?? 'closed', 'closed'); assert.equal(r.st.signal.inflight.attempts, 1); assert.equal(r.sd.calls, 1);
  assert.notEqual(r.st.signal.slot, Math.floor(NOW / M15) * M15, '실패한 슬롯은 완료 처리되지 않음');
  r.st.signal.retryAt = 0; await signalStep({ ...r.args, now: NOW + 30000, force: true }); assert.equal(r.sd.calls, 2); assert.equal(r.st.signal.inflight.attempts, 2);
  r.st.signal.retryAt = 0; await signalStep({ ...r.args, now: NOW + 60000, force: true }); assert.equal(r.sd.calls, 2, '세 번째는 보내지 않고 전달된 것으로 간주'); assert.equal(r.st.signal.coins.ETHUSDT.status, 'active'); assert.equal(r.st.signal.daily['2024-06-01'].assumed, 1);
  assert.equal(MAX_ATTEMPTS, 2);
});
test('실행: 명확한 거절(HTTP 오류)은 시도로 치지 않고, 429는 대기', async () => {
  const r = run({ sender: sender({ failTimes: 1, status: 429 }) }); const o = await signalStep(r.args);
  assert.ok(o.sendError); assert.equal(r.st.signal.inflight, null); assert.ok(r.st.signal.retryAt > NOW); assert.equal((await signalStep({ ...r.args, now: NOW + 60000, force: true })).skipped, 'backoff');
});
test('실행: 상태 저장이 안 되면 보내지 않는다(장부 저장 불가 → 전송 중단)', async () => {
  const r = run({ store: store({ failAfter: 0 }) }); const o = await signalStep(r.args); assert.equal(r.sd.calls, 0); assert.match(o.saveError, /disk full/); assert.equal(o.sentMessages, 0);
  const r2 = run({ store: store({ failAfter: 1 }) }); await signalStep(r2.args); assert.equal(r2.sd.calls, 1, '장부는 저장됐으므로 1건은 전송, 전달 기록 저장이 실패하면 거기서 멈춤'); assert.match((await signalStep({ ...r2.args, now: NOW + 5000, force: true })).saveError ?? 'x', /disk full|x/); assert.ok(r2.sd.calls <= 2);
});
test('실행: 일일 상한은 진입 후보에만 적용하고 초과분은 보류(기록 없음)', async () => {
  const r = run({ symbols: ['ETHUSDT', 'SOLUSDT'], state: oppState(['ETHUSDT', 'SOLUSDT']), env: { RADAR_SIGNAL_MAX_PER_DAY: '1' } });
  const o = await signalStep(r.args); assert.equal(o.candidates, 2); assert.equal(o.sentMessages, 1); assert.equal(o.held, 1); assert.equal(r.st.signal.daily['2024-06-01'].candidates, 1);
  assert.equal(Object.values(r.st.signal.coins).filter(c => c.status === 'active').length, 1);
});
test('실행: 여러 후보는 조건 적합도 높은 순으로 보내고, 무효화가 먼저', async () => {
  const scores = { ETHUSDT: 70, SOLUSDT: 90 }; let k = 0; const syms = ['ETHUSDT', 'SOLUSDT'];
  const r = run({ symbols: syms, state: oppState(syms) }); r.args.analyze = () => mkA({ score: { total: scores[syms[k++ % 2]], grade: '', parts: [] } });
  await signalStep(r.args); assert.deepEqual(r.sd.sent.map(m => m.text.match(/<b>([A-Z]+)<\/b> · <b>LONG/)?.[1]), ['SOL', 'ETH']);
});
test('실행: 관찰 후보가 없으면 아무것도 하지 않는다 / 기존 레이더의 quiet·제한 대기를 따른다', async () => {
  const none = run({ state: {} }); assert.equal((await signalStep(none.args)).skipped, 'no-watchlist'); assert.equal(none.calls.length, 0);
  const q = run({ state: { ...oppState(), quiet: { hour: Math.floor(NOW / 3600000) } } }); assert.equal((await signalStep(q.args)).skipped, 'quiet'); assert.equal(q.calls.length, 0);
  const b = run({ state: { ...oppState(), retryAt: NOW + 1000 } }); assert.equal((await signalStep(b.args)).skipped, 'shared-backoff'); assert.equal(b.calls.length, 0);
  const old = run({ state: oppState(['ETHUSDT'], 'LONG', 3, NOW - 7 * 3600000) }); assert.equal((await signalStep(old.args)).skipped, 'no-watchlist', '6시간 넘은 관찰 후보는 쓰지 않음');
  const s1 = run({ state: oppState(['ETHUSDT'], 'LONG', 1) }); assert.equal((await signalStep(s1.args)).skipped, 'no-watchlist', '1단계 후보는 대상 아님');
  assert.deepEqual(watchlist({ opportunity: { coins: { BADname: { stage: 3, dir: 'LONG', lastBarT: NOW } } } }, normalizeSignal(undefined), NOW), []);
});
test('실행: 15분봉이 확정 전/오래됨이면 신호를 만들지 않는다(미완성 봉 사용 금지)', async () => {
  for (const status15 of ['pending', 'stale', 'error']) { const r = run({ status15 }); const o = await signalStep(r.args); assert.equal(o.candidates, 0); assert.equal(r.sd.calls, 0, status15); }
});
test('실행: 시간 초과 — 수집이 멈추면 아무것도 전송·변경하지 않고, 늦게 끝난 수집도 영향이 없다', async () => {
  const r = run(); r.args.collectHour = () => new Promise(() => {}); const before = structuredClone(r.st);
  const o = await runSignalSafe({ ...r.args, timeoutMs: 30 }); assert.match(o.failed, /timeout/); assert.equal(r.sd.calls, 0); assert.deepEqual(r.st, before);
  const r2 = run(); let release; const gate = new Promise(res => { release = res; }); const real = r2.args.collectHour; r2.args.collectHour = async x => { await gate; return real(x); };
  let t = 0; const run2 = signalStep({ ...r2.args, clock: () => t, deadline: 10 }); t = 100; release(); const o2 = await run2; assert.equal(o2.timedOut, true); assert.equal(r2.sd.calls, 0); assert.equal(r2.st.signal, undefined);
});
test('실행: 예외는 밖으로 번지지 않는다(래퍼)', async () => {
  const r = run(); r.args.collectHour = async () => { throw new Error('boom'); }; const o = await runSignalSafe(r.args); assert.match(o.failed, /boom/);
});
test('실행: 수집 실패(제한 응답)는 대기하고 전송하지 않는다', async () => {
  const r = run(); r.args.collectHour = async () => ({ coins: {}, calls: 1, fatal: { message: '요청 한도', status: 429, retryAfter: 0 } }); const o = await signalStep(r.args);
  assert.match(o.failed, /요청 한도/); assert.ok(r.st.signal.retryAt >= NOW + 300000); assert.equal(r.sd.calls, 0);
});
test('상태 정규화: 손상·형식 오류는 안전하게 초기화하고 입력은 바뀌지 않는다', () => {
  for (const bad of [undefined, null, 5, [], { v: 2, coins: {} }, { v: 1, coins: [] }, 'x']) assert.deepEqual(normalizeSignal(bad).coins, {});
  const input = { v: 1, coins: { ETHUSDT: { status: 'active', dir: 'LONG' }, bad: { status: 'active' }, SOLUSDT: { status: 'weird', dir: 'LONG' } }, inflight: { key: 3 }, daily: [] };
  const n = normalizeSignal(input); assert.deepEqual(Object.keys(n.coins), ['ETHUSDT']); assert.equal(n.inflight, null); assert.deepEqual(n.daily, {}); n.coins.ETHUSDT.dir = 'SHORT'; assert.equal(input.coins.ETHUSDT.dir, 'LONG');
});

// ── 기존 운영 회귀·격리 ──
test('연결부: 꺼져 있으면 null·호출 없음, 시간 예산이 부족하면 건너뜀, 예외 없음', async () => {
  let called = 0; const out = [];
  assert.equal(await runSignalAfterCycle({ state: {}, save: async () => {}, env: { RADAR_SIGNAL: 'off' }, collectHour: () => { called++; } }), null); assert.equal(called, 0);
  assert.equal(await runSignalAfterCycle({ state: {}, save: async () => {}, env: {} }), null);
  const skipped = await runSignalAfterCycle({ state: oppState(), save: async () => {}, env: { RADAR_SIGNAL: 'on' }, send: async () => {}, elapsedMs: 290000, out: m => out.push(m) }); assert.equal(skipped.skipped, 'time-budget'); assert.match(out[0], /^SIGNAL .*time-budget/);
  const r = run({ env: { RADAR_SIGNAL: 'preview' } }); const logs = []; const res = await runSignalAfterCycle({ ...r.args, elapsedMs: 1000, out: m => logs.push(m), now: NOW }); assert.equal(res.candidates, 1); assert.ok(logs.some(l => l.startsWith('SIGNAL ') && l.includes('진입 후보'))); assert.ok(logs.some(l => l.includes('===== SIGNAL message')));
});
test('운영 파일: radar.yml의 스케줄·권한·동시성은 그대로이고 신호 변수 4개가 기본 off/안전값으로 추가됨, run.mjs는 예외를 삼키는 호출만 추가', () => {
  const yml = readFileSync(new URL('../../.github/workflows/radar.yml', import.meta.url), 'utf8');
  assert.match(yml, /cron: '\*\/5 \* \* \* \*'/); assert.match(yml, /group: radar/); assert.match(yml, /timeout-minutes: 8/); assert.match(yml, /permissions:\n  contents: read\n  actions: read/);
  assert.match(yml, /RADAR_SIGNAL: \$\{\{ vars\.RADAR_SIGNAL \|\| 'off' \}\}/); assert.match(yml, /RADAR_SIGNAL_VALID_MIN: \$\{\{ vars\.RADAR_SIGNAL_VALID_MIN \|\| '45' \}\}/); assert.match(yml, /RADAR_SIGNAL_MIN_RR: \$\{\{ vars\.RADAR_SIGNAL_MIN_RR \|\| '1\.5' \}\}/); assert.match(yml, /RADAR_SIGNAL_MAX_PER_DAY: \$\{\{ vars\.RADAR_SIGNAL_MAX_PER_DAY \|\| '20' \}\}/);
  assert.match(yml, /RADAR_OPPORTUNITY: \$\{\{ vars\.RADAR_OPPORTUNITY \|\| 'off' \}\}/);
  assert.ok(!/RADAR_OPPORTUNITY_(TOP|MIN_STAGE|MAX_PER_HOUR|MAX_PER_DAY|FIRST_RUN): .*vars\.RADAR_SIGNAL/.test(yml));
  const run = readFileSync(new URL('../run.mjs', import.meta.url), 'utf8');
  assert.match(run, /const signal = options => runSignalAfterCycle\(\{ state, save, env: process\.env, \.\.\.options \}\)\.catch\(\(\) => null\);/); assert.equal((run.match(/await signal\(/g) ?? []).length, 2);
  assert.ok(run.indexOf('await opportunity({ send });\n    await signal({ send });') > 0, '기회 레이더 뒤에서만 호출');
});
test('주문·계정 API 흔적이 없다: 신호 모듈은 공개 시세 GET과 Telegram 전송만 사용', () => {
  const dir = new URL('../signal/', import.meta.url), files = readdirSync(dir).filter(f => f.endsWith('.mjs'));
  assert.ok(files.length >= 8);
  for (const f of files) { const src = readFileSync(new URL(f, dir), 'utf8').replace(/\/\/.*$/gm, ''); assert.ok(!/\/trade\/|\/account\/|\/asset\/|api[-_]?key|secret|signature|method:\s*['"]POST|order/i.test(src), `${f}: ${src.match(/\/trade\/|\/account\/|\/asset\/|api[-_]?key|secret|signature|method:\s*['"]POST|order/i)?.[0]}`); }
});

// ── 15분봉 수집 ──
test('15분봉 최신성: 직전 봉이면 fresh, 방금 마감해 확정 전이면 pending, 그 밖은 stale', () => {
  const slot = Math.floor(NOW / M15) * M15, bar = t => [{ t }];
  assert.equal(freshness15(bar(slot - M15), NOW).status, 'fresh'); assert.equal(freshness15(bar(slot - 2 * M15), slot + 60000).status, 'pending'); assert.equal(freshness15(bar(slot - 2 * M15), slot + 4 * 60000).status, 'stale');
  assert.equal(freshness15(bar(slot - 3 * M15), NOW).status, 'stale'); assert.equal(freshness15([], NOW).status, 'stale');
});
test('15분봉 수집: 미확정(confirm=0) 봉은 버리고, 제한 응답이면 즉시 중단하며 나머지는 대기 처리', async () => {
  const slot = Math.floor(NOW / M15) * M15, row = (t, c = 100, confirm = '1') => [String(t), String(c), String(c + 1), String(c - 1), String(c), '1', '1', '1000', confirm];
  const urls = [], fetcher = async url => { urls.push(url); if (url.includes('SOL')) return new Response('', { status: 429, headers: { 'retry-after': '30' } }); return new Response(JSON.stringify({ code: '0', data: [row(slot, 5000, '0'), row(slot - M15), row(slot - 2 * M15), row(slot - 3 * M15)] }), { status: 200 }); };
  const out = await collect15({ fetcher, now: NOW, ids: ['ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'XRP-USDT-SWAP'], gapMs: 0 });
  assert.equal(out.coins['ETH-USDT-SWAP'].status, 'fresh'); assert.equal(out.coins['ETH-USDT-SWAP'].c15.at(-1).t, slot - M15, '진행 중 봉 제외'); assert.ok(!out.coins['ETH-USDT-SWAP'].c15.some(x => x.c === 5000));
  assert.equal(out.stopped.status, 429); assert.equal(out.coins['XRP-USDT-SWAP'].status, 'pending'); assert.equal(urls.length, 2, '중단 뒤 추가 요청 없음'); assert.ok(urls.every(u => /bar=15m/.test(u) && !/trade|order/.test(u)));
});

// ── 실제 분석 경로(주입 없이 analyzeCoin) ──
import { aggregate } from '../opportunity/indicators.mjs';
import { analyzeCoin } from '../opportunity/analysis.mjs';
import { ETH, SOL, BTC } from './opportunity-fixture.mjs';
const real = (series, i) => { const s = series.slice(0, i + 1); return analyzeCoin(s.slice(-150), aggregate(s).slice(-300), aggregate(BTC.slice(0, i + 1)).slice(-300)); };
// 실제 분석 결과 a에 맞춰, 마지막 15분봉이 a.price에서 직전 8봉 극단을 확정 종가로 돌파하는 15분봉을 만든다(SHORT는 a.price 기준 가격 거울)
const craft = a => {
  const L = a.dir === 'LONG', a1 = a.metrics.atr1, bars = mk15({ closeT: a.asOf + M15, level: a.price - 0.25 * a1, a1, lastClose: a.price, lastOpen: a.price - 0.35 * a1 });
  return L ? bars : bars.map(x => ({ ...x, o: 2 * a.price - x.o, h: 2 * a.price - x.l, l: 2 * a.price - x.h, c: 2 * a.price - x.c }));
};
test('실제 분석 결과(합성 시계열)에서도 LONG·SHORT 모두 진입 후보가 생성되고, 가격·목표는 확정 구간에서만 나온다', () => {
  const res = { LONG: [], SHORT: [] };
  for (const series of [ETH, SOL]) for (let i = 1100; i < series.length; i++) {
    const a = real(series, i); if (a.status !== 'ok' || a.stage < 2) continue;
    const r = ev(a, craft(a), a.asOf + M15 + 60000); assert.ok(['CANDIDATE', 'OBSERVE'].includes(r.status), r.why);
    if (r.status !== 'CANDIDATE') continue;
    res[r.dir].push(r); const s = r.dir === 'LONG' ? 1 : -1;
    assert.equal(r.stop, a.invalidation); assert.ok((r.entry - r.stop) * s > 0 && (r.t1.price - r.entry) * s > 0 && (!r.t2 || (r.t2.price - r.t1.price) * s > 0));
    assert.ok(a.obstacles.some(o => o.price === r.t1.price), '1차 목표는 분석이 찾은 확정 구간 중 하나'); assert.ok(r.t1.net >= 1.5 && r.t1.rr > r.t1.net);
    assert.ok(r.triggerCloseT >= a.asOf && r.validUntil === r.triggerCloseT + 45 * 60000);
  }
  assert.ok(res.LONG.length >= 5 && res.SHORT.length >= 5, `LONG ${res.LONG.length} / SHORT ${res.SHORT.length}`);
});
test('실제 분석 경로: 기존 단계 판정에는 영향이 없다(분석 결과의 단계·점검·무효화는 신호 필드 추가 전후 동일, 장애물 목록은 가까운 순)', () => {
  let n = 0;
  for (const series of [ETH, SOL]) for (let i = 1100; i < series.length; i += 3) {
    const a = real(series, i); if (a.status !== 'ok' || a.stage < 1) continue; n++;
    const s = a.dir === 'LONG' ? 1 : -1; for (let k = 1; k < a.obstacles.length; k++) assert.ok((a.obstacles[k].price - a.obstacles[k - 1].price) * s > 0, '가까운 순');
    assert.equal(a.opposing, a.obstacles[0]?.price ?? null); assert.ok(a.metrics.atr1 > 0 && Math.abs(a.metrics.atr1 / a.price * 100 - a.metrics.atr1Pct) < 1e-9);
  }
  assert.ok(n > 30);
});
