/**
 * RICH 300 — S0 실측용 프로브 (일회용·폐기 예정). 비밀값·Telegram·실제 거래 데이터 없음.
 * 목적: 설계 가정 ①헤더 불가 ②POST 302 ③방문자 이메일 ④배포 2개 설정 ⑤쓰기·락·트리거 지연 을 실측한다.
 * 이 파일의 S0_TEST_KEY는 일회용 시험값이며 비밀이 아니다(운영 키와 무관).
 */
var S0_TEST_KEY = 's0-throwaway-key-not-a-secret';

function props_() { return PropertiesService.getScriptProperties(); }
function logSheet_() {
  var id = props_().getProperty('S0_SHEET'), ss;
  if (id) ss = SpreadsheetApp.openById(id);
  else { ss = SpreadsheetApp.create('RICH300-S0-probe'); props_().setProperty('S0_SHEET', ss.getId()); ss.getSheets()[0].setName('log'); }
  return ss.getSheetByName('log');
}
function log_(kind, data) { var t0 = Date.now(); logSheet_().appendRow([new Date().toISOString(), kind, JSON.stringify(data)]); return Date.now() - t0; }
function hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }
function hmac_(msg) { return hex_(Utilities.computeHmacSha256Signature(msg, S0_TEST_KEY)); }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function eq_(a, b) { if (a.length !== b.length) return false; var r = 0; for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

/** UI 배포(방문자로 실행) 실측: 방문자 이메일이 보이는가(가정 ③), 시간대, 이벤트 키 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'counter') return json_({ counter: Number(props_().getProperty('S0_COUNTER') || 0) });
  if (p.action === 'log') { var sh = logSheet_(), n = Math.min(sh.getLastRow(), 30); return json_({ rows: n ? sh.getRange(sh.getLastRow() - n + 1, 1, n, 3).getValues() : [] }); }
  var active = '', effective = '';
  try { active = Session.getActiveUser().getEmail(); } catch (err) { active = 'ERR:' + err.message; }
  try { effective = Session.getEffectiveUser().getEmail(); } catch (err) { effective = 'ERR:' + err.message; }
  return json_({ kind: 'doGet', activeUserEmail: active, effectiveUserEmail: effective, scriptTimeZone: Session.getScriptTimeZone(), eventKeys: Object.keys(e || {}), params: p, now: new Date().toISOString() });
}

/** API 배포(나로 실행/익명) 실측: 헤더 노출, 본문 서명, 락, 쓰기 지연, 실행 횟수 */
function doPost(e) {
  var t0 = Date.now(), lock = LockService.getScriptLock(), got = lock.tryLock(10000);
  if (!got) return json_({ ok: false, error: 'lock timeout' });
  try {
    var c = Number(props_().getProperty('S0_COUNTER') || 0) + 1; props_().setProperty('S0_COUNTER', String(c));
    var raw = (e.postData && e.postData.contents) || '', msg = {}, sigOk = false, tsOk = false;
    try { msg = JSON.parse(raw); sigOk = eq_(hmac_(msg.v + '.' + msg.ts + '.' + msg.nonce + '.' + JSON.stringify(msg.body)), String(msg.sig || '')); tsOk = Math.abs(Date.now() - Number(msg.ts)) <= 300000; } catch (err) {}
    var appendMs = log_('post', { c: c, sigOk: sigOk, nonce: msg.nonce || null });
    return json_({ ok: true, counter: c, sigOk: sigOk, tsOk: tsOk, eventKeys: Object.keys(e), headerLikeKeys: Object.keys(e).filter(function (k) { return /head/i.test(k); }),
      contentLength: e.contentLength, contentType: e.postData && e.postData.type, queryString: e.queryString || '', paramKeys: Object.keys(e.parameter || {}), appendMs: appendMs, handlerMs: Date.now() - t0 });
  } finally { lock.releaseLock(); }
}

/** 트리거 실측: 1분 트리거(지연·실행시간)와 매일 0시 트리거(0~1시 창 내 실제 실행 시각) */
function s0InstallTriggers() {
  s0RemoveTriggers();
  ScriptApp.newTrigger('s0Tick').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('s0Daily').timeBased().everyDays(1).atHour(0).create();
}
function s0RemoveTriggers() { ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); }); }
function s0Tick(e) { var t0 = Date.now(); var n = Number(props_().getProperty('S0_TICKS') || 0) + 1; props_().setProperty('S0_TICKS', String(n)); log_('tick', { n: n, ev: e || null, kstHour: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'), ms: Date.now() - t0 }); }
function s0Daily(e) { log_('daily', { ev: e || null, kst: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss') }); }
/** 편집기에서 실행해 결과를 확인: 트리거 로그 요약 */
function s0Report() {
  var rows = logSheet_().getDataRange().getValues().filter(function (r) { return r[1] === 'tick' || r[1] === 'daily'; }), out = { ticks: 0, daily: [], maxMs: 0, gapsOver90s: 0 }, prev = null;
  rows.forEach(function (r) { var d = JSON.parse(r[2]), at = new Date(r[0]).getTime(); if (r[1] === 'daily') out.daily.push(d.kst); else { out.ticks++; out.maxMs = Math.max(out.maxMs, d.ms); if (prev && at - prev > 90000) out.gapsOver90s++; prev = at; } });
  Logger.log(JSON.stringify(out)); return out;
}
