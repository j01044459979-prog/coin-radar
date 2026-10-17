// 듀얼 전략용 지표. 모두 '인과적(causal)' 계산이다: 시리즈의 i번째 값은 0..i번째 캔들만으로 정해지며 미래 캔들을 참조하지 않는다.
// 캔들: { t, o, h, l, c, q } (q = USDT 거래대금). 계산 불가 구간은 NaN.
export const nan = n => Array(n).fill(NaN);

export function sma(values, n) {
  const out = nan(values.length); let sum = 0;
  for (let i = 0; i < values.length; i++) { sum += values[i]; if (i >= n) sum -= values[i - n]; if (i >= n - 1) out[i] = sum / n; }
  return out;
}

// 지수이동평균: 첫 n개의 단순평균으로 시작(TradingView ta.ema와 동일한 시드)
export function ema(values, n) {
  const out = nan(values.length), k = 2 / (n + 1);
  if (values.length < n) return out;
  let prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n; out[n - 1] = prev;
  for (let i = n; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

// Wilder 평활(RMA): ATR·RSI에 사용
export function rma(values, n) {
  const out = nan(values.length);
  if (values.length < n) return out;
  let prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n; out[n - 1] = prev;
  for (let i = n; i < values.length; i++) { prev = (prev * (n - 1) + values[i]) / n; out[i] = prev; }
  return out;
}

export function trueRange(c) {
  return c.map((x, i) => (i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1].c), Math.abs(x.l - c[i - 1].c))));
}
export const atr = (c, n = 14) => rma(trueRange(c), n);

export function rsi(closes, n = 14) {
  const out = nan(closes.length);
  if (closes.length <= n) return out;
  const gain = [0], loss = [0];
  for (let i = 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; gain.push(Math.max(d, 0)); loss.push(Math.max(-d, 0)); }
  // 첫 평균은 1..n 구간의 단순평균(인덱스 n에서 시작), 이후 Wilder 평활
  let ag = gain.slice(1, n + 1).reduce((a, b) => a + b, 0) / n, al = loss.slice(1, n + 1).reduce((a, b) => a + b, 0) / n;
  out[n] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = n + 1; i < closes.length; i++) {
    ag = (ag * (n - 1) + gain[i]) / n; al = (al * (n - 1) + loss[i]) / n;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, signalN = 9) {
  const f = ema(closes, fast), s = ema(closes, slow);
  const line = closes.map((_, i) => (Number.isFinite(f[i]) && Number.isFinite(s[i]) ? f[i] - s[i] : NaN));
  const start = line.findIndex(Number.isFinite);
  const signal = nan(closes.length), hist = nan(closes.length);
  if (start >= 0) {
    const sig = ema(line.slice(start), signalN);
    sig.forEach((v, j) => { signal[start + j] = v; if (Number.isFinite(v)) hist[start + j] = line[start + j] - v; });
  }
  return { line, signal, hist };
}

// Supertrend (TradingView ta.supertrend와 같은 정의): dir 1=상승(라인은 지지), -1=하락(라인은 저항)
export function supertrend(c, period = 10, mult = 3) {
  const n = c.length, a = atr(c, period);
  const line = nan(n), dir = nan(n), flip = nan(n); // flip: 마지막 방향 전환이 일어난 인덱스
  let up = NaN, dn = NaN, trend = 1, lastFlip = NaN;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(a[i])) continue;
    const hl2 = (c[i].h + c[i].l) / 2;
    let nu = hl2 - mult * a[i], nd = hl2 + mult * a[i];
    if (Number.isFinite(up)) { if (c[i - 1].c > up) nu = Math.max(nu, up); if (c[i - 1].c < dn) nd = Math.min(nd, dn); }
    if (Number.isFinite(up)) {
      if (trend === -1 && c[i].c > dn) { trend = 1; lastFlip = i; }
      else if (trend === 1 && c[i].c < up) { trend = -1; lastFlip = i; }
    } else lastFlip = i;
    up = nu; dn = nd;
    dir[i] = trend; line[i] = trend === 1 ? up : dn; flip[i] = lastFlip;
  }
  return { line, dir, flip, atr: a };
}

// 직전 n봉(현재 봉 제외)의 최고가/최저가
export function priorHigh(c, i, n) { let m = -Infinity; for (let j = Math.max(0, i - n); j < i; j++) m = Math.max(m, c[j].h); return m; }
export function priorLow(c, i, n) { let m = Infinity; for (let j = Math.max(0, i - n); j < i; j++) m = Math.min(m, c[j].l); return m; }
export function avgQuote(c, i, n) { let s = 0, k = 0; for (let j = Math.max(0, i - n); j < i; j++) { s += c[j].q; k++; } return k ? s / k : 0; }

// 1시간봉 → 4시간봉 집계(UTC 4시간 경계, 4개가 모두 있는 봉만). 인과적: 마지막 4H 봉은 완성된 경우에만 포함.
export function aggregate(c, stepMs = 3600000, groupMs = 14400000) {
  const out = []; let cur = null;
  for (const x of c) {
    const start = Math.floor(x.t / groupMs) * groupMs;
    if (!cur || cur.t !== start) { if (cur && cur.n === groupMs / stepMs) out.push(cur); cur = { t: start, o: x.o, h: x.h, l: x.l, c: x.c, q: x.q, n: 1, last: x.t }; }
    else { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; cur.q += x.q; cur.n++; cur.last = x.t; }
  }
  if (cur && cur.n === groupMs / stepMs) out.push(cur);
  return out;
}
