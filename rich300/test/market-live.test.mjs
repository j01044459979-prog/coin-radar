// 실제 거래소 공개 API 연결 시험 — 기본은 건너뜀(자동 테스트는 네트워크를 쓰지 않는다). 켜기: RICH300_LIVE_MARKET=1 node --test rich300/test/market-live.test.mjs
// 같은 점검을 GitHub Actions 에서 실행하는 워크플로: .github/workflows/rich300-market-check.yml
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSymbol } from '../perf/market-check.mjs';

const live = process.env.RICH300_LIVE_MARKET === '1';
test('실제 OKX·Bybit: 감시가 쓰는 주소·해석·판정으로 ETHUSDT 가 감시 가능으로 나온다', { skip: !live && '실제 네트워크 시험(RICH300_LIVE_MARKET=1 일 때만)' }, async () => {
  const r = await checkSymbol('ETHUSDT'); assert.equal(r.ok, true, JSON.stringify(r.sources.map(s => ({ src: s.src, http: s.http, why: s.why }))));
});
test('연결 점검 로직(가짜 응답): 정상/차단/구조 변경을 구분하고 가격·본문을 결과에 싣지 않는다', async () => {
  const NOW = 1790000000000, H = 3600000, bars = (n, step, start) => Array.from({ length: n }, (_, i) => [String(NOW - (i + 1) * step), '2001', '2003', '1999', '2001', '10', '0', '0', '1']);
  const okx = url => { const u = new URL(url); if (/ticker/.test(u.pathname)) return { code: '0', data: [{ last: '2001.5', ts: String(NOW - 5000) }] }; const bar = u.searchParams.get('bar'), step = bar === '15m' ? 900000 : bar === '1H' ? H : 4 * H; return { code: '0', data: bars(Number(u.searchParams.get('limit')), step) }; };
  const good = async url => ({ status: 200, json: async () => (/okx/.test(url) ? okx(url) : { retCode: 10001 }) });
  const real = Date.now; Date.now = () => NOW; try {
    const r = await checkSymbol('ETHUSDT', { fetcher: good, now: () => NOW }); assert.equal(r.ok, true); assert.equal(r.sources[0].usable, true); assert.equal(r.sources[1].usable, false); assert.ok(!JSON.stringify(r).includes('2001.5'));
    const blocked = await checkSymbol('ETHUSDT', { fetcher: async () => ({ status: 403, json: async () => { throw new Error('html'); } }), now: () => NOW }); assert.equal(blocked.ok, false); assert.equal(blocked.sources[0].http.ticker, 403);
    const net = await checkSymbol('ETHUSDT', { fetcher: async () => { throw new Error('ENOTFOUND'); }, now: () => NOW }); assert.equal(net.ok, false); assert.equal(net.sources[0].http.ticker, 'network');
    const changed = await checkSymbol('ETHUSDT', { fetcher: async () => ({ status: 200, json: async () => ({ code: '0', data: [{ price: '1' }] }) }), now: () => NOW }); assert.equal(changed.ok, false);          // 응답 구조가 바뀌면 실패
  } finally { Date.now = real; }
});
