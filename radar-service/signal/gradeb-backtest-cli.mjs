// A급(확정형) vs B급(공격형) 과거 데이터 비교 실행기(읽기 전용): 공개 OKX 시세만 읽는다. Telegram·비밀값·상태 캐시·주문 없음.
// 사용: node radar-service/signal/gradeb-backtest-cli.mjs [--top 20] [--days 120] [--json out.json]
import { writeFileSync } from 'node:fs';
import { jsonRequest } from '../service.mjs';
import { scanMarket } from '../universe.mjs';
import { parseCandles } from '../opportunity/collect.mjs';
import { SBT } from './backtest.mjs';
import { M15 } from './evaluate.mjs';
import { runGradeBacktest, renderGradeReport } from './gradeb-backtest.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const top = Number(arg('--top', 20)), days = Number(arg('--days', 120)), jsonPath = arg('--json', null);
const BASE = 'https://www.okx.com/api/v5', pause = ms => new Promise(r => setTimeout(r, ms));
const get = async path => { for (let k = 0; ; k++) { try { const b = await jsonRequest(BASE + path); if (b.code === '50011') throw Object.assign(new Error('rate'), { status: 429 }); if (b.code !== '0' || !Array.isArray(b.data)) throw new Error(`code ${b.code}`); await pause(150); return b.data; } catch (e) { if (k >= 3) throw e; await pause(1500 * (k + 1)); } } };

const instruments = await get('/public/instruments?instType=SWAP'), tickers = await get('/market/tickers?instType=SWAP');
const market = scanMarket({ instruments, tickers });
const liquid = market.eligible.filter(e => e.turnover >= 1e6).sort((a, b) => b.turnover - a.turnover || (a.instId < b.instId ? -1 : 1));
const ids = [...new Set(['BTC-USDT-SWAP', ...liquid.map(e => e.instId)])].slice(0, top);
const need = days * 96 + SBT.warm15 + SBT.horizon15 + 100, now = Date.now(), data = {}, skipped = [];
async function load(id) {
  const rows = []; let after = '';
  try { while (rows.length < need) { const page = await get(`/market/history-candles?instId=${id}&bar=15m&limit=100${after ? `&after=${after}` : ''}`); if (!page.length) break; rows.push(...page); after = page.at(-1)[0]; if (page.length < 100) break; } } catch (e) { skipped.push(`${id}: ${String(e.message).slice(0, 60)}`); return; }
  const { candles } = parseCandles(rows, M15), c = candles.filter(x => x.t + M15 <= now);
  if (c.length >= SBT.warm15 + 500) data[id.replace(/-USDT-SWAP$/, 'USDT')] = c.slice(-need); else skipped.push(`${id}: 이력 부족(${c.length}봉)`);
}
const queue = [...ids]; await Promise.all([0, 1].map(async () => { while (queue.length) await load(queue.shift()); }));
const btc = data.BTCUSDT ?? null; if (!btc) { console.log('BTC 데이터가 없어 중단'); process.exit(1); }
const r = runGradeBacktest(data, btc);
console.log(renderGradeReport(r, { note: `OKX USDT 무기한 거래대금 상위 ${Object.keys(data).length}종목, 확정 15분봉에서 1H·4H 집계 (생존 편향 있음, 미검증)` }));
const { raw, ...summary } = r;
console.log('JSON ' + JSON.stringify({ ...summary, coinList: Object.keys(data), skipped }));
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(r));
