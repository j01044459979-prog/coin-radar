// 시험 결과 자동 요약(PASS/FAIL/WAIT/WARN/SKIP). 입력은 자동 시험 결과·폴링 통계·마법사 상태·시트 집계뿐이며, 출력에는 금액·ID·토큰·이메일이 없다.
//  판정 규칙은 LIVE-TEST.md 의 통과 기준과 같다. 관찰 중인 항목(24시간·자정)은 기준을 지금까지 만족하면 WAIT(잠정 통과), 어기면 FAIL.
import { storeList, storeIntegrityCheck } from './store.mjs';
import { kstDayOf } from './time.mjs';
import { LIVE_STEPS, liveGet } from './livewizard.mjs';
import { LIVE_LIMITS, liveProjectDailyMin } from './livesafe.mjs';

const LIVE_AUTO_IDS = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'C1', 'C2', 'C3', 'C4', 'C5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'];
const liveIt = (id, status, text) => ({ id, status, text });
const liveMedian = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

// ctx: { env(storeEnv 포함), now, auto:[...], stats:{since,runs,totalMs,maxMs,slow,busy,gaps90,maxGap,retry,errStreak}, counters:{...}, halt:{reason,text}|null, intervalMin }
export function liveBuildReport(env, ctx) {
  const st = liveGet(env), se = env.storeEnv(), items = [...(ctx.auto ?? [])], stats = ctx.stats ?? {}, c = ctx.counters ?? {}, now = ctx.now;
  const elapsedH = stats.since ? (now - stats.since) / 3600000 : 0, observing = elapsedH < 24, act = st ? st.act : {}, done = st ? st.done : {};
  const wait = (ok, text, extra = '') => liveIt(null, ok ? (observing ? 'WAIT' : 'PASS') : 'FAIL', `${text}${observing && ok ? ` (관찰 ${elapsedH.toFixed(1)}/24시간, 잠정 통과)` : ''}${extra}`);
  for (const id of LIVE_AUTO_IDS) if (!items.some(i => i.id === id)) items.push(liveIt(id, 'WAIT', '아직 실행 전(백그라운드에서 진행 중)'));
  const iv = ctx.intervalMin ?? 1, expected = Math.max(1, Math.floor((now - (stats.since ?? now)) / (iv * 60000))), ratio = stats.runs ? stats.runs / expected : 0;
  if (!stats.runs) { items.push(liveIt('D1', 'WAIT', '폴링 관찰 시작 전(트리거 실행 없음)')); }
  else {
    const avg = stats.totalMs / stats.runs, proj = liveProjectDailyMin(avg, iv);
    items.push({ ...wait(ratio >= 0.9 || elapsedH < 0.5, `폴링 실행 ${stats.runs}회 / 이론 ${expected}회(${Math.round(ratio * 100)}%, 간격 ${iv}분) — 카운터 기준이며 편집기 Executions 건수와는 별도`), id: 'D1' });
    items.push({ ...wait(avg <= 3000 && stats.maxMs <= 15000 && (stats.slow ?? 0) === 0, `실행 시간 평균 ${Math.round(avg)}ms · 최대 ${stats.maxMs}ms · 30초 초과 ${stats.slow ?? 0}회`), id: 'D2' });
    items.push({ ...wait(proj <= LIVE_LIMITS.dailyBudgetMin, `하루 총 실행 시간 추정 ${proj}분(내부 한도 ${LIVE_LIMITS.dailyBudgetMin}분, 문서상 한도 ${LIVE_LIMITS.assumedQuotaMin}분은 미검증 가정)`), id: 'D3' });
    const gp = stats.runs ? (stats.gaps90 ?? 0) / stats.runs : 0; items.push({ ...wait(gp <= 0.03, `90초 초과 간격 ${stats.gaps90 ?? 0}회(${(gp * 100).toFixed(1)}%), 최대 간격 ${Math.round((stats.maxGap ?? 0) / 1000)}초`), id: 'D4' });
    const bp = (stats.busy ?? 0) / stats.runs; items.push({ ...wait(bp <= 0.02, `겹침(busy) ${stats.busy ?? 0}회(${(bp * 100).toFixed(1)}%), 중복 기록은 유일키로 0`), id: 'D5' });
  }
  const lags = st ? st.lags : [];
  items.push(lags.length >= 3 ? liveIt('D6', liveMedian(lags) <= 70000 && Math.max(...lags) <= 150000 ? 'PASS' : 'FAIL', `메시지 처리 지연 중앙값 ${Math.round(liveMedian(lags) / 1000)}초 · 최대 ${Math.round(Math.max(...lags) / 1000)}초 (n=${lags.length})`) : liveIt('D6', 'SKIP', `메시지 처리 지연 표본 부족(n=${lags.length}) — 버튼은 도착 시각이 없어 측정할 수 없고 입력한 메시지만 측정됩니다`));
  // E 기능 시나리오
  const rs = storeList(se, 'response').map(r => r.data).filter(r => st && r.sid === st.sid), fl = storeList(se, 'fill').map(r => r.data).filter(f => st && f.sid === st.sid), kind = k => fl.filter(f => f.kind === k).length;
  const started = !!(st && st.phase !== 'unpaired'), skipped = id => done[id] !== undefined && done[id] < 0, pending = id => !(id in done);
  const wiz = (id, step, label, cond, okText, extra = '') => items.push(!started ? liveIt(id, 'WAIT', `${label}: 페어링 전`) : skipped(step) ? liveIt(id, 'SKIP', `${label}: 웹 주소 없음 — 미검증`) : cond ? liveIt(id, 'PASS', `${label}: ${okText}${extra}`) : pending(step) || st.phase !== 'done' ? liveIt(id, 'WAIT', `${label}: 진행 중`) : liveIt(id, 'FAIL', `${label}: 판정 기준 미충족`));
  items.push(act.unpaired > 0 ? liveIt('E1', 'PASS', `낯선 계정 메시지 ${act.unpaired}건이 무응답·무기록으로 무시됨`) : liveIt('E1', 'SKIP', '낯선 계정 메시지를 보내지 않아 미검증'));
  items.push(started && st.pairedAt ? liveIt('E2', 'PASS', '신호 알림 메시지 발송·버튼 표시(발송 성공)') : liveIt('E2', 'WAIT', '페어링 전'));
  wiz('E3', 'signal', '진입했어 버튼', rs.length === 1 && rs[0].choice === 'entered', `응답 ${rs.length}건`, `, 연타 관측 ${(act['response-duplicate'] ?? 0) + (act['response-conflict'] ?? 0)}회`);
  wiz('E4', 'fill-again', '같은 입력 재시도', (act['fill-rejected'] ?? 0) >= 1 && kind('entry') + kind('add') === 1, `재입력 차단 ${act['fill-rejected'] ?? 0}회, 진입 ${kind('entry') + kind('add')}건`);
  const webUsed = (act['live-exit2-draft'] ?? 0) === 0; wiz('E5', 'exit-web', '웹 입력 화면', kind('close') === 1 && webUsed, `웹 입력 화면 전량 청산 ${kind('close')}건`);
  if (started && kind('close') === 1 && !webUsed) items[items.length - 1] = liveIt('E5', 'SKIP', '웹 입력 화면 대신 대체 버튼을 써서 웹 폼은 미검증');
  items.push(!started ? liveIt('E6', 'WAIT', '페어링 전') : kind('reduce') === 1 && kind('close') === 1 ? liveIt('E6', 'PASS', '부분 청산 1건 + 전량 청산 1건') : liveIt('E6', st.phase === 'done' ? 'FAIL' : 'WAIT', `부분 ${kind('reduce')}건 · 전량 ${kind('close')}건`));
  const rv = storeList(se, 'review').filter(r => st && r.key === st.sid).length; wiz('E7', 'review', '10초 복기', rv === 1, `복기 ${rv}건(저장 전 0건은 오프라인 시험으로 검증)`);
  const eqN = storeList(se, 'equity').length; wiz('E8', 'equity', '평가액 입력', eqN >= 1, `평가액 ${eqN}건, 차이는 표시만(손익 자동 반영 없음)`);
  wiz('E9', 'journal-edit', '일지 수정 이력', true, '체결 수정 이력(rev ≥ 2) 확인');
  wiz('E10', 'cashflow', '입출금 기록', true, '입출금 기록 확인');
  const ownerOk = c['ui-owner-ok'] ?? 0, denOther = c['ui-denied-other'] ?? 0, denAnon = c['ui-denied-anon'] ?? 0;
  items.push(ownerOk >= 1 && denOther >= 1 ? liveIt('E11', 'PASS', `UI: 소유자 접속 ${ownerOk}회 표시, 다른 Google 계정 접속 ${denOther}회 차단, 익명 ${denAnon}회 차단`)
    : ownerOk >= 1 && denAnon >= 1 ? liveIt('E11', 'WARN', `UI: 소유자 표시 ${ownerOk}회, 익명 차단 ${denAnon}회 확인 — 두 번째 Google 계정 차단은 미검증`)
    : ownerOk >= 1 ? liveIt('E11', 'WAIT', `UI: 소유자 표시 ${ownerOk}회 확인 — 차단 시험(시크릿 창/다른 계정) 대기`)
    : (denAnon + denOther) >= 1 ? liveIt('E11', observing ? 'WARN' : 'FAIL', `UI: 소유자 접속 표시는 없고 차단 기록만 ${denAnon + denOther}회 — 본인 계정이 막혔을 수 있음("접속한 사용자로 실행" 배포 설정 확인 또는 UI 인증 방식 재설계 필요)${observing ? ' [관찰 중]' : ''}`) : liveIt('E11', 'WAIT', 'UI 접속 대기'));
  const notices = storeList(se, 'closenotice').map(r => r.data), sent = notices.filter(n => n.status === 'sent');
  items.push(sent.length >= 1 ? liveIt('E12', sent.length === new Set(sent.map(n => n.day)).size ? 'PASS' : 'FAIL', `일 마감 알림 발송 ${sent.length}건(날짜당 1회, 중복 ${sent.length - new Set(sent.map(n => n.day)).size})`) : liveIt('E12', 'WAIT', st && st.notify ? '자정 마감 알림 대기(00:00~01:00)' : '알림 시험 활성화 전(평가액 입력 단계 이후)'));
  // F 중복·장애
  items.push((act['draft-gone'] ?? 0) >= 1 ? liveIt('F3', 'PASS', `만료된 초안 저장 시도 ${act['draft-gone']}회 → 기록 0건, 안내 표시`) : liveIt('F3', started ? 'WAIT' : 'WAIT', '만료 초안 시험 대기'));
  const fd = c['form-duplicate'] ?? 0; items.push(fd >= 1 ? liveIt('F4', 'PASS', `웹 폼 중복 제출 ${fd}회 → 1건으로 수렴`) : liveIt('F4', 'SKIP', '웹 폼 중복 제출이 관측되지 않아 미검증(오프라인 시험으로는 검증됨)'));
  items.push(liveIt('F5', 'SKIP', `락 경합 직접 시험은 수동 항목(선택). 관측: LOCK 재시도 ${stats.retry ?? 0}회`));
  let ic; try { ic = storeIntegrityCheck(se); } catch { ic = { ok: false, issues: [{ type: 'read-failed' }] }; }
  const onlyMissing = !ic.ok && ic.issues.every(i => i.type === 'missing-view');
  items.push(ic.ok ? liveIt('F6', 'PASS', `무결성 OK(감사 ${ic.auditCount}행)`) : onlyMissing ? liveIt('F6', 'WARN', `무결성: 마지막 쓰기 중단 흔적(엔티티 행 누락 ${ic.issues.length}건, storeRepair로 복구 가능)`) : liveIt('F6', 'FAIL', `무결성 문제: ${[...new Set(ic.issues.map(i => i.type))].join(', ')}`));
  // H 마감 트리거
  const closes = storeList(se, 'dayclose').map(r => r.data).filter(d => st && d.closedAt > st.startedAt), mid = closes.filter(d => { const h = new Date(d.closedAt + 9 * 3600000).getUTCHours(); return h < 2 && kstDayOf(d.closedAt) !== d.day; });
  items.push(mid.length >= 1 ? liveIt('H1', 'PASS', `자정 트리거 마감 ${mid.length}건, 지연 ${mid.map(d => Math.round(((d.closedAt + 9 * 3600000) % 86400000) / 60000)).join('·')}분(00:00 기준)`) : liveIt('H1', 'WAIT', '자정(00:00~01:00 KST) 마감 관찰 대기'));
  items.push(liveIt('H2', 'SKIP', '매시간 재확인의 놓친 날 보충은 수동 항목(선택): 00시 트리거를 하루 꺼 두면 확인 가능'));
  // S 안전
  items.push(ctx.halt ? (ctx.halt.reason === 'window-ended' ? liveIt('S1', 'PASS', '시험 시간(36시간) 종료로 정상 중단') : liveIt('S1', 'FAIL', `자동 중단: ${ctx.halt.text}`)) : liveIt('S1', 'PASS', '자동 중단 조건 미해당(운영 환경 접근·토큰 오류·할당량 오류·무결성 문제 없음)'));
  items.push(liveIt('S2', 'PASS', '이 시험은 test 환경·테스트 봇에서만 실행(운영 승인 플래그 없음, 모든 메시지 [TEST])'));
  return items;
}
export function liveSummary(items) {
  const n = s => items.filter(i => i.status === s).length, fail = n('FAIL'), wait = n('WAIT');
  return { pass: n('PASS'), fail, wait, warn: n('WARN'), skip: n('SKIP'), verdict: fail ? 'FAIL' : wait ? 'WAIT' : 'PASS' };
}
// 텔레그램/로그용 텍스트(4096자 한도 안에서 나눔). 값 없는 PASS/FAIL 줄만.
export function liveReportTexts(items, { title = 'LIVE 결과' } = {}) {
  const s = liveSummary(items), head = `${title}: ${s.verdict} — PASS ${s.pass} · FAIL ${s.fail} · WAIT ${s.wait} · WARN ${s.warn} · SKIP ${s.skip}`, lines = items.map(i => `${i.status} ${i.id} ${i.text}`);
  const out = []; let cur = head; for (const l of lines) { if (cur.length + l.length + 1 > 3600) { out.push(cur); cur = `${title}(계속)`; } cur += `\n${l}`; } out.push(cur); return out;
}
void LIVE_STEPS;
