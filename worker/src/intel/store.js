// Crypto Intelligence D1 저장소 (binding: DB). 같은 SQL: migrations/0002_intelligence.sql
// 모든 시각은 epoch milliseconds(UTC) 정수로 저장합니다. 값은 항상 bind 로만 전달합니다 (SQL 문자열 조립 없음).

import { ensureSocialSchema, resetSocialSchemaFlagForTests } from './social-store.js';

export const RETENTION = { itemsDays: 30, clustersDays: 60 };
const DAY = 86400000;

export const INTEL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS intelligence_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_tier INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    url_key TEXT NOT NULL UNIQUE,
    published_at INTEGER,
    collected_at INTEGER NOT NULL,
    event_time INTEGER NOT NULL,
    summary TEXT,
    symbols TEXT NOT NULL,
    category TEXT NOT NULL,
    importance INTEGER NOT NULL,
    verification TEXT NOT NULL,
    cluster_id INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_intel_items_time ON intelligence_items(event_time)`,
  `CREATE INDEX IF NOT EXISTS idx_intel_items_cluster ON intelligence_items(cluster_id)`,
  `CREATE TABLE IF NOT EXISTS event_clusters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    category TEXT NOT NULL,
    symbols TEXT NOT NULL,
    importance_base INTEGER NOT NULL,
    reaction_bonus INTEGER NOT NULL DEFAULT 0,
    importance INTEGER NOT NULL,
    verification TEXT NOT NULL,
    source TEXT NOT NULL,
    source_type TEXT NOT NULL,
    sources TEXT NOT NULL,
    item_count INTEGER NOT NULL,
    source_count INTEGER NOT NULL,
    published_known INTEGER NOT NULL,
    event_time INTEGER NOT NULL,
    last_time INTEGER NOT NULL,
    first_seen_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_event_clusters_time ON event_clusters(event_time)`,
  `CREATE INDEX IF NOT EXISTS idx_event_clusters_type ON event_clusters(source_type, event_time)`,
  `CREATE TABLE IF NOT EXISTS event_market_snapshots (
    cluster_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    market TEXT NOT NULL,
    taken_at INTEGER NOT NULL,
    published_at INTEGER,
    price_at_pub REAL,
    price_now REAL,
    change_pre5 REAL,
    change_post5 REAL,
    change_post15 REAL,
    change_5m REAL,
    change_15m REAL,
    PRIMARY KEY (cluster_id, symbol)
  )`,
  // 진단용 키-값 (Cron 이 실제로 실행됐는지, collector 가 시작/완료했는지). 값은 짧은 문자열만.
  `CREATE TABLE IF NOT EXISTS intel_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS source_health (
    source TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    label TEXT NOT NULL,
    interval_ms INTEGER NOT NULL,
    last_attempt_at INTEGER,
    last_success_at INTEGER,
    last_error TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_item_count INTEGER NOT NULL DEFAULT 0
  )`,
];

let ready = false;
let pending = null;
export function ensureIntelSchema(db) {
  if (ready) return Promise.resolve();
  if (!pending) {
    pending = (async () => {
      await db.batch(INTEL_SCHEMA.map((s) => db.prepare(s)));
      await ensureSocialSchema(db); // Phase 6B: 소셜 테이블 + 클러스터 컬럼 (이미 있으면 건너뜀)
      ready = true;
    })().finally(() => { pending = null; });
  }
  return pending;
}
export function resetIntelSchemaFlagForTests() {
  ready = false;
  pending = null;
  resetSocialSchemaFlagForTests();
}

export async function loadHealth(db) {
  const r = await db.prepare(`SELECT * FROM source_health`).all();
  return new Map(r.results.map((h) => [h.source, h]));
}

export async function recordHealth(db, src, now, result) {
  const prev = (await db.prepare(`SELECT consecutive_failures, last_success_at, last_item_count FROM source_health WHERE source = ?`).bind(src.id).first()) || {};
  const ok = result.ok;
  await db
    .prepare(
      `INSERT INTO source_health (source, source_type, label, interval_ms, last_attempt_at, last_success_at, last_error, consecutive_failures, last_item_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source) DO UPDATE SET source_type = excluded.source_type, label = excluded.label, interval_ms = excluded.interval_ms,
         last_attempt_at = excluded.last_attempt_at, last_success_at = excluded.last_success_at, last_error = excluded.last_error,
         consecutive_failures = excluded.consecutive_failures, last_item_count = excluded.last_item_count`,
    )
    .bind(src.id, src.type, src.label, src.intervalMs, now, ok ? now : prev.last_success_at ?? null, ok ? null : String(result.error || 'error').slice(0, 200), ok ? 0 : (prev.consecutive_failures || 0) + 1, ok ? result.count : prev.last_item_count || 0)
    .run();
}

// 새 항목이면 id, 이미 있으면 null (url_key UNIQUE 로 중복 방지)
export async function insertItem(db, it) {
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO intelligence_items (source, source_type, source_tier, title, url, url_key, published_at, collected_at, event_time, summary, symbols, category, importance, verification, cluster_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .bind(it.source, it.sourceType, it.tier, it.title, it.url, it.urlKey, it.publishedAt, it.collectedAt, it.eventTime, it.summary || '', JSON.stringify(it.symbols), it.category, it.importance, it.verification)
    .run();
  return r.meta && r.meta.changes > 0 ? r.meta.last_row_id : null;
}

export async function setItemCluster(db, itemId, clusterId) {
  await db.prepare(`UPDATE intelligence_items SET cluster_id = ? WHERE id = ?`).bind(clusterId, itemId).run();
}

const parseJson = (s, d) => {
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};

export async function loadRecentClusters(db, now, limit = 300) {
  const r = await db.prepare(`SELECT * FROM event_clusters WHERE last_time >= ? ORDER BY last_time DESC LIMIT ?`).bind(now - 48 * 3600000, limit).all();
  return r.results.map(rowToCluster);
}

export function rowToCluster(r) {
  return {
    id: r.id, title: r.title, url: r.url, category: r.category, symbols: parseJson(r.symbols, []), importanceBase: r.importance_base, reactionBonus: r.reaction_bonus,
    importance: r.importance, verification: r.verification, source: r.source, sourceType: r.source_type, sources: parseJson(r.sources, []), itemCount: r.item_count,
    sourceCount: r.source_count, publishedKnown: !!r.published_known, eventTime: r.event_time, lastTime: r.last_time, firstSeenAt: r.first_seen_at, updatedAt: r.updated_at,
    officialCount: r.official_count || 0, newsCount: r.news_count || 0, telegramCount: r.telegram_count || 0, communityCount: r.community_count || 0,
    officialSeenAt: r.official_seen_at ?? null, socialSeenAt: r.social_seen_at ?? null, communitySeenAt: r.community_seen_at ?? null,
  };
}

const clusterArgs = (c) => [c.title, c.url, c.category, JSON.stringify(c.symbols), c.importanceBase, c.reactionBonus, c.importance, c.verification, c.source, c.sourceType, JSON.stringify(c.sources), c.itemCount, c.sourceCount, c.publishedKnown ? 1 : 0, c.eventTime, c.lastTime, c.firstSeenAt, c.updatedAt, c.officialCount || 0, c.newsCount || 0, c.telegramCount || 0, c.communityCount || 0, c.officialSeenAt ?? null, c.socialSeenAt ?? null, c.communitySeenAt ?? null];

export async function insertCluster(db, c) {
  const r = await db
    .prepare(
      `INSERT INTO event_clusters (title, url, category, symbols, importance_base, reaction_bonus, importance, verification, source, source_type, sources, item_count, source_count, published_known, event_time, last_time, first_seen_at, updated_at,
         official_count, news_count, telegram_count, community_count, official_seen_at, social_seen_at, community_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(...clusterArgs(c))
    .run();
  return r.meta.last_row_id;
}

export async function updateCluster(db, c) {
  await db
    .prepare(
      `UPDATE event_clusters SET title = ?, url = ?, category = ?, symbols = ?, importance_base = ?, reaction_bonus = ?, importance = ?, verification = ?, source = ?, source_type = ?, sources = ?,
         item_count = ?, source_count = ?, published_known = ?, event_time = ?, last_time = ?, first_seen_at = ?, updated_at = ?,
         official_count = ?, news_count = ?, telegram_count = ?, community_count = ?, official_seen_at = ?, social_seen_at = ?, community_seen_at = ? WHERE id = ?`,
    )
    .bind(...clusterArgs(c), c.id)
    .run();
}

export async function upsertSnapshot(db, s) {
  await db
    .prepare(
      `INSERT INTO event_market_snapshots (cluster_id, symbol, market, taken_at, published_at, price_at_pub, price_now, change_pre5, change_post5, change_post15, change_5m, change_15m)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cluster_id, symbol) DO UPDATE SET market = excluded.market, taken_at = excluded.taken_at, published_at = excluded.published_at, price_at_pub = excluded.price_at_pub,
         price_now = excluded.price_now, change_pre5 = excluded.change_pre5, change_post5 = excluded.change_post5, change_post15 = excluded.change_post15, change_5m = excluded.change_5m, change_15m = excluded.change_15m`,
    )
    .bind(s.clusterId, s.symbol, s.market, s.takenAt, s.publishedAt ?? null, s.price_at_pub ?? null, s.price_now ?? null, s.change_pre5 ?? null, s.change_post5 ?? null, s.change_post15 ?? null, s.change_5m ?? null, s.change_15m ?? null)
    .run();
}

// 오래된 기록 정리: 원본 항목 30일, 클러스터(+시세 스냅샷) 60일
export async function pruneIntel(db, now) {
  const cut = now - RETENTION.clustersDays * DAY;
  await db.batch([
    db.prepare(`DELETE FROM intelligence_items WHERE collected_at < ?`).bind(now - RETENTION.itemsDays * DAY),
    db.prepare(`DELETE FROM event_market_snapshots WHERE cluster_id IN (SELECT id FROM event_clusters WHERE last_time < ?)`).bind(cut),
    db.prepare(`DELETE FROM event_clusters WHERE last_time < ?`).bind(cut),
  ]);
}

// ── API 조회 (필터는 모두 검증된 값만 전달, LIMIT 은 호출자가 상한을 적용) ──
export async function queryEvents(db, { limit, symbol, sourceType, minImportance }) {
  const where = [];
  const args = [];
  if (sourceType === 'official') where.push(`source_type = 'official'`);
  else if (sourceType === 'news') where.push(`source_type != 'official'`);
  if (symbol) {
    where.push(`symbols LIKE ?`);
    args.push(`%"${symbol}"%`);
  }
  if (minImportance > 0) {
    where.push(`importance >= ?`);
    args.push(minImportance);
  }
  const rows = await db.prepare(`SELECT * FROM event_clusters ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY event_time DESC, id DESC LIMIT ?`).bind(...args, limit).all();
  const clusters = rows.results.map(rowToCluster);
  if (!clusters.length) return [];
  const ids = clusters.map((c) => c.id);
  const snaps = await db.prepare(`SELECT * FROM event_market_snapshots WHERE cluster_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  const by = new Map();
  for (const s of snaps.results) (by.get(s.cluster_id) || by.set(s.cluster_id, []).get(s.cluster_id)).push(s);
  return clusters.map((c) => ({ ...c, snapshots: by.get(c.id) || [] }));
}

export async function queryItems(db, { limit, symbol, sourceType }) {
  const where = [];
  const args = [];
  if (sourceType === 'official') where.push(`source_type = 'official'`);
  else if (sourceType === 'news') where.push(`source_type != 'official'`);
  if (symbol) {
    where.push(`symbols LIKE ?`);
    args.push(`%"${symbol}"%`);
  }
  const rows = await db.prepare(`SELECT * FROM intelligence_items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY event_time DESC, id DESC LIMIT ?`).bind(...args, limit).all();
  return rows.results;
}

// 이미 저장된 url_key 집합 (새 항목만 분석해서 CPU/D1 쓰기를 줄임)
export async function existingKeys(db, keys) {
  const found = new Set();
  for (let i = 0; i < keys.length; i += 50) {
    const part = keys.slice(i, i + 50);
    const r = await db.prepare(`SELECT url_key FROM intelligence_items WHERE url_key IN (${part.map(() => '?').join(',')})`).bind(...part).all();
    for (const row of r.results) found.add(row.url_key);
  }
  return found;
}

// ── 진단 (Phase 6A 운영 수정) ──
export const INCOMPLETE = '수집 미완료: 시작 기록만 있고 완료 기록 없음 (실행 시간/CPU 제한 의심)';

export async function setMeta(db, key, value, now) {
  await db
    .prepare(`INSERT INTO intel_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(key, String(value).slice(0, 300), now)
    .run();
}

export async function loadMeta(db) {
  const r = await db.prepare(`SELECT key, value, updated_at FROM intel_meta`).all();
  return new Map(r.results.map((x) => [x.key, x]));
}

// 수집을 시작하기 '전에' 이번에 다룰 출처의 시도 기록을 남깁니다 (한 번의 batch).
// 실행 도중 종료(CPU/시간 제한 등)되어도 "수집 준비 중" 이 아니라 "수집 미완료" 로 드러나고, 미완료가 반복되면 실패 횟수가 늘어 간격이 넓어집니다.
export async function markAttempts(db, sources, now) {
  if (!sources.length) return;
  const stmt = db.prepare(
    `INSERT INTO source_health (source, source_type, label, interval_ms, last_attempt_at, last_success_at, last_error, consecutive_failures, last_item_count)
     VALUES (?, ?, ?, ?, ?, NULL, ?, 0, 0)
     ON CONFLICT(source) DO UPDATE SET source_type = excluded.source_type, label = excluded.label, interval_ms = excluded.interval_ms,
       consecutive_failures = CASE WHEN source_health.last_error = ? THEN source_health.consecutive_failures + 1 ELSE source_health.consecutive_failures END,
       last_attempt_at = excluded.last_attempt_at, last_error = excluded.last_error`,
  );
  await db.batch(sources.map((s) => stmt.bind(s.id, s.type, s.label, s.intervalMs, now, INCOMPLETE, INCOMPLETE)));
}
