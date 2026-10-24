// R7 일지 화면 HTML 렌더러(서버 측, 순수 함수). 모바일 우선 · 외부 자원 없음 · 모든 동적 값 이스케이프 · 읽기/수정은 google.script.run 서버 함수로만(소유자 확인은 서버 측).
//  수정 UI에는 사유 입력이 필수이고, 저장 결과(변경 이력)는 일지에서 diff로 확인한다. 어떤 입력도 기본값으로 자동 저장하지 않는다.
export const jvEsc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jvE = jvEsc, JV_ARROW = (p, n) => (p ? '▲' : n ? '▼' : '■'), JV_TONE = (p, n) => (p ? 'pos' : n ? 'neg' : 'zero');
const JV_NOTICE = { off: '알림 꺼짐', sent: '알림 발송됨', failed: '알림 실패', pending: '알림 발송 중', unknown: '알림 결과 불명' };

const JV_CSS = `
:root{color-scheme:light;--bg:#f6f7f9;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--mute:#6b6a66;--line:#dcdbd6;--s1:#2a78d6;--s2:#eb6834;--good:#17794f;--bad:#c62828;--warnbg:#fff4d6;--warnink:#6b4a00;--track:#e8e7e2}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){color-scheme:dark;--bg:#111110;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--mute:#a09f96;--line:#33332f;--s1:#3987e5;--s2:#d95926;--good:#3ddc97;--bad:#ff7b7b;--warnbg:#3a3000;--warnink:#ffd866;--track:#2a2a27}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#111110;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--mute:#a09f96;--line:#33332f;--s1:#3987e5;--s2:#d95926;--good:#3ddc97;--bad:#ff7b7b;--warnbg:#3a3000;--warnink:#ffd866;--track:#2a2a27}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Noto Sans KR","Apple SD Gothic Neo",sans-serif;font-variant-numeric:tabular-nums;padding:0 max(16px,env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
main{max-width:560px;margin:0 auto}header{padding:16px 0 4px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px 8px}
h1{font-size:18px;margin:0}h2{font-size:15px;margin:0 0 8px;color:var(--ink2);font-weight:600}section{margin:16px 0}.sub{font-size:12px;color:var(--mute)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:10px}.pos{color:var(--good)}.neg{color:var(--bad)}.zero{color:var(--ink2)}
.badge{display:inline-block;font-size:11px;border:1px solid var(--line);border-radius:999px;padding:1px 8px;color:var(--ink2);white-space:nowrap}.badge.warn{background:var(--warnbg);color:var(--warnink);border-color:transparent}
.row{display:flex;justify-content:space-between;gap:8px;align-items:center}.day{padding:8px 0;border-top:1px solid var(--line)}.day:first-of-type{border-top:0}
label{display:block;font-size:12px;color:var(--mute);margin:10px 0 4px}input,select{width:100%;padding:10px 12px;font:inherit;font-size:16px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink);min-width:0}
button.act{font:inherit;font-size:15px;min-height:44px;padding:0 16px;border-radius:10px;border:1px solid var(--s1);background:var(--s1);color:#fff;margin-top:10px}button.act.alt{background:none;color:var(--ink);border-color:var(--line)}button.act:disabled{opacity:.5}
.out{margin-top:8px;font-size:13px;white-space:pre-wrap}.out.bad{color:var(--bad)}.out.ok{color:var(--good)}
.stat dl,.mini dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:13px}.stat dt,.mini dt{color:var(--mute)}.stat dd,.mini dd{margin:0;text-align:right}.stat h3{font-size:14px;margin:0 0 6px}
details.trade{border-top:1px solid var(--line);padding:8px 0}details.trade:first-of-type{border-top:0}details.trade>summary{cursor:pointer;min-height:44px;display:flex;justify-content:space-between;align-items:center;gap:8px;list-style:none}details.trade>summary::-webkit-details-marker{display:none}
.pill{display:inline-block;font-size:11px;font-weight:650;border:1px solid currentColor;border-radius:6px;padding:0 6px;margin-right:6px;color:var(--ink2)}
.fill{border-top:1px dashed var(--line);padding:8px 0;font-size:13px}.fill:first-child{border-top:0}.edits{margin:6px 0 0;padding-left:16px;font-size:12px;color:var(--ink2)}.edits li{margin:2px 0}.chg{color:var(--mute)}
details.edit{margin-top:6px}details.edit>summary{cursor:pointer;min-height:36px;display:flex;align-items:center;font-size:13px;color:var(--s1)}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px}
ul.plain{margin:0;padding-left:18px;font-size:13px;color:var(--ink2)}ul.plain li{margin:3px 0}footer{font-size:11px;color:var(--mute);margin:18px 0 0;text-align:center}
`;
const jvHead = t => `<!DOCTYPE html><html lang="ko"><jvHead><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${jvE(t)}</title><style>${JV_CSS}</style></jvHead>`;
export const journalRenderError = () => `${jvHead('RICH300 일지')}<body><main><header><h1>RICH 300 일지</h1></header><section class="card"><p>일지를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.</p></section></main></body></html>`;

const jvStat = (name, s) => `<div class="card stat"><h3>${jvE(name)} ${s.lowSample ? '<span class="badge warn">표본 부족</span>' : ''}</h3><dl><dt>청산 거래</dt><dd>${s.n}건 (승 ${s.wins} · 패 ${s.losses}${s.flat ? ` · 무 ${s.flat}` : ''})</dd><dt>승률</dt><dd>${jvE(s.winRate)} <span class="sub">(95% 구간 ${jvE(s.winRateRange)})</span></dd><dt>평균 이익 / 손실</dt><dd>${jvE(s.avgWin)} / ${jvE(s.avgLoss)}</dd><dt>손익비</dt><dd>${jvE(s.payoff)}</dd><dt>Profit factor</dt><dd>${jvE(s.profitFactor)}</dd><dt>기대값(건당)</dt><dd class="${JV_TONE(s.expectancyPositive, s.expectancyNegative)}">${JV_ARROW(s.expectancyPositive, s.expectancyNegative)} ${jvE(s.expectancy)} USDT${s.rCoverage ? ` <span class="sub">(${jvE(s.expectancyR)}, ${s.rCoverage}건 기준)</span>` : ''}</dd><dt>최대 낙폭(거래 기준)</dt><dd>${jvE(s.maxDd)} USDT <span class="sub">(${jvE(s.maxDdOfStart)})</span></dd><dt>순손익</dt><dd class="${JV_TONE(s.netPositive, s.netNegative)}">${JV_ARROW(s.netPositive, s.netNegative)} ${jvE(s.net)} USDT</dd></dl></div>`;
const jvGrp = g => `<div class="card mini"><div class="row"><strong>${jvE(g.label)}</strong><span class="sub">${g.n}건${g.lowSample ? ' · 표본 부족' : ''}</span></div><dl><dt>승률</dt><dd>${jvE(g.winRate)}</dd><dt>기대값</dt><dd class="${JV_TONE(g.expectancyPositive, g.expectancyNegative)}">${jvE(g.expectancy)}</dd><dt>순손익</dt><dd>${jvE(g.net)}</dd></dl></div>`;

function jvCloseHtml(m) {
  const rows = m.closes.map(c => `<div class="day"><div class="row"><strong>${jvE(c.day)}${c.today ? ' <span class="sub">오늘</span>' : ''}</strong><span>${c.closed ? '<span class="badge">마감됨</span>' : '<span class="badge">마감 전</span>'} ${c.equity !== null ? `<span class="badge">평가액 ${jvE(c.equity)}${c.late ? ' · 마감 후 입력' : ''}</span>` : c.closed ? '<span class="badge warn">평가액 미입력</span>' : ''}</span></div>`
    + `${c.diffMicro !== null && c.needsReview ? `<div class="sub">⚠ 장부와 차이(마감 시점 ${jvE(c.diffLabel)} USDT)</div>` : ''}${c.flags.filter(f => m.warningText[f]).map(f => `<div class="sub">· ${jvE(m.warningText[f])}</div>`).join('')}${c.notice ? `<div class="sub">${jvE(JV_NOTICE[c.notice] ?? c.notice)}</div>` : ''}</div>`).join('');
  const opts = m.closes.map(c => `<option value="${jvE(c.day)}"${c.day === m.presetDay ? ' selected' : ''}>${jvE(c.day)}${c.closed && c.equity === null ? ' (미입력)' : ''}</option>`).join('');
  return `<section id="close" aria-labelledby="h-close"><h2 id="h-close">일 마감 (매일 00:00 KST)</h2><div class="card">${rows || '<div class="sub">아직 마감할 날이 없습니다.</div>'}</div>
<div class="card"><form id="eqForm"><strong>실제 계좌 평가액 입력</strong><div class="sub">거래소 화면의 평가액(미실현 포함)을 직접 입력합니다. 장부와 다르면 차이만 표시하며 손익에는 자동 반영하지 않습니다.</div>
<label for="eqDay">날짜</label><select id="eqDay">${opts}</select><label for="eqVal">평가액 (USDT)</label><input id="eqVal" inputmode="decimal" autocomplete="off"><label for="eqUn">미실현 손익 (선택, 보유 포지션이 있을 때)</label><input id="eqUn" inputmode="decimal" autocomplete="off"><label for="eqWhy">수정 사유 (이미 입력한 날짜를 고칠 때)</label><input id="eqWhy" autocomplete="off">
<button class="act" type="submit">저장</button><div class="out" id="eqOut" role="status"></div></form></div></section>`;
}
function jvTradeHtml(t) {
  const edits = es => (es.length ? `<ul class="edits">${es.map(h => `<li>${jvE(h.atLabel)} · rev ${h.rev} · ${h.op === 'void' ? '취소' : '수정'}${h.reason ? ` — ${jvE(h.reason)}` : ''}${h.changes.map(c => `<div class="chg">${jvE(c.field)}: ${jvE(c.from)} → ${jvE(c.to)}</div>`).join('')}</li>`).join('')}</ul>` : '');
  const fill = f => `<div class="fill"><div class="row"><strong>${jvE(f.kindLabel)}</strong><span>${jvE(f.atLabel)}</span></div><div>${jvE(f.price)} × ${jvE(f.qty)} · 수수료 ${jvE(f.fee)} · 펀딩 ${jvE(f.funding)}${f.edits.length ? ` <span class="badge">수정 ${f.edits.length}회</span>` : ''}</div>${edits(f.edits)}
<details class="edit"><summary>수정 / 취소</summary><form class="fillForm" data-fill="${jvE(f.fillId)}"><div class="grid2"><div><label>가격</label><input name="price" inputmode="decimal" value="${jvE(f.price)}" data-orig="${jvE(f.price)}"></div><div><label>수량</label><input name="qty" inputmode="decimal" value="${jvE(f.qty)}" data-orig="${jvE(f.qty)}"></div><div><label>수수료 (비움=미입력, ~=추정)</label><input name="fee" value="${jvE(f.feeEdit)}" data-orig="${jvE(f.feeEdit)}"></div><div><label>펀딩 (비움=미입력, ~=추정)</label><input name="funding" value="${jvE(f.fundingEdit)}" data-orig="${jvE(f.fundingEdit)}"></div></div>
<label>사유 (필수)</label><input name="reason" autocomplete="off"><div class="row"><button class="act" type="submit" data-act="revise">수정 저장</button><button class="act alt" type="submit" data-act="void">이 체결 취소</button></div><div class="out" role="status"></div></form></details></div>`;
  const dirTone = t.status === 'open' ? 'zero' : JV_TONE(t.win, t.loss);
  return `<details class="trade" data-dir="${jvE(t.dir)}"><summary><span><span class="pill">${jvE(t.dir)}</span><strong>${jvE(t.symbol ?? t.sid)}</strong>${t.strategy ? ` <span class="badge">${jvE(t.strategy)}전략</span>` : ''}<div class="sub">${jvE(t.openedLabel)}${t.closedLabel ? ` → ${jvE(t.closedLabel)}` : ' · 보유 중'}</div></span><span class="${dirTone}"><strong>${t.status === 'open' ? '진행' : `${JV_ARROW(t.win, t.loss)} ${jvE(t.netLabel)}`}</strong></span></summary>
<div class="sub">${t.response ? `응답: ${jvE(t.response.label)}` : '응답 기록 없음'} · 신호 ${jvE(t.sid)}</div>
${t.review ? `<div class="sub">복기: ${jvE(t.review.plan)} · ${jvE(t.review.mind)}${t.review.memo ? ` · ${jvE(t.review.memo)}` : ''} (${jvE(t.review.savedLabel)})</div>${edits(t.review.edits)}` : '<div class="sub">복기 안 함</div>'}
${t.fills.map(fill).join('')}${t.voidedFills.length ? `<div class="sub" style="margin-top:6px">취소된 체결(손익에서 제외됨)</div>${t.voidedFills.map(v => `<div class="fill"><div>${jvE(v.kindLabel)} · ${jvE(v.atLabel)} · ${jvE(v.price)} × ${jvE(v.qty)}</div>${edits(v.edits)}</div>`).join('')}` : ''}</details>`;
}
export function journalRenderHtml(m, { appUrl } = {}) {
  if (m.empty) return `${jvHead('RICH300 일지')}<body><main><header><h1>RICH 300 일지</h1></header><section class="card"><p>챌린지 설정이 없습니다. 먼저 시작 자금과 시작일을 저장해 주세요.</p></section></main></body></html>`;
  const a = m.analytics, link = typeof appUrl === 'string' && /^https:\/\/\S+$/.test(appUrl) ? `<a target="_top" href="${jvE(appUrl)}${appUrl.includes('?') ? '&' : '?'}p=journal">새로고침</a>` : '';
  const rv = a.reviews;
  return `${jvHead('RICH300 일지')}<body><main>
<header><h1>RICH 300 일지</h1><span class="sub">${jvE(m.startDay)} 시작 · 시작 자금 ${jvE(m.startEquity)} USDT · ${link}</span></header>
${jvCloseHtml(m)}
<section aria-labelledby="h-stat"><h2 id="h-stat">통계 <span class="sub">실제 청산 거래만 · 모의 제외</span></h2>${jvStat('전체', a.overall)}<div class="sub" style="margin:-4px 0 8px">승률 구간은 표본이 작을수록 넓어집니다. 30건 미만은 참고용입니다.</div>${a.strategies.map(s => jvStat(s.name, s)).join('')}${a.unlinked ? `<div class="sub">전략을 알 수 없는 거래 ${a.unlinked}건은 전체에만 포함됩니다.</div>` : ''}${a.dirs.map(d => jvStat(d.key, d)).join('')}</section>
<section aria-labelledby="h-rv"><h2 id="h-rv">10초 복기 분석 <span class="sub">복기율 ${jvE(rv.reviewRate)} (${rv.reviewed}/${rv.total})</span></h2>${rv.byPlan.length ? `<div class="sub">계획 준수</div>${rv.byPlan.map(jvGrp).join('')}` : '<div class="card sub">저장된 복기가 없습니다.</div>'}${rv.byMind.length ? `<div class="sub">심리 상태</div>${rv.byMind.map(jvGrp).join('')}` : ''}${rv.insights.length ? `<div class="card"><strong>참고</strong><ul class="plain">${rv.insights.map(i => `<li>${jvE(i.text)}</li>`).join('')}</ul></div>` : ''}</section>
<section aria-labelledby="h-cf"><h2 id="h-cf">입출금 기록</h2><div class="card"><form id="cfForm"><div class="sub">거래소와 지갑 사이 입금(+)·출금(−)을 기록합니다. 손익과 분리되어 목표 계산에 영향을 주지 않습니다.</div><label for="cfAmt">금액 (USDT, 입금 +, 출금 −)</label><input id="cfAmt" inputmode="decimal" autocomplete="off"><label for="cfNote">메모 (선택)</label><input id="cfNote" autocomplete="off"><button class="act" type="submit">저장</button><div class="out" id="cfOut" role="status"></div></form></div>
${m.cashflows.length ? `<div class="card">${m.cashflows.map(c => `<div class="day"><div class="row"><span>${jvE(c.atLabel)} · <strong>${jvE(c.amount)}</strong> ${jvE(c.note)}</span></div><form class="cfVoid" data-cf="${jvE(c.cfId)}"><div class="row" style="gap:6px"><input name="reason" placeholder="취소 사유" autocomplete="off" aria-label="취소 사유"><button class="act alt" type="submit" style="margin:0;white-space:nowrap">취소</button></div><div class="out" role="status"></div></form></div>`).join('')}</div>` : ''}</section>
<section aria-labelledby="h-j"><h2 id="h-j">매매일지 <span class="sub">${m.tradesTotal}건${m.tradesOpen ? ` · 보유 ${m.tradesOpen}` : ''}${m.voidedCount ? ` · 취소된 체결 ${m.voidedCount}` : ''}</span></h2><div class="card">${m.trades.length ? m.trades.map(jvTradeHtml).join('') : '<div class="sub">아직 기록이 없습니다.</div>'}</div>${m.tradesTotal > m.trades.length ? `<div class="sub">최근 ${m.trades.length}건만 표시</div>` : ''}</section>
${m.warnings.length ? `<section aria-labelledby="h-w"><h2 id="h-w">데이터 확인</h2><div class="card"><ul class="plain">${m.warnings.map(w => `<li>${jvE(w.text)}</li>`).join('')}</ul></div></section>` : ''}
<footer>기록 전용 · 자동 주문 없음 · 수정은 사유와 함께 이력으로 남습니다 · 갱신 ${jvE(new Date(m.generatedAt + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' '))} KST</footer></main><script>${JV_JS}</script></body></html>`;
}
const JV_JS = `(function(){
function $(s,r){return (r||document).querySelector(s)}function say(el,t,ok){el.textContent=t;el.className='out '+(ok?'ok':'bad')}
function call(fn,args,out,done){var run=window.google&&google.script&&google.script.run;if(!run){say(out,'연결할 수 없습니다',false);return}
run.withSuccessHandler(function(r){if(r&&r.ok){say(out,(r.message||'저장됨')+(r.detail?'\\n'+r.detail:''),true);if(done)done(r)}else say(out,(r&&r.message)||(r&&r.error==='busy'?'다른 작업 중입니다. 잠시 후 다시 눌러 주세요(중복 저장되지 않습니다).':'저장하지 못했습니다.'),false);unlock()}).withFailureHandler(function(){say(out,'연결 오류. 다시 눌러 주세요(중복 저장되지 않습니다).',false);unlock()})[fn].apply(null,args)}
var locked=[];function lock(f){locked=[].slice.call(f.querySelectorAll('button'));locked.forEach(function(b){b.disabled=true})}function unlock(){locked.forEach(function(b){b.disabled=false});locked=[]}
function id(){return (window.crypto&&crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9]/g,'').slice(0,24)}
var cfId=id();
document.addEventListener('submit',function(e){e.preventDefault();var f=e.target;
if(f.id==='eqForm'){var out=$('#eqOut');lock(f);call('rich300EquitySubmit',[{day:$('#eqDay').value,equity:$('#eqVal').value.trim(),unrealized:$('#eqUn').value.trim(),reason:$('#eqWhy').value.trim()}],out)}
else if(f.id==='cfForm'){var out2=$('#cfOut');lock(f);call('rich300CashflowSubmit',[{formId:cfId,amount:$('#cfAmt').value.trim(),note:$('#cfNote').value.trim()}],out2,function(){cfId=id()})}
else if(f.classList.contains('cfVoid')){var o3=$('.out',f);if(!f.elements.reason.value.trim()){say(o3,'사유를 입력해 주세요',false);return}lock(f);call('rich300CashflowVoid',[f.getAttribute('data-cf'),f.elements.reason.value.trim()],o3)}
else if(f.classList.contains('fillForm')){var o4=$('.out',f),act=e.submitter&&e.submitter.getAttribute('data-act'),reason=f.elements.reason.value.trim();
if(!reason){say(o4,'사유를 입력해 주세요',false);return}lock(f);
if(act==='void'){call('rich300JournalVoidFill',[f.getAttribute('data-fill'),reason],o4)}
else{var patch={},changed=0;['price','qty'].forEach(function(k){var v=f.elements[k].value.trim();if(v!==f.elements[k].getAttribute('data-orig')){patch[k]=v;changed++}});
['fee','funding'].forEach(function(k){var v=f.elements[k].value.trim();if(v!==f.elements[k].getAttribute('data-orig')){patch[k]=v===''?{state:'missing'}:v.charAt(0)==='~'?{state:'estimated',amount:v.slice(1)}:{state:'entered',amount:v};changed++}});
if(!changed){say(o4,'바뀐 값이 없습니다',false);unlock();return}call('rich300JournalReviseFill',[f.getAttribute('data-fill'),patch,reason],o4)}}
});
})();`;
