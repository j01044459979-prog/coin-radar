// RICH STRATEGY RADAR 3.0: isolated OKX USDT-SWAP history collector.
// Reads only public market data. Never sends orders or Telegram alerts.
// Endpoint: https://www.okx.com/docs-v5/en/#order-book-trading-market-data-get-candlesticks-history
// Input/output timestamps are UTC epoch milliseconds. [from, to) is exclusive at the end.

import { validateClosedCandles } from './strategies-v3.mjs';

export const FIVE_MINUTES = 300000;
export const HISTORY_ENDPOINT = 'https://www.okx.com/api/v5/market/history-candles';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function requireIntegerTimestamp(ms, label) {
  if (!Number.isSafeInteger(ms) || ms <= 0 || ms % FIVE_MINUTES !== 0) {
    throw new Error(label + ' must be aligned to a UTC 5m candle start in milliseconds');
  }
}
function httpError(status, retryAfter) {
  const err = new Error('OKX history HTTP ' + status);
  err.status = status; err.retryAfter = retryAfter;
  return err;
}
function decodePage(json) {
  if (json?.code === '50011') throw httpError(429, 2);
  if (!json || json.code !== '0' || !Array.isArray(json.data)) {
    throw new Error('OKX history API error: ' + String(json?.code ?? 'invalid-response'));
  }
  const out = json.data.map((r, i) => {
    if (!Array.isArray(r) || r.length < 9) throw new Error('Malformed OKX candle at row ' + i);
    const [t, o, h, l, c, , v, q, confirm] = r;
    const bar = { t: Number(t), o: Number(o), h: Number(h), l: Number(l), c: Number(c),
      v: Number(v), q: Number(q), confirm };
    if (!Number.isSafeInteger(bar.t) || bar.t < 0 || bar.t % FIVE_MINUTES !== 0 ||
      ![bar.o, bar.h, bar.l, bar.c, bar.v, bar.q].every(Number.isFinite) ||
      bar.v < 0 || bar.q < 0 || bar.l <= 0 ||
      bar.h < Math.max(bar.o, bar.c, bar.l) || bar.l > Math.min(bar.o, bar.c)) {
      throw new Error('Invalid OKX candle: ' + String(t));
    }
    // Open bars are not allowed to leak into research history, even if encountered unexpectedly.
    if (bar.confirm !== '1') throw new Error('Incomplete OKX historical candle: ' + bar.t);
    return bar;
  });
  for (let i = 1; i < out.length; i++) {
    if (out[i - 1].t <= out[i].t) throw new Error('History page is not strictly newest-first');
  }
  return out;
}

async function fetchPage(url, { fetcher, pause, maxRetries, timeoutMs }) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res;
    try {
      res = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    } catch (e) {
      if (attempt === maxRetries) throw new Error('OKX history connection failed');
      await pause(1000 * (attempt + 1));
      continue;
    }
    if (!res?.ok) {
      const status = Number(res?.status) || 0;
      const retry = Number(res?.headers?.get?.('retry-after')) || 0;
      if (status === 429 && attempt < maxRetries) {
        await pause(Math.max(2000, Math.min(30000, retry * 1000)));
        continue;
      }
      throw httpError(status, retry);
    }
    let parsed;
    try { parsed = await res.json(); }
    catch { throw new Error('Invalid OKX history JSON response'); }
    try { return decodePage(parsed); }
    catch (err) {
      if (err.status === 429 && attempt < maxRetries) {
        await pause(2000 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Unreachable retry state');
}

export function validateHistoryCoverage(candles, from, to) {
  requireIntegerTimestamp(from, 'from');
  requireIntegerTimestamp(to, 'to');
  if (to <= from) throw new Error('Invalid research range');
  const required = (to - from) / FIVE_MINUTES;
  if (candles.length !== required) {
    throw new Error('Incomplete historical coverage: expected ' + required + ' bars; found ' + candles.length);
  }
  validateClosedCandles(candles);
  if (candles[0].t !== from || candles[candles.length - 1].t !== to - FIVE_MINUTES) {
    throw new Error('Incomplete historical coverage at requested boundaries');
  }
  return { expected: required, actual: candles.length, coveragePercent: 100 };
}

export async function collectOkxHistory({
  instId, from, to, fetcher = fetch, pause = sleep,
  limit = 100, gapMs = 140, maxPages = 1300, maxRetries = 2, timeoutMs = 12000,
} = {}) {
  if (typeof instId !== 'string' || !/^[A-Z0-9]+-USDT-SWAP$/.test(instId)) {
    throw new Error('Only named OKX USDT perpetual SWAP instruments are allowed');
  }
  requireIntegerTimestamp(from, 'from');
  requireIntegerTimestamp(to, 'to');
  const totalBars = (to - from) / FIVE_MINUTES;
  if (!Number.isSafeInteger(totalBars) || totalBars < 2 || totalBars > 110000) {
    throw new Error('Invalid history window: require 2 to 110000 complete 5m bars');
  }
  if (!Number.isInteger(limit) || limit < 2 || limit > 100) throw new Error('Page size must be 2..100');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 2000) throw new Error('Invalid maximum page count');
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5 ||
      !Number.isFinite(gapMs) || gapMs < 0 || gapMs > 10000) throw new Error('Invalid rate-limit settings');
  let cursor = to, pages = 0, reachedStart = false, priorOldest = Infinity;
  const bars = new Map();
  while (!reachedStart && pages < maxPages) {
    const url = new URL(HISTORY_ENDPOINT);
    url.searchParams.set('instId', instId);
    url.searchParams.set('bar', '5m');
    url.searchParams.set('limit', String(limit));
    // OKX "after" returns candles older than the timestamp; NEVER use "before" for this.
    url.searchParams.set('after', String(cursor));
    if (pages > 0 && gapMs > 0) await pause(gapMs);
    const page = await fetchPage(url.toString(), { fetcher, pause, maxRetries, timeoutMs });
    pages++;
    if (!page.length) throw new Error('History ended before requested start: ' + cursor);
    const oldest = page[page.length - 1].t;
    if (oldest >= cursor || oldest >= priorOldest) throw new Error('History cursor did not move backward');
    priorOldest = oldest;
    for (const b of page) {
      if (b.t >= cursor) throw new Error('History page violates exclusive after cursor');
      if (b.t < from) { reachedStart = true; continue; }
      if (b.t >= to) continue;
      if (bars.has(b.t)) throw new Error('Duplicate historical candle across pages: ' + b.t);
      bars.set(b.t, b);
      if (bars.size > totalBars) throw new Error('Too many historical candles for requested range');
    }
    // If all required timestamps arrived, a final completeness validator will confirm.
    if (bars.size === totalBars) reachedStart = true;
    cursor = oldest;
  }
  if (!reachedStart) throw new Error('Maximum page budget reached before requested start');
  const candles = [...bars.values()].sort((a, b) => a.t - b.t);
  const quality = validateHistoryCoverage(candles, from, to); // Fails closed on gaps.
  return {
    source: 'OKX', market: 'USDT-SWAP', instId, timeframe: '5m',
    fromInclusive: from, toExclusive: to, fetchedPages: pages, quality, candles,
  };
}
