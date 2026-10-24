import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld, SUN } from './helpers/gasworld.mjs';
import { OWNER } from './helpers/faketg.mjs';

const TOKEN = '123456789:AAFakeTokenForOfflineTestsOnly_0123456789abc';
const world = (o = {}) => loadWorld({ ...o, props: { RICH300_TG_TOKEN: TOKEN, ...(o.props ?? {}) } });
const logs = w => w.spy.logs.join('\n');

test('rich300LiveStart: 토큰 없음 → 필요한 입력만 안내(설치 없음), 운영 환경·운영 승인·운영 봇 토큰(이름에 test 없음)은 시작 거부', () => {
  const w = loadWorld(); const r = w.j(w.ctx.rich300LiveStart()); assert.deepEqual([r.ok, r.need], [false, ['RICH300_TG_TOKEN']]); assert.equal(w.triggers().length, 0); assert.ok(logs(w).includes('RICH300_TG_TOKEN')); assert.equal(w.pm.get('RICH300_ENV'), 'test'); assert.ok(w.pm.get('RICH300_SHEET_ID'));
  const prod = world({ props: { RICH300_ENV: 'prod' } }); assert.match(prod.j(prod.ctx.rich300LiveStart()).error, /test 환경이 아닙니다/); assert.equal(prod.triggers().length, 0); assert.equal(prod.spy.urls.length, 0);
  const appr = world({ props: { RICH300_PROD_APPROVED: 'yes' } }); assert.match(appr.j(appr.ctx.rich300LiveStart()).error, /운영 승인 플래그/); assert.equal(appr.spy.urls.length, 0);
  const bot = world(); bot.tele.botUsername = 'rich300_alerts_bot'; const b = bot.j(bot.ctx.rich300LiveStart()); assert.match(b.error, /not-test-bot/); assert.equal(bot.triggers().length, 0); assert.ok(!bot.tele.calls.some(c => ['sendMessage', 'getUpdates'].includes(c.method)));
  const bad = world(); bad.tele.fail('getMe', [{ status: 401, body: { ok: false } }]); assert.match(bad.j(bad.ctx.rich300LiveStart()).error, /token-rejected/); assert.equal(bad.triggers().length, 0);
});
test('rich300LiveStart: 설치·자동 검증·예산 점검·트리거·페어링 링크를 한 번에, 토큰·시트 ID는 출력하지 않고, 다시 실행해도 안전', () => {
  const w = world(); const r = w.j(w.ctx.rich300LiveStart()); assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300)); assert.match(r.pairLink, /^https:\/\/t\.me\/rich300_test_bot\?start=[A-Z2-9]{8}$/); assert.equal(r.interval, 1); assert.equal(r.summary.fail, 0);
  assert.deepEqual(w.triggers().sort(), ['rich300BackupRun:SUNDAY+h3', 'rich300CloseTick:hr1', 'rich300CloseTick:h0+d1', 'rich300LiveBackground:after30000', 'rich300TgPoll:m1'].sort());
  assert.equal(w.pm.get('RICH300_TEST_TG_ALLOW'), 'yes'); assert.equal(w.pm.get('RICH300_UI_URL'), 'https://script.google.com/macros/s/AKfycTEST/exec'); assert.equal(w.pm.has('RICH300_PROD_APPROVED'), false); assert.equal(w.pm.has('RICH300_CLOSE_SEND_APPROVED'), false);
  let auto = JSON.parse(w.pm.get('live:auto')); assert.deepEqual(auto.map(i => i.id), ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'S0']);                                   // 시작 시에는 빠른 시험만
  assert.deepEqual(JSON.parse(w.pm.get('live:bg')).todo, ['C-io', 'C-read', 'G']);
  for (let i = 0; i < 3; i++) { assert.ok(w.triggers().includes('rich300LiveBackground:after30000'), `구간 ${i} 예약`); w.advance(31000); w.ctx.rich300LiveBackground(); }                  // 백그라운드 구간 3개를 차례로 실행
  assert.equal(w.triggers().filter(t => t.startsWith('rich300LiveBackground')).length, 0); assert.deepEqual(JSON.parse(w.pm.get('live:bg')).todo, []);
  auto = JSON.parse(w.pm.get('live:auto')); const ids = auto.map(i => i.id); for (const id of ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'C1', 'C2', 'C3', 'C4', 'C5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'S0']) assert.ok(ids.includes(id), id);
  assert.ok(auto.every(i => i.status !== 'FAIL'), JSON.stringify(auto.filter(i => i.status === 'FAIL'))); assert.match(auto.find(i => i.id === 'S0').text, /하루 예상 .*분.*폴링 간격 1분/);
  const own = new Set(['RICH300_TG_TOKEN', 'RICH300_SHEET_ID', 'RICH300_OWNER_EMAIL', 'RICH300_UI_URL']), dump = logs(w) + JSON.stringify(r) + JSON.stringify(auto) + JSON.stringify([...w.pm.entries()].filter(([k]) => !own.has(k))); for (const secret of [TOKEN, 'AAFake', 'SHEET1', 'me@example.com']) assert.ok(!dump.includes(secret), secret);
  assert.ok(w.tele.sent.length === 0, '페어링 전에는 어떤 메시지도 보내지 않는다'); assert.equal(JSON.parse(w.pm.get('tg:live')).phase, 'unpaired');
  const again = w.j(w.ctx.rich300LiveStart()); assert.equal(again.ok, true); assert.equal(again.phase, 'unpaired'); assert.match(again.pairLink, /start=[A-Z2-9]{8}/); assert.equal(w.triggers().length, 4);                         // 이미 시작됨: 트리거 중복 설치 없음(백그라운드 구간은 끝나서 없음)
});
test('rich300LiveStart: 폴링이 너무 느리면(하루 예상 60분 초과) 간격을 5분으로, 5분도 안 되면 트리거를 설치하지 않는다', () => {
  const slow = world({ fetchMs: 2300 }); const r = slow.j(slow.ctx.rich300LiveStart()); assert.equal(r.ok, true); assert.equal(r.interval, 5); assert.ok(slow.triggers().includes('rich300TgPoll:m5')); assert.match(JSON.parse(slow.pm.get('live:auto')).find(i => i.id === 'S0').text, /폴링 간격 5분/);
  const worse = world({ fetchMs: 14000 }); const w = worse.j(worse.ctx.rich300LiveStart()); assert.equal(w.ok, false); assert.match(w.error, /실행 시간 예산 초과/); assert.equal(worse.triggers().length, 0);
});
test('휴대폰 흐름(가짜): 링크 /start 코드로 페어링 → [TEST] 안내 → 버튼으로 진행 → 폴링마다 판정, UI 접근 카운터(소유자·타 계정·익명)가 결과에 반영', () => {
  const w = world(); const r = w.j(w.ctx.rich300LiveStart()); const code = /start=([A-Z2-9]{8})/.exec(r.pairLink)[1];
  w.tele.say(OWNER, `/start ${code}`, { date: Math.floor(w.spy.now / 1000) - 5 }); w.advance(60000); w.ctx.rich300TgPoll();
  const st = () => JSON.parse(w.pm.get('tg:live')); assert.deepEqual([st().phase, st().step], ['wizard', 0]); assert.ok(w.tele.sent.length >= 4 && w.tele.texts().every(t => t.startsWith('[TEST] ')), w.tele.texts().find(t => !t.startsWith('[TEST] ')));
  const sig = w.tele.sent.find(m => m.text.includes('🔔')); w.tele.click(OWNER, sig, `r1:${st().sid}:e`); w.advance(60000); w.ctx.rich300TgPoll(); assert.equal(st().step, 1); assert.equal(w.rows('response').length, 1);
  w.spy.email = 'me@example.com'; w.ctx.doGet({ parameter: { p: 'journal' } }); w.spy.email = 'other@example.com'; w.ctx.doGet({ parameter: { p: 'journal' } }); w.spy.email = ''; w.ctx.doGet({ parameter: { p: 'journal' } }); w.ctx.doGet({ parameter: { p: 'nope' } });
  const ct = JSON.parse(w.pm.get('live:ct')); assert.deepEqual([ct['ui-owner-ok'], ct['ui-denied-other'], ct['ui-denied-anon']], [1, 1, 1]); assert.deepEqual(Object.keys(ct).filter(k => k.startsWith('ui-')).sort(), ['ui-denied-anon', 'ui-denied-other', 'ui-owner-ok']);                              // 존재하지 않는 페이지는 세지 않음
  const rep = w.j(w.ctx.rich300LiveReport()); assert.ok(rep.pass > 5 && rep.fail === 0 && rep.verdict === 'WAIT'); const log = logs(w); assert.match(log, /PASS E11 UI: 소유자 접속 1회 표시, 다른 Google 계정 접속 1회 차단, 익명 1회 차단/); assert.match(log, /WAIT E12/); assert.match(log, /PASS A1 /);
  const sent = w.j(w.ctx.rich300LiveSendReport()); assert.equal(sent.verdict, 'WAIT'); assert.ok(w.tele.texts().some(t => t.startsWith('[TEST] LIVE 결과:'))); assert.ok(![...w.pm.entries()].some(([k, v]) => k !== 'RICH300_TG_TOKEN' && String(v).includes(TOKEN)));
  const stats = JSON.parse(w.pm.get('tg:stats')); assert.ok(stats.runs >= 2 && stats.gaps90 >= 0 && 'maxGap' in stats && 'retry' in stats);
});
test('안전 중단(가짜 Apps Script): 토큰 오류·실행 시간·발송 폭주·운영 승인 플래그가 생기면 트리거 제거 + 상태 기록, 데이터·시트·백업은 그대로, rich300LiveStop 도 동일', () => {
  const mk = () => { const w = world(); const r = w.j(w.ctx.rich300LiveStart()); const code = /start=([A-Z2-9]{8})/.exec(r.pairLink)[1]; w.tele.say(OWNER, `/start ${code}`); w.advance(60000); w.ctx.rich300TgPoll(); return w; };
  const books0 = w => [...w.books.keys()].join(), filesTrashed = w => [...w.drive.files.values()].filter(f => f.trashed).length;
  const a = mk(); const b0 = books0(a), t0 = filesTrashed(a); a.tele.fail('getUpdates', [{ status: 401, body: { ok: false } }]); a.advance(60000); a.ctx.rich300TgPoll(); assert.equal(JSON.parse(a.pm.get('live:halt')).reason, 'bot-token-invalid'); assert.equal(a.triggers().length, 0); assert.equal(JSON.parse(a.pm.get('tg:live')).phase, 'halted'); assert.equal(books0(a), b0); assert.equal(filesTrashed(a), t0);
  const f = mk(); f.pm.set('live:ct', JSON.stringify({ [`sent:${new Date(f.spy.now + 9 * 3600000).toISOString().slice(0, 10)}`]: 400 })); f.advance(60000); f.ctx.rich300TgPoll(); assert.equal(JSON.parse(f.pm.get('live:halt')).reason, 'message-flood'); assert.equal(f.triggers().length, 0);
  const p = mk(); p.pm.set('RICH300_PROD_APPROVED', 'yes'); p.advance(60000); const out = p.ctx.rich300TgPoll(); assert.ok(out); assert.equal(p.triggers().length, 5);                       // 운영 승인 플래그가 있으면 가드가 Telegram 호출을 막고(forbidden), 하니스는 시험 환경이 아니므로 동작하지 않음
  const m = mk(); assert.equal(m.j(m.ctx.rich300LiveStop()).ok, true); assert.equal(m.triggers().length, 0); assert.equal(JSON.parse(m.pm.get('live:halt')).reason, 'manual'); m.advance(60000); m.ctx.rich300TgPoll(); assert.equal(m.rows('response').length, 0);
  const q = mk(); q.ctx.UrlFetchApp.fetch = () => { throw new Error('Service invoked too many times for one day: urlfetch.'); }; q.advance(60000); const qo = q.j(q.ctx.rich300TgPoll()); assert.ok(qo.status === 'error' || qo.status === 'exception');
});
test('하니스 소스 점검: 로그·속성에 토큰/이메일/시트 ID 를 쓰지 않고, 운영 환경에서는 카운터·훅이 동작하지 않으며, 삭제 호출(휴지통 제외)이 없다', () => {
  const w = loadWorld({ props: { RICH300_ENV: 'prod' } }); w.ctx.rich300LiveCount_('x'); assert.equal(w.pm.has('live:ct'), false); assert.equal(w.ctx.rich300LiveHook_({ status: 'ok' }), undefined);
  const src = w.ctx.rich300LiveStart.toString() + w.ctx.rich300LiveReport.toString(); assert.ok(!/setTrashed|deleteFile|\.remove\(/.test(src)); assert.ok(!/RICH300_TG_TOKEN['"]\)\s*[,;]?\s*Logger/.test(src));
});
