// 시험 하니스 마법사 테스트용 장비(가짜 Telegram + 가짜 휴대폰 사용자).
import assert from 'node:assert/strict';
import { makeTg, OWNER } from './faketg.mjs';
import { tgPoll, tgPairCreate, tgSubmitFillForm } from '../../lib/tg.mjs';
import { storeList, storeCreate } from '../../lib/store.mjs';
import { journalReviseFill, journalAddCashflow } from '../../lib/journal.mjs';
import { kstDayOf, dayStartMs } from '../../lib/time.mjs';
import { liveInit, liveGet, liveOnCallback } from '../../lib/livewizard.mjs';
import { liveHookRun } from '../../lib/livehook.mjs';

export const btn = (msg, part) => { for (const row of msg.reply_markup.inline_keyboard) for (const b of row) if (b.text.includes(part)) return b; throw new Error(`버튼 없음: ${part}`); };
export function rig({ uiUrl = 'https://example.com/exec', startAtMidday = true } = {}) {
  const x = makeTg({ uiUrl: uiUrl ?? undefined }); x.env.msgPrefix = '[TEST] '; x.env.live = { onCallback: liveOnCallback };
  if (startAtMidday) x.clock.t = dayStartMs(kstDayOf(x.clock.t)) + 14 * 3600000;                         // 14:00 KST
  x.notifyEnabled = false; x.env.enableTestNotify = () => { x.notifyEnabled = true; storeCreate(x.mem.env, 'setting', { name: 'closeNotify', value: 'on' }, { actor: 't' }); };
  x.stats = { since: x.clock.t, runs: 0, totalMs: 0, maxMs: 0, slow: 0, busy: 0, gaps90: 0, maxGap: 0, retry: 0 }; x.ct = {}; x.removed = 0; x.halted = null;
  x.io = { stats: () => x.stats, counters: () => x.ct, envName: () => 'test', prodApproved: () => false, removeTriggers: () => { x.removed++; }, saveHalt: o => { x.halted = o; }, auto: () => ['A1','A2','A3','A4','B1','B2','C1','C2','C3','C4','C5','G1','G2','G3','G4','G5','G6','G7'].map(id => ({ id, status: 'PASS', text: 'ok' })), halt: () => x.halted };
  x.start = () => liveInit(x.env, { bot: 'rich300_test_bot', intervalMin: 1, now: x.clock.t });
  const adv0 = x.advance; x.advance = ms => { adv0(ms); const n = Math.floor(ms / 60000); x.stats.runs += n; x.stats.totalMs += 900 * n; };      // 1분 트리거가 흘러간 시간만큼 실행된 것으로 본다
  x.poll = (adv = 60000) => { x.advance(adv); const out = tgPoll(x.env); x.stats.maxMs = Math.max(x.stats.maxMs, 900); const r = liveHookRun(x.env, out, x.io); return { out, r }; };
  x.state = () => liveGet(x.env); x.sid = () => x.state().sid;
  x.rows = e => storeList(x.mem.env, e).map(r => r.data); x.texts = () => x.tele.texts();
  x.tap = (msg, label) => { x.tele.click(OWNER, msg, btn(msg, label).callback_data); return x.poll(); };
  x.lastWith = text => [...x.tele.sent].reverse().find(m => m.text.includes(text));
  return x;
}
export function pairUser(x) { const { code } = tgPairCreate(x.env); x.tele.say(OWNER, `/start ${code}`, { date: Math.floor(x.clock.t / 1000) - 7 }); return x.poll(); }
export function runWizard(x) {                                   // 휴대폰 사용자를 흉내 내어 10단계를 끝까지
  pairUser(x); const sid = x.sid(), sig = x.lastWith('🔔');
  x.tap(sig, '진입했어'); x.tele.click(OWNER, sig, 'r1:' + sid + ':e'); x.poll();                              // 연타
  for (const [label, key] of [['진입 기록 만들기', 'fill'], ['같은 입력 다시 만들기', 'fill2'], ['부분 청산 만들기', 'exit1']]) { const g = x.lastWith('/') && [...x.tele.sent].reverse().find(m => m.reply_markup && m.reply_markup.inline_keyboard.flat().some(b => b.text.includes(label))); x.tap(g, label); const d = [...x.tele.sent].reverse().find(m => m.reply_markup && m.reply_markup.inline_keyboard[0][0].callback_data.startsWith('f1:')); x.tap(d, '저장'); void key; }
  tgSubmitFillForm(x.env, { kind: 'exit', sid, price: '101', formId: 'webform1' }); const dup = tgSubmitFillForm(x.env, { kind: 'exit', sid, price: '101', formId: 'webform1' }); assert.equal(dup.status, 'duplicate'); x.ct['form-duplicate'] = 1; x.poll(150000);
  const rv = x.lastWith('복기 · '); x.tap(rv, '저장');
  const eqb = [...x.tele.sent].reverse().find(m => m.reply_markup && m.reply_markup.inline_keyboard.flat().some(b => b.text.includes('평가액 입력 만들기'))); x.tap(eqb, '평가액 입력 만들기'); const ed = [...x.tele.sent].reverse().find(m => m.text.includes('평가액 입력 ·') && m.reply_markup); x.tap(ed, '저장');
  const fills = x.rows('fill').filter(f => f.sid === sid), close = fills.find(f => f.kind === 'close'); journalReviseFill(x.env, close.fillId, { price: '102' }, { reason: '시험' }); x.poll(150000);
  journalAddCashflow(x.env, { cfId: 'abc12345', amount: '1', note: '시험' }); x.poll(150000);
  x.ct['ui-owner-ok'] = 3; x.ct['ui-denied-other'] = 1; x.ct['ui-denied-anon'] = 1;
  const exp = [...x.tele.sent].reverse().find(m => m.text.includes('진입 LONG') && m.reply_markup && m.reply_markup.inline_keyboard[0][0].callback_data.startsWith('f1:')); x.advance(11 * 60000); x.tap(exp, '저장');
  return sid;
}

