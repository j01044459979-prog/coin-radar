import test from 'node:test';
import assert from 'node:assert/strict';
import { compoundNextTarget, compoundIdealSeries, compoundRateOn, rateFraction } from '../lib/compound.mjs';
import { ledgerBuildDaily } from '../lib/ledger.mjs';

const M = n => BigInt(Math.round(n * 1e6));
const ch = (extra = {}) => ({ startEquity: '300', startDay: '2026-10-24', rateSchedule: [{ from: '2026-10-24', rate: '0.05' }], ...extra });

test('1일차 목표: 시작 300 → 목표 마감 315, 목표 수익금 15', () => {
  const t = compoundNextTarget(M(300), '0.05'); assert.equal(t.targetCloseMicro, M(315)); assert.equal(t.targetProfitMicro, M(15));
});
test('이상 복리선: 300×1.05^n 이 독립 계산(Python Decimal)과 일치 — n=1,2,7,30,100', () => {
  const s = compoundIdealSeries({ startMicro: M(300), startDay: '2026-10-24', schedule: ch().rateSchedule, throughDay: '2027-02-01' });
  const at = n => s.find(r => r.n === n).idealMicro;
  assert.equal(s[0].n, 0); assert.equal(s[0].idealMicro, M(300)); assert.equal(at(1), 315000000n); assert.equal(at(2), 330750000n); assert.equal(at(7), 422130127n); assert.equal(at(30), 1296582713n); assert.equal(at(100), 39450377354n);
  assert.equal(s.find(r => r.n === 1).day, '2026-10-24');
});
test('목표율 변경은 변경일부터 적용(과거 이상선 불변), 분수 정확', () => {
  const sch = [{ from: '2026-10-24', rate: '0.05' }, { from: '2026-10-27', rate: '0.03' }];
  const a = compoundIdealSeries({ startMicro: M(300), startDay: '2026-10-24', schedule: sch, throughDay: '2026-10-28' }), b = compoundIdealSeries({ startMicro: M(300), startDay: '2026-10-24', schedule: sch, throughDay: '2026-10-26' });
  assert.equal(a[5].idealMicro, 368437309n); assert.deepEqual(a.slice(0, 4), b);                      // 3일은 5% 3일 + 3% 2일 = 368.437309, 앞 구간은 그대로
  assert.equal(compoundRateOn('2026-10-26', sch), '0.05'); assert.equal(compoundRateOn('2026-10-27', sch), '0.03'); assert.throws(() => compoundRateOn('2026-10-23', sch), /일정 없음/);
  assert.deepEqual(rateFraction('0.05'), { num: 5n, den: 100n }); assert.throws(() => rateFraction('1.5'), /0~100%/); assert.throws(() => rateFraction('abc'), /형식/);
});
test('미달분 보정 없음: 다음 날 목표는 전일 *실제* 마감 × 1.05 뿐(310 마감 → 325.5, 315×1.05+5 아님)', () => {
  const r = ledgerBuildDaily({ challenge: ch(), throughDay: '2026-10-26', equityInputs: [{ day: '2026-10-24', equity: '310' }, { day: '2026-10-25', equity: '300' }] });
  assert.equal(r.rows[0].targetCloseMicro, M(315)); assert.equal(r.rows[0].pnlMicro, M(10));
  assert.equal(r.rows[1].targetCloseMicro, M(325.5)); assert.equal(r.rows[1].targetProfitMicro, M(15.5)); assert.equal(r.rows[1].pnlMicro, M(-10));
  assert.equal(r.rows[2].targetCloseMicro, M(315)); assert.equal(r.rows[2].startMicro, M(300));              // 어제 300 마감 → 오늘 목표 315
  assert.ok(r.rows[1].idealMicro > r.rows[1].closeMicro);                                                   // 이상선과는 별개로 유지
});
test('속성: 당일 목표는 (전일 실제 마감, 목표율)만의 함수 — 무작위 수열에서 어제 마감이 같으면 과거와 무관하게 같은 목표', () => {
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let k = 0; k < 200; k++) {
    const closes = Array.from({ length: 6 }, () => (100 + rnd() * 400).toFixed(2));
    const full = ledgerBuildDaily({ challenge: ch(), throughDay: '2026-10-30', equityInputs: closes.slice(0, 5).map((e, i) => ({ day: ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28'][i], equity: e })) });
    for (let i = 1; i < 5; i++) assert.equal(full.rows[i].targetCloseMicro, compoundNextTarget(BigInt(Math.round(Number(closes[i - 1]) * 100)) * 10000n, '0.05').targetCloseMicro);
  }
});
