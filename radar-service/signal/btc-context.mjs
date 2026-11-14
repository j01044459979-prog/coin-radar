// BTC context for entry-alert prose. Confirmed public candles only; explanatory, never an entry gate.
// No automatic order, probabilities or claims that correlation guarantees a trade.
import { ema, H1, H4 } from '../opportunity/indicators.mjs';
const pct = (x, y) => y > 0 ? (x / y - 1) * 100 : null;
const signed = n => (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(2) + '%';
const side = dir => dir === 'LONG' ? 1 : dir === 'SHORT' ? -1 : 0;
const sign = n => !Number.isFinite(n) || Math.abs(n) < 0.05 ? 0 : Math.sign(n);
const timeKst = t => new Date(t + 9 * H1).toISOString().slice(11, 16);

function validHourly(candles, at) {
  if (!Array.isArray(candles) || candles.length < 2 || !Number.isFinite(at)) return null;
  const last = candles.at(-1), prev = candles.at(-2);
  if (![last?.c, prev?.c, last?.t, prev?.t].every(Number.isFinite) ||
    last.c <= 0 || prev.c <= 0 || last.t - prev.t !== H1 ||
    last.t + H1 > at || at - (last.t + H1) >= H1) return null;
  return { closeT: last.t + H1, delta: pct(last.c, prev.c) };
}
function valid4hTrend(candles, at) {
  if (!Array.isArray(candles) || candles.length < 55 || !Number.isFinite(at)) return null;
  const last = candles.at(-1);
  if (!Number.isFinite(last?.t) || !Number.isFinite(last?.c) || last.c <= 0 ||
      last.t + H4 > at || at - (last.t + H4) >= H4) return null;
  const prices = candles.map(b => b.c);
  if (!prices.every(c => Number.isFinite(c) && c > 0)) return null;
  const fast = ema(prices, 20).at(-1), slow = ema(prices, 50).at(-1);
  if (![fast, slow].every(Number.isFinite)) return null;
  return fast > slow && last.c > fast ? '상승' : fast < slow && last.c < fast ? '하락' : '혼조';
}
export function btcContext({ btc4h = null, btc1h = null, coin1h = null, dir, at } = {}) {
  const trend4h = valid4hTrend(btc4h, at);
  const b = validHourly(btc1h, at), a = validHourly(coin1h, at);
  const btc1hPct = b?.delta ?? null;
  // Compare matching hourly close only: never compare an older BTC close to a newer altcoin close.
  const coin1hPct = b && a && b.closeT === a.closeT ? a.delta : null;
  const changeVsBtc = Number.isFinite(coin1hPct) && Number.isFinite(btc1hPct)
    ? coin1hPct - btc1hPct : null;
  const trendDirection = trend4h === '상승' ? 1 : trend4h === '하락' ? -1 : 0;
  const hourlyDirection = sign(btc1hPct), wanted = side(dir);
  const conflicted = [trendDirection, hourlyDirection].filter(d => d && wanted && d !== wanted).length;
  const aligned = [trendDirection, hourlyDirection].filter(d => d && wanted && d === wanted).length;
  const status = !trend4h && !b ? '확인 불가' : conflicted === 2 ? '충돌' : conflicted ? '주의' : aligned && !conflicted ? '일치' : '혼조';
  return { trend4h, btc1hPct, coin1hPct, changeVsBtc, asOf: b?.closeT ?? null, status };
}
export function btcContextLines(context, symbol, dir) {
  const c = context;
  if (!c || (!c.trend4h && !Number.isFinite(c.btc1hPct))) {
    return ['₿ BTC 비교: 확정 데이터 부족', '   BTC 흐름 확인 전 진입 주의'];
  }
  const lines = [
    `₿ BTC 비교 · 확정봉${Number.isFinite(c.asOf) ? ' ' + timeKst(c.asOf) + ' KST' : ''}`,
    `BTC 4H ${c.trend4h ?? '확인 불가'} · 1H ${Number.isFinite(c.btc1hPct) ? signed(c.btc1hPct) : '확인 불가'}`,
  ];
  if (Number.isFinite(c.coin1hPct) && Number.isFinite(c.changeVsBtc))
    lines.push(`${String(symbol).replace(/USDT$/, '')} 1H ${signed(c.coin1hPct)} · BTC 대비 ${c.changeVsBtc >= 0 ? '+' : '−'}${Math.abs(c.changeVsBtc).toFixed(2)}%p`);
  if (c.status === '충돌') lines.push(`⚠️ BTC 4H·1H이 ${dir === 'LONG' ? '롱' : '숏'} 반대 · 관망 우선`);
  else if (c.status === '주의') lines.push('⚠️ BTC 일부 지표 역행 · 진입 주의');
  else if (c.status === '혼조') lines.push('⚠️ BTC 방향 혼조 · 판단 보류');
  else if (c.status === '일치') lines.push('ℹ️ BTC 방향 일치 · 성과 보장 아님');
  return lines;
}
