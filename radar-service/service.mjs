import { reportParts } from './report.mjs';
import { alertReport } from './compact.mjs';
import { candidateSpec, chartCaption, chartPlan } from './chart.mjs';
import { needsRefresh } from './news.mjs';

// 제한 응답 대기 정책(전체 수집 실패·수집 중간 제한 공통): 최소 5분, 429는 Retry-After 반영,
// 403(지역/권한 차단)·451(지역 제한)·418(IP 차단 경고)은 반복 요청이 차단을 악화시킬 수 있어 최소 1시간 대기한다.
export const RESTRICTED = [403, 418, 429, 451];
export const waitMs = (status, retryAfterSec = 0) => Math.max(300000, (Number(retryAfterSec) || 0) * 1000, [403, 418, 451].includes(status) ? 3600000 : 0);

export class ApiError extends Error {
  constructor(service, status, retryAfter = 0) {
    super(`${service} HTTP ${status}`); this.status = status; this.retryAfter = retryAfter;
  }
}
export async function jsonRequest(url, options = {}, fetcher = fetch) {
  let response;
  const { timeoutMs = 10000, ...rest } = options;
  try { response = await fetcher(url, { ...rest, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' }); }
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
  // html=true이면 parse_mode HTML(<b>, <a href>만 사용). 동적 문자열은 호출 쪽에서 이스케이프한다.
  return async (text, { html = false, markup = null } = {}) => {
    if (text.length > 4000) throw new Error('Telegram 메시지 길이 초과');
    const body = { chat_id: chatId, text, link_preview_options: { is_disabled: true }, ...(html ? { parse_mode: 'HTML' } : {}), ...(markup ? { reply_markup: markup } : {}) };   // markup(inline keyboard)은 RICH 300 연동 메시지에만 쓴다
    const result = await jsonRequest(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }, fetcher);
    if (!result.ok || !result.result?.message_id) throw new Error('Telegram 전송 미확인');
  };
}

// HTML 본문 전송. Telegram이 서식을 거부(HTTP 400)하면 같은 내용을 일반 텍스트로 다시 보내 데이터가 사라지지 않게 한다.
// 400 이외의 오류(네트워크·429·5xx)는 그대로 던져 기존 재시도·중복 방지 경로를 따른다.
export async function sendText(send, part) {
  const extra = part.markup ? { markup: part.markup } : null;                                    // markup이 없는 기존 메시지는 호출 인자가 이전과 같다
  if (!part.html) return extra ? send(part.text, extra) : send(part.text);
  try { return await send(part.text, extra ? { html: true, ...extra } : { html: true }); }
  catch (error) { if (error.status === 400 && part.plain) return extra ? send(part.plain, extra) : send(part.plain); throw error; }
}

// sendPhoto: 차트 PNG 업로드. 성공(message_id) 확인 후에만 true 취급. 토큰은 오류 메시지에 노출되지 않는다.
export function telegramPhotoSender(token, chatId, fetcher = fetch) {
  if (!token || !/^[1-9]\d*$/.test(chatId || '')) throw new Error('개인 Telegram token/chat ID 설정 필요');
  return async (png, caption = '', { markup = null } = {}) => {
    if (!png?.length) throw new Error('이미지 없음');
    if (caption.length > 1024) throw new Error('Telegram 캡션 길이 초과');
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption);
    if (markup) form.append('reply_markup', JSON.stringify(markup));
    form.append('photo', new Blob([png], { type: 'image/png' }), 'chart.png');
    const result = await jsonRequest(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form, timeoutMs: 20000 }, fetcher);
    if (!result.ok || !result.result?.message_id) throw new Error('Telegram 사진 전송 미확인');
  };
}

export const MAX_CHARTS = 2; // 기본 정기 보고: 추천 관찰 TOP 2 후보 차트 최대 2장(후보 없으면 BTC 시장 차트 1장)
export const PARTIAL_VERSION = 3; // 전송 파트 구성(텍스트 1 + 사진 ≤2) 버전. 이전 버전의 partial은 이미 전달된 보고로 간주한다.

// 차트 렌더링 격리: 개별 실패·시간 초과는 png=null로 남기고 텍스트 보고는 계속된다.
async function withTimeout(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} 시간 초과`)), ms); })]); }
  finally { clearTimeout(timer); }
}
async function buildChart(spec, render, timeoutMs = 15000) {
  if (spec.skipped) return { symbol: spec.symbol, png: null, error: spec.skipped };
  try { return { symbol: spec.symbol, tf: spec.tf, kind: spec.kind, reason: spec.reason, caption: chartCaption(spec), png: await withTimeout(render(spec), timeoutMs, '차트 렌더링') }; }
  catch (error) { return { symbol: spec.symbol, tf: spec.tf, kind: spec.kind, reason: spec.reason, png: null, error: String(error.message).slice(0, 80) }; }
}
// 사진 전송은 한 번만 재시도(네트워크·5xx), 429/4xx는 즉시 포기. 실패해도 예외를 던지지 않는다.
async function sendPhotoSafe(sendPhoto, item) {
  if (!sendPhoto || !item.png) return false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await sendPhoto(item.png, item.caption); return true; }
    catch (error) { item.error = String(error.message).slice(0, 80); if (error.status && error.status < 500) return false; }
  }
  return false;
}

// Caller serializes cycles and persists state on every acknowledged message.
// Telegram has no idempotency key: a crash after delivery but before save can duplicate once.
// 뉴스 갱신은 부가 기능: 실패·지연이 가격 분석/보고를 막지 않도록 시간 제한과 예외를 격리한다.
async function safeNews(news, state, now) {
  if (!news || !needsRefresh(state, now)) return;
  let timer;
  try { await Promise.race([news(state, now), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('뉴스 시간 초과')), 30000); })]); }
  catch (error) { state.newsError = String(error.message).slice(0, 80); }
  finally { clearTimeout(timer); }
}

export async function cycle({ now, state, collect, send, save, news, render, sendPhoto, chartTimeoutMs = 15000 }) {
  if (now < (state.retryAt || 0)) return { skipped: true };
  let result;
  try { result = await collect(now, { rotation: state.rotation }); }
  catch (error) {
    state.lastError = error.message;
    state.lastAttempt = now;
    state.retryAt = now + waitMs(error.status, error.retryAfter);
    await save(state);
    if (now - (state.errorSentAt || 0) >= 3600000) {
      await send(`리치 선물 레이더 · 수집 장애\n${error.message}\n가격·매매 신호를 생성하지 않습니다(대기). 다음 점검까지 대기합니다.`);
      state.errorSentAt = now; await save(state);
    }
    return { failed: true };
  }
  const { rows, failures, stats, charts: chartData } = result;
  state.lastAttempt = now; state.lastSuccess = now; state.lastError = null; state.retryAt = 0;
  state.rows = rows.map(r => ({ symbol: r.symbol, direction: r.direction, strong: r.strong, price: r.price, score: r.candidate?.score ?? null }));
  if (result.rotation) state.rotation = result.rotation; // 순환 위치·종목별 마지막 정밀 분석 시각(캐시 유실 시 안전하게 재초기화)
  // 수집 도중 제한 응답을 받았으면 일부만 수집된 결과를 보고하되 다음 수집을 정책대로 늦추고, 원인·대기시간을 기록한다.
  if (result.backoffMs) state.retryAt = now + result.backoffMs;
  state.lastLimit = result.limit ? { at: now, ...result.limit, waitMs: result.backoffMs || 0 } : null;
  state.failures = failures; state.stats = stats ?? null; state.sent ||= {};
  const hour = Math.floor(now / 3600000);
  const hourly = state.reportHour !== hour;
  const top = rows.filter(r => r.strong).sort((a, b) => b.volume - a.volume).slice(0, 2);
  // 억제 시간대(quiet): 상태 연속성이 의심될 때(손상 복구·오래된 캐시 복원) 이전 전송 기록을 알 수 없으므로 이 시간대에는 아무것도 보내지 않고
  // 현재 상태(보고 시각·강한 신호 쿨다운)만 기록한다. 다음 시간대부터 정상 재개. 중복 전송보다 1회 생략이 안전하다.
  if (state.quiet && state.quiet.hour !== hour) delete state.quiet;
  if (state.quiet) {
    state.reportHour = hour; delete state.partial;
    for (const row of top) state.sent[`${row.symbol}:${row.direction}`] = now;
    state.suppressed = { at: now, hour, reason: state.quiet.reason, strong: top.length };
    state.sent = Object.fromEntries(Object.entries(state.sent).filter(([, at]) => now - at < 86400000));
    await save(state);
    return { ok: true, quiet: state.quiet.reason, analyzed: rows.length, failed: failures.length };
  }
  if (hourly) {
    await safeNews(news, state, now);
    // 차트 렌더링은 부가 기능: 실패해도 텍스트 보고는 그대로 전송한다. 파트 순서(요약 → 1순위 차트 → 2순위 차트)는 항상 같다.
    const items = render && chartData ? await Promise.all(chartPlan(rows, chartData).slice(0, MAX_CHARTS).map(spec => buildChart(spec, render, chartTimeoutMs))) : [];
    const parts = reportParts(rows, failures, now, { news: state.news, scan: stats?.scan ?? null, charts: items.filter(i => !i.skipped && (i.png || i.error)) });
    // 파트별로 전송 확인·저장한다. 중간 실패 시 다음 실행이 이미 처리한 파트(이미지 포함)를 건너뛰어 중복 전송을 막는다.
    const done = [];
    // 업그레이드 호환: 이전 버전(partial.v가 없거나 3 미만)이 이 시간대 보고를 일부라도 보냈다면 이미 전달된 것으로 보고 새 형식으로 다시 보내지 않는다.
    const legacy = state.partial?.hour === hour && state.partial.v !== PARTIAL_VERSION;
    for (let i = legacy ? parts.length : state.partial?.hour === hour ? state.partial.sent : 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.type === 'text') await sendText(send, part);
      else done.push({ symbol: part.symbol, tf: part.tf, ok: await sendPhotoSafe(sendPhoto, part), error: part.error ?? null });
      state.partial = { hour, sent: i + 1, v: PARTIAL_VERSION }; await save(state);
    }
    if (items.length) state.chart = { hour, at: now, items: done.length ? done : items.map(i => ({ symbol: i.symbol, tf: i.tf, ok: false, error: i.error ?? null })) };
    delete state.partial;
    state.reportHour = hour;
    for (const row of top) state.sent[`${row.symbol}:${row.direction}`] = now;
    await save(state);
  } else {
    for (const row of top) {
      const key = `${row.symbol}:${row.direction}`;
      if (now - (state.sent[key] || 0) < 3600000) continue;
      const alert = alertReport(row, now);
      await sendText(send, { text: alert.text, plain: alert.plain, html: true });
      state.sent[key] = now; await save(state);
      // 긴급 알림: 간결 텍스트 뒤에 해당 종목 차트 1장(실패하면 생략)
      if (render && chartData) {
        const item = await buildChart(candidateSpec(row, chartData, '강한 신규 신호'), render, chartTimeoutMs);
        const ok = await sendPhotoSafe(sendPhoto, item);
        state.chart = { hour, at: now, items: [{ symbol: item.symbol, tf: item.tf ?? null, ok, error: item.error ?? null }] }; await save(state);
      }
    }
  }
  state.sent = Object.fromEntries(Object.entries(state.sent).filter(([, at]) => now - at < 86400000));
  await save(state);
  return { ok: true, analyzed: rows.length, failed: failures.length };
}
