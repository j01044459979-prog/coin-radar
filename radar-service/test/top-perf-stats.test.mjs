import test from 'node:test';
import assert from 'node:assert/strict';
import { percentile, mean, summarize, instrument, rateLimited } from '../perf/top-perf-stats.mjs';

test('백분위·요약: 최근접 순위 방식, 빈 입력은 null', () => {
  assert.equal(percentile([], 95), null); assert.equal(percentile([5], 95), 5);
  const a = Array.from({ length: 20 }, (_, i) => i + 1); assert.equal(percentile(a, 95), 19); assert.equal(percentile(a, 50), 10); assert.equal(percentile(a, 100), 20);
  assert.deepEqual(summarize([1, 2, 3]), { n: 3, mean: 2, p50: 2, p95: 3, max: 3, min: 1 }); assert.equal(mean([]), null);
});
test('계측 fetcher: 호출 수·HTTP 상태·OKX code·지연을 세고 원래 응답 본문은 그대로 읽을 수 있다(429·50011은 제한으로 센다)', async () => {
  const resp = [new Response(JSON.stringify({ code: '0', data: [] }), { status: 200 }), new Response(JSON.stringify({ code: '50011' }), { status: 200 }), new Response('', { status: 429 }), new Response(JSON.stringify({ code: '0' }), { status: 200 })];
  let k = 0; const f = instrument(async () => { if (k === 3) throw new Error('net'); return resp[k++]; });
  const r1 = await f('u'); assert.deepEqual(await r1.json(), { code: '0', data: [] });
  await f('u'); await f('u'); await assert.rejects(f('u'));
  assert.equal(f.stats.calls, 4); assert.equal(f.stats.http[200], 2); assert.equal(f.stats.http[429], 1); assert.equal(f.stats.okxCode['50011'], 1); assert.equal(f.stats.net, 1); assert.equal(rateLimited(f.stats), 2);
});
