// Upbit 서버 감시 계산 엔진 (순수 함수, 네트워크/DB 없음 → 테스트 가능)
//
// 브라우저 Binance 레이더와 같은 개념(구간 변화율, 거래 활동 배수, 상태, 레이더 점수)을
// Upbit 공식 캔들 데이터로 계산합니다. 설명: docs/MONITOR.md
//
// Binance 와 Upbit 의 데이터 차이:
//  - Upbit 은 체결이 없는 분에는 캔들을 만들지 않습니다. 빠진 분은 '거래 0, 가격은 직전 종가'로 봅니다.
//  - 거래대금은 원화(KRW) 기준(candle_acc_trade_price)입니다.
//  - 15분 구간의 평소 거래대금은 Upbit 15분봉(시계 기준 :00/:15/:30/:45) 12개 평균을 씁니다.
import { MIN, RULES } from './config.js';

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Upbit 분 캔들 → { t(시작 ms), o, h, l, c, q(거래대금 KRW), v(거래량) }
export function parseUpbitCandle(x) {
  if (!x || typeof x.candle_date_time_utc !== 'string') return null;
  const t = Date.parse(x.candle_date_time_utc + 'Z');
  const c = { t, o: num(x.opening_price), h: num(x.high_price), l: num(x.low_price), c: num(x.trade_price), q: num(x.candle_acc_trade_price), v: num(x.candle_acc_trade_volume) };
  if (!Number.isFinite(t) || t % MIN !== 0) return null;
  if (![c.o, c.h, c.l, c.c, c.q, c.v].every((n) => n !== null && n >= 0) || c.o <= 0) return null;
  return c;
}

// 완료된 1분봉을 빈 분 없이 이어 붙입니다 (체결 없는 분 = 거래 0, 가격 = 직전 종가).
// 반환: { candles: [...오래된→최근], last: 마지막 완료 분 시작시각 } 또는 null
export function buildMinuteSeries(rawCandles, now) {
  const m0 = Math.floor(now / MIN) * MIN; // 진행 중인 분
  const lastClosed = m0 - MIN;
  const list = rawCandles.map(parseUpbitCandle).filter((c) => c && c.t <= lastClosed).sort((a, b) => a.t - b.t);
  if (!list.length) return null;
  const byT = new Map(list.map((c) => [c.t, c]));
  const out = [];
  let prevClose = list[0].o;
  for (let t = list[0].t; t <= lastClosed; t += MIN) {
    const c = byT.get(t);
    if (c) {
      out.push(c);
      prevClose = c.c;
    } else {
      out.push({ t, o: prevClose, h: prevClose, l: prevClose, c: prevClose, q: 0, v: 0, empty: true });
    }
  }
  return { candles: out, last: lastClosed };
}

// 15분봉 → Map(시작시각 → 거래대금), 가장 오래된 시작시각
export function buildBucketMap(rawCandles, now) {
  const list = rawCandles.map(parseUpbitCandle).filter((c) => c && c.t % (15 * MIN) === 0 && c.t + 15 * MIN <= now);
  if (!list.length) return null;
  return { q: new Map(list.map((c) => [c.t, c.q])), oldest: Math.min(...list.map((c) => c.t)) };
}

function sum(arr, from, to, key) {
  let s = 0;
  for (let i = from; i < to; i += 1) s += arr[i][key];
  return s;
}

// W분 구간 계산. 현재 구간 = 마지막 완료 1분봉까지 W개.
// 평소 거래대금: 1분/5분 → 직전 같은 길이 구간 최대 12개 평균 (1분봉 합산),
//               15분    → 현재 구간 시작 이전에 끝난 Upbit 15분봉 12개 평균.
export function windowMetrics(series, W, buckets, rules = RULES) {
  const need = W * (1 + rules.minBaselineWindows);
  if (!series) return { status: 'collecting', window: W, remainingMin: need };
  const arr = series.candles;
  const n = arr.length;
  if (n < W) return { status: 'collecting', window: W, remainingMin: need - n };

  const curFrom = n - W;
  const cur = { q: sum(arr, curFrom, n, 'q'), v: sum(arr, curFrom, n, 'v'), open: arr[curFrom].o, close: arr[n - 1].c };
  const windowStart = arr[curFrom].t;

  const base = [];
  if (W === 15) {
    if (!buckets) return { status: 'collecting', window: W, remainingMin: need };
    const B = 15 * MIN;
    const lastEnd = Math.floor(windowStart / B) * B; // 현재 구간 시작 이전에 끝난 15분봉
    for (let k = 1; k <= rules.baselineWindows; k += 1) {
      const s = lastEnd - k * B;
      if (s < buckets.oldest) break; // 받은 범위 밖은 알 수 없음
      base.push(buckets.q.get(s) || 0); // 범위 안에서 없는 15분봉 = 체결 없음
    }
    if (base.length < rules.minBaselineWindows) return { status: 'collecting', window: W, remainingMin: (rules.minBaselineWindows - base.length) * 15 };
  } else {
    for (let k = 1; k <= rules.baselineWindows; k += 1) {
      const from = curFrom - k * W;
      if (from < 0) break;
      base.push(sum(arr, from, from + W, 'q'));
    }
    if (base.length < rules.minBaselineWindows) return { status: 'collecting', window: W, remainingMin: need - n };
  }

  const baselineAvg = base.reduce((a, b) => a + b, 0) / base.length;
  const changePct = ((cur.close - cur.open) / cur.open) * 100;
  return {
    status: 'ok',
    window: W,
    windowStart,
    windowEnd: series.last + MIN,
    open: cur.open,
    close: cur.close,
    changePct,
    quoteVol: cur.q,
    baseVol: cur.v,
    baselineAvg,
    baselineCount: base.length,
    ratio: baselineAvg > 0 ? cur.q / baselineAvg : null,
    direction: changePct > 0 ? 'up' : changePct < 0 ? 'down' : 'flat',
  };
}

// ── 상태 판정 / 레이더 점수 (브라우저 radar-engine.js 와 같은 공식) ──
export const LEVEL_RANK = { none: 0, observe: 0, active: 1, alert: 2, overheat: 3 };

export function classify(m, rules = RULES) {
  if (!m || m.status !== 'ok') return { labels: [], level: 'none', primary: null };
  const th = rules.priceMovePct[m.window];
  const abs = Math.abs(m.changePct);
  const r = m.ratio;
  const priceMove = abs >= th;
  const volAnomaly = r !== null && r >= rules.volumeAnomalyRatio;
  const activity = r !== null && r >= rules.activityRatio;
  const overheat = abs >= th * rules.overheat.priceMult && r !== null && r >= rules.overheat.ratio;
  const labels = [];
  if (overheat) labels.push('과열');
  if (priceMove) labels.push('가격 급변');
  if (volAnomaly) labels.push('거래량 이상');
  else if (activity) labels.push('활동 증가');
  if (!labels.length) labels.push('관찰');
  const level = overheat ? 'overheat' : priceMove || volAnomaly ? 'alert' : activity ? 'active' : 'observe';
  return { labels, level, primary: labels[0], priceMove, volAnomaly, activity, overheat };
}

export function radarScore(m, rules = RULES) {
  if (!m || m.status !== 'ok') return null;
  const th = rules.priceMovePct[m.window];
  const pf = rules.score.priceFullMult;
  const rf = rules.score.ratioFull;
  const pricePart = (Math.min(Math.abs(m.changePct) / th, pf) / pf) * 50;
  const volumePart = m.ratio === null ? 0 : (Math.min(Math.max(m.ratio - 1, 0), rf - 1) / (rf - 1)) * 50;
  return { score: Math.round(pricePart + volumePart), pricePart: Math.round(pricePart), volumePart: Math.round(volumePart) };
}

// 한 종목의 1분/5분/15분 결과
export function analyzeMarket(market, minuteRaw, fifteenRaw, now, rules = RULES) {
  const series = buildMinuteSeries(minuteRaw || [], now);
  const buckets = buildBucketMap(fifteenRaw || [], now);
  return rules.windows.map((W) => {
    const metrics = windowMetrics(series, W, buckets, rules);
    return { market, window: W, metrics, cls: classify(metrics, rules), score: radarScore(metrics, rules) };
  });
}

// 종목별로 점수가 가장 높은 구간 하나 (같으면 짧은 구간)
export function bestPerMarket(rows) {
  const best = new Map();
  for (const r of rows) {
    if (r.metrics.status !== 'ok') continue;
    const b = best.get(r.market);
    if (!b || r.score.score > b.score.score) best.set(r.market, r);
  }
  return [...best.values()].sort((a, b) => b.score.score - a.score.score);
}

// 24H 거래대금 상위 KRW 마켓 (스테이블코인 제외)
export function pickMarkets(tickers, n, stableBases) {
  return tickers
    .filter((x) => typeof x.market === 'string' && x.market.startsWith('KRW-') && !stableBases.has(x.market.slice(4)))
    .filter((x) => Number.isFinite(Number(x.acc_trade_price_24h)))
    .sort((a, b) => Number(b.acc_trade_price_24h) - Number(a.acc_trade_price_24h))
    .slice(0, n)
    .map((x) => x.market);
}
