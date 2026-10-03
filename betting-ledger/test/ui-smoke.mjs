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
console.log('첫 화면:', (await page.textContent('#uBody')).trim());
await tab('bet');
await page.fill('#bName', 'UI테스트'); await page.fill('#bOdds', '2.2'); await page.fill('#bStake', '5000');
await page.click('#bSave'); await page.waitForSelector('#bMsg.ok');
console.log('추천 저장:', await page.textContent('#bMsg'), '| 헤더 사용(미구매라 0):', await page.textContent('#hUsed'));
await page.fill('#bName', '추가추천'); await page.fill('#bOdds', '2'); await page.fill('#bStake', '1000');
await page.click('#bSave'); await page.waitForSelector('#bMsg.ok');
await tab('buy'); await page.waitForSelector('.buybtns');
console.log('구매 확인 항목 수:', await page.locator('#tab-buy .pend').count(), '| 버튼 텍스트:', await page.locator('#tab-buy .pend').first().innerText());
// 연타: 같은 항목의 샀다 두 번 연속 클릭 → 한 번만 처리
const first = page.locator('#tab-buy .pend').first();
await first.locator('.yes').dblclick();
await page.waitForFunction(() => document.getElementById('hUsed').textContent !== '0원');
console.log('샀다 후:', await page.textContent('#uMsg'), '| 헤더 사용:', await page.textContent('#hUsed'));
// 한도: 남은 추천 1,000원 구매는 5,000 + 1,000 > 5,000 이므로 차단
await page.locator('#tab-buy .pend').first().locator('.yes').click(); await page.waitForSelector('#uMsg.err');
console.log('한도 차단:', await page.textContent('#uMsg'));
await page.locator('#tab-buy .pend').first().locator('.no').click();
await page.waitForFunction(() => document.getElementById('uBody').textContent.includes('없습니다'));
console.log('안 샀다 후 목록:', (await page.textContent('#uBody')).trim());
await tab('res'); await page.waitForSelector('.rBetSave');
const bought = page.locator('#pBets .pend', { has: page.locator('b', { hasText: /^구매$/ }) });
await bought.locator('.rRet').fill('2000'); await bought.locator('.rBetSave').click();   // 실구매 1,000원 → 2,000원 반환
await page.waitForFunction(() => document.getElementById('hProfit').textContent.includes('+1,000'));
console.log('손익/ROI 헤더:', await page.textContent('#hProfit'), await page.textContent('#hRoi'));
await tab('wdl'); await page.fill('#wRound', '100'); await page.fill('#wStake', '5000');
await page.click('#wSave'); await page.waitForSelector('#wMsg.err'); console.log('승무패 미입력:', await page.textContent('#wMsg'));
for (let i = 0; i < 14; i++) await page.click(`.g[data-i="${i}"] button[data-v="승"]`);
await page.click('#wSave'); await page.waitForSelector('#wMsg.ok'); console.log('승무패:', await page.textContent('#wMsg'));
await tab('buy'); await page.waitForSelector('#tab-buy .pend');
console.log('승무패 구매 확인 카드:', (await page.locator('#tab-buy .pend').first().innerText()).replace(/\n/g, ' | '));
await tab('mon'); await page.waitForSelector('#mBody table');
console.log('월간 표 개수:', await page.locator('#mBody table').count(), '| 가로 넘침:', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), '| 페이지 에러:', errs.length ? errs : '없음');
await page.screenshot({ path: path.join(process.env.SHOT_DIR || '.', 'ui.png'), fullPage: true });
await browser.close();
