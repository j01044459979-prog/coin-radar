// ?p=pos 포지션 등록 화면 실제 브라우저 검증(320/390px). google.script.run 은 가짜로 대체(서버·시세·Telegram 호출 없음). Playwright 가 없으면 건너뛴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { manualRenderHtml } from '../lib/manualview.mjs';

const PW = process.env.RICH300_PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright', CH = process.env.RICH300_CHROMIUM ?? '/opt/pw-browsers/chromium', skip = { skip: !existsSync(PW) && 'playwright 없음' };
const STUB = `<script>window.__calls=[];window.__resp={ok:true,status:'added',symbolId:'SOLUSDT',dir:'LONG',entry:'140',qty:'2',stop:'135',warnings:['레버리지 10배 — 운영 원칙(최대 3배)을 넘습니다']};window.__mode='ok';
window.google={script:{run:{withSuccessHandler:function(s){var f=null,o=new Proxy({},{get:function(t,k){if(k==='withFailureHandler')return function(x){f=x;return o};return function(){window.__calls.push([k,[].slice.call(arguments)]);setTimeout(function(){if(window.__mode==='fail')f(new Error('boom'));else s(window.__resp)},10)}}});return o}}}};</script>`;
const OPEN = [{ sid: 'M-SOL-L-abc', symbolId: 'SOLUSDT', dir: 'LONG', stop: '135', tp1: '148', tp2: undefined, avgEntry: 140, openQty: 2, symbolCheck: 'ok' }];
const html = (open = []) => manualRenderHtml({ open, appUrl: 'https://script.google.com/macros/s/X/exec', build: 'b', now: 1790000000000 }).replace('<body>', `<body>${STUB}`);
async function withPage(fn, { w = 390, open = [] } = {}) {
  const { chromium } = createRequire(PW)(PW), b = await chromium.launch(existsSync(CH) ? { executablePath: CH } : {});
  try { const p = await (await b.newContext({ viewport: { width: w, height: 844 } })).newPage(), errs = []; p.on('pageerror', e => errs.push(String(e))); await p.setContent(html(open)); await fn(p, errs); } finally { await b.close(); }
}
test('입력 보조: 값을 넣으면 손절 거리·예상 손실·R 이 계산되고, 증거금만 넣으면 수량이 계산된다 · 방향이 반대면 경고', skip, () => withPage(async (p, errs) => {
  await p.click('button[data-sym="ETH"]'); assert.equal(await p.inputValue('#sym'), 'ETH');
  await p.fill('#entry', '140'); await p.fill('#stop', '135'); await p.fill('#qty', '2'); await p.fill('#tp1', '147.5'); await p.fill('#tp2', '152');
  const t = await p.textContent('#calc'); assert.match(t, /손절까지 3\.57%/); assert.match(t, /손절 시 손실 약 10\.00 USDT/); assert.match(t, /1차 익절 1\.50R/); assert.match(t, /2차 익절 2\.40R/);
  await p.fill('#qty', ''); await p.fill('#margin', '90'); await p.fill('#lev', '3'); assert.match(await p.textContent('#calc'), /수량 1\.92857\(계산\)/);
  await p.click('#dS'); assert.match(await p.textContent('#calc'), /SHORT 손절가는 진입가보다 위/); assert.deepEqual(errs, []);
}));
test('저장: 입력값이 그대로 서버 함수로 전달되고 결과·경고가 버튼 아래에 보이며 버튼이 다시 켜진다 · 새로고침 링크 표시', skip, () => withPage(async (p, errs) => {
  assert.equal(await p.isVisible('#reload'), false);
  await p.fill('#sym', 'sol'); await p.fill('#entry', '140'); await p.fill('#qty', '2'); await p.fill('#lev', '10'); await p.fill('#stop', '135'); await p.fill('#tp1', '148'); await p.click('#go');
  await p.waitForFunction(() => /저장됨/.test(document.getElementById('msg').textContent)); const c = await p.evaluate(() => window.__calls[0]);
  assert.equal(c[0], 'rich300ManualRegister'); assert.deepEqual({ symbol: c[1][0].symbol, dir: c[1][0].dir, entry: c[1][0].entry, qty: c[1][0].qty, leverage: c[1][0].leverage, stop: c[1][0].stop, tp1: c[1][0].tp1 }, { symbol: 'sol', dir: 'LONG', entry: '140', qty: '2', leverage: '10', stop: '135', tp1: '148' });
  assert.match(c[1][0].formId, /^[A-Za-z0-9]{6,10}$/); const m = await p.textContent('#msg'); assert.match(m, /SOLUSDT LONG/); assert.match(m, /⚠ 레버리지 10배/); assert.equal(await p.isDisabled('#go'), false); assert.equal(await p.isVisible('#reload'), true);
  await p.click('#go'); await p.waitForFunction(() => window.__calls.length === 2); assert.equal(await p.evaluate(() => window.__calls[1][1][0].formId === window.__calls[0][1][0].formId), true);       // 같은 화면 재제출은 같은 formId(서버가 1건만 기록)
  assert.deepEqual(errs, []);
}));
test('저장 실패: 서버 오류 사유가 그대로 보이고 입력은 유지 · 호출 실패는 중복 저장되지 않는다는 안내 · 서버 연결 없음 안내', skip, () => withPage(async (p) => {
  await p.evaluate(() => { window.__resp = { ok: false, error: 'invalid', message: 'LONG 손절가는 진입가보다 아래여야 합니다' }; }); await p.fill('#sym', 'btc'); await p.fill('#entry', '100'); await p.fill('#stop', '110'); await p.click('#go');
  await p.waitForFunction(() => /손절가는 진입가보다 아래/.test(document.getElementById('msg').textContent)); assert.equal(await p.inputValue('#stop'), '110'); assert.equal(await p.isDisabled('#go'), false); assert.equal(await p.isVisible('#reload'), false);
  await p.evaluate(() => { window.__mode = 'fail'; }); await p.click('#go'); await p.waitForFunction(() => /서버 호출 실패/.test(document.getElementById('msg').textContent)); assert.match(await p.textContent('#msg'), /중복 저장되지 않습니다/);
  await p.evaluate(() => { window.google = undefined; }); await p.click('#go'); assert.match(await p.textContent('#msg'), /google\.script\.run/);
}));
test('보유 목록: 종목·평균·손절·익절 표시 · 청산 기록 링크 · 손절·익절 수정이 서버 함수로 전달된다', skip, () => withPage(async (p) => {
  const t = await p.textContent('.pc'); assert.match(t, /SOL/); assert.match(t, /평균 140/); assert.match(t, /손절 135/); assert.match(t, /1차 익절 148/); assert.match(t, /2차 익절 —/);
  assert.match(await p.getAttribute('.pc a.mini', 'href'), /p=fill&mode=exit&sid=M-SOL-L-abc$/); assert.equal(await p.isVisible('.edbox'), false);
  await p.click('.ed'); assert.equal(await p.isVisible('.edbox'), true); await p.fill('.e-stop', '138'); await p.fill('.e-tp1', '150'); await p.fill('.e-tp2', ''); await p.evaluate(() => { window.__resp = { ok: true, status: 'revised', stop: '138', tp1: '150', tp2: null }; }); await p.click('.e-save');
  await p.waitForFunction(() => /수정 저장됨/.test(document.querySelector('.e-msg').textContent)); const c = await p.evaluate(() => window.__calls[0]); assert.deepEqual([c[0], c[1][0], c[1][1]], ['rich300ManualUpdate', 'M-SOL-L-abc', { stop: '138', tp1: '150', tp2: '' }]);
}, { open: OPEN }));
test('모바일 폭 320/390: 가로 넘침 없음 · 입력과 버튼 높이 40px 이상 · 메뉴가 가로 스크롤로 접근 가능', skip, async () => { for (const w of [320, 390]) await withPage(async (p) => {
  const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, small: [...document.querySelectorAll('input,button.go,.seg button,.chips button,.mini')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 38).map(e => e.id || e.className)}));
  assert.ok(r.sw <= r.cw, `가로 넘침 ${r.sw}>${r.cw}`); assert.deepEqual(r.small, []);
}, { w, open: OPEN }); });
