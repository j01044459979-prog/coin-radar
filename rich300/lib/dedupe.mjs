// 중복 기록 방지와 수정 이력(추가 전용). 같은 키의 동일 내용은 무시(재전송 안전), 다른 내용은 충돌로 거부한다. 삭제는 없고 취소는 void 리비전이다.
export function dedupeCanonical(v) { return JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `${x}n` : x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x)); }
export const dedupeSame = (a, b) => dedupeCanonical(a) === dedupeCanonical(b);
export function dedupeAppend(list, rec, keyField) {
  const key = (rec == null ? undefined : rec[keyField]);
  if (key === undefined || key === null || key === '') throw new Error(`${keyField} 필요`);
  const prev = list.find(r => r[keyField] === key);
  if (!prev) return { list: [...list, rec], status: 'added' };
  return dedupeSame(prev, rec) ? { list, status: 'duplicate' } : { list, status: 'conflict' };
}
// 같은 포지션의 같은 종류·가격·수량 체결이 60초 안에 id만 다르게 들어온 경우 후보로 표시(자동 삭제하지 않음)
export function dedupePossibleFills(fills, windowMs = 60000) {
  const out = [];
  for (let i = 0; i < fills.length; i++) for (let j = i + 1; j < fills.length; j++) {
    const a = fills[i], b = fills[j];
    if (a.fillId !== b.fillId && a.sid === b.sid && a.kind === b.kind && String(a.price) === String(b.price) && String(a.qty) === String(b.qty) && Math.abs(a.at - b.at) <= windowMs) out.push([a.fillId, b.fillId]);
  }
  return out;
}
// 리비전 로그: 같은 key의 변경은 rev를 올려 *추가*한다(이전 리비전 보존). latest()가 현재 값.
export function dedupeRevise(log, key, patch, meta = {}) {
  const prev = dedupeLatest(log).get(key);
  if (!prev) throw new Error(`수정 대상 없음: ${key}`);
  if (prev.void) throw new Error(`취소된 기록은 수정할 수 없음: ${key}`);
  return [...log, { ...prev, ...patch, key, rev: prev.rev + 1, prevRev: prev.rev, at: (meta.at != null ? meta.at : null), reason: (meta.reason != null ? meta.reason : null) }];
}
export const dedupeVoid = (log, key, meta = {}) => dedupeRevise(log, key, { void: true }, meta);
export function dedupeLatest(log) { const m = new Map(); for (const r of log) { const p = m.get(r.key); if (!p || r.rev > p.rev) m.set(r.key, r); } return m; }
