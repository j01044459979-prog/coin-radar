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
// RICH300 전용 Telegram 연결 준비·진단(?p=tg): d = rich300TgDiagState_() 결과(존재 여부·코드만). 토큰·채팅 ID·봇 이름은 어디에도 표시하지 않는다(토큰은 입력창에서 서버로만 가며 화면에 되돌려 주지 않는다).
export function shellRenderTgDiag({ d, check = null, nonce = null, pairCode = null, appUrl = '', build = 'dev' } = {}) {
  const li = t => `<li>${dashEsc(t)}</li>`, test = d.test || null, selfUrl = shellUrl(appUrl, 'tg');
  const stateText = !test ? '아직 보낸 적 없음' : { pending: '전송 중이었는데 결과를 기록하지 못함(상태 불명)', sent: '전송 API 성공 — 수신 확인 대기', failed: `전송 실패(${test.code || 'error'})`, acked: '전송 API 성공 + 사용자가 수신 확인함', unacked: '전송했으나 사용자가 못 받았다고 표시' }[test.state];
  const rows = [`환경: ${d.env || '미설정'}`, `봇 토큰 속성: ${d.tokenSet ? '있음' : '없음'}`, `운영 승인(RICH300_PROD_APPROVED): ${d.prodApproved ? '있음' : '없음'} — 감시·폴링·버튼 알림은 이것이 있어야 전송됩니다`, `테스트 전송 허용(RICH300_TG_TEST_OK): ${d.testAllow ? '허용됨' : '꺼짐'} — 읽기 점검·페어링 확인 1회·테스트 메시지 1건만 허용(그 밖은 계속 차단)`,
    `메시지 전송 가드(일반): ${d.gateSend ? `막힘(${d.gateSend})` : '통과'}`, `테스트 메시지 가드: ${d.gateTestSend ? `막힘(${d.gateTestSend})` : '통과'}`, `수신 계정 연결(페어링): ${d.paired ? '됨' : '안 됨'}${d.pairingActive ? ' · 페어링 코드 대기 중' : ''}`, `수신 폴링 트리거: ${d.pollTriggers ? d.pollTriggers + '개' : '없음'}`, d.lastPoll ? `마지막 폴링: ${d.lastPoll.ageMin}분 전 · ${d.lastPoll.status}` : '마지막 폴링: 기록 없음', `테스트 메시지: ${stateText}`];
  let body = `<section class="card"><div class="k">Telegram 연결 상태 (값 비노출)</div><ul class="warn" style="list-style:none;padding:0">${rows.map(li).join('')}</ul></section>`;
  if (check) body += `<section class="card"><div class="k">Telegram 읽기 점검 (getMe·getWebhookInfo 두 호출만 · 메시지 없음)</div><ul class="warn" style="list-style:none;padding:0">${(check.items || []).map(li).join('')}</ul></section>`;
  const canTest = !!nonce && !d.gateTestSend && d.paired && d.tokenSet && (!test || test.state === 'failed' || test.state === 'unacked'), waitingAck = !!test && (test.state === 'sent' || test.state === 'pending');
  const step = (n, title, inner) => `<div class="day"><div class="row"><strong>${n}. ${dashEsc(title)}</strong></div>${inner}</div>`;
  const TL = { 'saved-verified': '저장됨(Telegram 확인 성공)', 'saved-unverified': '저장됨(확인 호출은 하지 않았거나 실패)', 'bad-format': '형식이 맞지 않아 저장하지 않음', 'forbidden': '소유자 확인 실패', 'busy': '다른 작업 중이라 저장하지 않음', 'lock-error': '잠금 오류', 'already-set': '이미 저장돼 있어 저장하지 않음', 'storage-error': '속성 저장소 오류', 'storage-verify-failed': '저장 후 확인 실패', 'token-rejected': 'Telegram 이 토큰을 거부해 삭제함' };
  const tl = d.tokenLast, dt = tl && tl.d ? ` (길이 ${tl.d.len}, 콜론 ${tl.d.hasColon ? '있음' : '없음'}, 앞 숫자 ${tl.d.idDigits}자, 뒤 문자 ${tl.d.secretLen}자)` : '';
  const tokLast = tl ? `<div class="sub">마지막 토큰 저장 시도: ${dashEsc(String(tl.ageMin))}분 전 · ${dashEsc(TL[tl.code] || String(tl.code))}${dashEsc(dt)} — 값은 기록하지 않습니다.</div>` : '';
  let steps = '';
  steps += step(1, '봇 토큰 등록', d.tokenSet ? '<div class="sub"><strong>토큰 있음</strong> — 완료 (값은 표시하지 않습니다)</div>' + tokLast : '<div class="sub"><strong>토큰 없음</strong>. BotFather 의 /mybots → 봇 선택 → API Token 값을 붙여 넣으세요. 화면에 다시 표시되지 않고 Script Properties 에만 저장됩니다. 채팅·URL·로그에 붙여 넣지 마세요.</div><input id="tok" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="123456789:AA…"><button id="tokBtn" class="cta" type="button">토큰 저장</button><div id="tokMsg" class="sub" role="status" aria-live="polite"></div>' + tokLast);
  steps += step(2, '테스트 전송 허용 (운영 승인과 별개)', d.testAllow ? '<div class="sub">허용됨.</div><button id="allowOff" class="cta" type="button">허용 해제</button>' : (d.tokenSet ? '<div class="sub">테스트 목적의 getMe·페어링 확인·테스트 메시지 1건만 허용합니다. 감시·폴링·추천 알림은 계속 막힙니다. 아래 칸에 <strong>테스트 전송 허용</strong> 이라고 입력하세요.</div><input id="phrase" autocomplete="off" placeholder="테스트 전송 허용"><button id="allowOn" class="cta" type="button">허용</button>' : '<div class="sub">먼저 토큰을 등록하세요.</div>'));
  steps += step(3, '연결 읽기 점검', checkUrlBlock(d, selfUrl));
  steps += step(4, '소유자 Telegram 계정 페어링', d.paired ? '<div class="sub">완료.</div>' : (d.tokenSet && d.testAllow ? `<div class="sub">① 코드를 만들고 ② Telegram 에서 이 봇에게 <code>/start 코드</code> 를 보낸 뒤(10분 이내, 개인 대화) ③ 확인을 누르세요. 확인은 1회 조회이며 메시지를 보내지 않습니다.</div><button id="pairStart" class="cta" type="button">코드 만들기</button> <button id="pairCheck" class="cta" type="button">페어링 확인</button>${pairCode ? `<div class="v">${dashEsc(pairCode)}</div>` : ''}<div id="codeBox" class="v"></div>` : '<div class="sub">토큰 등록과 테스트 전송 허용이 필요합니다.</div>'));
  steps += step(5, '테스트 메시지 1건', canTest ? `<div class="sub">[RICH300 TEST] 메시지를 <strong>딱 1건</strong> 보냅니다. 버튼은 한 번만 눌러 주세요(연타해도 서버가 한 번만 보냅니다).</div><button id="sendTest" class="cta" type="button">테스트 메시지 1건 보내기</button>` : (waitingAck ? '<div class="sub">전송했습니다. Telegram 에서 [RICH300 TEST] 를 확인하세요. 이 화면은 다시 보내지 않습니다.</div>' : `<div class="sub">${d.gateTestSend ? '테스트 전송 허용이 필요합니다.' : !d.paired ? '페어링이 필요합니다.' : test && test.state === 'acked' ? '완료.' : '대기 중.'}</div>`));
  steps += step(6, '수신 확인', waitingAck ? '<div class="sub">메시지를 받으셨나요?</div><button id="ackYes" class="cta" type="button">받았음</button> <button id="ackNo" class="cta" type="button">못 받음</button>' : `<div class="sub">${test && test.state === 'acked' ? '수신 확인됨.' : '전송 후에 표시됩니다.'}</div>`);
  const script = `<script>(function(){var cur=null;function $(i){return document.getElementById(i)}
var say=function(t,id){var e=$(id||'msg')||$('msg');if(e){e.textContent=t;try{e.scrollIntoView({block:'center'})}catch(x){}}};
var call=function(fn,args,ok,id,fail){say('처리 중…',id);var t=setTimeout(function(){say('응답이 늦습니다(30초). 결과가 불확실하면 새로고침해서 상태를 확인하세요.',id)},30000);
if(!(window.google&&google.script&&google.script.run)){clearTimeout(t);say('이 화면에서 서버 연결(google.script.run)을 쓸 수 없습니다. 앱 주소(/exec)를 브라우저 주소창에 직접 열어 주세요.',id);if(fail)fail();return}
var r=google.script.run.withSuccessHandler(function(x){clearTimeout(t);ok(x||{})}).withFailureHandler(function(e){clearTimeout(t);var m='';try{m=String(e&&e.message||e||'').replace(/\\d{6,12}:[A-Za-z0-9_-]{20,}/g,'[가림]').slice(0,120)}catch(z){}say('서버 호출 실패'+(m?': '+m:'')+' — 결과가 불확실합니다. 새로고침해서 상태를 확인하세요(자동 재시도 없음).',id);if(fail)fail()});r[fn].apply(r,args)};
var done=function(t,id){say(t+' 아래 새로고침을 눌러 상태를 확인하세요.',id);var a=$('reload');if(a)a.hidden=false};
var TM={'bad-format':'형식이 맞지 않습니다. BotFather 의 API Token(숫자:문자열)을 통째로 붙여 넣으세요.','forbidden':'소유자 계정으로 열려 있지 않아 저장할 수 없습니다(구글 로그인 계정 확인).','busy':'다른 작업이 진행 중입니다. 잠시 뒤 다시 누르세요.','lock-error':'잠금을 얻지 못했습니다. 잠시 뒤 다시 누르세요.','already-set':'이미 토큰이 저장돼 있습니다. 새로고침하세요.','storage-error':'속성 저장소 쓰기 오류(권한 확인 필요).','storage-verify-failed':'저장 후 확인에 실패했습니다.','token-rejected':'Telegram 이 이 토큰을 거부했습니다(저장하지 않음). 토큰을 다시 복사하세요.'};
if($('tokBtn'))$('tokBtn').onclick=function(){var v=$('tok').value;if(!v||!v.replace(/\\s/g,'')){say('토큰 칸이 비어 있습니다. 붙여 넣은 뒤 다시 누르세요.','tokMsg');return}
$('tokBtn').disabled=true;call('rich300TgSetToken',[v],function(r){if(r.ok){$('tok').value='';var tb=$('tokBtn');tb.style.display='none';$('tok').style.display='none';done('토큰 있음 — 저장했습니다'+(r.code==='saved-verified'?'(Telegram 확인 성공).':'(확인 호출은 하지 않았습니다).'),'tokMsg')}else{$('tokBtn').disabled=false;var dd=r.detail?' (길이 '+r.detail.len+', 콜론 '+(r.detail.hasColon?'있음':'없음')+', 앞 숫자 '+r.detail.idDigits+'자, 뒤 문자 '+r.detail.secretLen+'자)':'';say('저장하지 않음['+(r.code||'error')+']: '+(TM[r.code]||'원인을 알 수 없습니다.')+dd,'tokMsg')}},'tokMsg',function(){$('tokBtn').disabled=false})};
if($('allowOn'))$('allowOn').onclick=function(){var v=$('phrase').value;$('phrase').value='';call('rich300TgSetTestAllow',[true,v],function(r){done(r.ok?'테스트 전송 허용을 켰습니다.':'변경하지 않음: '+(r.code||'error'))})};
if($('allowOff'))$('allowOff').onclick=function(){call('rich300TgSetTestAllow',[false,''],function(r){done('테스트 전송 허용을 껐습니다.')})};
if($('pairStart'))$('pairStart').onclick=function(){call('rich300TgPairStart',[],function(r){if(r.ok){$('codeBox').textContent=r.pairCode;say('이 코드를 Telegram 의 봇 대화에 /start '+r.pairCode+' 로 보내고(10분 이내) “페어링 확인”을 누르세요.')}else say('만들지 않음: '+(r.code||'error'))})};
if($('pairCheck'))$('pairCheck').onclick=function(){call('rich300TgPairCheck',[],function(r){if(r.ok&&r.code==='paired')done('페어링되었습니다.');else say(r.ok?'아직 메시지를 찾지 못했습니다('+r.code+'). 봇에게 /start 코드 를 보낸 뒤 다시 눌러 주세요.':'확인하지 못함: '+(r.code||'error'))})};
if($('sendTest'))$('sendTest').onclick=function(){$('sendTest').disabled=true;call('rich300TgTestSend',[${JSON.stringify(String(nonce || '')).replace(/</g, '\\u003c')}],function(r){done(r.ok?'전송 API 성공(Telegram이 메시지를 받았습니다). Telegram 에서 [RICH300 TEST] 를 확인하고 “받았음/못 받음”을 눌러 주세요.':'보내지 않았거나 실패: '+(r.code||'error'))})};
if($('ackYes'))$('ackYes').onclick=function(){call('rich300TgTestAck',[true],function(){done('수신 확인을 기록했습니다.')})};
if($('ackNo'))$('ackNo').onclick=function(){call('rich300TgTestAck',[false],function(){done('미수신으로 기록했습니다(1회 더 시도할 수 있습니다).')})};
})()</script>`;
  return `${dashHead('RICH300 텔레그램 점검')}<body><main><header><h1>RICH 300 · 텔레그램 연결</h1></header>${dashNav('', appUrl)}${body}<section class="card"><div class="k">연결 준비 순서</div>${steps}<div id="msg" class="sub" role="status"></div>${selfUrl ? `<a id="reload" hidden class="cta" target="_top" href="${dashEsc(selfUrl)}">새로고침</a>` : ''}<div class="sub">빌드 ${dashEsc(build)} · 이 화면은 감시 알림·폴링 트리거·자동 전송을 켜지 않습니다. 테스트 메시지는 추천·매매 알림이 아닙니다.</div></section></main>${script}</body></html>`;
}
const checkUrlBlock = (d, selfUrl) => { const u = selfUrl ? `${selfUrl}&check=1` : null; return d.tokenSet && !d.gateRead && u ? `<a class="cta" target="_top" href="${dashEsc(u)}">읽기 점검(getMe)</a>` : `<div class="sub">${!d.tokenSet ? '먼저 토큰을 등록하세요.' : '테스트 전송 허용(또는 읽기 점검 허용) 후에 사용할 수 있습니다.'}</div>`; };
