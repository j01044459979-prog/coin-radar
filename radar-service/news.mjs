// 뉴스·공지 연결. 기존 worker/src/intel 의 순수 파서·분류기·심볼 인식기를 재사용한다(Worker 코드는 수정하지 않음).
// Binance 공지는 지역 차단이라 제외. 실패는 격리되어 가격 분석/Telegram 보고를 막지 않는다.
import { enabledSources } from '../worker/src/intel/sources.js';
import { detectSymbols } from '../worker/src/intel/symbols.js';
import { detectCategory } from '../worker/src/intel/classify.js';
import { urlKey } from '../worker/src/intel/text.js';

export const REFRESH_MS = 55 * 60000;      // 정상 시 갱신 주기
export const RETRY_MS = 15 * 60000;        // 실패 시 재시도 간격
export const MAX_AGE_MS = 24 * 3600000;    // 이슈로 인정하는 최대 경과 시간
const KEEP_MS = 48 * 3600000, MAX_ITEMS = 80;

export const newsSources = () => enabledSources({ INTEL_DISABLED: 'binance' });
export const needsRefresh = (state, now) => {
  const n = state.news;
  return !n || now - (n.triedAt || 0) >= (n.status === 'ok' ? REFRESH_MS : RETRY_MS);
};

const clean = (s, n = 140) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export async function refreshNews(state, now, { fetcher = fetch, sources = newsSources() } = {}) {
  const prev = state.news;
  const health = {};
  const settled = await Promise.allSettled(sources.map(async src => {
    const raw = await src.fetchRaw(fetcher);
    return { src, parsed: src.parse(raw, now) };
  }));
  const items = [];
  settled.forEach((r, i) => {
    const src = sources[i];
    if (r.status !== 'fulfilled') { health[src.id] = { ok: false, error: clean(r.reason?.message, 60) }; return; }
    health[src.id] = { ok: true, count: r.value.parsed.length };
    for (const it of r.value.parsed) {
      const at = Number(it.publishedAt);
      // 게시 시각이 없거나 미래인 항목은 시점을 확인할 수 없어 '미확인'으로 취급해 저장하지 않는다.
      if (!it.title || !it.url || !Number.isFinite(at) || at > now + 10 * 60000 || now - at > KEEP_MS) continue;
      items.push({ title: clean(it.title), url: it.url, publishedAt: at, source: src.id, label: src.label,
        kind: src.type === 'official' ? '공식' : '보도', symbols: detectSymbols(it.title), category: detectCategory(it.title, src.type, it.hint) });
    }
  });
  const anyOk = Object.values(health).some(h => h.ok);
  if (!anyOk) {
    state.news = { ...(prev || {}), triedAt: now, status: prev?.items?.length ? 'stale' : 'unavailable', health };
    return state.news;
  }
  const seen = new Set(), merged = [];
  for (const it of [...items, ...(prev?.items || [])].sort((a, b) => b.publishedAt - a.publishedAt)) {
    const keys = [urlKey(it.url), it.title.toLowerCase().replace(/[^a-z0-9가-힣]+/g, ' ').trim()];
    if (keys.some(k => seen.has(k))) continue;
    keys.forEach(k => seen.add(k));
    if (now - it.publishedAt <= KEEP_MS) merged.push(it);
  }
  state.news = { checkedAt: now, triedAt: now, status: 'ok', health, items: merged.slice(0, MAX_ITEMS) };
  return state.news;
}

// 후보 종목별 관련 이슈(최근 24시간)와 시장 전반 이슈. 가격 변동의 '원인'으로 단정하지 않는다.
export function relevantNews(news, bases, now, { perSymbol = 2, market = 2 } = {}) {
  const fresh = (news?.items || []).filter(i => now - i.publishedAt <= MAX_AGE_MS && i.publishedAt <= now + 10 * 60000);
  const bySymbol = {};
  const used = new Set();
  for (const b of bases) {
    bySymbol[b] = fresh.filter(i => i.symbols.includes(b)).slice(0, perSymbol);
    bySymbol[b].forEach(i => used.add(i.url));
  }
  const mkt = fresh.filter(i => !used.has(i.url) && (i.symbols.some(s => s === 'BTC' || s === 'ETH') || ['regulation', 'security'].includes(i.category))).slice(0, market);
  return { bySymbol, market: mkt };
}
