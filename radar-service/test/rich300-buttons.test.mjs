// RICH 300 연동(R9) 테스트. 데이터는 합성이며 네트워크·Telegram은 모의다(실제 호출 금지).
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSignal } from '../signal/evaluate.mjs';
import { signalStep } from '../signal/step.mjs';
import { candidateMessage } from '../signal/message.mjs';
import { signalCaption } from '../signal/chart.mjs';
import { r9Enabled, r9Sid, r9Line, r9Decorate, r9Keyboard } from '../signal/rich300.mjs';
import { telegramSender, telegramPhotoSender } from '../service.mjs';
import { NOW, mkA, mirrorA, mk15, mirror15, sender, store, collectors, oppState } from './signal-fixture.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const OPT = { minRR: 1.5, validMin: 45 };
const evL = () => evaluateSignal({ a: mkA(), c15: mk15(), now: NOW }, OPT), evS = () => evaluateSignal({ a: mirrorA(mkA()), c15: mirror15(mk15()), now: NOW }, OPT);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const mk = (env, o = {}) => { const st = { ...oppState() }, sd = sender(), sv = store(); return { st, sd, args: { now: NOW, state: st, env: { RADAR_SIGNAL: 'on', ...env }, send: sd.send, save: sv.save, analyze: () => mkA(), ...collectors({ c15: mk15() }), ...o } }; };

test('플래그: RADAR_RICH300_BUTTONS=on 일 때만 켜진다(기본·오타·빈 값은 off)', () => {
  assert.equal(r9Enabled({ RADAR_RICH300_BUTTONS: 'on' }), true); assert.equal(r9Enabled({ RADAR_RICH300_BUTTONS: ' ON ' }), true);
  for (const v of [undefined, '', 'off', 'true', '1', 'yes']) assert.equal(r9Enabled({ RADAR_RICH300_BUTTONS: v }), false);
  assert.equal(r9Enabled({}), false);
});
test('기본 off: 후보 메시지가 한 글자도 달라지지 않고 버튼 인자도 전달되지 않는다', async () => {
  const ev = evL(), base = candidateMessage('ETHUSDT', ev, { now: NOW });
  assert.equal(r9Decorate(base, 'ETHUSDT', ev, {}), base); assert.equal(r9Decorate(base, 'ETHUSDT', ev, { RADAR_RICH300_BUTTONS: 'off' }), base);
  const r = mk({}); const out = await signalStep(r.args);
  assert.equal(out.sentMessages, 1); assert.equal(r.sd.sent[0].text, base.text); assert.deepEqual(r.sd.sent[0].opt, { html: true }); assert.ok(!/R9 v1|🆔/.test(r.sd.sent[0].text));
});
test('고유 ID: 코인·방향·트리거 시각으로 결정적이고 callback_data 한도(64바이트) 안', () => {
  const ev = evL(), sid = r9Sid('ETHUSDT', ev); assert.match(sid, /^SG-ETH-L-[0-9a-z]+$/); assert.equal(r9Sid('ETHUSDT', evL()), sid);
  assert.match(r9Sid('ETHUSDT', evS()), /^SG-ETH-S-/); assert.notEqual(r9Sid('ETHUSDT', evS()), sid); assert.notEqual(r9Sid('BTCUSDT', ev), sid);
  for (const b of r9Keyboard(sid).inline_keyboard[0]) assert.ok(Buffer.byteLength(b.callback_data) <= 64, b.callback_data);
  assert.deepEqual(r9Keyboard(sid).inline_keyboard[0].map(b => b.text), ['진입했어', '관망했어', '놓쳤어']);
  assert.deepEqual(r9Keyboard(sid).inline_keyboard[0].map(b => b.callback_data.split(':')[2]), ['e', 'w', 'm']);
});
test('기계 줄: 신호 상세(코인·방향·진입·손절·1차·2차·전략·점수·시각)를 담고 값이 없으면 줄을 만들지 않는다', () => {
  const ev = evL(), f = r9Line('ETHUSDT', ev).split(' ');
  assert.deepEqual(f.slice(0, 2), ['R9', 'v1']); assert.equal(f[3], 'ETHUSDT'); assert.equal(f[4], 'LONG'); assert.equal(+f[5], ev.entry); assert.equal(+f[6], ev.stop); assert.equal(+f[7], ev.t1.price); assert.equal(f[9], 'S'); assert.equal(+f[11], ev.triggerT); assert.equal(f.length, 12);
  assert.equal(f[8], ev.t2 ? String(ev.t2.price) : '-');
  assert.equal(r9Line('ETHUSDT', { ...ev, entry: NaN }), null); assert.equal(r9Line('ETHUSDT', { ...ev, t1: null }), null); assert.equal(r9Line('eth', ev), null);
  assert.equal(r9Line('ETHUSDT', { ...ev, t2: null }).split(' ')[8], '-');
  assert.equal(r9Line('ETHUSDT', ev, { strategy: 'B' }).split(' ')[9], 'B');
  assert.equal(r9Line('ETHUSDT', { ...ev, entry: 0.00000123 }).split(' ')[5], '0.00000123');
});
test('on: 텍스트 후보에 버튼 3개·고유 ID·기계 줄이 붙고 기존 본문은 그대로다(HTML 안전)', async () => {
  const r = mk({ RADAR_RICH300_BUTTONS: 'on' }), base = candidateMessage('ETHUSDT', evL(), { now: NOW }); const out = await signalStep(r.args);
  assert.equal(out.sentMessages, 1); const m = r.sd.sent[0]; assert.ok(m.text.startsWith(base.text)); assert.match(m.text, /🆔 SG-ETH-L-/); assert.match(m.text, /<code>R9 v1 SG-ETH-L-[0-9a-z]+ ETHUSDT LONG /);
  assert.equal(m.opt.html, true); assert.equal(m.opt.markup.inline_keyboard[0].length, 3); assert.ok(m.text.length < 4000);
  assert.ok(base.plain && !/[<>]/.test(m.text.replace(/<\/?(b|code)>/g, '')));
});
test('on: 사진 알림은 설명 끝에 ID·기계 줄, 사진 전송에 버튼이 전달된다(텍스트는 따로 보내지 않음)', async () => {
  const photos = []; const sendPhoto = async (png, caption, o) => { photos.push({ png, caption, o }); };
  const r = mk({ RADAR_RICH300_BUTTONS: 'on' }, { sendPhoto, renderChart: async () => PNG }); const out = await signalStep(r.args);
  assert.equal(out.photoSent, 1); assert.equal(r.sd.sent.length, 0); const p = photos[0];
  assert.ok(p.caption.startsWith(signalCaption('ETHUSDT', evL()))); assert.match(p.caption, /\nR9 v1 SG-ETH-L-/); assert.ok([...p.caption].length <= 1024); assert.equal(p.o.markup.inline_keyboard[0].length, 3);
  const off = mk({}, { sendPhoto: async (...a) => { photos.push({ n: a.length }); }, renderChart: async () => PNG }); await signalStep(off.args); assert.equal(photos[1].n, 2);     // off: 호출 인자 수도 기존과 같다(png, caption)
});
test('on: 사진이 4xx로 거절되면 버튼 달린 텍스트로 대체, 재실행해도 같은 신호는 다시 나가지 않는다', async () => {
  const sendPhoto = async () => { throw Object.assign(new Error('bad'), { status: 400 }); };
  const r = mk({ RADAR_RICH300_BUTTONS: 'on' }, { sendPhoto, renderChart: async () => PNG }); const out = await signalStep(r.args);
  assert.equal(out.photoFallback, 1); assert.equal(r.sd.sent.length, 1); assert.equal(r.sd.sent[0].opt.markup.inline_keyboard[0].length, 3);
  await signalStep({ ...r.args, now: NOW + 16 * 60000 }); assert.equal(r.sd.sent.length, 1);
});
test('HTML 400 대체 전송에도 버튼이 유지된다', async () => {
  const calls = []; const send = async (text, o) => { calls.push({ text, o }); if (calls.length === 1) throw Object.assign(new Error('parse'), { status: 400 }); };
  const r = mk({ RADAR_RICH300_BUTTONS: 'on' }, { send }); await signalStep(r.args);
  assert.equal(calls.length, 2); assert.ok(calls[1].o.markup); assert.ok(!/<code>/.test(calls[1].text));
});
test('Telegram 어댑터: markup 은 reply_markup 으로만 나가고 토큰은 노출되지 않으며, 없으면 body 에 reply_markup 이 없다', async () => {
  const bodies = []; const fetcher = async (url, init) => { bodies.push({ url, body: init.body }); return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({ ok: true, result: { message_id: 1 } }), json: async () => ({ ok: true, result: { message_id: 1 } }) }; };
  const send = telegramSender('123:TOKEN', '1001', fetcher); await send('a', { markup: r9Keyboard('SG-X-L-1') }); await send('b');
  assert.match(bodies[0].body, /reply_markup/); assert.ok(!/reply_markup/.test(bodies[1].body)); assert.ok(!bodies.some(b => /TOKEN/.test(b.body)));
  const photo = telegramPhotoSender('123:TOKEN', '1001', fetcher); await photo(PNG, 'cap', { markup: r9Keyboard('SG-X-L-1') }); assert.equal(bodies[2].body.get('reply_markup').includes('r1:SG-X-L-1:e'), true);
  await photo(PNG, 'cap'); assert.equal(bodies[3].body.get('reply_markup'), null);
});
test('무효화 알림·off 모드는 버튼이 없다(진입 후보에만)', () => {
  const part = { kind: 'invalidated', text: 'x', plain: 'x', html: true }; assert.equal(r9Decorate(part, 'ETHUSDT', evL(), { RADAR_RICH300_BUTTONS: 'on' }), part);
});
