// 버튼 입력 수신·응답 분리 진단과 응답 만료 대응(2026-11-04 PR #62 테스트 메시지에 반응이 없던 건). 가짜 Telegram·메모리 시트만 사용(실제 호출 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTg, OWNER, STRANGER } from './helpers/faketg.mjs';
import { tgPoll, tgPairCreate } from '../lib/tg.mjs';
import { storeList } from '../lib/store.mjs';
import { shellActLine } from '../lib/shell.mjs';
import { loadProd } from './helpers/gasprod.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const TEST_TEXT = '🧪 테스트 · 가상 데이터 · 매매 금지\n버튼 수신 확인용 메시지입니다 (장부 기록 없음).';
function setup() { const x = makeTg({ uiUrl: 'https://script.google.com/macros/s/X/exec' }); const { code } = tgPairCreate(x.env); x.tele.say(OWNER, `/pair ${code}`); tgPoll(x.env); x.tele.sent.length = 0; return x; }
const count = (x, e) => storeList(x.mem.env, e).length;
const ledger = x => ['signal', 'response', 'strategy', 'fill'].map(e => { try { return count(x, e); } catch { return 0; } });
const press = (x, act = 'w', o = {}) => { x.tele.click(o.from ?? OWNER, { message_id: 7000 + x.tele.nextMsg++, chat_id: OWNER }, `r1:SG-TESTBTN-L-zz0001:${act}`, { text: TEST_TEXT, ...o }); return tgPoll(x.env); };

test('R9 줄 없는 테스트 메시지의 버튼: 처리됨(handled)·응답 성공·메시지에 처리 결과가 남고, 장부는 변하지 않는다', () => {
  const x = setup(), before = ledger(x), r = press(x);
  assert.equal(r.handled, 1); assert.equal(r.actions['unknown-signal'], 1); assert.deepEqual(r.acks, { ok: 1 }); assert.equal(r.replyFailed, 0);
  assert.equal(x.tele.answers.at(-1).text, '알 수 없는 신호입니다');
  const e = x.tele.edits.at(-1); assert.match(e.text, /수신됨 · 알 수 없는 신호라 기록하지 않음/); assert.match(e.text, /테스트 · 가상 데이터 · 매매 금지/); assert.deepEqual(e.reply_markup, { inline_keyboard: [] });   // 토스트가 사라져도 남는 증거, 버튼 제거
  assert.deepEqual(ledger(x), before);
});
test('응답 만료(query is too old): 토스트는 못 띄워도 메시지 편집으로 처리 결과가 남고, 만료로 집계되며, 장부는 변하지 않는다', () => {
  const x = setup(), before = ledger(x);
  x.tele.fail('answerCallbackQuery', [{ status: 400, body: { ok: false, description: 'Bad Request: query is too old and response timeout expired or query ID is invalid' } }]);
  const r = press(x); assert.equal(r.handled, 1); assert.deepEqual(r.acks, { stale: 1 }); assert.equal(r.replyFailed, 0);
  assert.match(x.tele.edits.at(-1).text, /수신됨/); assert.deepEqual(ledger(x), before);
});
test('응답 API 자체 실패: 실패로 집계되고 replyFailed 로 올라온다(이전에는 집계되지 않았다)', () => {
  const x = setup(); x.tele.fail('answerCallbackQuery', Array.from({ length: 6 }, () => ({ status: 500, body: { ok: false, description: 'Internal Server Error' } })));
  const r = press(x); assert.equal(r.handled, 1); assert.deepEqual(r.acks, { failed: 1 }); assert.equal(r.replyFailed, 1);
});
test('페어링되지 않은 사용자의 입력은 여전히 무응답·무기록이며 "무시됨(unpaired)"으로만 집계된다', () => {
  const x = setup(), before = ledger(x), editsBefore = x.tele.edits.length, ansBefore = x.tele.answers.length;
  const r = press(x, 'w', { from: STRANGER }); assert.equal(r.handled, 0); assert.equal(r.ignored, 1); assert.equal(r.actions.unpaired, 1); assert.equal(r.acks, undefined);
  assert.equal(x.tele.edits.length, editsBefore); assert.equal(x.tele.answers.length, ansBefore); assert.deepEqual(ledger(x), before);
});
test('같은 입력을 다시 가져와도 중복 처리·중복 편집이 없다(offset 확정)', () => {
  const x = setup(); press(x); const edits = x.tele.edits.length; const r2 = tgPoll(x.env); assert.equal(r2.handled, 0); assert.equal(x.tele.edits.length, edits);
});
test('진단 줄: 개수·종류만 표시하고 ID·토큰·본문이 없다', () => {
  const line = shellActLine({ ageMin: 2, handled: 1, ignored: 0, retry: 0, replyFailed: 0, actions: { 'unknown-signal': 1 }, acks: { stale: 1 } });
  assert.match(line, /2분 전/); assert.match(line, /알 수 없는 신호\(기록 없음\) 1/); assert.match(line, /만료 1/); assert.doesNotMatch(line, /\d{6,}|token|SG-|테스트 · 가상/);
  assert.match(shellActLine(null), /기록 없음/); assert.match(shellActLine({ ageMin: 0, actions: { weird: 3 } }), /기타 3/);
});
test('Apps Script 경로: 입력이 있으면 tg:act 에 요약만 남고(?p=tg 에 표시), 입력이 없는 폴링은 남기지 않는다', () => {
  const g = loadProd({ props: { RICH300_PROD_APPROVED: 'yes' } }); const r = g.ctx.rich300Install(); g.tele.say(OWNER, `/start ${r.pairLink.split('=')[1]}`); g.ctx.rich300TgPoll();
  g.P.deleteProperty('tg:act'); g.ctx.rich300TgPoll(); assert.equal(g.P.getProperty('tg:act'), null);
  g.tele.click(OWNER, { message_id: 8001, chat_id: OWNER }, 'r1:SG-TESTBTN-L-zz0001:w', { text: TEST_TEXT }); g.ctx.rich300TgPoll();
  const act = JSON.parse(g.P.getProperty('tg:act')); assert.equal(act.handled, 1); assert.deepEqual(act.actions, { 'unknown-signal': 1 }); assert.deepEqual(act.acks, { ok: 1 });
  const raw = g.P.getProperty('tg:act'); assert.doesNotMatch(raw, new RegExp(String(OWNER))); assert.doesNotMatch(raw, /테스트/);
  const html = g.ctx.doGet({ parameter: { p: 'tg' } }).html.replace(/<[^>]+>/g, ' '); assert.match(html, /마지막 입력 처리: \d+분 전 · 처리 1/); assert.match(html, /버튼 응답 성공 1 \/ 만료 0 \/ 실패 0/);
});
