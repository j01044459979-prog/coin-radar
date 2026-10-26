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
// 감시 점검 화면(?p=watch): state = rich300WatchState_() 결과, result = 미리보기 실행 결과(개수·코드만). 값·ID·이메일·토큰 없음.
export function shellRenderWatch({ state, result = null, net = null, ran = false, error = null, ms = 0, appUrl = '', build = 'dev' } = {}) {
  const propText = { unset: '속성 없음(미설정)', off: 'off', preview: 'preview', on: 'on', invalid: `인식할 수 없는 값(길이 ${state.invalidLen}) — 꺼짐과 동일하게 동작` }[state.prop], eff = { nothing: '아무것도 하지 않음(꺼짐)', 'preview-only': '계산만 하고 전송하지 않음', sends: '전송 가능' }[state.effective];
  const runUrl = shellUrl(appUrl, 'watch&run=1'), li = t => `<li>${dashEsc(t)}</li>`;
  const rows = [`스크립트 속성 RICH300_WATCH_ALERTS: ${propText}`, `실제 동작(지금 트리거가 돌면): ${eff}`, `감시 트리거: ${state.triggers ? `${state.triggers}개 설치됨` : '없음(설치 안 됨)'}`, `텔레그램 전송 가드: ${state.gateBlocked ? '막힘(운영 승인 전)' : '통과'} · 연결: ${state.paired ? '됨' : '안 됨'}`,
    state.last ? `마지막 실행 기록: ${Math.round((Date.now() - state.last.at) / 60000)}분 전 · ${state.last.status} (요청 ${state.last.requested})` : '마지막 실행 기록: 없음'];
  let body = `<section class="card"><div class="k">감시 상태(읽기 전용 진단)</div><ul class="warn" style="list-style:none;padding:0">${rows.map(li).join('')}</ul></section>`;
  if (ran && net) {
    const row = r => `<tr><td>${dashEsc(r.symbol)}</td><td>${dashEsc(r.source || '-')}</td><td>${r.totalMs}ms</td><td>${r.priceAgeSec === null ? '-' : r.priceAgeSec + '초'}</td><td>${r.bar1hAgeMin === null ? '-' : r.bar1hAgeMin + '분'}</td><td>${r.bar4hAgeMin === null ? '-' : r.bar4hAgeMin + '분'}</td><td>${r.ok ? '정상' : '<strong>실패</strong> ' + dashEsc(r.why)}</td></tr>`;
    const att = net.flatMap(r => r.attempts.map(a => `${r.symbol} ${a.src}: ${a.ms}ms · HTTP ${a.http.join('/')} · 티커 ${a.ticker ? 'ok' : 'bad'} · 봉 15m ${a.n['15m'] === undefined ? '캐시' : a.n['15m']}/1h ${a.n['1h'] === undefined ? '캐시' : a.n['1h']}/4h ${a.n['4h'] === undefined ? '캐시' : a.n['4h']}`));
    const allOk = net.length > 0 && net.every(r => r.ok);
    body += `<section class="card"><div class="k">시세 연결 점검 (캐시 없이 새로 조회 · 읽기 전용 · ${dashEsc(String(ms))}ms)</div><div class="v">${allOk ? '모두 정상' : '실패 있음'}</div><table><tr><th>종목</th><th>출처</th><th>응답</th><th>시세 나이</th><th>1h 봉</th><th>4h 봉</th><th>판정</th></tr>${net.map(row).join('')}</table><ul class="warn" style="list-style:none;padding:0">${att.map(li).join('')}</ul><div class="sub">판정 기준: 시세 10분 이내 · 마지막 마감 1h 봉 2시간 이내 · 4h 봉 8시간 이내 · 봉 55개 이상·끊김 없음 · 티커와 봉 가격 일치. 하나라도 어긋나면 그 종목은 감시에서 제외됩니다.</div></section>`;
  }
  if (ran && error) body += `<section class="card" role="alert"><p><strong>점검을 실행하지 못했습니다.</strong></p><p class="sub">오류 코드: ${dashEsc(error)}</p></section>`;
  if (result) {
    {
      const mk = (result.market || []).map(m => `${m.symbol}: ${m.ok ? `성공(${m.source}, 시세 ${m.ageSec}초 전, 봉 15m ${m.n15}/1h ${m.n1h}/4h ${m.n4h})` : `**실패** — ${m.why}`}`);
      const bt = Object.entries(result.byType || {}).map(([k, v]) => `${k} ${v}`).join(', ') || '없음', sb = Object.entries(result.skippedBy || {}).map(([k, v]) => `${k} ${v}`).join(', ') || '없음';
      const failed = result.marketFail > 0;
      body += `<section class="card"><div class="k">미리보기 결과 (전송 없음 · ${dashEsc(String(ms))}ms)</div><div class="v">${result.status === 'ok' ? (failed ? '시세 조회 실패 있음' : '정상') : result.status === 'idle' ? '보유 포지션 없음(시세 호출 없음)' : result.status === 'busy' ? '다른 감시 실행 중(잠시 후 다시)' : dashEsc(String(result.status))}</div><ul class="warn" style="list-style:none;padding:0">${[`감시 대상 포지션: ${result.positions || 0}건 (제외: ${sb})`, `계산된 이벤트: ${result.events || 0}건 (${bt})`, `시세 조회: ${failed ? `${result.marketFail}개 종목 실패` : (result.market && result.market.length ? '모두 성공' : '조회할 종목 없음')}`, ...mk.map(x => x.replace(/\*\*/g, ''))].map(li).join('')}</ul></section>`;
    }
  }
  const netUrl = shellUrl(appUrl, 'watch&net=1'), links = (runUrl ? `<a class="cta" target="_top" href="${dashEsc(runUrl)}">미리보기 실행(전송 없음)</a> ` : '') + (netUrl ? `<a class="cta" target="_top" href="${dashEsc(netUrl)}">시세 연결 점검</a>` : '');
  return shellPage('RICH300 감시 점검', `<header><h1>RICH 300 · 감시 점검</h1></header>${dashNav('', appUrl)}${body}<section class="card"><div class="sub">빌드 ${dashEsc(build)} · 이 화면은 텔레그램을 보내지 않고 트리거를 만들지 않으며 감시 설정을 바꾸지 않습니다. 미리보기는 거래소 공개 시세를 읽기만 합니다.</div>${links}</section>`);
}
// RICH300 전용 Telegram 연결 진단(?p=tg): d = rich300TgDiagState_() 결과(존재 여부·코드만). 토큰·채팅 ID·봇 이름은 어디에도 표시하지 않는다.
export function shellRenderTgDiag({ d, check = null, nonce = null, appUrl = '', build = 'dev' } = {}) {
  const yn = v => (v ? '있음' : '없음'), li = t => `<li>${dashEsc(t)}</li>`, test = d.test || null;
  const stateText = !test ? '아직 보낸 적 없음' : { pending: '전송 중이었는데 결과를 기록하지 못함(상태 불명)', sent: '전송 API 성공 — 수신 확인 대기', failed: `전송 실패(${test.code || 'error'})`, acked: '전송 API 성공 + 사용자가 수신 확인함', unacked: '전송했으나 사용자가 못 받았다고 표시' }[test.state];
  const rows = [`환경: ${d.env || '미설정'}`, `봇 토큰 속성: ${yn(d.tokenSet)}`, `메시지 전송 가드: ${d.gateSend ? `막힘(${d.gateSend})` : '통과'}`, `읽기 점검 가드(getMe): ${d.gateRead ? `막힘(${d.gateRead})` : '통과'}`, `수신 계정 연결(페어링): ${d.paired ? '됨' : '안 됨'}`, `수신 폴링 트리거: ${d.pollTriggers ? d.pollTriggers + '개' : '없음'}`, d.lastPoll ? `마지막 폴링: ${d.lastPoll.ageMin}분 전 · ${d.lastPoll.status}` : '마지막 폴링: 기록 없음', `테스트 메시지: ${stateText}`];
  let body = `<section class="card"><div class="k">Telegram 연결 상태 (읽기 전용 · 값 비노출)</div><ul class="warn" style="list-style:none;padding:0">${rows.map(li).join('')}</ul></section>`;
  if (check) body += `<section class="card"><div class="k">Telegram 읽기 점검 (getMe·getWebhookInfo 두 호출만 · 메시지 없음)</div><ul class="warn" style="list-style:none;padding:0">${(check.items || []).map(li).join('')}</ul></section>`;
  const checkUrl = shellUrl(appUrl, 'tg&check=1');
  const canTest = !!nonce && !d.gateSend && d.paired && (!test || test.state === 'failed' || test.state === 'unacked');
  let act = '';
  if (canTest) act += `<p>[RICH300 TEST] 메시지를 <strong>딱 1건</strong> 보냅니다. 버튼은 한 번만 눌러 주세요(연타해도 서버가 한 번만 보냅니다).</p><button id="sendTest" class="cta" type="button">테스트 메시지 1건 보내기</button>`;
  else if (test && (test.state === 'sent' || test.state === 'pending')) act += '<p>Telegram에서 <strong>[RICH300 TEST]</strong> 메시지를 확인하세요. 이 화면은 다시 보내지 않습니다.</p>';
  else if (d.gateSend) act += '<p>운영 승인 전이라 전송할 수 없습니다(가드가 막음). 승인 후에 사용할 수 있습니다.</p>'; else if (!d.paired) act += '<p>수신 계정이 연결되지 않아 전송할 수 없습니다.</p>';
  if (test && (test.state === 'sent' || test.state === 'pending')) act += '<div id="ackBox"><button id="ackYes" class="cta" type="button">받았음</button> <button id="ackNo" class="cta" type="button">못 받음</button></div>';
  act += '<div id="testMsg" class="sub" role="status"></div>';
  const script = (canTest || (test && (test.state === 'sent' || test.state === 'pending'))) ? `<script>(function(){var m=document.getElementById('testMsg');function say(t){m.textContent=t}var b=document.getElementById('sendTest');
if(b)b.onclick=function(){b.disabled=true;say('전송 중…');google.script.run.withSuccessHandler(function(r){say(r&&r.ok?'전송 API 성공(Telegram이 메시지를 받았습니다). Telegram에서 [RICH300 TEST]를 확인하고 이 화면을 새로고침해 주세요.':'보내지 않았거나 실패: '+((r&&r.code)||'error'))}).withFailureHandler(function(){say('연결 오류 — 전송 여부가 불확실합니다. Telegram을 확인하고 새로고침하세요(자동 재전송 없음).')}).rich300TgTestSend(${JSON.stringify(String(nonce || '')).replace(/</g, '\\u003c')})};
function ack(v){return function(){google.script.run.withSuccessHandler(function(){say(v?'수신 확인을 기록했습니다.':'미수신으로 기록했습니다. 새로고침하면 1회 더 시도할 수 있습니다.')}).withFailureHandler(function(){say('기록하지 못했습니다. 다시 눌러 주세요.')}).rich300TgTestAck(v)}}
var y=document.getElementById('ackYes'),n=document.getElementById('ackNo');if(y)y.onclick=ack(true);if(n)n.onclick=ack(false)})()</script>` : '';
  return `${dashHead('RICH300 텔레그램 점검')}<body><main><header><h1>RICH 300 · 텔레그램 점검</h1></header>${dashNav('', appUrl)}${body}<section class="card">${act}${checkUrl ? `<a class="cta" target="_top" href="${dashEsc(checkUrl)}">읽기 점검(getMe)</a>` : ''}<div class="sub">빌드 ${dashEsc(build)} · 토큰·채팅 ID·봇 이름은 표시하지 않습니다. 테스트 메시지는 추천·매매 알림이 아닙니다.</div></section></main>${script}</body></html>`;
}
