// 5분봉 상승 가속 모멘텀 검증 실행기(읽기 전용): 공개 OKX 시세(history-candles)만 읽는다. Telegram·비밀값·상태 캐시·주문 없음.
// 사용: node radar-service/signal/momentum-backtest-cli.mjs [--top 40] [--days 120] [--json out.json]   (권장 30~80종목, 120일 이상)
import { writeFileSync } from 'node:fs';
import { jsonRequest } from '../service.mjs';
import { scanMarket } from '../universe.mjs';
import { parseCandles } from '../opportunity/collect.mjs';
import { M5 } from './momentum5m.mjs';
import { runMomentumBacktest, renderMomentumReport, MBT } from './momentum-backtest.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const top = Math.min(80, Math.max(30, Number(arg('--top', 40)))), days = Math.max(120, Number(arg('--days', 120))), jsonPath = arg('--json', null);
const BASE = 'https://www.okx.com/api/v5', pause = ms => new Promise(r => setTimeout(r, ms));
const get = async path => { for (let k = 0; ; k++) { try { const b = await jsonRequest(BASE + path); if (b.code === '50011') throw Object.assign(new Error('rate'), { status: 429 }); if (b.code !== '0' || !Array.isArray(b.data)) throw new Error(`code ${b.code}`); await pause(150); return b.data; } catch (e) { if (k >= 3) throw e; await pause(1500 * (k + 1)); } } };

const instruments = await get('/public/instruments?instType=SWAP'), tickers = await get('/market/tickers?instType=SWAP');
const market = scanMarket({ instruments, tickers });
const liquid = market.eligible.filter(e => e.turnover >= 1e6).sort((a, b) => b.turnover - a.turnover || (a.instId < b.instId ? -1 : 1));
const ids = liquid.map(e => e.instId).slice(0, top);
const need = days * 288 + MBT.window + MBT.maxBars + 100, now = Date.now(), data = {}, skipped = [];
async function load(id) {
  const rows = []; let after = '';
  try {
    while (rows.length < need) {
      const page = await get(`/market/history-candles?instId=${id}&bar=5m&limit=100${after ? `&after=${after}` : ''}`);
      if (!page.length) break; rows.push(...page); after = page.at(-1)[0];
      if (page.length < 100) break;
    }
  } catch (e) { skipped.push(`${id}: ${String(e.message).slice(0, 60)}`); return; }
  const { candles, notes } = parseCandles(rows, M5), c = candles.filter(x => x.t + M5 <= now);          // 확정(confirm=1) 봉만, 마감 시각이 현재 이후인 봉은 제외
  const gaps = rows.length ? 0 : 1;
  console.log(`LOAD ${id} 15m ${c.length}개 5m (${c.length ? new Date(c[0].t).toISOString().slice(0, 10) : '-'} ~ ${c.length ? new Date(c.at(-1).t).toISOString().slice(0, 10) : '-'})${notes.length ? ` 주의:${notes.join(',')}` : ''}${gaps ? ' 비어 있음' : ''}`);
  if (c.length >= days * 288 * 0.9) data[id.replace(/-USDT-SWAP$/, 'USDT')] = c.slice(-need); else skipped.push(`${id}: 이력 부족(${c.length}봉)`);
}
const queue = [...ids]; await Promise.all([0, 1].map(async () => { while (queue.length) await load(queue.shift()); }));
if (skipped.length) console.log('SKIPPED ' + skipped.join(' | '));
if (Object.keys(data).length < 30) { console.log(`데이터가 확보된 종목이 30개 미만(${Object.keys(data).length}) — 검증 불충분으로 중단`); process.exit(1); }
const result = runMomentumBacktest(data);
console.log(renderMomentumReport(result, { note: `OKX USDT 무기한 거래대금 상위 ${Object.keys(data).length}종목 · ${days}일 · 확정 5분봉 (생존 편향 있음, 펀딩 제외, 위험 한도 0.5% 기준 R)` }));
console.log('JSON ' + JSON.stringify({ coins: Object.keys(data), skipped, events: result.events, holdoutEvents: result.holdoutEvents, symbols: result.symbols, verdict: result.verdict, variants: result.variants }));
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(result));
