// 분할 진입 가격(시장 구조 기반) · 단계별 체결 시나리오 · Telegram 매매 전략 메시지. LONG/SHORT 대칭, 일부 분할 미체결·취소 시나리오. 가상 데이터만 사용(네트워크·Telegram 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stgPlan, stgPivots, stgAtr, STG } from '../lib/stages.mjs';
import { sgyBuild, sgyRunBars, sgyNewMessage, sgyEventMessage, sgyScenarios } from '../lib/strategy.mjs';

const M = 900000, H = 3600000, T0 = Date.UTC(2026, 9, 26, 3, 0), CLOSE = T0, VALID = CLOSE + 45 * 60000, START = CLOSE + 15 * 60000;
// 1시간 봉: 완만한 상승 + 지정 위치에 스윙 저점(피벗). 모든 봉 폭 ≈ 8.
const mkBars = ({ n = 100, step = H, start = 1900, drift = 0.001, now = T0, dips = {}, mirrorK = null }) => Array.from({ length: n }, (_, i) => {
  const c = start * (1 + drift * i), dip = dips[i], l = dip !== undefined ? dip : c * 0.998, bar = { t: now - (n - i) * step, o: c, h: c * 1.002, l, c, v: 100 };
  return mirrorK === null ? bar : { t: bar.t, o: 2 * mirrorK - bar.o, h: 2 * mirrorK - bar.l, l: 2 * mirrorK - bar.h, c: 2 * mirrorK - bar.c, v: 100 };
});
const LONGIN = (o = {}) => ({ dir: 'LONG', entry: 2000, stop: 1970, atr1: 8, zone: null, level: null, bars1h: mkBars({ start: 1900 }), bars4h: mkBars({ step: 4 * H, start: 1590, drift: 0.003 }), bars15m: [], ...o });
const fe = (o = {}) => ({ ok: true, kind: 'candidate', sid: 'SG-ETH-L-abc123', symbolId: 'ETHUSDT', dir: 'LONG', entry: 2000, stop: 1970, triggerT: CLOSE - M, closeT: CLOSE, validUntil: VALID, score: 70, rr1: 1.9, evidence: ['4H 상승'], createdAt: CLOSE + 1, ...o });
const live = (stage, o = {}) => { const r = sgyBuild(fe(o), { now: CLOSE + 5 * 60000, stage }); assert.equal(r.ok, true, JSON.stringify(r.reason)); const s = r.s; s.state = 'WAIT_ENTRY'; s.x.startT = START; return s; };
const bar = (k, o, h, l, c) => ({ t: START + k * M, o, h, l, c, v: 100, dur: M });
const run = (s, bars, now = START + 200 * M) => sgyRunBars(s, bars, now), types = r => r.events.map(e => e.type);

test('구조 후보: 구간 경계·스윙 저점·돌파선이 모이면 그 가격(지지 바로 위)에 2·3차, 근거 라벨 포함 · 검증 규칙(간격·손절 여유·깊이)', () => {
  const p = stgPlan(LONGIN({ zone: { lo: 1980, hi: 1990 }, level: 1996 })); assert.equal(p.ok, true); assert.deepEqual(p.stages.map(s => s.n), [2, 3]);
  const [a, b] = p.stages, R = 30; assert.ok(a.price > 1990 && a.price < 1993, String(a.price)); assert.ok(b.price > 1980 && b.price < 1983, String(b.price));            // 지지 구간 상단·하단 바로 위
  assert.ok(a.why.some(w => /1H 지지 구간 상단 1990\.00/.test(w))); assert.ok(b.why.some(w => /1H 지지 구간 하단 1980\.00/.test(w))); assert.ok(a.depthR >= STG.s2[0] && a.depthR <= STG.s2[1]); assert.ok(b.depthR >= a.depthR + STG.gap3R && b.depthR <= STG.s3Max);
  assert.ok((a.price - 1970) / R >= STG.stopRoomR && (b.price - 1970) / R >= STG.stopRoomR); assert.ok(2000 - a.price >= STG.minFromE1Atr * p.atr); assert.ok(a.price - b.price >= Math.max(STG.minGapR * R, STG.minGapAtr * p.atr)); assert.deepEqual(p.addR, [a.depthR, b.depthR]);
  assert.deepEqual([p.trends.h1, p.trends.h4], ['상승', '상승']);
});
test('스윙 저점 두 곳이 가까이 모이면(1시간 2+2=4점) 후보 · 한 곳만(2점)이면 부족 · 고정 −0.3R/−0.6R 을 기계적으로 쓰지 않는다', () => {
  const bars1h = mkBars({ start: 1900, dips: { 85: 1986.4, 90: 1985.9 } }), p = stgPlan(LONGIN({ bars1h }));
  assert.ok(p.stages.length >= 1); const first = p.stages[0]; assert.ok(first.why.some(w => /1시간 스윙 저점/.test(w))); assert.ok(first.score >= 4); assert.ok(first.price > 1986.4 && first.price < 1989, String(first.price)); assert.notEqual(Math.round(first.depthR * 10) / 10 === 0.3 && Math.abs(first.price - 1991) < 0.05, true);
  const piv = stgPivots(bars1h, 'low', 2, 72).map(x => x.price); assert.ok(piv.includes(1986.4) && piv.includes(1985.9));
  assert.equal(stgPlan(LONGIN({ bars1h: mkBars({ start: 1900, dips: { 90: 1986.4 } }) })).stages.length, 0);
});
test('근거가 약하면 억지로 분할하지 않는다: 점수 부족·구조 없음 → 1차 단독 · 3차만 없으면 2차까지 · 잡음 거리·손절 여유 위반 후보 제외', () => {
  const none = stgPlan(LONGIN({ bars1h: mkBars({ start: 1900 }) })); assert.deepEqual([none.ok, none.stages.length, none.addR.length], [true, 0, 0]); assert.ok(none.notes.some(n => /억지로 분할하지 않고 1차 단독/.test(n)));
  const weak = stgPlan(LONGIN({ bars1h: mkBars({ start: 1900 }), bars15m: mkBars({ n: 60, step: M, start: 1990, drift: 0, now: T0, dips: { 40: 1991 } }) })); assert.equal(weak.stages.length, 0);                    // 15분 스윙(가중치 1)만으로는 부족
  const two = stgPlan(LONGIN({ zone: { lo: 1985, hi: 1990 } })); assert.equal(two.stages.length, 2);
  const only2 = stgPlan(LONGIN({ zone: { lo: 1993.5, hi: 1990 } })); assert.ok(only2.stages.length >= 1);
  const noise = stgPlan(LONGIN({ zone: { lo: 1999, hi: 1998.5 } })); assert.equal(noise.stages.length, 0);                                       // 1차에서 0.25 ATR 도 안 떨어진 가격은 잡음 체결 → 제외
  const nearStop = stgPlan(LONGIN({ zone: { lo: 1971, hi: 1972 } })); assert.equal(nearStop.stages.length, 0);                                    // 손절선 바로 위(0.2R 미만 여유) → 제외
  const deep = stgPlan(LONGIN({ zone: { lo: 1960, hi: 1975 } })); assert.equal(deep.stages.length, 0);                                            // 0.8R 보다 깊음
  const noAtr = stgPlan(LONGIN({ atr1: undefined, bars1h: [] , zone: { lo: 1980, hi: 1990 } })); assert.equal(noAtr.stages.length, 0); assert.ok(noAtr.notes.some(n => /ATR/.test(n)));
});
test('추세 검증: 4시간 추세가 반대면 추가 진입 없음 · 1시간 추세가 반대면 2차까지 · 15분 추세는 근거로만', () => {
  const zone = { lo: 1980, hi: 1990 }, down = (step, start) => mkBars({ step, start, drift: -0.001 });
  const h4 = stgPlan(LONGIN({ zone, bars4h: down(4 * H, 2300) })); assert.equal(h4.stages.length, 0); assert.ok(h4.notes.some(n => /4시간 추세가 하락 — 롱 추가 진입\(물타기\) 금지/.test(n)));
  const h1 = stgPlan(LONGIN({ zone, bars1h: down(H, 2100) })); assert.ok(h1.stages.length <= 1); assert.ok(h1.notes.some(n => /1시간 추세가 하락 — 추가 진입은 2차까지만/.test(n)));
  assert.equal(stgPlan(LONGIN({ zone })).stages.length, 2);
});
test('SHORT 대칭: 같은 구조를 거울상으로 놓으면 가격·깊이·근거가 대칭이다 (저항 구간·스윙 고점 바로 아래)', () => {
  const K = 2000, L = stgPlan(LONGIN({ zone: { lo: 1980, hi: 1990 }, level: 1996 }));
  const S = stgPlan({ dir: 'SHORT', entry: 2000, stop: 2030, atr1: 8, zone: { lo: 2010, hi: 2020 }, level: 2004, bars1h: mkBars({ start: 1900, mirrorK: K }), bars4h: mkBars({ step: 4 * H, start: 1590, drift: 0.003, mirrorK: K }), bars15m: [] });
  assert.equal(S.stages.length, 2); S.stages.forEach((s, i) => { assert.ok(Math.abs(s.price - (2 * K - L.stages[i].price)) < 0.011, `${s.price} vs ${2 * K - L.stages[i].price}`); assert.ok(Math.abs(s.depthR - L.stages[i].depthR) < 1e-3); });
  assert.ok(S.stages[0].price < 2010 && S.stages[0].price > 2007); assert.ok(S.stages[0].why.some(w => /1H 저항 구간 하단 2010\.00/.test(w))); assert.ok(S.stages[1].why.some(w => /1H 저항 구간 상단 2020\.00/.test(w)));
  const shortStrongUp = stgPlan({ dir: 'SHORT', entry: 2000, stop: 2030, atr1: 8, zone: { lo: 2010, hi: 2020 }, level: null, bars1h: mkBars({ start: 1900 }), bars4h: mkBars({ step: 4 * H, start: 1590, drift: 0.003 }), bars15m: [] }); assert.equal(shortStrongUp.stages.length, 0);          // 4시간 상승 중 숏 추가 진입 금지
});
test('플랜: 구조 가격이 그대로 splan 의 단계 가격이 되고, 세 분할 모두 체결 후 손절해도 위험 예산 이내 · 단계별 시나리오 표 · 찾지 못한 단계는 만들지 않는다', () => {
  const st = stgPlan(LONGIN({ zone: { lo: 1980, hi: 1990 }, level: 1996 })), s = live(st), plan = s.x.plan;
  assert.deepEqual(plan.stages.map(x => x.price), [2000, ...st.stages.map(x => Number(x.price.toFixed(2)))]); assert.equal(s.x.stageInfo.source, 'structure'); assert.ok(plan.worstLoss <= plan.riskBudget * 1.000001); assert.ok(plan.add.structurePrice < plan.stages[2].price);
  const sc = sgyScenarios(plan); assert.equal(sc.length, 3); assert.ok(Math.abs(sc[2].loss - plan.worstLoss) < 1e-9); assert.ok(sc[0].loss < sc[1].loss && sc[1].loss < sc[2].loss); assert.ok(sc[2].avg < sc[1].avg && sc[1].avg < sc[0].avg);               // 롱: 깊이 체결될수록 평균 하락
  assert.ok(sc.every(k => k.loss <= plan.riskBudget * 1.000001) && sc[0].margin < sc[2].margin);
  const one = live(stgPlan(LONGIN({ bars1h: mkBars({ start: 1900 }) }))); assert.equal(one.x.plan.stagesCount, 1); assert.equal(one.x.plan.stages[0].weight, 1); assert.ok(one.x.stageInfo.notes.some(n => /1차 단독/.test(n)));
  const two = live(stgPlan(LONGIN({ zone: { lo: 2000, hi: 1990 } }))); assert.equal(two.x.plan.stagesCount, 2); assert.ok(Math.abs(two.x.plan.stages[0].weight - 0.625) < 0.01 && Math.abs(two.x.plan.stages[1].weight - 0.375) < 0.01);
});
test('메시지: 요구 항목 전부(1~3차 가격/비중/수량/증거금·근거·조건·유효기간 · 손절·익절·추적·평균가·최대 손실·무효화·유효시간) + 지정가 안내 + 가상 체결 주의', () => {
  const s = live(stgPlan(LONGIN({ zone: { lo: 1980, hi: 1990 }, level: 1996 }))), t = sgyNewMessage(s, { price: 2005, priceAt: CLOSE + 2 * 60000, source: 'OKX', now: CLOSE + 5 * 60000 }), plan = s.x.plan;
  assert.ok(t.length < 3900, `길이 ${t.length}`); assert.match(t, /^\[RICH300 매매 전략\]\n🟢 ETH \/ LONG \/ 추천 점수 70/);
  for (const st of plan.stages) assert.match(t, new RegExp(`${st.n}차 진입: ${st.price.toFixed(2).replace('.', '\\.')} / ${Math.round(st.weight * 100)}% / 수량 ${st.qty.toFixed(3).replace('.', '\\.')} / 증거금 ${st.margin.toFixed(2).replace('.', '\\.')} USDT`));
  for (const re of [/근거: 추천 기준가/, /근거: 1H 지지 구간 상단 1990\.00 \(1차 대비 −0\.\d+R\)/, /조건: 매수 지정가 2000\.00 · 유효 ~12:45 KST/, /조건: 1차 체결 뒤 매수 지정가 1990\.90 · 직전 15분 종가 [\d.]+ 위 · 유효 ~16:00 KST/, /최초 손절가: 1970\.00/, /1차 익절가: 2045\.00 \(\+1\.5R\)/, /2차 익절가: 2060\.00 \(\+2R\)/, /잔여 물량 추적손절: 20%/,
    /세 분할 모두 체결 시 예상 평균가: 1994\.\d\d \(총 수량 0\.\d+ · 증거금 [\d.]+ USDT · 격리 3배\)/, /전체 예상 최대 손실: −2\.\d\d USDT \(평가액 300 의 0\.\d+% · 위험 예산 3\.00 이내/, /추가 진입 무효화 조건: TP1 도달 · 15분 종가가 [\d.]+ 아래 · 신호 후 240분/, /추천 유효시간: 1차 ~12:45 KST\(남은 40분\) · 2·3차 ~16:00 KST/, /시장 구조: 15분 .+ 1시간 상승 · 4시간 상승 · 1H ATR/, /매수 지정가\(Limit\)로 직접 설정/, /수량 단위 0\.001/, /실제 체결은 Binance 주문 내역에서 직접 확인/, /실제 Binance 체결 아님 · 자동 주문 아님/]) assert.match(t, re);
  const sh = live(stgPlan({ dir: 'SHORT', entry: 2000, stop: 2030, atr1: 8, zone: { lo: 2010, hi: 2020 }, level: null, bars1h: mkBars({ start: 2100, drift: -0.001, mirrorK: null }), bars4h: mkBars({ step: 4 * H, start: 2400, drift: -0.003 }), bars15m: [] }), { dir: 'SHORT', sid: 'SG-ETH-S-abc123', stop: 2030 }), ts = sgyNewMessage(sh, { price: 1995, priceAt: CLOSE, source: 'OKX', now: CLOSE + 5 * 60000 });
  assert.match(ts, /🔴 ETH \/ SHORT/); assert.match(ts, /매도 지정가\(Limit\)로 직접 설정/); assert.match(ts, /2차 진입: 20(0|1)\d\.\d\d/); assert.match(ts, /15분 종가가 [\d.]+ 위 — |15분 종가가 [\d.]+ 위 ·/);
  const single = sgyNewMessage(live(stgPlan(LONGIN({ bars1h: mkBars({ start: 1900 }) }))), { price: 2001, priceAt: CLOSE, now: CLOSE + 5 * 60000 }); assert.match(single, /2차 진입: 설정하지 않음 — 2차로 쓸 만한 구조 가격/); assert.match(single, /3차 진입: 설정하지 않음/); assert.match(single, /1차 진입: 2000\.00 \/ 100%/); assert.match(single, /추가 진입 무효화 조건: 해당 없음/); assert.match(single, /한 분할 모두 체결 시/);
});
test('일부 분할 미체결 ① 1차만 체결 후 TP1: 2·3차는 함께 취소(+) · 평균·손실 재계산 · 남은 지정가 안내 · 체결 안 된 단계는 이후 체결되지 않는다(LONG)', () => {
  const s = live(stgPlan(LONGIN({ zone: { lo: 1980, hi: 1990 }, level: 1996 }))), bars = [bar(0, 2010, 2012, 1999.5, 2005), bar(1, 2005, 2048, 2003, 2046), bar(2, 2046, 2047, 2030, 2040)];
  const r1 = run(s, bars.slice(0, 1)); assert.deepEqual(types(r1), ['ENTRY']); const m1 = sgyEventMessage(r1.s, r1.events[0], { price: 2005, now: START + M });
  assert.match(m1, /현재 체결 1\/3단계 · 평균 진입가 2000\.00 · 수량 0\.052 · 현재 손절 1970\.00 에서 청산 시 손실 −1\.8\d USDT \(예산 3\.00\)/); assert.match(m1, /남은 지정가: 2차 1990\.90\(0\.031\) · 3차 1980\.90\(0\.021\)/); assert.match(m1, /실제 Binance 주문이 체결됐다는 뜻이 아닙니다/);
  const r3 = run(r1.s, bars); assert.deepEqual(types(r3), ['TP1', 'BE', 'ADD_CANCEL', 'ADD_CANCEL']); assert.equal(r3.s.x.fills.length, 1); assert.deepEqual(r3.events.filter(e => e.type === 'ADD_CANCEL').map(e => [e.n, e.reason]), [[2, 'after-tp'], [3, 'after-tp+']]);
  const c = sgyEventMessage(r3.s, r3.events[2], { price: 2046, now: START + 3 * M }); assert.match(c, /2차\(1990\.90\) 추가 진입 취소: 익절이 시작되어 추가 진입 취소/); assert.match(c, /Binance 에 걸어 둔 해당 지정가가 있으면 취소하세요/); assert.match(c, /취소된 단계: 2차 · 3차/);
  const later = run(r3.s, [...bars, bar(3, 2040, 2041, 1979, 1985)]); assert.equal(later.s.x.fills.length, 1);                                       // 취소된 단계는 가격이 닿아도 체결 안 됨
});
test('일부 분할 미체결 ② 1·2차 체결 후 손절: 3차 미체결 → 손실은 2단계 시나리오와 같고 예산 이내 · 평균가 재계산', () => {
  const s = live(stgPlan(LONGIN({ zone: { lo: 1980, hi: 1990 }, level: 1996 }))), plan = s.x.plan, sc = sgyScenarios(plan);
  const r = run(s, [bar(0, 2010, 2012, 1999.5, 2005), bar(1, 2005, 2006, 1989, 1992), bar(2, 1992, 1993, 1969, 1971)].map(b => b));      // 3차(1980.90)는 두 번째 봉에서 1989 까지만 → 닿지 않음, 세 번째 봉에서 손절선까지
  assert.deepEqual(types(r), ['ENTRY', 'ADD', 'ADD', 'STOP']); assert.equal(r.s.x.fills.length, 3);                                              // 마지막 봉이 3차 가격까지 내려가므로 3차도 체결 후 손절(최악 가정)
  const r2 = run(s, [bar(0, 2010, 2012, 1999.5, 2005), bar(1, 2005, 2006, 1985, 1992), bar(2, 1992, 1993, 1981.5, 1982)]); assert.equal(r2.s.x.fills.length, 2); const stop = run(r2.s, [bar(0, 2010, 2012, 1999.5, 2005), bar(1, 2005, 2006, 1985, 1992), bar(2, 1992, 1993, 1981.5, 1982), bar(3, 1982, 1983, 1979.5, 1979)]);
  assert.equal(stop.s.x.fills.length, 3);  // 3차는 1980.9 에 닿으면 체결(1979.5 < 1980.9) → 3단계 모두
  const st2 = run(r2.s, [bar(0, 2010, 2012, 1999.5, 2005), bar(1, 2005, 2006, 1985, 1992), bar(2, 1992, 1993, 1981.5, 1982), bar(3, 1982, 1985, 1981.2, 1984)]); assert.equal(st2.s.x.fills.length, 2);
  const m = sgyEventMessage(r2.s, r2.events.find(e => e.type === 'ADD'), { price: 1992, now: START + 3 * M }); assert.match(m, /현재 체결 2\/3단계 · 평균 진입가 199[5-7]\.\d\d/); assert.match(m, /남은 지정가: 3차 1980\.90/);
  const only2 = { ...r2.s, x: { ...r2.s.x, stopPrice: 1970 } }; const stopped = run(only2, [bar(0, 2010, 2012, 1999.5, 2005), bar(1, 2005, 2006, 1985, 1992), bar(2, 1992, 1993, 1981.5, 1982)]); void stopped;
  assert.ok(sc[1].loss > sc[0].loss && sc[1].loss <= plan.riskBudget);
});
test('일부 분할 미체결 ③ 구조 이탈(직전 15분 종가가 구조선 아래)·허용 시간 경과 → 남은 단계 모두 취소, 모순 없음 · 2차 취소면 3차도 취소', () => {
  const s = live(stgPlan(LONGIN({ zone: { lo: 1980, hi: 1990 }, level: 1996 }))), sp = s.x.plan.add.structurePrice;
  const r = run(s, [bar(0, 2010, 2012, 1999.5, sp - 0.5), bar(1, sp - 0.5, sp, 1989, 1990)]); assert.deepEqual(r.events.filter(e => e.type === 'ADD_CANCEL').map(e => [e.n, e.reason]), [[2, 'structure'], [3, 'structure+']]); assert.equal(r.s.x.fills.length, 1);
  const w = run(s, [bar(0, 2010, 2012, 1999.5, 2005), ...Array.from({ length: 17 }, (_, i) => bar(1 + i, 2005, 2008, 1996, 2004))]); assert.deepEqual(w.events.filter(e => e.type === 'ADD_CANCEL').map(e => [e.n, e.reason]), [[2, 'window'], [3, 'window+']]);
  assert.equal(w.s.x.fills.length, 1); assert.equal(w.s.state, 'TRACKING');
});
test('일부 분할 미체결 ④ SHORT: 1차만 체결 후 손절 → 1단계 시나리오 손실 · 2·3차 진입 전 반등이 손절 직전까지 가면 모두 체결 후 손절(최악, 예산 이내)', () => {
  const stage = stgPlan({ dir: 'SHORT', entry: 2000, stop: 2030, atr1: 8, zone: { lo: 2010, hi: 2020 }, level: null, bars1h: mkBars({ start: 2100, drift: -0.001 }), bars4h: mkBars({ step: 4 * H, start: 2400, drift: -0.003 }), bars15m: [] });
  assert.equal(stage.stages.length, 2); const s = live(stage, { dir: 'SHORT', sid: 'SG-ETH-S-abc123', stop: 2030 }), plan = s.x.plan, sc = sgyScenarios(plan);
  assert.ok(sc[1].avg > sc[0].avg && sc[2].avg > sc[1].avg, '숏: 높게 체결될수록 평균 상승'); assert.ok(sc.every(k => k.loss <= plan.riskBudget * 1.000001));
  const full = run(s, [bar(0, 1990, 2001, 1988, 1995), bar(1, 1995, 2031, 1994, 2020)]); assert.deepEqual(types(full), ['ENTRY', 'ADD', 'ADD', 'STOP']); assert.ok(-full.s.x.result.usdt <= plan.riskBudget * 1.000001 && -full.s.x.result.usdt > 0);
  const m = sgyEventMessage(full.s, full.events[1], { price: 2012, now: START + 2 * M }); assert.match(m, /2\/3단계 · 평균 진입가 200[3-9]\.\d\d/);
  const first = run(s, [bar(0, 1990, 2001, 1988, 1995)]); assert.equal(first.s.x.fills.length, 1); const bounce = run(first.s, [bar(0, 1990, 2001, 1988, 1995), bar(1, 1995, 2008, 1994, 2006)]); assert.equal(bounce.s.x.fills.length, 1); assert.equal(bounce.s.state, 'TRACKING');       // 2차(≈2009)에 닿지 않은 반등: 1차만 유지, 모순 없음
});
test('최소 주문 수량·가격 단위: 비싼 종목은 단계가 줄고(분할 불가 시 제외), 메시지에 수량 단위가 표시된다 · 계획 불가는 CANCELLED', () => {
  const btc = fe({ symbolId: 'BTCUSDT', sid: 'SG-BTC-L-aaa111', entry: 100000, stop: 98500 }), st = stgPlan({ dir: 'LONG', entry: 100000, stop: 98500, atr1: 400, zone: { lo: 99000, hi: 99400 }, level: null, bars1h: mkBars({ start: 95000, step: H, drift: 0.0005 }), bars4h: mkBars({ step: 4 * H, start: 80000, drift: 0.003 }), bars15m: [] });
  const r = sgyBuild(btc, { now: CLOSE + 5 * 60000, stage: st }); if (r.ok) { assert.ok(r.s.x.plan.stagesCount <= 3); assert.ok(r.s.x.plan.stages.every(x => x.qty >= r.s.x.plan.spec.minQty)); assert.match(sgyNewMessage({ ...r.s }, { price: 100000, priceAt: CLOSE, now: CLOSE + 5 * 60000 }), /수량 단위 0\.001/); } else assert.match(r.reason, /^plan-/);
  const tiny = sgyBuild(fe({ stop: 1999 }), { now: CLOSE + 5 * 60000, stage: stgPlan(LONGIN({ stop: 1999, zone: { lo: 1980, hi: 1990 } })) }); assert.equal(tiny.ok, false); assert.equal(tiny.s.state, 'CANCELLED');
});
test('무작위 시장(LONG/SHORT 각 300개): 단계 가격은 항상 규칙을 지키고(순서·깊이·간격·손절 여유), 모든 단계 체결 후 손절 손실은 예산 이내', () => {
  let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (const dir of ['LONG', 'SHORT']) for (let n = 0; n < 300; n++) {
    const dips = {}; for (let k = 0; k < 4; k++) dips[40 + Math.floor(rnd() * 58)] = 1975 + rnd() * 30; const mir = dir === 'SHORT' ? 2000 : null, zl = 1972 + rnd() * 14, zh = zl + 2 + rnd() * 10;
    const inp = dir === 'LONG' ? LONGIN({ zone: rnd() < 0.7 ? { lo: zl, hi: zh } : null, level: rnd() < 0.5 ? 1990 + rnd() * 8 : null, bars1h: mkBars({ start: 1900, dips }) })
      : { dir, entry: 2000, stop: 2030, atr1: 8, zone: rnd() < 0.7 ? { lo: 4000 - zh, hi: 4000 - zl } : null, level: rnd() < 0.5 ? 2002 + rnd() * 8 : null, bars1h: mkBars({ start: 1900, dips, mirrorK: mir }), bars4h: mkBars({ step: 4 * H, start: 1590, drift: 0.003, mirrorK: mir }), bars15m: [] };
    const p = stgPlan(inp), s = dir === 'LONG' ? 1 : -1; let prev = inp.entry;
    for (const st of p.stages) { assert.ok((prev - st.price) * s > 0, 'depth order'); assert.ok(st.depthR >= STG.s2[0] - 1e-9 && st.depthR <= STG.s3Max + 1e-9); assert.ok((st.price - inp.stop) * s >= STG.stopRoomR * 30 - 1e-6); assert.ok(st.why.length >= 1 && st.score >= STG.minScore); prev = st.price; }
    const r = sgyBuild(fe(dir === 'LONG' ? {} : { dir, sid: 'SG-ETH-S-abc123', stop: 2030 }), { now: CLOSE + 5 * 60000, stage: p }); if (r.ok) { const plan = r.s.x.plan; assert.ok(plan.worstLoss <= plan.riskBudget * 1.000001); assert.ok(sgyScenarios(plan).every(k => k.loss <= plan.riskBudget * 1.000001)); }
  }
});
