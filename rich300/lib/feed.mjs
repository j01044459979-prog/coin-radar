// COIN RADAR → RICH300 추천 전달(피드): radar(GitHub Actions)가 서명한 피드 파일을 RICH300 이 *가져와서*(pull) 검증한다. 수신 서버·새 배포 없음(웹앱은 '나만' 접근이라 외부 POST 불가).
//  · 파일: { v:1, ts, nonce, body:{ entries:[…], meta:{…} }, sig } — 요청 인증(auth.mjs)과 같은 봉투·같은 정규화·HMAC-SHA256(키 RICH300_FEED_KEY). **서명 필수**: 키가 없거나 약하거나 서명이 틀리면 피드를 거부한다.
//  · 숫자는 모두 문자열(정규화 규칙). 항목은 radar 가 *전달이 확인된* 진입 후보만 담는다(전송 실패 후보는 없음).
//  · 받은 항목도 다시 검증한다: 종목·방향·가격 방향성·시각·유효시간. 검증을 통과해야 전략이 만들어지고, 같은 sid 는 한 번만 만들어진다.
import { authSignedString, authTimingSafeEqual, AUTH_MIN_KEY_LEN } from './auth.mjs';

export const FEED_VERSION = 1;
export const FEED_MAX_AGE_MS = 30 * 60000;                  // 피드 파일이 이보다 오래되면 radar 쪽 중단으로 본다(진단용 — 이미 받은 전략 추적은 계속한다)
export const FEED_MAX_ENTRIES = 40;
export const FEED_MAX_BYTES = 60000;
const FEED_SID_RE = /^SG-[A-Za-z0-9]{1,14}-[LS]-[a-z0-9]{4,10}$/, FEED_SYM_RE = /^[A-Z0-9]{2,20}USDT$/, FEED_NUM_RE = /^\d+(?:\.\d+)?$/;
const fdNum = v => (typeof v === 'string' && FEED_NUM_RE.test(v) && Number(v) > 0 ? Number(v) : null);
const fdMs = v => (typeof v === 'string' && /^\d{10,14}$/.test(v) ? Number(v) : Number.isSafeInteger(v) && v > 1e9 ? v : null);

// raw: 피드 파일 본문(문자열). env: { now(), hmacSha256(key,msg):hex }. key: 서명 키 — **필수**(없거나 32자 미만이면 무조건 거부: fail-closed). opts: { lastTs } 이미 받아들인 가장 최근 피드의 ts(되돌림·재사용 차단)
// 봉투는 요청 인증(auth.mjs)과 같고, body = { entries:[…], meta:{ runId, attempt, ref, sha, event, mode, at } }. meta 는 서명 범위 안에 있다 — GitHub Actions 의 *main 브랜치 정기/수동 once 실행*에서 나온 피드만 받는다.
export const FEED_META_EVENTS = Object.freeze(['schedule', 'workflow_dispatch']);
export function feedVerify(env, raw, key, opts = {}) {
  if (typeof key !== 'string' || key.length < AUTH_MIN_KEY_LEN) return { ok: false, reason: 'no-key' };
  if (typeof raw !== 'string' || !raw || raw.length > FEED_MAX_BYTES) return { ok: false, reason: 'bad-size' };
  let msg; try { msg = JSON.parse(raw); } catch (e_) { return { ok: false, reason: 'bad-json' }; }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || Object.keys(msg).sort().join(',') !== 'body,nonce,sig,ts,v' || msg.v !== FEED_VERSION || !Number.isSafeInteger(msg.ts) || typeof msg.nonce !== 'string' || typeof msg.sig !== 'string' || !/^[0-9a-f]{64}$/.test(msg.sig)) return { ok: false, reason: 'bad-format' };
  let signed; try { signed = authSignedString(msg.v, msg.ts, msg.nonce, msg.body); } catch (e_) { return { ok: false, reason: 'bad-body' }; }
  if (!authTimingSafeEqual(env.hmacSha256(key, signed), msg.sig)) return { ok: false, reason: 'bad-signature' };               // 서명 누락·변조·다른 키 → 거부(내용은 보지 않는다)
  const now = env.now(), age = now - msg.ts;
  if (age < -5 * 60000) return { ok: false, reason: 'future-ts' };
  if (Number.isSafeInteger(opts.lastTs) && msg.ts < opts.lastTs) return { ok: false, reason: 'replay' };                              // 이미 받은 것보다 오래된 피드(되돌려 쓰기) 거부
  const body = msg.body, entries = body && Array.isArray(body.entries) ? body.entries : null, meta = body && body.meta;
  if (!entries || entries.length > FEED_MAX_ENTRIES) return { ok: false, reason: 'bad-entries' };
  if (!meta || typeof meta !== 'object' || !/^\d{1,20}$/.test(String(meta.runId)) || meta.ref !== 'refs/heads/main' || meta.mode !== 'once' || !FEED_META_EVENTS.includes(meta.event) || !/^\d{10,14}$/.test(String(meta.at))) return { ok: false, reason: 'bad-meta' };
  const genAge = now - Number(meta.at);
  if (age > FEED_MAX_AGE_MS || genAge > FEED_MAX_AGE_MS) return { ok: false, reason: 'stale', ageMs: Math.max(age, genAge) };            // 오래된 피드로 새 전략을 만들지 않는다
  return { ok: true, signed: true, ageMs: Math.max(0, genAge), ts: msg.ts, entries, runId: String(meta.runId) };
}
// 항목 하나를 검증해 전략 입력으로 바꾼다. 실패하면 { ok:false, why }.
export function feedParseEntry(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return { ok: false, why: 'not-object' };
  if (e.type === 'invalidated') return FEED_SID_RE.test(String(e.sid)) ? { ok: true, kind: 'invalidated', sid: e.sid, at: fdMs(e.at), reason: String(e.reason || '').slice(0, 120) } : { ok: false, why: 'bad-sid' };
  if (!FEED_SID_RE.test(String(e.sid))) return { ok: false, why: 'bad-sid' };
  if (!FEED_SYM_RE.test(String(e.symbol))) return { ok: false, why: 'bad-symbol' };
  if (e.dir !== 'LONG' && e.dir !== 'SHORT') return { ok: false, why: 'bad-dir' };
  const entry = fdNum(e.entry), stop = fdNum(e.stop), closeT = fdMs(e.closeT), triggerT = fdMs(e.triggerT), validUntil = fdMs(e.validUntil), sg = e.dir === 'LONG' ? 1 : -1;
  if (entry === null || stop === null || closeT === null || triggerT === null || validUntil === null) return { ok: false, why: 'bad-number' };
  if (!((entry - stop) * sg > 0)) return { ok: false, why: 'stop-wrong-side' };
  if (!(validUntil > closeT && validUntil - closeT <= 3 * 3600000)) return { ok: false, why: 'bad-validity' };
  const score = typeof e.score === 'string' && /^\d{1,3}$/.test(e.score) ? Number(e.score) : null, rr = fdNum(e.rr1);
  const ref = [fdNum(e.ref1), fdNum(e.ref2)], ev = Array.isArray(e.evidence) ? e.evidence.slice(0, 3).map(x => String(x).slice(0, 80)) : [];
  const zlo = fdNum(e.zlo), zhi = fdNum(e.zhi), lvl = fdNum(e.lvl), atr = fdNum(e.atr);
  return { ok: true, kind: 'candidate', zlo: zlo === null ? undefined : zlo, zhi: zhi === null ? undefined : zhi, lvl: lvl === null ? undefined : lvl, atr: atr === null ? undefined : atr, sid: e.sid, symbolId: e.symbol, dir: e.dir, entry, stop, triggerT, closeT, validUntil, score, rr1: rr, ref1: ref[0], ref2: ref[1], evidence: ev, volRel: fdNum(e.volRel), btcAlign: e.btcAlign ? String(e.btcAlign).slice(0, 10) : null, stageLabel: e.stageLabel ? String(e.stageLabel).slice(0, 30) : null, costPct: fdNum(e.costPct), createdAt: fdMs(e.createdAt) };
}
