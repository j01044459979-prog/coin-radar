-- COIN RADAR Phase 6A: Crypto Intelligence D1 스키마 (참고용)
-- Worker 가 처음 실행될 때 같은 SQL(CREATE TABLE IF NOT EXISTS)을 자동으로 실행하므로 직접 실행하지 않아도 됩니다.
-- 모든 시각은 epoch milliseconds(UTC) 입니다. 원본: worker/src/intel/store.js 의 INTEL_SCHEMA

CREATE TABLE IF NOT EXISTS intelligence_items (
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
  );

CREATE INDEX IF NOT EXISTS idx_intel_items_time ON intelligence_items(event_time);

CREATE INDEX IF NOT EXISTS idx_intel_items_cluster ON intelligence_items(cluster_id);

CREATE TABLE IF NOT EXISTS event_clusters (
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
  );

CREATE INDEX IF NOT EXISTS idx_event_clusters_time ON event_clusters(event_time);

CREATE INDEX IF NOT EXISTS idx_event_clusters_type ON event_clusters(source_type, event_time);

CREATE TABLE IF NOT EXISTS event_market_snapshots (
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
  );

CREATE TABLE IF NOT EXISTS intel_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

CREATE TABLE IF NOT EXISTS source_health (
    source TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    label TEXT NOT NULL,
    interval_ms INTEGER NOT NULL,
    last_attempt_at INTEGER,
    last_success_at INTEGER,
    last_error TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_item_count INTEGER NOT NULL DEFAULT 0
  );
