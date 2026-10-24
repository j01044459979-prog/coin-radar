// 24시간 폴링 시험의 안전 장치(순수 함수): 실행 시간 예산 추정, 폴링 간격 선택, 자동 중단 조건.
//  · Apps Script 한도(문서상 일일 트리거 총 실행 90분·실행당 6분·UrlFetch 2만 회/일)는 *미검증 가정*이라, 그보다 넉넉한 내부 한도(일일 60분 추정)를 먼저 넘으면 스스로 멈춘다.
//  · 중단은 트리거 제거 + 사유 기록 + (가능하면) [TEST] 알림뿐이다. 프로젝트·시트·백업·봇은 삭제하거나 바꾸지 않는다.
export const LIVE_LIMITS = Object.freeze({ dailyBudgetMin: 60, assumedQuotaMin: 90, maxRunMs: 120000, slowMax: 3, errStreakMax: 15, windowMs: 36 * 3600000, sentPerDayMax: 300, extraDailyMin: 6, minRunsForBudget: 30 });
export const liveProjectDailyMin = (avgMs, intervalMin) => Math.round(((avgMs * (1440 / intervalMin)) / 60000 + LIVE_LIMITS.extraDailyMin) * 10) / 10;
// 평균 유휴 폴링 시간으로 간격 선택: 1분이 예산 안이면 1분, 아니면 5분, 5분도 넘으면 설치하지 않는다(minutes=null).
export function liveChooseInterval(avgMs) {
  for (const m of [1, 5]) { const p = liveProjectDailyMin(avgMs, m); if (p <= LIVE_LIMITS.dailyBudgetMin) return { minutes: m, projectedMin: p }; }
  return { minutes: null, projectedMin: liveProjectDailyMin(avgMs, 5) };
}
// i: { env, prodApproved, stats:{runs,totalMs,maxMs,slow}, intervalMin, now, startedAt, errStreak, authError, quotaHit, sentToday, integrityBad }
export function liveSafety(i) {
  const L = LIVE_LIMITS, halt = (reason, text, graceful = false) => ({ halt: true, reason, text, graceful });
  if (i.env !== 'test' || i.prodApproved) return halt('env-guard', '테스트 환경이 아니거나 운영 승인 플래그가 있습니다');
  if (i.authError) return halt('bot-token-invalid', '봇 토큰이 거부되었습니다(폐기·오입력)');
  if (i.quotaHit) return halt('quota-exceeded', 'Apps Script 할당량/호출 한도 오류가 감지되었습니다');
  if (i.integrityBad) return halt('integrity', '저장소 무결성 문제가 감지되었습니다');
  if (i.errStreak >= L.errStreakMax) return halt('poll-errors', `폴링이 ${i.errStreak}회 연속 실패했습니다`);
  const st = i.stats ?? {};
  if ((st.maxMs ?? 0) > L.maxRunMs) return halt('run-too-long', `폴링 1회가 ${Math.round(st.maxMs / 1000)}초 걸렸습니다(한도 ${L.maxRunMs / 1000}초)`);
  if ((st.slow ?? 0) >= L.slowMax) return halt('slow-runs', `30초가 넘는 폴링이 ${st.slow}회 발생했습니다`);
  if ((st.runs ?? 0) >= L.minRunsForBudget) { const p = liveProjectDailyMin(st.totalMs / st.runs, i.intervalMin ?? 1); if (p > L.dailyBudgetMin) return halt('runtime-budget', `하루 예상 실행 시간 ${p}분이 내부 한도 ${L.dailyBudgetMin}분을 넘습니다`); }
  if ((i.sentToday ?? 0) > L.sentPerDayMax) return halt('message-flood', `하루 발송 ${i.sentToday}건이 한도 ${L.sentPerDayMax}건을 넘었습니다`);
  if (i.now - i.startedAt >= L.windowMs) return halt('window-ended', '시험 시간(36시간)이 끝났습니다', true);
  return { halt: false };
}
