// 알림 상태 기계(순수 함수): 코인별 '관찰 에피소드'를 추적해 중복 알림을 막고, 의미 있는 변화에서만 다시 알린다.
//
// 에피소드 = 대기 아님(stage ≥ 1) 상태가 이어지는 동안. 한 에피소드 안에서는 이미 알린 단계(alertedStage)보다 높아질 때만 알린다.
//  · 새 관찰 시작 / 단계 상승(접근 → 눌림 → 조건 충족) / 방향 전환  → 알림
//  · 같은 단계 유지, 단계 하락 후 재상승(이미 알린 단계까지)       → 알리지 않음
//  · 무효화 가격을 1H 종가로 이탈 → 즉시 해제 / 대기로 돌아간 상태가 연속 CLEAR_N회 확인되면 해제 (깜빡임 방지)
//  · 해제 후 다시 나타나면 새 에피소드. 단 같은 코인의 알림 간격은 COOLDOWN_MS 이상(조건 충족·방향 전환은 예외)
export const CLEAR_N = 2;                 // 대기 복귀가 이 횟수만큼 연속(= 마감 1H 봉 N개)으로 확인돼야 해제
export const COOLDOWN_MS = 2 * 3600000;   // 같은 코인 알림 최소 간격

export const blank = () => ({ dir: null, stage: 0, maxStage: 0, alertedStage: 0, alertedDir: null, clearCount: 0, since: null, lastBarT: 0, lastAlertAt: 0, invalidation: null, zone: null, price: null });

const breached = (dir, price, inv) => inv !== null && Number.isFinite(inv) && (dir === 'LONG' ? price < inv : price > inv);

// prev: 저장된 코인 상태(없으면 null), cur: analyzeCoin 결과(status 'ok'), now: 현재 시각(ms)
// 반환 { next, event, committed }
//  next      — 알림이 필요 없거나 알림 전송 전에 기록해도 되는 상태
//  event     — null | { type: 'new'|'upgrade'|'flip'|'cleared'|'invalidated', from, to, reason }
//  committed — 알림 전송이 확인된 뒤 저장할 상태(알린 단계·시각 반영). event가 없으면 next와 같다.
export function transition(prev0, cur, now) {
  const prev = prev0 ?? blank();
  const next = { ...prev, lastBarT: cur.barT, price: cur.price };
  let event = null;
  const from = { dir: prev.dir, stage: prev.stage };
  const watching = cur.stage >= 1;

  // 무효화 가격 이탈: 디바운스 없이 즉시 해제
  if (prev.stage >= 1 && breached(prev.dir, cur.price, prev.invalidation)) {
    const wasAlerted = prev.alertedStage >= 1;
    const reset = { ...blank(), lastBarT: cur.barT, price: cur.price, lastAlertAt: prev.lastAlertAt };
    const reason = `1H 종가 ${cur.price}가 무효화 가격 ${prev.invalidation}을 ${prev.dir === 'LONG' ? '하향' : '상향'} 이탈`;
    if (!wasAlerted) return { next: reset, event: null, committed: reset };
    event = { type: 'invalidated', from, to: { dir: null, stage: 0 }, reason, prevDir: prev.dir, prevZone: prev.zone, prevInvalidation: prev.invalidation };
    return { next: { ...prev, lastBarT: cur.barT, price: cur.price }, event, committed: { ...reset, lastAlertAt: now } };
  }

  if (!watching) {
    if (prev.stage === 0) { next.clearCount = 0; return { next, event: null, committed: next }; }
    next.clearCount = prev.clearCount + 1;
    if (next.clearCount < CLEAR_N) return { next, event: null, committed: next };            // 아직 해제 확정 아님(한 번의 깜빡임일 수 있음)
    const reset = { ...blank(), lastBarT: cur.barT, price: cur.price, lastAlertAt: prev.lastAlertAt };
    if (prev.alertedStage < 1) return { next: reset, event: null, committed: reset };         // 알린 적 없는 관찰은 조용히 종료
    event = { type: 'cleared', from, to: { dir: null, stage: 0 }, reason: cur.unmet?.[0] ?? '조건이 더 이상 유지되지 않음', prevDir: prev.dir, prevZone: prev.zone, prevInvalidation: prev.invalidation };
    return { next: { ...next, clearCount: prev.clearCount + 1 }, event, committed: { ...reset, lastAlertAt: now } };
  }

  // 관찰 중(stage ≥ 1)
  next.clearCount = 0; next.invalidation = cur.invalidation; next.zone = cur.zone;
  const flipped = prev.stage >= 1 && prev.dir !== cur.dir, flipAlerted = flipped && prev.alertedStage >= 1;   // 알린 적 없는 관찰의 방향 변경은 '새 관찰'
  if (prev.stage === 0 || flipped) {                                                         // 새 에피소드
    Object.assign(next, { dir: cur.dir, stage: cur.stage, maxStage: cur.stage, alertedStage: 0, alertedDir: null, since: cur.barT });
  } else {
    next.stage = cur.stage; next.maxStage = Math.max(prev.maxStage, cur.stage);
  }
  const higher = cur.stage > next.alertedStage;
  const cooled = now - (prev.lastAlertAt || 0) >= COOLDOWN_MS;
  if (higher && (flipAlerted || cur.stage === 3 || cooled)) {
    event = { type: flipAlerted ? 'flip' : next.alertedStage === 0 ? 'new' : 'upgrade', from, to: { dir: cur.dir, stage: cur.stage }, prevDir: flipAlerted ? prev.dir : null };
  }
  const committed = event ? { ...next, alertedStage: cur.stage, alertedDir: cur.dir, lastAlertAt: now } : next;
  return { next, event, committed };
}
