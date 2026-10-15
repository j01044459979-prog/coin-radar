import test from 'node:test';
import assert from 'node:assert/strict';
import { runResearch } from '../research-v3.mjs';

const stats = trades => ({
  trades, winRatePercent: 50, profitFactor: 1.2, averageNetTradePercent: 0.1, averageR: 0.2,
  netReturnPercent1x: 1.1, maxClosedTradeDrawdownPercent: 2.3,
});
const sample = { source: 'OKX', market: 'USDT-SWAP', quality: { actual: 51840, coveragePercent: 100 },
  fetchedPages: 520, candles: [{ t: 1 }] };
const bt = { inSample: stats(88), outOfSample: stats(15), boundaryTradesExcluded: 1 };
const fixed = '--to-ms=1800000000000';

test('research runner is read-only, labels OKX source, and marks inadequate OOS sample', async () => {
  const calls = [];
  const report = await runResearch(['--days=180', '--symbols=BTC,ETH,SOL', fixed], {
    collect: async request => { calls.push(request); return sample; },
    test: () => bt,
  });
  assert.equal(report.complete, true);
  assert.equal(report.errors.length, 0);
  assert.deepEqual(calls.map(x => x.instId), ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP']);
  assert.equal(report.symbols.BTC.resultState, 'INSUFFICIENT_SAMPLE');
  assert.match(report.caveat, /not compared/i);
  assert.equal(report.symbols.SOL.inSample.trades, 88);
});

test('research runner handles provider failures as partial without inventing missing metrics', async () => {
  const report = await runResearch(['--days=7', '--symbols=BTC,ETH', fixed], {
    collect: async args => {
      if (args.instId.startsWith('ETH-')) throw new Error('HTTP 451 region restricted');
      return sample;
    }, test: () => bt,
  });
  assert.equal(report.complete, false);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].symbol, 'ETH');
  assert.equal(report.symbols.ETH, undefined);
});

test('invalid symbols, missing day range and improperly aligned timestamps fail closed', async () => {
  await assert.rejects(runResearch(['--symbols=BTC,DOGE', fixed]), /Allowed symbols/);
  await assert.rejects(runResearch(['--days=366', fixed]), /days/);
  await assert.rejects(runResearch(['--days=7', '--to-ms=1234']), /5m-aligned/);
  await assert.rejects(runResearch(['--days=7', '--foo=bar']), /Unknown/);
});

test('sufficient history and trade count still outputs RESEARCH_ONLY and no readiness claim', async () => {
  const report = await runResearch(['--days=90', '--symbols=BTC', fixed], {
    collect: async () => sample, test: () => ({ inSample: stats(120), outOfSample: stats(31),
      boundaryTradesExcluded: 0 }),
  });
  assert.equal(report.symbols.BTC.resultState, 'RESEARCH_ONLY');
  assert.match(report.symbols.BTC.note, /forward paper/);
});

test('negative OOS performance is explicitly FAILED_VALIDATION and never approved for live use', async () => {
  const losing = { ...stats(80), profitFactor: 0.4, netReturnPercent1x: -27,
    maxClosedTradeDrawdownPercent: 29 };
  const report = await runResearch(['--days=90', '--symbols=BTC', fixed], {
    collect: async () => sample,
    test: () => ({ inSample: stats(100), outOfSample: losing, boundaryTradesExcluded: 0 }),
  });
  assert.equal(report.symbols.BTC.resultState, 'FAILED_VALIDATION');
  assert.equal(report.symbols.BTC.validationGate.passed, false);
  assert.equal(report.symbols.BTC.validationGate.liveApproved, false);
  assert.match(report.symbols.BTC.note, /REJECTED/);
});
