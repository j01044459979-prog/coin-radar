import test from 'node:test';
import assert from 'node:assert/strict';
import { dec, decAdd, decSub, decMul, decDiv, decToMicro, microToDec, decFormat, microFormat, microToNumber, microFromNumber, decRoundDiv } from '../lib/decimal.mjs';
import { kstDayOf, dayStartMs, dayEndMs, addDays, daysBetween, dayRange, isDayString } from '../lib/time.mjs';

test('십진수: 부동소수 오차 없이 0.1+0.2=0.3, 문자열 정확 파싱, 12자리 초과·형식 오류 거부', () => {
  assert.equal(decAdd(dec('0.1'), dec('0.2')), dec('0.3')); assert.equal(decFormat(decAdd(dec('0.1'), dec('0.2')), 12), '0.300000000000');
  assert.equal(dec(0.1 + 0.2), dec('0.3'));                                           // 숫자 입력은 12자리로 반올림(꼬리 노이즈 제거)
  assert.equal(dec('-12.5'), -12500000000000n); assert.equal(dec(5n), 5000000000000n);
  assert.throws(() => dec('0.1234567890123'), /12자리/); assert.throws(() => dec('1e3'), /형식/); assert.throws(() => dec('abc'), /형식/); assert.throws(() => dec(NaN), /범위/); assert.throws(() => dec(''), /형식/);
});
test('십진수: 곱셈·나눗셈 반올림(0에서 먼 쪽)과 마이크로 변환 동률 처리', () => {
  assert.equal(decRoundDiv(5n, 2n), 3n); assert.equal(decRoundDiv(-5n, 2n), -3n); assert.equal(decRoundDiv(4n, 3n), 1n); assert.equal(decRoundDiv(-4n, 3n), -1n); assert.equal(decRoundDiv(5n, -2n), -3n);
  assert.equal(decToMicro(dec('0.0000005')), 1n); assert.equal(decToMicro(dec('-0.0000005')), -1n); assert.equal(decToMicro(dec('0.0000004')), 0n);
  assert.equal(decMul(dec('100.5'), dec('2')), dec('201')); assert.equal(decDiv(dec('1'), dec('3')), dec('0.333333333333')); assert.equal(decDiv(dec('2'), dec('3')), dec('0.666666666667'));
  assert.throws(() => decDiv(dec(1), 0n), /0으로/);
});
test('십진수: 아주 작은 가격×큰 수량도 정확(PEPE류 0.00001234 × 1,000,000,000 = 12,340)', () => {
  assert.equal(decMul(dec('0.00001234'), dec('1000000000')), dec('12340')); assert.equal(microFormat(decToMicro(decMul(dec('0.00001234'), dec('1000000000'))), 2), '12340.00');
});
test('십진수: 10만 번 더해도 오차 0, 표시 자릿수·음수·Sheets 안전 정수', () => {
  let s = 0n; for (let i = 0; i < 100000; i++) s += decToMicro(dec('0.000001')); assert.equal(s, 100000n); assert.equal(microFormat(s), '0.100000');
  let f = 0; for (let i = 0; i < 100000; i++) f += 0.000001; assert.notEqual(f, 0.1);                           // 부동소수는 어긋남(비교 기준)
  assert.equal(decFormat(dec('-0.0000004'), 6), '0.000000'); assert.equal(decFormat(dec('-1.5'), 1), '-1.5'); assert.equal(microFormat(-315000000n, 2), '-315.00');
  assert.equal(microToNumber(315000000n), 315000000); assert.throws(() => microToNumber(2n ** 60n), /범위/); assert.equal(microFromNumber(5), 5n); assert.throws(() => microFromNumber(1.5), /정수/);
  assert.equal(microToDec(1n), dec('0.000001'));
});
test('KST 거래일: 00:00 경계(23:59:59.999 vs 00:00:00.000), 월말·윤년, 범위 계산', () => {
  const d = Date.UTC(2026, 9, 24, 0, 0, 0) - 9 * 3600000;                           // 2026-10-24 00:00 KST
  assert.equal(kstDayOf(d), '2026-10-24'); assert.equal(kstDayOf(d - 1), '2026-10-23'); assert.equal(kstDayOf(d + 86399999), '2026-10-24'); assert.equal(kstDayOf(d + 86400000), '2026-10-25');
  assert.equal(dayStartMs('2026-10-24'), d); assert.equal(dayEndMs('2026-10-24'), d + 86400000);
  assert.equal(addDays('2024-02-28', 1), '2024-02-29'); assert.equal(addDays('2023-02-28', 1), '2023-03-01'); assert.equal(addDays('2026-12-31', 1), '2027-01-01'); assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(daysBetween('2026-10-24', '2026-11-24'), 31); assert.deepEqual(dayRange('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.ok(isDayString('2024-02-29') && !isDayString('2023-02-29') && !isDayString('2026-13-01') && !isDayString('20261001'));
  assert.equal(kstDayOf(Date.UTC(2026, 9, 23, 15, 0, 0)), '2026-10-24');            // UTC 15:00 = KST 다음 날 00:00
});
