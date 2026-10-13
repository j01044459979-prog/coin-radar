// OKX 공개 API 모의 응답 (테스트 전용)
export const now = 1800000000000 - (1800000000000 % 300000) + 120000;
export const open = now - (now % 300000);
export const ok = data => new Response(JSON.stringify({ code: '0', msg: '', data }), { status: 200 });
const TF = { '15m': 900000, '1H': 3600000, '4H': 14400000 };
// 상위 시간대 캔들: kind = up | down | flat | gap. 최신 먼저, 첫 봉은 미확정(confirm 0)
export function mtfCandles(bar, kind) {
  const step = TF[bar], cur = now - (now % step);
  const rows = [];
  for (let i = 0; i < 101; i++) {
    const idx = 100 - i; // 오래된 쪽 0
    const wave = Math.round(2 * Math.sin(2 * Math.PI * idx / 8) * 1e4) / 1e4;
    const drift = kind === 'up' ? idx * 0.4 : kind === 'down' ? -idx * 0.4 : 0;
    const c = 100 + drift + wave + (i === 0 ? 50 : 0); // 미확정 봉은 일부러 튀게(사용되면 결과가 바뀜)
    rows.push([String(cur - i * step), String(c - .1), String(c + .5), String(c - .5), String(c), '1', '1', '1', i === 0 ? '0' : '1']);
  }
  return kind === 'gap' ? rows.filter((_, i) => i !== 40) : rows;
}
export function fakeOkx({ breakout = true, funding = '0.0001', oiNow = 103, calls = [], mtf = {} } = {}) {
  return async url => {
    calls.push(url);
    const u = new URL(url); const id = u.searchParams.get('instId');
    switch (u.pathname.replace('/api/v5', '')) {
      case '/public/instruments': return ok(['BTC', 'ETH', 'SOL'].map(c => ({ instId: `${c}-USDT-SWAP`, state: 'live', ctType: 'linear', settleCcy: 'USDT' }))
        .concat([{ instId: 'BTC-USD-SWAP', state: 'live', ctType: 'inverse', settleCcy: 'BTC' }]));
      case '/market/tickers': return ok(['BTC', 'ETH', 'SOL'].map(c => ({ instId: `${c}-USDT-SWAP`, last: '100', volCcy24h: '1000' })));
      case '/market/candles': {
        const bar = u.searchParams.get('bar');
        if (bar !== '5m') { if (mtf[bar] === 'fail') return new Response('', { status: 500 }); return ok(mtfCandles(bar, mtf[bar] ?? 'up')); }
        const rows = [];
        for (let i = 0; i < 62; i++) { // 최신 먼저. i=0은 미확정 봉
          const t = open - i * 300000, idx = 61 - i;
          const c = breakout && i === 1 ? 102 : 100 + idx / 100 - (breakout ? 0 : 0);
          rows.push([String(t), String(c - .2), String(c + .3), String(c - .3), String(c), '1', '1', i === 1 && breakout ? '300' : '100', i === 0 ? '0' : '1']);
        }
        return ok(rows);
      }
      case '/public/mark-price': return ok([{ instId: id, instType: 'SWAP', markPx: '101.2', ts: String(now - 1000) }]);
      case '/public/open-interest': return ok([{ instId: id, oi: '1', oiCcy: String(oiNow), ts: String(now - 1000) }]);
      case '/public/funding-rate': return ok([{ instId: id, fundingRate: funding, ts: String(now) }]);
      case '/rubik/stat/contracts/open-interest-history':
        return ok(Array.from({ length: 13 }, (_, i) => [String(open - 300000 - i * 300000), '1', i === 2 ? '100' : '100.5', '10000']));
      default: return new Response('', { status: 404 });
    }
  };
}
