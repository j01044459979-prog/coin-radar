// 실제 브라우저(Chromium) 렌더 검증. Playwright가 없으면 건너뛴다(CI에 브라우저가 없을 수 있음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dashSampleModel } from '../lib/dashboard.mjs';
import { dashRenderHtml } from '../lib/dashview.mjs';

const PW = process.env.RICH300_PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright', CH = process.env.RICH300_CHROMIUM ?? '/opt/pw-browsers/chromium';
const have = existsSync(PW);
const html = dashRenderHtml(dashSampleModel(1791876554386 + 3600000));
async function withBrowser(fn) { const { chromium } = createRequire(PW)(PW); const b = await chromium.launch(existsSync(CH) ? { executablePath: CH } : {}); try { return await fn(b); } finally { await b.close(); } }
const page = async (b, { w = 390, h = 844, scheme = 'light' } = {}) => { const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme }), p = await ctx.newPage(), errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); await p.setContent(html); return { p, errs }; };

test('모바일 렌더: 390/320px에서 가로 스크롤 없음·오류 없음·터치 버튼 35px 이상', { skip: !have && 'playwright 없음' }, async () => withBrowser(async b => {
  for (const w of [390, 320]) {
    const { p, errs } = await page(b, { w }); const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, small: [...document.querySelectorAll('button')].filter(x => x.offsetParent && x.getBoundingClientRect().height < 35).length }));
    assert.ok(m.sw <= m.cw, `가로 넘침 ${m.sw}>${m.cw} @${w}`); assert.deepEqual(errs, []); assert.equal(m.small, 0);
  }
}));
test('인터랙션: LONG/SHORT 필터, 이상선 토글, 차트 호버 툴팁', { skip: !have && 'playwright 없음' }, async () => withBrowser(async b => {
  const { p, errs } = await page(b), vis = sel => p.evaluate(s => [...document.querySelectorAll(s)].filter(e => e.offsetParent !== null).length, sel);
  const all = await vis('.trade'); assert.ok(all > 10);
  await p.click('button[data-f="LONG"]'); const longOnly = await vis('.trade'); assert.ok(longOnly > 0 && longOnly < all); assert.equal(await p.evaluate(() => [...document.querySelectorAll('.trade')].filter(e => e.offsetParent && e.dataset.dir !== 'LONG').length), 0);
  assert.equal(await p.getAttribute('button[data-f="LONG"]', 'aria-pressed'), 'true'); await p.click('button[data-f="ALL"]'); assert.equal(await vis('.trade'), all);
  assert.equal(await p.isVisible('#cI svg'), true); await p.click('#btnActual'); assert.equal(await p.isVisible('#cA svg'), true); assert.equal(await p.isVisible('#cI svg'), false); await p.click('#btnIdeal');
  const box = await p.locator('#cI svg').boundingBox(); await p.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4);
  const tip = await p.textContent('#tip'); assert.match(tip, /실제 \d+\.\d\d/); assert.match(tip, /이상 \d+\.\d\d · 차이 /); assert.equal(await p.isVisible('#tip'), true);
  await p.mouse.move(0, 0); await p.evaluate(() => document.getElementById('chartwrap').dispatchEvent(new PointerEvent('pointerleave'))); assert.equal(await p.isVisible('#tip'), false); assert.deepEqual(errs, []);
}));
test('다크 모드·테마 전환: 배경색이 바뀌고 본문 대비가 유지된다(글자·배경 4.5:1 이상)', { skip: !have && 'playwright 없음' }, async () => withBrowser(async b => {
  const lum = c => { const [r, g, bl] = c.match(/\d+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; }, ratio = (a, c) => { const [x, y] = [lum(a), lum(c)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const colors = async scheme => { const { p } = await page(b, { scheme }); return p.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(document.body).color, mute: getComputedStyle(document.querySelector('.k')).color, sf: getComputedStyle(document.querySelector('.card')).backgroundColor })); };
  const L = await colors('light'), D = await colors('dark'); assert.notEqual(L.bg, D.bg); assert.ok(ratio(L.ink, L.sf) >= 4.5 && ratio(D.ink, D.sf) >= 4.5 && ratio(L.mute, L.sf) >= 4.5 && ratio(D.mute, D.sf) >= 4.5, JSON.stringify({ L, D }));
  const { p } = await page(b, { scheme: 'light' }); const before = await p.evaluate(() => getComputedStyle(document.body).backgroundColor); await p.click('#btnTheme'); assert.notEqual(await p.evaluate(() => getComputedStyle(document.body).backgroundColor), before);
}));
