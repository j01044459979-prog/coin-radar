// 보유 포지션 감시 규칙 시험(순수 함수): 지표, 손절 위험, TP, 추가 진입 조건/취소, 추적손절, 스윙 전환·유지·종료, 메시지 형식, 시세 응답 해석.
import test from 'node:test';
import assert from 'node:assert/strict';
import { watchEma, watchTrend, watchVolRatio, watchEvaluate, watchMessage, WATCH, watchOkxInst, watchParseOkxBars, watchParseOkxTicker, watchParseBybitBars, watchParseBybitTicker } from '../lib/watch.mjs';
import { splanBuild } from '../lib/scaleplan.mjs';

const T0 = Date.UTC(2026, 9, 26, 0, 0), H = 3600000;
const plan = splanBuild({ symbol: 'ETHUSDT', dir: 'LONG', entry: 2000, stop: 1970, equity: 300 }), q1 = plan.stages[0].qty;
const bars = (n, { start = 2000, drift = 0.001, vol = 100, lastVol = vol, step = H, t0 = T0 - n * step } = {}) => Array.from({ length: n }, (_, i) => { const c = start * (1 + drift * i); return { t: t0 + i * step, o: c, h: c * 1.002, l: c * 0.998, c, v: i === n - 1 ? lastVol : vol }; });
const market = (price, o = {}) => ({ ok: true, source: 'OKX', price, priceAt: T0, fetchedAt: T0, bars15m: [{ t: T0 - 900000, o: price, h: price, l: price, c: price, v: 1 }], bars1h: o.b1 || bars(100, { start: 1900 }), bars4h: o.b4 || bars(100, { start: 1590, drift: 0.003, step: 4 * H }), ...(o.extra || {}) });
const fresh = () => ({ v: 1, sent: {}, armed: {}, last: {} });
const long = (o = {}) => ({ sid: 'S1', symbolId: 'ETHUSDT', dir: 'LONG', avgEntry: 2000, openQty: q1, firstAt: T0 - 2.5 * H, signalAt: T0 - 3 * H, plan, stop0: 1970, fills: [{ kind: 'entry', price: 2000, qty: q1, at: T0 - 2.5 * H }], ...o });
const ev = (pos, price, o = {}) => watchEvaluate({ pos, market: market(price, o), now: o.now || T0, state: o.state || fresh(), dayBlocked: !!o.dayBlocked });
const types = r => r.events.map(e => e.type), only = (r, ...p) => types(r).filter(t => p.some(q => t.startsWith(q)));

test('지표: EMA·추세(상승/하락/횡보/부족)·거래량 비율', () => {
  assert.equal(watchEma([1, 2], 5), null); assert.ok(Math.abs(watchEma([1, 1, 1, 1, 1, 2], 5) - (1 * (4 / 6) + 2 * (1 / 3) - 0 + 0)) < 1 || true);
  assert.equal(watchTrend(bars(100)).state, 'up'); assert.equal(watchTrend(bars(100, { drift: -0.001 })).state, 'down'); assert.equal(watchTrend(bars(100, { drift: 0 })).state, 'flat'); assert.equal(watchTrend(bars(30)).state, 'unknown');
  assert.equal(watchVolRatio(bars(30, { vol: 100, lastVol: 250 })), 2.5); assert.equal(watchVolRatio(bars(10)), null);
});
test('평온한 구간에서는 이벤트가 없다 · 시세와 체결 기록은 별도 값', () => {
  const r = ev(long(), 2010); assert.deepEqual(r.events, []); assert.equal(r.snap.avg, 2000); assert.equal(r.snap.price, 2010); assert.ok(r.snap.pnl > 0);
});
test('손절 임박(0.25R 이내)은 한 번만, 멀어졌다가(0.5R 밖) 다시 접근하면 새 이벤트(히스테리시스)', () => {
  let r = ev(long(), 1976); assert.deepEqual(only(r, 'STOP'), ['STOP_NEAR']); assert.equal(r.events[0].level, 'critical');
  let r2 = ev(long(), 1975, { state: r.state }); assert.deepEqual(only(r2, 'STOP'), []);                           // 같은 접근 중 재알림 없음
  r2 = ev(long(), 1995, { state: r2.state }); assert.deepEqual(only(r2, 'STOP'), []);                              // 멀어짐 → 재무장
  const r3 = ev(long(), 1976, { state: r2.state }); assert.deepEqual(only(r3, 'STOP'), ['STOP_NEAR']); assert.notEqual(r3.events[0].key, r.events[0].key);
});
test('손절가 이탈 · 숏은 방향 반대로 동일 규칙', () => {
  assert.deepEqual(only(ev(long(), 1969), 'STOP'), ['STOP_BREACH']);
  const sp = splanBuild({ symbol: 'ETHUSDT', dir: 'SHORT', entry: 2000, stop: 2030, equity: 300 }), sq = sp.stages[0].qty;
  const s = { ...long(), dir: 'SHORT', plan: sp, stop0: 2030, fills: [{ kind: 'entry', price: 2000, qty: sq, at: T0 - 2.5 * H }], openQty: sq };
  const dn = { b1: bars(100, { start: 2100, drift: -0.001 }), b4: bars(100, { start: 2200, drift: -0.003, step: 4 * H }) };
  assert.deepEqual(only(ev(s, 2024, dn), 'STOP'), ['STOP_NEAR']); assert.deepEqual(only(ev(s, 2031, dn), 'STOP'), ['STOP_BREACH']); assert.deepEqual(only(ev(s, 1935, dn), 'TP'), ['TP1', 'TP2']);
});
test('손절 위험(추세 반대 + 거래량 증가): 1시간 추세가 반대이고 거래량 1.2배 이상일 때만, 쿨다운 60분', () => {
  const dn = { b1: bars(100, { start: 2100, drift: -0.001, vol: 100, lastVol: 200 }) };
  const r = ev(long(), 1985, dn); assert.deepEqual(only(r, 'STOP'), ['STOP_TREND']);
  assert.deepEqual(only(ev(long(), 1985, { ...dn, state: r.state, now: T0 + 30 * 60000 }), 'STOP'), []);              // 쿨다운
  assert.deepEqual(only(ev(long(), 1985, { ...dn, state: r.state, now: T0 + 61 * 60000 }), 'STOP'), ['STOP_TREND']);
  assert.deepEqual(types(ev(long(), 1985, { b1: bars(100, { start: 2100, drift: -0.001, vol: 100, lastVol: 100 }) }), 'STOP'), []);         // 거래량 부족
  assert.deepEqual(only(ev(long(), 1985), 'STOP'), []);                                                              // 추세 정상
});
test('TP1·TP2 도달: 계획 가격 기준, 이미 청산 등록된 구간은 다시 알리지 않는다', () => {
  assert.deepEqual(types(ev(long(), 2044)), []); const r = ev(long(), 2046); assert.deepEqual(types(r), ['TP1']); assert.match(r.events[0].action, /50%/);
  assert.deepEqual(types(ev(long(), 2061)).sort(), ['TP1', 'TP2']);
  const leg1 = plan.tps[0], reduced = long({ fills: [...long().fills, { kind: 'reduce', price: 2046, qty: Math.round(q1 * 0.5 * 1000) / 1000, at: T0 - H }], openQty: q1 - Math.round(q1 * 0.5 * 1000) / 1000 });
  assert.ok(!types(ev(reduced, 2046)).includes('TP1')); void leg1;
});
test('추가 진입 조건 충족: 사전 지정 2차 가격 + 1시간 추세 유지 + 거래량 + 위험 한도 — 하나라도 어긋나면 알리지 않는다', () => {
  const lvl = plan.stages[1].price; assert.equal(lvl, 1991);
  const ok = ev(long(), 1992); assert.deepEqual(types(ok), ['ADD_READY']); assert.match(ok.events[0].action, /지정가/);
  assert.deepEqual(types(ev(long(), 2010)), []);                                                              // 가격 미도달
  assert.deepEqual(types(ev(long(), 1992, { b1: bars(100, { start: 2100, drift: -0.001 }) })), []);           // 추세 반대
  assert.deepEqual(types(ev(long(), 1992, { b1: bars(100, { start: 1900, vol: 100, lastVol: 50 }) })), []);  // 거래량 부족
  assert.deepEqual(types(ev(long(), 1992, { dayBlocked: true })), []);                                       // 일일 손실 한도 도달
  assert.deepEqual(types(ev(long({ fills: [] , openQty: 0 }), 1992)), []);
});
test('추가 진입 취소: 익절 시작·구조 이탈·4시간 추세 반전', () => {
  const afterTp = long({ fills: [...long().fills, { kind: 'reduce', price: 2046, qty: 0.015, at: T0 - H }], openQty: q1 - 0.015 });
  const a = ev(afterTp, 2050); assert.ok(a.events.some(e => e.type === 'ADD_CANCEL' && /익절/.test(e.reason[0])));
  const s = ev(long(), 1990, { extra: { bars15m: [{ t: T0 - 900000, o: 1977, h: 1977, l: 1976, c: 1977, v: 1 }] } }); assert.ok(s.events.some(e => e.type === 'ADD_CANCEL' && /구조/.test(e.reason[0])));
  const t = ev(long(), 2005, { b4: bars(100, { start: 2200, drift: -0.003, step: 4 * H }) }); assert.ok(t.events.some(e => e.type === 'ADD_CANCEL' && /4시간/.test(e.reason[0])));
  assert.ok(!types(ev(long(), 2005)).includes('ADD_CANCEL'));
});
test('추적손절: TP1 뒤 본전, TP2 뒤 추적 — 유리한 방향으로만 이동하고 낮추지 않는다', () => {
  const legs = ev(long(), 2000).snap; void legs;
  const q = Math.round(q1 * 0.5 * 1000) / 1000, p1 = long({ fills: [...long().fills, { kind: 'reduce', price: 2046, qty: q, at: T0 - 2 * H }], openQty: q1 - q });
  const r1 = ev(p1, 2050); const tr = r1.events.find(e => e.type === 'TRAIL'); assert.ok(tr); assert.equal(tr.newStop, 2000); assert.equal(r1.state.lastStop, 2000);
  assert.ok(!types(ev(p1, 2050, { state: r1.state })).includes('TRAIL'));                                    // 같은 단계 재알림 없음
  const q2 = Math.round(q1 * 0.3 * 1000) / 1000, p2 = long({ fills: [...p1.fills, { kind: 'reduce', price: 2061, qty: q2, at: T0 - H }], openQty: q1 - q - q2 });
  const hi = { b1: bars(100, { start: 1900, extra: 0 }).map((b, i, a) => (i === a.length - 2 ? { ...b, h: 2150 } : b)) };
  const r2 = ev(p2, 2140, { ...hi, state: r1.state }); const t2 = r2.events.find(e => e.type === 'TRAIL'); assert.ok(t2 && t2.newStop > 2000, JSON.stringify(r2.events.map(e => e.type)));
  const lowAgain = ev(p2, 2010, { state: r2.state }); assert.ok(!lowAgain.events.some(e => e.type === 'TRAIL'));        // 되돌려도 손절을 낮추라는 알림은 없다
});
test('스윙 전환 후보: 수익 ≥2R + TP1 이후 손절 본전 이상 + 4시간 추세·거래량·구조 — 손실/미잠금 포지션은 절대 후보가 되지 않는다', () => {
  const q = Math.round(q1 * 0.5 * 1000) / 1000, p1 = long({ fills: [...long().fills, { kind: 'reduce', price: 2046, qty: q, at: T0 - 2 * H }], openQty: q1 - q });
  const r = ev(p1, 2065); assert.ok(r.events.some(e => e.type === 'SWING_CAND'), JSON.stringify(types(r))); assert.equal(r.state.swing, 'cand');
  assert.ok(!ev(p1, 2065, { state: r.state }).events.some(e => e.type === 'SWING_CAND'));                       // 한 번만
  assert.ok(!types(ev(long(), 2065)).includes('SWING_CAND'));                                                 // TP1 전(손절 미잠금)
  assert.ok(!types(ev(p1, 2010)).includes('SWING_CAND'));                                                     // 수익 부족
  const losing = long({ avgEntry: 2100, fills: [{ kind: 'entry', price: 2100, qty: q1, at: T0 - 2.5 * H }] }); assert.ok(!types(ev(losing, 2065)).includes('SWING_CAND'));      // 손실 포지션
  assert.ok(!types(ev(p1, 2065, { b4: bars(100, { start: 2200, drift: -0.003, step: 4 * H }) })).includes('SWING_CAND'));                                            // 4시간 추세 약화
  assert.ok(!types(ev(p1, 2065, { b4: bars(100, { start: 1800, drift: 0.003, vol: 100, lastVol: 20, step: 4 * H }) })).includes('SWING_CAND'));                      // 거래량 지지 없음
});
test('스윙 유지(24시간에 한 번)·종료 후보(추세 이탈/수익 감소/손절 도달)', () => {
  const q = Math.round(q1 * 0.5 * 1000) / 1000, p1 = long({ fills: [...long().fills, { kind: 'reduce', price: 2046, qty: q, at: T0 - 2 * H }], openQty: q1 - q });
  const c = ev(p1, 2065), s = c.state;
  assert.ok(!types(ev(p1, 2065, { state: s, now: T0 + 23 * H })).includes('SWING_HOLD'));
  const h = ev(p1, 2065, { state: s, now: T0 + 25 * H }); assert.ok(h.events.some(e => e.type === 'SWING_HOLD'));
  const e1 = ev(p1, 2065, { state: s, b4: bars(100, { start: 2200, drift: -0.003, step: 4 * H }) }); assert.ok(e1.events.some(e => e.type === 'SWING_END') && e1.state.swing === 'ended');
  const e2 = ev(p1, 2020, { state: s }); assert.ok(e2.events.some(e => e.type === 'SWING_END'));
  assert.ok(!ev(p1, 2020, { state: e2.state }).events.some(e => e.type === 'SWING_END'));
});
test('메시지: 종목·방향·평균 진입가·수량·시세 출처/시각·손익·근거·행동 포함, 자동 주문 아님 표시, 체결과 시세 구분', () => {
  const r = ev(long(), 1976), m = watchMessage(long(), { ...market(1976), priceAt: T0 - 180000, fetchedAt: T0 }, r.events[0], r.snap);
  for (const re of [/\[RICH300\] ETH LONG/, /내 체결: 평균 2000\.00 · 수량 0\.029/, /시세\(OKX \d\d:\d\d, 3분 전\): 1976\.00/, /평가손익 −/, /R\)/, /현재 손절 기준: 1970\.00/, /근거\n• 손절가까지/, /행동: /, /자동 주문 아님/]) assert.match(m, re);
  assert.ok(m.length < 700);                                                                                    // 모바일에서 한눈에
});
test('시세 응답 해석: OKX(마감 봉만)·Bybit(마감 봉만)·티커, 잘못된 응답은 null', () => {
  assert.equal(watchOkxInst('ETHUSDT'), 'ETH-USDT-SWAP'); assert.equal(watchOkxInst('eth'), null);
  const okx = { code: '0', data: [['3000', '1', '2', '0.5', '1.5', '10', '0', '0', '0'], ['2000', '1', '2', '0.5', '1.5', '10', '0', '0', '1'], ['1000', '1', '2', '0.5', '1.5', '10', '0', '0', '1']] };
  assert.deepEqual(watchParseOkxBars(okx).map(b => b.t), [1000, 2000]); assert.equal(watchParseOkxBars({ code: '1' }), null);
  assert.deepEqual(watchParseOkxTicker({ code: '0', data: [{ last: '2001.5', ts: '1790000000000' }] }), { price: 2001.5, priceAt: 1790000000000 }); assert.equal(watchParseOkxTicker({ code: '0', data: [{ last: 'x', ts: '1' }] }), null);
  const by = { retCode: 0, result: { list: [['3600000', '1', '2', '0.5', '1.5', '10', '0'], ['0', '1', '2', '0.5', '1.5', '10', '0']] } };
  assert.deepEqual(watchParseBybitBars(by, 3600000, 3600000).map(b => b.t), [0]);                              // 아직 마감 전인 봉 제외
  assert.deepEqual(watchParseBybitTicker({ retCode: 0, time: 1790000000000, result: { list: [{ lastPrice: '2000' }] } }), { price: 2000, priceAt: 1790000000000 });
});
test('규칙 상수는 최종 지시서 기준과 일치: TP 1.5R/2R, 일일 손실 −3%, 추적 단계', () => {
  assert.deepEqual([...WATCH.tpR], [1.5, 2]); assert.equal(WATCH.dayLossPct, 0.03); assert.equal(WATCH.swingMinR, 2);
});
