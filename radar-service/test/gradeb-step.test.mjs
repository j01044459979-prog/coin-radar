// B급 공격형 신호 단계 통합 테스트: 플래그(off/preview/on), A급 우선, 메시지 구분 표시, 피드, 일일 상한, 무효화 알림. 네트워크·Telegram은 모의다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { signalStep } from '../signal/step.mjs';
import { signalSettings } from '../signal/config.mjs';
import { feedEntryOf } from '../signal/feed.mjs';
import { evaluateB } from '../signal/gradeb.mjs';
import { M15 } from '../signal/evaluate.mjs';
import { T, NOW, mkA, mk15, sender, store, collectors, oppState } from './signal-fixture.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
function bars(rows, closeT = T + M15) {
  const n = 62 + rows.length, out = [];
  for (let k = 0; k < n; k++) { const t = closeT - (n - k) * M15; if (k < 62) { const w = ((k * 7) % 5) / 10; out.push({ t, o: 100.4 + w * 0.2, h: 100.7 + w * 0.2, l: 100.1 - w * 0.1, c: 100.4 - w * 0.1 + 0.1, q: 1000 }); } else { const [o, h, l, c, q] = rows[k - 62]; out.push({ t, o, h, l, c, q }); } }
  return out;
}
const OK = [[100.3, 100.4, 99.9, 100.0, 1000], [100.0, 100.1, 99.5, 99.6, 1000], [99.6, 99.7, 99.1, 99.2, 1000], [99.2, 99.3, 98.9, 99.1, 1100], [99.1, 99.4, 99.0, 99.3, 1000], [99.3, 99.5, 99.1, 99.2, 900], [99.2, 99.45, 99.1, 99.4, 1000], [99.4, 99.55, 99.2, 99.3, 900], [99.3, 99.4, 99.15, 99.35, 1000], [99.35, 99.95, 99.3, 99.9, 1500]];
const B_BARS = bars(OK), A_BARS = mk15();
function run({ env = {}, c15 = B_BARS, symbols = ['ETHUSDT'], a = mkA(), state } = {}) {
  const calls = [], st = state ?? { ...oppState(symbols) }, sd = sender(), sv = store();
  return { calls, st, sd, sv, args: { now: NOW, state: st, env: { RADAR_SIGNAL: 'on', ...env }, send: sd.send, save: sv.save, analyze: () => a, scanAll: false, ...collectors({ c15, symbols, calls }) } };
}

test('설정: RADAR_SIGNAL_B 는 기본 off, 잘못된 값은 off, 일일 상한 기본 10(1~30)', () => {
  assert.equal(signalSettings({}).gradeB, 'off'); assert.equal(signalSettings({ RADAR_SIGNAL_B: 'ON' }).gradeB, 'on'); assert.equal(signalSettings({ RADAR_SIGNAL_B: 'true' }).gradeB, 'off'); assert.equal(signalSettings({ RADAR_SIGNAL_B: 'preview' }).gradeB, 'preview');
  assert.equal(signalSettings({}).maxPerDayB, 10); assert.equal(signalSettings({ RADAR_SIGNAL_B_MAX_PER_DAY: '3' }).maxPerDayB, 3); assert.equal(signalSettings({ RADAR_SIGNAL_B_MAX_PER_DAY: '99' }).maxPerDayB, 10);
});
test('B급 off(기본): B급 구조 회복만 있는 상황에서는 아무것도 보내지 않고 상태·메시지는 이전과 같다(구분 표시도 없음)', async () => {
  const r = run(); const out = await signalStep(r.args);
  assert.equal(out.sentMessages, 0); assert.equal(out.gradeB, undefined); assert.equal(r.sd.sent.length, 0);
  const a = run({ c15: A_BARS }); const o2 = await signalStep(a.args); assert.equal(o2.sentMessages, 1); assert.ok(!/A급|B급/.test(a.sd.sent[0].text), 'B급이 꺼져 있으면 기존 A급 메시지에 구분 표시를 붙이지 않는다');
});
test('B급 preview: 판정만 하고 전송·상태 변경 없음(요약에 B급 후보 수만 남는다)', async () => {
  const r = run({ env: { RADAR_SIGNAL_B: 'preview' } }); const out = await signalStep(r.args);
  assert.equal(out.sentMessages, 0); assert.equal(r.sd.sent.length, 0); assert.equal(out.gradeB.mode, 'preview'); assert.equal(out.gradeB.candidates, 1); assert.equal(out.gradeB.previewOnly, 1);
  assert.notEqual(r.st.signal?.coins?.ETHUSDT?.status, 'active'); assert.equal(r.st.signal?.coins?.ETHUSDT?.grade, undefined); assert.equal(r.st.signal?.feed, undefined, '신호 상태에 B급 활성 신호·피드 항목이 생기지 않는다');
});
test('B급 on: [B급 공격형] 표시·손절·무효화·손실 한도 문구를 보내고, 활성 신호에 grade B 를 남기며, 일일 B급 카운터를 올린다', async () => {
  const r = run({ env: { RADAR_SIGNAL_B: 'on' } }); const out = await signalStep(r.args);
  assert.equal(out.sentMessages, 1); assert.equal(out.gradeB.candidates, 1); const t = r.sd.sent[0].text;
  assert.match(t, /\[B급 공격형\]/); assert.match(t, /진입 후보/); assert.match(t, /손절 기준 98\.65/); assert.match(t, /구조 무효화/); assert.match(t, /1\.5 USDT/); assert.match(t, /RICH300 \[B급 공격형\]/); assert.doesNotMatch(t, /A급 확정형/);
  assert.equal(r.st.signal.coins.ETHUSDT.grade, 'B'); assert.equal(r.st.signal.coins.ETHUSDT.status, 'active'); assert.equal(Object.values(r.st.signal.daily)[0].candidatesB, 1); assert.equal(Object.values(r.st.signal.daily)[0].candidates, 0);
  assert.equal(out.dailySentB, 1);
});
test('같은 봉에 A급과 B급이 모두 가능하면 A급 우선, A급 메시지에는 [A급 확정형] 표시', async () => {
  const r = run({ env: { RADAR_SIGNAL_B: 'on' }, c15: A_BARS }); const out = await signalStep(r.args);
  assert.equal(out.sentMessages, 1); assert.match(r.sd.sent[0].text, /\[A급 확정형\]/); assert.doesNotMatch(r.sd.sent[0].text, /B급 공격형/); assert.notEqual(r.st.signal.coins.ETHUSDT.grade, 'B');
});
test('B급 일일 상한: RADAR_SIGNAL_B_MAX_PER_DAY=1 이면 두 종목 중 한 건만 보내고 나머지는 보류(A급 상한과 별도)', async () => {
  const r = run({ env: { RADAR_SIGNAL_B: 'on', RADAR_SIGNAL_B_MAX_PER_DAY: '1' }, symbols: ['ETHUSDT', 'SOLUSDT'] }); const out = await signalStep(r.args);
  assert.equal(out.sentMessages, 1); assert.equal(out.held, 1); assert.equal(out.candidates, 2);
});
test('RICH300 피드: B급 항목만 grade=B·swing 이 붙고 A급 항목은 이전과 같은 필드(바이트 호환)', async () => {
  const b = run({ env: { RADAR_SIGNAL_B: 'on', RADAR_RICH300_FEED: 'on' } }); await signalStep(b.args);
  const fb = b.st.signal.feed[0]; assert.equal(fb.grade, 'B'); assert.equal(fb.swing, '98.9'); assert.ok(Number(fb.entry) > Number(fb.stop)); assert.ok(Number(fb.rr1) >= 2, '비용 반영 2R 이상');
  const a = run({ env: { RADAR_SIGNAL_B: 'on', RADAR_RICH300_FEED: 'on' }, c15: A_BARS }); await signalStep(a.args);
  assert.equal(a.st.signal.feed[0].grade, undefined); assert.equal(a.st.signal.feed[0].swing, undefined);
  const ev = evaluateB({ a: mkA(), c15: B_BARS, now: NOW }); const legacy = feedEntryOf('ETHUSDT', { ...ev, grade: 'A', swing: undefined }, { now: NOW }); assert.equal(legacy.grade, undefined);
});
test('B급 신호 무효화(15분 종가가 구조 무효화 가격 이탈): [B급 공격형] 표시가 붙은 무효화 알림', async () => {
  const r = run({ env: { RADAR_SIGNAL_B: 'on' } }); await signalStep(r.args);
  const broken = bars([...OK.slice(0, 9), [99.2, 99.3, 98.0, 98.2, 2000]], T + M15 + M15), now2 = NOW + M15;
  const r2 = { ...r.args, now: now2, collectM15: async ({ ids }) => ({ coins: Object.fromEntries(ids.map(id => [id, { status: 'fresh', c15: broken, notes: [] }])), stopped: null, calls: ids.length }), analyze: () => mkA({ asOf: T }) };
  const out = await signalStep(r2); const msg = r.sd.sent.at(-1).text;
  assert.equal(out.invalidated, 1); assert.match(msg, /\[B급 공격형\]/); assert.match(msg, /무효화/);
});
