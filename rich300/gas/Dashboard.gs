/**
 * RICH 300 — 대시보드 페이지(R6). 엔진 번들 + Adapters.gs + Api.gs(라우터) 와 같은 프로젝트에 둔다. 운영 배포는 승인 이후.
 *  · ?p=dash 는 Api.gs 라우터가 *소유자 이메일 확인(fail-closed)* 을 통과시킨 경우에만 이 함수를 호출한다.
 *  · 서버에서 완성된 HTML을 만든다(값은 모두 이스케이프됨). 읽기 전용: 이 페이지는 아무것도 쓰지 않는다(시트 초기화 확인 제외).
 *  · 숫자 중심 메인 화면(그래프 없음). 챌린지 설정이 없으면 '설정 전' 안내만 보이고(샘플·가짜 잔액 없음), 오류는 일반 오류 화면만 보인다(내부 정보 비노출).
 */
function rich300PageDash_(e) {
  var html;
  try {
    var se = rich300GasEnv_(PropertiesService.getScriptProperties().getProperty('RICH300_SHEET_ID'));
    RICH300_ENGINE.storeInit(se);
    html = RICH300_ENGINE.dashRenderHtml(RICH300_ENGINE.dashBuildFromStore(se, { now: Date.now() }), { appUrl: rich300AppUrl_() });
  } catch (err) { html = RICH300_ENGINE.shellRenderError({ title: '홈', code: RICH300_ENGINE.shellErrorCode(err), appUrl: rich300AppUrl_(), page: 'dash' }); }
  return HtmlService.createHtmlOutput(html).setTitle('RICH300').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
