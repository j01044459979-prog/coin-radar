// 웹앱 공통 화면(서버 측, 순수 함수): 접근 거부·오류(재시도 버튼)·상태 점검. 시트를 읽지 않으므로 저장소가 느리거나 고장 나도 *항상 즉시* 열린다 — 무한 로딩 대신 원인과 다시 시도 버튼을 보여 준다.
//  · 비밀값·이메일·시트 ID·금액은 어디에도 넣지 않는다. 오류는 짧은 코드(StoreError 코드·오류 이름)와 안내 문장만 보여 준다.
import { dashEsc, dashHead, dashNav } from './dashview.mjs';

const shellUrl = (appUrl, p) => (typeof appUrl === 'string' && /^https:\/\/\S+$/.test(appUrl) ? `${appUrl}${appUrl.includes('?') ? '&' : '?'}p=${p}` : null);
// 오류 → 화면에 보여도 안전한 짧은 코드(메시지 본문은 쓰지 않는다: 시트 값·ID가 섞일 수 있음)
export function shellErrorCode(err) {
  if (!err) return 'ERROR';
  if (typeof err.code === 'string' && /^[A-Z_]{2,20}$/.test(err.code)) return err.code;
  const n = String(err.name || 'Error').replace(/[^A-Za-z]/g, '').slice(0, 24).toUpperCase(); return n || 'ERROR';
}
const SHELL_HINTS = {
  LOCK: '다른 작업이 저장 중입니다. 몇 초 뒤 다시 시도하면 됩니다.',
  SCHEMA: '시트 구조 버전이 코드와 다릅니다. 상태 점검 화면에서 확인하세요.',
  INTEGRITY: '시트 내용에 이상이 감지되었습니다. 상태 점검 화면에서 확인하세요(데이터는 지우지 않았습니다).',
  NO_SHEET: '스크립트 속성에 시트 설정이 없습니다. Apps Script 편집기에서 rich300Install 을 한 번 실행하세요.',
  EXCEPTION: 'Google 서버가 일시적으로 응답하지 않았을 수 있습니다. 잠시 후 다시 시도하세요.',
};
const SHELL_JS = `<script>(function(){var b=document.getElementById('retry');if(b)b.addEventListener('click',function(e){if(!b.getAttribute('href')){e.preventDefault();location.reload()}})})()</script>`;
const shellPage = (title, body) => `${dashHead(title)}<body><main>${body}</main>${SHELL_JS}</body></html>`;

export function shellRenderError({ title = '화면', code = 'ERROR', appUrl = '', page = 'dash' } = {}) {
  const retry = shellUrl(appUrl, page), health = shellUrl(appUrl, 'health'), hint = SHELL_HINTS[code] || '잠시 후 다시 시도하세요. 계속되면 상태 점검 화면에서 원인을 확인할 수 있습니다.';
  return shellPage(`RICH300 ${title}`, `<header><h1>RICH 300 · ${dashEsc(title)}</h1></header>${dashNav(page === 'health' ? '' : page, appUrl)}<section class="card" role="alert"><p><strong>화면을 불러오지 못했습니다.</strong></p><p>${dashEsc(hint)}</p><p class="sub">오류 코드: ${dashEsc(code)} · 기록된 데이터는 변경되지 않았습니다.</p>
<a id="retry" class="cta" target="_top"${retry ? ` href="${dashEsc(retry)}"` : ''}>다시 시도</a>${health ? ` <a class="cta" target="_top" href="${dashEsc(health)}">상태 점검</a>` : ''}</section>`);
}
export function shellRenderDenied({ appUrl = '' } = {}) {
  void appUrl;
  return shellPage('접근 제한', `<header><h1>접근 제한</h1></header><section class="card" role="alert"><p><strong>이 페이지는 소유자 Google 계정으로 로그인한 브라우저에서만 열립니다.</strong></p><p>계정을 확인한 뒤 다시 열어 주세요. 텔레그램·메신저 안에서 열린 링크는 로그인 정보가 전달되지 않아 계속 로딩되거나 빈 화면이 될 수 있습니다. Chrome·Safari 에서 같은 주소를 열어 보세요.</p><a id="retry" class="cta" target="_top">다시 시도</a></section>`);
}
// 상태 점검: steps = [{ id, status: 'PASS'|'FAIL'|'WAIT', text, ms }], perf = { recent: [{p, ms, cold, at}], summary: [...] }
export function shellRenderHealth({ steps = [], build = 'dev', appUrl = '', totalMs = 0, perf = null } = {}) {
  const fail = steps.filter(s => s.status === 'FAIL').length, wait = steps.filter(s => s.status === 'WAIT').length, verdict = fail ? `문제 ${fail}건 — 아래 FAIL 항목을 먼저 확인하세요` : wait ? `정상 · 확인할 일 ${wait}건` : '정상';
  const li = s => `<li><span class="badge${s.status === 'PASS' ? ' ok' : ''}">${dashEsc(s.status)}</span> ${dashEsc(s.text)}${s.ms != null ? ` <span class="sub">${dashEsc(String(s.ms))}ms</span>` : ''}</li>`;
  const perfRows = perf && perf.recent && perf.recent.length ? `<table><tr><th>화면</th><th>구분</th><th>서버 처리</th></tr>${perf.recent.map(r => `<tr><td>${dashEsc(r.p)}</td><td>${r.cold ? '첫 실행' : '재실행'}</td><td>${dashEsc(String(r.ms))}ms</td></tr>`).join('')}</table>` : '<div class="sub">아직 기록이 없습니다. 화면을 몇 번 연 뒤 다시 확인하세요.</div>';
  const links = ['dash', 'journal', 'signals', 'stats', 'assets', 'fill', 'check'].map(p => [p, shellUrl(appUrl, p)]).filter(x => x[1]);
  return shellPage('RICH300 상태 점검', `<header><h1>RICH 300 · 상태 점검</h1></header>${dashNav('', appUrl)}<section class="card"><div class="k">결과</div><div class="v">${dashEsc(verdict)}</div><div class="sub">빌드 ${dashEsc(build)} · 점검 ${dashEsc(String(totalMs))}ms · 이 화면은 읽기 전용입니다</div></section>
<section class="card"><h2>점검 항목</h2><ul class="warn" style="list-style:none;padding:0">${steps.map(li).join('')}</ul></section>
<section class="card"><h2>최근 응답시간(서버 처리 기준)</h2>${perfRows}<div class="sub">목표: 첫 화면 3초 · 기록 조회·저장 2초 이내. '첫 실행'은 최근 10분간 실행이 없던 뒤의 첫 요청입니다.</div></section>
<section class="card"><h2>바로가기</h2>${links.map(([p, u]) => `<a class="cta" target="_top" href="${dashEsc(u)}">${dashEsc(p)}</a>`).join(' ')}</section>`);
}
