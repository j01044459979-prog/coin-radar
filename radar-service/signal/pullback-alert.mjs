// Live alert candidate for a trend pullback bounce, independent of the existing 7-bar breakout.
// This rule has NOT been backtested or validated for trading profitability.
// It reads confirmed 4H/1H/15m OHLCV only and never places an order.
import { ema } from '../opportunity/indicators.mjs';
import { M15, SIG } from './evaluate.mjs';

const PULLBACK_VOL_MULT = 1.0;
const finite = x => Number.isFinite(x) && x > 0;

export function evaluatePullback({ a, c1h, c15, now }, { minRR = 1.5, validMin = 45 } = {}) {
  if (a?.status !== 'ok' || a.stage < 2 || !['LONG', 'SHORT'].includes(a.dir) ||
      !a.zone || !finite(a.metrics?.atr1) || !finite(a.invalidation) ||
      !Array.isArray(c1h) || c1h.length < 60 || !Array.isArray(c15) || c15.length < SIG.minBars15) return null;
  const last = c15.at(-1), prev = c15.at(-2), closeT = last.t + M15;
  if (closeT > now || now - closeT > SIG.lateMin * 60000 || closeT < a.asOf) return null;
  const L = a.dir === 'LONG', s = L ? 1 : -1, a1 = a.metrics.atr1, z = a.zone;
  const closes = c1h.map(b => b.c), e20 = ema(closes, 20).at(-1), e50 = ema(closes, 50).at(-1);
  if (!finite(e20) || !finite(e50) || (e20 - e50) * s <= 0 || (closes.at(-1) - e50) * s <= 0) return null;

  // Recent 15-minute bars must have revisited the 1H support/resistance area.
  const preceding = c15.slice(-5, -1);
  const priorExtreme = L ? Math.min(...preceding.map(b => b.l)) : Math.max(...preceding.map(b => b.h));
  const edge = L ? z.hi : z.lo, far = L ? z.lo : z.hi;
  if ((priorExtreme - edge) * s > 0.5 * a1) return null;
  const rebound = (last.c - last.o) * s > 0 && (last.c - prev.c) * s > 0 &&
    (last.c - prev.o) * s > 0;
  if (!rebound || (last.c - far) * s < 0) return null;
  if ((last.c - edge) * s > SIG.chaseAtr1 * a1) return null;
  if ((last.h - last.l) > SIG.maxTrigRangeAtr1 * a1) return null;
  const risk = (last.c - a.invalidation) * s, riskAtr = risk / a1;
  if (!(risk > 0 && riskAtr >= SIG.stopMinAtr1 && riskAtr <= SIG.stopMaxAtr1)) return null;
  const recent = c15.slice(-16), extreme = L ? Math.min(...recent.map(b => b.l)) : Math.max(...recent.map(b => b.h));
  if ((extreme - a.invalidation) * s <= 0) return null;

  const amounts = c15.slice(-21, -1).map(b => b.q);
  if (amounts.some(q => !Number.isFinite(q) || q < 0) || !finite(last.q)) return null;
  const average = amounts.reduce((v, q) => v + q, 0) / amounts.length;
  const volRel = average > 0 ? last.q / average : 0;
  if (volRel < PULLBACK_VOL_MULT) return null;

  // Use only precomputed, confirmed 4H/1H obstacle levels as targets.
  const targets = (a.obstacles ?? []).map(o => ({ ...o, dist: (o.price - last.c) * s }))
    .filter(o => o.dist > 0).map(o => ({ ...o, rr: o.dist / risk })).sort((x, y) => x.dist - y.dist);
  const t1 = targets.find(o => o.rr >= SIG.firstTargetMinR);
  if (!t1) return null;
  const costR = last.c * SIG.costPct / 100 / risk;
  if (t1.rr - costR < minRR) return null;
  const t2 = targets.find(o => o.rr >= t1.rr + SIG.t2ExtraR);
  const format = o => o ? { price: o.price, pct: (o.price - last.c) / last.c * 100, rr: o.rr, net: o.rr - costR, source: o.source } : null;
  return {
    status: 'CANDIDATE', strategy: 'pullback', dir: a.dir, entry: last.c, stop: a.invalidation,
    riskAbs: risk, riskPct: risk / last.c * 100, riskAtr, costR, costPct: SIG.costPct,
    t1: format(t1), t2: format(t2), volRel, zone: z,
    level: L ? prev.h : prev.l, triggerT: last.t, triggerCloseT: closeT,
    validUntil: closeT + validMin * 60000,
    zoneKey: `PULLBACK:${a.dir}:${Number(z.level).toPrecision(8)}`,
    score: a.score?.total ?? null, btcAlign: a.metrics.btcAlign, stageLabel: a.stageLabel,
    blockers: [], tags: [],
    evidence: [
      '4H 추세 · 1H EMA20/50 정렬',
      '1H 지지·저항 눌림 후 15분봉 반등 확정',
      `15분 거래대금 평균 ×${volRel.toFixed(2)}`,
    ],
  };
}
