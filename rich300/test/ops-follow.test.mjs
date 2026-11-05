// 1시간 포지션 분석 스위치(?p=ops · rich300OpsFollowSet): 소유자만, 미리보기 → 켜기 순서, 트리거 정확히 1개, 새 트리거·전송·체결 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProd } from './helpers/gasprod.mjs';
import { seed } from '../perf/bench.mjs';
import { OWNER } from './helpers/faketg.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const j = v => JSON.parse(JSON.stringify(v));
const trig = g => g.spy.triggers.filter(t => !t.deleted && t.fn === 'rich300WatchTick').length;
function world({ trigger = true, email } = {}) {
  const g = loadProd({ props: { RICH300_PROD_APPROVED: 'yes' }, ...(email ? { email } : {}) }); seed(g, 3); const inst = g.ctx.rich300Install(); g.tele.say(OWNER, `/start ${inst.pairLink.split('=')[1]}`); g.ctx.rich300TgPoll();
  if (trigger) g.ctx.rich300WatchInstallTrigger();
  g.spy.marketHandler = () => ({ status: 500, body: {} }); g.tele.sent.length = 0; return g;
}
test('소유자만: 비소유자는 거부되고 속성은 바뀌지 않는다', () => {
  const g = world({ email: 'other@example.com' }); const r = j(g.ctx.rich300OpsFollowSet('preview')); assert.deepEqual([r.ok, r.code], [false, 'forbidden']); assert.equal(g.P.getProperty('RICH300_HOURLY_FOLLOW'), null);
});
test('잘못된 값은 거부', () => { const g = world(); assert.equal(j(g.ctx.rich300OpsFollowSet('yes')).code, 'bad-mode'); assert.equal(g.P.getProperty('RICH300_HOURLY_FOLLOW'), null); });
test('5분 감시 트리거가 정확히 1개가 아니면 켜지 않고 새 트리거도 만들지 않는다', () => {
  const g = world({ trigger: false }); const r = j(g.ctx.rich300OpsFollowSet('preview')); assert.deepEqual([r.ok, r.code, r.triggers], [false, 'trigger-count', 0]); assert.equal(trig(g), 0); assert.equal(g.P.getProperty('RICH300_HOURLY_FOLLOW'), null);
});
test('미리보기 먼저: 바로 켜기는 거부, 미리보기 후 켜기 가능, 트리거 1개 유지·텔레그램 전송 0·체결 0', () => {
  const g = world(), fills0 = g.rows('fill').length; assert.equal(j(g.ctx.rich300OpsFollowSet('on')).code, 'preview-first'); assert.equal(g.P.getProperty('RICH300_HOURLY_FOLLOW'), null);
  const p = j(g.ctx.rich300OpsFollowSet('preview')); assert.deepEqual([p.ok, p.code], [true, 'preview']); assert.equal(g.P.getProperty('RICH300_HOURLY_FOLLOW'), 'preview'); assert.equal(g.tele.sent.length, 0);
  const o = j(g.ctx.rich300OpsFollowSet('on')); assert.deepEqual([o.ok, o.code, o.effective, o.triggers], [true, 'on', 'active', 1]); assert.equal(g.P.getProperty('RICH300_HOURLY_FOLLOW'), 'on');
  assert.equal(trig(g), 1); assert.equal(g.rows('fill').length, fills0); assert.equal(g.tele.sent.length, 0);
  const f = j(g.ctx.rich300OpsFollowSet('off')); assert.deepEqual([f.ok, f.code], [true, 'off']); assert.equal(g.P.getProperty('RICH300_HOURLY_FOLLOW'), 'off');
});
test('운영 전송 승인이 없으면(전송 불가) 미리보기까지만 되고 켜지 않는다', () => {
  const g = world(); assert.equal(j(g.ctx.rich300OpsFollowSet('preview')).ok, true); g.P.deleteProperty('RICH300_PROD_APPROVED'); const r = j(g.ctx.rich300OpsFollowSet('on')); assert.deepEqual([r.ok, r.code], [false, 'tg-not-ready']); assert.equal(g.P.getProperty('RICH300_HOURLY_FOLLOW'), 'preview');
});
test('관리 화면에 1시간 분석 구역과 세 버튼, 현재 상태가 보인다', () => {
  const g = world(); const h = g.ctx.doGet({ parameter: { p: 'ops' } }).html; for (const w of ['1시간 포지션 분석', 'id="fpv"', 'id="fon"', 'id="foff"', 'rich300OpsFollowSet']) assert.ok(h.includes(w), w);
});
