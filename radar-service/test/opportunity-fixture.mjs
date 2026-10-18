// 기회 포착 레이더 테스트 공용 픽스처(합성 시계열·OKX 모의 서버·보조 함수). 실제 네트워크·Telegram은 어디에도 쓰지 않는다.
import { aggregate, H1, H4 } from '../opportunity/indicators.mjs';
import { analyzeCoin } from '../opportunity/analysis.mjs';
import { normalize } from '../opportunity/step.mjs';

const T0 = Date.UTC(2024, 0, 1);
const lcg = seed => { let x = seed >>> 0; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296; };
function wave(n, seed, { amp = 0.06, per = 240, drift = 0.0004 } = {}) {
  const r = lcg(seed); let p = 100; const rows = [];
  for (let i = 0; i < n; i++) {
    const tgt = 100 * Math.exp(drift * i + amp * Math.sin(2 * Math.PI * i / per)), o = p, c = tgt * (1 + (r() - 0.5) * 0.004);
    rows.push({ t: T0 + i * H1, o, h: Math.max(o, c) * (1 + r() * 0.002), l: Math.min(o, c) * (1 - r() * 0.002), c, q: 1e6 * (0.6 + r() * 1.5) }); p = c;
  }
  return rows;
}
const mirror = (c, K = 1000) => c.map(x => ({ t: x.t, o: K - x.o, h: K - x.l, l: K - x.h, c: K - x.c, q: x.q }));
const at = (c, i) => { const s = c.slice(0, i + 1); return analyzeCoin(s, aggregate(s), aggregate(s)); };
const N = 2600;
const ETH = wave(N, 5), SOL = mirror(ETH), BTC = wave(N, 9, { amp: 0.04, per: 300 });
// stage별 대표 인덱스(합성 데이터에서 탐색)
function find(c, pred, from = 1100) { const out = []; for (let i = from; i < c.length; i++) { const a = at(c, i); if (a.status === 'ok' && pred(a)) out.push(i); } return out; }
const ethStage = {}; for (const st of [1, 2, 3]) ethStage[st] = find(ETH, a => a.stage === st);

const row = (t, o, h, l, c, confirm = '1', q = 1000) => [String(t), String(o), String(h), String(l), String(c), '1', String(q / ((h + l) / 2)), String(q), confirm];

const SERIES = { 'BTC-USDT-SWAP': BTC, 'ETH-USDT-SWAP': ETH, 'SOL-USDT-SWAP': SOL };
const rowCache = new Map();    // 같은 (종목, 봉, 길이) 응답은 재사용해 테스트를 빠르게 한다(내용은 항상 같다)
function okxFake({ cursor, calls = [], fail = {}, limit4 = 300, series = SERIES } = {}) {
  const ok = d => new Response(JSON.stringify({ code: '0', msg: '', data: d }), { status: 200 });
  return async url => {
    calls.push(url); const u = new URL(url), path = u.pathname.replace('/api/v5', ''), id = u.searchParams.get('instId');
    for (const [k, v] of Object.entries(fail)) if (url.includes(k)) return typeof v === 'function' ? v(url) : v;
    if (path === '/public/instruments') return ok(Object.keys(series).map(instId => ({ instId, state: 'live', ctType: 'linear', settleCcy: 'USDT', instCategory: '1' })));
    if (path === '/market/tickers') return ok(Object.keys(series).map(instId => ({ instId, last: '100', open24h: '99', volCcy24h: '100000' })));
    if (path !== '/market/candles') return new Response('', { status: 404 });
    const c = series[id], i = cursor(id); if (!c) return new Response('', { status: 404 });
    const s = c.slice(0, i + 1), bar = u.searchParams.get('bar'), key = `${id}|${bar}|${s.length}|${s.at(-1).t}|${s.at(-1).c}|${s[0].c}`;
    let rows = rowCache.get(key);
    if (!rows) {
      if (bar === '1H') { rows = s.map(x => row(x.t, x.o, x.h, x.l, x.c, '1', x.q)).reverse(); rows.unshift(row(s.at(-1).t + H1, 1, 9999, 0.5, 5000, '0')); }   // 진행 중 봉(튀는 값)
      else { const c4 = aggregate(s); rows = c4.map(x => row(x.t, x.o, x.h, x.l, x.c, '1', x.q)).reverse(); rows.unshift(row(c4.at(-1).t + H4, 1, 9999, 0.5, 5000, '0')); }
      rowCache.set(key, rows);
    }
    return ok(rows.slice(0, Math.min(bar === '1H' ? Infinity : limit4, Number(u.searchParams.get('limit')))));
  };
}
const IDX = ethStage[3][0], NOW = i => ETH[i].t + H1 + 30000;      // 신호 봉 i가 막 마감된 시각(+30초)
const mkSend = (sent, failAt = []) => async (text, opt) => { if (failAt.includes(sent.length + 1)) { sent.push('FAIL'); sent.pop(); throw Object.assign(new Error('전송 실패'), { status: 500 }); } sent.push({ text, opt }); };
const env = (v, extra = {}) => ({ RADAR_OPPORTUNITY: v, RADAR_OPPORTUNITY_FIRST_RUN: 'alert', ...extra });

const rebase = (series, i, target) => series.slice(0, i + 1).map(x => ({ ...x, t: x.t + (target - i) * H1 }));   // 같은 모양의 시리즈를 목표 인덱스 시각에 끝나도록 평행 이동(4시간 정렬 유지)
const aligned = st => ethStage[st].find(i => (IDX - i) % 4 === 0);
const mixed = ({ r = 0, w = 0, a = 0 }) => {
  const out = { 'BTC-USDT-SWAP': BTC.slice(0, IDX + 1) };
  const add = (prefix, n, i) => { for (let k = 0; k < n; k++) out[`${prefix}${String(k).padStart(2, '0')}-USDT-SWAP`] = rebase(ETH, i, IDX); };
  add('R', r, IDX); add('W', w, aligned(2)); add('A', a, aligned(1));
  return out;
};
const fx = (series, extra = {}) => okxFake({ cursor: id => series[id].length - 1, series, ...extra });
const names = sent => sent.flatMap(m => [...m.text.matchAll(/<b>([A-Z0-9]+)<\/b> · <b>(?:LONG|SHORT) 관찰/g)].map(x => x[1]));
const dayOf = t => new Date(t).toISOString().slice(0, 10);
const thisHour = Math.floor(NOW(IDX) / H1);
const preState = o => ({ opportunity: { ...normalize({ v: 1, coins: {} }), baselineDone: true, ...o } });

export { T0, lcg, wave, mirror, at, N, ETH, SOL, BTC, find, ethStage, row, SERIES, okxFake, IDX, NOW, mkSend, env, rebase, aligned, mixed, fx, names, dayOf, thisHour, preState };
