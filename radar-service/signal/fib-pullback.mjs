// Experimental Fibonacci trend-pullback confirmation for existing SIGNAL candidates.
// Uses ONLY closed OKX OHLCV candles, no additional API requests, no orders.
// The candle-distributed profile is a coarse volume-at-price proxy, NOT TradingView FRVP/tick-level VPVR.
// Defaults OFF; "preview" logs diagnostics without changing any candidate/state/message.
// "on" adds a fail-closed confirmation gate to the existing 4H/1H/15m signal engine.
import { ema, atr, H4 } from '../opportunity/indicators.mjs';
import { fmtPrice } from '../format.mjs';

export const FIB = Object.freeze({
  pivotK: 3, impulseLookback: 48, pivotAge: 30, pullbackBars: 12,
  minImpulseAtr: 2, lowerRatio: 0.618, upperRatio: 0.5,
  profileBins: 64, profileBars: 96, profileToleranceAtr: 0.75,
  rsiPeriod: 14, rsiCrossBars: 4,
});

// RSI(14), Wilder smoothing; every output uses only current/past closes.
export function fibRsi(closes, period = FIB.rsiPeriod) {
  const out = Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    gain += Math.max(0, d);
    loss += Math.max(0, -d);
  }
  gain /= period; loss /= period;
  const at = () => (gain + loss === 0 ? 50 : loss === 0 ? 100 : gain === 0 ? 0 : 100 - 100 / (1 + gain / loss));
  out[period] = at();
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(0, d)) / period;
    loss = (loss * (period - 1) + Math.max(0, -d)) / period;
    out[i] = at();
  }
  return out;
}

// Most recent confirmed pivot (three candles after it), followed by a preceding
// impulse extreme. Anchors never move in response to candles that have not closed.
export function fibAnchors(c1, dir, a1, P = FIB) {
  if (!Array.isArray(c1) || c1.length < P.impulseLookback + P.pivotK + 2 || !(a1 > 0)) return null;
  const L = dir === 'LONG', k = P.pivotK, end = c1.length - 1;
  for (let p = end - k; p >= Math.max(k, end - P.pivotAge); p--) {
    const high = c1[p].h, low = c1[p].l;
    let pivot = true;
    for (let j = 1; j <= k; j++) {
      if (L ? !(high > c1[p - j].h && high >= c1[p + j].h) : !(low < c1[p - j].l && low <= c1[p + j].l)) { pivot = false; break; }
    }
    if (!pivot) continue;
    const start = Math.max(0, p - P.impulseLookback);
    if (p - start < 8) continue;
    let anchor = start;
    for (let j = start + 1; j < p; j++) {
      if (L ? c1[j].l < c1[anchor].l : c1[j].h > c1[anchor].h) anchor = j;
    }
    const hi = L ? high : c1[anchor].h, lo = L ? c1[anchor].l : low;
    if (!(hi > lo) || hi - lo < P.minImpulseAtr * a1) continue;
    // The impulse must run in the chosen direction from its prior extreme to the pivot.
    const half = L ? hi - 0.5 * (hi - lo) : lo + 0.5 * (hi - lo);
    const golden = L ? hi - 0.618 * (hi - lo) : lo + 0.618 * (hi - lo);
    return { from: c1[anchor].t, to: c1[p].t, fromPrice: L ? lo : hi,
      toPrice: L ? hi : lo, pivotIndex: p, lo: Math.min(half, golden), hi: Math.max(half, golden),
      half, golden, height: hi - lo, ageBars: end - p };
  }
  return null;
}

// Distribute each candle's quote turnover uniformly across intersected price bins.
// This is explicitly an OHLCV approximation: it cannot reproduce real traded-at-price VPVR.
export function estimatedVolumeProfile(c1, P = FIB) {
  const c = (c1 ?? []).slice(-P.profileBars);
  if (c.length < 30) return null;
  const lo = Math.min(...c.map(x => x.l)), hi = Math.max(...c.map(x => x.h));
  if (!(hi > lo)) return null;
  const width = (hi - lo) / P.profileBins, bins = Array(P.profileBins).fill(0);
  let valid = 0, total = 0;
  for (const b of c) {
    if (!(Number.isFinite(b.q) && b.q > 0 && Number.isFinite(b.l) && Number.isFinite(b.h) && b.h >= b.l)) continue;
    valid++; total += b.q;
    const first = Math.max(0, Math.min(P.profileBins - 1, Math.floor((b.l - lo) / width)));
    const last = Math.max(first, Math.min(P.profileBins - 1, Math.floor((b.h - lo) / width)));
    for (let j = first; j <= last; j++) {
      const overlap = Math.max(0, Math.min(b.h, lo + (j + 1) * width) - Math.max(b.l, lo + j * width));
      bins[j] += b.h === b.l ? (j === first ? b.q : 0) : b.q * overlap / (b.h - b.l);
    }
  }
  if (valid < 30 || !(total > 0)) return null;
  let top = 0;
  for (let j = 1; j < bins.length; j++) if (bins[j] > bins[top]) top = j;
  return { poc: lo + (top + 0.5) * width, binWidth: width, bars: valid, method: 'OHLCV-approximation', note: '체결 단위 VPVR 아님' };
}

// Pure diagnostic report; reasons are independent of legacy SIGNAL score.
// No lookahead: trim 4H to candles closed by the last 1H analysis timestamp.
export function evaluateFibPullback({ a, c1h, c4h, c15 }, P = FIB) {
  const reasons = [], add = (ok, reason) => { if (!ok) reasons.push(reason); };
  const unavailable = why => ({ ok: false, reasons: [why], fib: null, rsi1: null, rsi15: null, profile: null, profileNear: null, ema50Near: null });
  if (!a || a.status !== 'ok' || !['LONG', 'SHORT'].includes(a.dir)) return unavailable('기존 4H·1H 추세 판정 불가');
  if (!Array.isArray(c1h) || !Array.isArray(c4h) || !Array.isArray(c15)) return unavailable('확정 1H·4H·15m 데이터 없음');
  if (c1h.length < 100 || c15.length < 60 || c1h.at(-1).t + 3600000 > a.asOf) return unavailable('확정 봉/시각 검증 실패');
  const closed4 = c4h.filter(x => x.t + H4 <= a.asOf), n = closed4.length;
  if (n < 210) return unavailable('4H EMA200 계산에 필요한 데이터 부족');
  const L = a.dir === 'LONG', s = L ? 1 : -1;
  const c4 = closed4.map(x => x.c), e20 = ema(c4, 20), e50 = ema(c4, 50), e200 = ema(c4, 200);
  const trend = [e20.at(-1), e50.at(-1), e200.at(-1), e50.at(-2)].every(Number.isFinite) &&
    (e20.at(-1) - e50.at(-1)) * s > 0 && (e50.at(-1) - e200.at(-1)) * s > 0 &&
    (c4.at(-1) - e200.at(-1)) * s > 0 && (e50.at(-1) - e50.at(-2)) * s > 0;
  add(trend, '4H EMA20·50·200 정렬/EMA50 기울기 미충족');
  const a1 = atr(c1h, 14).at(-1);
  const fib = fibAnchors(c1h, a.dir, a1, P);
  if (!fib) return { ...unavailable('확정된 1H 상승/하락 파동 없음'), reasons: [...reasons, '확정된 1H 상승/하락 파동 없음'] };
  const after = c1h.slice(Math.max(fib.pivotIndex + 1, c1h.length - P.pullbackBars));
  const touched = after.some(b => b.l <= fib.hi && b.h >= fib.lo);
  add(touched, '1H 피보나치 0.5~0.618 구간 접촉 없음');
  const held = after.length > 0 && after.every(b => (b.c - (L ? fib.lo : fib.hi)) * s >= 0);
  add(held, '1H 피보나치 지지/저항 경계 종가 이탈');
  const last1 = c1h.at(-1).c, inReach = L ? last1 >= fib.lo : last1 <= fib.hi;
  add(inReach, '1H 종가가 피보나치 구간을 회복하지 못함');
  const r1s = fibRsi(c1h.map(x => x.c), P.rsiPeriod);
  const r15s = fibRsi(c15.map(x => x.c), P.rsiPeriod), rsi1 = r1s.at(-1), rsi15 = r15s.at(-1);
  const r1Prev = r1s.at(-2), recent1 = r1s.slice(-5).filter(Number.isFinite), recent15 = r15s.slice(-P.rsiCrossBars - 1, -1).filter(Number.isFinite);
  const momentum1 = Number.isFinite(rsi1) && Number.isFinite(r1Prev) && (rsi1 - r1Prev) * s > 0 &&
    (L ? rsi1 >= 40 && rsi1 <= 70 && Math.min(...recent1) <= 55 : rsi1 >= 30 && rsi1 <= 60 && Math.max(...recent1) >= 45);
  add(momentum1, '1H RSI14 조정 후 회복 미확인');
  const momentum15 = Number.isFinite(rsi15) && (rsi15 - 50) * s > 0 &&
    recent15.some(v => (v - 50) * s <= 0);
  add(momentum15, '15분 RSI14 중앙선(50) 재돌파/재이탈 미확인');
  const p = estimatedVolumeProfile(c1h, P);
  const profileNear = p ? p.poc >= fib.lo - P.profileToleranceAtr * a1 && p.poc <= fib.hi + P.profileToleranceAtr * a1 : null;
  const ema1 = ema(c1h.map(x => x.c), 50).at(-1);
  const ema50Near = Number.isFinite(ema1) && ema1 >= fib.lo - a1 && ema1 <= fib.hi + a1;
  // POC and 1H EMA50 overlap are informational confidence labels, not hard entry gates.
  // Otherwise hourly OHLCV uniform-profile estimation could silently reject valid setups.
  return { ok: reasons.length === 0, reasons, fib, rsi1, rsi15,
    profile: p, profileNear, ema50Near,
    evidence: 'FIB 0.5~0.618 ' + fmtPrice(fib.lo) + '~' + fmtPrice(fib.hi) +
      ' · RSI(1H/15m) ' + (rsi1?.toFixed(0) ?? '?') + '/' + (rsi15?.toFixed(0) ?? '?'),
    context: (profileNear === null ? '매물대 추정 불가' : profileNear ? '추정 POC 근접' : '추정 POC 비근접') +
      ' · ' + (ema50Near ? 'EMA50 근접' : 'EMA50 비근접') };
}

// When OFF/PREVIEW this returns the legacy evaluation byte-for-byte.
// ON adds a strict gate only for would-be candidates, with observation diagnostics.
export function applyFibGate(ev, report, mode = 'off') {
  if (mode !== 'on' || !ev || !['CANDIDATE', 'OBSERVE'].includes(ev.status)) return ev;
  const info = report ?? { ok: false, reasons: ['피보나치 확인 불가'] };
  if (info.ok) {
    if (ev.status !== 'CANDIDATE') return ev;
    return { ...ev, fib: info, evidence: [info.evidence, ev.evidence[1], info.context] };
  }
  if (ev.status !== 'CANDIDATE') return { ...ev, fib: info }; // legacy blocker still wins
  const blockers = [...(ev.blockers ?? []), ...info.reasons.map(x => 'FIB ' + x)];
  const { evidence, ...rest } = ev;
  return { ...rest, status: 'OBSERVE', fib: info, blockers, tags: [...(ev.tags ?? []), 'fib'] };
}
