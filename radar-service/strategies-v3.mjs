// RICH STRATEGY RADAR 3.0 - independent, opt-in indicator engine.
// No TradingView source code is copied; the calculations use standard public formulas.
// All inputs MUST be closed, chronological candles. This module does not send orders or alerts.
// OHLC objects: { t?, o, h, l, c, q? (quote turnover), v? (base volume) }.

const DEFAULTS = Object.freeze({
  atrPeriod: 14, supertrendFactor: 3, utPeriod: 10, utFactor: 1,
  donchianPeriod: 20, volumeFactor: 1.5, bbPeriod: 20, bbStd: 2,
  rsiPeriod: 14, maxAtrPercent: 3, stopAtr: 1.5, targetR: 2,
});

const average = xs => xs.reduce((n, x) => n + x, 0) / xs.length;
const last = xs => xs[xs.length - 1];
const safe = n => Number.isFinite(n) ? n : null;

export function validateClosedCandles(candles, intervalMs = 300000) {
  if (!Array.isArray(candles) || candles.length < 2) throw new Error('At least 2 confirmed candles required');
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) throw new Error('Invalid candle interval');
  let lastT = null;
  for (const [i, x] of candles.entries()) {
    if (![x?.o, x?.h, x?.l, x?.c].every(v => typeof v === 'number' && Number.isFinite(v))) {
      throw new Error('Invalid OHLC: ' + i);
    }
    if (x.l <= 0 || x.h < Math.max(x.o, x.c, x.l) || x.l > Math.min(x.o, x.c)) {
      throw new Error('Invalid OHLC range: ' + i);
    }
    if (!Number.isSafeInteger(x.t) || x.t < 0 || x.t % intervalMs !== 0) {
      throw new Error('Invalid candle timestamp or alignment: ' + i);
    }
    if (lastT !== null && x.t - lastT !== intervalMs) {
      throw new Error('Missing/duplicate/out-of-order candle: ' + i);
    }
    lastT = x.t;
    if (x.confirm !== '1' && x.confirm !== 1 && x.confirm !== true) {
      throw new Error('Unconfirmed candle rejected: ' + i);
    }
  }
  return true;
}
function emaSeries(values, length) {
  const out = Array(values.length).fill(null);
  if (values.length < length) return out;
  let x = average(values.slice(0, length));
  out[length - 1] = x;
  const alpha = 2 / (length + 1);
  for (let i = length; i < values.length; i++) {
    x = alpha * values[i] + (1 - alpha) * x;
    out[i] = x;
  }
  return out;
}
function atrSeries(c, length) {
  const out = Array(c.length).fill(null);
  if (c.length <= length) return out;
  const tr = c.map((x, i) => i === 0 ? 0 :
    Math.max(x.h - x.l, Math.abs(x.h - c[i - 1].c), Math.abs(x.l - c[i - 1].c)));
  let a = average(tr.slice(1, length + 1));
  out[length] = a;
  for (let i = length + 1; i < c.length; i++) {
    a = (a * (length - 1) + tr[i]) / length;
    out[i] = a;
  }
  return out;
}
function rsiSeries(c, length) {
  const out = Array(c.length).fill(null);
  if (c.length <= length) return out;
  let gains = 0, losses = 0;
  for (let i = 1; i <= length; i++) {
    const delta = c[i].c - c[i - 1].c;
    gains += Math.max(delta, 0); losses += Math.max(-delta, 0);
  }
  gains /= length; losses /= length;
  const rsi = () => gains === 0 && losses === 0 ? 50 : losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
  out[length] = rsi();
  for (let i = length + 1; i < c.length; i++) {
    const d = c[i].c - c[i - 1].c;
    gains = (gains * (length - 1) + Math.max(d, 0)) / length;
    losses = (losses * (length - 1) + Math.max(-d, 0)) / length;
    out[i] = rsi();
  }
  return out;
}
function bbSeries(c, length, sd) {
  return c.map((_, i) => {
    if (i < length - 1) return null;
    const closes = c.slice(i - length + 1, i + 1).map(x => x.c);
    const mid = average(closes);
    const std = Math.sqrt(average(closes.map(x => (x - mid) ** 2)));
    return { upper: mid + sd * std, mid, lower: mid - sd * std };
  });
}
// SuperTrend (Olivier Seban): ATR bands using the previous CLOSE to carry forward final bands.
function supertrendSeries(c, atr, factor) {
  const out = Array(c.length).fill(null);
  let upper = null, lower = null, direction = null;
  for (let i = 0; i < c.length; i++) {
    if (atr[i] === null) continue;
    const mid = (c[i].h + c[i].l) / 2;
    const basicUpper = mid + factor * atr[i], basicLower = mid - factor * atr[i];
    if (upper === null) {
      upper = basicUpper; lower = basicLower;
      direction = 'DOWN'; // TradingView SuperTrend initialization before first crossing.
    } else {
      const prevUpper = upper, prevLower = lower;
      upper = basicUpper < prevUpper || c[i - 1].c > prevUpper ? basicUpper : prevUpper;
      lower = basicLower > prevLower || c[i - 1].c < prevLower ? basicLower : prevLower;
      if (direction === 'DOWN' && c[i].c > upper) direction = 'UP';
      else if (direction === 'UP' && c[i].c < lower) direction = 'DOWN';
    }
    out[i] = { direction, line: direction === 'UP' ? lower : upper };
  }
  return out;
}
// Independent ATR-based trailing-stop variant inspired by UT-style trend tracking.
// Not a verbatim port of any third-party TradingView script.
function atrTrailSeries(c, atr, factor) {
  const out = Array(c.length).fill(null);
  let trail = null, priorBias = null;
  for (let i = 0; i < c.length; i++) {
    if (atr[i] === null) continue;
    const loss = factor * atr[i];
    if (trail === null) trail = c[i].c - loss;
    else {
      const prevTrail = trail;
      if (c[i].c > prevTrail && c[i - 1].c > prevTrail) trail = Math.max(prevTrail, c[i].c - loss);
      else if (c[i].c < prevTrail && c[i - 1].c < prevTrail) trail = Math.min(prevTrail, c[i].c + loss);
      else trail = c[i].c > prevTrail ? c[i].c - loss : c[i].c + loss;
    }
    const bias = c[i].c > trail ? 'UP' : 'DOWN';
    out[i] = { direction: bias, line: trail, flip: priorBias !== null && bias !== priorBias };
    priorBias = bias;
  }
  return out;
}
const vol = x => Number.isFinite(x.q) && x.q > 0 ? x.q : Number.isFinite(x.v) && x.v > 0 ? x.v : null;

// Produce decisions at the CLOSE of each candle, never using values from later bars.
// Supertrend and ATR trail are ONE evidence group (correlated ATR indicators), not two votes.
export function buildStrategySeries(candles, config = {}) {
  validateClosedCandles(candles);
  const p = { ...DEFAULTS, ...config };
  if (!(p.stopAtr > 0 && p.targetR > 0 && p.volumeFactor > 0)) throw new Error('Invalid strategy configuration');
  const closes = candles.map(x => x.c);
  const ema20 = emaSeries(closes, 20), ema50 = emaSeries(closes, 50);
  const atr = atrSeries(candles, p.atrPeriod), utAtr = atrSeries(candles, p.utPeriod);
  const rsi = rsiSeries(candles, p.rsiPeriod), bb = bbSeries(candles, p.bbPeriod, p.bbStd);
  const st = supertrendSeries(candles, atr, p.supertrendFactor);
  const ut = atrTrailSeries(candles, utAtr, p.utFactor);
  return candles.map((c, i) => {
    const basic = { index: i, time: c.t ?? null, price: c.c, signal: 'WAIT',
      setup: null, regime: 'UNKNOWN', reason: 'Indicator warm-up',
      indicators: null, risk: null, blockers: [] };
    const prev = i - 1;
    if (i < Math.max(55, p.donchianPeriod + 1, p.bbPeriod + 1) ||
      [ema20[i], ema50[i], ema20[i - 5], atr[i], rsi[i], rsi[prev]].some(x => x === null) ||
      !bb[i] || !bb[prev] || !st[i] || !ut[i]) return basic;
    const a = atr[i];
    const emaGap = (ema20[i] - ema50[i]) / a;
    const emaSlope = ema20[i] - ema20[i - 5];
    const trendUp = emaGap >= 0.6 && emaSlope > 0;
    const trendDown = emaGap <= -0.6 && emaSlope < 0;
    const regime = trendUp || trendDown ? 'TREND' : Math.abs(emaGap) <= 0.6 ? 'RANGE' : 'TRANSITION';
    const prevCandles = candles.slice(i - p.donchianPeriod, i);
    const high = Math.max(...prevCandles.map(x => x.h));
    const low = Math.min(...prevCandles.map(x => x.l));
    const oldVolumes = prevCandles.map(vol);
    const currentVol = vol(c);
    const volumeRatio = currentVol !== null && oldVolumes.every(v => v !== null) ?
      currentVol / average(oldVolumes) : null;
    const trendLong = trendUp && st[i].direction === 'UP' && ut[i].direction === 'UP';
    const trendShort = trendDown && st[i].direction === 'DOWN' && ut[i].direction === 'DOWN';
    const breakoutLong = c.c > high && volumeRatio !== null && volumeRatio >= p.volumeFactor;
    const breakoutShort = c.c < low && volumeRatio !== null && volumeRatio >= p.volumeFactor;
    const bounceLong = candles[prev].c < bb[prev].lower && rsi[prev] <= 35 &&
      c.c > bb[i].lower && rsi[i] > rsi[prev];
    const bounceShort = candles[prev].c > bb[prev].upper && rsi[prev] >= 65 &&
      c.c < bb[i].upper && rsi[i] < rsi[prev];
    let signal = 'WAIT', setup = null;
    if (regime === 'TREND' && trendLong && breakoutLong) { signal = 'LONG'; setup = 'TREND_BREAKOUT'; }
    else if (regime === 'TREND' && trendShort && breakoutShort) { signal = 'SHORT'; setup = 'TREND_BREAKOUT'; }
    else if (regime === 'RANGE' && bounceLong) { signal = 'LONG'; setup = 'RANGE_REVERSION'; }
    else if (regime === 'RANGE' && bounceShort) { signal = 'SHORT'; setup = 'RANGE_REVERSION'; }
    const atrPct = a / c.c * 100, blockers = [];
    if (atrPct > p.maxAtrPercent) blockers.push('5m ATR volatility exceeds cap');
    if (signal !== 'WAIT' && !(c.c > 0 && a > 0)) blockers.push('Cannot compute stop distance');
    if (blockers.length) { signal = 'WAIT'; setup = null; }
    const stopDistance = p.stopAtr * a;
    const risk = signal === 'WAIT' ? null : {
      entryReference: c.c, stopDistance, stopReference: signal === 'LONG' ? c.c - stopDistance : c.c + stopDistance,
      takeReference: signal === 'LONG' ? c.c + stopDistance * p.targetR : c.c - stopDistance * p.targetR,
      stopPercent: stopDistance / c.c * 100, rewardRisk: p.targetR,
    };
    return { index: i, time: c.t ?? null, price: c.c, signal, setup, regime,
      reason: blockers.length ? blockers.join(' / ') : signal !== 'WAIT' ? 'Closed-bar signal: observe from next bar' : 'Independent conditions not met',
      indicators: { supertrend: st[i].direction, atrTrail: ut[i].direction,
        atrTrailFlip: ut[i].flip, emaGapAtr: emaGap, atrPercent: atrPct, rsi: rsi[i],
        bollinger: bb[i], donchianHigh: high, donchianLow: low, volumeRatio: safe(volumeRatio),
        trendEvidence: trendLong ? 'LONG' : trendShort ? 'SHORT' : 'NONE',
        breakoutEvidence: breakoutLong ? 'LONG' : breakoutShort ? 'SHORT' : 'NONE',
        rangeEvidence: bounceLong ? 'LONG' : bounceShort ? 'SHORT' : 'NONE' },
      risk, blockers };
  });
}
export function latestStrategySignal(candles, config = {}) {
  return last(buildStrategySeries(candles, config));
}
