// 일별 계좌 성장·목표·정합성 계산(순수 함수).
//  · 입출금은 매매 손익과 분리: 일 손익 = 마감 평가액 − 시작 평가액 − 당일 순입출금.
//  · 당일 목표 = 전일 *실제* 마감 잔고 × (1+목표율). 미달분을 다음 날에 더하지 않는다(compound.mjs).
//  · 실제 마감 = 사용자가 입력한 평가액. 없으면 장부 근사값(closeSource='ledger')으로 표시한다(숨기지 않음).
//  · 장부 잔고 = 시작 평가액 + 실현 순손익(입력된 수수료·펀딩만) + 입출금 + 명시 조정. 입력 평가액과의 차이는 항상 표시하고 자동으로 손익에 흡수하지 않는다.
//  · 시작 시 미결제 포지션은 시작 시점 마크가격을 새 기준가로 삼아(opening) 시작 이후 변동분만 반영한다.
import { dec, decFormat, decMul, decSub, decToMicro, decRoundDiv, microToDec } from './decimal.mjs';
import { dayEndMs, dayRange, dayStartMs, dayToIndex, kstDayOf } from './time.mjs';
import { compoundIdealSeries, compoundNextTarget, compoundRateOn } from './compound.mjs';
import { pnlComputeAll, pnlDailyFlows } from './pnl.mjs';
import { dedupeAppend } from './dedupe.mjs';

export const LEDGER_REVIEW_ABS_MICRO = 1000000n;        // 1 USDT
export const LEDGER_REVIEW_PPM = 5000n;                  // 0.5%

const ledgerMicro = v => decToMicro(dec(v));
function ledgerUnique(list, keyField, label) {
  let out = [];
  for (const r of list ?? []) { const x = dedupeAppend(out, r, keyField); if (x.status === 'conflict') throw new Error(`${label} 충돌(같은 ${keyField}, 다른 내용): ${r[keyField]}`); out = x.list; }
  return out;                                              // 같은 id·같은 내용의 재전송은 한 번만 반영
}

export function ledgerBuildDaily({ challenge, fills = [], cashflows = [], equityInputs = [], adjustments = [], openingPositions = [], throughDay }) {
  const startMicro = ledgerMicro(challenge.startEquity), startDay = challenge.startDay, schedule = challenge.rateSchedule;
  if (dayToIndex(throughDay) < dayToIndex(startDay)) return { rows: [], summary: null, flags: ['through-before-start'], trades: new Map() };
  const uFills = ledgerUnique(fills, 'fillId', '체결'), uCash = ledgerUnique(cashflows, 'cfId', '입출금'), uAdj = ledgerUnique(adjustments, 'adjId', '조정');
  const eqByDay = new Map(); for (const e of equityInputs) { if (eqByDay.has(e.day)) throw new Error(`같은 날 평가액 중복: ${e.day}`); eqByDay.set(e.day, e); }
  // opening 포지션 → 시작일 00:00 KST의 기준가 체결(수수료·펀딩 0 입력)
  const startMs = dayStartMs(startDay), openingSids = new Map(), allFills = [...uFills];
  for (const o of openingPositions) { allFills.push({ origin: 'real', fillId: `${o.sid}:opening`, sid: o.sid, kind: 'opening', dir: o.dir, at: startMs, price: o.startMark, qty: o.qty, fee: { state: 'entered', amount: '0' }, funding: { state: 'entered', amount: '0' } }); openingSids.set(o.sid, o); }
  const usable = allFills.filter(f => f.at >= startMs), trades = pnlComputeAll(usable, {}), flows = pnlDailyFlows(trades);
  const days = dayRange(startDay, throughDay), ideal = compoundIdealSeries({ startMicro, startDay, schedule, throughDay });
  const rows = []; let prevClose = startMicro, ledgerWallet = startMicro;
  for (let i = 0; i < days.length; i++) {
    const day = days[i], endMs = dayEndMs(day), rate = compoundRateOn(day, schedule);
    const fl = flows.get(day) ?? { netEnteredMicro: 0n, grossMicro: 0n, feeEnteredMicro: 0n, feeEstimatedMicro: 0n, fundingEnteredMicro: 0n, fundingEstimatedMicro: 0n };
    let cash = 0n; for (const c of uCash) if (kstDayOf(c.at) === day) cash += ledgerMicro(c.amount);
    let adj = 0n; for (const a of uAdj) if (kstDayOf(a.at) === day) adj += ledgerMicro(a.amount);
    ledgerWallet += fl.netEnteredMicro + cash + adj;
    const target = compoundNextTarget(prevClose, rate);
    const eq = eqByDay.get(day) ?? null, equityIn = eq ? ledgerMicro(eq.equity) : null;
    // 그날 끝 미결제 포지션과 opening 기준 미실현 보정
    const openNow = [...pnlComputeAll(usable, { cutoffMs: endMs }).values()].filter(t => t.status === 'open');
    let openingU = 0n, openingUnknown = false;
    for (const t of openNow) {
      const o = openingSids.get(t.sid); if (!o) continue;
      if (o.origEntry === undefined || o.origEntry === null) { openingUnknown = true; continue; }
      const oq = dec(o.qty), q = t.openQtyDec < oq ? t.openQtyDec : oq;
      openingU += decToMicro(decMul(decMul(decSub(dec(o.startMark), dec(o.origEntry)), q), dec(t.dir === 'LONG' ? 1 : -1)));
    }
    const unrl = eq && eq.unrealized !== undefined && eq.unrealized !== null ? ledgerMicro(eq.unrealized) : null;
    const rowFlags = [];
    let diffMicro = null, uncertain = false, needsReview = false, expected = null;
    if (equityIn !== null) {
      if (unrl === null && openNow.length) { uncertain = true; rowFlags.push('unrealized-missing'); expected = ledgerWallet; }
      else if (openingUnknown) { uncertain = true; rowFlags.push('opening-basis-unknown'); expected = ledgerWallet + (unrl ?? 0n); }
      else expected = ledgerWallet + (unrl ?? 0n) - openingU;
      diffMicro = equityIn - expected;
      const rel = decRoundDiv((equityIn < 0n ? -equityIn : equityIn) * LEDGER_REVIEW_PPM, 1000000n), tol = rel > LEDGER_REVIEW_ABS_MICRO ? rel : LEDGER_REVIEW_ABS_MICRO;
      needsReview = (diffMicro < 0n ? -diffMicro : diffMicro) > tol;
      if (needsReview) rowFlags.push('ledger-mismatch');
      if (eq.late) rowFlags.push('late-entry');
    }
    // 실제 마감: 입력 평가액 우선, 없으면 장부 근사(미실현 미반영)
    const close = equityIn !== null ? equityIn : prevClose + cash + fl.netEnteredMicro + adj;
    const closeSource = equityIn !== null ? 'input' : 'ledger';
    if (closeSource === 'ledger') rowFlags.push('close-from-ledger');
    if (fl.feeEstimatedMicro || fl.fundingEstimatedMicro) rowFlags.push('has-estimates');
    for (const t of trades.values()) if (t.events.some(e => e.day === day)) for (const f of t.flags) if (f.endsWith('-missing') && !rowFlags.includes(f)) rowFlags.push(f);
    const pnl = close - prevClose - cash;
    rows.push({ day, n: i + 1, rate, startMicro: prevClose, targetCloseMicro: target.targetCloseMicro, targetProfitMicro: target.targetProfitMicro,
      idealMicro: ideal[i + 1].idealMicro, closeMicro: close, closeSource, cashflowMicro: cash, adjustmentMicro: adj, pnlMicro: pnl,
      achievementPpm: target.targetProfitMicro > 0n ? decRoundDiv(pnl * 1000000n, target.targetProfitMicro) : null,
      ledgerWalletMicro: ledgerWallet, expectedEquityMicro: expected, diffMicro, needsReview, uncertain,
      realizedGrossMicro: fl.grossMicro, feesEnteredMicro: fl.feeEnteredMicro, fundingEnteredMicro: fl.fundingEnteredMicro, openPositions: openNow.length, flags: rowFlags });
    prevClose = close;
  }
  return { rows, summary: ledgerSummarize(rows, startMicro), flags: [], trades };
}

// 요약: 누적 수익률(시작 자금 대비 단순), 최고 평가액, 최대 낙폭(입출금을 제거한 곡선 기준)
export function ledgerSummarize(rows, startMicro) {
  if (!rows.length) return null;
  let cum = 0n, peak = startMicro, maxDd = 0n, maxDdPpm = 0n, highest = startMicro, met = 0, inputDays = 0, ledgerDays = 0, review = 0, curve = startMicro;
  for (const r of rows) {
    cum += r.cashflowMicro; curve = r.closeMicro - cum;
    if (curve > peak) peak = curve;
    const dd = peak - curve; if (dd > maxDd) { maxDd = dd; maxDdPpm = peak > 0n ? decRoundDiv(dd * 1000000n, peak) : 0n; }
    if (r.closeMicro > highest) highest = r.closeMicro;
    if (r.targetProfitMicro > 0n && r.pnlMicro >= r.targetProfitMicro) met++;
    if (r.closeSource === 'input') inputDays++; else ledgerDays++;
    if (r.needsReview) review++;
  }
  const last = rows[rows.length - 1], pnlTotal = last.closeMicro - startMicro - cum, curDd = peak - curve;
  return { startMicro, latestCloseMicro: last.closeMicro, netCashflowMicro: cum, pnlTotalMicro: pnlTotal, returnOnStartPpm: startMicro > 0n ? decRoundDiv(pnlTotal * 1000000n, startMicro) : null,
    highestEquityMicro: highest, maxDrawdownMicro: maxDd, maxDrawdownPpm: maxDdPpm, currentDrawdownMicro: curDd, currentDrawdownPpm: peak > 0n ? decRoundDiv(curDd * 1000000n, peak) : 0n,
    daysTargetMet: met, days: rows.length, daysWithInput: inputDays, daysLedgerOnly: ledgerDays, daysNeedingReview: review, idealLatestMicro: last.idealMicro, gapToIdealMicro: last.closeMicro - last.idealMicro };
}
export const ledgerMicroLabel = (m, dp = 2) => decFormat(microToDec(m), dp);
