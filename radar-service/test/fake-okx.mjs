// OKX 공개 API 모의 응답 (테스트 전용)
export const now = 1800000000000 - (1800000000000 % 300000) + 120000;
export const open = now - (now % 300000);
export const ok = data => new Response(JSON.stringify({ code: '0', msg: '', data }), { status: 200 });
const TF = { '15m': 900000, '1H': 3600000, '4H': 14400000 };
// 상위 시간대 캔들: kind = up | down | flat | gap. 최신 먼저, 첫 봉은 미확정(confirm 0)
export function mtfCandles(bar, kind, len = 101) {
  const step = TF[bar], cur = now - (now % step);
  const rows = [];
  for (let i = 0; i < len; i++) {
    const idx = len - 1 - i; // 오래된 쪽 0
    const wave = Math.round(2 * Math.sin(2 * Math.PI * idx / 8) * 1e4) / 1e4;
    const drift = kind === 'up' ? idx * 0.4 : kind === 'down' ? -idx * 0.4 : 0;
    const c = 100 + drift + wave + (i === 0 ? 50 : 0); // 미확정 봉은 일부러 튀게(사용되면 결과가 바뀜)
    rows.push([String(cur - i * step), String(c - .1), String(c + .5), String(c - .5), String(c), '1', '5', String(c * 5), i === 0 ? '0' : '1']);
  }
  if (kind === 'stale') return rows.slice(4); // 최근 3개 마감봉이 빠진 오래된 데이터(미확정 봉 포함 4개 제거)
  return kind === 'gap' ? rows.filter((_, i) => i !== 40) : rows;
}
// 종목 구성: 기본은 BTC/ETH/SOL. universe:'full'이면 관심 코인·주식형·분류 없음 상품을 추가한다.
export const CRYPTOS = ['BTC', 'ETH', 'SOL'], FULL_CRYPTOS = ['BTC', 'ETH', 'SOL', 'ZEC', 'RENDER', 'DOGE'], NON_CRYPTO = { SOXL: '2', SNDK: '2', SKHYNIX: '2', GOLD: '3' };
export function instrumentList(universe) {
  const crypto = (universe === 'full' ? FULL_CRYPTOS : CRYPTOS).map(c => ({ instId: `${c}-USDT-SWAP`, state: 'live', ctType: 'linear', settleCcy: 'USDT', instCategory: '1' }));
  const extra = universe === 'full' ? [...Object.entries(NON_CRYPTO).map(([c, k]) => ({ instId: `${c}-USDT-SWAP`, state: 'live', ctType: 'linear', settleCcy: 'USDT', instCategory: k })),
    { instId: 'MYSTERY-USDT-SWAP', state: 'live', ctType: 'linear', settleCcy: 'USDT' }, // 분류 없음
    { instId: 'OLDCOIN-USDT-SWAP', state: 'suspend', ctType: 'linear', settleCcy: 'USDT', instCategory: '1' }] : [];
  return [...crypto, ...extra, { instId: 'BTC-USD-SWAP', state: 'live', ctType: 'inverse', settleCcy: 'BTC', instCategory: '1' }];
}
export function fakeOkx({ breakout = true, funding = '0.0001', oiNow = 103, calls = [], mtf = {}, universe, instruments, tickers, hook } = {}) {
  const t0 = Date.now(); const drift = () => Date.now() - t0; // 실제 경과만큼 거래소 시각도 흐른다(느린 수집 재현용)
  return async url => {
    calls.push(url);
    const hooked = hook && hook(url, calls.length); if (hooked) return hooked;
    const u = new URL(url); const id = u.searchParams.get('instId');
    switch (u.pathname.replace('/api/v5', '')) {
      case '/public/instruments': return ok(instruments ?? instrumentList(universe));
      case '/market/tickers': return tickers ? ok(tickers) : ok(instrumentList(universe).filter(x => x.ctType === 'linear').map(x => ({ instId: x.instId, last: '100', open24h: '98', volCcy24h: x.instCategory === '1' ? '100000' : '900000' })));
      case '/market/candles': {
        const bar = u.searchParams.get('bar');
        if (bar !== '5m') { if (mtf[bar] === 'fail') return new Response('', { status: 500 }); return ok(mtfCandles(bar, mtf[bar] ?? 'up', Number(u.searchParams.get('limit')) > 100 ? 301 : 101)); }
        const rows = [];
        for (let i = 0; i < 62; i++) { // 최신 먼저. i=0은 미확정 봉
          const t = open - i * 300000, idx = 61 - i;
          const c = breakout && i === 1 ? 102 : 100 + idx / 100 - (breakout ? 0 : 0);
          const q = i === 1 && breakout ? 300 : 100;
          rows.push([String(t), String(c - .2), String(c + .3), String(c - .3), String(c), '1', String(q / c), String(q), i === 0 ? '0' : '1']); // vol(계약), volCcy(기초자산 수량=q/c), volCcyQuote(USDT)
        }
        return ok(rows);
      }
      case '/public/mark-price': return ok([{ instId: id, instType: 'SWAP', markPx: '101.2', ts: String(now - 1000 + drift()) }]);
      case '/public/open-interest': return ok([{ instId: id, oi: '1', oiCcy: String(oiNow), ts: String(now - 1000 + drift()) }]);
      case '/public/funding-rate': return ok([{ instId: id, fundingRate: funding, ts: String(now) }]);
      case '/rubik/stat/contracts/open-interest-history':
        return ok(Array.from({ length: 13 }, (_, i) => [String(open - 300000 - i * 300000), '1', i === 2 ? '100' : '100.5', '10000']));
      default: return new Response('', { status: 404 });
    }
  };
}
