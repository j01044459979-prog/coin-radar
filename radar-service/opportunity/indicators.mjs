// 기회 포착 레이더용 지표(순수 함수). 연구 브랜치(PR #24~#26)의 인과적 지표 구현을 필요한 부분만 옮겼다.
// 시리즈의 i번째 값은 0..i번째 캔들만으로 정해진다(미래 캔들 비참조). 캔들: { t, o, h, l, c, q } (q = USDT 거래대금, 누락이면 null).
const nan = n => Array(n).fill(NaN);
export const H1 = 3600000, H4 = 4 * H1;

// 지수이동평균: 첫 n개의 단순평균으로 시작(TradingView ta.ema와 동일한 시드)
export function ema(values, n) {
  const out = nan(values.length), k = 2 / (n + 1);
  if (values.length < n) return out;
  let prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n; out[n - 1] = prev;
  for (let i = n; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}
// Wilder 평활(RMA)
export function rma(values, n) {
  const out = nan(values.length);
  if (values.length < n) return out;
  let prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n; out[n - 1] = prev;
  for (let i = n; i < values.length; i++) { prev = (prev * (n - 1) + values[i]) / n; out[i] = prev; }
  return out;
}
export const trueRange = c => c.map((x, i) => (i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1].c), Math.abs(x.l - c[i - 1].c))));
export const atr = (c, n = 14) => rma(trueRange(c), n);

// 1시간봉 → 4시간봉 집계(UTC 4시간 경계, 4개가 모두 있는 봉만). 마지막 4H 봉은 완성된 경우에만 포함한다.
export function aggregate(c, stepMs = H1, groupMs = H4) {
  const out = []; let cur = null;
  for (const x of c) {
    const start = Math.floor(x.t / groupMs) * groupMs;
    if (!cur || cur.t !== start) { if (cur && cur.n === groupMs / stepMs) out.push(cur); cur = { t: start, o: x.o, h: x.h, l: x.l, c: x.c, q: x.q, n: 1 }; }
    else { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; cur.q = cur.q === null || x.q === null ? null : cur.q + x.q; cur.n++; }
  }
  if (cur && cur.n === groupMs / stepMs) out.push(cur);
  return out;
}
// 직전 n봉(현재 봉 제외)의 최고가/최저가, 평균 거래대금(유효값이 minValid개 미만이면 null)
export function priorHigh(c, i, n) { let m = -Infinity; for (let j = Math.max(0, i - n); j < i; j++) m = Math.max(m, c[j].h); return m; }
export function priorLow(c, i, n) { let m = Infinity; for (let j = Math.max(0, i - n); j < i; j++) m = Math.min(m, c[j].l); return m; }
export function avgQuote(c, i, n, minValid = Math.ceil(n / 2)) {
  let s = 0, k = 0;
  for (let j = Math.max(0, i - n); j < i; j++) if (Number.isFinite(c[j].q) && c[j].q >= 0) { s += c[j].q; k++; }
  return k >= minValid ? s / k : null;
}
