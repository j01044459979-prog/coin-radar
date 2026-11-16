// BONKUSDT 보유 관찰: 기존 RICH RADAR Telegram 전송기로 3시간 간격 시장 점검만 보낸다.
// 실제 거래계정/포지션 방향/진입가를 읽지 않으며 주문 기능이 없다.
import { collectOpportunity } from './opportunity/collect.mjs';
import { jsonRequest } from './service.mjs';
import { fmtPrice } from './format.mjs';

export const BONK_INTERVAL_MS = 3 * 60 * 60 * 1000;
const ID = 'BONK-USDT-SWAP';
const BTC = 'BTC-USDT-SWAP';
const BASE = 'https://www.okx.com/api/v5';

export const bonkEnabled = (env = process.env) =>
  String(env?.RADAR_BONK_FOLLOWUP ?? 'off').trim().toLowerCase() === 'on';

const valid = n => Number.isFinite(n) && n > 0;
const pct = (later, earlier) => valid(later) && valid(earlier)
  ? (later / earlier - 1) * 100 : null;
const signed = n => n === null ? '확인 불가' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const slope = (later, earlier) => !valid(later) || !valid(earlier)
  ? '확인 불가' : later > earlier ? '상승' : later < earlier ? '하락' : '횡보';
const kst = ms => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16);

export async function fetchBonkTicker(fetcher = fetch) {
  const body = await jsonRequest(BASE + '/market/ticker?instId=' + ID, { timeoutMs: 8000 }, fetcher);
  const last = Number(body?.data?.[0]?.last);
  return body?.code === '0' && valid(last) ? last : null;
}

export function bonkFollowupMessage({ bonk, btc, ticker, now }) {
  const c1 = bonk.c1h, c4 = bonk.c4h;
  if (!Array.isArray(c1) || c1.length < 25 || !Array.isArray(c4) || c4.length < 2 ||
      !valid(c1.at(-1)?.c) || !valid(c1.at(-4)?.c)) return null;
  const confirmed = c1.at(-1).c;
  const current = valid(ticker) ? ticker : confirmed;
  const reference = c1.at(-4).c; // 3시간 전 확정 1H 종가
  const previous = c1.slice(-25, -1), low = Math.min(...previous.map(x => x.l)),
    high = Math.max(...previous.map(x => x.h));
  if (!valid(low) || !valid(high)) return null;
  const prevVols = previous.slice(-20).map(x => x.q).filter(valid);
  const volBase = prevVols.length >= 10 ? prevVols.reduce((a, b) => a + b, 0) / prevVols.length : null;
  const volume = valid(volBase) && valid(c1.at(-1)?.q)
    ? '최근 확정 1H 거래대금 ×' + (c1.at(-1).q / volBase).toFixed(2) + ' (이전 20봉 대비)'
    : '거래량 확인 불가';
  const btc1 = btc?.status === 'fresh' ? btc.c1h : null;
  const btc4 = btc?.status === 'fresh' ? btc.c4h : null;
  const btcTrend = Array.isArray(btc4) && btc4.length >= 2
    ? slope(btc4.at(-1).c, btc4.at(-2).c) : '확인 불가';
  const btcChange = Array.isArray(btc1) && btc1.length >= 4
    ? signed(pct(btc1.at(-1).c, btc1.at(-4).c)) : '확인 불가';
  const risks = [];
  if (current < low) risks.push('최근 24H 지지 하향 이탈');
  if (current > high) risks.push('최근 24H 저항 상향 돌파');
  if (current >= low && current <= high) {
    if ((current - low) / current <= 0.015) risks.push('지지선 근접: 하향 이탈 주의');
    if ((high - current) / current <= 0.015) risks.push('저항선 근접: 상향 변동 주의');
  }
  if (btcTrend === '하락') risks.push('BTC 직전 4H 약세');
  if (!risks.length) risks.push('주요 구간 이탈 전: 변동성 확대 관찰');
  return [
    '🧭 [RICH RADAR] BONK 보유 관찰 · 3시간 점검',
    '⏱ ' + kst(now) + ' KST · OKX USDT 무기한',
    '💰 ' + (valid(ticker) ? '최근 체결가' : '최근 확정 1H 종가') + ' ' + fmtPrice(current) + ' USDT',
    '📉 1H 확정봉 3시간 변동 ' + signed(pct(confirmed, reference)),
    '📊 1H 최근 3봉 ' + slope(confirmed, reference) + ' · 4H 직전봉 대비 ' + slope(c4.at(-1).c, c4.at(-2).c),
    '📦 지난 24H 구간 지지 ' + fmtPrice(low) + ' / 저항 ' + fmtPrice(high),
    '🔎 ' + volume,
    '₿ BTC 최근 3H ' + btcChange + ' · 직전 4H ' + btcTrend,
    '⚠️ ' + risks.join(' · '),
    '👀 다음 3시간 관찰: ' + fmtPrice(low) + ' 아래 / ' + fmtPrice(high) + ' 위 확정 여부',
    '※ 진입가·롱/숏·레버리지·실제 손익은 계정과 미연동',
    '※ 시장 참고용 · 주문/포지션 변경 없음',
  ].join('\n');
}

// 상태는 state.bonkFollowup 아래에만 저장. 전송 성공 후에만 시각을 갱신한다.
export async function checkBonkFollowup({ state, now = Date.now(), env = process.env,
  send, save = async () => {}, fetcher = fetch, collect = collectOpportunity,
  getTicker = fetchBonkTicker } = {}) {
  if (!bonkEnabled(env)) return { status: 'off' };
  if (!state || typeof state !== 'object' || typeof send !== 'function')
    return { status: 'unavailable' };
  const hour = Math.floor(now / 3600000);
  if (state.quiet?.hour === hour || now < (state.retryAt || 0))
    return { status: 'suppressed', reason: 'state safety guard' };
  const last = state.bonkFollowup?.lastSentAt;
  if (Number.isFinite(last) && now >= last && now - last < BONK_INTERVAL_MS)
    return { status: 'cooldown', nextAt: last + BONK_INTERVAL_MS };
  const result = await collect({ fetcher, now, ids: [BTC, ID], gapMs: 260, budgetMs: 35000 });
  const bonk = result?.coins?.[ID], btc = result?.coins?.[BTC];
  if (!bonk || bonk.status !== 'fresh')
    return { status: 'deferred', reason: bonk?.reason ?? result?.fatal?.message ?? 'BONK confirmed candles unavailable' };
  // 티커 오류는 확정 종가 표기로 안전하게 폴백. 값이 없는 경우 현재가로 가장하지 않는다.
  const ticker = await getTicker(fetcher).catch(() => null);
  const message = bonkFollowupMessage({ bonk, btc, ticker, now });
  if (!message) return { status: 'deferred', reason: 'BONK candle history insufficient' };
  await send(message);
  state.bonkFollowup = { lastSentAt: now, symbol: 'BONKUSDT' };
  await save(state);
  return { status: 'sent', symbol: 'BONKUSDT', lastSentAt: now };
}
