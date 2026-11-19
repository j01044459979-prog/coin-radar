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
  ema200: 105, riskPct: 4.4, costR: 0.03 };
const watch = { stage: 'WATCH', dir: 'SHORT', asOf: one.at(-1).t + H1,
  upper: 112, lower: 100, entry: 100.8, ema200: 104 };

test('Donchian breakout chart has the actual 4H timeframe and supplied levels', () => {
  const svg = buildDonchianSvg('ETHUSDT', breakout, one, four);
  assert.match(svg, /4H 확정 돌파/);
  assert.match(svg, /채널 상단/);
  assert.match(svg, /손절 기준/);
  assert.match(svg, /목표 2.5R \\(\\+11\\.06%\\)/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
  const caption = donchianCaption('ETHUSDT', breakout);
  assert.match(caption, /🧭 지금 할 일: 실시간 가격 확인 · 추격 진입 금지/);
  assert.match(caption, /손절 108\.00 \(가격 -4\.42% · 손실\)/);
  assert.match(caption, /1차 익절 2\.5R 125\.50 \(가격 \+11\.06% · 수익\)/);
  assert.match(caption, /2차 익절 4R 133\.00 \(가격 \+17\.70% · 수익\)/);
  assert.ok([...caption].length <= 1024, 'Telegram photo caption limit');
  assert.match(svg, /손절 \(-4\.42%\)/);
});

test('Donchian early-watch chart uses 1H candles and no invented stop or target', () => {
  const svg = buildDonchianSvg('XRPUSDT', watch, one, four);
  assert.match(svg, /1H 돌파 접근/);
  assert.match(svg, /4H 마감 대기/);
  assert.doesNotMatch(svg, /목표 4R|손절 기준/);
  const caption = donchianCaption('XRPUSDT', watch);
  assert.match(caption, /🧭 지금 할 일: 관망 · 4H 확정봉 대기/);
  assert.match(caption, /손절 \/ 🎯 익절: 미산정/);
  assert.doesNotMatch(caption, /1차 익절 2\.5R/);
  assert.ok([...caption].length <= 1024, 'Telegram photo caption limit');
});

test('Chart refuses a mismatched final candle rather than showing wrong prices', () => {
  assert.throws(() => validateDonchianChart('ETHUSDT', { ...breakout, asOf: breakout.asOf + H4 }, one, four), /불일치/);
});

test('Donchian PNG can be rendered with shared Korean font', async t => {
  // RICH300 CI intentionally skips optional chart dependency installation;
  // radar-pr-check and production radar install @resvg/resvg-js before running.
  try { await import('@resvg/resvg-js'); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') { t.skip('optional renderer not installed in this job'); return; }
    throw error;
  }
  const png = await renderDonchianChart('ETHUSDT', breakout, one, four);
  assert.ok(png.length > 3000);
  assert.equal(Buffer.from(png).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});
