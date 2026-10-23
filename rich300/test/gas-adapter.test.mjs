// GAS 경로 끝단 시험: 엔진 번들 + Adapters.gs 를 모듈 시스템 없이 vm에서 실행하고, 가짜 SpreadsheetApp(텍스트 서식 없으면 숫자·날짜로 자동 변환)으로
// 저장·읽기·수정·복구·장부 계산을 한다. 실제 Google 동작은 S0/배포 단계에서 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildEngine } from '../build.mjs';

function fakeSheetsServices() {
  const book = new Map(); let held = false;
  const mkSheet = name => ({ name, cells: [], fmt: [], frozen: 0, max: 1000,
    getLastRow() { return this.cells.length; }, getLastColumn() { return this.cells.reduce((m, r) => Math.max(m, r.length), 0); }, getMaxRows() { return this.max; }, insertRowsAfter(_, n) { this.max += n; }, setFrozenRows(n) { this.frozen = n; },
    getRange(r, c, nr, nc) { const sh = this; return {
      setNumberFormat(f) { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { (sh.fmt[r - 1 + i] ||= [])[c - 1 + j] = f; } return this; },
      setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => { const R = r - 1 + i, C = c - 1 + j, text = sh.fmt[R]?.[C] === '@'; (sh.cells[R] ||= [])[C] = text ? String(v) : (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v) : v); })); return this; },
      getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(sh.cells[r - 1 + i]?.[c - 1 + j] ?? ''); out.push(row); } return out; } }; } });
  const ss = { getSheetByName: n => book.get(n) ?? null, insertSheet: n => { const s = mkSheet(n); book.set(n, s); return s; } };
  return { book, ctx: {
    SpreadsheetApp: { openById: () => ss, flush() {} }, LockService: { getScriptLock: () => ({ tryLock: () => { if (held) return false; held = true; return true; }, releaseLock() { held = false; } }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: (a, s) => [...createHash('sha256').update(s).digest()].map(b => (b > 127 ? b - 256 : b)) } } };
}
const load = () => {
  const svc = fakeSheetsServices(), ctx = { console, Date, ...svc.ctx }; vm.createContext(ctx);
  vm.runInContext(buildEngine() + '\n' + readFileSync(new URL('../gas/Adapters.gs', import.meta.url), 'utf8'), ctx);
  const E = ctx.RICH300_ENGINE; return { ctx: E, book: svc.book, env: ctx.rich300GasEnv_('sheet-id'), raw: ctx };
};
const day = '2026-10-24', t0 = Date.UTC(2026, 9, 23, 15, 0, 0);          // 2026-10-24 00:00 KST

test('GAS 경로: 어댑터가 모든 열을 텍스트 서식으로 만들어 날짜 키(2026-10-24)·숫자형 키·금액이 손상 없이 왕복한다', () => {
  const { ctx, env } = load(); ctx.storeInit(env); ctx.storeInit(env);
  assert.equal(ctx.storeCreate(env, 'equity', { day, equity: '320.5' }, { actor: 'gas' }).status, 'added'); assert.equal(ctx.storeCreate(env, 'cashflow', { cfId: '12345', at: t0 + 5, amount: '10' }, { actor: 'gas' }).status, 'added');
  assert.equal(ctx.storeCreate(env, 'equity', { day, equity: '320.50' }, { actor: 'gas' }).status, 'duplicate');
  assert.equal(ctx.storeGet(env, 'equity', day).data.equity, '320.5'); assert.equal(ctx.storeGet(env, 'cashflow', '12345').data.amount, '10'); assert.equal(ctx.storeIntegrityCheck(env).ok, true);
});
test('GAS 경로: 헤더 불일치 시트는 거부, 락은 한 번에 하나만, 쓰기 후 장부 계산·복구가 동작', () => {
  const { ctx, book, env, raw } = load(); ctx.storeInit(env);
  book.get('Fills').cells[0][2] = 'DIR'; assert.throws(() => raw.rich300GasEnv_('x').sheets.ensure('Fills', ['key', 'rev', 'void', 'recordedAt', 'data', 'sid', 'kind', 'dir', 'atKst', 'price', 'qty']), /헤더 불일치/); book.get('Fills').cells[0][2] = 'void';
  assert.equal(env.lock.tryLock(1), true); assert.equal(env.lock.tryLock(1), false); env.lock.release(); assert.equal(env.lock.tryLock(1), true); env.lock.release();
  ctx.storeSetupChallenge(env, { startEquity: '300', startDay: day, rate: '0.05' }, { actor: 'gas' });
  ctx.storeCreate(env, 'fill', { origin: 'real', fillId: 'f1', sid: 'S1', kind: 'entry', dir: 'LONG', at: t0 + 3600000, price: '100', qty: '1', fee: { state: 'entered', amount: '0' }, funding: { state: 'entered', amount: '0' } }, { actor: 'gas' });
  ctx.storeCreate(env, 'fill', { origin: 'real', fillId: 'f2', sid: 'S1', kind: 'close', dir: 'LONG', at: t0 + 7200000, price: '110', qty: '1', fee: { state: 'entered', amount: '0' }, funding: { state: 'entered', amount: '0' } }, { actor: 'gas' });
  const r = ctx.storeBuildLedger(env, { throughDay: day }); assert.equal(String(r.rows[0].closeMicro), '310000000'); assert.equal(String(r.rows[0].realizedGrossMicro), '10000000');
  book.get('Fills').cells.pop();                                                                                         // 엔티티 행 유실
  assert.equal(ctx.storeIntegrityCheck(env).repairable, 1); const rep = ctx.storeRepair(env); assert.equal(rep.after.ok, true); assert.equal(rep.appended.length, 1);
});
test('GAS 경로: 같은 쓰기를 두 번 보내도(재전송) 한 번만 기록되고 감사 로그 해시 체인이 유지', () => {
  const { ctx, env } = load(); ctx.storeInit(env); const sig = { sid: 'A-1', strategy: 'A', symbolId: 'BTCUSDT', dir: 'LONG', signalAt: t0, entry: '100', stop: '98', tp1: '103' };
  assert.equal(ctx.storeCreate(env, 'signal', sig, { actor: 'api' }).status, 'added'); assert.equal(ctx.storeCreate(env, 'signal', { ...sig }, { actor: 'api' }).status, 'duplicate'); assert.equal(ctx.storeReadAudit(env).length, 1);
  assert.equal(ctx.storeClaimUpdate(env, 'u', 5, 'tg'), true); assert.equal(ctx.storeClaimUpdate(env, 'u', 5, 'tg'), false); assert.equal(ctx.storeIntegrityCheck(env).ok, true);
});
