import test from 'node:test';
import assert from 'node:assert/strict';
import { anStats, anReviews, anBuild, anTradesFrom, anUsd, anPct, anRatio, AN_MIN_SAMPLE } from '../lib/analytics.mjs';
import { ledgerBuildDaily } from '../lib/ledger.mjs';

const M = v => BigInt(Math.round(v * 1e6));
const T = (sid, net, at, extra = {}) => ({ sid, netMicro: M(net), closedAt: at, riskMicro: M(5), ...extra });

test('통계: 손계산 — 승률·평균이익/손실·손익비·PF·기대값·R·최대낙폭·최고/최저', () => {
  const s = anStats([T('1', 10, 1), T('2', -5, 2), T('3', 20, 3), T('4', -10, 4), T('5', 5, 5)], { startMicro: M(300) });
  assert.deepEqual([s.n, s.wins, s.losses, s.winRate, s.winRateRange, s.avgWin, s.avgLoss, s.payoff, s.profitFactor, s.net, s.expectancy, s.expectancyR, s.rCoverage, s.maxDd, s.maxDdOfStart, s.best, s.worst, s.lowSample],
    [5, 3, 2, '60%', '23–88%', '+11.67', '−7.50', '1.56', '2.33', '+20.00', '+4.00', '0.80R', 5, '10.00', '3.3%', '+20.00', '−10.00', true]);
  assert.equal(s.expectancyMicro, '4000000'); assert.equal(s.maxDdMicro, '10000000');
});
test('통계: 최대 낙폭은 청산 시각 순(입력 순서와 무관), 연속 손실 구간, 손익 0은 승패에서 제외', () => {
  const a = [T('a', 5, 10), T('b', -3, 20), T('c', -4, 30), T('d', 1, 40), T('e', 0, 50)], b = [...a].reverse();
  const x = anStats(a), y = anStats(b); assert.deepEqual(x, y); assert.equal(x.maxDd, '7.00'); assert.deepEqual([x.wins, x.losses, x.flat, x.winRate], [2, 2, 1, '40%']);
  const only = anStats([T('w1', 3, 1), T('w2', 4, 2)]); assert.deepEqual([only.payoff, only.profitFactor, only.avgLoss, only.maxDd, only.winRate], ['—', '—', '—', '0.00', '100%']);
  const loss = anStats([T('l1', -3, 1)]); assert.deepEqual([loss.payoff, loss.profitFactor, loss.avgWin, loss.maxDd, loss.expectancy, loss.expectancyNegative], ['—', '—', '—', '3.00', '−3.00', true]);
  const none = anStats([]); assert.deepEqual([none.n, none.winRate, none.expectancy, none.maxDd, none.best, none.winRateRange, none.expectancyR], [0, '—', '—', '0.00', '—', '—', '—']);
});
test('통계: R-배수는 계획 손절이 있는 거래만(커버리지 표시), 표본 30건 이상이면 lowSample 해제, 형식 도우미', () => {
  const r = anStats([T('1', 10, 1, { riskMicro: null }), T('2', -5, 2, { riskMicro: M(10) })]); assert.deepEqual([r.expectancyR, r.rCoverage], ['−0.50R', 1]);
  const many = anStats(Array.from({ length: AN_MIN_SAMPLE }, (_, i) => T(`m${i}`, i % 2 ? -1 : 2, i))); assert.equal(many.lowSample, false); assert.equal(AN_MIN_SAMPLE, 30);
  assert.equal(anUsd(1234567890n), '1,234.57'); assert.equal(anUsd(-5000n), '−0.01'); assert.equal(anUsd(-4999n), '0.00'); assert.equal(anPct(615000n), '62%'); assert.equal(anPct(null), '—'); assert.equal(anRatio(1555556n), '1.56');
});
test('복기 분석: 계획·심리별 성과, 계획 위반·불안정 거래의 기대값 비교 인사이트(표본 5건 이상일 때만), 복기율 경고', () => {
  const ok = (i, v) => T(`ok${i}`, v, i, { review: { plan: 'plan_ok', mind: 'calm' } }), bad = (i, v) => T(`bad${i}`, v, 100 + i, { review: { plan: 'chase_or_average_down', mind: 'greedy' } });
  const trades = [...[5, 6, 4, 7, 3].map((v, i) => ok(i, v)), ...[-4, -3, 2, -5, -6].map((v, i) => bad(i, v)), T('nr1', 1, 300), T('nr2', 1, 301), T('nr3', 1, 302), T('nr4', 1, 303), T('nr5', 1, 304), T('nr6', 1, 305)];
  const r = anReviews(trades, {}); assert.deepEqual([r.total, r.reviewed, r.reviewRate], [16, 10, '63%']);
  assert.deepEqual(r.byPlan.map(g => [g.key, g.n, g.expectancy]), [['plan_ok', 5, '+5.00'], ['chase_or_average_down', 5, '−3.20']]); assert.deepEqual(r.byMind.map(g => g.key), ['calm', 'greedy']);
  const types = r.insights.map(i => i.type); assert.deepEqual(types, ['plan-violation', 'mind-unsettled', 'review-rate']);
  assert.match(r.insights[0].text, /계획과 다르게 한 거래\(5건\)의 건당 기대값 −3\.20 USDT는 계획대로 한 거래\(5건\)의 \+5\.00 USDT보다 8\.20 USDT 낮습니다 — 표본이 적어 참고용입니다/);
  assert.match(r.insights[2].text, /청산 16건 중 복기한 거래는 10건\(63%\)/);
  const few = anReviews([ok(1, 5), bad(1, -4)], {}); assert.deepEqual(few.insights, []);                              // 표본 부족: 문장을 만들지 않는다
  const reverse = anReviews([...Array.from({ length: 5 }, (_, i) => ok(i + 10, 1)), ...Array.from({ length: 5 }, (_, i) => bad(i + 10, 9))], {}); assert.ok(!reverse.insights.some(i => i.type === 'plan-violation'));   // 위반이 더 좋으면 "더 낮다"는 문장 없음
});
test('anBuild: R2 장부 거래에서 전략·방향·계획 손절 R을 만든다(청산만, 모의 없음, 전략 없는 거래는 unlinked)', () => {
  const day0 = Date.UTC(2026, 9, 24, 0, 0) - 9 * 3600000, H = 3600000, f = (sid, kind, at, price, extra = {}) => ({ origin: 'real', fillId: `${sid}-${kind}`, sid, kind, dir: 'LONG', at: day0 + at * H, price, qty: '2', fee: { state: 'entered', amount: '0' }, funding: { state: 'entered', amount: '0' }, ...extra });
  const fills = [f('A1', 'entry', 1, '100', { plannedStop: '95' }), f('A1', 'close', 2, '110'), f('B1', 'entry', 3, '50', { plannedStop: '48' }), f('B1', 'close', 4, '49'), f('N1', 'entry', 5, '10'), f('N1', 'close', 6, '11'), f('OPEN', 'entry', 7, '5')];
  const signals = [{ sid: 'A1', strategy: 'A' }, { sid: 'B1', strategy: 'B' }], led = ledgerBuildDaily({ challenge: { startEquity: '300', startDay: '2026-10-24', rateSchedule: [{ from: '2026-10-24', rate: '0.05' }] }, fills, throughDay: '2026-10-24' });
  const a = anBuild({ ledgerTrades: led.trades, fills, signals, reviews: [{ sid: 'A1', plan: 'plan_ok', mind: 'calm' }], startMicro: M(300) });
  assert.deepEqual([a.overall.n, a.overall.net, a.unlinked, a.reviews.reviewed], [3, '+20.00', 1, 1]);
  const A = a.strategies[0], B = a.strategies[1]; assert.deepEqual([A.key, A.n, A.net, A.expectancyR, B.n, B.net, B.expectancyR], ['A', 1, '+20.00', '2.00R', 1, '−2.00', '−0.50R']);        // A: 20/(5×2)=2R, B: −2/(2×2)=−0.5R
});
