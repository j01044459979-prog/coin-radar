import futures from '../assets/futures-engine.js';

const MIN = 60000;
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const numeric = x => x !== null && x !== '' && Number.isFinite(Number(x));
export function closedCandles(rows, now) {
  if (!Array.isArray(rows)) throw new Error('캔들 응답 오류');
  const candles = rows.filter(r => Array.isArray(r) && Number(r[6]) < now).map(r => {
    if (![0, 1, 2, 3, 4, 6, 7].every(i => numeric(r[i]))) throw new Error('캔들 숫자 오류');
    const [t, o, h, l, c, , end, q] = r.map(Number);
    if (Math.min(o, h, l, c) <= 0 || h < Math.max(o, c, l) || l > Math.min(o, c) || q < 0 || end !== t + 5 * MIN - 1) throw new Error('캔들 범위 오류');
    return { t, o, h, l, c, end, q };
  });
  if (candles.length < 50) throw new Error('캔들 부족');
  for (let i = 1; i < candles.length; i++) if (candles[i].t - candles[i - 1].t !== 5 * MIN) throw new Error('캔들 누락');
  if (now - candles.at(-1).end > 6 * MIN) throw new Error('캔들 지연');
  return candles;
}

export function analyze(symbol, raw, now) {
  const candles = closedCandles(raw.klines, now);
  const mark = futures.parsePremiumIndex(raw.premium);
  const oi = futures.parseOpenInterest(raw.oi);
  if (!mark || !oi || mark.symbol !== symbol || oi.symbol !== symbol || mark.fundingPct === null ||
      !mark.time || now - mark.time > 3 * MIN || now - oi.t > 3 * MIN || mark.time > now + MIN || oi.t > now + MIN) throw new Error('가격/OI 지연 또는 누락');
  const history = futures.parseOiHist(raw.history).filter(p => p.t < oi.t);
  const oi15 = futures.oiChange([...history, oi], 15);
  if (oi15 === null) throw new Error('15분 OI 비교값 없음');
  const last = candles.at(-1);
  const prior = candles.slice(-21, -1);
  const high = Math.max(...prior.map(c => c.h));
  const low = Math.min(...prior.map(c => c.l));
  const fast = mean(candles.slice(-12).map(c => c.c));
  const slow = mean(candles.slice(-48).map(c => c.c));
  const baseline = mean(prior.map(c => c.q));
  const volume = baseline > 0 ? last.q / baseline : 0;
  const change15 = (last.c / candles.at(-4).c - 1) * 100;
  const atr = mean(candles.slice(-14).map((c, i) => {
    const previous = candles[candles.length - 15 + i].c;
    return Math.max(c.h - c.l, Math.abs(c.h - previous), Math.abs(c.l - previous));
  }));
  let direction = 'WAIT';
  if (last.c > high && fast > slow && mark.markPrice >= high) direction = 'LONG';
  if (last.c < low && fast < slow && mark.markPrice <= low) direction = 'SHORT';
  const level = direction === 'LONG' ? high : direction === 'SHORT' ? low : null;
  const strong = direction !== 'WAIT' && volume >= 2 && oi15 >= 1 && Math.abs(mark.fundingPct) <= 0.05 &&
    atr > 0 && Math.abs(mark.markPrice - level) <= atr;
  const swing = candles.slice(-12);
  return { symbol, direction, strong, high, low, swingHigh: Math.max(...swing.map(c => c.h)), swingLow: Math.min(...swing.map(c => c.l)), trend: fast > slow ? '상승' : fast < slow ? '하락' : '횡보', atrPct: atr / mark.markPrice * 100, price: mark.markPrice, priceAt: mark.time, collectedAt: now,
    candleAt: last.end, oiAt: oi.t, change15, volume, oi15, funding: mark.fundingPct, atr, level,
    stop: direction === 'LONG' ? level - atr : direction === 'SHORT' ? level + atr : null };
}

export function applyBtcFilter(rows) {
  const btc = rows.find(r => r.symbol === 'BTCUSDT');
  return rows.map(r => {
    const strong = r.strong && Boolean(btc) &&
      !(r.direction === 'LONG' && btc.change15 < -0.5) && !(r.direction === 'SHORT' && btc.change15 > 0.5);
    // 보수형(상대적으로 보수적인 조건): BTC가 같은 방향이고 펀딩 과열·OI 과열·기준선 이격이 모두 작을 때. 나머지 강한 조건은 공격형. 수익률과 무관한 규칙 분류.
    const aligned = btc && (r.direction === 'LONG' ? btc.change15 >= 0 : btc.change15 <= 0);
    const safe = strong && aligned && Math.abs(r.funding) <= 0.02 && r.oi15 <= 5 && Math.abs(r.price - r.level) <= 0.5 * r.atr;
    return { ...r, strong, grade: strong ? (safe ? '보수형' : '공격형') : null };
  });
}

export { signalText, reportText, reportMessages } from './report.mjs';
