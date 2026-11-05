import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memEnv } from './helpers/memenv.mjs';
import { storeInit, storeCreate, storeRevise, storeVoid, storeGet, storeList, storeHistory, storeClaimUpdate, storeSaveReview, storeSetupChallenge, storeGetSettings, storeIntegrityCheck, storeRepair, storeReadAudit, storeWithLock, storeBuildLedger, storeLoadLedgerInputs } from '../lib/store.mjs';
import { StoreError, PLAN_CHOICES } from '../lib/schema.mjs';
import { ledgerBuildDaily } from '../lib/ledger.mjs';
import { dayStartMs } from '../lib/time.mjs';

const A = { actor: 'test' };
const fill = (o = {}) => ({ origin: 'real', fillId: 'f1', sid: 'S1', kind: 'entry', dir: 'LONG', at: dayStartMs('2026-10-24') + 3600000, price: '100', qty: '2', margin: '20', leverage: '10', fee: { state: 'entered', amount: '0.1' }, funding: { state: 'missing' }, ...o });
const fresh = o => { const m = memEnv(o); storeInit(m.env); return m; };
const freshFixed = o => fresh({ fixedClock: true, ...o });
const code = async fn => { try { await fn(); return null; } catch (e) { return e instanceof StoreError ? e.code : `OTHER:${e.message}`; } };

test('초기화: 시트·헤더 생성, 재호출 안전, 스키마 버전 기록·불일치 거부', () => {
  const m = fresh(); storeInit(m.env); storeInit(m.env);
  assert.ok(m.sheets.has('Audit') && m.sheets.has('Fills') && m.sheets.has('Meta')); assert.equal(m.sheets.get('Meta').length, 1); assert.deepEqual(m.headers.get('Audit').slice(0, 3), ['seq', 'recordedAt', 'entity']);
  m.sheets.get('Meta')[0][1] = '99'; assert.throws(() => storeInit(m.env), e => e.code === 'SCHEMA');
});
test('생성: added → 같은 내용 duplicate → 다른 내용 conflict, 값 표기가 달라도(100·"100.0") 같은 기록으로 판정', () => {
  const m = fresh(); let r = storeCreate(m.env, 'fill', fill(), A); assert.deepEqual([r.status, r.rev], ['added', 1]);
  assert.equal(storeCreate(m.env, 'fill', fill({ price: 100, qty: '2.0' }), A).status, 'duplicate');
  assert.equal(storeCreate(m.env, 'fill', fill({ price: '101' }), A).status, 'conflict');
  assert.equal(storeReadAudit(m.env).length, 1); assert.equal(m.sheets.get('Fills').length, 1);                // 중복·충돌은 아무것도 쓰지 않는다
  assert.equal(storeGet(m.env, 'fill', 'f1').data.price, '100'); assert.equal(storeGet(m.env, 'fill', 'f1').data.qty, '2');
});
test('검증: 모의 체결·잘못된 값 거부, 저장소에 아무것도 남지 않음', () => {
  const m = fresh(), before = storeReadAudit(m.env).length;
  for (const bad of [fill({ origin: 'paper' }), fill({ price: '0' }), fill({ qty: 'x' }), fill({ kind: 'bogus' }), fill({ fee: { state: 'entered' } }), fill({ at: 1.5 }), fill({ fillId: '' })]) assert.throws(() => storeCreate(m.env, 'fill', bad, A), e => e.code === 'VALIDATION');
  assert.throws(() => storeCreate(m.env, 'cashflow', { cfId: 'c', at: 1, amount: '0' }, A), e => e.code === 'VALIDATION'); assert.throws(() => storeCreate(m.env, 'adjustment', { adjId: 'a', at: 1, amount: '1', reason: '' }, A), e => e.code === 'VALIDATION');
  assert.throws(() => storeCreate(m.env, 'equity', { day: '2026-13-01', equity: '1' }, A), e => e.code === 'VALIDATION'); assert.throws(() => storeCreate(m.env, 'nope', {}, A), e => e.code === 'VALIDATION');
  assert.equal(storeReadAudit(m.env).length, before);
});
test('수정 이력: 리비전 추가·이전 값 보존·같은 값은 unchanged·null은 항목 삭제·사유 필수·키 변경 불가', () => {
  const m = fresh(); storeCreate(m.env, 'fill', fill(), A);
  assert.equal(storeRevise(m.env, 'fill', 'f1', { price: '101' }, { actor: 'web', reason: '체결가 정정' }).rev, 2);
  assert.equal(storeRevise(m.env, 'fill', 'f1', { price: '101' }, { actor: 'web', reason: '재전송' }).status, 'unchanged');
  storeRevise(m.env, 'fill', 'f1', { margin: null }, { actor: 'web', reason: '증거금 제거' });
  const h = storeHistory(m.env, 'fill', 'f1'); assert.deepEqual(h.map(x => x.rev), [1, 2, 3]); assert.equal(h[0].data.price, '100'); assert.equal(h[1].data.price, '101'); assert.equal(h[2].data.margin, undefined);
  assert.equal(storeGet(m.env, 'fill', 'f1').rev, 3);
  const au = storeReadAudit(m.env); assert.deepEqual(au.map(a => a.op), ['create', 'revise', 'revise']); assert.equal(JSON.parse(au[1].before).price, '100'); assert.equal(JSON.parse(au[1].after).price, '101'); assert.equal(au[1].reason, '체결가 정정');
  assert.throws(() => storeRevise(m.env, 'fill', 'f1', { price: '102' }, { actor: 'web' }), e => e.code === 'VALIDATION');
  assert.throws(() => storeRevise(m.env, 'fill', 'f1', { fillId: 'zz' }, { actor: 'web', reason: 'x' }), e => e.code === 'VALIDATION');
  assert.throws(() => storeRevise(m.env, 'fill', 'none', { price: '1' }, { actor: 'web', reason: 'x' }), e => e.code === 'NOT_FOUND');
});
test('취소(void)는 삭제가 아님: 이력 보존, 목록에서 제외, 재생성은 rev+1, 취소된 기록 수정 불가', () => {
  const m = fresh(); storeCreate(m.env, 'cashflow', { cfId: 'c1', at: 5, amount: '10' }, A);
  assert.equal(storeVoid(m.env, 'cashflow', 'c1', { actor: 'web', reason: '입력 실수' }).status, 'voided'); assert.equal(storeVoid(m.env, 'cashflow', 'c1', { actor: 'web', reason: '재시도' }).status, 'unchanged');
  assert.equal(storeList(m.env, 'cashflow').length, 0); assert.equal(storeList(m.env, 'cashflow', { includeVoid: true }).length, 1); assert.equal(storeHistory(m.env, 'cashflow', 'c1').length, 2);
  assert.throws(() => storeRevise(m.env, 'cashflow', 'c1', { amount: '5' }, { actor: 'web', reason: 'x' }), e => e.code === 'VOID');
  const re = storeCreate(m.env, 'cashflow', { cfId: 'c1', at: 5, amount: '12' }, A); assert.deepEqual([re.status, re.rev], ['added', 3]); assert.equal(storeList(m.env, 'cashflow')[0].data.amount, '12');
});
test('시작 설정·신호·수신 기록은 보존: 수정·취소 불가, 다른 값 재설정은 conflict', () => {
  const m = fresh(); assert.equal(storeSetupChallenge(m.env, { startEquity: '300', startDay: '2026-10-24', rate: '0.05' }, A).status, 'added');
  assert.equal(storeSetupChallenge(m.env, { startEquity: '300.0', startDay: '2026-10-24', rate: '0.05' }, A).status, 'duplicate');
  assert.equal(storeSetupChallenge(m.env, { startEquity: '500', startDay: '2026-10-24', rate: '0.05' }, A).status, 'conflict'); assert.equal(storeGet(m.env, 'challenge', 'challenge').data.startEquity, '300');
  assert.throws(() => storeRevise(m.env, 'challenge', 'challenge', { startEquity: '1' }, { actor: 'x', reason: 'y' }), e => e.code === 'IMMUTABLE'); assert.throws(() => storeVoid(m.env, 'challenge', 'challenge', { actor: 'x', reason: 'y' }), e => e.code === 'IMMUTABLE');
  const sig = { sid: 'A-BTC-1', strategy: 'A', symbolId: 'BTCUSDT', dir: 'LONG', signalAt: 1790000000000, entry: '100', stop: '98', tp1: '103', tp2: '104' };
  assert.equal(storeCreate(m.env, 'signal', sig, A).status, 'added'); assert.equal(storeCreate(m.env, 'signal', { ...sig, entry: '101' }, A).status, 'conflict'); assert.throws(() => storeRevise(m.env, 'signal', 'A-BTC-1', { entry: '1' }, { actor: 'x', reason: 'y' }), e => e.code === 'IMMUTABLE');
  assert.throws(() => storeCreate(m.env, 'signal', { ...sig, sid: 'x', strategy: 'C' }, A), e => e.code === 'VALIDATION');
  const rate = storeCreate(m.env, 'rate', { from: '2026-11-01', rate: '0.03' }, A); assert.equal(rate.status, 'added'); assert.equal(storeRevise(m.env, 'rate', 'rate:2026-11-01', { rate: '0.02' }, { actor: 'web', reason: '목표율 하향' }).rev, 2);
  assert.throws(() => storeCreate(m.env, 'rate', { from: '2026-11-02', rate: '1.5' }, A), e => e.code === 'VALIDATION');
});
test('설정 기본값: 백업 8개·Telegram CSV off·마감 알림 off, 변경은 검증', () => {
  const m = fresh(); assert.deepEqual(storeGetSettings(m.env), { backupKeep: '8', backupTelegramCsv: 'off', closeNotify: 'off' });
  storeCreate(m.env, 'setting', { name: 'closeNotify', value: 'on' }, A); assert.equal(storeGetSettings(m.env).closeNotify, 'on'); assert.equal(storeGetSettings(m.env).backupKeep, '8');
  for (const b of [{ name: 'backupKeep', value: '0' }, { name: 'backupKeep', value: '31' }, { name: 'backupTelegramCsv', value: 'yes' }, { name: 'unknown', value: 'on' }]) assert.throws(() => storeCreate(m.env, 'setting', b, A), e => e.code === 'VALIDATION');
});
test('복기: 계획·심리를 명시하지 않으면 저장되지 않음(기본값 자동 저장 없음), 같은 내용은 unchanged, 수정은 리비전', () => {
  const m = fresh(), n = () => storeReadAudit(m.env).length;
  assert.throws(() => storeSaveReview(m.env, { sid: 'S1' }, A), e => e.code === 'VALIDATION'); assert.throws(() => storeSaveReview(m.env, { sid: 'S1', plan: 'plan_ok' }, A), e => e.code === 'VALIDATION'); assert.throws(() => storeSaveReview(m.env, { sid: 'S1', plan: 'plan_ok', mind: '침착' }, A), e => e.code === 'VALIDATION');
  assert.equal(n(), 0); assert.equal(storeGet(m.env, 'review', 'S1'), null);
  assert.equal(storeSaveReview(m.env, { sid: 'S1', plan: 'plan_ok', mind: 'calm', memo: '규칙대로' }, A).status, 'added'); assert.equal(storeSaveReview(m.env, { sid: 'S1', plan: 'plan_ok', mind: 'calm', memo: '규칙대로' }, A).status, 'unchanged');
  const r = storeSaveReview(m.env, { sid: 'S1', plan: 'early_exit', mind: 'anxious_rushed' }, A); assert.deepEqual([r.status, r.rev], ['revised', 2]);
  const h = storeHistory(m.env, 'review', 'S1'); assert.equal(h[0].data.plan, 'plan_ok'); assert.equal(h[1].data.memo, undefined); assert.equal(h[1].data.mind, 'anxious_rushed');
  assert.throws(() => storeSaveReview(m.env, { sid: 'S2', plan: 'plan_ok', mind: 'calm', memo: 'x'.repeat(501) }, A), e => e.code === 'VALIDATION'); assert.equal(PLAN_CHOICES.plan_ok, '계획대로 진입·청산');
});
test('텔레그램 중복 방지: update_id·callback_id는 처음 한 번만 true(종류가 다르면 별개)', () => {
  const m = fresh(); assert.equal(storeClaimUpdate(m.env, 'u', 1001, 'tg'), true); assert.equal(storeClaimUpdate(m.env, 'u', 1001, 'tg'), false); assert.equal(storeClaimUpdate(m.env, 'cb', 1001, 'tg'), true); assert.equal(storeClaimUpdate(m.env, 'cb', '1001', 'tg'), false);
  assert.equal(storeReadAudit(m.env).length, 2);
});
test('잠금: 락을 못 얻으면 LOCK 오류로 아무것도 쓰지 않고, 같은 요청 안의 묶음 쓰기는 락 한 번으로 처리(중첩 허용), 예외가 나도 락은 해제', () => {
  const m = fresh({ lockBusy: true }); assert.equal(code(() => storeCreate(m.env, 'fill', fill(), A)) instanceof Promise, true);
  assert.throws(() => storeCreate(m.env, 'fill', fill(), A), e => e.code === 'LOCK'); assert.equal(storeReadAudit(m.env).length, 0);
  m.setLockBusy(false);
  assert.equal(storeWithLock(m.env, () => storeCreate(m.env, 'fill', fill(), A)).status, 'added');          // 묶음 안의 쓰기는 같은 락을 쓴다(락 한 번·flush 한 번)
  assert.equal(m.env.__lockDepth, 0); assert.equal(m.env.lock.tryLock(1), true); m.env.lock.release();       // 끝나면 락이 풀려 있다
  assert.throws(() => storeWithLock(m.env, () => { throw new Error('boom'); }), /boom/); assert.equal(storeCreate(m.env, 'fill', { ...fill(), fillId: 'f-2' }, A).status, 'added');   // 예외 후에도 락 해제됨
});
test('장애 복구 — 쓰기 지점마다 고장 주입: 어디서 끊겨도 재시도하면 최종 상태가 정상 실행과 동일(중복·누락 없음), 무결성 통과', () => {
  const day = '2026-10-24', t0 = dayStartMs(day);
  const ops = [
    e => storeSetupChallenge(e, { startEquity: '300', startDay: day, rate: '0.05' }, A),
    e => storeCreate(e, 'signal', { sid: 'A-1', strategy: 'A', symbolId: 'ETHUSDT', dir: 'LONG', signalAt: t0, entry: '100', stop: '98', tp1: '103' }, A),
    e => storeCreate(e, 'response', { sid: 'A-1', choice: 'entered', at: t0 + 1 }, A),
    e => storeCreate(e, 'fill', fill({ fillId: 'f1', sid: 'A-1' }), A),
    e => storeRevise(e, 'fill', 'f1', { price: '101' }, { actor: 'web', reason: '정정' }),
    e => storeCreate(e, 'fill', fill({ fillId: 'f2', sid: 'A-1', kind: 'close', at: t0 + 7200000, price: '110', qty: '2' }), A),
    e => storeCreate(e, 'cashflow', { cfId: 'c1', at: t0 + 100, amount: '50' }, A),
    e => storeVoid(e, 'cashflow', 'c1', { actor: 'web', reason: '취소' }),
    e => storeCreate(e, 'equity', { day, equity: '320' }, A),
    e => storeSaveReview(e, { sid: 'A-1', plan: 'plan_ok', mind: 'calm' }, A),
    e => storeClaimUpdate(e, 'u', 77, 'tg'),
  ];
  const snapshot = e => JSON.stringify({ au: storeReadAudit(e).map(a => [a.seq, a.entity, a.key, a.rev, a.op, a.after]), views: ['fill', 'cashflow', 'equity', 'review', 'response', 'signal', 'challenge', 'rate', 'tgupdate'].map(n => storeList(e, n, { includeVoid: true }).map(r => [r.key, r.rev, r.void, r.raw])) });
  const base = freshFixed(), a0 = base.appends; ops.forEach(op => op(base.env)); const baseSnap = snapshot(base.env), total = base.appends - a0;    // 초기화 이후의 쓰기 횟수
  assert.equal(storeIntegrityCheck(base.env).ok, true); assert.ok(total >= 20, `쓰기 ${total}회`);
  let crashes = 0;
  for (let f = 1; f <= total; f++) {
    const m = freshFixed(), start = m.appends; m.setFail(start + f);
    for (const op of ops) { for (let tries = 0; ; tries++) { try { op(m.env); break; } catch (e) { if (!/쓰기 실패 주입/.test(e.message)) throw e; crashes++; m.setFail(null); m.reset(); assert.ok(tries < 3); } } }
    assert.equal(snapshot(m.env), baseSnap, `고장 지점 #${f}`); const ic = storeIntegrityCheck(m.env); assert.equal(ic.ok, true, `고장 지점 #${f}: ${JSON.stringify(ic.issues)}`);
  }
  assert.equal(crashes, total);
});
test('고장 직후(복구 전)에도 읽기는 최신 상태를 보여 준다: 선기록 감사 로그의 끝부분을 합쳐 읽기', () => {
  const m = fresh(); storeCreate(m.env, 'cashflow', { cfId: 'c1', at: 1, amount: '5' }, A);
  m.setFail(m.appends + 2);                                                                                                  // 감사 로그는 쓰이고 엔티티 행에서 실패
  assert.throws(() => storeCreate(m.env, 'cashflow', { cfId: 'c2', at: 2, amount: '7' }, A), /쓰기 실패 주입/); m.reset(); m.setFail(null);
  assert.equal(storeReadAudit(m.env).length, 2); assert.equal(m.sheets.get('Cashflows').length, 1);                          // 엔티티 시트에는 아직 없음
  assert.deepEqual(storeList(m.env, 'cashflow').map(r => [r.key, r.data.amount, !!r.pending]), [['c1', '5', false], ['c2', '7', true]]);
  assert.equal(storeIntegrityCheck(m.env).repairable, 1); const rep = storeRepair(m.env); assert.deepEqual(rep.appended, ['cashflow|c2|1']); assert.equal(rep.after.ok, true);
  assert.equal(storeRepair(m.env).appended.length, 0);
});
test('무결성 검사: 감사 해시 체인 변조·엔티티 행 변조·고아 행·중복 행·시퀀스/리비전 누락을 탐지(자동 수정하지 않음)', () => {
  const build = () => { const m = fresh(); storeCreate(m.env, 'fill', fill(), A); storeRevise(m.env, 'fill', 'f1', { price: '101' }, { actor: 'w', reason: 'r' }); storeCreate(m.env, 'cashflow', { cfId: 'c1', at: 1, amount: '5' }, A); return m; };
  let m = build(); assert.equal(storeIntegrityCheck(m.env).ok, true);
  m = build(); m.sheets.get('Audit')[1][9] = m.sheets.get('Audit')[1][9].replace('101', '999'); let types = storeIntegrityCheck(m.env).issues.map(i => i.type); assert.ok(types.includes('audit-hash-mismatch') && types.includes('tampered-view'), types.join());
  m = build(); m.sheets.get('Fills')[0][4] = m.sheets.get('Fills')[0][4].replace('"100"', '"1"'); assert.ok(storeIntegrityCheck(m.env).issues.some(i => i.type === 'tampered-view' && i.entity === 'fill'));
  m = build(); m.sheets.get('Cashflows').push(['zzz', '1', '0', '1', '{"a":1}', '', '']); assert.ok(storeIntegrityCheck(m.env).issues.some(i => i.type === 'orphan-view'));
  m = build(); m.sheets.get('Fills').push([...m.sheets.get('Fills')[0]]); assert.ok(storeIntegrityCheck(m.env).issues.some(i => i.type === 'duplicate-view-row'));
  m = build(); m.sheets.get('Audit').splice(1, 1); types = storeIntegrityCheck(m.env).issues.map(i => i.type); assert.ok(types.includes('audit-seq-gap') && types.includes('audit-chain-broken') && types.includes('orphan-view'), types.join());   // 수정 이력 행을 잃음
  m = build(); m.sheets.get('Audit').splice(0, 1); types = storeIntegrityCheck(m.env).issues.map(i => i.type); assert.ok(types.includes('rev-gap') && types.includes('audit-seq-gap'), types.join());      // 첫 리비전을 잃음
  m = build(); const snap = JSON.stringify([...m.sheets]); m.sheets.get('Fills')[0][4] = '{"x":1}'; const r = storeRepair(m.env); assert.equal(r.after.ok, false); assert.ok(r.appended.length === 0); assert.ok(snap !== JSON.stringify([...m.sheets]));   // 변조 행은 고치지 않고 보고만
});
test('감사 로그만 남아도 복원: 엔티티 시트가 비어 있어도 Audit에서 전부 재구성되고 장부 계산 결과가 같다', () => {
  const a = fresh(), day = '2026-10-24', t0 = dayStartMs(day);
  storeSetupChallenge(a.env, { startEquity: '300', startDay: day, rate: '0.05' }, A); storeCreate(a.env, 'fill', fill({ price: '100', qty: '1', margin: '10' }), A); storeCreate(a.env, 'fill', fill({ fillId: 'f2', kind: 'close', at: t0 + 7200000, price: '103', qty: '1', fee: { state: 'entered', amount: '0.2' } }), A);
  storeCreate(a.env, 'cashflow', { cfId: 'c1', at: t0 + 50, amount: '20' }, A); storeCreate(a.env, 'equity', { day, equity: '322.7' }, A);
  const ledgerA = storeBuildLedger(a.env, { throughDay: '2026-10-25' }), ser = r => JSON.stringify(r.rows, (k, v) => (typeof v === 'bigint' ? `${v}n` : v));
  const b = fresh(); b.sheets.get('Audit').push(...a.sheets.get('Audit').map(r => [...r]));                                  // 감사 로그만 복사한 새 시트
  assert.equal(storeIntegrityCheck(b.env).ok, false); const rep = storeRepair(b.env); assert.equal(rep.after.ok, true); assert.equal(rep.appended.length, 6);     // challenge·rate·fill 2·cashflow·equity
  assert.equal(ser(storeBuildLedger(b.env, { throughDay: '2026-10-25' })), ser(ledgerA));
});
test('R2 연결: 저장소에서 읽은 입력으로 계산한 장부가 직접 계산과 동일, 입출금 취소는 즉시 반영', () => {
  const m = fresh(), day = '2026-10-24', t0 = dayStartMs(day); storeSetupChallenge(m.env, { startEquity: '300', startDay: day, rate: '0.05' }, A);
  storeCreate(m.env, 'fill', fill(), A); storeCreate(m.env, 'fill', fill({ fillId: 'f2', kind: 'close', at: t0 + 7200000, price: '105', qty: '2', fee: { state: 'entered', amount: '0.1' } }), A);
  storeCreate(m.env, 'cashflow', { cfId: 'c1', at: t0 + 10, amount: '100' }, A); storeCreate(m.env, 'equity', { day, equity: '409.8' }, A);
  const inputs = storeLoadLedgerInputs(m.env), direct = ledgerBuildDaily({ ...inputs, throughDay: day }), viaStore = storeBuildLedger(m.env, { throughDay: day });
  assert.equal(JSON.stringify(viaStore.rows, (k, v) => (typeof v === 'bigint' ? `${v}n` : v)), JSON.stringify(direct.rows, (k, v) => (typeof v === 'bigint' ? `${v}n` : v)));
  assert.equal(viaStore.rows[0].pnlMicro, 9800000n - 0n + 0n - 0n + 0n - 0n); assert.equal(viaStore.rows[0].diffMicro, 0n); assert.equal(viaStore.rows[0].needsReview, false);
  storeVoid(m.env, 'cashflow', 'c1', { actor: 'web', reason: '잘못 입력' }); const after = storeBuildLedger(m.env, { throughDay: day }); assert.equal(after.rows[0].cashflowMicro, 0n); assert.equal(after.rows[0].needsReview, true);   // 입금이 빠지면 차이 노출
  assert.throws(() => storeLoadLedgerInputs(fresh().env), e => e.code === 'NOT_FOUND');
});
test('시트 자동 형변환 방어: 날짜·숫자로 바뀐 셀(텍스트 서식 누락)은 조용히 손상시키지 않고 INTEGRITY 오류', () => {
  const m = fresh({ coerce: true }); storeCreate(m.env, 'cashflow', { cfId: '12345', at: 1, amount: '5' }, A);                // 숫자처럼 보이는 키는 문자열로 복원되어 문제 없음
  assert.equal(storeGet(m.env, 'cashflow', '12345').data.amount, '5');
  storeCreate(m.env, 'equity', { day: '2026-10-24', equity: '300' }, A);                                                     // 날짜 문자열 키 → Date로 바뀜
  assert.throws(() => storeList(m.env, 'equity'), e => e.code === 'INTEGRITY' && /텍스트 서식/.test(e.message));
});
test('저장소 모듈은 로그를 출력하지 않는다(공개 로그에 금액·ID 노출 금지)', () => {
  for (const f of ['store', 'schema']) assert.ok(!/console\.|Logger\.log/.test(readFileSync(new URL(`../lib/${f}.mjs`, import.meta.url), 'utf8')), f);
});
