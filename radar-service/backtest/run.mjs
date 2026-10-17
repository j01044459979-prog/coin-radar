// 백테스트 실행기: 기존(근사)·A·B·A+B·무작위를 동일 데이터·동일 비용·동일 체결 규칙으로 비교하고 마크다운 성과표를 출력한다.
//  node radar-service/backtest/run.mjs data.json.gz [--out results.json]
import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runSymbol, regimeOf, COSTS, ENGINE } from './engine.mjs';
import { metrics, fmt } from './metrics.mjs';
import { legacyProxy, randomBaseline, dualStrategies } from './strategies.mjs';
import { DUAL_RULES } from '../dual/combine.mjs';

const toCandles = rows => rows.map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], q: r[5] }));
export const SPLIT_FRACTION = 0.6;   // 앞 60% = 구간1, 뒤 40% = 구간2(기간 외 검증). 전략 규칙·임계값은 어느 구간에서도 조정하지 않았다.

export function runBacktest(dataset, { costs = COSTS, rules = DUAL_RULES, sweep = [60, 65, 70, 75, 80], randomSeeds = 3 } = {}) {
  const cs = Object.fromEntries(Object.entries(dataset.candles).map(([k, v]) => [k, toCandles(v)]));
  const btc = cs['BTC-USDT-SWAP'];
  if (!btc || btc.length < 1000) throw new Error('BTC 데이터 부족');
  const btcIdx = new Map(btc.map((x, i) => [x.t, i]));
  const start = btc[ENGINE.warmup].t, end = btc.at(-1).t, cutoff = start + (end - start) * SPLIT_FRACTION;
  const variants = {}, add = (name, sym, trades) => { (variants[name] ||= []).push(...trades.map(t => ({ ...t, symbol: sym, regime: regimeOf(btc, btcIdx.get(t.t) ?? -1), split: t.tEntry < cutoff ? '구간1' : '구간2' }))); };
  for (const [sym, c] of Object.entries(cs)) {
    if (sym === 'BTC-USDT-SWAP' && false) continue;
    if (c.length < ENGINE.warmup + 100) continue;
    const base = sym.replace('-USDT-SWAP', '');
    const run = fn => runSymbol(c, fn, { costs });
    add('기존(근사) TP1=1R', base, run(legacyProxy(c, btc, btcIdx, 1)));
    add('기존(근사) TP2=2R', base, run(legacyProxy(c, btc, btcIdx, 2)));
    const d = dualStrategies(c, btc, btcIdx, rules);
    add('전략 A', base, run(d.A)); add('전략 B', base, run(d.B)); add('A+B 우선후보', base, run(d.AB));
    for (let s = 0; s < randomSeeds; s++) add('무작위(비교 기준선)', base, run(randomBaseline(c, 1000 + s * 17 + base.length)));
    for (const th of sweep) {
      if (th === rules.priorityMin) continue;
      const dd = dualStrategies(c, btc, btcIdx, { ...rules, priorityMin: th });
      add(`민감도 A≥${th}`, base, run(dd.A)); add(`민감도 B≥${th}`, base, run(dd.B)); add(`민감도 A+B≥${th}`, base, run(dd.AB));
    }
  }
  const table = {};
  for (const [name, trades] of Object.entries(variants)) {
    const per = name.startsWith('무작위') ? trades : trades;
    const bySplit = {}, byRegime = {};
    for (const sp of ['구간1', '구간2']) bySplit[sp] = metrics(per.filter(t => t.split === sp));
    for (const rg of ['상승장', '하락장', '횡보장']) byRegime[rg] = metrics(per.filter(t => t.regime === rg));
    table[name] = { net: metrics(per), gross: metrics(per, { gross: true }), bySplit, byRegime };
  }
  const symbols = Object.keys(cs).length;
  return { meta: { ...dataset.meta, symbols, bars: btc.length, from: new Date(btc[0].t).toISOString(), to: new Date(end).toISOString(), cutoff: new Date(cutoff).toISOString(), costs, engine: ENGINE, rules }, table, trades: Object.fromEntries(Object.entries(variants).filter(([k]) => !k.startsWith('민감도')).map(([k, v]) => [k, v.length])) };
}

const pct = x => (x * 100).toFixed(1) + '%', num = (x, d = 3) => Number(x).toFixed(d);
const row = (name, m) => !m.n ? `| ${name} | 0 | - | - | - | - | - | - |` : `| ${name} | ${m.n} | ${pct(m.winRate)} | ${num(m.expectancyR)} | ${num(m.avgWinR, 2)} / ${num(m.avgLossR, 2)} | ${Number.isFinite(m.profitFactor) ? num(m.profitFactor, 2) : '∞'} | ${num(m.maxDrawdownR, 1)} | ${m.ci95 ? `[${num(m.ci95[0], 2)}, ${num(m.ci95[1], 2)}]` : '-'} |`;
const HEAD = '| 구분 | 거래 수 | 승률 | 기대값(R/거래) | 평균 이익/손실(R) | Profit Factor | 최대 낙폭(R) | 기대값 95% 구간 |\n|---|---|---|---|---|---|---|---|';

export function formatReport(r) {
  const L = [], main = ['기존(근사) TP1=1R', '기존(근사) TP2=2R', '전략 A', '전략 B', 'A+B 우선후보', '무작위(비교 기준선)'];
  L.push(`## 백테스트 결과 (${r.meta.symbols}종목 · 1시간봉 ${r.meta.bars}봉 · ${r.meta.from.slice(0, 10)} ~ ${r.meta.to.slice(0, 10)})`);
  L.push(`- 비용: 수수료 ${(r.meta.costs.feePerSide * 100).toFixed(2)}%/편도 · 슬리피지 ${(r.meta.costs.slipPerSide * 100).toFixed(2)}%/편도 · 펀딩 ${(r.meta.costs.fundingPer8h * 100).toFixed(3)}%/8h 보수 가정. 체결은 신호 다음 봉 시가, 손절·목표 동시 터치는 손절 우선, 최대 보유 ${r.meta.engine.maxHoldBars}봉.`);
  L.push(`- 구간 분할: 구간1 ~ ${r.meta.cutoff.slice(0, 10)} / 구간2(기간 외) 이후. 시장 구분은 신호 시점 직전 30일 BTC 수익률(+8% 초과 상승장 · −8% 미만 하락장).`);
  L.push(`### 1) 전체 (수수료·슬리피지 반영, R 단위)\n${HEAD}`); main.forEach(n => r.table[n] && L.push(row(n, r.table[n].net)));
  L.push(`### 2) 비용 반영 전(총손익) 대비 — 비용이 수익을 얼마나 갉아먹는가\n| 구분 | 총손익 기대값(R) | 비용 반영 기대값(R) | 거래당 비용(R) |\n|---|---|---|---|`);
  main.forEach(n => { const t = r.table[n]; if (t?.net.n) L.push(`| ${n} | ${num(t.gross.expectancyR)} | ${num(t.net.expectancyR)} | ${num(t.gross.expectancyR - t.net.expectancyR)} |`); });
  L.push(`### 3) 기간 분할 (구간2 = 기간 외 검증)\n${HEAD}`); main.forEach(n => r.table[n] && ['구간1', '구간2'].forEach(sp => L.push(row(`${n} · ${sp}`, r.table[n].bySplit[sp]))));
  L.push(`### 4) 시장 상황별\n${HEAD}`); main.forEach(n => r.table[n] && ['상승장', '하락장', '횡보장'].forEach(rg => L.push(row(`${n} · ${rg}`, r.table[n].byRegime[rg]))));
  const sens = Object.keys(r.table).filter(k => k.startsWith('민감도'));
  if (sens.length) { L.push(`### 5) 임계값 민감도 (참고용 — 결과를 보고 임계값을 고르면 과최적화이므로 75점 고정)\n${HEAD}`); sens.sort().forEach(n => L.push(row(n, r.table[n].net))); }
  const flags = main.filter(n => r.table[n]?.net.flags?.length).map(n => `- **${n}**: ${r.table[n].net.flags.join(' · ')}`);
  L.push(`### 6) 표본·과최적화 경고\n${flags.join('\n') || '- 해당 없음'}`);
  L.push('- 규칙·임계값은 사전에 고정했고 이 데이터로 조정하지 않았다. 그래도 종목 선정(현재 거래대금 상위)에 의한 생존 편향, OI·펀딩 과거 데이터 부재(기존 전략은 근사), 1시간봉 단일 해상도, 단일 시장 국면이라는 한계가 있어 미래 성과를 보장하지 않는다.');
  return L.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2]; if (!file || !existsSync(file)) { console.error('사용법: node run.mjs data.json.gz [--out results.json]'); process.exit(2); }
  const raw = readFileSync(file); const data = JSON.parse((file.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8'));
  const t0 = Date.now(), result = runBacktest(data), md = formatReport(result);
  console.log(md); console.log(`\n(계산 ${((Date.now() - t0) / 1000).toFixed(1)}초)`);
  const oi = process.argv.indexOf('--out'); if (oi > 0) writeFileSync(process.argv[oi + 1], JSON.stringify(result));
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md, { flag: 'a' });
}
