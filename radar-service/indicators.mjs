// 확정 캔들 기반 순수 지표. 미완성 캔들은 호출 전에 제거되어 있어야 한다(okx.mjs에서 confirm=1만 전달).
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
export const TF_MS = { '15m': 900000, '1H': 3600000, '4H': 14400000 };
export const TF_LABEL = { '15m': '15분', '1H': '1시간', '4H': '4시간' };

// 양옆 k봉보다 높은(낮은) 봉을 스윙 고점(저점)으로 본다. 마지막 k봉은 확정 불가라 제외.
export function pivots(candles, k = 2) {
  const highs = [], lows = [];
  for (let i = k; i < candles.length - k; i++) {
    const around = candles.slice(i - k, i + k + 1);
    if (candles[i].h === Math.max(...around.map(c => c.h)) && around.filter(c => c.h === candles[i].h).length === 1) highs.push({ t: candles[i].t, price: candles[i].h });
    if (candles[i].l === Math.min(...around.map(c => c.l)) && around.filter(c => c.l === candles[i].l).length === 1) lows.push({ t: candles[i].t, price: candles[i].l });
  }
  return { highs, lows };
}

// candles: [{t,o,h,l,c,end}] 오래된 순. 간격 누락·부족 시 '미확인'.
export function trendOf(candles, tf) {
  const unknown = basis => ({ tf, dir: 'UNKNOWN', label: '미확인', arrow: '?', basis, lastClosedAt: candles?.at?.(-1)?.end ?? null });
  if (!Array.isArray(candles) || candles.length < 30) return unknown('확정 캔들 부족');
  for (let i = 1; i < candles.length; i++) if (candles[i].t - candles[i - 1].t !== TF_MS[tf]) return unknown('캔들 누락');
  const closes = candles.map(c => c.c);
  const ma10 = mean(closes.slice(-10)), ma30 = mean(closes.slice(-30)), close = closes.at(-1);
  const { highs, lows } = pivots(candles);
  const [ph, lh] = [highs.at(-2), highs.at(-1)], [pl, ll] = [lows.at(-2), lows.at(-1)];
  const hi = ph && lh ? (lh.price > ph.price ? 1 : lh.price < ph.price ? -1 : 0) : 0;
  const lo = pl && ll ? (ll.price > pl.price ? 1 : ll.price < pl.price ? -1 : 0) : 0;
  const ma = ma10 > ma30 && close > ma30 ? 1 : ma10 < ma30 && close < ma30 ? -1 : 0;
  const total = hi + lo + ma;
  const dir = total >= 2 ? 'UP' : total <= -2 ? 'DOWN' : 'FLAT';
  const word = v => (v > 0 ? '상승' : v < 0 ? '하락' : '불명확');
  return {
    tf, dir, label: { UP: '상승', DOWN: '하락', FLAT: '횡보' }[dir], arrow: { UP: '↑', DOWN: '↓', FLAT: '→' }[dir],
    basis: `고점 ${word(hi)} · 저점 ${word(lo)} · MA10 ${ma10 > ma30 ? '>' : ma10 < ma30 ? '<' : '='} MA30`,
    lastClosedAt: candles.at(-1).end, lastHigh: lh?.price ?? null, lastLow: ll?.price ?? null, prevHigh: ph?.price ?? null, prevLow: pl?.price ?? null,
    close, // 구조 참고용 (1H 저항/지지 계산에 사용)
    resistance: highs.map(p => p.price), support: lows.map(p => p.price),
  };
}
