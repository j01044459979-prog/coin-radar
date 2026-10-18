// 기회 포착 레이더 데이터 수집(OKX 공개 API, 키·주문 없음) + 오탐 방지 검증.
//  · 확정(confirm=1) 캔들만 사용한다(진행 중인 봉은 버린다).
//  · 시각 정렬·OHLC 정합성·연속성(누락 봉)을 검사하고, 누락이 있으면 가장 최근의 연속 구간만 쓴다.
//  · 마지막 확정 봉이 기대한 봉(직전에 마감한 1H/4H)이 아니면 fresh가 아니다: 방금 마감해 아직 확정 전이면 pending, 그 밖에는 stale(분석 제외).
import { jsonRequest, RESTRICTED } from '../service.mjs';
import { scanMarket } from '../universe.mjs';
import { parseCandleVolume } from '../volume.mjs';
import { H1, H4 } from './indicators.mjs';

const BASE = 'https://www.okx.com/api/v5';
export const LIMITS = Object.freeze({ c1h: 150, c4h: 300, minTurnover: 1000000, defaultTop: 20, maxTop: 30, graceMs: 30 * 60000 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function data(body, what) {
  if (body?.code === '50011') throw Object.assign(new Error(`${what} 요청 한도 초과(code 50011)`), { status: 429 });
  if (!body || body.code !== '0' || !Array.isArray(body.data)) throw new Error(`${what} 응답 오류(code ${body?.code})`);
  return body.data;
}

// OKX 캔들 행 → 확정 캔들(오래된 순). 문제 있는 행이 하나라도 있으면 그 이전 구간은 버리고 최근 연속 구간만 남긴다.
export function parseCandles(rows, stepMs) {
  const notes = [];
  const parsed = [];
  for (const r of rows) {
    if (r?.[8] !== '1') continue;                                                    // 미확정(진행 중) 봉 제외
    const t = Number(r[0]), o = Number(r[1]), h = Number(r[2]), l = Number(r[3]), c = Number(r[4]);
    const ok = [t, o, h, l, c].every(Number.isFinite) && t % stepMs === 0 && l > 0 && h >= Math.max(o, c, l) && l <= Math.min(o, c);
    if (!ok) { notes.push('비정상 캔들'); parsed.push(null); continue; }
    parsed.push({ t, o, h, l, c, q: parseCandleVolume(r, l, h).q });
  }
  const asc = parsed.reverse();                                                       // OKX는 최신이 먼저 → 오래된 순으로
  let start = 0;
  for (let k = 0; k < asc.length; k++) {
    const bad = asc[k] === null || (k > 0 && asc[k - 1] !== null && asc[k].t - asc[k - 1].t !== stepMs);
    if (bad) { if (asc[k] !== null && k > 0 && asc[k - 1] !== null) notes.push('누락 봉'); start = asc[k] === null ? k + 1 : k; }
  }
  const candles = asc.slice(start).filter(Boolean);
  // 중복 시각 방지
  for (let k = 1; k < candles.length; k++) if (candles[k].t <= candles[k - 1].t) return { candles: [], notes: [...notes, '시각 중복/역순'] };
  return { candles, notes: [...new Set(notes)] };
}

// 마지막 확정 봉이 기대한 봉인지: 'fresh' | 'pending'(방금 마감, 확정 대기) | 'stale'
export function freshness(c1h, c4h, now, graceMs = LIMITS.graceMs) {
  const hourStart = Math.floor(now / H1) * H1, exp1 = hourStart - H1, last1 = c1h.at(-1)?.t, last4 = c4h.at(-1)?.t;
  if (last1 === undefined || last4 === undefined) return { status: 'stale', reason: '확정 캔들 없음' };
  const grace = now - hourStart < graceMs;
  if (last1 !== exp1) return last1 === exp1 - H1 && grace ? { status: 'pending', reason: '직전 1H 봉 확정 대기' } : { status: 'stale', reason: `1H 데이터가 오래됨(마지막 ${new Date(last1).toISOString().slice(0, 16)}Z)` };
  const need4 = Math.floor((last1 + H1) / H4) * H4 - H4;                               // 신호 봉 마감 시각까지 마감된 마지막 4H 봉
  if (last4 >= need4) return { status: 'fresh' };
  return last4 === need4 - H4 && grace ? { status: 'pending', reason: '직전 4H 봉 확정 대기' } : { status: 'stale', reason: `4H 데이터가 오래됨(마지막 ${new Date(last4).toISOString().slice(0, 16)}Z)` };
}

// 수집. ids가 있으면 그 종목만(확정 대기 재시도), 없으면 시세 상위 topN. 반환:
//  { universe, coins: { [instId]: { symbol, status: 'fresh'|'pending'|'stale'|'error', c1h, c4h, reason, notes } }, btc4h, stopped, calls, fatal }
export async function collectOpportunity({ fetcher = fetch, now, ids = null, topN = LIMITS.defaultTop, budgetMs = 60000, gapMs = 260 } = {}) {
  const started = Date.now(), out = { universe: ids, coins: {}, btc4h: null, stopped: null, calls: 0, fatal: null };
  const get = async path => { out.calls++; const body = await jsonRequest(BASE + path, {}, fetcher); if (gapMs) await pause(gapMs); return body; };
  try {
    if (!ids) {
      const instruments = data(await get('/public/instruments?instType=SWAP'), '계약 목록'), tickers = data(await get('/market/tickers?instType=SWAP'), '티커');
      const market = scanMarket({ instruments, tickers });
      const liquid = market.eligible.filter(e => e.turnover >= LIMITS.minTurnover).sort((a, b) => b.turnover - a.turnover || (a.instId < b.instId ? -1 : 1));
      const n = Math.max(1, Math.min(LIMITS.maxTop, Number.isInteger(topN) ? topN : LIMITS.defaultTop));
      out.universe = [...new Set(['BTC-USDT-SWAP', ...liquid.map(e => e.instId)])].slice(0, n);
    }
  } catch (error) { out.fatal = { message: error.message, status: error.status ?? null, retryAfter: error.retryAfter ?? 0 }; return out; }
  const fetchList = [...new Set(['BTC-USDT-SWAP', ...out.universe])];                // BTC는 맥락용으로 항상 필요
  for (const id of fetchList) {
    if (Date.now() - started > budgetMs) { if (out.universe.includes(id)) out.coins[id] = { symbol: id.replace(/-USDT-SWAP$/, 'USDT'), status: 'pending', reason: '수집 시간 예산 초과(다음 실행에서 재시도)' }; continue; }
    const symbol = id.replace(/-USDT-SWAP$/, 'USDT');
    try {
      const r1 = data(await get(`/market/candles?instId=${id}&bar=1H&limit=${LIMITS.c1h}`), '1H 캔들');
      const r4 = data(await get(`/market/candles?instId=${id}&bar=4H&limit=${LIMITS.c4h}`), '4H 캔들');
      const a = parseCandles(r1, H1), b = parseCandles(r4, H4);
      const fr = freshness(a.candles, b.candles, now);
      if (id === 'BTC-USDT-SWAP' && fr.status === 'fresh') out.btc4h = b.candles;
      if (out.universe.includes(id)) out.coins[id] = { symbol, status: fr.status, reason: fr.reason ?? null, c1h: a.candles, c4h: b.candles, notes: [...a.notes, ...b.notes] };
    } catch (error) {
      if (RESTRICTED.includes(error.status)) { out.stopped = { status: error.status, retryAfter: error.retryAfter || 0, at: id }; break; }     // 제한 응답이면 즉시 중단(남은 종목은 다음에)
      if (out.universe.includes(id)) out.coins[id] = { symbol, status: 'error', reason: String(error.message).slice(0, 80) };
    }
  }
  for (const id of out.universe) if (!out.coins[id] && out.stopped) out.coins[id] = { symbol: id.replace(/-USDT-SWAP$/, 'USDT'), status: 'pending', reason: '제한 응답으로 중단(대기 후 재시도)' };
  return out;
}
