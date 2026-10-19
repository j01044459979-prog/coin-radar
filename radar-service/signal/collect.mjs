// 신호용 15분봉 수집(OKX 공개 API, 키·주문 없음). 확정(confirm=1) 봉만 쓰고, 마지막 봉이 방금 마감한 15분봉인지 확인한다.
// 1H·4H 데이터는 기존 collectOpportunity를 그대로 쓴다(검증·제한 응답 처리 동일).
import { jsonRequest, RESTRICTED } from '../service.mjs';
import { parseCandles } from '../opportunity/collect.mjs';
import { M15 } from './evaluate.mjs';

const BASE = 'https://www.okx.com/api/v5', pause = ms => new Promise(r => setTimeout(r, ms));
export const LIMIT15 = 120;

// 'fresh' | 'pending'(방금 마감, 확정 대기) | 'stale'
export function freshness15(c15, now, graceMs = 180000) {
  const slot = Math.floor(now / M15) * M15, expected = slot - M15, last = c15.at(-1)?.t;
  if (last === undefined) return { status: 'stale', reason: '15분봉 없음' };
  if (last === expected) return { status: 'fresh' };
  return last === expected - M15 && now - slot < graceMs ? { status: 'pending', reason: '직전 15분봉 확정 대기' } : { status: 'stale', reason: `15분봉이 오래됨(마지막 ${new Date(last).toISOString().slice(0, 16)}Z)` };
}

export async function collect15({ fetcher = fetch, now, ids, gapMs = 260, budgetMs = 30000, shouldStop = () => false } = {}) {
  const started = Date.now(), out = { coins: {}, stopped: null, calls: 0 };
  for (const id of ids) {
    if (shouldStop() || Date.now() - started > budgetMs) { out.coins[id] = { status: 'pending', reason: '수집 시간 예산 초과(다음 실행에서 재시도)' }; continue; }
    if (out.stopped) { out.coins[id] = { status: 'pending', reason: '제한 응답으로 중단' }; continue; }
    try {
      out.calls++;
      const body = await jsonRequest(`${BASE}/market/candles?instId=${id}&bar=15m&limit=${LIMIT15}`, {}, fetcher);
      if (gapMs) await pause(gapMs);
      if (body?.code !== '0' || !Array.isArray(body.data)) throw new Error(`15분봉 응답 오류(code ${body?.code})`);
      const { candles, notes } = parseCandles(body.data, M15), fr = freshness15(candles, now);
      out.coins[id] = { status: fr.status, reason: fr.reason ?? null, c15: candles, notes };
    } catch (error) {
      if (RESTRICTED.includes(error.status)) { out.stopped = { status: error.status, retryAfter: error.retryAfter || 0, at: id }; out.coins[id] = { status: 'pending', reason: '제한 응답' }; }
      else out.coins[id] = { status: 'error', reason: String(error.message).slice(0, 80) };
    }
  }
  return out;
}
