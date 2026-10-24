/**
 * RICH 300 — 대시보드 페이지(R6). 엔진 번들 + Adapters.gs + Api.gs(라우터) 와 같은 프로젝트에 둔다. 운영 배포는 승인 이후.
 *  · ?p=dash 는 Api.gs 라우터가 *소유자 이메일 확인(fail-closed)* 을 통과시킨 경우에만 이 함수를 호출한다.
 *  · 서버에서 완성된 HTML을 만든다(값은 모두 이스케이프됨). 읽기 전용: 이 페이지는 아무것도 쓰지 않는다(시트 초기화 확인 제외).
 *  · 챌린지 설정이 없을 때만 샘플 데이터(명시 배너)로 보여 준다. 설정이 있는데 오류가 나면 샘플로 숨기지 않고 일반 오류 화면만 보인다(내부 정보 비노출).
 */
function rich300PageDash_(e) {
  var html;
  try {
    var se = rich300GasEnv_(PropertiesService.getScriptProperties().getProperty('RICH300_SHEET_ID'));
    RICH300_ENGINE.storeInit(se);
    html = RICH300_ENGINE.dashRenderHtml(RICH300_ENGINE.dashBuildFromStore(se, { now: Date.now() }));
  } catch (err) { html = RICH300_ENGINE.dashRenderError(); }
  return HtmlService.createHtmlOutput(html).setTitle('RICH300').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
