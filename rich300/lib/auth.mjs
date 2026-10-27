// R5 요청 인증(순수 함수, 환경은 주입): 본문 HMAC-SHA256 + 타임스탬프 창 + nonce 재전송 방지.
//  요청: {"v":1,"ts":<ms>,"nonce":"<16~64자 [A-Za-z0-9_-]>","body":{…},"sig":"<hex64>"}
//  서명 문자열 = `${v}.${ts}.${nonce}.${canonical(body)}`, canonical = 키 정렬·공백 없는 JSON. body에는 부동소수·undefined·BigInt를 허용하지 않는다(언어 간 정규화 불일치 방지, 금액은 문자열).
//  Apps Script는 요청 헤더를 읽을 수 없으므로 인증 정보는 전부 본문에 있다(실제 동작은 S0 실측 전까지 미확정).
//  env = { now(): ms, hmacSha256(key, message): hex, getKeys(): string[] (현재 키, 이전 키 선택), nonces: { has(n): boolean, put(n, ttlSec) }, counter?(name) }
//  원칙: 값싼 검사 먼저 → 서명 검증 후에만 nonce를 기록(쓰레기 nonce로 캐시를 채우는 공격 방지) → 실패 사유는 내부 코드로만 반환(호출자가 외부에는 동일한 응답을 낸다). 키·서명·본문은 어떤 반환값·오류에도 넣지 않는다.
import { dedupeCanonical } from './dedupe.mjs';

export const AUTH_VERSION = 1;
export const AUTH_WINDOW_MS = 300000;            // ±5분
export const AUTH_NONCE_TTL_SEC = 900;           // 창(±5분 = 10분)보다 길게 기억
export const AUTH_MAX_BYTES = 8192;
export const AUTH_MIN_KEY_LEN = 32;
const AUTH_NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/, AUTH_SIG_RE = /^[0-9a-f]{64}$/;

// 상수 시간 비교(길이가 같을 때 모든 문자를 비교)
export function authTimingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function authCheckValue(v, path) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
  if (typeof v === 'number') { if (!Number.isSafeInteger(v)) throw new Error(`본문 숫자는 안전 정수만 허용(소수는 문자열로): ${path}`); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => authCheckValue(x, `${path}[${i}]`)); return; }
  if (typeof v === 'object') { for (const [k, x] of Object.entries(v)) authCheckValue(x, `${path}.${k}`); return; }
  throw new Error(`본문 자료형 오류: ${path}`);
}
export function authCanonicalBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('본문은 객체여야 함');
  authCheckValue(body, 'body'); return dedupeCanonical(body);
}
export const authSignedString = (v, ts, nonce, body) => `${v}.${ts}.${nonce}.${authCanonicalBody(body)}`;
export function authBuildRequest(env, key, body, { nonce } = {}) {
  if (typeof key !== 'string' || key.length < AUTH_MIN_KEY_LEN) throw new Error('키가 너무 짧음');
  const ts = env.now(), n = (nonce != null ? nonce : env.newNonce());
  if (!AUTH_NONCE_RE.test(n)) throw new Error('nonce 형식 오류');
  return JSON.stringify({ v: AUTH_VERSION, ts, nonce: n, body, sig: env.hmacSha256(key, authSignedString(AUTH_VERSION, ts, n, body)) });
}
const fail = (env, reason) => { try { (env.counter == null ? undefined : env.counter(`auth-fail:${reason}`)); } catch (e_) { /* 카운터 실패는 무시 */ } return { ok: false, reason }; };

export function authVerify(env, raw) {
  if (typeof raw !== 'string') return fail(env, 'bad-format');
  if (raw.length > AUTH_MAX_BYTES) return fail(env, 'too-large');
  let msg; try { msg = JSON.parse(raw); } catch (e_) { return fail(env, 'bad-format'); }
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return fail(env, 'bad-format');
  const keys = Object.keys(msg).sort().join(',');
  if (keys !== 'body,nonce,sig,ts,v') return fail(env, 'bad-format');                         // 알 수 없는 필드·누락 거부(모호성 제거)
  if (msg.v !== AUTH_VERSION) return fail(env, 'bad-version');
  if (!Number.isSafeInteger(msg.ts)) return fail(env, 'bad-format');
  if (typeof msg.nonce !== 'string' || !AUTH_NONCE_RE.test(msg.nonce)) return fail(env, 'bad-format');
  if (typeof msg.sig !== 'string' || !AUTH_SIG_RE.test(msg.sig)) return fail(env, 'bad-format');
  if (Math.abs(env.now() - msg.ts) > AUTH_WINDOW_MS) return fail(env, 'stale');
  let signed; try { signed = authSignedString(msg.v, msg.ts, msg.nonce, msg.body); } catch (e_) { return fail(env, 'bad-body'); }
  let candidates; try { candidates = env.getKeys().filter(k => typeof k === 'string' && k.length > 0); } catch (e_) { return fail(env, 'misconfigured'); }
  if (!candidates.length || candidates.some(k => k.length < AUTH_MIN_KEY_LEN)) return fail(env, 'misconfigured');   // 키가 없거나 약하면 *닫힌 채로* 실패
  let matched = -1;
  candidates.forEach((k, i) => { const ok = authTimingSafeEqual(env.hmacSha256(k, signed), msg.sig); if (ok && matched < 0) matched = i; });   // 모든 후보를 끝까지 계산
  if (matched < 0) return fail(env, 'bad-signature');
  if (env.nonces.has(msg.nonce)) return fail(env, 'replay');
  env.nonces.put(msg.nonce, AUTH_NONCE_TTL_SEC);                                              // 서명이 맞은 요청의 nonce만 기록
  return { ok: true, body: msg.body, ts: msg.ts, nonce: msg.nonce, usedPreviousKey: matched > 0 };
}
