// 백테스트 엔진. 규칙: ① 신호는 i번째 봉 '마감 후' 0..i 데이터로만 계산 ② 체결은 i+1번째 봉 시가(+슬리피지) ③ 손절·목표는 i+1 이후 봉의 고저로 판정,
// 같은 봉에서 둘 다 닿으면 손절 우선(보수적) ④ 수수료·슬리피지·펀딩 비용을 R 단위로 환산해 차감 ⑤ 심볼당 동시 포지션 1개, 청산 후 쿨다운.
export const COSTS = { feePerSide: 0.0005, slipPerSide: 0.0005, fundingPer8h: 0.0001 }; // 테이커 0.05%·슬리피지 0.05%(편도), 펀딩 0.01%/8h 보수적 가정
export const ENGINE = { maxHoldBars: 48, cooldownBars: 6, warmup: 260 };
const H = 3600000;

// 거래소 규격 반영(옵션): inst = { tickSz, lotSz, minSz, ctVal }. 체결가는 불리한 방향으로 호가 단위에 맞추고, 위험 1% 기준 수량이 최소 주문 수량에 못 미치면 거래하지 않는다.
export const ACCOUNT = { equity: 10000, riskFrac: 0.01 };
const quant = (p, tick, mode) => (tick > 0 ? (mode === 'up' ? Math.ceil(p / tick - 1e-9) : Math.floor(p / tick + 1e-9)) * tick : p);

// 한 건의 체결·청산을 시뮬레이션한다(백테스트와 추천 로그 추적이 같은 규칙을 쓴다). c: 캔들 배열, i: 신호 봉 인덱스(마감 완료), sig: { dir, stop, tp }.
// 반환: { status: 'skipped'|'open'|'closed', ... }  — 'open'은 아직 손절·목표·최대 보유 기간에 이르지 않음(데이터가 모자람). closed에는 MFE/MAE(R 단위)가 포함된다.
export function simulateTrade(c, i, sig, { costs = COSTS, engine = ENGINE, inst = null, account = ACCOUNT } = {}) {
  const d = sig.dir === 'LONG' ? 1 : -1, nb = c[i + 1];
  if (!nb) return { status: 'open', reason: '다음 봉 대기' };
  const tick = inst?.tickSz ?? 0;
  const entry = quant(nb.o * (1 + d * costs.slipPerSide), tick, d === 1 ? 'up' : 'down');   // 불리한 방향 슬리피지 + 불리한 호가 반올림
  if (!((entry - sig.stop) * d > 0 && (sig.tp - entry) * d > 0)) return { status: 'skipped', reason: '시가가 손절/목표 바깥' }; // 갭으로 바깥에서 시작하면 거래 안 함
  const risk = (entry - sig.stop) * d, riskPct = risk / entry, last = Math.min(c.length - 1, i + engine.maxHoldBars);
  let contracts = null, qtyRiskErr = null;
  if (inst?.ctVal > 0 && inst?.lotSz > 0) {                                  // 최소 주문 단위 점검
    const wantNotional = account.equity * account.riskFrac / riskPct, lots = Math.floor(wantNotional / entry / inst.ctVal / inst.lotSz + 1e-9);
    contracts = lots * inst.lotSz;
    if (contracts < (inst.minSz ?? 0) || contracts <= 0) return { status: 'skipped', reason: '최소 주문 수량 미달' };
    qtyRiskErr = contracts * inst.ctVal * entry * riskPct / (account.equity * account.riskFrac) - 1;   // 수량 반올림으로 생긴 위험 오차
  }
  let exit = null, reason = null, k = i + 1, mfe = 0, mae = 0, ambiguous = false;
  for (; k <= last; k++) {
    const b = c[k];
    mfe = Math.max(mfe, ((d === 1 ? b.h : -b.l) - (d === 1 ? entry : -entry)) / risk);
    mae = Math.max(mae, ((d === 1 ? entry - b.l : b.h - entry)) / risk);
    const hitStop = d === 1 ? b.l <= sig.stop : b.h >= sig.stop, hitTp = d === 1 ? b.h >= sig.tp : b.l <= sig.tp;
    if (k > i + 1 && ((d === 1 && b.o <= sig.stop) || (d === -1 && b.o >= sig.stop))) { exit = b.o; reason = 'stop'; break; } // 시가 갭으로 손절 통과
    if (hitStop) { ambiguous = hitTp; exit = sig.stop; reason = 'stop'; break; } // 같은 봉에서 둘 다 닿으면 손절 우선(순서를 알 수 없는 봉은 ambiguous로 표시)
    if (hitTp) { exit = sig.tp; reason = 'tp'; break; }
  }
  if (exit === null) {
    if (i + engine.maxHoldBars > c.length - 1) return { status: 'open', reason: '진행 중', entry, riskPct, barsSeen: last - i };
    k = last; exit = c[k].c; reason = 'time';
  }
  const exitFill = quant(exit * (1 - d * costs.slipPerSide), tick, d === 1 ? 'down' : 'up');
  const gross = (exitFill - entry) * d / risk, bars = k - i;
  const costPct = 2 * costs.feePerSide + costs.fundingPer8h * (bars / 8);   // 수수료는 명목가 기준, 슬리피지는 체결가에 이미 반영
  const rNet = gross - costPct / riskPct;
  // 봉 내부 순서를 알 수 없어 손절로 처리한 거래의 낙관적 상한(목표가 먼저 닿았다고 가정): 손절 가정의 영향 범위를 가늠하기 위한 값
  let rNetOpt = rNet;
  if (ambiguous) { const g2 = (quant(sig.tp * (1 - d * costs.slipPerSide), tick, d === 1 ? 'down' : 'up') - entry) * d / risk; rNetOpt = g2 - costPct / riskPct; }
  return { status: 'closed', k, tEntry: nb.t, tExit: c[k].t, entry, exit: exitFill, riskPct, bars, reason, rGross: gross, rNet, rNetOpt, ambiguous, mfeR: mfe, maeR: mae, contracts, qtyRiskErr };
}

// strategyFn(i) → null | { dir, stop, tp, meta }  (i 이후 데이터를 참조하면 안 된다: 인과성 테스트로 검증)
// from/to: 신호 봉 시각(ms) 허용 구간 [from, to). 그 밖의 신호는 무시하고, 청산이 to를 넘는 거래는 구간 경계를 가로지르므로 제외(purge).
export function runSymbol(c, strategyFn, { costs = COSTS, engine = ENGINE, from = 0, to = Infinity, inst = null, account = ACCOUNT, stats = null } = {}) {
  const trades = []; let i = engine.warmup, blockedUntil = -1;
  for (; i < c.length - 2; i++) {
    if (i < blockedUntil) continue;
    if (c[i].t < from) continue;
    if (c[i].t >= to) break;
    const sig = strategyFn(i);
    if (!sig) continue;
    const r = simulateTrade(c, i, sig, { costs, engine, inst, account });
    if (r.status === 'skipped') { if (stats) stats[r.reason] = (stats[r.reason] || 0) + 1; continue; }
    if (r.status === 'closed' && r.tExit >= to) { if (stats) stats.purged = (stats.purged || 0) + 1; continue; }
    if (r.status === 'open') { if (r.reason === '진행 중') break; continue; }  // 데이터 끝에서 미청산 거래는 집계하지 않음
    trades.push({ i, t: c[i].t, tEntry: r.tEntry, tExit: r.tExit, dir: sig.dir, entry: r.entry, stop: sig.stop, tp: sig.tp, exit: r.exit, riskPct: r.riskPct, bars: r.bars, reason: r.reason, rGross: r.rGross, rNet: r.rNet, rNetOpt: r.rNetOpt, ambiguous: r.ambiguous, mfeR: r.mfeR, maeR: r.maeR, qtyRiskErr: r.qtyRiskErr, meta: sig.meta ?? null });
    blockedUntil = r.k + engine.cooldownBars; i = Math.max(i, r.k - 1);
  }
  return trades;
}

export const regimeOf = (btc, i) => {
  if (i < 720) return null;
  const r = btc[i].c / btc[i - 720].c - 1;                                     // 직전 30일 BTC 수익률(과거만 사용)
  return r > 0.08 ? '상승장' : r < -0.08 ? '하락장' : '횡보장';
};
