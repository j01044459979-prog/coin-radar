// ?p=tg 토큰 저장 화면 실제 브라우저 검증(390px). google.script.run 은 가짜로 대체(서버·Telegram 호출 없음). 입력값은 가짜 형식 문자열뿐. Playwright 가 없으면 건너뛴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { loadProd } from './helpers/gasprod.mjs';

const PW = process.env.RICH300_PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright', CH = process.env.RICH300_CHROMIUM ?? '/opt/pw-browsers/chromium', have = existsSync(PW), skip = { skip: !have && 'playwright 없음' };
const FAKE = '123456789:' + 'Z'.repeat(35);
const STUB = `<script>window.__calls=[];window.__resp={ok:false,code:'bad-format',detail:{len:3,hasColon:false,idDigits:0,secretLen:0}};window.__mode='ok';
window.google={script:{run:{withSuccessHandler:function(s){var f=null,o=new Proxy({},{get:function(t,k){if(k==='withFailureHandler')return function(x){f=x;return o};return function(){window.__calls.push([k,[].slice.call(arguments)]);setTimeout(function(){if(window.__mode==='fail')f(new Error('boom 123456789:'+'Z'.repeat(35)));else s(window.__resp)},10)}}});return o}}}};</script>`;
function html() { const g = loadProd({ props: { RICH300_TG_TOKEN: '' } }); g.ctx.rich300Install(); return g.ctx.doGet({ parameter: { p: 'tg' } }).html.replace(/<body>/, `<body>${STUB}`); }
async function withPage(fn, { noGoogle = false } = {}) {
  const { chromium } = createRequire(PW)(PW), b = await chromium.launch(existsSync(CH) ? { executablePath: CH } : {});
  try { const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage(), errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.setContent(html().replace(noGoogle ? STUB : '\u0000', noGoogle ? '' : '')); await fn(p, errs); } finally { await b.close(); }
}
test('토큰 저장: 형식 오류는 버튼 바로 아래에 이유를 보이고, 입력은 지우지 않고 버튼을 다시 켠다', skip, () => withPage(async (p, errs) => {
  await p.fill('#tok', 'abc'); await p.click('#tokBtn'); await p.waitForFunction(() => /저장하지 않음\[bad-format\]/.test(document.getElementById('tokMsg').textContent));
  assert.match(await p.textContent('#tokMsg'), /길이 3, 콜론 없음/); assert.equal(await p.inputValue('#tok'), 'abc'); assert.equal(await p.isDisabled('#tokBtn'), false);
  assert.equal(await p.isVisible('#tokMsg'), true); assert.deepEqual(errs, []);
}));
test('토큰 저장: 성공하면 "토큰 있음"으로 바뀌고 입력칸·버튼이 사라지며 값이 화면에 남지 않는다', skip, () => withPage(async (p, errs) => {
  await p.evaluate(() => { window.__resp = { ok: true, code: 'saved-verified', detail: null }; });
  await p.fill('#tok', FAKE); await p.click('#tokBtn'); await p.waitForFunction(() => /토큰 있음/.test(document.getElementById('tokMsg').textContent));
  const call = await p.evaluate(() => window.__calls[0]); assert.equal(call[0], 'rich300TgSetToken'); assert.equal(call[1][0], FAKE);
  assert.equal(await p.isVisible('#tok'), false); assert.equal(await p.isVisible('#tokBtn'), false); assert.ok(!(await p.content()).includes(FAKE.split(':')[1])); assert.deepEqual(errs, []);
}));
test('토큰 저장: 서버 호출 실패 시 오류가 보이고(토큰 모양은 가림) 버튼이 다시 켜진다 · 빈 입력은 호출하지 않는다', skip, () => withPage(async (p) => {
  await p.click('#tokBtn'); assert.match(await p.textContent('#tokMsg'), /비어 있습니다/); assert.equal(await p.evaluate(() => window.__calls.length), 0);
  await p.evaluate(() => { window.__mode = 'fail'; }); await p.fill('#tok', FAKE); await p.click('#tokBtn'); await p.waitForFunction(() => /서버 호출 실패/.test(document.getElementById('tokMsg').textContent));
  const t = await p.textContent('#tokMsg'); assert.ok(!t.includes('ZZZZZ')); assert.match(t, /\[가림\]/); assert.equal(await p.isDisabled('#tokBtn'), false);
}));
test('google.script.run 이 없으면 이유를 안내한다', skip, () => withPage(async (p) => {
  await p.fill('#tok', FAKE); await p.click('#tokBtn'); assert.match(await p.textContent('#tokMsg'), /google\.script\.run/); assert.equal(await p.isDisabled('#tokBtn'), false);
}, { noGoogle: true }));
