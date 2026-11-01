/**
 * RICH 300 — API 배포 진입점(R5, "나로 실행 / 누구나" 배포 전용). 엔진 번들(Engine) + Adapters.gs 와 같은 프로젝트에 둔다. 운영 배포는 S0 실측·승인 이후.
 *  · 인증: 본문 HMAC(rich300/lib/auth.mjs). 키는 Script Properties(RICH300_INGEST_KEY, 선택 RICH300_INGEST_KEY_PREV)에서만 읽는다. 코드·로그·응답에 키를 쓰지 않는다.
 *  · 스프레드시트 ID(RICH300_SHEET_ID)도 Script Properties. 시트는 인증이 통과한 뒤에만 연다.
 *  · nonce: CacheService(최선 노력, 만료·퇴출될 수 있음 — 재전송 신호는 sid 유일키로 어차피 중복 기록되지 않는다).
 *  · 이 파일은 로그를 출력하지 않는다(Logger/console 없음). GET 요청에는 접근 안내만.
 */
/**
 * GET 라우터: 소유자가 아니면 *접근 안내만*(데이터 없음. 예전의 빈 응답은 모바일에서 '계속 로딩'처럼 보였다 — 익명 GET에 정보를 주지 않는 원칙은 유지).
 *  ?p=fill (R4 모바일 입력 화면), ?p=dash (R6 대시보드)는 해당 PR이 페이지 함수를 정의했을 때만 동작하고, *소유자 이메일 확인이 통과해야* 한다.
 *  소유자 확인은 fail-closed: RICH300_OWNER_EMAIL 미설정이거나 방문자 이메일을 알 수 없으면(익명·"나로 실행" 배포의 타인) 거부한다.
 */
var RICH300_BUILD = '__RICH300_BUILD__';                 // 번들 생성 때 내용 해시로 바뀐다(?p=health 에 표시 — 배포된 버전이 올린 버전인지 확인)
var RICH300_PAGES_ = { fill: 'rich300PageFill_', dash: 'rich300PageDash_', journal: 'rich300PageJournalTab_', stats: 'rich300PageStats_', assets: 'rich300PageAssets_', signals: 'rich300PageSignals_', check: 'rich300PageCheck_', health: 'rich300PageHealth_', watch: 'rich300PageWatch_', tg: 'rich300PageTg_', pos: 'rich300PagePos_', ops: 'rich300PageOps_', strat: 'rich300PageStrat_' };
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
function rich300Ping_() {                              // 배포·본인 인증 진단: 값 없이 상태 단어만(이메일·ID 없음). 접근 제한(나만)이 걸려 있으면 소유자만 여기에 닿는다.
  var owner = String(PropertiesService.getScriptProperties().getProperty('RICH300_OWNER_EMAIL') || '').trim(), who = rich300UiWho_();
  var lines = ['RICH300 ping', 'reachable: yes', 'visitor-email: ' + (who === 'anon' ? 'hidden' : 'visible'), 'owner-setting: ' + (owner.length > 3 ? 'set' : 'unset'), 'owner-match: ' + (who === 'owner' ? 'yes' : who === 'other' ? 'no' : 'unknown'), 'verdict: ' + (who === 'owner' ? 'OK(소유자 확인됨)' : who === 'other' ? 'DENY(다른 계정)' : 'BLOCKED(이메일을 읽지 못함: 실행 계정·배포 설정 확인)')];
  return ContentService.createTextOutput(lines.join('\n')).setMimeType(ContentService.MimeType.TEXT);
}
function rich300Html_(html, title) { return HtmlService.createHtmlOutput(html).setTitle(title).addMetaTag('viewport', 'width=device-width, initial-scale=1'); }
/**
 * 무한 로딩·빈 화면 방지: 어떤 경우에도 *화면*을 돌려준다.
 *  · 소유자가 아니거나 이메일을 알 수 없으면 빈 응답 대신 접근 안내(데이터 없음). 소유자가 p 없이/모르는 p 로 열면 메인(dash).
 *  · 페이지 함수가 예외를 던지면 오류 코드와 '다시 시도' 버튼이 있는 화면. 처리 시간은 최근 기록(?p=health)에 남긴다.
 */
function doGet(e) {
  var t0 = Date.now(), name = e && e.parameter && e.parameter.p, page = 'strat', out;
  if (name === 'ping') return rich300Ping_();
  try {
    if (rich300UiWho_() !== 'owner') return rich300Html_(RICH300_ENGINE.shellRenderDenied({ appUrl: rich300AppUrl_() }), '접근 제한');
    page = name && Object.prototype.hasOwnProperty.call(RICH300_PAGES_, name) ? name : 'strat';
    var fn = globalThis[RICH300_PAGES_[page]];
    if (typeof fn !== 'function') throw new Error('page-missing');
    out = fn(e);
  } catch (err) {
    out = rich300Html_(RICH300_ENGINE.shellRenderError({ title: '화면', code: RICH300_ENGINE.shellErrorCode(err), appUrl: rich300AppUrl_(), page: page }), 'RICH300');
  }
  if (typeof rich300PerfRecord_ === 'function') rich300PerfRecord_(page, Date.now() - t0);
  return out;
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
    hmacSha256: function (key, message) { return rich300Hex_(Utilities.computeHmacSha256Signature(message, key, Utilities.Charset.UTF_8)); },
    getKeys: function () { return [props.getProperty('RICH300_INGEST_KEY'), props.getProperty('RICH300_INGEST_KEY_PREV')].filter(function (k) { return k; }); },
    nonces: { has: function (n) { return cache.get('n:' + n) !== null; }, put: function (n, ttlSec) { cache.put('n:' + n, '1', ttlSec); } },
    counter: function (name) { var k = 'c:' + name, v = Number(cache.get(k) || 0) + 1; cache.put(k, String(v), 21600); },
    storeEnv: function () { if (!store) { store = rich300GasEnv_(props.getProperty('RICH300_SHEET_ID')); RICH300_ENGINE.storeInit(store); } return store; }
  };
}
