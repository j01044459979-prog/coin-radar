// 24시간 Upbit 감시 실행 (Cron 이 1분마다 호출)
import { ALERT, STABLE_BASES, readConfig } from './config.js';
import { fetchKrwTickers, fetchCandles } from './upbit.js';
import { analyzeMarket, bestPerMarket, pickMarkets } from './monitor-engine.js';
import { isEvent, decideAlerts, formatAlertMessage } from './alerts.js';
import { sendTelegram } from './telegram.js';
import * as store from './store.js';

// D1 이 없을 때를 위한 같은 인스턴스 안의 마지막 실행 기록 (재시작되면 사라짐)
export const memory = { lastRun: null };

const compact = (r) => ({
  market: r.market,
  window: r.window,
  change_pct: Number(r.metrics.changePct.toFixed(3)),
  ratio: r.metrics.ratio === null ? null : Number(r.metrics.ratio.toFixed(2)),
  quote_vol: Math.round(r.metrics.quoteVol),
  score: r.score.score,
  labels: r.cls.labels.join(' + '),
  window_end: r.metrics.windowEnd,
});

// options: { fetchImpl, candleIntervalMs, notify(기본 true), persist(기본 true) }
export async function runMonitor(env, now, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const notify = options.notify !== false;
  const persist = options.persist !== false;
  const cfg = readConfig(env);
  const db = cfg.d1Configured && persist ? env.DB : null;
  const run = { startedAt: now, finishedAt: now, ok: false, markets: 0, analyzed: 0, events: 0, alertsSent: 0, errors: [], summary: [], alerts: [], notes: [] };

  try {
    const tickers = await fetchKrwTickers(fetchImpl);
    const markets = pickMarkets(tickers, cfg.markets, STABLE_BASES);
    run.markets = markets.length;

    const { data, errors } = await fetchCandles(markets, fetchImpl, options.candleIntervalMs);
    run.errors.push(...errors);
    const rows = [];
    for (const [market, d] of data) rows.push(...analyzeMarket(market, d.m1, d.m15, now));
    const best = bestPerMarket(rows);
    run.analyzed = best.length;
    run.summary = best.slice(0, 10).map(compact);
    const events = best.filter(isEvent);
    run.events = events.length;

    if (db) {
      await store.ensureSchema(db);
      await store.saveEvents(db, events, now);
    }

    // ── Telegram: 중요 이벤트만, 중복/쿨다운 확인 ──
    if (!notify) {
      run.notes.push('미리보기 실행: 알림 없음');
    } else if (!db) {
      run.notes.push('D1 미설정: 중복 알림 방지 기록을 저장할 수 없어 Telegram 알림을 보내지 않습니다');
    } else {
      const keys = best.map((r) => `${r.market}|${r.window}|${r.metrics.windowEnd}`);
      const history = await store.loadAlertHistory(db, now, ALERT.cooldownMinutes, keys);
      const decisions = decideAlerts(best, history, now);
      for (const d of decisions) {
        if (d.action !== 'send') {
          run.alerts.push({ market: d.row.market, window: d.row.window, action: 'skip', why: d.why });
          continue;
        }
        if (!cfg.telegramConfigured) {
          run.alerts.push({ market: d.row.market, window: d.row.window, action: 'skip', why: 'Telegram Secret 미설정' });
          continue;
        }
        const res = await sendTelegram(env, formatAlertMessage(d.row, now, { escalation: d.escalation }), fetchImpl);
        await store.saveAlert(db, d.row, d.key, res.ok ? 'sent' : 'failed', res.ok ? d.reason : res.reason, now);
        if (res.ok) run.alertsSent += 1;
        run.alerts.push({ market: d.row.market, window: d.row.window, action: res.ok ? 'sent' : 'failed', why: res.ok ? d.reason : res.reason });
      }
    }
    run.ok = run.markets > 0 && run.analyzed > 0;
  } catch (err) {
    run.errors.push({ error: String(err && err.message) });
  }

  run.finishedAt = Date.now() > now ? Date.now() : now;
  memory.lastRun = { ...run };
  if (db) {
    try {
      await store.ensureSchema(db);
      await store.saveRun(db, run);
      if (new Date(now).getUTCMinutes() === 0) await store.prune(db, now);
    } catch (err) {
      run.errors.push({ error: 'D1 저장 실패: ' + String(err && err.message) });
    }
  }
  return run;
}

// /api/monitor/status 응답
export async function monitorStatus(env, now) {
  const cfg = readConfig(env);
  const out = {
    status: 'ok',
    worker: 'ok',
    monitor: 'Upbit KRW 시장 24시간 감시 (Binance 는 브라우저 전용)',
    cron: { schedule: '* * * * * (1분마다)', last_run_at: null, last_run_kst: null, seconds_since_last_run: null, healthy: false, last_ok_at: null, source: null },
    markets_watched: null,
    markets_setting: cfg.markets,
    telegram: { configured: cfg.telegramConfigured, ready: cfg.telegramConfigured && cfg.d1Configured },
    d1: { configured: cfg.d1Configured },
    latest_ranking: [],
    recent_events: [],
    recent_alerts: [],
    notes: [],
  };
  let run = null;
  if (cfg.d1Configured) {
    try {
      await store.ensureSchema(env.DB);
      const s = await store.loadStatus(env.DB);
      if (s.run) {
        run = { startedAt: s.run.started_at, ok: !!s.run.ok, markets: s.run.markets, summary: JSON.parse(s.run.summary || '[]'), errors: JSON.parse(s.run.errors || '[]') };
        out.cron.source = 'D1';
      }
      out.cron.last_ok_at = s.lastOkAt;
      out.recent_events = s.events.map((e) => ({ detected_at: e.detected_at, market: e.market, window: e.win, change_pct: e.change_pct, ratio: e.ratio, score: e.score, labels: e.labels }));
      out.recent_alerts = s.alerts.map((a) => ({ created_at: a.created_at, market: a.market, window: a.win, score: a.score, status: a.status, reason: a.reason }));
    } catch (err) {
      out.notes.push('D1 조회 실패: ' + String(err && err.message));
    }
  } else {
    out.notes.push('D1 미설정: 실행 기록/이벤트를 저장하지 않으며 Telegram 알림도 보내지 않습니다 (docs/MONITOR.md 참고)');
    if (memory.lastRun) {
      run = memory.lastRun;
      out.cron.source = 'memory (이 인스턴스의 마지막 실행, 재시작 시 사라짐)';
    }
  }
  if (!cfg.telegramConfigured) out.notes.push('Telegram Secret 미설정: 알림을 건너뜁니다');
  if (run) {
    const age = Math.round((now - run.startedAt) / 1000);
    out.cron.last_run_at = run.startedAt;
    out.cron.last_run_kst = new Date(run.startedAt + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    out.cron.seconds_since_last_run = age;
    out.cron.healthy = age <= 180 && run.ok;
    out.markets_watched = run.markets;
    out.latest_ranking = run.summary;
    if (run.errors && run.errors.length) out.cron.last_errors = run.errors.slice(0, 5);
  } else {
    out.notes.push('아직 기록된 Cron 실행이 없습니다');
  }
  if (!out.cron.healthy) out.status = 'degraded';
  return out;
}
