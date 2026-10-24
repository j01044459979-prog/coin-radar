import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memEnv } from './helpers/memenv.mjs';
import { storeInit, storeCreate, storeSetupChallenge, storeGet, storeList, storeIntegrityCheck, storeBuildLedger } from '../lib/store.mjs';
import { StoreError } from '../lib/schema.mjs';
import { journalBuild, journalHistory, journalDiff, journalReviseFill, journalVoidFill, journalAddCashflow, journalVoidCashflow, JOURNAL_FILL_EDITABLE } from '../lib/journal.mjs';
import { closeRun } from '../lib/close.mjs';
import { dayStartMs } from '../lib/time.mjs';

const D1 = '2026-10-24', D2 = '2026-10-25', H = 3600000, A = { actor: 't' };
function setup() {
  const m = memEnv(); storeInit(m.env); storeSetupChallenge(m.env, { startEquity: '300', startDay: D1, rate: '0.05' }, A);
  const clock = { t: dayStartMs(D2) + 2 * H }, env = { now: () => clock.t, storeEnv: () => m.env, sendEnabled: () => false };
  storeCreate(m.env, 'signal', { sid: 'A-1', strategy: 'A', symbolId: 'BTCUSDT', dir: 'LONG', signalAt: dayStartMs(D1) + 9 * H, entry: '100', stop: '98', tp1: '103' }, A);
  storeCreate(m.env, 'response', { sid: 'A-1', choice: 'entered', at: dayStartMs(D1) + 9 * H }, A);
  const at = dayStartMs(D1) + 10 * H;
  for (const f of [{ fillId: 'in', kind: 'entry', at, price: '100', qty: '3', plannedStop: '98', margin: '30', leverage: '10' }, { fillId: 'add', kind: 'add', at: at + H, price: '101', qty: '1' }, { fillId: 'out', kind: 'close', at: at + 2 * H, price: '103', qty: '4' }])
    storeCreate(m.env, 'fill', { origin: 'real', sid: 'A-1', dir: 'LONG', fee: { state: 'entered', amount: '0.1' }, funding: { state: 'missing' }, ...f }, A);
  storeCreate(m.env, 'review', { sid: 'A-1', plan: 'plan_ok', mind: 'calm', savedAt: at + 5 * H }, A);
  return { m, env, clock };
}
const fills = x => storeList(x.m.env, 'fill').map(r => r.data);

test('일지 조회: 거래·체결 타임라인·응답·복기·마감 상태·통계·경고가 한 모델에 나온다', () => {
  const x = setup(); closeRun(x.env); const j = journalBuild(x.env);
  assert.equal(j.empty, false); assert.deepEqual([j.tradesTotal, j.tradesOpen, j.voidedCount, j.startDay], [1, 0, 0, D1]); const t = j.trades[0];
  assert.deepEqual([t.sid, t.dir, t.strategy, t.symbol, t.status, t.win, t.response.label, t.review.plan, t.review.mind], ['A-1', 'LONG', 'A', 'BTC', 'closed', true, '진입했어', '계획대로 진입·청산', '침착']);
  assert.deepEqual(t.fills.map(f => [f.kindLabel, f.price, f.qty, f.fee, f.funding]), [['진입', '100', '3', '0.1', '미입력'], ['추가진입', '101', '1', '0.1', '미입력'], ['전량청산', '103', '4', '0.1', '미입력']]);
  assert.equal(t.netLabel, '+10.70'); assert.ok(t.flags.includes('funding-missing'));            // 평균 100.25, 청산 103×4 → 총 +11.00, 수수료 0.3 → 순 +10.70
  assert.deepEqual(j.closes.map(c => [c.day, c.closed, c.source]), [[D2, false, null], [D1, true, 'ledger']]); assert.equal(j.analytics.overall.n, 1); assert.ok(j.warnings.some(w => w.type === 'funding-missing')); assert.ok(j.warnings.some(w => w.type === 'close-from-ledger'));
  const empty = memEnv(); storeInit(empty.env); assert.deepEqual(journalBuild({ now: () => 1, storeEnv: () => empty.env }), { empty: true, reason: 'no-challenge', generatedAt: 1 });
});
test('수정 이력: 체결 수정은 리비전·사유·변경 전후(diff)로 남고, 이전 값은 사라지지 않는다', () => {
  const x = setup(); x.clock.t += H;
  const r = journalReviseFill(x.env, 'out', { price: '104', fee: { state: 'entered', amount: '0.25' } }, { reason: '체결 내역 재확인' }); assert.deepEqual([r.status, r.rev], ['revised', 2]);
  const t = journalBuild(x.env).trades[0], out = t.fills.find(f => f.fillId === 'out'); assert.deepEqual([out.price, out.fee, out.rev], ['104', '0.25', 2]);
  assert.equal(out.edits.length, 1); assert.deepEqual([out.edits[0].rev, out.edits[0].op, out.edits[0].reason, out.edits[0].actor], [2, 'revise', '체결 내역 재확인', 'ui']);
  assert.deepEqual(out.edits[0].changes, [{ field: 'fee', from: '0.1', to: '0.25' }, { field: 'price', from: '103', to: '104' }]);
  assert.equal(journalHistory(x.env, 'fill', 'out').length, 2); assert.equal(journalHistory(x.env, 'fill', 'out')[0].op, 'create'); assert.equal(storeGet(x.m.env, 'fill', 'out').rev, 2);
  const again = journalReviseFill(x.env, 'out', { price: '104' }, { reason: '동일' }); assert.equal(again.status, 'unchanged');
  assert.equal(storeIntegrityCheck(x.m.env).ok, true);
  const t2 = journalBuild(x.env).trades[0]; assert.equal(t2.netMicro, String(BigInt(t.netMicro)));                         // 이력 표시는 손익을 바꾸지 않는다(같은 모델)
});
test('수정 검증: 사유 필수·허용 항목만·계산이 깨지는 수정은 저장하지 않음(청산량 초과·미지의 체결·시각 미래·값 형식)', () => {
  const x = setup(); const before = JSON.stringify(fills(x)); const code = fn => { try { fn(); return null; } catch (e) { return e instanceof StoreError ? `${e.code}:${e.message}` : `OTHER:${e.message}`; } };
  assert.match(code(() => journalReviseFill(x.env, 'out', { price: '104' }, { reason: '' })), /^VALIDATION:수정 사유/); assert.match(code(() => journalReviseFill(x.env, 'out', { price: '104' }, {})), /^VALIDATION/);
  assert.match(code(() => journalReviseFill(x.env, 'out', { sid: 'OTHER' }, { reason: 'x' })), /수정할 수 없는 항목: sid/); assert.match(code(() => journalReviseFill(x.env, 'out', { kind: 'reduce' }, { reason: 'x' })), /수정할 수 없는 항목: kind/); assert.match(code(() => journalReviseFill(x.env, 'out', { fillId: 'z' }, { reason: 'x' })), /수정할 수 없는 항목/);
  assert.match(code(() => journalReviseFill(x.env, 'out', {}, { reason: 'x' })), /수정할 값이 없습니다/); assert.match(code(() => journalReviseFill(x.env, 'nope', { price: '1' }, { reason: 'x' })), /^NOT_FOUND/);
  assert.match(code(() => journalReviseFill(x.env, 'out', { qty: '9' }, { reason: '수량 오입력' })), /계산이 맞지 않아/);                  // 보유 4보다 많이 청산
  assert.match(code(() => journalReviseFill(x.env, 'in', { qty: '1' }, { reason: '수량 수정' })), /계산이 맞지 않아/);                     // 진입을 줄이면 청산이 잔량 초과
  assert.match(code(() => journalReviseFill(x.env, 'out', { price: 'abc' }, { reason: 'x' })), /^VALIDATION/); assert.match(code(() => journalReviseFill(x.env, 'out', { at: x.clock.t + 3600000 }, { reason: 'x' })), /체결 시각/);
  assert.match(code(() => journalReviseFill(x.env, 'out', { fee: { state: 'entered' } }, { reason: 'x' })), /^VALIDATION/);
  assert.equal(JSON.stringify(fills(x)), before); assert.deepEqual(JOURNAL_FILL_EDITABLE, ['price', 'qty', 'at', 'margin', 'leverage', 'plannedStop', 'fee', 'funding', 'note']);
  assert.equal(journalReviseFill(x.env, 'in', { note: '메모' }, { reason: '메모 추가' }).status, 'revised'); assert.equal(journalReviseFill(x.env, 'in', { note: null }, { reason: '메모 삭제' }).status, 'revised'); assert.equal(fills(x).find(f => f.fillId === 'in').note, undefined);
});
test('체결 취소: 사유 필수, 계산이 유지될 때만(청산 취소 후 추가진입 취소 OK, 진입·잔량이 어긋나면 거절), 취소된 체결은 손익에서 빠지고 일지에 취소 표시와 이력이 남는다', () => {
  const x = setup(); const gross = () => storeBuildLedger(x.m.env, { throughDay: D1 }).rows[0].realizedGrossMicro; assert.equal(gross(), 11000000n);
  assert.throws(() => journalVoidFill(x.env, 'add', { reason: '' }), /수정 사유/); assert.throws(() => journalVoidFill(x.env, 'in', { reason: '진입 취소' }), /계산이 맞지 않아/);
  assert.throws(() => journalVoidFill(x.env, 'add', { reason: '추가진입 취소' }), /계산이 맞지 않아/);                  // 청산 4가 잔량 3보다 큼 → 먼저 청산을 취소해야 함
  assert.throws(() => journalReviseFill(x.env, 'out', { qty: '3' }, { reason: '청산 수량 정정' }), /계산이 맞지 않아/);       // close는 잔량 전체여야 함
  assert.equal(journalVoidFill(x.env, 'out', { reason: '청산 잘못 입력' }).status, 'voided'); assert.equal(journalBuild(x.env).trades[0].status, 'open'); assert.equal(gross(), 0n);
  assert.equal(journalVoidFill(x.env, 'add', { reason: '잘못 입력한 추가진입' }).status, 'voided');
  storeCreate(x.m.env, 'fill', { origin: 'real', fillId: 'out2', sid: 'A-1', kind: 'close', dir: 'LONG', at: dayStartMs(D1) + 13 * H, price: '103', qty: '3', fee: { state: 'entered', amount: '0.1' }, funding: { state: 'missing' } }, A);
  const j = journalBuild(x.env), t = j.trades[0]; assert.equal(j.voidedCount, 2); assert.deepEqual(t.fills.map(f => f.fillId), ['in', 'out2']); assert.deepEqual(t.voidedFills.map(f => [f.fillId, f.kindLabel, f.edits.at(-1).op, f.edits.at(-1).reason]), [['add', '추가진입', 'void', '잘못 입력한 추가진입'], ['out', '전량청산', 'void', '청산 잘못 입력']]);
  assert.equal(gross(), 9000000n);                                                                                                     // (103-100)×3
  assert.equal(journalVoidFill(x.env, 'add', { reason: '다시' }).status, 'unchanged'); assert.equal(storeIntegrityCheck(x.m.env).ok, true);
});
test('입출금 기록: cfId로 중복 제출 1건, 금액 검증, 취소 이력, 장부 불일치 해소', () => {
  const x = setup(); const r = journalAddCashflow(x.env, { cfId: 'form1abc', amount: '100', note: '입금' }); assert.deepEqual([r.status, r.key], ['added', 'cf-form1abc']);
  assert.equal(journalAddCashflow(x.env, { cfId: 'form1abc', amount: '100', note: '입금', at: storeGet(x.m.env, 'cashflow', 'cf-form1abc').data.at }).status, 'duplicate'); assert.equal(storeList(x.m.env, 'cashflow').length, 1);
  for (const bad of [{ cfId: 'abc', amount: '1' }, { cfId: 'form2abc', amount: '0' }, { cfId: 'form2abc', amount: 'x' }, { cfId: 'form2abc', amount: '5', at: x.clock.t + 3600000 }]) assert.throws(() => journalAddCashflow(x.env, bad), e => e instanceof StoreError && e.code === 'VALIDATION');
  const j = journalBuild(x.env); assert.deepEqual(j.cashflows.map(c => [c.cfId, c.amount, c.note]), [['cf-form1abc', '100', '입금']]);
  assert.throws(() => journalVoidCashflow(x.env, 'cf-form1abc', { reason: '' }), /수정 사유/); assert.equal(journalVoidCashflow(x.env, 'cf-form1abc', { reason: '잘못 입력' }).status, 'voided'); assert.equal(journalBuild(x.env).cashflows.length, 0);
});
test('경고: 입출금 누락 의심·장부 불일치·수수료 미입력이 일지 경고에 나오고 자동 보정은 없다', () => {
  const x = setup(); storeCreate(x.m.env, 'equity', { day: D2, equity: '500' }, A);   // D2: 거래·입출금 없음인데 평가액이 장부와 크게 다름
  x.clock.t = dayStartMs(D2) + 20 * H; const j = journalBuild(x.env), types = j.warnings.map(w => w.type);
  assert.ok(types.includes('ledger-mismatch') && types.includes('possible-missing-cashflow') && types.includes('funding-missing')); assert.match(j.warnings.find(w => w.type === 'possible-missing-cashflow').text, /2026-10-25.*자동 보정하지 않음/);
  assert.equal(storeList(x.m.env, 'adjustment').length, 0); assert.equal(storeList(x.m.env, 'cashflow').length, 0);
});
test('diff 도우미와 소스 점검: 객체·시각 표시, 로그·네트워크 없음, 설정 300/5% 보존', () => {
  assert.deepEqual(journalDiff({ a: 1, fee: { state: 'missing' } }, { a: 1, fee: { state: 'estimated', amount: '0.2' }, at: 1790000000000 }), [{ field: 'at', from: '—', to: '2026-09-21 23:13' }, { field: 'fee', from: '미입력', to: '추정 0.2' }]);
  const src = readFileSync(new URL('../lib/journal.mjs', import.meta.url), 'utf8'); assert.ok(!/console\.|Logger\.log|UrlFetchApp|fetch\(/.test(src));
  const x = setup(); assert.equal(storeGet(x.m.env, 'challenge', 'challenge').data.startEquity, '300'); assert.equal(storeList(x.m.env, 'rate')[0].data.rate, '0.05');
  assert.equal(storeCreate(x.m.env, 'challenge', { startEquity: '500', startDay: D1 }, A).status, 'conflict');           // 시작 자금은 바꿀 수 없다
});
