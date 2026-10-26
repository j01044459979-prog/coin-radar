// 운영 묶음(gas 파일 전체 + 엔진)을 가짜 Apps Script·가짜 Telegram 위에 올리는 시험용 로더. 실제 호출 없음.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { buildEngine } from '../../build.mjs';
import { fakeSheetsServices, fakeCache } from './gasfakes.mjs';
import { fakeTelegram, FAKE_TOKEN } from './faketg.mjs';

export const readGas = f => readFileSync(new URL(`../../gas/${f}`, import.meta.url), 'utf8');
const FILES = ['Adapters.gs', 'Api.gs', 'Telegram.gs', 'Dashboard.gs', 'Journal.gs', 'Backup.gs', 'Deploy.gs', 'Verify.gs', 'Health.gs', 'Watch.gs', 'Install.gs'];
export function loadProd({ props = {}, email = 'me@example.com', url = 'https://script.google.com/macros/s/X/exec' } = {}) {
  const sheets = fakeSheetsServices(), tele = fakeTelegram(), cache = fakeCache({ t: 0 }), spy = { logs: [], triggers: [], pages: [], fetches: 0 };
  const pm = new Map(Object.entries({ RICH300_SHEET_ID: 'sheet', RICH300_OWNER_EMAIL: 'me@example.com', RICH300_TG_TOKEN: FAKE_TOKEN, 'verify:startedAt': '1', ...props }));
  const P = { getProperty: k => (pm.has(k) ? pm.get(k) : null), setProperty: (k, v) => { pm.set(k, String(v)); }, deleteProperty: k => { pm.delete(k); }, getKeys: () => [...pm.keys()] };
  const trig = () => { const t = { deleted: false, kind: [] }; const b = new Proxy({}, { get: (_, k) => (k === 'create' ? () => { spy.triggers.push(t); } : (...a) => { t.kind.push(`${String(k)}${a.length ? a.join(',') : ''}`); return b; }) }); return { t, b }; };
  const ctx = { console: { log: () => {} }, Logger: { log: (...a) => spy.logs.push(a.join(' ')) }, Date: class extends Date { static now() { return 1790000000000; } }, ...sheets.ctx, HtmlService: { createTemplateFromFile: name => ({ evaluate() { const o = { html: `<!-- template ${name} preset ${this.preset} -->`, setTitle(x) { this.title = x; return this; }, addMetaTag() { return this; } }; spy.pages.push(o); return o; } }), createHtmlOutput: h => { const o = { html: h, setTitle(x) { this.title = x; return this; }, addMetaTag() { return this; } }; spy.pages.push(o); return o; } },
    ContentService: { MimeType: { JSON: 'json', TEXT: 'text' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) }, CacheService: cache.service, PropertiesService: { getScriptProperties: () => P }, Session: { getActiveUser: () => ({ getEmail: () => email }), getEffectiveUser: () => ({ getEmail: () => email }), getScriptTimeZone: () => 'Asia/Seoul' },
    Utilities: { ...sheets.ctx.Utilities, getUuid: () => randomUUID(), sleep: () => {} }, ScriptApp: { WeekDay: { SUNDAY: 'SUN' }, getService: () => ({ getUrl: () => url }), getProjectTriggers: () => spy.triggers.filter(t => !t.deleted).map(t => ({ ...t, getHandlerFunction: () => t.fn })), deleteTrigger: t => { const r = spy.triggers.find(x => x === t || (x.fn === t.fn && !x.deleted)); if (r) r.deleted = true; }, newTrigger: fn => { const { t, b } = trig(); t.fn = fn; return b; } },
    UrlFetchApp: { fetchAll: reqs => reqs.map(r => ctxFetch(r.url, r)), fetch: (u, opt) => ctxFetch(u, opt) } };
  const ctxFetch = (u, opt) => { if (/okx\.com|bybit\.com/.test(u)) { spy.market = (spy.market || 0) + 1; const r = spy.marketHandler ? spy.marketHandler(u) : { status: 503, body: '' }; return { getResponseCode: () => r.status, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) }; } spy.fetches++; const m = /\/bot[^/]+\/(\w+)$/.exec(u)[1]; const r = tele.http.call(m, JSON.parse(opt.payload)); return { getResponseCode: () => r.status, getContentText: () => JSON.stringify(r.body) }; };
  vm.createContext(ctx); vm.runInContext(FILES.map(readGas).reduce((a, b) => `${a}\n${b}`, buildEngine()), ctx);
  return { ctx, tele, spy, pm, P, cache, rows: n => JSON.parse(JSON.stringify(ctx.RICH300_ENGINE.storeList(ctx.rich300GasEnv_('sheet'), n).map(r => r.data))) };
}
