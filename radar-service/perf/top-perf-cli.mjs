// TOP 20 vs TOP 30 읽기 전용 성능 측정: 공개 OKX 시세만 읽는다. Telegram·비밀값·상태 캐시·주문 없음. 운영 변수(RADAR_OPPORTUNITY_TOP)를 읽거나 바꾸지 않는다.
// 운영과 같은 수집 함수·같은 파라미터(간격 260ms, 기회 레이더 수집 예산 60초, 신호 15분봉 예산 40초)로 한 라운드에 TOP 20과 TOP 30을 연달아(순서는 라운드마다 번갈아) 실행해 같은 시장 시점에서 비교한다.
// 사용: node radar-service/perf/top-perf-cli.mjs [--rounds 8] [--spacing 60] [--json out.json]
import { writeFileSync } from 'node:fs';
import { collectOpportunity } from '../opportunity/collect.mjs';
import { analyzeCoin } from '../opportunity/analysis.mjs';
import { collect15 } from '../signal/collect.mjs';
import { evaluateSignal, SIG } from '../signal/evaluate.mjs';
import { instrument, rateLimited, summarize } from './top-perf-stats.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const rounds = Number(arg('--rounds', 8)), spacing = Number(arg('--spacing', 60)), jsonPath = arg('--json', null), sleep = ms => new Promise(r => setTimeout(r, ms));
const GAP = 260, OPP_BUDGET = 60000, SIG_BUDGET = 40000;

async function pass(topN) {
  const f = instrument(), now = Date.now(), t0 = Date.now();
  const hour = await collectOpportunity({ fetcher: f, now, ids: null, topN, budgetMs: OPP_BUDGET, gapMs: GAP });
  const t1 = Date.now(), statuses = {}; for (const c of Object.values(hour.coins)) statuses[c.status] = (statuses[c.status] || 0) + 1;
  const rows = [], stages = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const [instId, c] of Object.entries(hour.coins)) if (c.status === 'fresh') { const a = analyzeCoin(c.c1h, c.c4h, hour.btc4h); rows.push({ instId, a }); if (a.status === 'ok') stages[a.stage] = (stages[a.stage] || 0) + 1; }
  const watch = rows.filter(r => r.a.status === 'ok' && r.a.stage >= 2), t2 = Date.now();
  const m15 = watch.length ? await collect15({ fetcher: f, now, ids: watch.map(r => r.instId), gapMs: GAP, budgetMs: SIG_BUDGET }) : { coins: {}, calls: 0, stopped: null };
  const t3 = Date.now(), ev = { CANDIDATE: 0, OBSERVE: 0, WAIT: 0, none: 0 }, tags = {}, fresh15 = Object.values(m15.coins).filter(c => c.status === 'fresh').length;
  for (const r of watch) { const c = m15.coins[r.instId]; if (!c || c.status !== 'fresh') { ev.none++; continue; } const e = evaluateSignal({ a: r.a, c15: c.c15, now: Date.now() }, { minRR: 1.5, validMin: 45 }); ev[e.status]++; for (const t of e.tags ?? []) tags[t] = (tags[t] || 0) + 1; }
  return { topN, universe: hour.universe?.length ?? 0, statuses, analyzed: rows.length, stages, watching: watch.length, fresh15, ev, tags, stopped: hour.stopped || m15.stopped || null, fatal: hour.fatal,
    calls: f.stats.calls, callsOpp: hour.calls, calls15: m15.calls, http: f.stats.http, okxCode: f.stats.okxCode, net: f.stats.net, rateLimited: rateLimited(f.stats), latMax: Math.max(0, ...f.stats.lat),
    msOpp: t1 - t0, msAnalyze: t2 - t1, ms15: t3 - t2, msTotal: t3 - t0, overBudgetOpp: Object.values(hour.coins).some(c => /예산 초과/.test(c.reason || '')), overBudget15: Object.values(m15.coins).some(c => /예산 초과/.test(c.reason || '')) };
}

const all = { 20: [], 30: [] };
for (let r = 0; r < rounds; r++) {
  const order = r % 2 ? [30, 20] : [20, 30];
  for (const n of order) { const p = await pass(n); p.round = r + 1; p.at = new Date().toISOString(); all[n].push(p); console.log(`ROUND ${r + 1} TOP ${n}: 총 ${(p.msTotal / 1000).toFixed(1)}s (수집 ${(p.msOpp / 1000).toFixed(1)}s · 분석 ${(p.msAnalyze / 1000).toFixed(2)}s · 15분봉 ${(p.ms15 / 1000).toFixed(1)}s) · 호출 ${p.calls} · 분석 ${p.analyzed}/${p.universe} · 관찰(2단계↑) ${p.watching} · 후보 ${p.ev.CANDIDATE} · 429/제한 ${p.rateLimited} · 예산 초과 ${p.overBudgetOpp || p.overBudget15} · ${JSON.stringify(p.statuses)}`); await sleep(15000); }
  if (r < rounds - 1) await sleep(spacing * 1000);
}
const S = n => { const a = all[n]; return { total: summarize(a.map(p => p.msTotal / 1000)), opp: summarize(a.map(p => p.msOpp / 1000)), m15: summarize(a.map(p => p.ms15 / 1000)), calls: summarize(a.map(p => p.calls)), analyzed: summarize(a.map(p => p.analyzed)), watching: summarize(a.map(p => p.watching)), candidates: a.reduce((x, p) => x + p.ev.CANDIDATE, 0), observe: summarize(a.map(p => p.ev.OBSERVE)), rateLimited: a.reduce((x, p) => x + p.rateLimited, 0), stopped: a.filter(p => p.stopped).length, fatal: a.filter(p => p.fatal).length, overBudget: a.filter(p => p.overBudgetOpp || p.overBudget15).length, net: a.reduce((x, p) => x + p.net, 0), passes: a.length }; };
const f1 = x => (x === null || x === undefined ? '-' : x.toFixed(1)), line = (name, s) => `| ${name} | ${f1(s.total.mean)} | ${f1(s.total.p50)} | ${f1(s.total.p95)} | ${f1(s.total.max)} | ${f1(s.opp.mean)} | ${f1(s.m15.mean)} | ${f1(s.calls.mean)} | ${f1(s.analyzed.mean)} | ${f1(s.watching.mean)} | ${s.candidates} | ${s.rateLimited} | ${s.stopped + s.fatal} | ${s.overBudget} |`;
const s20 = S(20), s30 = S(30);
console.log(`\n## TOP 20 vs TOP 30 성능 측정 (읽기 전용, ${rounds}라운드, 같은 시점 연속 측정, 운영과 같은 수집 파라미터)`);
console.log('| 설정 | 총 시간 평균(초) | 중앙값 | P95 | 최대 | 기회 수집 평균 | 15분봉 평균 | 호출 수 평균 | 분석 성공 평균 | 관찰(2단계↑) 평균 | A급 후보 합계 | 429/제한 | 중단·치명 | 예산 초과 패스 |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
console.log(line('TOP 20', s20)); console.log(line('TOP 30', s30));
console.log(`\n증가분(TOP 30 − TOP 20): 총 시간 평균 +${f1(s30.total.mean - s20.total.mean)}초 · 호출 수 평균 +${f1(s30.calls.mean - s20.calls.mean)} · 분석 종목 +${f1(s30.analyzed.mean - s20.analyzed.mean)} · 관찰 후보(2단계↑) +${f1(s30.watching.mean - s20.watching.mean)}`);
console.log('JSON ' + JSON.stringify({ rounds, s20, s30, passes: all }));
if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ rounds, s20, s30, passes: all }));
