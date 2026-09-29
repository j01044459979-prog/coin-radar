// 24시간 감시 실행(Cron) · D1 저장 · Telegram · 상태 API 통합 테스트
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { runMonitor, memory } from '../src/monitor.js';
import { resetSchemaFlagForTests } from '../src/store.js';
import { FakeD1, makeFetch, MIN } from './helpers.js';

const SECRETS = { TELEGRAM_BOT_TOKEN: 'TEST-TOKEN-NOT-REAL', TELEGRAM_CHAT_ID: '123' };
const SPIKE = { 'KRW-SOL': { spike: { minutes: 5, q: 4e8, pricePct: 3 } } };
const HOT = { 'KRW-SOL': { spike: { minutes: 5, q: 6e8, pricePct: 6 } } };
const T = Date.UTC(2026, 8, 28, 5, 37, 2);

const realFetch = globalThis.fetch;
beforeEach(() => {
  resetSchemaFlagForTests();
  memory.lastRun = null;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('D1·Secret 없음: 감시 계산은 정상, 알림은 건너뜀', async () => {
  const f = makeFetch({ now: T, specs: SPIKE });
  const run = await runMonitor({ MONITOR_MARKETS: '15' }, T, { fetchImpl: f.fetch, candleIntervalMs: 0 });
  assert.equal(run.ok, true);
  assert.equal(run.markets, 4); // KRW-USDT(스테이블) 제외
  assert.equal(run.analyzed, 4);
  assert.equal(run.summary[0].market, 'KRW-SOL');
  assert.equal(run.summary[0].score, 88);
  assert.equal(run.summary[0].labels, '가격 급변 + 거래량 이상');
  assert.equal(run.events, 1);
  assert.equal(f.calls.telegram.length, 0);
  assert.match(run.notes.join(), /D1 미설정/);
  assert.equal(f.calls.upbit, 2 + 4 * 2); // 목록 1 + 현재가 1 + 종목당 캔들 2
});

test('D1 있음, Secret 없음: 이벤트 저장, Telegram 요청 없음', async () => {
  const DB = new FakeD1();
  const f = makeFetch({ now: T, specs: SPIKE });
  const run = await runMonitor({ DB }, T, { fetchImpl: f.fetch, candleIntervalMs: 0 });
  assert.equal(run.ok, true);
  assert.equal(f.calls.telegram.length, 0);
  assert.equal(run.alerts[0].why, 'Telegram Secret 미설정');
  assert.equal(DB.rows('SELECT * FROM events').length, 1);
  assert.equal(DB.rows('SELECT * FROM alerts').length, 0);
  assert.equal(DB.rows('SELECT * FROM monitor_runs').length, 1);
});

test('D1 + Secret: 중요 이벤트 1회 알림 → 다음 분 cooldown → 과열로 상향 시 1회 더', async () => {
  const DB = new FakeD1();
  const env = { DB, ...SECRETS };

  const f1 = makeFetch({ now: T, specs: SPIKE });
  const r1 = await runMonitor(env, T, { fetchImpl: f1.fetch, candleIntervalMs: 0 });
  assert.equal(r1.alertsSent, 1);
  assert.equal(f1.calls.telegram.length, 1);
  const text = f1.calls.telegram[0].body.text;
  assert.equal(f1.calls.telegram[0].body.chat_id, '123');
  for (const s of ['COIN RADAR', 'SOL (KRW-SOL)', '시간 구간: 5분', '가격 변화율: +3.00%', '거래 활동: 4.0배', '상태: 가격 급변 + 거래량 이상', '레이더 점수: 88', '발생 시각: 2026-09-28 14:37:02 KST']) {
    assert.ok(text.includes(s), s);
  }

  // 같은 움직임이 이어지는 다음 분: cooldown 으로 알림 없음
  const T2 = T + MIN;
  const f2 = makeFetch({ now: T2, specs: SPIKE });
  const r2 = await runMonitor(env, T2, { fetchImpl: f2.fetch, candleIntervalMs: 0 });
  assert.equal(f2.calls.telegram.length, 0);
  assert.match(r2.alerts[0].why, /cooldown/);

  // 같은 분에 Cron 이 한 번 더 실행돼도 중복 전송 없음 (dedup_key)
  const f2b = makeFetch({ now: T2, specs: SPIKE });
  await runMonitor(env, T2, { fetchImpl: f2b.fetch, candleIntervalMs: 0 });
  assert.equal(f2b.calls.telegram.length, 0);

  // 과열로 상태 등급 상승 → 1회 허용
  const T3 = T + 2 * MIN;
  const f3 = makeFetch({ now: T3, specs: HOT });
  const r3 = await runMonitor(env, T3, { fetchImpl: f3.fetch, candleIntervalMs: 0 });
  assert.equal(f3.calls.telegram.length, 1);
  assert.match(f3.calls.telegram[0].body.text, /상태 상향[\s\S]*상태: 과열/);
  assert.equal(r3.alertsSent, 1);

  const alerts = DB.rows('SELECT market, status, level FROM alerts ORDER BY id');
  assert.deepEqual(alerts.map((a) => [a.market, a.status, a.level]), [['KRW-SOL', 'sent', 'alert'], ['KRW-SOL', 'sent', 'overheat']]);
  assert.equal(DB.rows('SELECT * FROM monitor_runs').length, 4);
});

test('중요하지 않은 움직임은 이벤트/알림 없음', async () => {
  const DB = new FakeD1();
  const f = makeFetch({ now: T });
  const run = await runMonitor({ DB, ...SECRETS }, T, { fetchImpl: f.fetch, candleIntervalMs: 0 });
  assert.equal(run.events, 0);
  assert.equal(f.calls.telegram.length, 0);
  assert.equal(DB.rows('SELECT * FROM events').length, 0);
});

test('Telegram 전송 실패는 기록하고 Worker 는 계속 동작', async () => {
  const DB = new FakeD1();
  const f = makeFetch({ now: T, specs: SPIKE, telegramStatus: 401 });
  const run = await runMonitor({ DB, ...SECRETS }, T, { fetchImpl: f.fetch, candleIntervalMs: 0 });
  assert.equal(run.ok, true);
  assert.equal(run.alertsSent, 0);
  assert.deepEqual(DB.rows('SELECT status, reason FROM alerts'), [{ status: 'failed', reason: 'Telegram HTTP 401' }]);
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
  const f = makeFetch({ now, specs: SPIKE });
  globalThis.fetch = f.fetch;
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
  assert.deepEqual(s.telegram, { configured: false, ready: false });
  assert.ok(s.latest_ranking.length >= 1);
  assert.equal(s.recent_events[0].market, 'KRW-SOL');
  assert.ok(!JSON.stringify(s).includes('TEST-TOKEN')); // Secret 값은 절대 노출하지 않음
});

test('/api/monitor/status: D1 없음, Cron 기록 없음 → degraded + 안내', async () => {
  const res = await worker.fetch(new Request('https://x.test/api/monitor/status'), { ...SECRETS }, {});
  const s = await res.json();
  assert.equal(s.status, 'degraded');
  assert.equal(s.cron.healthy, false);
  assert.deepEqual(s.telegram, { configured: true, ready: false });
  assert.match(s.notes.join(), /D1 미설정/);
  assert.ok(!JSON.stringify(s).includes('TEST-TOKEN'));
});

test('/api/monitor/preview: 저장·알림 없이 계산 결과', async () => {
  const now = Date.now();
  const f = makeFetch({ now, specs: SPIKE, markets: ['KRW-SOL'] });
  globalThis.fetch = f.fetch;
  const res = await worker.fetch(new Request('https://x.test/api/monitor/preview'), { ...SECRETS, MONITOR_MARKETS: '1' }, {});
  const b = await res.json();
  assert.equal(b.ok, true);
  assert.equal(b.ranking[0].market, 'KRW-SOL');
  assert.equal(f.calls.telegram.length, 0);
});

test('관리자 Telegram 테스트: ADMIN_TOKEN 없으면 404, 틀리면 401, 맞으면 전송', async () => {
  const post = (env, auth) => worker.fetch(new Request('https://x.test/api/admin/telegram-test', { method: 'POST', headers: auth ? { authorization: auth } : {} }), env, {});
  assert.equal((await post({ ...SECRETS })).status, 404);
  const env = { ...SECRETS, ADMIN_TOKEN: 'admin-test-value' };
  assert.equal((await post(env, 'Bearer wrong')).status, 401);
  assert.equal((await post(env)).status, 401);
  const f = makeFetch({ now: Date.now() });
  globalThis.fetch = f.fetch;
  const ok = await post(env, 'Bearer admin-test-value');
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);
  assert.equal(f.calls.telegram.length, 1);
  assert.doesNotMatch(f.calls.telegram[0].body.text, /매수|매도|롱|숏/);
  // GET 은 허용되지 않음
  const get = await worker.fetch(new Request('https://x.test/api/admin/telegram-test'), env, {});
  assert.equal(get.status, 404);
});
