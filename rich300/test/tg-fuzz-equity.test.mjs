// R7: 평가액 입력(/equity)과 일 마감이 섞인 결함 주입 퍼징. 같은 평가액 입력이 여러 번 전달·재시도되어도 입력 1건(수정 이력 없음)으로 수렴하고 마감 기록이 중복되지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runFuzz } from './tg-fuzz.test.mjs';
import { storeSetupChallenge, storeList, storeGet } from '../lib/store.mjs';
import { closeRun } from '../lib/close.mjs';
import { kstDayOf, addDays } from '../lib/time.mjs';

const prepare = x => { const today = kstDayOf(x.clock.t); x.yesterday = addDays(today, -1); storeSetupChallenge(x.mem.env, { startEquity: '300', startDay: addDays(today, -3), rate: '0.05' }, { actor: 't' }); closeRun(x.env); };
const extra = ({ x, say, clickSave, until }) => until(() => storeList(x.mem.env, 'equity').length > 0, () => { say(`/equity 305 ${x.yesterday}`); const d = [...x.tele.sent].reverse().find(m => m.text.startsWith('평가액 입력') && m.reply_markup); if (d) clickSave(d); });
const snapExtra = x => ({ eq: storeList(x.mem.env, 'equity').map(r => [r.data.equity, r.data.day === x.yesterday, storeGet(x.mem.env, 'equity', r.key).rev]), closes: storeList(x.mem.env, 'dayclose').length });
test('퍼징(평가액 입력·마감): 무작위 결함에서도 평가액 1건(rev 1)·마감 3건으로 수렴한다', () => {
  const ref = runFuzz(1, false, { prepare, extra, snapExtra }); const j = JSON.parse(ref.snap); assert.deepEqual([j.eq, j.closes], [[['305', true, 1]], 3]);
  for (let seed = 1; seed <= 25; seed++) assert.equal(runFuzz(seed * 104729, true, { prepare, extra, snapExtra }).snap, ref.snap, `시드 ${seed}`);
});
