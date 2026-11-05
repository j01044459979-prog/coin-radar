// Telegram 연결 준비: 토큰 등록(값 비노출)·테스트 전송 허용(운영 승인과 분리)·조용한 페어링·테스트 1건. 가짜 Telegram 사용(실제 전송 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProd } from './helpers/gasprod.mjs';
import { OWNER } from './helpers/faketg.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const TOKEN = '123456789:' + 'A'.repeat(35), NOW_S = 1790000000;
const j = v => JSON.parse(JSON.stringify(v)), strip = h => h.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ');
function world({ email } = {}) { const g = loadProd({ props: { RICH300_TG_TOKEN: '' }, ...(email ? { email } : {}) }); g.ctx.rich300Install(); g.tele.calls.length = 0; return g; }
const page = (g, q = {}) => g.ctx.doGet({ parameter: { p: 'tg', ...q } }).html;
const secretFree = (g, ...texts) => texts.every(t => !String(t).includes(TOKEN) && !String(t).includes(String(OWNER)));

test('토큰 등록: 형식 검사 → 저장(값 비노출) → 이미 있으면 거부 · 가드가 getMe 를 막으면 텔레그램 호출 0', () => {
  const g = world(); assert.match(page(g), /id="tokBtn"/); assert.match(strip(page(g)), /봇 토큰 속성: 없음/);
  { const b = j(g.ctx.rich300TgSetToken('nope')); assert.equal(b.ok, false); assert.equal(b.code, 'bad-format'); assert.deepEqual(b.detail, { len: 4, hasColon: false, idDigits: 0, secretLen: 0 }); } assert.equal(g.P.getProperty('RICH300_TG_TOKEN'), '');
  const r = j(g.ctx.rich300TgSetToken(`  ${TOKEN}  `)); assert.deepEqual(r, { ok: true, code: 'saved-unverified', detail: null }); assert.equal(g.P.getProperty('RICH300_TG_TOKEN'), TOKEN); assert.equal(g.tele.calls.length, 0);
  assert.deepEqual(j(g.ctx.rich300TgSetToken(TOKEN)), { ok: false, code: 'already-set', detail: null });
  const html = page(g); assert.ok(!/id="tokBtn"/.test(html)); assert.match(strip(html), /봇 토큰 속성: 있음/); assert.ok(secretFree(g, html, JSON.stringify(r), JSON.stringify(g.spy.logs)));
});
test('토큰이 거절되면(getMe auth) 저장을 취소한다', () => {
  const g = world(); g.P.setProperty('RICH300_TG_TEST_OK', 'yes'); g.tele.fail('getMe', [{ status: 401, body: { ok: false, description: 'Unauthorized' } }]);
  assert.deepEqual(j(g.ctx.rich300TgSetToken(TOKEN)), { ok: false, code: 'token-rejected', detail: null }); assert.equal(g.P.getProperty('RICH300_TG_TOKEN'), null);
});
test('테스트 전송 허용: 확인 문구가 있어야 켜지고, 운영 승인(PROD_APPROVED)은 이 화면이 절대 바꾸지 않는다 · 해제 가능', () => {
  const g = world(); assert.deepEqual(j(g.ctx.rich300TgSetTestAllow(true, '테스트 전송 허용')), { ok: false, code: 'no-token' }); g.ctx.rich300TgSetToken(TOKEN);
  assert.deepEqual(j(g.ctx.rich300TgSetTestAllow(true, '예')), { ok: false, code: 'bad-phrase' }); assert.equal(g.P.getProperty('RICH300_TG_TEST_OK'), null);
  assert.deepEqual(j(g.ctx.rich300TgSetTestAllow(true, ' 테스트 전송 허용 ')), { ok: true, code: 'on' }); assert.equal(g.P.getProperty('RICH300_TG_TEST_OK'), 'yes'); assert.equal(g.P.getProperty('RICH300_PROD_APPROVED'), null);
  assert.match(strip(page(g)), /테스트 전송 허용\(RICH300_TG_TEST_OK\): 허용됨/); assert.deepEqual(j(g.ctx.rich300TgSetTestAllow(false, '')), { ok: true, code: 'off' }); assert.equal(g.P.getProperty('RICH300_TG_TEST_OK'), null);
});
test('가드 분리: 테스트 허용만으로는 폴링 트리거 함수·감시·일반 전송이 계속 차단된다(운영 승인 전)', () => {
  const g = world(); g.ctx.rich300TgSetToken(TOKEN); g.ctx.rich300TgSetTestAllow(true, '테스트 전송 허용');
  assert.equal(g.ctx.rich300TgGate_('sendMessage'), 'prod-not-approved'); assert.equal(g.ctx.rich300TgGate_('getUpdates'), 'prod-not-approved'); assert.equal(g.ctx.rich300TgGate_('getMe'), null);
  const poll = g.ctx.rich300TgPoll(); assert.ok(!g.tele.calls.some(c => c.method === 'getUpdates'), '폴링 트리거 함수는 getUpdates 를 호출하지 못한다'); void poll;
  g.P.setProperty('RICH300_WATCH_ALERTS', 'on'); assert.equal(g.ctx.rich300WatchCanSend_(), false); assert.notEqual(g.ctx.rich300WatchTick().sent, 1); assert.equal(g.tele.sent.length, 0);          // 감시는 계속 미리보기(전송 불가)
  const t = strip(page(g, { check: '1' })); assert.match(t, /getMe: 성공/); assert.deepEqual(g.tele.calls.map(c => c.method).sort().filter(m => m !== 'getUpdates'), ['getMe', 'getWebhookInfo']);
});
test('페어링: 코드 만들기 → 봇에 /start 코드 → 확인(1회 getUpdates) — 답장 없음·다른 업데이트 처리 없음·오래된 메시지 무시', () => {
  const g = world(); g.ctx.rich300TgSetToken(TOKEN); assert.equal(g.ctx.rich300TgPairStart().code, 'not-allowed'); g.ctx.rich300TgSetTestAllow(true, '테스트 전송 허용');
  const s = j(g.ctx.rich300TgPairStart()); assert.equal(s.ok, true); assert.match(s.pairCode, /^[A-Z0-9]{8}$/);
  assert.deepEqual(j(g.ctx.rich300TgPairCheck()), { ok: true, code: 'waiting' });
  g.tele.say(OWNER, '/fill S1 30 3 100', { date: NOW_S + 5 }); g.tele.say(OWNER, `/start ${s.pairCode}`, { date: NOW_S - 3600 });      // 다른 명령 · 코드 생성 전 메시지
  assert.equal(j(g.ctx.rich300TgPairCheck()).code, 'waiting');
  g.tele.say(OWNER, '/start WRONGCODE', { date: NOW_S + 6 }); g.tele.say(OWNER, `/start ${s.pairCode}`, { date: NOW_S + 7 }); const upd = g.tele.updates?.length;
  assert.deepEqual(j(g.ctx.rich300TgPairCheck()), { ok: true, code: 'paired' }); assert.equal(g.tele.sent.length, 0); assert.equal(g.rows('fill').length, 0);
  assert.ok(g.P.getProperty('tg:paired')); assert.ok(!JSON.stringify(g.spy.logs).includes(String(OWNER))); void upd;
  assert.deepEqual(j(g.ctx.rich300TgPairCheck()), { ok: true, code: 'already-paired' }); assert.equal(j(g.ctx.rich300TgPairStart()).code, 'already-paired');
  const html = page(g); assert.match(strip(html), /수신 계정 연결\(페어링\): 됨/); assert.ok(secretFree(g, html));
});
test('테스트 허용만으로 [RICH300 TEST] 1건: 보낸 뒤에도 일반 전송 가드는 계속 차단(목적 초기화) · 두 번째 전송 불가', () => {
  const g = world(); g.ctx.rich300TgSetToken(TOKEN); g.ctx.rich300TgSetTestAllow(true, '테스트 전송 허용'); const c = g.ctx.rich300TgPairStart().pairCode; g.tele.say(OWNER, `/start ${c}`, { date: NOW_S + 5 }); assert.equal(g.ctx.rich300TgPairCheck().code, 'paired');
  g.ctx.doGet({ parameter: { p: 'tg' } }); const n = JSON.parse(g.P.getProperty('tgdiag:nonce')).n; assert.deepEqual(j(g.ctx.rich300TgTestSend(n)), { ok: true, code: 'sent' });
  const sent = g.tele.sent.filter(m => /\[RICH300 TEST\]/.test(m.text)); assert.equal(sent.length, 1); assert.equal(g.tele.sent.length, 1);
  assert.equal(g.ctx.rich300TgGate_('sendMessage'), 'prod-not-approved'); assert.equal(g.ctx.RICH300_GATE_PURPOSE_, '');
  assert.equal(g.ctx.rich300TgTestSend(n).code, 'bad-nonce'); assert.equal(g.tele.sent.length, 1);
  g.ctx.rich300TgTestAck(true); assert.equal(g.ctx.rich300TgTestSend('x').code, 'bad-nonce');
});
test('허용을 끄면 다시 막힌다 · 소유자가 아니면 모든 설정 함수가 forbidden(값 변화 없음)', () => {
  const g = world(); g.ctx.rich300TgSetToken(TOKEN); g.ctx.rich300TgSetTestAllow(true, '테스트 전송 허용'); g.ctx.rich300TgSetTestAllow(false, '');
  assert.match(g.ctx.rich300TgPairCheck().code, /^blocked:|^forbidden$/); assert.equal(g.ctx.rich300TgPairStart().code, 'not-allowed');
  const o = world({ email: 'other@example.com' }); for (const [fn, args] of [['rich300TgSetToken', [TOKEN]], ['rich300TgSetTestAllow', [true, '테스트 전송 허용']], ['rich300TgPairStart', []], ['rich300TgPairCheck', []]]) assert.deepEqual({ ok: j(o.ctx[fn](...args)).ok, code: j(o.ctx[fn](...args)).code }, { ok: false, code: 'forbidden' }, fn);
  assert.equal(o.P.getProperty('RICH300_TG_TOKEN'), ''); assert.equal(o.P.getProperty('RICH300_TG_TEST_OK'), null); assert.equal(o.tele.calls.length, 0);
});

test('토큰 붙여넣기 변형(줄바꿈·bot 접두·앞뒤 글·제로폭 문자)도 저장되고, 응답·화면·로그에 값이 없다', () => {
  for (const wrap of [t => `\n${t}\n`, t => `bot${t}`, t => `토큰: ${t} (복사)`, t => `\u200B${t}\uFEFF`, t => `\u00A0${t}\u00A0`]) {
    const g = world(); const r = j(g.ctx.rich300TgSetToken(wrap(TOKEN))); assert.equal(r.ok, true, wrap(TOKEN)); assert.equal(g.P.getProperty('RICH300_TG_TOKEN'), TOKEN);
    const html = page(g); assert.match(strip(html), /토큰 있음/); assert.ok(secretFree(g, html, JSON.stringify(r), JSON.stringify(g.spy.logs), g.P.getProperty('tgdiag:tokenlast')));
  }
});
test('형식 오류 진단: 값 없이 길이·콜론·자릿수만 기록되고 화면에 "마지막 토큰 저장 시도"로 보인다', () => {
  const g = world(); const bad = '123456789' + 'B'.repeat(30); const r = j(g.ctx.rich300TgSetToken(bad)); assert.equal(r.code, 'bad-format'); assert.equal(r.detail.hasColon, false);
  const r2 = j(g.ctx.rich300TgSetToken('123456789:short')); assert.equal(r2.detail.hasColon, true); assert.equal(r2.detail.secretLen, 5);
  const t = strip(page(g)); assert.match(t, /마지막 토큰 저장 시도: \d+분 전 · 형식이 맞지 않아 저장하지 않음 \(길이 15, 콜론 있음, 앞 숫자 9자, 뒤 문자 5자\)/); assert.ok(!t.includes('short'));
  assert.equal(g.P.getProperty('RICH300_TG_TOKEN'), '');
});
test('운영 승인 게이트는 토큰 저장을 막지 않는다(PROD_APPROVED 없이 저장 가능) · 비소유자는 forbidden', () => {
  const g = world(); assert.ok(!g.P.getProperty('RICH300_PROD_APPROVED')); assert.equal(j(g.ctx.rich300TgSetToken(TOKEN)).ok, true); assert.ok(!g.P.getProperty('RICH300_PROD_APPROVED'));
  const o = world({ email: 'other@example.com' }); assert.equal(j(o.ctx.rich300TgSetToken(TOKEN)).code, 'forbidden'); assert.equal(o.P.getProperty('RICH300_TG_TOKEN'), '');
});

test('토큰 추출은 긴 문자열의 일부를 토큰으로 오인하지 않는다 · 토큰 원문은 오류 상세·진단 기록에 남지 않는다', () => {
  const body = 'A'.repeat(35), bads = [`9999${TOKEN}`, `${'1'.repeat(13)}:${body}`, `xx${TOKEN}`, `${TOKEN}:extra`, `1234567890:${'A'.repeat(81)}`, `${'1'.repeat(6)}:${'a'.repeat(29)}`];
  for (const b of bads) { const g = world(); const r = j(g.ctx.rich300TgSetToken(b)); assert.equal(r.code, 'bad-format', b); assert.equal(g.P.getProperty('RICH300_TG_TOKEN'), '');
    const rec = String(g.P.getProperty('tgdiag:tokenlast')); assert.ok(!rec.includes(body) && !JSON.stringify(r).includes(body) && !JSON.stringify(g.spy.logs).includes(body)); assert.ok(!strip(page(g)).includes(body)); }
  for (const ok of [TOKEN, `bot${TOKEN}`, `토큰=${TOKEN}.`, `"${TOKEN}"`, `\n${TOKEN}\r\n`]) { const g = world(); assert.equal(j(g.ctx.rich300TgSetToken(ok)).ok, true, ok); assert.equal(g.P.getProperty('RICH300_TG_TOKEN'), TOKEN); }
});
