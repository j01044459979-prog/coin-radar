// 실제 Chromium(390px)에서 Index.html 을 열고 google.script.run 을 Code.gs(메모리 시트 mock)에 연결하는 공용 하네스.
// 서버 호출은 calls 배열에 기록된다. delay[fn] = ms 로 서버 응답을 지연시킬 수 있다(연타 테스트용).
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import { createRequire } from 'module';
const require = createRequire(import.meta.url);
export const here = path.dirname(fileURLToPath(import.meta.url));
let chromium; try { chromium = require('playwright').chromium; } catch { chromium = require('/opt/pw-browsers/../usr/lib/node_modules/playwright').chromium; }

export function makeEnv() {
  const src = fs.readFileSync(path.join(here, 'ledger.test.js'), 'utf8').split('/* ---------- 도우미')[0];
  const env = new Function('require', '__dirname', src + '\nreturn makeContext;')(require, here)();
  env.get('setup')();
  return env;
}

export async function openApp({ html = path.join(here, '..', 'Index.html'), env = makeEnv(), delay = {}, autoOpen = true } = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  page.setDefaultTimeout(5000);
  const calls = [], errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.exposeFunction('__srv', async (fn, arg) => {
    calls.push(fn);
    if (delay[fn]) await new Promise(r => setTimeout(r, delay[fn]));
    return JSON.stringify(env.get(fn)(arg === null ? undefined : arg));
  });
  await page.addInitScript(() => {
    window.google = { script: { run: new Proxy({}, { get: () => null }) } };
    const mk = (ok, fail) => new Proxy({}, { get: (_, fn) => {
      if (fn === 'withSuccessHandler') return h => mk(h, fail);
      if (fn === 'withFailureHandler') return h => mk(ok, h);
      return arg => window.__srv(fn, arg === undefined ? null : arg).then(s => ok(JSON.parse(s)));
    } });
    window.google.script.run = mk();
  });
  const api = { page, env, calls, errs, browser, html,
    open: async () => { await page.goto('file://' + html); await page.waitForFunction(() => document.getElementById('hUsed').textContent !== '-'); },
    close: () => browser.close() };
  if (autoOpen) await api.open();
  return api;
}
