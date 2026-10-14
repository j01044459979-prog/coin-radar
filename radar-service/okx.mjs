// OKX 공식 공개 API(USDT 무기한 스왑) 수집기. 키·주문 없음. 응답을 기존 분석 입력 형태로 변환한다.
import { analyze, applyBtcFilter } from './analysis.mjs';
import { enrich, preliminary } from './enrich.mjs';
import { TF_MS, trendOf } from './indicators.mjs';
import { jsonRequest } from './service.mjs';
import { parseCandleVolume } from './volume.mjs';
import { selectUniverse, MAX_SYMBOLS } from './universe.mjs';

export const SOURCE = { name: 'OKX', label: 'OKX USDT 무기한(SWAP)', url: 'https://www.okx.com/api/v5' };
const base = SOURCE.url;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function okData(body, what) {
  if (!body || body.code !== '0' || !Array.isArray(body.data)) throw new Error(`${what} 응답 오류(code ${body?.code})`);
  return body.data;
}
// 'BTC-USDT-SWAP' -> 'BTCUSDT'
export const internalSymbol = instId => instId.replace(/-USDT-SWAP$/, 'USDT');

export function createOkxCollector(fetcher = fetch, { gapMs = 260, max = MAX_SYMBOLS, priority } = {}) {
  const stats = { calls: 0 };
  const get = async path => { stats.calls++; const body = await jsonRequest(base + path, {}, fetcher); if (gapMs) await pause(gapMs); return body; };
  // 상위 시간대: OKX 확정(confirm=1) 캔들만 사용. 실패는 해당 시간대만 '미확인' 처리하고 5분 레이더는 계속 동작한다.
  async function loadMtf(instId, now, keep) {
    const out = {};
    for (const tf of ['15m', '1H', '4H']) {
      try {
        const rows = okData(await get(`/market/candles?instId=${instId}&bar=${tf}&limit=100`), `${tf} 캔들`);
        const candles = rows.filter(r => r[8] === '1').reverse().map(r => { const h = Number(r[2]), l = Number(r[3]); return { t: Number(r[0]), o: Number(r[1]), h, l, c: Number(r[4]), end: Number(r[0]) + TF_MS[tf] - 1, ...parseCandleVolume(r, l, h) }; });
        out[tf] = candles.some(c => !(c.o > 0 && c.h >= Math.max(c.o, c.c, c.l) && c.l > 0 && c.l <= Math.min(c.o, c.c))) ? trendOf(null, tf, now, '비정상 캔들') : trendOf(candles, tf, now);
        if (keep && out[tf].dir !== 'UNKNOWN') keep[tf] = candles.slice(-100); // 검증(최신·연속·정상 OHLC)을 통과한 캔들만 차트에 사용
      } catch (error) {
        out[tf] = trendOf(null, tf, now); out[tf].basis = `수집 실패(${error.status ?? error.message})`;
        if ([403, 418, 429, 451].includes(error.status)) { out.blocked = true; break; } // 제한 응답이면 추가 호출 중단
      }
    }
    return out;
  }
  return async function collect(now) {
    const started = Date.now();
    const instruments = okData(await get('/public/instruments?instType=SWAP'), '계약 목록');
    const tickers = okData(await get('/market/tickers?instType=SWAP'), '티커');
    const universe = selectUniverse({ instruments, tickers, max, priority });
    const ids = universe.ids;
    const turn24 = universe.turnover;
    const rows = [], failures = [], raw5 = {};
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
        const klines = candles.filter(r => r[8] === '1').reverse().map(r => [r[0], r[1], r[2], r[3], r[4], r[5], Number(r[0]) + 299999, r[7], r[6]]); // [8]=volCcy(기초자산 수량): 거래대금 단위 점검용
        raw5[symbol] = klines.map(k => ({ t: Number(k[0]), o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), end: Number(k[6]), ...parseCandleVolume([k[0], k[1], k[2], k[3], k[4], k[5], k[8], k[7]], Number(k[3]), Number(k[2])) })).slice(-70);
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
    const filtered = applyBtcFilter(rows);
    // MTF 조회 대상: BTC + 강한 후보 + 예비 점수 상위 4종목 (호출 수 절약)
    const btcRow = filtered.find(r => r.symbol === 'BTCUSDT');
    const ranked2 = filtered.filter(r => r.symbol !== 'BTCUSDT').map(r => ({ r, p: preliminary(r, btcRow) }))
      .sort((a, b) => (b.r.strong - a.r.strong) || (b.p.score - a.p.score));
    const targets = [...new Set([...(btcRow ? [btcRow] : []), ...ranked2.slice(0, 4).map(x => x.r)])];
    const mtf = {}, charts = {}; let blocked = false;
    // 차트용 5분 확정 캔들(대체 시간봉): 이미 받은 데이터를 재사용하므로 추가 호출 없음
    for (const r of filtered) if (raw5[r.symbol]) charts[r.symbol] = { '5m': raw5[r.symbol] };
    for (const row of targets) {
      if (blocked || Date.now() - started > 200000) break;
      try { const keep = charts[row.symbol] ??= {}; const m = await loadMtf(row.instId, now, keep); blocked = Boolean(m.blocked); delete m.blocked; mtf[row.symbol] = m; }
      catch { /* 시간대 분석 실패는 격리 */ }
    }
    return { rows: enrich(filtered, mtf), failures, charts, stats: { calls: stats.calls, ms: Date.now() - started, mtfSymbols: Object.keys(mtf), universe: { selected: ids, eligible: universe.eligibleCount, priority: universe.priorityStatus, excluded: universe.excluded, reasons: universe.reasonCounts, categories: universe.categoryCounts } } };
  };
}
