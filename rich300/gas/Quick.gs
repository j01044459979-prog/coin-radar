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
  // Only negative Cashflows are withdrawals. The equity close is ALREADY after withdrawal;
  // this list is display-only for Quick and must never be subtracted a second time.
  var withdrawalByDay = {};
  RICH300_ENGINE.storeList(se, 'cashflow', { audit: audit }).forEach(function (r) {
    var day = RICH300_ENGINE.kstDayOf(r.data.at);
    if (day < startDay || day > today) return;
    var v = RICH300_ENGINE.decToMicro(RICH300_ENGINE.dec(r.data.amount));
    if (v >= BigInt(0)) return;
    withdrawalByDay[day] = (withdrawalByDay[day] || BigInt(0)) - v;
  });
  var withdrawals = Object.keys(withdrawalByDay).sort().map(function (day) {
    return { day: day, micro: String(withdrawalByDay[day]) };
  });
  return { ok: true, configured: true, today: today, startDay: startDay, startMicro: String(RICH300_ENGINE.decToMicro(RICH300_ENGINE.dec(ch.data.startEquity))), closes: closes, withdrawals: withdrawals };
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

/**
 * Save the selected KST day's TOTAL withdrawal, not a repeated increment.
 * Other manually-recorded Cashflows are included in that total; only the difference
 * is written as a deterministic Quick-specific cashflow. This keeps audit/P&L correct
 * without double-subtracting from already-net Equity or the compound forecast.
 * Entering zero cancels the Quick-specific record (existing external entries stay).
 */
function rich300QuickWithdrawSave(form) {
  return rich300Guarded_(function (env) {
    var f = form || {}, day = String(f.day || ''), raw = String(f.amount == null ? '' : f.amount).trim();
    var se = env.storeEnv(), today = RICH300_ENGINE.kstDayOf(Date.now());
    var ch = RICH300_ENGINE.storeGet(se, 'challenge', 'challenge');
    if (!ch || !RICH300_ENGINE.isDayString(day) || day < ch.data.startDay || day > today)
      throw new RICH300_ENGINE.StoreError('VALIDATION', '시작일 이후부터 오늘까지만 기록할 수 있어요.');
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(raw))
      throw new RICH300_ENGINE.StoreError('VALIDATION', '출금액은 0 이상의 숫자로 소수점 최대 6자리까지 입력해 주세요.');
    var req = RICH300_ENGINE.schemaDecString(raw, '해당 날짜 출금 합계', { nonNegative: true });
    var reqMicro = RICH300_ENGINE.decToMicro(RICH300_ENGINE.dec(req));
    var ownId = 'quick-withdraw-' + day, other = BigInt(0), cash = RICH300_ENGINE.storeList(se, 'cashflow');
    cash.forEach(function (r) {
      if (r.key === ownId || RICH300_ENGINE.kstDayOf(r.data.at) !== day) return;
      var micro = RICH300_ENGINE.decToMicro(RICH300_ENGINE.dec(r.data.amount));
      if (micro < BigInt(0)) other -= micro;
    });
    if (reqMicro < other)
      throw new RICH300_ENGINE.StoreError('VALIDATION', '기존 입출금 장부의 해당일 출금액보다 작게 저장할 수 없어요.');
    var own = reqMicro - other, old = RICH300_ENGINE.storeGet(se, 'cashflow', ownId), result;
    if (own === BigInt(0)) {
      result = old && !old.void
        ? RICH300_ENGINE.storeVoid(se, 'cashflow', ownId, { actor: 'ui:quick-withdraw', reason: '일별 출금 합계 0 또는 기존 기록으로 대체' })
        : { status: 'unchanged' };
    } else {
      var negative = '-' + RICH300_ENGINE.microFormat(own, 6);
      if (!old || old.void) {
        result = RICH300_ENGINE.storeCreate(se, 'cashflow', {
          cfId: ownId, at: Math.min(RICH300_ENGINE.dayStartMs(day) + 60000, Date.now()),
          amount: negative, note: '복리 캘린더 일별 출금 기록'
        }, { actor: 'ui:quick-withdraw' });
        if (result.status === 'conflict') throw new RICH300_ENGINE.StoreError('VALIDATION', '다른 출금 기록이 동시에 변경됐어요. 새로고침 후 확인해 주세요.');
      } else {
        result = RICH300_ENGINE.storeRevise(se, 'cashflow', ownId, { amount: negative },
          { actor: 'ui:quick-withdraw', reason: '일별 출금 합계 수정' });
      }
    }
    return { ok: true, status: result.status, message: result.status === 'unchanged' || result.status === 'duplicate' ? '이미 같은 출금액이 기록되어 있어요.' : '출금 기록을 저장했어요.',
      savedWithdrawal: { day: day, amount: req, micro: String(reqMicro) }, today: today };
  });
}
