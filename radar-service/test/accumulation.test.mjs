import test from 'node:test';
import assert from 'node:assert/strict';
import { H1 } from '../opportunity/indicators.mjs';
import { M15 } from '../signal/evaluate.mjs';
import { ACCUMULATION, accumulationWatch, accumulationMessage } from '../signal/accumulation.mjs';
import { signalStep } from '../signal/step.mjs';

const NOW = 600 * H1 + M15 + 20_000;
const mkHour = () => Array.from({ length: 90 }, (_, i) => {
  const j = i - 60;
  const old = i < 60, c = old ? 100 + Math.sin(i * 1.5) * 0.85 :
    100 + j * 0.017 + Math.sin(i * 1.2) * 0.065;
  const o = c - (old ? 0.09 : 0.10);
  return { t: (510 + i) * H1, o, c, h: c + (old ? 0.6 : 0.2),
    l: c - (old ? 0.6 : 0.58), q: 1000 + (i > 59 && i % 4 !== 0 ? 400 : 0) };
});
test('independent accumulation watch flags compressed sideways price + rising quote-turnover flow', () => {
  const data = mkHour(), ev = accumulationWatch(data, NOW);
  assert.ok(ev, 'expected watch from synthetic compression series');
  assert.equal(ev.stage, 'WATCH');
  assert.ok(ev.cmf > 0 && ev.flow > 0 && ev.squeeze < ACCUMULATION.squeezeRatio);
  assert.ok(ev.upper > ev.close && ev.lower < ev.close && ev.score >= 55);
  const text = accumulationMessage('DOGEUSDT', ev, null);
  assert.match(text.plain, /매집 의심/);
  assert.match(text.plain, /주문 아님/);
  assert.match(text.plain, /BTC 비교/);
  assert.doesNotMatch(text.plain, /진입 관심가|1차 목표|R9 v1/);
});
test('volume-supported confirmed breakout is an observation, not a chase recommendation', () => {
  const c = mkHour(), upper = Math.max(...c.slice(-25, -1).map(b => b.h));
  const last = c.at(-1);
  last.o = upper - 0.25; last.c = upper * 1.004; last.h = last.c + 0.07;
  last.l = last.o - 0.22; last.q = 2700;
  const ev = accumulationWatch(c, NOW);
  assert.equal(ev?.stage, 'BREAKOUT', JSON.stringify(ev));
  assert.match(accumulationMessage('DOGEUSDT', ev, null).plain, /추격 진입 금지/);
});
test('rejects stale/future/invalid candles and non-positive directional money-flow', () => {
  const c = mkHour();
  assert.equal(accumulationWatch(c, NOW + 2 * H1), null, 'stale');
  assert.equal(accumulationWatch(c, NOW - H1), null, 'future');
  assert.equal(accumulationWatch(c.map((b, i) => i === 10 ? { ...b, q: null } : b), NOW), null);
  assert.equal(accumulationWatch(c.map((b, i) => i === 75 ? { ...b, t: b.t + H1 } : b), NOW), null);
  const down = mkHour();
  for (let i = 69; i < down.length; i++) {
    down[i].c = 100.5 - (i - 69) * 0.035;
    down[i].o = down[i].c + 0.12; down[i].h = down[i].o + 0.18;
    down[i].l = down[i].c - 0.44;
  }
  assert.equal(accumulationWatch(down, NOW), null, 'selling pressure must not be labeled accumulation');
});
test('legacy signal, EMA, paper and RICH300 untouched; throttled watch only when expressly enabled', async () => {
  const c1h = mkHour();
  const collectHour = async () => ({ calls: 0, coins: { 'DOGE-USDT-SWAP': { symbol: 'DOGEUSDT', status: 'fresh', c1h, c4h: [] } }, btc4h: null });
  const collectM15 = async () => ({ calls: 0, coins: {} });
  async function run(flag) {
    const state = {}, sent = [];
    const input = { now: NOW, state, env: { RADAR_SIGNAL: 'on', RADAR_ACCUMULATION_WATCH: flag,
        RADAR_RICH300_FEED: 'on', RADAR_RICH300_BUTTONS: 'on', RADAR_EMA_PULLBACK: 'off' },
      send: async (text) => { sent.push(text); }, save: async () => {},
      collectHour, collectM15, analyze: () => ({ status: 'ok', stage: 0 }),
      scanAll: true, force: true };
    const first = await signalStep(input), second = await signalStep(input);
    return { first, second, state, sent };
  }
  const off = await run('off');
  assert.equal(off.sent.length, 0);
  const preview = await run('preview');
  assert.equal(preview.sent.length, 0);
  assert.ok(preview.first.accumulation.observed > 0);
  const live = await run('on');
  assert.equal(live.sent.length, 1, 'cooldown prevents repeat within same 18-hour window');
  assert.equal(live.first.sentMessages, 1);
  assert.equal(live.first.accumulation.selected, 1);
  assert.equal(live.second.accumulation.selected, 0);
  assert.equal(live.state.signal.accumulation.sent['DOGEUSDT:WATCH'], NOW);
  assert.deepEqual(live.state.signal.coins, {}, 'legacy candidates untouched');
  assert.equal(live.state.signal.feed, undefined, 'watch must never feed RICH300');
  assert.equal(live.state.signal.paper, undefined, 'watch must not create paper trades');
  assert.doesNotMatch(live.sent[0], /R9 v1/);
});
