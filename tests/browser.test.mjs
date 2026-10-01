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

// 테스트용 1분봉(REST klines 형식). SOLUSDT 만 최근 5분 동안 거래대금 4배 + 가격 +3% 로 만듭니다.
const MIN = 60000;
function klineRows(symbol, limit, startTime, mode) {
  const now = Date.now();
  const m0 = Math.floor(now / MIN) * MIN; // 진행 중인 1분봉
  const first = startTime ? startTime : m0 - (limit - 1) * MIN;
  const rows = [];
  for (let t = first; t <= m0; t += MIN) {
    const k = (m0 - MIN - t) / MIN; // 0 = 마지막 완료 봉
    let o = 100, c = 100, q = 1e6;
    if (symbol === 'SOLUSDT' && k >= 0 && k < 5) {
      const j = 4 - k; // 0..4 (오래된 → 최근)
      o = 100 + 0.6 * j;
      c = 100 + 0.6 * (j + 1);
      q = 4e6;
    } else if (symbol === 'SOLUSDT' && k < 0) { o = 103; c = 103; }
    rows.push([t, String(o), String(Math.max(o, c)), String(Math.min(o, c)), String(c), '100', t + MIN - 1, String(q), 10, '1', '1', '0']);
  }
  return mode === 'short' ? rows.slice(-4) : rows;
}

// 테스트용 Binance 선물 응답 (fapi). APTUSDT 는 선물 계약 없음, SOLUSDT 는 최근 OI 10% 증가
const FUT_MISSING = 'APTUSDT';
const fundingOf = { BTCUSDT: '0.00012500', ETHUSDT: '-0.00018000' };
function futuresRoute(mode, counter) {
  return (r) => {
    counter.n += 1;
    const cors = { 'access-control-allow-origin': '*' };
    if (mode === 'fail') return r.fulfill({ status: 500, body: 'x', headers: cors });
    if (mode === 'ratelimit') return r.fulfill({ status: 429, body: 'x', headers: { ...cors, 'retry-after': '120' } });
    const u = new URL(r.request().url());
    const sym = u.searchParams.get('symbol');
    const now = Date.now();
    const prem = (s) => ({ symbol: s, markPrice: '100.0', indexPrice: '100.0', lastFundingRate: fundingOf[s] || '0.00010000', nextFundingTime: Math.ceil(now / 28800000) * 28800000, time: now });
    if (u.pathname === '/fapi/v1/premiumIndex') {
      if (sym) return r.fulfill({ json: prem(sym), headers: cors });
      const all = SYMS.map((b) => b + 'USDT').filter((s) => s !== FUT_MISSING).map(prem);
      all.push(prem('BTCUSDT_261226'));
      return r.fulfill({ json: all, headers: cors });
    }
    const oiNow = sym === 'SOLUSDT' ? 1100 : 1000;
    if (u.pathname === '/fapi/v1/openInterest') return r.fulfill({ json: { symbol: sym, openInterest: String(oiNow), time: now }, headers: cors });
    if (u.pathname === '/futures/data/openInterestHist') {
      const f5 = Math.floor(now / 300000) * 300000;
      const list = [];
      for (let k = 12; k >= 0; k -= 1) {
        const oi = sym === 'SOLUSDT' && k < 2 ? 1100 : 1000;
        list.push({ symbol: sym, sumOpenInterest: String(oi), sumOpenInterestValue: String(oi * 100), timestamp: f5 - k * 300000 });
      }
      return r.fulfill({ json: list, headers: cors });
    }
    return r.fulfill({ status: 404, body: 'x', headers: cors });
  };
}

// ── Phase 6A: 정보(뉴스/공지) 테스트용 고정 응답 (표시 로직 검증용 입력이며 서비스 코드에는 들어가지 않음) ──
function intelEvents(now) {
  const base = { importance_base: 0, reaction_bonus: 0, item_count: 1, source_count: 1, updated_at: now, market: [] };
  return [
    { ...base, id: 1, title: 'Binance Will List Solana (SOL) with Seed Tag Applied', url: 'https://www.binance.com/en/support/announcement/abc123', category: 'listing', symbols: ['SOL'], importance: 68, verification: 'official', source: 'binance', source_type: 'official', sources: ['binance'], published_at: now - 6 * 60000, event_time: now - 6 * 60000, first_seen_at: now - 4 * 60000 },
    { ...base, id: 2, title: 'Bitcoin ETF inflows hit a new record', url: 'https://www.coindesk.com/markets/btc-etf', category: 'regulation', symbols: ['BTC'], importance: 61, verification: 'multi', source: 'coindesk', source_type: 'news', sources: ['coindesk', 'cointelegraph'], source_count: 2, item_count: 2, published_at: now - 50 * 60000, event_time: now - 50 * 60000, first_seen_at: now - 45 * 60000 },
    { ...base, id: 3, title: '[거래] 제트제트(ZZZ) KRW 마켓 디지털 자산 추가', url: 'https://upbit.com/service_center/notice?id=999', category: 'listing', symbols: ['ZZZ'], importance: 55, verification: 'official', source: 'upbit', source_type: 'official', sources: ['upbit'], published_at: now - 2 * 3600000, event_time: now - 2 * 3600000, first_seen_at: now - 2 * 3600000 },
    { ...base, id: 4, title: '<img src=x onerror="window.__xss=1"> Dogecoin <script>window.__xss=2</script>news', url: 'javascript:window.__xss=3', category: 'general', symbols: ['XRP'], importance: 30, verification: 'news', source: 'blockmedia', source_type: 'news', sources: ['blockmedia'], published_at: null, event_time: now - 3 * 3600000, first_seen_at: now - 3 * 3600000 },
    { ...base, id: 5, title: 'Fed holds rates steady', url: 'https://cointelegraph.com/news/fed', category: 'general', symbols: [], importance: 20, verification: 'news', source: 'cointelegraph', source_type: 'news', sources: ['cointelegraph'], published_at: now - 5 * 3600000, event_time: now - 5 * 3600000, first_seen_at: now - 5 * 3600000 },
  ];
}
function intelStatus(now, mode = 'ok') {
  const mk = (id, label, status, last, err) => ({ id, label, type: 'x', status, last_success_at: last, last_error: err || null });
  if (mode === 'pending') return { status: 'degraded', now, diagnostics: { code: 'cron_not_seen', hint: '정보 수집 Cron 실행 기록이 없습니다' }, sources: ['Binance 공지', 'Upbit 공지', 'BlockMedia', 'CoinDesk', 'Cointelegraph'].map((l, i) => mk('s' + i, l, 'pending', null)) };
  if (mode === 'errors') return { status: 'degraded', now, diagnostics: { code: 'error', hint: '마지막 collector 실행에 오류가 있었습니다' }, sources: [mk('binance', 'Binance 공지', 'error', null, 'HTTP 451'), mk('upbit', 'Upbit 공지', 'ok', now - 60000), mk('coindesk', 'CoinDesk', 'error', now - 30 * 60000, 'HTTP 503'), mk('blockmedia', 'BlockMedia', 'pending', null)] };
  return { status: 'ok', now, sources: [
    { id: 'binance', label: 'Binance 공지', type: 'official', status: 'ok', last_success_at: now - 2 * 60000 },
    { id: 'upbit', label: 'Upbit 공지', type: 'official', status: 'ok', last_success_at: now - 60000 },
    { id: 'coindesk', label: 'CoinDesk', type: 'news', status: 'delayed', last_success_at: now - 17 * 60000 },
    { id: 'blockmedia', label: 'BlockMedia', type: 'news', status: 'pending', last_success_at: null },
  ] };
}

async function openPage({ upbitFail = false, viewport, initScript, wsMessages, klines = 'full', context, futures = 'ok', intel = 'ok' } = {}) {
  const page = context ? await context.newPage() : await browser.newPage(viewport ? { viewport } : {});
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const sockets = [];
  await page.routeWebSocket(/binance/, (ws) => {
    sockets.push(ws);
    for (const m of wsMessages || [tickerMsg('BTCUSDT', 65432.1, 1.5), miniMsg]) ws.send(m);
  });
  // Playwright 의 WebSocket 가로채기 뒤에 등록해야 테스트용 WebSocket 교체가 적용됩니다
  if (initScript) await page.addInitScript(initScript);
  await page.route(/binance\.(com|vision)\/api\/v3\/klines/, (r) => {
    if (klines === 'fail') return r.fulfill({ status: 503, body: 'x', headers: { 'access-control-allow-origin': '*' } });
    const u = new URL(r.request().url());
    const json = klineRows(u.searchParams.get('symbol'), Number(u.searchParams.get('limit')), Number(u.searchParams.get('startTime')) || 0, klines);
    return r.fulfill({ json, headers: { 'access-control-allow-origin': '*' } });
  });
  const futCalls = { n: 0 };
  await page.route(/fapi\.binance\.com/, futuresRoute(futures, futCalls));
  await page.route(/binance\.(com|vision)\/api\/v3\/ticker\/24hr/, (r) => r.fulfill({ json: rest24h, headers: { 'access-control-allow-origin': '*' } }));
  await page.route(/api\.upbit\.com/, (r) => {
    if (upbitFail) return r.fulfill({ status: 500, body: 'x', headers: { 'access-control-allow-origin': '*' } });
    const json = r.request().url().includes('market/all') ? upbitMarkets : upbitTicker;
    return r.fulfill({ json, headers: { 'access-control-allow-origin': '*' } });
  });
  const intelCalls = { events: 0, status: 0 };
  await page.route(/workers\.dev\/api\/intelligence/, (r) => {
    const cors = { 'access-control-allow-origin': '*' };
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('/status')) intelCalls.status += 1;
    else intelCalls.events += 1;
    if (intel === 'fail') return r.fulfill({ status: 503, body: 'x', headers: cors });
    const noEvents = intel === 'empty' || intel === 'pending' || intel === 'errors';
    return r.fulfill({ json: path.endsWith('/status') ? intelStatus(Date.now(), intel) : { status: 'ok', count: 0, events: noEvents ? [] : intelEvents(Date.now()) }, headers: cors });
  });
  await page.goto(base);
  return { page, errors, sockets, futCalls, intelCalls };
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
  // 단기 레이더 (기본 5분)
  await page.waitForFunction(() => document.querySelector('#signals [data-symbol]'));
  assert.equal(await page.getAttribute('#signals .signal >> nth=0', 'data-symbol'), 'SOLUSDT');
  const first = await page.textContent('#signals .signal >> nth=0');
  assert.match(first, /가격 급변 \+ 거래량 이상/);
  assert.match(first, /5분 \+3\.00% · 거래 활동 4\.0배/);
  assert.match(first, /레이더 점수 88/);
  assert.match(first, /평소 \$5\.00M, 직전 12구간 평균/);
  assert.equal(await page.locator('.controls .btn:disabled').count(), 0);
  assert.equal(await page.getAttribute('.winbtn[data-win="5"]', 'aria-pressed'), 'true');
  assert.match(sockets[0].url(), /solusdt@kline_1m/);
  assert.match(sockets[0].url(), /btcusdt@ticker/);
  assert.doesNotMatch(sockets[0].url(), /!miniTicker@arr/);
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

// ── Phase 2+3 레이더 화면 테스트 ──

test('1분/5분/15분 버튼: 순위·변화율·거래 활동·상태가 선택 구간 기준으로 바뀜', async () => {
  const { page, errors } = await openPage();
  await page.waitForFunction(() => document.querySelector('#signals [data-symbol]'));
  const firstCard = () => page.textContent('#signals .signal >> nth=0');

  await page.click('.winbtn[data-win="1"]');
  assert.equal(await page.getAttribute('.winbtn[data-win="1"]', 'aria-pressed'), 'true');
  assert.equal(await page.getAttribute('.winbtn[data-win="5"]', 'aria-pressed'), 'false');
  let t = await firstCard();
  assert.match(t, /1분 \+0\.59% · 거래 활동 2\.0배/);
  assert.match(t, /가격 급변 \+ 활동 증가/);
  assert.match(await page.textContent('#hero'), /1분 /);

  await page.click('.winbtn[data-win="15"]');
  t = await firstCard();
  assert.match(t, /15분 \+3\.00% · 거래 활동 2\.0배/);
  assert.match(t, /가격 급변 \+ 활동 증가/);
  assert.match(await page.textContent('#radarInfo'), /완료된 1분봉 기준 · 감시 17종목 · 계산 가능 17종목/);
  assert.match(await page.textContent('#volumeEvent'), /0종목/);

  await page.click('.winbtn[data-win="5"]');
  assert.match(await page.textContent('#volumeEvent'), /1종목[\s\S]*SOL/);

  // 선택 구간은 새로고침 후에도 유지
  await page.click('.winbtn[data-win="15"]');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#signals [data-symbol]'));
  assert.equal(await page.getAttribute('.winbtn[data-win="15"]', 'aria-pressed'), 'true');
  assert.deepEqual(errors, []);
  await page.close();
});

test('데이터가 부족하면 수집 중 + 남은 시간 표시 (추정값 없음)', async () => {
  const { page, errors } = await openPage({ klines: 'short' });
  // 처음에는 1분봉이 하나도 없어 약 35분, REST 로 3개를 받은 뒤에는 약 32분
  await page.waitForFunction(() => /데이터 수집 중 \(약 3[123]분 남음\)/.test(document.getElementById('signals').textContent));
  const t = await page.textContent('#signals');
  assert.match(t, /5분 데이터 수집 중 \(약 3[123]분 남음\)/);
  assert.equal(await page.locator('#signals [data-symbol]').count(), 0);
  assert.match(await page.textContent('#hero'), /5분 데이터 수집 중/);
  assert.match(await page.textContent('#volumeEvent'), /데이터 수집 중/);
  assert.doesNotMatch(await page.textContent('#signals'), /배|레이더 점수/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('localStorage 복원: 새로고침/재접속 시 수집 데이터 유지', async () => {
  const context = await browser.newContext();
  const a = await openPage({ context });
  await a.page.waitForFunction(() => document.querySelector('#signals [data-symbol]'));
  await a.page.waitForFunction(() => !!localStorage.getItem('coinradar.candles.v1'), null, { timeout: 10000 });
  const saved = await a.page.evaluate(() => JSON.parse(localStorage.getItem('coinradar.candles.v1')));
  assert.equal(saved.v, 1);
  assert.ok(saved.s.SOLUSDT.length >= 190);
  assert.ok(saved.s.SOLUSDT.every((row) => row.length === 7)); // 시각·시고저종·거래량·거래대금만
  await a.page.close();

  // 두 번째 접속: 과거 1분봉 REST 가 실패해도 저장 데이터로 바로 계산
  const b = await openPage({ context, klines: 'fail' });
  await b.page.waitForFunction(() => document.querySelector('#signals [data-symbol]'), null, { timeout: 10000 });
  assert.equal(await b.page.getAttribute('#signals .signal >> nth=0', 'data-symbol'), 'SOLUSDT');
  assert.match(await b.page.textContent('#signals .signal >> nth=0'), /거래 활동 4\.0배/);
  assert.deepEqual([...a.errors, ...b.errors], []);
  await context.close();
});

test('WebSocket 1분봉 수신: 완료된 봉이 레이더에 반영', async () => {
  const now = Date.now();
  const m0 = Math.floor(now / MIN) * MIN;
  const k = (t, x) => JSON.stringify({ stream: 'dogeusdt@kline_1m', data: { e: 'kline', E: now, s: 'DOGEUSDT', k: { t, T: t + MIN - 1, s: 'DOGEUSDT', i: '1m', o: '100', c: '100', h: '100', l: '100', v: '1', q: '1', x } } });
  const { page, errors, sockets } = await openPage({ wsMessages: [tickerMsg('BTCUSDT', 65432.1, 1.5), k(m0, false)] });
  await page.waitForFunction(() => document.getElementById('binanceStatus').textContent === '● Binance 실시간');
  await page.waitForFunction(() => document.querySelector('#signals [data-symbol]'));
  // 진행 중 봉은 저장하지 않고, 완료된 봉만 저장
  await page.waitForFunction(() => !!localStorage.getItem('coinradar.candles.v1'), null, { timeout: 10000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('coinradar.candles.v1')));
  assert.ok(!saved.s.DOGEUSDT.some((r) => r[0] === m0));
  sockets[0].send(k(m0, true));
  await page.waitForFunction((t) => {
    const d = JSON.parse(localStorage.getItem('coinradar.candles.v1'));
    return d.s.DOGEUSDT.some((r) => r[0] === t);
  }, m0, { timeout: 10000 });
  assert.deepEqual(errors, []);
  await page.close();
});

test('모바일: 레이더 버튼·카드 표시, 가로 스크롤 없음', async () => {
  const { page, errors } = await openPage({ viewport: { width: 390, height: 844 } });
  await page.waitForFunction(() => document.querySelector('#signals [data-symbol]'));
  await page.click('.winbtn[data-win="15"]');
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(sw <= iw, `scrollWidth ${sw} > innerWidth ${iw}`);
  const btn = await page.$eval('.winbtn[data-win="15"]', (n) => n.getBoundingClientRect().width);
  assert.ok(btn >= 40);
  if (process.env.SCREENSHOT_DIR) {
    await page.$eval('#radarPanel', (n) => n.scrollIntoView());
    await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, 'mobile-radar.png') });
  }
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Phase 5 선물 레이더 화면 테스트 (Binance 선물 응답은 테스트용 고정값) ──

test('선물 탭·카드: OI 금액·변화, Funding, 가격·OI 조합, 활동도 순 정렬, 선물 없는 종목 표시', async () => {
  const { page, errors } = await openPage();
  await page.waitForFunction(() => document.getElementById('futStatus').textContent === '● 선물 정상');
  await page.waitForFunction(() => /가격↑ · OI↑/.test(document.getElementById('futCards').textContent));
  assert.equal(await page.locator('.tab[data-go="futuresPanel"]').count(), 1);
  await page.click('.tab[data-go="futuresPanel"]');
  assert.deepEqual(await page.$$eval('.tab.on', (ns) => ns.map((n) => n.dataset.go)), ['futuresPanel']);

  const first = page.locator('#futCards .fcard').first();
  assert.equal(await first.getAttribute('data-symbol'), 'SOLUSDT'); // 활동도 가장 높음
  const sol = await first.textContent();
  assert.match(sol, /선물시장 활동도 69/);
  assert.match(sol, /가격↑ · OI↑/);
  assert.match(sol, /OI 급증/);
  assert.match(sol, /\$110\.0K/); // 1100 × Mark 100
  assert.match(sol, /\+10\.00%/); // 15분 OI
  assert.match(sol, /현물 15분\+3\.00%/);
  const btc = await page.textContent('#futCards [data-symbol="BTCUSDT"]');
  assert.match(btc, /\+0\.0125%/);
  assert.match(btc, /양수 펀딩/);
  assert.match(await page.textContent('#futCards [data-symbol="ETHUSDT"]'), /-0\.0180%\s*음수 펀딩/);
  assert.match(await page.textContent('#futInfo'), /선물 없음: APT/);
  assert.match(await page.textContent('#futCards'), /갱신 \d/);
  assert.doesNotMatch(await page.textContent('#futuresPanel'), /매수|매도|롱|숏|진입/);
  assert.match(await page.textContent('#appVersion'), /v1\.4\.0/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('선물 API 실패: 선물만 재연결 표시, 현물·Upbit 는 정상, 재시도는 천천히(backoff)', async () => {
  const { page, errors, futCalls } = await openPage({ futures: 'fail' });
  await page.waitForFunction(() => /선물 재연결 중/.test(document.getElementById('futStatus').textContent));
  await page.waitForFunction(() => document.getElementById('binanceStatus').textContent === '● Binance 실시간');
  await page.waitForFunction(() => document.getElementById('upbitStatus').textContent === '● Upbit 정상');
  await page.waitForFunction(() => document.querySelector('#signals [data-symbol]'));
  assert.match(await page.textContent('#futCards'), /선물 데이터를 받지 못했습니다/);
  assert.equal(await page.getAttribute('#futStatus', 'data-level'), 'err');
  const before = futCalls.n;
  await page.waitForTimeout(3000);
  assert.equal(futCalls.n, before); // 5초 이내 재요청 없음
  await page.waitForFunction((b) => document.getElementById('futStatus').textContent.includes('재연결') && true, before);
  assert.deepEqual(errors, []);
  await page.close();
});

test('선물 API 429(요청 제한): Retry-After 만큼 기다림', async () => {
  const { page, errors } = await openPage({ futures: 'ratelimit' });
  await page.waitForFunction(() => /선물 재연결 중 \((11\d|120)초 후\)/.test(document.getElementById('futStatus').textContent));
  assert.deepEqual(errors, []);
  await page.close();
});

test('localStorage 손상 데이터가 있어도 사이트·선물 레이더 정상', async () => {
  const initScript = () => {
    localStorage.setItem('coinradar.futures.v1', '{broken json');
    localStorage.setItem('coinradar.candles.v1', 'garbage');
    localStorage.setItem('coinradar.window', 'nan');
  };
  const { page, errors } = await openPage({ initScript });
  await page.waitForFunction(() => document.getElementById('futStatus').textContent === '● 선물 정상');
  await page.waitForFunction(() => document.querySelector('#futCards .fcard') && document.querySelector('#signals [data-symbol]'));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('coinradar.futures.v1')));
  assert.equal(saved.v, 1);
  assert.ok(saved.s.SOLUSDT.length >= 2);
  assert.deepEqual(errors, []);
  await page.close();
});

test('모바일: 선물 카드 가로 스크롤 없음, 모바일 종목 수 10개', async () => {
  const { page, errors } = await openPage({ viewport: { width: 390, height: 844 } });
  await page.waitForFunction(() => /가격↑ · OI↑/.test(document.getElementById('futCards').textContent));
  await page.click('.tab[data-go="futuresPanel"]');
  await page.waitForTimeout(800);
  assert.ok((await page.locator('#futCards .fcard').count()) <= 10);
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(sw <= iw, `scrollWidth ${sw} > innerWidth ${iw}`);
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, 'mobile-futures.png') });
  assert.deepEqual(errors, []);
  await page.close();
});

test('데스크톱: 선물 레이더 표시', async () => {
  const { page, errors } = await openPage({ viewport: { width: 1280, height: 900 } });
  await page.waitForFunction(() => /가격↑ · OI↑/.test(document.getElementById('futCards').textContent));
  await page.$eval('#futuresPanel', (n) => n.scrollIntoView());
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, 'desktop-futures.png') });
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(sw <= iw);
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Phase 6A: 뉴스/정보 탭 ──

test('뉴스 탭: 활성화(준비 중 아님), 이동·선택 표시, 카드·검증 배지·출처 상태', async () => {
  const { page, errors } = await openPage();
  await page.waitForFunction(() => document.querySelectorAll('#intelList .icard').length === 5);
  assert.equal(await page.locator('.tab', { hasText: '뉴스' }).evaluate((n) => n.classList.contains('soon')), false);
  assert.doesNotMatch(await page.textContent('#tabs'), /뉴스준비 중/);
  await page.click('.tab[data-go="intelPanel"]');
  await page.waitForTimeout(1500);
  assert.deepEqual(await page.$$eval('.tab.on', (ns) => ns.map((n) => n.dataset.go)), ['intelPanel']);
  const card1 = await page.textContent('#intelList .icard[data-event="1"]');
  assert.match(card1, /SOL/);
  assert.match(card1, /공식 확인/);
  assert.match(card1, /Binance · 6분 전/);
  assert.match(card1, /KST/);
  assert.match(card1, /Binance Will List Solana/);
  assert.match(card1, /정보 중요도 68/);
  assert.match(await page.textContent('#intelList .icard[data-event="2"]'), /복수 출처 확인/);
  assert.match(await page.textContent('#intelList .icard[data-event="2"]'), /CoinDesk 외 1곳/);
  assert.match(await page.textContent('#intelList .icard[data-event="4"]'), /게시 시간 미확인 · 수집 3시간 전/);
  assert.match(await page.textContent('#intelSources'), /Binance 공지 정상 · 2분 전/);
  assert.match(await page.textContent('#intelSources'), /CoinDesk 지연 · 17분 전/);
  assert.match(await page.textContent('#intelSources'), /BlockMedia 수집 준비 중/);
  assert.match(await page.textContent('#intelStatus'), /일부 출처 수집 오류 \(1개\)/);
  assert.match(await page.textContent('#newsEvent'), /5건/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('뉴스 카드 보안: 원문 링크는 새 탭 + noopener noreferrer, 위험 URL 링크 없음, 제목 XSS 실행 안 됨', async () => {
  const { page, errors } = await openPage();
  await page.waitForFunction(() => document.querySelectorAll('#intelList .icard').length === 5);
  const links = await page.$$eval('#intelList a', (as) => as.map((a) => ({ href: a.href, target: a.target, rel: a.rel })));
  assert.equal(links.length, 4); // 위험 URL 인 4번 카드는 링크 없음
  for (const l of links) {
    assert.match(l.href, /^https:\/\//);
    assert.equal(l.target, '_blank');
    assert.match(l.rel, /noopener/);
    assert.match(l.rel, /noreferrer/);
  }
  assert.equal(await page.$$eval('a[href^="javascript"]', (n) => n.length), 0);
  assert.match(await page.textContent('#intelList .icard[data-event="4"]'), /원문 링크 없음/);
  assert.equal(await page.$('#intelList img'), null);
  assert.equal(await page.$('#intelList script'), null);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.match(await page.textContent('#intelList .icard[data-event="4"] .ititle'), /<img src=x/); // 텍스트로 그대로 보임
  assert.deepEqual(errors, []);
  await page.close();
});

test('시장 반응 연결: 감시 종목은 실제 가격·거래 활동·OI, 없는 코인은 안내만 (임의 숫자 없음)', async () => {
  const { page, errors } = await openPage();
  await page.waitForFunction(() => document.querySelector('#signals [data-symbol]')); // 1분봉 수집 완료
  await page.waitForFunction(() => /OI 5분/.test(document.querySelector('#intelList .icard[data-event="1"]')?.textContent || ''), null, { timeout: 15000 });
  const sol = await page.textContent('#intelList .icard[data-event="1"]');
  assert.match(sol, /시장 반응 · SOL 기준/);
  assert.match(sol, /가격 5분 \/ 15분\+3\.00% \/ \+3\.00%/);
  assert.match(sol, /거래 활동\d+\.\d배/);
  assert.match(sol, /OI 5분 \/ 15분/);
  assert.match(sol, /Funding\+0\.0100%/);
  const zzz = await page.textContent('#intelList .icard[data-event="3"]');
  assert.match(zzz, /Binance 감시 종목이 아니어서 시장 데이터 없음/);
  assert.doesNotMatch(zzz, /\d+\.\d+%/);
  assert.equal(await page.$('#intelList .icard[data-event="5"] .ireact'), null); // 코인 없는 뉴스
  assert.deepEqual(errors, []);
  await page.close();
});

test('필터: 전체/공식/뉴스 + 코인, 선택 상태 유지', async () => {
  const { page, errors } = await openPage();
  await page.waitForFunction(() => document.querySelectorAll('#intelList .icard').length === 5);
  const ids = () => page.$$eval('#intelList .icard', (n) => n.map((x) => x.dataset.event));
  await page.click('#intelKind [data-kind="official"]');
  assert.deepEqual(await ids(), ['1', '3']);
  assert.equal(await page.getAttribute('#intelKind [data-kind="official"]', 'aria-pressed'), 'true');
  await page.click('#intelKind [data-kind="news"]');
  assert.deepEqual(await ids(), ['2', '4', '5']);
  await page.click('#intelKind [data-kind="all"]');
  await page.click('#intelCoin [data-coin="BTC"]');
  assert.deepEqual(await ids(), ['2']);
  await page.click('#intelCoin [data-coin="OTHER"]');
  assert.deepEqual(await ids(), ['3', '5']);
  await page.click('#intelCoin [data-coin="XRP"]');
  assert.deepEqual(await ids(), ['4']);
  await page.click('#intelCoin [data-coin="ETH"]');
  assert.match(await page.textContent('#intelList'), /선택한 조건에 맞는 정보가 없습니다/);
  await page.click('#intelCoin [data-coin="SOL"]');
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#intelList .icard').length === 1);
  assert.equal(await page.getAttribute('#intelCoin [data-coin="SOL"]', 'aria-pressed'), 'true'); // 새로고침 후에도 유지
  assert.deepEqual(errors, []);
  await page.close();
});

test('전체 레이더: 최근 중요 정보 상위 표시 (중요도 + 최신성 순, 최대 5개, 링크 안전)', async () => {
  const { page, errors } = await openPage();
  await page.waitForFunction(() => document.querySelectorAll('#intelTopList .imini').length > 0);
  const ids = await page.$$eval('#intelTopList .imini', (n) => n.map((x) => x.dataset.event));
  assert.deepEqual(ids, ['1', '2', '3', '4', '5']);
  assert.match(await page.textContent('#intelTopList .imini >> nth=0'), /SOL 공식 확인.*Binance · 6분 전 · 정보 중요도 68/);
  assert.match(await page.textContent('#intelTopList .imini[data-event="4"]'), /\(수집 시각\)/);
  assert.equal(await page.$$eval('#intelTopList a[href^="javascript"]', (n) => n.length), 0);
  // 전체 레이더(맨 위)에서 시세 카드와 같은 화면에 보임
  assert.ok(await page.$eval('#intelTop', (n) => n.getBoundingClientRect().top < 3000));
  assert.deepEqual(errors, []);
  await page.close();
});

test('정보 서버 실패: 정보 영역만 오류 표시, 시세·레이더·선물은 정상', async () => {
  const { page, errors } = await openPage({ intel: 'fail' });
  await page.waitForFunction(() => document.getElementById('intelStatus').textContent.includes('연결 실패'));
  assert.match(await page.textContent('#intelList'), /정보 서버에 연결하지 못했습니다/);
  assert.match(await page.textContent('#intelTopList'), /정보 서버에 연결하지 못했습니다/);
  await page.waitForFunction(() => document.getElementById('hero').textContent.includes('65,432.1'));
  await page.waitForFunction(() => document.getElementById('connStatus').textContent.includes('Binance 실시간'));
  await page.waitForFunction(() => document.querySelector('#signals [data-symbol]'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('정보가 아직 없을 때: 빈 상태 안내', async () => {
  const { page, errors } = await openPage({ intel: 'empty' });
  await page.waitForFunction(() => document.getElementById('intelList').textContent.includes('아직 수집된 정보가 없습니다'));
  assert.match(await page.textContent('#newsEvent'), /0건/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('모바일 뉴스 탭: 카드 표시, 가로 스크롤 없음, 탭 고정', async () => {
  const { page, errors } = await openPage({ viewport: { width: 390, height: 844 } });
  await page.waitForFunction(() => document.querySelectorAll('#intelList .icard').length === 5);
  await page.click('.tab[data-go="intelPanel"]');
  await page.waitForTimeout(1500);
  assert.deepEqual(await page.$$eval('.tab.on', (ns) => ns.map((n) => n.dataset.go)), ['intelPanel']);
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(sw <= iw, `scrollWidth ${sw} > innerWidth ${iw}`);
  const over = await page.$$eval('#intelList .icard', (ns) => ns.filter((n) => n.getBoundingClientRect().right > window.innerWidth).length);
  assert.equal(over, 0);
  const linkH = await page.$eval('#intelList .ilink', (n) => n.getBoundingClientRect().height);
  assert.ok(linkH >= 34, `원문 링크 터치 영역 ${linkH}`);
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, 'mobile-intel.png') });
  assert.deepEqual(errors, []);
  await page.close();
});

test('첫 수집 전(모든 출처 pending): "수집 준비 중" 표시, "정보 정상"/"연결 실패" 아님', async () => {
  const { page, errors } = await openPage({ intel: 'pending' });
  await page.waitForFunction(() => document.getElementById('intelStatus').textContent.includes('수집 준비 중'));
  assert.doesNotMatch(await page.textContent('#intelStatus'), /정보 정상|연결 실패/);
  await page.waitForFunction(() => document.getElementById('intelSources').textContent.includes('수집 준비 중'));
  assert.equal(await page.locator('#intelSources .pending').count(), 5);
  assert.match(await page.textContent('#intelList'), /수집 준비 중/);
  assert.doesNotMatch(await page.textContent('#intelList'), /연결하지 못했습니다/);
  assert.match(await page.textContent('#intelInfo'), /0건/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('일부 출처 수집 오류: 해당 출처만 "수집 오류"로 표시, 서버 연결 실패 아님', async () => {
  const { page, errors } = await openPage({ intel: 'errors' });
  await page.waitForFunction(() => document.getElementById('intelSources').textContent.includes('수집 오류'));
  assert.match(await page.textContent('#intelStatus'), /일부 출처 수집 오류 \(2개\)/);
  assert.doesNotMatch(await page.textContent('#intelStatus'), /연결 실패/);
  const src = await page.textContent('#intelSources');
  assert.match(src, /Binance 공지 수집 오류 · 아직 성공 기록 없음/);
  assert.match(src, /CoinDesk 수집 오류 · 마지막 성공 30분 전/);
  assert.match(src, /Upbit 공지 정상/);
  assert.match(src, /BlockMedia 수집 준비 중/);
  assert.equal(await page.locator('#intelSources .error').count(), 2);
  assert.equal(await page.getAttribute('#intelSources .error >> nth=0', 'title'), 'HTTP 451');
  assert.match(await page.textContent('#intelList'), /수집 오류가 있습니다/);
  assert.match(await page.textContent('#intelSources'), /진단: 마지막 collector 실행에 오류/);
  assert.deepEqual(errors, []);
  await page.close();
});
