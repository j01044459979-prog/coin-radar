// Telegram 중복 처리·재시도 검증(결함 주입 퍼징): 요청 실패(429/5xx/네트워크)·시트 쓰기 실패·락 경합·중복 전달·오프셋 유실이 무작위로 섞여도
// 정상화 후 최종 상태가 결함 없는 실행과 같고(중복·누락 없음) 무결성이 유지되는지 확인한다. 시드 고정(재현 가능).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTg, OWNER } from './helpers/faketg.mjs';
import { tgPoll, tgPairCreate } from '../lib/tg.mjs';
import { storeCreate, storeList, storeIntegrityCheck, storeRepair } from '../lib/store.mjs';

const SIG = { sid: 'A-BTC-1', strategy: 'A', symbolId: 'BTCUSDT', dir: 'LONG', signalAt: 1790000000000, entry: '100', stop: '98', tp1: '103' }, SID = SIG.sid;
const lcg = seed => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const rows = (x, e) => storeList(x.mem.env, e).map(r => r.data);
const draftMsg = x => [...x.tele.sent].reverse().find(m => m.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data?.startsWith('f1:'));
const reviewMsg = x => [...x.tele.sent].reverse().find(m => m.text.startsWith('복기 · '));
function build() { const x = makeTg(); storeCreate(x.mem.env, 'signal', SIG, { actor: 't' }); const { code } = tgPairCreate(x.env); x.tele.say(OWNER, `/pair ${code}`); tgPoll(x.env); return x; }
export function runFuzz(seed, chaos, { prepare, extra, snapExtra } = {}) {
  const x = build(); if (prepare) prepare(x); const r = lcg(seed), poll = () => {
    if (chaos) {
      if (r() < 0.35) for (let i = 0, n = 1 + Math.floor(r() * 3); i < n; i++) { const m = ['sendMessage', 'editMessageText', 'answerCallbackQuery', 'getUpdates'][Math.floor(r() * 4)], f = [{ status: 429, body: { ok: false, parameters: { retry_after: 1 } } }, { status: 500, body: null }, 'throw', { status: 400, body: { ok: false, description: 'Bad Request: message is not modified' } }][Math.floor(r() * 4)]; x.tele.fail(m, [...(x.tele.fails.get(m) ?? []), f]); }
      if (r() < 0.25) x.mem.setFail(x.mem.appends + 1 + Math.floor(r() * 6)); else x.mem.setFail(null);
      x.mem.setLockBusy(r() < 0.15); if (r() < 0.2) x.kv.del('offset');
    }
    const out = tgPoll(x.env); x.mem.setLockBusy(false); x.mem.setFail(null); return out;
  };
  const say = t => { x.tele.say(OWNER, t); poll(); }, clickSave = m => { x.tele.click(OWNER, m, m.reply_markup.inline_keyboard[0][0].callback_data); poll(); };
  const until = (cond, act) => { for (let i = 0; i < 12 && !cond(); i++) act(); };           // 사람이 결과를 보고 안 됐으면 다시 시도하는 것과 같다(이미 반영된 것은 다시 하지 않음)
  const has = k => () => rows(x, 'fill').some(f => f.kind === k);
  const newest = () => draftMsg(x);
  const ok = prefix => () => { const d = newest(); return d && d.text.startsWith(prefix) ? d : null; };           // 사람은 확인 문구(진입/추가진입/부분/전량)를 읽고 의도한 것만 저장한다
  until(has('entry'), () => { say(`/fill ${SID} 30 10 100 98`); const d = ok('진입 LONG')(); if (d) clickSave(d); });
  until(has('reduce'), () => { say(`/exit ${SID} 103 1`); const d = ok('부분 청산')(); if (d) clickSave(d); });
  until(has('close'), () => { say(`/exit ${SID} 101`); const d = ok('전량 청산')(); if (d) clickSave(d); });
  until(() => rows(x, 'review').length > 0, () => { let p = reviewMsg(x); if (!p) { say(`/review ${SID}`); p = reviewMsg(x); } if (p) { x.tele.click(OWNER, p, p.reply_markup.inline_keyboard[2][0].callback_data); poll(); } });
  if (extra) extra({ x, say, clickSave, until, poll, newest });
  x.tele.fails.clear(); x.mem.setFail(null); x.mem.setLockBusy(false); for (let i = 0; i < 6; i++) tgPoll(x.env);        // 정상화 후 남은 update 처리
  let integ = storeIntegrityCheck(x.mem.env); if (!integ.ok) { assert.ok(integ.issues.every(i => i.type === 'missing-view'), JSON.stringify(integ.issues)); integ = storeRepair(x.mem.env).after; } assert.equal(integ.ok, true, JSON.stringify(integ.issues));
  return { x, snap: JSON.stringify({ fills: rows(x, 'fill').map(f => [f.kind, f.price, f.qty]).sort(), resp: rows(x, 'response').map(f => f.choice), rv: rows(x, 'review').map(f => [f.plan, f.mind]), ...(snapExtra ? snapExtra(x) : {}) }) };
}
test('퍼징: 무작위 결함(요청 실패·쓰기 실패·락 경합·중복 전달·오프셋 유실) 40개 시드에서 최종 상태가 결함 없는 실행과 같다', () => {
  const ref = runFuzz(1, false); assert.equal(JSON.parse(ref.snap).fills.length, 3); let withFaults = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = runFuzz(seed * 7919, true); assert.equal(r.snap, ref.snap, `시드 ${seed}: 최종 상태가 다름`);
    const ids = rows(r.x, 'tgupdate').map(u => `${u.kind}:${u.id}`); assert.equal(new Set(ids).size, ids.length);
    assert.ok(r.x.tele.texts().filter(t => t.startsWith('복기 · A-BTC-1')).length <= 3, `시드 ${seed}: 복기 프롬프트 과다`);
    if (r.x.tele.calls.length > ref.x.tele.calls.length) withFaults++;
  }
  assert.ok(withFaults >= 20);                                                         // 결함이 실제로 주입되었음을 확인(빈 시험 방지)
});
