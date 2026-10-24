import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTg, OWNER, FAKE_TOKEN } from './helpers/faketg.mjs';
import { tgPoll, tgPairCreate, tgSubmitFillForm, tgSendNotice, tgPairedUser } from '../lib/tg.mjs';
import { storeList, storeCreate, storeGet, storeIntegrityCheck } from '../lib/store.mjs';
import { journalReviseFill, journalAddCashflow } from '../lib/journal.mjs';
import { closeTick } from '../lib/close.mjs';
import { kstDayOf, dayStartMs, addDays } from '../lib/time.mjs';
import { liveInit, liveGet, liveWizardTick, liveOnCallback, LIVE_STEPS } from '../lib/livewizard.mjs';
import { rig, pairUser, runWizard, btn } from './helpers/liverig.mjs';
import { liveHookRun, liveReportNow, liveBotCheck } from '../lib/livehook.mjs';
import { liveBuildReport, liveReportTexts, liveSummary } from '../lib/livereport.mjs';
import { liveSafety, liveChooseInterval, liveProjectDailyMin, LIVE_LIMITS } from '../lib/livesafe.mjs';

test('마법사 전체: 페어링(/start 코드) → 10단계를 버튼·웹 조작으로 마치면 자동 판정이 PASS로 쌓이고 중간 결과가 [TEST] 메시지로 온다', () => {
  const x = rig(); x.start(); assert.equal(x.state().phase, 'unpaired'); assert.ok(x.rows('dayclose').length === 2 && x.rows('closenotice').every(n => n.status === 'off'));      // 시험 챌린지 + 지난 이틀 마감, 알림은 꺼진 상태로 기록
  const sid = runWizard(x); const st = x.state(); assert.equal(st.phase, 'done'); assert.deepEqual(Object.keys(st.done), LIVE_STEPS); assert.ok(st.interimSent);
  assert.deepEqual(x.rows('fill').filter(f => f.sid === sid).map(f => f.kind).sort(), ['close', 'entry', 'reduce']); assert.equal(x.rows('response').filter(r => r.sid === sid).length, 1); assert.equal(x.rows('review').length, 1); assert.equal(x.rows('equity').length, 1); assert.equal(x.notifyEnabled, true);
  assert.ok(x.tele.sent.length > 12 && x.texts().every(t => t.startsWith('[TEST] ')), x.texts().find(t => !t.startsWith('[TEST] '))); assert.ok(!JSON.stringify([x.tele.calls, [...x.kv.map.values()]]).includes(FAKE_TOKEN));
  const interim = x.texts().filter(t => t.includes('LIVE 중간 결과')); assert.equal(interim.length, 1); assert.match(interim[0], /PASS E3 /); assert.match(interim[0], /WAIT E12 /);
  const items = Object.fromEntries(liveReportNow(x.env, x.io, x.state()).map(i => [i.id, i]));
  for (const id of ['E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11', 'F3', 'F4', 'F6', 'S1', 'S2']) assert.equal(items[id].status, 'PASS', `${id}: ${items[id].text}`);
  assert.deepEqual(['E12', 'H1', 'D1'].map(k => items[k].status), ['WAIT', 'WAIT', 'WAIT']); assert.equal(items.E1.status, 'SKIP'); assert.equal(storeIntegrityCheck(x.mem.env).ok, true);
});
test('마법사 안내: 같은 입력 재시도는 막히고(기록 1건), 단계가 막히면 30분마다 최대 3번 알려 주며, 폴링에 처리된 update 가 있을 때만 시트를 읽는다', () => {
  const x = rig(); x.start(); pairUser(x); const sid = x.sid(); const sig = x.lastWith('🔔'); x.tap(sig, '진입했어');
  const before = x.tele.sent.length; for (let i = 0; i < 130; i++) x.poll(60000); const reminders = x.texts().filter(t => /\(알림 \d\/3\)/.test(t)); assert.equal(reminders.length, 3); assert.equal(x.state().step, 1); assert.ok(x.tele.sent.length - before === 3);
  const g = x.lastWith('진입 기록 만들기'); x.tap(g, '진입 기록 만들기'); let d = [...x.tele.sent].reverse().find(m => m.reply_markup?.inline_keyboard[0][0].callback_data.startsWith('f1:')); x.tap(d, '저장'); assert.equal(x.rows('fill').filter(f => f.sid === sid).length, 1);
  const g2 = x.lastWith('같은 입력 다시 만들기'); x.tap(g2, '같은 입력 다시 만들기'); d = [...x.tele.sent].reverse().find(m => m.reply_markup?.inline_keyboard[0][0].callback_data.startsWith('f1:')); x.tap(d, '저장'); assert.equal(x.rows('fill').filter(f => f.sid === sid).length, 1); assert.match(x.tele.edits.at(-1).text, /\[TEST\] ⚠ 그 사이 포지션 상태가 바뀌어|중복 저장 방지/); assert.equal(x.state().act['fill-rejected'], 1); assert.equal(x.state().step, 3);
});
test('웹 주소가 없으면 웹 단계는 미검증(SKIP)으로 건너뛰고, 대체 버튼으로 청산하면 웹 폼은 SKIP으로 표시', () => {
  const x = rig({ uiUrl: null }); x.start(); pairUser(x); const sid = x.sid(); x.tap(x.lastWith('🔔'), '진입했어');
  for (const label of ['진입 기록 만들기', '같은 입력 다시 만들기', '부분 청산 만들기']) { const g = [...x.tele.sent].reverse().find(m => m.reply_markup?.inline_keyboard.flat().some(b => b.text.includes(label))); x.tap(g, label); const d = [...x.tele.sent].reverse().find(m => m.reply_markup?.inline_keyboard[0][0].callback_data.startsWith('f1:')); x.tap(d, '저장'); }
  const e = [...x.tele.sent].reverse().find(m => m.reply_markup?.inline_keyboard.flat().some(b => b.text.includes('전량 청산 만들기'))); assert.ok(e.text.includes('웹 화면 주소가 없어')); x.tap(e, '전량 청산 만들기'); const d = [...x.tele.sent].reverse().find(m => m.reply_markup?.inline_keyboard[0][0].callback_data.startsWith('f1:')); x.tap(d, '저장');
  x.tap(x.lastWith('복기 · '), '저장'); const eqb = [...x.tele.sent].reverse().find(m => m.reply_markup?.inline_keyboard.flat().some(b => b.text.includes('평가액 입력 만들기'))); x.tap(eqb, '평가액 입력 만들기'); x.tap([...x.tele.sent].reverse().find(m => m.text.includes('평가액 입력 ·') && m.reply_markup), '저장');
  x.poll(150000); x.poll(150000); assert.equal(x.state().step, 9); assert.ok(x.state().done['journal-edit'] < 0 && x.state().done.cashflow < 0);
  const it = Object.fromEntries(liveReportNow(x.env, x.io, x.state()).map(i => [i.id, i])); assert.equal(it.E5.status, 'SKIP'); assert.equal(it.E9.status, 'SKIP'); assert.equal(it.E10.status, 'SKIP'); void sid;
});
test('자정 마감 알림(E12·H1): 마법사가 알림을 켠 뒤 00:30 KST 마감 때 [TEST] 알림 1회, 재실행해도 중복 없음 → 24시간 뒤 최종 결과가 PASS(스킵 제외)', () => {
  const x = rig(); x.start(); runWizard(x); 
  const chatId = () => tgPairedUser(x.env).chatId, cenv = () => ({ now: () => x.clock.t, storeEnv: () => x.mem.env, uiUrl: 'https://example.com/exec', sendEnabled: () => x.notifyEnabled, notify: m => tgSendNotice(x.env, chatId(), m.text, m.url) });
  const tPrev = x.clock.t; x.clock.t = dayStartMs(addDays(kstDayOf(x.clock.t), 1)) + 30 * 60000; { const n = Math.floor((x.clock.t - tPrev) / 60000); x.stats.runs += n; x.stats.totalMs += 900 * n; } const n0 = x.tele.sent.length; const r = closeTick(cenv(), { now: x.clock.t }); assert.equal(r.closed.length, 1); assert.equal(r.notices.sent, 1);
  closeTick(cenv(), { now: x.clock.t + 3600000 }); assert.equal(x.tele.sent.length - n0, 1); assert.match(x.tele.sent.at(-1).text, /^\[TEST\] RICH300 · .* 마감 평가액 미입력/);
  x.advance(24 * 3600000); x.poll(60000); assert.equal(x.state().finalSent, true);
  const fin = x.texts().filter(t => t.includes('LIVE 최종 결과')); assert.equal(fin.length >= 1, true); const items = Object.fromEntries(liveReportNow(x.env, x.io, x.state()).map(i => [i.id, i]));
  assert.deepEqual(['E12', 'H1', 'D1', 'D2', 'D3', 'D4', 'D5'].map(k => items[k].status), Array(7).fill('PASS'), JSON.stringify(['E12', 'H1', 'D1'].map(k => items[k].text))); const sum = liveSummary(Object.values(items)); assert.equal(sum.fail, 0); assert.equal(sum.wait, 0); assert.equal(sum.verdict, 'PASS');
  x.poll(60000); assert.equal(x.texts().filter(t => t.includes('LIVE 최종 결과')).length, fin.length);                          // 최종 결과는 한 번만
});
test('안전 중단 규칙: 환경·토큰·할당량·무결성·연속 오류·긴 실행·느린 실행·예산·발송 폭주·시간 종료 각각 중단, 정상은 계속', () => {
  const base = { env: 'test', prodApproved: false, stats: { runs: 100, totalMs: 100 * 900, maxMs: 1500, slow: 0 }, intervalMin: 1, now: 1000, startedAt: 0, errStreak: 0, authError: false, quotaHit: false, sentToday: 5, integrityBad: false };
  assert.deepEqual(liveSafety(base), { halt: false });
  const cases = [[{ env: 'prod' }, 'env-guard'], [{ prodApproved: true }, 'env-guard'], [{ authError: true }, 'bot-token-invalid'], [{ quotaHit: true }, 'quota-exceeded'], [{ integrityBad: true }, 'integrity'], [{ errStreak: 15 }, 'poll-errors'],
    [{ stats: { ...base.stats, maxMs: 130000 } }, 'run-too-long'], [{ stats: { ...base.stats, slow: 3 } }, 'slow-runs'], [{ stats: { runs: 40, totalMs: 40 * 3000, maxMs: 4000, slow: 0 } }, 'runtime-budget'], [{ sentToday: 301 }, 'message-flood'], [{ now: LIVE_LIMITS.windowMs + 1 }, 'window-ended']];
  for (const [over, reason] of cases) { const v = liveSafety({ ...base, ...over }); assert.equal(v.halt, true, reason); assert.equal(v.reason, reason); assert.equal(v.graceful === true, reason === 'window-ended'); }
  assert.equal(liveSafety({ ...base, errStreak: 14 }).halt, false); assert.equal(liveSafety({ ...base, stats: { runs: 29, totalMs: 29 * 5000, maxMs: 6000, slow: 0 } }).halt, false);              // 표본이 적으면 예산 판단 보류
  assert.deepEqual([liveChooseInterval(1000).minutes, liveChooseInterval(2400).minutes, liveChooseInterval(15000).minutes], [1, 5, null]); assert.equal(liveProjectDailyMin(1000, 1), 30); assert.equal(liveProjectDailyMin(1000, 5), 10.8);
});
test('안전 중단 실행: 중단되면 트리거 제거·상태 기록·[TEST] 알림, 이후 마법사는 멈추고 데이터는 그대로', () => {
  for (const [name, setup] of [['토큰 오류', x => x.tele.fail('getUpdates', [{ status: 401, body: { ok: false } }])], ['긴 실행', x => { x.stats.maxMs = 130000; }]]) {
    const x = rig(); x.start(); pairUser(x); const rows0 = JSON.stringify([...x.mem.sheets.keys()]); const n0 = x.tele.sent.length; setup(x); const { r } = x.poll(); assert.equal(r.halted, true, name); assert.equal(x.removed, 1); assert.equal(x.state().phase, 'halted'); assert.ok(x.halted.reason);
    if (name === '긴 실행') { assert.match(x.tele.sent.at(-1).text, /^\[TEST\] 자동 중단: .*트리거를 제거/); } assert.equal(JSON.stringify([...x.mem.sheets.keys()]), rows0); const n1 = x.tele.sent.length; x.poll(); x.poll(); assert.ok(x.tele.sent.length - n1 <= 0); void n0;
  }
  const w = rig(); w.start(); pairUser(w); w.advance(LIVE_LIMITS.windowMs); w.stats.since = w.state().startedAt; const { r } = w.poll(); assert.equal(r.halted, true); assert.equal(w.halted.reason, 'window-ended'); assert.ok(w.texts().some(t => t.includes('LIVE 최종 결과')) && w.texts().at(-1).includes('시험 시간이 끝나'));
  const g = rig(); g.start(); pairUser(g); g.io.envName = () => 'prod'; assert.equal(g.poll().r.reason, 'env-guard');
});
test('결과 요약: PASS/FAIL/WAIT/WARN/SKIP 집계·판정, 4096자 한도 안에서 분할, 값 없음', () => {
  const x = rig(); x.start(); const items = liveBuildReport(x.env, { now: x.clock.t, auto: [{ id: 'A1', status: 'FAIL', text: 'x' }], stats: {}, counters: {}, halt: null, intervalMin: 1 });
  const s = liveSummary(items); assert.equal(s.verdict, 'FAIL'); assert.ok(s.wait > 5 && s.skip >= 3);
  const long = Array.from({ length: 80 }, (_, i) => ({ id: `Z${i}`, status: 'PASS', text: '가'.repeat(100) })); const texts = liveReportTexts(long); assert.ok(texts.length >= 3 && texts.every(t => t.length <= 4000)); assert.match(texts[0], /^LIVE 결과: PASS — PASS 80/);
  assert.ok(!/AAF|@[a-z]|docs\.google/.test(JSON.stringify(items)));
  const e11 = (ct, hours) => { const y = rig(); y.start(); return Object.fromEntries(liveBuildReport(y.env, { now: y.clock.t + hours * 3600000, auto: [], stats: { since: y.clock.t }, counters: ct, halt: null, intervalMin: 1 }).map(i => [i.id, i])).E11.status; };
  assert.deepEqual([e11({}, 1), e11({ 'ui-owner-ok': 1 }, 1), e11({ 'ui-owner-ok': 1, 'ui-denied-anon': 1 }, 1), e11({ 'ui-owner-ok': 2, 'ui-denied-other': 1 }, 1), e11({ 'ui-denied-anon': 2 }, 1), e11({ 'ui-denied-anon': 2 }, 30)], ['WAIT', 'WAIT', 'WARN', 'PASS', 'WARN', 'FAIL']);
});
test('봇 확인: 이름에 test 가 없으면 거부(운영 봇 토큰 실수 방지), 웹훅이 있으면 제거, 토큰 오류는 token-rejected, 토큰 문자열은 결과에 없음', () => {
  const ok = rig(); assert.deepEqual(liveBotCheck(ok.env), { ok: true, username: 'rich300_test_bot', webhookRemoved: false });
  const wh = rig(); wh.tele.webhookUrl = 'https://hook.example'; assert.deepEqual(liveBotCheck(wh.env), { ok: true, username: 'rich300_test_bot', webhookRemoved: true }); assert.equal(wh.tele.webhookUrl, '');
  const prod = rig(); prod.tele.botUsername = 'rich300_alerts_bot'; assert.deepEqual(liveBotCheck(prod.env), { ok: false, reason: 'not-test-bot' }); assert.ok(!prod.tele.calls.some(c => c.method === 'sendMessage'));
  const bad = rig(); bad.tele.fail('getMe', [{ status: 401, body: { ok: false } }]); assert.deepEqual(liveBotCheck(bad.env), { ok: false, reason: 'token-rejected' }); assert.ok(!JSON.stringify([ok, wh, prod, bad].map(r => r.tele.calls)).includes(FAKE_TOKEN));
});
