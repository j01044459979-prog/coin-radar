import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { buildEngine } from '../build.mjs';
import { fakeSheetsServices, fakeCache } from './helpers/gasfakes.mjs';
import { fakeTelegram, FAKE_TOKEN, OWNER } from './helpers/faketg.mjs';

const read = f => readFileSync(new URL(`../gas/${f}`, import.meta.url), 'utf8'), j = v => JSON.parse(JSON.stringify(v));
const DAY = 86400000, H = 3600000;
function load({ email = 'me@example.com', now = Date.UTC(2026, 9, 25, 3, 0) - 9 * H + 9 * H, approved = false, closeNotify = false } = {}) {
  const sheets = fakeSheetsServices(), tele = fakeTelegram(), cache = fakeCache({ t: 0 }), spy = { logs: [], triggers: [], pages: [] };
  const pm = new Map(Object.entries({ RICH300_SHEET_ID: 'sheet', RICH300_OWNER_EMAIL: 'me@example.com', RICH300_UI_URL: 'https://example.com/exec', RICH300_TG_TOKEN: FAKE_TOKEN, ...(approved ? { RICH300_CLOSE_SEND_APPROVED: 'yes' } : {}) }));
  const props = { getProperty: k => (pm.has(k) ? pm.get(k) : null), setProperty: (k, v) => { pm.set(k, String(v)); }, deleteProperty: k => { pm.delete(k); }, getKeys: () => [...pm.keys()] };
  const ContentService = { MimeType: { JSON: 'json', TEXT: 'text' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) };
  const HtmlService = { createHtmlOutput: h => { const o = { html: h, title: '', setTitle(x) { this.title = x; return this; }, addMetaTag() { return this; } }; spy.pages.push(o); return o; } };
  const trig = () => { const t = { deleted: false, kind: [] }; const b = { timeBased: () => b, atHour: h => { t.kind.push(`hour${h}`); return b; }, everyDays: n => { t.kind.push(`days${n}`); return b; }, everyHours: n => { t.kind.push(`hours${n}`); return b; }, everyMinutes: n => { t.kind.push(`min${n}`); return b; }, create: () => { spy.triggers.push(t); } }; return { t, b }; };
  const ctx = { console: { log: (...a) => spy.logs.push(a.join(' ')) }, Logger: { log: (...a) => spy.logs.push(a.join(' ')) }, Date: class extends Date { static now() { return ctx.__now; } }, __now: now, ...sheets.ctx, ContentService, HtmlService, CacheService: cache.service, PropertiesService: { getScriptProperties: () => props }, Session: { getActiveUser: () => ({ getEmail: () => email }) },
    Utilities: { ...sheets.ctx.Utilities, getUuid: () => randomUUID(), sleep: () => {} }, ScriptApp: { getService: () => ({ getUrl: () => 'https://script.example/exec' }), getProjectTriggers: () => spy.triggers.filter(t => !t.deleted).map(t => ({ ...t, getHandlerFunction: () => t.fn })), deleteTrigger: t => { const r = spy.triggers.find(x => x === t || x.fn === t.fn && !x.deleted); if (r) r.deleted = true; }, newTrigger: fn => { const { t, b } = trig(); t.fn = fn; return b; } },
    UrlFetchApp: { fetch: (url, opt) => { const m = /\/bot[^/]+\/(\w+)$/.exec(url)[1]; const r = tele.http.call(m, JSON.parse(opt.payload)); return { getResponseCode: () => r.status, getContentText: () => JSON.stringify(r.body) }; } } };
  vm.createContext(ctx); vm.runInContext(['Adapters.gs', 'Api.gs', 'Telegram.gs', 'Journal.gs'].map(read).reduce((a, b) => `${a}\n${b}`, buildEngine()), ctx);
  const E = ctx.RICH300_ENGINE, se = () => ctx.rich300GasEnv_('sheet');
  const setupChallenge = (start = '2026-10-24') => { E.storeInit(se()); E.storeSetupChallenge(se(), { startEquity: '300', startDay: start, rate: '0.05' }, { actor: 't' }); if (closeNotify) E.storeCreate(se(), 'setting', { name: 'closeNotify', value: 'on' }, { actor: 't' }); };
  return { ctx, tele, spy, pm, E, se, setupChallenge, rows: n => j(E.storeList(se(), n).map(r => r.data)), pair: () => { const r = ctx.rich300TgPairCode(); tele.say(OWNER, `/pair ${r.code}`); ctx.rich300TgPoll(); } };
}
const NOW_D2 = Date.UTC(2026, 9, 24, 15, 30);       // 2026-10-25 00:30 KST

test('Journal.gs: ?p=journal 은 소유자만(타인·익명 빈 응답), 페이지는 서버에서 완성되고 오류 시 일반 화면, 시트에 쓰지 않는다', () => {
  const g = load({ now: NOW_D2 }); g.setupChallenge(); const cells = () => ['Fills', 'Equity', 'Cashflows'].map(n => g.sheets?.book?.get?.(n)).length;
  const out = g.ctx.doGet({ parameter: { p: 'journal', day: '2026-10-24' } }); assert.ok(out.html.includes('RICH 300 일지') && out.html.includes('실제 계좌 평가액 입력')); assert.equal(out.title, 'RICH300 일지'); assert.ok(out.html.includes('value="2026-10-24" selected') && out.html.includes('https://script.example/exec?p=journal'));
  for (const email of ['', 'other@example.com']) assert.equal(load({ email }).ctx.doGet({ parameter: { p: 'journal' } }).text, '');
  const bad = load({ now: NOW_D2 }); bad.setupChallenge(); bad.ctx.RICH300_ENGINE.storeCreate(bad.se(), 'fill', { origin: 'real', fillId: 'f', sid: 'S', kind: 'close', dir: 'LONG', at: NOW_D2 - H, price: '1', qty: '1', fee: { state: 'missing' }, funding: { state: 'missing' } }, { actor: 't' });   // 첫 체결이 close → 계산 불가
  const o = bad.ctx.doGet({ parameter: { p: 'journal' } }); assert.ok(o.html.includes('불러오지 못했습니다') && !/첫 체결|Error|stack/.test(o.html)); assert.equal(g.spy.logs.length, 0); void cells;
});
test('Journal.gs: google.script.run 서버 함수는 각각 소유자 확인(타인 forbidden), 입력 오류는 안내 문구만, 평가액·입출금·체결 수정/취소 흐름', () => {
  const g = load({ now: NOW_D2 }); g.setupChallenge();
  let r = j(g.ctx.rich300EquitySubmit({ day: '2026-10-24', equity: '305' })); assert.deepEqual([r.ok, r.status, r.message], [true, 'added', '저장됨']); assert.match(r.detail, /장부 기준 300\.00 · 차이 \+5\.00/); assert.equal(g.rows('equity')[0].late, true);
  r = j(g.ctx.rich300EquitySubmit({ day: '2026-10-24', equity: '305' })); assert.equal(r.status, 'unchanged'); r = j(g.ctx.rich300EquitySubmit({ day: '2030-01-01', equity: '1' })); assert.deepEqual([r.ok, r.error, r.message], [false, 'invalid', '미래 날짜에는 입력할 수 없습니다']);
  r = j(g.ctx.rich300CashflowSubmit({ formId: 'abcdef12', amount: '50', note: '입금' })); assert.deepEqual([r.ok, r.status], [true, 'added']); assert.equal(j(g.ctx.rich300CashflowSubmit({ formId: 'abcdef12', amount: '50', note: '입금' })).status, 'duplicate'); assert.equal(g.rows('cashflow').length, 1);
  assert.equal(j(g.ctx.rich300CashflowSubmit({ formId: 'x', amount: '50' })).error, 'invalid'); assert.equal(j(g.ctx.rich300CashflowVoid('cf-abcdef12', '')).error, 'invalid'); assert.equal(j(g.ctx.rich300CashflowVoid('cf-abcdef12', '오입력')).ok, true);
  const E = g.E, at = NOW_D2 - 14 * H; for (const f of [{ fillId: 'in', kind: 'entry', at, price: '100', qty: '3' }, { fillId: 'out', kind: 'close', at: at + H, price: '103', qty: '3' }]) E.storeCreate(g.se(), 'fill', { origin: 'real', sid: 'S1', dir: 'LONG', fee: { state: 'missing' }, funding: { state: 'missing' }, ...f }, { actor: 't' });
  r = j(g.ctx.rich300JournalReviseFill('out', { price: '104' }, '재확인')); assert.deepEqual([r.ok, r.status], [true, 'revised']); assert.equal(j(g.ctx.rich300JournalReviseFill('out', { price: '104' }, '')).error, 'invalid'); assert.equal(j(g.ctx.rich300JournalReviseFill('out', { qty: '9' }, '오류 시험')).error, 'invalid');
  assert.equal(j(g.ctx.rich300JournalVoidFill('in', '진입 취소')).error, 'invalid'); assert.equal(j(g.ctx.rich300JournalVoidFill('out', '청산 취소')).ok, true);
  for (const email of ['', 'other@example.com']) { const o = load({ email, now: NOW_D2 }); o.setupChallenge(); for (const [fn, args] of [['rich300EquitySubmit', [{ day: '2026-10-24', equity: '1' }]], ['rich300CashflowSubmit', [{ formId: 'abcdef12', amount: '5' }]], ['rich300CashflowVoid', ['cf-x', 'r']], ['rich300JournalReviseFill', ['out', { price: '1' }, 'r']], ['rich300JournalVoidFill', ['out', 'r']]]) assert.deepEqual(j(o.ctx[fn](...args)), { ok: false, error: 'forbidden' }, `${fn}(${email || '익명'})`); assert.equal(o.rows('equity').length + o.rows('cashflow').length, 0); }
  assert.equal(g.spy.logs.length, 0);
});
test('Journal.gs: 일 마감 트리거(00시 + 매시간)·중복 설치 교체, 마감 실행은 한 번만, 알림 기본 OFF(Telegram 호출 없음)', () => {
  const g = load({ now: NOW_D2 }); g.setupChallenge(); g.pair(); const sent0 = g.tele.sent.length;
  g.ctx.rich300InstallCloseTriggers(); g.ctx.rich300InstallCloseTriggers(); const live = g.spy.triggers.filter(t => !t.deleted); assert.deepEqual(live.map(t => t.kind.join('+')), ['hour0+days1', 'hours1']);
  let r = j(g.ctx.rich300CloseTick()); assert.deepEqual(r.closed, ['2026-10-24']); r = j(g.ctx.rich300CloseTick()); assert.deepEqual(r.closed, []); assert.equal(g.rows('dayclose').length, 1);
  assert.equal(g.tele.sent.length, sent0); assert.deepEqual(g.rows('closenotice').map(n => [n.status, n.error]), [['off', 'setting-off']]);          // 설정 OFF → 보내지 않음
  assert.equal(JSON.parse(g.pm.get('close:last')).closed, 0); g.ctx.rich300RemoveCloseTriggers(); assert.equal(g.spy.triggers.filter(t => !t.deleted).length, 0); assert.equal(g.spy.logs.length, 0);
});
test('Journal.gs: 설정 on 이어도 RICH300_CLOSE_SEND_APPROVED 가 없으면 보내지 않고, 둘 다 켜지면 평가액 미입력 알림 1회(URL 버튼 포함)·재실행 시 중복 없음', () => {
  const a = load({ now: NOW_D2, closeNotify: true }); a.setupChallenge(); a.pair(); const n0 = a.tele.sent.length; a.ctx.rich300CloseTick(); assert.equal(a.tele.sent.length, n0); assert.equal(a.rows('closenotice')[0].error, 'not-approved');
  const b = load({ now: NOW_D2, closeNotify: true, approved: true }); b.setupChallenge(); b.pair(); const m0 = b.tele.sent.length; b.ctx.rich300CloseTick(); b.ctx.rich300CloseTick(); b.ctx.rich300CloseTick();
  assert.equal(b.tele.sent.length, m0 + 1); const msg = b.tele.sent.at(-1); assert.match(msg.text, /^RICH300 · 2026-10-24 마감 평가액 미입력\n장부 잔고 300\.00 USDT/); assert.equal(msg.reply_markup.inline_keyboard[0][0].url, 'https://example.com/exec?p=journal&day=2026-10-24#close'); assert.equal(b.rows('closenotice')[0].status, 'sent');
  const c = load({ now: NOW_D2, closeNotify: true, approved: true }); c.setupChallenge(); const k0 = c.tele.sent.length; c.ctx.rich300CloseTick(); assert.equal(c.tele.sent.length, k0); assert.equal(c.rows('closenotice')[0].status, 'failed');              // 페어링 전: 실패로 기록(재시도 가능)
});
test('Journal.gs: 로그·콘솔 출력 없음, 토큰 문자열 없음', () => { const src = read('Journal.gs'); assert.ok(!/console\.|Logger\.log/.test(src)); assert.ok(!/\d{6,}:[A-Za-z0-9_-]{30,}/.test(src)); });
