// Cron 표현식 → 실행 종류. wrangler.toml [triggers] crons 와 반드시 일치해야 합니다 (테스트로 확인).
//
// 이전 버전은 controller.cron === '*/2 * * * *' 일 때만 정보 수집을 실행하고 그 외는 모두 Upbit 감시로 보냈습니다.
// 표현식 문자열이 조금이라도 다르게 전달되면 정보 수집이 영원히 실행되지 않는 구조였습니다.
// 이제는 '1분마다' 표현식(또는 표현식 정보가 없는 호출)만 Upbit 감시이고, 그 밖의 모든 Cron 은 정보 수집입니다.

export const MONITOR_CRON = '* * * * *';
export const INTEL_CRON = '*/2 * * * *';
export const CRONS = [MONITOR_CRON, INTEL_CRON];

export function cronKind(cron) {
  const c = typeof cron === 'string' ? cron.trim().replace(/\s+/g, ' ') : '';
  return !c || c === MONITOR_CRON ? 'monitor' : 'intel';
}
