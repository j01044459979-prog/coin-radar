// R9: COIN RADAR 추천 메시지의 버튼 → RICH 300 신호·응답·체결 기록. 가짜 Telegram·메모리 시트만 사용(실제 호출 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTg, OWNER, STRANGER } from './helpers/faketg.mjs';
import { tgPoll, tgPairCreate, tgSubmitFillForm, tgParseAt } from '../lib/tg.mjs';
import { r9ParseSignal, r9StripLine } from '../lib/r9.mjs';
import { storeList } from '../lib/store.mjs';
import { pnlComputeTrade } from '../lib/pnl.mjs';
import { r9Line, r9Tail } from '../../radar-service/signal/rich300.mjs';
import { dayStartMs, kstDayOf, addDays } from '../lib/time.mjs';

const T0 = 1790000000000, D1 = addDays(kstDayOf(T0), -1), D0 = kstDayOf(T0);
const EV = { dir: 'LONG', entry: 3012.5, stop: 2980, t1: { price: 3075 }, t2: { price: 3120 }, triggerT: T0 - 600000, score: 72 };
const RADAR_TEXT = `🟢 ETH · LONG · 진입 후보\n💰 진입 관심가 3012.5\n🛑 손절 기준 2980.0${r9Tail('ETHUSDT', EV).plain}`;
const SID = r9Tail('ETHUSDT', EV).sid;
function setup() { const x = makeTg({ uiUrl: 'https://script.google.com/macros/s/X/exec' }); const { code } = tgPairCreate(x.env); x.tele.say(OWNER, `/pair ${code}`); tgPoll(x.env); x.tele.sent.length = 0; return x; }
const rows = (x, e) => storeList(x.mem.env, e).map(r => r.data).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
const radarMsg = x => ({ message_id: 9000 + x.tele.nextMsg++, chat_id: OWNER });
const press = (x, act, o = {}) => { x.tele.click(o.from ?? OWNER, o.msg ?? radarMsg(x), `r1:${o.sid ?? SID}:${act}`, { text: RADAR_TEXT, ...o }); return tgPoll(x.env); };

test('계약: radar가 만든 R9 줄을 앱이 그대로 읽는다(전략·점수·2차 목표 없음 포함)', () => {
  const s = r9ParseSignal(RADAR_TEXT); assert.deepEqual(s, { sid: SID, symbolId: 'ETHUSDT', dir: 'LONG', entry: '3012.5', stop: '2980', tp1: '3075', tp2: '3120', strategy: 'S', score: 72, signalAt: EV.triggerT });
  const no2 = r9ParseSignal(r9Line('BTCUSDT', { ...EV, t2: null, score: null, dir: 'SHORT' })); assert.equal(no2.tp2, undefined); assert.equal(no2.score, undefined); assert.equal(no2.dir, 'SHORT');
  assert.equal(r9ParseSignal('아무 글'), null); assert.equal(r9ParseSignal(RADAR_TEXT.replace('v1', 'v2')), null); assert.equal(r9ParseSignal(RADAR_TEXT.replace('ETHUSDT LONG', 'ETHUSDT BUY')), null);
  const shown = r9StripLine(RADAR_TEXT); assert.ok(!/R9 v1/.test(shown)); assert.ok(shown.includes('🆔 ' + SID)); assert.ok(shown.includes('진입 관심가'));
});
test('[진입했어]: 신호·응답이 저장되고 메시지는 결과로 바뀌며 입력 화면 링크가 온다(기계 줄은 숨김)', () => {
  const x = setup(); const r = press(x, 'e');
  assert.equal(r.handled, 1); const sg = rows(x, 'signal'); assert.equal(sg.length, 1);
  assert.deepEqual({ ...sg[0] }, { sid: SID, strategy: 'S', symbolId: 'ETHUSDT', dir: 'LONG', signalAt: EV.triggerT, entry: '3012.5', stop: '2980', tp1: '3075', tp2: '3120', score: 72 });
  assert.deepEqual(rows(x, 'response').map(r => [r.sid, r.choice]), [[SID, 'entered']]); assert.equal(rows(x, 'fill').length, 0);
  const ed = x.tele.edits[0]; assert.match(ed.text, /→ 진입했어/); assert.ok(!/R9 v1/.test(ed.text)); assert.deepEqual(ed.reply_markup, { inline_keyboard: [] });
  const link = x.tele.last().reply_markup.inline_keyboard[0][0].url; assert.ok(link.includes(`sid=${SID}`) && link.includes('entry=3012.5'));
});
test('[관망했어]·[놓쳤어]: 추천 기록에만 남고 체결·손익에는 들어가지 않는다', () => {
  for (const [act, ch] of [['w', 'watched'], ['m', 'missed']]) {
    const x = setup(); press(x, act); assert.deepEqual(rows(x, 'response').map(r => r.choice), [ch]); assert.equal(rows(x, 'fill').length, 0); assert.equal(x.tele.sent.length, 0);
  }
});
test('중복 클릭·다른 버튼 재클릭·같은 callback 재전달: 신호 1건·응답 1건, 처음 응답을 유지한다', () => {
  const x = setup(); const msg = radarMsg(x);
  press(x, 'e', { msg, cbId: 'same' }); press(x, 'e', { msg, cbId: 'same' }); press(x, 'e', { msg, cbId: 'other' }); press(x, 'w', { msg });
  assert.equal(rows(x, 'signal').length, 1); assert.deepEqual(rows(x, 'response').map(r => r.choice), ['entered']);
  assert.equal(x.tele.sent.filter(m => /진입 기록/.test(m.text)).length, 1);                          // 입력 안내도 한 번만
});
test('거부: 낯선 사용자·sid 불일치·값이 잘못된 줄은 아무것도 저장하지 않는다', () => {
  const x = setup(); x.tele.click(STRANGER, radarMsg(x), `r1:${SID}:e`, { text: RADAR_TEXT }); tgPoll(x.env); assert.equal(rows(x, 'signal').length, 0);
  press(x, 'e', { sid: 'SG-OTHER-L-1' }); assert.equal(rows(x, 'signal').length, 0); assert.match(x.tele.answers.at(-1).text, /알 수 없는 신호/);
  press(x, 'e', { text: RADAR_TEXT.replace(/ 2980 /, ' 0 ') }); assert.equal(rows(x, 'signal').length, 0); press(x, 'e', { text: '일반 메시지' }); assert.equal(rows(x, 'signal').length, 0);
  assert.equal(rows(x, 'response').length, 0);
});
test('사진 추천 메시지: 설명(caption)을 읽고 editMessageCaption 으로 결과를 표시한다', () => {
  const x = setup(); x.tele.click(OWNER, radarMsg(x), `r1:${SID}:e`, { caption: RADAR_TEXT, photo: true }); tgPoll(x.env);
  assert.equal(rows(x, 'signal').length, 1); const ed = x.tele.edits[0]; assert.equal(ed.viaCaption, true); assert.match(ed.text, /→ 진입했어/);
  assert.ok(x.tele.calls.every(c => c.method !== 'editMessageText'));
});
test('같은 신호가 재전송돼도 신호는 처음 저장된 값 그대로(불변), 응답만 새로 가능', () => {
  const x = setup(); press(x, 'w'); const first = JSON.stringify(rows(x, 'signal')[0]);
  press(x, 'e', { text: RADAR_TEXT.replace(' 3012.5 ', ' 9999 ') }); assert.equal(JSON.stringify(rows(x, 'signal')[0]), first); assert.equal(rows(x, 'signal').length, 1);
});

// ── 체결 입력(시각·비율·메모·손절 선택) ──
const form = (o) => ({ formId: o.formId ?? Math.random().toString(36).slice(2, 12), sid: SID, ...o });
function entered(x, extra = {}) {
  press(x, 'e'); x.env.now = () => x.clock.t;
  return tgSubmitFillForm(x.env, form({ kind: 'entry', margin: '30', leverage: '10', entry: '3012.5', stop: '2980', ...extra }));
}
test('입력 화면: 실제 진입(수량 직접·시각 지정·손절 없음)과 추천가 구분 저장', () => {
  const x = setup(); const at = `${D1} 14:30`, r = entered(x, { qty: '0.1', entry: '3010', stop: '', at });
  assert.equal(r.ok, true, JSON.stringify(r)); const f = rows(x, 'fill')[0]; assert.equal(f.price, '3010'); assert.equal(f.qty, '0.1'); assert.equal(f.plannedStop, undefined); assert.equal(f.at, dayStartMs(D1) + (14 * 60 + 30) * 60000);
  assert.equal(rows(x, 'signal')[0].entry, '3012.5');                                              // 추천가는 신호에, 체결가는 체결에 따로
  assert.match(r.summary, /손절 미입력/);
});
test('부분 청산 여러 번: 비율(50%)·수량·시각·메모, 마지막은 전량 — 손익은 방향·수량·수수료·펀딩 반영', () => {
  const x = setup(); entered(x, { qty: '1', at: `${D1} 09:00` });
  const a = tgSubmitFillForm(x.env, form({ kind: 'exit', price: '3100', qty: '50%', fee: '0.5', funding: '-0.1', at: `${D1} 10:00` })); assert.equal(a.ok, true, JSON.stringify(a)); assert.match(a.summary, /부분 청산/);
  const b = tgSubmitFillForm(x.env, form({ kind: 'exit', price: '3050', qty: '0.25', at: `${D1} 11:00` })); assert.equal(b.ok, true);
  const c = tgSubmitFillForm(x.env, form({ kind: 'exit', price: '3000', qty: '100%', fee: '0.3', at: `${D1} 12:00`, note: '손절 라인 근처에서 정리' })); assert.equal(c.ok, true); assert.match(c.summary, /전량 청산/); assert.match(c.summary, /메모/);
  const fl = rows(x, 'fill'); assert.deepEqual(fl.map(f => [f.kind, f.qty]), [['entry', '1'], ['reduce', '0.5'], ['reduce', '0.25'], ['close', '0.25']]); assert.equal(fl[3].note, '손절 라인 근처에서 정리');
  const tr = pnlComputeTrade(fl);   // LONG: 0.5×87.5 + 0.25×37.5 + 0.25×(−12.5) = 50.0, 입력된 수수료 0.8·펀딩 −0.1 → 49.1
  assert.equal(tr.status, 'closed'); assert.equal(tr.totals.netEnteredMicro, 49100000n);
});
test('청산 입력 오류: 비율 범위·시각 순서·미래 시각·잔량 초과는 저장하지 않는다', () => {
  const x = setup(); entered(x, { qty: '1', at: `${D1} 09:00` }); const n0 = rows(x, 'fill').length;
  for (const bad of [{ qty: '0%' }, { qty: '101%' }, { qty: '2' }, { at: `${D1} 08:00` }, { at: '2999-01-01 10:00' }, { at: '25:99' }, { at: 'abc' }])
    { const r = tgSubmitFillForm(x.env, form({ kind: 'exit', price: '3100', ...bad })); assert.equal(r.ok, false, JSON.stringify(bad)); }
  assert.equal(rows(x, 'fill').length, n0);
});
test('중복 방지: 같은 formId 재제출·더블탭은 1건, 같은 값의 다른 폼도 10분 안에는 거절', () => {
  const x = setup(); entered(x, { qty: '1', at: `${D1} 09:00` }); const id = 'dup123', mk = () => form({ kind: 'exit', formId: id, price: '3100', qty: '0.4', at: `${D1} 10:00` });
  const a = tgSubmitFillForm(x.env, mk()), b = tgSubmitFillForm(x.env, mk()); assert.equal(a.ok, true); assert.equal(b.status, 'duplicate'); assert.equal(rows(x, 'fill').filter(f => f.kind === 'reduce').length, 1);
});
test('/exit 명령: at=·memo=·50% 도 같은 검증을 거친다', () => {
  const x = setup(); entered(x, { qty: '1', at: `${D1} 09:00` }); x.tele.say(OWNER, `/exit ${SID} 3100 50% at=${D1}_10:00 memo=익절_후_관망`); tgPoll(x.env);
  const m = x.tele.last(); assert.match(m.text, /부분 청산/); assert.match(m.text, /메모: 익절 후 관망/); const save = m.reply_markup.inline_keyboard[0][0].callback_data; x.tele.click(OWNER, m, save); tgPoll(x.env);
  assert.deepEqual(rows(x, 'fill').map(f => f.kind), ['entry', 'reduce']); assert.equal(rows(x, 'fill')[1].qty, '0.5');
});
test('tgParseAt: HH:mm·MM-DD HH:mm·전체 형식, 미래·잘못된 값 거부', () => {
  const now = dayStartMs('2026-10-24') + 15 * 3600000;
  assert.equal(tgParseAt('14:30', now), dayStartMs('2026-10-24') + 14.5 * 3600000); assert.equal(tgParseAt('16:00', now), dayStartMs('2026-10-23') + 16 * 3600000);
  assert.equal(tgParseAt('10-23 08:05', now), dayStartMs('2026-10-23') + (8 * 60 + 5) * 60000); assert.equal(tgParseAt('2026-10-24T09:00', now), dayStartMs('2026-10-24') + 9 * 3600000); assert.equal(tgParseAt('', now), undefined);
  for (const b of ['25:00', '12:60', '2026-10-25 10:00', 'x', '10-24', '2026-13-01 10:00']) assert.throws(() => tgParseAt(b, now), b);
});
