import test from 'node:test';
import assert from 'node:assert/strict';
import { bonkEnabled, BONK_INTERVAL_MS, bonkFollowupMessage, checkBonkFollowup } from '../position-followup.mjs';

const BASE = Date.UTC(2026, 10, 16, 12, 5);
const hour = 3600000;
const makeC = (n, base, step, h) => Array.from({ length: n }, (_, i) => {
  const close = base + step * i;
  return { t: BASE - (n - i) * h, o: close, c: close, h: close * 1.01, l: close * 0.99, q: 1e6 + i * 1e4 };
});
const bonk = { status: 'fresh', c1h: makeC(30, .00001, .00000001, hour), c4h: makeC(10, .00001, .00000003, 4 * hour) };
const btc = { status: 'fresh', c1h: makeC(30, 90000, -10, hour), c4h: makeC(10, 90000, -20, 4 * hour) };
const collect = async () => ({ coins: { 'BONK-USDT-SWAP': bonk, 'BTC-USDT-SWAP': btc } });
const env = { RADAR_BONK_FOLLOWUP: 'on' };

test('default off and explicit opt-in only', async () => {
  assert.equal(bonkEnabled({}), false);
  assert.equal(bonkEnabled(env), true);
  const r = await checkBonkFollowup({ env: {}, state: {}, send: async () => { throw Error('not called'); } });
  assert.equal(r.status, 'off');
});

test('first Telegram send then once each 3 hours (no duplicates)', async () => {
  const messages = [], state = { other: { untouched: true } };
  let saved = 0, collected = 0;
  const opts = {
    state, env, getTicker: async () => .000011, send: async t => { messages.push(t); },
    save: async () => { saved++; }, collect: async () => { collected++; return collect(); },
  };
  assert.equal((await checkBonkFollowup({ ...opts, now: BASE })).status, 'sent');
  assert.match(messages[0], /BONK 보유 관찰/);
  assert.match(messages[0], /BTC/);
  assert.match(messages[0], /계정과 미연동/);
  assert.equal((await checkBonkFollowup({ ...opts, now: BASE + hour })).status, 'cooldown');
  assert.equal((await checkBonkFollowup({ ...opts, now: BASE + BONK_INTERVAL_MS })).status, 'sent');
  assert.equal(messages.length, 2);
  assert.equal(saved, 2);
  assert.equal(collected, 2);
  assert.deepEqual(state.other, { untouched: true });
});

test('stale candles never send or consume cooldown', async () => {
  const state = {}, calls = [];
  const result = await checkBonkFollowup({
    state, now: BASE, env, collect: async () => ({
      coins: { 'BONK-USDT-SWAP': { status: 'pending', reason: 'confirmation pending' } },
    }), send: async m => calls.push(m),
  });
  assert.equal(result.status, 'deferred');
  assert.equal(calls.length, 0);
  assert.equal(state.bonkFollowup, undefined);
});

test('Telegram failure cannot advance last sent time', async () => {
  const state = {};
  await assert.rejects(() => checkBonkFollowup({ state, now: BASE, env, collect,
    getTicker: async () => null, send: async () => { throw new Error('Telegram'); } }), /Telegram/);
  assert.equal(state.bonkFollowup, undefined);
});

test('fallback uses closed 1H price and never calls it realtime', () => {
  const message = bonkFollowupMessage({ bonk, btc, ticker: null, now: BASE });
  assert.match(message, /최근 확정 1H 종가/);
  assert.doesNotMatch(message, /최근 체결가/);
});

test('state safety guard suppresses sends when current hour is marked quiet', async () => {
  const r = await checkBonkFollowup({ state: { quiet: { hour: Math.floor(BASE / hour) } },
    now: BASE, env, send: async () => { throw Error('not called'); } });
  assert.equal(r.status, 'suppressed');
});
