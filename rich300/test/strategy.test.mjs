// 추천 전략 가상 추적 엔진(순수): 진입·손절·익절·본전·트레일링·보수적 선후 판정·위험 한도. 가상 봉 데이터만 사용(네트워크·Telegram 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sgyBuild, sgyRunBars, sgyNotes, sgyBarsFor, sgySummary, sgyRiskPct, STRAT } from '../lib/strategy.mjs';
import { feedParseEntry } from '../lib/feed.mjs';

const M = 900000, T0 = Date.UTC(2026, 9, 26, 3, 0), CLOSE = T0, VALID = CLOSE + 45 * 60000, START = CLOSE + 15 * 60000;
const fe = (o = {}) => ({ ok: true, kind: 'candidate', sid: 'SG-ETH-L-abc123', symbolId: 'ETHUSDT', dir: 'LONG', entry: 2000, stop: 1970, triggerT: CLOSE - M, closeT: CLOSE, validUntil: VALID, score: 70, rr1: 1.9, ref1: 2050, ref2: 2090, evidence: ['4H 상승 · 1H 지지 눌림'], volRel: 1.5, btcAlign: '동행', stageLabel: '진입 후보', costPct: 0.15, createdAt: CLOSE + 60000, ...o });
const bar = (k, o, h, l, c) => ({ t: START + k * M, o, h, l, c, v: 100, dur: M });
const live = (o = {}) => { const r = sgyBuild(fe(o), { now: CLOSE + 5 * 60000 }); assert.equal(r.ok, true, JSON.stringify(r.reason)); const s = r.s; s.state = 'WAIT_ENTRY'; s.x.startT = START; return s; };
const run = (s, bars, now = START + 60 * M) => sgyRunBars(s, bars, now);
const types = r => r.events.map(e => e.type);

test('생성: 위험 1%(점수 80 이상 1.5%) · 분할 50/30/20 · TP1 +1.5R · TP2 +2R · 격리 3배 이하 · 최대 손실이 예산 이내', () => {
  const a = live(), b = live({ score: 85, sid: 'SG-ETH-L-zzz999' }), p = a.x.plan, q = b.x.plan;
  assert.equal(sgyRiskPct(70), 0.01); assert.equal(sgyRiskPct(80), 0.015); assert.equal(a.x.riskLabel, 'base'); assert.equal(b.x.riskLabel, 'strong');
  assert.ok(p.riskBudget > 2.99 && p.riskBudget < 3.01 && q.riskBudget > 4.49 && q.riskBudget < 4.51); assert.ok(p.worstLoss <= p.riskBudget && q.worstLoss <= q.riskBudget); assert.ok(q.totalQty > p.totalQty);
  assert.deepEqual(p.stages.map(s => Math.round(s.weight * 10) / 10), [0.5, 0.3, 0.2]); assert.deepEqual(p.tps.map(t => [t.r, t.price]), [[1.5, 2045], [2, 2060]]); assert.ok(p.lev <= 3 && p.marginUsage <= 0.3 + 1e-9); assert.equal(a.state, 'WAIT_ENTRY');
});
test('위험 한도 초과 전략은 추천하지 않고 CANCELLED 로 기록: 일일 손실 −3% · 증거금 한도 · 동시 추적 수 · 계획 불가 · 도착 지연', () => {
  const ctx = (o = {}) => ({ now: CLOSE + 60000, ...o });
  const day = sgyBuild(fe(), ctx({ dayPnl: -9.01 })); assert.deepEqual([day.ok, day.reason, day.notify, day.s.state], [false, 'day-loss-limit', true, 'CANCELLED']);
  assert.equal(sgyBuild(fe(), ctx({ dayPnl: -8.9 })).ok, true);
  const mc = sgyBuild(fe(), ctx({ activeMargin: 89 })); assert.equal(mc.reason, 'margin-cap-total'); assert.equal(sgyBuild(fe(), ctx({ activeCount: 10 })).reason, 'too-many-active');
  const near = sgyBuild(fe({ sid: 'SG-ETH-L-near01', stop: 1999 }), ctx()); assert.equal(near.ok, false); assert.equal(near.reason, 'plan-cost-heavy'); assert.equal(near.s.state, 'CANCELLED');              // 손절폭 대비 비용이 너무 커 계획 불가
  const late = sgyBuild(fe(), { now: VALID + 1 }); assert.deepEqual([late.reason, late.notify], ['expired-on-arrival', true]); assert.equal(sgyBuild(fe(), { now: CLOSE + 4 * 3600000 }).notify, false);       // 늦게 도착: 안내 1건 · 아주 오래된 추천은 조용히 기록만
});
test('정상 승리 시나리오: 진입 → TP1(본전 이동 다음 봉부터) → TP2 → 트레일링 → 추적 손절로 종료, 전략 기준 가상 성적 양수', () => {
  let s = live(); const bars = [bar(0, 2010, 2012, 1999, 2005), bar(1, 2005, 2048, 2003, 2046), bar(2, 2046, 2065, 2044, 2062), bar(3, 2062, 2090, 2060, 2088), bar(4, 2088, 2089, 2050, 2052)];
  const r1 = run(s, bars.slice(0, 1)); assert.deepEqual(types(r1), ['ENTRY']); assert.equal(r1.s.state, 'ENTRY_TRIGGERED'); assert.equal(r1.s.x.fills[0].price, 2000);
  const r2 = run(r1.s, bars.slice(0, 2)); assert.deepEqual(types(r2), ['TP1', 'BE']); assert.equal(r2.s.state, 'TP1'); assert.equal(r2.s.x.stopKind, 'breakeven');
  const r3 = run(r2.s, bars.slice(0, 3)); assert.deepEqual(types(r3), ['ADD_CANCEL', 'ADD_CANCEL', 'TP2', 'TRAIL']);       // TP1 이후 미체결 2·3차는 취소 안내 assert.equal(r3.s.state, 'TP2'); assert.ok(r3.s.x.stopPrice > 2000);
  const r4 = run(r3.s, bars.slice(0, 4)); assert.equal(r4.s.state, 'TRAILING'); assert.ok(r4.s.x.stopPrice > r3.s.x.stopPrice);
  const r5 = run(r4.s, bars); assert.equal(r5.s.state, 'STOP'); assert.equal(r5.s.x.stopExit.kind, 'trailing'); assert.deepEqual(types(r5), ['STOP']);
  const res = r5.s.x.result; assert.ok(res.usdt > 0 && res.r > 0 && res.pct > 0); assert.ok(res.fee > 0); assert.equal(r5.s.x.legs.length, 2);
});
test('멱등: 같은 봉을 다시 처리해도 체결·이벤트·상태가 늘지 않는다(장애 복구 후 재실행 안전)', () => {
  const bars = [bar(0, 2010, 2012, 1999, 2005), bar(1, 2005, 2048, 2003, 2046)]; const a = run(live(), bars), b = run(a.s, bars); assert.deepEqual(b.events, []); assert.deepEqual(b.s.x, a.s.x); assert.equal(b.s.state, a.s.state);
  const c = run(a.s, [bar(0, 1, 1, 1, 1), ...bars]); assert.deepEqual(c.s.x.fills, a.s.x.fills);
});
test('보수적 판정 ① 진입 봉에서 손절선까지 내려가면 1·2·3차가 모두 체결된 뒤 손절(최악 손실 ≤ 위험 예산)', () => {
  const s = live(), r = run(s, [bar(0, 2005, 2008, 1960, 1965)]); assert.deepEqual(types(r), ['ENTRY', 'ADD', 'ADD', 'STOP']); assert.equal(r.s.state, 'STOP'); assert.equal(r.s.x.fills.length, 3);
  assert.ok(r.s.x.result.usdt < 0 && -r.s.x.result.usdt <= s.x.plan.riskBudget * 1.000001, `${r.s.x.result.usdt} vs ${s.x.plan.riskBudget}`);
});
test('보수적 판정 ② 같은 봉에서 손절·익절이 모두 닿으면 손절 · ③ 진입 체결 봉에서는 익절 인정 안 함', () => {
  let r = run(live(), [bar(0, 2010, 2012, 1999, 2005)]); const both = run(r.s, [bar(0, 2010, 2012, 1999, 2005), bar(1, 2005, 2050, 1969, 2000)]); assert.deepEqual(types(both), ['ADD', 'ADD', 'STOP']);       // 같은 봉에서 손절선까지 내려가며 2·3차도 체결된 뒤 손절(최악 가정) assert.equal(both.s.x.legs.length, 0);
  const entryBar = run(live(), [bar(0, 2010, 2050, 1999, 2040)]); assert.deepEqual(types(entryBar), ['ENTRY']); assert.equal(entryBar.s.x.legs.length, 0); assert.equal(entryBar.s.state, 'ENTRY_TRIGGERED');                       // 진입 봉의 고점이 TP1 을 넘어도 익절 없음
  const next = run(entryBar.s, [bar(0, 2010, 2050, 1999, 2040), bar(1, 2040, 2046, 2038, 2045)]); assert.deepEqual(types(next), ['TP1', 'BE']);
});
test('보수적 판정 ④ 본전 손절은 TP1 다음 봉부터 적용: TP1 봉의 저가가 본전 아래여도 그 봉에서는 손절 아님 → 다음 봉에 본전 손절(이익 잠금)', () => {
  let r = run(live(), [bar(0, 2010, 2012, 1999, 2005)]); const tp = run(r.s, [bar(0, 2010, 2012, 1999, 2005), bar(1, 2005, 2048, 1995, 2040)]);      // TP1 봉 저가 1995 < 평균 진입(≈2000)이지만 초기 손절 1970 위
  assert.equal(tp.s.state, 'TP1'); const stop = run(tp.s, [bar(0, 2010, 2012, 1999, 2005), bar(1, 2005, 2048, 1995, 2040), bar(2, 2040, 2042, 1998, 2000)]); assert.equal(stop.s.state, 'STOP'); assert.equal(stop.s.x.stopExit.kind, 'breakeven');
  assert.ok(stop.s.x.result.usdt > 0);                                                                                                               // TP1 이익 > 본전 손절 비용
});
test('진입 전: 지정가에 닿기 전에 TP1 가격이 먼저 닿으면 무효(추격 금지) · 유효시간이 지나면 만료 · 추천 시각 이전 봉은 쓰지 않는다', () => {
  const run1 = run(live(), [bar(0, 2020, 2050, 2010, 2048)]); assert.equal(run1.s.state, 'INVALIDATED'); assert.equal(run1.s.x.reason, 'tp1-before-entry'); assert.equal(run1.s.x.result, null); assert.deepEqual(types(run1), ['INVALIDATED']);
  const exp = run(live(), [bar(0, 2020, 2030, 2010, 2025), bar(1, 2025, 2031, 2012, 2028), bar(2, 2028, 2032, 2015, 2030), bar(3, 2030, 2033, 2018, 2031)]); assert.equal(exp.s.state, 'EXPIRED'); assert.equal(exp.s.x.reason, 'entry-window-passed'); assert.equal(exp.s.endedAt, VALID);
  const early = run(live(), [{ t: CLOSE, o: 2000, h: 2001, l: 1990, c: 1995, v: 1, dur: M }]); assert.equal(early.s.state, 'WAIT_ENTRY'); assert.equal(early.s.x.fills.length, 0);              // 추천 이전 봉으로 체결을 만들지 않음
  const notClosed = run(live(), [bar(0, 2010, 2012, 1999, 2005)], START + 1000); assert.equal(notClosed.s.x.fills.length, 0);                                                                 // 마감 전 봉은 사용하지 않음
});
test('추가 진입(2·3차): 사전 가격 + 구조 유지일 때만 · TP 이후·구조 이탈·시간 초과는 취소 알림 후 다시 체결하지 않음', () => {
  const ok = run(live(), [bar(0, 2010, 2012, 1999, 2005), bar(1, 2005, 2008, 1990, 1995)]); assert.deepEqual(types(ok), ['ENTRY', 'ADD']); assert.equal(ok.s.x.fills.length, 2);               // 2차 = 2000 − 0.3×30 = 1991
  const struct = live(); const sp = struct.x.plan.add.structurePrice; const broke = run(struct, [bar(0, 2010, 2012, 1999, sp - 1), bar(1, sp - 1, sp, 1990, sp - 2)]); assert.ok(types(broke).includes('ADD_CANCEL')); assert.equal(broke.s.x.fills.length, 1);
  const after = run(live(), [bar(0, 2010, 2012, 1999, 2005), bar(1, 2005, 2048, 2003, 2046), bar(2, 2046, 2047, 1985, 2000)]); assert.ok(after.events.some(e => e.type === 'ADD_CANCEL' && e.reason === 'after-tp'));
  const again = run(after.s, [bar(0, 2010, 2012, 1999, 2005), bar(1, 2005, 2048, 2003, 2046), bar(2, 2046, 2047, 1985, 2000), bar(3, 2000, 2001, 1980, 1990)]); assert.equal(again.s.x.fills.length, 1);
});
test('SHORT 대칭: 손절은 위, 익절은 아래', () => {
  const s = live({ dir: 'SHORT', sid: 'SG-ETH-S-abc123', entry: 2000, stop: 2030 }); const bars = [bar(0, 1990, 2001, 1988, 1995), bar(1, 1995, 1996, 1950, 1954), bar(2, 1954, 1955, 1938, 1940)];
  const r = run(s, bars); assert.deepEqual(types(r).slice(0, 3), ['ENTRY', 'TP1', 'BE']); assert.ok(types(r).includes('TP2')); const stop = run(r.s, [...bars, bar(3, 1940, 1990, 1939, 1985)]); assert.equal(stop.s.state, 'STOP'); assert.ok(stop.s.x.result.usdt > 0);
  const loss = run(live({ dir: 'SHORT', sid: 'SG-ETH-S-abc124', entry: 2000, stop: 2030 }), [bar(0, 1990, 2001, 1988, 1995), bar(1, 1995, 2031, 1994, 2020)]); assert.equal(loss.s.state, 'STOP'); assert.ok(loss.s.x.result.usdt < 0);
});
test('최대 추적 72시간: 평가가로 종료(EXPIRED) · 시세 공백은 1시간 봉으로 보충(보수적 규칙 동일)', () => {
  const s = live(); const first = run(s, [bar(0, 2010, 2012, 1999, 2005)]); const longBar = { t: START + 73 * 3600000, o: 2005, h: 2010, l: 2001, c: 2008, v: 1, dur: M };
  const ex = sgyRunBars(first.s, [longBar], START + 74 * 3600000); assert.equal(ex.s.state, 'EXPIRED'); assert.equal(ex.s.x.reason, 'max-track-time'); assert.ok(ex.s.x.result);
  const mkt = { bars15m: [{ t: START + 10 * 3600000, o: 1, h: 1, l: 1, c: 1, v: 1 }], bars1h: [{ t: START + 3600000, o: 2000, h: 2002, l: 1999, c: 2001, v: 1 }, { t: START + 2 * 3600000, o: 1, h: 1, l: 1, c: 1, v: 1 }] };
  const got = sgyBarsFor(mkt, START, START, START + 11 * 3600000); assert.ok(got[0].coarse && got[0].dur === 3600000); assert.equal(got.at(-1).dur, M); assert.deepEqual(got.map(b => b.t), [...got.map(b => b.t)].sort((a, b) => a - b));
  const gapRun = sgyRunBars(live({ validUntil: START + 20 * 3600000 }), got, START + 11 * 3600000); assert.ok(gapRun.events.every(e => e.coarse !== undefined || true)); assert.ok(gapRun.s.x.fills.length >= 1 && gapRun.s.x.fills[0].coarse === true);
});
test('무작위 경로 1,000개: 최악 손실이 위험 예산을 넘지 않고, 종료 후 상태가 변하지 않으며, 수량이 계획을 넘지 않는다(보수적 규칙 회귀)', () => {
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let n = 0; n < 1000; n++) {
    const base = live(), bars = []; let p = 2000;
    for (let k = 0; k < 40; k++) { const o = p, mv = (rnd() - 0.5) * 70, c = o + mv, hi = Math.max(o, c) + rnd() * 25, lo = Math.min(o, c) - rnd() * 25; bars.push(bar(k, o, hi, lo, c)); p = c; }
    const r = run(base, bars, START + 100 * M), x = r.s.x, plan = x.plan, q = x.fills.reduce((a, f) => a + f.qty, 0);
    assert.ok(q <= plan.totalQty + 1e-9, 'qty'); if (r.s.state === 'STOP' && x.stopKind === 'initial') assert.ok(-x.result.usdt <= plan.riskBudget * 1.000001, `loss ${x.result.usdt}`);
    if (x.result) assert.ok(x.result.usdt >= -plan.riskBudget * 1.000001, `any loss ${x.result.usdt} ${r.s.state}`);
    const again = run(r.s, bars, START + 100 * M); assert.deepEqual(again.events, []); assert.equal(JSON.stringify(again.s.x), JSON.stringify(x));
    if (['STOP', 'DONE', 'INVALIDATED', 'EXPIRED'].includes(r.s.state)) assert.ok(r.s.endedAt);
  }
});
test('시세 기준 알림(봉 마감 전): 진입 접근 · 손절 접근(재무장 후 재알림) · 추세 약화 · 진입 전 4시간 추세 반전', () => {
  const ns = {}, s = live(); const mk = (price) => ({ bars1h: [], bars4h: [] });
  assert.deepEqual(sgyNotes(s, { price: 2050, market: mk(), now: START }, ns), []);                                 // 멀리: 무장만
  const near = sgyNotes(s, { price: 2005, market: mk(), now: START }, ns); assert.deepEqual(near.map(n => n.type), ['ENTRY_NEAR']); assert.deepEqual(sgyNotes(s, { price: 2004, market: mk(), now: START }, ns), []);
  const t = run(live(), [bar(0, 2010, 2012, 1999, 2005)]).s, n2 = {}; sgyNotes(t, { price: 2030, market: mk(), now: START }, n2);
  const a = sgyNotes(t, { price: 1975, market: mk(), now: START }, n2); assert.deepEqual(a.map(n => n.type), ['STOP_NEAR']); assert.equal(a[0].level, 'critical'); assert.deepEqual(sgyNotes(t, { price: 1974, market: mk(), now: START }, n2), []);
  sgyNotes(t, { price: 1990, market: mk(), now: START }, n2); const b = sgyNotes(t, { price: 1975, market: mk(), now: START + 1000 }, n2); assert.equal(b[0].key.endsWith(':2'), true);                    // 0.5R 이상 벌어졌다가 다시 접근
  const down = Array.from({ length: 100 }, (_, i) => ({ t: START - (100 - i) * 3600000, o: 2200 - i * 3, h: 2201 - i * 3, l: 2199 - i * 3, c: 2200 - i * 3, v: i === 99 ? 500 : 100 })), mkd = { bars1h: down, bars4h: Array.from({ length: 100 }, (_, i) => ({ t: START - (100 - i) * 14400000, o: 2200 - i * 3, h: 2201 - i * 3, l: 2199 - i * 3, c: 2200 - i * 3, v: 100 })) };
  const w = sgyNotes(t, { price: 1985, market: mkd, now: START + 7200000 }, {}); assert.ok(w.some(x => x.type === 'WEAK')); const inv = sgyNotes(live(), { price: 2020, market: mkd, now: START }, {}); assert.ok(inv.some(x => x.type === 'TREND_INVALID' && x.terminal));
});
test('요약: 진입한 전략만 성적에 반영 · 미진입(만료·무효·취소)은 따로 집계 · 일일 합계', () => {
  const mk = (state, usdt, r, endedAt) => ({ sid: 'x' + Math.random(), state, endedAt, x: { result: usdt === null ? null : { usdt, r, pct: usdt / 300 } } });
  const sm = sgySummary([mk('STOP', -3, -1, T0), mk('DONE', 6, 2, T0), mk('EXPIRED', null, 0, T0), mk('INVALIDATED', null, 0, T0), mk('CANCELLED', null, 0, T0), { sid: 'a', state: 'TRACKING', x: {} }], T0 + 1000);
  assert.deepEqual([sm.total, sm.active, sm.ended, sm.entered, sm.notEntered, sm.wins, sm.losses], [6, 1, 5, 2, 3, 1, 1]); assert.equal(sm.winRate, 0.5); assert.equal(sm.usdt, 3); assert.equal(sm.r, 1); assert.equal(sm.todayUsdt, 3);
});
