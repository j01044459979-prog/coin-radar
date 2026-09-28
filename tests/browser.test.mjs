// index.html 을 실제 Chromium 에서 여는 화면 테스트.
// 거래소 응답은 테스트용 고정값으로 흉내 냅니다 (실제 서비스 코드에는 가짜 데이터 없음).
// 실행: node --test tests/*.test.*  (Playwright 필요)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require(join(process.env.PLAYWRIGHT_GLOBAL || '/usr/local/lib/node_modules', 'playwright')));
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
let server, base, browser;

before(async () => {
  server = createServer(async (req, res) => {
    try {
      const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      const body = await readFile(join(ROOT, path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

// ── 테스트용 고정 응답 ──
const SYMS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'AVAX', 'LINK', 'TRX', 'DOT', 'LTC', 'SUI', 'PEPE', 'TON', 'NEAR', 'APT'];
const rest24h = SYMS.map((s, i) => ({ symbol: s + 'USDT', lastPrice: String(1000 - i), priceChangePercent: String(i - 8), quoteVolume: String((20 - i) * 1e8), volume: String(1000 + i) }));
const upbitMarkets = [{ market: 'KRW-BTC' }, { market: 'KRW-ETH' }, { market: 'BTC-ETH' }];
const upbitTicker = [
  { market: 'KRW-BTC', trade_price: 90000000, signed_change_rate: 0.012, acc_trade_price_24h: 5e11 },
  { market: 'KRW-ETH', trade_price: 4000000, signed_change_rate: -0.02, acc_trade_price_24h: 2e11 },
];
const tickerMsg = (s, c, P) => JSON.stringify({ stream: s.toLowerCase() + '@ticker', data: { e: '24hrTicker', s, c: String(c), P: String(P), q: '2000000000', v: '30000' } });
const miniMsg = JSON.stringify({ stream: '!miniTicker@arr', data: [{ e: '24hrMiniTicker', s: 'SOLUSDT', c: '120', o: '100', q: '900000000', v: '7000' }] });

async function openPage({ upbitFail = false, viewport, initScript, wsMessages } = {}) {
  const page = await browser.newPage(viewport ? { viewport } : {});
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const sockets = [];
  await page.routeWebSocket(/binance/, (ws) => {
    sockets.push(ws);
    for (const m of wsMessages || [tickerMsg('BTCUSDT', 65432.1, 1.5), miniMsg]) ws.send(m);
  });
  // Playwright 의 WebSocket 가로채기 뒤에 등록해야 테스트용 WebSocket 교체가 적용됩니다
  if (initScript) await page.addInitScript(initScript);
  await page.route(/binance\.(com|vision)\/api\/v3\/ticker\/24hr/, (r) => r.fulfill({ json: rest24h, headers: { 'access-control-allow-origin': '*' } }));
  await page.route(/api\.upbit\.com/, (r) => {
    if (upbitFail) return r.fulfill({ status: 500, body: 'x', headers: { 'access-control-allow-origin': '*' } });
    const json = r.request().url().includes('market/all') ? upbitMarkets : upbitTicker;
    return r.fulfill({ json, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto(base);
  return { page, errors, sockets };
}

test('실시간 시세·상태 표시, 준비 중 기능 비활성', async () => {
  const { page, errors, sockets } = await openPage();
  await page.waitForFunction(() => document.getElementById('connStatus').textContent.includes('Binance 실시간'));
  await page.waitForFunction(() => document.getElementById('connStatus').textContent.includes('Upbit 정상'));
  await page.waitForFunction(() => document.getElementById('hero').textContent.includes('65,432.1'));

  const hero = await page.textContent('#hero');
  assert.match(hero, /BTC\$65,432\.1\+1\.50%/);
  assert.match(hero, /24H 거래량/);
  assert.match(await page.textContent('#hero'), /SOL\$120\+20\.00%/); // miniTicker: (120-100)/100
  assert.equal(await page.locator('#binanceBody tr').count(), 15);
  assert.equal(await page.locator('#upbitBody tr').count(), 2);
  assert.match(await page.textContent('#signals'), /24H 상승 상위/);
  assert.equal(await page.locator('.controls .btn:disabled').count(), 3);
  assert.match(await page.textContent('#updated'), /Binance 마지막 수신 \d/);
  assert.equal(await page.evaluate(() => typeof window.status), 'string'); // 전역 status 와 충돌 없음
  assert.equal(sockets.length, 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test('WebSocket 이 끊기면 자동 재연결', async () => {
  const { page, errors, sockets } = await openPage();
  await page.waitForFunction(() => document.getElementById('connStatus').textContent.includes('Binance 실시간'));
  sockets[0].close();
  await page.waitForFunction(() => document.getElementById('connStatus').textContent.includes('재연결'));
  await page.waitForFunction(() => document.getElementById('connStatus').textContent.includes('Binance 실시간'), null, { timeout: 10000 });
  assert.equal(sockets.length, 2);
  assert.deepEqual(errors, []);
  await page.close();
});

test('Upbit 오류가 나도 Binance 는 계속 동작', async () => {
  const { page, errors } = await openPage({ upbitFail: true });
  await page.waitForFunction(() => document.getElementById('connStatus').textContent.includes('Upbit 재시도 중'));
  await page.waitForFunction(() => document.getElementById('hero').textContent.includes('65,432.1'));
  assert.match(await page.textContent('#upbitBody'), /Upbit 연결 재시도 중/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('모바일 화면: 가로 스크롤 없음', async () => {
  const { page, errors } = await openPage({ viewport: { width: 390, height: 844 } });
  await page.waitForFunction(() => document.getElementById('hero').textContent.includes('65,432.1'));
  await page.waitForTimeout(1200);
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(sw <= iw, `scrollWidth ${sw} > innerWidth ${iw}`);
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, 'mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Phase 1.1 재발 방지 테스트 ──

// Binance 공식 문서 형식 그대로의 메시지 (모든 필드 포함)
const officialTicker = JSON.stringify({ stream: 'btcusdt@ticker', data: { e: '24hrTicker', E: 1790600000000, s: 'BTCUSDT', p: '100.00', P: '0.157', w: '65000.1', x: '65000.00', c: '65100.00', Q: '0.01', b: '65099.99', B: '1.2', a: '65100.00', A: '0.8', o: '65000.00', h: '65500.00', l: '64000.00', v: '12345.6', q: '802000000.5', O: 1790513600000, C: 1790600000000, F: 1, L: 2, n: 2 } });
const officialMini = JSON.stringify({ stream: '!miniTicker@arr', data: [{ e: '24hrMiniTicker', E: 1790600000000, s: 'ETHUSDT', c: '3500.00', o: '3400.00', h: '3550.00', l: '3380.00', v: '100000', q: '350000000' }] });

const cssColor = (page, sel) => page.$eval(sel, (n) => getComputedStyle(n).color);

test('공식 형식 메시지 수신 → Binance 실시간 초록, Upbit 별도 표시', async () => {
  const { page, errors } = await openPage({ wsMessages: [officialTicker, officialMini] });
  await page.waitForFunction(() => document.getElementById('binanceStatus').textContent === '● Binance 실시간');
  await page.waitForFunction(() => document.getElementById('upbitStatus').textContent === '● Upbit 정상');
  assert.equal(await page.getAttribute('#binanceStatus', 'data-level'), 'ok');
  assert.equal(await cssColor(page, '#binanceStatus'), 'rgb(66, 212, 134)');
  assert.equal(await page.getAttribute('#upbitStatus', 'data-level'), 'ok');
  assert.ok(!(await page.textContent('body')).includes('● 연결 중'));
  await page.waitForFunction(() => document.getElementById('hero').textContent.includes('65,100'));
  assert.match(await page.textContent('#hero'), /BTC\$65,100\+0\.16%/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('Upbit 오류는 Binance 상태 색을 바꾸지 않음', async () => {
  const { page, errors } = await openPage({ upbitFail: true });
  await page.waitForFunction(() => document.getElementById('binanceStatus').dataset.level === 'ok');
  await page.waitForFunction(() => document.getElementById('upbitStatus').dataset.level === 'err');
  assert.equal(await page.textContent('#binanceStatus'), '● Binance 실시간');
  assert.equal(await cssColor(page, '#upbitStatus'), 'rgb(255, 101, 118)');
  assert.deepEqual(errors, []);
  await page.close();
});

test('연결 시도가 멈추면 10초 후 재연결', async () => {
  // 첫 번째 WebSocket 은 영원히 CONNECTING 상태로 멈추게 만듭니다
  const initScript = () => {
    const Real = window.WebSocket;
    let n = 0;
    function W(url) {
      n += 1;
      window.__wsCreated = n;
      if (n === 1) {
        const fake = { url, readyState: 0, send() {}, close() { this.readyState = 3; setTimeout(() => this.onclose && this.onclose({}), 0); } };
        window.__hung = fake;
        return fake;
      }
      return new Real(url);
    }
    W.CONNECTING = 0; W.OPEN = 1; W.CLOSING = 2; W.CLOSED = 3;
    window.WebSocket = W;
  };
  const { page, errors, sockets } = await openPage({ initScript });
  await page.waitForTimeout(2000);
  assert.equal(await page.textContent('#binanceStatus'), '● Binance 연결 중');
  assert.equal(sockets.length, 0);
  await page.waitForFunction(() => document.getElementById('binanceStatus').textContent === '● Binance 실시간', null, { timeout: 20000 });
  assert.equal(await page.evaluate(() => window.__hung.readyState), 3); // 멈춘 연결은 닫힘
  assert.ok((await page.evaluate(() => window.__wsCreated)) >= 2);
  assert.equal(sockets.length, 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test('탭 선택 표시: 누른 시장이 선택되고 해당 표가 강조됨', async () => {
  const { page, errors } = await openPage();
  await page.waitForFunction(() => document.getElementById('hero').textContent.includes('65,432.1'));
  const onTabs = () => page.$$eval('.tab.on', (ns) => ns.map((n) => n.dataset.go));

  assert.deepEqual(await onTabs(), ['top']);
  await page.click('.tab[data-go="binancePanel"]');
  assert.deepEqual(await onTabs(), ['binancePanel']);
  assert.equal(await page.getAttribute('.tab[data-go="binancePanel"]', 'aria-current'), 'true');
  assert.equal(await page.getAttribute('.tab[data-go="top"]', 'aria-current'), null);
  assert.ok(await page.$eval('#binancePanel', (n) => n.classList.contains('flash')));
  assert.equal(await cssColor(page, '.tab[data-go="binancePanel"]'), 'rgb(255, 255, 255)');

  await page.click('.tab[data-go="upbitPanel"]');
  assert.deepEqual(await onTabs(), ['upbitPanel']);
  await page.waitForTimeout(1500);
  assert.deepEqual(await onTabs(), ['upbitPanel']); // 스크롤이 끝난 뒤에도 유지

  await page.click('.tab[data-go="top"]');
  await page.waitForTimeout(1500);
  assert.deepEqual(await onTabs(), ['top']);

  // 준비 중 탭은 선택되지 않음
  await page.click('.tab.soon >> nth=0');
  assert.deepEqual(await onTabs(), ['top']);

  // 직접 스크롤해도 현재 위치의 시장이 선택됨
  await page.evaluate(() => { const r = document.getElementById('binancePanel').getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top - 70); });
  await page.waitForTimeout(300);
  assert.deepEqual(await onTabs(), ['binancePanel']);
  assert.deepEqual(errors, []);
  await page.close();
});

test('모바일: 탭이 화면 상단에 고정되고 선택 표시가 보임', async () => {
  const { page, errors } = await openPage({ viewport: { width: 390, height: 844 } });
  await page.waitForFunction(() => document.getElementById('hero').textContent.includes('65,432.1'));
  await page.tap?.('.tab[data-go="upbitPanel"]').catch(() => page.click('.tab[data-go="upbitPanel"]'));
  await page.waitForTimeout(1500);
  const box = await page.$eval('#tabs', (n) => n.getBoundingClientRect().top);
  assert.ok(box >= 0 && box <= 2, `tabs top ${box}`);
  assert.deepEqual(await page.$$eval('.tab.on', (ns) => ns.map((n) => n.dataset.go)), ['upbitPanel']);
  const panelTop = await page.$eval('#upbitPanel', (n) => n.getBoundingClientRect().top);
  const tabsBottom = await page.$eval('#tabs', (n) => n.getBoundingClientRect().bottom);
  assert.ok(panelTop >= tabsBottom - 1, `패널 제목이 탭에 가려짐 (${panelTop} < ${tabsBottom})`);
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(sw <= iw, `scrollWidth ${sw} > innerWidth ${iw}`);
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, 'mobile-upbit.png') });
  assert.deepEqual(errors, []);
  await page.close();
});

test('버전 표시', async () => {
  const { page, errors } = await openPage();
  await page.waitForFunction(() => document.getElementById('appVersion').textContent.includes('v'));
  const text = await page.textContent('#appVersion');
  assert.match(text, /^COIN RADAR v\d+\.\d+\.\d+$/);
  assert.equal(await page.$eval('#appVersion', (n) => n.classList.contains('warn')), false);
  assert.deepEqual(errors, []);
  await page.close();
});
