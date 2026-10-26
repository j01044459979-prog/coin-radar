/**
 * RICH 300 — 상태 점검(?p=health)과 응답시간 기록. 소유자만(라우터가 확인). 읽기 전용: 시트에는 아무것도 쓰지 않는다(없는 시트 확인만).
 *  · 무한 로딩·빈 화면의 원인을 한 화면에서 가른다: 속성/시트 설정 → 스프레드시트 열기 → 시트 구조 → 챌린지 → 최근 기록 → 트리거 → 웹앱 주소 → 첫 화면·일지 처리 시간(실측).
 *  · 각 단계는 독립적으로 try/catch 한다(한 단계가 실패해도 나머지를 계속 점검하고, 이 화면 자체는 항상 열린다). 오류는 짧은 코드만 보인다(값·ID·이메일 없음).
 *  · 응답시간: doGet 이 화면별 처리 시간을 CacheService 에 최근 12건 남긴다. '첫 실행' = 직전 기록이 없거나 10분 넘게 지난 뒤의 첫 요청(서버 시작·캐시 비어 있음 포함), '재실행' = 그 이후.
 */
function rich300PerfRecord_(page, ms) {
  try {      // 캐시 호출 2번(읽기+쓰기). '첫 실행' = 직전 기록이 없거나 10분 넘게 지난 뒤의 첫 요청
    var c = CacheService.getScriptCache(), now = Date.now(), log = [];
    try { log = JSON.parse(c.get('perf:log') || '[]'); } catch (e1) { log = []; }
    var last = log.length ? log[log.length - 1] : null;
    log.push({ p: page, ms: ms, cold: !last || now - last.at > 600000, at: now });
    c.put('perf:log', JSON.stringify(log.slice(-12)), 21600);
  } catch (err) { /* 기록 실패는 화면에 영향을 주지 않는다 */ }
}
function rich300PerfRecent_() {
  try { return JSON.parse(CacheService.getScriptCache().get('perf:log') || '[]').reverse(); } catch (err) { return []; }
}
function rich300PageHealth_(e) {
  var t0 = Date.now(), steps = [], props = PropertiesService.getScriptProperties(), E = RICH300_ENGINE, se = null;
  function step(id, label, fn) {
    var t = Date.now();
    try { var r = fn() || {}; steps.push({ id: id, status: r.status || 'PASS', text: r.text || id, ms: Date.now() - t }); }
    catch (err) { steps.push({ id: id, status: 'FAIL', text: label + ' 실패 (' + E.shellErrorCode(err) + ')', ms: Date.now() - t }); }
  }
  step('H1', '코드 빌드 확인', function () { return { text: '코드 빌드 ' + RICH300_BUILD + ' (배포된 웹앱이 이 빌드와 같아야 합니다)' }; });
  step('H2', '스크립트 속성 확인', function () {
    var sid = props.getProperty('RICH300_SHEET_ID'), owner = String(props.getProperty('RICH300_OWNER_EMAIL') || '').trim();
    if (!sid) return { status: 'FAIL', text: '스크립트 속성 RICH300_SHEET_ID 없음 → 편집기에서 rich300Install 실행' };
    return { status: owner.length > 3 ? 'PASS' : 'FAIL', text: '스크립트 속성: 시트 설정 있음 · 소유자 ' + (owner.length > 3 ? '설정됨' : '미설정 → rich300Install 실행') };
  });
  step('H3', '스프레드시트 열기', function () { se = rich300GasEnv_(props.getProperty('RICH300_SHEET_ID')); return { text: '스프레드시트 열기' }; });
  step('H4', '시트 구조·스키마 확인', function () { E.storeInit(se, { force: true }); return { text: '시트 구조·스키마 버전 확인(머리글 전체 재확인)' }; });
  step('H5', '챌린지 확인', function () { var ch = E.storeGet(se, 'challenge', 'challenge'); return ch && !ch.void ? { text: '챌린지 설정 있음' } : { status: 'WAIT', text: '챌린지 설정 없음 → rich300Install 실행(첫 화면은 "설정 전" 안내만 보임)' }; });
  step('H6', '최근 기록 확인', function () { var t = E.storeReadAuditTail(se, 1)[0]; return { text: '최근 기록: ' + (t ? '#' + t.seq : '없음') }; });
  step('H7', '트리거 확인', function () {
    var n = ScriptApp.getProjectTriggers().length; return n ? { text: '트리거 ' + n + '개 설치됨' } : { status: 'WAIT', text: '트리거 없음 → rich300Install 실행(일 마감·백업)' };
  });
  step('H8', '웹앱 주소 확인', function () { return rich300AppUrl_() ? { text: '웹앱 주소 확인됨(/exec). 주소는 배포를 새 버전으로 갱신해도 바뀌지 않습니다' } : { status: 'WAIT', text: '웹앱 주소를 알 수 없음 → 배포(웹 앱) 필요' }; });
  step('H9', '첫 화면(홈) 생성', function () {   // 첫 화면 실측: 실제 대시보드 모델 생성 + 렌더 (새 env — 요청 캐시 없이)
    var ms = Date.now(), env = rich300GasEnv_(props.getProperty('RICH300_SHEET_ID')); E.storeInit(env);
    E.dashRenderHtml(E.dashBuildFromStore(env, { now: Date.now() }), { appUrl: '' }); var t = Date.now() - ms;
    return { status: t < 3000 ? 'PASS' : 'WAIT', text: '첫 화면(홈) 생성 ' + t + 'ms — 목표 3000ms' + (t < 3000 ? '' : ' 초과: 기록이 많아졌거나 Google 응답이 느린 상태') };
  });
  step('H10', '기록 조회 생성', function () {
    var ms = Date.now(), jenv = rich300JournalEnv_(); E.journalBuild(jenv, { now: Date.now(), limit: 40 }); var t = Date.now() - ms;
    return { status: t < 2000 ? 'PASS' : 'WAIT', text: '기록 조회(최근 40건) 생성 ' + t + 'ms — 목표 2000ms' };
  });
  var html = E.shellRenderHealth({ steps: steps, build: RICH300_BUILD, appUrl: rich300AppUrl_(), totalMs: Date.now() - t0, perf: { recent: rich300PerfRecent_() } });
  return rich300Html_(html, 'RICH300 상태 점검');
}
