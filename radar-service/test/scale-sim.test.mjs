import test from 'node:test';
import assert from 'node:assert/strict';
import { scaleSimulate, scaleSummarize, scaleCompare, scaleReport, SCALE_VARIANTS } from '../signal/scale-sim.mjs';

// 결정적 의사난수(재현 가능한 합성 경로). 실제 시장 데이터가 아니라 *메커니즘 검증용*이다.
const rng = seed => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const bar = (t, o, c, h, l) => ({ t, o, c, h: h ?? Math.max(o, c) * 1.0005, l: l ?? Math.min(o, c) * 0.9995 });
function path(kind, seed, n = 260, base = 3000) {
  const r = rng(seed), bars = []; let px = base;
  const sig = 5, legs = { breakout: [0.0012, 0.0016], retest: [-0.0018, 0.0014] };    // A형: 돌파 후 지속 상승 / B형: 눌림·재시험 후 상승
  for (let k = 0; k < n; k++) {
    const phase = k < sig ? 0 : k < sig + 12 ? 1 : 2, drift = kind === 'noise' ? 0 : phase === 1 ? legs[kind][0] : phase === 2 ? legs[kind][1] * (r() < 0.55 ? 1 : -0.8) : 0.0002;
    const o = px, c = o * (1 + drift + (r() - 0.5) * 0.004), h = Math.max(o, c) * (1 + r() * 0.0015), l = Math.min(o, c) * (1 - r() * 0.0015);
    bars.push({ t: k, o, h, l, c }); px = c;
  }
  return bars;
}
const ev = (bars, dir = 'LONG', i = 4, dist = 0.012) => ({ symbol: 'ETHUSDT', dir, stop: dir === 'LONG' ? bars[i + 1].o * (1 - dist) : bars[i + 1].o * (1 + dist), bars, i });

test('곧바로 오르면 TP1·TP2 를 채우고 이익, 한도 초과 없음', () => {
  const b = [bar(0, 3000, 3000), bar(1, 3000, 3030, 3032, 2999), bar(2, 3030, 3070, 3075, 3030), bar(3, 3070, 3090, 3100, 3068), bar(4, 3090, 3010, 3095, 3000)];
  const r = scaleSimulate(b, 0, { symbol: 'ETHUSDT', dir: 'LONG', stop: 2964 }, { maxBars: 4 });
  assert.equal(r.excluded, false); assert.ok(r.tp1 && r.tp2); assert.ok(r.pnl > 0); assert.equal(r.stagesFilled, 1); assert.equal(r.budgetExceeded, false);
});

test('허용 시간이 지난 뒤 손절이면 추가 체결 없이 1차 몫(≈50%)만 손실', () => {
  const b = [bar(0, 3000, 3000), bar(1, 3000, 3020, 3022, 2999), bar(2, 3020, 3015, 3025, 3010), bar(3, 3015, 2950, 3016, 2940)];
  const r = scaleSimulate(b, 0, { symbol: 'ETHUSDT', dir: 'LONG', stop: 2964 }, { window: 1 });
  assert.equal(r.kind, 'stop'); assert.equal(r.stagesFilled, 1); assert.ok(r.pnl < 0); assert.ok(-r.rMult > 0.3 && -r.rMult < 0.62, `rMult ${r.rMult}`);
});

test('3차까지 모두 체결된 뒤 손절이어도 계획 최악 손실 이내', () => {
  const b = [bar(0, 3000, 3000), bar(1, 3000, 2990, 3001, 2985), bar(2, 2990, 2975, 2991, 2972), bar(3, 2975, 2968, 2976, 2966), bar(4, 2968, 2950, 2969, 2940)];
  const r = scaleSimulate(b, 0, { symbol: 'ETHUSDT', dir: 'LONG', stop: 2964, }, { equity: 300 });
  assert.equal(r.stagesFilled, 3); assert.equal(r.kind, 'stop'); assert.equal(r.budgetExceeded, false); assert.ok(-r.pnl <= r.planWorst + 1e-9);
});

test('시간 창 밖에서는 지정가가 닿아도 추가 체결 금지', () => {
  const b = [bar(0, 3000, 3000), bar(1, 3000, 3010, 3012, 2999.5), bar(2, 3010, 3005, 3012, 3000), bar(3, 3005, 2985, 3006, 2984), bar(4, 2985, 2990, 2991, 2984)];
  const r = scaleSimulate(b, 0, { symbol: 'ETHUSDT', dir: 'LONG', stop: 2964 }, { window: 2, maxBars: 4 });
  assert.equal(r.stagesFilled, 1);
});

test('SHORT 도 같은 규칙: 갭 손절은 시가 청산, 한도 초과로 집계', () => {
  const b = [bar(0, 3000, 3000), bar(1, 3000, 2998, 3001, 2996), bar(2, 3100, 3105, 3110, 3098)];
  const r = scaleSimulate(b, 0, { symbol: 'ETHUSDT', dir: 'SHORT', stop: 3036 });
  assert.equal(r.kind, 'gap-stop'); assert.equal(r.budgetExceeded, true);
});

test('동봉 손절·익절 충돌은 손절 우선', () => {
  const b = [bar(0, 3000, 3000), bar(1, 3000, 3010, 3012, 2999), bar(2, 3010, 3010, 3090, 2950)];
  const r = scaleSimulate(b, 0, { symbol: 'ETHUSDT', dir: 'LONG', stop: 2964 });
  assert.equal(r.kind, 'stop'); assert.equal(r.tp1, false);
});

test('합성 경로 600건: 1차 몫 이내가 아닌 손실은 갭 손절 외에 없다(0.5% 한도 보장)', () => {
  let n = 0, exceeded = 0, nonGapExceeded = 0;
  for (const kind of ['breakout', 'retest', 'noise']) for (const dir of ['LONG', 'SHORT']) for (let seed = 1; seed <= 100; seed++) {
    const b = path(kind, seed * 7 + 3), e = ev(b, dir);
    for (const v of SCALE_VARIANTS) {
      const r = scaleSimulate(b, e.i, e, { params: v.params }); if (r.excluded !== false) continue;
      n++; if (r.budgetExceeded) { exceeded++; if (r.kind !== 'gap-stop') nonGapExceeded++; }
      assert.ok(r.fillRatio <= 1 + 1e-9);
    }
  }
  assert.ok(n > 3000); assert.equal(nonGapExceeded, 0, `한도 초과 ${exceeded}건 중 갭 외 ${nonGapExceeded}건`);
});

test('결정적: 같은 입력은 같은 결과, 변형 비교와 리포트 출력', () => {
  const events = []; for (const strategy of ['A', 'B']) for (let s = 1; s <= 30; s++) { const b = path(strategy === 'A' ? 'breakout' : 'retest', s * 11); events.push({ ...ev(b, 'LONG'), strategy }); }
  const c1 = scaleCompare(events), c2 = scaleCompare(events);
  assert.deepEqual(c1, c2); assert.deepEqual(Object.keys(c1), ['A', 'B']);
  for (const k of ['A', 'B']) for (const v of SCALE_VARIANTS) { const s = c1[k][v.id]; assert.ok(s.n > 0, `${k}/${v.id}`); assert.ok(s.addFillRate !== null); }
  assert.equal(c1.A.single.addFillRate, 0); assert.equal(c1.A.single.avgStagesFilled, 1);
  const rep = scaleReport(c1); assert.match(rep, /전략 A/); assert.match(rep, /전략 B/); assert.match(rep, /분할 50\/30\/20/);
});

test('요약: 빈 입력과 제외 집계', () => {
  const s = scaleSummarize([{ excluded: true }, { excluded: false, rMult: 1, kind: 'time', tp1: true, tp2: false, stagesFilled: 1, adds: 0, fillRatio: 1, budgetExceeded: false, bars: 3 }]);
  assert.equal(s.n, 1); assert.equal(s.excluded, 1); assert.equal(s.excludedRate, 0.5); assert.equal(scaleSummarize([]).n, 0);
});

import { synthEvents } from '../signal/scale-synth.mjs';
test('합성 A형·B형 비교: 한도 불변 + 메커니즘(눌림형은 분할 유리, 추세형은 분할이 이익 줄임)', () => {
  const ev = synthEvents({ count: 300 }), c = scaleCompare(ev, { variants: SCALE_VARIANTS.filter(v => ['single', 'split-50-30-20'].includes(v.id)) });
  for (const k of ['A', 'B']) for (const id of ['single', 'split-50-30-20']) assert.equal(c[k][id].budgetExceededRate, 0);
  assert.ok(c.B['split-50-30-20'].avgR > c.B.single.avgR, 'B형: 분할이 단일 이상');
  assert.ok(c.A['split-50-30-20'].avgR < c.A.single.avgR, 'A형: 분할은 체결률 하락만큼 이익이 줄어듦');
  assert.deepEqual(synthEvents({ count: 5 }), synthEvents({ count: 5 }));
});
