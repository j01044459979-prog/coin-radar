/**
 * RICH 300 — 수동 포지션 등록(?p=pos). Binance 에서 직접 연 선물 포지션을 종목·방향·실제 진입가·수량·레버리지·증거금·손절·익절로 기록한다.
 *  · 주문·계정 API 없음. 기록 + (운영 승인 후) 공개 시세 기반 감시 알림 대상 등록만 한다. 이 파일의 어떤 함수도 트리거를 만들거나 Telegram 을 보내지 않는다.
 *  · google.script.run 대상 함수는 각각 소유자 확인을 다시 한다(클라이언트 호출은 라우터를 거치지 않음).
 *  · 종목 확인은 OKX·Bybit 공개 티커 2건(읽기 전용)이며 결과는 6시간 캐시한다. 응답을 못 받으면 등록은 허용하고 경고만 한다.
 *  · 로그에는 아무것도 출력하지 않는다.
 */
function rich300ManualEnv_() {
  var base = rich300JournalEnv_();
  base.randomId = function (n) { return Utilities.getUuid().replace(/[^A-Za-z0-9]/g, '').slice(0, n || 8); };
  base.symbolCheck = rich300ManualSymbolCheck_;
  return base;
}
function rich300ManualSymbolCheck_(symbolId) {
  var E = RICH300_ENGINE, cache = CacheService.getScriptCache(), key = 'sc:' + symbolId;
  try { if (cache.get(key) === 'ok') return 'ok'; } catch (err) { /* 캐시 실패는 무시 */ }
  var o = E.watchMarketUrls('OKX', symbolId), b = E.watchMarketUrls('Bybit', symbolId);
  if (!o || !b) return 'unknown';
  var res; try { res = UrlFetchApp.fetchAll([{ url: o.ticker, method: 'get', muteHttpExceptions: true }, { url: b.ticker, method: 'get', muteHttpExceptions: true }]); } catch (err) { return 'unverified'; }
  var verdict = E.watchSymbolVerdict(rich300WatchJson_(res[0]), rich300WatchJson_(res[1]));
  if (verdict === 'ok') { try { cache.put(key, 'ok', 21600); } catch (err2) { /* 무시 */ } }
  return verdict;
}
/** 페이지(?p=pos): 서버에서 완성된 HTML. 시세 호출 없음(시트만 읽는다). */
function rich300PagePos_(e) {
  var html, appUrl = rich300AppUrl_();
  try {
    var env = rich300JournalEnv_();
    html = RICH300_ENGINE.manualRenderHtml({ open: RICH300_ENGINE.manualOpenList(env.storeEnv()), appUrl: appUrl, build: RICH300_BUILD, now: Date.now() });
  } catch (err) { html = RICH300_ENGINE.shellRenderError({ title: '포지션', code: RICH300_ENGINE.shellErrorCode(err), appUrl: appUrl, page: 'pos' }); }
  return rich300Html_(html, 'RICH300 포지션');
}
/** google.script.run 대상(소유자 전용) */
function rich300ManualRegister(form) {
  if (!rich300IsOwner_()) return { ok: false, error: 'forbidden' };
  try { return RICH300_ENGINE.manualRegister(rich300ManualEnv_(), form || {}, { actor: 'ui:pos' }); } catch (err) { return rich300UiError_(err); }
}
function rich300ManualUpdate(sid, patch) {
  if (!rich300IsOwner_()) return { ok: false, error: 'forbidden' };
  try { return RICH300_ENGINE.manualUpdate(rich300ManualEnv_(), String(sid || ''), patch || {}, { actor: 'ui:pos' }); } catch (err) { return rich300UiError_(err); }
}
