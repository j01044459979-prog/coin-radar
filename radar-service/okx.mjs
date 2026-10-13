// OKX 공식 공개 API(USDT 무기한 스왑) 수집기. 키·주문 없음. 응답을 기존 분석 입력 형태로 변환한다.
import { analyze, applyBtcFilter } from './analysis.mjs';
import { jsonRequest } from './service.mjs';

export const SOURCE = { name: 'OKX', label: 'OKX USDT 무기한(SWAP)', url: 'https://www.okx.com/api/v5' };
const base = SOURCE.url;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function okData(body, what) {
  if (!body || body.code !== '0' || !Array.isArray(body.data)) throw new Error(`${what} 응답 오류(code ${body?.code})`);
  return body.data;
}
// 'BTC-USDT-SWAP' -> 'BTCUSDT'
export const internalSymbol = instId => instId.replace(/-USDT-SWAP$/, 'USDT');

export function createOkxCollector(fetcher = fetch, { gapMs = 260, max = 12 } = {}) {
  const get = async path => { const body = await jsonRequest(base + path, {}, fetcher); if (gapMs) await pause(gapMs); return body; };
  return async function collect(now) {
    const started = Date.now();
    const instruments = okData(await get('/public/instruments?instType=SWAP'), '계약 목록');
    const tickers = okData(await get('/market/tickers?instType=SWAP'), '티커');
    const live = new Set(instruments.filter(x => x.state === 'live' && x.ctType === 'linear' && x.settleCcy === 'USDT' && /^[A-Z0-9]+-USDT-SWAP$/.test(x.instId)).map(x => x.instId));
    const turnover = x => Number(x.volCcy24h) * Number(x.last); // USDT 근사 거래대금(기초자산 수량 × 최근가)
    const ranked = tickers.filter(x => live.has(x.instId) && turnover(x) > 0).sort((a, b) => turnover(b) - turnover(a));
    const turn24 = Object.fromEntries(ranked.map(x => [x.instId, turnover(x)]));
    const ids = [...new Set(['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP', ...ranked.map(x => x.instId)])].filter(i => live.has(i)).slice(0, max);
    const rows = [], failures = [];
    for (const instId of ids) {
      if (Date.now() - started > 150000) throw new Error('전체 수집 시간 초과');
      const symbol = internalSymbol(instId);
      try {
        const candles = okData(await get(`/market/candles?instId=${instId}&bar=5m&limit=70`), '캔들');
        const mark = okData(await get(`/public/mark-price?instType=SWAP&instId=${instId}`), '마크가격')[0];
        const oi = okData(await get(`/public/open-interest?instType=SWAP&instId=${instId}`), 'OI')[0];
        const funding = okData(await get(`/public/funding-rate?instId=${instId}`), '펀딩')[0];
        const history = okData(await get(`/rubik/stat/contracts/open-interest-history?instId=${instId}&period=5m&limit=13`), 'OI 이력');
        if (!mark || !oi || !funding || mark.instId !== instId || oi.instId !== instId || funding.instId !== instId) throw new Error('응답 종목 불일치');
        // 확정(confirm=1) 5분봉만 사용, 오래된 순 정렬. 인덱스: ts,o,h,l,c,vol,volCcy,volCcyQuote(USDT),confirm
        const klines = candles.filter(r => r[8] === '1').reverse().map(r => [r[0], r[1], r[2], r[3], r[4], r[5], Number(r[0]) + 299999, r[7]]);
        const raw = {
          klines,
          premium: { symbol, markPrice: mark.markPx, lastFundingRate: funding.fundingRate, time: mark.ts },
          oi: { symbol, openInterest: oi.oiCcy, time: oi.ts }, // 기초자산 수량 기준(가격 변동 영향 제외)
          history: history.map(h => ({ timestamp: h[0], sumOpenInterest: h[2], sumOpenInterestValue: h[3] })),
        };
        rows.push({ ...analyze(symbol, raw, now), turnover24h: turn24[instId] ?? null, source: SOURCE.label, sourceUrl: `${base}/public/mark-price?instType=SWAP&instId=${instId}`, instId });
      } catch (error) {
        if ([403, 418, 429, 451].includes(error.status)) throw error;
        failures.push({ symbol, reason: error.message });
      }
    }
    if (Date.now() - started > 150000) throw new Error('전체 수집 시간 초과');
    if (!rows.length) throw new Error('모든 종목 수집 실패');
    return { rows: applyBtcFilter(rows), failures };
  };
}
