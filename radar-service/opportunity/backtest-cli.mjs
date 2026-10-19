// 기회 포착 레이더 과거 데이터 검증 실행기(읽기 전용): 공개 OKX 시세(history-candles)만 읽는다. Telegram·비밀값·상태 캐시·주문 없음.
// 사용: node radar-service/opportunity/backtest-cli.mjs [--top 20] [--days 270] [--json out.json]
import { writeFileSync } from 'node:fs';
import { jsonRequest } from '../service.mjs';
import { scanMarket } from '../universe.mjs';
import { parseCandles } from './collect.mjs';
import { runBacktest, renderReport, BT } from './backtest.mjs';
import { H1 } from './indicators.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const top = Number(arg('--top', 20)), days = Number(arg('--days', 270)), jsonPath = arg('--json', null);
const BASE = 'https://www.okx.com/api/v5', pause = ms => new Promise(r => setTimeout(r, ms));
const get = async path => { for (let k = 0; ; k++) { try { const b = await jsonRequest(BASE + path); if (b.code === '50011') throw Object.assign(new Error('rate'), { status: 429 }); if (b.code !== '0' || !Array.isArray(b.data)) throw new Error(`code ${b.code}`); await pause(130); return b.data; } catch (e) { if (k >= 3) throw e; await pause(1500 * (k + 1)); } } };

const instruments = await get('/public/instruments?instType=SWAP'), tickers = await get('/market/tickers?instType=SWAP');
const market = scanMarket({ instruments, tickers });
const liquid = market.eligible.filter(e => e.turnover >= 1e6).sort((a, b) => b.turnover - a.turnover || (a.instId < b.instId ? -1 : 1));
const ids = [...new Set(['BTC-USDT-SWAP', ...liquid.map(e => e.instId)])].slice(0, top);
const need = days * 24 + BT.warm1h + BT.horizon + 50;
const now = Date.now(), data = {};
for (const id of ids) {
  const rows = []; let after = '';
  try {
    while (rows.length < need) {
      const page = await get(`/market/history-candles?instId=${id}&bar=1H&limit=100${after ? `&after=${after}` : ''}`);
      if (!page.length) break; rows.push(...page); after = page.at(-1)[0];
      if (page.length < 100) break;
    }
  } catch (e) { console.log(`SKIP ${id}: ${String(e.message).slice(0, 60)}`); continue; }
  const { candles, notes } = parseCandles(rows, H1);
  const c = candles.filter(x => x.t + H1 <= now);                                             // 확정 봉만(parseCandles가 confirm=1만 통과시키고, 마지막 봉이 진행 중이어도 제외)
  console.log(`LOAD ${id} 1H ${c.length}개 (${new Date(c[0]?.t).toISOString().slice(0, 10)} ~ ${new Date(c.at(-1)?.t).toISOString().slice(0, 10)})${notes.length ? ` 주의:${notes.join(',')}` : ''}`);
  if (c.length >= BT.warm1h + 200) data[id.replace(/-USDT-SWAP$/, 'USDT')] = c.slice(-need);
}
const btc = data.BTCUSDT ?? null;
if (!btc) { console.log('BTC 데이터가 없어 중단'); process.exit(1); }
const result = runBacktest(data, btc);
const { raw, ...summary } = result;
console.log(renderReport(result, { note: `OKX USDT 무기한 거래대금 상위 ${Object.keys(data).length}종목, 확정 1H 봉 (생존 편향 있음)` }));
console.log('JSON ' + JSON.stringify({ ...summary, coinList: Object.keys(data) }));
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(result));
