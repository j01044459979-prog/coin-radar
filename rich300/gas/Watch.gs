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
/** 공개 시세 수집: 15분·1시간·4시간 봉 + 현재가. 캐시는 아주 짧게(봉 60·150·600초) — 현재가는 캐시하지 않는다. */
function rich300WatchMarket_(symbolId) {
  var E = RICH300_ENGINE, cache = CacheService.getScriptCache(), now = Date.now(), inst = E.watchOkxInst(symbolId);
  if (!inst) return { ok: false };
  var bars = { '15m': { okx: '15m', byb: '15', ms: 900000, n: 6, ttl: 60 }, '1h': { okx: '1H', byb: '60', ms: 3600000, n: 100, ttl: 150 }, '4h': { okx: '4H', byb: '240', ms: 14400000, n: 100, ttl: 600 } };
  function cached(k) { try { var c = cache.get('wc:' + symbolId + ':' + k); return c ? JSON.parse(c) : null; } catch (err) { return null; } }
  function keep(k, v, ttl) { try { cache.put('wc:' + symbolId + ':' + k, JSON.stringify(v), ttl); } catch (err) { /* 캐시 실패는 무시 */ } }
  var out = { ok: false, source: null, price: 0, priceAt: 0, bars15m: cached('15m'), bars1h: cached('1h'), bars4h: cached('4h') };
  var sources = ['OKX', 'Bybit'];
  for (var si = 0; si < sources.length && !out.ok; si++) {
    var src = sources[si], reqs = [], keys = [];
    var add = function (url, key) { reqs.push({ url: url, method: 'get', muteHttpExceptions: true }); keys.push(key); };
    if (src === 'OKX') { add('https://www.okx.com/api/v5/market/ticker?instId=' + inst, 'ticker'); } else { add('https://api.bybit.com/v5/market/tickers?category=linear&symbol=' + symbolId, 'ticker'); }
    ['15m', '1h', '4h'].forEach(function (k) {
      if (out['bars' + k]) return;
      if (src === 'OKX') add('https://www.okx.com/api/v5/market/candles?instId=' + inst + '&bar=' + bars[k].okx + '&limit=' + bars[k].n, k);
      else add('https://api.bybit.com/v5/market/kline?category=linear&symbol=' + symbolId + '&interval=' + bars[k].byb + '&limit=' + bars[k].n, k);
    });
    var res; try { res = UrlFetchApp.fetchAll(reqs); } catch (err) { continue; }
    var tk = null, got = {};
    for (var i = 0; i < keys.length; i++) {
      var j = rich300WatchJson_(res[i]);
      if (keys[i] === 'ticker') tk = src === 'OKX' ? E.watchParseOkxTicker(j) : E.watchParseBybitTicker(j);
      else got[keys[i]] = src === 'OKX' ? E.watchParseOkxBars(j) : E.watchParseBybitBars(j, bars[keys[i]].ms, now);
    }
    if (!tk) continue;
    ['15m', '1h', '4h'].forEach(function (k) { if (got[k] && got[k].length) { out['bars' + k] = got[k]; keep(k, got[k], bars[k].ttl); } });
    if (out.bars15m && out.bars1h && out.bars4h) { out.ok = true; out.source = src; out.price = tk.price; out.priceAt = tk.priceAt; }
  }
  return out;
}
function rich300WatchEnv_(mode) {
  var props = PropertiesService.getScriptProperties(), P = 'w:', store = null, tg = null;
  function tgEnv() { if (!tg) tg = rich300TgEnv_(); return tg; }
  return {
    now: function () { return Date.now(); },
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
/** 편집기에서 직접 실행하는 미리보기: 전송·상태 저장 없이 계산 결과 개수만 돌려준다(설정과 무관). */
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
  try { props.setProperty('watch:last', JSON.stringify({ at: t0, ms: Date.now() - t0, status: out.status, mode: out.mode || out.requested || want, requested: want, positions: out.positions || 0, events: out.events || 0, sent: out.sent || 0, failed: out.failed || 0, marketFail: out.marketFail || 0, code: out.code || null })); } catch (err) { /* 기록 실패는 무시 */ }
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
