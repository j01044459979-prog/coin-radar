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
//  - 손상 복구, 오래된 캐시(stale), 캐시가 있는데 복원 실패(cold-with-caches): 확실한 이상 신호 → 감지될 때마다 그 시간대 억제(fail-closed)
//    (억제한 실행이 새 최신 캐시를 저장하므로 보통 한 번으로 해소된다)
//  - 확인 불가(unverified, 캐시 API 장애): 직전 슬롯과 이어지는 상태면 진행. 이어지지 않으면 억제하되 **장애 한 건당 1시간만**(fail-open):
//    확인 불가는 '이상 증거'가 아니라 '정보 부족'이므로, 같은 장애가 계속돼도 두 번째 시간대부터는 정기 보고를 재개한다
//    (장시간 알림 누락 방지 — 대신 이때 오래된 캐시가 복원되면 정기 보고 1회 중복이 가능, 아래 ALERT로 알림).
export const QUIET_STATUSES = new Set(['stale', 'cold-with-caches']);
export const ALERT_HOURS = 3;   // 같은 이상 상태가 이 시간(UTC 시 단위) 이상 이어지면 실행을 실패로 표시해 GitHub 알림을 유도(시간당 최대 1회)
export function quietReason({ cacheStatus, recovered, state = {}, slot, degraded = state?.degraded }) {
  if (recovered) return 'corrupt-state';
  if (QUIET_STATUSES.has(cacheStatus)) return `cache-${cacheStatus}`;
  if (cacheStatus === 'unverified') {
    const last = Number(state?.lastSlot);
    const continuous = Number.isFinite(last) && Number.isFinite(Number(slot)) && Number(slot) - last === 1;
    if (continuous) return null;
    if (degraded?.kind === 'unverified' && degraded.quietedHours >= 1) return null; // 이미 한 시간 억제했음 → 재개(fail-open)
    return 'cache-unverified';
  }
  return null;
}

// 게이트 전체 평가(CLI·테스트 공용): 실행 여부 + 억제(quiet) + 이상 상태 추적(state.degraded) + 경고 문구.
// state를 직접 갱신한다. failOpen=false는 이전 정책(unverified 무기한 억제)을 재현하는 테스트용.
export function evaluate({ source, scheduler, state, now, slot, cacheStatus, recovered = false, failOpen = true }) {
  const d = decide({ source, scheduler, state, now, slot });
  const hour = Math.floor(now / 3600000);
  const out = { ...d, quiet: null, alert: null, newHour: false, degradedHours: 0, kind: null };
  const kind = recovered ? 'corrupt-state' : ['unverified', 'stale', 'cold-with-caches'].includes(cacheStatus) ? cacheStatus : null;
  if (!kind) { delete state.degraded; return out; }
  const deg = state.degraded?.kind === kind ? state.degraded : { kind, since: now, hours: 0, quietedHours: 0, lastHour: null };
  if (deg.lastHour !== hour) { deg.hours += 1; deg.lastHour = hour; out.newHour = true; }
  const reason = quietReason({ cacheStatus, recovered, state, slot: d.slot, degraded: failOpen ? deg : { kind: null } });
  if (reason && state.quiet?.hour !== hour) { state.quiet = { reason, hour, at: now }; deg.quietedHours += 1; out.quiet = reason; }
  state.degraded = deg; out.kind = kind; out.degradedHours = deg.hours;
  if (out.newHour && deg.hours >= ALERT_HOURS) out.alert = `${kind} 상태가 ${deg.hours}시간째 이어지고 있습니다(시작 ${new Date(deg.since).toISOString()}). 캐시 확인 API·저장 상태를 점검하세요.`;
  return out;
}
