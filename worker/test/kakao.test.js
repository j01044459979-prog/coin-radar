// 카카오 "나에게 보내기" 연동 테스트 (토큰 암호화, OAuth 연결 페이지, 테스트 발송, 보안)
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import * as K from '../src/kakao.js';
import { FakeD1, makeFetch } from './helpers.js';

// 테스트용 가짜 값 (실제 키/토큰 아님)
const SECRETS = { KAKAO_REST_API_KEY: 'test-rest-key', KAKAO_CLIENT_SECRET: 'test-client-secret', ADMIN_TOKEN: 'test-admin-token-0123456789' };
const SECRET_VALUES = ['test-rest-key', 'test-client-secret', 'test-admin-token', 'test-access', 'test-refresh'];
const BASE = 'https://coin-radar-engine.example.workers.dev';

const realFetch = globalThis.fetch;
beforeEach(() => K.resetKakaoSchemaFlagForTests());
afterEach(() => {
  globalThis.fetch = realFetch;
});

const req = (path, init) => new Request(BASE + path, init);
const form = (path, fields) => req(path, { method: 'POST', body: new URLSearchParams(fields), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
const noSecrets = (text) => SECRET_VALUES.forEach((v) => assert.ok(!text.includes(v), `노출됨: ${v}`));

test('토큰 암호화: 복호화 가능, 저장값에 원문 없음, 키가 다르면 복호화 불가', async () => {
  const c = await K.encryptToken(SECRETS, 'test-refresh-xyz');
  assert.ok(c.startsWith('v1.'));
  assert.ok(!c.includes('test-refresh-xyz'));
  assert.equal(await K.decryptToken(SECRETS, c), 'test-refresh-xyz');
  assert.notEqual(await K.encryptToken(SECRETS, 'same'), await K.encryptToken(SECRETS, 'same')); // 매번 다른 IV
  assert.equal(await K.decryptToken({ ...SECRETS, KAKAO_CLIENT_SECRET: 'other' }, c), null);
  assert.equal(await K.decryptToken(SECRETS, 'garbage'), null);
});

test('OAuth state: ADMIN_TOKEN 서명, 10분 만료, 위조 거부', async () => {
  const now = Date.now();
  const s = await K.makeState(SECRETS, now);
  assert.equal(await K.verifyState(SECRETS, s, now), true);
  assert.equal(await K.verifyState(SECRETS, s, now + 11 * 60000), false);
  assert.equal(await K.verifyState({ ...SECRETS, ADMIN_TOKEN: 'other' }, s, now), false);
  const [exp, nonce, sig] = s.split('.');
  assert.equal(await K.verifyState(SECRETS, `${Number(exp) + 999999}.${nonce}.${sig}`, now), false);
  assert.equal(await K.verifyState(SECRETS, null, now), false);
  assert.equal(await K.verifyState({}, s, now), false);
});

test('인가 URL: 공식 주소 + talk_message 권한', () => {
  const u = new URL(K.authorizeUrl(SECRETS, `${BASE}/kakao/callback`, 'st'));
  assert.equal(u.origin + u.pathname, 'https://kauth.kakao.com/oauth/authorize');
  assert.equal(u.searchParams.get('client_id'), 'test-rest-key');
  assert.equal(u.searchParams.get('redirect_uri'), `${BASE}/kakao/callback`);
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('scope'), 'talk_message');
  assert.equal(u.searchParams.get('state'), 'st');
});

test('메시지 템플릿: text 타입, 200자 제한, 사이트 버튼', () => {
  const t = K.buildTemplate('a'.repeat(250));
  assert.equal(t.object_type, 'text');
  assert.equal(t.text.length, 200);
  assert.deepEqual(t.link, { web_url: 'https://j01044459979-prog.github.io/coin-radar/', mobile_web_url: 'https://j01044459979-prog.github.io/coin-radar/' });
  assert.equal(t.button_title, 'COIN RADAR 보기');
});

test('Secret 없음/미연결이면 안전하게 건너뜀', async () => {
  let called = 0;
  const f = async () => { called += 1; return new Response('{}'); };
  assert.deepEqual(await K.sendKakaoMemo({}, new FakeD1(), 'x', Date.now(), f), { ok: false, skipped: true, reason: 'Kakao Secret 미설정' });
  const r = await K.sendKakaoMemo(SECRETS, new FakeD1(), 'x', Date.now(), f);
  assert.deepEqual(r, { ok: false, skipped: true, reason: 'Kakao 미연결' });
  assert.equal(called, 0);
});

test('설정 페이지: 리다이렉트 URI 안내, 비밀값 미노출', async () => {
  const res = await worker.fetch(req('/kakao/setup'), { DB: new FakeD1(), ...SECRETS }, {});
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  const html = await res.text();
  assert.ok(html.includes(`${BASE}/kakao/callback`));
  assert.ok(html.includes('카카오 연결하기'));
  noSecrets(html);
});

test('연결하기: ADMIN_TOKEN 틀리면 401, 맞으면 카카오 로그인으로 303', async () => {
  const env = { DB: new FakeD1(), ...SECRETS };
  const bad = await worker.fetch(form('/kakao/connect', { admin_token: 'wrong' }), env, {});
  assert.equal(bad.status, 401);
  const ok = await worker.fetch(form('/kakao/connect', { admin_token: SECRETS.ADMIN_TOKEN }), env, {});
  assert.equal(ok.status, 303);
  const loc = new URL(ok.headers.get('location'));
  assert.equal(loc.origin, 'https://kauth.kakao.com');
  assert.equal(loc.searchParams.get('scope'), 'talk_message');
  assert.equal(await K.verifyState(SECRETS, loc.searchParams.get('state'), Date.now()), true);
  assert.ok(!ok.headers.get('location').includes(SECRETS.ADMIN_TOKEN));
  // ADMIN_TOKEN Secret 이 없으면 연결 불가
  const none = await worker.fetch(form('/kakao/connect', { admin_token: '' }), { DB: new FakeD1(), KAKAO_REST_API_KEY: 'k' }, {});
  assert.equal(none.status, 400);
});

test('콜백: state 없거나 위조면 거부 (토큰 요청 안 함)', async () => {
  const f = makeFetch({ now: Date.now() });
  globalThis.fetch = f.fetch;
  const env = { DB: new FakeD1(), ...SECRETS };
  const r1 = await worker.fetch(req('/kakao/callback?code=abc'), env, {});
  assert.equal(r1.status, 400);
  const r2 = await worker.fetch(req('/kakao/callback?code=abc&state=1.2.3'), env, {});
  assert.equal(r2.status, 400);
  assert.equal(f.calls.token.length, 0);
});

test('콜백 정상: 토큰 발급 → D1 암호화 저장 → 연결 확인 메시지 → 상태 ready', async () => {
  const now = Date.now();
  const f = makeFetch({ now });
  globalThis.fetch = f.fetch;
  const DB = new FakeD1();
  const env = { DB, ...SECRETS };
  const state = await K.makeState(SECRETS, now);
  const res = await worker.fetch(req(`/kakao/callback?code=test-code&state=${encodeURIComponent(state)}`), env, {});
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /카카오톡 연결 완료/);
  noSecrets(html);
  // 토큰 요청 형식 (공식 문서 파라미터)
  assert.deepEqual(f.calls.token[0], { grant_type: 'authorization_code', redirect_uri: `${BASE}/kakao/callback`, code: 'test-code', client_id: 'test-rest-key', client_secret: 'test-client-secret' });
  // D1 에는 암호화된 값만
  const row = DB.rows('SELECT * FROM kakao_auth')[0];
  assert.ok(row.access_enc.startsWith('v1.') && row.refresh_enc.startsWith('v1.'));
  noSecrets(JSON.stringify(row));
  assert.ok(row.refresh_expires_at > now + 50 * 86400000);
  // 연결 확인 메시지
  assert.equal(f.calls.memo.length, 1);
  assert.match(f.calls.memo[0].template.text, /카카오톡 알림이 연결되었습니다/);
  const s = await K.kakaoStatus(env, DB, now);
  assert.equal(s.ready, true);
  assert.equal(s.linked, true);
});

test('콜백: 카카오가 오류를 주면 안내 (예: 동의 취소, 잘못된 키)', async () => {
  const now = Date.now();
  const state = encodeURIComponent(await K.makeState(SECRETS, now));
  const env = { DB: new FakeD1(), ...SECRETS };
  const cancel = await worker.fetch(req(`/kakao/callback?error=access_denied&state=${state}`), env, {});
  assert.equal(cancel.status, 400);
  globalThis.fetch = makeFetch({ now, kakao: { codeError: 'invalid_client' } }).fetch;
  const bad = await worker.fetch(req(`/kakao/callback?code=c&state=${state}`), env, {});
  assert.equal(bad.status, 502);
  const html = await bad.text();
  assert.match(html, /KAKAO_REST_API_KEY 또는 KAKAO_CLIENT_SECRET/);
  noSecrets(html);
});

test('테스트 메시지: 폼/API 모두 ADMIN_TOKEN 필요, 성공 시 1건 발송', async () => {
  const now = Date.now();
  const DB = new FakeD1();
  const env = { DB, ...SECRETS };
  const f = makeFetch({ now });
  await K.exchangeCode(env, DB, 'test-code', `${BASE}/kakao/callback`, now, f.fetch);
  globalThis.fetch = f.fetch;

  assert.equal((await worker.fetch(form('/kakao/test', { admin_token: 'wrong' }), env, {})).status, 401);
  const okForm = await worker.fetch(form('/kakao/test', { admin_token: SECRETS.ADMIN_TOKEN }), env, {});
  assert.equal(okForm.status, 200);
  assert.match(await okForm.text(), /테스트 메시지를 보냈습니다/);
  assert.match(f.calls.memo.at(-1).template.text, /COIN RADAR 테스트 메시지/);
  assert.doesNotMatch(f.calls.memo.at(-1).template.text, /매수|매도|롱|숏/);

  const api = (auth, e = env) => worker.fetch(req('/api/admin/kakao-test', { method: 'POST', headers: auth ? { authorization: auth } : {} }), e, {});
  assert.equal((await api()).status, 401);
  assert.equal((await api('Bearer wrong')).status, 401);
  assert.equal((await api('Bearer x', { DB })).status, 404); // ADMIN_TOKEN 미설정 시 숨김
  const ok = await api(`Bearer ${SECRETS.ADMIN_TOKEN}`);
  assert.deepEqual(await ok.json(), { ok: true, message: '테스트 메시지를 보냈습니다.' });
  assert.equal(f.calls.memo.length, 2); // 폼 1건 + API 1건
  // GET 으로는 발송 불가
  assert.equal((await worker.fetch(req('/kakao/test'), env, {})).status, 404);
});

test('동의 없음(-402) 등 실패 사유 안내, 토큰 값 미포함', async () => {
  const now = Date.now();
  const DB = new FakeD1();
  const env = { DB, ...SECRETS };
  await K.exchangeCode(env, DB, 'c', `${BASE}/kakao/callback`, now, makeFetch({ now }).fetch);
  const r = await K.sendKakaoMemo(env, DB, 'hi', now, makeFetch({ now, kakao: { memoStatus: 403 } }).fetch);
  assert.equal(r.ok, false);
  assert.match(r.reason, /talk_message/);
  noSecrets(r.reason);
});

test('기존 API 회귀: health / reachability 목록 / 없는 주소', async () => {
  const h = await (await worker.fetch(req('/api/health'), {}, {})).json();
  assert.equal(h.status, 'ok');
  const idx = await (await worker.fetch(req('/'), {}, {})).json();
  assert.ok(idx.endpoints['GET /debug/reachability']);
  assert.ok(idx.endpoints['GET /kakao/setup']);
  assert.ok(!JSON.stringify(idx).toLowerCase().includes('telegram'));
  assert.equal((await worker.fetch(req('/nope'), {}, {})).status, 404);
});
