// Index.html 을 실제 Chromium 에서 열고, google.script.run 을 Code.gs(mock 시트)로 연결하는 스모크 테스트
import fs from 'fs'; import vm from 'vm'; import path from 'path'; import { fileURLToPath } from 'url'; import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
let chromium; try { chromium = require('playwright').chromium; } catch { chromium = require('/opt/pw-browsers/../usr/lib/node_modules/playwright').chromium; }
// ledger.test.js 의 makeContext 재사용을 위해 소스를 로드
const src = fs.readFileSync(path.join(here, 'ledger.test.js'), 'utf8').split('/* ---------- 도우미')[0];
const env = new Function('require', '__dirname', src + '\nreturn makeContext;')(require, here)();
env.get('setup')();
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.exposeFunction('__srv', (fn, arg) => JSON.stringify(env.get(fn)(arg === null ? undefined : arg)));
await page.addInitScript(() => {
  window.google = { script: { run: new Proxy({}, { get: () => null }) } };
  const mk = (ok, fail) => new Proxy({}, { get: (_, fn) => {
    if (fn === 'withSuccessHandler') return h => mk(h, fail);
    if (fn === 'withFailureHandler') return h => mk(ok, h);
    return arg => window.__srv(fn, arg === undefined ? null : arg).then(s => ok(JSON.parse(s)));
  } });
  window.google.script.run = mk();
});
await page.goto('file://' + path.join(here, '..', 'Index.html'));
await page.waitForFunction(() => document.getElementById('hUsed').textContent !== '-');
const tab = n => page.click(`[data-tab=${n}]`);
const navs = await page.$$eval('.nav button', bs => bs.map(b => b.textContent.replace(/\s*\(\d+\)$/, '')));
console.log('메뉴:', navs.join(' | '), '| 입력 메뉴 없음:', !navs.some(x => /입력/.test(x)) && !(await page.$('#tab-bet, #tab-wdl, #bSave, #wSave')));
// 리치 자동저장 진입점으로 추천 3건(일반 2 + 승무패 1) 저장 → 화면 새로고침
const today = await page.evaluate(() => S.today);
const save = JSON.parse(await page.evaluate(([d]) => window.__srv('apiSaveRichPicks', { requestId: 'smoke-batch-0001', picks: [
  { type: 'BET', date: d, sport: '축구', league: 'K리그1', name: '울산 vs 전북 아주 긴 경기명 줄바꿈 확인 확인 확인 확인 확인 확인', pick: '핸디캡 홈 -1.5 / 언더 2.5 / 긴 픽 내용 줄바꿈 확인용 문장', folders: 2, odds: 2.2, stake: 5000, grade: '메인' },
  { type: 'BET', date: d, sport: '야구', league: 'KBO', name: 'B경기', pick: '홈승', folders: 1, odds: 1.8, stake: 1000, grade: '대박' },
  { type: 'WDL', round: '100', date: d, combo: '주력', games: Array(14).fill('승'), stake: 5000 }] }), [today]));
console.log('자동저장:', save.savedCount, '건 저장 /', save.failedCount, '건 실패');
await page.click('[data-tab=mon]'); await tab('buy'); await page.waitForSelector('#tab-buy .pend');
console.log('구매 확인 카드 수:', await page.locator('#tab-buy .pend').count(), '| 버튼:', await page.locator('#tab-buy .pend').first().locator('button').allTextContents());
const first = page.locator('#tab-buy .pend', { hasText: '울산' });
await first.locator('.yes').dblclick();                                   // 연타 → 한 번만 처리
await page.waitForFunction(() => document.getElementById('hUsed').textContent !== '0원');
console.log('샀다 후:', await page.textContent('#uMsg'), '| 실제 사용액:', await page.textContent('#hUsed'));
await page.locator('#tab-buy .pend', { hasText: 'B경기' }).locator('.yes').click(); await page.waitForSelector('#uMsg.err');
console.log('한도 차단:', await page.textContent('#uMsg'));
await page.locator('#tab-buy .pend', { hasText: 'B경기' }).locator('.no').click();
await page.waitForFunction(() => !document.getElementById('uBody').textContent.includes('B경기'));
await tab('res'); await page.waitForSelector('.rBetSave');
console.log('결과 처리 대기 목록(미확인 승무패 제외):', await page.locator('#pBets .pend').count(), '/', await page.locator('#pWdl .pend').count());
const bought = page.locator('#pBets .pend', { has: page.locator('b', { hasText: /^구매$/ }) });
await bought.locator('.rRet').fill('11000'); await bought.locator('.rBetSave').click();
await page.waitForFunction(() => document.getElementById('hProfit').textContent.includes('+6,000'));
console.log('손익/ROI 헤더:', await page.textContent('#hProfit'), await page.textContent('#hRoi'));
await tab('mon'); await page.waitForSelector('#mBody table');
console.log('월간 표 개수:', await page.locator('#mBody table').count(), '| 가로 넘침:', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), '| 페이지 에러:', errs.length ? errs : '없음');
await tab('buy'); await page.waitForSelector('#tab-buy .pend');
console.log('구매 확인 재진입 후 가로 넘침:', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
await page.screenshot({ path: path.join(process.env.SHOT_DIR || '.', 'ui.png'), fullPage: true });
await browser.close();
