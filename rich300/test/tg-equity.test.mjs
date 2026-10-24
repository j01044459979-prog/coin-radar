import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTg, OWNER, STRANGER } from './helpers/faketg.mjs';
import { tgPoll, tgPairCreate } from '../lib/tg.mjs';
import { storeSetupChallenge, storeList, storeGet, storeCreate } from '../lib/store.mjs';
import { closeRun } from '../lib/close.mjs';
import { kstDayOf, addDays, dayStartMs } from '../lib/time.mjs';

function setup() {
  const x = makeTg(), today = kstDayOf(x.clock.t), start = addDays(today, -3);
  storeSetupChallenge(x.mem.env, { startEquity: '300', startDay: start, rate: '0.05' }, { actor: 't' });
  const { code } = tgPairCreate(x.env); x.tele.say(OWNER, `/pair ${code}`); tgPoll(x.env); closeRun(x.env);    // start, start+1, start+2 마감(어제까지)
  return { ...x, today, start, yesterday: addDays(today, -1) };
}
const say = (x, t, from = OWNER) => { x.tele.say(from, t); return tgPoll(x.env); };
const eq = x => storeList(x.mem.env, 'equity').map(r => r.data);
const save = x => { const m = x.tele.sent.at(-1); x.tele.click(OWNER, m, m.reply_markup.inline_keyboard[0][0].callback_data); return tgPoll(x.env); };

test('/equity: 기본 날짜=평가액 없는 가장 최근 마감일, 저장 전에는 기록 없음, 저장하면 차이만 표시하고 손익에는 반영하지 않음', () => {
  const x = setup(); assert.deepEqual(storeList(x.mem.env, 'dayclose').map(r => r.data.day), [x.start, addDays(x.start, 1), addDays(x.start, 2)]);
  say(x, '/equity 305'); const m = x.tele.sent.at(-1); assert.match(m.text, new RegExp(`평가액 입력 · ${x.yesterday}\\n실제 계좌 평가액 305 USDT`)); assert.equal(eq(x).length, 0);
  save(x); assert.deepEqual(eq(x).map(e => [e.day, e.equity, e.late]), [[x.yesterday, '305', true]]);                       // 마감 이후 입력 → late
  const e = x.tele.edits.at(-1); assert.match(e.text, /저장됨 ✓ · .* 평가액 305 USDT \(마감 후 입력\)/); assert.match(e.text, /장부 기준 300\.00 · 차이 \+5\.00/); assert.equal(x.tele.answers.at(-1).text, '저장했습니다');
  assert.equal(storeList(x.mem.env, 'adjustment').length, 0); assert.equal(storeList(x.mem.env, 'cashflow').length, 0);       // 자동 보정 없음
  say(x, '/equity 306'); assert.match(x.tele.sent.at(-1).text, new RegExp(addDays(x.yesterday, -1)));                         // 다음 기본값은 그 전날(아직 입력 없는 마감일)
});
test('/equity: 날짜 지정·unrealized·수정 이력·같은 값 unchanged·재클릭 1건·취소·만료', () => {
  const x = setup(), d = addDays(x.start, 1);
  say(x, `/equity 301.5 ${d} unrealized=1.5`); save(x); assert.deepEqual(eq(x).map(e => [e.day, e.equity, e.unrealized]), [[d, '301.5', '1.5']]);
  const m = x.tele.sent.at(-1); x.tele.click(OWNER, m, m.reply_markup.inline_keyboard[0][0].callback_data); tgPoll(x.env); assert.equal(eq(x).length, 1); assert.equal(storeGet(x.mem.env, 'equity', d).rev, 1);     // 재클릭: 변화 없음
  say(x, `/equity 301.5 ${d} unrealized=1.5`); save(x); assert.match(x.tele.edits.at(-1).text, /^이미 같은 값/); assert.equal(storeGet(x.mem.env, 'equity', d).rev, 1);
  say(x, `/equity 310 ${d}`); save(x); assert.equal(storeGet(x.mem.env, 'equity', d).rev, 2); assert.equal(eq(x)[0].equity, '310'); assert.equal(eq(x)[0].unrealized, undefined);
  const h = storeList(x.mem.env, 'equity', {})[0]; assert.ok(h); const hist = x.mem.sheets.get('Audit').filter(r => r[2] === 'equity' && r[3] === d); assert.deepEqual(hist.map(r => [r[4], r[5], r[7]]), [['1', 'create', ''], ['2', 'revise', 'Telegram 입력']]);
  say(x, `/equity 999 ${d}`); const c = x.tele.sent.at(-1); x.tele.click(OWNER, c, c.reply_markup.inline_keyboard[0][1].callback_data); tgPoll(x.env); assert.equal(eq(x)[0].equity, '310'); assert.equal(x.tele.edits.at(-1).text, '취소됨');
  say(x, `/equity 998 ${d}`); x.advance(11 * 60000); save(x); assert.equal(eq(x)[0].equity, '310');
});
test('/equity: 형식 오류·미래 날짜·시작 전 날짜·비페어링은 초안 없이 안내하거나 무응답', () => {
  const x = setup(), n0 = () => [...x.kv.map.keys()].filter(k => k.startsWith('d:')).length;
  for (const [line, re] of [['/equity', /사용법/], ['/equity abc', /평가액/], ['/equity -5', /평가액/], ['/equity 300 2026-13-40', /날짜 형식/], ['/equity 300 notaday', /날짜 형식/]]) { say(x, line); assert.match(x.tele.sent.at(-1).text, re, line); }
  assert.equal(n0(), 0);
  say(x, `/equity 300 ${addDays(x.today, 2)}`); assert.match(x.tele.sent.at(-1).text, /⚠ 미래 날짜에는 입력할 수 없습니다/); assert.equal(n0(), 0);
  say(x, `/equity 300 ${addDays(x.start, -1)}`); assert.match(x.tele.sent.at(-1).text, /⚠ 챌린지 시작일 이전/); assert.equal(n0(), 0); assert.equal(eq(x).length, 0);
  say(x, `/equity 300 ${x.yesterday}`); const m = x.tele.sent.at(-1); x.advance(2 * 86400000);          // 초안은 10분 만료이므로 만료 전에 날짜 상태가 바뀌는 경우는 재현 불가 → 직접 초안을 만들어 확인
  const id = [...x.kv.map.keys()].find(k => k.startsWith('d:')); const d = JSON.parse(x.kv.get(id)); d.v.equity.day = addDays(x.today, 9); d.exp = 0; x.kv.put(id, JSON.stringify(d));
  x.tele.click(OWNER, m, m.reply_markup.inline_keyboard[0][0].callback_data); const r = tgPoll(x.env); assert.equal(r.retry, 0); assert.equal(eq(x).length, 0); assert.match(x.tele.edits.at(-1).text, /⚠ 미래 날짜/);
  const sent = x.tele.sent.length; say(x, '/equity 300', STRANGER); assert.equal(x.tele.sent.length, sent); assert.equal(eq(x).length, 0);
});
test('/help에 /equity 안내, 챌린지가 없으면 /equity는 초안 없이 안내만', () => {
  const x = makeTg(); const { code } = tgPairCreate(x.env); x.tele.say(OWNER, `/pair ${code}`); tgPoll(x.env); say(x, '/help'); assert.match(x.tele.sent.at(-1).text, /\/equity 금액/);
  say(x, '/equity 300'); assert.match(x.tele.sent.at(-1).text, /⚠ 챌린지 설정 없음/); assert.equal([...x.kv.map.keys()].filter(k => k.startsWith('d:')).length, 0); assert.equal(storeList(x.mem.env, 'equity').length, 0);
});
