import test from 'node:test';
import assert from 'node:assert/strict';
import { H1 } from '../opportunity/indicators.mjs';
import { M15 } from '../signal/evaluate.mjs';
import { signalStep } from '../signal/step.mjs';
import { accumulationAutoInterests } from '../signal/auto-interest.mjs';
import { feedArtifactOf } from '../signal/feed.mjs';

// Realistic present-day timestamps; all market candles are synthetic.
const CLOSE = Date.UTC(2026, 10, 19, 7, 0, 0);
const NOW = CLOSE + M15 + 20000;
const mkHour = () => Array.from({ length: 90 }, (_, i) => {
  const j = i - 60, old = i < 60;
  const c = old ? 100 + Math.sin(i * 1.5) * 0.85 :
    100 + j * 0.017 + Math.sin(i * 1.2) * 0.065;
  const o = c - (old ? 0.09 : 0.10);
  return { t: CLOSE - (90 - i) * H1, o, c,
    h: c + (old ? 0.6 : 0.2), l: c - (old ? 0.6 : 0.58),
    q: 1000 + (i > 59 && i % 4 !== 0 ? 400 : 0) };
});
const symbols = ['BTCUSDT', 'ETHUSDT', 'ALGOUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT'];
const hour = mkHour();
const feedEnv = { RADAR_RICH300_FEED: 'on', MODE: 'once',
  GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_RUN_ID: '81234', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'a'.repeat(40) };

test('all stage-one qualifying symbols auto-register, even if only two Telegram alerts are sent', async () => {
  const state = {}, sent = [];
  const input = { now: NOW, state,
    env: { RADAR_SIGNAL: 'on', RADAR_ACCUMULATION_WATCH: 'on',
      RADAR_DONCHIAN: 'off', RADAR_EMA_PULLBACK: 'off',
      RADAR_RICH300_FEED: 'on' },
    save: async () => {}, send: async text => sent.push(text),
    collectHour: async () => ({ calls: 0, coins: Object.fromEntries(symbols.map(sym =>
      [sym.replace('USDT', '-USDT-SWAP'),
        { symbol: sym, status: 'fresh', c1h: hour, c4h: [] }])),
      btc4h: null }),
    collectM15: async () => ({ coins: {}, calls: 0 }),
    analyze: () => ({ status: 'ok', stage: 0 }),
    scanAll: true, force: true };
  const first = await signalStep(input);
  assert.equal(first.accumulation.observed, symbols.length);
  assert.equal(first.accumulation.autoInterestAdded, symbols.length);
  assert.equal(first.accumulation.autoInterestTotal, symbols.length);
  assert.equal(first.accumulation.selected, 2, 'Telegram limits stay unchanged');
  assert.equal(sent.length, 2);
  const saved = state.signal.accumulation.autoInterest;
  assert.deepEqual(Object.keys(saved).sort(), [...symbols].sort());
  for (const x of Object.values(saved)) {
    assert.equal(x.source, 'C'); assert.equal(x.dir, 'WATCH');
    assert.match(x.sid, /^WK-[A-Z0-9]+-C-[a-z0-9]+$/);
  }
  assert.deepEqual(state.signal.coins, {}, 'watchlist must never become trades');
  assert.equal(state.signal.feed, undefined, 'trade feed remains separate');
  const artifact = feedArtifactOf(state, feedEnv, NOW);
  assert.equal(artifact.ok, true);
  assert.equal(artifact.artifact.entries.length, 0);
  assert.equal(artifact.artifact.watches.length, symbols.length);
  const second = await signalStep(input);
  assert.equal(second.accumulation.autoInterestAdded, 0);
  assert.equal(second.accumulation.autoInterestTotal, symbols.length);
  assert.equal(sent.length, 2);
});

test('deduplicates per symbol, recognizes breakout as stage-one qualified, rejects stale data', () => {
  const mk = (sym, stage='WATCH', asOf=CLOSE) => ({ symbol:sym, entry:{stage, asOf} });
  const a = accumulationAutoInterests({}, [mk('BNBUSDT'), mk('ADAUSDT', 'BREAKOUT')], NOW);
  assert.equal(a.added, 2); assert.equal(a.total, 2);
  const b = accumulationAutoInterests(a.records,
    [mk('BNBUSDT'), mk('ADAUSDT', 'BREAKOUT'), mk('BTCUSDT', 'RETEST')], NOW + 120000);
  assert.equal(b.added, 0); assert.equal(b.total, 2);
  assert.equal(b.records.BNBUSDT.sid, a.records.BNBUSDT.sid);
  const c = accumulationAutoInterests(a.records, [], NOW + 31 * 86400000);
  assert.equal(c.total, 0, '30-day stale interests expire');
});
