// 메인 화면 HTML 렌더러(서버 측 렌더링, 순수 함수, R6 수정판). 숫자 중심: 그래프·차트·장식 없음. 모바일 우선 단일 HTML 문자열.
//  · 외부 스크립트·폰트·이미지 없음(인라인 CSS만, 스크립트 없음). 모든 동적 값은 dashEsc 로 이스케이프한다(시트 값이 HTML이 될 수 없음).
//  · 색은 토큰(:root)으로 정의하고 다크 모드는 prefers-color-scheme. 색만으로 의미를 전달하지 않는다(▲▼ 기호·텍스트 라벨 병행).
//  · 일일 5%는 '목표치'이며 수익을 보장하지 않는다는 문구를 항상 표시하고, 실제 성과(입력 평가액)와 목표를 다른 줄·다른 라벨로 구분한다.
export const dashEsc = v => String((v != null ? v : '')).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DASH_ARROW = (pos, neg) => (pos ? '▲' : neg ? '▼' : '■');
const dashTone = (pos, neg) => (pos ? 'pos' : neg ? 'neg' : 'zero');

export const DASH_PAGES = Object.freeze([['dash', '홈'], ['journal', '매매일지']]);

export const DASH_CSS = `
:root{color-scheme:light;--bg:#f6f7f9;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#3f3e3b;--mute:#5c5b57;--line:#dcdbd6;--accent:#2a78d6;--good:#17794f;--bad:#c62828;--warnbg:#fff4d6;--warnink:#6b4a00;--track:#e8e7e2}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#111110;--surface:#1a1a19;--ink:#f0efec;--ink2:#d4d3c9;--mute:#a9a89f;--line:#33332f;--accent:#5aa0f0;--good:#3ddc97;--bad:#ff7b7b;--warnbg:#3a3000;--warnink:#ffd866;--track:#2a2a27}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Noto Sans KR","Apple SD Gothic Neo",sans-serif;font-variant-numeric:tabular-nums;padding:0 max(16px,env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
main{max-width:560px;margin:0 auto}
header{padding:14px 0 4px}h1{font-size:17px;margin:0}h2{font-size:14px;margin:0 0 8px;color:var(--ink2);font-weight:600}
nav.tabs{display:flex;gap:6px;margin:8px 0 4px;overflow-x:auto}nav.tabs a{flex:1 0 auto;text-align:center;font-size:14px;padding:9px 12px;min-height:40px;border:1px solid var(--line);background:var(--surface);color:var(--ink2);border-radius:999px;text-decoration:none}nav.tabs a[aria-current="page"]{border-color:var(--accent);color:var(--ink);font-weight:650}
.sub{font-size:12px;color:var(--mute)}
section{margin:14px 0}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px}
.hero{padding:18px 14px}.hero .k{font-size:13px}.hero .big{font-size:46px;font-weight:700;line-height:1.1;letter-spacing:-.5px}.hero .big small{font-size:16px;font-weight:500;color:var(--mute);margin-left:4px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.grid2>div{min-width:0}
.k{font-size:12px;color:var(--mute)}.v{font-size:24px;font-weight:650;line-height:1.25}.v small{font-size:12px;font-weight:500;color:var(--mute)}
.pos{color:var(--good)}.neg{color:var(--bad)}.zero{color:var(--ink2)}
.badge{display:inline-block;font-size:12px;border:1px solid var(--line);border-radius:999px;padding:1px 9px;color:var(--ink2);white-space:nowrap}.badge.ok{border-color:var(--good);color:var(--good);font-weight:650}
.notice{background:var(--warnbg);color:var(--warnink);border-radius:10px;padding:10px 12px;font-size:13px;margin:8px 0}
.sample{background:var(--warnbg);color:var(--warnink);border-radius:10px;padding:10px 12px;font-size:13px;margin:8px 0}
.alert{border-left:4px solid var(--bad);padding:6px 10px;margin-top:10px;font-size:13px;background:var(--bg);border-radius:6px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:8px 4px;border-bottom:1px solid var(--line);text-align:right;vertical-align:top}th{font-size:12px;color:var(--mute);font-weight:600}th:first-child,td:first-child{text-align:left}
td .sub{display:block}
.warn{margin:0;padding-left:18px;font-size:13px;color:var(--ink2)}.warn li{margin:3px 0}
.cta{display:inline-block;margin-top:8px;padding:10px 14px;border:1px solid var(--accent);border-radius:10px;color:var(--ink);text-decoration:none;font-size:14px}
footer{font-size:11px;color:var(--mute);margin:18px 0 0;text-align:center}

/* Focus UI: only Home and Journal are primary navigation. Other routes remain accessible to owner. */
main{padding-bottom:96px}
nav.tabs{position:fixed;bottom:0;left:0;right:0;z-index:10;margin:0;justify-content:center;background:var(--surface);border-top:1px solid var(--line);padding:10px max(16px,env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));gap:10px}
nav.tabs a{flex:1 1 0;max-width:260px;border-radius:12px;min-height:48px;font-size:16px;display:flex;align-items:center;justify-content:center}
.focus-title{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.focus-brand{letter-spacing:-.4px;font-size:23px;font-weight:750}
.focus-eyebrow{font-size:12px;color:var(--mute)}
.focus-panel{margin-top:14px}.focus-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.focus-primary{font-size:42px;font-weight:750;letter-spacing:-1px;line-height:1.17;word-break:break-word}
.focus-unit{font-size:16px;color:var(--mute);font-weight:500}
.focus-label{font-size:13px;color:var(--mute)}
.focus-sub{font-size:12px;color:var(--mute);margin-top:7px}
.focus-mini{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:15px;min-width:0}
.focus-mini .v{font-size:22px;overflow-wrap:anywhere}
.focus-target{font-size:28px;font-weight:730}
.focus-progress{height:11px;border-radius:999px;background:var(--track);overflow:hidden;margin:14px 0 3px}
.focus-progress span{display:block;background:var(--accent);height:100%;border-radius:999px}
.focus-progress.empty span{display:none}
.focus-graph{width:100%;height:auto;display:block;margin:8px 0 0}
.focus-legend{display:flex;gap:16px;font-size:12px;color:var(--mute);flex-wrap:wrap}
.focus-legend i{display:inline-block;width:17px;height:3px;vertical-align:middle;margin-right:4px;background:var(--ink2)}
.focus-legend i.ideal{background:var(--accent);border-top:2px dashed var(--surface)}
.focus-trade{border-bottom:1px solid var(--line);padding:11px 0}
.focus-trade:last-child{border-bottom:0}
.focus-cta{display:block;text-align:center;min-height:44px;margin-top:12px;padding:11px 12px;border-radius:10px;background:var(--accent);color:#fff;text-decoration:none;font-weight:700}
.focus-secondary{display:block;text-align:center;margin:10px 0;color:var(--ink2);font-size:13px;text-decoration:underline}
.focus-collapse{margin:14px 0}.focus-collapse summary{cursor:pointer;font-weight:650;min-height:44px;padding:12px}
.focus-collapse .card{margin-top:4px}
.focus-note{font-size:12px;line-height:1.5;color:var(--mute)}
@media(max-width:360px){.focus-primary{font-size:32px}.focus-target{font-size:24px}.focus-mini .v{font-size:19px}}
`;
export const dashHead = title => `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${dashEsc(title)}</title><style>${DASH_CSS}</style></head>`;
const dashUrl = (appUrl, p) => (typeof appUrl === 'string' && /^https:\/\/\S+$/.test(appUrl) ? `${appUrl}${appUrl.includes('?') ? '&' : '?'}p=${p}` : null);
// 모든 페이지 공통 상단 메뉴(Apps Script 웹앱은 iframe 안에서 열리므로 target=_top 으로 이동)
export function dashNav(active, appUrl) {
  return `<nav class="tabs" aria-label="메뉴">${DASH_PAGES.map(([p, label]) => { const u = dashUrl(appUrl, p); return u ? `<a target="_top" href="${dashEsc(u)}"${p === active ? ' aria-current="page"' : ''}>${label}</a>` : `<a${p === active ? ' aria-current="page"' : ' aria-disabled="true"'}>${label}</a>`; }).join('')}</nav>`;
}
export const dashFooter = m => `<footer>기록 전용 · 자동 주문 없음 · 갱신 ${dashEsc(new Date(m.generatedAt + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' '))} KST</footer>`;

export function dashRenderError(appUrl) {
  return `${dashHead('RICH300')}<body><main><header><h1>RICH 300</h1></header>${dashNav('dash', appUrl)}<section class="card"><p>화면을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.</p></section></main></body></html>`;
}
function dashGrowthSvg(daily) {
  const rows = (daily || []).slice().reverse();
  const values = rows.flatMap(r => [Number(r.idealMicro),r.actualMicro === null ? NaN : Number(r.actualMicro)]).filter(Number.isFinite);
  if (!rows.length || values.length < 2) return '<div class="focus-sub">기록이 쌓이면 실제 자산과 복리 목표의 성장선이 표시됩니다.</div>';
  const hi=Math.max(...values),lo=Math.min(...values),span=Math.max(hi-lo,1),x=i=>14+292*(rows.length===1?0.5:i/(rows.length-1)),y=v=>108-(v-lo)/span*92;
  const ideal=rows.map((r,i)=>`${x(i).toFixed(1)},${y(Number(r.idealMicro)).toFixed(1)}`).join(' ');
  const parts=[];let current=[];
  for(let i=0;i<rows.length;i++){const r=rows[i],val=r.actualMicro===null?NaN:Number(r.actualMicro);if(!Number.isFinite(val)){if(current.length>1)parts.push(current.join(' '));current=[];}else current.push(`${x(i).toFixed(1)},${y(val).toFixed(1)}`);}
  if(current.length>1)parts.push(current.join(' '));
  const dots=rows.map((r,i)=>r.actualMicro!==null&&Number.isFinite(Number(r.actualMicro))?`<circle cx="${x(i).toFixed(1)}" cy="${y(Number(r.actualMicro)).toFixed(1)}" r="2.5" fill="currentColor"><title>${dashEsc(r.day)} · 실제 입력</title></circle>`:'').join('');
  return `<svg class="focus-graph" viewBox="0 0 320 124" role="img" aria-label="최근 ${rows.length}일간 실제 입력 평가액(입출금 제외)과 이상 복리 목표 비교"><path d="M14 16H306 M14 62H306 M14 108H306" fill="none" stroke="currentColor" stroke-opacity=".14" stroke-dasharray="3 5"/><polyline points="${ideal}" stroke="var(--accent)" stroke-width="2.5" stroke-dasharray="5 5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>${parts.map(p=>`<polyline points="${p}" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}${dots}</svg>`;
}
export function dashRenderHtml(m, { appUrl } = {}) {
  const head = `<header class="focus-title"><span class="focus-brand">RICH 300</span><span class="focus-eyebrow">MY TRADING JOURNAL</span></header>`;
  const nav = dashNav('dash',appUrl);
  const sample = m.sample ? '<div class="sample"><strong>샘플 데이터</strong> · 실제 자산 아님</div>' : '';
  if (m.noChallenge) return `${dashHead('RICH300')}<body><main>${head}${sample}<section class="card"><p>챌린지가 아직 설정되지 않았습니다.</p><p class="focus-note">계좌 정보 없이 금액을 임의로 표시하지 않습니다.</p></section>${nav}</main></body></html>`;
  if (m.empty) return `${dashHead('RICH300')}<body><main>${head}${sample}<section class="card">아직 시작 전입니다. 시작일: ${dashEsc(m.startDay)}</section>${nav}</main></body></html>`;
  const c=m.current,t=m.today,assets=dashUrl(appUrl,'assets'),journal=dashUrl(appUrl,'journal'),ops=dashUrl(appUrl,'ops');
  const currentHtml=c?`<div class="focus-primary">${dashEsc(c.label)} <span class="focus-unit">USDT</span></div><div class="focus-sub">${c.today?'오늘 입력':`${dashEsc(c.day)} 입력 기준 · 오늘 평가액 없음`}${c.cashflowLabel?` · 입출금 ${dashEsc(c.cashflowLabel)}(손익 별도)`:''}</div>`:`<div class="focus-primary">미입력</div><div class="focus-sub">실제 계좌 평가액을 입력해야 표시됩니다.</div>`;
  const pnl=c?`<div class="v ${dashTone(c.pnlPositive,c.pnlNegative)}">${DASH_ARROW(c.pnlPositive,c.pnlNegative)} ${dashEsc(c.pnlLabel)}</div>`:'<div class="v">미입력</div>';
  const ret=c?`<div class="v ${dashTone(c.pnlPositive,c.pnlNegative)}">${DASH_ARROW(c.pnlPositive,c.pnlNegative)} ${dashEsc(c.returnLabel)}</div>`:'<div class="v">미입력</div>';
  const remaining=t.remainingLabel===null?'<span class="focus-target">미입력</span>':`<span class="focus-target">${dashEsc(t.remainingLabel)} <span class="focus-unit">USDT</span></span>`;
  const achieved=t.achieved?'<span class="badge ok">오늘 목표 달성</span>':'';
  const progress=t.progress===null?'<div class="focus-progress empty"><span></span></div><div class="focus-sub">오늘 평가액 없음 · 달성률 계산 대기</div>':`<div class="focus-progress"><span style="width:${Math.max(0,Math.min(100,t.progress)).toFixed(2)}%"></span></div><div class="focus-sub">오늘 수익 목표 달성률 ${dashEsc(t.progressLabel)}${achieved?' · '+achieved:''}</div>`;
  const realTrades=(m.recentTrades||[]).map(tr=>`<div class="focus-trade"><div class="focus-row"><strong>${dashEsc(tr.symbol||tr.sid)} · ${dashEsc(tr.dir)}</strong><strong class="${dashTone(tr.pnlPositive,tr.pnlNegative)}">${tr.status==='closed'?dashEsc(tr.netLabel)+' USDT':'보유 중'}</strong></div><div class="focus-sub">${tr.status==='closed'?'실제 체결 종료':'실제 체결 기록'} · ${tr.reviewed?'복기 완료':'복기 필요'}</div></div>`).join('');
  const tradeSection=realTrades||'<div class="focus-sub">아직 실제 체결 기록이 없습니다. 가상 전략은 매매일지에 포함하지 않습니다.</div>';
  const history=(m.daily||[]).map(d=>`<tr><td>${dashEsc(d.day.slice(5))}${d.today?' 오늘·진행 중':''}</td><td>${d.input?dashEsc(d.closeLabel):'미입력'}</td><td class="${dashTone(d.pnlPositive,d.pnlNegative)}">${dashEsc(d.pnlLabel)}${d.input?'':' <span class="sub">장부상 실현손익</span>'}</td></tr>`).join('');
  const records=m.dailyTotal>m.daily.length?` · 최근 ${m.daily.length}일`:'';
  return `${dashHead('RICH300')}<body><main>${head}${sample}
<section class="focus-panel" aria-label="내 실제 자산"><div class="card hero"><div class="focus-label">내 실제 총자산 (입력 평가액)</div>${currentHtml}</div></section>
<section class="focus-panel" aria-label="누적 성과"><div class="grid2"><div class="focus-mini"><div class="focus-label">누적 손익</div>${pnl}</div><div class="focus-mini"><div class="focus-label">누적 수익률</div>${ret}</div></div><p class="focus-sub">시작 자금 ${dashEsc(m.startEquity)} USDT · 입출금 제외 · 실제 평가액 기준</p></section>
<section class="focus-panel" aria-label="오늘 복리 목표"><div class="card"><div class="focus-row"><h2>오늘 복리 목표 +${dashEsc(t.rate)}</h2><span class="focus-label">${dashEsc(t.day)} · ${t.n}일차</span></div><div class="focus-row"><span class="focus-label">오늘 시작 자산</span><strong>${dashEsc(t.startLabel)} USDT</strong></div><div class="focus-row" style="margin-top:10px"><span class="focus-label">오늘 목표 자산</span><strong>${dashEsc(t.targetLabel)} USDT</strong></div><div class="focus-label" style="margin-top:18px">목표까지 남은 금액</div>${remaining}${progress}${t.needsReview?`<div class="alert">장부와 입력 평가액의 차이 ${dashEsc(t.diffLabel)} USDT — 확인 필요</div>`:''}<p class="focus-note">목표 = 전일 실제 마감 자산 × (1+${dashEsc(t.rate)}). 목표일 뿐 수익을 보장하지 않으며, 미입력일에는 달성 여부를 추정하지 않습니다.</p></div></section>
<section class="focus-panel" aria-label="자산 성장"><div class="card"><h2>내 자산 증식 현황</h2>${dashGrowthSvg(m.daily)}<div class="focus-legend"><span><i></i>실제 평가액 (입출금 제외)</span><span><i class="ideal"></i>이상 5% 복리 목표</span></div><div class="focus-row" style="margin-top:14px"><span class="focus-label">이상 복리 목표 자산</span><strong>${dashEsc(m.idealTodayLabel)} USDT</strong></div><div class="focus-row" style="margin-top:8px"><span class="focus-label">이상 복리선까지 격차</span><strong>${m.idealGapLabel===null?'오늘 평가액 미입력':dashEsc(m.idealGapLabel)+' USDT'}</strong></div><p class="focus-note">실제 평가액을 입력한 날짜만 실선으로 표시합니다. 차트는 참고용 목표와 실제 기록을 구분합니다.</p></div></section>
<section class="focus-panel" aria-label="최근 매매일지"><div class="card"><div class="focus-row"><h2>최근 매매일지</h2>${journal?`<a class="focus-secondary" target="_top" href="${dashEsc(journal)}">전체 보기</a>`:''}</div>${tradeSection}</div></section>
${assets?`<a class="focus-cta" target="_top" href="${dashEsc(assets)}">오늘 평가액 입력하기</a>`:''}
<details class="focus-collapse"><summary>날짜별 마감 자산 · 일간 손익${records}</summary><div class="card"><table><thead><tr><th>날짜</th><th>마감 자산</th><th>손익</th></tr></thead><tbody>${history}</tbody></table></div></details>
${m.warnings.length?`<details class="focus-collapse"><summary>데이터 확인 (${m.warnings.length})</summary><div class="card"><ul class="warn">${m.warnings.map(w=>`<li>${dashEsc(w.text)}</li>`).join('')}</ul></div></details>`:''}
${ops?`<a class="focus-secondary" target="_top" href="${dashEsc(ops)}">운영 관리</a>`:''}
${dashFooter(m)}${nav}
</main></body></html>`;
}
