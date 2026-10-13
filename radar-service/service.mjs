import { analyze, applyBtcFilter, reportText, signalText } from './analysis.mjs';

export class ApiError extends Error {
  constructor(service, status, retryAfter = 0) {
    super(`${service} HTTP ${status}`); this.status = status; this.retryAfter = retryAfter;
  }
}
export async function jsonRequest(url, options = {}, fetcher = fetch) {
  let response;
  try { response = await fetcher(url, { ...options, signal: AbortSignal.timeout(10000), redirect: 'error' }); }
  catch { throw new Error('외부 API 연결 실패'); } // Never log token-bearing Telegram URLs.
  if (!response.ok) throw new ApiError(new URL(url).hostname, response.status, Number(response.headers.get('retry-after')) || 0);
  try { return await response.json(); } catch { throw new Error('외부 API JSON 오류'); }
}
const base = 'https://fapi.binance.com';
export function createCollector(fetcher = fetch) {
  const get = path => jsonRequest(base + path, {}, fetcher);
  return async function collect(now) {
    const started = Date.now();
    const info = await get('/fapi/v1/exchangeInfo');
    const tickers = await get('/fapi/v1/ticker/24hr');
    if (!Array.isArray(info.symbols) || !Array.isArray(tickers)) throw new Error('거래소 종목 목록 오류');
    const allowed = new Set(info.symbols.filter(x => x.status === 'TRADING' && x.contractType === 'PERPETUAL' && x.quoteAsset === 'USDT').map(x => x.symbol));
    const ranked = tickers.filter(x => allowed.has(x.symbol) && /^[A-Z0-9]+USDT$/.test(x.symbol) && Number(x.quoteVolume) > 0)
      .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume));
    const symbols = [...new Set(['BTCUSDT', 'ETHUSDT', ...ranked.map(x => x.symbol)])].filter(s => allowed.has(s)).slice(0, 12);
    const rows = [], failures = [];
    for (const symbol of symbols) {
      if (Date.now() - started > 120000) throw new Error('전체 수집 시간 초과');
      try {
        const klines = await get(`/fapi/v1/klines?symbol=${symbol}&interval=5m&limit=61`);
        const premium = await get(`/fapi/v1/premiumIndex?symbol=${symbol}`);
        const oi = await get(`/fapi/v1/openInterest?symbol=${symbol}`);
        const history = await get(`/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=13`);
        if (Date.now() - started > 120000) throw new Error('전체 수집 시간 초과');
        rows.push(analyze(symbol, { klines, premium, oi, history }, now));
      } catch (error) {
        if ([403, 451, 418, 429].includes(error.status)) throw error;
        failures.push({ symbol, reason: error.message });
      }
    }
    if (Date.now() - started > 120000) throw new Error('전체 수집 시간 초과');
    if (!rows.length) throw new Error('모든 종목 수집 실패');
    return { rows: applyBtcFilter(rows), failures };
  };
}

export function telegramSender(token, chatId, fetcher = fetch) {
  if (!token || !/^[1-9]\d*$/.test(chatId || '')) throw new Error('개인 Telegram token/chat ID 설정 필요');
  return async text => {
    if (text.length > 4000) throw new Error('Telegram 메시지 길이 초과');
    const result = await jsonRequest(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
    }, fetcher);
    if (!result.ok || !result.result?.message_id) throw new Error('Telegram 전송 미확인');
  };
}

// Caller serializes cycles and persists state on every acknowledged message.
// Telegram has no idempotency key: a crash after delivery but before save can duplicate once.
export async function cycle({ now, state, collect, send, save }) {
  if (now < (state.retryAt || 0)) return { skipped: true };
  let result;
  try { result = await collect(now); }
  catch (error) {
    state.lastError = error.message;
    state.lastAttempt = now;
    state.retryAt = now + Math.max(300000, error.retryAfter * 1000 || 0, [403, 451].includes(error.status) ? 3600000 : 0);
    await save(state);
    if (now - (state.errorSentAt || 0) >= 3600000) {
      await send(`리치 선물 레이더 · 수집 장애\n${error.message}\n가격·매매 신호를 생성하지 않습니다(대기). 다음 점검까지 대기합니다.`);
      state.errorSentAt = now; await save(state);
    }
    return { failed: true };
  }
  const { rows, failures } = result;
  state.lastAttempt = now; state.lastSuccess = now; state.lastError = null; state.retryAt = 0;
  state.rows = rows; state.failures = failures; state.sent ||= {};
  const hour = Math.floor(now / 3600000);
  const hourly = state.reportHour !== hour;
  const top = rows.filter(r => r.strong).sort((a, b) => b.volume - a.volume).slice(0, 2);
  if (hourly) {
    await send(reportText(rows, failures, now));
    state.reportHour = hour;
    for (const row of top) state.sent[`${row.symbol}:${row.direction}`] = now;
    await save(state);
  } else {
    for (const row of top) {
      const key = `${row.symbol}:${row.direction}`;
      if (now - (state.sent[key] || 0) < 3600000) continue;
      await send(`🚨 신규 조건 포착 · 규칙 기반 분석 (${row.source ?? '거래소'})\n${signalText(row)}\n수집: ${new Date(now).toISOString()}\n위험: BTC 역방향 급변 또는 기준선 이탈 시 무효`);
      state.sent[key] = now; await save(state);
    }
  }
  state.sent = Object.fromEntries(Object.entries(state.sent).filter(([, at]) => now - at < 86400000));
  await save(state);
  return { ok: true, analyzed: rows.length, failed: failures.length };
}
