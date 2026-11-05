import test from 'node:test';
import assert from 'node:assert/strict';
import { pnlComputeTrade, pnlComputeAll, pnlDailyFlows, pnlNormalizeFill } from '../lib/pnl.mjs';
import { riskTrade } from '../lib/risk.mjs';
import { dedupeAppend, dedupePossibleFills, dedupeRevise, dedupeVoid, dedupeLatest } from '../lib/dedupe.mjs';

const T0 = Date.UTC(2026, 9, 24, 3, 0, 0);
const F = (o = {}) => ({ origin: 'real', fillId: 'f1', sid: 'S1', kind: 'entry', dir: 'LONG', at: T0, price: '100', qty: '2', margin: '20', leverage: '10', fee: { state: 'entered', amount: '0.1' }, funding: { state: 'missing' }, ...o });
const M = n => BigInt(Math.round(n * 1e6));

test('LONG: 100에 2개 진입 → 110에 전량 청산 = +20, 수수료·펀딩 반영', () => {
  const t = pnlComputeTrade([F(), F({ fillId: 'f2', kind: 'close', at: T0 + 3600000, price: '110', fee: { state: 'entered', amount: '0.11' }, funding: { state: 'entered', amount: '-0.05' } })]);
  assert.equal(t.status, 'closed'); assert.equal(t.totals.grossMicro, M(20)); assert.equal(t.totals.feeEnteredMicro, M(0.21)); assert.equal(t.totals.fundingEnteredMicro, M(-0.05));
  assert.equal(t.totals.netEnteredMicro, M(20 - 0.21 - 0.05)); assert.equal(t.totals.fundingMissingCount, 1); assert.ok(t.flags.includes('funding-missing')); assert.equal(t.marginMicro, M(20));
  assert.equal(t.roePpm, (M(19.74) * 1000000n + M(20) / 2n) / M(20));                      // 순손익/증거금 ppm
});
test('SHORT: 100에 2개 공매도 → 90에 청산 = +20, 가격 상승 시 손실', () => {
  const win = pnlComputeTrade([F({ dir: 'SHORT' }), F({ fillId: 'f2', dir: 'SHORT', kind: 'close', price: '90', at: T0 + 1 })]); assert.equal(win.totals.grossMicro, M(20));
  const loss = pnlComputeTrade([F({ dir: 'SHORT' }), F({ fillId: 'f2', dir: 'SHORT', kind: 'close', price: '104', at: T0 + 1 })]); assert.equal(loss.totals.grossMicro, M(-8));
});
test('추가 진입·부분 청산: (100×1, 110×1) 평균 105, 120에 1개 청산 +15, 잔량 1개를 100에 청산 −5 → 합계 +10', () => {
  const t = pnlComputeTrade([F({ fillId: 'a', qty: '1' }), F({ fillId: 'b', kind: 'add', price: '110', qty: '1', at: T0 + 1 }), F({ fillId: 'c', kind: 'reduce', price: '120', qty: '1', at: T0 + 2 }), F({ fillId: 'd', kind: 'close', price: '100', qty: '1', at: T0 + 3 })]);
  assert.deepEqual(t.events.map(e => e.grossMicro), [0n, 0n, M(15), M(-5)]); assert.equal(t.totals.grossMicro, M(10)); assert.equal(t.status, 'closed');
  const open = pnlComputeTrade([F({ fillId: 'a', qty: '1' }), F({ fillId: 'b', kind: 'add', price: '110', qty: '1', at: T0 + 1 }), F({ fillId: 'c', kind: 'reduce', price: '120', qty: '1', at: T0 + 2 })]);
  assert.equal(open.status, 'open'); assert.equal(open.openQty, '1.000000000000'); assert.equal(open.avgEntry, '105.0000000000');
});
test('체결 순서는 시각 기준(입력 순서와 무관), cutoff 이전 체결만 사용', () => {
  const list = [F({ fillId: 'c', kind: 'close', price: '110', at: T0 + 5 }), F({ fillId: 'a' })];
  assert.equal(pnlComputeTrade(list).totals.grossMicro, M(20)); assert.equal(pnlComputeTrade(list, { cutoffMs: T0 + 1 }).status, 'open'); assert.equal(pnlComputeTrade(list, { cutoffMs: T0 }), null);
});
test('수수료·펀딩 3상태: entered/estimated/missing을 섞어 netEntered(실제만)와 netWithEstimates(추정 포함)를 구분', () => {
  const t = pnlComputeTrade([F({ fee: { state: 'estimated', amount: '0.2' } }), F({ fillId: 'f2', kind: 'close', price: '110', fee: { state: 'entered', amount: '0.3' }, funding: { state: 'estimated', amount: '-0.1' } })]);
  assert.equal(t.totals.netEnteredMicro, M(20 - 0.3)); assert.equal(t.totals.netWithEstimatesMicro, M(20 - 0.3 - 0.2 - 0.1)); assert.ok(t.flags.includes('fee-estimated') && t.flags.includes('funding-estimated') && t.flags.includes('funding-missing'));
  assert.throws(() => pnlComputeTrade([F({ fee: { state: 'entered' } })]), /금액 필요/); assert.throws(() => pnlComputeTrade([F({ fee: { state: 'entered', amount: '-1' } })]), /0 이상/); assert.throws(() => pnlComputeTrade([F({ fee: { state: 'bogus' } })]), /상태 오류/);
});
test('검증: 모의(origin≠real) 거부, 잔량 초과·close 불일치·방향 불일치·중복 fillId·첫 체결 종류 오류', () => {
  assert.throws(() => pnlNormalizeFill(F({ origin: 'paper' })), /실제 체결만/);
  assert.throws(() => pnlComputeTrade([F(), F({ fillId: 'x', kind: 'reduce', qty: '3', at: T0 + 1 })]), /보유 수량.*보다 큼/);
  assert.throws(() => pnlComputeTrade([F(), F({ fillId: 'x', kind: 'close', qty: '1', at: T0 + 1 })]), /잔량 전체/);
  assert.throws(() => pnlComputeTrade([F(), F({ fillId: 'x', dir: 'SHORT', kind: 'close', at: T0 + 1 })]), /방향/);
  assert.throws(() => pnlComputeTrade([F(), F({ fillId: 'f1', kind: 'add', at: T0 + 1 })]), /중복 fillId/);
  assert.throws(() => pnlComputeTrade([F({ kind: 'close' })]), /첫 체결/); assert.throws(() => pnlComputeTrade([F(), F({ fillId: 'x', at: T0 + 1 })]), /kind=add/);
  assert.throws(() => pnlNormalizeFill(F({ price: '0' })), /0보다/); assert.throws(() => pnlNormalizeFill(F({ qty: '-1' })), /0보다/);
});
test('소수점 정밀도: 초소형 가격 롱 — 0.00001234→0.00001300 × 1e9개 = +660 USDT, 반올림 동률', () => {
  const t = pnlComputeTrade([F({ price: '0.00001234', qty: '1000000000', margin: '1234' }), F({ fillId: 'c', kind: 'close', price: '0.000013', qty: '1000000000', at: T0 + 1 })]); assert.equal(t.totals.grossMicro, M(660));
  const tie = pnlComputeTrade([F({ price: '1', qty: '0.0000005' }), F({ fillId: 'c', kind: 'close', price: '2', qty: '0.0000005', at: T0 + 1 })]); assert.equal(tie.totals.grossMicro, 1n);   // 0.0000005 → 마이크로 반올림(0에서 먼 쪽)
});
test('일별 흐름: 체결 시각의 KST 날짜에 귀속(자정 직전/직후), 여러 sid 합산', () => {
  const mid = Date.UTC(2026, 9, 24, 15, 0, 0);                                                              // 2026-10-25 00:00 KST
  const trades = pnlComputeAll([F(), F({ fillId: 'c', kind: 'close', price: '110', at: mid - 1 }), F({ fillId: 'g', sid: 'S2', at: mid - 2 }), F({ fillId: 'h', sid: 'S2', kind: 'close', price: '90', at: mid })]);
  const d = pnlDailyFlows(trades); assert.equal(d.get('2026-10-24').grossMicro, M(20)); assert.equal(d.get('2026-10-25').grossMicro, M(-20)); assert.equal(d.get('2026-10-24').feeEnteredMicro, M(0.3));   // 10-24일 체결 3건(f1, c, g) × 0.1
});
test('위험 계산: 거래당 위험%·청산 근사·경고(손절이 청산보다 멀면 경고, 증거금·레버리지 불일치)', () => {
  const r = riskTrade({ dir: 'LONG', entry: '100', stop: '98', qty: '10', margin: '100', leverage: '10', equityMicro: M(300) });
  assert.equal(r.notionalMicro, M(1000)); assert.equal(r.stopLossMicro, M(20)); assert.equal(r.riskPpmOfEquity, 66667n); assert.ok(r.flags.includes('risk-over-2pct')); assert.equal(r.impliedLeverage, '10.0000'); assert.equal(r.liquidationApprox, '90.50000000'); assert.equal(r.liquidationBeforeStop, false);
  const far = riskTrade({ dir: 'LONG', entry: '100', stop: '85', qty: '1', margin: '5', leverage: '20' }); assert.ok(far.liquidationBeforeStop && far.flags.includes('liquidation-before-stop'));
  const sh = riskTrade({ dir: 'SHORT', entry: '100', stop: '103', qty: '1', margin: '10', leverage: '10' }); assert.equal(sh.liquidationApprox, '109.50000000'); assert.equal(sh.liquidationBeforeStop, false);
  assert.ok(riskTrade({ dir: 'LONG', entry: '100', stop: '98', qty: '1', margin: '50', leverage: '10' }).flags.includes('leverage-mismatch')); assert.ok(riskTrade({ dir: 'LONG', entry: '100', stop: '101', qty: '1', leverage: '5' }).flags.includes('stop-on-wrong-side'));
});
test('중복 기록 방지: 같은 id·같은 내용은 무시(재전송 안전), 다른 내용은 충돌, 비슷한 체결은 후보 표시(자동 삭제 없음)', () => {
  const a = F(); let r = dedupeAppend([], a, 'fillId'); assert.equal(r.status, 'added');
  const again = dedupeAppend(r.list, { ...a, fee: { amount: '0.1', state: 'entered' } }, 'fillId'); assert.equal(again.status, 'duplicate'); assert.equal(again.list.length, 1);   // 키 순서가 달라도 동일
  assert.equal(dedupeAppend(r.list, { ...a, price: '101' }, 'fillId').status, 'conflict'); assert.throws(() => dedupeAppend([], { x: 1 }, 'fillId'), /필요/);
  assert.deepEqual(dedupePossibleFills([a, { ...a, fillId: 'f1b', at: T0 + 30000 }, { ...a, fillId: 'f9', at: T0 + 600000 }]), [['f1', 'f1b']]);
});
test('수정 이력: 리비전 추가·이전 보존·취소(void)는 삭제가 아님', () => {
  let log = [{ key: 'review:S1', rev: 1, plan: '계획대로', mind: '침착' }]; log = dedupeRevise(log, 'review:S1', { mind: '불안·조급' }, { at: 1, reason: '정정' });
  assert.equal(log.length, 2); assert.equal(log[0].mind, '침착'); assert.equal(dedupeLatest(log).get('review:S1').mind, '불안·조급'); assert.equal(dedupeLatest(log).get('review:S1').rev, 2);
  log = dedupeVoid(log, 'review:S1'); assert.equal(dedupeLatest(log).get('review:S1').void, true); assert.equal(log.length, 3); assert.throws(() => dedupeRevise(log, 'review:S1', {}), /취소된/); assert.throws(() => dedupeRevise(log, 'nope', {}), /대상 없음/);
});
