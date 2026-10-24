// 종단 간(오프라인): COIN RADAR 신호 메시지(실제 signalStep 산출물) → Telegram 버튼 → Apps Script 폴링 → 신호·응답 저장 → 입력 화면 제출(진입·부분 청산·전량 청산)
//  → 평가액 입력 → 웹앱 숫자 화면. 가짜 Telegram·가짜 Apps Script만 사용하며 실제 호출은 없다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { signalStep } from '../../radar-service/signal/step.mjs';
import { htmlToPlain } from '../../radar-service/format.mjs';
import { NOW, mkA, mk15, sender, store, collectors, oppState } from '../../radar-service/test/signal-fixture.mjs';
import { loadProd } from './helpers/gasprod.mjs';
import { OWNER, STRANGER } from './helpers/faketg.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const text = html => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ');

async function radarMessage({ photo = false } = {}) {
  const st = { ...oppState() }, sd = sender(), sv = store(), photos = [];
  const args = { now: NOW, state: st, env: { RADAR_SIGNAL: 'on', RADAR_RICH300_BUTTONS: 'on' }, send: sd.send, save: sv.save, analyze: () => mkA(), ...collectors({ c15: mk15() }),
    ...(photo ? { sendPhoto: async (png, caption, o) => { photos.push({ caption, markup: o && o.markup }); }, renderChart: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]) } : {}) };
  const out = await signalStep(args); assert.equal(out.sentMessages, 1);
  if (photo) return { text: photos[0].caption, markup: photos[0].markup, photo: true };
  return { text: htmlToPlain(sd.sent[0].text).replace(/<\/?code>/g, ''), markup: sd.sent[0].opt.markup, photo: false };              // Telegram 은 callback 에 태그 없는 본문을 돌려 준다
}
function world() {
  const g = loadProd({ props: { RICH300_PROD_APPROVED: 'yes' } }), r = g.ctx.rich300Install(); g.tele.say(OWNER, `/start ${r.pairLink.split('=')[1]}`); g.ctx.rich300TgPoll(); g.tele.sent.length = 0; return g;
}
const press = (g, msg, act, o = {}) => { const cb = msg.markup.inline_keyboard[0].find(b => b.callback_data.endsWith(`:${act}`)).callback_data; g.tele.click(o.from ?? OWNER, o.msgRef ?? { message_id: 7000, chat_id: OWNER }, cb, { ...(msg.photo ? { caption: msg.text, photo: true } : { text: msg.text }), ...o }); g.ctx.rich300TgPoll(); return cb; };

for (const photo of [false, true]) test(`종단 간(${photo ? '사진' : '텍스트'} 추천): 버튼 → 신호 저장 → 진입·부분·전량 청산 → 평가액 → 웹앱 숫자와 추천·성적 화면`, async () => {
  const g = world(), msg = await radarMessage({ photo }), sid = msg.markup.inline_keyboard[0][0].callback_data.split(':')[1];
  assert.match(sid, /^SG-ETH-L-/); assert.deepEqual(msg.markup.inline_keyboard[0].map(b => b.text), ['진입했어', '관망했어', '놓쳤어']);
  press(g, msg, 'e'); assert.equal(g.rows('signal').length, 1); assert.equal(g.rows('signal')[0].strategy, 'S'); assert.deepEqual(g.rows('response').map(r => r.choice), ['entered']);
  assert.ok(g.tele.edits.some(e => /→ 진입했어/.test(e.text) && !!e.viaCaption === photo)); assert.ok(g.tele.sent.some(m => /진입 기록/.test(m.text)));         // 입력 안내
  const sig = g.rows('signal')[0], t0 = 1790000000000 - 5 * 3600000, day = '2026-09-21';
  const submit = f => g.ctx.rich300FillSubmit({ sid, ...f });
  let r = submit({ kind: 'entry', formId: 'e1', margin: '30', leverage: '10', entry: String(sig.entry), qty: '0.1', stop: String(sig.stop), at: `${day}T00:30` }); assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(submit({ kind: 'entry', formId: 'e1', margin: '30', leverage: '10', entry: String(sig.entry), qty: '0.1', stop: String(sig.stop), at: `${day}T00:30` }).status, 'duplicate');   // 더블탭·재시도
  assert.equal(submit({ kind: 'exit', formId: 'x1', price: String(sig.tp1), qty: '50%', fee: '0.05', funding: '0', at: `${day}T01:00` }).ok, true);
  r = submit({ kind: 'exit', formId: 'x2', price: String(Number(sig.entry) + 5), qty: '', fee: '0.05', funding: '-0.02', at: `${day}T02:00`, note: '목표 근처에서 정리' }); assert.equal(r.ok, true, JSON.stringify(r)); assert.match(r.summary, /전량 청산/);
  assert.deepEqual(g.rows('fill').sort((a, b) => a.at - b.at).map(f => f.kind), ['entry', 'reduce', 'close']); assert.equal(g.rows('fill').filter(f => f.kind === 'entry')[0].price, sig.entry);
  assert.ok(g.tele.sent.some(m => /복기/.test(m.text)));                                                                                               // 청산 뒤 10초 복기 안내
  // 평가액 입력(실제 계좌 값) 후 웹앱
  assert.equal(g.ctx.rich300EquitySubmit({ day, equity: '312.5' }).ok, true);
  const dash = text(g.ctx.doGet({ parameter: { p: 'dash' } }).html);
  assert.match(dash, /현재 총자산 \(입력 평가액\) 312\.50 USDT/); assert.match(dash, /\+12\.50/); assert.match(dash, /\+4\.17%/); assert.match(dash, /오늘 시작 자산 300\.00/); assert.match(dash, /오늘 목표 자산 \(\+5%\) 315\.00/); assert.match(dash, /목표까지 남은 금액 2\.50/);
  assert.match(dash, /오늘 실현손익 [▲▼■] [+\-−]?\d/); assert.ok(!/<svg|<canvas/.test(g.ctx.doGet({ parameter: { p: 'dash' } }).html));
  const sg = text(g.ctx.doGet({ parameter: { p: 'signals' } }).html); assert.match(sg, /진입했어/); assert.match(sg, /실제 매매 있음/); assert.match(sg, /결과 [▲▼]/); assert.match(sg, /추천 진입/);
  const st = text(g.ctx.doGet({ parameter: { p: 'stats' } }).html); assert.match(st, /COIN RADAR 신호/); assert.match(st, /청산 거래 1건/);
  const jr = text(g.ctx.doGet({ parameter: { p: 'journal' } }).html); assert.match(jr, /목표 근처에서 정리/); assert.match(jr, /ETH/);
  // 중복 클릭은 아무것도 늘리지 않는다
  press(g, msg, 'e'); press(g, msg, 'w'); assert.equal(g.rows('signal').length, 1); assert.equal(g.rows('response').length, 1); assert.equal(g.rows('fill').length, 3);
});
test('종단 간: [관망했어]·[놓쳤어]는 추천 기록에만 남고 자산·손익에 영향이 없다', async () => {
  const g = world(), msg = await radarMessage(); press(g, msg, 'w');
  assert.deepEqual(g.rows('response').map(r => r.choice), ['watched']); assert.equal(g.rows('fill').length, 0);
  assert.match(text(g.ctx.doGet({ parameter: { p: 'signals' } }).html), /관망했어/); const dash = text(g.ctx.doGet({ parameter: { p: 'dash' } }).html); assert.match(dash, /현재 총자산 미입력/); assert.match(dash, /오늘 실현손익 [■▲▼] 0\.00/);
});
test('종단 간: 허용되지 않은 사용자의 버튼·명령은 무시되고 아무것도 저장되지 않는다(페어링한 계정만)', async () => {
  const g = world(), msg = await radarMessage(); press(g, msg, 'e', { from: STRANGER }); g.tele.say(STRANGER, '/status'); g.tele.say(STRANGER, '/fill SG-X 30 10 100 98'); g.ctx.rich300TgPoll();
  assert.equal(g.rows('signal').length, 0); assert.equal(g.rows('response').length, 0); assert.equal(g.tele.sent.length, 0);
  const g2 = loadProd({ props: { RICH300_PROD_APPROVED: 'yes' } }); g2.ctx.rich300Install(); press(g2, msg, 'e'); assert.equal(g2.rows('signal').length, 0);          // 페어링 전에는 누구도 기록할 수 없다
});
test('종단 간: 웹앱은 소유자만(타인·익명은 빈 응답), 입력·검증 서버 함수도 소유자 확인', async () => {
  const g = world(); for (const p of ['dash', 'journal', 'signals', 'stats', 'assets', 'fill', 'check']) assert.ok(g.ctx.doGet({ parameter: { p } }).html || g.ctx.doGet({ parameter: { p } }).title, p);
  for (const email of ['', 'other@example.com']) { const o = loadProd({ props: { RICH300_PROD_APPROVED: 'yes' }, email }); o.ctx.rich300Install(); for (const p of ['dash', 'journal', 'signals', 'stats', 'assets', 'fill', 'check']) assert.equal(o.ctx.doGet({ parameter: { p } }).text, '', `${email}:${p}`); assert.equal(o.ctx.rich300FillSubmit({ kind: 'entry', sid: 'x' }).error, 'forbidden'); }
});
