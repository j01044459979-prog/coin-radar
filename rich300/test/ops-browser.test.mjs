// ?p=ops 실전 감시 관리 화면 브라우저 검증(390/320px). google.script.run 은 가짜(서버·시세·Telegram 호출 없음). Playwright 가 없으면 건너뛴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { opsRenderHtml } from '../lib/opsview.mjs';

const PW = process.env.RICH300_PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright', CH = process.env.RICH300_CHROMIUM ?? '/opt/pw-browsers/chromium', skip = { skip: !existsSync(PW) && 'playwright 없음' };
const STUB = `<script>window.__calls=[];window.__resp={};window.__mode='ok';
window.google={script:{run:{withSuccessHandler:function(s){var f=null,o=new Proxy({},{get:function(t,k){if(k==='withFailureHandler')return function(x){f=x;return o};return function(){window.__calls.push([k,[].slice.call(arguments)]);setTimeout(function(){if(window.__mode==='fail')f(new Error('boom'));else s(window.__resp[k])},10)}}});return o}}}};</script>`;
const M = { env: 'prod', tokenSet: true, paired: true, prodApproved: false, gateSend: 'prod-not-approved', prop: 'unset', mode: 'off', effective: 'nothing', triggers: 0, last: null, positions: 0, precheck: null, opsLast: null };
const html = (m = M) => opsRenderHtml({ m, appUrl: 'https://script.google.com/macros/s/X/exec', build: 'b' }).replace('<body>', `<body>${STUB}`);
async function withPage(fn, { w = 390, m = M } = {}) {
  const { chromium } = createRequire(PW)(PW), b = await chromium.launch(existsSync(CH) ? { executablePath: CH } : {});
  try { const p = await (await b.newContext({ viewport: { width: w, height: 844 } })).newPage(), errs = []; p.on('pageerror', e => errs.push(String(e))); await p.setContent(html(m)); await fn(p, errs); } finally { await b.close(); }
}
const PASS = { ok: true, pass: true, items: [{ id: 'token', must: true, ok: true, text: 'Telegram 봇 토큰 있음' }, { id: 'net', must: true, ok: true, text: '시세 연결 2/2 정상' }] };
const FAIL = { ok: true, pass: false, items: [{ id: 'net', must: true, ok: false, text: '시세 연결 1/2 정상 — 실패: SOLUSDT(stale-price)' }] };

test('시작 버튼은 사전 점검 통과 + 확인 문구 입력 전에는 비활성 · 점검 실패면 계속 비활성', skip, () => withPage(async (p, errs) => {
  assert.equal(await p.isDisabled('#on'), true); await p.fill('#phrase', '실전 감시 시작'); assert.equal(await p.isDisabled('#on'), true);                       // 점검 전
  await p.evaluate(f => { window.__resp.rich300OpsPrecheck = f; }, FAIL); await p.click('#pre'); await p.waitForFunction(() => /사전 점검 실패/.test(document.getElementById('preMsg').textContent));
  assert.match(await p.textContent('#preList'), /✗ 시세 연결 1\/2 정상/); assert.equal(await p.isDisabled('#on'), true);
  await p.evaluate(f => { window.__resp.rich300OpsPrecheck = f; }, PASS); await p.click('#pre'); await p.waitForFunction(() => /사전 점검 통과/.test(document.getElementById('preMsg').textContent));
  assert.match(await p.textContent('#preList'), /✓ Telegram 봇 토큰 있음/); assert.equal(await p.isDisabled('#on'), false);
  await p.fill('#phrase', '실전'); assert.equal(await p.isDisabled('#on'), true); await p.fill('#phrase', ' 실전 감시 시작 '); assert.equal(await p.isDisabled('#on'), false); assert.deepEqual(errs, []);
}));
test('시작: 문구만 서버로 전달(이름·값 없음) · 성공 메시지와 새로고침 링크 · 서버 거부 사유는 버튼 아래에 · 중복 클릭은 1회만 호출', skip, () => withPage(async (p) => {
  await p.evaluate(f => { window.__resp.rich300OpsPrecheck = f; }, PASS); await p.click('#pre'); await p.waitForFunction(() => /통과/.test(document.getElementById('preMsg').textContent)); await p.fill('#phrase', '실전 감시 시작');
  await p.evaluate(() => { window.__resp.rich300OpsEnable = { ok: false, code: 'verify-failed', rolledBack: true }; }); await p.click('#on'); await p.waitForFunction(() => /시작하지 않았습니다/.test(document.getElementById('onMsg').textContent));
  assert.match(await p.textContent('#onMsg'), /\[verify-failed\]/); assert.match(await p.textContent('#onMsg'), /이전 상태로 되돌렸습니다/); assert.equal(await p.isVisible('#reload'), false);
  await p.evaluate(() => { window.__resp.rich300OpsEnable = { ok: true, code: 'enabled', triggers: 1 }; window.__calls.length = 0; }); await p.click('#on'); await p.click('#on', { force: true }).catch(() => {});
  await p.waitForFunction(() => /실전 감시를 시작했습니다/.test(document.getElementById('onMsg').textContent)); const calls = await p.evaluate(() => window.__calls.filter(c => c[0] === 'rich300OpsEnable')); assert.equal(calls.length, 1); assert.deepEqual(calls[0][1], ['실전 감시 시작']);
  assert.match(await p.textContent('#onMsg'), /트리거 1개/); assert.equal(await p.isVisible('#reload'), true);
}));
test('중지: 즉시 호출되고 결과(트리거 0개)를 보여 준다 · 실패하면 다시 누르라고 안내 · 서버 호출 실패/연결 없음 안내', skip, () => withPage(async (p) => {
  await p.evaluate(() => { window.__resp.rich300OpsDisable = { ok: true, code: 'disabled', triggers: 0 }; }); await p.click('#off'); await p.waitForFunction(() => /감시를 중지했습니다/.test(document.getElementById('offMsg').textContent)); assert.match(await p.textContent('#offMsg'), /트리거 0개/);
  await p.evaluate(() => { window.__resp.rich300OpsDisable = { ok: false, code: 'verify-failed', triggers: 1 }; }); await p.click('#off'); await p.waitForFunction(() => /중지 확인에 실패/.test(document.getElementById('offMsg').textContent)); assert.equal(await p.isDisabled('#off'), false);
  await p.evaluate(() => { window.__mode = 'fail'; }); await p.click('#off'); await p.waitForFunction(() => /서버 호출 실패/.test(document.getElementById('offMsg').textContent)); assert.match(await p.textContent('#offMsg'), /불확실/);
  await p.evaluate(() => { window.google = undefined; }); await p.click('#off'); assert.match(await p.textContent('#offMsg'), /google\.script\.run/);
}));
test('상태 표시: 켜짐/꺼짐·트리거 수·마지막 실행·포지션 0건 안내 · 모바일 폭 320/390 가로 넘침 없음·버튼 높이 40px 이상', skip, async () => {
  const on = { ...M, prodApproved: true, prop: 'on', mode: 'on', effective: 'sends', triggers: 1, last: { ageMin: 3, status: 'ok', mode: 'on', positions: 2, events: 1, sent: 1, failed: 0, marketFail: 0 }, precheck: { ageMin: 4, ok: true }, opsLast: { ageMin: 4, action: 'enable', code: 'ok' } };
  for (const w of [320, 390]) await withPage(async (p) => {
    const t = await p.textContent('main'); assert.match(t, /실제 동작: 전송 중\(실전 감시 켜짐\)/); assert.match(t, /5분 감시 트리거: 1개/); assert.match(t, /마지막 감시 실행: 3분 전 · ok · on · 포지션 2/); assert.match(t, /마지막 관리 동작: 4분 전 · enable · ok/);
    const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, small: [...document.querySelectorAll('button,input')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 40).map(e => e.id) })); assert.ok(r.sw <= r.cw); assert.deepEqual(r.small, []);
  }, { w, m: on });
  await withPage(async (p) => { assert.match(await p.textContent('#off').then(() => p.textContent('main')), /최대 1회 실행 ?은 끝까지 진행될 수 있습니다/); assert.match(await p.textContent('main'), /감시 설정이 off 이면 감시 전송은 차단/); assert.match(await p.textContent('main'), /0건이면 정상 대기/); assert.match(await p.textContent('main'), /실제 동작: 아무것도 하지 않음\(꺼짐\)/); });
});
