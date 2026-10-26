/**
 * RICH 300 — 설치 후 비파괴 자동 검증(호환성·계산 시간·시트 입출력·백업 복원 리허설). 엔진 번들 + 나머지 gas 파일과 같은 프로젝트에 둔다.
 *  · 운영 시트의 데이터는 읽기만 한다(쓰지 않음). 쓰기·복원·변조 시험은 *임시 시트*(RICH300-VERIFY-SCRATCH-…)에서만 한다. 어떤 시트·백업도 삭제하지 않는다.
 *  · 빠른 구간(A·B)은 즉시, 느린 구간(C·G)은 일회용 시간 트리거로 한 구간씩 나눠 돌린다(실행 한도 6분 안). 사용자가 할 일은 없다.
 *  · 결과(PASS/FAIL, 값 없음)는 Script Properties(verify:auto)에 모이고 ?p=check 화면(소유자 전용)에서 본다. Telegram 메시지는 보내지 않는다.
 */
function rich300VerifyProps_() { return PropertiesService.getScriptProperties(); }
function rich300VerifyJson_(k, d) { try { var v = rich300VerifyProps_().getProperty(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
var RICH300_VERIFY_IDS_ = { 'A': ['A1', 'A2', 'A3', 'A4'], 'B': ['B1', 'B2'], 'C-io': ['C1', 'C4'], 'C-read': ['C2', 'C3', 'C5'], 'G': ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'] };
function rich300VerifyPorts_() {
  var base = rich300TgEnv_(), stamp = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace(/[-:T]/g, ''), scratchDrive = rich300BackupDrive_('RICH300-VERIFY-SCRATCH');
  return {
    now: function () { return Date.now(); },
    hmacSha256: function (key, msg) { return rich300Hex_(Utilities.computeHmacSha256Signature(msg, key)); },
    sha256: base.sha256,
    tz: function () { return Session.getScriptTimeZone(); },
    formatKst: function (ms) { return Utilities.formatDate(new Date(ms), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'); },
    selfTest: function () { return rich300SelfTestRun_(); },
    newScratch: function (label) {
      var id = SpreadsheetApp.create('RICH300-VERIFY-SCRATCH-' + label + '-' + stamp).getId();
      try { DriveApp.getFolderById(scratchDrive.ensureFolder()).addFile(DriveApp.getFileById(id)); } catch (e) { /* 폴더 정리는 선택 */ }
      var se = rich300GasEnv_(id); RICH300_ENGINE.storeInit(se); RICH300_ENGINE.deployMarkEnv(se, 'test'); return { se: se, id: id };
    },
    scratchDrive: function () { return scratchDrive; },
    realBackup: function () { return rich300BackupEnv_(); },
    tamper: function (id) { var sh = SpreadsheetApp.openById(id).getSheetByName('Fills'); sh.getRange(2, 5).setNumberFormat('@').setValue('{"tampered":"yes"}'); },
    sleep: function (ms) { Utilities.sleep(ms); },
    httpCount: function () { try { return Number(CacheService.getScriptCache().get('verify:http') || 0); } catch (e) { return 0; } }
  };
}
function rich300VerifyFail_(name, err) { return { id: 'V-' + name, status: 'FAIL', text: '구간 ' + name + ' 실행 오류: ' + String(err && (err.code || err.message) || 'error').replace(/https?:\/\/\S+/g, '').slice(0, 80) }; }
/** 검증 시작(멱등 아님: 호출할 때마다 처음부터). 빠른 구간을 바로 돌리고 느린 구간은 백그라운드로 예약한다. */
function rich300VerifyStart() {
  var p = rich300VerifyProps_(), items = [], ports = rich300VerifyPorts_();
  RICH300_ENGINE.LIVE_FAST_SECTIONS.forEach(function (name) { try { items = items.concat(RICH300_ENGINE.liveRunSection(name, ports)); } catch (err) { items.push(rich300VerifyFail_(name, err)); } });
  p.setProperty('verify:auto', JSON.stringify(items)); p.setProperty('verify:bg', JSON.stringify({ todo: RICH300_ENGINE.LIVE_SLOW_SECTIONS.slice() })); p.setProperty('verify:startedAt', String(Date.now()));
  rich300VerifyScheduleBg_(30000);
  return { ok: true, fast: items.length, pending: RICH300_ENGINE.LIVE_SLOW_SECTIONS.length };
}
function rich300VerifyClearBg_() { ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'rich300VerifyBackground') ScriptApp.deleteTrigger(t); }); }
function rich300VerifyScheduleBg_(ms) { rich300VerifyClearBg_(); ScriptApp.newTrigger('rich300VerifyBackground').timeBased().after(ms).create(); }
function rich300VerifyBackground() {
  rich300VerifyClearBg_();
  var bg = rich300VerifyJson_('verify:bg', null), p = rich300VerifyProps_();
  if (!bg || !bg.todo || !bg.todo.length) return;
  var name = bg.todo[0], items = rich300VerifyJson_('verify:auto', []);
  try { items = items.concat(RICH300_ENGINE.liveRunSection(name, rich300VerifyPorts_())); } catch (err) { items.push(rich300VerifyFail_(name, err)); }
  bg.todo.shift(); p.setProperty('verify:auto', JSON.stringify(items)); p.setProperty('verify:bg', JSON.stringify(bg));
  if (bg.todo.length) rich300VerifyScheduleBg_(30000);
}
/** 화면용 항목: 끝난 구간은 결과, 남은 구간은 '진행 중'. 아직 시작하지 않았으면 빈 목록. */
function rich300VerifyItems_() {
  var items = rich300VerifyJson_('verify:auto', []), bg = rich300VerifyJson_('verify:bg', null);
  if (!items.length && !bg) return [{ id: 'V0', status: 'WAIT', text: '자동 검증이 아직 시작되지 않았습니다(rich300Install 실행 시 시작)' }];
  ((bg && bg.todo) || []).forEach(function (name) { (RICH300_VERIFY_IDS_[name] || [name]).forEach(function (id) { items.push({ id: id, status: 'WAIT', text: '구간 ' + name + ' 대기 중(자동 진행)' }); }); });
  return items;
}
/** ?p=check 화면(소유자 전용: Api.gs 라우터가 확인). 읽기 전용. */
function rich300PageCheck_(e) {
  var html, appUrl = rich300AppUrl_();
  try {
    var p = rich300VerifyProps_(), st = rich300VerifyJson_('tg:stats', null), self = RICH300_ENGINE.checkFromSelfTest(rich300SelfTestRun_());
    var sections = [{ title: '설치 점검', items: self }, { title: '실환경 자동 검증(호환성·계산·시트·백업)', items: rich300VerifyItems_() }, { title: '봇 사전 점검(읽기 전용)', items: RICH300_ENGINE.checkBotItems(rich300VerifyJson_('botcheck:last', null)) }, { title: 'Telegram 폴링 실측', items: RICH300_ENGINE.checkPollItems(st, { last: rich300VerifyJson_('tg:last', null) }) },
      { title: '트리거', items: [{ id: 'T1', status: 'PASS', text: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }).sort().join(', ') || '없음' }] }];
    var notes = []; if (p.getProperty('RICH300_PROD_APPROVED') !== 'yes') notes.push('운영 승인 전: Telegram 호출이 모두 차단되어 있습니다(정상). 승인 후 rich300Install 을 다시 실행하세요.');
    html = RICH300_ENGINE.checkRenderHtml({ sections: sections, generatedAt: Date.now(), notes: notes }, { appUrl: appUrl });
  } catch (err) { html = RICH300_ENGINE.shellRenderError({ title: '설치 점검', code: RICH300_ENGINE.shellErrorCode(err), appUrl: appUrl, page: 'check' }); }
  return HtmlService.createHtmlOutput(html).setTitle('RICH300 점검').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
