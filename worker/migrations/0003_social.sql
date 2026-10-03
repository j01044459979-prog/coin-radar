-- COIN RADAR Phase 6B: Telegram / 커뮤니티 D1 스키마 (참고용)
-- Worker 가 처음 실행될 때 같은 SQL 을 자동 실행합니다 (CREATE ... IF NOT EXISTS, 컬럼은 PRAGMA 로 확인 후 ALTER). 직접 실행하지 않아도 됩니다.
-- 모든 시각은 epoch milliseconds(UTC). 원본: worker/src/intel/social-store.js

CREATE TABLE IF NOT EXISTS social_items (
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
  );

CREATE INDEX IF NOT EXISTS idx_social_items_kind_time ON social_items(kind, event_time);

CREATE INDEX IF NOT EXISTS idx_social_items_cluster ON social_items(cluster_id);

CREATE TABLE IF NOT EXISTS social_mentions (
    item_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    channel TEXT NOT NULL,
    symbol TEXT NOT NULL,
    ts INTEGER NOT NULL,
    PRIMARY KEY (item_id, symbol)
  );

CREATE INDEX IF NOT EXISTS idx_social_mentions_kind_ts ON social_mentions(kind, ts);

CREATE INDEX IF NOT EXISTS idx_social_mentions_symbol_ts ON social_mentions(symbol, ts);

CREATE TABLE IF NOT EXISTS social_hourly (
    kind TEXT NOT NULL,
    symbol TEXT NOT NULL,
    hour_ts INTEGER NOT NULL,
    mentions INTEGER NOT NULL,
    channels INTEGER NOT NULL,
    PRIMARY KEY (kind, symbol, hour_ts)
  );

-- event_clusters 컬럼 추가 (이미 있으면 실행하지 마세요 — Worker 는 자동으로 건너뜁니다)
ALTER TABLE event_clusters ADD COLUMN official_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event_clusters ADD COLUMN news_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event_clusters ADD COLUMN telegram_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event_clusters ADD COLUMN community_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event_clusters ADD COLUMN official_seen_at INTEGER;
ALTER TABLE event_clusters ADD COLUMN social_seen_at INTEGER;
ALTER TABLE event_clusters ADD COLUMN community_seen_at INTEGER;
