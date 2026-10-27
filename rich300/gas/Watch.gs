/**
 * RICH 300 — 보유 포지션 감시(시간 트리거). 웹앱 화면과 무관하게 *백그라운드*에서만 실행되어 홈 화면을 느리게 하지 않는다.
 *  · 기본 OFF: 스크립트 속성 RICH300_WATCH_ALERTS 가 'on' 일 때만 전송, 'preview' 면 계산만(전송·상태 저장 없음), 없으면 아무것도 하지 않는다(시세 호출 0).
 *  · 이 파일의 어떤 함수도 기존 트리거를 바꾸지 않는다. 감시 트리거는 rich300WatchInstallTrigger() 를 *직접 실행했을 때만* 설치된다(사용자 승인 후).
 *  · 시세: 거래소 공개 API(OKX 우선, 실패 시 Bybit) 읽기 전용 — 키·주문 없음. 사용자가 등록한 체결과 시세는 별도 출처로 표시된다.
 *  · 상태: Script Properties 'w:' 접두(포지션별 전송 기록·손절 단계 등). 텔레그램 입력 상태 'tg:'·COIN RADAR(GitHub Actions 캐시)와 분리.
 *  · 전송은 텔레그램 환경 가드(rich300TgGate_)를 그대로 따른다: 운영 승인 전에는 'on' 이어도 전송하지 않고 미리보기로만 동작한다.
 *  · 로그에는 개수·코드만 남긴다(금액·ID·본문·토큰 없음).
 */
function rich300WatchMode_() {
  var v = String(PropertiesService.getScriptProperties().getProperty('RICH300_WATCH_ALERTS') || '').trim().toLowerCase();
  return v === 'on' ? 'on' : v === 'preview' ? 'preview' : 'off';
}
function rich300WatchJson_(res) { try { return res.getResponseCode() === 200 ? JSON.parse(res.getContentText()) : null; } catch (err) { return null; } }
/** 공개 시세 수집: 15분·1시간·4시간 봉 + 현재가(주소·해석·판정은 엔진의 watchMarketUrls/watchParseSource 와 같다). 봉 캐시는 60·150·600초뿐이고 현재가는 캐시하지 않는다. opts.noCache 면 캐시 없이 새로 읽는다(연결 점검용).
 *  반환 attempts: 출처별 { src, ms(응답 시간), http:[상태 코드…], ticker:bool, n:{15m,1h,4h} } — 코드·시간·개수만(본문·값 없음). */
function rich300WatchMarket_(symbolId, opts) {
  var E = RICH300_ENGINE, cache = CacheService.getScriptCache(), now = Date.now(), noCache = !!(opts && opts.noCache), TTL = { '15m': 60, '1h': 150, '4h': 600 };
  var out = { ok: false, source: null, price: 0, priceAt: 0, why: '', attempts: [], bars15m: null, bars1h: null, bars4h: null };
  if (!E.watchMarketUrls('OKX', symbolId)) return out;
  function cached(k) { if (noCache) return null; try { var c = cache.get('wc:' + symbolId + ':' + k); return c ? JSON.parse(c) : null; } catch (err) { return null; } }
  function keep(k, v) { if (noCache) return; try { cache.put('wc:' + symbolId + ':' + k, JSON.stringify(v), TTL[k]); } catch (err) { /* 캐시 실패는 무시 */ } }
  ['15m', '1h', '4h'].forEach(function (k) { out['bars' + k] = cached(k); });
  var sources = ['OKX', 'Bybit'];
  for (var si = 0; si < sources.length && !out.ok; si++) {
    var src = sources[si], urls = E.watchMarketUrls(src, symbolId), keys = ['ticker'], reqs = [{ url: urls.ticker, method: 'get', muteHttpExceptions: true }];
    ['15m', '1h', '4h'].forEach(function (k) { if (!out['bars' + k]) { keys.push(k); reqs.push({ url: urls[k], method: 'get', muteHttpExceptions: true }); } });
    var t0 = Date.now(), res, att = { src: src, ms: 0, http: [], ticker: false, n: {} };
    try { res = UrlFetchApp.fetchAll(reqs); } catch (err) { att.ms = Date.now() - t0; att.http = ['exception']; out.attempts.push(att); out.why += src + '[fetch-exception] '; continue; }
    att.ms = Date.now() - t0;
    var jsons = {}; for (var i = 0; i < keys.length; i++) { att.http.push(res[i].getResponseCode()); jsons[keys[i]] = rich300WatchJson_(res[i]); }
    var parsed = E.watchParseSource(src, jsons, now), tk = parsed.ticker; att.ticker = !!tk;
    ['15m', '1h', '4h'].forEach(function (k) { var got = parsed.bars[k]; att.n[k] = got ? got.length : 0; if (got && got.length) { out['bars' + k] = got; keep(k, got); } });
    out.attempts.push(att);
    out.why += src + '[http ' + att.http.join('/') + ' ticker ' + (tk ? 'ok' : 'bad') + '] ';      // 상태 코드만(본문·값 없음)
    if (!tk) continue;
    if (out.bars15m && out.bars1h && out.bars4h) { out.ok = true; out.source = src; out.price = tk.price; out.priceAt = tk.priceAt; }
  }
  return out;
}
function rich300WatchEnv_(mode) {
  var props = PropertiesService.getScriptProperties(), P = 'w:', store = null, tg = null;
  function tgEnv() { if (!tg) tg = rich300TgEnv_(); return tg; }
  return {
    now: function () { return Date.now(); },
    clock: function () { return Date.now(); },      // 실행 시간 한도(240초) 판단용 — 종목이 많아도 6분 제한 전에 멈춘다
    mode: function () { return mode; },
    storeEnv: function () { if (!store) { store = rich300GasEnv_(props.getProperty('RICH300_SHEET_ID')); RICH300_ENGINE.storeInit(store); } return store; },
    kv: {
      get: function (k) { return props.getProperty(P + k); },
      put: function (k, v) { props.setProperty(P + k, v); },
      del: function (k) { props.deleteProperty(P + k); },
      keys: function () { return props.getKeys().filter(function (k) { return k.indexOf(P) === 0; }).map(function (k) { return k.slice(P.length); }); }
    },
    market: rich300WatchMarket_,
    send: function (text) {
      var e = tgEnv(), p = RICH300_ENGINE.tgPairedUser(e);
      if (!p) return { ok: false, code: 'not-paired' };
      return RICH300_ENGINE.tgSendNotice(e, p.chatId, text);
    }
  };
}
/** 전송이 실제로 가능한가: 환경 가드 통과 + 텔레그램 연결됨. 아니면 'on' 이어도 미리보기로만 동작한다. */
function rich300WatchCanSend_() {
  try {
    if (typeof rich300TgGate_ === 'function' && rich300TgGate_('sendMessage')) return false;
    return !!RICH300_ENGINE.tgPairedUser(rich300TgEnv_());
  } catch (err) { return false; }
}
/** 시간 트리거 진입점(5분). 겹쳐 실행되지 않도록 사용자 락을 잡는다. 결과는 개수만 속성에 남긴다. */
function rich300WatchTick() { return rich300WatchRun_(rich300WatchMode_()); }
/** 편집기에서 직접 실행하는 미리보기: 전송·상태 저장 없이 계산 결과 개수만 돌려준다(설정과 무관, 어떤 속성도 쓰지 않는다). */
function rich300WatchPreview() { return rich300WatchRun_('preview'); }
function rich300WatchRun_(want) {
  var props = PropertiesService.getScriptProperties(), t0 = Date.now(), out;
  if (want === 'off') return { status: 'off' };
  var lk = typeof LockService.getUserLock === 'function' ? LockService.getUserLock() : null;
  if (lk && !lk.tryLock(500)) return { status: 'busy' };
  try {
    var mode = want === 'on' && !rich300WatchCanSend_() ? 'preview' : want;
    out = RICH300_ENGINE.watchTick(rich300WatchEnv_(mode)); out.requested = want;
  } catch (err) { out = { status: 'exception', code: String(err && err.code || err && err.name || 'error').slice(0, 24) }; }
  finally { if (lk) lk.releaseLock(); }
  if (want !== 'preview') try { props.setProperty('watch:last', JSON.stringify({ at: t0, ms: Date.now() - t0, status: out.status, mode: out.mode || out.requested || want, requested: want, positions: out.positions || 0, events: out.events || 0, sent: out.sent || 0, failed: out.failed || 0, marketFail: out.marketFail || 0, code: out.code || null })); } catch (err) { /* 기록 실패는 무시 */ }
  return out;
}
/** 감시 트리거 설치/제거 — 같은 이름의 트리거만 교체한다. 다른 트리거(수신 폴링·일 마감·백업)는 건드리지 않는다. 승인 후 직접 실행. */
function rich300WatchInstallTrigger() {
  rich300WatchRemoveTrigger();
  ScriptApp.newTrigger('rich300WatchTick').timeBased().everyMinutes(5).create();
  return { ok: true, everyMinutes: 5 };
}
function rich300WatchRemoveTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'rich300WatchTick') ScriptApp.deleteTrigger(t); });
}

/**
 * 감시가 *지금 실제로* 꺼져 있는지 진단한다(읽기 전용: 속성 읽기·트리거 목록·가드 상태만, 시세·시트·텔레그램 호출 없음).
 *  prop: 'unset'(속성 없음) | 'off' | 'preview' | 'on' | 'invalid'(인식할 수 없는 값 — 길이만 표시, 동작은 꺼짐과 같음)
 *  effective: 실제 동작 — 'nothing'(아무것도 안 함) | 'preview-only' | 'sends'(전송 가능)
 */
function rich300WatchState_() {
  var props = PropertiesService.getScriptProperties(), raw = props.getProperty('RICH300_WATCH_ALERTS'), prop, v = raw === null || raw === undefined ? null : String(raw);
  if (v === null) prop = 'unset'; else { var t = v.trim().toLowerCase(); prop = t === 'on' ? 'on' : t === 'preview' ? 'preview' : t === 'off' ? 'off' : 'invalid'; }
  var triggers = ScriptApp.getProjectTriggers().filter(function (x) { return x.getHandlerFunction() === 'rich300WatchTick'; }).length;
  var gateBlocked = typeof rich300TgGate_ === 'function' ? !!rich300TgGate_('sendMessage') : true, paired = false;
  try { paired = !!RICH300_ENGINE.tgPairedUser(rich300TgEnv_()); } catch (err) { paired = false; }
  var canSend = !gateBlocked && paired, mode = rich300WatchMode_();
  var last = null; try { var raw2 = props.getProperty('watch:last'); last = raw2 ? JSON.parse(raw2) : null; } catch (err) { last = null; }
  return { prop: prop, invalidLen: prop === 'invalid' ? v.length : 0, mode: mode, gateBlocked: gateBlocked, paired: paired, triggers: triggers, last: last,
    effective: mode === 'off' ? 'nothing' : mode === 'preview' ? 'preview-only' : (canSend ? 'sends' : 'preview-only') };
}
/** ?p=watch — 소유자 전용. 기본 방문은 상태만 읽는다(시세 호출 없음). &run=1 은 미리보기, &net=1 은 시세 연결 점검(캐시 없이 새로 읽어 출처·응답 시간·신선도·오류 코드 표시). 둘 다 전송·트리거·속성 쓰기가 없다. */
/** 시세 연결 점검(읽기 전용): 보유 포지션 종목 + BTCUSDT 를 캐시 없이 새로 읽어 출처별 응답 시간·상태 코드·신선도를 돌려준다. 값(가격)은 돌려주지 않는다. */
function rich300WatchNetCheck_() {
  var E = RICH300_ENGINE, now = Date.now(), syms = ['BTCUSDT'];
  try { E.watchOpenPositions(rich300WatchEnv_('preview').storeEnv(), { now: now }).positions.forEach(function (p) { if (syms.indexOf(p.symbolId) < 0) syms.push(p.symbolId); }); } catch (err) { /* 시트 오류여도 BTCUSDT 점검은 한다 */ }
  return syms.slice(0, 6).map(function (sym) {
    var t0 = Date.now(), m = rich300WatchMarket_(sym, { noCache: true }), a = m.ok ? E.watchAssessMarket(m, now) : { ok: false, why: 'fetch-failed' }, last = function (b) { return b && b.length ? Math.round((now - b[b.length - 1].t) / 60000) : null; };
    return { symbol: sym, ok: !!(m.ok && a.ok), source: m.source, totalMs: Date.now() - t0, priceAgeSec: m.ok ? Math.round((now - m.priceAt) / 1000) : null, bar1hAgeMin: last(m.bars1h), bar4hAgeMin: last(m.bars4h), why: m.ok && a.ok ? null : (a.why || 'fetch-failed'), attempts: m.attempts };
  });
}
function rich300PageWatch_(e) {
  var t0 = Date.now(), p = (e && e.parameter) || {}, run = p.run === '1', net = p.net === '1', result = null, netRes = null, err = null;
  try { if (run) result = rich300WatchRun_('preview'); if (net) netRes = rich300WatchNetCheck_(); } catch (x) { err = RICH300_ENGINE.shellErrorCode(x); }
  var state = rich300WatchState_();
  var html = RICH300_ENGINE.shellRenderWatch({ state: state, result: result, net: netRes, ran: run || net, error: err, ms: Date.now() - t0, appUrl: rich300AppUrl_(), build: RICH300_BUILD });
  return rich300Html_(html, 'RICH300 감시 점검');
}
