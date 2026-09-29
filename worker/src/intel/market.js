// 이벤트 시각 전후의 Upbit 원화 시세 반응 계산 (순수 함수). Binance 는 Worker 에서 접속이 막혀 브라우저에서 계산합니다.
// 반환값은 실제 1분봉으로 계산한 값뿐이며, 데이터가 모자라면 null (임의로 채우지 않음).
import { parseUpbitCandle } from '../monitor-engine.js';
import { MIN } from '../config.js';

const pct = (a, b) => (a && b ? Number(((a / b - 1) * 100).toFixed(3)) : null);

// rawCandles: Upbit 분봉 응답. 시각 T 의 가격 = T 이전에 '완료된' 마지막 1분봉 종가 (체결 없는 분은 직전 종가 유지)
export function reactionFromCandles(rawCandles, publishedAt, now) {
  const list = (Array.isArray(rawCandles) ? rawCandles : []).map(parseUpbitCandle).filter(Boolean).sort((a, b) => a.t - b.t);
  if (!list.length) return null;
  const first = list[0].t;
  const priceAt = (T) => {
    const minute = Math.floor(T / MIN) * MIN; // T 가 속한 분의 시작. 그 이전에 끝난 봉만 사용
    if (minute > Math.floor(now / MIN) * MIN || minute <= first) return null; // 미래이거나 데이터 시작 이전
    let p = null;
    for (const c of list) {
      if (c.t + MIN <= minute) p = c.c;
      else break;
    }
    return p;
  };
  const out = { price_now: priceAt(now), change_5m: null, change_15m: null, change_pre5: null, change_post5: null, change_post15: null, price_at_pub: null };
  out.change_5m = pct(out.price_now, priceAt(now - 5 * MIN));
  out.change_15m = pct(out.price_now, priceAt(now - 15 * MIN));
  if (publishedAt) {
    const p0 = priceAt(publishedAt);
    out.price_at_pub = p0;
    out.change_pre5 = pct(p0, priceAt(publishedAt - 5 * MIN));
    out.change_post5 = publishedAt + 5 * MIN <= now ? pct(priceAt(publishedAt + 5 * MIN), p0) : null;
    out.change_post15 = publishedAt + 15 * MIN <= now ? pct(priceAt(publishedAt + 15 * MIN), p0) : null;
  }
  return out.price_now === null ? null : out;
}
