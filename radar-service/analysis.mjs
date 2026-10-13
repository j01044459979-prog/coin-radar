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
  return { symbol, direction, strong, price: mark.markPrice, priceAt: mark.time, collectedAt: now,
    candleAt: last.end, oiAt: oi.t, change15, volume, oi15, funding: mark.fundingPct, atr, level,
    stop: direction === 'LONG' ? level - atr : direction === 'SHORT' ? level + atr : null };
}

export function applyBtcFilter(rows) {
  const btc = rows.find(r => r.symbol === 'BTCUSDT');
  return rows.map(r => ({ ...r, strong: r.strong && Boolean(btc) &&
    !(r.direction === 'LONG' && btc.change15 < -0.5) && !(r.direction === 'SHORT' && btc.change15 > 0.5) }));
}

const f = n => Number(n.toPrecision(7)).toString();
const kst = n => new Date(n).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';
export function signalText(row) {
  return `${row.symbol} · ${row.direction} 관찰\n검증 마크가격: ${f(row.price)} USDT (${kst(row.priceAt)})\n` +
    `15분 가격 ${row.change15.toFixed(2)}% · OI ${row.oi15.toFixed(2)}%\n거래대금 ${row.volume.toFixed(2)}배 · 최근 펀딩 ${row.funding.toFixed(4)}%\n` +
    (row.level === null ? '돌파 조건 미충족\n' : `관찰 기준선 ${f(row.level)} · 5분봉 재지지/재저항 확인 필요\n무효화 참고선 ${f(row.stop)} (기준선 ± 14봉 ATR)\n`) +
    `출처: https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${row.symbol}`;
}

export function reportText(rows, failures, now) {
  const candidates = rows.filter(r => r.strong).sort((a, b) => b.volume - a.volume).slice(0, 2);
  return `리치 선물 레이더 · 정기 분석\n수집 ${kst(now)}\n정상 ${rows.length}종목 / 실패 ${failures.length}종목\n` +
    (candidates.length ? candidates.map(signalText).join('\n\n') : '현재 검증된 강한 조건 없음 · 대기') +
    `\n\nBTC 15분: ${rows.find(r => r.symbol === 'BTCUSDT')?.change15.toFixed(2) ?? '미확인'}%\n` +
    '위험: BTC 역방향 급변·기준선 이탈 시 조건 무효. 규칙 기반 관찰이며 수익 확률을 뜻하지 않습니다.';
}
