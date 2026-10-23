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
