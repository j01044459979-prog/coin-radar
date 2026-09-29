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
    return { success: true, meta: { changes: r.changes } };
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

// Upbit + Kakao 가짜 fetch. specs: { 'KRW-SOL': { spike: {...} } }, fail: Set(market)
// kakao: { memoStatus(기본 200), expireFirstMemo(첫 전송 401), refreshError('invalid_grant' 등), rotate(새 refresh_token 발급) }
export function makeFetch({ now, specs = {}, markets = ['KRW-BTC', 'KRW-ETH', 'KRW-SOL', 'KRW-XRP', 'KRW-USDT'], fail = new Set(), kakao = {} } = {}) {
  const calls = { upbit: 0, kakao: [], memo: [], token: [] };
  let seq = kakao.seqStart || 0; // 발급 토큰 번호 (test-access-N)
  let memoCount = 0;
  const fn = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname === 'kauth.kakao.com' && url.pathname === '/oauth/token') {
      const body = new URLSearchParams(init.body);
      const req = Object.fromEntries(body);
      calls.token.push(req);
      if (kakao.refreshError && req.grant_type === 'refresh_token') return Response.json({ error: kakao.refreshError, error_description: 'x' }, { status: 400 });
      if (kakao.codeError && req.grant_type === 'authorization_code') return Response.json({ error: kakao.codeError, error_code: 'KOE320' }, { status: 400 });
      seq += 1;
      const tok = { token_type: 'bearer', access_token: `test-access-${seq}`, expires_in: 21599 };
      if (req.grant_type === 'authorization_code' || kakao.rotate) Object.assign(tok, { refresh_token: `test-refresh-${seq}`, refresh_token_expires_in: 5183999, scope: 'talk_message' });
      return Response.json(tok);
    }
    if (url.hostname === 'kapi.kakao.com') {
      memoCount += 1;
      const auth = (init.headers && (init.headers.authorization || init.headers.Authorization)) || '';
      const template = JSON.parse(new URLSearchParams(init.body).get('template_object'));
      calls.memo.push({ auth, template });
      if (kakao.expireFirstMemo && memoCount === 1) return Response.json({ msg: 'this access token does not exist', code: -401 }, { status: 401 });
      const status = kakao.memoStatus || 200;
      return status === 200 ? Response.json({ result_code: 0 }) : Response.json({ msg: 'error', code: -402 }, { status });
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
