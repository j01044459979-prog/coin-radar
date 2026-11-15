import test from 'node:test';
import assert from 'node:assert/strict';
import { H1, H4 } from '../opportunity/indicators.mjs';
import { buildDonchianSvg, donchianCaption, renderDonchianChart, validateDonchianChart } from '../signal/donchian-chart.mjs';

// Rendering smoke tests only. Not a trading strategy backtest or a claim of profitability.
const mk = (n, step, start) => Array.from({ length: n }, (_, i) => {
  const price = 100 + 0.04 * i + Math.sin(i / 3);
  return { t: start + i * step, o: price - 0.12, h: price + 0.9,
    l: price - 0.9, c: price + 0.13, q: 10000 + 100 * i };
});
const four = mk(220, H4, 0);
const one = mk(120, H1, four.at(-1).t - 26 * H1);
const breakout = { stage: 'BREAKOUT', dir: 'LONG', asOf: four.at(-1).t + H4,
  upper: 111, lower: 98, entry: 113, stop: 108, t1: 125.5, t2: 133,
  ema200: 105, riskPct: 4.4 };
const watch = { stage: 'WATCH', dir: 'SHORT', asOf: one.at(-1).t + H1,
  upper: 112, lower: 100, entry: 100.8, ema200: 104 };

test('Donchian breakout chart has the actual 4H timeframe and supplied levels', () => {
  const svg = buildDonchianSvg('ETHUSDT', breakout, one, four);
  assert.match(svg, /4H 확정 돌파/);
  assert.match(svg, /채널 상단/);
  assert.match(svg, /손절 기준/);
  assert.match(svg, /가상 목표 2.5R/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
  assert.match(donchianCaption('ETHUSDT', breakout), /손절/);
});

test('Donchian early-watch chart uses 1H candles and no invented stop or target', () => {
  const svg = buildDonchianSvg('XRPUSDT', watch, one, four);
  assert.match(svg, /1H 돌파 접근/);
  assert.match(svg, /4H 마감 대기/);
  assert.doesNotMatch(svg, /가상 목표 4R|손절 기준/);
});

test('Chart refuses a mismatched final candle rather than showing wrong prices', () => {
  assert.throws(() => validateDonchianChart('ETHUSDT', { ...breakout, asOf: breakout.asOf + H4 }, one, four), /불일치/);
});

test('Donchian PNG can be rendered with shared Korean font', async () => {
  const png = await renderDonchianChart('ETHUSDT', breakout, one, four);
  assert.ok(png.length > 3000);
  assert.equal(Buffer.from(png).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});
