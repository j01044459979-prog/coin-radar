/**
 * RICH 300 — 일지·일 마감(R7). 엔진 번들 + Adapters.gs + Api.gs(라우터) + Telegram.gs 와 같은 프로젝트에 둔다. 운영 배포·실제 알림은 승인 이후.
 *  · ?p=journal 은 라우터가 소유자 이메일 확인(fail-closed)을 통과시킨 경우에만 이 파일의 페이지 함수를 호출한다.
 *  · google.script.run 으로 호출되는 함수(rich300EquitySubmit 등)는 *각각* 소유자 확인을 다시 한다(클라이언트 호출은 라우터를 거치지 않음).
 *  · 일 마감 트리거: 매일 00:00(KST, 프로젝트 시간대) + 매시간 재확인. 같은 날짜는 한 번만 마감되므로 중복 실행은 안전하다(락·유일키).
 *  · 마감 알림(평가액 미입력)은 기본 OFF: 설정 closeNotify=on 이고 Script Property RICH300_CLOSE_SEND_APPROVED=yes 일 때만 실제로 보낸다.
 *  · 로그에는 개수·코드만 남긴다(금액·ID·본문·토큰 없음).
 */
function rich300JournalEnv_() {
  var props = PropertiesService.getScriptProperties(), store = null, tg = null;
  function tgEnv() { if (!tg) tg = rich300TgEnv_(); return tg; }
  return {
    now: function () { return Date.now(); },
    uiUrl: props.getProperty('RICH300_UI_URL') || undefined,
    storeEnv: function () { if (!store) { store = rich300GasEnv_(props.getProperty('RICH300_SHEET_ID')); RICH300_ENGINE.storeInit(store); } return store; },
    sendEnabled: function () { return props.getProperty('RICH300_CLOSE_SEND_APPROVED') === 'yes'; },
    notify: function (msg) {
      var e = tgEnv(), p = RICH300_ENGINE.tgPairedUser(e);
      if (!p) return { ok: false, code: 'not-paired' };
      return RICH300_ENGINE.tgSendNotice(e, p.chatId, msg.text, msg.url);
    }
  };
}
function rich300UiError_(err) {
  var C = RICH300_ENGINE.StoreError;
  if (err instanceof C) {
    if (err.code === 'LOCK') return { ok: false, error: 'busy', retry: true };
    if (err.code === 'VALIDATION' || err.code === 'NOT_FOUND') return { ok: false, error: 'invalid', message: String(err.message).slice(0, 160) };
  }
  return { ok: false, error: 'server' };
}
function rich300Guarded_(fn) {
  if (!rich300IsOwner_()) return { ok: false, error: 'forbidden' };
  try { return fn(rich300JournalEnv_()); } catch (err) { return rich300UiError_(err); }
}

/** 페이지(?p=journal): 서버에서 완성된 HTML. 오류는 일반 화면만(내부 정보 없음). */
function rich300PageJournal_(e, tab) {
  var html, appUrl = rich300AppUrl_();
  try {
    var env = rich300JournalEnv_(), prm = (e && e.parameter) || {}, day = /^\d{4}-\d{2}-\d{2}$/.test(String(prm.day || '')) ? String(prm.day) : null, q = prm.q ? String(prm.q).slice(0, 20) : null;
    var model = RICH300_ENGINE.journalBuild(env, { now: Date.now(), day: tab === 'journal' || !tab ? day : null, q: tab === 'journal' || !tab ? q : null });
    if (day && tab !== 'journal' && tab) model.presetDay = day;
    html = RICH300_ENGINE.journalRenderHtml(model, { appUrl: appUrl, tab: tab || 'all', query: { day: day, q: q } });
  } catch (err) { html = RICH300_ENGINE.journalRenderError(); }
  return HtmlService.createHtmlOutput(html).setTitle('RICH300 일지').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function rich300PageJournalTab_(e) { return rich300PageJournal_(e, 'journal'); }
function rich300PageStats_(e) { return rich300PageJournal_(e, 'stats'); }
function rich300PageAssets_(e) { return rich300PageJournal_(e, 'assets'); }
function rich300PageSignals_(e) {
  var html, appUrl = rich300AppUrl_();
  try {
    var env = rich300JournalEnv_(), r = e && e.parameter && e.parameter.r;
    html = RICH300_ENGINE.siglogRenderHtml(RICH300_ENGINE.siglogBuild(env, { now: Date.now(), filter: r }), { appUrl: appUrl });
  } catch (err) { html = RICH300_ENGINE.siglogRenderError(appUrl); }
  return HtmlService.createHtmlOutput(html).setTitle('RICH300 추천 기록').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** google.script.run 대상(소유자 전용) */
function rich300EquitySubmit(form) {
  return rich300Guarded_(function (env) {
    var f = form || {}, r = RICH300_ENGINE.closeSubmitEquity(env, { day: String(f.day || ''), equity: String(f.equity || ''), unrealized: f.unrealized ? String(f.unrealized) : undefined, reason: f.reason ? String(f.reason) : undefined }, { actor: 'ui:journal' });
    var detail = r.diffLabel === null ? '' : '장부 기준 ' + r.expectedLabel + ' · 차이 ' + (r.diffMicro && Number(r.diffMicro) > 0 ? '+' : '') + r.diffLabel + (r.needsReview ? ' (확인 필요)' : '');
    return { ok: true, status: r.status, message: r.status === 'unchanged' ? '이미 같은 값이 저장돼 있습니다' : '저장됨', detail: detail, flags: r.flags };
  });
}
function rich300JournalReviseFill(fillId, patch, reason) {
  return rich300Guarded_(function (env) { var r = RICH300_ENGINE.journalReviseFill(env, String(fillId || ''), patch, { actor: 'ui:journal', reason: String(reason || '') }); return { ok: true, status: r.status, message: r.status === 'unchanged' ? '바뀐 값이 없습니다' : '수정 저장됨(새로고침하면 이력이 보입니다)' }; });
}
function rich300JournalVoidFill(fillId, reason) {
  return rich300Guarded_(function (env) { var r = RICH300_ENGINE.journalVoidFill(env, String(fillId || ''), { actor: 'ui:journal', reason: String(reason || '') }); return { ok: true, status: r.status, message: '체결을 취소했습니다(이력은 남습니다)' }; });
}
function rich300CashflowSubmit(form) {
  return rich300Guarded_(function (env) { var f = form || {}, r = RICH300_ENGINE.journalAddCashflow(env, { cfId: String(f.formId || ''), amount: String(f.amount || ''), note: f.note ? String(f.note) : undefined }, { actor: 'ui:journal' }); return { ok: true, status: r.status, message: r.status === 'duplicate' ? '이미 저장됨' : '저장됨' }; });
}
function rich300CashflowVoid(cfId, reason) {
  return rich300Guarded_(function (env) { var r = RICH300_ENGINE.journalVoidCashflow(env, String(cfId || ''), { actor: 'ui:journal', reason: String(reason || '') }); return { ok: true, status: r.status, message: '입출금을 취소했습니다' }; });
}

/** 시간 트리거 진입점: 일 마감 + 실패 알림 재시도. 결과는 개수만 속성에 남긴다. */
function rich300CloseTick() {
  var out;
  try { out = RICH300_ENGINE.closeTick(rich300JournalEnv_(), { now: Date.now() }); } catch (err) { out = { status: 'exception', code: String(err && err.code || 'error') }; }
  PropertiesService.getScriptProperties().setProperty('close:last', JSON.stringify({ at: Date.now(), status: out.status, closed: (out.closed || []).length, skipped: (out.skipped || []).length, notices: out.notices || null, retry: out.retry || null, code: out.code || null }));
  return out;
}
function rich300InstallCloseTriggers() {
  rich300RemoveCloseTriggers();
  ScriptApp.newTrigger('rich300CloseTick').timeBased().atHour(0).everyDays(1).create();    // 프로젝트 시간대(Asia/Seoul) 00:00~01:00 사이 실행(Apps Script 특성)
  ScriptApp.newTrigger('rich300CloseTick').timeBased().everyHours(1).create();             // 놓친 날·실패 알림 재확인
}
function rich300RemoveCloseTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'rich300CloseTick') ScriptApp.deleteTrigger(t); });
}
