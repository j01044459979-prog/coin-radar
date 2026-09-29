// 24시간 감시 실행(Cron) · D1 저장 · 카카오톡 알림 · 상태 API 통합 테스트
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { runMonitor, memory } from '../src/monitor.js';
import { resetSchemaFlagForTests } from '../src/store.js';
import { resetKakaoSchemaFlagForTests, exchangeCode } from '../src/kakao.js';
import { FakeD1, makeFetch, MIN } from './helpers.js';

// 테스트용 가짜 값 (실제 키/토큰 아님)
const KAKAO = { KAKAO_REST_API_KEY: 'test-rest-key', KAKAO_CLIENT_SECRET: 'test-client-secret' };
const SPIKE = { 'KRW-SOL': { spike: { minutes: 5, q: 4e8, pricePct: 3 } } };
const HOT = { 'KRW-SOL': { spike: { minutes: 5, q: 6e8, pricePct: 6 } } };
const T = Date.UTC(2026, 8, 28, 5, 37, 2);

const realFetch = globalThis.fetch;
beforeEach(() => {
  resetSchemaFlagForTests();
  resetKakaoSchemaFlagForTests();
  memory.lastRun = null;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// 카카오 계정 연결(최초 1회)을 흉내
async function linked(now = T, kakao = {}) {
  const DB = new FakeD1();
  const env = { DB, ...KAKAO };
  const f = makeFetch({ now, kakao });
  const r = await exchangeCode(env, DB, 'test-code', 'https://x.test/kakao/callback', now, f.fetch);
  assert.equal(r.ok, true);
  return { DB, env };
}

test('D1·Kakao Secret 없음: 감시 계산은 정상, 알림은 건너뜀', async () => {
  const f = makeFetch({ now: T, specs: SPIKE });
  const run = await runMonitor({ MONITOR_MARKETS: '15' }, T, { fetchImpl: f.fetch, candleIntervalMs: 0 });
  assert.equal(run.ok, true);
  assert.equal(run.markets, 4); // KRW-USDT(스테이블) 제외
  assert.equal(run.analyzed, 4);
  assert.equal(run.summary[0].market, 'KRW-SOL');
  assert.equal(run.summary[0].score, 88);
  assert.equal(run.summary[0].labels, '가격 급변 + 거래량 이상');
  assert.equal(run.events, 1);
  assert.equal(f.calls.memo.length + f.calls.token.length, 0);
  assert.match(run.notes.join(), /D1 미설정/);
  assert.equal(f.calls.upbit, 2 + 4 * 2); // 목록 1 + 현재가 1 + 종목당 캔들 2
});

test('D1 있음, Kakao Secret 없음: 이벤트 저장, 카카오 요청 없음', async () => {
  const DB = new FakeD1();
  const f = makeFetch({ now: T, specs: SPIKE });
  const run = await runMonitor({ DB }, T, { fetchImpl: f.fetch, candleIntervalMs: 0 });
  assert.equal(run.ok, true);
  assert.equal(f.calls.memo.length + f.calls.token.length, 0);
  assert.equal(run.alerts[0].why, 'Kakao Secret 미설정');
  assert.equal(DB.rows('SELECT * FROM events').length, 1);
  assert.equal(DB.rows('SELECT * FROM alerts').length, 0);
  assert.equal(DB.rows('SELECT * FROM monitor_runs').length, 1);
});

test('Kakao Secret 있음, 계정 미연결: 알림 건너뜀 + 연결 안내', async () => {
  const DB = new FakeD1();
  const f = makeFetch({ now: T, specs: SPIKE });
  const run = await runMonitor({ DB, ...KAKAO }, T, { fetchImpl: f.fetch, candleIntervalMs: 0 });
  assert.equal(f.calls.memo.length, 0);
  assert.match(run.alerts[0].why, /카카오 미연결/);
});

test('연결됨: 중요 이벤트 1회 알림 → 다음 분 cooldown → 같은 분 재실행 dedup → 과열 상향 1회', async () => {
  const { DB, env } = await linked();

  const f1 = makeFetch({ now: T, specs: SPIKE });
  const r1 = await runMonitor(env, T, { fetchImpl: f1.fetch, candleIntervalMs: 0 });
  assert.equal(r1.alertsSent, 1);
  assert.equal(f1.calls.memo.length, 1);
  const { auth, template } = f1.calls.memo[0];
  assert.equal(auth, 'Bearer test-access-1'); // 연결 때 받은 Access Token 사용 (아직 유효 → 갱신 없음)
  assert.equal(f1.calls.token.length, 0);
  assert.equal(template.object_type, 'text');
  assert.equal(template.button_title, 'COIN RADAR 보기');
  assert.equal(template.link.web_url, 'https://j01044459979-prog.github.io/coin-radar/');
  assert.ok(template.text.length <= 200);
  for (const s of ['COIN RADAR', 'SOL 가격 급변 + 거래량 이상 감지', '⏱ 5분', '💰 가격변동 +3.00%', '📊 거래활동 4.0배', '🎯 Radar Score 88', '🕒 09-28 14:37 KST']) {
    assert.ok(template.text.includes(s), s);
  }

  const T2 = T + MIN;
  const f2 = makeFetch({ now: T2, specs: SPIKE });
  const r2 = await runMonitor(env, T2, { fetchImpl: f2.fetch, candleIntervalMs: 0 });
  assert.equal(f2.calls.memo.length, 0);
  assert.match(r2.alerts[0].why, /cooldown/);

  const f2b = makeFetch({ now: T2, specs: SPIKE });
  await runMonitor(env, T2, { fetchImpl: f2b.fetch, candleIntervalMs: 0 });
  assert.equal(f2b.calls.memo.length, 0);

  const T3 = T + 2 * MIN;
  const f3 = makeFetch({ now: T3, specs: HOT });
  const r3 = await runMonitor(env, T3, { fetchImpl: f3.fetch, candleIntervalMs: 0 });
  assert.equal(f3.calls.memo.length, 1);
  assert.match(f3.calls.memo[0].template.text, /상태 상향[\s\S]*과열 감지[\s\S]*🔥 과열/);
  assert.equal(r3.alertsSent, 1);

  const alerts = DB.rows('SELECT market, status, level FROM alerts ORDER BY id');
  assert.deepEqual(alerts.map((a) => [a.market, a.status, a.level]), [['KRW-SOL', 'sent', 'alert'], ['KRW-SOL', 'sent', 'overheat']]);
  assert.equal(DB.rows('SELECT * FROM monitor_runs').length, 4);
});

test('중요하지 않은 움직임은 이벤트/알림 없음', async () => {
  const { DB, env } = await linked();
  const f = makeFetch({ now: T });
  const run = await runMonitor(env, T, { fetchImpl: f.fetch, candleIntervalMs: 0 });
  assert.equal(run.events, 0);
  assert.equal(f.calls.memo.length, 0);
  assert.equal(DB.rows('SELECT * FROM events').length, 0);
});

test('Cron 이 Access Token 만료 10분 전에 자동 갱신 (Refresh Token 회전 포함)', async () => {
  const { DB, env } = await linked();
  // 6시간 가까이 지남 → 갱신 필요
  const later = T + 6 * 60 * MIN - 5 * MIN;
  const f = makeFetch({ now: later, kakao: { rotate: true, seqStart: 1 } });
  await runMonitor(env, later, { fetchImpl: f.fetch, candleIntervalMs: 0 });
  assert.equal(f.calls.token.length, 1);
  assert.equal(f.calls.token[0].grant_type, 'refresh_token');
  assert.equal(f.calls.token[0].refresh_token, 'test-refresh-1');
  assert.equal(f.calls.token[0].client_id, 'test-rest-key');
  assert.equal(f.calls.token[0].client_secret, 'test-client-secret');
  const row = DB.rows('SELECT * FROM kakao_auth')[0];
  assert.ok(row.access_expires_at > later + 5 * 60 * MIN);
  // 다음 분에는 갱신하지 않음
  const f2 = makeFetch({ now: later + MIN });
  await runMonitor(env, later + MIN, { fetchImpl: f2.fetch, candleIntervalMs: 0 });
  assert.equal(f2.calls.token.length, 0);
  // 회전된 새 Refresh Token 으로 다음 갱신
  const much = later + 6 * 60 * MIN;
  const f3 = makeFetch({ now: much });
  await runMonitor(env, much, { fetchImpl: f3.fetch, candleIntervalMs: 0 });
  assert.equal(f3.calls.token[0].refresh_token, 'test-refresh-2');
});

test('전송 중 401(토큰 만료) → 한 번 갱신 후 재시도 성공', async () => {
  const { env } = await linked();
  const f = makeFetch({ now: T, specs: SPIKE, kakao: { expireFirstMemo: true, seqStart: 1 } });
  const run = await runMonitor(env, T, { fetchImpl: f.fetch, candleIntervalMs: 0 });
  assert.equal(run.alertsSent, 1);
  assert.equal(f.calls.memo.length, 2);
  assert.equal(f.calls.token.length, 1);
  assert.equal(f.calls.memo[1].auth, 'Bearer test-access-2');
});

test('카카오 전송 실패는 기록하고 Worker 는 계속 동작', async () => {
  const { DB, env } = await linked();
  const f = makeFetch({ now: T, specs: SPIKE, kakao: { memoStatus: 403 } });
  const run = await runMonitor(env, T, { fetchImpl: f.fetch, candleIntervalMs: 0 });
  assert.equal(run.ok, true);
  assert.equal(run.alertsSent, 0);
  assert.deepEqual(DB.rows('SELECT status FROM alerts'), [{ status: 'failed' }]);
});

test('Refresh Token 만료(invalid_grant) → 재연결 필요 표시, 알림 중단', async () => {
  const { DB, env } = await linked();
  const later = T + 6 * 60 * MIN;
  const f = makeFetch({ now: later, specs: SPIKE, kakao: { refreshError: 'invalid_grant' } });
  const run = await runMonitor(env, later, { fetchImpl: f.fetch, candleIntervalMs: 0 });
  assert.equal(f.calls.memo.length, 0);
  assert.match(run.alerts[0].why, /카카오 미연결/);
  assert.equal(DB.rows('SELECT last_error FROM kakao_auth')[0].last_error, 'reauth_required');
  globalThis.fetch = makeFetch({ now: later }).fetch;
  const s = await (await worker.fetch(new Request('https://x.test/api/monitor/status'), env, {})).json();
  assert.equal(s.kakao.ready, false);
  assert.equal(s.kakao.last_error, 'reauth_required');
});

test('KAKAO_REFRESH_TOKEN Secret 으로도 시작 가능 (D1 로 옮겨 저장)', async () => {
  const DB = new FakeD1();
  const env = { DB, ...KAKAO, KAKAO_REFRESH_TOKEN: 'test-refresh-from-secret' };
  const f = makeFetch({ now: T, specs: SPIKE });
  const run = await runMonitor(env, T, { fetchImpl: f.fetch, candleIntervalMs: 0 });
  assert.equal(f.calls.token[0].refresh_token, 'test-refresh-from-secret');
  assert.equal(run.alertsSent, 1);
  const row = DB.rows('SELECT refresh_enc, refresh_expires_at FROM kakao_auth')[0];
  assert.ok(row.refresh_enc.startsWith('v1.'));
  assert.ok(!row.refresh_enc.includes('test-refresh-from-secret'));
  assert.equal(row.refresh_expires_at, null);
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

test('Cron handler(scheduled) → 실행 기록 → /api/monitor/status (kakao 상태, Telegram 없음)', async () => {
  const now = Date.now();
  const { DB, env } = await linked(now);
  env.MONITOR_MARKETS = '3';
  globalThis.fetch = makeFetch({ now, specs: SPIKE }).fetch;
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
  assert.equal(s.kakao.configured, true);
  assert.equal(s.kakao.linked, true);
  assert.equal(s.kakao.ready, true);
  assert.equal(s.telegram, undefined);
  assert.equal(s.recent_events[0].market, 'KRW-SOL');
  const text = JSON.stringify(s);
  for (const secret of ['test-rest-key', 'test-client-secret', 'test-access', 'test-refresh']) assert.ok(!text.includes(secret), secret);
});

test('/api/monitor/status: D1 없음, Cron 기록 없음 → degraded + 안내', async () => {
  const s = await (await worker.fetch(new Request('https://x.test/api/monitor/status'), { ...KAKAO }, {})).json();
  assert.equal(s.status, 'degraded');
  assert.equal(s.cron.healthy, false);
  assert.deepEqual(s.kakao, { configured: true, ready: false });
  assert.match(s.notes.join(), /D1 미설정/);
  assert.ok(!JSON.stringify(s).includes('test-rest-key'));
});

test('/api/monitor/preview: 저장·알림 없이 계산 결과', async () => {
  const now = Date.now();
  const f = makeFetch({ now, specs: SPIKE, markets: ['KRW-SOL'] });
  globalThis.fetch = f.fetch;
  const b = await (await worker.fetch(new Request('https://x.test/api/monitor/preview'), { ...KAKAO, MONITOR_MARKETS: '1' }, {})).json();
  assert.equal(b.ok, true);
  assert.equal(b.ranking[0].market, 'KRW-SOL');
  assert.equal(f.calls.memo.length, 0);
});

test('Telegram 경로는 제거됨', async () => {
  const r = await worker.fetch(new Request('https://x.test/api/admin/telegram-test', { method: 'POST' }), { ADMIN_TOKEN: 'a' }, {});
  assert.equal(r.status, 405);
});
