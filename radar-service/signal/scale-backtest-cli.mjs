// 분할 진입·익절 계획 비교 백테스트(읽기 전용): 공개 OKX 시세만 읽는다. Telegram·비밀값·상태 캐시·주문 없음.
// 사용: node radar-service/signal/scale-backtest-cli.mjs [--top 20] [--days 120] [--equity 300] [--adapter ./path.mjs] [--json out.json]
// 전략 'S'(현재 radar 의 15분 진입 후보)는 기본 내장. A/B 같은 다른 전략은 --adapter 모듈(export collect(symbol,c15,btc15) → [{i,dir,stop,strategy}])로 붙인다.
import { writeFileSync } from 'node:fs';
import { jsonRequest } from '../service.mjs';
import { scanMarket } from '../universe.mjs';
import { parseCandles } from '../opportunity/collect.mjs';
import { collectSignalEvents, SBT } from './backtest.mjs';
import { M15 } from './evaluate.mjs';
import { scaleCompare, scaleReport } from './scale-sim.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const top = Number(arg('--top', 20)), days = Number(arg('--days', 120)), equity = Number(arg('--equity', 300)), jsonPath = arg('--json', null), adapterPath = arg('--adapter', null);
const BASE = 'https://www.okx.com/api/v5', pause = ms => new Promise(r => setTimeout(r, ms));
const get = async path => { for (let k = 0; ; k++) { try { const b = await jsonRequest(BASE + path); if (b.code === '50011') throw Object.assign(new Error('rate'), { status: 429 }); if (b.code !== '0' || !Array.isArray(b.data)) throw new Error(`code ${b.code}`); await pause(150); return b.data; } catch (e) { if (k >= 3) throw e; await pause(1500 * (k + 1)); } } };

const instruments = await get('/public/instruments?instType=SWAP'), tickers = await get('/market/tickers?instType=SWAP');
const market = scanMarket({ instruments, tickers });
const liquid = market.eligible.filter(e => e.turnover >= 1e6).sort((a, b) => b.turnover - a.turnover || (a.instId < b.instId ? -1 : 1));
const ids = [...new Set(['BTC-USDT-SWAP', ...liquid.map(e => e.instId)])].slice(0, top);
const need = days * 96 + SBT.warm15 + SBT.horizon15 + 100, now = Date.now(), data = {}, skipped = [];
async function load(id) {
  const rows = []; let after = '';
  try {
    while (rows.length < need) {
      const page = await get(`/market/history-candles?instId=${id}&bar=15m&limit=100${after ? `&after=${after}` : ''}`);
      if (!page.length) break; rows.push(...page); after = page.at(-1)[0];
      if (page.length < 100) break;
    }
  } catch (e) { skipped.push(`${id}: ${String(e.message).slice(0, 60)}`); return; }
  const { candles, notes } = parseCandles(rows, M15), c = candles.filter(x => x.t + M15 <= now);          // 확정(confirm=1) 봉만, 마감 시각이 현재 이후인 봉은 제외
  const gaps = rows.length ? 0 : 1;
  console.log(`LOAD ${id} 15m ${c.length}개 (${c.length ? new Date(c[0].t).toISOString().slice(0, 10) : '-'} ~ ${c.length ? new Date(c.at(-1).t).toISOString().slice(0, 10) : '-'})${notes.length ? ` 주의:${notes.join(',')}` : ''}${gaps ? ' 비어 있음' : ''}`);
  if (c.length >= SBT.warm15 + 500) data[id.replace(/-USDT-SWAP$/, 'USDT')] = c.slice(-need); else skipped.push(`${id}: 이력 부족(${c.length}봉)`);
}
const queue = [...ids]; await Promise.all([0, 1].map(async () => { while (queue.length) await load(queue.shift()); }));
if (skipped.length) console.log('SKIPPED ' + skipped.join(' | '));
const btc = data.BTCUSDT ?? null;
if (!btc) { console.log('BTC 데이터가 없어 중단'); process.exit(1); }
const adapter = adapterPath ? await import(adapterPath) : null, events = [];
for (const [symbol, c15] of Object.entries(data)) {
  for (const r of collectSignalEvents(symbol, c15, symbol === 'BTCUSDT' ? null : btc, { control: false }).events) events.push({ symbol, strategy: 'S', dir: r.dir, stop: r.stop, bars: c15, i: r.i });
  if (adapter) for (const r of adapter.collect(symbol, c15, symbol === 'BTCUSDT' ? null : btc)) events.push({ symbol, strategy: r.strategy, dir: r.dir, stop: r.stop, bars: c15, i: r.i });
}
const cmp = scaleCompare(events, { equity });
console.log(`분할 진입·익절 비교 — OKX USDT 무기한 상위 ${Object.keys(data).length}종목, 확정 15분봉, 계좌 ${equity} USDT 기준, 모든 변형이 같은 0.5% 위험 한도로 사이징됨 (생존 편향 있음, 펀딩 제외)`);
console.log(scaleReport(cmp));
console.log('JSON ' + JSON.stringify({ events: events.length, coinList: Object.keys(data), skipped, cmp }));
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(cmp));
