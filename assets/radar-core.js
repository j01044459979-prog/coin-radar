// COIN RADAR 화면용 순수 함수 모음 (DOM/네트워크 없음 → Node 테스트 가능)
// 모든 숫자는 Binance/Upbit 공식 API 응답에서 그대로 가져오며, 임의로 만들어내지 않습니다.
(function (root) {
  'use strict';

  // Binance 공식 공개 주소 (API Key 불필요, 시세 조회 전용)
  const BINANCE_WS_HOSTS = ['wss://stream.binance.com:9443', 'wss://data-stream.binance.vision'];
  const BINANCE_REST_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
  const WATCH = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'BNBUSDT'];

  // 값이 없으면 null 을 돌려줍니다 (Number(null) === 0 처럼 없는 값이 0으로 보이는 것을 방지)
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  function buildStreamUrl(host, watch = WATCH) {
    const streams = ['!miniTicker@arr', ...watch.map((s) => s.toLowerCase() + '@ticker')];
    return `${host}/stream?streams=${streams.join('/')}`;
  }

  function isTrackedSymbol(symbol) {
    return typeof symbol === 'string' && symbol.endsWith('USDT') && !symbol.includes('_');
  }

  // REST /api/v3/ticker/24hr 항목
  function fromRest24h(x) {
    return {
      symbol: x.symbol,
      last: num(x.lastPrice),
      changePct: num(x.priceChangePercent),
      quoteVol: num(x.quoteVolume),
      baseVol: num(x.volume),
    };
  }

  // WebSocket <symbol>@ticker 이벤트 (24H 등락률 P 를 Binance가 직접 제공)
  function fromTicker(d) {
    return {
      symbol: d.s,
      last: num(d.c),
      changePct: num(d.P),
      quoteVol: num(d.q),
      baseVol: num(d.v),
    };
  }

  // WebSocket !miniTicker@arr 항목. 등락률은 Binance가 준 24H 시가(o)와 현재가(c)로 계산
  function fromMiniTicker(d) {
    const last = num(d.c);
    const open = num(d.o);
    return {
      symbol: d.s,
      last,
      changePct: last !== null && open ? ((last - open) / open) * 100 : null,
      quoteVol: num(d.q),
      baseVol: num(d.v),
    };
  }

  // 결합 스트림 메시지({stream, data})를 [{...ticker}] 목록으로 변환
  function parseStreamMessage(raw) {
    let msg;
    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return [];
    }
    if (!msg || !msg.stream || !msg.data) return [];
    if (msg.stream === '!miniTicker@arr' && Array.isArray(msg.data)) {
      return msg.data.filter((d) => isTrackedSymbol(d.s)).map(fromMiniTicker);
    }
    if (msg.stream.endsWith('@ticker') && msg.data.e === '24hrTicker') {
      return [fromTicker(msg.data)];
    }
    return [];
  }

  function topByQuoteVolume(rows, n) {
    return rows
      .filter((r) => r.quoteVol !== null)
      .sort((a, b) => b.quoteVol - a.quoteVol)
      .slice(0, n);
  }

  // 24H 등락률 상위/하위 (거래대금이 너무 작은 종목은 제외)
  function topMovers(rows, n, minQuoteVol) {
    const ok = rows.filter((r) => r.changePct !== null && r.quoteVol !== null && r.quoteVol >= minQuoteVol);
    const up = [...ok].sort((a, b) => b.changePct - a.changePct).slice(0, n);
    const down = [...ok].sort((a, b) => a.changePct - b.changePct).slice(0, n);
    return { up, down };
  }

  // 재연결 대기 시간: 1초, 2초, 4초 ... 최대 30초 (+ 최대 1초 무작위)
  function reconnectDelay(attempt, rand = Math.random) {
    return Math.min(30000, 1000 * 2 ** Math.max(0, attempt)) + Math.floor(rand() * 1000);
  }

  function fmtCompact(v) {
    const n = num(v);
    if (n === null) return '—';
    if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function fmtPrice(v) {
    const n = num(v);
    if (n === null) return '—';
    if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
    return n.toPrecision(5);
  }

  function fmtPct(v) {
    const n = num(v);
    if (n === null) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  const api = {
    BINANCE_WS_HOSTS,
    BINANCE_REST_HOSTS,
    WATCH,
    buildStreamUrl,
    isTrackedSymbol,
    fromRest24h,
    fromTicker,
    fromMiniTicker,
    parseStreamMessage,
    topByQuoteVolume,
    topMovers,
    reconnectDelay,
    fmtCompact,
    fmtPrice,
    fmtPct,
    esc,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RadarCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
