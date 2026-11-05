// 분할 진입·익절 계획의 봉 단위 시뮬레이션과 비율 비교(순수 함수, 네트워크·주문 없음). 백테스트(과거 데이터)와 모의매매(앞으로 쌓이는 확정 봉) 모두 같은 함수를 쓴다.
// 가정(보수적): 1차는 신호 다음 봉 시가(기존 백테스트와 같음)에 체결하고 그 가격을 계획의 기준(1차 진입가)으로 삼는다. 2·3차는 사전 지정 가격의 지정가 — 직전 봉 종가가 구조 유지선 위(LONG)이고
// TP 체결 전이며 신호 후 허용 시간 안일 때만 유효하고, 봉의 저가가 닿으면 min(가격, 시가)에 불리한 슬리피지를 더해 체결한다. 같은 봉에서 추가 체결과 손절이 모두 가능하면 추가 체결 후 손절(최악),
// 손절과 익절이 모두 가능하면 손절 먼저. 손절선·본전·추적 손절의 갭은 시가에서 청산(손절 슬리피지 상정보다 나쁠 수 있으며, 그 초과는 budgetExceeded 로 센다).
// 비용: 수수료 편도 feeBps(진입·청산 모두), 슬리피지는 시장성 체결(진입·손절·시간 종료)에만 적용. TP는 지정가라 슬리피지 없음. 펀딩 제외.
import { SPLAN, splanBuild, splanTpLegs } from './scale.mjs';

export const SSIM = Object.freeze({ equity: 300, maxBars: 192, window: SPLAN.addWindowBars });

const execPx = (s, price, slip) => price * (1 + s * slip);            // 진입·시간 종료: 불리한 방향 슬리피지(진입은 +s, 매도 청산은 -s 로 호출)

// bars: 확정 봉 [{t,o,h,l,c}] (오래된 순). i: 신호가 확정된 봉의 인덱스. ev: { symbol, dir, stop }. opts: { equity, params, maxBars, lev, spec, window }.
export function scaleSimulate(bars, i, ev, opts = {}) {
  const o = { ...SSIM, ...opts }, nb = bars[i + 1];
  if (!nb) return { skipped: 'no-next-bar' };
  const dir = ev.dir, s = dir === 'LONG' ? 1 : -1, p = { ...SPLAN, ...(o.params || {}) }, E1 = nb.o;
  if (!((E1 - ev.stop) * s > 0)) return { skipped: 'already-invalid' };
  const plan = splanBuild({ symbol: ev.symbol, dir, entry: E1, stop: ev.stop, equity: o.equity, lev: o.lev, spec: o.spec, params: { ...(o.params || {}), addWindowBars: o.window } });
  if (plan.status !== 'ok') return { excluded: true, reason: plan.reason };
  const f = p.feeBps / 10000, slipE = p.entrySlipBps / 10000, slipS = p.stopSlipBps / 10000, R = plan.R;
  const ins = [], outs = [], filled = new Set();
  let open = 0, entered = 0, cost = 0, stopPrice = ev.stop, tp1 = false, tp2 = false, ext = null, prevClose = bars[i].c, kind = 'time', exitBar = null;
  const buy = (px, qty) => { ins.push({ px, qty }); open = Number((open + qty).toFixed(12)); entered += qty; cost += px * qty; };
  const sell = (px, qty) => { if (qty <= 1e-12) return; outs.push({ px, qty }); open = Number((open - qty).toFixed(12)); };
  const stopKind = () => (tp1 ? (tp2 ? 'trail-stop' : 'be-stop') : 'stop');
  buy(execPx(s, E1, slipE), plan.stages[0].qty); filled.add(1);
  const last = Math.min(bars.length - 1, i + o.maxBars);
  for (let j = i + 1; j <= last && open > 1e-12; j++) {
    const b = bars[j], since = j - i, avg = cost / entered;
    // 1) 갭: 시가가 이미 손절선을 넘었으면 시가에서 전량 청산(첫 봉은 시가가 곧 1차 진입가라 해당 없음)
    if (j > i + 1 && (b.o - stopPrice) * s <= 0) { sell(b.o, open); kind = tp1 ? stopKind() : 'gap-stop'; exitBar = j; break; }
    // 2) 추가 진입(지정가): 직전 봉 종가가 구조 유지선 안쪽, TP·부분 청산 전, 허용 시간 안
    const valid = !tp1 && outs.length === 0 && (prevClose - plan.add.structurePrice) * s > 0 && since <= o.window;
    if (valid) for (const g of plan.stages) if (g.n > 1 && !filled.has(g.n) && filled.has(g.n - 1) && (s > 0 ? b.l <= g.price : b.h >= g.price)) {
      buy(execPx(s, s > 0 ? Math.min(g.price, b.o) : Math.max(g.price, b.o), slipE), g.qty); filled.add(g.n);
    }
    // 3) 손절(같은 봉에서 익절과 겹치면 손절 먼저, 추가 체결이 있었어도 그 뒤 손절)
    if (s > 0 ? b.l <= stopPrice : b.h >= stopPrice) { sell(execPx(-s, stopPrice, slipS), open); kind = stopKind(); exitBar = j; break; }
    // 4) 익절(지정가): 진입이 끝난 수량 기준 배분
    const L = splanTpLegs(plan, entered).legs, reach = k => (s > 0 ? b.h >= L[k].price : b.l <= L[k].price);
    if (!tp1 && reach(0)) { sell(L[0].price, Math.min(open, L[0].qty)); tp1 = true; if (p.beAfterTp1) stopPrice = s > 0 ? Math.max(stopPrice, cost / entered) : Math.min(stopPrice, cost / entered); }
    if (tp1 && !tp2 && reach(1) && open > 1e-12) { sell(L[1].price, Math.min(open, L[1].qty)); tp2 = true; ext = L[1].price; }
    if (tp2) { ext = s > 0 ? Math.max(ext, b.h) : Math.min(ext, b.l); const trail = ext - s * p.trailR * R; stopPrice = s > 0 ? Math.max(stopPrice, trail) : Math.min(stopPrice, trail); }   // 다음 봉부터 적용
    prevClose = b.c;
    if (j === last && open > 1e-12) { sell(execPx(-s, b.c, slipE), open); kind = tp1 ? 'time-after-tp' : 'time'; exitBar = j; }
  }
  const avgIn = cost / entered, gross = outs.reduce((a, t) => a + (t.px - avgIn) * s * t.qty, 0), fees = ins.reduce((a, t) => a + f * t.px * t.qty, 0) + outs.reduce((a, t) => a + f * t.px * t.qty, 0), pnl = gross - fees, stagesFilled = filled.size;
  return { excluded: false, planStages: plan.stagesCount, lev: plan.lev, kind, tp1, tp2, stagesFilled, adds: stagesFilled - 1, qtyIn: entered, qtyPlanned: plan.totalQty, fillRatio: entered / plan.totalQty, pnl, rMult: pnl / plan.riskBudget, budget: plan.riskBudget, budgetExceeded: pnl < -plan.riskBudget * (1 + 1e-9), bars: exitBar === null ? last - i : exitBar - i, planWorst: plan.worstLoss, marginUsage: plan.marginUsage };
}

// ── 집계 ──
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
export function scaleSummarize(results) {
  const done = results.filter(r => r && r.excluded === false), n = done.length, ex = results.filter(r => r && r.excluded).length, r = done.map(x => x.rMult), wins = r.filter(x => x > 0), losses = r.filter(x => x <= 0);
  let cum = 0, peak = 0, dd = 0; for (const x of r) { cum += x; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); }
  const kinds = k => done.filter(x => x.kind === k).length;
  return { n, excluded: ex, excludedRate: results.length ? ex / results.length : null, avgR: mean(r), sumR: n ? cum : null, winRate: n ? wins.length / n : null, profitFactor: losses.length && losses.reduce((a, b) => a + b, 0) < 0 ? wins.reduce((a, b) => a + b, 0) / -losses.reduce((a, b) => a + b, 0) : null,
    avgWinR: mean(wins), avgLossR: mean(losses), maxDrawdownR: dd, stopRate: n ? (kinds('stop') + kinds('gap-stop')) / n : null, beRate: n ? kinds('be-stop') / n : null, tp1Rate: n ? done.filter(x => x.tp1).length / n : null, tp2Rate: n ? done.filter(x => x.tp2).length / n : null,
    avgStagesFilled: mean(done.map(x => x.stagesFilled)), addFillRate: n ? done.filter(x => x.adds > 0).length / n : null, avgFillRatio: mean(done.map(x => x.fillRatio)), budgetExceededRate: n ? done.filter(x => x.budgetExceeded).length / n : null, worstR: n ? Math.min(...r) : null, avgBars: mean(done.map(x => x.bars)) };
}

// 비교할 변형. 모두 같은 위험 한도(0.5%)로 사이징되므로 R(=계획 손실 한도의 배수) 기준으로 직접 비교할 수 있다.
export const SCALE_VARIANTS = Object.freeze([
  { id: 'single', label: '단일 진입 100% (기준선)', params: { weights: [1], maxStages: 1, addR: [] } },
  { id: 'split-50-30-20', label: '분할 50/30/20 · 0.3R·0.6R (기본)', params: {} },
  { id: 'split-40-30-30', label: '분할 40/30/30', params: { weights: [0.4, 0.3, 0.3] } },
  { id: 'split-60-25-15', label: '분할 60/25/15', params: { weights: [0.6, 0.25, 0.15] } },
  { id: 'split-70-30', label: '분할 70/30 (2단계)', params: { weights: [0.7, 0.3], maxStages: 2, addR: [0.3] } },
  { id: 'split-50-30-20-shallow', label: '분할 50/30/20 · 0.2R·0.4R (얕게)', params: { addR: [0.2, 0.4] } },
  { id: 'split-50-30-20-deep', label: '분할 50/30/20 · 0.4R·0.8R (깊게)', params: { addR: [0.4, 0.8] } },
  { id: 'tp-40-30-30', label: '기본 진입 + 익절 40/30/30', params: { tp: [{ r: 1.5, w: 0.4 }, { r: 2, w: 0.3 }] } },
  { id: 'tp-60-20-20', label: '기본 진입 + 익절 60/20/20', params: { tp: [{ r: 1.5, w: 0.6 }, { r: 2, w: 0.2 }] } },
  { id: 'no-be', label: '기본 + TP1 후 본전 이동 없음', params: { beAfterTp1: false } },
]);

// events: [{ symbol, strategy, dir, stop, barsRef(심볼별 확정 봉 배열), i }]. 반환: { [strategy]: { [variantId]: summary } }
export function scaleCompare(events, { variants = SCALE_VARIANTS, equity = SSIM.equity, maxBars = SSIM.maxBars, window = SSIM.window } = {}) {
  const out = {};
  for (const ev of events) {
    const key = ev.strategy ?? 'S';
    out[key] ??= Object.fromEntries(variants.map(v => [v.id, []]));
    for (const v of variants) out[key][v.id].push(scaleSimulate(ev.bars, ev.i, ev, { equity, maxBars, window, params: v.params }));
  }
  return Object.fromEntries(Object.entries(out).map(([k, vs]) => [k, Object.fromEntries(Object.entries(vs).map(([id, rs]) => [id, scaleSummarize(rs)]))]));
}
export const scaleReport = (cmp, variants = SCALE_VARIANTS) => {
  const f = (x, d = 2) => (x === null || x === undefined ? '-' : x.toFixed(d)), pc = x => (x === null || x === undefined ? '-' : `${(x * 100).toFixed(0)}%`), lines = [];
  for (const [strategy, vs] of Object.entries(cmp)) {
    lines.push(`■ 전략 ${strategy}`, '변형 | 거래 | 제외 | 평균R | 합계R | 승률 | PF | 최대낙폭R | 최악R | 손절 | 추가체결 | 체결률 | 한도초과');
    for (const v of variants) { const s = vs[v.id]; lines.push(`${v.label} | ${s.n} | ${pc(s.excludedRate)} | ${f(s.avgR, 3)} | ${f(s.sumR, 1)} | ${pc(s.winRate)} | ${f(s.profitFactor)} | ${f(s.maxDrawdownR, 1)} | ${f(s.worstR)} | ${pc(s.stopRate)} | ${pc(s.addFillRate)} | ${pc(s.avgFillRatio)} | ${pc(s.budgetExceededRate)}`); }
  }
  return lines.join('\n');
};
