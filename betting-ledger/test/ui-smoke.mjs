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
await page.fill('#bName', 'UI테스트'); await page.fill('#bOdds', '2.2'); await page.fill('#bStake', '5000');
const before = await page.evaluate(() => scrollY);
await page.click('#bSave'); await page.waitForSelector('#bMsg.ok');
console.log('저장 메시지:', await page.textContent('#bMsg'), '| 헤더 사용:', await page.textContent('#hUsed'), '| scrollY 유지:', before === await page.evaluate(() => scrollY));
await page.fill('#bName', '또저장'); await page.fill('#bOdds', '2'); await page.fill('#bStake', '1000');
await page.click('#bSave'); await page.waitForSelector('#bMsg.err');
console.log('차단 메시지:', await page.textContent('#bMsg'));
await page.click('[data-tab=res]'); await page.waitForSelector('.rBetSave');
await page.fill('.rRet', '11000'); await page.click('.rBetSave');
await page.waitForFunction(() => document.getElementById('hProfit').textContent.includes('+6,000'));
console.log('손익/ROI 헤더:', await page.textContent('#hProfit'), await page.textContent('#hRoi'));
await page.click('[data-tab=wdl]'); await page.fill('#wRound', '100'); await page.fill('#wStake', '5000');
await page.click('#wSave'); await page.waitForSelector('#wMsg.err'); console.log('승무패 미입력:', await page.textContent('#wMsg'));
for (let i = 0; i < 14; i++) await page.click(`.g[data-i="${i}"] button[data-v="승"]`);
await page.click('#wSave'); await page.waitForSelector('#wMsg.ok'); console.log('승무패:', await page.textContent('#wMsg'));
await page.click('[data-tab=mon]'); await page.waitForSelector('#mBody table');
console.log('월간 표 개수:', await page.locator('#mBody table').count(), '| 페이지 에러:', errs.length ? errs : '없음');
await page.screenshot({ path: path.join(process.env.SHOT_DIR || '.', 'ui.png'), fullPage: true });
await browser.close();
