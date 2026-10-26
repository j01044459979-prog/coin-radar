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
import { nullishOr } from './nullish.mjs';

export const LEDGER_REVIEW_ABS_MICRO = BigInt(1000000);        // 1 USDT
export const LEDGER_REVIEW_PPM = BigInt(5000);                  // 0.5%

const ledgerMicro = v => decToMicro(dec(v));
function ledgerUnique(list, keyField, label) {
  let out = [];
  for (const r of (list != null ? list : [])) { const x = dedupeAppend(out, r, keyField); if (x.status === 'conflict') throw new Error(`${label} 충돌(같은 ${keyField}, 다른 내용): ${r[keyField]}`); out = x.list; }
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
  // 범위 밖 입력은 조용히 버리지 않고 경고로 알린다(개수만, 값은 노출하지 않음)
  const endAll = dayEndMs(throughDay), inputFlags = [], flag = (type, n) => { if (n) inputFlags.push({ type, count: n }); };
  flag('fills-before-start', uFills.filter(f => f.at < startMs).length); flag('fills-after-through', uFills.filter(f => f.at >= endAll).length);
  flag('cashflows-before-start', uCash.filter(c => c.at < startMs).length); flag('cashflows-after-through', uCash.filter(c => c.at >= endAll).length);
  flag('adjustments-before-start', uAdj.filter(a => a.at < startMs).length); flag('adjustments-after-through', uAdj.filter(a => a.at >= endAll).length);
  flag('equity-outside-range', equityInputs.filter(e => dayToIndex(e.day) < dayToIndex(startDay) || dayToIndex(e.day) > dayToIndex(throughDay)).length);
  const usable = allFills.filter(f => f.at >= startMs && f.at < endAll), trades = pnlComputeAll(usable, {}), flows = pnlDailyFlows(trades);
  const days = dayRange(startDay, throughDay), ideal = compoundIdealSeries({ startMicro, startDay, schedule, throughDay });
  const rows = []; let prevClose = startMicro, ledgerWallet = startMicro;
  // 한 번만 훑는 색인: 일별 입출금·조정 합계, 체결 시간순 이벤트(미결제 상태 갱신), 일별 미입력 수수료·펀딩 표시
  const cashByDay = new Map(), adjByDay = new Map(), missingByDay = new Map(), evs = [];
  for (const c of uCash) { const k = kstDayOf(c.at); cashByDay.set(k, (nullishOr(cashByDay.get(k), BigInt(0))) + ledgerMicro(c.amount)); }
  for (const a of uAdj) { const k = kstDayOf(a.at); adjByDay.set(k, (nullishOr(adjByDay.get(k), BigInt(0))) + ledgerMicro(a.amount)); }
  for (const t of trades.values()) for (const e of t.events) {
    evs.push({ at: e.at, sid: t.sid, dir: t.dir, qtyAfter: e.qtyAfter });
    if (e.feeState === 'missing' || e.fundingState === 'missing') { const m = nullishOr(missingByDay.get(e.day), new Set()); if (e.feeState === 'missing') m.add('fee-missing'); if (e.fundingState === 'missing') m.add('funding-missing'); missingByDay.set(e.day, m); }
  }
  evs.sort((a, b) => a.at - b.at); let evPtr = 0; const openQty = new Map();
  for (let i = 0; i < days.length; i++) {
    const day = days[i], endMs = dayEndMs(day), rate = compoundRateOn(day, schedule);
    const fl = nullishOr(flows.get(day), { netEnteredMicro: BigInt(0), grossMicro: BigInt(0), feeEnteredMicro: BigInt(0), feeEstimatedMicro: BigInt(0), fundingEnteredMicro: BigInt(0), fundingEstimatedMicro: BigInt(0) });
    const cash = nullishOr(cashByDay.get(day), BigInt(0)), adj = nullishOr(adjByDay.get(day), BigInt(0));
    ledgerWallet += fl.netEnteredMicro + cash + adj;
    const target = compoundNextTarget(prevClose, rate);
    const eq = nullishOr(eqByDay.get(day), null), equityIn = eq ? ledgerMicro(eq.equity) : null;
    // 그날 끝 미결제 포지션과 opening 기준 미실현 보정
    while (evPtr < evs.length && evs[evPtr].at < endMs) { const e = evs[evPtr++]; if (e.qtyAfter > BigInt(0)) openQty.set(e.sid, { dir: e.dir, qty: e.qtyAfter }); else openQty.delete(e.sid); }
    const openNow = [...openQty.entries()].map(([sid, v]) => ({ sid, dir: v.dir, openQtyDec: v.qty }));
    let openingU = BigInt(0), openingUnknown = false;
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
      else if (openingUnknown) { uncertain = true; rowFlags.push('opening-basis-unknown'); expected = ledgerWallet + ((unrl != null ? unrl : BigInt(0))); }
      else expected = ledgerWallet + ((unrl != null ? unrl : BigInt(0))) - openingU;
      diffMicro = equityIn - expected;
      const rel = decRoundDiv((equityIn < BigInt(0) ? -equityIn : equityIn) * LEDGER_REVIEW_PPM, BigInt(1000000)), tol = rel > LEDGER_REVIEW_ABS_MICRO ? rel : LEDGER_REVIEW_ABS_MICRO;
      needsReview = (diffMicro < BigInt(0) ? -diffMicro : diffMicro) > tol;
      if (needsReview) rowFlags.push('ledger-mismatch');
      if (eq.late) rowFlags.push('late-entry');
    }
    // 실제 마감: 입력 평가액 우선, 없으면 장부 근사(미실현 미반영)
    const close = equityIn !== null ? equityIn : prevClose + cash + fl.netEnteredMicro + adj;
    const closeSource = equityIn !== null ? 'input' : 'ledger';
    if (closeSource === 'ledger') rowFlags.push('close-from-ledger');
    if (fl.feeEstimatedMicro || fl.fundingEstimatedMicro) rowFlags.push('has-estimates');
    for (const f of nullishOr(missingByDay.get(day), [])) if (!rowFlags.includes(f)) rowFlags.push(f);
    const pnl = close - prevClose - cash;
    rows.push({ day, n: i + 1, rate, startMicro: prevClose, targetCloseMicro: target.targetCloseMicro, targetProfitMicro: target.targetProfitMicro,
      idealMicro: ideal[i + 1].idealMicro, closeMicro: close, closeSource, cashflowMicro: cash, adjustmentMicro: adj, pnlMicro: pnl,
      achievementPpm: target.targetProfitMicro > BigInt(0) ? decRoundDiv(pnl * BigInt(1000000), target.targetProfitMicro) : null,
      ledgerWalletMicro: ledgerWallet, expectedEquityMicro: expected, diffMicro, needsReview, uncertain,
      realizedGrossMicro: fl.grossMicro, realizedNetMicro: fl.netEnteredMicro, feesEnteredMicro: fl.feeEnteredMicro, fundingEnteredMicro: fl.fundingEnteredMicro, openPositions: openNow.length, flags: rowFlags });
    prevClose = close;
  }
  return { rows, summary: ledgerSummarize(rows, startMicro), flags: inputFlags, trades };
}

// 요약: 누적 수익률(시작 자금 대비 단순), 최고 평가액, 최대 낙폭(입출금을 제거한 곡선 기준)
export function ledgerSummarize(rows, startMicro) {
  if (!rows.length) return null;
  let cum = BigInt(0), peak = startMicro, maxDd = BigInt(0), maxDdPpm = BigInt(0), highest = startMicro, met = 0, inputDays = 0, ledgerDays = 0, review = 0, curve = startMicro;
  for (const r of rows) {
    cum += r.cashflowMicro; curve = r.closeMicro - cum;
    if (curve > peak) peak = curve;
    const dd = peak - curve; if (dd > maxDd) { maxDd = dd; maxDdPpm = peak > BigInt(0) ? decRoundDiv(dd * BigInt(1000000), peak) : BigInt(0); }
    if (r.closeMicro > highest) highest = r.closeMicro;
    if (r.targetProfitMicro > BigInt(0) && r.pnlMicro >= r.targetProfitMicro) met++;
    if (r.closeSource === 'input') inputDays++; else ledgerDays++;
    if (r.needsReview) review++;
  }
  const last = rows[rows.length - 1], pnlTotal = last.closeMicro - startMicro - cum, curDd = peak - curve;
  return { startMicro, latestCloseMicro: last.closeMicro, netCashflowMicro: cum, pnlTotalMicro: pnlTotal, returnOnStartPpm: startMicro > BigInt(0) ? decRoundDiv(pnlTotal * BigInt(1000000), startMicro) : null,
    highestEquityMicro: highest, maxDrawdownMicro: maxDd, maxDrawdownPpm: maxDdPpm, currentDrawdownMicro: curDd, currentDrawdownPpm: peak > BigInt(0) ? decRoundDiv(curDd * BigInt(1000000), peak) : BigInt(0),
    daysTargetMet: met, days: rows.length, daysWithInput: inputDays, daysLedgerOnly: ledgerDays, daysNeedingReview: review, idealLatestMicro: last.idealMicro, gapToIdealMicro: last.closeMicro - last.idealMicro };
}
export const ledgerMicroLabel = (m, dp = 2) => decFormat(microToDec(m), dp);
