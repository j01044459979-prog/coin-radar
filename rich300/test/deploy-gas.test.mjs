import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { buildEngine } from '../build.mjs';
import { fakeSheetsServices, fakeCache } from './helpers/gasfakes.mjs';
import { fakeTelegram, FAKE_TOKEN, OWNER } from './helpers/faketg.mjs';

const read = f => readFileSync(new URL(`../gas/${f}`, import.meta.url), 'utf8'), j = v => JSON.parse(JSON.stringify(v));
const SUN = Date.UTC(2026, 9, 24, 18, 0);

function load({ props: extra = {}, files = ['Adapters.gs', 'Api.gs', 'Telegram.gs', 'Backup.gs', 'Deploy.gs'], now = SUN, email = 'me@example.com' } = {}) {
  const spy = { logs: [], urls: [], triggers: [], now }, tele = fakeTelegram(), cache = fakeCache({ t: 0 }), books = new Map(), drive = { folders: new Map(), files: new Map(), n: 1 };
  const newBook = () => { const s = fakeSheetsServices(), id = `SHEET${books.size + 1}`; books.set(id, s); return id; };
  const cloneBook = srcId => { const src = books.get(srcId), id = newBook(), dst = books.get(id); for (const [name, sh] of src.book) { const n = dst.ctx.SpreadsheetApp.openById('x').insertSheet(name); n.cells = sh.cells.map(r => [...r]); n.fmt = sh.fmt.map(r => (r ? [...r] : r)); n.frozen = sh.frozen; n.max = sh.max; } return id; };
  const pm = new Map(Object.entries({ ...extra })); const props = { getProperty: k => (pm.has(k) ? pm.get(k) : null), setProperty: (k, v) => { pm.set(k, String(v)); }, deleteProperty: k => { pm.delete(k); }, getKeys: () => [...pm.keys()] };
  const lock = { held: false }, fileObj = id => { const f = drive.files.get(id); return { getId: () => id, getName: () => f.name, getDateCreated: () => new Date(f.created), setTrashed: t => { f.trashed = t; return this; }, makeCopy: (name, folder) => { const nid = cloneBook(f.bookId); drive.files.set(nid, { name, parent: folder.getId(), bookId: nid, trashed: false, created: spy.now + drive.n++ }); return fileObj(nid); } }; };
  const ctx = { console: { log: (...a) => spy.logs.push(a.join(' ')) }, Logger: { log: (...a) => spy.logs.push(a.join(' ')) }, Date: class extends Date { static now() { return spy.now; } },
    SpreadsheetApp: { openById: id => { const b = books.get(id); if (!b) throw new Error('no sheet'); return b.ctx.SpreadsheetApp.openById(id); }, flush() {}, create: name => { const id = newBook(); drive.files.set(id, { name, parent: null, bookId: id, trashed: false, created: 0 }); return { getId: () => id }; } },
    LockService: { getScriptLock: () => ({ tryLock: () => { if (lock.held) return false; lock.held = true; return true; }, releaseLock() { lock.held = false; } }) },
    Utilities: { ...fakeSheetsServices().ctx.Utilities, getUuid: () => randomUUID(), sleep: () => {} }, CacheService: cache.service, PropertiesService: { getScriptProperties: () => props },
    Session: { getActiveUser: () => ({ getEmail: () => email }), getEffectiveUser: () => ({ getEmail: () => 'me@example.com' }), getScriptTimeZone: () => 'Asia/Seoul' },
    ContentService: { MimeType: { JSON: 'json', TEXT: 'text' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) },
    DriveApp: { getFoldersByName: name => { const m = [...drive.folders.entries()].filter(([, n]) => n === name); let i = 0; return { hasNext: () => i < m.length, next: () => ({ getId: () => m[i++][0] }) }; }, createFolder: name => { const id = `FOLDER${drive.n++}`; drive.folders.set(id, name); return { getId: () => id }; }, getFolderById: id => ({ getId: () => id, getFiles: () => { const l = [...drive.files.entries()].filter(([, f]) => f.parent === id && !f.trashed).map(([fid]) => fileObj(fid)); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; } }), getFileById: id => fileObj(id) },
    ScriptApp: { WeekDay: { SUNDAY: 'SUNDAY' }, getService: () => ({ getUrl: () => 'https://script.example/exec' }), getProjectTriggers: () => spy.triggers.filter(t => !t.deleted), deleteTrigger: t => { t.deleted = true; }, newTrigger: fn => { const t = { fn, deleted: false, kind: [], getHandlerFunction: () => fn }; const b = { timeBased: () => b, onWeekDay: d => { t.kind.push(d); return b; }, atHour: h => { t.kind.push(`h${h}`); return b; }, everyDays: n => { t.kind.push(`d${n}`); return b; }, everyHours: n => { t.kind.push(`hr${n}`); return b; }, everyMinutes: n => { t.kind.push(`m${n}`); return b; }, create: () => { spy.triggers.push(t); } }; return b; } },
    UrlFetchApp: { fetch: (url, opt) => { spy.urls.push(url); const m = /\/bot[^/]+\/(\w+)$/.exec(url)[1]; const r = tele.http.call(m, JSON.parse(opt.payload)); return { getResponseCode: () => r.status, getContentText: () => JSON.stringify(r.body) }; } } };
  vm.createContext(ctx); vm.runInContext([buildEngine(), ...files.map(read)].join('\n'), ctx);
  const E = ctx.RICH300_ENGINE, se = (id = pm.get('RICH300_SHEET_ID')) => ctx.rich300GasEnv_(id);
  return { ctx, spy, pm, tele, E, se, books, drive, props, rows: n => j(E.storeList(se(), n).map(r => r.data)), advance: ms => { spy.now += ms; } };
}
const ready = (env = 'test', more = {}) => { const g = load({ props: { RICH300_OWNER_EMAIL: 'me@example.com', ...more } }); assert.equal(j(g.ctx[env === 'test' ? 'rich300SetupTest' : 'rich300SetupProd']()).ok, true); return g; };
const seedData = g => { const A = { actor: 't' }, E = g.E, s = g.se(); E.storeSetupChallenge(s, { startEquity: '300', startDay: '2026-10-24', rate: '0.05' }, A); E.storeCreate(s, 'equity', { day: '2026-10-24', equity: '300' }, A); };

test('초기 설정: 환경 이름·소유자·시트 생성·환경 표식(멱등), 다른 환경으로 재설정 거부, 출력에 비밀값 없음', () => {
  const g = load(); const r = j(g.ctx.rich300SetupTest()); assert.deepEqual([r.ok, r.env, r.sheetCreated], [true, 'test', true]); assert.equal(g.pm.get('RICH300_ENV'), 'test'); assert.equal(g.pm.get('RICH300_OWNER_EMAIL'), 'me@example.com'); assert.equal(g.E.deployReadEnv(g.se()), 'test');
  const again = j(g.ctx.rich300SetupTest()); assert.deepEqual([again.ok, again.sheetCreated], [true, false]); assert.equal(g.books.size, 1);
  assert.deepEqual(j(g.ctx.rich300SetupProd()), { ok: false, error: 'env-conflict', note: '이 프로젝트는 이미 test 환경입니다. 환경이 다르면 새 프로젝트를 만드세요.' });
  assert.ok(!JSON.stringify(r).includes('SHEET1') && !JSON.stringify(r).includes('example.com'));
  const mixed = load({ props: { RICH300_ENV: 'test', RICH300_SHEET_ID: 'SHEET1' } }); mixed.books.set('SHEET1', null); assert.throws(() => mixed.ctx.rich300SetupTest());
  const g2 = ready('test'); g2.E.storeInit(g2.se()); g2.pm.set('RICH300_ENV', 'prod'); const c = j(g2.E.deployCheckEnv(g2.se(), 'prod')); assert.equal(c.ok, false);                        // 표식(test)과 프로젝트 환경(prod) 불일치 감지
});
test('자가 점검: 상태만 반환·로그에 값 없음, 초기 상태의 경고와 설치 후 변화', () => {
  const g = ready('test', { RICH300_TG_TOKEN: FAKE_TOKEN, RICH300_INGEST_KEY: 'K'.repeat(40), RICH300_UI_URL: 'https://example.com/exec' }); seedData(g);
  let r = j(g.ctx.rich300SelfTest()); assert.equal(r.fail, 0); const ids = r.items.filter(i => !i.ok).map(i => i.id); assert.ok(ids.includes('trigger-rich300TgPoll') && ids.includes('trigger-rich300BackupRun') && ids.includes('backup')); assert.ok(!ids.includes('trigger-rich300CloseTick'));          // Journal.gs 없음 → 요구하지 않음
  g.ctx.rich300InstallAllTriggers(); g.ctx.rich300BackupRun(); r = j(g.ctx.rich300SelfTest()); assert.deepEqual([r.fail, r.warn], [0, 0]);
  const dump = g.spy.logs.join('\n') + JSON.stringify(r); for (const secret of [FAKE_TOKEN, 'K'.repeat(40), 'me@example.com', 'SHEET1', 'https://example.com']) assert.ok(!dump.includes(secret), secret);
  g.pm.set('RICH300_CLOSE_SEND_APPROVED', 'yes'); r = j(g.ctx.rich300SelfTest()); assert.ok(r.fail >= 1 && r.items.find(i => i.id === 'test-no-prod-flags').ok === false);                   // 테스트 프로젝트에 운영 승인 플래그
  const noOwner = load({ props: {} }); noOwner.ctx.rich300SetupTest(); noOwner.pm.delete('RICH300_OWNER_EMAIL'); assert.equal(j(noOwner.ctx.rich300SelfTest()).items.find(i => i.id === 'owner').ok, false);
});
test('Telegram 환경 가드: 미설정·운영 미승인·테스트 미허용이면 네트워크 호출 자체가 없고, 허용 조합에서만 호출된다(가드 파일이 없으면 차단)', () => {
  const run = (props, files) => { const g = load({ props: { RICH300_OWNER_EMAIL: 'me@example.com', RICH300_TG_TOKEN: FAKE_TOKEN, ...props }, files }); g.pm.set('RICH300_SHEET_ID', g.ctx.SpreadsheetApp.create('x').getId()); g.E.storeInit(g.se()); const r = j(g.ctx.rich300TgPoll()); return { r, urls: g.spy.urls.length, g }; };
  for (const props of [{}, { RICH300_ENV: 'prod' }, { RICH300_ENV: 'prod', RICH300_TEST_TG_ALLOW: 'yes' }, { RICH300_ENV: 'test' }, { RICH300_ENV: 'test', RICH300_PROD_APPROVED: 'yes' }, { RICH300_ENV: 'dev', RICH300_PROD_APPROVED: 'yes', RICH300_TEST_TG_ALLOW: 'yes' }]) { const x = run(props); assert.equal(x.urls, 0, JSON.stringify(props)); assert.deepEqual([x.r.status, x.r.code, x.r.retryable], ['error', 'forbidden', false]); }
  for (const props of [{ RICH300_ENV: 'test', RICH300_TEST_TG_ALLOW: 'yes' }, { RICH300_ENV: 'prod', RICH300_PROD_APPROVED: 'yes' }]) { const x = run(props); assert.ok(x.urls > 0, JSON.stringify(props)); assert.equal(x.r.status, 'ok'); assert.ok(x.g.spy.urls.every(u => u.startsWith(`https://api.telegram.org/bot${FAKE_TOKEN}/`))); }
  const noGuard = run({ RICH300_ENV: 'test', RICH300_TEST_TG_ALLOW: 'yes' }, ['Adapters.gs', 'Api.gs', 'Telegram.gs']); assert.equal(noGuard.urls, 0); assert.equal(noGuard.r.code, 'forbidden');
});
test('Backup.gs: 백업 폴더 생성·사본 생성·검증·이름 목록(ID 비노출)·주 1회 트리거·8개 보관·로그 없음', () => {
  const g = ready('test'); seedData(g); g.ctx.rich300BackupInstallTrigger(); g.ctx.rich300BackupInstallTrigger(); const live = g.spy.triggers.filter(t => !t.deleted); assert.deepEqual(live.map(t => [t.fn, t.kind.join('+')]), [['rich300BackupRun', 'SUNDAY+h3']]);
  for (let i = 0; i < 11; i++) { const r = j(g.ctx.rich300BackupRun()); assert.equal(r.status, 'ok'); g.advance(7 * 86400000); }
  const list = j(g.ctx.rich300BackupList()); assert.equal(list.length, 8); assert.ok(list.every(x => /^RICH300-backup-\d{8}-\d{4}$/.test(x.name) && Object.keys(x).sort().join() === 'createdAt,name')); assert.equal(g.drive.folders.size, 1);
  assert.deepEqual(j(g.ctx.rich300BackupRun()).status, 'ok'); const last = JSON.parse(g.pm.get('backup:last')); assert.deepEqual([last.status, last.rotated], ['ok', true]); assert.ok(!JSON.stringify(last).includes('SHEET')); assert.equal(g.spy.logs.length, 0);
  g.ctx.rich300BackupRemoveTrigger(); assert.equal(g.spy.triggers.filter(t => !t.deleted).length, 0);
  const trashed = [...g.drive.files.values()].filter(f => f.trashed).length; assert.ok(trashed >= 4);
});
test('Backup.gs: 복원은 새 사본(운영 시트 불변), 전환은 속성 두 개 확인 후에만·전환 전 자동 백업·환경 표식 불일치 거부·이전 ID 보관', () => {
  const g = ready('test'); seedData(g); g.ctx.rich300BackupRun(); const live = g.pm.get('RICH300_SHEET_ID'), liveRows = JSON.stringify([...g.books.get(live).book.keys()]);
  const r = j(g.ctx.rich300BackupRestoreLatest()); assert.deepEqual([r.ok, /^RICH300-restored-/.test(r.name)], [true, true]); assert.equal(g.pm.get('RICH300_SHEET_ID'), live); assert.equal(JSON.stringify([...g.books.get(live).book.keys()]), liveRows); const restoredId = g.pm.get('RICH300_LAST_RESTORED_ID'); assert.ok(restoredId && restoredId !== live);
  assert.deepEqual(j(g.ctx.rich300BackupSwitchFromProps()), { ok: false, error: 'not-confirmed' }); g.pm.set('RICH300_SWITCH_TO', restoredId); assert.equal(j(g.ctx.rich300BackupSwitchFromProps()).error, 'not-confirmed'); assert.equal(g.pm.get('RICH300_SHEET_ID'), live);
  g.advance(60000); g.pm.set('RICH300_SWITCH_CONFIRM', 'yes'); const s = j(g.ctx.rich300BackupSwitchFromProps()); assert.equal(s.ok, true); assert.match(s.preBackup, /^RICH300-backup-/); assert.equal(g.pm.get('RICH300_SHEET_ID'), restoredId); assert.equal(g.pm.get('RICH300_SHEET_ID_PREVIOUS'), live); assert.ok(!g.pm.has('RICH300_SWITCH_TO') && !g.pm.has('RICH300_SWITCH_CONFIRM'));
  assert.equal(j(g.ctx.rich300SelfTest()).items.find(i => i.id === 'integrity').ok, true);
  const prod = ready('prod'); seedData(prod); prod.ctx.rich300BackupRun(); const pid = prod.pm.get('RICH300_SHEET_ID');                                                       // 다른 환경의 시트로 전환 시도
  const other = ready('test'); seedData(other); other.books.set('PRODSHEET', prod.books.get(pid)); other.pm.set('RICH300_SWITCH_TO', 'PRODSHEET'); other.pm.set('RICH300_SWITCH_CONFIRM', 'yes'); const bad = j(other.ctx.rich300BackupSwitchFromProps()); assert.deepEqual([bad.ok, bad.error, bad.issues], [false, 'checks-failed', ['env-mismatch']]); assert.equal(other.pm.get('RICH300_SHEET_ID') === 'PRODSHEET', false);
  const none = ready('test'); assert.deepEqual(j(none.ctx.rich300BackupRestoreLatest()), { ok: false, error: 'no-backup' });
});
test('배포 보조 파일 정적 점검: Backup.gs·Deploy.gs 에 외부 호출·토큰 출력 없음, Telegram 호출은 가드 뒤', () => {
  assert.ok(!/UrlFetchApp|console\.|sendDocument/.test(read('Backup.gs'))); assert.ok(!/UrlFetchApp|console\./.test(read('Deploy.gs'))); const tg = read('Telegram.gs'); assert.ok(tg.indexOf('rich300TgGate_') < tg.indexOf('UrlFetchApp.fetch'));
  assert.ok(!/Logger\.log\([^)]*(TOKEN|KEY|EMAIL|SHEET_ID)/.test(read('Deploy.gs')));
});
