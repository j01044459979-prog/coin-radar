// 실제 OKX·Bybit 공개 시세 API 연결 점검(읽기 전용 GET 6~8회, 키·계정·주문 없음). 감시 기능이 쓰는 주소·해석·판정(lib/watch.mjs)을 그대로 사용한다.
//  사용: node rich300/perf/market-check.mjs [SYMBOL…]   (기본 ETHUSDT BTCUSDT)   종료 코드: 모든 종목이 두 출처 중 하나로 '감시 가능' 판정이면 0, 아니면 1.
//  출력에는 가격·응답 본문을 넣지 않는다(출처·HTTP 상태·응답 시간·개수·나이·판정 코드만).
import { watchMarketUrls, watchParseSource, watchAssessMarket } from '../lib/watch.mjs';

export async function checkSymbol(symbolId, { fetcher = fetch, now = () => Date.now() } = {}) {
  const res = { symbol: symbolId, sources: [] };
  for (const src of ['OKX', 'Bybit']) {
    const urls = watchMarketUrls(src, symbolId), t0 = Date.now(), jsons = {}, http = {};
    await Promise.all(Object.entries(urls).map(async ([k, u]) => {
      try { const r = await fetcher(u, { headers: { accept: 'application/json' } }); http[k] = r.status; try { jsons[k] = await r.json(); } catch (e_) { jsons[k] = null; } } catch (e_) { http[k] = 'network'; jsons[k] = null; }
    }));
    const ms = Date.now() - t0, at = now(), parsed = watchParseSource(src, jsons, at), tk = parsed.ticker;
    const m = tk ? { price: tk.price, priceAt: tk.priceAt, bars15m: parsed.bars['15m'] || [], bars1h: parsed.bars['1h'] || [], bars4h: parsed.bars['4h'] || [] } : null, a = m ? watchAssessMarket(m, at) : { ok: false, why: 'no-ticker' };
    res.sources.push({ src, ms, http, ticker: !!tk, n: m ? { '15m': m.bars15m.length, '1h': m.bars1h.length, '4h': m.bars4h.length } : null,
      priceAgeSec: m ? Math.round((at - m.priceAt) / 1000) : null, bar1hAgeMin: m && m.bars1h.length ? Math.round((at - m.bars1h[m.bars1h.length - 1].t) / 60000) : null, bar4hAgeMin: m && m.bars4h.length ? Math.round((at - m.bars4h[m.bars4h.length - 1].t) / 60000) : null, usable: a.ok, why: a.why });
  }
  res.ok = res.sources.some(s => s.usable); return res;
}
if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  const syms = process.argv.slice(2).length ? process.argv.slice(2) : ['ETHUSDT', 'BTCUSDT']; let bad = 0;
  for (const s of syms) {
    const r = await checkSymbol(s); if (!r.ok) bad++;
    console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${s}`);
    for (const x of r.sources) console.log(`  ${x.src.padEnd(5)} ${String(x.ms).padStart(5)}ms http ${Object.entries(x.http).map(([k, v]) => `${k}:${v}`).join(' ')} · ticker ${x.ticker ? 'ok' : 'bad'} · bars ${x.n ? `15m ${x.n['15m']} 1h ${x.n['1h']} 4h ${x.n['4h']}` : '-'} · age price ${x.priceAgeSec ?? '-'}s 1h ${x.bar1hAgeMin ?? '-'}m 4h ${x.bar4hAgeMin ?? '-'}m · ${x.usable ? 'usable' : 'NOT usable: ' + x.why}`);
  }
  console.log(bad ? `RESULT: ${bad}/${syms.length} symbols not usable` : `RESULT: all ${syms.length} symbols usable`); process.exit(bad ? 1 : 0);
}
