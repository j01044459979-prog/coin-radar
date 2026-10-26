// 분할 진입·익절 계획(scale.mjs) 시험. 합성 값만 쓰며 네트워크·주문 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPLAN, splanBuild, splanSpec, splanTpLegs, splanStatus, splanCheckAdd, splanLines, splanStatusLines, splanReasonText } from '../signal/scale.mjs';

const mk = (o = {}) => splanBuild({ symbol: 'ETHUSDT', dir: 'LONG', entry: 3012.5, stop: 2980, equity: 300, ...o });
const FILL = (kind, price, qty, at) => ({ kind, price, qty, at });
const rng = seed => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

test('기본값: 진입 50/30/20, 추가 0.3R·0.6R, TP 1.5R 50%·2R 30%·잔여 20%, 거래당 위험 0.5%, 격리 3배→2배', () => {
  assert.deepEqual([...SPLAN.weights], [0.5, 0.3, 0.2]); assert.deepEqual([...SPLAN.addR], [0.3, 0.6]); assert.deepEqual(SPLAN.tp.map(t => [t.r, t.w]), [[1.5, 0.5], [2, 0.3]]); assert.equal(SPLAN.riskPct, 0.005); assert.deepEqual([...SPLAN.levs], [3, 2]);
  const p = mk(); assert.equal(p.status, 'ok'); assert.equal(p.lev, 3); assert.equal(p.stagesCount, 3); assert.equal(p.degraded, null); assert.deepEqual(p.stages.map(s => Math.round(s.weight * 100)), [50, 30, 20]); assert.equal(p.runnerWeight, 0.2);
  assert.equal(p.R, 32.5); assert.deepEqual(p.stages.map(s => s.price), [3012.5, 3002.75, 2993]); assert.deepEqual(p.tps.map(t => t.price), [3061.25, 3077.5]);        // TP = 1차 진입가 + 1.5R·2R
  assert.equal(p.riskBudget, 1.5);
});
test('핵심 보장: 3단계 모두 체결 후 손절되는 최악 손실(수수료·슬리피지 포함)이 평가액의 0.5%를 넘지 않는다 — 난수 3,000건(LONG/SHORT·여러 가격대·평가액)', () => {
  const r = rng(7); let ok = 0, ex = 0;
  for (let k = 0; k < 3000; k++) {
    const price = 10 ** (r() * 5 - 1.5), riskPct = 0.003 + r() * 0.08, dir = r() < 0.5 ? 'LONG' : 'SHORT', equity = 50 + r() * 20000, entry = Number(price.toPrecision(5)), stop = Number((dir === 'LONG' ? entry * (1 - riskPct) : entry * (1 + riskPct)).toPrecision(5));
    const p = splanBuild({ symbol: 'XYZUSDT', dir, entry, stop, equity });
    if (p.status !== 'ok') { ex++; assert.ok(['cost-heavy', 'min-size', 'liq-buffer', 'margin-cap', 'size-too-small', 'stop-on-wrong-side'].includes(p.reason), p.reason); continue; }
    ok++; const step = p.spec.step;
    assert.ok(p.worstLoss <= p.riskBudget, `worst ${p.worstLoss} > ${p.riskBudget}`); assert.ok(p.worstLossPct <= 0.005 + 1e-12); assert.ok(p.marginUsage <= 0.3 + 1e-9);
    for (const s of p.stages) { assert.ok(s.qty >= p.spec.minQty - 1e-12); assert.ok(Math.abs(s.qty / step - Math.round(s.qty / step)) < 1e-6, '단위 배수'); assert.ok(s.qty * s.price >= p.spec.minNotional - 1e-9); }
    assert.ok(p.liqRatio <= 0.6 + 1e-12); assert.ok(p.minAvailable >= equity * 0.7 - 1e-9); assert.ok(p.equityAfterWorst > 0);
  }
  assert.ok(ok > 1500 && ex > 100, `ok=${ok} ex=${ex}`);
});
test('LONG/SHORT 대칭: 같은 R 구조를 거울상으로 두면 수량·위험이 같다', () => {
  const a = mk(), b = splanBuild({ symbol: 'ETHUSDT', dir: 'SHORT', entry: 3012.5, stop: 3045, equity: 300 });
  assert.deepEqual(a.stages.map(s => s.qty), b.stages.map(s => s.qty)); assert.ok(Math.abs(a.worstLoss - b.worstLoss) / a.worstLoss < 0.01); assert.deepEqual(b.stages.map(s => s.price), [3012.5, 3022.25, 3032]); assert.deepEqual(b.tps.map(t => t.price), [2963.75, 2947.5]);
});
test('수량은 내림: 올림하면 한도를 넘는 경계에서도 최악 손실이 한도 이하이고, 평가액이 커질수록 한도 사용률이 1에 가까워진다', () => {
  const small = mk({ equity: 300 }), big = mk({ equity: 30000 }); assert.ok(small.worstLoss <= small.riskBudget); assert.ok(big.worstLoss <= big.riskBudget); assert.ok(big.worstLoss / big.riskBudget > 0.98);
  const raw = big.riskBudget / (big.worstLoss / big.totalQty); assert.ok(big.totalQty <= raw + 1e-9);                      // 한도가 허용하는 수량을 넘지 않음
});
test('격리 3배 기본 → 청산 여유가 부족하면 2배 대안 → 그래도 안 되면 거래 제외', () => {
  const two = splanBuild({ symbol: 'ABCUSDT', dir: 'LONG', entry: 100, stop: 75, equity: 5000 }); assert.equal(two.status, 'ok'); assert.equal(two.lev, 2);           // 손절 25%: 3배 청산 거리 대비 76% > 60% → 2배
  const none = splanBuild({ symbol: 'ABCUSDT', dir: 'LONG', entry: 100, stop: 40, equity: 5000 }); assert.equal(none.status, 'excluded'); assert.equal(none.reason, 'liq-buffer');
  assert.equal(mk().lev, 3); assert.equal(splanBuild({ symbol: 'ETHUSDT', dir: 'LONG', entry: 3012.5, stop: 2980, equity: 300, lev: 2 }).lev, 2);
});
test('제외 조건: 손절이 너무 가까움(비용 과다)·방향 불일치·평가액 없음·증거금 한도·최소 주문 미달', () => {
  assert.equal(splanBuild({ symbol: 'ETHUSDT', dir: 'LONG', entry: 3000, stop: 2997, equity: 5000 }).reason, 'cost-heavy');
  assert.equal(splanBuild({ symbol: 'ETHUSDT', dir: 'LONG', entry: 3000, stop: 3100, equity: 5000 }).reason, 'stop-on-wrong-side'); assert.equal(mk({ equity: 0 }).reason, 'no-equity'); assert.equal(mk({ equity: undefined }).reason, 'no-equity'); assert.equal(mk({ dir: 'BUY' }).reason, 'bad-input');
  assert.equal(mk({ params: { maxMarginUsage: 0.01 } }).reason, 'margin-cap'); assert.equal(splanBuild({ symbol: 'BTCUSDT', dir: 'LONG', entry: 100000, stop: 98500, equity: 100 }).reason, 'min-size');
  for (const r of ['liq-buffer', 'cost-heavy', 'margin-cap', 'min-size', 'no-equity']) assert.notEqual(splanReasonText(r), r);
});
test('소액 계좌: 평가액이 줄면 3분할 → 2분할 → 1회 → 제외 순으로 줄어들고(표시), 어느 단계에서도 최악 손실은 한도 이하', () => {
  const rows = []; for (let eq = 400; eq >= 20; eq -= 5) { const p = splanBuild({ symbol: 'ETHUSDT', dir: 'LONG', entry: 3012.5, stop: 2980, equity: eq }); rows.push([eq, p.status === 'ok' ? p.stagesCount : 0, p]); if (p.status === 'ok') assert.ok(p.worstLoss <= p.riskBudget); }
  const counts = rows.map(r => r[1]); assert.ok(counts.includes(3) && counts.includes(2) && counts.includes(1) && counts.includes(0), JSON.stringify(counts));
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] <= counts[i - 1], '평가액이 줄면 단계 수는 늘지 않는다');
  const two = rows.find(r => r[1] === 2)[2]; assert.equal(two.degraded, '3→2'); assert.deepEqual(two.stages.map(s => Math.round(s.weight * 100)), [63, 38].map((v, i) => Math.round(two.stages[i].weight * 100))); assert.match(splanLines(two).join('\n'), /소액으로 3→2 단계 축소/);
  const one = rows.find(r => r[1] === 1)[2]; assert.equal(one.degraded, '3→1'); assert.equal(one.stages[0].weight, 1); assert.equal(rows.find(r => r[1] === 0)[2].reason, 'min-size');
});
test('TP 수량 배분: 열린 수량을 50/30/20으로 내림 배분, 합 = 열린 수량, 최소 단위 미만 구간은 다음 구간에 합친다', () => {
  const p = mk({ equity: 5000 }), legs = splanTpLegs(p, 0.7); assert.deepEqual(legs.legs.map(l => l.qty), [0.35, 0.21]); assert.equal(Number((legs.legs[0].qty + legs.legs[1].qty + legs.runner).toFixed(3)), 0.7);
  const tiny = splanTpLegs(p, 0.003); assert.equal(Number((tiny.legs[0].qty + tiny.legs[1].qty + tiny.runner).toFixed(3)), 0.003); assert.ok(tiny.legs.every(l => l.qty === 0 || l.qty >= 0.001)); assert.ok(tiny.runner >= 0);
  const r = rng(3); for (let k = 0; k < 500; k++) { const q = Number((r() * 5).toFixed(3)), t = splanTpLegs(p, q); assert.ok(Math.abs(t.legs.reduce((a, l) => a + l.qty, 0) + t.runner - q) < 1e-9); assert.ok(t.legs.every(l => l.qty >= 0) && t.runner >= 0); }
});
test('상태 추적: 1차만 체결 → 미체결 2·3차는 유지, 손절 수량 = 보유 수량', () => {
  const p = mk(), st = splanStatus(p, [FILL('entry', 3012.5, p.stages[0].qty, 1)]);
  assert.equal(st.openQty, p.stages[0].qty); assert.equal(st.stopQty, st.openQty); assert.equal(st.stopPrice, 2980); assert.equal(st.stopKind, 'initial'); assert.deepEqual(st.pending.map(x => [x.n, x.state, x.remainingQty]), [[2, 'working', p.stages[1].qty], [3, 'working', p.stages[2].qty]]);
  assert.ok(st.worstIfPendingFill <= p.riskBudget + 1e-9); assert.ok(st.lossNow < p.riskBudget);
});
test('부분 체결: 2차가 일부만 체결되면 잔량을 보여 주고 3차는 대기, 초과 체결은 경고', () => {
  const p = mk({ equity: 5000 }), q = p.stages.map(s => s.qty), half = Number((q[1] / 2).toFixed(3));
  const st = splanStatus(p, [FILL('entry', 3012.5, q[0], 1), FILL('add', 3002.75, half, 2)]); const s2 = st.pending.find(x => x.n === 2); assert.equal(s2.partiallyFilled, true); assert.equal(s2.remainingQty, Number((q[1] - half).toFixed(3))); assert.ok(st.pending.some(x => x.n === 3));
  const over = splanStatus(p, [FILL('entry', 3012.5, q[0], 1), FILL('add', 3002.75, q[1] + q[2] + 0.5, 2)]); assert.ok(over.warnings.includes('over-plan-qty'));
});
test('TP 체결 후: TP1 → 손절 본전 이동·미체결 추가 주문 취소 안내·손절 수량 = 잔여 수량, TP2 → 추적 손절(본전 아래로 내리지 않음)', () => {
  const p = mk({ equity: 5000 }), q = p.stages.map(s => s.qty), all = [FILL('entry', 3012.5, q[0], 1), FILL('add', 3002.75, q[1], 2), FILL('add', 2993, q[2], 3)], total = q.reduce((a, b) => a + b, 0), legs = splanTpLegs(p, total);
  const avg = all.reduce((a, f) => a + f.price * f.qty, 0) / total;
  let st = splanStatus(p, all); assert.equal(st.openQty, Number(total.toFixed(3))); assert.equal(st.pending.length, 0);
  st = splanStatus(p, [...all, FILL('reduce', 3061.25, legs.legs[0].qty, 4)]); assert.equal(st.tp1Done, true); assert.equal(st.stopKind, 'breakeven'); assert.ok(Math.abs(st.stopPrice - avg) < 1e-9); assert.equal(st.stopQty, Number((total - legs.legs[0].qty).toFixed(3)));
  const partial = splanStatus(p, [FILL('entry', 3012.5, q[0], 1), FILL('reduce', 3061.25, splanTpLegs(p, q[0]).legs[0].qty, 2)]); assert.ok(partial.pending.every(x => x.state === 'cancel-after-tp'));      // 2·3차 미체결 상태에서 TP1 → 취소 안내
  const tp2 = [...all, FILL('reduce', 3061.25, legs.legs[0].qty, 4), FILL('reduce', 3077.5, legs.legs[1].qty, 5)];
  st = splanStatus(p, tp2, { lastHigh: 3200 }); assert.equal(st.tp2Done, true); assert.equal(st.stopKind, 'trailing'); assert.ok(Math.abs(st.stopPrice - (3200 - p.R)) < 1e-9); assert.equal(st.stopQty, st.runnerQty);
  st = splanStatus(p, tp2, { lastHigh: 3030 }); assert.ok(Math.abs(st.stopPrice - avg) < 1e-9);                                                  // 추적선이 본전 아래면 본전 유지
  st = splanStatus(p, [...tp2, FILL('close', 3150, st.openQty, 6)]); assert.equal(st.closed, true); assert.equal(st.openQty, 0);
});
test('추가 진입 규칙: 사전 지정 가격·확인 조건에서만 허용, 무계획 물타기(더 깊은 가격·TP 후·1차 전·손절 밖·계획 수량 초과·한도 초과)는 거절', () => {
  const p = mk({ equity: 5000 }), q = p.stages.map(s => s.qty), f1 = [FILL('entry', 3012.5, q[0], 1)];
  assert.deepEqual(splanCheckAdd(p, f1, { price: 3002.75, qty: q[1] }, { lastClose: 3010, barsSinceSignal: 3 }), { ok: true, reasons: [] });
  const bad = (add, fills = f1, ctx = {}) => splanCheckAdd(p, fills, add, ctx).reasons;
  assert.ok(bad({ price: 2990, qty: q[1] }).includes('price-deeper-than-plan'));                                           // 계획 가격보다 깊은 곳 = 물타기
  assert.ok(bad({ price: 3012, qty: q[1] }).includes('price-not-at-plan-level'));                                            // 계획 가격이 아닌 곳(제자리 추가)
  assert.ok(bad({ price: 3002.75, qty: q[1] }, []).includes('first-entry-missing'));
  assert.ok(bad({ price: 3002.75, qty: q[1] }, [...f1, FILL('reduce', 3061.25, 0.01, 2)]).includes('after-take-profit'));
  assert.ok(bad({ price: 3002.75, qty: q[1] * 2 }).includes('qty-over-plan'));
  assert.ok(bad({ price: 2979, qty: q[1] }).includes('beyond-stop'));
  assert.ok(bad({ price: 3002.75, qty: q[1] }, f1, { lastClose: 2985 }).includes('structure-broken'));                        // 구조 훼손(손절선+0.25R 아래 종가)
  assert.ok(bad({ price: 3002.75, qty: q[1] }, f1, { barsSinceSignal: 17 }).includes('window-passed'));
  const all = [...f1, FILL('add', 3002.75, q[1], 2), FILL('add', 2993, q[2], 3)]; assert.ok(bad({ price: 2993, qty: q[2] }, all).includes('no-stage-left'));        // 4번째 추가 금지
  const worse = [FILL('entry', 3030, q[0], 1)]; assert.ok(bad({ price: 3002.75, qty: q[1] }, worse).includes('risk-over-budget') || bad({ price: 3002.75, qty: q[1] }, worse).length > 0);   // 1차가 계획보다 비싸게 체결 → 한도 초과 가능
  assert.ok(bad({ price: 2993, qty: q[2] }, f1).includes('price-deeper-than-plan'));                                         // 3차를 2차보다 먼저 = 2차 가격보다 깊은 곳
  assert.ok(bad({ price: 3002.75, qty: q[1] }, [FILL('entry', 3012.5, q[0] / 4, 1)]).includes('previous-stage-unfilled'));                // 1차가 절반도 안 찼는데 2차
  for (const r of ['price-deeper-than-plan', 'after-take-profit', 'structure-broken', 'risk-over-budget']) assert.notEqual(splanReasonText(r), r);
});
test('표시: 각 진입 가격·비중·증거금·예상 손실, 각 익절 가격·비중, 총 증거금 사용률·최소 가용 잔고·최악 손실이 모두 들어간다', () => {
  const p = mk(), t = splanLines(p).join('\n');
  for (const s of p.stages) { assert.ok(t.includes(`${s.n}차 ${Math.round(s.weight * 100)}%`)); assert.ok(t.includes(s.price.toFixed(2))); assert.ok(t.includes(`증거금 ${s.margin.toFixed(2)}`)); assert.ok(t.includes(`손절 시 −${s.lossIfStop.toFixed(2)}`)); }
  for (const x of p.tps) { assert.ok(t.includes(`TP${x.n} ${x.price.toFixed(2)} (${x.r}R) ${Math.round(x.w * 100)}%`)); }
  assert.match(t, /잔여 20% 추적 손절/); assert.match(t, /총 증거금 [\d.]+ USDT \(평가액의 [\d.]+%, 한도 30%\)/); assert.match(t, /유지할 가용 잔고 ≥ [\d.]+ USDT/); assert.match(t, /최악 손실 −[\d.]+ USDT = 평가액의 0\.4\d% \(한도 0\.50%/); assert.match(t, /손실 만회용 추가 금지/); assert.match(t, /내림/);
  const c = splanLines(p, { compact: true }); assert.ok(c.join('\n').length < 330, String(c.join('\n').length)); assert.match(c.join('\n'), /TP1 1\.5R 50%/);
  assert.match(splanLines(mk({ equity: 0 }))[0], /거래 제외/); const st = splanStatusLines(p, splanStatus(p, [FILL('entry', 3012.5, p.stages[0].qty, 1)])).join('\n'); assert.match(st, /손절 수량 = 보유 수량/); assert.match(st, /미체결 2차/);
});
test('규격 기본값: 알려진 코인은 표, 그 밖은 가격대별(참고용)', () => {
  assert.deepEqual(splanSpec('BTCUSDT', 100000), { step: 0.001, minQty: 0.001, minNotional: 100, source: 'table' }); assert.equal(splanSpec('FOOUSDT', 2500).step, 0.001); assert.equal(splanSpec('FOOUSDT', 0.5).step, 1); assert.equal(splanSpec('FOOUSDT', 50).step, 0.1);
});
