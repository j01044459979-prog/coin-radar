// 5분봉 모멘텀 백테스트 파이프라인·합격 판정 테스트(합성 데이터 — 파이프라인 검증이지 성과 증거가 아니다).
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectMomentumEvents, runMomentumBacktest, momentumVerdict, renderMomentumReport, MBT } from '../signal/momentum-backtest.mjs';
import { M5 } from '../signal/momentum5m.mjs';
import { synthRng } from '../signal/scale-synth.mjs';
import { TP_VARIANTS, scaleCompare } from '../signal/scale-sim.mjs';

// 랜덤워크 + 가끔 가속 구간(거래대금 증가). edge: 가속 뒤 평균 추가 상승(드리프트).
function market(seed, { n = 8000, edge = 0 } = {}) {
  const r = synthRng(seed), bars = []; let p = 100, burst = 0;
  for (let i = 0; i < n; i++) {
    if (burst === 0 && r() < 0.004) burst = 6; const inBurst = burst > 0; if (burst > 0) burst--;
    const drift = (inBurst ? 0.0022 : 0.00004) + (burst === 0 && i > 0 && bars[i - 1].burst ? edge : 0), o = p, c = o * (1 + drift + (r() - 0.5) * 0.008), h = Math.max(o, c) * (1 + r() * 0.002), l = Math.min(o, c) * (1 - r() * 0.002);
    bars.push({ t: 1.7e12 + i * M5, o, c, h, l, q: (inBurst ? 3.2 : 1) * 1e5 * (0.8 + r() * 0.4), burst: inBurst }); p = c;
  }
  return bars.map(({ burst, ...b }) => b);
}
const data = (k, o) => Object.fromEntries(Array.from({ length: k }, (_, s) => [`C${s}USDT`, market(100 + s, o)]));

test('이벤트 수집: 쿨다운 준수·미래 비참조(손절은 진입가 아래)·재현 가능', () => {
  const c5 = market(1), a = collectMomentumEvents('ETHUSDT', c5), b = collectMomentumEvents('ETHUSDT', c5);
  assert.deepEqual(a, b); assert.ok(a.length > 0);
  for (const e of a) assert.ok(e.stop < e.entry && e.dir === 'LONG' && e.i >= MBT.window - 1);
  for (let k = 1; k < a.length; k++) assert.ok(a[k].t - a[k - 1].t >= 3 * 3600000);
  const ctl = collectMomentumEvents('ETHUSDT', c5, { control: true }); assert.ok(ctl.length >= a.length, '대조군은 조건이 느슨해 같거나 많다');
});
test('미래 비참조: 이후 봉을 바꿔도 같은 시점의 이벤트는 그대로', () => {
  const c5 = market(2), cut = 5000, a = collectMomentumEvents('X', c5.slice(0, cut + 2)).filter(e => e.i < cut - 5), tweaked = c5.map((b, i) => (i > cut + 2 ? { ...b, c: b.c * 1.5, h: b.h * 1.5 } : b)), b = collectMomentumEvents('X', tweaked).filter(e => e.i < cut - 5);
  assert.deepEqual(a.map(e => [e.i, e.stop]), b.map(e => [e.i, e.stop]));
});
test('파이프라인: 변형 4종 결과·홀드아웃·대조군·판정 구조, 결정적, 위험 한도 불변', () => {
  const d = data(12), r1 = runMomentumBacktest(d), r2 = runMomentumBacktest(d);
  assert.deepEqual(r1.verdict, r2.verdict); assert.equal(r1.events, r2.events); assert.ok(r1.events > 0 && r1.holdoutEvents > 0 && r1.controlEvents > 0);
  assert.deepEqual(Object.keys(r1.variants), TP_VARIANTS.map(v => v.id));
  for (const v of Object.values(r1.variants)) { assert.ok(v.all.n > 0); assert.equal(v.all.budgetExceededRate === null ? 0 : Math.round(v.all.budgetExceededRate * 100) <= 5, true); assert.ok('ci' in v.holdout); }
  assert.match(renderMomentumReport(r1), /판정: (PASS|FAIL)/);
});
test('이익 우위가 없는 합성 시장(엣지 0)에서는 합격하지 않는다(거짓 양성 방지)', () => {
  const r = runMomentumBacktest(data(14, { edge: 0 })); assert.equal(r.verdict.pass, false); assert.ok(r.verdict.fails.length > 0);
});
test('합격 판정 규칙: 이벤트·홀드아웃·종목 수·집중도·대조군·스트레스·신뢰구간을 각각 확인', () => {
  const good = { avgR: 0.2, ci: { lo: 0.05, hi: 0.35 }, n: 100 }, ok = { events: 300, holdoutEvents: 90, symbols: 20, topShare: 0.1, primary: { holdout: good, stress: { avgR: 0.05 }, control: { avgR: 0.0, n: 50 } } };
  assert.equal(momentumVerdict(ok).pass, true);
  const worse = patch => momentumVerdict({ ...ok, ...patch });
  assert.match(worse({ events: 100 }).fails.join(), /이벤트 부족/); assert.match(worse({ holdoutEvents: 10 }).fails.join(), /홀드아웃 이벤트 부족/); assert.match(worse({ symbols: 3 }).fails.join(), /종목 수/); assert.match(worse({ topShare: 0.6 }).fails.join(), /집중/);
  assert.match(worse({ primary: { ...ok.primary, holdout: { ...good, ci: { lo: -0.1, hi: 0.4 } } } }).fails.join(), /하한/); assert.match(worse({ primary: { ...ok.primary, stress: { avgR: -0.1 } } }).fails.join(), /스트레스/);
  assert.match(worse({ primary: { ...ok.primary, control: { avgR: 0.3, n: 50 } } }).fails.join(), /대조군/); assert.match(worse({ primary: { ...ok.primary, holdout: { ...good, avgR: -0.1 } } }).fails.join(), /평균 R ≤ 0/);
});
test('익절 비율 비교: 30/30/40 변형은 TP 1.5R·2.5R 와 잔여 40% 추적으로 구성되고 모두 단일 진입', () => {
  const v = TP_VARIANTS.find(x => x.id === 'tp-30-30-40'); assert.deepEqual(v.params.tp, [{ r: 1.5, w: 0.3 }, { r: 2.5, w: 0.3 }]); assert.deepEqual(v.params.weights, [1]);
  const evs = Object.entries(data(3)).flatMap(([s, bars]) => collectMomentumEvents(s, bars).slice(0, 5).map(e => ({ ...e, bars, strategy: 'M' })));
  const cmp = scaleCompare(evs, { variants: TP_VARIANTS, equity: MBT.equity, maxBars: MBT.maxBars }); for (const v2 of TP_VARIANTS) { const s = cmp.M[v2.id]; assert.ok(s.n > 0); assert.equal(s.avgStagesFilled, 1); }
});
