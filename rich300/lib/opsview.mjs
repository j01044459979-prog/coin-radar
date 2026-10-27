// 실전 감시 관리(?p=ops): 사전 점검 판정(순수)과 화면 HTML. 값(토큰·채팅 ID·가격)은 어디에도 담지 않고 존재 여부·코드·개수만 쓴다.
//  · 활성화는 서버가 사전 점검 통과 기록(15분 이내·같은 빌드)과 확인 문구를 다시 검사한다 — 화면의 버튼 상태는 편의일 뿐 보안 경계가 아니다.
import { dashEsc, dashHead, dashNav } from './dashview.mjs';

export const OPS_PHRASE = '실전 감시 시작';
export const OPS_STRAT_PHRASE = '전략 추적 시작';
export const OPS_PRECHECK_TTL_MS = 15 * 60000;
// info: { state:{env,tokenSet,paired,gateSend,triggers}, net:[{symbol,ok,why}], preview:{status,positions,marketFail,skipped} } → { ok, items:[{id,must,ok,text}] }
export function opsEvaluate(info) {
  const s = info.state || {}, net = Array.isArray(info.net) ? info.net : [], pv = info.preview || {}, items = [];
  const add = (id, must, ok, text) => items.push({ id, must, ok: !!ok, text });
  add('env', true, s.env === 'prod', `운영 환경 표식 ${s.env === 'prod' ? '확인' : '아님(' + (s.env || '미설정') + ')'}`);
  add('token', true, s.tokenSet, `Telegram 봇 토큰 ${s.tokenSet ? '있음' : '없음'}`);
  add('paired', true, s.paired, `소유자 Telegram 페어링 ${s.paired ? '됨' : '안 됨'}`);
  const gateOk = s.gateSend === null || s.gateSend === undefined || s.gateSend === 'prod-not-approved';
  add('gate', true, gateOk, gateOk ? '전송 가드: 운영 승인 외 막는 사유 없음' : `전송 가드가 다른 사유로 막혀 있음(${s.gateSend})`);
  const bad = net.filter(n => !n.ok);
  add('net', true, net.length > 0 && bad.length === 0, net.length ? `시세 연결 ${net.length - bad.length}/${net.length} 정상${bad.length ? ` — 실패: ${bad.map(n => `${n.symbol}(${n.why || 'fail'})`).join(', ')}` : ''}` : '시세 연결 점검 결과 없음');
  const pvOk = (pv.status === 'ok' || pv.status === 'idle') && !(pv.marketFail > 0);
  add('preview', true, pvOk, pv.status === 'idle' ? '감시 미리보기: 보유 포지션 없음 — 정상 대기' : pvOk ? `감시 미리보기 정상 (포지션 ${pv.positions || 0}건)` : `감시 미리보기 실패(${pv.status || 'none'}${pv.marketFail ? ', 시세 실패 ' + pv.marketFail + '종목' : ''}${pv.code ? ', ' + pv.code : ''})`);
  add('triggers', false, (s.triggers || 0) <= 1, (s.triggers || 0) <= 1 ? `기존 감시 트리거 ${s.triggers || 0}개` : `감시 트리거가 ${s.triggers}개 — 활성화하면 1개로 정리됩니다`);
  if (pv.skipped > 0) add('skipped', false, false, `감시에서 제외되는 포지션 ${pv.skipped}건(종목 불명·체결 오류) — 확인하세요`);
  return { ok: items.filter(i => i.must).every(i => i.ok), items };
}
// 전략 추적 사전 점검 판정(순수): info.preview = { status, feed:{ok,signed,ageMin,stale,entries,code}, marketFail, code, keySet }
export function opsEvaluateStrategy(info) {
  const s = info.state || {}, net = Array.isArray(info.net) ? info.net : [], pv = info.preview || {}, fd = pv.feed || null, items = [];
  const add = (id, must, ok, text) => items.push({ id, must, ok: !!ok, text });
  add('env', true, s.env === 'prod', `운영 환경 표식 ${s.env === 'prod' ? '확인' : '아님(' + (s.env || '미설정') + ')'}`);
  add('token', true, s.tokenSet, `Telegram 봇 토큰 ${s.tokenSet ? '있음' : '없음'}`);
  add('paired', true, s.paired, `소유자 Telegram 페어링 ${s.paired ? '됨' : '안 됨'}`);
  const gateOk = s.gateSend === null || s.gateSend === undefined || s.gateSend === 'prod-not-approved';
  add('gate', true, gateOk, gateOk ? '전송 가드: 운영 승인 외 막는 사유 없음' : `전송 가드가 다른 사유로 막혀 있음(${s.gateSend})`);
  add('feed', true, !!(fd && fd.ok), fd && fd.ok ? `추천 피드 연결 정상 (항목 ${fd.entries}건 · ${fd.ageMin}분 전 생성${fd.stale ? ' · 오래됨(radar 중단 의심)' : ''})` : `추천 피드를 읽지 못함(${(fd && fd.code) || pv.status || 'none'}) — GitHub 쪽 RADAR_RICH300_FEED=on 과 rich300-feed 브랜치가 필요합니다`);
  add('signed', false, !!(fd && fd.signed), fd && fd.signed ? '피드 서명 검증 통과' : pv.keySet ? '피드 서명 확인 실패' : '서명 키 미등록 — 서명 없이 받습니다(저장소 쓰기 권한자만 위조 가능). 키 등록을 권장합니다');
  add('net', true, net.length > 0 && net.every(n => n.ok), net.length ? `시세 연결 ${net.filter(n => n.ok).length}/${net.length} 정상` : '시세 연결 점검 결과 없음');
  add('preview', true, pv.status === 'ok' && !(pv.marketFail > 0), pv.status === 'ok' ? '전략 추적 미리보기 정상(저장·전송 없음)' : `전략 추적 미리보기 실패(${pv.status || 'none'}${pv.code ? ', ' + pv.code : ''})`);
  return { ok: items.filter(i => i.must).every(i => i.ok), items };
}
const opsKst = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
const opsUrl = (appUrl, q) => (typeof appUrl === 'string' && /^https:\/\/\S+$/.test(appUrl) ? `${appUrl}${appUrl.includes('?') ? '&' : '?'}${q}` : null);
// m: 서버가 만든 상태 모델
export function opsRenderHtml({ m, appUrl = '', build = 'dev' } = {}) {
  const li = t => `<li>${dashEsc(t)}</li>`, last = m.last ? `${m.last.ageMin}분 전 · ${m.last.status}${m.last.mode ? ' · ' + m.last.mode : ''} · 포지션 ${m.last.positions || 0} · 이벤트 ${m.last.events || 0} · 전송 ${m.last.sent || 0}${m.last.failed ? ' · 실패 ' + m.last.failed : ''}${m.last.marketFail ? ' · 시세 실패 ' + m.last.marketFail : ''}${m.last.code ? ' · ' + m.last.code : ''}` : '기록 없음';
  const live = m.effective === 'sends', rows = [
    `빌드 ${build} · 환경 ${m.env || '미설정'}`,
    `Telegram: 토큰 ${m.tokenSet ? '있음' : '없음'} · 페어링 ${m.paired ? '됨' : '안 됨'}`,
    `운영 승인(RICH300_PROD_APPROVED): ${m.prodApproved ? '있음' : '없음'}`,
    `감시 설정(RICH300_WATCH_ALERTS): ${{ unset: '없음(꺼짐)', off: 'off', preview: 'preview(계산만)', on: 'on', invalid: '인식할 수 없는 값(꺼짐과 같음)' }[m.prop] || m.prop}`,
    `5분 감시 트리거: ${m.triggers}개`,
    `실제 동작: ${live ? '전송 중(실전 감시 켜짐)' : m.effective === 'preview-only' ? '계산만(전송 없음)' : '아무것도 하지 않음(꺼짐)'}`,
    `등록된 미청산 포지션: ${m.positions === null ? '확인 못 함' : m.positions + '건'}${m.positions === 0 ? ' — 0건이면 정상 대기(시세 호출 없음)' : ''}`,
    `마지막 감시 실행: ${last}`,
    `추천 전략 자동 추적(RICH300_STRATEGY): ${{ off: '꺼짐', preview: 'preview(계산만)', on: '켜짐' }[(m.strategy && m.strategy.prop) || 'off']} · 피드 서명 키 ${m.strategy && m.strategy.keySet ? '등록됨' : '없음'}`,
    `마지막 전략 추적 실행: ${m.strategy && m.strategy.last ? `${Math.round(m.strategy.last.ageMin === undefined ? 0 : m.strategy.last.ageMin)}분 전 · ${m.strategy.last.status} · 생성 ${m.strategy.last.created} · 추적 ${m.strategy.last.tracked} · 전송 ${m.strategy.last.sent}${m.strategy.last.failed ? ' · 실패 ' + m.strategy.last.failed : ''}${m.strategy.last.feed ? ' · 피드 ' + (m.strategy.last.feed.ok ? '정상' : m.strategy.last.feed.code) : ''}` : '기록 없음'}`,
    `마지막 관리 동작: ${m.opsLast ? `${m.opsLast.ageMin}분 전 · ${m.opsLast.action} · ${m.opsLast.code}` : '기록 없음'}`];
  const pre = m.precheck ? `마지막 사전 점검: ${m.precheck.ageMin}분 전 · ${m.precheck.ok ? '통과' : '실패'}${m.precheck.ok && m.precheck.ageMin >= 15 ? ' (15분 지나 만료 — 다시 점검)' : ''}` : '사전 점검 기록 없음';
  const watchUrl = opsUrl(appUrl, 'p=watch'), posUrl = opsUrl(appUrl, 'p=pos'), self = opsUrl(appUrl, 'p=ops');
  const body = `<header><h1>RICH 300 · 실전 감시 관리</h1></header>${dashNav('', appUrl)}
<section class="card"><div class="k">현재 상태 (값 비노출)</div><ul class="warn" style="list-style:none;padding:0">${rows.map(li).join('')}</ul></section>
<section class="card"><div class="k">1. 사전 점검 (읽기 전용)</div><div class="sub">Telegram 연결 · 시세 연결(OKX/Bybit) · 감시 미리보기를 확인합니다. 메시지를 보내지 않고 설정·트리거를 바꾸지 않습니다. ${dashEsc(pre)}</div>
<button id="pre" class="go" type="button">사전 점검 실행</button><div id="preMsg" class="msg" role="status" aria-live="polite"></div><ul id="preList" class="warn" style="list-style:none;padding:0"></ul></section>
<section class="card"><div class="k">2. 실전 감시 시작</div><div class="sub">사전 점검에 통과해야 시작할 수 있습니다. 시작하면 운영 승인(<code>RICH300_PROD_APPROVED=yes</code>)과 <code>RICH300_WATCH_ALERTS=on</code> 을 설정하고 5분 감시 트리거를 1개만 설치한 뒤, 실제 값을 다시 조회해 확인합니다. 실패하면 모두 되돌립니다. 손절·익절 알림이 Telegram 으로 전송됩니다(자동 주문은 없습니다).</div>
<label for="phrase">확인 문구: <strong>${dashEsc(OPS_PHRASE)}</strong> 를 입력</label><input id="phrase" autocomplete="off" placeholder="${dashEsc(OPS_PHRASE)}">
<button id="on" class="go" type="button" disabled>실전 감시 시작</button><div id="onMsg" class="msg" role="status" aria-live="polite"></div></section>
<section class="card"><div class="k">3. 감시 중지</div><div class="sub">즉시 <code>RICH300_WATCH_ALERTS=off</code> 로 바꾸고 5분 트리거를 제거합니다. 운영 승인 플래그와 시트·Telegram 연결 정보는 그대로 둡니다. 운영 승인이 남아 있어도 감시 설정이 off 이면 감시 전송은 차단됩니다.<br><strong>주의:</strong> 중지를 누르는 순간 이미 실행 중이던 감시가 있으면 그 <strong>최대 1회 실행</strong>은 끝까지 진행될 수 있습니다(그 실행에서 알림이 나갈 수 있음). 그다음 실행부터는 전송되지 않습니다.</div>
<button id="off" class="go stop" type="button">감시 중지</button><div id="offMsg" class="msg" role="status" aria-live="polite"></div></section>
<section class="card"><div class="k">4. 추천 전략 자동 추적 (COIN RADAR 추천 → 자동 전략·가상 추적)</div><div class="sub">추천이 생기면 RICH300 이 진입 구간·분할 진입·손절·TP·트레일링을 만들어 Telegram 으로 알리고 종료까지 <strong>가상으로</strong> 추적합니다(수동 등록 불필요, 실제 주문·체결 아님). 위 실제 포지션 감시와 별개로 켜고 끕니다. 켜면 운영 승인(<code>RICH300_PROD_APPROVED=yes</code>)과 <code>RICH300_STRATEGY=on</code>, 5분 트리거(이미 있으면 공유)가 설정됩니다. <strong>COIN RADAR 의 GitHub 쪽 설정 <code>RADAR_RICH300_FEED=on</code> + 서명 키 Secret 이 먼저 있어야 추천이 전달됩니다.</strong></div>
${m.strategy && m.strategy.keySet ? '<div class="sub">피드 서명 키: 등록됨(값은 표시하지 않습니다)</div>' : `<label for="fkey">피드 서명 키 (선택 · 32자 이상 영문/숫자/_-, 값은 저장 후 표시되지 않음)</label><input id="fkey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="GitHub Secret RICH300_FEED_KEY 와 같은 값"><button id="fkeyBtn" class="go" type="button">서명 키 저장</button><div id="fkeyMsg" class="msg" role="status" aria-live="polite"></div>`}
<button id="spre" class="go" type="button">전략 추적 사전 점검 (읽기 전용)</button><div id="spreMsg" class="msg" role="status" aria-live="polite"></div><ul id="spreList" class="warn" style="list-style:none;padding:0"></ul>
<label for="sphrase">확인 문구: <strong>${dashEsc(OPS_STRAT_PHRASE)}</strong> 를 입력</label><input id="sphrase" autocomplete="off" placeholder="${dashEsc(OPS_STRAT_PHRASE)}">
<button id="son" class="go" type="button" disabled>전략 추적 시작</button><div id="sonMsg" class="msg" role="status" aria-live="polite"></div>
<button id="soff" class="go stop" type="button">전략 추적 중지</button><div class="sub">중지하면 <code>RICH300_STRATEGY=off</code> 로 바꾸고, 실전 위치 감시가 꺼져 있을 때만 5분 트리거를 제거합니다. 이미 실행 중이던 1회 실행은 끝까지 진행될 수 있습니다. 진행 중이던 전략은 기록에 남고 추적만 멈춥니다.</div><div id="soffMsg" class="msg" role="status" aria-live="polite"></div></section>
<section class="card"><a id="reload" class="cta" hidden target="_top"${self ? ` href="${dashEsc(self)}"` : ''}>새로고침</a>${watchUrl ? ` <a class="cta" target="_top" href="${dashEsc(watchUrl)}">감시 점검 화면</a>` : ''}${posUrl ? ` <a class="cta" target="_top" href="${dashEsc(posUrl)}">포지션 등록</a>` : ''}
<div class="sub">이 화면은 열기만 해서는 아무것도 바꾸지 않습니다. 임의의 설정은 바꿀 수 없고(허용 목록: 운영 승인·감시 설정), 소유자만 실행됩니다. 기록 전용 · 자동 주문 없음.</div></section>`;
  const css = `<style>[hidden]{display:none!important}label{display:block;font-size:13px;color:var(--mute);margin:12px 0 4px}input{width:100%;padding:12px;font-size:16px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink);min-height:46px}
.go{width:100%;margin-top:12px;padding:14px;font-size:16px;border:0;border-radius:10px;background:var(--accent);color:#fff;min-height:48px;touch-action:manipulation}.go:disabled{opacity:.5}.go.stop{background:var(--bad)}
.msg{margin-top:10px;white-space:pre-wrap;font-size:14px}.msg.bad{color:var(--bad)}.msg.ok{color:var(--good)}code{font-size:12px}</style>`;
  const script = `<script>(function(){var $=function(i){return document.getElementById(i)},passed=false,busy={};
var say=function(id,t,c){var e=$(id);if(!e)return;e.textContent=t;e.classList.remove('bad');e.classList.remove('ok');if(c)e.classList.add(c);try{e.scrollIntoView({block:'nearest'})}catch(x){}};
var sync=function(){$('on').disabled=!(passed&&$('phrase').value.trim()===${JSON.stringify(OPS_PHRASE)}&&!busy.on)};
var run=function(fn,args,ok,out,fail){if(!(window.google&&google.script&&google.script.run)){say(out,'서버 연결(google.script.run)을 쓸 수 없습니다. 앱 주소(/exec)를 브라우저에서 직접 열어 주세요.','bad');fail&&fail();return}
var t=setTimeout(function(){say(out,'응답이 늦습니다(60초). 상태가 바뀌었을 수 있으니 새로고침해서 확인하세요.','bad');var a=$('reload');if(a)a.hidden=false;fail&&fail()},60000);
var r=google.script.run.withSuccessHandler(function(x){clearTimeout(t);ok(x||{})}).withFailureHandler(function(e){clearTimeout(t);var m='';try{m=String(e&&e.message||e||'').slice(0,100)}catch(z){}say(out,'서버 호출 실패'+(m?': '+m:'')+' — 상태가 불확실합니다. 새로고침해서 확인하세요.','bad');var a=$('reload');if(a)a.hidden=false;fail&&fail()});r[fn].apply(r,args)};
var CODES={forbidden:'소유자 계정으로 열려 있지 않습니다.',busy:'다른 관리 작업이 진행 중입니다. 잠시 후 다시 누르세요.',phrase:'확인 문구가 맞지 않습니다.','precheck-required':'사전 점검 통과 기록이 없거나 만료됐습니다(15분). 사전 점검을 다시 실행하세요.','tg-not-ready':'Telegram 연결(토큰·페어링·전송 가드)이 준비되지 않았습니다.','verify-failed':'설정 확인에 실패했습니다.','rollback-failed':'되돌리기 확인에 실패했습니다 — 즉시 [감시 중지]를 누르고 알려 주세요.',exception:'서버 오류가 났습니다.'};
$('phrase').addEventListener('input',sync);
$('pre').onclick=function(){if(busy.pre)return;busy.pre=true;$('pre').disabled=true;passed=false;sync();say('preMsg','점검 중… (시세 조회로 10~30초 걸릴 수 있습니다)');$('preList').textContent='';
run('rich300OpsPrecheck',[],function(r){busy.pre=false;$('pre').disabled=false;if(!r.ok){say('preMsg',CODES[r.code]||('점검하지 못했습니다('+(r.code||'error')+')'),'bad');return}
(r.items||[]).forEach(function(i){var l=document.createElement('li');l.textContent=(i.ok?'✓ ':(i.must?'✗ ':'△ '))+i.text;$('preList').appendChild(l)});
passed=!!r.pass;say('preMsg',passed?'사전 점검 통과 — 아래 확인 문구를 입력하면 시작할 수 있습니다(15분 이내).':'사전 점검 실패 — 시작할 수 없습니다. ✗ 항목을 해결한 뒤 다시 점검하세요.',passed?'ok':'bad');sync()},'preMsg',function(){busy.pre=false;$('pre').disabled=false})};
$('on').onclick=function(){if(busy.on)return;busy.on=true;sync();say('onMsg','시작 중… 설정·트리거를 적용하고 다시 조회해 확인합니다.');
run('rich300OpsEnable',[$('phrase').value.trim()],function(r){busy.on=false;if(r.ok){say('onMsg',(r.code==='already-on'?'이미 켜져 있습니다. ':'실전 감시를 시작했습니다. ')+'확인: 운영 승인 있음 · 감시 on · 트리거 '+r.triggers+'개. 첫 실행은 최대 5분 뒤입니다.','ok');$('reload').hidden=false}
else{say('onMsg','시작하지 않았습니다['+(r.code||'error')+']: '+(CODES[r.code]||'원인을 알 수 없습니다.')+(r.rolledBack?'\\n이전 상태로 되돌렸습니다(감시 off).':''),'bad');if(r.code==='rollback-failed')$('reload').hidden=false;sync()}},'onMsg',function(){busy.on=false;sync()})};
$('off').onclick=function(){if(busy.off)return;busy.off=true;$('off').disabled=true;say('offMsg','중지 중…');
run('rich300OpsDisable',[],function(r){busy.off=false;$('off').disabled=false;say('offMsg',r.ok?'감시를 중지했습니다: 설정 off · 트리거 '+r.triggers+'개.':'중지 확인에 실패했습니다['+(r.code||'error')+'] — 다시 [감시 중지]를 누르세요.',r.ok?'ok':'bad');$('reload').hidden=false},'offMsg',function(){busy.off=false;$('off').disabled=false})};
var spassed=false,ssync=function(){$('son').disabled=!(spassed&&$('sphrase').value.trim()===${JSON.stringify(OPS_STRAT_PHRASE)}&&!busy.son)};
$('sphrase').addEventListener('input',ssync);
if($('fkeyBtn'))$('fkeyBtn').onclick=function(){if(busy.fk)return;var v=$('fkey').value.replace(/\\s/g,'');if(!v){say('fkeyMsg','키 칸이 비어 있습니다.','bad');return}busy.fk=true;$('fkeyBtn').disabled=true;say('fkeyMsg','저장 중…');
run('rich300OpsSetFeedKey',[v],function(r){busy.fk=false;if(r.ok){$('fkey').value='';$('fkey').style.display='none';$('fkeyBtn').style.display='none';say('fkeyMsg','서명 키를 저장했습니다(값은 표시하지 않습니다). 새로고침하세요.','ok');$('reload').hidden=false}else{$('fkeyBtn').disabled=false;say('fkeyMsg','저장하지 않음['+(r.code||'error')+']: '+(CODES[r.code]||(r.code==='bad-format'?'32자 이상 영문·숫자·_- 만 가능합니다.':r.code==='already-set'?'이미 키가 저장돼 있습니다.':'원인을 알 수 없습니다.')),'bad')}},'fkeyMsg',function(){busy.fk=false;$('fkeyBtn').disabled=false})};
$('spre').onclick=function(){if(busy.spre)return;busy.spre=true;$('spre').disabled=true;spassed=false;ssync();say('spreMsg','점검 중… (피드·시세 조회로 10~40초 걸릴 수 있습니다)');$('spreList').textContent='';
run('rich300OpsStratPrecheck',[],function(r){busy.spre=false;$('spre').disabled=false;if(!r.ok){say('spreMsg',CODES[r.code]||('점검하지 못했습니다('+(r.code||'error')+')'),'bad');return}
(r.items||[]).forEach(function(i){var l=document.createElement('li');l.textContent=(i.ok?'✓ ':(i.must?'✗ ':'△ '))+i.text;$('spreList').appendChild(l)});
spassed=!!r.pass;say('spreMsg',spassed?'사전 점검 통과 — 확인 문구를 입력하면 시작할 수 있습니다(15분 이내).':'사전 점검 실패 — 시작할 수 없습니다. ✗ 항목을 해결한 뒤 다시 점검하세요.',spassed?'ok':'bad');ssync()},'spreMsg',function(){busy.spre=false;$('spre').disabled=false})};
$('son').onclick=function(){if(busy.son)return;busy.son=true;ssync();say('sonMsg','시작 중… 설정·트리거를 적용하고 다시 조회해 확인합니다.');
run('rich300OpsStratEnable',[$('sphrase').value.trim()],function(r){busy.son=false;if(r.ok){say('sonMsg',(r.code==='already-on'?'이미 켜져 있습니다. ':'추천 전략 자동 추적을 시작했습니다. ')+'트리거 '+r.triggers+'개. 다음 추천부터 자동으로 전략이 만들어집니다.','ok');$('reload').hidden=false}
else{say('sonMsg','시작하지 않았습니다['+(r.code||'error')+']: '+(CODES[r.code]||'원인을 알 수 없습니다.')+(r.rolledBack?'\\n이전 상태로 되돌렸습니다.':''),'bad');ssync()}},'sonMsg',function(){busy.son=false;ssync()})};
$('soff').onclick=function(){if(busy.soff)return;busy.soff=true;$('soff').disabled=true;say('soffMsg','중지 중…');
run('rich300OpsStratDisable',[],function(r){busy.soff=false;$('soff').disabled=false;say('soffMsg',r.ok?'전략 추적을 중지했습니다: 설정 off · 트리거 '+r.triggers+'개.':'중지 확인에 실패했습니다['+(r.code||'error')+'] — 다시 [전략 추적 중지]를 누르세요.',r.ok?'ok':'bad');$('reload').hidden=false},'soffMsg',function(){busy.soff=false;$('soff').disabled=false})};
})()</script>`;
  return `${dashHead('RICH300 실전 감시 관리')}<body><main>${css}${body}</main>${script}</body></html>`;
}
