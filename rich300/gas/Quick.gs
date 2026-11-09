/**
 * RICH300 간편 마감 화면: 기존 Equity 감사 로그를 그대로 사용한다.
 * GET 첫 화면은 Sheets를 열지 않음(소유자 확인은 Api.gs에서 선행).
 * 실제 수치 로딩은 소유자 전용 google.script.run 1회로 처리.
 */
function rich300PageQuick_() {
  return HtmlService.createHtmlOutputFromFile('Quick').setTitle('RICH300 복리 캘린더').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function rich300QuickData_() {
  var now = Date.now(), today = RICH300_ENGINE.kstDayOf(now);
  var sheetId = PropertiesService.getScriptProperties().getProperty('RICH300_SHEET_ID');
  if (!sheetId) return { ok: false, error: 'setup', message: '연결된 자산 장부가 없습니다.' };
  var se = rich300GasEnv_(sheetId); // 이미 운영 중인 시트: 매번 17개 시트 초기화를 검사하지 않는다
  var audit = RICH300_ENGINE.storeReadAuditTail(se);
  var ch = RICH300_ENGINE.storeList(se, 'challenge', { audit: audit }).filter(function (x) { return x.key === 'challenge'; })[0];
  if (!ch) return { ok: true, configured: false, today: today };
  var startDay = ch.data.startDay;
  var equity = RICH300_ENGINE.storeList(se, 'equity', { audit: audit });
  var closes = equity.filter(function (x) { return x.data.day >= startDay && x.data.day <= today; }).map(function (x) {
    return { day: x.data.day, micro: String(RICH300_ENGINE.decToMicro(RICH300_ENGINE.dec(x.data.equity))), equity: x.data.equity };
  });
  return { ok: true, configured: true, today: today, startDay: startDay, startMicro: String(RICH300_ENGINE.decToMicro(RICH300_ENGINE.dec(ch.data.startEquity))), closes: closes };
}
function rich300QuickModel() {
  return rich300Guarded_(function () { return rich300QuickData_(); });
}
function rich300QuickSave(form) {
  return rich300Guarded_(function (env) {
    var f = form || {}, day = String(f.day || ''), equity = String(f.equity || '').trim();
    // 기존 마감의 미실현손익 필드는 이 간편 화면에서 표시하지 않더라도 보존한다.
    var se = env.storeEnv(), prev = RICH300_ENGINE.storeGet(se, 'equity', day);
    var un = prev && prev.data ? prev.data.unrealized : undefined;
    var r = RICH300_ENGINE.closeSubmitEquity(env, { day: day, equity: equity, unrealized: un, reason: '마감 금액 수정' }, { actor: 'ui:quick' });
    var answer = { ok: true, status: r.status, message: r.status === 'unchanged' ? '이미 같은 금액이 저장되어 있어요.' : '마감 금액을 저장했어요.' };
    // 신형 화면은 1건의 확정 값만 받는다. 전체 Equity 재조회 없이 저장 직후 갱신 가능.
    // 이미 열려 있는 구형 화면은 model 응답을 기대하므로 기존 경로를 유지한다.
    if (f.quickDelta === true) {
      var finalEquity = RICH300_ENGINE.schemaDecString(equity, '평가액', { nonNegative: true });
      answer.savedClose = { day: day, equity: finalEquity, micro: String(RICH300_ENGINE.decToMicro(RICH300_ENGINE.dec(finalEquity))) };
      answer.today = RICH300_ENGINE.kstDayOf(Date.now());
    } else {
      answer.model = rich300QuickData_();
    }
    return answer;
  });
}
