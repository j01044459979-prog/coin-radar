// Apps Script 서비스를 메모리로 흉내 내어 Code.gs 로직(인증·권한·기록·QR)을 검증한다.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(dir, '..', 'Code.gs'), 'utf8');

export function createEnv({ props = {}, now = () => Date.now() } = {}) {
  const propStore = { ...props };
  const cacheStore = new Map();
  const sheets = {};
  const head = (names) => names;
  const seed = {
    '아파트DB': [['ID','아파트명','주소','총세대수','전체동수','동목록','아파트형식','공동현관','메모','최근활동일','누적활동동수','사용여부'],
      ['APT002','원앙마을2단지','x',1,13,'201동, 202동, 203동','혼합형','미확인','',  '',0,'사용'],
      ['APT011','신선마을','x',1,15,'201동, 202동','계단형','비밀번호 없음','', '',0,'사용'],
      ['APT099','폐쇄단지','x',1,1,'101동','미확인','미확인','','',0,'미사용']],
    '활동기록': [['활동ID','활동일','담당자','아파트ID','아파트명','완료동','활동동수','아파트형식','공동현관','활동메모','등록일시']],
    'QR접속기록': [['접속ID','접속일','접속시간','QR구분','기록일시']],
  };
  Object.entries(seed).forEach(([k, v]) => (sheets[k] = v.map((r) => r.slice())));
  const mkSheet = (name) => ({
    appendRow: (r) => sheets[name].push(r),
    getLastRow: () => sheets[name].length,
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => sheets[name].slice(r - 1, r - 1 + nr).map((x) => x.slice(c - 1, c - 1 + nc)),
      setValues: (v) => v.forEach((row, i) => row.forEach((val, j) => (sheets[name][r - 1 + i][c - 1 + j] = val))),
      setValue: (v) => (sheets[name][r - 1][c - 1] = v),
    }),
    deleteRow: (r) => sheets[name].splice(r - 1, 1),
  });
  const g = {
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => propStore[k] ?? null }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => { const e = cacheStore.get(k); if (!e) return null; if (e.exp <= now()) { cacheStore.delete(k); return null; } return e.v; },
      put: (k, v, s) => cacheStore.set(k, { v, exp: now() + s * 1000 }),
      remove: (k) => cacheStore.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { openById: (id) => { if (id !== 'SHEET') throw new Error('no sheet'); return {
      getSheetByName: (n) => (sheets[n] ? mkSheet(n) : null),
      insertSheet: (n) => { sheets[n] = []; return mkSheet(n); } }; } },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/NEW/exec' }) },
    HtmlService: { createHtmlOutput: (h) => ({ html: h, setTitle() { return this; } }),
      createHtmlOutputFromFile: (f) => { const o = { file: f, setTitle() { return o; }, addMetaTag() { return o; }, setXFrameOptionsMode() { return o; } }; return o; },
      XFrameOptionsMode: { DEFAULT: 0 } },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, f) => {
        const k = new Date(d.getTime() + 9 * 3600e3), p = (n, l = 2) => String(n).padStart(l, '0');
        const m = { yyyy: k.getUTCFullYear(), MM: p(k.getUTCMonth() + 1), dd: p(k.getUTCDate()), HH: p(k.getUTCHours()), mm: p(k.getUTCMinutes()), ss: p(k.getUTCSeconds()), SSS: p(k.getUTCMilliseconds(), 3) };
        return f.replace(/yyyy|MM|dd|HH|mm|ss|SSS/g, (t) => m[t]);
      },
      parseDate: (s) => { const [d, t] = s.split(' '); return new Date(`${d}T${t}:00+09:00`); },
    },
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now()])); } static now() { return now(); } static [Symbol.hasInstance](x) { return Object.prototype.toString.call(x) === '[object Date]'; } },
  };
  vm.createContext(g);
  vm.runInContext(code, g);
  return { g, sheets, propStore, cacheStore, call: (fn, ...a) => g[fn](...a) };
}
