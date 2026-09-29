// /api/intelligence/* (GET 전용). 입력은 모두 검증하고 조회 개수에는 상한을 둡니다.
import { json } from '../response.js';
import * as store from './store.js';
import { SOURCES, enabledSources, healthView } from './sources.js';
import { safeUrl } from './text.js';

export const LIMITS = { default: 20, max: 50 };
const CORS = { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=20' }; // 공개 읽기 전용 데이터

const bad = (message) => json({ status: 'error', message }, 400, CORS);

// 쿼리 검증. 잘못된 값은 { error } 로 돌려줍니다 (조용히 무시하지 않음).
export function parseQuery(params) {
  const q = { limit: LIMITS.default, symbol: null, sourceType: 'all', minImportance: 0 };
  if (params.has('limit')) {
    const raw = params.get('limit');
    if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1) return { error: `limit 는 1~${LIMITS.max} 의 정수여야 합니다` };
    q.limit = Math.min(Number(raw), LIMITS.max);
  }
  if (params.has('symbol')) {
    const s = params.get('symbol').toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(s)) return { error: 'symbol 형식이 올바르지 않습니다 (영문 대문자/숫자 2~10자)' };
    q.symbol = s;
  }
  if (params.has('source')) {
    const s = params.get('source');
    if (!['all', 'official', 'news'].includes(s)) return { error: 'source 는 all | official | news 중 하나여야 합니다' };
    q.sourceType = s;
  }
  if (params.has('min_importance')) {
    const raw = params.get('min_importance');
    if (!/^\d{1,3}$/.test(raw) || Number(raw) > 100) return { error: 'min_importance 는 0~100 의 정수여야 합니다' };
    q.minImportance = Number(raw);
  }
  return q;
}

const safe = (u) => safeUrl(u) || null;

export function eventView(c) {
  return {
    id: c.id, title: c.title, url: safe(c.url), category: c.category, symbols: c.symbols, importance: c.importance, importance_base: c.importanceBase, reaction_bonus: c.reactionBonus,
    verification: c.verification, source: c.source, source_type: c.sourceType, sources: c.sources.map((s) => s.source), item_count: c.itemCount, source_count: c.sourceCount,
    published_at: c.publishedKnown ? c.eventTime : null, event_time: c.eventTime, first_seen_at: c.firstSeenAt, updated_at: c.updatedAt,
    market: (c.snapshots || []).map((s) => ({ symbol: s.symbol, market: s.market, taken_at: s.taken_at, price_now: s.price_now, price_at_pub: s.price_at_pub, change_pre5: s.change_pre5, change_post5: s.change_post5, change_post15: s.change_post15, change_5m: s.change_5m, change_15m: s.change_15m })),
  };
}

function itemView(r) {
  let symbols = [];
  try { symbols = JSON.parse(r.symbols); } catch { /* 손상된 값은 빈 목록 */ }
  return { id: r.id, source: r.source, source_type: r.source_type, title: r.title, url: safe(r.url), summary: r.summary, published_at: r.published_at, collected_at: r.collected_at, symbols, category: r.category, importance: r.importance, verification: r.verification, cluster_id: r.cluster_id };
}

export async function handleIntelligence(path, url, env, now) {
  const db = env && env.DB && typeof env.DB.prepare === 'function' ? env.DB : null;
  const sub = path.slice('/api/intelligence'.length) || '/';
  if (!['/latest', '/events', '/status'].includes(sub)) return json({ status: 'not_found', message: `"${path}" 주소는 없습니다.`, endpoints: ['/api/intelligence/latest', '/api/intelligence/events', '/api/intelligence/status'] }, 404, CORS);
  if (!db) return json({ status: 'degraded', d1: { configured: false }, message: 'D1 이 연결되지 않아 정보를 저장/조회할 수 없습니다', items: [], events: [] }, 200, CORS);
  await store.ensureIntelSchema(db);

  if (sub === '/status') {
    const health = await store.loadHealth(db);
    const sources = enabledSources(env).map((s) => ({ id: s.id, label: s.label, type: s.type, interval_seconds: s.intervalMs / 1000, ...healthView(s, health.get(s.id), now) }));
    const disabled = SOURCES.filter((s) => !sources.some((x) => x.id === s.id)).map((s) => s.id);
    const last = Math.max(0, ...sources.map((s) => s.last_attempt_at || 0));
    return json({ status: sources.some((s) => s.status === 'ok') ? 'ok' : 'degraded', now, last_run_at: last || null, sources, disabled, retention_days: { items: store.RETENTION.itemsDays, clusters: store.RETENTION.clustersDays } }, 200, CORS);
  }

  const q = parseQuery(url.searchParams);
  if (q.error) return bad(q.error);
  if (sub === '/latest') {
    const items = (await store.queryItems(db, q)).map(itemView);
    return json({ status: 'ok', count: items.length, limit: q.limit, items }, 200, CORS);
  }
  const events = (await store.queryEvents(db, q)).map(eventView);
  return json({ status: 'ok', count: events.length, limit: q.limit, now, events }, 200, CORS);
}
