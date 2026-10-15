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

// 복원된 Actions 캐시가 최신인지 판정한다. caches: [{ key, created_at }] (저장소 캐시 목록, 순서 무관).
// 반환 status: ok | cold | stale | cold-with-caches | unverified | skipped
//  - 복원 키가 목록에 없으면(목록 반영 지연) 비교할 수 없으므로 stale로 단정하지 않고 unverified로 둔다:
//    더 오래된 캐시로 '되돌려 복원'하는 사고를 막기 위함.
//  - 복원 캐시의 생성 시각이 목록의 최신과 같거나 늦으면 ok.
export function judgeCache({ restoredKey, caches, ref, expectedRef = 'refs/heads/main' }) {
  if (ref !== expectedRef) return { status: 'skipped', newest: null }; // 기능 브랜치 프리뷰 등은 비교하지 않음
  if (!Array.isArray(caches)) return { status: 'unverified', newest: null };
  const time = c => Date.parse(c.created_at) || 0;
  const sorted = [...caches].filter(c => c && typeof c.key === 'string').sort((a, b) => time(b) - time(a));
  const newest = sorted[0] ?? null;
  if (!restoredKey) return newest ? { status: 'cold-with-caches', newest: newest.key } : { status: 'cold', newest: null };
  if (!newest) return { status: 'unverified', newest: null };   // 복원은 됐는데 목록이 비어 있음: 목록 지연으로 보고 판단 보류
  const mine = sorted.find(c => c.key === restoredKey);
  if (!mine) return { status: 'unverified', newest: newest.key };
  return time(mine) >= time(newest) ? { status: 'ok', newest: newest.key } : { status: 'stale', newest: newest.key };
}

// 상태 연속성이 의심될 때 Telegram 전송을 그 시간대에 한해 억제할지 결정한다(중복 전송보다 1회 생략이 안전).
//  - 손상 복구, 오래된 캐시(stale), 캐시가 있는데 복원 실패(cold-with-caches)
//  - 확인 불가(unverified): 복원된 상태가 '직전 슬롯'까지 처리한 것으로 이어지지 않으면(lastSlot !== 현재 슬롯 - 1, 상태 없음 포함) 한 실행이라도 뒤처진 상태일 수 있으므로 억제.
//    직전 슬롯과 정확히 이어지면 최신 상태로 보고 진행한다(API 일시 장애로 알림이 막히는 것을 피함).
export const QUIET_STATUSES = new Set(['stale', 'cold-with-caches']);
export function quietReason({ cacheStatus, recovered, state = {}, slot }) {
  if (recovered) return 'corrupt-state';
  if (QUIET_STATUSES.has(cacheStatus)) return `cache-${cacheStatus}`;
  if (cacheStatus === 'unverified') {
    const last = Number(state?.lastSlot);
    const continuous = Number.isFinite(last) && Number.isFinite(Number(slot)) && Number(slot) - last === 1;
    return continuous ? null : 'cache-unverified';
  }
  return null;
}
