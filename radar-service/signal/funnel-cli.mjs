// 신호 생성 단계별 탈락·실행 간격·대체 전략(눌림목 지정가 재진입 / 돌파 후 되돌림) 과거 데이터 검증 실행기(읽기 전용): 공개 OKX 시세만 읽는다. Telegram·비밀값·상태 캐시·주문 없음.
// 사용: node radar-service/signal/funnel-cli.mjs [--top 20] [--days 120] [--json out.json]
import { writeFileSync } from 'node:fs';
import { jsonRequest } from '../service.mjs';
import { scanMarket } from '../universe.mjs';
import { parseCandles } from '../opportunity/collect.mjs';
import { collectSignalEvents, summarizeSignals, SBT } from './backtest.mjs';
import { M15 } from './evaluate.mjs';
import { collectAltEvents, summarizeAlt } from './alt-strategies.mjs';
import { funnelCoin, mergeFunnel, blankFunnel, captureRate, captureFromGaps } from './funnel.mjs';

// 2026-10-27 21:35Z ~ 10-30 20:10Z 사이 radar 실제 실행 간격(분, 실행 40회, 시간순). 목록은 GitHub Actions 실행 이력에서 가져왔다(수동 실행 3회 포함).
const REAL_GAPS = [35, 31, 31, 28, 28, 50, 49, 40, 45, 40, 34, 44, 38, 33, 64, 50, 48, 45, 39, 43, 38, 34, 62, 53, 52, 46, 43, 280, 224, 354, 418, 326, 243, 200, 378, 40, 11, 356, 263];
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
const coins = Object.keys(data), n = coins.length, evalDays = Math.max(...Object.values(data).map(c => c.length - SBT.warm15)) / 96;
const f = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? '-' : x.toFixed(d)), pc = x => (x === null || x === undefined || !Number.isFinite(x) ? '-' : `${(x * 100).toFixed(1)}%`);

let fun = blankFunnel(); const S = [], alt = { PBedge: [], PBmid: [], BR: [] };
for (const [sym, c15] of Object.entries(data)) {
  const b = sym === 'BTCUSDT' ? null : btc;
  fun = mergeFunnel(fun, funnelCoin(c15, b));
  S.push(...collectSignalEvents(sym, c15, b, { control: false }).events);
  const r = collectAltEvents(sym, c15, b); for (const k of Object.keys(alt)) alt[k].push(...r[k]);
}
console.log(`## 신호 생성 단계 분석 — OKX USDT 무기한 거래대금 상위 ${n}종목(요청 ${top}), 평가 약 ${evalDays.toFixed(0)}일, 15분봉 단위 (생존 편향 있음, 미검증)`);
console.log(`| 단계 | 종목-15분봉 | 비율 |\n|---|---|---|`);
const rowsF = [['전체(분석 가능)', fun.bars - fun.data, 1], ['4H·1H 0단계(추세·눌림 없음)', fun.stage0, fun.stage0 / (fun.bars - fun.data)], ['4H·1H 1단계(구간 접근만)', fun.stage1, fun.stage1 / (fun.bars - fun.data)], ['4H·1H 2단계 이상(맥락 충족)', fun.ctx, fun.ctx / (fun.bars - fun.data)], ['└ 15분 트리거 충족(막힘 없음 또는 트리거 외 막힘)', fun.trigOk, fun.ctx ? fun.trigOk / fun.ctx : null], ['└ 관찰(OBSERVE)', fun.observe, fun.ctx ? fun.observe / fun.ctx : null], ['└ 진입 후보(CANDIDATE, 봉 단위)', fun.candidate, fun.ctx ? fun.candidate / fun.ctx : null]];
for (const [k, v, r] of rowsF) console.log(`| ${k} | ${v} | ${pc(r)} |`);
console.log(`\n맥락 충족 봉 중 대기(WAIT) 사유: ${Object.entries(fun.wait).map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'}`);
console.log(`\n| 막힘 조건(OBSERVE 봉 기준) | 걸린 봉 | 단일 막힘(그것만 풀면 후보) |\n|---|---|---|`);
for (const t of Object.keys(fun.tag)) console.log(`| ${t} | ${fun.tag[t]} | ${fun.sole[t]} |`);

const sS = summarizeSignals(S, 'wick', { coins: n, days: evalDays });
console.log(`\n## 전략 비교 (모든 전략 같은 비용 왕복 ${SBT.costBps}bp, 보유 최대 ${SBT.horizon15 / 4}시간, 같은 봉 손절 우선, 스탑주문 모형)`);
console.log('| 전략 | 주문 건 | 체결 | 미체결률 | 이벤트/종목/일 | 목표/손절/미결정(체결) | 평균 순손익비 [95% CI](체결) | 30bp | 주문 건당 기대값(미체결 0) | 최악 1건(R) | MAE p90(R) |\n|---|---|---|---|---|---|---|---|---|---|---|');
console.log(`| S 기존(15분 트리거 시장가) | ${sS.n} | ${sS.n} | 0% | ${f(sS.perCoinDay, 3)} | ${pc(sS.target)}/${pc(sS.stop)}/${pc(sS.time)} | ${f(sS.netR, 3)} [${f(sS.ciLo, 2)}, ${f(sS.ciHi, 2)}] | ${f(sS.netStressR, 3)} | ${f(sS.netR, 3)} | - | ${f(sS.maeP90R, 2)} |`);
const altSum = {}; for (const [k, name] of [['PBedge', 'PB-edge 눌림 지정가(구간 경계)'], ['PBmid', 'PB-mid 눌림 지정가(구간 중앙)'], ['BR', 'BR 돌파 후 되돌림']]) { const m = summarizeAlt(alt[k], { coins: n, days: evalDays }); altSum[k] = m; console.log(`| ${name} | ${m.armed} | ${m.filled} | ${pc(m.armed ? 1 - m.fillRate : null)} (놓침 ${pc(m.missed)} · 만료 ${pc(m.expired)} · 무효 ${pc(m.invalid)}) | ${f(m.perCoinDay, 3)} | ${pc(m.win)}/${pc(m.stop)}/${pc(m.time)} | ${f(m.netR, 3)} [${f(m.ciLo, 2)}, ${f(m.ciHi, 2)}] | ${f(m.netStressR, 3)} | ${f(m.perArmedR, 3)} | ${f(m.worstR, 2)} | ${f(m.maeP90R, 2)} |`); }

console.log(`\n## 실행 간격과 포착률 (트리거 봉 마감 후 ${20}분 안에 radar 실행이 있어야 알림)`);
console.log('| radar 실행 간격 | 포착 가능 비율 |\n|---|---|');
for (const g of [5, 15, 30, 45, 60, 120, 180]) console.log(`| 매 ${g}분 | ${pc(captureRate(g))} |`);
const mean = REAL_GAPS.reduce((x, y) => x + y, 0) / REAL_GAPS.length;
console.log(`| 최근 72시간 실제 간격(평균 ${mean.toFixed(0)}분, 최대 ${Math.max(...REAL_GAPS)}분) | ${pc(captureFromGaps(REAL_GAPS))} |`);
console.log('JSON ' + JSON.stringify({ top, n, coins, skipped, evalDays, fun, S: sS, alt: altSum, realCapture: captureFromGaps(REAL_GAPS) }));
if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ fun, S: sS, alt: altSum }));
