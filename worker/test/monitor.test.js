// 24시간 감시 실행(Cron) · D1 저장 · 상태 API 통합 테스트 (외부 메신저 알림 없음)
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.js';
import { runMonitor, memory } from '../src/monitor.js';
import { resetSchemaFlagForTests } from '../src/store.js';
import { FakeD1, makeFetch, MIN } from './helpers.js';

const SPIKE = { 'KRW-SOL': { spike: { minutes: 5, q: 4e8, pricePct: 3 } } };
const T = Date.UTC(2026, 8, 28, 5, 37, 2);
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const realFetch = globalThis.fetch;
beforeEach(() => {
  resetSchemaFlagForTests();
  memory.lastRun = null;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('D1 없음: 감시 계산 정상, 외부 요청은 Upbit 뿐', async () => {
  const f = makeFetch({ now: T, specs: SPIKE });
  const run = await runMonitor({ MONITOR_MARKETS: '15' }, T, { fetchImpl: f.fetch, candleIntervalMs: 0 });
  assert.equal(run.ok, true);
  assert.equal(run.markets, 4); // KRW-USDT(스테이블) 제외
  assert.equal(run.analyzed, 4);
  assert.equal(run.summary[0].market, 'KRW-SOL');
  assert.equal(run.summary[0].score, 88);
  assert.equal(run.summary[0].labels, '가격 급변 + 거래량 이상');
  assert.equal(run.summary[0].important, true);
  assert.equal(run.summary[1].important, false);
  assert.equal(run.events, 1);
  assert.deepEqual(f.calls.other, []);
  assert.equal(f.calls.upbit, 2 + 4 * 2); // 목록 1 + 현재가 1 + 종목당 캔들 2
});

test('D1 있음: 이벤트·실행 기록 저장, 메신저 전송 없음 (Kakao Secret 이 남아 있어도 무시)', async () => {
  const DB = new FakeD1();
  const f = makeFetch({ now: T, specs: SPIKE });
  const env = { DB, KAKAO_REST_API_KEY: 'leftover-test-value', KAKAO_CLIENT_SECRET: 'leftover-test-value', ADMIN_TOKEN: 'leftover-test-value', TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_CHAT_ID: 'y' };
  const run = await runMonitor(env, T, { fetchImpl: f.fetch, candleIntervalMs: 0 });
  assert.equal(run.ok, true);
  assert.deepEqual(f.calls.other, []);
  assert.equal(DB.rows('SELECT * FROM events').length, 1);
  assert.equal(DB.rows('SELECT * FROM monitor_runs').length, 1);
  assert.equal(DB.rows('SELECT alerts_sent FROM monitor_runs')[0].alerts_sent, 0);
  // 다음 분: 같은 이벤트가 이어져도 정상 저장
  const f2 = makeFetch({ now: T + MIN, specs: SPIKE });
  await runMonitor(env, T + MIN, { fetchImpl: f2.fetch, candleIntervalMs: 0 });
  assert.equal(DB.rows('SELECT * FROM monitor_runs').length, 2);
});

test('예전 카카오 토큰 표(kakao_auth)는 자동 삭제', async () => {
  const DB = new FakeD1();
  DB.db.exec('CREATE TABLE kakao_auth (id INTEGER PRIMARY KEY, refresh_enc TEXT)');
  DB.db.exec("INSERT INTO kakao_auth VALUES (1, 'v1.old')");
  await runMonitor({ DB }, T, { fetchImpl: makeFetch({ now: T }).fetch, candleIntervalMs: 0 });
  assert.equal(DB.rows("SELECT name FROM sqlite_master WHERE name = 'kakao_auth'").length, 0);
});

test('중요하지 않은 움직임은 이벤트 없음', async () => {
  const DB = new FakeD1();
  const run = await runMonitor({ DB }, T, { fetchImpl: makeFetch({ now: T }).fetch, candleIntervalMs: 0 });
  assert.equal(run.events, 0);
  assert.equal(DB.rows('SELECT * FROM events').length, 0);
});

test('일부 종목 Upbit 오류(429)는 건너뛰고 나머지는 계산', async () => {
  const f = makeFetch({ now: T, specs: SPIKE, fail: new Set(['KRW-BTC']) });
  const run = await runMonitor({}, T, { fetchImpl: f.fetch, candleIntervalMs: 0 });
  assert.equal(run.ok, true);
  assert.equal(run.analyzed, 3);
  assert.equal(run.errors[0].market, 'KRW-BTC');
  assert.match(run.errors[0].error, /429/);
});

test('Upbit 전체 실패: ok=false 로 기록, 예외로 멈추지 않음', async () => {
  const DB = new FakeD1();
  const run = await runMonitor({ DB }, T, { fetchImpl: async () => new Response('x', { status: 503 }), candleIntervalMs: 0 });
  assert.equal(run.ok, false);
  assert.match(run.errors[0].error, /503/);
  assert.equal(DB.rows('SELECT ok FROM monitor_runs')[0].ok, 0);
});

test('Cron handler(scheduled) → 실행 기록 → /api/monitor/status', async () => {
  const DB = new FakeD1();
  const now = Date.now();
  globalThis.fetch = makeFetch({ now, specs: SPIKE }).fetch;
  const env = { DB, MONITOR_MARKETS: '3' };
  const waits = [];
  await worker.scheduled({ scheduledTime: now, cron: '* * * * *' }, env, { waitUntil: (p) => waits.push(p) });
  assert.equal(waits.length, 1);
  await Promise.all(waits);
  assert.equal(DB.rows('SELECT * FROM monitor_runs').length, 1);

  const res = await worker.fetch(new Request('https://x.test/api/monitor/status'), env, {});
  assert.equal(res.status, 200);
  const s = await res.json();
  assert.equal(s.status, 'ok');
  assert.equal(s.cron.healthy, true);
  assert.equal(s.cron.source, 'D1');
  assert.equal(s.markets_watched, 3);
  assert.equal(s.d1.configured, true);
  assert.ok(s.latest_ranking.length >= 1);
  assert.equal(s.recent_events[0].market, 'KRW-SOL');
  assert.equal(s.kakao, undefined);
  assert.equal(s.telegram, undefined);
  assert.equal(s.recent_alerts, undefined);
  assert.match(s.notifications, /외부 메신저 알림 없음/);
});

test('/api/monitor/status: D1 없음, Cron 기록 없음 → degraded + 안내', async () => {
  const s = await (await worker.fetch(new Request('https://x.test/api/monitor/status'), {}, {})).json();
  assert.equal(s.status, 'degraded');
  assert.equal(s.cron.healthy, false);
  assert.match(s.notes.join(), /D1 미설정/);
});

test('/api/monitor/preview: 저장 없이 계산 결과', async () => {
  const now = Date.now();
  const f = makeFetch({ now, specs: SPIKE, markets: ['KRW-SOL'] });
  globalThis.fetch = f.fetch;
  const b = await (await worker.fetch(new Request('https://x.test/api/monitor/preview'), { MONITOR_MARKETS: '1' }, {})).json();
  assert.equal(b.ok, true);
  assert.equal(b.ranking[0].market, 'KRW-SOL');
  assert.deepEqual(f.calls.other, []);
});

test('카카오/Telegram 경로 제거됨 (404/405)', async () => {
  const env = { ADMIN_TOKEN: 'a', KAKAO_REST_API_KEY: 'k' };
  for (const p of ['/kakao/setup', '/kakao/callback?code=x&state=y']) {
    assert.equal((await worker.fetch(new Request('https://x.test' + p), env, {})).status, 404, p);
  }
  for (const p of ['/kakao/connect', '/kakao/test', '/api/admin/kakao-test', '/api/admin/telegram-test']) {
    assert.equal((await worker.fetch(new Request('https://x.test' + p, { method: 'POST' }), env, {})).status, 405, p);
  }
  const idx = JSON.stringify(await (await worker.fetch(new Request('https://x.test/'), {}, {})).json()).toLowerCase();
  assert.ok(!idx.includes('kakao') && !idx.includes('telegram'));
});

test('소스에 카카오/Telegram 코드·import 가 남아 있지 않음', () => {
  for (const f of readdirSync(SRC)) {
    const text = readFileSync(join(SRC, f), 'utf8');
    assert.doesNotMatch(text, /from '\.\/(kakao|telegram)/, f);
    assert.doesNotMatch(text, /KAKAO_|TELEGRAM_|ADMIN_TOKEN|kapi\.kakao|kauth\.kakao|api\.telegram/, f);
  }
  assert.ok(!readdirSync(SRC).some((f) => /kakao|telegram/i.test(f)));
});

test('Worker 는 Binance 를 호출하지 않음 (선물 레이더는 브라우저 전용)', () => {
  for (const f of readdirSync(SRC).filter((x) => x !== 'reachability.js')) {
    assert.doesNotMatch(readFileSync(join(SRC, f), 'utf8'), /binance\.com|binance\.vision/, f);
  }
});
