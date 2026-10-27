/**
 * RICH 300 — 실전 감시 관리(?p=ops). 소유자 전용. 사전 점검 → 확인 문구 → 활성화(운영 승인 + 감시 on + 5분 트리거 1개) / 중지(감시 off + 트리거 제거).
 *  · 이 화면이 바꿀 수 있는 Script Properties 는 허용 목록(RICH300_OPS_ALLOW_)뿐이고, 값도 정해진 것만 쓴다. 이름·값을 클라이언트가 정할 수 없다(서버 함수는 인자로 문구만 받는다).
 *  · 활성화는 서버가 다시 검증한다: 소유자 · 확인 문구 · 사전 점검 통과 기록(15분·같은 빌드) · Telegram 준비. 화면의 버튼 상태는 편의일 뿐이다.
 *  · 순서: 운영 승인 → 트리거 설치(정확히 1개) → 감시 on(마지막). 실제 속성·트리거를 다시 조회해 확인하고, 어느 단계든 실패하면 감시 off·트리거 제거·운영 승인 복원으로 되돌려 부분 활성화를 남기지 않는다.
 *  · 스크립트 락으로 중복 클릭·동시 실행을 막는다. 중지는 락을 못 잡아도(최대 10초) 진행한다 — 멈추는 동작은 항상 가능해야 한다.
 *  · 이 파일은 Telegram 을 보내지 않는다. 자동 주문 없음. 로그·반환값에 토큰·채팅 ID·가격은 없다(개수·코드만).
 */
var RICH300_OPS_PROD_ = 'RICH300_PROD_APPROVED', RICH300_OPS_WATCH_ = 'RICH300_WATCH_ALERTS', RICH300_OPS_PRE_ = 'ops:precheck', RICH300_OPS_LAST_ = 'ops:last';
var RICH300_OPS_ALLOW_ = { 'RICH300_PROD_APPROVED': ['yes'], 'RICH300_WATCH_ALERTS': ['on', 'off'], 'RICH300_STRATEGY': ['on', 'off'], 'RICH300_FEED_KEY': 'secret', 'ops:precheck': 'json', 'ops:sprecheck': 'json', 'ops:last': 'json' };
function rich300OpsSet_(name, value) {
  if (!Object.prototype.hasOwnProperty.call(RICH300_OPS_ALLOW_, name)) throw new Error('ops-not-allowed');
  var rule = RICH300_OPS_ALLOW_[name];
  if (rule === 'secret') { if (!/^[A-Za-z0-9_-]{32,128}$/.test(String(value))) throw new Error('ops-bad-value'); }       // 비밀값은 전용 함수(rich300OpsSetFeedKey)만 쓴다
  else if (rule !== 'json' && rule.indexOf(value) < 0) throw new Error('ops-bad-value');
  PropertiesService.getScriptProperties().setProperty(name, String(value));
}
function rich300OpsDel_(name) {
  if (!Object.prototype.hasOwnProperty.call(RICH300_OPS_ALLOW_, name)) throw new Error('ops-not-allowed');
  PropertiesService.getScriptProperties().deleteProperty(name);
}
function rich300OpsWatchTriggers_() { return ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'rich300WatchTick'; }); }
function rich300OpsLog_(action, code) { try { rich300OpsSet_(RICH300_OPS_LAST_, JSON.stringify({ at: Date.now(), action: action, code: code })); } catch (err) { /* 기록 실패는 무시 */ } }
function rich300OpsJson_(key) { try { var r = PropertiesService.getScriptProperties().getProperty(key); return r ? JSON.parse(r) : null; } catch (err) { return null; } }
function rich300OpsStratLast_() { var l = rich300StrategyLast_(); return l ? { ageMin: Math.round((Date.now() - l.at) / 60000), status: l.status, created: l.created, tracked: l.tracked, sent: l.sent, failed: l.failed, feed: l.feed ? { ok: l.feed.ok, code: l.feed.code || null } : null } : null; }
function rich300OpsAge_(pre) { return pre ? { ageMin: Math.round((Date.now() - pre.at) / 60000), ok: !!pre.ok && pre.build === RICH300_BUILD } : null; }
/** 읽기 전용 상태(시세·텔레그램 호출 없음, 시트는 포지션 개수 확인용으로만 읽는다). */
function rich300OpsState_() {
  var w = rich300WatchState_(), t = rich300TgDiagState_(), props = PropertiesService.getScriptProperties(), n = null, pre = rich300OpsJson_(RICH300_OPS_PRE_), ol = rich300OpsJson_(RICH300_OPS_LAST_);
  try { n = RICH300_ENGINE.watchOpenPositions(rich300WatchEnv_('preview').storeEnv(), { now: Date.now() }).positions.length; } catch (err) { n = null; }
  return { env: t.env, tokenSet: t.tokenSet, paired: t.paired, prodApproved: t.prodApproved, gateSend: t.gateSend, prop: w.prop, mode: w.mode, effective: w.effective, triggers: w.triggers, last: w.last ? { ageMin: Math.round((Date.now() - w.last.at) / 60000), status: w.last.status, mode: w.last.mode, positions: w.last.positions, events: w.last.events, sent: w.last.sent, failed: w.last.failed, marketFail: w.last.marketFail, code: w.last.code || null } : null,
    strategy: { prop: rich300StrategyMode_(), keySet: !!props.getProperty('RICH300_FEED_KEY'), last: rich300OpsStratLast_(), precheck: rich300OpsAge_(rich300OpsJson_('ops:sprecheck')) }, positions: n, precheck: pre ? { ageMin: Math.round((Date.now() - pre.at) / 60000), ok: !!pre.ok && pre.build === RICH300_BUILD } : null, opsLast: ol ? { ageMin: Math.round((Date.now() - ol.at) / 60000), action: ol.action, code: ol.code } : null };
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
  var ok = want === 'on' ? prod === 'yes' && watch === 'on' && n === 1 && rich300WatchState_().effective === 'sends' : watch === 'off' && (rich300StrategyMode_() !== 'off' ? n <= 1 : n === 0);
  return { ok: ok, triggers: n, prod: prod === 'yes', watch: watch };
}
function rich300OpsRollback_(before) {
  try { rich300OpsSet_(RICH300_OPS_WATCH_, 'off'); } catch (err) { /* 아래 확인에서 잡는다 */ }
  try { if (rich300StrategyMode_() === 'off') rich300WatchRemoveTrigger(); } catch (err2) { /* 확인에서 잡는다 */ }
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
    try { if (rich300StrategyMode_() === 'off') rich300WatchRemoveTrigger(); } catch (err2) { /* 확인에서 잡는다 */ }      // 추천 전략 추적이 켜져 있으면 같은 5분 트리거를 남긴다
    var v = rich300OpsVerify_('off'); rich300OpsLog_('disable', v.ok ? 'ok' : 'verify-failed');
    return { ok: v.ok, code: v.ok ? 'disabled' : 'verify-failed', triggers: v.triggers, lockless: !held };
  } finally { if (held) lock.releaseLock(); }
}

/** ── 추천 전략 자동 추적 관리(?p=ops 3개 구역) ───────────────────────────────────────────────── */
/** 서명 키 등록(한 번만 · 소유자 전용): 값은 화면·로그·반환값에 되돌려 주지 않는다. radar 쪽 GitHub Secret RICH300_FEED_KEY 와 같은 값이어야 한다. */
function rich300OpsSetFeedKey(key) {
  if (!rich300IsOwner_()) return { ok: false, code: 'forbidden' };
  var lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) return { ok: false, code: 'busy' };
  try {
    if (PropertiesService.getScriptProperties().getProperty('RICH300_FEED_KEY')) return { ok: false, code: 'already-set' };
    var k = String(key === null || key === undefined ? '' : key).replace(/\s/g, '');
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(k)) return { ok: false, code: 'bad-format' };
    rich300OpsSet_('RICH300_FEED_KEY', k);
    rich300OpsLog_('feed-key', 'ok'); return { ok: true, code: 'saved' };
  } catch (err) { return { ok: false, code: 'exception' }; }
  finally { lock.releaseLock(); }
}
/** 전략 추적 사전 점검(읽기 전용): Telegram 준비 + 피드 가져오기·서명 검증 + 시세 + 미리보기. 메시지·저장·트리거·설정 변경 없음. */
function rich300OpsStratPrecheck() {
  if (!rich300IsOwner_()) return { ok: false, code: 'forbidden' };
  var lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) return { ok: false, code: 'busy' };
  try {
    var st = rich300OpsState_(), net = rich300WatchNetCheck_(), pv = rich300StrategyRun_('preview');
    var ev = RICH300_ENGINE.opsEvaluateStrategy({ state: st, net: net, preview: { status: pv.status, feed: pv.feed || null, marketFail: pv.marketFail || 0, code: pv.code || null, keySet: st.strategy.keySet } });
    rich300OpsSet_('ops:sprecheck', JSON.stringify({ at: Date.now(), build: RICH300_BUILD, ok: ev.ok }));
    return { ok: true, pass: ev.ok, items: ev.items };
  } catch (err) { return { ok: false, code: 'exception' }; }
  finally { lock.releaseLock(); }
}
function rich300OpsStratVerify_(want) {
  var props = PropertiesService.getScriptProperties(), n = rich300OpsWatchTriggers_().length, prod = props.getProperty(RICH300_OPS_PROD_), sm = props.getProperty('RICH300_STRATEGY');
  var ok = want === 'on' ? prod === 'yes' && sm === 'on' && n === 1 && rich300WatchCanSend_() : sm === 'off' && (rich300WatchMode_() !== 'off' ? n <= 1 : n === 0);
  return { ok: ok, triggers: n, strategy: sm };
}
function rich300OpsStratEnable(phrase) {
  if (!rich300IsOwner_()) return { ok: false, code: 'forbidden' };
  if (String(phrase === null || phrase === undefined ? '' : phrase).trim() !== RICH300_ENGINE.OPS_STRAT_PHRASE) return { ok: false, code: 'phrase' };
  var lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) return { ok: false, code: 'busy' };
  var props = PropertiesService.getScriptProperties(), before = { prod: props.getProperty(RICH300_OPS_PROD_), strat: props.getProperty('RICH300_STRATEGY'), triggers: rich300OpsWatchTriggers_().length }, changed = false;
  try {
    var cur = rich300OpsStratVerify_('on'); if (cur.ok) return { ok: true, code: 'already-on', triggers: cur.triggers };
    var pre = rich300OpsJson_('ops:sprecheck');
    if (!pre || !pre.ok || pre.build !== RICH300_BUILD || Date.now() - pre.at > RICH300_ENGINE.OPS_PRECHECK_TTL_MS || pre.at > Date.now() + 60000) return { ok: false, code: 'precheck-required' };
    var t = rich300TgDiagState_();
    if (!t.tokenSet || !t.paired || t.env !== 'prod' || (t.gateSend && t.gateSend !== 'prod-not-approved')) return { ok: false, code: 'tg-not-ready' };
    changed = true;
    rich300OpsSet_(RICH300_OPS_PROD_, 'yes');
    if (before.triggers !== 1) rich300WatchInstallTrigger();           // 5분 트리거가 이미 정확히 1개면 그대로 둔다(위치 감시와 공유)
    rich300OpsSet_('RICH300_STRATEGY', 'on');                           // 마지막
    var v = rich300OpsStratVerify_('on'); if (!v.ok) throw new Error('verify-failed');
    rich300OpsDel_('ops:sprecheck'); rich300OpsLog_('strategy-enable', 'ok');
    return { ok: true, code: 'enabled', triggers: v.triggers };
  } catch (err) {
    var code = String(err && err.message || 'exception').indexOf('verify-failed') === 0 ? 'verify-failed' : 'exception', rolled = true;
    if (changed) {
      try { rich300OpsSet_('RICH300_STRATEGY', 'off'); } catch (e1) { rolled = false; }
      try { if (before.triggers === 0 && rich300WatchMode_() === 'off') rich300WatchRemoveTrigger(); else if (before.triggers !== 1) { rich300WatchRemoveTrigger(); if (rich300WatchMode_() !== 'off') rich300WatchInstallTrigger(); } } catch (e2) { rolled = false; }
      try { if (before.prod === null || before.prod === undefined) rich300OpsDel_(RICH300_OPS_PROD_); else if (before.prod === 'yes') rich300OpsSet_(RICH300_OPS_PROD_, 'yes'); } catch (e3) { rolled = false; }
      var chk = rich300OpsStratVerify_('off'), pn = props.getProperty(RICH300_OPS_PROD_);
      rolled = rolled && chk.ok && (before.prod === null || before.prod === undefined ? pn === null : pn === before.prod) && rich300OpsWatchTriggers_().length === (before.triggers === 0 ? 0 : 1);
    }
    rich300OpsLog_('strategy-enable', rolled ? code + '/rolled-back' : code + '/rollback-failed');
    return { ok: false, code: rolled ? code : 'rollback-failed', rolledBack: rolled };
  } finally { lock.releaseLock(); }
}
function rich300OpsStratDisable() {
  if (!rich300IsOwner_()) return { ok: false, code: 'forbidden' };
  var lock = LockService.getScriptLock(), held = lock.tryLock(10000);
  try {
    try { rich300OpsSet_('RICH300_STRATEGY', 'off'); } catch (err) { /* 확인에서 잡는다 */ }
    try { if (rich300WatchMode_() === 'off') rich300WatchRemoveTrigger(); } catch (err2) { /* 확인에서 잡는다 */ }      // 실전 위치 감시가 켜져 있으면 같은 트리거를 남긴다
    var v = rich300OpsStratVerify_('off'); rich300OpsLog_('strategy-disable', v.ok ? 'ok' : 'verify-failed');
    return { ok: v.ok, code: v.ok ? 'disabled' : 'verify-failed', triggers: v.triggers, lockless: !held };
  } finally { if (held) lock.releaseLock(); }
}
