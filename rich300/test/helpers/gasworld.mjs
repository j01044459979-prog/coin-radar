// 가짜 Apps Script 세계(시험용): 여러 스프레드시트·Drive·속성·트리거·UrlFetch(가짜 Telegram)·가변 시계·가변 방문자 이메일.
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { buildEngine } from '../../build.mjs';
import { fakeSheetsServices, fakeCache } from './gasfakes.mjs';
import { fakeTelegram, FAKE_TOKEN } from './faketg.mjs';

const read = f => readFileSync(new URL(`../../gas/${f}`, import.meta.url), 'utf8'), j = v => JSON.parse(JSON.stringify(v));
export const SUN = Date.UTC(2026, 9, 24, 5, 0);                       // 2026-10-24 14:00 KST
export function loadWorld({ props: extra = {}, email = 'me@example.com', now = SUN, files, fetchMs = 0, execUrl = 'https://script.google.com/macros/s/AKfycTEST/exec' } = {}) {
  const spy = { logs: [], urls: [], triggers: [], now, email, fetchMs, userLockHeld: false }, tele = fakeTelegram(), cache = fakeCache({ t: 0 }), books = new Map(), drive = { folders: new Map(), files: new Map(), n: 1 };
  const newBook = () => { const s = fakeSheetsServices(), id = `SHEET${books.size + 1}`; books.set(id, s); return id; };
  const cloneBook = srcId => { const src = books.get(srcId), id = newBook(), dst = books.get(id); for (const [name, sh] of src.book) { const n = dst.ctx.SpreadsheetApp.openById('x').insertSheet(name); n.cells = sh.cells.map(r => [...r]); n.fmt = sh.fmt.map(r => (r ? [...r] : r)); n.frozen = sh.frozen; n.max = sh.max; } return id; };
  const pm = new Map(Object.entries({ ...extra })), props = { getProperty: k => (pm.has(k) ? pm.get(k) : null), setProperty: (k, v) => { pm.set(k, String(v)); }, deleteProperty: k => { pm.delete(k); }, getKeys: () => [...pm.keys()] };
  const lock = { held: false }, fileObj = id => { const f = drive.files.get(id); return { getId: () => id, getName: () => f.name, getDateCreated: () => new Date(f.created), setTrashed: t => { f.trashed = t; }, makeCopy: (name, folder) => { const nid = cloneBook(f.bookId); drive.files.set(nid, { name, parent: folder.getId(), bookId: nid, trashed: false, created: spy.now + drive.n++ }); return fileObj(nid); } }; };
  const ctx = { console: { log: (...a) => spy.logs.push(a.join(' ')) }, Logger: { log: (...a) => spy.logs.push(a.join(' ')) }, Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super(spy.now); } static now() { return spy.now; } },
    SpreadsheetApp: { openById: id => { const b = books.get(id); if (!b) throw new Error('no sheet'); return b.ctx.SpreadsheetApp.openById(id); }, flush() {}, create: name => { const id = newBook(); drive.files.set(id, { name, parent: null, bookId: id, trashed: false, created: 0 }); return { getId: () => id }; } },
    LockService: { getScriptLock: () => ({ tryLock: () => { if (lock.held) return false; lock.held = true; return true; }, releaseLock() { lock.held = false; } }), getUserLock: () => ({ tryLock: () => { if (spy.userLockHeld) return false; spy.userLockHeld = true; return true; }, releaseLock() { spy.userLockHeld = false; } }) },
    Utilities: { ...fakeSheetsServices().ctx.Utilities, getUuid: () => randomUUID(), sleep: () => {}, formatDate: (d, tz, fmt) => { if (tz !== 'Asia/Seoul' || fmt !== 'yyyy-MM-dd HH:mm') throw new Error('unsupported'); return new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' '); } }, CacheService: cache.service, PropertiesService: { getScriptProperties: () => props },
    Session: { getActiveUser: () => ({ getEmail: () => spy.email }), getEffectiveUser: () => ({ getEmail: () => 'me@example.com' }), getScriptTimeZone: () => 'Asia/Seoul' },
    ContentService: { MimeType: { JSON: 'json', TEXT: 'text' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) },
    HtmlService: { createHtmlOutput: h => { const o = { html: h, setTitle() { return this; }, addMetaTag() { return this; } }; return o; }, createTemplateFromFile: () => ({ evaluate: () => ({ setTitle() { return this; }, addMetaTag() { return this; } }) }) },
    DriveApp: { getFoldersByName: name => { const m = [...drive.folders.entries()].filter(([, n]) => n === name); let i = 0; return { hasNext: () => i < m.length, next: () => ({ getId: () => m[i++][0] }) }; }, createFolder: name => { const id = `FOLDER${drive.n++}`; drive.folders.set(id, name); return { getId: () => id }; }, getFolderById: id => ({ getId: () => id, addFile: () => {}, getFiles: () => { const l = [...drive.files.entries()].filter(([, f]) => f.parent === id && !f.trashed).map(([fid]) => fileObj(fid)); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; } }), getFileById: id => fileObj(id) },
    ScriptApp: { WeekDay: { SUNDAY: 'SUNDAY' }, getService: () => ({ getUrl: () => execUrl }), getProjectTriggers: () => spy.triggers.filter(t => !t.deleted), deleteTrigger: t => { t.deleted = true; }, newTrigger: fn => { const t = { fn, deleted: false, kind: [], getHandlerFunction: () => fn }; const b = { timeBased: () => b, onWeekDay: d => { t.kind.push(d); return b; }, atHour: h => { t.kind.push(`h${h}`); return b; }, everyDays: n => { t.kind.push(`d${n}`); return b; }, after: n => { t.kind.push(`after${n}`); return b; }, everyHours: n => { t.kind.push(`hr${n}`); return b; }, everyMinutes: n => { t.kind.push(`m${n}`); return b; }, create: () => { spy.triggers.push(t); } }; return b; } },
    UrlFetchApp: { fetch: (url, opt) => { spy.urls.push(url); spy.now += spy.fetchMs; const m = /\/bot[^/]+\/(\w+)$/.exec(url)[1]; const r = tele.http.call(m, JSON.parse(opt.payload)); return { getResponseCode: () => r.status, getContentText: () => JSON.stringify(r.body) }; } } };
  vm.createContext(ctx);
  const list = files ?? ['Adapters.gs', 'Api.gs', 'Telegram.gs', 'Journal.gs', 'Backup.gs', 'Deploy.gs', 'LiveVerify.gs'].filter(f => readdirSync(new URL('../../gas/', import.meta.url)).includes(f));
  vm.runInContext([buildEngine(), ...list.map(read)].join('\n'), ctx);
  const E = ctx.RICH300_ENGINE, se = (id = pm.get('RICH300_SHEET_ID')) => ctx.rich300GasEnv_(id);
  return { ctx, spy, pm, tele, E, se, books, drive, props, j, FAKE_TOKEN, rows: n => j(E.storeList(se(), n).map(r => r.data)), advance: ms => { spy.now += ms; }, triggers: () => spy.triggers.filter(t => !t.deleted).map(t => `${t.fn}:${t.kind.join('+')}`) };
}
