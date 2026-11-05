// 독립 기준값(Python Decimal) 대조: 300건 무작위 거래(LONG/SHORT·추가 진입·부분/전량 청산·초소형~대형 가격)의 체결별 실현손익이 마이크로 USDT까지 일치해야 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pnlComputeTrade } from '../lib/pnl.mjs';

const oracle = JSON.parse(readFileSync(new URL('./fixtures/pnl-oracle.json', import.meta.url), 'utf8'));
test(`독립 기준값 ${oracle.length}건과 체결별·합계 실현손익이 모두 일치(오차 0 마이크로)`, () => {
  let events = 0;
  oracle.forEach((o, i) => {
    const fills = o.fills.map((f, k) => ({ origin: 'real', sid: `T${i}`, dir: o.dir, at: Date.UTC(2026, 9, 24) + k * 1000, fee: { state: 'entered', amount: '0' }, funding: { state: 'entered', amount: '0' }, ...f }));
    const t = pnlComputeTrade(fills);
    assert.equal(t.status, 'closed', `거래 ${i}`);
    assert.deepEqual(t.events.map(e => Number(e.grossMicro)), o.grossMicroPerEvent, `거래 ${i} 체결별`);
    assert.equal(Number(t.totals.grossMicro), o.grossMicroTotal, `거래 ${i} 합계`);
    events += o.grossMicroPerEvent.length;
  });
  assert.ok(events > 700);
});

// 정확 유리수 기준값(Python Fraction, 중간 반올림 없음): 동률 반올림이 자주 걸리는 값 포함. 검토에서 중간 12자리 반올림이 4건/3,173건을 1마이크로 어긋나게 함을 발견 → 24자리 원가로 수정, 이제 0건.
const exact = JSON.parse(readFileSync(new URL('./fixtures/pnl-exact-oracle.json', import.meta.url), 'utf8'));
test(`정확 유리수 기준값 ${exact.length}건 일치: 중간 반올림 없는 계산과 체결별 실현손익이 마이크로 단위까지 동일`, () => {
  let events = 0, ties = 0;
  exact.forEach((o, i) => {
    const fills = o.fills.map((f, k) => ({ origin: 'real', sid: `E${i}`, dir: o.dir, at: Date.UTC(2026, 9, 24) + k * 1000, fee: { state: 'entered', amount: '0' }, funding: { state: 'entered', amount: '0' }, ...f }));
    const t = pnlComputeTrade(fills);
    t.events.forEach((e, k) => { assert.equal(e.grossMicro, BigInt(o.grossMicroPerEvent[k]), `거래 ${i} 체결 ${k}`); events++; });
  });
  assert.ok(events > 3000); void ties;
});
test('정밀 반올림 회귀: 평균 원가가 나눠떨어지지 않는 부분 청산도 정확히 한 번만 반올림(예: 100×1 + 101×2 평균 100.6666…, 1.5개 청산)', () => {
  const base = { origin: 'real', sid: 'R', dir: 'LONG', fee: { state: 'entered', amount: '0' }, funding: { state: 'entered', amount: '0' } };
  const t = pnlComputeTrade([{ ...base, fillId: 'a', kind: 'entry', at: 1, price: '100', qty: '1' }, { ...base, fillId: 'b', kind: 'add', at: 2, price: '101', qty: '2' }, { ...base, fillId: 'c', kind: 'reduce', at: 3, price: '103', qty: '1.5' }]);
  assert.equal(t.events[2].grossMicro, 3500000n);                      // (103 − 302/3)×1.5 = 3.5 (정확)
  assert.equal(t.avgEntry, '100.6666666667');
});
