// 소셜 관심도 계산 (순수 함수, deterministic). Telegram 언급량과 국내 커뮤니티 게시글 증가를 같은 규칙으로 계산합니다.
// ⚠️ 이 점수는 '관심도'이며 매수/매도 점수·가격 예측이 아닙니다. 정보 중요도(classify.js)와 섞지 않습니다.
const H = 3600000;

// 15분/1시간/6시간 창은 직전 기준 기간(baseMs)과 비교해 배수를 계산하고, 24시간 창은 개수만 보여줍니다.
// minCoverage: 수집이 이 기간 이상 진행된 뒤에만 배수를 계산 (그 전에는 '데이터 축적 중')
export const WINDOWS = [
  { key: '15m', ms: 15 * 60000, baseMs: 6 * H, minCoverage: 3 * H },
  { key: '1h', ms: H, baseMs: 24 * H, minCoverage: 12 * H },
  { key: '6h', ms: 6 * H, baseMs: 48 * H, minCoverage: 24 * H },
  { key: '24h', ms: 24 * H, baseMs: null, minCoverage: null },
];
export const MAX_LOOKBACK_MS = 6 * H + 48 * H; // 가장 긴 기준 기간(6h 창 + 48h)

// count: 창 안 개수, baseCount: 직전 기준 기간 개수. 반환: { count, ratio|null, state }
//  state: ok(배수 계산됨) | insufficient(데이터 축적 중) | new(기준 기간엔 없었는데 새로 등장) | none(비교할 활동 없음) | count_only(24h)
export function windowStat(w, count, baseCount, coverageMs) {
  if (!w.baseMs) return { count, ratio: null, state: 'count_only' };
  if (coverageMs < w.minCoverage) return { count, ratio: null, state: 'insufficient' };
  if (!baseCount) return { count, ratio: null, state: count >= 3 ? 'new' : 'none' };
  const ratio = count / (w.ms / H) / (baseCount / (w.baseMs / H));
  return { count, ratio: Math.round(ratio * 10) / 10, state: 'ok' };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 관심도 점수 0~100. 요소: 증가율 · 절대 개수 · (Telegram) 동시 언급 채널 수 · 최근성
//  Telegram : 증가율 40 + 개수 20(1시간 8건 만점) + 채널 다양성 25(2개 채널부터, 4개 만점) + 최근성 15
//  커뮤니티 : 증가율 50 + 개수 30(1시간 10건 만점) + 최근성 20
// 증가율 점수: 배수 1배=0점, 5배 이상 만점. 배수를 계산할 수 없으면(데이터 축적 중) 그 요소는 0점이고 partial=true.
export function attentionScore({ kind, stats, channels1h, lastAt, now }) {
  const ratios = ['15m', '1h', '6h'].map((k) => stats[k] && stats[k].ratio).filter((r) => typeof r === 'number');
  const hasRatio = ratios.length > 0;
  const isNew = ['15m', '1h', '6h'].some((k) => stats[k] && stats[k].state === 'new');
  const r = hasRatio ? Math.max(...ratios) : isNew ? 5 : null; // 새로 등장(기준 기간 0건)은 최대로 취급
  const tg = kind === 'telegram';
  const ratioPart = r === null ? 0 : clamp((r - 1) / 4, 0, 1) * (tg ? 40 : 50);
  const c1h = (stats['1h'] && stats['1h'].count) || 0;
  const volumePart = tg ? clamp(c1h / 8, 0, 1) * 20 : clamp(c1h / 10, 0, 1) * 30;
  const diversityPart = tg ? clamp(((channels1h || 0) - 1) / 3, 0, 1) * 25 : 0;
  const age = lastAt ? now - lastAt : Infinity;
  const recencyFull = tg ? 15 : 20;
  const recencyPart = age <= 10 * 60000 ? recencyFull : age <= 30 * 60000 ? recencyFull * 0.7 : age <= H ? recencyFull * 0.4 : age <= 6 * H ? recencyFull * 0.1 : 0;
  const score = Math.round(ratioPart + volumePart + diversityPart + recencyPart);
  return { score: clamp(score, 0, 100), partial: r === null, parts: { ratio: Math.round(ratioPart), volume: Math.round(volumePart), channels: Math.round(diversityPart), recency: Math.round(recencyPart) } };
}

// 검증 상태 우선순위
export const VERIFY_RANK = { official: 3, multi: 2, news: 1, unverified: 0 };
export const bestVerification = (list) => list.reduce((b, v) => ((VERIFY_RANK[v] ?? 0) > (VERIFY_RANK[b] ?? 0) ? v : b), 'unverified');

// SQL 집계 행(심볼별) → 화면용 객체. row: { symbol, c15, c1h, c6h, c24h, b15, b1h, b6h, ch1h, last }
export function buildAttention(kind, row, coverageMs, now) {
  const stats = {
    '15m': windowStat(WINDOWS[0], row.c15 || 0, row.b15 || 0, coverageMs),
    '1h': windowStat(WINDOWS[1], row.c1h || 0, row.b1h || 0, coverageMs),
    '6h': windowStat(WINDOWS[2], row.c6h || 0, row.b6h || 0, coverageMs),
    '24h': windowStat(WINDOWS[3], row.c24h || 0, 0, coverageMs),
  };
  const sc = attentionScore({ kind, stats, channels1h: row.ch1h || 0, lastAt: row.last, now });
  return { kind, symbol: row.symbol, score: sc.score, partial: sc.partial, parts: sc.parts, stats, channels_1h: row.ch1h || 0, last_at: row.last || null };
}
