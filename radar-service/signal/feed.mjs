// RICH 300 추천 전달 피드(radar 쪽): 진입 후보 알림이 *전달 확인된* 뒤에만 state.signal.feed 에 항목을 남긴다. 별도 워크플로가 이 항목을 서명해 저장소 브랜치에 올리고, RICH300 이 가져간다.
//  · 기능 플래그 RADAR_RICH300_FEED = on 일 때만 동작(기본 off → 상태·메시지·전송 경로는 한 글자도 바뀌지 않는다). 주문·계정 API 없음. 비밀값은 여기서 다루지 않는다.
//  · 항목의 숫자는 모두 문자열(서명 정규화 규칙). 같은 신호(sid)는 한 번만 넣는다. 24시간이 지난 항목·상한(30건) 초과분은 지운다.

export const FEED_MAX = 30, FEED_KEEP_MS = 24 * 3600000;
// 신호 고유 ID: RICH 300 연동(R9)의 r9Sid 와 *같은 공식*(코인·방향·15분봉 트리거 시각 → 같은 ID, 재전송에도 동일). 이 파일은 R9 모듈 없이도 동작하도록 공식을 복제했고 테스트가 같은지 확인한다.
export function feedSid(symbol, ev) {
  const base = String(symbol).replace(/USDT$/, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 14);
  return `SG-${base}-${ev.dir === 'LONG' ? 'L' : 'S'}-${Math.floor(ev.triggerT / 1000).toString(36)}`;
}
export const feedEnabled = (env = process.env) => String(env?.RADAR_RICH300_FEED ?? '').trim().toLowerCase() === 'on';
const num = v => { const n = Number(v); if (!Number.isFinite(n) || n <= 0) return null; let t = String(Number(n.toPrecision(10))); if (/e/i.test(t)) t = n.toFixed(12).replace(/0+$/, '').replace(/\.$/, ''); return t; };
export function feedEntryOf(symbol, ev, { now, sid = feedSid(symbol, ev) } = {}) {
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
  // 분할 진입 가격 산출용 구조 정보(RICH300 이 2·3차 지정가를 시장 구조에서 찾을 때 쓴다): 1H 지지·저항 구간, 돌파 기준선, 1H ATR
  if (ev.zone && num(ev.zone.lo) && num(ev.zone.hi)) { e.zlo = num(ev.zone.lo); e.zhi = num(ev.zone.hi); }
  if (num(ev.level)) e.lvl = num(ev.level);
  if (Number.isFinite(ev.riskAbs) && Number.isFinite(ev.riskAtr) && ev.riskAtr > 0 && num(ev.riskAbs / ev.riskAtr)) e.atr = num(ev.riskAbs / ev.riskAtr);
  return e;
}
export function feedInvalidatedOf(symbol, event, { now }) {
  const sid = feedSid(symbol, { dir: event.dir, triggerT: event.triggerT });
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

// ── GitHub Actions 산출물(서명 전): radar 실행이 끝난 직후 *그 실행의* 상태 파일에서 피드 항목을 꺼내 run 정보와 함께 쓴다. 서명은 별도 워크플로(rich300-feed.yml)가 Secret 으로 한다.
//  · 정기/수동 once 실행·main 브랜치에서만 만든다(미리보기·telegram-test·다른 브랜치·push 실행은 만들지 않는다). env: GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_REF, GITHUB_SHA, GITHUB_EVENT_NAME, MODE
export function feedArtifactOf(state, env, now = Date.now()) {
  if (!feedEnabled(env)) return { ok: false, reason: 'flag-off' };
  if (String(env.MODE || '') !== 'once') return { ok: false, reason: 'not-once' };
  if (String(env.GITHUB_REF || '') !== 'refs/heads/main') return { ok: false, reason: 'not-main' };
  if (!['schedule', 'workflow_dispatch'].includes(String(env.GITHUB_EVENT_NAME || ''))) return { ok: false, reason: 'bad-event' };
  if (!/^\d{1,20}$/.test(String(env.GITHUB_RUN_ID || ''))) return { ok: false, reason: 'no-run-id' };
  const list = Array.isArray(state?.signal?.feed) ? state.signal.feed : [], entries = list.filter(x => x && typeof x === 'object' && now - Number(x.createdAt ?? x.at ?? now) <= FEED_KEEP_MS).slice(-FEED_MAX);
  return { ok: true, artifact: { v: 1, meta: { runId: String(env.GITHUB_RUN_ID), attempt: String(env.GITHUB_RUN_ATTEMPT || '1'), ref: String(env.GITHUB_REF), sha: String(env.GITHUB_SHA || '').slice(0, 40), event: String(env.GITHUB_EVENT_NAME), mode: 'once', at: String(Math.round(now)) }, entries } };
}
