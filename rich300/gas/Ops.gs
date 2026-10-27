/**
 * RICH 300 — 실전 감시 관리(?p=ops). 소유자 전용. 사전 점검 → 확인 문구 → 활성화(운영 승인 + 감시 on + 5분 트리거 1개) / 중지(감시 off + 트리거 제거).
 *  · 이 화면이 바꿀 수 있는 Script Properties 는 허용 목록(RICH300_OPS_ALLOW_)뿐이고, 값도 정해진 것만 쓴다. 이름·값을 클라이언트가 정할 수 없다(서버 함수는 인자로 문구만 받는다).
 *  · 활성화는 서버가 다시 검증한다: 소유자 · 확인 문구 · 사전 점검 통과 기록(15분·같은 빌드) · Telegram 준비. 화면의 버튼 상태는 편의일 뿐이다.
 *  · 순서: 운영 승인 → 트리거 설치(정확히 1개) → 감시 on(마지막). 실제 속성·트리거를 다시 조회해 확인하고, 어느 단계든 실패하면 감시 off·트리거 제거·운영 승인 복원으로 되돌려 부분 활성화를 남기지 않는다.
 *  · 스크립트 락으로 중복 클릭·동시 실행을 막는다. 중지는 락을 못 잡아도(최대 10초) 진행한다 — 멈추는 동작은 항상 가능해야 한다.
 *  · 이 파일은 Telegram 을 보내지 않는다. 자동 주문 없음. 로그·반환값에 토큰·채팅 ID·가격은 없다(개수·코드만).
 */
var RICH300_OPS_PROD_ = 'RICH300_PROD_APPROVED', RICH300_OPS_WATCH_ = 'RICH300_WATCH_ALERTS', RICH300_OPS_PRE_ = 'ops:precheck', RICH300_OPS_LAST_ = 'ops:last';
var RICH300_OPS_ALLOW_ = { 'RICH300_PROD_APPROVED': ['yes'], 'RICH300_WATCH_ALERTS': ['on', 'off'], 'ops:precheck': 'json', 'ops:last': 'json' };
function rich300OpsSet_(name, value) {
  if (!Object.prototype.hasOwnProperty.call(RICH300_OPS_ALLOW_, name)) throw new Error('ops-not-allowed');
  var rule = RICH300_OPS_ALLOW_[name];
  if (rule !== 'json' && rule.indexOf(value) < 0) throw new Error('ops-bad-value');
  PropertiesService.getScriptProperties().setProperty(name, String(value));
}
function rich300OpsDel_(name) {
  if (!Object.prototype.hasOwnProperty.call(RICH300_OPS_ALLOW_, name)) throw new Error('ops-not-allowed');
  PropertiesService.getScriptProperties().deleteProperty(name);
}
function rich300OpsWatchTriggers_() { return ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'rich300WatchTick'; }); }
function rich300OpsLog_(action, code) { try { rich300OpsSet_(RICH300_OPS_LAST_, JSON.stringify({ at: Date.now(), action: action, code: code })); } catch (err) { /* 기록 실패는 무시 */ } }
function rich300OpsJson_(key) { try { var r = PropertiesService.getScriptProperties().getProperty(key); return r ? JSON.parse(r) : null; } catch (err) { return null; } }
/** 읽기 전용 상태(시세·텔레그램 호출 없음, 시트는 포지션 개수 확인용으로만 읽는다). */
function rich300OpsState_() {
  var w = rich300WatchState_(), t = rich300TgDiagState_(), props = PropertiesService.getScriptProperties(), n = null, pre = rich300OpsJson_(RICH300_OPS_PRE_), ol = rich300OpsJson_(RICH300_OPS_LAST_);
  try { n = RICH300_ENGINE.watchOpenPositions(rich300WatchEnv_('preview').storeEnv(), { now: Date.now() }).positions.length; } catch (err) { n = null; }
  return { env: t.env, tokenSet: t.tokenSet, paired: t.paired, prodApproved: t.prodApproved, gateSend: t.gateSend, prop: w.prop, mode: w.mode, effective: w.effective, triggers: w.triggers, last: w.last ? { ageMin: Math.round((Date.now() - w.last.at) / 60000), status: w.last.status, mode: w.last.mode, positions: w.last.positions, events: w.last.events, sent: w.last.sent, failed: w.last.failed, marketFail: w.last.marketFail, code: w.last.code || null } : null,
    positions: n, precheck: pre ? { ageMin: Math.round((Date.now() - pre.at) / 60000), ok: !!pre.ok && pre.build === RICH300_BUILD } : null, opsLast: ol ? { ageMin: Math.round((Date.now() - ol.at) / 60000), action: ol.action, code: ol.code } : null };
}
/** 페이지(?p=ops): 열기만 해서는 아무것도 바꾸지 않는다. */
function rich300PageOps_(e) {
  var html, appUrl = rich300AppUrl_();
  try { html = RICH300_ENGINE.opsRenderHtml({ m: rich300OpsState_(), appUrl: appUrl, build: RICH300_BUILD }); }
  catch (err) { html = RICH300_ENGINE.shellRenderError({ title: '실전 감시 관리', code: RICH300_ENGINE.shellErrorCode(err), appUrl: appUrl, page: 'ops' }); }
  return rich300Html_(html, 'RICH300 실전 감시 관리');
}
/** 사전 점검(읽기 전용): Telegram 준비 + 시세 연결 + 감시 미리보기. 통과 기록(15분)만 남긴다. 메시지·트리거·감시 설정 변경 없음. */
function rich300OpsPrecheck() {
  if (!rich300IsOwner_()) return { ok: false, code: 'forbidden' };
  var lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) return { ok: false, code: 'busy' };
  try {
    var st = rich300OpsState_(), net = rich300WatchNetCheck_(), pv = rich300WatchRun_('preview');
    var ev = RICH300_ENGINE.opsEvaluate({ state: st, net: net, preview: { status: pv.status, positions: pv.positions || 0, marketFail: pv.marketFail || 0, skipped: pv.skipped || 0, code: pv.code || null } });
    rich300OpsSet_(RICH300_OPS_PRE_, JSON.stringify({ at: Date.now(), build: RICH300_BUILD, ok: ev.ok }));
    return { ok: true, pass: ev.ok, items: ev.items };
  } catch (err) { return { ok: false, code: 'exception' }; }
  finally { lock.releaseLock(); }
}
/** 실제 속성·트리거를 다시 조회한 결과. want: 'on' | 'off' */
function rich300OpsVerify_(want) {
  var props = PropertiesService.getScriptProperties(), n = rich300OpsWatchTriggers_().length, prod = props.getProperty(RICH300_OPS_PROD_), watch = props.getProperty(RICH300_OPS_WATCH_);
  var ok = want === 'on' ? prod === 'yes' && watch === 'on' && n === 1 && rich300WatchState_().effective === 'sends' : watch === 'off' && n === 0;
  return { ok: ok, triggers: n, prod: prod === 'yes', watch: watch };
}
function rich300OpsRollback_(before) {
  try { rich300OpsSet_(RICH300_OPS_WATCH_, 'off'); } catch (err) { /* 아래 확인에서 잡는다 */ }
  try { rich300WatchRemoveTrigger(); } catch (err2) { /* 확인에서 잡는다 */ }
  try { if (before.prod === null || before.prod === undefined) rich300OpsDel_(RICH300_OPS_PROD_); else if (before.prod === 'yes') rich300OpsSet_(RICH300_OPS_PROD_, 'yes'); } catch (err3) { /* 확인에서 잡는다 */ }
  var v = rich300OpsVerify_('off'), props = PropertiesService.getScriptProperties(), prodNow = props.getProperty(RICH300_OPS_PROD_), prodOk = before.prod === null || before.prod === undefined ? prodNow === null : prodNow === before.prod;
  return v.ok && prodOk;
}
function rich300OpsEnable(phrase) {
  if (!rich300IsOwner_()) return { ok: false, code: 'forbidden' };
  if (String(phrase === null || phrase === undefined ? '' : phrase).trim() !== RICH300_ENGINE.OPS_PHRASE) return { ok: false, code: 'phrase' };
  var lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) return { ok: false, code: 'busy' };
  var props = PropertiesService.getScriptProperties(), before = { prod: props.getProperty(RICH300_OPS_PROD_), watch: props.getProperty(RICH300_OPS_WATCH_) }, changed = false;
  try {
    var cur = rich300OpsVerify_('on');
    if (cur.ok) return { ok: true, code: 'already-on', triggers: cur.triggers };           // 이미 켜져 있으면 아무것도 바꾸지 않는다(멱등)
    var pre = rich300OpsJson_(RICH300_OPS_PRE_);
    if (!pre || !pre.ok || pre.build !== RICH300_BUILD || Date.now() - pre.at > RICH300_ENGINE.OPS_PRECHECK_TTL_MS || pre.at > Date.now() + 60000) return { ok: false, code: 'precheck-required' };
    var t = rich300TgDiagState_();
    if (!t.tokenSet || !t.paired || t.env !== 'prod' || (t.gateSend && t.gateSend !== 'prod-not-approved')) return { ok: false, code: 'tg-not-ready' };
    changed = true;
    rich300OpsSet_(RICH300_OPS_PROD_, 'yes');
    rich300WatchInstallTrigger();                                // 같은 이름의 트리거를 지우고 5분 트리거 1개만 설치
    rich300OpsSet_(RICH300_OPS_WATCH_, 'on');                    // 마지막: 이 시점부터 전송 가능
    var v = rich300OpsVerify_('on'); if (!v.ok) throw new Error('verify-failed');
    rich300OpsDel_(RICH300_OPS_PRE_);                            // 점검 통과 기록은 한 번만 쓴다
    rich300OpsLog_('enable', 'ok');
    return { ok: true, code: 'enabled', triggers: v.triggers };
  } catch (err) {
    var code = String(err && err.message || 'exception').indexOf('verify-failed') === 0 ? 'verify-failed' : 'exception', rolled = changed ? rich300OpsRollback_(before) : true;
    rich300OpsLog_('enable', rolled ? code + '/rolled-back' : code + '/rollback-failed');
    return { ok: false, code: rolled ? code : 'rollback-failed', rolledBack: rolled };
  } finally { lock.releaseLock(); }
}
function rich300OpsDisable() {
  if (!rich300IsOwner_()) return { ok: false, code: 'forbidden' };
  var lock = LockService.getScriptLock(), held = lock.tryLock(10000);          // 못 잡아도 중지는 진행한다(멱등)
  try {
    try { rich300OpsSet_(RICH300_OPS_WATCH_, 'off'); } catch (err) { /* 아래 확인에서 잡는다 */ }
    try { rich300WatchRemoveTrigger(); } catch (err2) { /* 확인에서 잡는다 */ }
    var v = rich300OpsVerify_('off'); rich300OpsLog_('disable', v.ok ? 'ok' : 'verify-failed');
    return { ok: v.ok, code: v.ok ? 'disabled' : 'verify-failed', triggers: v.triggers, lockless: !held };
  } finally { if (held) lock.releaseLock(); }
}
