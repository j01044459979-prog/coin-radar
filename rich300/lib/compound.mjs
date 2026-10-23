// 복리 도전 목표 계산(정수·유리수 연산, 부동소수 없음).
//  · 당일 목표 마감 잔고 = 전일 *실제* 마감 잔고 × (1 + 목표율). 미달분을 다음 날 목표에 더하지 않는다(보정 없음).
//  · 이상 복리선 = 시작 자금 × Π(1 + 그날 목표율). 실제 성적과 무관하게 고정된 기준선이다.
//  · 모든 금액은 마이크로 USDT(BigInt). 목표율은 십진 문자열("0.05").
import { decRoundDiv } from './decimal.mjs';
import { dayToIndex, indexToDay } from './time.mjs';

export function rateFraction(rate) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(rate).trim());
  if (!m) throw new Error(`목표율 형식 오류: ${rate}`);
  const frac = m[2] ?? '', den = 10n ** BigInt(frac.length), num = BigInt(m[1] + frac);
  if (num > den) throw new Error('목표율은 0~100%');            // 0 이상 1 이하(100%)
  return { num, den };
}
export function compoundNextTarget(prevCloseMicro, rate) {
  const { num, den } = rateFraction(rate);
  const targetCloseMicro = decRoundDiv(prevCloseMicro * (den + num), den);
  return { targetCloseMicro, targetProfitMicro: targetCloseMicro - prevCloseMicro };
}
// 목표율 일정: [{from:'YYYY-MM-DD', rate:'0.05'}] — from 이후 첫 일정부터 적용(과거 날짜는 과거 일정 그대로)
export function compoundRateOn(day, schedule) {
  const di = dayToIndex(day); let cur = null, curIdx = -Infinity;
  for (const s of schedule) { const fi = dayToIndex(s.from); if (fi <= di && fi >= curIdx) { cur = s.rate; curIdx = fi; } }
  if (cur === null) throw new Error(`목표율 일정 없음: ${day}`);
  return cur;
}
// 이상선: startDay가 1일차(마감 목표 = 시작 × (1+g)^1). n=0은 시작 전 기준점(= 시작 자금).
export function compoundIdealSeries({ startMicro, startDay, schedule, throughDay }) {
  const s = dayToIndex(startDay), e = dayToIndex(throughDay);
  if (e < s) return [{ day: indexToDay(s - 1), n: 0, idealMicro: startMicro }];
  const rows = [{ day: indexToDay(s - 1), n: 0, idealMicro: startMicro }];
  let numer = startMicro, denom = 1n;
  for (let i = s; i <= e; i++) {
    const { num, den } = rateFraction(compoundRateOn(indexToDay(i), schedule));
    numer *= den + num; denom *= den;
    rows.push({ day: indexToDay(i), n: i - s + 1, idealMicro: decRoundDiv(numer, denom) });
  }
  return rows;
}
