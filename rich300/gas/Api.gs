/**
 * RICH 300 — API 배포 진입점(R5, "나로 실행 / 누구나" 배포 전용). 엔진 번들(Engine) + Adapters.gs 와 같은 프로젝트에 둔다. 운영 배포는 S0 실측·승인 이후.
 *  · 인증: 본문 HMAC(rich300/lib/auth.mjs). 키는 Script Properties(RICH300_INGEST_KEY, 선택 RICH300_INGEST_KEY_PREV)에서만 읽는다. 코드·로그·응답에 키를 쓰지 않는다.
 *  · 스프레드시트 ID(RICH300_SHEET_ID)도 Script Properties. 시트는 인증이 통과한 뒤에만 연다.
 *  · nonce: CacheService(최선 노력, 만료·퇴출될 수 있음 — 재전송 신호는 sid 유일키로 어차피 중복 기록되지 않는다).
 *  · 이 파일은 로그를 출력하지 않는다(Logger/console 없음). GET 요청에는 빈 응답.
 */
function doGet() { return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT); }

function doPost(e) {
  var out;
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    out = RICH300_ENGINE.ingestHandle(rich300ApiEnv_(), raw);
  } catch (err) { out = { ok: false, error: 'server' }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function rich300ApiEnv_() {
  var props = PropertiesService.getScriptProperties(), cache = CacheService.getScriptCache(), store = null;
  return {
    now: function () { return Date.now(); },
    hmacSha256: function (key, message) { return rich300Hex_(Utilities.computeHmacSha256Signature(message, key)); },
    getKeys: function () { return [props.getProperty('RICH300_INGEST_KEY'), props.getProperty('RICH300_INGEST_KEY_PREV')].filter(function (k) { return k; }); },
    nonces: { has: function (n) { return cache.get('n:' + n) !== null; }, put: function (n, ttlSec) { cache.put('n:' + n, '1', ttlSec); } },
    counter: function (name) { var k = 'c:' + name, v = Number(cache.get(k) || 0) + 1; cache.put(k, String(v), 21600); },
    storeEnv: function () { if (!store) { store = rich300GasEnv_(props.getProperty('RICH300_SHEET_ID')); RICH300_ENGINE.storeInit(store); } return store; }
  };
}
