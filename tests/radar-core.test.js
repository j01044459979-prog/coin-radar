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
