// Watch.gs(가짜 Apps Script·가짜 Telegram·가짜 거래소 시세): 기본 OFF, 미리보기, 전송 가드, 한 번만 전송, 상태 분리, 락, 트리거 관리.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProd } from './helpers/gasprod.mjs';
import { seed } from '../perf/bench.mjs';
import { OWNER } from './helpers/faketg.mjs';
import { splanBuild } from '../lib/scaleplan.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const NOW = 1790000000000, H = 3600000, plan = splanBuild({ symbol: 'ETHUSDT', dir: 'LONG', entry: 2000, stop: 1970, equity: 300 }), q1 = plan.stages[0].qty;
const okxBars = (n, { start, drift, step }) => ({ code: '0', data: Array.from({ length: n }, (_, i) => { const idx = n - 1 - i, c = start * (1 + drift * idx), t = NOW - (i + 1) * step; return [String(t), String(c), String(c * 1.002), String(c * 0.998), String(c), '100', '0', '0', '1']; }) });
function market(price, hits) {
  return url => {
    hits.push(url);
    if (/ticker/.test(url)) return { status: 200, body: { code: '0', data: [{ last: String(price), ts: String(NOW - 30000) }] } };
    if (/bar=15m/.test(url)) return { status: 200, body: { code: '0', data: [[String(NOW - 900000), String(price), String(price), String(price), String(price), '1', '0', '0', '1']] } };
    if (/bar=1H/.test(url)) return { status: 200, body: okxBars(100, { start: 1900, drift: 0.001, step: H }) };
    return { status: 200, body: okxBars(100, { start: 1590, drift: 0.003, step: 4 * H }) };
  };
}
function world({ approved = true, paired = true, price = 2050 } = {}) {
  const g = loadProd({ props: approved ? { RICH300_PROD_APPROVED: 'yes' } : {} }); seed(g, 3); g.ctx.rich300Install();
  if (paired && approved) { const r = g.ctx.rich300Install(); g.tele.say(OWNER, `/start ${r.pairLink.split('=')[1]}`); g.ctx.rich300TgPoll(); }
  const se = g.ctx.rich300GasEnv_('sheet'), E = g.ctx.RICH300_ENGINE, A = { actor: 't' };
  E.storeCreate(se, 'signal', { sid: 'W1', strategy: 'A', symbolId: 'ETHUSDT', dir: 'LONG', signalAt: NOW - 3 * H, entry: '2000', stop: '1970', tp1: '2045' }, A);
  E.storeCreate(se, 'fill', { origin: 'real', fillId: 'W1:in', sid: 'W1', kind: 'entry', dir: 'LONG', at: NOW - 2.5 * H, price: '2000', qty: String(q1), margin: '30', leverage: '3', plannedStop: '1970', fee: { state: 'entered', amount: '0.04' }, funding: { state: 'entered', amount: '0' } }, A);
  E.storeCreate(se, 'plan', { sid: 'W1', equity: '300', entry: '2000', stop: '1970', lev: plan.lev, stages: plan.stagesCount, at: NOW - 2.5 * H }, A);
  const hits = []; g.spy.marketHandler = market(price, hits); g.tele.sent.length = 0; g.cache.evictAll();
  return { g, hits, sentWatch: () => g.tele.sent.filter(m => /\[RICH300\]/.test(m.text)) };
}
const tgKeys = g => g.P.getKeys().filter(k => k.startsWith('tg:')).sort().map(k => `${k}=${g.P.getProperty(k)}`);

test('기본 OFF: 속성이 없으면 시세 호출 0 · 텔레그램 0 · 트리거도 설치하지 않는다', () => {
  const w = world(); assert.deepEqual(JSON.parse(JSON.stringify(w.g.ctx.rich300WatchTick())), { status: 'off' }); assert.equal(w.hits.length, 0); assert.equal(w.sentWatch().length, 0);
  assert.equal(w.g.spy.triggers.filter(t => t.fn === 'rich300WatchTick').length, 0);
});
test('미리보기(rich300WatchPreview): 설정과 무관하게 계산만 — 전송 0 · 감시 상태 저장 0 · 시세는 읽기 전용 GET', () => {
  const w = world(); const r = w.g.ctx.rich300WatchPreview(); assert.equal(r.status, 'ok'); assert.ok(r.events >= 1); assert.equal(w.sentWatch().length, 0);
  assert.equal(w.g.P.getKeys().filter(k => k.startsWith('w:')).length, 0); assert.ok(w.hits.length >= 4); assert.ok(w.hits.every(u => /^https:\/\/(www\.okx\.com|api\.bybit\.com)\//.test(u)));
  assert.equal(JSON.parse(w.g.P.getProperty('watch:last')).requested, 'preview');
});
test('ON + 운영 승인 + 연결: TP1 알림이 정확히 1건, 다시 실행해도 추가 없음 · tg: 상태는 건드리지 않는다', () => {
  const w = world(); w.g.P.setProperty('RICH300_WATCH_ALERTS', 'on'); const before = tgKeys(w.g);
  const r1 = w.g.ctx.rich300WatchTick(); assert.equal(r1.sent, 1, JSON.stringify(r1)); const m = w.sentWatch(); assert.equal(m.length, 1); assert.match(m[0].text, /ETH LONG · 🎯 TP1 도달/); assert.match(m[0].text, /자동 주문 아님/);
  assert.equal(w.g.ctx.rich300WatchTick().sent, 0); assert.equal(w.sentWatch().length, 1);
  assert.deepEqual(tgKeys(w.g), before);                                                                            // 텔레그램 입력 상태 불변
  assert.ok(w.g.P.getKeys().some(k => k === 'w:pos:W1')); assert.equal(JSON.parse(w.g.P.getProperty('watch:last')).sent, 0);
});
test('전송 가드: 운영 승인 전이거나 연결 전이면 ON 이어도 전송하지 않고 미리보기로만 동작(텔레그램 호출 0)', () => {
  const a = world({ approved: false }); a.g.P.setProperty('RICH300_WATCH_ALERTS', 'on'); const r = a.g.ctx.rich300WatchTick(); assert.equal(r.mode, 'preview'); assert.equal(a.g.tele.sent.length, 0); assert.equal(a.g.spy.fetches, 0);
  const b = world({ paired: false }); b.g.P.setProperty('RICH300_WATCH_ALERTS', 'on'); assert.equal(b.g.ctx.rich300WatchTick().mode, 'preview'); assert.equal(b.sentWatch().length, 0);
});
test('시세 API 장애·잘못된 응답: 예외 없이 끝나고 알림 없음 · OKX 실패 시 Bybit 로 대체 시도', () => {
  const w = world(); w.g.P.setProperty('RICH300_WATCH_ALERTS', 'on'); w.g.spy.marketHandler = url => { w.hits.push(url); return { status: 503, body: 'down' }; };
  const r = w.g.ctx.rich300WatchTick(); assert.equal(r.status, 'ok'); assert.equal(r.sent, 0); assert.equal(r.marketFail, 1); assert.ok(w.hits.some(u => /okx\.com/.test(u)) && w.hits.some(u => /bybit\.com/.test(u)));
  w.g.spy.marketHandler = () => ({ status: 200, body: '<html>' }); assert.equal(w.g.ctx.rich300WatchTick().sent, 0);
});
test('트리거가 겹치면(사용자 락 사용 중) 실행하지 않고 busy', () => {
  const w = world(); w.g.P.setProperty('RICH300_WATCH_ALERTS', 'on'); w.g.ctx.LockService.getUserLock = () => ({ tryLock: () => false, releaseLock() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(w.g.ctx.rich300WatchTick())), { status: 'busy' }); assert.equal(w.hits.length, 0);
});
test('트리거 설치·제거는 감시 트리거만 바꾼다(기존 트리거 불변) · 5분 간격', () => {
  const w = world(); const before = w.g.spy.triggers.filter(t => !t.deleted).map(t => t.fn).sort();
  w.g.ctx.rich300WatchInstallTrigger(); const mid = w.g.spy.triggers.filter(t => !t.deleted); assert.equal(mid.filter(t => t.fn === 'rich300WatchTick').length, 1);
  w.g.ctx.rich300WatchInstallTrigger(); assert.equal(w.g.spy.triggers.filter(t => !t.deleted && t.fn === 'rich300WatchTick').length, 1);       // 중복 없음
  w.g.ctx.rich300WatchRemoveTrigger(); assert.deepEqual(w.g.spy.triggers.filter(t => !t.deleted).map(t => t.fn).sort(), before);
});
test('홈 화면은 감시와 무관: 감시를 켜도 ?p=dash 의 Sheets·시세 호출이 늘지 않는다', () => {
  const w = world(); const h0 = w.hits.length; w.g.ctx.doGet({ parameter: { p: 'dash' } }); w.g.P.setProperty('RICH300_WATCH_ALERTS', 'on'); w.g.ctx.doGet({ parameter: { p: 'dash' } }); assert.equal(w.hits.length, h0);
});
