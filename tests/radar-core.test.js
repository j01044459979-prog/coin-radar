// 화면용 계산 함수 테스트. 실행: node --test tests/*.test.*
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/radar-core.js');

test('WebSocket 결합 스트림 주소', () => {
  const url = C.buildStreamUrl('wss://stream.binance.com:9443', ['BTCUSDT', 'ETHUSDT']);
  assert.equal(url, 'wss://stream.binance.com:9443/stream?streams=!miniTicker@arr/btcusdt@ticker/ethusdt@ticker');
});

test('공식 Binance 주소만 사용', () => {
  for (const h of [...C.BINANCE_WS_HOSTS, ...C.BINANCE_REST_HOSTS]) {
    assert.match(h, /^(wss|https):\/\/(stream|api|data-stream|data-api)\.binance\.(com|vision)(:9443)?$/);
  }
});

test('@ticker 이벤트: Binance가 준 24H 등락률(P)을 그대로 사용', () => {
  const list = C.parseStreamMessage(JSON.stringify({
    stream: 'btcusdt@ticker',
    data: { e: '24hrTicker', s: 'BTCUSDT', c: '65000.5', P: '-1.234', q: '1500000000', v: '23000' },
  }));
  assert.deepEqual(list, [{ symbol: 'BTCUSDT', last: 65000.5, changePct: -1.234, quoteVol: 1500000000, baseVol: 23000 }]);
});

test('!miniTicker@arr: 24H 시가(o)와 현재가(c)로 등락률 계산, USDT 마켓만', () => {
  const list = C.parseStreamMessage({
    stream: '!miniTicker@arr',
    data: [
      { e: '24hrMiniTicker', s: 'SOLUSDT', c: '110', o: '100', q: '5000000', v: '50000' },
      { e: '24hrMiniTicker', s: 'ETHBTC', c: '0.05', o: '0.05', q: '1', v: '1' },
    ],
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].symbol, 'SOLUSDT');
  assert.ok(Math.abs(list[0].changePct - 10) < 1e-9);
});

test('잘못된 메시지는 무시', () => {
  assert.deepEqual(C.parseStreamMessage('not json'), []);
  assert.deepEqual(C.parseStreamMessage({ result: null, id: 1 }), []);
  assert.deepEqual(C.parseStreamMessage({ stream: 'x@depth', data: {} }), []);
});

test('시가가 0이면 등락률은 null (임의 값 생성 안 함)', () => {
  assert.equal(C.fromMiniTicker({ s: 'AUSDT', c: '1', o: '0', q: '1', v: '1' }).changePct, null);
});

test('REST 24hr 변환', () => {
  const r = C.fromRest24h({ symbol: 'XRPUSDT', lastPrice: '0.5', priceChangePercent: '2.5', quoteVolume: '100', volume: '200' });
  assert.deepEqual(r, { symbol: 'XRPUSDT', last: 0.5, changePct: 2.5, quoteVol: 100, baseVol: 200 });
});

test('거래대금 TOP 정렬', () => {
  const rows = [{ symbol: 'A', quoteVol: 1 }, { symbol: 'B', quoteVol: 3 }, { symbol: 'C', quoteVol: null }, { symbol: 'D', quoteVol: 2 }];
  assert.deepEqual(C.topByQuoteVolume(rows, 2).map((r) => r.symbol), ['B', 'D']);
});

test('등락률 상위/하위: 거래대금 기준 미달 종목 제외', () => {
  const rows = [
    { symbol: 'A', changePct: 50, quoteVol: 1 },
    { symbol: 'B', changePct: 5, quoteVol: 20e6 },
    { symbol: 'C', changePct: -7, quoteVol: 20e6 },
    { symbol: 'D', changePct: 1, quoteVol: 20e6 },
  ];
  const { up, down } = C.topMovers(rows, 1, 10e6);
  assert.equal(up[0].symbol, 'B');
  assert.equal(down[0].symbol, 'C');
});

test('재연결 대기 시간: 1초부터 최대 30초', () => {
  const zero = () => 0;
  assert.equal(C.reconnectDelay(0, zero), 1000);
  assert.equal(C.reconnectDelay(3, zero), 8000);
  assert.equal(C.reconnectDelay(20, zero), 30000);
});

test('숫자 표시 형식', () => {
  assert.equal(C.fmtCompact(1.5e9), '1.5B');
  assert.equal(C.fmtCompact(null), '—');
  assert.equal(C.fmtPrice(65000.123), '65,000.12');
  assert.equal(C.fmtPct(1.2345), '+1.23%');
  assert.equal(C.fmtPct(-0.5), '-0.50%');
  assert.equal(C.esc('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});

test('Binance 상태: 데이터 수신 중이면 실시간(초록)', () => {
  const now = 1_000_000;
  assert.deepEqual(C.binanceStatusView({ state: 'live', lastMsg: now - 1000 }, now), { text: 'Binance 실시간', level: 'ok' });
  assert.equal(C.binanceStatusView({ state: 'live', lastMsg: now - 15000 }, now).level, 'warn');
  assert.deepEqual(C.binanceStatusView({ state: 'connecting' }, now), { text: 'Binance 연결 중', level: 'warn' });
  assert.equal(C.binanceStatusView({ state: 'reconnecting', retryAt: now + 3200 }, now).text, 'Binance 재연결 중 (4초 후)');
  assert.equal(C.binanceStatusView({ state: 'error', retryAt: now + 1000 }, now).level, 'err');
});

test('Upbit 상태는 Binance 와 별개로 판정', () => {
  const now = 1_000_000;
  assert.deepEqual(C.upbitStatusView({ state: 'ok', last: now - 1000 }, now), { text: 'Upbit 정상', level: 'ok' });
  assert.equal(C.upbitStatusView({ state: 'ok', last: now - 100000 }, now).level, 'warn');
  assert.deepEqual(C.upbitStatusView({ state: 'error' }, now), { text: 'Upbit 재시도 중', level: 'err' });
  assert.deepEqual(C.upbitStatusView({ state: 'loading' }, now), { text: 'Upbit 불러오는 중', level: 'warn' });
});

test('버전: radar-core.js, index.html APP_VERSION, script ?v= 가 모두 같음 (캐시 섞임 방지)', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(C.VERSION, /^\d+\.\d+\.\d+$/);
  assert.ok(html.includes(`const APP_VERSION = '${C.VERSION}'`), 'APP_VERSION 불일치');
  assert.ok(html.includes(`assets/radar-core.js?v=${C.VERSION}"`), 'script ?v= 불일치');
  const E = require('../assets/radar-engine.js');
  assert.equal(E.VERSION, C.VERSION, 'radar-engine.js VERSION 불일치');
  assert.ok(html.includes(`assets/radar-engine.js?v=${C.VERSION}"`), 'radar-engine script ?v= 불일치');
  const FE = require('../assets/futures-engine.js');
  assert.equal(FE.VERSION, C.VERSION, 'futures-engine.js VERSION 불일치');
  assert.ok(html.includes(`assets/futures-engine.js?v=${C.VERSION}"`), 'futures-engine script ?v= 불일치');
});

test('처음 화면 문구에 거래소 이름 없는 "● 연결 중" 이 없음 (이전 버전 문구)', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(!html.includes('>● 연결 중<'));
});

test('감시 종목 스트림 주소: ticker(기본 6) + miniTicker(나머지) + kline_1m(전체)', () => {
  const url = C.buildRadarStreamUrl('wss://stream.binance.com:9443', ['BTCUSDT', 'PEPEUSDT'], ['BTCUSDT']);
  assert.equal(url, 'wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/pepeusdt@miniTicker/btcusdt@kline_1m/pepeusdt@kline_1m');
});

test('종목별 miniTicker 메시지 처리', () => {
  const list = C.parseStreamMessage({ stream: 'pepeusdt@miniTicker', data: { e: '24hrMiniTicker', s: 'PEPEUSDT', c: '0.00001', o: '0.00002', q: '5', v: '6' } });
  assert.equal(list.length, 1);
  assert.equal(list[0].symbol, 'PEPEUSDT');
  assert.ok(Math.abs(list[0].changePct + 50) < 1e-9);
});

test('화면이 숨겨져 연결을 쉬는 상태 표시', () => {
  assert.deepEqual(C.binanceStatusView({ state: 'paused' }, 0), { text: 'Binance 일시정지 (화면 숨김)', level: 'warn' });
});
