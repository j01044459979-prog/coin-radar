// 실행 게이트: 외부 스케줄러(Cloudflare)와 GitHub 자체 schedule이 동시에 작동해도 5분 슬롯당 한 번만 수집·알림하도록 결정한다.
// 순수 함수(입력만으로 결정) — 워크플로의 'Gate' 단계와 단위 테스트가 같은 코드를 쓴다.
export const SOURCES = { cloudflare: 'cloudflare', githubSchedule: 'github-schedule' };
export const MIN_GAP_MS = 90000;        // 같은 슬롯의 중복 디스패치/이중 발화를 걸러내는 최소 간격(실행 1회 약 2분, 주기 5분이므로 정상 주기는 영향 없음)
export const TAKEOVER_MS = 900000;      // Cloudflare 모드에서 마지막 시도가 15분 넘게 없으면 GitHub schedule이 대신 실행(자동 복구)

// scheduler: 저장소 변수 RADAR_SCHEDULER ('github' 기본 | 'cloudflare'). 롤백은 이 값을 'github'로 바꾸는 것만으로 즉시 적용된다.
export function decide({ source, scheduler = 'github', state = {}, now }) {
  const last = Number(state?.lastAttempt) || 0;
  const age = last ? now - last : Infinity;
  const mode = scheduler === 'cloudflare' ? 'cloudflare' : 'github';
  const out = (run, reason) => ({ run, reason, mode, ageMs: Number.isFinite(age) ? age : null });
  if (source === SOURCES.cloudflare) {
    if (mode !== 'cloudflare') return out(false, 'RADAR_SCHEDULER=github: Cloudflare 디스패치 무시(롤백 상태)');
    return age < MIN_GAP_MS ? out(false, `직전 시도 ${Math.round(age / 1000)}초 전: 같은 슬롯 중복 디스패치`) : out(true, 'Cloudflare 정기 실행');
  }
  if (source === SOURCES.githubSchedule) {
    if (mode === 'cloudflare') return age > TAKEOVER_MS ? out(true, `Cloudflare 실행이 ${Math.round(age / 60000)}분간 없어 GitHub schedule이 대신 실행`) : out(false, 'Cloudflare 모드: GitHub schedule은 대기(정상 주기 유지 중)');
    return age < MIN_GAP_MS ? out(false, `직전 시도 ${Math.round(age / 1000)}초 전: 중복 실행`) : out(true, 'GitHub schedule 실행');
  }
  return out(true, '수동/푸시 실행'); // 사람이 직접 시작한 실행은 항상 허용
}
