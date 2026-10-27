// RICH 300 추천 전달 피드(radar 쪽): 진입 후보 알림이 *전달 확인된* 뒤에만 state.signal.feed 에 항목을 남긴다. 별도 워크플로가 이 항목을 서명해 저장소 브랜치에 올리고, RICH300 이 가져간다.
//  · 기능 플래그 RADAR_RICH300_FEED = on 일 때만 동작(기본 off → 상태·메시지·전송 경로는 한 글자도 바뀌지 않는다). 주문·계정 API 없음. 비밀값은 여기서 다루지 않는다.
//  · 항목의 숫자는 모두 문자열(서명 정규화 규칙). 같은 신호(sid)는 한 번만 넣는다. 24시간이 지난 항목·상한(30건) 초과분은 지운다.
import { r9Sid } from './rich300.mjs';

export const FEED_MAX = 30, FEED_KEEP_MS = 24 * 3600000;
export const feedEnabled = (env = process.env) => String(env?.RADAR_RICH300_FEED ?? '').trim().toLowerCase() === 'on';
const num = v => { const n = Number(v); if (!Number.isFinite(n) || n <= 0) return null; let t = String(Number(n.toPrecision(10))); if (/e/i.test(t)) t = n.toFixed(12).replace(/0+$/, '').replace(/\.$/, ''); return t; };
export function feedEntryOf(symbol, ev, { now, sid = r9Sid(symbol, ev) } = {}) {
  const f = { entry: num(ev.entry), stop: num(ev.stop) };
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol) || (ev.dir !== 'LONG' && ev.dir !== 'SHORT') || !f.entry || !f.stop || !Number.isFinite(ev.triggerT) || !Number.isFinite(ev.triggerCloseT) || !Number.isFinite(ev.validUntil)) return null;
  const e = { sid, symbol, dir: ev.dir, entry: f.entry, stop: f.stop, closeT: String(Math.round(ev.triggerCloseT)), triggerT: String(Math.round(ev.triggerT)), validUntil: String(Math.round(ev.validUntil)), createdAt: String(Math.round(now)) };
  if (Number.isFinite(ev.score)) e.score = String(Math.max(0, Math.min(100, Math.round(ev.score))));
  if (ev.t1 && num(ev.t1.net) && ev.t1.net > 0) e.rr1 = num(ev.t1.net);
  if (ev.t1 && num(ev.t1.price)) e.ref1 = num(ev.t1.price);
  if (ev.t2 && num(ev.t2.price)) e.ref2 = num(ev.t2.price);
  if (Array.isArray(ev.evidence)) e.evidence = ev.evidence.slice(0, 3).map(x => String(x).slice(0, 80));
  if (Number.isFinite(ev.volRel) && ev.volRel > 0) e.volRel = num(ev.volRel);
  if (ev.btcAlign) e.btcAlign = String(ev.btcAlign).slice(0, 10);
  if (ev.stageLabel) e.stageLabel = String(ev.stageLabel).slice(0, 30);
  if (Number.isFinite(ev.costPct) && ev.costPct > 0) e.costPct = num(ev.costPct);
  return e;
}
export function feedInvalidatedOf(symbol, event, { now }) {
  const sid = r9Sid(symbol, { dir: event.dir, triggerT: event.triggerT });
  return { type: 'invalidated', sid, at: String(Math.round(now)), reason: String(event.reason || '').slice(0, 120) };
}
// sg: state.signal(복사본이 아니라 그대로 수정). 반환: 추가했으면 true
export function feedPush(sg, entry, now) {
  if (!entry) return false;
  const list = Array.isArray(sg.feed) ? sg.feed : [];
  const dup = list.some(x => x.sid === entry.sid && (x.type || 'candidate') === (entry.type || 'candidate'));
  const keep = list.filter(x => now - Number(x.createdAt ?? x.at ?? now) <= FEED_KEEP_MS);
  if (!dup) keep.push(entry);
  sg.feed = keep.slice(-FEED_MAX);
  return !dup;
}
