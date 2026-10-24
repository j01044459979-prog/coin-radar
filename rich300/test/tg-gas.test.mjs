import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { buildEngine } from '../build.mjs';
import { fakeSheetsServices, fakeCache } from './helpers/gasfakes.mjs';
import { fakeTelegram, FAKE_TOKEN, OWNER } from './helpers/faketg.mjs';

const j = v => JSON.parse(JSON.stringify(v));      // vm 컨텍스트 객체는 prototype이 달라 deepEqual이 실패하므로 JSON으로 정규화
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const SIG = { sid: 'A-BTC-1', strategy: 'A', symbolId: 'BTCUSDT', dir: 'LONG', signalAt: 1790000000000, entry: '100', stop: '98', tp1: '103' };
function load({ email = 'me@example.com', token = FAKE_TOKEN, fetchThrows = false } = {}) {
  const sheets = fakeSheetsServices(), tele = fakeTelegram(), cache = fakeCache({ t: 0 }), spy = { logs: [], urls: [], triggers: [], pages: [] }, pm = new Map(Object.entries({ RICH300_SHEET_ID: 'sheet', RICH300_OWNER_EMAIL: 'me@example.com', RICH300_UI_URL: 'https://example.com/exec', RICH300_ENV: 'test', RICH300_TEST_TG_ALLOW: 'yes', ...(token ? { RICH300_TG_TOKEN: token } : {}) }));
  const props = { getProperty: k => (pm.has(k) ? pm.get(k) : null), setProperty: (k, v) => { pm.set(k, String(v)); }, deleteProperty: k => { pm.delete(k); }, getKeys: () => [...pm.keys()] };
  const ContentService = { MimeType: { JSON: 'json', TEXT: 'text' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) };
  const ctx = { console: { log: (...a) => spy.logs.push(a.join(' ')) }, Logger: { log: (...a) => spy.logs.push(a.join(' ')) }, ...sheets.ctx, ContentService, CacheService: cache.service, PropertiesService: { getScriptProperties: () => props },
    Session: { getActiveUser: () => ({ getEmail: () => email }) },
    Utilities: { ...sheets.ctx.Utilities, getUuid: () => randomUUID(), sleep: ms => { tele.sleeps.push(ms); } },
    UrlFetchApp: { fetch: (url, opt) => { spy.urls.push(url); if (fetchThrows) throw new Error(`DNS failure for ${url}`); const m = /\/bot[^/]+\/(\w+)$/.exec(url)[1]; const r = tele.http.call(m, JSON.parse(opt.payload)); return { getResponseCode: () => r.status, getContentText: () => JSON.stringify(r.body) }; } },
    ScriptApp: { getProjectTriggers: () => spy.triggers.filter(t => !t.deleted), deleteTrigger: t => { t.deleted = true; }, newTrigger: fn => { const t = { fn, getHandlerFunction: () => fn, deleted: false }; return { timeBased: () => ({ everyMinutes: n => ({ create: () => { t.every = n; spy.triggers.push(t); } }) }) }; } },
    HtmlService: { createTemplateFromFile: name => { const t = { name, evaluate: () => { const o = { title: '', meta: [], setTitle(x) { this.title = x; return this; }, addMetaTag(a, b) { this.meta.push([a, b]); return this; }, preset: t.preset }; spy.pages.push(o); return o; } }; return t; } } };
  vm.createContext(ctx);
  vm.runInContext([buildEngine(), read('gas/Adapters.gs'), read('gas/Api.gs'), read('gas/Telegram.gs'), read('gas/Deploy.gs')].join('\n'), ctx);
  const E = () => ctx.RICH300_ENGINE;
  const storeEnv = () => ctx.rich300GasEnv_('sheet');
  return { ctx, tele, spy, pm, sheets, E, storeEnv, rows: n => { const env = storeEnv(); return j(E().storeList(env, n).map(r => r.data)); } };
}
function pairOwner(g) { const r = g.ctx.rich300TgPairCode(); assert.equal(r.ok, true); g.tele.say(OWNER, `/pair ${r.code}`); g.ctx.rich300TgPoll(); }

test('Telegram.gs(가짜 Apps Script): 페어링 → 신호 버튼 → /fill 저장 → 청산 → 복기, 시트는 텍스트 서식으로 형변환 없이 저장', () => {
  const g = load(); g.E().storeInit(g.storeEnv()); g.E().storeCreate(g.storeEnv(), 'signal', SIG, { actor: 't' });
  pairOwner(g); assert.match(g.tele.sent.at(-1).text, /연결 완료/);
  const send = g.E().tgSendSignalPrompt(g.ctx.rich300TgEnv_(), OWNER, 'A-BTC-1'); assert.equal(send.ok, true);
  const m = g.tele.sent.at(-1); g.tele.click(OWNER, m, 'r1:A-BTC-1:e'); g.ctx.rich300TgPoll();
  assert.deepEqual(g.rows('response').map(r => r.choice), ['entered']);
  g.tele.say(OWNER, '/fill A-BTC-1 30 10 100 98'); g.ctx.rich300TgPoll(); let d = g.tele.sent.at(-1); g.tele.click(OWNER, d, d.reply_markup.inline_keyboard[0][0].callback_data); g.ctx.rich300TgPoll();
  g.tele.say(OWNER, '/exit A-BTC-1 101'); g.ctx.rich300TgPoll(); d = g.tele.sent.at(-1); g.tele.click(OWNER, d, d.reply_markup.inline_keyboard[0][0].callback_data); g.ctx.rich300TgPoll();
  assert.deepEqual(g.rows('fill').map(f => [f.kind, f.price, f.qty]).sort(), [['close', '101', '3'], ['entry', '100', '3']]);
  const p = g.tele.sent.at(-1); assert.match(p.text, /^복기 · A-BTC-1/); g.tele.click(OWNER, p, p.reply_markup.inline_keyboard[2][0].callback_data); g.ctx.rich300TgPoll();
  assert.equal(g.rows('review')[0].plan, 'plan_ok'); assert.equal(j(g.E().storeIntegrityCheck(g.storeEnv())).ok, true);
  assert.equal(JSON.parse(g.pm.get('tg:last')).r.status, 'ok');
});
test('Telegram.gs: 토큰은 요청 URL에만 쓰이고 속성·로그·결과·오류에 나오지 않으며(네트워크 오류 메시지에 URL이 있어도), 토큰 미설정이면 안전하게 실패', () => {
  const g = load(); g.E().storeInit(g.storeEnv()); pairOwner(g);
  g.tele.say(OWNER, '/help'); g.ctx.rich300TgPoll();
  assert.ok(g.spy.urls.length > 0 && g.spy.urls.every(u => u.startsWith(`https://api.telegram.org/bot${FAKE_TOKEN}/`)));
  const dump = JSON.stringify([...g.pm.entries().filter(([k]) => k !== 'RICH300_TG_TOKEN')], null, 0) + g.spy.logs.join('\n'); assert.ok(!dump.includes(FAKE_TOKEN) && !dump.includes('AAFake')); assert.equal(g.spy.logs.length, 0);
  const bad = load({ fetchThrows: true }); bad.E().storeInit(bad.storeEnv()); const r = j(bad.ctx.rich300TgPoll()); assert.deepEqual([r.status, r.code], ['error', 'network']);
  assert.ok(!JSON.stringify([...bad.pm.entries().filter(([k]) => k !== 'RICH300_TG_TOKEN')]).includes(FAKE_TOKEN)); assert.ok(!JSON.stringify(r).includes('DNS'));
  const none = load({ token: null }); none.E().storeInit(none.storeEnv()); const r2 = none.ctx.rich300TgPoll(); assert.equal(r2.status, 'error'); assert.equal(none.spy.urls.length, 0);
  assert.ok(!/console\.|Logger\.log/.test(read('gas/Telegram.gs')));
});
test('Telegram.gs: 폴링 트리거 설치는 1분 1개(중복 설치 시 교체)·제거 가능, 페어링 코드는 소유자 확인 필요', () => {
  const g = load(); g.ctx.rich300TgInstallPollTrigger(); g.ctx.rich300TgInstallPollTrigger(); assert.equal(g.spy.triggers.filter(t => !t.deleted).length, 1); assert.equal(g.spy.triggers.at(-1).every, 1); g.ctx.rich300TgRemovePollTrigger(); assert.equal(g.spy.triggers.filter(t => !t.deleted).length, 0);
  assert.deepEqual(j(load({ email: 'other@example.com' }).ctx.rich300TgPairCode()), { ok: false, error: 'forbidden' }); assert.deepEqual(j(load({ email: '' }).ctx.rich300TgPairCode()), { ok: false, error: 'forbidden' });
});
test('입력 화면: ?p=fill 은 소유자만, 서버가 값을 JSON으로 주입(< 이스케이프), 제출은 소유자만·중복 제출 1건, HTML은 외부 스크립트·innerHTML 없음', () => {
  const g = load(); g.E().storeInit(g.storeEnv()); g.E().storeCreate(g.storeEnv(), 'signal', SIG, { actor: 't' });
  const out = g.ctx.doGet({ parameter: { p: 'fill', sid: 'A-BTC-1</script><b>', dir: 'LONG', entry: '100', stop: '98' } }); assert.equal(out.title, '입력'.length ? 'RICH300 입력' : '');
  assert.ok(!out.preset.includes('<') && JSON.parse(out.preset.replace(/\\u003c/g, '<')).sid.includes('</script>')); assert.deepEqual(out.meta, [['viewport', 'width=device-width, initial-scale=1']]);
  const other = load({ email: 'other@example.com' }); assert.equal(other.ctx.doGet({ parameter: { p: 'fill' } }).text, ''); assert.deepEqual(j(other.ctx.rich300FillSubmit({ sid: 'A-BTC-1' })), { ok: false, error: 'forbidden' });
  const form = { sid: 'A-BTC-1', margin: '30', leverage: '10', entry: '100', stop: '98', formId: 'abc123' };
  assert.deepEqual([g.ctx.rich300FillSubmit(form).ok, g.ctx.rich300FillSubmit(form).status], [true, 'duplicate']); assert.equal(g.rows('fill').length, 1);
  const html = read('gas/Fill.html'); assert.ok(!/<script[^>]+src=/i.test(html) && !/https?:\/\//.test(html.replace(/<\?!=[^?]*\?>/g, ''))); assert.ok(!/innerHTML|eval\(|document\.write/.test(html));
  const js = /<script>([\s\S]*?)<\/script>/.exec(html)[1].replace('<?!= preset ?>', '{}'); assert.doesNotThrow(() => new vm.Script(js)); assert.ok(html.includes('rich300FillSubmit') && html.includes('viewport') === false);
  assert.ok(/inputmode="decimal"/.test(html) && /prefers-color-scheme/.test(html));
});
test('tgGc: 만료된 초안·오래된 복기 표시만 지우고 1시간에 한 번만 실행', () => {
  const g = load(); const env = g.ctx.rich300TgEnv_(), E = g.E(); const now = Date.now();
  g.pm.set('tg:d:old', JSON.stringify({ v: { x: 1 }, exp: now - 1000 })); g.pm.set('tg:d:live', JSON.stringify({ v: { x: 1 }, exp: now + 600000 })); g.pm.set('tg:rp:A', String(now - 31 * 86400000)); g.pm.set('tg:rp:B', String(now)); g.pm.set('tg:paired', JSON.stringify({ v: { userId: 1 }, exp: 0 }));
  assert.deepEqual(j(E.tgGc(env)), { ran: true, removed: 2 }); assert.deepEqual(j(E.tgGc(env)), { ran: false });
  assert.ok(!g.pm.has('tg:d:old') && g.pm.has('tg:d:live') && !g.pm.has('tg:rp:A') && g.pm.has('tg:rp:B') && g.pm.has('tg:paired'));
});
