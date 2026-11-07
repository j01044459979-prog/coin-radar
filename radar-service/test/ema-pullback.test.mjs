import test from 'node:test';
import assert from 'node:assert/strict';
import { H1, H4 } from '../opportunity/indicators.mjs';
import { M15 } from '../signal/evaluate.mjs';
import { EMA_PRIORITY, emaSetup, evaluateEmaPullback } from '../signal/ema-pullback.mjs';
import { blankPaper, paperStep, paperSummary } from '../signal/paper.mjs';
import { normalizeSignal, watchlist, expandedWatchlist } from '../signal/step.mjs';

const NOW = 400 * H1 + M15 + 20_000;
function fixture() {
  const c1h = Array.from({ length: 100 }, (_, i) => {
    const c = 100 + i * 0.03;
    return { t: (300 + i) * H1, o: c - 0.02, h: c + 0.45, l: c - 0.45, c, q: 1000 };
  });
  // Confirmed historical swing target, not a made-up profit level.
  c1h[50].h = 106.5;
  const c4h = Array.from({ length: 100 }, (_, i) => {
    const c = 100 + i * 0.03;
    return { t: i * H4, o: c - 0.02, h: c + 0.45, l: c - 0.45, c, q: 4000 };
  });
  c4h[70].h = 106.8;
  const lastT = 400 * H1;
  const c15 = Array.from({ length: 80 }, (_, i) => ({
    t: lastT - (79 - i) * M15, o: 102.82, h: 103.05, l: 102.55, c: 102.85, q: 1000,
  }));
  c15.at(-1).o = 102.85; c15.at(-1).c = 103.1; c15.at(-1).h = 103.2; c15.at(-1).l = 102.75; c15.at(-1).q = 1300;
  return { c1h, c4h, c15 };
}

test('EMA is independent from legacy opportunity stage and uses only completed 4H/1H bars', () => {
  const { c1h, c4h, c15 } = fixture();
  const setup = emaSetup(c1h, c4h, NOW);
  assert.equal(setup.dir, 'LONG');
  const ev = evaluateEmaPullback({ setup, c15, now: NOW });
  assert.equal(ev.status, 'CANDIDATE');
  assert.equal(ev.strategy, 'ema-pullback');
  assert.ok(ev.t1.net >= 1.5);
  assert.ok(ev.stop < ev.entry && ev.t1.price > ev.entry);
  const future = { ...c4h.at(-1), t: 400 * H1, c: 1, h: 1, l: 1, o: 1 };
  assert.equal(emaSetup(c1h, [...c4h, future], NOW).dir, setup.dir, 'unclosed 4H bar cannot flip trend');
});
test('EMA refuses unconfirmed trigger, weak volume and excessive chase', () => {
  const { c1h, c4h, c15 } = fixture();
  const setup = emaSetup(c1h, c4h, NOW);
  assert.equal(evaluateEmaPullback({ setup, c15, now: c15.at(-1).t + M15 - 1 }).status, 'WAIT');
  const weak = structuredClone(c15); weak.at(-1).q = 100;
  assert.equal(evaluateEmaPullback({ setup, c15: weak, now: NOW }).status, 'OBSERVE');
  const chase = structuredClone(c15); chase.at(-1).c += 2;
  assert.equal(evaluateEmaPullback({ setup, c15: chase, now: NOW }).status, 'OBSERVE');
  assert.equal(evaluateEmaPullback({ setup, c15, now: NOW }, { minRR: 99 }).status, 'OBSERVE');
});
test('priority majors stay ahead of rotations and existing pinned signals', () => {
  const now = NOW;
  const sg = normalizeSignal(undefined);
  sg.coins.BTCUSDT = { status: 'active', dir: 'LONG' };
  const state = {};
  const w = watchlist(state, sg, now);
  assert.equal(w[0], 'BTCUSDT');
  assert.deepEqual(w.slice(1, 6), EMA_PRIORITY);
  const pool = [...EMA_PRIORITY, ...Array.from({ length: 75 }, (_, n) => 'COIN' + n + 'USDT')];
  const exp = expandedWatchlist(state, sg, now, null, pool);
  assert.ok(exp.length <= 32);
  assert.equal(exp[0], 'BTCUSDT');
  EMA_PRIORITY.forEach(x => assert.ok(exp.includes(x)));
});
test('paper trades and statistics stay separate for legacy and EMA on same coin', () => {
  const { c1h, c4h, c15 } = fixture();
  const ev = evaluateEmaPullback({ setup: emaSetup(c1h, c4h, NOW), c15, now: NOW });
  const old = { ...ev, strategy: 'pullback', zoneKey: 'legacy:LONG' };
  const p = blankPaper();
  const evaluations = [
    { symbol: 'SOLUSDT', strategy: 'legacy', ev: old, a: null, c15 },
    { symbol: 'SOLUSDT', strategy: 'ema-pullback', ev, a: null, c15 },
  ];
  paperStep(p, { evaluations, bars: {}, now: NOW });
  assert.equal(p.open.length, 2);
  assert.equal(new Set(p.open.map(t => t.id)).size, 2);
  assert.equal(paperSummary(p, NOW).strategies['legacy'].open, 1);
  assert.equal(paperSummary(p, NOW).strategies['ema-pullback'].open, 1);
  paperStep(p, { evaluations, bars: {}, now: NOW + 1_000 });
  assert.equal(p.open.length, 2, 'same candle must not open a duplicate position');
});
