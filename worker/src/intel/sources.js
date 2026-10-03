// Source Adapter 목록. 새 출처(Telegram 공개 채널, X, 커뮤니티 등)는 이 배열에 어댑터 하나를 추가하면 됩니다.
//
// 어댑터 형식:
//   { id, label, type: 'official'|'news'|'social'|'community', intervalMs, maxAgeMs,
//     fetchRaw(fetchImpl)      → 네트워크 응답 원문 (여러 출처를 병렬로 받는 단계, CPU 를 거의 쓰지 않음)
//     scan(raw, now)           → { keys, build(skip, limit) } 항목(공식/뉴스): 키만 싸게 훑고, 이미 저장된 항목(skip)은 build 에서 제외
//     (소셜은 peekIds + parse(raw, now, { skip, limit }))
//   cost: 실행당 CPU 예산에서 차지하는 '평상시(새 항목 없음)' 비용 단위, intervalMs: 목표 수집 주기 }
// 실패는 예외로 던지면 엔진이 그 출처의 상태(source_health)만 기록합니다. 다른 출처와 전체 Worker 에는 영향이 없습니다.
import { parseFeed, scanFeed } from './feed.js';
import { TELEGRAM_CHANNELS, TELEGRAM_PREVIEW, parseTelegramPreview, peekMessageIds, MAX_MESSAGES } from './telegram.js';
import { COMMUNITY_SOURCES, parseCommunity } from './community.js';
import { safeUrl } from './text.js';
import { BINANCE_CATALOGS, binanceListUrl, UPBIT_NOTICE_API, scanBinance, scanUpbit } from './official.js';

export const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY = 1_500_000;
const UA = 'coin-radar-engine/6a (+https://github.com/j01044459979-prog/coin-radar)';

// opts.allowHosts: 최종 응답 주소(리다이렉트 포함)의 호스트가 이 목록에 있어야 함 (예상 밖 호스트로의 이동 차단)
export async function fetchText(fetchImpl, url, accept, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, redirect: 'follow', headers: { accept, 'user-agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length'));
    if (len > MAX_BODY) throw new Error('응답이 너무 큼');
    if (opts.allowHosts && res.url) {
      let h = '';
      try { h = new URL(res.url).hostname.toLowerCase(); } catch { /* 주소를 알 수 없으면 아래에서 거부 */ }
      if (!opts.allowHosts.some((a) => h === a || h.endsWith('.' + a))) throw new Error('예상 밖 호스트로 이동: ' + (h || '?'));
    }
    const body = await res.text();
    if (body.length > MAX_BODY) throw new Error('응답이 너무 큼');
    return body;
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error(`시간 초과 (${FETCH_TIMEOUT_MS / 1000}초)`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const MIN = 60000;
// 뉴스 RSS: 실행마다 예산 안에서 돌아가며 수집 (무료 플랜 CPU 10ms 보호). 평상시 비용 = 링크 키 훑기 + D1 확인.
const feedSource = (id, label, url) => ({
  id, label, type: 'news', intervalMs: 12 * MIN, maxAgeMs: 3 * 86400000, cost: 2,
  fetchRaw: (fetchImpl) => fetchText(fetchImpl, url, 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5'),
  scan: (raw, now, o) => scanFeed(raw, now, url, o && o.maxAgeMs),
  parse: (raw, now) => parseFeed(raw, now, url), // 호환용 (전체 파싱)
});

export const SOURCES = [
  {
    id: 'binance', label: 'Binance 공지', type: 'official', intervalMs: 2 * MIN, maxAgeMs: 7 * 86400000, cost: 1,
    // Binance 는 Worker 위치에 따라 451/403 으로 차단될 수 있음(docs/MONITOR.md). 실패해도 source_health 에만 기록됩니다.
    async fetchRaw(fetchImpl) {
      const results = await Promise.allSettled(BINANCE_CATALOGS.map((c) => fetchText(fetchImpl, binanceListUrl(c.id), 'application/json')));
      const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      if (!ok.length) throw results[0].reason;
      return ok;
    },
    scan: (raws, now, o) => scanBinance(raws, now, o && o.maxAgeMs),
  },
  {
    id: 'upbit', label: 'Upbit 공지', type: 'official', intervalMs: 2 * MIN, maxAgeMs: 7 * 86400000, cost: 1,
    fetchRaw: (fetchImpl) => fetchText(fetchImpl, UPBIT_NOTICE_API, 'application/json'),
    scan: (raw, now, o) => scanUpbit(raw, now, o && o.maxAgeMs),
  },
  feedSource('blockmedia', 'BlockMedia', 'https://www.blockmedia.co.kr/feed'),
  feedSource('coindesk', 'CoinDesk', 'https://www.coindesk.com/arc/outboundfeeds/rss'),
  feedSource('cointelegraph', 'Cointelegraph', 'https://cointelegraph.com/rss'),
  // ── Phase 6B: Telegram 공개 채널 (채널 목록은 telegram.js 의 TELEGRAM_CHANNELS) ──
  ...TELEGRAM_CHANNELS.map((ch) => ({
    id: ch.id, label: `Telegram · ${ch.name}`, type: 'social', kind: 'telegram', channel: ch.name, pipeline: 'social', reliabilityTier: ch.reliabilityTier,
    enabled: ch.enabled, intervalMs: 10 * MIN, maxAgeMs: 14 * 86400000, cost: 1, // 보관 기간(14일)과 같게: 저장된 글은 다시 파싱하지 않음
    fetchRaw: (fetchImpl) => fetchText(fetchImpl, TELEGRAM_PREVIEW(ch.username), 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', { allowHosts: ['t.me'] }),
    peekIds: (raw) => peekMessageIds(raw, ch.username),
    parse: (raw, now, o) => parseTelegramPreview(raw, ch.username, now, { skip: o && o.skip, limit: MAX_MESSAGES, minTime: now - 14 * 86400000 }),
  })),
  // ── Phase 6B: 국내 커뮤니티 (기본 비활성: INTEL_ENABLE=coinpan + COINPAN_BOARDS) ──
  ...COMMUNITY_SOURCES.map((c) => ({
    id: c.id, label: `${c.name} (국내 커뮤니티)`, type: 'community', kind: 'community', channel: c.name, pipeline: 'social', reliabilityTier: c.reliabilityTier,
    enabled: c.enabled, disabledReason: c.reason, intervalMs: 12 * MIN, maxAgeMs: 7 * 86400000, cost: 2,
    async fetchRaw(fetchImpl, env) {
      const host = new URL(c.site).hostname.replace(/^www\./, '');
      const boards = String((env && env.COINPAN_BOARDS) || '').split(',').map((u) => safeUrl(u.trim())).filter((u) => { const bh = u && new URL(u).hostname.toLowerCase(); return bh && (bh === host || bh === 'www.' + host || bh.endsWith('.' + host)); }).slice(0, 3); // 'notcoinpan.com' 같은 비슷한 호스트 거부
      if (!boards.length) throw new Error('COINPAN_BOARDS 미설정 (게시판 RSS/목록 URL 필요)');
      const raws = [];
      for (const b of boards) raws.push(await fetchText(fetchImpl, b, 'application/rss+xml, text/html;q=0.8, */*;q=0.5', { allowHosts: [host] }));
      return { boards, raws };
    },
    parse: (raw, now) => parseCommunity(raw.raws, raw.boards, now),
  })),
];

// env.INTEL_DISABLED="coindesk,tg-emperorcoin" 처럼 출처를 코드 수정 없이 끌 수 있고,
// env.INTEL_ENABLE="coinpan" 으로 기본 비활성 출처를 켤 수 있습니다 (둘 다 비밀값 아님).
const list = (v) => new Set(String(v || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
export function enabledSources(env = {}) {
  const off = list(env.INTEL_DISABLED);
  const on = list(env.INTEL_ENABLE);
  return SOURCES.filter((s) => !off.has(s.id) && (s.enabled !== false || on.has(s.id)));
}
// 비활성 출처와 이유
export function disabledSources(env = {}) {
  const active = new Set(enabledSources(env).map((s) => s.id));
  const off = list(env.INTEL_DISABLED);
  return SOURCES.filter((s) => !active.has(s.id)).map((s) => ({ id: s.id, label: s.label, reason: off.has(s.id) ? 'INTEL_DISABLED 로 꺼짐' : s.disabledReason || '비활성' }));
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
