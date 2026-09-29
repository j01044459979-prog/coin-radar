// Cloudflare D1 저장소 (binding 이름: DB). DB 가 없으면 이 파일의 함수는 호출되지 않습니다.
// 테이블은 처음 실행 때 자동으로 만듭니다 (CREATE TABLE IF NOT EXISTS). 같은 SQL: migrations/0001_monitor.sql
import { MIN } from './config.js';

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS monitor_runs (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_runs_started ON monitor_runs(started_at)`,
  `CREATE TABLE IF NOT EXISTS events (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_events_detected ON events(detected_at)`,
  `CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    market TEXT NOT NULL,
    win INTEGER NOT NULL,
    level TEXT NOT NULL,
    score INTEGER NOT NULL,
    dedup_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    reason TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_market_created ON alerts(market, created_at)`,
];

let schemaReady = false;
export async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  schemaReady = true;
}
export function resetSchemaFlagForTests() {
  schemaReady = false;
}

export async function saveEvents(db, rows, now) {
  if (!rows.length) return 0;
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO events (detected_at, market, win, window_start, window_end, change_pct, ratio, quote_vol, baseline_avg, score, level, labels)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  await db.batch(
    rows.map((r) => {
      const m = r.metrics;
      return stmt.bind(now, r.market, m.window, m.windowStart, m.windowEnd, m.changePct, m.ratio, m.quoteVol, m.baselineAvg, r.score.score, r.cls.level, r.cls.labels.join(' + '));
    }),
  );
  return rows.length;
}

// 알림 판단에 필요한 기록: cooldown 이내 전송, 최근 1시간 건수, 이미 처리한 dedup_key
export async function loadAlertHistory(db, now, cooldownMinutes, keys) {
  const since = now - cooldownMinutes * MIN;
  const sent = await db.prepare(`SELECT market, level, created_at AS sent_at FROM alerts WHERE status = 'sent' AND created_at >= ?`).bind(since).all();
  const hour = await db.prepare(`SELECT COUNT(*) AS n FROM alerts WHERE status IN ('sent', 'failed') AND created_at >= ?`).bind(now - 60 * MIN).first();
  let done = [];
  if (keys.length) {
    const res = await db.prepare(`SELECT dedup_key FROM alerts WHERE dedup_key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all();
    done = res.results.map((x) => x.dedup_key);
  }
  return { sent: sent.results, hourCount: hour ? hour.n : 0, keys: new Set(done) };
}

export async function saveAlert(db, row, key, status, reason, now) {
  await db
    .prepare(`INSERT OR IGNORE INTO alerts (created_at, market, win, level, score, dedup_key, status, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(now, row.market, row.window, row.cls.level, row.score.score, key, status, reason || null)
    .run();
}

export async function saveRun(db, run) {
  await db
    .prepare(`INSERT INTO monitor_runs (started_at, finished_at, ok, markets, analyzed, events, alerts_sent, errors, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(run.startedAt, run.finishedAt, run.ok ? 1 : 0, run.markets, run.analyzed, run.events, run.alertsSent, JSON.stringify(run.errors || []), JSON.stringify(run.summary || []))
    .run();
}

// 오래된 기록 정리 (매시 정각 실행): 실행 기록 3일, 이벤트 14일, 알림 30일
export async function prune(db, now) {
  await db.batch([
    db.prepare(`DELETE FROM monitor_runs WHERE started_at < ?`).bind(now - 3 * 1440 * MIN),
    db.prepare(`DELETE FROM events WHERE detected_at < ?`).bind(now - 14 * 1440 * MIN),
    db.prepare(`DELETE FROM alerts WHERE created_at < ?`).bind(now - 30 * 1440 * MIN),
  ]);
}

export async function loadStatus(db, limit = 10) {
  const run = await db.prepare(`SELECT * FROM monitor_runs ORDER BY started_at DESC LIMIT 1`).first();
  const lastOk = await db.prepare(`SELECT started_at FROM monitor_runs WHERE ok = 1 ORDER BY started_at DESC LIMIT 1`).first();
  const events = await db.prepare(`SELECT * FROM events ORDER BY detected_at DESC, score DESC LIMIT ?`).bind(limit).all();
  const alerts = await db.prepare(`SELECT created_at, market, win, level, score, status, reason FROM alerts ORDER BY created_at DESC LIMIT ?`).bind(limit).all();
  return { run, lastOkAt: lastOk ? lastOk.started_at : null, events: events.results, alerts: alerts.results };
}
