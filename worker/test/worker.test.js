// 실제 거래소에 접속하지 않고(가짜 fetch 사용) 기본 동작을 확인하는 테스트입니다.
// 실행: worker 폴더에서 `npm test`
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';
import { TARGETS, checkTarget, explain } from '../src/reachability.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const get = (path, init) => worker.fetch(new Request(`https://example.test${path}`, init), {}, {});

const fakeBody = {
  'api.binance.com': { symbol: 'BTCUSDT', price: '65000.00' },
  'data-api.binance.vision': { symbol: 'BTCUSDT', price: '65000.00' },
  'fapi.binance.com': { symbol: 'BTCUSDT', markPrice: '65010.00', lastFundingRate: '0.0001' },
  'api.upbit.com': [{ market: 'KRW-BTC', trade_price: 90000000 }],
};

test('GET /api/health 는 status ok 를 돌려준다', async () => {
  const res = await get('/api/health');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'coin-radar-engine');
  assert.equal(body.phase, 0);
});

test('끝에 / 가 붙어도 동작한다', async () => {
  const res = await get('/api/health/');
  assert.equal(res.status, 200);
});

test('GET / 는 주소 목록을 보여준다', async () => {
  const body = await (await get('/')).json();
  assert.ok(body.endpoints['GET /debug/reachability']);
});

test('없는 주소는 404 JSON', async () => {
  const res = await get('/nope');
  assert.equal(res.status, 404);
  assert.equal((await res.json()).status, 'not_found');
});

test('POST 요청은 405', async () => {
  const res = await get('/api/health', { method: 'POST' });
  assert.equal(res.status, 405);
});

test('/debug/reachability: 모두 성공', async () => {
  globalThis.fetch = async (url) => Response.json(fakeBody[new URL(url).host]);
  const body = await (await get('/debug/reachability')).json();
  assert.equal(body.results.length, TARGETS.length);
  assert.ok(body.results.every((r) => r.reachable));
  assert.match(body.summary, /^✅/);
  const upbit = body.results.find((r) => r.id === 'upbit');
  assert.deepEqual(upbit.sample, { market: 'KRW-BTC', price_krw: 90000000 });
});

test('/debug/reachability: Binance 지역 차단(451)은 실패로 표시', async () => {
  globalThis.fetch = async (url) => {
    const host = new URL(url).host;
    if (host === 'api.binance.com' || host === 'fapi.binance.com') return new Response('blocked', { status: 451 });
    return Response.json(fakeBody[host]);
  };
  const body = await (await get('/debug/reachability')).json();
  const spot = body.results.find((r) => r.id === 'binance_spot');
  assert.equal(spot.reachable, false);
  assert.equal(spot.http_status, 451);
  assert.match(spot.message, /지역 차단/);
  assert.match(body.summary, /^⚠️/);
});

test('네트워크 오류도 서버가 죽지 않고 결과로 보여준다', async () => {
  const r = await checkTarget(TARGETS[0], async () => {
    throw new Error('connection refused');
  });
  assert.equal(r.reachable, false);
  assert.equal(r.http_status, null);
  assert.match(r.message, /connection refused/);
});

test('상태 코드 설명', () => {
  assert.match(explain(200), /정상/);
  assert.match(explain(403), /지역 차단/);
  assert.match(explain(429), /너무 많아/);
  assert.match(explain(502), /거래소 서버/);
});
