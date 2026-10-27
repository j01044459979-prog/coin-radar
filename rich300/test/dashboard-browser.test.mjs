// 실제 브라우저(Chromium) 렌더 검증. Playwright가 없으면 건너뛴다(CI에 브라우저가 없을 수 있음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dashSampleModel, dashBuildModel } from '../lib/dashboard.mjs';
import { dashRenderHtml } from '../lib/dashview.mjs';

const PW = process.env.RICH300_PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright', CH = process.env.RICH300_CHROMIUM ?? '/opt/pw-browsers/chromium';
const have = existsSync(PW);
const APP = 'https://script.google.com/macros/s/X/exec', html = dashRenderHtml(dashSampleModel(1791876554386 + 3600000), { appUrl: APP });
const empty = dashRenderHtml(dashBuildModel({ inputs: { challenge: { startEquity: '300', startDay: '2026-10-01', rateSchedule: [{ from: '2026-10-01', rate: '0.05' }] }, fills: [], cashflows: [], adjustments: [], openingPositions: [], equityInputs: [] }, throughDay: '2026-10-03', now: 1791876554386 }), { appUrl: APP });
async function withBrowser(fn) { const { chromium } = createRequire(PW)(PW); const b = await chromium.launch(existsSync(CH) ? { executablePath: CH } : {}); try { return await fn(b); } finally { await b.close(); } }
const page = async (b, { w = 390, h = 844, scheme = 'light' } = {}) => { const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme }), p = await ctx.newPage(), errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); await p.setContent(html); return { p, errs }; };

test('모바일 렌더: 390/320px에서 가로 스크롤 없음·오류 없음·터치 대상 40px 이상(샘플·미입력 모두)', { skip: !have && 'playwright 없음' }, async () => withBrowser(async b => {
  for (const doc of [html, empty]) for (const w of [390, 320]) {
    const { p, errs } = await page(b, { w }); await p.setContent(doc); const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, small: [...document.querySelectorAll('a,button')].filter(e => e.getBoundingClientRect().height < 38).length }));
    assert.ok(m.sw <= m.cw, `가로 넘침 ${m.sw}>${m.cw} @${w}`); assert.deepEqual(errs, []); assert.equal(m.small, 0);
  }
}));
test('숫자가 크게 보인다: 현재 총자산 40px 이상, 본문 숫자 20px 이상, 그래프 요소 없음', { skip: !have && 'playwright 없음' }, async () => withBrowser(async b => {
  const { p } = await page(b); await p.setContent(html);
  const hero = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.hero .big')).fontSize)), v = await p.evaluate(() => Math.min(...[...document.querySelectorAll('.v')].map(e => parseFloat(getComputedStyle(e).fontSize))));
  assert.ok(hero >= 40, `hero ${hero}`); assert.ok(v >= 20, `v ${v}`); assert.equal(await p.evaluate(() => document.querySelectorAll('svg,canvas').length), 0);
  const first = await p.evaluate(() => { const r = document.querySelector('.hero').getBoundingClientRect(); return r.top + r.height; }); assert.ok(first < 844 * 0.5, `현재 총자산이 첫 화면 위쪽에 보여야 함 (${first})`);
}));
test('다크 모드: 배경이 바뀌고 본문·보조 글자 대비 4.5:1 이상', { skip: !have && 'playwright 없음' }, async () => withBrowser(async b => {
  const lum = c => { const [r, g, bl] = c.match(/\d+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const ratio = (a, c) => { const [x, y] = [lum(a), lum(c)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const colors = async scheme => { const { p } = await page(b, { scheme }); await p.setContent(html); return p.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(document.body).color, sf: getComputedStyle(document.querySelector('.card')).backgroundColor, mute: getComputedStyle(document.querySelector('.k')).color, pos: getComputedStyle(document.querySelector('.pos')).color, neg: getComputedStyle(document.querySelector('.neg')).color })); };
  const L = await colors('light'), D = await colors('dark'); assert.notEqual(L.bg, D.bg);
  for (const C of [L, D]) for (const k of ['ink', 'mute', 'pos', 'neg']) assert.ok(ratio(C[k], C.sf) >= 4.5, `${k} ${ratio(C[k], C.sf).toFixed(2)}`);
}));
test('메뉴 링크는 target=_top 이고 평가액 입력 링크가 있다(미입력 화면)', { skip: !have && 'playwright 없음' }, async () => withBrowser(async b => {
  const { p } = await page(b); await p.setContent(empty); const links = await p.evaluate(() => [...document.querySelectorAll('nav.tabs a')].map(a => [a.textContent, a.target, a.getAttribute('href')]));
  assert.deepEqual(links.map(l => l[0]), ['홈', '포지션', '일지', '추천', '성적', '자산']); assert.ok(links.every(l => l[1] === '_top' && l[2].startsWith('https://script.google.com/')));
  assert.equal(await p.locator('.cta').count(), 1);
}));
