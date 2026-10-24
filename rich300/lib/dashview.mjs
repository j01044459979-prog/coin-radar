// R6 대시보드 HTML 렌더러(서버 측 렌더링, 순수 함수). 뷰 모델(dashboard.mjs) → 모바일 우선 단일 HTML 문자열.
//  · 외부 스크립트·폰트·이미지 없음(인라인 CSS/JS/SVG만). 모든 동적 값은 dashEsc 로 이스케이프한다(시트 값이 HTML이 될 수 없음).
//  · 색은 토큰(:root)으로 정의하고 다크 모드는 별도 선택값(prefers-color-scheme + data-theme). 색만으로 의미를 전달하지 않는다(▲▼ 기호·텍스트 라벨 병행).
//  · 차트: 실제 평가액(실선) vs 이상 복리선(점선), 2px 선·끝점 직접 라벨·범례·표 보기·호버 십자선/툴팁.
import { PLAN_CHOICES, MIND_CHOICES } from './schema.mjs';

export const dashEsc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DASH_FLAG_TEXT = { 'fee-missing': '수수료 미입력', 'funding-missing': '펀딩 미입력', 'fee-estimated': '수수료 추정', 'funding-estimated': '펀딩 추정' };
const DASH_ARROW = (pos, neg) => (pos ? '▲' : neg ? '▼' : '■');
const dashTone = (pos, neg) => (pos ? 'pos' : neg ? 'neg' : 'zero');
const dashMd = day => day.slice(5);

const DASH_CSS = `
:root{color-scheme:light;--bg:#f6f7f9;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--mute:#6b6a66;--line:#dcdbd6;--grid:#e8e7e2;--s1:#2a78d6;--s2:#eb6834;--ref:#6b6a66;--good:#17794f;--bad:#c62828;--warnbg:#fff4d6;--warnink:#6b4a00;--track:#e8e7e2}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){color-scheme:dark;--bg:#111110;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--mute:#a09f96;--line:#33332f;--grid:#2a2a27;--s1:#3987e5;--s2:#d95926;--ref:#a09f96;--good:#3ddc97;--bad:#ff7b7b;--warnbg:#3a3000;--warnink:#ffd866;--track:#2a2a27}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#111110;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--mute:#a09f96;--line:#33332f;--grid:#2a2a27;--s1:#3987e5;--s2:#d95926;--ref:#a09f96;--good:#3ddc97;--bad:#ff7b7b;--warnbg:#3a3000;--warnink:#ffd866;--track:#2a2a27}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Noto Sans KR","Apple SD Gothic Neo",sans-serif;font-variant-numeric:tabular-nums;padding:0 max(16px,env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
main{max-width:560px;margin:0 auto}
header{padding:16px 0 4px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px 8px}
h1{font-size:18px;margin:0}h2{font-size:15px;margin:0 0 8px;color:var(--ink2);font-weight:600}
.sub{font-size:12px;color:var(--mute)}
section{margin:14px 0}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px}
.sample{background:var(--warnbg);color:var(--warnink);border-radius:10px;padding:10px 12px;font-size:13px;margin:8px 0}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px}
.k{font-size:12px;color:var(--mute)}.v{font-size:20px;font-weight:650;line-height:1.25}.v small{font-size:12px;font-weight:500;color:var(--mute)}
.pos{color:var(--good)}.neg{color:var(--bad)}.zero{color:var(--ink2)}
.hero .v{font-size:24px}.grid2>div{min-width:0}
.bar{height:10px;border-radius:5px;background:var(--track);overflow:hidden;margin:6px 0 4px}.bar>i{display:block;height:100%;background:var(--s1);border-radius:5px}
.row{display:flex;justify-content:space-between;gap:8px;font-size:13px;color:var(--ink2)}
.badge{display:inline-block;font-size:11px;border:1px solid var(--line);border-radius:999px;padding:1px 8px;color:var(--ink2);white-space:nowrap}
.alert{border-left:4px solid var(--bad);padding:6px 10px;margin-top:10px;font-size:13px;background:var(--bg);border-radius:6px}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--ink2);margin:0 0 6px}.legend i{display:inline-block;width:18px;height:0;border-top:2px solid var(--s1);vertical-align:middle;margin-right:6px}.legend i.ref{border-top:2px dashed var(--ref)}
.chart{position:relative;touch-action:pan-y}.chart svg{display:block;width:100%;height:auto}.chart text{font-size:10px;fill:var(--mute)}
.tip{position:absolute;pointer-events:none;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-size:12px;line-height:1.4;box-shadow:0 2px 8px rgba(0,0,0,.18);display:none;white-space:nowrap}
.seg{display:flex;gap:6px;margin:0 0 8px;flex-wrap:wrap}.seg button{font:inherit;font-size:13px;padding:6px 12px;min-height:36px;border:1px solid var(--line);background:var(--surface);color:var(--ink2);border-radius:999px}.seg button[aria-pressed="true"]{border-color:var(--s1);color:var(--ink);font-weight:650}
details{margin-top:8px;font-size:12px;color:var(--ink2)}summary{cursor:pointer;min-height:32px;display:flex;align-items:center}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:right;padding:3px 4px;border-bottom:1px solid var(--grid)}th:first-child,td:first-child{text-align:left}
.trade{border-top:1px solid var(--line);padding:10px 0}.trade:first-of-type{border-top:0}.trade .top{display:flex;justify-content:space-between;align-items:center;gap:8px}.trade .pnl{font-weight:650;white-space:nowrap}
.pill{display:inline-block;font-size:11px;font-weight:650;border:1px solid currentColor;border-radius:6px;padding:0 6px;margin-right:6px;color:var(--ink2)}
.meta{font-size:12px;color:var(--mute);margin-top:2px}.tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
[data-filter="LONG"] .trade[data-dir="SHORT"],[data-filter="SHORT"] .trade[data-dir="LONG"]{display:none}
.dirs{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px}.dirs .card{padding:10px}
.ab{display:grid;grid-template-columns:1fr;gap:10px}@media (min-width:480px){.ab{grid-template-columns:1fr 1fr}}
.ab h3{font-size:14px;margin:0 0 6px;display:flex;align-items:center;gap:8px}.sq{display:inline-block;width:12px;height:12px;border-radius:3px}.sq.a{background:var(--s1)}.sq.b{background:var(--s2)}
.ab dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:13px}.ab dt{color:var(--mute)}.ab dd{margin:0;text-align:right}
.track{height:8px;border-radius:4px;background:var(--track);overflow:hidden}.track>i{display:block;height:100%;border-radius:4px}.track>i.a{background:var(--s1)}.track>i.b{background:var(--s2)}
.warn{margin:0;padding-left:18px;font-size:13px;color:var(--ink2)}.warn li{margin:3px 0}
footer{font-size:11px;color:var(--mute);margin:18px 0 0;text-align:center}
`;

function dashChartSvg(series, { ideal, id }) {
  const W = 360, H = 200, ml = 46, mr = 58, mt = 10, mb = 22, n = series.length, vals = series.flatMap(p => (ideal ? [p.actual, p.ideal] : [p.actual]));
  let lo = Math.min(...vals), hi = Math.max(...vals); if (hi === lo) { hi += 1; lo -= 1; } const pad = (hi - lo) * 0.06; lo = Math.max(0, lo - pad); hi += pad;
  const X = i => ml + (n <= 1 ? 0 : (i * (W - ml - mr)) / (n - 1)), Y = v => mt + ((hi - v) / (hi - lo)) * (H - mt - mb), f0 = v => (v >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(v >= 100 ? 0 : 1));
  const ticks = [0, 1, 2, 3].map(k => lo + ((hi - lo) * k) / 3), line = key => series.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p[key]).toFixed(1)}`).join('');
  const last = series[n - 1], ya = Y(last.actual), yi = Y(last.ideal), gap = Math.abs(ya - yi) < 13;
  const xs = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}t ${id}d" data-w="${W}" data-ml="${ml}" data-mr="${mr}" data-mt="${mt}" data-mb="${mb}" data-h="${H}" data-lo="${lo}" data-hi="${hi}"><title id="${id}t">계좌 성장선</title><desc id="${id}d">${ideal ? '실제 평가액과 이상 복리선' : '실제 평가액'}의 일별 추이. 표로 보기에서 값을 확인할 수 있습니다.</desc>`
    + ticks.map(v => `<line x1="${ml}" x2="${W - mr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--grid)" stroke-width="1"/><text x="${ml - 6}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${f0(v)}</text>`).join('')
    + xs.map(i => `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${dashEsc(i === 0 ? '시작' : dashMd(series[i].day))}</text>`).join('')
    + (ideal ? `<path d="${line('ideal')}" fill="none" stroke="var(--ref)" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round" stroke-linejoin="round"/>` : '')
    + `<path d="${line('actual')}" fill="none" stroke="var(--s1)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
    + series.map((p, i) => (p.source === 'ledger' && i >= n - 60 ? `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.actual).toFixed(1)}" r="3" fill="var(--surface)" stroke="var(--s1)" stroke-width="2"/>` : '')).join('')
    + `<circle cx="${X(n - 1).toFixed(1)}" cy="${ya.toFixed(1)}" r="4" fill="var(--s1)" stroke="var(--surface)" stroke-width="2"/>`
    + `<text x="${W - mr + 6}" y="${(gap && ya > yi ? ya + 6 : ya + 3).toFixed(1)}" style="fill:var(--ink);font-weight:600">실제 ${f0(last.actual)}</text>`
    + (ideal ? `<text x="${W - mr + 6}" y="${(gap && ya > yi ? yi - 4 : gap ? yi - 4 : yi + 3).toFixed(1)}">이상 ${f0(last.ideal)}</text>` : '')
    + `<line class="xh" x1="0" x2="0" y1="${mt}" y2="${H - mb}" stroke="var(--mute)" stroke-width="1" style="display:none"/></svg>`;
}
const dashDays = (series) => series.slice(-30).map(p => `<tr><td>${dashEsc(p.n === 0 ? '시작' : p.day)}</td><td>${p.actual.toFixed(2)}${p.source === 'ledger' ? '*' : ''}</td><td>${p.ideal.toFixed(2)}</td><td>${(p.actual - p.ideal).toFixed(2)}</td></tr>`).join('');

function dashTradeHtml(t) {
  const tone = dashTone(t.win, t.loss), dirLabel = t.dir, rv = t.review ? `${PLAN_CHOICES[t.review.plan] ?? t.review.plan} · ${MIND_CHOICES[t.review.mind] ?? t.review.mind}` : '복기 안 함';
  const where = t.status === 'open' ? `보유 중 · 수량 ${dashEsc(t.openQty)}${t.entryAvg ? ` @ ${dashEsc(t.entryAvg)}` : ''}` : `${t.entryAvg ? `진입 ${dashEsc(t.entryAvg)}` : ''}${t.exitAvg ? ` → 청산 ${dashEsc(t.exitAvg)}` : ''}`;
  return `<article class="trade" data-dir="${dashEsc(t.dir)}"><div class="top"><div><span class="pill">${dirLabel}</span><strong>${dashEsc(t.symbol ?? t.sid)}</strong>${t.strategy ? ` <span class="badge">${dashEsc(t.strategy)}전략</span>` : ''}</div>`
    + `<div class="pnl ${tone}">${t.status === 'open' ? '진행' : `${DASH_ARROW(t.win, t.loss)} ${dashEsc(t.netLabel)}`}${t.roeLabel ? ` <span class="sub">${dashEsc(t.roeLabel)}</span>` : ''}</div></div>`
    + `<div class="meta">${dashEsc(t.openedLabel)}${t.closedLabel ? ` → ${dashEsc(t.closedLabel)}` : ''} · ${where}</div>`
    + `<div class="tags"><span class="badge">${dashEsc(rv)}</span>${t.flags.map(f => `<span class="badge">${dashEsc(DASH_FLAG_TEXT[f] ?? f)}</span>`).join('')}</div></article>`;
}
const dashDir = d => `<div class="card"><div class="k">${d.dir} · 청산 ${d.closed}건${d.open ? ` · 보유 ${d.open}` : ''}</div><div class="v ${dashTone(d.netPositive, d.netNegative)}">${DASH_ARROW(d.netPositive, d.netNegative)} ${dashEsc(d.netLabel)}</div><div class="sub">승률 ${dashEsc(d.winRate)} (${d.wins}/${d.closed}) · 평균 ${dashEsc(d.avgLabel)}</div></div>`;
const dashStrat = s => `<div class="card"><h3><span class="sq ${s.key.toLowerCase()}" aria-hidden="true"></span>${dashEsc(s.name)}</h3><dl><dt>신호</dt><dd>${s.signals}건</dd><dt>응답</dt><dd>진입 ${s.entered} · 관망 ${s.watched} · 놓침 ${s.missed}${s.unanswered ? ` · 미응답 ${s.unanswered}` : ''}</dd><dt>진입률</dt><dd>${dashEsc(s.enteredRate)}</dd><dt>청산 거래</dt><dd>${s.closed}건${s.lowSample ? ' <span class="badge">표본 부족</span>' : ''}</dd><dt>승률</dt><dd>${dashEsc(s.winRate)} (${s.wins}/${s.closed})</dd><dt>순손익</dt><dd class="${dashTone(s.netPositive, s.netNegative)}">${DASH_ARROW(s.netPositive, s.netNegative)} ${dashEsc(s.netLabel)}</dd><dt>건당 평균</dt><dd>${dashEsc(s.avgLabel)}</dd></dl>`
  + `<div class="track" style="margin-top:8px" role="img" aria-label="승률 ${dashEsc(s.winRate)}"><i class="${s.key.toLowerCase()}" style="width:${s.winRatePpm === null ? 0 : Math.round(s.winRatePpm * 100)}%"></i></div></div>`;

const DASH_JS = `(function(){
var root=document.getElementById('journal');function setF(f){root.setAttribute('data-filter',f);document.querySelectorAll('.seg button[data-f]').forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-f')===f))})}
document.querySelectorAll('.seg button[data-f]').forEach(function(b){b.addEventListener('click',function(){setF(b.getAttribute('data-f'))})});
var cw=document.getElementById('chartwrap');var showIdeal=true;var bi=document.getElementById('btnIdeal'),ba=document.getElementById('btnActual');
function setI(v){showIdeal=v;document.getElementById('cI').style.display=v?'':'none';document.getElementById('cA').style.display=v?'none':'';bi.setAttribute('aria-pressed',String(v));ba.setAttribute('aria-pressed',String(!v))}
bi.addEventListener('click',function(){setI(true)});ba.addEventListener('click',function(){setI(false)});
var pts=JSON.parse(document.getElementById('pts').textContent);var tip=document.getElementById('tip');
function hover(e){var svg=(showIdeal?document.getElementById('cI'):document.getElementById('cA')).querySelector('svg');var r=svg.getBoundingClientRect(),W=+svg.dataset.w,ml=+svg.dataset.ml,mr=+svg.dataset.mr,mt=+svg.dataset.mt,H=+svg.dataset.h,mb=+svg.dataset.mb;
var vx=(e.clientX-r.left)/r.width*W,i=Math.round((vx-ml)/(W-ml-mr)*(pts.length-1));i=Math.max(0,Math.min(pts.length-1,i));var x=ml+(pts.length<=1?0:i*(W-ml-mr)/(pts.length-1));
var ln=svg.querySelector('.xh');ln.setAttribute('x1',x);ln.setAttribute('x2',x);ln.style.display='';var p=pts[i];
tip.textContent='';var d=document.createElement('div');d.textContent=p[0];tip.appendChild(d);var a=document.createElement('div');a.textContent='실제 '+p[1].toFixed(2)+(p[3]?' (장부 근사)':'');tip.appendChild(a);
if(showIdeal){var q=document.createElement('div');q.textContent='이상 '+p[2].toFixed(2)+' · 차이 '+(p[1]-p[2]).toFixed(2);tip.appendChild(q)}
tip.style.display='block';var px=x/W*r.width,tw=tip.offsetWidth;tip.style.left=Math.max(0,Math.min(r.width-tw,px-tw/2))+'px';tip.style.top='0px'}
function leave(){tip.style.display='none';document.querySelectorAll('.xh').forEach(function(l){l.style.display='none'})}
cw.addEventListener('pointermove',hover);cw.addEventListener('pointerdown',hover);cw.addEventListener('pointerleave',leave);
var th=document.getElementById('btnTheme');if(th){th.addEventListener('click',function(){var cur=document.documentElement.getAttribute('data-theme');var dark=cur?cur==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-theme',dark?'light':'dark')})}
})();`;

const dashHead = title => `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${dashEsc(title)}</title><style>${DASH_CSS}</style></head>`;

export function dashRenderError() {
  return `${dashHead('RICH300')}<body><main><header><h1>RICH 300</h1></header><section class="card"><p>대시보드를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.</p></section></main></body></html>`;
}
export function dashRenderHtml(m) {
  const title = 'RICH300';
  if (m.empty) return `${dashHead(title)}<body><main><header><h1>RICH 300</h1><span class="sub">${dashEsc(m.startDay)} 시작</span></header>${m.sample ? '<div class="sample" role="note">샘플 데이터입니다.</div>' : ''}<section class="card"><p>아직 시작 전입니다. 시작일: ${dashEsc(m.startDay)}</p></section></main></body></html>`;
  const c = m.card, s = m.summary, pts = JSON.stringify(m.series.map(p => [p.n === 0 ? '시작' : p.day, p.actual, p.ideal, p.source === 'ledger' ? 1 : 0])).replace(/</g, '\\u003c');
  const srcBadge = c.source === 'input' ? '<span class="badge">입력 평가액</span>' : '<span class="badge">장부 근사 · 평가액 미입력</span>';
  return `${dashHead(title)}<body><main>
<header><h1>RICH 300</h1><span class="sub">${c.n}일차 · ${dashEsc(m.startDay)} 시작 · <button id="btnTheme" class="badge" type="button" style="font:inherit;background:none;cursor:pointer;color:inherit;min-height:36px;padding:0 12px" aria-label="화면 테마 전환">테마</button></span></header>
${m.sample ? '<div class="sample" role="note"><strong>샘플 데이터</strong> — 실제 기록이 없어 화면 검증용 예시를 보여 줍니다. 저장되지 않으며 실제 계좌와 무관합니다.</div>' : ''}
<section aria-labelledby="h-today"><h2 id="h-today">오늘 (${dashEsc(c.day)}) · 목표 ${dashEsc(c.rate)}</h2><div class="card hero"><div class="grid2">
<div><div class="k">오늘 시작 평가액</div><div class="v">${dashEsc(c.startLabel)} <small>USDT</small></div></div>
<div><div class="k">목표 마감액</div><div class="v">${dashEsc(c.targetLabel)} <small>${dashEsc(c.targetProfitLabel)}</small></div></div>
<div><div class="k">실제 평가액 ${srcBadge}</div><div class="v ${dashTone(c.pnlPositive, c.pnlNegative)}">${DASH_ARROW(c.pnlPositive, c.pnlNegative)} ${dashEsc(c.actualLabel)} <small>${dashEsc(c.pnlLabel)}</small></div></div>
<div><div class="k">목표까지</div><div class="v">${dashEsc(c.remainingLabel)} <small>USDT</small></div></div></div>
<div class="bar" role="progressbar" aria-label="오늘 목표 달성률" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(c.progressBar * 100)}"><i style="width:${Math.min(100, Math.round((c.progressBar / 1.5) * 100))}%"></i></div>
<div class="row"><span>달성률 ${dashEsc(c.progressLabel)}</span><span>목표 100%</span></div>
${c.cashflowLabel ? `<div class="row"><span>입출금(손익과 분리)</span><span>${dashEsc(c.cashflowLabel)}</span></div>` : ''}
${c.needsReview ? `<div class="alert" role="alert">⚠ 장부와 입력 평가액의 차이 ${dashEsc(c.diffLabel)} USDT — 확인이 필요합니다(자동으로 손익에 반영하지 않음).</div>` : ''}
</div></section>
<section aria-labelledby="h-sum"><h2 id="h-sum">누적</h2><div class="card"><div class="grid2">
<div><div class="k">누적 수익률(시작 대비)</div><div class="v ${dashTone(s.returnPositive, s.returnNegative)}">${DASH_ARROW(s.returnPositive, s.returnNegative)} ${dashEsc(s.returnLabel)}</div></div>
<div><div class="k">누적 손익</div><div class="v">${dashEsc(s.pnlTotalLabel)} <small>USDT</small></div></div>
<div><div class="k">최대 낙폭</div><div class="v">${dashEsc(s.maxDdPct)} <small>${dashEsc(s.maxDdLabel)}</small></div></div>
<div><div class="k">현재 낙폭</div><div class="v">${dashEsc(s.curDdPct)} <small>${dashEsc(s.curDdLabel)}</small></div></div>
<div><div class="k">목표 달성일</div><div class="v">${s.daysTargetMet}<small> / ${s.days}일</small></div></div>
<div><div class="k">이상 복리선 대비</div><div class="v ${dashTone(s.gapPositive, s.gapNegative)}">${DASH_ARROW(s.gapPositive, s.gapNegative)} ${dashEsc(s.gapLabel)}</div></div></div>
<div class="row" style="margin-top:8px"><span>평가액 입력 ${s.daysWithInput}일 · 장부 근사 ${s.daysLedgerOnly}일</span>${s.netCashflowLabel ? `<span>순입출금 ${dashEsc(s.netCashflowLabel)}</span>` : ''}</div></div></section>
<section aria-labelledby="h-chart"><h2 id="h-chart">계좌 성장선</h2><div class="card">
<div class="seg" role="group" aria-label="차트 보기"><button type="button" id="btnIdeal" aria-pressed="true">이상선 포함</button><button type="button" id="btnActual" aria-pressed="false">실제만</button></div>
<div class="legend"><span><i></i>실제 평가액</span><span><i class="ref"></i>이상 복리선(고정 기준)</span><span>○ 장부 근사일</span></div>
<div class="chart" id="chartwrap"><div id="cI">${dashChartSvg(m.series, { ideal: true, id: 'ci' })}</div><div id="cA" style="display:none">${dashChartSvg(m.series, { ideal: false, id: 'ca' })}</div><div class="tip" id="tip"></div></div>
<details><summary>표로 보기 (최근 30일)</summary><table><thead><tr><th>날짜</th><th>실제</th><th>이상</th><th>차이</th></tr></thead><tbody>${dashDays(m.series)}</tbody></table><div class="sub">* 장부 근사(평가액 미입력)</div></details>
<script type="application/json" id="pts">${pts}</script></div></section>
<section aria-labelledby="h-ab"><h2 id="h-ab">A/B 전략 비교 <span class="sub">실제 기록만 · 모의 제외</span></h2><div class="ab">${m.strategies.map(dashStrat).join('')}</div></section>
<section aria-labelledby="h-j"><h2 id="h-j">매매일지 <span class="sub">${m.tradesTotal}건${m.tradesOpen ? ` · 보유 ${m.tradesOpen}` : ''}</span></h2>
<div class="dirs">${m.dirs.map(dashDir).join('')}</div>
<div class="card"><div class="seg" role="group" aria-label="방향 필터"><button type="button" data-f="ALL" aria-pressed="true">전체</button><button type="button" data-f="LONG" aria-pressed="false">LONG</button><button type="button" data-f="SHORT" aria-pressed="false">SHORT</button></div>
<div id="journal" data-filter="ALL">${m.trades.length ? m.trades.map(dashTradeHtml).join('') : '<p class="sub">아직 기록이 없습니다.</p>'}</div>${m.tradesTotal > m.trades.length ? `<div class="sub">최근 ${m.trades.length}건만 표시</div>` : ''}</div></section>
${m.warnings.length ? `<section aria-labelledby="h-w"><h2 id="h-w">데이터 확인</h2><div class="card"><ul class="warn">${m.warnings.map(w => `<li>${dashEsc(w.text)}</li>`).join('')}</ul></div></section>` : ''}
<footer>기록 전용 · 자동 주문 없음 · 갱신 ${dashEsc(new Date(m.generatedAt + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' '))} KST</footer>
</main><script>${DASH_JS}</script></body></html>`;
}
