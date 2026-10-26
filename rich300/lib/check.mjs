// 설치·검증 결과 화면(?p=check, 소유자 전용). 순수 함수: GAS가 모은 상태(값 없음)를 PASS/FAIL 요약 HTML로 만든다.
//  · 사용자에게 로그·스크린샷을 반복해서 요청하지 않도록, 설치 점검·자동 검증·폴링 실측을 한 화면에 모은다(복사 가능한 텍스트 포함).
//  · 토큰·키·이메일·시트 ID·금액은 어디에도 없다(존재 여부·개수·시간만).
import { dashEsc, dashHead, dashNav, dashFooter } from './dashview.mjs';

export const CHECK_STATUS_LABEL = Object.freeze({ PASS: '통과', FAIL: '실패', WARN: '주의', WAIT: '진행 중', SKIP: '건너뜀' });
// items: [{id,status,text}] (status: PASS|FAIL|WARN|WAIT|SKIP)
export function checkSummary(items) {
  const c = { PASS: 0, FAIL: 0, WARN: 0, WAIT: 0, SKIP: 0 }; for (const i of items) if (Object.prototype.hasOwnProperty.call(c, i.status)) c[i.status]++;
  return { ...c, verdict: c.FAIL ? 'FAIL' : c.WAIT ? 'WAIT' : c.WARN ? 'WARN' : 'PASS' };
}
// selfTest 항목({id,level,ok,text})을 같은 형식으로
export const checkFromSelfTest = r => (r && Array.isArray(r.items) ? r.items.map(i => ({ id: `S-${i.id}`, status: i.ok ? 'PASS' : i.level === 'fail' ? 'FAIL' : 'WARN', text: i.ok ? i.text.replace(/\s*\(.*$/, '') : i.text })) : []);
// 폴링 통계(tg:stats)를 실측 항목으로: 평균·최대 실행 시간, 간격 이상, 느린 실행
export function checkPollItems(st, { minRuns = 20, last = null } = {}) {
  if (last && last.r && last.r.status === 'error' && last.r.code === 'conflict') return [{ id: 'P0', status: 'FAIL', text: '다른 곳에서 같은 봇의 업데이트를 가져가고 있거나 웹훅이 켜져 있습니다(409). 폴링이 동작하지 않습니다 — 설정은 건드리지 않았습니다' }];
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
  return [`RICH300 점검 결과: ${CHECK_STATUS_LABEL[sum.verdict]} (통과 ${sum.PASS} · 실패 ${sum.FAIL} · 주의 ${sum.WARN} · 진행 중 ${sum.WAIT})`, ...sections.flatMap(s => [`[${s.title}]`, ...s.items.map(i => `${(checkSym[i.status] != null ? checkSym[i.status] : '?')} ${i.id} ${i.text}`)])].join('\n');
}
export function checkRenderHtml({ sections, generatedAt, notes = [] }, { appUrl } = {}) {
  const all = sections.flatMap(s => s.items), sum = checkSummary(all), tone = s => (s === 'PASS' ? 'pos' : s === 'FAIL' ? 'neg' : 'zero');
  const sec = s => `<section><h2>${dashEsc(s.title)}</h2><div class="card"><table><tbody>${s.items.map(i => `<tr><td class="${tone(i.status)}">${(checkSym[i.status] != null ? checkSym[i.status] : '?')} ${dashEsc((CHECK_STATUS_LABEL[i.status] != null ? CHECK_STATUS_LABEL[i.status] : i.status))}</td><td style="text-align:left">${dashEsc(i.id)} · ${dashEsc(i.text)}</td></tr>`).join('') || '<tr><td colspan="2" class="sub">항목 없음</td></tr>'}</tbody></table></div></section>`;
  return `${dashHead('RICH300 점검')}<body><main><header><h1>RICH 300 · 설치 점검</h1></header>${dashNav('check', appUrl)}
<section><div class="card hero"><div class="k">전체 판정</div><div class="big ${tone(sum.verdict)}">${dashEsc(CHECK_STATUS_LABEL[sum.verdict])}</div><div class="sub">통과 ${sum.PASS} · 실패 ${sum.FAIL} · 주의 ${sum.WARN} · 진행 중 ${sum.WAIT}${sum.WAIT ? ' — 잠시 뒤 새로 고침' : ''}</div></div></section>
${notes.map(n => `<div class="notice">${dashEsc(n)}</div>`).join('')}
${sections.map(sec).join('\n')}
<section><h2>복사용 요약</h2><div class="card"><pre style="white-space:pre-wrap;word-break:break-word;margin:0;font-size:12px">${dashEsc(checkReportText(sections))}</pre></div></section>
${dashFooter({ generatedAt })}</main></body></html>`;
}
export const checkRenderError = appUrl => `${dashHead('RICH300 점검')}<body><main><header><h1>RICH 300 · 설치 점검</h1></header>${dashNav('check', appUrl)}<section class="card"><p>점검 결과를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.</p></section></main></body></html>`;

// 봇 사전 점검(읽기 전용 getMe·getWebhookInfo 결과의 요약 info: {me:{ok,code}, wh:{ok, hasUrl, pending, lastErrorAt, hasAllowed}})
export function checkBotItems(info) {
  if (!info) return [{ id: 'B0', status: 'WAIT', text: '봇 사전 점검 전(rich300BotCheck 실행, 읽기 전용 승인 또는 운영 승인 필요)' }];
  const out = [];
  out.push({ id: 'B1', status: info.me && info.me.ok ? 'PASS' : 'FAIL', text: info.me && info.me.ok ? '봇 토큰 유효(getMe)' : `봇 토큰을 확인하지 못했습니다(${info.me ? info.me.code : 'error'})` });
  if (!info.wh || !info.wh.ok) { out.push({ id: 'B2', status: 'FAIL', text: '웹훅 상태를 확인하지 못했습니다' }); return out; }
  out.push({ id: 'B2', status: info.wh.hasUrl ? 'FAIL' : 'PASS', text: info.wh.hasUrl ? '이 봇에는 웹훅이 설정되어 있습니다 — 다른 수신 서비스가 있다는 뜻이며 폴링을 쓸 수 없습니다(설정은 지우지 않음)' : '웹훅 없음(폴링 사용 가능)' });
  out.push({ id: 'B3', status: info.wh.pending > 0 ? 'WARN' : 'PASS', text: info.wh.pending > 0 ? `아직 가져가지 않은 업데이트 ${info.wh.pending}건 — 첫 폴링에서 처리됩니다(페어링 전에는 모두 무시, 기록 없음)` : '대기 중인 업데이트 없음' });
  out.push({ id: 'B4', status: info.wh.lastErrorAt ? 'WARN' : 'PASS', text: info.wh.lastErrorAt ? '웹훅 전달 오류 기록이 있습니다(과거 웹훅 사용 흔적)' : '웹훅 오류 기록 없음' });
  return out;
}
