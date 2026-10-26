// 안전 중심 분할 진입·분할 익절 계획(순수 함수, 의존성·네트워크·주문 없음). 주문이 아니라 *계산*이다 — 실제 주문은 사용자가 거래소에서 직접 한다.
// 이 파일은 radar-service/signal/scale.mjs 와 rich300/lib/scaleplan.mjs 에 *바이트 단위로 같은 내용*으로 존재한다(테스트가 동기화를 확인).
// 모든 이름은 splan/SPLAN 접두사: RICH300 Apps Script 번들(한 파일)에서 다른 모듈과 이름이 겹치지 않게 한다. import/export default/export { } 를 쓰지 않는다.
//
// 용어: R = |1차 진입가 − 손절가|(계획 1R). 손절가는 계획 전체에서 고정(이동·확대 금지). 방향 dir 은 'LONG' | 'SHORT'.
// 규칙(기본값 SPLAN):
//  · 진입 3분할 50/30/20. 2·3차 가격은 1차 진입가에서 손절 쪽으로 0.3R·0.6R 떨어진 *사전 지정 가격*의 지정가. 확인 조건을 모두 만족할 때만 허용(splanAddRules).
//    손절선(1R) 안에서만, TP 체결 전에만, 단계 순서대로만, 계획 수량 안에서만. 손실을 만회하려는 무계획 추가(물타기)는 금지 — 어긋나면 splanCheckAdd 가 거부한다.
//  · 익절 TP1 1.5R 50% · TP2 2R 30% · 잔여 20% 는 추적 손절(TP2 이후 최고가−1R, 단 본전 아래로 내리지 않음). TP1 체결 후 손절은 평균 진입가(본전)로 올린다.
//  · 수량: 계좌 평가액의 0.5%(riskPct) 를 거래당 계획 손실 한도로 삼아, 3단계가 모두 체결된 뒤 손절되는 *최악의 경우*(수수료·슬리피지 포함)가 한도를 넘지 않도록 계산한다.
//    수량은 거래소 최소 단위로 *내림*한다(반올림해서 한도를 넘는 일이 없다). 내림 후 최악 손실을 다시 계산해 확인한다.
//  · 격리 3배 기본, 청산가가 손절선보다 충분히 멀지 않으면 2배, 그래도 안 되면 거래 제외. 총 증거금은 평가액의 maxMarginUsage 를 넘지 않는다(초과하면 수량을 줄이고, 계획의 minSizeRatio 미만이면 제외).
//  · 소액이라 단계별 수량이 최소 주문 단위에 못 미치면 3→2→1 단계로 줄인다(degraded 표시). 그래도 안 되면 제외.
//  · 비용: 수수료 편도 feeBps(양쪽 체결), 진입 슬리피지 entrySlipBps(불리한 방향), 손절 슬리피지 stopSlipBps. 펀딩비는 계획에 포함하지 않는다(보유 시간에 따라 달라짐).

export const SPLAN_NOTE = '계획은 참고용 계산이며 주문이 아닙니다';
export const SPLAN = Object.freeze({
  weights: Object.freeze([0.5, 0.3, 0.2]), addR: Object.freeze([0.3, 0.6]), tp: Object.freeze([Object.freeze({ r: 1.5, w: 0.5 }), Object.freeze({ r: 2, w: 0.3 })]), trailR: 1, beAfterTp1: true,
  riskPct: 0.005, feeBps: 5, entrySlipBps: 5, stopSlipBps: 10, levs: Object.freeze([3, 2]), mmr: 0.005, liqBuffer: 0.6,
  maxMarginUsage: 0.3, minSizeRatio: 0.4, maxCostShareOfR: 0.35, structureR: 0.25, addWindowBars: 16, addPriceTolR: 0.15,
});

export const splanSign = dir => (dir === 'LONG' ? 1 : -1);
export const splanDecimals = step => { const t = String(step); return t.includes('.') ? t.split('.')[1].length : 0; };
export const splanFloor = (x, step) => Number((Math.floor(x / step) * step).toFixed(splanDecimals(step)));      // 내림(부동소수 오차로 한 단위 모자라는 쪽으로만 틀린다 = 안전한 쪽)
export const splanFloorTol = (x, step) => Number((Math.floor(x / step + 1e-9) * step).toFixed(splanDecimals(step)));   // TP 배분용: 0.7×0.5/0.001 같은 부동소수 경계에서 한 단위 모자라지 않게(진입 수량에는 쓰지 않음)
export const splanRound = (x, dec) => Number(x.toFixed(dec));
export const splanMean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// 거래소 주문 규격의 *참고 기본값*. 실제 규격은 거래소 화면에서 확인해야 한다(틀리면 거래소가 주문을 거절하므로 안전한 쪽으로만 영향).
export const SPLAN_SPECS = Object.freeze({
  BTC: { step: 0.001, minQty: 0.001, minNotional: 100 }, ETH: { step: 0.001, minQty: 0.001, minNotional: 20 }, BNB: { step: 0.01, minQty: 0.01, minNotional: 5 }, SOL: { step: 1, minQty: 1, minNotional: 5 },
  XRP: { step: 0.1, minQty: 0.1, minNotional: 5 }, DOGE: { step: 1, minQty: 1, minNotional: 5 }, ADA: { step: 1, minQty: 1, minNotional: 5 }, AVAX: { step: 1, minQty: 1, minNotional: 5 }, LINK: { step: 0.01, minQty: 0.01, minNotional: 5 },
});
export function splanSpec(symbol, price) {
  const base = String(symbol || '').replace(/USDT$/, '').toUpperCase();
  if (SPLAN_SPECS[base]) return { ...SPLAN_SPECS[base], source: 'table' };
  const p = Number(price), step = p >= 1000 ? 0.001 : p >= 100 ? 0.01 : p >= 10 ? 0.1 : 1;
  return { step, minQty: step, minNotional: 5, source: 'price-tier' };
}

// 단계 가중치(활성 단계 수 n 에 맞춰 정규화): n=3 → 0.5/0.3/0.2, n=2 → 0.625/0.375, n=1 → 1
export const splanWeights = (p, n) => { const w = p.weights.slice(0, n), s = w.reduce((a, b) => a + b, 0); return w.map(x => x / s); };

// 단계별 *계획 체결가*(슬리피지 반영 전) — 1차는 entry, 2·3차는 손절 쪽으로 addR×R. 표시 자릿수(dp)로 반올림.
export function splanStagePrices(dir, entry, stop, p, n, dp) {
  const s = splanSign(dir), R = (entry - stop) * s, out = [splanRound(entry, dp)];
  for (let k = 1; k < n; k++) out.push(splanRound(entry - s * p.addR[k - 1] * R, dp));
  return out;
}
export const splanExec = (dir, price, bps) => price * (1 + splanSign(dir) * bps / 10000);                 // 진입 체결가(불리한 방향 슬리피지)
export const splanStopExec = (dir, stop, bps) => stop * (1 - splanSign(dir) * bps / 10000);               // 손절 체결가(불리한 방향 슬리피지)

// 수량 배열(qtys[i])로 3단계가 모두 체결된 뒤 손절되는 최악의 손실(수수료·슬리피지 포함, 계좌 통화 단위). prices 는 계획 체결가.
export function splanWorstLoss(dir, prices, qtys, stop, p) {
  const s = splanSign(dir), x = splanStopExec(dir, stop, p.stopSlipBps), f = p.feeBps / 10000;
  let loss = 0, fee = 0, slip = 0;
  for (let i = 0; i < qtys.length; i++) {
    const e = splanExec(dir, prices[i], p.entrySlipBps), q = qtys[i];
    loss += (e - x) * s * q + f * (e + x) * q;
    fee += f * (e + x) * q; slip += (e - prices[i]) * s * q + (stop - x) * s * q;
  }
  return { loss, fee, slip };
}

// 계획 만들기. input: { symbol, dir, entry, stop, equity, spec?, lev?, params? }. 반환 plan.status === 'ok' | 'excluded'.
export function splanBuild(input) {
  const p = { ...SPLAN, ...(input.params || {}) }, dir = input.dir, symbol = input.symbol, E1 = Number(input.entry), S = Number(input.stop), equity = Number(input.equity);
  const exclude = (reason, extra) => ({ status: 'excluded', reason, note: SPLAN_NOTE, symbol, dir, entry: E1, stop: S, equity, ...(extra || {}) });
  if ((dir !== 'LONG' && dir !== 'SHORT') || !(E1 > 0) || !(S > 0)) return exclude('bad-input');
  if (!(equity > 0)) return exclude('no-equity');
  const sg = splanSign(dir), R = (E1 - S) * sg;
  if (!(R > 0)) return exclude('stop-on-wrong-side');
  const dp = Math.max(splanDecimals(String(E1)), splanDecimals(String(S)), 2), spec = input.spec || splanSpec(symbol, E1);
  const budget = equity * p.riskPct, costPerUnit = (p.feeBps / 10000) * (E1 + S) + E1 * p.entrySlipBps / 10000 + S * p.stopSlipBps / 10000;
  if (costPerUnit > p.maxCostShareOfR * R) return exclude('cost-heavy', { R, costShareOfR: costPerUnit / R });          // 손절폭 대비 비용이 너무 크면(손절이 너무 가까움) 계획 불가
  const levs = input.lev ? [input.lev] : p.levs, tried = [];
  for (const lev of levs) {
    for (let n = Math.min(3, p.maxStages || 3, p.weights.length); n >= 1; n--) {
      const r = splanTry(p, { dir, symbol, E1, S, R, dp, equity, budget, spec, lev, n });
      tried.push({ lev, n, ok: r.ok, reason: r.reason });
      if (r.ok) return { ...r.plan, degraded: n < Math.min(3, p.maxStages || 3, p.weights.length) ? `${Math.min(3, p.maxStages || 3, p.weights.length)}→${n}` : null, tried };
      if (r.reason === 'liq-buffer') break;                                                                       // 이 배율은 청산 여유가 부족: 단계 수를 줄여도 소용없으니 다음 배율로
    }
  }
  const last = tried.filter(t => t.reason);
  const pick = ['liq-buffer', 'margin-cap', 'min-size'].find(k => last.some(t => t.reason === k)) || 'size-too-small';
  return exclude(pick, { tried });
}

export function splanTry(p, c) {
  const { dir, symbol, E1, S, R, dp, equity, budget, spec, lev, n } = c, sg = splanSign(dir), w = splanWeights(p, n), prices = splanStagePrices(dir, E1, S, p, n, dp);
  // 청산 여유: 단계별 누적 평균가 기준으로 손절 거리가 (격리 청산 거리 × liqBuffer) 이내여야 한다.
  const x = splanStopExec(dir, S, p.stopSlipBps), f = p.feeBps / 10000;
  let liqWorst = 0, cum = 0, cumQ = 0;
  for (let i = 0; i < n; i++) { const e = splanExec(dir, prices[i], p.entrySlipBps); cum += e * w[i]; cumQ += w[i]; const avg = cum / cumQ, liqDist = avg * (1 / lev - p.mmr - f), stopDist = (avg - x) * sg; liqWorst = Math.max(liqWorst, stopDist / liqDist); }
  if (!(liqWorst <= p.liqBuffer)) return { ok: false, reason: 'liq-buffer' };
  const unit = splanWorstLoss(dir, prices, w, S, p).loss;                                                         // 총수량 1 당 최악 손실
  if (!(unit > 0)) return { ok: false, reason: 'bad-input' };
  const qRisk = budget / unit, mUnit = w.reduce((a, wi, i) => a + wi * splanExec(dir, prices[i], p.entrySlipBps), 0) / lev, qCap = p.maxMarginUsage * equity / mUnit;
  const q = Math.min(qRisk, qCap);
  if (q < qRisk * p.minSizeRatio) return { ok: false, reason: 'margin-cap' };
  const qtys = w.map(wi => splanFloor(q * wi, spec.step));                                                        // 내림
  for (let i = 0; i < n; i++) if (!(qtys[i] >= spec.minQty) || qtys[i] * prices[i] < spec.minNotional) return { ok: false, reason: 'min-size' };
  const total = qtys.reduce((a, b) => a + b, 0), worst = splanWorstLoss(dir, prices, qtys, S, p);
  if (worst.loss > budget) return { ok: false, reason: 'internal-risk' };                                         // 이론상 발생하지 않음(내림이므로). 방어용
  const stages = qtys.map((qty, i) => {
    const e = splanExec(dir, prices[i], p.entrySlipBps), margin = e * qty / lev, lossIfStop = (e - x) * sg * qty + f * (e + x) * qty;
    return { n: i + 1, weight: splanRound(qtys[i] / total, 4), price: prices[i], execPrice: e, qty, margin, lossIfStop };
  });
  const totalMargin = stages.reduce((a, s) => a + s.margin, 0), avgE = stages.reduce((a, s) => a + s.execPrice * s.qty, 0) / total, liqDist = avgE * (1 / lev - p.mmr - f);
  const tps = p.tp.map((t, i) => ({ n: i + 1, r: t.r, w: t.w, price: splanRound(E1 + sg * t.r * R, dp) }));
  return { ok: true, plan: {
    status: 'ok', note: SPLAN_NOTE, symbol, dir, entry: E1, stop: S, R, riskPct: R / E1, equity, lev, spec, params: { riskPct: p.riskPct, feeBps: p.feeBps, entrySlipBps: p.entrySlipBps, stopSlipBps: p.stopSlipBps, maxMarginUsage: p.maxMarginUsage, addR: p.addR.slice(0, n - 1), trailR: p.trailR, beAfterTp1: p.beAfterTp1 },
    stagesCount: n, stages, tps, runnerWeight: splanRound(1 - p.tp.reduce((a, t) => a + t.w, 0), 4), totalQty: total, riskBudget: budget, worstLoss: worst.loss, worstLossPct: worst.loss / equity, worstFee: worst.fee, worstSlip: worst.slip,
    totalMargin, marginUsage: totalMargin / equity, minAvailable: equity - totalMargin, equityAfterWorst: equity - worst.loss, liqPrice: dir === 'LONG' ? avgE - liqDist : avgE + liqDist, liqRatio: liqWorst,
    add: { window: p.addWindowBars, structurePrice: splanRound(S + sg * p.structureR * R, dp), tolR: p.addPriceTolR },
  } };
}

// TP 수량 배분: 열린 수량(open)을 TP1 50% · TP2 30% · 잔여로 내림 배분. 최소 주문 단위보다 작은 구간은 다음 구간에 합친다(TP1→TP2→잔여).
export function splanTpLegs(plan, openQty) {
  const step = plan.spec.step, minQ = plan.spec.minQty, legs = plan.tps.map(t => ({ n: t.n, r: t.r, price: t.price, w: t.w, qty: splanFloorTol(openQty * t.w, step) }));
  let used = legs.reduce((a, l) => a + l.qty, 0), runner = Number((openQty - used).toFixed(splanDecimals(step)));
  for (let i = 0; i < legs.length; i++) if (legs[i].qty < minQ) { const carry = legs[i].qty; legs[i].qty = 0; legs[i].merged = true; if (i + 1 < legs.length) legs[i + 1].qty = Number((legs[i + 1].qty + carry).toFixed(splanDecimals(step))); else runner = Number((runner + carry).toFixed(splanDecimals(step))); }
  return { legs, runner: Math.max(0, runner), openQty };
}

// 체결 기록(fills: [{ kind:'entry'|'add'|'reduce'|'close', price, qty, at }])로 현재 상태를 계산한다. ctx(선택): { lastClose, lastHigh, lastLow, barsSinceSignal }.
export function splanStatus(plan, fillsIn, ctx) {
  const c = ctx || {}, fills = [...fillsIn].sort((a, b) => a.at - b.at), sg = splanSign(plan.dir), step = plan.spec.step, warnings = [];
  const stages = plan.stages.map(s => ({ n: s.n, price: s.price, plannedQty: s.qty, filled: 0 }));
  let idx = 0, entered = 0, cost = 0, reduced = 0;
  for (const f of fills) {
    if (f.kind === 'entry' || f.kind === 'add') {
      let rest = f.qty; entered += f.qty; cost += f.qty * f.price;
      while (rest > step / 2 && idx < stages.length) { const room = stages[idx].plannedQty - stages[idx].filled, take = Math.min(room, rest); stages[idx].filled += take; rest -= take; if (stages[idx].filled >= stages[idx].plannedQty - step / 2) idx++; }
      if (rest > step / 2) warnings.push('over-plan-qty');
    } else if (f.kind === 'reduce' || f.kind === 'close') reduced += f.qty;
  }
  const open = Number((entered - reduced).toFixed(splanDecimals(step))), avgEntry = entered > 0 ? cost / entered : null;
  const eps = step / 2, legsTotal = splanTpLegs(plan, entered), cum1 = legsTotal.legs[0].qty, cum2 = cum1 + legsTotal.legs[1].qty;
  const tp2Done = reduced > eps && cum2 > 0 && reduced >= cum2 - eps, tp1Done = reduced > eps && (cum1 > 0 ? reduced >= cum1 - eps : tp2Done);          // 최소 단위 미만 구간은 다음 구간에 합쳐져 있다
  let stopPrice = plan.stop, stopKind = 'initial';
  if (tp1Done && plan.params.beAfterTp1 && avgEntry !== null) { stopPrice = avgEntry; stopKind = 'breakeven'; }
  if (tp2Done && Number.isFinite(c.lastHigh) && avgEntry !== null) {                                                // 추적 손절: TP2 이후 최고가−trailR×R, 본전 아래로는 내리지 않음
    const ext = plan.dir === 'LONG' ? c.lastHigh : c.lastLow, trail = ext - sg * plan.params.trailR * plan.R;
    if (Number.isFinite(ext)) { stopPrice = sg > 0 ? Math.max(avgEntry, trail) : Math.min(avgEntry, trail); stopKind = 'trailing'; }
  }
  const stopHit = open <= 0 && entered > 0;
  const pending = stages.filter(s => s.filled < s.plannedQty - step / 2 && s.n > 1).map(s => {
    const rem = Number((s.plannedQty - s.filled).toFixed(splanDecimals(step)));
    let state = 'working';
    if (entered === 0) state = 'waiting-first'; else if (tp1Done || reduced > 0) state = 'cancel-after-tp'; else if (stopHit) state = 'cancel-closed';
    else if (Number.isFinite(c.lastClose) && (c.lastClose - plan.add.structurePrice) * sg <= 0) state = 'cancel-structure';
    else if (Number.isFinite(c.barsSinceSignal) && c.barsSinceSignal > plan.add.window) state = 'cancel-window';
    return { n: s.n, price: s.price, remainingQty: rem, partiallyFilled: s.filled > 0, state };
  });
  const sx = splanStopExec(plan.dir, stopPrice, plan.params.stopSlipBps), f = plan.params.feeBps / 10000;
  const lossNow = open > 0 && avgEntry !== null ? ((avgEntry - sx) * sg + f * (avgEntry + sx)) * open : 0;                       // 지금 포지션이 현재 손절선에서 청산될 때 손실(음수면 이익 잠금)
  const workable = pending.filter(s => s.state === 'working');
  let potential = lossNow;
  if (workable.length && open > 0) potential = ((avgEntry * open + workable.reduce((a, s) => a + s.price * s.remainingQty, 0)) / (open + workable.reduce((a, s) => a + s.remainingQty, 0)) - sx) * sg * (open + workable.reduce((a, s) => a + s.remainingQty, 0)) + f * (open + workable.reduce((a, s) => a + s.remainingQty, 0)) * (avgEntry + sx);
  if (lossNow > plan.riskBudget * 1.0000001) warnings.push('risk-over-budget');
  const shown = entered > 0 ? legsTotal : splanTpLegs(plan, plan.totalQty);
  return { stages, entered, reduced, openQty: open, avgEntry, stopQty: open, stopPrice, stopKind, tp1Done, tp2Done, pending, lossNow, worstIfPendingFill: potential, riskBudget: plan.riskBudget, legs: shown.legs.map(l => ({ n: l.n, price: l.price, qty: l.qty, done: l.n === 1 ? tp1Done : tp2Done })), runnerQty: shown.runner, warnings, closed: stopHit };
}

// 추가 진입 규칙(문서화된 사전 조건). 사용자 입력 add:{price, qty} 를 계획·체결 상태와 대조한다. 반환 { ok, reasons:[코드…] }.
export function splanCheckAdd(plan, fills, add, ctx) {
  const reasons = [], c = ctx || {};
  if (!plan || plan.status !== 'ok') return { ok: false, reasons: ['no-plan'] };
  const st = splanStatus(plan, fills, c), sg = splanSign(plan.dir), tol = plan.add.tolR * plan.R;
  if (st.entered === 0) reasons.push('first-entry-missing');                                                         // 1차 없이 2·3차 금지
  if (st.closed) reasons.push('position-closed');
  if (st.reduced > 0 || st.tp1Done) reasons.push('after-take-profit');                                              // TP 체결 후에는 추가 진입 금지
  const next = st.stages.find(s => s.n > 1 && s.filled < s.plannedQty - plan.spec.step / 2);
  if (!next) reasons.push('no-stage-left');
  else {
    const prev = st.stages[next.n - 2]; if (prev.filled < prev.plannedQty * 0.5) reasons.push('previous-stage-unfilled');
    if (Math.abs(add.price - next.price) > tol) reasons.push((add.price - next.price) * sg < 0 ? 'price-deeper-than-plan' : 'price-not-at-plan-level');   // 사전 지정 가격 밖(더 깊은 물타기 포함)
    if (add.qty > (next.plannedQty - next.filled) + plan.spec.step / 2) reasons.push('qty-over-plan');
  }
  if ((add.price - plan.stop) * sg <= 0) reasons.push('beyond-stop');
  if (Number.isFinite(c.lastClose) && (c.lastClose - plan.add.structurePrice) * sg <= 0) reasons.push('structure-broken');
  if (Number.isFinite(c.barsSinceSignal) && c.barsSinceSignal > plan.add.window) reasons.push('window-passed');
  if (!reasons.length) {                                                                                             // 추가 후 최악 손실이 한도 이하인가
    const q = st.openQty + add.qty, avg = (st.avgEntry * st.openQty + add.price * add.qty) / q, sx = splanStopExec(plan.dir, plan.stop, plan.params.stopSlipBps), f = plan.params.feeBps / 10000;
    const worst = ((avg * (1 + sg * plan.params.entrySlipBps / 10000) - sx) * sg + f * (avg + sx)) * q;
    if (worst > plan.riskBudget * 1.0000001) reasons.push('risk-over-budget');
  }
  return { ok: reasons.length === 0, reasons };
}
export const SPLAN_REASON_TEXT = Object.freeze({
  'over-plan-qty': '계획보다 많은 수량이 체결됐습니다', 'no-plan': '이 신호에는 분할 계획이 없습니다', 'first-entry-missing': '1차 진입이 먼저 기록돼야 합니다', 'position-closed': '이미 청산된 포지션입니다', 'after-take-profit': '익절이 시작된 뒤에는 추가 진입을 하지 않습니다', 'no-stage-left': '계획된 추가 진입 단계가 남아 있지 않습니다',
  'previous-stage-unfilled': '이전 단계가 아직 충분히 체결되지 않았습니다', 'price-deeper-than-plan': '계획 가격보다 더 깊은 가격입니다(손실 만회용 추가 진입 금지)', 'price-not-at-plan-level': '사전에 정한 추가 진입 가격이 아닙니다', 'qty-over-plan': '계획 수량을 넘습니다',
  'beyond-stop': '손절선을 넘은 가격입니다', 'structure-broken': '구조 유지 조건(직전 15분봉 종가)을 만족하지 않습니다', 'window-passed': '추가 진입 허용 시간이 지났습니다', 'risk-over-budget': '추가하면 최악 손실이 계획 한도를 넘습니다',
  'bad-input': '입력값이 올바르지 않습니다', 'no-equity': '계좌 평가액이 없습니다', 'stop-on-wrong-side': '손절가가 방향과 반대쪽입니다', 'cost-heavy': '손절폭 대비 수수료·슬리피지가 너무 큽니다', 'liq-buffer': '청산가가 손절선에 비해 충분히 멀지 않습니다(2배도 불충분)',
  'margin-cap': '증거금 사용률 한도 때문에 계획 수량을 확보할 수 없습니다', 'min-size': '최소 주문 수량·금액에 못 미칩니다(계좌 대비 너무 작은 계획)', 'size-too-small': '계획 수량이 너무 작습니다', 'internal-risk': '내부 위험 검증 실패',
});
export const splanReasonText = code => SPLAN_REASON_TEXT[code] || code;

// ── 표시 ──
export const splanFmtNum = (x, dp) => Number(x).toFixed(dp);
export const splanQty = (q, spec) => Number(q).toFixed(splanDecimals(spec.step));
export function splanLines(plan, opts) {
  const o = opts || {}, dp = Math.max(splanDecimals(String(plan.entry)), 2), u = 'USDT';
  if (plan.status !== 'ok') return [`📐 분할 계획: 거래 제외 — ${splanReasonText(plan.reason)}`];
  const eq = splanFmtNum(plan.equity, 2), lines = [];
  if (o.compact) {
    lines.push(`📐 ${plan.stagesCount}분할 · 격리 ${plan.lev}배 · 평가액 ${eq} 가정 · 최악 −${splanFmtNum(plan.worstLoss, 2)} ${u}(${splanFmtNum(plan.worstLossPct * 100, 2)}%)`);
    lines.push(plan.stages.map(s => `${s.n}차 ${Math.round(s.weight * 100)}% ${splanFmtNum(s.price, dp)}`).join(' · ') + ` · 손절 ${splanFmtNum(plan.stop, dp)}`);
    lines.push(plan.tps.map(t => `TP${t.n} ${t.r}R ${Math.round(t.w * 100)}% ${splanFmtNum(t.price, dp)}`).join(' · ') + ` · 잔여 ${Math.round(plan.runnerWeight * 100)}% 추적`);
    return lines;
  }
  lines.push(`📐 ${plan.stagesCount}분할 진입 계획 · 격리 ${plan.lev}배${plan.lev === 2 ? '(대안)' : ''} · 평가액 ${eq} ${u}${o.assumed ? ' 가정' : ''}${plan.degraded ? ` · 소액으로 ${plan.degraded} 단계 축소` : ''}`);
  for (const s of plan.stages) lines.push(`  ${s.n}차 ${Math.round(s.weight * 100)}% · ${splanFmtNum(s.price, dp)}${s.n > 1 ? ` (−${plan.params.addR[s.n - 2]}R)` : ''} · 수량 ${splanQty(s.qty, plan.spec)} · 증거금 ${splanFmtNum(s.margin, 2)} · 손절 시 −${splanFmtNum(s.lossIfStop, 2)}`);
  lines.push(`  추가 진입은 2·3차 가격에서만, 직전 15분봉 종가가 ${splanFmtNum(plan.add.structurePrice, dp)} ${plan.dir === 'LONG' ? '위' : '아래'}(구조 유지)·TP 체결 전·신호 후 ${plan.add.window * 15}분 안일 때만. 손실 만회용 추가 금지`);
  lines.push(`  손절 ${splanFmtNum(plan.stop, dp)} (1R=${splanFmtNum(plan.R, dp)}, 고정) · 최악 손실 −${splanFmtNum(plan.worstLoss, 2)} ${u} = 평가액의 ${splanFmtNum(plan.worstLossPct * 100, 2)}% (한도 ${splanFmtNum(plan.params.riskPct * 100, 2)}% · 수수료·슬리피지 포함)`);
  lines.push(`  익절 ${plan.tps.map(t => `TP${t.n} ${splanFmtNum(t.price, dp)} (${t.r}R) ${Math.round(t.w * 100)}%`).join(' · ')} · 잔여 ${Math.round(plan.runnerWeight * 100)}% 추적 손절(TP1 후 손절=본전, TP2 후 최고가−${plan.params.trailR}R)`);
  lines.push(`  총 증거금 ${splanFmtNum(plan.totalMargin, 2)} ${u} (평가액의 ${splanFmtNum(plan.marginUsage * 100, 1)}%, 한도 ${Math.round(plan.params.maxMarginUsage * 100)}%) · 유지할 가용 잔고 ≥ ${splanFmtNum(plan.minAvailable, 2)} ${u} · 청산가(근사) ${splanFmtNum(plan.liqPrice, dp)}`);
  lines.push(`  수량은 거래소 최소 단위(${plan.spec.step})로 내림 · 전량 체결 총 ${splanQty(plan.totalQty, plan.spec)} · ${plan.note}`);
  return lines;
}
export function splanStatusLines(plan, st) {
  const dp = Math.max(splanDecimals(String(plan.entry)), 2), lines = [], f = x => splanFmtNum(x, dp);
  lines.push(`📐 계획 상태 · ${plan.symbol} ${plan.dir} · 보유 ${splanQty(st.openQty, plan.spec)}${st.avgEntry === null ? '' : ` @ ${f(st.avgEntry)}`}`);
  lines.push(`  손절 수량 = 보유 수량 ${splanQty(st.stopQty, plan.spec)} · 손절가 ${f(st.stopPrice)}(${{ initial: '최초', breakeven: '본전으로 이동', trailing: '추적' }[st.stopKind]})`);
  for (const s of st.stages) lines.push(`  ${s.n}차 ${f(s.price)} · ${splanQty(s.filled, plan.spec)}/${splanQty(s.plannedQty, plan.spec)} 체결`);
  for (const p of st.pending) lines.push(`  미체결 ${p.n}차 ${f(p.price)} 잔량 ${splanQty(p.remainingQty, plan.spec)}${p.partiallyFilled ? '(부분 체결)' : ''} → ${{ working: '유지', 'waiting-first': '1차 체결 전', 'cancel-after-tp': '익절 시작: 취소하세요', 'cancel-closed': '청산됨: 취소하세요', 'cancel-structure': '구조 훼손: 취소하세요', 'cancel-window': '시간 초과: 취소하세요' }[p.state]}`);
  for (const l of st.legs) lines.push(`  TP${l.n} ${f(l.price)} ${splanQty(l.qty, plan.spec)}${l.done ? ' ✔체결' : ''}`);
  lines.push(`  잔여 추적 ${splanQty(st.runnerQty, plan.spec)} · 지금 손절 시 ${st.lossNow >= 0 ? `손실 −${splanFmtNum(st.lossNow, 2)}` : `이익 +${splanFmtNum(-st.lossNow, 2)}`} USDT(한도 ${splanFmtNum(st.riskBudget, 2)})${st.pending.some(p => p.state === 'working') ? ` · 미체결이 모두 체결되면 최악 −${splanFmtNum(st.worstIfPendingFill, 2)}` : ''}`);
  if (st.warnings.length) lines.push(`  ⚠ ${st.warnings.map(splanReasonText).join(' · ')}`);
  return lines;
}
