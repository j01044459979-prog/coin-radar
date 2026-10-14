import test from 'node:test';
import assert from 'node:assert/strict';
import { NEAR_MIN_SCORE, RECOMMEND_MIN_SCORE, pickNear, pickTop2, rankValue } from '../scoring.mjs';
import { applyBtcFilter } from '../analysis.mjs';
import { enrich } from '../enrich.mjs';
import { chartPlan, makeSpec } from '../chart.mjs';
import { compactReport } from '../compact.mjs';
import { cycle } from '../service.mjs';
import { planOf, riskOf } from '../plan.mjs';
import { now } from './fake-okx.mjs';

const hour = Math.floor(now / 3600000);
const mk = (symbol, dir, score, { strong = false, risk = 0, blockers = [], atrUnits = 0.8 } = {}) => {
  const long = dir === 'LONG';
  const r = { symbol, strong, direction: strong ? dir : 'WAIT', trend: long ? '상승' : '하락', price: 100, priceAt: now, collectedAt: now, atr: 0.5, atrPct: 0.5, high: 101, low: 99, swingHigh: 100.6, swingLow: 99.4, volume: 1.2, oi15: 0.4, funding: 0.01, source: 'OKX' };
  const plan = planOf(r, dir, null);
  const mtf = { '15m': { arrow: '→' }, '1H': { arrow: '→' }, '4H': { arrow: '→' } };
  return { ...r, mtf, candidate: { dir, score, blockers, plan, dist: { level: long ? 101 : 99, atrUnits, broken: false }, unmet: strong ? [] : ['거래대금 1.20배 → 2배 필요'], met: [], missing: [], mtfConflict: false,
    risk: { ...riskOf(r, dir, mtf, plan, { change15: 0 }), points: risk }, parts: {} } };
};
const btc = { symbol: 'BTCUSDT', price: 83150.4, trend: '상승', mtf: { '15m': { arrow: '↑', dir: 'UP' }, '1H': { arrow: '→', dir: 'FLAT' }, '4H': { arrow: '→', dir: 'FLAT' } }, candidate: null, source: 'OKX' };
const candles = (n = 60, p0 = 100) => Array.from({ length: n }, (_, i) => ({ t: now - (n - i) * 3600000, o: p0, h: p0 + 1, l: p0 - 1, c: p0 + (i % 2 ? 0.3 : -0.3), end: 0, q: 1e7, v: 1e7 / p0 }));
const dataFor = rows => Object.fromEntries(rows.map(r => [r.symbol, { '1H': candles(60, 100), '4H': candles(60, 100) }]));

test('상수: 내부 근접 감시 하한 40은 유지, 추천 표시 하한 55는 별도 상수', () => {
  assert.equal(NEAR_MIN_SCORE, 40); assert.equal(RECOMMEND_MIN_SCORE, 55);
});
test('경계값: 39.9 내부 자격 없음 / 40·54.9 내부 감시 유지·추천 제외 / 55·55.1·70 추천 가능', () => {
  const cases = [[39.9, false, false], [40, true, false], [54.9, true, false], [55, true, true], [55.1, true, true], [70, true, true]];
  for (const [score, internal, recommend] of cases) {
    const row = mk('XXXUSDT', 'LONG', score);
    assert.equal(pickNear([row], 3).length === 1, internal, `내부 ${score}`);
    assert.equal(pickTop2([row]).length === 1, recommend, `추천 ${score}`);
  }
});
test('strong 후보에도 정기 추천 표시 기준 55점 적용(54.9 제외, 55 포함)', () => {
  assert.deepEqual(pickTop2([mk('AAAUSDT', 'LONG', 54.9, { strong: true })]), []);
  assert.deepEqual(pickTop2([mk('AAAUSDT', 'LONG', 55, { strong: true })]).map(p => [p.row.symbol, p.tier]), [['AAAUSDT', 'strong']]);
});
test('표시 기준은 점수(score)이지 순위값(rankValue)이 아니다: 점수 56·위험 12(순위값 32)는 추천 가능, 54.9·위험 0(순위값 54.9)은 제외', () => {
  const risky = mk('RSKUSDT', 'LONG', 56, { risk: 12 }), safe = mk('SAFUSDT', 'LONG', 54.9, { risk: 0 });
  assert.equal(rankValue(risky), 32); assert.equal(rankValue(safe), 54.9);
  assert.deepEqual(pickTop2([risky, safe]).map(p => p.row.symbol), ['RSKUSDT']);
  // 적격 후보 사이의 정렬은 기존 rankValue 공식 그대로
  const a = mk('AAAUSDT', 'LONG', 70, { risk: 5 }), b = mk('BBBUSDT', 'LONG', 66, { risk: 0 });   // 60 < 66
  assert.deepEqual(pickTop2([a, b]).map(p => p.row.symbol), ['BBBUSDT', 'AAAUSDT']);
  assert.deepEqual(pickTop2([a, b]).map(p => p.row.candidate.score), [66, 70]);                     // 표시 점수는 원래 점수
});
test('조합: strong 2개 / strong 1 + near 1 / near 2 / 적격 1개 / 55점 미만만 있음', () => {
  const s1 = mk('S1USDT', 'LONG', 80, { strong: true }), s2 = mk('S2USDT', 'SHORT', 70, { strong: true }), n1 = mk('N1USDT', 'LONG', 99), n2 = mk('N2USDT', 'SHORT', 60), low1 = mk('L1USDT', 'LONG', 50), low2 = mk('L2USDT', 'SHORT', 45);
  assert.deepEqual(pickTop2([n1, s2, s1]).map(p => [p.row.symbol, p.tier]), [['S1USDT', 'strong'], ['S2USDT', 'strong']]);
  assert.deepEqual(pickTop2([n1, s1, low1]).map(p => [p.row.symbol, p.tier]), [['S1USDT', 'strong'], ['N1USDT', 'near']]);
  assert.deepEqual(pickTop2([n2, n1, low1]).map(p => p.row.symbol), ['N1USDT', 'N2USDT']);
  assert.deepEqual(pickTop2([n2, low1, low2]).map(p => p.row.symbol), ['N2USDT']);
  assert.deepEqual(pickTop2([low1, low2]), []);
  assert.deepEqual(pickNear([low1, low2], 3).map(r => r.symbol).sort(), ['L1USDT', 'L2USDT']);      // 내부 근접 후보로는 남아 있음
});
test('BTC 필터·필수 차단 조건에 걸린 종목은 점수 55 이상이어도 제외(강한 신호는 strong 자체가 해제됨)', () => {
  assert.deepEqual(pickTop2([mk('BLKUSDT', 'LONG', 90, { blockers: ['BTC 15분 0.5% 초과 역행'] })]), []);
  assert.deepEqual(pickTop2([mk('BLKUSDT', 'LONG', 90, { strong: true, blockers: ['BTC 데이터 없음'] })]), []);
  const rows = enrich(applyBtcFilter([{ symbol: 'BTCUSDT', change15: -0.9, price: 100, atr: 1, high: 101, low: 99, swingHigh: 101, swingLow: 99, trend: '하락', atrPct: 1, volume: 1, oi15: 0, funding: 0, priceAt: now, collectedAt: now, direction: 'WAIT', strong: false },
    { symbol: 'ETHUSDT', direction: 'LONG', strong: true, trend: '상승', high: 101, low: 99, swingHigh: 100.6, swingLow: 99.4, price: 101.1, priceAt: now, collectedAt: now, atr: 0.5, atrPct: 0.5, volume: 3, oi15: 2, funding: 0, change15: 0.2, source: 'OKX' }]), {});
  assert.deepEqual(pickTop2(rows), []); assert.ok(rows[1].candidate.score > 55);                      // 점수는 높지만 BTC 역행 차단
});
test('텍스트 TOP 2와 차트 선정이 항상 같은 종목·같은 순서(1순위 일치)', () => {
  const s1 = mk('S1USDT', 'LONG', 80, { strong: true }), n1 = mk('N1USDT', 'SHORT', 70), n2 = mk('N2USDT', 'LONG', 62), low = mk('LOWUSDT', 'LONG', 54.9);
  for (const rows of [[btc, s1, n1, n2, low], [btc, n1, n2, low], [btc, n2, low], [btc, low], [btc]]) {
    const text = compactReport(rows, [], now, {}), plan = chartPlan(rows, dataFor([btc, s1, n1, n2, low]));
    const picks = pickTop2(rows).map(p => p.row.symbol);
    assert.deepEqual(text.tops, picks);
    if (picks.length) assert.deepEqual(plan.map(s => s.symbol), picks); else assert.deepEqual(plan.map(s => [s.symbol, s.kind]), [['BTCUSDT', 'market']].filter(() => Boolean(dataFor([btc])['BTCUSDT']['4H'])));
    assert.ok(!plan.some(s => s.symbol === 'LOWUSDT'));                                              // 55점 미만은 차트도 없음
    if (picks.length) assert.equal(plan[0].symbol, text.tops[0]);                                    // 1순위 동일
  }
});
test('보고 예시: 55점 이상 후보 2개 / 1개 / 0개(내부 감시 있음·없음)', () => {
  const a = mk('AAAUSDT', 'LONG', 82), b = mk('BBBUSDT', 'SHORT', 76), low = mk('LOWUSDT', 'LONG', 48), low2 = mk('LO2USDT', 'SHORT', 41);
  const two = compactReport([btc, a, b, low], [], now, {}).plain, one = compactReport([btc, a, low], [], now, {}).plain;
  assert.match(two, /TOP 2/); assert.match(two, /🥇 1순위 AAAUSDT[\s\S]*🥈 2순위 BBBUSDT/); assert.doesNotMatch(two, /LOWUSDT/);
  assert.match(one, /TOP 1/); assert.doesNotMatch(one, /🥈|LOWUSDT/);
  const zero = compactReport([btc, low, low2], [], now, {}).plain;
  assert.match(zero, /🔎 후보 없음 · 대기/); assert.match(zero, /⏳ 현재 추천 표시 기준\(55점\)을 충족한 후보 없음\n내부 감시 중인 근접 후보 2건 \(55점 미만 · 표시 안 함\)/);
  assert.doesNotMatch(zero, /LOWUSDT|LO2USDT|진입 기준|손절|목표|🥇/);                              // 낮은 후보 종목명·가짜 진입가 없음
  const none = compactReport([btc], [], now, {}).plain; assert.match(none, /⏳ 현재 추천 표시 기준\(55점\)을 충족한 후보 없음$/m); assert.doesNotMatch(none, /내부 감시/);
});
test('추천 0개일 때 BTC 시장 차트 1장만 사용하고 가짜 진입·손절·목표를 만들지 않는다', () => {
  const low = mk('LOWUSDT', 'LONG', 48);
  const plan = chartPlan([btc, low], { BTCUSDT: { '4H': candles(60, 83000) }, LOWUSDT: { '1H': candles(60) } });
  assert.deepEqual(plan.map(s => [s.symbol, s.kind, s.tf]), [['BTCUSDT', 'market', '4H']]); assert.equal(plan[0].plan, null); assert.equal(plan[0].level, null);
  assert.deepEqual(chartPlan([btc, low], { LOWUSDT: { '1H': candles(60) } }), []);                  // BTC 캔들이 없으면 차트 생략
});
// ── 내부 감시 보존 / 긴급 알림 불변 / 캐시 ──
test('40~54.9점 근접 후보는 내부 계산·기록에 그대로 남고 보고에서만 빠진다', async () => {
  const low = mk('LOWUSDT', 'LONG', 50), ok = mk('OKUSDT', 'LONG', 60), st = {}, sent = [];
  await cycle({ now, state: st, collect: async () => ({ rows: [btc, low, ok], failures: [], charts: dataFor([low, ok]) }), save: async () => {}, render: async () => Buffer.from('x'), send: async t => sent.push(t), sendPhoto: async () => {} });
  assert.deepEqual(st.rows.filter(r => r.score !== null).map(r => [r.symbol, r.score]), [['LOWUSDT', 50], ['OKUSDT', 60]]);   // 내부 상태에 점수 기록 유지
  assert.ok(sent[0].includes('OKUSDT') && !sent[0].includes('LOWUSDT')); assert.equal(st.chart.items.length, 1); assert.equal(st.chart.items[0].symbol, 'OKUSDT');
  assert.deepEqual(pickNear([btc, low, ok], 3).map(r => r.symbol).sort(), ['LOWUSDT', 'OKUSDT']);
});
test('55점 미만이어도 기존 강한 신호 5분 긴급 알림은 변경 없이 발송된다(정기 추천 표시와 별개)', async () => {
  const weak = mk('WEAKUSDT', 'SHORT', 50, { strong: true }), st = { reportHour: hour }, log = [];
  const o = { state: st, collect: async () => ({ rows: [btc, weak], failures: [], charts: dataFor([weak]) }), save: async () => {}, render: async () => Buffer.from('x'), send: async t => log.push(['text', t]), sendPhoto: async (p, c) => log.push(['photo', c]) };
  await cycle({ ...o, now });
  assert.deepEqual(log.map(x => x[0]), ['text', 'photo']); assert.match(log[0][1], /^<b>🚨 신규 조건 포착<\/b>\n<b>WEAKUSDT<\/b>/); assert.match(log[0][1], /점수\)?/.source ? /\(50점\)/ : /x/);
  await cycle({ ...o, now: now + 300000 }); assert.equal(log.length, 2);                                // 쿨다운 중복 억제 그대로
  assert.deepEqual(pickTop2([btc, weak]), []);                                                           // 같은 종목이 정기 추천에는 오르지 않음
});
test('정기 보고에서 55점 미만 strong은 추천에 오르지 않지만 중복 억제 키·캐시 복원은 정상(같은 시간대 재보고 없음)', async () => {
  const weak = mk('WEAKUSDT', 'LONG', 52, { strong: true }), ok = mk('OKUSDT', 'LONG', 70), log = []; let saved;
  const o = { collect: async () => ({ rows: [btc, weak, ok], failures: [], charts: dataFor([weak, ok]) }), save: async s => { saved = JSON.stringify(s); }, render: async () => Buffer.from('x'), send: async t => log.push(t), sendPhoto: async () => {} };
  await cycle({ ...o, now, state: {} });
  assert.ok(log[0].includes('OKUSDT') && !log[0].includes('WEAKUSDT') && /TOP 1/.test(log[0]));
  const n = log.length; await cycle({ ...o, now: now + 300000, state: JSON.parse(saved) }); assert.equal(log.length, n);   // 캐시 복원 후 같은 시간대 재전송 없음
  const lost = []; await cycle({ ...o, send: async t => lost.push(t), now: now + 600000, state: {} }); assert.equal(lost.length, 1);   // 캐시 유실 시 보고 1회만
});
