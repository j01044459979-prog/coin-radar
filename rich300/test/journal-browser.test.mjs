// 일지 화면 실제 브라우저 검증(Chromium). google.script.run 은 스텁으로 대체해 전송 인자·중복 방지·오류 표시를 확인한다. Playwright가 없으면 건너뜀.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { memEnv } from './helpers/memenv.mjs';
import { storeInit, storeCreate, storeSetupChallenge } from '../lib/store.mjs';
import { journalBuild, journalAddCashflow } from '../lib/journal.mjs';
import { journalRenderHtml } from '../lib/journalview.mjs';
import { closeRun } from '../lib/close.mjs';
import { dayStartMs } from '../lib/time.mjs';

const PW = process.env.RICH300_PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright', CH = process.env.RICH300_CHROMIUM ?? '/opt/pw-browsers/chromium', have = existsSync(PW);
const D1 = '2026-10-24', D2 = '2026-10-25', H = 3600000, A = { actor: 't' };
function html() {
  const m = memEnv(); storeInit(m.env); storeSetupChallenge(m.env, { startEquity: '300', startDay: D1, rate: '0.05' }, A);
  const env = { now: () => dayStartMs(D2) + 3 * H, storeEnv: () => m.env, sendEnabled: () => false }, at = dayStartMs(D1) + 10 * H;
  storeCreate(m.env, 'signal', { sid: 'A-1', strategy: 'A', symbolId: 'BTCUSDT', dir: 'LONG', signalAt: at - H, entry: '100', stop: '98', tp1: '103' }, A);
  for (const f of [{ fillId: 'in', kind: 'entry', at, price: '100', qty: '3' }, { fillId: 'out', kind: 'close', at: at + H, price: '103', qty: '3' }]) storeCreate(m.env, 'fill', { origin: 'real', sid: 'A-1', dir: 'LONG', fee: { state: 'entered', amount: '0.1' }, funding: { state: 'missing' }, ...f }, A);
  journalAddCashflow(env, { cfId: 'abcdef12', amount: '10', note: '입금', at: at - 2 * H }); closeRun(env); return journalRenderHtml(journalBuild(env), { appUrl: 'https://example.com/exec' });
}
async function withPage(fn, { w = 390 } = {}) {
  const { chromium } = createRequire(PW)(PW), b = await chromium.launch(existsSync(CH) ? { executablePath: CH } : {});
  try { const p = await (await b.newContext({ viewport: { width: w, height: 844 } })).newPage(), errs = []; p.on('pageerror', e => errs.push(String(e))); await p.setContent(html());
    await p.evaluate(() => { window.__calls = []; window.__next = { ok: true, message: '저장됨' }; window.__mode = 'ok'; window.google = { script: { run: { withSuccessHandler(s) { return { withFailureHandler(f) { return new Proxy({}, { get: (_, name) => (...args) => { window.__calls.push({ name, args }); setTimeout(() => (window.__mode === 'fail' ? f(new Error('x')) : s(window.__next)), 0); } }); } }; } } } }; });
    return await fn(p, errs); } finally { await b.close(); }
}
test('일지 화면: 390/320px 가로 넘침 없음·오류 없음·터치 대상 44px 근처', { skip: !have && 'playwright 없음' }, async () => { for (const w of [390, 320]) await withPage(async (p, errs) => { const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); assert.ok(m.sw <= m.cw, `넘침 ${m.sw}>${m.cw} @${w}`); assert.deepEqual(errs, []); const small = await p.evaluate(() => [...document.querySelectorAll('button.act')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 43).length); assert.equal(small, 0); }, { w }); });
test('평가액 입력: 전송 인자·결과 표시·진행 중 중복 클릭 방지·연결 오류 표시', { skip: !have && 'playwright 없음' }, async () => withPage(async p => {
  await p.fill('#eqVal', '305.5'); await p.fill('#eqUn', '1'); await p.click('#eqForm button[type=submit]'); await p.waitForFunction(() => document.getElementById('eqOut').textContent.length > 0);
  const calls = await p.evaluate(() => window.__calls); assert.deepEqual(calls.map(c => c.name), ['rich300EquitySubmit']); assert.deepEqual(calls[0].args[0], { day: '2026-10-24', equity: '305.5', unrealized: '1', reason: '' }); assert.equal(await p.textContent('#eqOut'), '저장됨');
  assert.equal(await p.isDisabled('#eqForm button[type=submit]'), false);
  await p.evaluate(() => { window.__mode = 'fail'; }); await p.click('#eqForm button[type=submit]'); await p.waitForFunction(() => /연결 오류/.test(document.getElementById('eqOut').textContent)); assert.match(await p.textContent('#eqOut'), /중복 저장되지 않습니다/); assert.equal(await p.isDisabled('#eqForm button[type=submit]'), false);
  await p.evaluate(() => { window.__mode = 'ok'; window.__next = { ok: false, error: 'invalid', message: '미래 날짜에는 입력할 수 없습니다' }; }); await p.click('#eqForm button[type=submit]'); await p.waitForFunction(() => /미래 날짜/.test(document.getElementById('eqOut').textContent)); assert.equal(await p.getAttribute('#eqOut', 'class'), 'out bad');
}));
test('체결 수정: 사유 필수·바뀐 값만 전송(수수료 ~추정/비움=미입력 변환)·취소 호출', { skip: !have && 'playwright 없음' }, async () => withPage(async p => {
  await p.click('details.trade > summary'); await p.click('details.edit:has(form[data-fill="out"]) > summary'); const form = p.locator('form.fillForm[data-fill="out"]');
  await form.locator('input[name=price]').fill('104'); await form.locator('button[data-act=revise]').click(); assert.match(await form.locator('.out').textContent(), /사유를 입력해 주세요/); assert.equal((await p.evaluate(() => window.__calls)).length, 0);
  await form.locator('input[name=reason]').fill('재확인'); await form.locator('button[data-act=revise]').click(); await p.waitForFunction(() => window.__calls.length === 1);
  let c = (await p.evaluate(() => window.__calls))[0]; assert.deepEqual([c.name, c.args], ['rich300JournalReviseFill', ['out', { price: '104' }, '재확인']]);
  await form.locator('input[name=fee]').fill('~0.25'); await form.locator('input[name=funding]').fill('-0.01'); await form.locator('button[data-act=revise]').click(); await p.waitForFunction(() => window.__calls.length === 2);
  c = (await p.evaluate(() => window.__calls))[1]; assert.deepEqual(c.args[1], { price: '104', fee: { state: 'estimated', amount: '0.25' }, funding: { state: 'entered', amount: '-0.01' } });   // 비교 기준은 화면이 열릴 때의 원래 값
  await form.locator('input[name=fee]').fill(''); await form.locator('input[name=price]').fill('103'); await form.locator('input[name=funding]').fill(''); await form.locator('button[data-act=revise]').click(); await p.waitForFunction(() => window.__calls.length === 3);
  c = (await p.evaluate(() => window.__calls))[2]; assert.deepEqual(c.args[1], { fee: { state: 'missing' } });                       // 원래 값과 같은 칸(가격·펀딩)은 보내지 않는다
  await form.locator('input[name=fee]').fill('0.1'); await form.locator('button[data-act=revise]').click(); assert.match(await form.locator('.out').textContent(), /바뀐 값이 없습니다/); assert.equal((await p.evaluate(() => window.__calls)).length, 3);
  await form.locator('button[data-act=void]').click(); await p.waitForFunction(() => window.__calls.length === 4); c = (await p.evaluate(() => window.__calls))[3]; assert.deepEqual([c.name, c.args], ['rich300JournalVoidFill', ['out', '재확인']]);
  await p.evaluate(() => { document.querySelector('form.fillForm[data-fill="out"] input[name=reason]').value = ''; }); const n = (await p.evaluate(() => window.__calls)).length; await form.locator('button[data-act=void]').click(); assert.equal((await p.evaluate(() => window.__calls)).length, n);
}));
test('입출금: 같은 formId로 재시도(실패 후), 성공하면 새 formId·취소 폼은 사유 필수', { skip: !have && 'playwright 없음' }, async () => withPage(async p => {
  await p.fill('#cfAmt', '25'); await p.fill('#cfNote', '입금'); await p.evaluate(() => { window.__mode = 'fail'; }); await p.click('#cfForm button[type=submit]'); await p.waitForFunction(() => /연결 오류/.test(document.getElementById('cfOut').textContent));
  await p.evaluate(() => { window.__mode = 'ok'; }); await p.click('#cfForm button[type=submit]'); await p.waitForFunction(() => window.__calls.length === 2); const [c1, c2] = await p.evaluate(() => window.__calls); assert.equal(c1.args[0].formId, c2.args[0].formId); assert.deepEqual([c1.name, c1.args[0].amount, c1.args[0].note], ['rich300CashflowSubmit', '25', '입금']);
  await p.waitForFunction(() => document.getElementById('cfOut').textContent === '저장됨'); await p.click('#cfForm button[type=submit]'); await p.waitForFunction(() => window.__calls.length === 3); const c3 = (await p.evaluate(() => window.__calls))[2]; assert.notEqual(c3.args[0].formId, c2.args[0].formId);
  const f = p.locator('form.cfVoid'); await f.locator('button').click(); assert.match(await f.locator('.out').textContent(), /사유를 입력해 주세요/); await f.locator('input[name=reason]').fill('오입력'); await f.locator('button').click(); await p.waitForFunction(() => window.__calls.length === 4); const c4 = (await p.evaluate(() => window.__calls))[3]; assert.deepEqual([c4.name, c4.args], ['rich300CashflowVoid', ['cf-abcdef12', '오입력']]);
}));
