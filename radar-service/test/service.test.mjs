import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, applyBtcFilter, reportText } from '../analysis.mjs';
import { ApiError, cycle, telegramSender, createCollector } from '../service.mjs';
const now = 1800000000000;
function raw() {
  return {
    klines: Array.from({ length: 60 }, (_, i) => {
      const t = now - (60 - i) * 300000;
      const c = i === 59 ? 102 : 100 + i / 100;
      return [t, c - .2, c + .3, c - .3, c, 1, t + 299999, i === 59 ? 300 : 100];
    }),
    premium: { symbol: 'BTCUSDT', markPrice: '102', lastFundingRate: '0.0001', time: now },
    oi: { symbol: 'BTCUSDT', openInterest: '103', time: now },
    history: [{ timestamp: now - 900000, sumOpenInterest: '100', sumOpenInterestValue: '10000' }],
  };
}
test('completed breakout, volume and OI produce numeric watch levels', () => {
  const r = analyze('BTCUSDT', raw(), now);
  assert.equal(r.direction, 'LONG'); assert.equal(r.oi15, 3);
  assert.ok(r.stop < r.level); assert.equal(r.volume, 3);
});
test('all conditions produce strong LONG, funding or low volume suppresses it', () => {
  const data = raw(); data.premium.markPrice = '101.2';
  assert.equal(analyze('BTCUSDT', data, now).strong, true);
  data.premium.lastFundingRate = '0.001';
  assert.equal(analyze('BTCUSDT', data, now).strong, false);
  data.premium.lastFundingRate = '0'; data.klines[59][7] = 100;
  assert.equal(analyze('BTCUSDT', data, now).strong, false);
});
test('bearish breakout produces SHORT with stop above level', () => {
  const data = raw();
  data.klines = data.klines.map(r => [r[0], 200-r[1], 200-r[3], 200-r[2], 200-r[4], r[5], r[6], r[7]]);
  data.premium.markPrice = '98.8';
  const row = analyze('BTCUSDT', data, now);
  assert.equal(row.direction, 'SHORT'); assert.equal(row.strong, true); assert.ok(row.stop > row.level);
});
test('open candle is ignored', () => {
  const data = raw(); data.klines.push([now, 999, 1000, 998, 999, 1, now + 299999, 999999]);
  assert.deepEqual(analyze('BTCUSDT', data, now), analyze('BTCUSDT', raw(), now));
});
for (const [name, change] of [
  ['stale mark', d => { d.premium.time -= 300000; }],
  ['future mark', d => { d.premium.time += 120000; }],
  ['missing OI', d => { d.history = []; }],
  ['missing funding', d => { d.premium.lastFundingRate = null; }],
  ['candle gap', d => { d.klines.splice(20, 1); }],
  ['bad candle', d => { d.klines[59][4] = 'NaN'; }],
  ['wrong symbol', d => { d.oi.symbol = 'OTHERUSDT'; }],
]) test(`${name} blocks analysis`, () => { const d = raw(); change(d); assert.throws(() => analyze('BTCUSDT', d, now)); });
test('BTC missing or opposite move vetoes strong signal', () => {
  const row = { symbol: 'ETHUSDT', direction: 'LONG', strong: true };
  assert.equal(applyBtcFilter([row])[0].strong, false);
  assert.equal(applyBtcFilter([{ symbol: 'BTCUSDT', change15: -1 }, row])[1].strong, false);
});
test('hourly report states no conditions rather than inventing a pick', () => {
  assert.match(reportText([], [{ symbol: 'BTCUSDT' }], now), /검증된 강한 조건 없음/);
});
test('hourly send is once per hour, signal is cooled down across saved state', async () => {
  let state = {}, messages = [], saved;
  const row = { ...analyze('BTCUSDT', raw(), now), strong: true };
  const options = { collect: async () => ({ rows: [row], failures: [] }), send: async t => messages.push(t), save: async s => { saved = structuredClone(s); } };
  await cycle({ ...options, now, state });
  state = saved;
  await cycle({ ...options, now: now + 300000, state });
  assert.equal(messages.length, 1);
  await cycle({ ...options, now: now + 3600000, state });
  assert.equal(messages.length, 2);
});
test('a new intrahour condition sends immediately and does not repeat', async () => {
  const state = { reportHour: Math.floor(now / 3600000) }; let count = 0;
  const row = { ...analyze('BTCUSDT', raw(), now), strong: true };
  const options = { state, collect: async () => ({ rows: [row], failures: [] }), send: async () => count++, save: async () => {} };
  await cycle({ ...options, now }); await cycle({ ...options, now: now + 300000 });
  assert.equal(count, 1);
});
test('failed Telegram delivery does not acknowledge hourly report', async () => {
  const state = {};
  await assert.rejects(cycle({ now, state, collect: async () => ({ rows: [], failures: [] }), send: async () => { throw Error('failed'); }, save: async () => {} }));
  assert.equal(state.reportHour, undefined);
});
test('region denial stops scanning and suppresses signals for one hour', async () => {
  const state = {}; const messages = []; let calls = 0;
  const options = { state, collect: async () => { calls++; throw new ApiError('binance', 403); }, send: async t => messages.push(t), save: async () => {} };
  await cycle({ ...options, now }); await cycle({ ...options, now: now + 300000 });
  assert.equal(calls, 1); assert.equal(messages.length, 1); assert.match(messages[0], /수집 장애/);
});
test('rate limit respects Retry-After', async () => {
  const state = {};
  await cycle({ now, state, collect: async () => { throw new ApiError('binance', 429, 7200); }, send: async () => {}, save: async () => {} });
  assert.equal(state.retryAt, now + 7200000);
});
test('Telegram refuses group targets and requires confirmed response', async () => {
  assert.throws(() => telegramSender('token', '-123'));
  const send = telegramSender('token', '123', async () => new Response(JSON.stringify({ ok: false }), { status: 200 }));
  await assert.rejects(send('test'), /전송 미확인/);
});
test('Telegram network errors never expose bot token', async () => {
  const send = telegramSender('secret-token', '123', async url => { throw Error(url); });
  await assert.rejects(send('test'), e => !e.message.includes('secret-token'));
});
test('collector stops at first region rejection', async () => {
  let calls = 0;
  const collect = createCollector(async () => { calls++; return new Response('', { status: 451 }); });
  await assert.rejects(collect(now), e => e.status === 451); assert.equal(calls, 1);
});
