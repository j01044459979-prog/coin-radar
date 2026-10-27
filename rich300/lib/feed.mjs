// COIN RADAR → RICH300 추천 전달(피드): radar(GitHub Actions)가 서명한 피드 파일을 RICH300 이 *가져와서*(pull) 검증한다. 수신 서버·새 배포 없음(웹앱은 '나만' 접근이라 외부 POST 불가).
//  · 파일: { v:1, ts, nonce, body:{ entries:[…] }, sig } — 요청 인증(auth.mjs)과 같은 봉투·같은 정규화·HMAC-SHA256(키 RICH300_FEED_KEY). 키가 설정돼 있으면 서명이 맞아야만 받는다(없으면 서명 없이 받되 '미서명'으로 표시).
//  · 숫자는 모두 문자열(정규화 규칙). 항목은 radar 가 *전달이 확인된* 진입 후보만 담는다(전송 실패 후보는 없음).
//  · 받은 항목도 다시 검증한다: 종목·방향·가격 방향성·시각·유효시간. 검증을 통과해야 전략이 만들어지고, 같은 sid 는 한 번만 만들어진다.
import { authSignedString, authTimingSafeEqual } from './auth.mjs';

export const FEED_VERSION = 1;
export const FEED_MAX_AGE_MS = 30 * 60000;                  // 피드 파일이 이보다 오래되면 radar 쪽 중단으로 본다(진단용 — 이미 받은 전략 추적은 계속한다)
export const FEED_MAX_ENTRIES = 40;
export const FEED_MAX_BYTES = 60000;
const FEED_SID_RE = /^SG-[A-Za-z0-9]{1,14}-[LS]-[a-z0-9]{4,10}$/, FEED_SYM_RE = /^[A-Z0-9]{2,20}USDT$/, FEED_NUM_RE = /^\d+(?:\.\d+)?$/;
const fdNum = v => (typeof v === 'string' && FEED_NUM_RE.test(v) && Number(v) > 0 ? Number(v) : null);
const fdMs = v => (typeof v === 'string' && /^\d{10,14}$/.test(v) ? Number(v) : Number.isSafeInteger(v) && v > 1e9 ? v : null);

// raw: 피드 파일 본문(문자열). env: { now(), hmacSha256(key,msg):hex }. key: 서명 키(없으면 null → 서명 검사 생략, signed:false)
export function feedVerify(env, raw, key) {
  if (typeof raw !== 'string' || !raw || raw.length > FEED_MAX_BYTES) return { ok: false, reason: 'bad-size' };
  let msg; try { msg = JSON.parse(raw); } catch (e_) { return { ok: false, reason: 'bad-json' }; }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || Object.keys(msg).sort().join(',') !== 'body,nonce,sig,ts,v' || msg.v !== FEED_VERSION || !Number.isSafeInteger(msg.ts) || typeof msg.sig !== 'string' || !/^[0-9a-f]{64}$/.test(msg.sig)) return { ok: false, reason: 'bad-format' };
  const signed = typeof key === 'string' && key.length > 0;
  if (signed) {
    let s; try { s = authSignedString(msg.v, msg.ts, msg.nonce, msg.body); } catch (e_) { return { ok: false, reason: 'bad-body' }; }
    if (!authTimingSafeEqual(env.hmacSha256(key, s), msg.sig)) return { ok: false, reason: 'bad-signature' };
  }
  const age = env.now() - msg.ts;
  if (age < -5 * 60000) return { ok: false, reason: 'future-ts' };
  const entries = msg.body && Array.isArray(msg.body.entries) ? msg.body.entries : null;
  if (!entries || entries.length > FEED_MAX_ENTRIES) return { ok: false, reason: 'bad-entries' };
  return { ok: true, signed, ageMs: Math.max(0, age), stale: age > FEED_MAX_AGE_MS, ts: msg.ts, entries };
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
  return { ok: true, kind: 'candidate', sid: e.sid, symbolId: e.symbol, dir: e.dir, entry, stop, triggerT, closeT, validUntil, score, rr1: rr, ref1: ref[0], ref2: ref[1], evidence: ev, volRel: fdNum(e.volRel), btcAlign: e.btcAlign ? String(e.btcAlign).slice(0, 10) : null, stageLabel: e.stageLabel ? String(e.stageLabel).slice(0, 30) : null, costPct: fdNum(e.costPct), createdAt: fdMs(e.createdAt) };
}
