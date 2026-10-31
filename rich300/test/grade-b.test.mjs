// B급 공격형 전략 생성·위험 한도·구조 무효화·메시지 구분·저장 왕복 테스트(가상 데이터, 네트워크·Telegram·주문 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sgyBuild, sgyRunBars, sgyNewMessage, sgyCancelMessage, sgyEventMessage, sgyGrade, SGY_GRADE_TAG, STRAT } from '../lib/strategy.mjs';
import { feedParseEntry } from '../lib/feed.mjs';
import { ENTITIES } from '../lib/schema.mjs';

const M = 900000, T0 = Date.UTC(2026, 9, 26, 3, 0), CLOSE = T0, VALID = CLOSE + 45 * 60000, START = CLOSE + 15 * 60000;
const fe = (o = {}) => ({ ok: true, kind: 'candidate', grade: 'B', swing: 1984, sid: 'SG-ETH-L-bbb001', symbolId: 'ETHUSDT', dir: 'LONG', entry: 2000, stop: 1976, triggerT: CLOSE - M, closeT: CLOSE, validUntil: VALID, score: 70, rr1: 2.4, ref1: 2060, ref2: 2090, evidence: ['4H 상승', '구조 회복', '손절=눌림 저점'], ...o });
const feA = (o = {}) => fe({ grade: 'A', swing: undefined, sid: 'SG-ETH-L-aaa001', stop: 1970, rr1: 1.9, ...o });
const bar = (k, o, h, l, c) => ({ t: START + k * M, o, h, l, c, v: 100, dur: M });
const ctx = (o = {}) => ({ now: CLOSE + 60000, ...o });
const live = (f = fe()) => { const r = sgyBuild(f, ctx()); assert.equal(r.ok, true, JSON.stringify(r.reason)); const s = r.s; s.state = 'WAIT_ENTRY'; s.x.startT = START; return s; };

test('피드 파싱: 등급 필드가 없으면 A급(이전 피드와 호환), B급은 눌림 저점이 진입가와 손절 사이에 있어야 한다', () => {
  const raw = { sid: 'SG-ETH-L-abc123', symbol: 'ETHUSDT', dir: 'LONG', entry: '2000', stop: '1976', closeT: String(CLOSE), triggerT: String(CLOSE - M), validUntil: String(VALID), createdAt: String(CLOSE) };
  assert.equal(feedParseEntry(raw).grade, 'A'); assert.equal(feedParseEntry(raw).swing, undefined);
  const b = feedParseEntry({ ...raw, grade: 'B', swing: '1984' }); assert.equal(b.ok, true); assert.equal(b.grade, 'B'); assert.equal(b.swing, 1984);
  for (const sw of [undefined, '1970', '2001', 'x']) assert.deepEqual(feedParseEntry({ ...raw, grade: 'B', swing: sw }), { ok: false, why: 'b-bad-swing' });
  assert.equal(feedParseEntry({ ...raw, grade: 'Z', swing: '1984' }).grade, 'A', '알 수 없는 등급은 A급으로 취급(B급 완화 경로 없음)');
});
test('B급 생성: 거래당 손실 한도 1.5 USDT · 격리 3배 이하 · 최악 손실이 한도 이내 · 등급이 x 본문에 저장된다 (A급은 이전과 같은 3 USDT)', () => {
  const s = live(), p = s.x.plan, a = live(feA());
  assert.equal(sgyGrade(s), 'B'); assert.equal(s.x.grade, 'B'); assert.equal(s.x.riskLabel, 'b'); assert.ok(Math.abs(p.riskBudget - 1.5) < 1e-9, `예산 ${p.riskBudget}`); assert.ok(p.worstLoss <= 1.5 + 1e-9); assert.ok(p.lev <= 3); assert.ok(p.marginUsage <= 0.3 + 1e-9);
  assert.equal(sgyGrade(a), 'A'); assert.ok(Math.abs(a.x.plan.riskBudget - 3) < 1e-9); assert.equal(a.x.grade, undefined);
  assert.equal(s.x.plan.stop, 1976, '최초 손절가는 피드 값 그대로(위험 예산을 키우려고 옮기지 않음)');
});
test('B급 구조 유지선: 추가 진입 구조 가격이 눌림 저점이고, 그 바깥 분할 가격은 만들지 않는다', () => {
  const s = live(), p = s.x.plan;
  assert.ok(Math.abs(p.add.structurePrice - 1984) < 0.51, `구조선 ${p.add.structurePrice}`);
  for (const st of p.stages.slice(1)) assert.ok(st.price > 1984, `${st.n}차 ${st.price} 는 구조선 안쪽`);
  const near = live(fe({ swing: 1997, sid: 'SG-ETH-L-bbb002' })); assert.equal(near.x.plan.stagesCount, 1, '구조선이 진입가 코앞이면 추가 진입 없음(1차 단독)');
});
test('B급 위험 한도: 비용 반영 1차 손익비 2R 미만 · B급 하루 누적 손실 9 USDT · 전체 일일 손실(−3%) · 증거금 한도는 전략을 만들지 않고 CANCELLED 로 기록', () => {
  const lowRR = sgyBuild(fe({ rr1: 1.99 }), ctx()); assert.deepEqual([lowRR.ok, lowRR.reason, lowRR.notify, lowRR.s.state], [false, 'b-rr-below-2', true, 'CANCELLED']); assert.equal(sgyBuild(fe({ rr1: 2 }), ctx()).ok, true); assert.equal(sgyBuild(feA({ rr1: 1.6 }), ctx()).ok, true, 'A급은 2R 요구 없음');
  const bd = sgyBuild(fe(), ctx({ dayPnlB: -9 })); assert.deepEqual([bd.ok, bd.reason], [false, 'b-day-loss-limit']); assert.equal(sgyBuild(fe(), ctx({ dayPnlB: -8.99 })).ok, true); assert.equal(sgyBuild(feA(), ctx({ dayPnlB: -50 })).ok, true, 'B급 손실이 A급 생성을 막지 않는다');
  assert.equal(sgyBuild(fe(), ctx({ dayPnl: -9.01 })).reason, 'day-loss-limit'); assert.equal(sgyBuild(fe(), ctx({ activeMargin: 89 })).reason, 'margin-cap-total'); assert.equal(sgyBuild(fe(), { now: VALID + 1 }).reason, 'expired-on-arrival');
  assert.equal(STRAT.gradeB.riskUsdt, 1.5); assert.equal(STRAT.gradeB.dayLossUsdt, 9); assert.equal(STRAT.gradeB.minNetRR, 2); assert.equal(STRAT.gradeB.maxLev, 3);
});
test('손절은 더 멀어지지 않는다: 어떤 경로에서도 손절가는 최초 손절 이상(LONG)이고 본전·추적으로만 이익 쪽으로 이동', () => {
  let s = live(); const stops = [s.x.stopPrice];
  const bars = [bar(0, 2000, 2003, 1995, 1998), bar(1, 1998, 2001, 1990, 1996), bar(2, 1996, 2062, 1994, 2060), bar(3, 2060, 2092, 2058, 2090), bar(4, 2090, 2095, 2070, 2075)];
  for (let k = 1; k <= bars.length; k++) { s = sgyRunBars(s, bars.slice(0, k), START + 60 * M).s; stops.push(s.x.stopPrice); }
  assert.ok(stops.every(v => v >= 1976), `손절 경로 ${stops}`); assert.ok(stops.every((v, i) => i === 0 || v >= stops[i - 1]), '단조 비감소(LONG)'); assert.equal(stops[0], 1976);
  const loss = [s.x.plan.worstLoss]; assert.ok(loss[0] <= 1.5 + 1e-9);
});
test('구조 무너짐: 추가 진입은 구조 유지선 위에서만, 익절이 시작되면 남은 지정가는 취소되고 손절은 더 멀어지지 않는다', () => {
  const s = live(), n = s.x.plan.stagesCount; assert.ok(n >= 2, `추가 진입이 있어야 취소를 시험할 수 있다(${n}단계)`);
  const r = sgyRunBars(s, [bar(0, 2002, 2003, 1999.5, 2001), bar(1, 2001, 2065, 2000.5, 2062), bar(2, 2062, 2070, 2055, 2060)], START + 60 * M);
  const types = r.events.map(e => e.type); assert.ok(types.includes('TP1')); assert.ok(types.includes('ADD_CANCEL'), `익절 시작 뒤 미체결 추가 진입 취소: ${types}`);
  assert.ok(r.s.x.fills.every(f => f.n === 1 || f.price > 1984)); assert.ok(r.s.x.stopPrice >= 1976);
  // 1차 체결 뒤 직전 15분 종가가 구조 유지선(1984) 아래이면 아직 안 채워진 추가 진입은 취소된다: 추가 진입 가격에 닿지 않은 봉으로 구성(갭 위 마감 후 급락 없이 종가만 낮음은 불가능하므로 종가 기준 직접 설정)
  const t = live(); const r2 = sgyRunBars(t, [bar(0, 2002, 2003, 1999.5, 2001)], START + 60 * M); const u = JSON.parse(JSON.stringify(r2.s)); u.x.lastClose = 1983;
  const r3 = sgyRunBars(u, [bar(1, 1999, 2000, 1998, 1999)], START + 60 * M); assert.ok(r3.events.some(e => e.type === 'ADD_CANCEL' && e.reason === 'structure'), '구조 유지선 아래 종가 → 남은 추가 진입 취소');
});
test('메시지: [B급 공격형]/[A급 확정형] 구분 표시, B급은 손실 한도·구조 무효화·1~3차 정보가 모두 들어간다', () => {
  const sb = live(), sa = live(feA()), mb = sgyNewMessage(sb, { price: 1999, priceAt: START, source: '시세', now: CLOSE + 60000 }), ma = sgyNewMessage(sa, { price: 1999, priceAt: START, source: '시세', now: CLOSE + 60000 });
  assert.match(mb, /^\[RICH300 매매 전략\] \[B급 공격형\]/); assert.match(ma, /^\[RICH300 매매 전략\] \[A급 확정형\]/); assert.doesNotMatch(mb, /A급 확정형/); assert.doesNotMatch(ma, /B급 공격형/);
  for (const m of [mb, ma]) { assert.match(m, /1차 진입:/); assert.match(m, /비중|%/); assert.match(m, /수량/); assert.match(m, /증거금/); assert.match(m, /최초 손절가/); assert.match(m, /1차 익절가/); assert.match(m, /2차 익절가/); assert.match(m, /전체 예상 최대 손실/); assert.match(m, /무효화/); assert.match(m, /2차 진입|설정하지 않음/); }
  assert.match(mb, /거래당 손실 한도 1\.5 USDT/); assert.match(mb, /위험 예산 1\.50/); assert.match(mb, /격리 [123]배/);
  const cancel = sgyBuild(fe({ rr1: 1.5 }), ctx()); assert.match(sgyCancelMessage(cancel.s, CLOSE + 60000), /\[B급 공격형\]/); assert.match(sgyCancelMessage(cancel.s, CLOSE + 60000), /2R/);
  const ev = sgyRunBars(sb, [bar(0, 2002, 2003, 1999, 2001)], START + 60 * M).events[0]; assert.match(sgyEventMessage(sb, ev, { price: 2001, now: START + M, snap: {} }), /^\[RICH300 전략\] \[B급 공격형\]/);
  assert.deepEqual(SGY_GRADE_TAG, { A: '[A급 확정형]', B: '[B급 공격형]' });
});
test('저장 왕복: 시트 스키마를 거친 뒤에도 등급(x.grade)이 유지된다', () => {
  const s = live(), n = ENTITIES.strategy.normalize(JSON.parse(JSON.stringify(s)));
  assert.equal(sgyGrade(n), 'B'); assert.equal(n.x.grade, 'B'); assert.equal(n.x.swing, 1984);
});
