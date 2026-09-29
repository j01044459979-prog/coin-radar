// 테스트 전용 도우미: D1 호환 SQLite, Upbit/Telegram 가짜 fetch.
// 여기의 캔들 값은 계산 검증용 테스트 입력이며 서비스 코드에는 들어가지 않습니다.
import { DatabaseSync } from 'node:sqlite';

export const MIN = 60000;

// ── D1 API 일부(prepare/bind/all/first/run/batch)를 node:sqlite 로 흉내 ──
class Stmt {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Stmt(this.db, this.sql, args.map((a) => (a === undefined ? null : a)));
  }
  _exec() {
    const s = this.db.prepare(this.sql);
    if (/^\s*(SELECT|WITH)/i.test(this.sql)) return { results: s.all(...this.args) };
    const r = s.run(...this.args);
    return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.args) };
  }
  async first() {
    return this.db.prepare(this.sql).get(...this.args) || null;
  }
  async run() {
    return this._exec();
  }
}

export class FakeD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
  }
  prepare(sql) {
    return new Stmt(this.db, sql);
  }
  async batch(stmts) {
    return stmts.map((s) => s._exec());
  }
  rows(sql) {
    return this.db.prepare(sql).all().map((r) => ({ ...r }));
  }
}

// ── Upbit 캔들 (API 형식, 최근 → 오래된 순, 진행 중인 캔들 포함) ──
const iso = (t) => new Date(t).toISOString().slice(0, 19);
function upbitCandle(market, unit, t, o, c, q) {
  return {
    market,
    candle_date_time_utc: iso(t),
    candle_date_time_kst: iso(t + 9 * 3600000),
    opening_price: o,
    high_price: Math.max(o, c),
    low_price: Math.min(o, c),
    trade_price: c,
    timestamp: t + 30000,
    candle_acc_trade_price: q,
    candle_acc_trade_volume: q / Math.max(c, 1),
    unit,
  };
}

// spec: { spike: { minutes, q, pricePct } } 최근 몇 분 동안 거래대금/가격 변화
export function makeUpbitMinute(market, count, now, spec = {}) {
  const m0 = Math.floor(now / MIN) * MIN;
  const out = [upbitCandle(market, 1, m0, 1000, 1000, 1e6)]; // 진행 중
  const s = spec.spike;
  for (let k = 0; out.length < count; k += 1) {
    const t = m0 - (k + 1) * MIN; // k=0 : 마지막 완료 분
    if (spec.skip && spec.skip.includes(k)) continue; // 체결 없는 분 (캔들 없음)
    let o = 1000, c = 1000, q = spec.baseQ ?? 1e8;
    if (s && k < s.minutes) {
      const j = s.minutes - 1 - k;
      const step = (1000 * s.pricePct) / 100 / s.minutes;
      o = 1000 + step * j;
      c = 1000 + step * (j + 1);
      q = s.q;
    }
    out.push(upbitCandle(market, 1, t, o, c, q));
  }
  return out;
}

export function makeUpbitFifteen(market, count, now, q = 15e8) {
  const B = 15 * MIN;
  const b0 = Math.floor(now / B) * B;
  const out = [];
  for (let k = 0; k < count; k += 1) out.push(upbitCandle(market, 15, b0 - k * B, 1000, 1000, k === 0 ? q / 3 : q));
  return out;
}

// Upbit 가짜 fetch. specs: { 'KRW-SOL': { spike: {...} } }, fail: Set(market)
// Upbit 이외의 주소로 요청하면 테스트가 실패하도록 기록합니다 (외부 메신저 호출이 없어야 함).
export function makeFetch({ now, specs = {}, markets = ['KRW-BTC', 'KRW-ETH', 'KRW-SOL', 'KRW-XRP', 'KRW-USDT'], fail = new Set() } = {}) {
  const calls = { upbit: 0, other: [] };
  const fn = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname !== 'api.upbit.com') {
      calls.other.push(url.hostname);
      return new Response('unexpected host', { status: 599 });
    }
    calls.upbit += 1;
    const p = url.pathname;
    if (p === '/v1/market/all') return Response.json([...markets.map((market) => ({ market })), { market: 'BTC-ETH' }]);
    if (p === '/v1/ticker') {
      const list = url.searchParams.get('markets').split(',');
      return Response.json(list.map((market, i) => ({ market, trade_price: 1000, acc_trade_price_24h: (list.length - i) * 1e11 + (market === 'KRW-USDT' ? 1e13 : 0) })));
    }
    const market = url.searchParams.get('market');
    if (fail.has(market)) return new Response('Too Many Requests', { status: 429 });
    const count = Number(url.searchParams.get('count'));
    if (p === '/v1/candles/minutes/1') return Response.json(makeUpbitMinute(market, count, now, specs[market] || {}));
    if (p === '/v1/candles/minutes/15') return Response.json(makeUpbitFifteen(market, count, now));
    return new Response('not found', { status: 404 });
  };
  return { fetch: fn, calls };
}
