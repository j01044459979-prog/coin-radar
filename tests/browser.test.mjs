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

async function openPage({ upbitFail = false, viewport } = {}) {
  const page = await browser.newPage(viewport ? { viewport } : {});
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const sockets = [];
  await page.routeWebSocket(/binance/, (ws) => {
    sockets.push(ws);
    ws.send(tickerMsg('BTCUSDT', 65432.1, 1.5));
    ws.send(miniMsg);
  });
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
