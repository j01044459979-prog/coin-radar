// ?p=strat 추천 전략 화면 브라우저 검증(320/390px). 서버 호출 없는 정적 화면(모델은 가상 데이터). Playwright 가 없으면 건너뛴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { stratRenderHtml } from '../lib/stratview.mjs';

const PW = process.env.RICH300_PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright', CH = process.env.RICH300_CHROMIUM ?? '/opt/pw-browsers/chromium', skip = { skip: !existsSync(PW) && 'playwright 없음' };
const NOW = 1790000000000, plan = { riskPct: 0.01, lev: 3, totalMargin: 68.5, tps: [{ price: 2045 }, { price: 2060 }], stages: [{ price: 2000 }] };
const row = (state, o = {}, x = {}) => ({ sid: 'SG-ETH-L-' + state.toLowerCase(), symbolId: 'ETHUSDT', dir: 'LONG', state, createdAt: NOW - 3600000, endedAt: undefined, score: 72, entry: '2000', stop: '1970', x: { plan, validUntil: NOW + 600000, stopPrice: 1970, stopKind: 'initial', fills: [], legs: [], ...x }, ...o });
const rows = [row('CANDIDATE'), row('WAIT_ENTRY'), row('TRACKING', {}, { fills: [{ n: 1 }], legs: [], entryAt: NOW - 1800000 }), row('TP1', {}, { fills: [{ n: 1 }], legs: [{ n: 1 }], stopKind: 'breakeven', stopPrice: 2000, entryAt: NOW - 1800000 }),
  row('STOP', { endedAt: NOW - 600000 }, { reason: 'stop', result: { usdt: -3.2, r: -1.05, pct: -0.0107, avgEntry: 2000 } }), row('DONE', { endedAt: NOW - 300000, sid: 'SG-ETH-L-done' }, { reason: 'all-targets', result: { usdt: 6.4, r: 1.9, pct: 0.021, avgEntry: 2000 } }), row('EXPIRED', { endedAt: NOW - 100000, sid: 'SG-ETH-L-exp' }, { reason: 'entry-window-passed', result: null })];
async function withPage(fn, w = 390, m = { rows, now: NOW, mode: 'on', lastRun: { ageMin: 3, status: 'ok' } }) {
  const { chromium } = createRequire(PW)(PW), b = await chromium.launch(existsSync(CH) ? { executablePath: CH } : {});
  try { const p = await (await b.newContext({ viewport: { width: w, height: 844 } })).newPage(), errs = []; p.on('pageerror', e => errs.push(String(e))); await p.setContent(stratRenderHtml({ m, appUrl: 'https://script.google.com/macros/s/X/exec', build: 'b' })); await fn(p, errs); } finally { await b.close(); }
}
test('구역 5개와 상태·성과 표시: 신규/대기/추적/종료/실제 포지션(선택) · 가상 추적 문구 · 실제 성적과 분리', skip, () => withPage(async (p, errs) => {
  const t = await p.textContent('main'); for (const re of [/신규 추천 전략 \(1\)/, /진입 대기 전략 \(1\)/, /자동 추적 중인 전략 \(2\)/, /종료 전략 및 성과 \(3\)/, /실제 보유 포지션 \(선택 기능\)/, /추천 전략 가상 성적 \(실제 계좌와 별개\)/, /켜짐\(추천 → 자동 추적·알림\)/, /마지막 실행 3분 전\(ok\)/, /TP1 도달/, /손절/, /목표 완료/, /진입 없음/, /진입한 전략/, /승률/]) assert.match(t, re);
  assert.match(t, /▼ −3\.20 USDT/); assert.match(t, /▲ \+6\.40 USDT/); assert.ok((t.match(/전략 기준 가상 추적 · 실제 체결 아님/g) || []).length >= 4); assert.deepEqual(errs, []);
  const hrefs = await p.$$eval('a', as => as.map(a => a.getAttribute('href'))); assert.ok(hrefs.some(h => /p=pos$/.test(h)) && hrefs.some(h => /p=journal$/.test(h)) && hrefs.some(h => /p=ops$/.test(h)));
}));
test('모바일 폭 320/390: 가로 넘침 없음 · 메뉴 첫 탭이 전략', skip, async () => { for (const w of [320, 390]) await withPage(async (p) => {
  const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, first: document.querySelector('nav.tabs a').textContent, cur: document.querySelector('nav.tabs a[aria-current]').textContent })); assert.ok(r.sw <= r.cw, `넘침 ${r.sw}>${r.cw}`); assert.deepEqual([r.first, r.cur], ['전략', '전략']);
}, w); });
test('빈 상태·꺼짐: 안내 문구만 · 오류 없음', skip, () => withPage(async (p, errs) => { const t = await p.textContent('main'); assert.match(t, /신규 추천 전략 \(0\)/); assert.match(t, /꺼짐\(자동 추적 안 함\)/); assert.match(t, /아직 종료된 전략이 없습니다/); assert.deepEqual(errs, []); }, 390, { rows: [], now: NOW, mode: 'off' }));
