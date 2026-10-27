// Telegram 연결 진단(?p=tg)과 1회 테스트 메시지: 값 비노출, 한 번만 전송(nonce·락·pending), 가드, 수신 확인 분리, 실패/재시도 제한. 가짜 Telegram 사용(실제 전송 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProd } from './helpers/gasprod.mjs';
import { OWNER, FAKE_TOKEN } from './helpers/faketg.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const strip = h => h.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ');
const j = v => JSON.parse(JSON.stringify(v));
function world({ approved = true, paired = true, email } = {}) {
  const g = loadProd({ props: approved ? { RICH300_PROD_APPROVED: 'yes' } : {}, ...(email ? { email } : {}) }); const r = g.ctx.rich300Install();
  if (paired && approved) { g.tele.say(OWNER, `/start ${r.pairLink.split('=')[1]}`); g.ctx.rich300TgPoll(); } g.tele.sent.length = 0; g.tele.calls.length = 0; return g;
}
const nonceOf = g => JSON.parse(g.P.getProperty('tgdiag:nonce')).n;
const testMsgs = g => g.tele.sent.filter(m => /\[RICH300 TEST\]/.test(m.text));

test('진단 화면: 존재 여부·가드·트리거만 표시, 토큰·채팅 ID·봇 이름 비노출, 네트워크(텔레그램) 호출 0', () => {
  const g = world(); const html = g.ctx.doGet({ parameter: { p: 'tg' } }).html, t = strip(html);
  assert.match(t, /봇 토큰 속성: 있음/); assert.match(t, /메시지 전송 가드\(일반\): 통과/); assert.match(t, /수신 계정 연결\(페어링\): 됨/); assert.match(t, /테스트 메시지: 아직 보낸 적 없음/);
  for (const secret of [FAKE_TOKEN, String(OWNER), 'rich300_test_bot']) assert.ok(!html.includes(secret), `비노출: ${secret}`);
  assert.equal(g.tele.calls.length, 0);
});
test('소유자가 아니면 진단 화면도 접근 제한 · 전송 함수는 forbidden', () => {
  const g = world({ email: 'other@example.com' }); assert.match(g.ctx.doGet({ parameter: { p: 'tg' } }).html, /접근 제한/); assert.deepEqual(j(g.ctx.rich300TgTestSend('x')), { ok: false, code: 'forbidden' }); assert.deepEqual(j(g.ctx.rich300TgTestAck(true)), { ok: false, code: 'forbidden' }); assert.equal(g.tele.sent.length, 0);
});
test('테스트 메시지는 정확히 1건: 같은 nonce 재사용·연타·새 화면 모두 추가 전송 없음, 메시지에 [RICH300 TEST] 와 비추천 안내', () => {
  const g = world(); g.ctx.doGet({ parameter: { p: 'tg' } }); const n = nonceOf(g);
  assert.deepEqual(j(g.ctx.rich300TgTestSend(n)), { ok: true, code: 'sent' }); assert.equal(testMsgs(g).length, 1); assert.match(testMsgs(g)[0].text, /추천·매매 알림이 아닙니다/);
  assert.equal(g.ctx.rich300TgTestSend(n).code, 'bad-nonce'); assert.equal(g.ctx.rich300TgTestSend(n).code, 'bad-nonce');                      // 연타
  const html = g.ctx.doGet({ parameter: { p: 'tg' } }).html; assert.ok(!/id="sendTest"/.test(html)); assert.match(strip(html), /전송 API 성공 — 수신 확인 대기/);       // 이미 보냄 → 버튼 없음
  assert.equal(g.P.getProperty('tgdiag:nonce'), null); assert.equal(g.ctx.rich300TgTestSend('anything').code, 'bad-nonce'); assert.equal(testMsgs(g).length, 1);
  assert.ok(!html.includes(FAKE_TOKEN) && !html.includes(String(OWNER)));
});
test('API 전송 성공과 사용자 수신 확인은 별도: 받았음 → acked(다시 못 보냄) · 못 받음 → 최대 3회까지만 재시도', () => {
  const g = world(); g.ctx.doGet({ parameter: { p: 'tg' } }); assert.equal(g.ctx.rich300TgTestSend(nonceOf(g)).ok, true);
  assert.equal(JSON.parse(g.P.getProperty('tgdiag:test')).state, 'sent'); assert.deepEqual(j(g.ctx.rich300TgTestAck(false)), { ok: true, code: 'unacked' });
  g.ctx.doGet({ parameter: { p: 'tg' } }); assert.equal(g.ctx.rich300TgTestSend(nonceOf(g)).ok, true); assert.equal(testMsgs(g).length, 2); assert.deepEqual(j(g.ctx.rich300TgTestAck(true)), { ok: true, code: 'acked' });
  g.ctx.doGet({ parameter: { p: 'tg' } }); assert.equal(g.P.getProperty('tgdiag:nonce'), null); assert.equal(g.ctx.rich300TgTestSend('x').code, 'bad-nonce'); assert.equal(testMsgs(g).length, 2);
  const h = world(); for (let i = 0; i < 3; i++) { h.ctx.doGet({ parameter: { p: 'tg' } }); assert.equal(h.ctx.rich300TgTestSend(nonceOf(h)).ok, true); h.ctx.rich300TgTestAck(false); }
  h.ctx.doGet({ parameter: { p: 'tg' } }); assert.equal(testMsgs(h).length, 3); h.P.setProperty('tgdiag:nonce', JSON.stringify({ n: 'zz', at: Date.now() })); assert.equal(h.ctx.rich300TgTestSend('zz').code, 'max-tries'); assert.equal(testMsgs(h).length, 3);
});
test('결과를 기록하지 못한 채 끝난 경우(pending)는 자동 재전송하지 않는다', () => {
  const g = world(); g.P.setProperty('tgdiag:test', JSON.stringify({ state: 'pending', at: Date.now(), tries: 1 })); g.P.setProperty('tgdiag:nonce', JSON.stringify({ n: 'abc', at: Date.now() }));
  assert.equal(g.ctx.rich300TgTestSend('abc').code, 'already-pending'); assert.equal(g.tele.sent.length, 0); assert.match(strip(g.ctx.doGet({ parameter: { p: 'tg' } }).html), /결과를 기록하지 못함\(상태 불명\)/);
});
test('API 전송 실패: failed 기록, 60초 안에는 재시도 거부, 그 뒤에는 새 nonce 로 다시 시도 가능 — 사용자에게는 최대 1건 전달', () => {
  const g = world(); g.tele.fail('sendMessage', [{ status: 500, body: { ok: false, description: 'Internal' } }, { status: 500, body: { ok: false, description: 'Internal' } }, { status: 500, body: { ok: false, description: 'Internal' } }, { status: 500, body: { ok: false, description: 'Internal' } }]);
  g.ctx.doGet({ parameter: { p: 'tg' } }); const r = g.ctx.rich300TgTestSend(nonceOf(g)); assert.equal(r.ok, false); assert.equal(JSON.parse(g.P.getProperty('tgdiag:test')).state, 'failed'); assert.equal(testMsgs(g).length, 0);
  g.ctx.doGet({ parameter: { p: 'tg' } }); assert.equal(g.ctx.rich300TgTestSend(nonceOf(g)).code, 'cooldown');
  const t = JSON.parse(g.P.getProperty('tgdiag:test')); g.P.setProperty('tgdiag:test', JSON.stringify({ ...t, at: 1790000000000 - 120000 })); g.tele.fails.clear();
  g.ctx.doGet({ parameter: { p: 'tg' } }); assert.equal(g.ctx.rich300TgTestSend(nonceOf(g)).ok, true); assert.equal(testMsgs(g).length, 1);
});
test('가드: 운영 승인 전이거나 연결 전이면 전송 불가(0건)·버튼/nonce 없음 · 안내 문구', () => {
  const a = world({ approved: false }); const html = a.ctx.doGet({ parameter: { p: 'tg' } }).html; assert.ok(!/id="sendTest"/.test(html)); assert.match(strip(html), /메시지 전송 가드\(일반\): 막힘\(prod-not-approved\)/); assert.equal(a.P.getProperty('tgdiag:nonce'), null);
  a.P.setProperty('tgdiag:nonce', JSON.stringify({ n: 'q', at: Date.now() })); assert.match(a.ctx.rich300TgTestSend('q').code, /^blocked:/); assert.equal(a.tele.sent.length, 0); assert.equal(a.tele.calls.length, 0);
  const b = world({ paired: false }); b.P.setProperty('RICH300_PROD_APPROVED', 'yes'); b.ctx.doGet({ parameter: { p: 'tg' } }); b.P.setProperty('tgdiag:nonce', JSON.stringify({ n: 'q', at: Date.now() })); assert.equal(b.ctx.rich300TgTestSend('q').code, 'not-paired'); assert.equal(b.tele.sent.length, 0);
});
test('읽기 점검(check=1): getMe·getWebhookInfo 두 호출만, 메시지·설정 변경 없음, 봇 이름 비노출 · 가드가 막으면 호출 0', () => {
  const g = world(); const t = strip(g.ctx.doGet({ parameter: { p: 'tg', check: '1' } }).html); assert.match(t, /getMe: 성공/); assert.match(t, /웹훅 설정: 없음\(정상\)/); assert.deepEqual(g.tele.calls.map(c => c.method).sort(), ['getMe', 'getWebhookInfo']); assert.equal(g.tele.sent.length, 0); assert.ok(!t.includes('rich300_test_bot'));
  const b = world({ approved: false }); assert.match(strip(b.ctx.doGet({ parameter: { p: 'tg', check: '1' } }).html), /막힘\(prod-not-approved\) — 호출하지 않았습니다/); assert.equal(b.tele.calls.length, 0);
});
test('감시 미리보기·진단 화면은 텔레그램 테스트와 무관: ?p=watch 방문이 메시지를 만들지 않는다', () => {
  const g = world(); g.ctx.doGet({ parameter: { p: 'watch' } }); g.ctx.doGet({ parameter: { p: 'watch', run: '1' } }); assert.equal(g.tele.sent.length, 0); assert.equal(g.P.getProperty('tgdiag:test'), null);
});
