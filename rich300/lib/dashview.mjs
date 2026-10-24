// 메인 화면 HTML 렌더러(서버 측 렌더링, 순수 함수, R6 수정판). 숫자 중심: 그래프·차트·장식 없음. 모바일 우선 단일 HTML 문자열.
//  · 외부 스크립트·폰트·이미지 없음(인라인 CSS만, 스크립트 없음). 모든 동적 값은 dashEsc 로 이스케이프한다(시트 값이 HTML이 될 수 없음).
//  · 색은 토큰(:root)으로 정의하고 다크 모드는 prefers-color-scheme. 색만으로 의미를 전달하지 않는다(▲▼ 기호·텍스트 라벨 병행).
//  · 일일 5%는 '목표치'이며 수익을 보장하지 않는다는 문구를 항상 표시하고, 실제 성과(입력 평가액)와 목표를 다른 줄·다른 라벨로 구분한다.
export const dashEsc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DASH_ARROW = (pos, neg) => (pos ? '▲' : neg ? '▼' : '■');
const dashTone = (pos, neg) => (pos ? 'pos' : neg ? 'neg' : 'zero');

export const DASH_PAGES = Object.freeze([['dash', '홈'], ['journal', '일지'], ['signals', '추천'], ['stats', '성적'], ['assets', '자산']]);

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
export function dashRenderHtml(m, { appUrl } = {}) {
  const title = 'RICH300', head = `<header><h1>RICH 300</h1></header>${dashNav('dash', appUrl)}`, sampleBox = m.sample ? '<div class="sample" role="note"><strong>샘플 데이터</strong> — 화면 검증용 예시입니다. 실제 계좌와 무관합니다.</div>' : '';
  if (m.noChallenge) return `${dashHead(title)}<body><main>${head}<section class="card"><p>챌린지가 아직 설정되지 않았습니다.</p><p class="sub">Apps Script에서 설치 함수를 실행하면 시작 자금 300 USDT로 설정됩니다.</p></section></main></body></html>`;
  if (m.empty) return `${dashHead(title)}<body><main>${head}${sampleBox}<section class="card"><p>아직 시작 전입니다. 시작일: ${dashEsc(m.startDay)}</p></section></main></body></html>`;
  const c = m.current, t = m.today, assetsUrl = dashUrl(appUrl, 'assets');
  const input = assetsUrl ? `<a class="cta" target="_top" href="${dashEsc(assetsUrl)}">평가액 입력하기</a>` : '';
  const hero = c
    ? `<div class="k">현재 총자산 (입력 평가액)</div><div class="big">${dashEsc(c.label)}<small>USDT</small></div><div class="sub">${c.today ? '오늘 입력' : `${dashEsc(c.day)} 입력 기준 — 오늘 평가액은 아직 없습니다`}${c.cashflowLabel ? ` · 입출금 ${dashEsc(c.cashflowLabel)}(손익과 분리)` : ''}</div>`
    : `<div class="k">현재 총자산</div><div class="big zero">미입력<small>USDT</small></div><div class="sub">거래소 평가액을 입력하면 표시됩니다. 입력이 없을 때 임의의 잔액을 만들어 보여 주지 않습니다.</div>${input}`;
  const goalNote = c && t.achieved ? '<span class="badge ok">✔ 오늘 목표 달성</span>' : c && t.achievedStale ? '<span class="badge">입력 시점 기준 목표 초과(오늘 평가액 없음)</span>' : '';
  return `${dashHead(title)}<body><main>
${head}
${sampleBox}
<section aria-label="현재 자산"><div class="card hero">${hero}</div></section>
<section aria-label="시작 자금 대비 성과"><div class="card"><div class="grid2">
<div><div class="k">시작 자금 대비 누적 손익</div>${c ? `<div class="v ${dashTone(c.pnlPositive, c.pnlNegative)}">${DASH_ARROW(c.pnlPositive, c.pnlNegative)} ${dashEsc(c.pnlLabel)} <small>USDT</small></div>` : '<div class="v zero">미입력</div>'}</div>
<div><div class="k">시작 자금 대비 누적 수익률</div>${c ? `<div class="v ${dashTone(c.pnlPositive, c.pnlNegative)}">${DASH_ARROW(c.pnlPositive, c.pnlNegative)} ${dashEsc(c.returnLabel)}</div>` : '<div class="v zero">미입력</div>'}</div></div>
<div class="sub" style="margin-top:8px">시작 자금 ${dashEsc(m.startEquity)} USDT · 입출금은 손익에서 제외</div></div></section>
<section aria-labelledby="h-today"><h2 id="h-today">오늘 (${dashEsc(t.day)}) · ${t.n}일차</h2><div class="card"><div class="grid2">
<div><div class="k">오늘 시작 자산</div><div class="v">${dashEsc(t.startLabel)} <small>USDT</small></div></div>
<div><div class="k">오늘 목표 자산 (+${dashEsc(t.rate)})</div><div class="v">${dashEsc(t.targetLabel)} <small>${dashEsc(t.targetProfitLabel)}</small></div></div>
<div><div class="k">오늘 실현손익</div><div class="v ${dashTone(t.realizedPositive, t.realizedNegative)}">${DASH_ARROW(t.realizedPositive, t.realizedNegative)} ${dashEsc(t.realizedLabel)} <small>USDT</small></div></div>
<div><div class="k">목표까지 남은 금액</div>${t.remainingLabel === null ? '<div class="v zero">미입력</div>' : `<div class="v">${dashEsc(t.remainingLabel)} <small>USDT</small></div>`}</div></div>
${goalNote ? `<div style="margin-top:8px">${goalNote}</div>` : ''}
${t.needsReview ? `<div class="alert" role="alert">⚠ 장부와 입력 평가액의 차이 ${dashEsc(t.diffLabel)} USDT — 확인이 필요합니다(자동으로 손익에 반영하지 않음).</div>` : ''}
<div class="sub" style="margin-top:8px">목표 = 전일 실제 마감 자산 × (1+${dashEsc(t.rate)}). 목표치일 뿐 수익을 보장하지 않으며 실제 성과는 입력 평가액 기준입니다.</div></div></section>
<section aria-labelledby="h-daily"><h2 id="h-daily">날짜별 마감 자산 · 일간 손익${m.dailyTotal > m.daily.length ? ` <span class="sub">(최근 ${m.daily.length}일)</span>` : ''}</h2><div class="card"><table><thead><tr><th>날짜</th><th>마감 자산</th><th>일간 손익</th></tr></thead><tbody>
${m.daily.map(d => `<tr><td>${dashEsc(d.day.slice(5))}${d.today ? ' <span class="sub">오늘·진행 중</span>' : ''}${d.met ? ' <span class="badge ok">달성</span>' : ''}</td><td>${d.input ? dashEsc(d.closeLabel) : '<span class="sub">미입력</span>'}${d.review ? ' <span class="sub">⚠ 장부 차이</span>' : ''}</td><td class="${dashTone(d.pnlPositive, d.pnlNegative)}">${DASH_ARROW(d.pnlPositive, d.pnlNegative)} ${dashEsc(d.pnlLabel)}${d.input ? '' : '<span class="sub">장부상 실현손익</span>'}</td></tr>`).join('')}
</tbody></table></div></section>
${m.warnings.length ? `<section aria-labelledby="h-w"><h2 id="h-w">데이터 확인</h2><div class="card"><ul class="warn">${m.warnings.map(w => `<li>${dashEsc(w.text)}</li>`).join('')}</ul></div></section>` : ''}
${dashFooter(m)}
</main></body></html>`;
}
