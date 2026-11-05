// 모바일 입력 화면(Fill.html) 실제 브라우저 검증. google.script.run 은 가짜로 대체한다(서버 호출 없음). Playwright가 없으면 건너뛴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';

const PW = process.env.RICH300_PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright', CH = process.env.RICH300_CHROMIUM ?? '/opt/pw-browsers/chromium', have = existsSync(PW);
const STUB = `<script>window.__calls = []; var mk = function (ok) { var o = { withSuccessHandler: function (f) { ok = f; return o; }, withFailureHandler: function () { return o; }, rich300FillSubmit: function (form) { window.__calls.push(JSON.parse(JSON.stringify(form))); setTimeout(function () { ok({ ok: true, status: 'added', summary: '진입 LONG' }); }, 0); } }; return o; }; window.google = { script: { get run() { return mk(); } } };</script>`;
const html = (preset = {}) => readFileSync(new URL('../gas/Fill.html', import.meta.url), 'utf8').replace('<body>', `<body>${STUB}`).replace('<?!= preset ?>', JSON.stringify({ sid: 'SG-ETH-L-abc', dir: 'LONG', entry: '3012.5', stop: '2980', ...preset }));
async function withPage(fn, { w = 390 } = {}) {
  const { chromium } = createRequire(PW)(PW), b = await chromium.launch(existsSync(CH) ? { executablePath: CH } : {});
  try { const p = await (await b.newContext({ viewport: { width: w, height: 844 } })).newPage(), errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.setContent(html()); await fn(p, errs); } finally { await b.close(); }
}
const skip = { skip: !have && 'playwright 없음' };

test('진입 입력: 추천가는 미리 채워지고, 실제 진입가·수량·손절 없음·시각을 보낸다', skip, async () => withPage(async (p, errs) => {
  assert.equal(await p.inputValue('#entry'), '3012.5'); assert.equal(await p.inputValue('#sid'), 'SG-ETH-L-abc');
  await p.fill('#margin', '30'); await p.fill('#leverage', '10'); await p.fill('#entry', '3010'); await p.fill('#qty', '0.1'); await p.fill('#stop', ''); await p.fill('#at', '2026-10-24T14:30'); await p.click('#go');
  await p.waitForFunction(() => window.__calls.length === 1); const f = await p.evaluate(() => window.__calls[0]);
  assert.deepEqual({ kind: f.kind, sid: f.sid, margin: f.margin, leverage: f.leverage, entry: f.entry, qty: f.qty, stop: f.stop, at: f.at }, { kind: 'entry', sid: 'SG-ETH-L-abc', margin: '30', leverage: '10', entry: '3010', qty: '0.1', stop: '', at: '2026-10-24T14:30' });
  assert.match(f.formId, /^[A-Za-z0-9]{8,24}$/); assert.match(await p.textContent('#msg'), /저장됨/); assert.deepEqual(errs, []);
}));
test('청산 입력: 비율 버튼·메모·시각, 같은 화면의 재저장은 같은 formId(중복 방지 키)', skip, async () => withPage(async (p) => {
  await p.click('#mExit'); assert.equal(await p.isVisible('#exitFields'), true); assert.equal(await p.isVisible('#entryFields'), false); assert.equal(await p.isVisible('#note'), true);
  await p.fill('#price', '3100'); await p.click('button[data-q="50%"]'); assert.equal(await p.inputValue('#xqty'), '50%'); await p.fill('#fee', '0.5'); await p.fill('#funding', '-0.1'); await p.fill('#note', '익절 후 관망'); await p.click('#go');
  await p.waitForFunction(() => window.__calls.length === 1); await p.click('#go'); await p.waitForFunction(() => window.__calls.length === 2);
  const [a, b] = await p.evaluate(() => window.__calls); assert.deepEqual({ kind: a.kind, price: a.price, qty: a.qty, fee: a.fee, funding: a.funding, note: a.note }, { kind: 'exit', price: '3100', qty: '50%', fee: '0.5', funding: '-0.1', note: '익절 후 관망' }); assert.equal(a.formId, b.formId);
  await p.click('button[data-q=""]'); assert.equal(await p.inputValue('#xqty'), '');
}));
test('모바일 폭 320/390에서 가로 넘침 없음, 입력·버튼 높이 40px 이상', skip, async () => { for (const w of [320, 390]) await withPage(async (p) => {
  for (const m of ['#mEntry', '#mExit']) { await p.click(m); const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, small: [...document.querySelectorAll('input,button')].filter(e => e.offsetParent !== null && e.getBoundingClientRect().height < 38).map(e => e.id || e.textContent)})); assert.ok(r.sw <= r.cw, `넘침 @${w}`); assert.deepEqual(r.small, []); }
}, { w }); });

test('수동 등록 목록의 [청산 기록] 링크(mode=exit)로 열면 청산 입력 모드로 시작하고 해당 포지션 ID 가 채워진다', skip, async () => {
  const { chromium } = createRequire(PW)(PW), b = await chromium.launch(existsSync(CH) ? { executablePath: CH } : {});
  try { const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage(); await p.setContent(html({ sid: 'M-SOL-L-abc', mode: 'exit' }));
    assert.equal(await p.isVisible('#exitFields'), true); assert.equal(await p.isVisible('#entryFields'), false); assert.equal(await p.inputValue('#sid'), 'M-SOL-L-abc'); } finally { await b.close(); }
});
