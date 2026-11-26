// 5분봉 상승 가속 모멘텀 검증(순수 함수, 읽기 전용). 사전 지정 합격 기준으로 PASS/FAIL 을 낸다 — 홀드아웃 결과를 보고 임계값을 고치지 않는다.
//  · 이벤트: 종목별 5분봉에서 evaluateMomentum5m 을 모든 봉마다 평가(운영과 같은 쿨다운). 대조군: 가속·거래대금 조건만 뺀 같은 추세·봉 품질 조건.
//  · 결과: scaleSimulate(다음 봉 시가 진입, 수수료·슬리피지 포함, 손절 우선 보수적 체결)로 R 배수. 위험 한도 0.5% 기준 R.
//  · 합격(모두 충족): 전체 이벤트 ≥ 200 · 홀드아웃(마지막 30% 시간) 이벤트 ≥ 60 · 홀드아웃 평균 R > 0 이고 일 군집 부트스트랩 95% 하한 > 0 · 비용 2배 스트레스 평균 R > 0 ·
//    대조군보다 홀드아웃 평균 R 이 높음 · 이벤트가 발생한 종목 ≥ 10 · 한 종목이 전체의 25% 초과 아님. 하나라도 어기면 FAIL(운영 승격 금지).
import { aggregate, H1 } from '../opportunity/indicators.mjs';
import { clusterBootstrap } from '../opportunity/backtest.mjs';
import { evaluateMomentum5m, MOM5, M5 } from './momentum5m.mjs';
import { scaleSimulate, scaleSummarize, TP_VARIANTS } from './scale-sim.mjs';

export const MBT = Object.freeze({ window: 100, equity: 10000, maxBars: 144, holdoutShare: 0.3, minEvents: 200, minHoldout: 60, minSymbols: 10, maxSymbolShare: 0.25, primary: 'tp-50-30-20' });
const CONTROL_P = Object.freeze({ ...MOM5, minRecentPct: -1e9, accelRatio: 0, prevFloorPct: -1e9, volMult: 0 });

export function collectMomentumEvents(symbol, c5, { control = false, P = control ? CONTROL_P : MOM5, cooldownMs = MOM5.cooldownMs } = {}) {
  const c1hAll = aggregate(c5, M5, H1), out = []; let p1 = 0, lastAt = -Infinity;
  for (let i = MBT.window - 1; i < c5.length - 2; i++) {
    const closeT = c5[i].t + M5;
    while (p1 < c1hAll.length && c1hAll[p1].t + H1 <= closeT) p1++;
    if (closeT - lastAt < cooldownMs) continue;
    const e = evaluateMomentum5m(c5.slice(i - MBT.window + 1, i + 1), c1hAll.slice(Math.max(0, p1 - 60), p1), closeT + 60000, P);
    if (e.status !== 'SIGNAL') continue;
    out.push({ symbol, i, t: closeT, dir: 'LONG', stop: e.stop, entry: e.entry, strategy: control ? 'control' : 'momentum-5m' }); lastAt = closeT;
  }
  return out;
}

const stressParams = p => ({ ...p, feeBps: 10, entrySlipBps: 10, stopSlipBps: 20 });
export function runMomentumBacktest(coinData, { variants = TP_VARIANTS, equity = MBT.equity } = {}) {
  const evs = [], ctl = [];
  for (const [symbol, c5] of Object.entries(coinData)) {
    for (const e of collectMomentumEvents(symbol, c5)) evs.push({ ...e, bars: c5 });
    for (const e of collectMomentumEvents(symbol, c5, { control: true })) ctl.push({ ...e, bars: c5 });
  }
  const times = evs.concat(ctl).map(e => e.t), tMin = Math.min(...times), tMax = Math.max(...times), cut = times.length ? tMax - (tMax - tMin) * MBT.holdoutShare : Infinity;
  const sim = (set, params) => set.map(e => ({ ...scaleSimulate(e.bars, e.i, e, { equity, maxBars: MBT.maxBars, params }), t: e.t, symbol: e.symbol }));
  const per = {};
  for (const v of variants) {
    const all = sim(evs, v.params), hold = all.filter(r => r.t >= cut), stress = sim(evs, stressParams(v.params)).filter(r => r.t >= cut), c = sim(ctl, v.params).filter(r => r.t >= cut);
    const done = a => a.filter(r => r.excluded === false);
    const ci = a => clusterBootstrap(done(a).map(r => ({ t: r.t, r: r.rMult })), x => x.r);
    per[v.id] = { all: scaleSummarize(all), holdout: { ...scaleSummarize(hold), ci: ci(hold) }, stress: scaleSummarize(stress), control: scaleSummarize(c) };
  }
  const events = evs.length, holdoutEvents = evs.filter(e => e.t >= cut).length, bySym = {}; for (const e of evs) bySym[e.symbol] = (bySym[e.symbol] ?? 0) + 1;
  const symbols = Object.keys(bySym).length, topShare = events ? Math.max(...Object.values(bySym)) / events : 0;
  return { events, holdoutEvents, controlEvents: ctl.length, symbols, topShare, cut, variants: per, verdict: momentumVerdict({ events, holdoutEvents, symbols, topShare, primary: per[MBT.primary] }) };
}

export function momentumVerdict({ events, holdoutEvents, symbols, topShare, primary }) {
  const fails = [], h = primary?.holdout, st = primary?.stress, c = primary?.control;
  if (events < MBT.minEvents) fails.push(`이벤트 부족(${events} < ${MBT.minEvents})`);
  if (holdoutEvents < MBT.minHoldout) fails.push(`홀드아웃 이벤트 부족(${holdoutEvents} < ${MBT.minHoldout})`);
  if (!(h && h.avgR > 0)) fails.push(`홀드아웃 평균 R ≤ 0 (${h?.avgR?.toFixed?.(3) ?? '-'})`);
  if (!(h?.ci && h.ci.lo > 0)) fails.push(`홀드아웃 95% 하한 ≤ 0 (${h?.ci?.lo?.toFixed?.(3) ?? '-'})`);
  if (!(st && st.avgR > 0)) fails.push(`비용 2배 스트레스 평균 R ≤ 0 (${st?.avgR?.toFixed?.(3) ?? '-'})`);
  if (!(c && h && c.n > 0 && h.avgR > c.avgR)) fails.push(`대조군보다 낫지 않음(전략 ${h?.avgR?.toFixed?.(3) ?? '-'} vs 대조 ${c?.avgR?.toFixed?.(3) ?? '-'})`);
  if (symbols < MBT.minSymbols) fails.push(`이벤트 종목 수 부족(${symbols} < ${MBT.minSymbols})`);
  if (topShare > MBT.maxSymbolShare) fails.push(`한 종목 집중(${(topShare * 100).toFixed(0)}% > ${MBT.maxSymbolShare * 100}%)`);
  return { pass: fails.length === 0, fails, rule: '사전 지정 기준(홀드아웃으로 임계값 조정 금지)' };
}

export function renderMomentumReport(r, meta = {}) {
  const f = (x, d = 3) => (x === null || x === undefined ? '-' : Number(x).toFixed(d)), pc = x => (x === null || x === undefined ? '-' : `${(x * 100).toFixed(0)}%`), L = [];
  L.push(`■ 5분봉 상승 가속 모멘텀 검증${meta.note ? ` — ${meta.note}` : ''}`, `이벤트 ${r.events}건(홀드아웃 ${r.holdoutEvents}) · 종목 ${r.symbols} · 최대 종목 비중 ${pc(r.topShare)} · 대조군 이벤트 ${r.controlEvents}`);
  L.push('변형 | 전체 n | 전체 평균R | 홀드아웃 n | 홀드 평균R | 95% 구간 | 스트레스 평균R | 대조 평균R | 최악R | 손절률 | TP1 | TP2');
  for (const v of TP_VARIANTS) { const x = r.variants[v.id]; if (!x) continue; L.push(`${v.label} | ${x.all.n} | ${f(x.all.avgR)} | ${x.holdout.n} | ${f(x.holdout.avgR)} | ${f(x.holdout.ci?.lo)}~${f(x.holdout.ci?.hi)} | ${f(x.stress.avgR)} | ${f(x.control.avgR)} | ${f(x.all.worstR, 2)} | ${pc(x.all.stopRate)} | ${pc(x.all.tp1Rate)} | ${pc(x.all.tp2Rate)}`); }
  L.push(`판정: ${r.verdict.pass ? 'PASS' : 'FAIL'}${r.verdict.fails.length ? ' — ' + r.verdict.fails.join(' · ') : ''} (${r.verdict.rule})`);
  return L.join('\n');
}
