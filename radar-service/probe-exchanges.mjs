// 공개 시세 엔드포인트 접근·응답 검증 (키 불필요, 주문 없음). 우회 없이 직접 호출만 한다.
const SYMS = ['BTC', 'ETH', 'SOL'];
const out = [];
async function call(ex, name, url, check) {
  const t0 = Date.now();
  const row = { ex, name, status: null, ms: null, valid: false, note: '' };
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'error' });
    row.status = r.status; row.ms = Date.now() - t0;
    row.limit = r.headers.get('x-bapi-limit-status') || r.headers.get('x-ratelimit-remaining') || '';
    const body = await r.json().catch(() => null);
    if (r.ok && body) { const c = check(body); row.valid = !!c.ok; row.note = c.note; }
    else row.note = `body=${JSON.stringify(body)?.slice(0, 120)}`;
  } catch (e) { row.note = `error:${e.message}`; }
  out.push(row); return row;
}
const n = Number;
for (const s of SYMS) {
  const by = `${s}USDT`, ok = `${s}-USDT-SWAP`;
  const B = 'https://api.bybit.com/v5/market';
  await call('bybit', `${by} tickers`, `${B}/tickers?category=linear&symbol=${by}`, b => {
    const x = b.result?.list?.[0];
    return { ok: b.retCode === 0 && n(x?.lastPrice) > 0 && n(x?.markPrice) > 0 && n(x?.turnover24h) > 0 && x?.fundingRate !== '' && n(x?.openInterestValue) > 0,
      note: `last=${x?.lastPrice} mark=${x?.markPrice} turn24h=${x?.turnover24h} fund=${x?.fundingRate} oiValue=${x?.openInterestValue}` };
  });
  await call('bybit', `${by} kline5m`, `${B}/kline?category=linear&symbol=${by}&interval=5&limit=3`, b => {
    const l = b.result?.list;
    return { ok: b.retCode === 0 && l?.length === 3 && n(l[0][4]) > 0, note: `newestStart=${l?.[0]?.[0]} (${new Date(n(l?.[0]?.[0])).toISOString()}) close=${l?.[0]?.[4]} turnover=${l?.[0]?.[6]} now=${new Date().toISOString()}` };
  });
  await call('bybit', `${by} oiHist5m`, `${B}/open-interest?category=linear&symbol=${by}&intervalTime=5min&limit=13`, b => {
    const l = b.result?.list;
    return { ok: b.retCode === 0 && l?.length === 13 && n(l[0].openInterest) > 0, note: `n=${l?.length} newest=${l?.[0]?.openInterest}@${l?.[0] && new Date(n(l[0].timestamp)).toISOString()} oldest=${l?.[12]?.openInterest}` };
  });
  const O = 'https://www.okx.com/api/v5';
  await call('okx', `${ok} ticker`, `${O}/market/ticker?instId=${ok}`, b => {
    const x = b.data?.[0];
    return { ok: b.code === '0' && n(x?.last) > 0 && n(x?.volCcy24h) > 0, note: `last=${x?.last} volCcy24h=${x?.volCcy24h} ts=${x?.ts}` };
  });
  await call('okx', `${ok} mark`, `${O}/public/mark-price?instType=SWAP&instId=${ok}`, b => ({ ok: b.code === '0' && n(b.data?.[0]?.markPx) > 0, note: `mark=${b.data?.[0]?.markPx}` }));
  await call('okx', `${ok} candles5m`, `${O}/market/candles?instId=${ok}&bar=5m&limit=3`, b => {
    const l = b.data;
    return { ok: b.code === '0' && l?.length === 3 && n(l[0][4]) > 0, note: `newest=${l?.[0]?.[0]} confirm=${l?.[0]?.[8]} close=${l?.[0]?.[4]}` };
  });
  await call('okx', `${ok} oi`, `${O}/public/open-interest?instType=SWAP&instId=${ok}`, b => ({ ok: b.code === '0' && n(b.data?.[0]?.oi) > 0, note: `oi=${b.data?.[0]?.oi} oiCcy=${b.data?.[0]?.oiCcy}` }));
  await call('okx', `${ok} oiHist5m`, `${O}/rubik/stat/contracts/open-interest-history?instId=${ok}&period=5m&limit=13`, b => ({ ok: b.code === '0' && b.data?.length >= 4, note: `n=${b.data?.length} first=${JSON.stringify(b.data?.[0])}` }));
  await call('okx', `${ok} funding`, `${O}/public/funding-rate?instId=${ok}`, b => ({ ok: b.code === '0' && b.data?.[0]?.fundingRate !== undefined && b.data[0].fundingRate !== '', note: `fund=${b.data?.[0]?.fundingRate}` }));
}
for (const r of out) console.log(`${r.valid ? 'OK  ' : 'FAIL'} ${r.ex} ${r.name} http=${r.status} ${r.ms}ms ${r.limit} ${r.note}`);
const by = ex => out.filter(r => r.ex === ex);
for (const ex of ['bybit', 'okx']) console.log(`SUMMARY ${ex}: ${by(ex).filter(r => r.valid).length}/${by(ex).length} valid`);
