// 실행 게이트: 외부 스케줄러(Cloudflare)와 GitHub 자체 schedule이 동시에 작동해도 5분 슬롯당 한 번만 수집·알림하도록 결정한다.
// 순수 함수(입력만으로 결정) — 워크플로의 'Gate' 단계와 단위 테스트가 같은 코드를 쓴다.
export const SOURCES = { cloudflare: 'cloudflare', githubSchedule: 'github-schedule' };
export const SLOT_MS = 300000;
export const MIN_GAP_MS = 90000;        // 슬롯 정보가 없는 호출을 위한 보조 간격(정상 주기는 영향 없음)
export const TAKEOVER_MS = 900000;      // Cloudflare 모드에서 마지막 시도가 15분 넘게 없으면 GitHub schedule이 대신 실행(자동 복구)

export const slotOfTime = ms => Math.floor(ms / SLOT_MS);

// slot: 디스패처가 보낸 5분 슬롯 번호(없으면 현재 시각 기준 슬롯). 슬롯 멱등성이 1차 방어, 90초 간격은 보조.
// 한 번 처리한 슬롯(state.lastSlot)과 그 이전 슬롯은 어떤 출처든 다시 실행하지 않는다 → 같은 슬롯의 중복 분석·Telegram 전송 불가,
// 늦게 도착한 오래된 디스패치도 무시된다.
// scheduler: 저장소 변수 RADAR_SCHEDULER ('github' 기본 | 'cloudflare'). 롤백은 이 값을 'github'로 바꾸는 것만으로 즉시 적용된다.
export function decide({ source, scheduler = 'github', state = {}, now, slot }) {
  const last = Number(state?.lastAttempt) || 0;
  const age = last ? now - last : Infinity;
  const mode = scheduler === 'cloudflare' ? 'cloudflare' : 'github';
  const slotNow = Number.isFinite(Number(slot)) && slot !== '' && slot !== null && slot !== undefined ? Number(slot) : slotOfTime(now);
  const handled = Number(state?.lastSlot);
  const out = (run, reason) => ({ run, reason, mode, slot: slotNow, ageMs: Number.isFinite(age) ? age : null });
  const dup = () => Number.isFinite(handled) && slotNow <= handled ? out(false, `슬롯 ${slotNow}은(는) 이미 처리됨(마지막 처리 슬롯 ${handled}): 중복·지연 실행 무시`) : null;
  if (source === SOURCES.cloudflare) {
    if (mode !== 'cloudflare') return out(false, 'RADAR_SCHEDULER=github: Cloudflare 디스패치 무시(롤백 상태)');
    return dup() ?? (age < MIN_GAP_MS ? out(false, `직전 시도 ${Math.round(age / 1000)}초 전: 같은 시점 중복 디스패치`) : out(true, 'Cloudflare 정기 실행'));
  }
  if (source === SOURCES.githubSchedule) {
    if (mode === 'cloudflare') return age > TAKEOVER_MS ? (dup() ?? out(true, `Cloudflare 실행이 ${Math.round(age / 60000)}분간 없어 GitHub schedule이 대신 실행`)) : out(false, 'Cloudflare 모드: GitHub schedule은 대기(정상 주기 유지 중)');
    return dup() ?? (age < MIN_GAP_MS ? out(false, `직전 시도 ${Math.round(age / 1000)}초 전: 중복 실행`) : out(true, 'GitHub schedule 실행'));
  }
  return out(true, '수동/푸시 실행'); // 사람이 직접 시작한 실행은 항상 허용
}

// 복원된 Actions 캐시가 최신인지 판정한다. caches: [{ key, created_at }] (저장소 캐시 목록, 최신순 무관).
// 반환 status: ok | cold | stale | cold-with-caches | unverified | skipped
export function judgeCache({ restoredKey, caches, ref, expectedRef = 'refs/heads/main' }) {
  if (ref !== expectedRef) return { status: 'skipped', newest: null }; // 기능 브랜치 프리뷰 등은 비교하지 않음
  if (!Array.isArray(caches)) return { status: 'unverified', newest: null };
  const sorted = [...caches].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const newest = sorted[0]?.key ?? null;
  if (!restoredKey) return newest ? { status: 'cold-with-caches', newest } : { status: 'cold', newest: null };
  if (!newest) return { status: 'unverified', newest: null }; // 복원은 됐는데 목록이 비어 있음: 목록 지연으로 보고 판단 보류
  return restoredKey === newest ? { status: 'ok', newest } : { status: 'stale', newest };
}

// 상태 연속성이 의심될 때 Telegram 전송을 그 시간대에 한해 억제할지 결정한다(중복 전송보다 1회 생략이 안전).
export const QUIET_STATUSES = new Set(['stale', 'cold-with-caches']);
export function quietReason({ cacheStatus, recovered }) {
  if (recovered) return 'corrupt-state';
  return QUIET_STATUSES.has(cacheStatus) ? `cache-${cacheStatus}` : null;
}
