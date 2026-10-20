// Offline research CLI. Usage:
// node radar-service/strategy-backtest-cli-v3.mjs /path/to/closed-candles.json
// JSON: [{t,o,h,l,c,q,confirm:"1"}, ...] or {candles:[...]}.
// NO network, credentials, live Telegram, Binance keys, or order placement.
import { readFile } from 'node:fs/promises';
import { backtestStrategy } from './strategy-backtest-v3.mjs';

const path = process.argv[2];
if (!path || process.argv.length > 3) {
  console.error('Usage: node radar-service/strategy-backtest-cli-v3.mjs <confirmed-candle-json>');
  process.exitCode = 2;
} else {
  try {
    const json = JSON.parse(await readFile(path, 'utf8'));
    const candles = Array.isArray(json) ? json : json.candles;
    if (!Array.isArray(candles)) throw new Error('JSON must be an array or {candles:[...]}');
    const result = backtestStrategy(candles);
    const { trades, ...safeReport } = result; // brief default; no flood of sensitive price data
    console.log(JSON.stringify(safeReport, null, 2));
    console.log('Trades: ' + trades.length + ' (summary only)');
  } catch (error) {
    console.error('Backtest failed: ' + error.message);
    process.exitCode = 1;
  }
}
