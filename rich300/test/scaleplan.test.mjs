// 분할 진입·익절 계획(앱 쪽): 동기화·저장·/plan·추가 진입 규칙. 계산·기록만 있고 주문은 없다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeTg, OWNER } from './helpers/faketg.mjs';
import { tgPoll, tgPairCreate } from '../lib/tg.mjs';
import { storeCreate, storeList, storeSetupChallenge, storeIntegrityCheck } from '../lib/store.mjs';
import { kstDayOf } from '../lib/time.mjs';

const T = 1790000000000, SID = 'A-ETH-1';
const SIG = { sid: SID, strategy: 'A', symbolId: 'ETHUSDT', dir: 'LONG', signalAt: T, entry: '3012.5', stop: '2980', tp1: '3061.25', tp2: '3077.5' };
const poll = x => tgPoll(x.env), rows = (x, e) => storeList(x.mem.env, e).map(r => r.data), lastSent = x => x.tele.sent[x.tele.sent.length - 1];
const btn = (m, part) => { for (const r of m.reply_markup.inline_keyboard) for (const b of r) if (b.text.includes(part)) return b.callback_data; throw new Error('버튼 없음'); };
function say(x, text) { x.tele.say(OWNER, text); return poll(x); }
function click(x, m, d) { x.tele.click(OWNER, m, d); return poll(x); }
function setup({ equity = true } = {}) {
  const x = makeTg(); if (equity) storeSetupChallenge(x.mem.env, { startEquity: '300', startDay: kstDayOf(T - 86400000), rate: '0.05' }, { actor: 't' });
  storeCreate(x.mem.env, 'signal', SIG, { actor: 't' }); const { code } = tgPairCreate(x.env); x.tele.say(OWNER, `/pair ${code}`); poll(x); return x;
}
const enter = (x, line = `/fill ${SID} 15 3 3012.5 2980 qty=0.022`) => { say(x, line); const m = lastSent(x); click(x, m, btn(m, '저장')); return m; };

test('scaleplan.mjs 는 레이더 쪽 scale.mjs 와 바이트 단위로 같다', () => {
  assert.equal(readFileSync(new URL('../lib/scaleplan.mjs', import.meta.url), 'utf8'), readFileSync(new URL('../../radar-service/signal/scale.mjs', import.meta.url), 'utf8'));
});
test('/plan: 진입 전에는 미리보기(저장 없음), 첫 진입을 기록하면 계획 입력이 불변으로 1건 저장된다', () => {
  const x = setup(); say(x, `/plan ${SID}`); const t = lastSent(x).text;
  assert.match(t, /3분할 진입 계획/); assert.match(t, /1차 50%/); assert.match(t, /미리보기/); assert.equal(rows(x, 'plan').length, 0);
  enter(x); const p = rows(x, 'plan'); assert.equal(p.length, 1); assert.deepEqual([p[0].sid, p[0].equity, p[0].entry, p[0].stop, p[0].lev, p[0].stages], [SID, '300', '3012.5', '2980', 3, 3]);
  say(x, `/plan ${SID}`); const s = lastSent(x).text; assert.match(s, /계획 상태/); assert.match(s, /0\.022/); assert.match(s, /미체결 2차/); assert.equal(storeIntegrityCheck(x.mem.env).ok, true);
});
test('첫 진입이 계획 1차 수량보다 크면 확인 요약에 경고(기록은 막지 않음)', () => {
  const x = setup(); say(x, `/fill ${SID} 40 3 3012.5 2980 qty=0.044`); const m = lastSent(x); assert.match(m.text, /1차 계획 수량 0\.022 보다 큽니다/); click(x, m, btn(m, '저장')); assert.equal(rows(x, 'fill').length, 1);
});
test('추가 진입: 계획 가격·수량에서만 허용, 만회용 물타기·무계획·손절 밖은 차단, force=1 이면 경고와 함께 기록', () => {
  const x = setup(); enter(x);
  say(x, `/fill ${SID} 10 3 3002.75 2980 qty=0.013`); let m = lastSent(x); assert.match(m.text, /^추가진입 LONG/); assert.ok(!/계획 밖/.test(m.text)); click(x, m, btn(m, '저장')); assert.equal(rows(x, 'fill').length, 2);
  say(x, `/fill ${SID} 10 3 2985 2980 qty=0.009`); assert.match(lastSent(x).text, /더 깊은 가격|사전에 정한/);          // 3차 계획가(2993)보다 깊은 가격 = 물타기
  say(x, `/fill ${SID} 10 3 2993 2980 qty=0.05`); assert.match(lastSent(x).text, /계획 수량을 넘습니다/);
  assert.equal(rows(x, 'fill').length, 2);
  say(x, `/fill ${SID} 10 3 2993 2980 qty=0.009`); m = lastSent(x); assert.match(m.text, /^추가진입/); click(x, m, btn(m, '저장')); assert.equal(rows(x, 'fill').length, 3);
  say(x, `/fill ${SID} 10 3 2990 2980 qty=0.001`); assert.match(lastSent(x).text, /계획된 추가 진입 단계가 남아 있지 않습니다/);
  say(x, `/fill ${SID} 10 3 2990 2980 qty=0.001 force=1`); assert.match(lastSent(x).text, /계획 밖 추가 진입\(force\)/);
});
test('익절이 시작된 뒤 추가 진입 금지, 평가액이 없으면 계획 저장 없이 진입 기록은 정상', () => {
  const x = setup(); enter(x); say(x, `/exit ${SID} 3061.25 0.011`); let m = lastSent(x); click(x, m, btn(m, '저장'));
  say(x, `/fill ${SID} 10 3 3002.75 2980 qty=0.013`); assert.match(lastSent(x).text, /익절이 시작된 뒤/);
  const y = setup({ equity: false }); enter(y); assert.equal(rows(y, 'fill').length, 1); assert.equal(rows(y, 'plan').length, 0);
  say(y, `/fill ${SID} 10 3 3002.75 2980 qty=0.013`); assert.match(lastSent(y).text, /분할 계획이 없습니다/);
});
