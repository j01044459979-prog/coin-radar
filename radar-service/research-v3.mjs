// RICH STRATEGY RADAR 3.0 - multi-symbol, read-only research runner.
// Examples:
// node radar-service/research-v3.mjs --days=7 --symbols=BTC,ETH,SOL
// node radar-service/research-v3.mjs --days=180 --symbols=BTC,ETH,SOL --out-dir=/tmp/radar3
// Public OKX data only. No trading, Telegram, credentials, or live recommendation writes.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectOkxHistory, FIVE_MINUTES } from './history-v3.mjs';
import { backtestStrategy } from './strategy-backtest-v3.mjs';

const ALLOWED = new Set(['BTC', 'ETH', 'SOL']);
const DATE_MS = 86400000;
function parseArgs(argv) {
  const opts = Object.fromEntries(argv.map(x => {
    const match = /^--([a-z-]+)=(.+)$/.exec(x);
    if (!match) throw new Error('Invalid option: ' + x);
    return [match[1], match[2]];
  }));
  if (Object.keys(opts).some(x => !['days', 'symbols', 'out-dir', 'to-ms'].includes(x))) {
    throw new Error('Unknown research argument');
  }
  const days = Number(opts.days ?? '7');
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Research days must be 1..365');
  const symbols = (opts.symbols ?? 'BTC,ETH,SOL').split(',');
  if (symbols.length < 1 || symbols.length > 3 || new Set(symbols).size !== symbols.length ||
      symbols.some(s => !ALLOWED.has(s))) throw new Error('Allowed symbols: BTC,ETH,SOL (no duplicates)');
  const to = opts['to-ms'] === undefined ?
    Math.floor((Date.now() - 120000) / FIVE_MINUTES) * FIVE_MINUTES : Number(opts['to-ms']);
  if (!Number.isSafeInteger(to) || to <= 0 || to % FIVE_MINUTES !== 0) {
    throw new Error('to-ms must be a UTC 5m-aligned timestamp');
  }
  const from = to - days * DATE_MS;
  if (from <= 0) throw new Error('Research start is before Unix epoch');
  return { days, symbols, to, from, outDir: opts['out-dir'] ?? null };
}
function slim(x) {
  return {
    trades: x.trades, winRatePercent: x.winRatePercent, profitFactor: x.profitFactor,
    avgNetTradePercent: x.averageNetTradePercent, avgR: x.averageR,
    netReturnPercent1x: x.netReturnPercent1x, maxClosedTradeDrawdownPercent: x.maxClosedTradeDrawdownPercent,
  };
}
export async function runResearch(argv = [], deps = {}) {
  const input = parseArgs(argv);
  const collect = deps.collect ?? collectOkxHistory;
  const test = deps.test ?? backtestStrategy;
  const report = {
    name: 'RICH STRATEGY RADAR 3.0 research', mode: 'offline-backtest',
    dataSource: 'OKX USDT-SWAP (NOT Binance)',
    from: new Date(input.from).toISOString(), toExclusive: new Date(input.to).toISOString(),
    strategy: 'EMA20/50 + ATR-group + Donchian/volume breakout OR RSI/BB range reentry',
    costs: { feeBpsEachSide: 6, slippageBpsEachSide: 3, fundingModeled: false, liquidationModeled: false },
    caveat: 'Not financial advice. Past performance cannot predict future returns; OOS counts are illustrative. v2.4 history baseline needs historical OI/funding and is NOT compared yet.',
    symbols: {}, errors: [],
  };
  if (input.outDir) await mkdir(input.outDir, { recursive: true, mode: 0o700 });
  for (const symbol of input.symbols) {
    const instId = symbol + '-USDT-SWAP';
    try {
      const result = await collect({ instId, from: input.from, to: input.to });
      const bt = test(result.candles);
      const validTrades = bt.outOfSample.trades;
      const state = input.days < 90 || validTrades < 30 ? 'INSUFFICIENT_SAMPLE' : 'RESEARCH_ONLY';
      report.symbols[symbol] = {
        source: result.source, market: result.market, instId,
        bars: result.quality.actual, pages: result.fetchedPages, coveragePercent: result.quality.coveragePercent,
        inSample: slim(bt.inSample), outOfSample: slim(bt.outOfSample),
        boundaryTradesExcluded: bt.boundaryTradesExcluded, resultState: state,
        note: state === 'INSUFFICIENT_SAMPLE'
          ? 'Need at least 90 days AND 30 OOS trades for preliminary comparison. Never an automatic live approval.'
          : 'Still requires baseline matched-period comparison, longer walk-forward and forward paper tracking.',
      };
      if (input.outDir) {
        const path = join(input.outDir, 'okx-' + symbol.toLowerCase() + '-5m-' + input.days + 'd.json');
        await writeFile(path, JSON.stringify({ source: result.source, instId, from: input.from, to: input.to,
          candles: result.candles }), { mode: 0o600 });
      }
    } catch (e) {
      report.errors.push({ symbol, message: String(e.message).slice(0, 250) });
    }
  }
  report.complete = report.errors.length === 0 && Object.keys(report.symbols).length === input.symbols.length;
  return report;
}

if (process.argv[1]?.endsWith('/research-v3.mjs')) {
  try {
    const report = await runResearch(process.argv.slice(2));
    console.log('RADAR3_RESEARCH ' + JSON.stringify(report));
    if (!report.complete) process.exitCode = 1;
  } catch (e) {
    console.error('RADAR3_RESEARCH_ERROR ' + String(e.message).slice(0, 250));
    process.exitCode = 1;
  }
}
