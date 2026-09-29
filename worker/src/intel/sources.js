// Source Adapter 목록. 새 출처(Telegram 공개 채널, X, 커뮤니티 등)는 이 배열에 어댑터 하나를 추가하면 됩니다.
//
// 어댑터 형식:
//   { id, label, type: 'official'|'news'|'social'|'community', intervalMs, maxAgeMs,
//     fetchRaw(fetchImpl)      → 네트워크 응답 원문 (여러 출처를 병렬로 받는 단계, CPU 를 거의 쓰지 않음)
//     parse(raw, now)          → [{ title, url, publishedAt(ms|null), summary, hint? }] (출처마다 순서대로 처리하는 단계) }
// 실패는 예외로 던지면 엔진이 그 출처의 상태(source_health)만 기록합니다. 다른 출처와 전체 Worker 에는 영향이 없습니다.
import { parseFeed } from './feed.js';
import { BINANCE_CATALOGS, binanceListUrl, UPBIT_NOTICE_API, parseBinanceAnnouncements, parseUpbitNotices } from './official.js';

export const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY = 1_500_000;
const UA = 'coin-radar-engine/6a (+https://github.com/j01044459979-prog/coin-radar)';

export async function fetchText(fetchImpl, url, accept) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, redirect: 'follow', headers: { accept, 'user-agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length'));
    if (len > MAX_BODY) throw new Error('응답이 너무 큼');
    return await res.text();
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error(`시간 초과 (${FETCH_TIMEOUT_MS / 1000}초)`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const MIN = 60000;
// 뉴스는 실행(2분)마다 출처 1개씩 돌아가며 수집하므로 3개 출처의 실제 주기는 약 6분입니다 (무료 플랜 CPU 10ms 보호).
const feedSource = (id, label, url) => ({
  id, label, type: 'news', intervalMs: 6 * MIN, maxAgeMs: 3 * 86400000,
  fetchRaw: (fetchImpl) => fetchText(fetchImpl, url, 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5'),
  parse: (raw, now) => parseFeed(raw, now, url),
});

export const SOURCES = [
  {
    id: 'binance', label: 'Binance 공지', type: 'official', intervalMs: 2 * MIN, maxAgeMs: 7 * 86400000,
    // Binance 는 Worker 위치에 따라 451/403 으로 차단될 수 있음(docs/MONITOR.md). 실패해도 source_health 에만 기록됩니다.
    async fetchRaw(fetchImpl) {
      const results = await Promise.allSettled(BINANCE_CATALOGS.map((c) => fetchText(fetchImpl, binanceListUrl(c.id), 'application/json')));
      const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      if (!ok.length) throw results[0].reason;
      return ok;
    },
    parse(raws, now) {
      const lists = [];
      let firstErr = null;
      for (const raw of raws) {
        try { lists.push(parseBinanceAnnouncements(JSON.parse(raw), now)); } catch (e) { firstErr = firstErr || e; }
      }
      if (!lists.length) throw firstErr;
      return lists.flat();
    },
  },
  {
    id: 'upbit', label: 'Upbit 공지', type: 'official', intervalMs: 2 * MIN, maxAgeMs: 7 * 86400000,
    fetchRaw: (fetchImpl) => fetchText(fetchImpl, UPBIT_NOTICE_API, 'application/json'),
    parse: (raw, now) => parseUpbitNotices(JSON.parse(raw), now),
  },
  feedSource('blockmedia', 'BlockMedia', 'https://www.blockmedia.co.kr/feed'),
  feedSource('coindesk', 'CoinDesk', 'https://www.coindesk.com/arc/outboundfeeds/rss'),
  feedSource('cointelegraph', 'Cointelegraph', 'https://cointelegraph.com/rss'),
];

// env.INTEL_DISABLED="coindesk,blockmedia" 처럼 출처를 코드 수정 없이 끌 수 있습니다 (비밀값 아님).
export function enabledSources(env = {}) {
  const off = new Set(String(env.INTEL_DISABLED || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  return SOURCES.filter((s) => !off.has(s.id));
}

// 출처 상태
//  pending : 아직 한 번도 시도하지 않음 (첫 수집 준비 중)
//  ok      : 최근 성공
//  error   : 시도했지만 성공한 적이 없거나(수집 오류) 연속 실패 3회 이상, 또는 오래 성공이 없고 마지막 시도가 오류
//  delayed : 성공 기록이 오래됐는데 오류 기록은 없음 (수집이 멈춘 것으로 보임)
export function healthView(src, h, now) {
  if (!h || !h.last_attempt_at) return { status: 'pending', last_success_at: null, last_attempt_at: null, last_error: null, consecutive_failures: 0, last_item_count: 0 };
  const stale = !h.last_success_at || now - h.last_success_at > src.intervalMs * 3 + 60000;
  const status = !h.last_success_at || h.consecutive_failures >= 3 ? 'error' : stale ? (h.last_error ? 'error' : 'delayed') : 'ok';
  return {
    status,
    last_success_at: h.last_success_at,
    last_attempt_at: h.last_attempt_at,
    last_error: h.last_error,
    consecutive_failures: h.consecutive_failures,
    last_item_count: h.last_item_count,
  };
}
