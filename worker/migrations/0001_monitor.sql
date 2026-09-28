-- COIN RADAR Phase 4 D1 스키마 (참고용)
-- Worker 가 처음 실행될 때 같은 SQL(CREATE TABLE IF NOT EXISTS)을 자동으로 실행하므로
-- 직접 실행하지 않아도 됩니다. 수동으로 만들고 싶다면 Cloudflare D1 콘솔에 붙여 넣으세요.

CREATE TABLE IF NOT EXISTS monitor_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  markets INTEGER NOT NULL,
  analyzed INTEGER NOT NULL,
  events INTEGER NOT NULL,
  alerts_sent INTEGER NOT NULL,
  errors TEXT,
  summary TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_started ON monitor_runs(started_at);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  detected_at INTEGER NOT NULL,
  market TEXT NOT NULL,
  win INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  window_end INTEGER NOT NULL,
  change_pct REAL NOT NULL,
  ratio REAL,
  quote_vol REAL NOT NULL,
  baseline_avg REAL NOT NULL,
  score INTEGER NOT NULL,
  level TEXT NOT NULL,
  labels TEXT NOT NULL,
  UNIQUE(market, win, window_end)
);
CREATE INDEX IF NOT EXISTS idx_events_detected ON events(detected_at);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  market TEXT NOT NULL,
  win INTEGER NOT NULL,
  level TEXT NOT NULL,
  score INTEGER NOT NULL,
  dedup_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_market_created ON alerts(market, created_at);
