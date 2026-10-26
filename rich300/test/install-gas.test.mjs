// 운영 설치(Install.gs)·검증 화면(Verify.gs/?p=check)을 가짜 Apps Script·가짜 Telegram 으로 검사한다. 실제 호출 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FAKE_TOKEN, OWNER } from './helpers/faketg.mjs';

import { loadProd as load, readGas as read } from './helpers/gasprod.mjs';
const statusOf = (r, id) => r.steps.find(s => s.id === id)?.status;

test('승인 전 설치: 시트·챌린지(300 USDT·5%)·마감/백업 트리거까지만, Telegram 호출 0건, 웹앱 미배포면 WAIT', () => {
  const g = load({ url: 'https://script.google.com/macros/s/X/dev' }), r = g.ctx.rich300Install();
  assert.equal(r.ok, true, JSON.stringify(r.steps)); assert.deepEqual(['I1', 'I2', 'I3', 'I4', 'I5', 'I6'].map(i => statusOf(r, i)), ['PASS', 'PASS', 'PASS', 'WAIT', 'PASS', 'WAIT']);
  assert.equal(g.spy.fetches, 0); assert.equal(g.tele.calls.length, 0); assert.equal(r.pairLink, null);
  assert.equal(g.pm.get('RICH300_ENV'), 'prod'); const ch = g.rows('challenge')[0]; assert.equal(ch.startEquity, '300'); assert.equal(g.rows('rate')[0].rate, '0.05');
  const kinds = g.spy.triggers.map(t => t.fn).sort(); assert.ok(kinds.includes('rich300CloseTick') && kinds.includes('rich300BackupRun') && !kinds.includes('rich300TgPoll'));
  assert.ok(!g.spy.logs.join('\n').includes(FAKE_TOKEN)); assert.ok(!/@|sheet|FakeToken/.test(g.spy.logs.join('\n').replace(/Telegram/g, '')));
});
test('토큰이 없으면 안내만 하고(승인 여부와 무관) 호출하지 않는다', () => {
  const g = load({ props: { RICH300_TG_TOKEN: '', RICH300_PROD_APPROVED: 'yes' } }); g.pm.delete('RICH300_TG_TOKEN'); const r = g.ctx.rich300Install(); assert.equal(statusOf(r, 'I6'), 'WAIT'); assert.equal(g.spy.fetches, 0);
});
test('승인 후 설치: 봇 확인·웹훅 없음 확인·폴링 트리거·1회용 페어링 링크, 웹앱 주소 자동 기록', () => {
  const g = load({ props: { RICH300_PROD_APPROVED: 'yes' } }), r = g.ctx.rich300Install();
  assert.deepEqual(['I4', 'I6', 'I7', 'I8'].map(i => statusOf(r, i)), ['PASS', 'PASS', 'PASS', 'WAIT']); assert.equal(g.pm.get('RICH300_UI_URL'), 'https://script.google.com/macros/s/X/exec');
  assert.deepEqual(g.tele.calls.map(c => c.method), ['getMe', 'getWebhookInfo']); assert.ok(g.spy.triggers.some(t => t.fn === 'rich300TgPoll' && t.kind.includes('everyMinutes1')));
  assert.match(r.pairLink, /^https:\/\/t\.me\/rich300_test_bot\?start=[A-Z0-9]{8}$/); assert.equal(g.tele.sent.length, 0);                    // 메시지는 보내지 않는다
  g.tele.say(OWNER, `/start ${r.pairLink.split('=')[1]}`); g.ctx.rich300TgPoll(); assert.match(g.tele.last().text, /연결/);                    // 링크 탭 = 페어링
  const again = g.ctx.rich300Install(); assert.equal(statusOf(again, 'I8'), 'PASS'); assert.equal(again.pairLink, null);
});
test('재실행은 안전하다: 챌린지·시트를 바꾸지 않고 트리거를 늘리지 않는다', () => {
  const g = load({ props: { RICH300_PROD_APPROVED: 'yes' } }); g.ctx.rich300Install(); const n1 = g.spy.triggers.filter(t => !t.deleted).length, ch = JSON.stringify(g.rows('challenge')); g.ctx.rich300Install(); g.ctx.rich300Install();
  assert.equal(g.spy.triggers.filter(t => !t.deleted).length, n1); assert.equal(JSON.stringify(g.rows('challenge')), ch); assert.equal(g.rows('rate').length, 1);
});
test('웹훅이 이미 있으면 지우지 않고 멈춘다(FAIL), 폴링 트리거도 만들지 않는다', () => {
  const g = load({ props: { RICH300_PROD_APPROVED: 'yes' } }); g.tele.webhookUrl = 'https://example.com/hook'; const r = g.ctx.rich300Install();
  assert.equal(statusOf(r, 'I6'), 'FAIL'); assert.ok(!g.tele.calls.some(c => c.method === 'deleteWebhook')); assert.ok(!g.spy.triggers.some(t => t.fn === 'rich300TgPoll')); assert.equal(r.ok, false);
});
test('봇 토큰이 거절되면 FAIL(토큰은 출력되지 않음)', () => {
  const g = load({ props: { RICH300_PROD_APPROVED: 'yes' } }); g.tele.fail('getMe', [{ status: 401, body: { ok: false, description: 'Unauthorized' } }]); const r = g.ctx.rich300Install();
  assert.equal(statusOf(r, 'I6'), 'FAIL'); assert.ok(!JSON.stringify(r).includes(FAKE_TOKEN) && !g.spy.logs.join('').includes(FAKE_TOKEN));
});
test('이미 다른 환경(test)으로 표시된 프로젝트는 설치를 거부한다', () => {
  const g = load({ props: { RICH300_ENV: 'test' } }); const r = g.ctx.rich300Install(); assert.equal(r.ok, false); assert.equal(statusOf(r, 'I1'), 'FAIL'); assert.equal(r.steps.length, 1); assert.equal(g.spy.triggers.length, 0);
});
test('?p=check: 소유자만, 설치 점검·자동 검증(진행 중 표시)·폴링 실측·트리거가 한 화면에 나온다', () => {
  const g = load({ props: { RICH300_PROD_APPROVED: 'yes' } }); g.ctx.rich300Install();
  g.pm.set('verify:auto', JSON.stringify([{ id: 'A1', status: 'PASS', text: 'V8·BigInt' }, { id: 'B1', status: 'FAIL', text: '엔진 느림' }])); g.pm.set('verify:bg', JSON.stringify({ todo: ['G'] }));
  g.pm.set('tg:stats', JSON.stringify({ since: 1, lastAt: 2, runs: 30, totalMs: 15000, maxMs: 1800, slow: 0, busy: 0, gaps90: 0, maxGap: 70000 }));
  const out = g.ctx.doGet({ parameter: { p: 'check' } }); assert.equal(out.title, 'RICH300 점검');
  for (const w of ['전체 판정', '설치 점검', 'A1', '엔진 느림', 'G1', '대기 중', '폴링 30회', '평균 500ms', 'rich300TgPoll', '복사용 요약']) assert.ok(out.html.includes(w), w);
  assert.ok(!out.html.includes(FAKE_TOKEN)); for (const e of ['', 'other@example.com']) assert.match(load({ email: e }).ctx.doGet({ parameter: { p: 'check' } }).html, /접근 제한/);
});
test('?p=check: 검증을 시작하지 않았으면 안내, 폴링 전이면 WAIT, 전부 통과하면 통과', () => {
  const g = load({ props: { 'verify:startedAt': '' } }); g.pm.delete('verify:startedAt'); const items = g.ctx.rich300VerifyItems_(); assert.equal(items[0].status, 'WAIT'); assert.match(items[0].text, /시작되지 않았습니다/);
  const E = g.ctx.RICH300_ENGINE; assert.equal(E.checkPollItems(null)[0].status, 'WAIT'); assert.equal(E.checkSummary([{ status: 'PASS' }, { status: 'WARN' }]).verdict, 'WARN'); assert.equal(E.checkSummary([{ status: 'PASS' }]).verdict, 'PASS'); assert.equal(E.checkSummary([{ status: 'FAIL' }, { status: 'WAIT' }]).verdict, 'FAIL');
});
test('Install.gs·Verify.gs 는 값(토큰·키·이메일)을 로그에 쓰지 않고 삭제 호출이 없다', () => {
  for (const f of ['Install.gs', 'Verify.gs']) { const s = read(f); assert.ok(!/Logger\.log\([^\n]*\bgetProperty\(/.test(s), f); assert.ok(!/\.setTrashed\(|deleteSheet|removeFile|deleteFile|trashFile/.test(s), f); }
});

test('읽기 전용 봇 점검: 승인 속성 없으면 호출 0건, READONLY_OK 면 getMe·getWebhookInfo 두 호출만(메시지·수신·웹훅 변경 없음)', () => {
  const g = load({ props: {} }); let r = g.ctx.rich300BotCheck(); assert.equal(r.error, 'not-approved'); assert.equal(g.spy.fetches, 0);
  const h = load({ props: { RICH300_TG_READONLY_OK: 'yes' } }); h.ctx.rich300Setup_('prod'); r = h.ctx.rich300BotCheck(); assert.equal(r.ok, true); assert.deepEqual(h.tele.calls.map(c => c.method), ['getMe', 'getWebhookInfo']); assert.equal(h.tele.sent.length, 0);
  assert.ok(r.items.every(i => i.status === 'PASS')); const j = JSON.parse(h.pm.get('botcheck:last')); assert.deepEqual(Object.keys(j.wh).sort(), ['hasAllowed', 'hasUrl', 'lastErrorAt', 'ok', 'pending']);
  assert.ok(!JSON.stringify(h.spy.logs).includes(FAKE_TOKEN));
  // 읽기 전용 승인으로는 그 밖의 호출(메시지·폴링)이 계속 차단된다
  h.tele.say(OWNER, 'hi'); const poll = h.ctx.rich300TgPoll(); assert.equal(poll.status, 'error'); assert.ok(!h.tele.calls.some(c => c.method === 'getUpdates')); assert.equal(h.tele.sent.length, 0);
});
test('읽기 전용 봇 점검: 웹훅·대기 업데이트·오류 기록을 보고만 하고 아무것도 지우거나 바꾸지 않는다', () => {
  const g = load({ props: { RICH300_TG_READONLY_OK: 'yes' } }); g.ctx.rich300Setup_('prod'); g.tele.webhookUrl = 'https://other.example/hook'; g.tele.updates.push({ update_id: 1, message: { message_id: 1, from: { id: 5, is_bot: false }, chat: { id: 5, type: 'private' }, text: 'x' } });
  const r = g.ctx.rich300BotCheck(); assert.equal(r.ok, false); assert.equal(r.items.find(i => i.id === 'B2').status, 'FAIL'); assert.deepEqual(g.tele.calls.map(c => c.method), ['getMe', 'getWebhookInfo']); assert.equal(g.tele.webhookUrl, 'https://other.example/hook');
  assert.equal(g.tele.updates.length, 1);
  const E = g.ctx.RICH300_ENGINE; assert.equal(E.checkBotItems({ me: { ok: true }, wh: { ok: true, hasUrl: false, pending: 7, lastErrorAt: 1 } }).filter(i => i.status === 'WARN').length, 2); assert.equal(E.checkBotItems(null)[0].status, 'WAIT');
  assert.equal(E.checkPollItems({ runs: 3, totalMs: 3, maxMs: 1 }, { last: { r: { status: 'error', code: 'conflict' } } })[0].status, 'FAIL');       // 폴링이 409를 받으면 다른 소비자·웹훅 의심으로 표시
});
test('?p=ping: 소유자는 OK, 다른 계정은 DENY, 이메일 불명은 BLOCKED(값 없이 상태 단어만)', () => {
  const ok = load({}).ctx.doGet({ parameter: { p: 'ping' } }).text; assert.match(ok, /reachable: yes/); assert.match(ok, /owner-match: yes/); assert.match(ok, /verdict: OK/); assert.ok(!/@|me@example/.test(ok));
  assert.match(load({ email: 'other@example.com' }).ctx.doGet({ parameter: { p: 'ping' } }).text, /verdict: DENY/); const an = load({ email: '' }).ctx.doGet({ parameter: { p: 'ping' } }).text; assert.match(an, /visitor-email: hidden/); assert.match(an, /BLOCKED/); assert.ok(!/@/.test(an));
});

test('승인 전이라도 읽기 전용 승인(RICH300_TG_READONLY_OK)이 있으면 설치가 봇 사전 점검까지 하고, 쓰기·수신 호출은 0건', () => {
  const g = load({ props: { RICH300_TG_READONLY_OK: 'yes' } }), r = g.ctx.rich300Install(); assert.equal(statusOf(r, 'I6a'), 'PASS'); assert.equal(statusOf(r, 'I6'), 'WAIT');
  assert.deepEqual(g.tele.calls.map(c => c.method), ['getMe', 'getWebhookInfo']); assert.ok(!g.spy.triggers.some(t => t.fn === 'rich300TgPoll')); assert.equal(g.tele.sent.length, 0);
  const w = load({ props: { RICH300_TG_READONLY_OK: 'yes' } }); w.tele.webhookUrl = 'https://other.example/h'; const r2 = w.ctx.rich300Install(); assert.equal(statusOf(r2, 'I6a'), 'FAIL'); assert.equal(r2.ok, false); assert.equal(w.tele.webhookUrl, 'https://other.example/h');
});
