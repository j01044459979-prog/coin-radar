// Telegram / 커뮤니티 항목 분석·저장·이벤트 연결 (Phase 6B). 기존 Intelligence 엔진(클러스터/심볼/분류)을 재사용합니다.
//
// 원칙
//  - Telegram/커뮤니티만 있으면 '미확인'. 공식/뉴스 클러스터와 실제로 연결될 때만 그 클러스터의 검증 상태를 따라갑니다.
//  - 글에 "공식"이라는 단어가 있어도 검증에 영향 없음. 링크 도메인이 공식 도메인이어도, 같은 URL 이 수집된 공식 항목과 일치할 때만 승격.
//  - 연결은 '같은 사건일 가능성' 이며 인과관계가 아닙니다. 소셜 항목은 클러스터의 중요도/출처 수(독립 확인)를 올리지 않고 집계(telegram_count 등)만 올립니다.
import { detectSymbols } from './symbols.js';
import { detectCategory, baseImportance, verificationOf } from './classify.js';
import { titleTokens } from './cluster.js';
import * as sstore from './social-store.js';
import { urlKey } from './text.js';

export const MAX_NEW_PER_RUN = 8; // 채널 1회 실행에서 새로 처리할 최대 메시지 (CPU 보호, 남은 것은 다음 실행에서)
const CATEGORY_WINDOW_MS = 3 * 3600000; // 같은 코인 + 같은 카테고리(일반 제외) + 3시간 이내
const TOKEN_WINDOW_MS = 24 * 3600000; // 핵심 단어 3개 이상 공통 + 24시간 이내

// 원본 항목 → 저장용 행
export function enrichSocial(raw, src, now, dict) {
  const text = [raw.title, raw.text, raw.excerpt].filter(Boolean).join(' ').slice(0, 600);
  if (!text) return null;
  const symbols = detectSymbols(text, dict, { social: true });
  const category = detectCategory(text, 'news');
  const eventTime = raw.publishedAt || now;
  return {
    kind: src.kind, source: src.id, channel: src.channel, messageId: String(raw.messageId), url: raw.url, title: raw.title || null,
    excerpt: (raw.excerpt || raw.text || raw.title || '').slice(0, 280), publishedAt: raw.publishedAt || null, collectedAt: now, eventTime,
    symbols, category, links: raw.links || [], views: raw.views ?? null, comments: raw.comments ?? null,
    verification: 'unverified', clusterId: null, importance: baseImportance({ sourceType: src.type, category, symbols }), _text: text,
  };
}

// 같은 사건일 가능성: 같은 코인이 있어야 하고, (카테고리 일치 + 3시간) 또는 (핵심 단어 3개 이상 + 24시간)
export function matchesSocial(item, cluster) {
  if (!item.symbols.length || !cluster.symbols.some((s) => item.symbols.includes(s))) return false;
  const dt = Math.min(Math.abs(item.eventTime - cluster.eventTime), Math.abs(item.eventTime - cluster.lastTime));
  if (item.category !== 'general' && item.category === cluster.category && dt <= CATEGORY_WINDOW_MS) return true;
  if (dt > TOKEN_WINDOW_MS) return false;
  const symTokens = new Set(item.symbols.map((s) => s.toLowerCase()));
  const tb = titleTokens(cluster.title);
  let common = 0;
  for (const t of titleTokens(item._text.slice(0, 200))) if (tb.has(t) && !symTokens.has(t)) common += 1;
  return common >= 3;
}

// 링크로 연결(가장 확실) → 같은 사건 규칙 순. 공식/뉴스 클러스터만 대상.
export function pickCluster(item, clusters, linkMap) {
  for (const l of item.links) {
    const id = linkMap.get(l.key);
    const c = id && clusters.find((x) => x.id === id);
    if (c) return { cluster: c, how: 'link' };
  }
  let best = null;
  for (const c of clusters) {
    if (!matchesSocial(item, c)) continue;
    const d = Math.min(Math.abs(item.eventTime - c.eventTime), Math.abs(item.eventTime - c.lastTime));
    if (!best || d < best.d) best = { cluster: c, d };
  }
  return best ? { cluster: best.cluster, how: 'text' } : null;
}

// 메시지의 검증 상태 = 연결된 클러스터의 검증 (연결이 없으면 미확인)
export const verificationFromCluster = (c) => (c ? verificationOf(c.sources) : 'unverified');

// 클러스터 집계 갱신 (중요도/출처 수/검증은 건드리지 않음)
export function attachToCluster(c, item, now) {
  if (item.kind === 'telegram') {
    c.telegramCount = (c.telegramCount || 0) + 1;
    if (item.publishedAt) c.socialSeenAt = c.socialSeenAt ? Math.min(c.socialSeenAt, item.publishedAt) : item.publishedAt;
  } else {
    c.communityCount = (c.communityCount || 0) + 1;
    if (item.publishedAt) c.communitySeenAt = c.communitySeenAt ? Math.min(c.communitySeenAt, item.publishedAt) : item.publishedAt;
  }
  c.updatedAt = now;
}

// 어댑터가 돌려준 항목들을 처리. ctx: { now, dict, clusters, touched }. 반환: { fetched, new, linked }
export async function ingestSocial(db, src, items, ctx) {
  const { now, dict, clusters, touched } = ctx;
  const known = await sstore.existingMessageIds(db, src.id, items.map((i) => String(i.messageId)));
  const fresh = items
    .filter((i) => !known.has(String(i.messageId)) && (!i.publishedAt || now - i.publishedAt <= src.maxAgeMs))
    .sort((a, b) => (a.publishedAt || now) - (b.publishedAt || now))
    .slice(-MAX_NEW_PER_RUN);
  const rows = fresh.map((r) => enrichSocial(r, src, now, dict)).filter(Boolean);
  // 공식/뉴스 도메인 링크만 실제 수집 항목과 대조 (같은 URL 이 이미 수집돼 있어야 연결)
  const keys = [...new Set(rows.flatMap((r) => r.links.filter((l) => l.kind === 'official_domain' || l.kind === 'news_domain').map((l) => l.key)))];
  const linkMap = keys.length ? await sstore.clustersByUrlKeys(db, keys) : new Map();
  let linked = 0;
  for (const row of rows) {
    const hit = pickCluster(row, clusters, linkMap);
    if (hit) {
      row.clusterId = hit.cluster.id;
      row.verification = verificationFromCluster(hit.cluster);
      attachToCluster(hit.cluster, row, now);
      touched.add(hit.cluster);
      linked += 1;
    }
  }
  if (rows.length) await sstore.saveSocialItems(db, rows);
  return { fetched: items.length, new: rows.length, linked };
}

// 공식/뉴스 클러스터가 '나중에' 생기거나 바뀐 경우를 반영 (Telegram 이 공식 공지보다 먼저 올라온 흐름 포함):
//  1) 아직 연결되지 않은 최근 24시간 소셜 글 중 같은 사건으로 보이는 것을 그 클러스터에 연결 (+검증 상태 승계)
//  2) 이미 연결된 글의 검증 상태를 클러스터의 현재 검증 상태로 맞춤 (예: 뉴스 1곳 → 복수 출처 확인)
export async function reconcileSocial(db, changed, ctx) {
  const { now, touched } = ctx;
  if (!changed.length) return 0;
  let linked = 0;
  const r = await db.prepare(`SELECT * FROM social_items WHERE cluster_id IS NULL AND event_time >= ? ORDER BY event_time DESC LIMIT 100`).bind(now - 24 * 3600000).all();
  const parse = (s) => { try { return JSON.parse(s); } catch { return []; } };
  const rows = r.results.map((x) => ({
    raw: x, kind: x.kind, symbols: parse(x.symbols), category: x.category, eventTime: x.event_time, publishedAt: x.published_at,
    links: parse(x.links).map((l) => { try { return { key: urlKey(l.url), kind: l.kind }; } catch { return null; } }).filter(Boolean),
    _text: [x.title, x.excerpt].filter(Boolean).join(' ').slice(0, 200),
  }));
  const keys = [...new Set(rows.flatMap((x) => x.links.filter((l) => l.kind === 'official_domain' || l.kind === 'news_domain').map((l) => l.key)))];
  const linkMap = keys.length ? await sstore.clustersByUrlKeys(db, keys) : new Map();
  for (const row of rows) {
    const hit = pickCluster(row, changed, linkMap);
    if (!hit) continue;
    await db.prepare(`UPDATE social_items SET cluster_id = ?, verification = ? WHERE id = ? AND cluster_id IS NULL`).bind(hit.cluster.id, verificationFromCluster(hit.cluster), row.raw.id).run();
    attachToCluster(hit.cluster, row, now);
    touched.add(hit.cluster);
    linked += 1;
  }
  for (const c of changed) {
    await db.prepare(`UPDATE social_items SET verification = ? WHERE cluster_id = ? AND verification != ?`).bind(verificationFromCluster(c), c.id, verificationFromCluster(c)).run();
  }
  return linked;
}
