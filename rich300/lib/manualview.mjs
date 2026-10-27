// 수동 포지션 등록 화면(?p=pos) HTML. 서버에서 완성된 HTML + 작은 인라인 스크립트(입력 보조 계산·제출). 모든 동적 값은 dashEsc.
//  · 입력: 종목(자유 입력 + 자주 쓰는 종목 버튼), LONG/SHORT, 실제 진입가, 수량(또는 증거금), 레버리지, 손절가, 1·2차 익절가. 입력하면서 손절까지 거리·예상 손실·R 을 바로 보여 준다(계산만, 저장 아님).
//  · 저장 버튼을 눌러야 기록된다. 같은 화면에서 다시 눌러도 한 번만 기록된다(formId). 결과·경고는 버튼 바로 아래에 표시한다.
//  · 주문 기능 없음: Binance 에서 직접 체결한 뒤 그 값을 기록하는 화면이다.
import { dashEsc, dashHead, dashNav } from './dashview.mjs';
import { MANUAL_QUICK } from './manual.mjs';

const mvUrl = (appUrl, q) => (typeof appUrl === 'string' && /^https:\/\/\S+$/.test(appUrl) ? `${appUrl}${appUrl.includes('?') ? '&' : '?'}${q}` : null);
const mvNum = v => (v == null || v === '' ? '—' : dashEsc(String(v)));
const mvCss = `<style>[hidden]{display:none!important}label{display:block;font-size:13px;color:var(--mute);margin:12px 0 4px}input{width:100%;padding:12px;font-size:16px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink);min-height:46px}
.seg{display:flex;gap:8px}.seg button,.chips button{flex:1;padding:10px;min-height:44px;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:8px;font-size:15px}.seg button[aria-pressed="true"]{border-color:var(--accent);color:var(--accent);font-weight:650}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.chips button{flex:0 0 auto;padding:6px 12px;min-height:38px;font-size:14px}.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.go{width:100%;margin-top:16px;padding:14px;font-size:17px;border:0;border-radius:10px;background:var(--accent);color:#fff;min-height:48px;touch-action:manipulation}.go:disabled{opacity:.6}
.msg{margin-top:12px;white-space:pre-wrap;font-size:14px}.msg.bad{color:var(--bad)}.msg.ok{color:var(--good)}.calc{margin-top:10px;font-size:13px;color:var(--ink2);background:var(--bg);border-radius:8px;padding:8px 10px}
.pill{display:inline-block;font-size:12px;border:1px solid var(--line);border-radius:999px;padding:1px 9px;margin-right:6px}.row{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.pc{padding:10px 0;border-bottom:1px solid var(--line)}.pc:last-child{border:0}
details>summary{cursor:pointer;font-size:13px;color:var(--ink2);margin-top:12px;min-height:40px}.mini{padding:8px 12px;min-height:40px;font-size:14px;border:1px solid var(--accent);border-radius:10px;background:transparent;color:var(--ink);text-decoration:none;display:inline-block;margin:6px 6px 0 0}</style>`;

export function manualRenderHtml({ open = [], appUrl = '', build = 'dev', now = Date.now() } = {}) {
  const list = open.length ? open.map(p => {
    const fillUrl = mvUrl(appUrl, `p=fill&mode=exit&sid=${encodeURIComponent(p.sid)}`), sid = dashEsc(p.sid);
    return `<div class="pc" data-sid="${sid}"><div class="row"><div><span class="pill">${dashEsc(p.dir)}</span><strong>${dashEsc(p.symbolId.replace(/USDT$/, ''))}</strong></div><div class="sub">평균 ${mvNum(p.avgEntry)} · 수량 ${mvNum(p.openQty)}</div></div>`
      + `<div class="sub">손절 ${mvNum(p.stop)} · 1차 익절 ${mvNum(p.tp1)} · 2차 익절 ${mvNum(p.tp2)}${p.symbolCheck === 'unverified' ? ' · 종목 미확인' : ''}</div>`
      + `<div>${fillUrl ? `<a class="mini" target="_top" href="${dashEsc(fillUrl)}">청산 기록</a>` : ''}<button type="button" class="mini ed" data-sid="${sid}">손절·익절 수정</button></div>`
      + `<div class="edbox" data-for="${sid}" hidden><div class="two"><div><label>손절가(좁히기만)</label><input class="e-stop" inputmode="decimal" value="${dashEsc(p.stop)}"></div><div><label>1차 익절가(비우면 삭제)</label><input class="e-tp1" inputmode="decimal" value="${dashEsc(p.tp1 != null ? p.tp1 : '')}"></div></div>`
      + `<label>2차 익절가(비우면 삭제)</label><input class="e-tp2" inputmode="decimal" value="${dashEsc(p.tp2 != null ? p.tp2 : '')}"><button type="button" class="go e-save" data-sid="${sid}">수정 저장</button><div class="msg e-msg" role="status"></div></div></div>`;
  }).join('') : '<p class="sub">등록된 보유 포지션이 없습니다. 아래에서 Binance 에서 체결한 포지션을 등록하세요. 등록한 보유 포지션만 감시 대상이 됩니다.</p>';
  const chips = MANUAL_QUICK.map(s => `<button type="button" data-sym="${dashEsc(s)}">${dashEsc(s)}</button>`).join('');
  const body = `<header><h1>RICH 300 · 포지션 등록</h1></header>${dashNav('pos', appUrl)}
<section class="card"><div class="k">보유 중 (수동 등록)</div>${list}</section>
<section class="card"><div class="k">Binance 포지션 등록</div><div class="sub">주문 기능이 없습니다. Binance 에서 직접 체결한 뒤 실제 체결 값을 기록하세요. 어떤 USDT 선물 종목이든 등록할 수 있습니다.</div>
<label for="sym">종목 (예: BTC, ETHUSDT)</label><input id="sym" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="BTC"><div class="chips" role="group" aria-label="자주 쓰는 종목">${chips}</div>
<label>방향</label><div class="seg" role="group" aria-label="방향"><button type="button" id="dL" aria-pressed="true">LONG</button><button type="button" id="dS" aria-pressed="false">SHORT</button></div>
<div class="two"><div><label for="entry">실제 진입가</label><input id="entry" inputmode="decimal"></div><div><label for="lev">레버리지</label><input id="lev" inputmode="decimal" value="3"></div></div>
<div class="two"><div><label for="qty">수량</label><input id="qty" inputmode="decimal"></div><div><label for="margin">증거금 (USDT)</label><input id="margin" inputmode="decimal"></div></div>
<div class="sub">수량과 증거금 중 하나만 입력해도 됩니다(나머지는 자동 계산).</div>
<div class="two"><div><label for="stop">손절가 (필수)</label><input id="stop" inputmode="decimal"></div><div><label for="tp1">1차 익절가</label><input id="tp1" inputmode="decimal"></div></div>
<label for="tp2">2차 익절가</label><input id="tp2" inputmode="decimal">
<div id="calc" class="calc" aria-live="polite">값을 입력하면 손절 거리와 예상 손실이 여기에 계산됩니다(저장 아님).</div>
<details><summary>체결 시각·수수료·펀딩 (선택)</summary><label for="at">체결 시각 (예: 14:30 또는 10-24 14:30, 비우면 지금)</label><input id="at" inputmode="text" autocomplete="off"><div class="two"><div><label for="fee">수수료 (USDT)</label><input id="fee" inputmode="text"></div><div><label for="fund">펀딩 (USDT)</label><input id="fund" inputmode="text"></div></div></details>
<button id="go" class="go" type="button">포지션 저장</button><div id="msg" class="msg" role="status" aria-live="polite"></div><a id="reload" class="cta" hidden target="_top"${mvUrl(appUrl, 'p=pos') ? ` href="${dashEsc(mvUrl(appUrl, 'p=pos'))}"` : ''}>새로고침</a>
<div class="sub">저장 버튼을 눌러야 기록됩니다. 같은 화면에서 다시 눌러도 한 번만 기록됩니다. 규칙(레버리지 3배·손실 1.5% 등)을 넘으면 경고만 표시하고 막지 않습니다.</div></section>
<section class="card"><div class="sub">감시 알림(손절 접근·이탈, 익절, 추적손절)은 운영 승인 후 켜집니다. 지금은 켜지 않았습니다. 빌드 ${dashEsc(build)} · 갱신 ${dashEsc(new Date(now + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' '))} KST</div></section>`;
  const script = `<script>(function(){var $=function(i){return document.getElementById(i)},dir='LONG',busy=false,fid=(window.crypto&&crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9]/g,'').slice(0,10);
var say=function(id,t,c){var e=typeof id==='string'?$(id):id;if(!e)return;e.textContent=t;e.classList.remove('bad');e.classList.remove('ok');if(c)e.classList.add(c);try{e.scrollIntoView({block:'nearest'})}catch(x){}};
var num=function(id){var v=parseFloat(($(id).value||'').replace(/,/g,''));return isFinite(v)?v:null};
var setDir=function(d){dir=d;$('dL').setAttribute('aria-pressed',String(d==='LONG'));$('dS').setAttribute('aria-pressed',String(d==='SHORT'));calc()};
var calc=function(){var e=num('entry'),s=num('stop'),q=num('qty'),m=num('margin'),l=num('lev'),el=$('calc');if(e===null||s===null){el.textContent='값을 입력하면 손절 거리와 예상 손실이 여기에 계산됩니다(저장 아님).';return}
var sg=dir==='LONG'?1:-1,d=(e-s)*sg,t=[];if(d<=0){el.textContent='⚠ '+dir+' 손절가는 진입가보다 '+(dir==='LONG'?'아래':'위')+'여야 합니다.';return}
if(q===null&&m!==null&&l!==null&&e>0)q=m*l/e;if(m===null&&q!==null&&l){m=e*q/l}
t.push('손절까지 '+(d/e*100).toFixed(2)+'%'+(l?' · 증거금 대비 '+(d/e*l*100).toFixed(0)+'%':''));if(q!==null){t.push('손절 시 손실 약 '+(d*q).toFixed(2)+' USDT');t.push('수량 '+Number(q.toPrecision(6))+(num('qty')===null?'(계산)':''))}
if(m!==null&&num('margin')===null)t.push('증거금 '+m.toFixed(2)+'(계산)');
var a=num('tp1');if(a!==null){var r=(a-e)*sg/d;t.push('1차 익절 '+(r>0?r.toFixed(2)+'R':'⚠ 방향 반대'))}var b=num('tp2');if(b!==null){var r2=(b-e)*sg/d;t.push('2차 익절 '+(r2>0?r2.toFixed(2)+'R':'⚠ 방향 반대'))}
el.textContent=t.join(' · ')};
var run=function(fn,args,ok,out,fail){if(!(window.google&&google.script&&google.script.run)){say(out,'서버 연결(google.script.run)을 쓸 수 없습니다. 앱 주소(/exec)를 브라우저에서 직접 열어 주세요.','bad');if(fail)fail();return}
var t=setTimeout(function(){say(out,'응답이 늦습니다(30초). 저장됐을 수 있으니 새로고침해 확인하세요. 같은 화면에서 다시 눌러도 중복 저장되지 않습니다.','bad');if(fail)fail()},30000);
var r=google.script.run.withSuccessHandler(function(x){clearTimeout(t);ok(x||{})}).withFailureHandler(function(e){clearTimeout(t);var m='';try{m=String(e&&e.message||e||'').slice(0,100)}catch(z){}say(out,'서버 호출 실패'+(m?': '+m:'')+' — 같은 화면에서 다시 눌러도 중복 저장되지 않습니다.','bad');if(fail)fail()});r[fn].apply(r,args)};
$('dL').onclick=function(){setDir('LONG')};$('dS').onclick=function(){setDir('SHORT')};
[].forEach.call(document.querySelectorAll('[data-sym]'),function(b){b.onclick=function(){$('sym').value=b.getAttribute('data-sym')}});
['entry','qty','margin','lev','stop','tp1','tp2'].forEach(function(i){$(i).addEventListener('input',calc)});
$('go').onclick=function(){if(busy)return;busy=true;$('go').disabled=true;$('go').textContent='저장 중…';say('msg','저장 중…');
var f={formId:fid,symbol:$('sym').value.trim(),dir:dir,entry:$('entry').value.trim(),qty:$('qty').value.trim(),leverage:$('lev').value.trim(),margin:$('margin').value.trim(),stop:$('stop').value.trim(),tp1:$('tp1').value.trim(),tp2:$('tp2').value.trim(),at:$('at').value.trim(),fee:$('fee').value.trim(),funding:$('fund').value.trim()};
var end=function(){busy=false;$('go').disabled=false;$('go').textContent='포지션 저장'};
run('rich300ManualRegister',[f],function(r){end();if(r.ok){var w=(r.warnings||[]).map(function(x){return '⚠ '+x}).join('\\n');say('msg',(r.status==='duplicate'?'이미 저장됨':'저장됨 ✓')+' · '+r.symbolId+' '+r.dir+' · 진입 '+r.entry+' · 수량 '+r.qty+' · 손절 '+r.stop+(w?'\\n'+w:'')+'\\n목록은 새로고침하면 보입니다.','ok');$('reload').hidden=false}else say('msg',(r.message||(r.error==='busy'?'다른 작업 중입니다. 잠시 후 다시 눌러 주세요.':r.error==='forbidden'?'소유자 계정으로 열려 있지 않습니다.':'저장하지 못했습니다.'))+'\\n고친 뒤 다시 눌러 주세요.','bad')},'msg',end)};
[].forEach.call(document.querySelectorAll('.ed'),function(b){b.onclick=function(){var s=b.getAttribute('data-sid'),bx=document.querySelector('.edbox[data-for="'+s+'"]');if(bx)bx.hidden=!bx.hidden}});
[].forEach.call(document.querySelectorAll('.e-save'),function(b){b.onclick=function(){var s=b.getAttribute('data-sid'),bx=document.querySelector('.edbox[data-for="'+s+'"]'),m=bx.querySelector('.e-msg');b.disabled=true;
run('rich300ManualUpdate',[s,{stop:bx.querySelector('.e-stop').value.trim(),tp1:bx.querySelector('.e-tp1').value.trim(),tp2:bx.querySelector('.e-tp2').value.trim()}],function(r){b.disabled=false;if(r.ok){say(m,(r.status==='unchanged'?'바뀐 값이 없습니다.':'수정 저장됨 ✓')+' 손절 '+r.stop+' · 1차 '+(r.tp1||'없음')+' · 2차 '+(r.tp2||'없음')+'\\n새로고침하면 목록에 반영됩니다.','ok');$('reload').hidden=false}else say(m,(r.message||'수정하지 못했습니다.'),'bad')},m,function(){b.disabled=false})}});
})()</script>`;
  return `${dashHead('RICH300 포지션 등록')}<body><main>${mvCss}${body}</main>${script}</body></html>`;
}
