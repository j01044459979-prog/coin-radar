// 고정소수점 십진수(BigInt, 단위 10^-12). 부동소수 오차 없이 가격·수량·금액을 계산한다.
//  · 내부 값 = 십진수 × 10^12 인 BigInt. 입력은 십진 문자열(권장), 숫자(소수 12자리로 반올림), 정수 BigInt(정수 단위).
//  · 문자열 입력은 소수 12자리를 넘으면 오류(조용히 반올림하지 않는다).
//  · 금액(USDT)은 장부 경계에서 마이크로 USDT(10^-6) 정수 BigInt로 반올림한다. 동률은 0에서 먼 쪽(half away from zero).
// 이 파일은 GAS 번들(build.mjs)로도 쓰이므로 최상위 이름이 다른 모듈과 겹치지 않아야 한다.
const DEC_SCALE = BigInt(10) ** BigInt(12);
const DEC_MICRO_DIV = BigInt(10) ** BigInt(6);
export const DEC_DIGITS = 12;

export function decRoundDiv(n, d) {                       // n/d 를 반올림(동률은 0에서 먼 쪽)
  if (d === BigInt(0)) throw new Error('0으로 나눌 수 없음');
  let q = n / d; const r = n % d;
  const twice = (r < BigInt(0) ? -r : r) * BigInt(2), ad = d < BigInt(0) ? -d : d;
  if (twice >= ad) q += (n < BigInt(0)) === (d < BigInt(0)) ? BigInt(1) : -BigInt(1);
  return q;
}
export function dec(x) {
  if (typeof x === 'bigint') return x * DEC_SCALE;
  if (typeof x === 'number') { if (!Number.isFinite(x) || Math.abs(x) >= 1e15) throw new Error(`숫자 범위 오류: ${x}`); x = x.toFixed(DEC_DIGITS); }
  if (typeof x !== 'string') throw new Error('숫자 형식 오류');
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(x.trim());
  if (!m) throw new Error(`숫자 형식 오류: ${String(x).slice(0, 24)}`);
  const frac = (m[3] != null ? m[3] : '');
  if (frac.length > DEC_DIGITS) throw new Error(`소수 ${DEC_DIGITS}자리 초과: ${String(x).slice(0, 24)}`);
  const v = BigInt(m[2]) * DEC_SCALE + BigInt(frac.padEnd(DEC_DIGITS, '0'));
  return m[1] === '-' ? -v : v;
}
export const decAdd = (a, b) => a + b;
export const decSub = (a, b) => a - b;
export const decNeg = a => -a;
export const decAbs = a => (a < BigInt(0) ? -a : a);
export const decMul = (a, b) => decRoundDiv(a * b, DEC_SCALE);
export const decDiv = (a, b) => decRoundDiv(a * DEC_SCALE, b);
export const decCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const decSign = a => (a < BigInt(0) ? -1 : a > BigInt(0) ? 1 : 0);
export const decIsZero = a => a === BigInt(0);
export const decToMicro = a => decRoundDiv(a, DEC_MICRO_DIV);        // 십진수 → 마이크로 정수(반올림)
export const microToDec = m => m * DEC_MICRO_DIV;
export function decFormat(a, dp = 6) {                                // 문자열 표시(반올림)
  if (dp < 0 || dp > DEC_DIGITS) throw new Error('자릿수 범위 오류');
  const neg = a < BigInt(0), unit = BigInt(10) ** BigInt(DEC_DIGITS - dp), v = decRoundDiv(neg ? -a : a, unit), p = BigInt(10) ** BigInt(dp);
  const s = `${v / p}${dp ? '.' + String(v % p).padStart(dp, '0') : ''}`;
  return neg && v !== BigInt(0) ? `-${s}` : s;
}
export const microFormat = (m, dp = 6) => decFormat(microToDec(m), dp);
export function microToNumber(m) {                                    // Sheets 등 배정밀도 저장용(안전 범위만)
  if (m > BigInt("9007199254740991") || m < -BigInt("9007199254740991")) throw new Error('안전 정수 범위 초과');
  return Number(m);
}
export const microFromNumber = n => { if (!Number.isInteger(n)) throw new Error('마이크로 정수가 아님'); return BigInt(n); };
