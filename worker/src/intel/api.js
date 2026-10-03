// /api/intelligence/* (GET 전용). 입력은 모두 검증하고 조회 개수에는 상한을 둡니다.
import { json } from '../response.js';
import * as store from './store.js';
import { enabledSources, disabledSources, healthView } from './sources.js';
import { safeUrl } from './text.js';
import { diagnostics, summarizeSources } from './diag.js';
import { deployInfo } from '../meta.js';
import * as sstore from './social-store.js';
import { buildAttention, bestVerification } from './attention.js';

export const LIMITS = { default: 20, max: 50 };

// 이 표가 라우터(index.js)와 /api/health 의 available_endpoints 의 단일 출처입니다 (라우트가 코드에는 있는데 연결 안 되는 문제 방지).
export const INTEL_ROUTES = [
  { path: '/events', desc: '중요 정보 이벤트(같은 사건은 하나로 묶음, counts·timeline 포함). ?limit=1~50&symbol=BTC&source=official|news&min_importance=0~100' },
  { path: '/latest', desc: '수집된 공지/뉴스 원본 항목 최신순 (같은 쿼리 지원)' },
  { path: '/status', desc: '정보 출처별 수집 상태 + cron_status/collector_status/source_status 진단 + 배포 버전' },
  { path: '/social', desc: 'Telegram 공개 채널 최근 글 요약(excerpt). ?limit=1~50&symbol=SOL&channel=tg-blockmedia' },
  { path: '/community', desc: '국내 커뮤니티 최근 글 요약 (기본 비활성). 같은 쿼리 지원' },
  { path: '/attention', desc: '코인별 소셜 관심도(15분/1시간/6시간/24시간 개수·평소 대비 배수·점수). ?kind=telegram|community|all&limit&symbol' },
];
const CORS = { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=20' }; // 공개 읽기 전용 데이터

const bad = (message) => json({ status: 'error', message }, 400, CORS);

// 쿼리 검증. 잘못된 값은 { error } 로 돌려줍니다 (조용히 무시하지 않음).
export function parseQuery(params) {
  const q = { limit: LIMITS.default, symbol: null, sourceType: 'all', minImportance: 0, channel: null, kind: 'all' };
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
  if (params.has('channel')) {
    const c = params.get('channel').toLowerCase();
    if (!/^[a-z0-9-]{3,40}$/.test(c)) return { error: 'channel 형식이 올바르지 않습니다 (소문자/숫자/- 3~40자, 예: tg-blockmedia)' };
    q.channel = c;
  }
  if (params.has('kind')) {
    const k = params.get('kind');
    if (!['all', 'telegram', 'community'].includes(k)) return { error: 'kind 는 all | telegram | community 중 하나여야 합니다' };
    q.kind = k;
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
    // 소스 종류별 집계와 관측 시각 (관측 순서일 뿐 인과관계가 아님)
    counts: { official: c.officialCount || 0, news: c.newsCount || 0, telegram: c.telegramCount || 0, community: c.communityCount || 0 },
    timeline: { first_seen_at: c.firstSeenAt, official_seen_at: c.officialSeenAt ?? null, social_seen_at: c.socialSeenAt ?? null, community_seen_at: c.communitySeenAt ?? null },
    market: (c.snapshots || []).map((s) => ({ symbol: s.symbol, market: s.market, taken_at: s.taken_at, price_now: s.price_now, price_at_pub: s.price_at_pub, change_pre5: s.change_pre5, change_post5: s.change_post5, change_post15: s.change_post15, change_5m: s.change_5m, change_15m: s.change_15m })),
  };
}

function itemView(r) {
  let symbols = [];
  try { symbols = JSON.parse(r.symbols); } catch { /* 손상된 값은 빈 목록 */ }
  return { id: r.id, source: r.source, source_type: r.source_type, title: r.title, url: safe(r.url), summary: r.summary, published_at: r.published_at, collected_at: r.collected_at, symbols, category: r.category, importance: r.importance, verification: r.verification, cluster_id: r.cluster_id };
}

function socialView(r) {
  const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
  return {
    id: r.id, kind: r.kind, source: r.source, channel: r.channel, url: safe(r.url), title: r.title, excerpt: r.excerpt, published_at: r.published_at, collected_at: r.collected_at,
    symbols: parse(r.symbols, []), category: r.category, links: parse(r.links, []).map((l) => ({ url: safe(l.url), kind: l.kind })).filter((l) => l.url),
    views: r.views, comments: r.comments, verification: r.verification, cluster_id: r.cluster_id,
  };
}

// 심볼별 소셜 관심도 (Telegram 언급량 / 커뮤니티 게시글). 배수는 수집 기간이 충분할 때만 계산 (그 전에는 state: insufficient = 데이터 축적 중)
async function attentionBody(db, q, now) {
  const kinds = q.kind === 'all' ? ['telegram', 'community'] : [q.kind];
  const clusters = new Map((await sstore.recentClustersBrief(db, now)).map((c) => [c.id, c]));
  const out = [];
  const coverage = {};
  for (const kind of kinds) {
    const since = await sstore.coverageStart(db, kind);
    coverage[kind + '_since'] = since;
    const rows = await sstore.mentionAggregates(db, kind, now, q.symbol);
    const attached = await sstore.attachedClusters(db, kind, now);
    const bySym = new Map();
    for (const a of attached) {
      const c = clusters.get(a.cluster_id);
      if (c) (bySym.get(a.symbol) || bySym.set(a.symbol, []).get(a.symbol)).push(c);
    }
    const list = rows.map((r) => {
      const att = buildAttention(kind, r, since ? now - since : 0, now);
      const cs = (bySym.get(r.symbol) || []).sort((x, y) => y.importance - x.importance).slice(0, 3);
      att.clusters = cs.map((c) => ({ id: c.id, title: c.title, verification: c.verification, importance: c.importance, source_type: c.source_type, url: safe(c.url) }));
      att.verification = bestVerification(cs.map((c) => c.verification)); // 실제로 연결된 공식/뉴스 클러스터가 있을 때만 상승, 없으면 unverified
      return att;
    });
    list.sort((a, b) => b.score - a.score || (b.stats['1h'].count - a.stats['1h'].count));
    out.push(...list.slice(0, q.limit));
  }
  return { status: 'ok', now, count: out.length, limit: q.limit, coverage, windows: ['15m', '1h', '6h', '24h'], attention: out };
}

export async function handleIntelligence(path, url, env, now) {
  const db = env && env.DB && typeof env.DB.prepare === 'function' ? env.DB : null;
  const sub = path.slice('/api/intelligence'.length) || '/';
  if (!INTEL_ROUTES.some((r) => r.path === sub)) return json({ status: 'not_found', message: `"${path}" 주소는 없습니다.`, endpoints: INTEL_ROUTES.map((r) => '/api/intelligence' + r.path) }, 404, CORS);
  if (!db) return json({ status: 'degraded', d1: { configured: false }, message: 'D1 이 연결되지 않아 정보를 저장/조회할 수 없습니다', items: [], events: [] }, 200, CORS);
  await store.ensureIntelSchema(db);

  if (sub === '/status') {
    const health = await store.loadHealth(db);
    const sources = enabledSources(env).map((s) => ({ id: s.id, label: s.label, type: s.type, interval_seconds: s.intervalMs / 1000, ...healthView(s, health.get(s.id), now) }));
    const disabledDetails = disabledSources(env);
    const disabled = disabledDetails.map((d) => d.id);
    const last = Math.max(0, ...sources.map((s) => s.last_attempt_at || 0));
    const summary = summarizeSources(sources);
    let diag = null;
    try {
      diag = await diagnostics(db, now, summary);
    } catch (err) {
      diag = { code: 'unknown', hint: '진단 정보를 읽지 못했습니다: ' + String((err && err.message) || err).slice(0, 100) };
    }
    // 전체 status: Cron · Collector · Source 가 모두 정상일 때만 ok (Cron 이 돌아도 출처가 오류면 degraded)
    const overall = diag.code === 'ok' ? 'ok' : 'degraded';
    return json({ status: overall, now, ...deployInfo(env), last_run_at: last || null, diagnostics: diag, source_status: summary, sources, disabled, disabled_sources: disabledDetails, retention_days: { items: store.RETENTION.itemsDays, clusters: store.RETENTION.clustersDays } }, 200, CORS);
  }

  const q = parseQuery(url.searchParams);
  if (q.error) return bad(q.error);
  if (sub === '/social' || sub === '/community') {
    const rows = await sstore.querySocialItems(db, { kind: sub === '/social' ? 'telegram' : 'community', limit: q.limit, symbol: q.symbol, source: q.channel });
    return json({ status: 'ok', count: rows.length, limit: q.limit, items: rows.map(socialView) }, 200, CORS);
  }
  if (sub === '/attention') return json(await attentionBody(db, q, now), 200, CORS);
  if (sub === '/latest') {
    const items = (await store.queryItems(db, q)).map(itemView);
    return json({ status: 'ok', count: items.length, limit: q.limit, items }, 200, CORS);
  }
  const events = (await store.queryEvents(db, q)).map(eventView);
  return json({ status: 'ok', count: events.length, limit: q.limit, now, events }, 200, CORS);
}
