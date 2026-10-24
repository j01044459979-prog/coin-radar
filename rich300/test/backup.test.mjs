import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDrive, liveStore, cloneMem } from './helpers/fakedrive.mjs';
import { storeCreate, storeSetupChallenge, storeBuildLedger, storeIntegrityCheck, storeList } from '../lib/store.mjs';
import { StoreError } from '../lib/schema.mjs';
import { backupRun, backupRestore, backupSwitchChecks, backupRetention, backupName, backupRestoredName, backupFingerprint, backupKeepFrom, BACKUP_RE } from '../lib/backup.mjs';
import { deployMarkEnv } from '../lib/deploy.mjs';
import { dayStartMs } from '../lib/time.mjs';

const A = { actor: 't' }, H = 3600000, D1 = '2026-10-24', SUN = Date.UTC(2026, 9, 24, 18, 0);       // 2026-10-25 03:00 KST (일요일)
function seeded() {
  const m = liveStore(); storeSetupChallenge(m.env, { startEquity: '300', startDay: D1, rate: '0.05' }, A); storeCreate(m.env, 'signal', { sid: 'A-1', strategy: 'A', symbolId: 'BTCUSDT', dir: 'LONG', signalAt: 1, entry: '100', stop: '98', tp1: '103' }, A);
  const at = dayStartMs(D1) + 10 * H; for (const f of [{ fillId: 'in', kind: 'entry', at, price: '100', qty: '3' }, { fillId: 'out', kind: 'close', at: at + H, price: '103', qty: '3' }]) storeCreate(m.env, 'fill', { origin: 'real', sid: 'A-1', dir: 'LONG', fee: { state: 'entered', amount: '0.1' }, funding: { state: 'entered', amount: '0' }, ...f }, A);
  storeCreate(m.env, 'equity', { day: D1, equity: '308.7' }, A); storeCreate(m.env, 'review', { sid: 'A-1', plan: 'plan_ok', mind: 'calm', savedAt: at + 5 * H }, A); deployMarkEnv(m.env, 'prod'); return m;
}
const mk = (live = seeded()) => { const d = fakeDrive({ live }); const env = { sourceId: 'SRC', storeEnv: () => live.env, drive: d.drive }; return { live, d, env }; };
const names = x => x.d.drive.list(x.d.drive.ensureFolder()).map(f => f.name).sort();

test('이름·보관 계획: KST 시각 이름, 이름 패턴이 맞는 백업만 최근 N개 보관, 나머지 파일은 무시, 설정 clamp', () => {
  assert.equal(backupName(SUN), 'RICH300-backup-20261025-0300'); assert.equal(backupRestoredName(SUN), 'RICH300-restored-20261025-0300'); assert.equal(backupName(Date.UTC(2026, 11, 31, 15, 5)), 'RICH300-backup-20270101-0005');
  const list = [...Array.from({ length: 12 }, (_, i) => ({ id: `b${i}`, name: backupName(SUN + (i - 6) * 7 * 86400000) })).sort(() => 0.5 - Math.random()), { id: 'x1', name: 'RICH300-restored-20261025-0300' }, { id: 'x2', name: 'RICH300 prod' }, { id: 'x3', name: 'RICH300-backup-2026-10-25' }, { id: 'x4', name: 'my-backup-20261025-0300' }];
  const p = backupRetention(list, 8); assert.equal(p.keep.length, 8); assert.equal(p.remove.length, 4); assert.deepEqual(p.ignored.map(x => x.id).sort(), ['x1', 'x2', 'x3', 'x4']);
  assert.ok(p.keep.every(k => p.remove.every(r => k.name > r.name))); assert.ok(p.remove.every(r => BACKUP_RE.test(r.name)));
  assert.deepEqual([backupKeepFrom({ backupKeep: '8' }), backupKeepFrom({ backupKeep: '0' }), backupKeepFrom({ backupKeep: '99' }), backupKeepFrom({ backupKeep: 'x' }), backupKeepFrom({})], [8, 1, 30, 8, 8]);
  assert.deepEqual(backupRetention([], 8), { keep: [], remove: [], ignored: [] });
});
test('백업: 락 안에서 사본 생성 → 무결성·지문 검증 → 이름 보관, 같은 분 재실행은 exists, 원본은 변경 없음', () => {
  const x = mk(), before = JSON.stringify([...x.live.sheets]); const r = backupRun(x.env, { now: SUN });
  assert.deepEqual([r.status, r.name, r.verified, r.keep, r.kept, r.trashed, r.warnings], ['ok', 'RICH300-backup-20261025-0300', true, 8, 1, [], []]); assert.deepEqual(names(x), ['RICH300-backup-20261025-0300']);
  assert.equal(JSON.stringify([...x.live.sheets]), before); assert.equal(backupRun(x.env, { now: SUN }).status, 'exists'); assert.equal(x.d.st.copies, 1);
  const fp = backupFingerprint(x.live.env); assert.ok(fp.auditCount >= 6); assert.equal(fp.sheets.Fills, 2); assert.equal(fp.metaKeys, 1);
  assert.equal(JSON.stringify(backupFingerprint(x.d.drive.openStore('F1'))), JSON.stringify(fp));
});
test('보관: 12주 연속 백업해도 최근 8개만 남고, 지운 것은 가장 오래된 백업뿐(다른 파일·복원본·원본은 그대로)', () => {
  const x = mk(); x.d.put('R1', 'RICH300-restored-20260101-0000', x.d.drive.ensureFolder(), cloneMem(x.live)); x.d.put('O1', 'notes.txt', x.d.drive.ensureFolder(), cloneMem(x.live)); const trashedAll = [];
  for (let i = 0; i < 12; i++) { const r = backupRun(x.env, { now: SUN + i * 7 * 86400000 }); assert.equal(r.status, 'ok'); trashedAll.push(...r.trashed); }
  const left = names(x).filter(n => BACKUP_RE.test(n)); assert.equal(left.length, 8); assert.deepEqual(left, Array.from({ length: 8 }, (_, i) => backupName(SUN + (i + 4) * 7 * 86400000)).sort()); assert.deepEqual(trashedAll, Array.from({ length: 4 }, (_, i) => backupName(SUN + i * 7 * 86400000)));
  assert.ok(names(x).includes('RICH300-restored-20260101-0000') && names(x).includes('notes.txt')); assert.equal(x.d.files.get('SRC').trashed, false);
  storeCreate(x.live.env, 'setting', { name: 'backupKeep', value: '3' }, A); const r = backupRun(x.env, { now: SUN + 12 * 7 * 86400000 }); assert.deepEqual([r.keep, r.kept, r.trashed.length], [3, 3, 6]); assert.equal(names(x).filter(n => BACKUP_RE.test(n)).length, 3);
});
test('검증 실패(사본 손상·지문 불일치): 사본을 폐기하고 기존 백업은 건드리지 않는다', () => {
  const x = mk(); for (let i = 0; i < 3; i++) backupRun(x.env, { now: SUN + i * 7 * 86400000 }); const before = names(x);
  x.d.st.tamperNext = mem => { mem.sheets.get('Fills')[0][4] = mem.sheets.get('Fills')[0][4].replace('100', '999'); };          // 사본의 체결 행 변조
  let r = backupRun(x.env, { now: SUN + 3 * 7 * 86400000 }); assert.deepEqual([r.status, r.reasons.includes('copy-integrity')], ['verify-failed', true]); assert.deepEqual(names(x), before); assert.equal(x.d.st.trashed.length, 1);
  x.d.st.tamperNext = mem => { mem.sheets.get('Audit').pop(); mem.sheets.get('Equity').pop(); };                                   // 끝부분 누락(해시 체인은 유지되지만 지문 불일치)
  r = backupRun(x.env, { now: SUN + 4 * 7 * 86400000 }); assert.equal(r.status, 'verify-failed'); assert.ok(r.reasons.includes('fingerprint-mismatch')); assert.deepEqual(names(x), before);
  x.d.st.copyFail = true; r = backupRun(x.env, { now: SUN + 5 * 7 * 86400000 }); assert.equal(r.status, 'copy-failed'); assert.deepEqual(names(x), before); x.d.st.copyFail = false;
  assert.equal(backupRun(x.env, { now: SUN + 6 * 7 * 86400000 }).status, 'ok'); assert.equal(names(x).length, 4);
});
test('원본에 무결성 문제가 있으면 사본은 증거로 남기되 회전하지 않는다(좋은 과거 백업 보존), 락 경합은 아무것도 만들지 않는다', () => {
  const x = mk(); storeCreate(x.live.env, 'setting', { name: 'backupKeep', value: '2' }, A); for (let i = 0; i < 2; i++) backupRun(x.env, { now: SUN + i * 7 * 86400000 });
  x.live.sheets.get('Fills')[0][4] = x.live.sheets.get('Fills')[0][4].replace('100', '777');                                          // 원본 변조
  const r = backupRun(x.env, { now: SUN + 2 * 7 * 86400000 }); assert.deepEqual([r.status, r.rotated, r.fingerprintMatches], ['ok-unhealthy-source', false, true]); assert.ok(r.issues.includes('tampered-view')); assert.equal(names(x).length, 3); assert.equal(x.d.st.trashed.length, 0);
  const y = mk(); y.live.setLockBusy(true); assert.throws(() => backupRun(y.env, { now: SUN }), e => e instanceof StoreError && e.code === 'LOCK'); assert.equal(y.d.st.copies, 0); assert.deepEqual(names(y), []);
});
test('Telegram CSV 자동 전송은 OFF: 설정이 on 이어도 보내지 않고 경고만, 모듈에 네트워크·Telegram 코드 없음', () => {
  const x = mk(); storeCreate(x.live.env, 'setting', { name: 'backupTelegramCsv', value: 'on' }, A); const r = backupRun(x.env, { now: SUN }); assert.deepEqual([r.status, r.warnings], ['ok', ['telegram-csv-unsupported']]);
  const src = readFileSync(new URL('../lib/backup.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, ''); assert.ok(!/fetch|UrlFetch|http|telegram|sendDocument|csv/i.test(src.replace(/backupTelegramCsv|telegram-csv-unsupported/g, '')));
  assert.ok(!/UrlFetchApp|sendDocument/.test(readFileSync(new URL('../gas/Backup.gs', import.meta.url), 'utf8')));
});
test('복원: 백업 → 새 사본(운영 시트·기존 백업 불변), 장부 계산이 원본과 동일, 손상 백업은 거부, 임의 파일은 복원 불가', () => {
  const x = mk(); backupRun(x.env, { now: SUN }); const id = 'F1', live0 = JSON.stringify([...x.live.sheets]), orig = storeBuildLedger(x.live.env, { throughDay: D1 });
  storeCreate(x.live.env, 'equity', { day: '2026-10-25', equity: '999' }, A);                                                        // 백업 이후 변경(복원하면 사라져야 함)
  const r = backupRestore(x.env, id, { now: SUN + 3600000 }); assert.equal(r.name, 'RICH300-restored-20261025-0400'); assert.equal(r.from, 'RICH300-backup-20261025-0300'); assert.ok(names(x).includes(r.name) && !BACKUP_RE.test(r.name));
  const rs = x.d.drive.openStore(r.id), restored = storeBuildLedger(rs, { throughDay: D1 }); assert.equal(JSON.stringify(restored.rows, (k, v) => (typeof v === 'bigint' ? String(v) : v)), JSON.stringify(orig.rows, (k, v) => (typeof v === 'bigint' ? String(v) : v)));
  assert.equal(storeList(rs, 'equity').length, 1); assert.equal(storeIntegrityCheck(rs).ok, true); assert.notEqual(JSON.stringify([...x.live.sheets]), live0);   // 운영 시트는 그 사이 변경분을 유지
  assert.equal(x.d.files.get(id).trashed, false); assert.equal(backupFingerprint(x.d.drive.openStore(id)).auditCount, r.fingerprint.auditCount);
  x.d.files.get(id).mem.sheets.get('Fills')[1][4] += ' '; assert.throws(() => backupRestore(x.env, id, { now: SUN + 7200000 }), e => e instanceof StoreError && e.code === 'INTEGRITY' && /손상/.test(e.message));
  x.d.put('O1', 'notes', x.d.drive.ensureFolder(), cloneMem(x.live)); for (const bad of ['O1', 'SRC', 'nope', r.id]) assert.throws(() => backupRestore(x.env, bad, { now: SUN }), e => e instanceof StoreError && e.code === 'NOT_FOUND');
});
test('복원 전체 주기: 운영 시트가 사라져도 백업에서 복원·점검 후 전환 가능(환경 표식 불일치·손상 대상은 전환 점검에서 거부)', () => {
  const x = mk(); backupRun(x.env, { now: SUN }); const r = backupRestore(x.env, 'F1', { now: SUN + 60000 });
  assert.deepEqual(backupSwitchChecks(x.env, r.id, { expectEnv: 'prod' }), { ok: true, issues: [], auditCount: r.fingerprint.auditCount, envMarker: 'prod' });
  const wrong = backupSwitchChecks(x.env, r.id, { expectEnv: 'test' }); assert.deepEqual([wrong.ok, wrong.issues], [false, ['env-mismatch']]);                  // 운영 데이터를 테스트 프로젝트에 연결하는 실수 방지
  const un = liveStore(); x.d.put('U1', 'unmarked', 'FOLDER-B', un); assert.deepEqual(backupSwitchChecks(x.env, 'U1', { expectEnv: 'prod' }).issues, ['env-unmarked']);
  x.d.files.get(r.id).mem.sheets.get('Responses').push(['x', '1', '0', '1', '{}', 'x']); const bad = backupSwitchChecks(x.env, r.id, { expectEnv: 'prod' }); assert.equal(bad.ok, false); assert.ok(bad.issues.includes('orphan-view'));
});
