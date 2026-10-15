import test from 'node:test';
import assert from 'node:assert/strict';
import { collectOkxHistory, validateHistoryCoverage, FIVE_MINUTES } from '../history-v3.mjs';

const START = 1800000000000;
const makeCandles = (n = 230) => Array.from({ length: n }, (_, i) => {
  const t = START + i * FIVE_MINUTES, price = 100 + i * 0.01;
  return [String(t), String(price), String(price + 0.5), String(price - 0.5),
    String(price + 0.2), '10', '10', '1000', '1'];
});
function mockPages(rows, { failOnce = false, badCode = null } = {}) {
  const calls = [], waits = [];
  let failures = 0;
  const fetcher = async url => {
    const u = new URL(url);
    calls.push({ path: u.pathname, cursor: Number(u.searchParams.get('after')),
      limit: Number(u.searchParams.get('limit')), instId: u.searchParams.get('instId'), bar: u.searchParams.get('bar') });
    if (failOnce && failures++ === 0) return { ok: false, status: 429, headers: { get: () => '1' } };
    const cursor = Number(u.searchParams.get('after'));
    const page = rows.filter(x => Number(x[0]) < cursor).sort((a, b) => Number(b[0]) - Number(a[0]))
      .slice(0, Number(u.searchParams.get('limit')));
    return { ok: true, json: async () => ({ code: badCode ?? '0', data: page }) };
  };
  return { fetcher, calls, waits, pause: async ms => waits.push(ms) };
}
const params = (fixture, n = 230) => ({
  instId: 'BTC-USDT-SWAP', from: START, to: START + n * FIVE_MINUTES,
  fetcher: fixture.fetcher, pause: fixture.pause, gapMs: 0, limit: 100,
});

test('OKX "after" uses an exclusive older-than cursor, merges >1 page in UTC ascending order', async () => {
  const fixture = mockPages(makeCandles());
  const data = await collectOkxHistory(params(fixture));
  assert.equal(data.source, 'OKX');
  assert.equal(data.fetchedPages, 3);
  assert.equal(data.candles.length, 230);
  assert.equal(data.quality.coveragePercent, 100);
  assert.equal(data.candles[0].t, START);
  assert.equal(data.candles.at(-1).t, START + 229 * FIVE_MINUTES);
  assert.equal(fixture.calls[0].cursor, START + 230 * FIVE_MINUTES);
  assert.equal(fixture.calls[1].cursor, START + 130 * FIVE_MINUTES);
  assert.equal(fixture.calls[2].cursor, START + 30 * FIVE_MINUTES);
  assert.ok(fixture.calls.every(x => x.path === '/api/v5/market/history-candles' &&
    x.limit === 100 && x.bar === '5m' && x.instId === 'BTC-USDT-SWAP'));
});

test('rejects missing 5m bars, even if API pages look superficially valid', async () => {
  const rows = makeCandles().filter((_, i) => i !== 105);
  const fixture = mockPages(rows);
  await assert.rejects(collectOkxHistory(params(fixture)), /Incomplete historical coverage/);
});

test('rejects unconfirmed bar instead of leaking a live bar into research', async () => {
  const rows = makeCandles();
  rows[205][8] = '0';
  const fixture = mockPages(rows);
  await assert.rejects(collectOkxHistory(params(fixture)), /Incomplete OKX historical candle/);
});

test('429 is retried only within bounded rules, with Retry-After backoff', async () => {
  const fixture = mockPages(makeCandles(), { failOnce: true });
  const data = await collectOkxHistory(params(fixture));
  assert.equal(data.quality.actual, 230);
  assert.ok(fixture.waits.includes(2000));
});

test('403 and 451 are not circumvented or retried', async () => {
  for (const status of [403, 451]) {
    let calls = 0;
    const fetcher = async () => { calls++; return { ok: false, status, headers: { get: () => null } }; };
    await assert.rejects(collectOkxHistory({ ...params(mockPages([])), fetcher }), new RegExp(String(status)));
    assert.equal(calls, 1);
  }
});

test('reject malformed OKX response, invalid symbols and insufficient page budget', async () => {
  const fixture = mockPages(makeCandles(), { badCode: '50000' });
  await assert.rejects(collectOkxHistory(params(fixture)), /API error/);
  await assert.rejects(collectOkxHistory({ ...params(mockPages(makeCandles())), instId: 'BTCUSDT' }), /USDT perpetual/);
  await assert.rejects(collectOkxHistory({ ...params(mockPages(makeCandles())), maxPages: 1 }), /page budget/);
  assert.throws(() => validateHistoryCoverage([], START, START + FIVE_MINUTES), /Incomplete historical coverage/);
});
