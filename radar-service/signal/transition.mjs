// 신호 상태 전이(순수 함수): 같은 신호의 중복 발송을 막고, 유효시간·무효화를 관리한다.
//
// 저장되는 코인 상태(state.signal.coins[SYMBOL]):  { status: 'active' | 'closed', id, dir, zoneKey, triggerT, validUntil, entry, stop, t1, t2, alertedAt, closedAt, closeReason, lastBar15 }
//  · 'active' 는 '진입 후보' 알림 전달이 확인된 신호만이다(전달 전에는 저장하지 않는다 → 전송 실패 시 다음 실행에서 유효시간 안이면 다시 시도).
//  · 같은 (코인, 방향, 구간) 신호는 한 번만 알린다: active 동안은 새 트리거가 나와도 알리지 않고, 끝난 뒤에도 cooldownMs 동안 같은 구간·방향은 알리지 않는다.
//  · 같은 15분봉(triggerT)에서 이미 처리한 신호는 다시 알리지 않는다.
//  · 유효시간(validUntil)이 지나면 조용히 만료(closed)한다. 무효화(손절 기준 15분 종가 이탈, 구조 소멸, 방향 전환)는 알린 신호에 한해 알린다.
import { invalidation } from './evaluate.mjs';

export const blank = () => ({ status: 'closed', id: null, dir: null, zoneKey: null, triggerT: 0, validUntil: 0, entry: null, stop: null, t1: null, t2: null, alertedAt: 0, closedAt: 0, closeReason: null, lastBar15: 0 });
export const signalId = (symbol, ev) => `${symbol}:${ev.dir}:${ev.zoneKey}:${ev.triggerT}`;

// prev: 저장 상태(없으면 null), ev: evaluateSignal 결과, ctx: { symbol, a, c15, now, cooldownMs }
// 반환 { next, event, committed }  — event: null | { type: 'candidate'|'invalidated', ... }, committed: 전달 확인 뒤 저장할 상태(event 없으면 next와 같다)
export function signalTransition(prev0, ev, { symbol, a, c15, now, cooldownMs }) {
  const prev = prev0 ?? blank(), lastBar = c15?.at(-1)?.t ?? prev.lastBar15;
  const next = { ...prev, lastBar15: Math.max(prev.lastBar15, lastBar) };
  if (prev.status === 'active') {
    if (now > prev.validUntil) { const closed = { ...next, status: 'closed', closedAt: now, closeReason: 'expired' }; return { next: closed, event: null, committed: closed }; }
    const inv = invalidation(prev, { a, c15 });
    if (inv) {
      const closed = { ...next, status: 'closed', closedAt: now, closeReason: 'invalidated' };
      return { next, event: { type: 'invalidated', id: prev.id, dir: prev.dir, reason: inv.reason, price: inv.price, entry: prev.entry, stop: prev.stop, triggerT: prev.triggerT, validUntil: prev.validUntil }, committed: closed };
    }
    return { next, event: null, committed: next };                                              // 유효시간 안: 같은 신호는 다시 알리지 않는다
  }
  if (ev.status !== 'CANDIDATE') return { next, event: null, committed: next };
  if (ev.triggerT <= prev.lastBar15 && prev.triggerT === ev.triggerT) return { next, event: null, committed: next };                        // 이미 처리한 트리거 봉
  if (prev.status === 'closed' && prev.zoneKey === ev.zoneKey && prev.dir === ev.dir && now - prev.closedAt < cooldownMs) return { next, event: null, committed: next };   // 같은 구간 재알림 금지
  const id = signalId(symbol, ev);
  const active = { status: 'active', id, dir: ev.dir, zoneKey: ev.zoneKey, triggerT: ev.triggerT, validUntil: ev.validUntil, entry: ev.entry, stop: ev.stop, t1: ev.t1?.price ?? null, t2: ev.t2?.price ?? null, alertedAt: now, closedAt: 0, closeReason: null, lastBar15: Math.max(prev.lastBar15, lastBar) };
  return { next, event: { type: 'candidate', id, ev }, committed: active };
}
