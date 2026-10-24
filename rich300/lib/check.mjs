// 설치·검증 결과 화면(?p=check, 소유자 전용). 순수 함수: GAS가 모은 상태(값 없음)를 PASS/FAIL 요약 HTML로 만든다.
//  · 사용자에게 로그·스크린샷을 반복해서 요청하지 않도록, 설치 점검·자동 검증·폴링 실측을 한 화면에 모은다(복사 가능한 텍스트 포함).
//  · 토큰·키·이메일·시트 ID·금액은 어디에도 없다(존재 여부·개수·시간만).
import { dashEsc, dashHead, dashNav, dashFooter } from './dashview.mjs';

export const CHECK_STATUS_LABEL = Object.freeze({ PASS: '통과', FAIL: '실패', WARN: '주의', WAIT: '진행 중', SKIP: '건너뜀' });
// items: [{id,status,text}] (status: PASS|FAIL|WARN|WAIT|SKIP)
export function checkSummary(items) {
  const c = { PASS: 0, FAIL: 0, WARN: 0, WAIT: 0, SKIP: 0 }; for (const i of items) if (Object.hasOwn(c, i.status)) c[i.status]++;
  return { ...c, verdict: c.FAIL ? 'FAIL' : c.WAIT ? 'WAIT' : c.WARN ? 'WARN' : 'PASS' };
}
// selfTest 항목({id,level,ok,text})을 같은 형식으로
export const checkFromSelfTest = r => (r && Array.isArray(r.items) ? r.items.map(i => ({ id: `S-${i.id}`, status: i.ok ? 'PASS' : i.level === 'fail' ? 'FAIL' : 'WARN', text: i.ok ? i.text.replace(/\s*\(.*$/, '') : i.text })) : []);
// 폴링 통계(tg:stats)를 실측 항목으로: 평균·최대 실행 시간, 간격 이상, 느린 실행
export function checkPollItems(st, { minRuns = 20 } = {}) {
  if (!st || !st.runs) return [{ id: 'P1', status: 'WAIT', text: 'Telegram 폴링이 아직 한 번도 실행되지 않았습니다(승인·페어링 후 시작)' }];
  const avg = Math.round(st.totalMs / st.runs), out = [];
  out.push({ id: 'P1', status: st.runs >= minRuns ? 'PASS' : 'WAIT', text: `폴링 ${st.runs}회 실행${st.runs >= minRuns ? '' : `(판정은 ${minRuns}회 이상부터)`}` });
  out.push({ id: 'P2', status: st.maxMs > 60000 ? 'FAIL' : st.maxMs > 30000 ? 'WARN' : 'PASS', text: `실행 시간 평균 ${avg}ms · 최대 ${st.maxMs}ms` });
  out.push({ id: 'P3', status: st.runs < minRuns ? 'WAIT' : (st.gaps90 || 0) > Math.max(2, Math.floor(st.runs * 0.1)) ? 'WARN' : 'PASS', text: `90초를 넘긴 실행 간격 ${st.gaps90 || 0}회(최대 간격 ${Math.round((st.maxGap || 0) / 1000)}초)` });
  out.push({ id: 'P4', status: (st.slow || 0) ? 'WARN' : 'PASS', text: `30초 넘게 걸린 실행 ${st.slow || 0}회 · 잠금 대기(busy) ${st.busy || 0}회` });
  return out;
}
const checkSym = { PASS: '✔', FAIL: '✖', WARN: '▲', WAIT: '…', SKIP: '–' };
export function checkReportText(sections) {
  const all = sections.flatMap(s => s.items), sum = checkSummary(all);
  return [`RICH300 점검 결과: ${CHECK_STATUS_LABEL[sum.verdict]} (통과 ${sum.PASS} · 실패 ${sum.FAIL} · 주의 ${sum.WARN} · 진행 중 ${sum.WAIT})`, ...sections.flatMap(s => [`[${s.title}]`, ...s.items.map(i => `${checkSym[i.status] ?? '?'} ${i.id} ${i.text}`)])].join('\n');
}
export function checkRenderHtml({ sections, generatedAt, notes = [] }, { appUrl } = {}) {
  const all = sections.flatMap(s => s.items), sum = checkSummary(all), tone = s => (s === 'PASS' ? 'pos' : s === 'FAIL' ? 'neg' : 'zero');
  const sec = s => `<section><h2>${dashEsc(s.title)}</h2><div class="card"><table><tbody>${s.items.map(i => `<tr><td class="${tone(i.status)}">${checkSym[i.status] ?? '?'} ${dashEsc(CHECK_STATUS_LABEL[i.status] ?? i.status)}</td><td style="text-align:left">${dashEsc(i.id)} · ${dashEsc(i.text)}</td></tr>`).join('') || '<tr><td colspan="2" class="sub">항목 없음</td></tr>'}</tbody></table></div></section>`;
  return `${dashHead('RICH300 점검')}<body><main><header><h1>RICH 300 · 설치 점검</h1></header>${dashNav('check', appUrl)}
<section><div class="card hero"><div class="k">전체 판정</div><div class="big ${tone(sum.verdict)}">${dashEsc(CHECK_STATUS_LABEL[sum.verdict])}</div><div class="sub">통과 ${sum.PASS} · 실패 ${sum.FAIL} · 주의 ${sum.WARN} · 진행 중 ${sum.WAIT}${sum.WAIT ? ' — 잠시 뒤 새로 고침' : ''}</div></div></section>
${notes.map(n => `<div class="notice">${dashEsc(n)}</div>`).join('')}
${sections.map(sec).join('\n')}
<section><h2>복사용 요약</h2><div class="card"><pre style="white-space:pre-wrap;word-break:break-word;margin:0;font-size:12px">${dashEsc(checkReportText(sections))}</pre></div></section>
${dashFooter({ generatedAt })}</main></body></html>`;
}
export const checkRenderError = appUrl => `${dashHead('RICH300 점검')}<body><main><header><h1>RICH 300 · 설치 점검</h1></header>${dashNav('check', appUrl)}<section class="card"><p>점검 결과를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.</p></section></main></body></html>`;
