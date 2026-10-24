/**
 * RICH 300 — API 배포 진입점(R5, "나로 실행 / 누구나" 배포 전용). 엔진 번들(Engine) + Adapters.gs 와 같은 프로젝트에 둔다. 운영 배포는 S0 실측·승인 이후.
 *  · 인증: 본문 HMAC(rich300/lib/auth.mjs). 키는 Script Properties(RICH300_INGEST_KEY, 선택 RICH300_INGEST_KEY_PREV)에서만 읽는다. 코드·로그·응답에 키를 쓰지 않는다.
 *  · 스프레드시트 ID(RICH300_SHEET_ID)도 Script Properties. 시트는 인증이 통과한 뒤에만 연다.
 *  · nonce: CacheService(최선 노력, 만료·퇴출될 수 있음 — 재전송 신호는 sid 유일키로 어차피 중복 기록되지 않는다).
 *  · 이 파일은 로그를 출력하지 않는다(Logger/console 없음). GET 요청에는 빈 응답.
 */
/**
 * GET 라우터: 기본은 빈 응답(익명 GET에 아무 정보도 주지 않는다 — S0 실측: 익명 GET도 도달 가능).
 *  ?p=fill (R4 모바일 입력 화면), ?p=dash (R6 대시보드)는 해당 PR이 페이지 함수를 정의했을 때만 동작하고, *소유자 이메일 확인이 통과해야* 한다.
 *  소유자 확인은 fail-closed: RICH300_OWNER_EMAIL 미설정이거나 방문자 이메일을 알 수 없으면(익명·"나로 실행" 배포의 타인) 거부한다.
 */
var RICH300_PAGES_ = { fill: 'rich300PageFill_', dash: 'rich300PageDash_', journal: 'rich300PageJournalTab_', stats: 'rich300PageStats_', assets: 'rich300PageAssets_', signals: 'rich300PageSignals_' };
function rich300UiWho_() {                              // 'owner' | 'other'(이메일은 보이나 소유자 아님) | 'anon'(이메일 불명)
  try {
    var owner = String(PropertiesService.getScriptProperties().getProperty('RICH300_OWNER_EMAIL') || '').trim().toLowerCase();
    var me = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    if (!me) return 'anon';
    return owner.length > 3 && me === owner ? 'owner' : 'other';
  } catch (err) { return 'anon'; }
}
function rich300AppUrl_() { try { var u = ScriptApp.getService().getUrl(); return /^https:\/\/\S+\/exec$/.test(u) ? u : ''; } catch (err) { return ''; } }
function rich300IsOwner_() { return rich300UiWho_() === 'owner'; }
function doGet(e) {
  var name = e && e.parameter && e.parameter.p, fn = name && Object.prototype.hasOwnProperty.call(RICH300_PAGES_, name) ? RICH300_PAGES_[name] : null;
  if (fn && typeof globalThis[fn] === 'function') {
    var who = rich300UiWho_();
    if (typeof rich300LiveCount_ === 'function') rich300LiveCount_('ui-' + (who === 'owner' ? 'owner-ok' : who === 'other' ? 'denied-other' : 'denied-anon'));     // 시험 환경 전용 카운터(값 없음)
    if (who === 'owner') return globalThis[fn](e);
  }
  return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
}

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
