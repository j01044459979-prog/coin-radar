// 실제 매매 손익 계산(LONG/SHORT, 부분청산·추가 진입, 수수료·펀딩 3상태). 모의매매(origin≠real)는 거부한다 — 모의와 실제는 섞지 않는다.
//  · 평균 진입가는 체결 순서의 가중평균(원가 합계 방식). 청산 시 비례 원가를 제거해 실현손익을 계산하고 체결마다 마이크로 USDT로 반올림.
//  · 수수료(fee): 양수 비용. 펀딩(funding): 부호 있는 현금흐름(+받음 −지급). 상태: entered(실제 입력) / estimated(추정, 별도 집계) / missing(미입력, 합계 제외 + 경고).
//  · 순손익(net) = 총손익 − 수수료 + 펀딩. 기본값(netEntered)은 *실제 입력된 값만* 반영하고, 추정치를 더한 값은 netWithEstimates로 따로 낸다.
import { dec, decAdd, decSub, decMul, decDiv, decSign, decToMicro, decFormat, microToDec, decRoundDiv } from './decimal.mjs';
import { kstDayOf } from './time.mjs';

export const PNL_ENTRY_KINDS = ['opening', 'entry', 'add'];
export const PNL_EXIT_KINDS = ['reduce', 'close'];
const PNL_STATES = ['entered', 'estimated', 'missing'];

function pnlNormalizeAmount(a, name, nonNegative) {
  const state = a?.state ?? 'missing';
  if (!PNL_STATES.includes(state)) throw new Error(`${name} 상태 오류: ${state}`);
  if (state === 'missing') return { state, micro: 0n };
  if (a.amount === undefined || a.amount === null || a.amount === '') throw new Error(`${name} 금액 필요(상태 ${state})`);
  const micro = decToMicro(dec(a.amount));
  if (nonNegative && micro < 0n) throw new Error(`${name}은 0 이상이어야 함`);
  return { state, micro };
}
export function pnlNormalizeFill(f) {
  if (!f || typeof f !== 'object') throw new Error('체결 형식 오류');
  if (f.origin !== 'real') throw new Error(`실제 체결만 허용(origin=real): ${f.origin}`);
  if (typeof f.fillId !== 'string' || !f.fillId || typeof f.sid !== 'string' || !f.sid) throw new Error('fillId·sid 필요');
  if (![...PNL_ENTRY_KINDS, ...PNL_EXIT_KINDS].includes(f.kind)) throw new Error(`체결 종류 오류: ${f.kind}`);
  if (f.dir !== 'LONG' && f.dir !== 'SHORT') throw new Error('방향 오류');
  if (!Number.isFinite(f.at)) throw new Error('체결 시각 오류');
  const price = dec(f.price), qty = dec(f.qty);
  if (decSign(price) <= 0 || decSign(qty) <= 0) throw new Error('가격·수량은 0보다 커야 함');
  return { fillId: f.fillId, sid: f.sid, kind: f.kind, dir: f.dir, at: f.at, price, qty,
    margin: f.margin === undefined || f.margin === null ? null : dec(f.margin), leverage: f.leverage === undefined || f.leverage === null ? null : dec(f.leverage),
    fee: pnlNormalizeAmount(f.fee, '수수료', true), funding: pnlNormalizeAmount(f.funding, '펀딩', false) };
}

// 한 포지션(sid)의 체결 목록 → 손익. cutoffMs가 있으면 그 시각 이전(<) 체결만 사용한다.
export function pnlComputeTrade(fillsIn, { cutoffMs = Infinity } = {}) {
  const fills = fillsIn.map(pnlNormalizeFill).filter(f => f.at < cutoffMs).map((f, i) => ({ f, i })).sort((a, b) => a.f.at - b.f.at || a.i - b.i).map(x => x.f);
  if (!fills.length) return null;
  const sid = fills[0].sid, dir = fills[0].dir, sign = dir === 'LONG' ? 1n : -1n;
  let qty = 0n, cost = 0n, marginMicro = 0n, marginAll = true, first = true;
  const events = [], flags = new Set(), seen = new Set();
  for (const f of fills) {
    if (f.sid !== sid) throw new Error('한 번에 하나의 sid만 계산');
    if (f.dir !== dir) throw new Error(`방향이 일치하지 않음: ${f.fillId}`);
    if (seen.has(f.fillId)) throw new Error(`중복 fillId: ${f.fillId}`); seen.add(f.fillId);
    if (first && !['entry', 'opening'].includes(f.kind)) throw new Error('첫 체결은 entry 또는 opening이어야 함');
    if (!first && f.kind === 'entry') throw new Error('추가 진입은 kind=add');
    if (!first && f.kind === 'opening') throw new Error('opening은 첫 체결만');
    first = false;
    let grossMicro = 0n;
    if (PNL_ENTRY_KINDS.includes(f.kind)) {
      qty = decAdd(qty, f.qty); cost = decAdd(cost, decMul(f.price, f.qty));
      if (f.kind !== 'opening') { if (f.margin === null) marginAll = false; else marginMicro += decToMicro(f.margin); }
    } else {
      if (f.qty > qty) throw new Error(`청산 수량(${decFormat(f.qty, 8)})이 보유 수량(${decFormat(qty, 8)})보다 큼: ${f.fillId}`);
      if (f.kind === 'close' && f.qty !== qty) throw new Error(`close는 잔량 전체여야 함: ${f.fillId}`);
      const removed = f.qty === qty ? cost : decDiv(decMul(cost, f.qty), qty);
      grossMicro = decToMicro(sign === 1n ? decSub(decMul(f.price, f.qty), removed) : decSub(removed, decMul(f.price, f.qty)));
      qty = decSub(qty, f.qty); cost = decSub(cost, removed);
    }
    events.push({ fillId: f.fillId, at: f.at, day: kstDayOf(f.at), kind: f.kind, grossMicro, feeMicro: f.fee.micro, feeState: f.fee.state, fundingMicro: f.funding.micro, fundingState: f.funding.state });
  }
  const t = { grossMicro: 0n, feeEnteredMicro: 0n, feeEstimatedMicro: 0n, feeMissingCount: 0, fundingEnteredMicro: 0n, fundingEstimatedMicro: 0n, fundingMissingCount: 0 };
  for (const e of events) {
    t.grossMicro += e.grossMicro;
    if (e.feeState === 'entered') t.feeEnteredMicro += e.feeMicro; else if (e.feeState === 'estimated') t.feeEstimatedMicro += e.feeMicro; else t.feeMissingCount++;
    if (e.fundingState === 'entered') t.fundingEnteredMicro += e.fundingMicro; else if (e.fundingState === 'estimated') t.fundingEstimatedMicro += e.fundingMicro; else t.fundingMissingCount++;
  }
  t.netEnteredMicro = t.grossMicro - t.feeEnteredMicro + t.fundingEnteredMicro;
  t.netWithEstimatesMicro = t.netEnteredMicro - t.feeEstimatedMicro + t.fundingEstimatedMicro;
  if (t.feeMissingCount) flags.add('fee-missing'); if (t.fundingMissingCount) flags.add('funding-missing');
  if (t.feeEstimatedMicro || events.some(e => e.feeState === 'estimated')) flags.add('fee-estimated');
  if (events.some(e => e.fundingState === 'estimated')) flags.add('funding-estimated');
  const status = qty === 0n ? 'closed' : 'open';
  const margin = marginAll && marginMicro > 0n ? marginMicro : null;
  return { sid, dir, status, openQty: decFormat(qty, 12), openQtyDec: qty, avgEntry: qty > 0n ? decFormat(decDiv(cost, qty), 10) : null, costDec: cost, marginMicro: margin,
    roePpm: margin && status === 'closed' ? decRoundDiv(t.netEnteredMicro * 1000000n, margin) : null, totals: t, events, flags: [...flags] };
}
// 여러 sid의 체결 → 포지션 맵
export function pnlComputeAll(fills, opts) {
  const by = new Map(); for (const f of fills) { if (!by.has(f.sid)) by.set(f.sid, []); by.get(f.sid).push(f); }
  const out = new Map(); for (const [sid, list] of by) { const t = pnlComputeTrade(list, opts); if (t) out.set(sid, t); } return out;
}
// 날짜(KST)별 흐름 합계: 체결 시각 기준으로 실현손익·수수료·펀딩을 귀속
export function pnlDailyFlows(trades) {
  const days = new Map();
  for (const t of trades.values()) for (const e of t.events) {
    const d = days.get(e.day) ?? { grossMicro: 0n, feeEnteredMicro: 0n, feeEstimatedMicro: 0n, fundingEnteredMicro: 0n, fundingEstimatedMicro: 0n, netEnteredMicro: 0n };
    d.grossMicro += e.grossMicro;
    if (e.feeState === 'entered') d.feeEnteredMicro += e.feeMicro; else if (e.feeState === 'estimated') d.feeEstimatedMicro += e.feeMicro;
    if (e.fundingState === 'entered') d.fundingEnteredMicro += e.fundingMicro; else if (e.fundingState === 'estimated') d.fundingEstimatedMicro += e.fundingMicro;
    d.netEnteredMicro = d.grossMicro - d.feeEnteredMicro + d.fundingEnteredMicro; days.set(e.day, d);
  }
  return days;
}
export const pnlMicroToString = (m, dp = 6) => decFormat(microToDec(m), dp);
