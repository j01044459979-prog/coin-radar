// Independent EMA20/50 pullback candidate. No opportunity-stage/4H swing-zone dependency.
// Uses confirmed 1H/4H/15m bars only; no account access or orders. Experimental, not backtested.
import { atr, ema, H1, H4 } from '../opportunity/indicators.mjs';
import { M15, SIG } from './evaluate.mjs';

export const EMA_PRIORITY = Object.freeze(['SOLUSDT', 'ETHUSDT', 'XRPUSDT', 'DOGEUSDT', 'ZECUSDT']);
export const EMA_RULES = Object.freeze({ proximityAtr: 1.6, touchAtr: 0.5, chaseAtr: 1.0, minRiskAtr: 0.65, maxRiskAtr: 3, volume: 1.0 });
const ok = x => Number.isFinite(x) && x > 0;
const pricePct = (v, from) => (v - from) / from * 100;

// EMA 후보 전용 설명 점수(0~100). 기존 5분 돌파/기회 레이더 점수와 비교하지 않는다.
// CANDIDATE의 확정된 조건에만 산정하며, 값이 없으면 0점이 아니라 null(미산정)이다.
// 추세 20 + EMA 터치 15 + 확정 반등 20 + 거래량 15 + 순손익비 20 + 추격/손절 위험 10.
// 이 가중치는 과거 성과로 검증되지 않았으며 승률·수익 확률이 아니다. 진입 게이트는 변경하지 않는다.
const unit = x => Math.max(0, Math.min(1, x));
export function emaConditionScore({ setup, near, volRel, netRR, riskAtr, chase } = {}) {
  if (!setup || !near || ![volRel, netRR, riskAtr, chase].every(Number.isFinite)) return null;
  const parts = {
    trend: 20,
    touch: 15,
    confirmed: 20,
    volume: 15 * unit(volRel / 2),
    reward: 20 * unit(netRR / 3),
    risk: 5 * unit(1 - Math.abs(chase) / EMA_RULES.chaseAtr) +
      5 * unit((EMA_RULES.maxRiskAtr - riskAtr) / (EMA_RULES.maxRiskAtr - EMA_RULES.minRiskAtr)),
  };
  return Math.round(Object.values(parts).reduce((a, b) => a + b, 0));
}

export function emaSetup(c1h, c4h, now = Date.now()) {
  if (!Array.isArray(c1h) || !Array.isArray(c4h) || c1h.length < 60 || c4h.length < 60) return null;
  const last1 = c1h.at(-1), asOf = last1.t + H1;
  if (asOf > now || now - asOf > 2 * H1) return null;
  // Do not use a four-hour candle that closes later than the latest confirmed 1H candle.
  const done4 = c4h.filter(b => b.t + H4 <= asOf);
  if (done4.length < 55) return null;
  const last4 = done4.at(-1);
  if (asOf - (last4.t + H4) >= H4) return null;
  const p1 = c1h.map(b => b.c), p4 = done4.map(b => b.c);
  const e20 = ema(p1, 20).at(-1), e50 = ema(p1, 50).at(-1);
  const f20 = ema(p4, 20).at(-1), f50 = ema(p4, 50).at(-1);
  const a1 = atr(c1h, 14).at(-1);
  if (![e20, e50, f20, f50, a1].every(ok)) return null;
  const long = e20 > e50 && f20 > f50 && last1.c > e50 && last4.c > f50;
  const short = e20 < e50 && f20 < f50 && last1.c < e50 && last4.c < f50;
  if (!long && !short) return null;
  const s = long ? 1 : -1;
  if (Math.abs(last1.c - e20) > EMA_RULES.proximityAtr * a1) return null;
  const touched = c1h.slice(-4).some(b => b.l <= e20 + EMA_RULES.touchAtr * a1 && b.h >= e20 - EMA_RULES.touchAtr * a1);
  if (!touched) return null;
  return { dir: long ? 'LONG' : 'SHORT', s, ema20: e20, ema50: e50, atr1: a1, asOf, c1h, c4h: done4, price: last1.c };
}

export function evaluateEmaPullback({ setup, c15, now }, { minRR = 1.5, validMin = 45 } = {}) {
  if (!setup) return { status: 'WAIT', why: 'EMA 4H·1H 추세/EMA20 접근 대기' };
  const { dir, s, ema20: e20, ema50: e50, atr1: a1 } = setup;
  if (!Array.isArray(c15) || c15.length < SIG.minBars15) return { status: 'WAIT', why: 'EMA 15분봉 부족' };
  for (let i = 1; i < c15.length; i++) if (c15[i].t - c15[i - 1].t !== M15) return { status: 'WAIT', why: 'EMA 15분봉 누락' };
  const last = c15.at(-1), prev = c15.at(-2), closeT = last.t + M15;
  if (closeT > now || closeT < setup.asOf || now - closeT > SIG.lateMin * 60000) return { status: 'WAIT', why: 'EMA 15분봉 미확정/지연' };
  const blockers = [], block = msg => blockers.push(msg);
  const near = c15.slice(-5).some(b => b.l <= e20 + EMA_RULES.touchAtr * a1 && b.h >= e20 - EMA_RULES.touchAtr * a1);
  if (!near) block('EMA20 구간 재접촉 대기');
  if ((last.c - e20) * s < 0 || (last.c - prev.c) * s <= 0 || (last.c - last.o) * s <= 0) block('15분봉 EMA20 회복·반등/반락 확정 대기');
  const chase = (last.c - e20) * s / a1;
  if (chase > EMA_RULES.chaseAtr || chase < -0.4) block('EMA20 이격 과다(추격·이탈 금지)');
  if (last.h - last.l > SIG.maxTrigRangeAtr1 * a1) block('급등락 15분봉 제외');
  const recent = c15.slice(-12);
  const lowHigh = s > 0 ? Math.min(...recent.map(b => b.l)) : Math.max(...recent.map(b => b.h));
  const stop = s > 0 ? Math.min(lowHigh, e20 - 0.65 * a1) - 0.1 * a1 : Math.max(lowHigh, e20 + 0.65 * a1) + 0.1 * a1;
  const entry = last.c, risk = (entry - stop) * s, riskAtr = risk / a1;
  if (!(risk > 0 && riskAtr >= EMA_RULES.minRiskAtr && riskAtr <= EMA_RULES.maxRiskAtr)) block('구조적 손절폭 부적정');
  const amounts = c15.slice(-21, -1).map(b => b.q);
  const meanVol = amounts.length === 20 && amounts.every(q => Number.isFinite(q) && q >= 0)
    ? amounts.reduce((a, b) => a + b, 0) / amounts.length : null;
  const volRel = meanVol > 0 && Number.isFinite(last.q) ? last.q / meanVol : null;
  if (volRel === null || volRel < EMA_RULES.volume) block('거래량 미확인/평균 미달');
  // Targets must be price levels actually seen on already confirmed hourly candles.
  const l = dir === 'LONG', candidates = [
    { price: l ? Math.max(...setup.c1h.slice(-73, -1).map(b => b.h)) : Math.min(...setup.c1h.slice(-73, -1).map(b => b.l)), source: '최근 1H 고저점' },
    { price: l ? Math.max(...setup.c4h.slice(-61, -1).map(b => b.h)) : Math.min(...setup.c4h.slice(-61, -1).map(b => b.l)), source: '최근 4H 고저점' },
  ].filter(o => ok(o.price) && (o.price - entry) * s > 0)
    .sort((x, y) => ((x.price - entry) - (y.price - entry)) * s);
  const costR = risk > 0 ? entry * SIG.costPct / 100 / risk : Infinity;
  const targets = candidates.map(o => ({ ...o, rr: (o.price - entry) * s / risk }));
  const first = targets[0] ?? null;
  if (!first || first.rr - costR < minRR) block('확정 지지·저항 목표까지 비용 반영 1.5R 미달');
  if (blockers.length) return { status: 'OBSERVE', dir, strategy: 'ema-pullback', blockers };
  const score = emaConditionScore({ setup, near, volRel, netRR: first.rr - costR, riskAtr, chase });
  const next = targets.find(o => o.rr >= first.rr + SIG.t2ExtraR) ?? null;
  const target = o => o && ({ price: o.price, pct: pricePct(o.price, entry), rr: o.rr, net: o.rr - costR, source: o.source });
  return {
    status: 'CANDIDATE', strategy: 'ema-pullback', dir, entry, stop, riskAbs: risk,
    riskPct: risk / entry * 100, riskAtr, costR, costPct: SIG.costPct, t1: target(first), t2: target(next),
    volRel, zone: { lo: e20 - EMA_RULES.touchAtr * a1, hi: e20 + EMA_RULES.touchAtr * a1, level: e20, type: '1H EMA20' },
    level: e20, triggerT: last.t, triggerCloseT: closeT, validUntil: closeT + validMin * 60000,
    zoneKey: 'EMA20:' + dir, score, stageLabel: 'EMA 추세 눌림목', blockers: [], tags: [],
    evidence: ['4H·1H EMA20/50 같은 방향', '1H EMA20 터치 후 15분 확정 반등/반락', '15분 거래대금 평균 x' + volRel.toFixed(2)],
  };
}
