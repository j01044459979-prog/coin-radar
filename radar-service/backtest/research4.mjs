// 4.0 연구 하네스: 선별형 추세 + 눌림목(A·B·C·D)을 3.0 전략·기존 근사·무작위 기준선과 같은 엔진·같은 비용·같은 계정 가정으로 비교한다.
// 규칙·임계값은 docs/TREND-PULLBACK-4-0-PREREG.md에 고정(탐색 없음). 이 파일은 '실행'과 '판정'만 한다.
import { runSymbol, regimeOf, COSTS } from './engine.mjs';
import { legacyProxy, randomBaseline, dualStrategies } from './strategies.mjs';
import { prepare, universeFor, periodDefs, EMBARGO } from './research.mjs';
import { makeStrategy4, trendSeries } from '../dual/strategy4.mjs';
import { summary } from './stats.mjs';
import { quarterOf } from './stats4.mjs';

export const ACCOUNT4 = Object.freeze({ equity: 10000, riskFrac: 0.005 });   // 거래당 계좌 위험 0.5%
export const MAX_OPEN4 = 3;                                                   // 동시 포지션 최대 3개(포트폴리오 단계)
export const CANDIDATES4 = ['TP4_A', 'TP4_B', 'TP4_C', 'TP4_D'];
export const BASELINES4 = ['v3_A', 'v3_B', 'v3_AB', 'legacy2', 'random', 'randomTrend'];
export const NAMES4 = [...CANDIDATES4, ...BASELINES4];
export const PREREG4 = Object.freeze({ minTrades: 100, pfMin: 1.15, stress: [1.5, 2], minRegimeN: 20, topSymbolsRemoved: 3 });

export function runResearch4(dataset, { periods = ['dev', 'val', 'seen'], costMults = [1, 1.5, 2], universeN = 20, onSegment = null } = {}) {
  const prep = prepare(dataset), PER = periodDefs(prep.btc[0].t);
  const uni = Object.fromEntries(periods.map(p => [p, universeFor(prep, PER[p].from, universeN)]));
  const regimeAt = t => regimeOf(prep.btc, prep.btcIdx.get(t) ?? -1), btcT = trendSeries(prep.btc);
  const res = { prep: { gaps: prep.gaps, bars: prep.btc.length, from: prep.btc[0].t, to: prep.btc.at(-1).t, symbols: prep.segs.length }, periods: PER, active: periods, universe: Object.fromEntries(periods.map(p => [p, [...uni[p]]])), trades: {}, skipped: {}, evaluated: 0 };
  const costsOf = m => ({ ...COSTS, feePerSide: COSTS.feePerSide * m, slipPerSide: COSTS.slipPerSide * m, fundingPer8h: COSTS.fundingPer8h * m });
  for (const seg of prep.segs) {
    if (!periods.some(p => uni[p].has(seg.base))) continue;
    const inst = prep.specs[seg.id] ?? null, s4 = makeStrategy4(seg.c, prep.btc, prep.btcIdx, btcT), v3 = dualStrategies(seg.c, prep.btc, prep.btcIdx);
    const seed = [...seg.name].reduce((a, ch) => a + ch.charCodeAt(0), 7);
    const fns = {
      TP4_A: [s4.A], TP4_B: [s4.B], TP4_C: [s4.C], TP4_D: [s4.D],
      v3_A: [v3.A], v3_B: [v3.B], v3_AB: [v3.AB], legacy2: [legacyProxy(seg.c, prep.btc, prep.btcIdx, 2)],
      random: [0, 1, 2].map(k => randomBaseline(seg.c, 1000 + seed * 31 + k * 17)),
      randomTrend: [0, 1, 2].map(k => s4.randomTrend(2000 + seed * 31 + k * 17)),
    };
    for (const mult of costMults) for (const p of periods) {
      if (!uni[p].has(seg.base)) continue;
      for (const v of NAMES4) for (const fn of fns[v]) {
        const tr = runSymbol(seg.c, fn, { costs: costsOf(mult), account: ACCOUNT4, from: PER[p].from + (p === 'dev' ? 0 : EMBARGO), to: PER[p].to, inst, stats: mult === 1 ? res.skipped : {} });
        const bucket = ((res.trades[mult] ||= {})[p] ||= {})[v] ||= [];
        for (const t of tr) bucket.push({ ...t, symbol: seg.base, seg: seg.name, period: p, regime: regimeAt(t.t), variant: v });
        res.evaluated++;
      }
    }
    if (onSegment) onSegment(seg, s4, { uni, PER, periods, res });
  }
  res.prepObj = prep;
  return res;
}

export const poolOf = (res, mult, variant, periods) => periods.flatMap(p => res.trades[mult]?.[p]?.[variant] ?? []);
const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : x === Infinity ? '∞' : '-');

// 사전 등록 판정(OOS 풀 = 검증 ∪ 이미 본 구간). periods 인자로 풀을 바꿀 수 있다(최종 테스트 때는 ['final']).
export function judge4(res, variant, periods = ['val', 'seen']) {
  const T1 = poolOf(res, 1, variant, periods), s = summary(T1), out = { variant, periods, n: T1.length, checks: [] };
  const chk = (name, pass, detail) => out.checks.push({ name, pass: Boolean(pass), detail });
  chk('청산 거래 ≥ 100', s.n >= PREREG4.minTrades, `n=${s.n}`);
  chk('비용 반영 기대값 > 0', s.n && s.avg > 0, `평균 ${f(s.avg)}R`);
  chk('95% 신뢰구간(주 블록) 하한 > 0', s.ci && s.ci[0] > 0, s.ci ? `[${f(s.ci[0])}, ${f(s.ci[1])}]` : '산출 불가');
  chk('Profit Factor ≥ 1.15', s.n && s.pf >= PREREG4.pfMin, `PF ${f(s.pf, 2)}`);
  for (const m of PREREG4.stress) { const ss = summary(poolOf(res, m, variant, periods)); chk(`비용 ${m}배 스트레스에서 기대값 > 0`, ss.n && ss.avg > 0, `평균 ${f(ss.avg)}R PF ${f(ss.pf, 2)}`); }
  const bySym = new Map(); for (const t of T1) bySym.set(t.symbol, (bySym.get(t.symbol) || 0) + t.rNet);
  const top = [...bySym.entries()].sort((a, b) => b[1] - a[1]).slice(0, PREREG4.topSymbolsRemoved).map(e => e[0]), sr = summary(T1.filter(t => !top.includes(t.symbol)));
  chk('상위 3종목 제외 후에도 기대값 > 0', sr.n && sr.avg > 0, `제외 ${top.join(',')} → 평균 ${f(sr.avg)}R (n=${sr.n})`);
  const byQ = new Map(); for (const t of T1) byQ.set(quarterOf(t.tEntry), (byQ.get(quarterOf(t.tEntry)) || 0) + t.rNet);
  const bestQ = [...byQ.entries()].sort((a, b) => b[1] - a[1])[0]?.[0], qr = summary(T1.filter(t => quarterOf(t.tEntry) !== bestQ));
  chk('수익 최상위 분기 1개 제외 후에도 기대값 > 0', qr.n && qr.avg > 0, `제외 ${bestQ ?? '-'} → 평균 ${f(qr.avg)}R (n=${qr.n})`);
  if (periods.length > 1) for (const p of periods) { const sp = summary(res.trades[1]?.[p]?.[variant] ?? []); chk(`${res.periods[p].label.split('(')[0]} 구간 단독 기대값 > 0`, sp.n && sp.avg > 0, `n=${sp.n} 평균 ${f(sp.avg)}R`); }
  const regs = ['상승장', '하락장', '횡보장'].map(r => ({ r, ...summary(T1.filter(t => t.regime === r)) })).filter(x => x.n >= PREREG4.minRegimeN);
  chk('특정 국면에만 집중되지 않음(n≥20인 국면 중 ≥2곳 양수)', regs.length >= 2 && regs.filter(x => x.avg > 0).length >= 2, regs.map(x => `${x.r} n=${x.n} 평균 ${f(x.avg)}`).join(', ') || '국면별 표본 부족');
  out.pass = out.checks.every(c => c.pass);
  out.insufficient = s.n < PREREG4.minTrades;
  return out;
}
