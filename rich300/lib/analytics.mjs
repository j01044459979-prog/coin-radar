// R7 거래 통계(순수 함수): 승률·손익비·기대값·최대 낙폭을 전략(A/B)·방향(LONG/SHORT)·복기 항목별로 계산한다.
//  · 입력은 R2가 계산한 *청산된 실제 거래*의 순손익(마이크로 USDT, BigInt)뿐이다. 새 손익식을 만들지 않는다. 모의 거래는 들어오지 않는다.
//  · 표본이 작으면 숨기지 않고 표시한다: n < 30 은 lowSample, 승률에는 95% Wilson 구간을 함께 낸다(작은 표본의 우연을 구분하기 위함).
//  · 최대 낙폭(거래 기준): 청산 시각 순 누적 순손익 곡선에서 고점 대비 최대 하락(USDT, 시작 자금 대비 %). 계좌 평가액 기준 낙폭은 대시보드(R6/R2 요약)가 따로 보여 준다.
//  · 기대값 = 건당 평균 순손익(= 승률×평균이익 − 패율×평균손실). 가능하면 R-배수(순손익 ÷ 계획 손절 위험)도 낸다(계획 손절가가 있는 거래만, 커버리지 표시).
//  · 인사이트는 규칙 기반 문장이며 인과를 주장하지 않는다("참고용"). 표본이 부족하면 문장을 만들지 않는다.
import { dec, decMul, decSub, decAbs, decToMicro, decFormat, decRoundDiv, microToDec } from './decimal.mjs';
import { PLAN_CHOICES, MIND_CHOICES } from './schema.mjs';

export const AN_MIN_SAMPLE = 30;
export const AN_INSIGHT_MIN = 5;

export function anUsd(micro, { sign = false } = {}) {
  const neg = micro < 0n, a = neg ? -micro : micro, s = decFormat(microToDec(a), 2).replace(/\B(?=(\d{3})+(?!\d))/g, ','), zero = a < 5000n;
  return `${neg && !zero ? '−' : sign && !zero ? '+' : ''}${s}`;
}
export const anRatio = ppm => (ppm === null ? '—' : decFormat(ppm * 1000000n, 2));          // 1e6 = 1.00
export function anPct(ppm, dp = 0) { if (ppm === null) return '—'; const neg = ppm < 0n, a = neg ? -ppm : ppm, s = decFormat(a * 100000000n, dp); return `${neg && !/^[0.]*$/.test(s) ? '−' : ''}${s}%`; }

function anWilson(w, n) {                                    // 표시용 부동소수(결정 로직에 쓰지 않음)
  if (n === 0) return null; const z = 1.96, p = w / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
// trades: [{ sid, netMicro: bigint, closedAt: ms, riskMicro?: bigint|null }]
export function anStats(trades, { startMicro = null } = {}) {
  const t = [...trades].sort((a, b) => a.closedAt - b.closedAt || (a.sid < b.sid ? -1 : 1)), n = t.length;
  let winN = 0, lossN = 0, flatN = 0, sumW = 0n, sumL = 0n, net = 0n, cum = 0n, peak = 0n, maxDd = 0n, rSum = 0n, rN = 0, best = null, worst = null;
  for (const x of t) {
    const v = x.netMicro; net += v; cum += v; if (cum > peak) peak = cum; if (peak - cum > maxDd) maxDd = peak - cum;
    if (v > 0n) { winN++; sumW += v; } else if (v < 0n) { lossN++; sumL += v; } else flatN++;
    if (x.riskMicro && x.riskMicro > 0n) { rSum += decRoundDiv(v * 1000000n, x.riskMicro); rN++; }
    if (best === null || v > best) best = v; if (worst === null || v < worst) worst = v;
  }
  const ci = anWilson(winN, n), avgWin = winN ? decRoundDiv(sumW, BigInt(winN)) : null, avgLoss = lossN ? decRoundDiv(sumL, BigInt(lossN)) : null;
  const payoffPpm = avgWin !== null && avgLoss !== null ? decRoundDiv(avgWin * 1000000n, -avgLoss) : null, pfPpm = sumL < 0n && sumW > 0n ? decRoundDiv(sumW * 1000000n, -sumL) : null;
  return { n, wins: winN, losses: lossN, flat: flatN, winRatePpm: n ? decRoundDiv(BigInt(winN) * 1000000n, BigInt(n)) : null, winRate: n ? anPct(decRoundDiv(BigInt(winN) * 1000000n, BigInt(n))) : '—',
    winRateRange: ci ? `${Math.round(ci[0] * 100)}–${Math.round(ci[1] * 100)}%` : '—', avgWinMicro: avgWin === null ? null : String(avgWin), avgLossMicro: avgLoss === null ? null : String(avgLoss), avgWin: avgWin === null ? '—' : anUsd(avgWin, { sign: true }), avgLoss: avgLoss === null ? '—' : anUsd(avgLoss, { sign: true }),
    payoff: anRatio(payoffPpm), profitFactor: anRatio(pfPpm), netMicro: String(net), net: anUsd(net, { sign: true }), netPositive: net > 0n, netNegative: net < 0n,
    expectancyMicro: n ? String(decRoundDiv(net, BigInt(n))) : null, expectancy: n ? anUsd(decRoundDiv(net, BigInt(n)), { sign: true }) : '—', expectancyPositive: n > 0 && net > 0n, expectancyNegative: n > 0 && net < 0n,
    expectancyR: rN ? `${decFormat(decRoundDiv(rSum, BigInt(rN)) * 1000000n, 2).replace('-', '−')}R` : '—', rCoverage: rN, maxDdMicro: String(maxDd), maxDd: anUsd(maxDd), maxDdOfStart: startMicro && startMicro > 0n ? anPct(decRoundDiv(maxDd * 1000000n, startMicro), 1) : '—',
    best: best === null ? '—' : anUsd(best, { sign: true }), worst: worst === null ? '—' : anUsd(worst, { sign: true }), lowSample: n < AN_MIN_SAMPLE };
}
export const AN_STRATEGY_NAME = Object.freeze({ A: 'A전략 · 추세돌파형', B: 'B전략 · 눌림목 재진입형', S: 'COIN RADAR 신호 · 눌림 진입 후보' });
// 신호가 있는 전략만 보여 준다. 이중 전략(A/B)이 없고 신호 레이더(S)만 있으면 A/B 빈 칸을 만들지 않는다.
const anStrategyKeys = signals => { const have = new Set(signals.map(s => s.strategy)); return ['A', 'B', 'S'].filter(k => (k === 'S' ? have.has('S') : have.has('A') || have.has('B') || !have.has('S'))); };
const anGroup = (trades, keyFn, keys, opts) => keys.map(k => ({ key: k, ...anStats(trades.filter(t => keyFn(t) === k), opts) }));

// ledgerTrades: R2 ledger.trades(Map sid→trade), fills: 저장소 체결 data, signals/reviews: data 배열
export function anTradesFrom({ ledgerTrades, fills = [], signals = [], reviews = [] }) {
  const sig = new Map(signals.map(s => [s.sid, s])), rev = new Map(reviews.map(r => [r.sid, r])), firstEntry = new Map();
  for (const f of [...fills].sort((a, b) => a.at - b.at)) if ((f.kind === 'entry') && !firstEntry.has(f.sid)) firstEntry.set(f.sid, f);
  const out = [];
  for (const t of ledgerTrades.values()) {
    if (t.status !== 'closed') continue;
    const fe = firstEntry.get(t.sid); let risk = null;
    if (fe && fe.plannedStop) { const d = decAbs(decSub(dec(fe.price), dec(fe.plannedStop))); risk = decToMicro(decMul(d, dec(fe.qty))); if (risk <= 0n) risk = null; }
    const s = sig.get(t.sid), r = rev.get(t.sid), last = t.events[t.events.length - 1];
    out.push({ sid: t.sid, dir: t.dir, strategy: s ? s.strategy : null, netMicro: t.totals.netEnteredMicro, closedAt: last.at, riskMicro: risk, review: r ? { plan: r.plan, mind: r.mind } : null });
  }
  return out;
}

// 복기 분석: 계획 준수·심리별 성과와 규칙 기반 인사이트
export function anReviews(trades, opts) {
  const reviewed = trades.filter(t => t.review), plan = Object.keys(PLAN_CHOICES), mind = Object.keys(MIND_CHOICES);
  const byPlan = plan.map(k => ({ key: k, label: PLAN_CHOICES[k], ...anStats(reviewed.filter(t => t.review.plan === k), opts) })).filter(g => g.n > 0);
  const byMind = mind.map(k => ({ key: k, label: MIND_CHOICES[k], ...anStats(reviewed.filter(t => t.review.mind === k), opts) })).filter(g => g.n > 0);
  const total = trades.length, rate = total ? decRoundDiv(BigInt(reviewed.length) * 1000000n, BigInt(total)) : null, insights = [];
  const cmp = (label, a, b, nameA, nameB) => {
    if (a.n < AN_INSIGHT_MIN || b.n < AN_INSIGHT_MIN) return;
    const ea = BigInt(a.expectancyMicro), eb = BigInt(b.expectancyMicro); if (ea >= eb) return;
    insights.push({ type: label, n: a.n + b.n, text: `${nameA}(${a.n}건)의 건당 기대값 ${anUsd(ea, { sign: true })} USDT는 ${nameB}(${b.n}건)의 ${anUsd(eb, { sign: true })} USDT보다 ${anUsd(eb - ea)} USDT 낮습니다${a.n + b.n < AN_MIN_SAMPLE ? ' — 표본이 적어 참고용입니다' : ''}` });
  };
  const ok = reviewed.filter(t => t.review.plan === 'plan_ok'), bad = reviewed.filter(t => t.review.plan !== 'plan_ok'), calm = reviewed.filter(t => t.review.mind === 'calm'), tense = reviewed.filter(t => t.review.mind !== 'calm');
  cmp('plan-violation', anStats(bad, opts), anStats(ok, opts), '계획과 다르게 한 거래', '계획대로 한 거래');
  cmp('mind-unsettled', anStats(tense, opts), anStats(calm, opts), '침착하지 않았던 거래', '침착했던 거래');
  if (total >= AN_INSIGHT_MIN && rate !== null && rate < 700000n) insights.push({ type: 'review-rate', n: total, text: `청산 ${total}건 중 복기한 거래는 ${reviewed.length}건(${anPct(rate)})입니다 — 복기가 적으면 위 분석이 한쪽으로 치우칠 수 있습니다` });
  return { total, reviewed: reviewed.length, reviewRate: anPct(rate), byPlan, byMind, insights };
}
export function anBuild({ ledgerTrades, fills, signals, reviews, startMicro }) {
  const trades = anTradesFrom({ ledgerTrades, fills, signals, reviews }), opts = { startMicro };
  return { overall: anStats(trades, opts), strategies: anGroup(trades, t => t.strategy, anStrategyKeys(signals), opts).map(g => ({ ...g, name: AN_STRATEGY_NAME[g.key] })), dirs: anGroup(trades, t => t.dir, ['LONG', 'SHORT'], opts),
    matrix: ['A', 'B'].flatMap(s => ['LONG', 'SHORT'].map(d => ({ strategy: s, dir: d, ...anStats(trades.filter(t => t.strategy === s && t.dir === d), opts) }))), unlinked: trades.filter(t => !t.strategy).length, reviews: anReviews(trades, opts), minSample: AN_MIN_SAMPLE };
}
