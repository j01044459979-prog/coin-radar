// Telegram / 커뮤니티 D1 저장소 (Phase 6B). 같은 SQL: migrations/0003_social.sql
// 모든 시각은 epoch milliseconds(UTC). 값은 항상 bind. 작성자/닉네임/IP 컬럼은 없습니다.
import { MAX_LOOKBACK_MS } from './attention.js';

export const SOCIAL_RETENTION = { telegramDays: 14, communityDays: 7, hourlyDays: 90 };
const DAY = 86400000;

export const SOCIAL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS social_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    channel TEXT NOT NULL,
    message_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    excerpt TEXT NOT NULL,
    published_at INTEGER,
    collected_at INTEGER NOT NULL,
    event_time INTEGER NOT NULL,
    symbols TEXT NOT NULL,
    category TEXT NOT NULL,
    links TEXT NOT NULL,
    views INTEGER,
    comments INTEGER,
    verification TEXT NOT NULL,
    cluster_id INTEGER,
    UNIQUE(source, message_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_social_items_kind_time ON social_items(kind, event_time)`,
  `CREATE INDEX IF NOT EXISTS idx_social_items_cluster ON social_items(cluster_id)`,
  `CREATE TABLE IF NOT EXISTS social_mentions (
    item_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    channel TEXT NOT NULL,
    symbol TEXT NOT NULL,
    ts INTEGER NOT NULL,
    PRIMARY KEY (item_id, symbol)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_social_mentions_kind_ts ON social_mentions(kind, ts)`,
  `CREATE INDEX IF NOT EXISTS idx_social_mentions_symbol_ts ON social_mentions(symbol, ts)`,
  // 시간별 집계(개수만): 원본이 정리된 뒤에도 관심도 이력을 90일 보존
  `CREATE TABLE IF NOT EXISTS social_hourly (
    kind TEXT NOT NULL,
    symbol TEXT NOT NULL,
    hour_ts INTEGER NOT NULL,
    mentions INTEGER NOT NULL,
    channels INTEGER NOT NULL,
    PRIMARY KEY (kind, symbol, hour_ts)
  )`,
];

// 이벤트 클러스터에 소스 종류별 집계/관측 시각 컬럼 추가 (Phase 6B). 이미 있으면 건너뜀 (PRAGMA 로 확인).
export const CLUSTER_COLUMNS = [
  ['official_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['news_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['telegram_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['community_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['official_seen_at', 'INTEGER'],
  ['social_seen_at', 'INTEGER'],
  ['community_seen_at', 'INTEGER'],
];

let ready = false;
let pending = null;
// 같은 인스턴스에서 동시에 호출돼도(Cron 진단 기록 + collector) 준비 작업은 한 번만 실행 (ALTER 경합 방지)
export function ensureSocialSchema(db) {
  if (ready) return Promise.resolve();
  if (!pending) {
    pending = doEnsure(db).then(() => { ready = true; }).finally(() => { pending = null; });
  }
  return pending;
}

async function doEnsure(db) {
  await db.batch(SOCIAL_SCHEMA.map((s) => db.prepare(s)));
  const info = await db.prepare(`PRAGMA table_info(event_clusters)`).all();
  const have = new Set(info.results.map((c) => c.name));
  const missing = CLUSTER_COLUMNS.filter(([c]) => !have.has(c));
  if (missing.length) {
    for (const [c, def] of missing) {
      try {
        await db.prepare(`ALTER TABLE event_clusters ADD COLUMN ${c} ${def}`).run();
      } catch (err) {
        if (!/duplicate column/i.test(String((err && err.message) || err))) throw err; // 다른 실행이 먼저 추가함
      }
    }
    // 기존(6A) 클러스터의 공식/뉴스 집계와 관측 시각을 원본 항목에서 한 번 채움
    await db.batch([
      db.prepare(`UPDATE event_clusters SET
        official_count = (SELECT COUNT(*) FROM intelligence_items i WHERE i.cluster_id = event_clusters.id AND i.source_type = 'official'),
        news_count = (SELECT COUNT(*) FROM intelligence_items i WHERE i.cluster_id = event_clusters.id AND i.source_type = 'news'),
        official_seen_at = (SELECT MIN(i.event_time) FROM intelligence_items i WHERE i.cluster_id = event_clusters.id AND i.source_type = 'official')`),
    ]);
  }
}
export function resetSocialSchemaFlagForTests() {
  ready = false;
  pending = null;
}

export async function existingMessageIds(db, source, ids) {
  const found = new Set();
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const r = await db.prepare(`SELECT message_id FROM social_items WHERE source = ? AND message_id IN (${part.map(() => '?').join(',')})`).bind(source, ...part).all();
    for (const row of r.results) found.add(row.message_id);
  }
  return found;
}

// 링크 URL 키 → 클러스터 id (이미 수집된 공식/뉴스 항목과 같은 URL 인지)
export async function clustersByUrlKeys(db, keys) {
  const map = new Map();
  for (let i = 0; i < keys.length; i += 50) {
    const part = keys.slice(i, i + 50);
    const r = await db.prepare(`SELECT url_key, cluster_id FROM intelligence_items WHERE cluster_id IS NOT NULL AND url_key IN (${part.map(() => '?').join(',')})`).bind(...part).all();
    for (const row of r.results) map.set(row.url_key, row.cluster_id);
  }
  return map;
}

// 항목 + 심볼별 언급을 한 번의 batch 로 저장. 중복(source+message_id)은 무시되고 언급도 중복 증가하지 않음 (PRIMARY KEY).
export async function saveSocialItems(db, rows) {
  const item = db.prepare(
    `INSERT OR IGNORE INTO social_items (kind, source, channel, message_id, url, title, excerpt, published_at, collected_at, event_time, symbols, category, links, views, comments, verification, cluster_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const mention = db.prepare(
    `INSERT OR IGNORE INTO social_mentions (item_id, kind, source, channel, symbol, ts)
     SELECT id, ?, ?, ?, ?, ? FROM social_items WHERE source = ? AND message_id = ?`,
  );
  for (let i = 0; i < rows.length; i += 20) {
    const stmts = [];
    for (const r of rows.slice(i, i + 20)) {
      stmts.push(item.bind(r.kind, r.source, r.channel, r.messageId, r.url, r.title ?? null, r.excerpt, r.publishedAt, r.collectedAt, r.eventTime, JSON.stringify(r.symbols), r.category, JSON.stringify(r.links.map((l) => ({ url: l.url, kind: l.kind }))), r.views ?? null, r.comments ?? null, r.verification, r.clusterId ?? null));
      for (const s of r.symbols) stmts.push(mention.bind(r.kind, r.source, r.channel, s, r.eventTime, r.source, r.messageId));
    }
    await db.batch(stmts);
  }
}

// 수집 시작 시각 (기준선 계산에 필요한 최소 수집 기간 판단)
export async function coverageStart(db, kind) {
  const r = await db.prepare(`SELECT MIN(collected_at) AS t FROM social_items WHERE kind = ?`).bind(kind).first();
  return r && r.t ? r.t : null;
}

// 심볼별 창 집계 (한 번의 쿼리). 창 경계는 모두 bind.
export async function mentionAggregates(db, kind, now, symbol) {
  const t = { m15: now - 15 * 60000, h1: now - 3600000, h6: now - 6 * 3600000, h24: now - 24 * 3600000 };
  const lo = now - MAX_LOOKBACK_MS;
  const b15 = t.m15 - 6 * 3600000;
  const b1 = t.h1 - 24 * 3600000;
  const b6 = t.h6 - 48 * 3600000;
  const r = await db
    .prepare(
      `SELECT symbol,
        SUM(ts >= ?) AS c15, SUM(ts >= ?) AS c1h, SUM(ts >= ?) AS c6h, SUM(ts >= ?) AS c24h,
        SUM(ts < ? AND ts >= ?) AS b15, SUM(ts < ? AND ts >= ?) AS b1h, SUM(ts < ? AND ts >= ?) AS b6h,
        COUNT(DISTINCT CASE WHEN ts >= ? THEN source END) AS ch1h, MAX(ts) AS last
       FROM social_mentions WHERE kind = ? AND ts >= ? ${symbol ? 'AND symbol = ?' : ''}
       GROUP BY symbol HAVING c24h > 0 ORDER BY c1h DESC, c24h DESC LIMIT 60`,
    )
    .bind(t.m15, t.h1, t.h6, t.h24, t.m15, b15, t.h1, b1, t.h6, b6, t.h1, kind, Math.min(lo, b6), ...(symbol ? [symbol] : []))
    .all();
  return r.results;
}

// 어떤 심볼이 어떤 (공식/뉴스) 클러스터에 실제로 연결된 글에서 언급됐는지 (최근 24시간)
export async function attachedClusters(db, kind, now) {
  const r = await db
    .prepare(`SELECT m.symbol AS symbol, i.cluster_id AS cluster_id FROM social_mentions m JOIN social_items i ON i.id = m.item_id WHERE m.kind = ? AND m.ts >= ? AND i.cluster_id IS NOT NULL GROUP BY m.symbol, i.cluster_id LIMIT 200`)
    .bind(kind, now - 24 * 3600000)
    .all();
  return r.results;
}

export async function recentClustersBrief(db, now) {
  const r = await db.prepare(`SELECT id, title, verification, importance, source_type, event_time, url FROM event_clusters WHERE last_time >= ? ORDER BY last_time DESC LIMIT 200`).bind(now - 48 * 3600000).all();
  return r.results;
}

export async function querySocialItems(db, { kind, limit, symbol, source }) {
  const where = ['kind = ?'];
  const args = [kind];
  if (symbol) { where.push('symbols LIKE ?'); args.push(`%"${symbol}"%`); }
  if (source) { where.push('source = ?'); args.push(source); }
  const r = await db.prepare(`SELECT * FROM social_items WHERE ${where.join(' AND ')} ORDER BY event_time DESC, id DESC LIMIT ?`).bind(...args, limit).all();
  return r.results;
}

// 오래된 원본 정리 + 최근 시간별 집계 재계산(멱등). 매시 정각 실행에서 호출.
export async function pruneSocial(db, now) {
  const hour = Math.floor(now / 3600000) * 3600000;
  await db.batch([
    // 정리 전에 최근 6시간 버킷을 다시 계산 (정각 실행이 한 번 빠져도 다음 실행이 메움)
    db
      .prepare(`INSERT OR REPLACE INTO social_hourly (kind, symbol, hour_ts, mentions, channels) SELECT kind, symbol, (ts / 3600000) * 3600000, COUNT(*), COUNT(DISTINCT source) FROM social_mentions WHERE ts >= ? GROUP BY kind, symbol, (ts / 3600000) * 3600000`)
      .bind(hour - 6 * 3600000),
    db.prepare(`DELETE FROM social_mentions WHERE (kind = 'telegram' AND ts < ?) OR (kind != 'telegram' AND ts < ?)`).bind(now - SOCIAL_RETENTION.telegramDays * DAY, now - SOCIAL_RETENTION.communityDays * DAY),
    db.prepare(`DELETE FROM social_items WHERE (kind = 'telegram' AND collected_at < ?) OR (kind != 'telegram' AND collected_at < ?)`).bind(now - SOCIAL_RETENTION.telegramDays * DAY, now - SOCIAL_RETENTION.communityDays * DAY),
    db.prepare(`DELETE FROM social_hourly WHERE hour_ts < ?`).bind(now - SOCIAL_RETENTION.hourlyDays * DAY),
  ]);
}
