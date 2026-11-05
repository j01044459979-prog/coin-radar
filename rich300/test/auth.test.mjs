import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { authVerify, authBuildRequest, authSignedString, authCanonicalBody, authTimingSafeEqual, AUTH_WINDOW_MS, AUTH_NONCE_TTL_SEC, AUTH_MAX_BYTES, AUTH_MIN_KEY_LEN } from '../lib/auth.mjs';
import { nodeAuthEnv } from '../client/ingest-client.mjs';

const KEY = 'k'.repeat(40), KEY2 = 'p'.repeat(40), T = 1790000000000;
// 가상 시계·nonce 캐시(TTL, 퇴출)·카운터를 가진 서버 환경
function srv({ keys = [KEY], now = T } = {}) {
  const st = { now, keys, cache: new Map(), counters: [] };
  const env = { now: () => st.now, hmacSha256: (k, m) => createHmac('sha256', k).update(m, 'utf8').digest('hex'), getKeys: () => st.keys,
    nonces: { has: n => { const e = st.cache.get(n); return !!e && st.now < e.exp; }, put: (n, ttl) => st.cache.set(n, { exp: st.now + ttl * 1000 }) }, counter: n => st.counters.push(n) };
  return { env, st };
}
const sign = (body, { key = KEY, ts = T, nonce = 'n'.repeat(20), v = 1 } = {}) => JSON.stringify({ v, ts, nonce, body, sig: createHmac('sha256', key).update(`${v}.${ts}.${nonce}.${authCanonicalBody(body)}`, 'utf8').digest('hex') });
const BODY = { type: 'signal', signal: { sid: 'A-1', entry: '100' } };
const reason = (s, raw) => { const r = authVerify(s.env, raw); return r.ok ? 'OK' : r.reason; };

test('독립 기준값(Python hmac/json) 60건: 정규화 문자열과 HMAC 서명이 모두 일치(한글·이모지·중첩·키 정렬 포함)', () => {
  const vecs = JSON.parse(readFileSync(new URL('./fixtures/hmac-vectors.json', import.meta.url), 'utf8')); let ascii = 0;
  for (const v of vecs) {
    assert.equal(authCanonicalBody(v.body), v.canonical); assert.equal(authSignedString(v.v, v.ts, v.nonce, v.body), v.signed);
    assert.equal(createHmac('sha256', v.key).update(authSignedString(v.v, v.ts, v.nonce, v.body), 'utf8').digest('hex'), v.sig);
    const s = srv({ now: v.ts }); s.st.keys = [v.key]; const r = authVerify(s.env, JSON.stringify({ v: v.v, ts: v.ts, nonce: v.nonce, body: v.body, sig: v.sig })); assert.equal(r.ok, true, v.signed.slice(0, 40)); if (/^[\x00-\x7f]*$/.test(v.signed)) ascii++;
  }
  assert.ok(vecs.length === 60 && ascii < 20);                                                                   // 대부분이 비ASCII
});
test('정상 요청: 통과하고 본문을 돌려줌, 키 순서가 달라도 같은 서명(정규화), 클라이언트 빌더와 호환', () => {
  const s = srv(); const r = authVerify(s.env, sign(BODY)); assert.equal(r.ok, true); assert.deepEqual(r.body, BODY); assert.equal(r.usedPreviousKey, false);
  const reordered = { signal: { entry: '100', sid: 'A-1' }, type: 'signal' }; assert.equal(authVerify(srv().env, sign(reordered, { nonce: 'q'.repeat(20) })).ok, true);
  assert.equal(authVerify(srv().env, JSON.stringify({ ...JSON.parse(sign(BODY)), body: reordered })).ok, true);           // 본문 키 순서만 바뀐 같은 내용
  const cenv = nodeAuthEnv({ now: () => T }); assert.equal(authVerify(srv().env, authBuildRequest(cenv, KEY, BODY)).ok, true);
});
test('변조 거부: 본문·타임스탬프·nonce·버전·서명 어느 하나라도 바뀌면 실패(사유별)', () => {
  const ok = JSON.parse(sign(BODY)), t = o => JSON.stringify({ ...ok, ...o });
  assert.equal(reason(srv(), t({ body: { ...BODY, signal: { sid: 'A-1', entry: '101' } } })), 'bad-signature'); assert.equal(reason(srv(), t({ ts: T + 1 })), 'bad-signature'); assert.equal(reason(srv(), t({ nonce: 'x'.repeat(20) })), 'bad-signature');
  assert.equal(reason(srv(), t({ sig: ok.sig.replace(/.$/, c => (c === '0' ? '1' : '0')) })), 'bad-signature'); assert.equal(reason(srv(), t({ v: 2 })), 'bad-version');
  assert.equal(reason(srv(), sign(BODY, { key: KEY2 })), 'bad-signature');
});
test('형식 거부: 서명 대문자·짧음·비16진, 필드 누락·추가, 잘못된 자료형, 잘못된 JSON, 비문자열, 크기 초과 — 모두 서명 계산 전에 걸러짐', () => {
  const ok = JSON.parse(sign(BODY)), t = o => JSON.stringify({ ...ok, ...o }), calls = [];
  const s = srv(); const spy = s.env.hmacSha256; s.env.hmacSha256 = (k, m) => { calls.push(1); return spy(k, m); };
  for (const bad of [t({ sig: ok.sig.toUpperCase() }), t({ sig: ok.sig.slice(1) }), t({ sig: 'z'.repeat(64) }), t({ nonce: 'short' }), t({ nonce: 'a b'.repeat(8) }), t({ nonce: 5 }), t({ ts: '1790000000000' }), t({ ts: 1.5 }), t({ extra: 1 }), JSON.stringify({ v: 1, ts: T, nonce: ok.nonce, body: BODY }), JSON.stringify([ok]), 'null', '{bad', '', 'x'.repeat(AUTH_MAX_BYTES + 1)]) assert.equal(authVerify(s.env, bad).ok, false);
  assert.equal(authVerify(s.env, 42).ok, false); assert.equal(authVerify(s.env, null).ok, false); assert.equal(calls.length, 0);
  assert.equal(reason(s, t({ body: [1] })), 'bad-body'); assert.equal(reason(s, t({ body: 'x' })), 'bad-body'); assert.equal(reason(s, t({ body: { a: 1.5 } })), 'bad-body');
});
test('타임스탬프 창: ±5분 경계(포함), 초과는 오래됨/미래 모두 거부', () => {
  const at = ts => reason(srv(), sign(BODY, { ts, nonce: 'w'.repeat(18) + String(ts).slice(-2) }));
  assert.equal(at(T - AUTH_WINDOW_MS), 'OK'); assert.equal(at(T + AUTH_WINDOW_MS), 'OK'); assert.equal(at(T - AUTH_WINDOW_MS - 1), 'stale'); assert.equal(at(T + AUTH_WINDOW_MS + 1), 'stale'); assert.equal(at(0), 'stale');
});
test('재전송 방지: 같은 nonce 두 번째는 거부, 서명이 틀린 요청은 nonce를 소비하지 않음(캐시 오염 방지), 만료 후에는 통과(저장소 유일키가 방어)', () => {
  const s = srv(), raw = sign(BODY); assert.equal(reason(s, raw), 'OK'); assert.equal(reason(s, raw), 'replay');
  const s2 = srv(), good = JSON.parse(sign(BODY, { nonce: 'p'.repeat(20) })); assert.equal(reason(s2, JSON.stringify({ ...good, sig: '0'.repeat(64) })), 'bad-signature'); assert.equal(s2.st.cache.size, 0); assert.equal(reason(s2, JSON.stringify(good)), 'OK');
  const s3 = srv(), r3 = sign(BODY, { nonce: 'e'.repeat(20) }); assert.equal(reason(s3, r3), 'OK'); s3.st.now += AUTH_NONCE_TTL_SEC * 1000 - 1; assert.equal(reason(s3, r3), 'stale');   // 창이 먼저 닫힘
  assert.ok(AUTH_NONCE_TTL_SEC * 1000 > 2 * AUTH_WINDOW_MS);                                                             // nonce 기억 시간 > 유효 창 전체(±5분)
  const s4 = srv(), r4 = sign(BODY, { nonce: 'f'.repeat(20) }); assert.equal(reason(s4, r4), 'OK'); s4.st.cache.clear(); assert.equal(reason(s4, r4), 'OK');   // 캐시 퇴출 시 인증은 통과 → 저장소 중복 방지가 방어(ingest 테스트)
});
test('키 회전: 이전 키로 서명한 요청은 이전 키가 설정된 동안만 통과, 현재 키는 항상 통과', () => {
  const both = srv({ keys: [KEY, KEY2] }), prev = authVerify(both.env, sign(BODY, { key: KEY2, nonce: 'r'.repeat(20) })); assert.equal(prev.ok, true); assert.equal(prev.usedPreviousKey, true);
  assert.equal(authVerify(both.env, sign(BODY, { key: KEY, nonce: 's'.repeat(20) })).usedPreviousKey, false);
  assert.equal(reason(srv({ keys: [KEY] }), sign(BODY, { key: KEY2 })), 'bad-signature');
});
test('키 설정 오류는 닫힌 채로 실패: 키 없음·빈 문자열·너무 짧음·조회 예외', () => {
  for (const keys of [[], [''], [null], ['short'], [KEY, 'weak']]) assert.equal(reason(srv({ keys }), sign(BODY)), 'misconfigured', JSON.stringify(keys));
  const s = srv(); s.env.getKeys = () => { throw new Error('props down'); }; assert.equal(reason(s, sign(BODY)), 'misconfigured');
  assert.throws(() => authBuildRequest(nodeAuthEnv({ now: () => T }), 'short', BODY), /키가 너무 짧음/); assert.ok(AUTH_MIN_KEY_LEN >= 32);
});
test('본문 정규화: 부동소수·BigInt·undefined·함수·NaN 거부(언어 간 불일치 방지), 안전 정수·중첩·한글은 허용', () => {
  for (const bad of [{ a: 1.5 }, { a: 1n }, { a: undefined }, { a: () => 1 }, { a: NaN }, { a: 2 ** 60 }, { a: [1, { b: 0.1 }] }, [], null, 'x']) assert.throws(() => authCanonicalBody(bad));
  assert.equal(authCanonicalBody({ b: [1, { z: 1, a: '한글' }], a: null, c: true }), '{"a":null,"b":[1,{"a":"한글","z":1}],"c":true}');
});
test('상수 시간 비교: 같음/다름/길이 다름/비문자열', () => {
  assert.equal(authTimingSafeEqual('abc', 'abc'), true); assert.equal(authTimingSafeEqual('abc', 'abd'), false); assert.equal(authTimingSafeEqual('abc', 'ab'), false); assert.equal(authTimingSafeEqual('a', 1), false); assert.equal(authTimingSafeEqual('', ''), true);
});
test('실패 카운터: 사유 코드만 기록(키·서명·본문 없음), 카운터 예외는 무시', () => {
  const s = srv(); authVerify(s.env, '{bad'); authVerify(s.env, sign(BODY, { key: KEY2 })); authVerify(s.env, sign(BODY, { ts: 1 }));
  assert.deepEqual(s.st.counters, ['auth-fail:bad-format', 'auth-fail:bad-signature', 'auth-fail:stale']); s.env.counter = () => { throw new Error('cache down'); }; assert.equal(authVerify(s.env, '{bad').ok, false);
});
test('Secret 비노출: 모든 실패·성공 반환값, 카운터, 클라이언트 요청 직렬화 어디에도 키가 나타나지 않고, 실패 반환에 서명·본문이 없다', () => {
  const s = srv(), out = [], raws = [sign(BODY), sign(BODY), sign(BODY, { key: KEY2, nonce: 'u'.repeat(20) }), sign(BODY, { ts: 5, nonce: 'v'.repeat(20) }), '{bad', JSON.stringify({ ...JSON.parse(sign(BODY)), body: { x: 1.5 } })];
  for (const raw of raws) out.push(JSON.stringify(authVerify(s.env, raw)));
  const all = out.join('|') + s.st.counters.join('|'); assert.ok(!all.includes(KEY) && !all.includes(KEY2)); for (const f of out.filter(o => o.includes('"ok":false'))) { assert.ok(!/[0-9a-f]{32,}/.test(f) && !f.includes('A-1') && !f.includes('entry'), f); assert.deepEqual(Object.keys(JSON.parse(f)), ['ok', 'reason']); }
  const built = authBuildRequest(nodeAuthEnv({ now: () => T }), KEY, BODY); assert.ok(!built.includes(KEY));
});
test('소스 위생: 인증·수신·클라이언트·API 진입점은 로그를 출력하지 않고 키를 하드코딩하지 않는다', () => {
  for (const f of ['lib/auth.mjs', 'lib/ingest.mjs', 'client/ingest-client.mjs', 'gas/Api.gs']) { const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); assert.ok(!/console\.|Logger\.log/.test(src), f); assert.ok(!/['"][A-Za-z0-9_-]{40,}['"]/.test(src.replace(/\/\/.*$/gm, '')), `${f}: 긴 리터럴`); }
  assert.ok(/getProperty\('RICH300_INGEST_KEY'\)/.test(readFileSync(new URL('../gas/Api.gs', import.meta.url), 'utf8')));
});
