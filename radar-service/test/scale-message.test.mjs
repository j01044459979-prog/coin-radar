// 분할 계획 메시지 연동 테스트(합성 데이터·모의 전송). 기본 off 에서는 기존 출력이 한 글자도 바뀌지 않아야 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSignal } from '../signal/evaluate.mjs';
import { signalStep } from '../signal/step.mjs';
import { candidateMessage } from '../signal/message.mjs';
import { signalCaption } from '../signal/chart.mjs';
import { scaleEnabled, scaleEquity, scaleDecorate, scaleCaption } from '../signal/scale-decorate.mjs';
import { NOW, mkA, mirrorA, mk15, mirror15, sender, store, collectors, oppState } from './signal-fixture.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const OPT = { minRR: 1.5, validMin: 45 };
const evL = () => evaluateSignal({ a: mkA(), c15: mk15(), now: NOW }, OPT), evS = () => evaluateSignal({ a: mirrorA(mkA()), c15: mirror15(mk15()), now: NOW }, OPT);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const mk = (env, o = {}) => { const st = { ...oppState() }, sd = sender(), sv = store(); return { st, sd, args: { now: NOW, state: st, env: { RADAR_SIGNAL: 'on', ...env }, send: sd.send, save: sv.save, analyze: () => mkA(), ...collectors({ c15: mk15() }), ...o } }; };

test('플래그: on 일 때만 켜지고 평가액은 범위 밖이면 기본 300', () => {
  assert.equal(scaleEnabled({ RADAR_SCALE_PLAN: 'on' }), true); for (const v of [undefined, '', 'off', 'true', '1']) assert.equal(scaleEnabled({ RADAR_SCALE_PLAN: v }), false);
  assert.equal(scaleEquity({}), 300); assert.equal(scaleEquity({ RADAR_PLAN_EQUITY: '500' }), 500); assert.equal(scaleEquity({ RADAR_PLAN_EQUITY: 'x' }), 300); assert.equal(scaleEquity({ RADAR_PLAN_EQUITY: '-5' }), 300);
});
test('기본 off: 후보 메시지·전송 결과가 달라지지 않는다', async () => {
  const ev = evL(), base = candidateMessage('ETHUSDT', ev, { now: NOW });
  assert.equal(scaleDecorate(base, 'ETHUSDT', ev, {}), base); assert.equal(scaleDecorate(base, 'ETHUSDT', ev, { RADAR_SCALE_PLAN: 'off' }), base);
  const r = mk({}); await signalStep(r.args); assert.equal(r.sd.sent[0].text, base.text); assert.ok(!/분할 진입 계획/.test(r.sd.sent[0].text));
});
test('on: 각 진입 가격·비중·증거금·예상 손실, 각 익절 가격·비중, 최악 손실·증거금 사용률·가용 잔고가 본문에 있다', () => {
  for (const ev of [evL(), evS()]) {
    const d = scaleDecorate(candidateMessage('ETHUSDT', ev, { now: NOW }), 'ETHUSDT', ev, { RADAR_SCALE_PLAN: 'on' }), t = d.plain, plan = d.scale.plan;
    assert.equal(plan.status, 'ok'); assert.ok(d.text.length < 3300);
    for (const s of plan.stages) { assert.ok(t.includes(`${s.n}차 ${Math.round(s.weight * 100)}%`)); assert.ok(t.includes(s.price.toFixed(2))); }
    for (const x of plan.tps) assert.ok(t.includes(`TP${x.n} ${x.price.toFixed(2)} (${x.r}R) ${Math.round(x.w * 100)}%`));
    assert.match(t, /증거금/); assert.match(t, /손절 시 −/); assert.match(t, /최악 손실/); assert.match(t, /증거금 \(?.*평가액의/); assert.match(t, /유지할 가용 잔고/); assert.match(t, /물타기|만회용 추가 금지/); assert.match(t, /주문이 아닙니다/);
    assert.ok(plan.worstLoss <= plan.riskBudget + 1e-9);
  }
});
test('계획 불가(손절이 너무 가까움)면 제외 사유를 보여 준다', () => {
  const ev = evL(), tight = { ...ev, stop: ev.entry * 0.9999 }, d = scaleDecorate(candidateMessage('ETHUSDT', tight, { now: NOW }), 'ETHUSDT', tight, { RADAR_SCALE_PLAN: 'on' });
  assert.match(d.plain, /거래 제외/);
});
test('사진 설명: on 이면 3줄 요약이 붙고 R9 꼬리 자리를 남기며 한도를 넘으면 원래 설명 유지', () => {
  const ev = evL(), d = scaleDecorate(candidateMessage('ETHUSDT', ev, { now: NOW }), 'ETHUSDT', ev, { RADAR_SCALE_PLAN: 'on' }), cap = signalCaption('ETHUSDT', ev);
  const c = scaleCaption(cap, d, 200); assert.ok(c.includes('📐') && [...c].length + 200 <= 1000);
  assert.equal(scaleCaption(cap, d, 990), cap); assert.equal(scaleCaption(cap, { }, 0), cap);
});
test('통합: on + 사진 모드에서 설명에 계획이 들어가고 본문 폴백에도 전체 계획이 있다', async () => {
  const photos = []; const sendPhoto = async (png, caption, o) => { photos.push({ caption }); };
  const r = mk({ RADAR_SCALE_PLAN: 'on', RADAR_RICH300_BUTTONS: 'on' }, { sendPhoto, renderChart: async () => PNG }); const out = await signalStep(r.args);
  assert.equal(out.photoSent, 1); assert.ok(photos[0].caption.includes('📐') && photos[0].caption.includes('R9 v1') && [...photos[0].caption].length <= 1000);
  const f = mk({ RADAR_SCALE_PLAN: 'on' }, { sendPhoto: async () => { throw Object.assign(new Error('bad'), { status: 400 }); }, renderChart: async () => PNG }); await signalStep(f.args);
  assert.match(f.sd.sent[0].text, /분할 진입 계획/);
});
