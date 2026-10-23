// 거래당 위험·청산 위험 표시(경고용 근사). 차단하지 않고 값과 경고만 낸다. 거래소별 유지증거금·수수료 구조가 달라 청산가는 *근사*다.
import { dec, decAbs, decMul, decDiv, decSub, decAdd, decSign, decToMicro, decFormat, decRoundDiv, microToDec } from './decimal.mjs';

export function riskTrade({ dir, entry, stop, qty, margin, leverage, equityMicro, mmr = '0.005' }) {
  if (dir !== 'LONG' && dir !== 'SHORT') throw new Error('방향 오류');
  const e = dec(entry), s = dec(stop), q = dec(qty), lev = dec(leverage), m = margin === undefined || margin === null ? null : dec(margin), r = dec(mmr), one = dec(1);
  if (decSign(e) <= 0 || decSign(q) <= 0 || decSign(lev) <= 0) throw new Error('진입가·수량·레버리지는 0보다 커야 함');
  const sign = dir === 'LONG' ? 1 : -1, dist = decMul(decSub(e, s), dec(sign));      // 손절까지 불리한 거리(양수여야 정상)
  const flags = [];
  if (decSign(dist) <= 0) flags.push('stop-on-wrong-side');
  const notional = decMul(e, q), lossMicro = decToMicro(decMul(decAbs(decSub(e, s)), q));
  const impliedLev = m && decSign(m) > 0 ? decDiv(notional, m) : null;
  if (impliedLev !== null && decAbs(decSub(impliedLev, lev)) * 20n > lev) flags.push('leverage-mismatch');           // 증거금·수량으로 계산한 레버리지가 입력과 5% 넘게 다름
  const liq = dir === 'LONG' ? decMul(e, decAdd(decSub(one, decDiv(one, lev)), r)) : decMul(e, decSub(decAdd(one, decDiv(one, lev)), r));   // 격리 마진 근사
  const liqBeforeStop = dir === 'LONG' ? liq >= s : liq <= s;
  if (liqBeforeStop && decSign(dist) > 0) flags.push('liquidation-before-stop');
  let riskPpm = null;
  if (equityMicro !== undefined && equityMicro !== null && equityMicro > 0n) { riskPpm = decRoundDiv(lossMicro * 1000000n, equityMicro); if (riskPpm > 20000n) flags.push('risk-over-2pct'); }
  return { notionalMicro: decToMicro(notional), impliedLeverage: impliedLev === null ? null : decFormat(impliedLev, 4), stopLossMicro: lossMicro, riskPpmOfEquity: riskPpm,
    liquidationApprox: decFormat(liq, 8), liquidationIsApproximate: true, liquidationBeforeStop: liqBeforeStop && decSign(dist) > 0, flags };
}
export const riskMicroLabel = m => decFormat(microToDec(m), 2);
