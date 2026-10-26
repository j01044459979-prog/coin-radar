// 보유 포지션 감시 통합 시험(오프라인): 메모리 저장소 + 가짜 시세/전송/상태 저장. 중복 방지·재시도·만료·시세 장애·미리보기·상한·정리·일일 손실.
import test from 'node:test';
import assert from 'node:assert/strict';
import { memEnv } from './helpers/memenv.mjs';
import { storeInit, storeCreate, storeSetupChallenge } from '../lib/store.mjs';
import { watchTick, WATCH } from '../lib/watch.mjs';
import { splanBuild } from '../lib/scaleplan.mjs';

const T0 = Date.UTC(2026, 9, 26, 3, 0), H = 3600000, DAY = '2026-10-26';
const plan = splanBuild({ symbol: 'ETHUSDT', dir: 'LONG', entry: 2000, stop: 1970, equity: 300 }), q1 = plan.stages[0].qty;
const bars = (n, { start = 2000, drift = 0.001, step = H } = {}) => Array.from({ length: n }, (_, i) => { const c = start * (1 + drift * i); return { t: T0 - (n - i) * step, o: c, h: c * 1.002, l: c * 0.998, c, v: 100 }; });
const mkt = (price, o = {}) => ({ ok: true, source: 'OKX', price, priceAt: T0 - 60000, bars15m: [{ t: T0 - 900000, o: price, h: price, l: price, c: price, v: 1 }], bars1h: bars(100, { start: 1900 }), bars4h: bars(100, { start: 1590, drift: 0.003, step: 4 * H }), ...o });
function world({ withPlan = true, challenge = false } = {}) {
  const m = memEnv({ now: T0, fixedClock: true }), se = m.env; storeInit(se);
  const A = { actor: 't' };
  storeCreate(se, 'signal', { sid: 'S1', strategy: 'A', symbolId: 'ETHUSDT', dir: 'LONG', signalAt: T0 - 3 * H, entry: '2000', stop: '1970', tp1: '2045' }, A);
  storeCreate(se, 'fill', { origin: 'real', fillId: 'S1:in', sid: 'S1', kind: 'entry', dir: 'LONG', at: T0 - 2.5 * H, price: '2000', qty: String(q1), margin: '30', leverage: '3', plannedStop: '1970', fee: { state: 'entered', amount: '0.04' }, funding: { state: 'entered', amount: '0' } }, A);
  if (withPlan) storeCreate(se, 'plan', { sid: 'S1', equity: '300', entry: '2000', stop: '1970', lev: plan.lev, stages: plan.stagesCount, at: T0 - 2.5 * H }, A);
  if (challenge) storeSetupChallenge(se, { startEquity: '300', startDay: DAY, rate: '0.05' }, A);
  const kv = new Map(), writes = { n: 0 }, sends = [], calls = { market: 0 };
  const w = { se, now: T0, mode: 'on', price: 2050, sendOk: () => true, kv, sends, calls, writes, mk: null };
  w.env = { now: () => w.now, mode: () => w.mode, storeEnv: () => se,
    kv: { get: k => (kv.has(k) ? kv.get(k) : null), put: (k, v) => { writes.n++; kv.set(k, v); }, del: k => { kv.delete(k); }, keys: () => [...kv.keys()] },
    market: sym => { calls.market++; return w.mk ? w.mk(sym) : mkt(w.price, { priceAt: w.now - 60000 }); }, send: t => { const ok = w.sendOk(t); sends.push({ ok, t, at: w.now }); return ok ? { ok: true } : { ok: false, code: 'network' }; } };
  w.tick = () => watchTick(w.env); w.delivered = () => sends.filter(s => s.ok);
  return w;
}

test('꺼짐(off)이면 시세 호출 0 · 보유 포지션이 없으면 시세 호출 0', () => {
  const w = world(); w.mode = 'off'; assert.deepEqual(w.tick(), { status: 'off' }); assert.equal(w.calls.market, 0);
  const e = memEnv({ now: T0, fixedClock: true }); storeInit(e.env); const calls = { n: 0 };
  const r = watchTick({ now: () => T0, mode: () => 'on', storeEnv: () => e.env, kv: { get: () => null, put() {}, del() {}, keys: () => [] }, market: () => { calls.n++; return { ok: false }; }, send: () => ({ ok: true }) }); assert.equal(r.status, 'idle'); assert.equal(calls.n, 0);
});
test('같은 이벤트는 한 번만: TP1 알림은 다음 실행들에서 다시 가지 않는다 · 상태는 w: 저장소(kv)에만', () => {
  const w = world(); const r1 = w.tick(); assert.equal(r1.sent, 1); assert.match(w.delivered()[0].t, /TP1 도달/);
  w.now += 5 * 60000; assert.equal(w.tick().sent, 0); w.now += 5 * 60000; assert.equal(w.tick().sent, 0); assert.equal(w.delivered().length, 1);
  assert.deepEqual([...w.kv.keys()].filter(k => !['market', 'cap', 'pos:S1', 'day'].includes(k)), []);
  assert.equal(JSON.parse(w.kv.get('pos:S1')).sent['TP1:S1'].st, 'sent');
});
test('전송 실패는 같은 본문으로 재시도(2분 뒤), 성공하면 끝 — 사용자에게는 한 번만 전달', () => {
  const w = world(); w.sendOk = () => false; const r1 = w.tick(); assert.equal(r1.failed, 1); assert.equal(w.sends.length, 1);
  w.now += 60000; w.tick(); assert.equal(w.sends.length, 1);                                                        // 아직 대기 시간 중
  w.sendOk = () => true; w.now += 70000; const r2 = w.tick(); assert.equal(r2.sent, 1); assert.equal(w.sends.length, 2); assert.equal(w.sends[1].t, w.sends[0].t);   // 저장된 본문 그대로
  w.now += 5 * 60000; w.tick(); assert.equal(w.sends.length, 2); assert.equal(w.delivered().length, 1);
});
test('계속 실패하면 만료(30분 안)되어 더는 보내지 않는다 — 오래된 알림 방지', () => {
  const w = world(); w.sendOk = () => false; for (let i = 0; i < 12; i++) { w.tick(); w.now += 4 * 60000; }
  const rec = JSON.parse(w.kv.get('pos:S1')).sent['TP1:S1']; assert.equal(rec.st, 'expired'); const n = w.sends.length; assert.ok(n <= 5, String(n));
  w.sendOk = () => true; w.now += 10 * 60000; w.tick(); assert.equal(w.sends.length, n);
});
test('전송 직후 중단되어 pending 이 남은 경우 다시 보내지 않는다(한 번만 의미)', () => {
  const w = world(); w.kv.set('pos:S1', JSON.stringify({ v: 1, sent: { 'TP1:S1': { at: T0 - 1000, st: 'pending', tries: 1, text: 'x' } }, armed: {}, last: {} }));
  const r = w.tick(); assert.equal(r.sent, 0); assert.equal(w.sends.length, 0);
});
test('트리거가 겹쳐 두 번 실행돼도(같은 시각) 알림은 한 번', () => {
  const w = world(); w.tick(); w.tick(); assert.equal(w.delivered().length, 1);
});
test('시세 장애: 연속 3회 실패 뒤 한 번만 알리고, 복구되면 해제 · 오래된 시세(10분 초과)는 사용하지 않는다', () => {
  const w = world(); w.mk = () => ({ ok: false });
  for (let i = 0; i < 6; i++) { w.tick(); w.now += 5 * 60000; } const down = w.sends.filter(s => /시세 수집 장애/.test(s.t)); assert.equal(down.length, 1); assert.equal(w.sends.filter(s => /TP1/.test(s.t)).length, 0);
  w.mk = null; w.tick(); assert.equal(JSON.parse(w.kv.get('market')).fails, 0); assert.equal(JSON.parse(w.kv.get('market')).alerted, false);
  const s = world(); s.mk = () => mkt(2050, { priceAt: s.now - 11 * 60000 }); const r = s.tick(); assert.equal(r.sent, 0); assert.equal(r.stale, 1);
});
test('미리보기(preview): 계산만 — 전송 0 · 저장 0', () => {
  const w = world(); w.mode = 'preview'; const r = w.tick(); assert.equal(r.status, 'ok'); assert.ok(r.events >= 1); assert.equal(w.sends.length, 0); assert.equal(w.writes.n, 0);
});
test('청산되어 더 이상 보유하지 않으면 그 포지션의 감시 상태를 정리하고 알림을 끝낸다', () => {
  const w = world(); w.tick(); assert.ok(w.kv.has('pos:S1'));
  storeCreate(w.se, 'fill', { origin: 'real', fillId: 'S1:out', sid: 'S1', kind: 'close', dir: 'LONG', at: T0 - H, price: '2050', qty: String(q1), fee: { state: 'entered', amount: '0.04' }, funding: { state: 'entered', amount: '0' } }, { actor: 't' });
  const r = w.tick(); assert.equal(r.status, 'idle'); assert.equal(w.kv.has('pos:S1'), false);
});
test('상한: 시간당 12건을 넘는 일반 알림은 보류하지만 손절 관련(critical)은 항상 보낸다', () => {
  const w = world(); w.kv.set('cap', JSON.stringify({ h: Math.floor(T0 / 3600000), nh: WATCH.capHour, d: DAY, nd: 0 }));
  const r = w.tick(); assert.equal(r.sent, 0); assert.equal(r.capped >= 1, true);
  w.price = 1976; const r2 = w.tick(); assert.ok(r2.sent >= 1); assert.match(w.delivered().at(-1).t, /손절 임박/);
});
test('종목을 알 수 없는 포지션(신호 없음)은 시세를 조회하지 않고 건너뛴다', () => {
  const w = world(); storeCreate(w.se, 'fill', { origin: 'real', fillId: 'M1:in', sid: 'M1', kind: 'entry', dir: 'SHORT', at: T0 - H, price: '100', qty: '1', fee: { state: 'missing' }, funding: { state: 'missing' } }, { actor: 't' });
  const r = w.tick(); assert.equal(r.skipped, 1); assert.equal(w.calls.market, 1);                                    // S1 의 ETHUSDT 만
});
test('일일 손실 −3% 도달: 한 번 알리고 추가 진입 조건 알림을 막는다(기존 포지션 위험 축소는 안내)', () => {
  const w = world({ challenge: true }); w.price = 1992;       // 2차 가격 구간 + 평가손실
  storeCreate(w.se, 'signal', { sid: 'S0', strategy: 'A', symbolId: 'BTCUSDT', dir: 'LONG', signalAt: T0 - 10 * H, entry: '100', stop: '90', tp1: '110' }, { actor: 't' });
  storeCreate(w.se, 'fill', { origin: 'real', fillId: 'S0:in', sid: 'S0', kind: 'entry', dir: 'LONG', at: T0 - 9 * H, price: '100', qty: '1', fee: { state: 'entered', amount: '0' }, funding: { state: 'entered', amount: '0' } }, { actor: 't' });
  storeCreate(w.se, 'fill', { origin: 'real', fillId: 'S0:out', sid: 'S0', kind: 'close', dir: 'LONG', at: T0 - 8 * H, price: '90', qty: '1', fee: { state: 'entered', amount: '0' }, funding: { state: 'entered', amount: '0' } }, { actor: 't' });   // 오늘 −10 USDT (300의 3.3%)
  const r = w.tick(); const day = w.sends.filter(s => /일일 손실 한도/.test(s.t)); assert.equal(day.length, 1, JSON.stringify(w.sends.map(s => s.t.slice(0, 40))));
  assert.ok(!w.sends.some(s => /추가 진입 조건 충족/.test(s.t))); w.now += 5 * 60000; w.tick(); assert.equal(w.sends.filter(s => /일일 손실 한도/.test(s.t)).length, 1); void r;
});
test('메시지에 비밀·주문 표현 없음: 모든 전송 본문은 자동 주문 아님을 밝히고 토큰/ID 형태를 포함하지 않는다', () => {
  const w = world(); w.tick(); for (const s of w.sends) { assert.match(s.t, /자동 주문 아님/); assert.ok(!/\d{8,}:[A-Za-z0-9_-]{30,}/.test(s.t)); }
});
