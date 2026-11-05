// 수동 포지션 등록 + 감시(가상 포지션·모의 알림만 사용: 실제 Telegram·거래소 호출 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { memEnv } from './helpers/memenv.mjs';
import { storeInit, storeCreate, storeList, storeSetupChallenge, storeHistory } from '../lib/store.mjs';
import { manualRegister, manualUpdate, manualOpenList, manualSymbol } from '../lib/manual.mjs';
import { watchTick, watchSymbolVerdict } from '../lib/watch.mjs';
import { StoreError } from '../lib/schema.mjs';
import { journalBuild } from '../lib/journal.mjs';

const T0 = Date.UTC(2026, 9, 26, 3, 0), H = 3600000, DAY = '2026-10-26';
const bars = (n, { start = 2000, drift = 0.001, step = H } = {}) => Array.from({ length: n }, (_, i) => { const c = start * (1 + drift * i); return { t: T0 - (n - i) * step, o: c, h: c * 1.002, l: c * 0.998, c, v: 100 }; });
const mkt = (price, o = {}) => ({ ok: true, source: 'OKX', price, priceAt: T0 - 60000, bars15m: [{ t: T0 - 900000, o: price, h: price, l: price, c: price, v: 1 }], bars1h: bars(100, { start: 1900 }), bars4h: bars(100, { start: 1590, drift: 0.003, step: 4 * H }), ...o });
function world({ challenge = false } = {}) {
  const m = memEnv({ now: T0, fixedClock: true }), se = m.env; storeInit(se); if (challenge) storeSetupChallenge(se, { startEquity: '300', startDay: DAY, rate: '0.05' }, { actor: 't' });
  const w = { se, now: T0, check: 'ok', kv: new Map(), sends: [], sendOk: () => true, prices: { ETHUSDT: 2050 }, mk: null, mode: 'on' };
  w.reg = () => ({ now: () => w.now, storeEnv: () => se, randomId: () => 'rnd00000', symbolCheck: () => w.check });
  w.env = { now: () => w.now, mode: () => w.mode, storeEnv: () => se, kv: { get: k => (w.kv.has(k) ? w.kv.get(k) : null), put: (k, v) => w.kv.set(k, v), del: k => w.kv.delete(k), keys: () => [...w.kv.keys()] },
    market: sym => (w.mk ? w.mk(sym) : mkt(w.prices[sym], { priceAt: w.now - 60000 })), send: t => { const ok = w.sendOk(t); w.sends.push({ ok, t }); return ok ? { ok: true } : { ok: false, code: 'network' }; } };
  w.tick = () => watchTick(w.env); w.texts = () => w.sends.filter(s => s.ok).map(s => s.t);
  return w;
}
const ETH = { formId: 'f1', symbol: 'ETH', dir: 'LONG', entry: '2000', qty: '0.15', leverage: '3', margin: '100', stop: '1970', tp1: '2045', tp2: '2060' };
const userErr = (fn, re) => assert.throws(fn, e => e instanceof StoreError && (e.code === 'USER' || e.code === 'VALIDATION') && re.test(e.message));

test('종목 입력 정규화: BTC / btcusdt / BTC-USDT-SWAP / BTCUSDT.P / 1000PEPE → USDT 선물 형식, 잘못된 형식은 거부', () => {
  for (const [i, o] of [['btc', 'BTCUSDT'], ['BTCUSDT', 'BTCUSDT'], ['btc/usdt', 'BTCUSDT'], ['BTC-USDT-SWAP', 'BTCUSDT'], ['ethusdt.p', 'ETHUSDT'], ['SOLUSDT Perp', 'SOLUSDT'], ['1000pepe', '1000PEPEUSDT'], [' doge ', 'DOGEUSDT']]) assert.equal(manualSymbol(i), o, i);
  for (const bad of ['', '  ', 'a', '비트코인', 'X'.repeat(30)]) userErr(() => manualSymbol(bad), /종목|지원/);
});
test('COIN RADAR 추천이 아니어도 어떤 지원 종목이든 등록된다 · 체결+수동 등록 두 기록 · 수량/증거금 자동 계산', () => {
  const w = world(); assert.equal(storeList(w.se, 'signal').length, 0);
  const r = manualRegister(w.reg(), ETH); assert.equal(r.status, 'added'); assert.equal(r.sid, 'M-ETH-L-f1'); assert.equal(r.symbolId, 'ETHUSDT');
  assert.equal(storeList(w.se, 'fill').length, 1); assert.equal(storeList(w.se, 'manualpos').length, 1);
  const f = storeList(w.se, 'fill')[0].data; assert.deepEqual([f.origin, f.kind, f.dir, f.price, f.qty, f.leverage, f.margin, f.plannedStop], ['real', 'entry', 'LONG', '2000', '0.15', '3', '100', '1970']);
  const d = manualRegister(w.reg(), { formId: 'f2', symbol: 'sol', dir: 'SHORT', entry: '150', margin: '30', leverage: '3', stop: '155' }); assert.equal(d.qtySource, 'derived'); assert.equal(d.qty, '0.6');       // 30×3÷150
  const q = manualRegister(w.reg(), { formId: 'f3', symbol: 'XRP', dir: 'LONG', entry: '0.5', qty: '100', leverage: '2', stop: '0.45' }); assert.equal(q.margin, '25');                        // 0.5×100÷2
  assert.deepEqual(manualOpenList(w.se).map(p => p.symbolId), ['ETHUSDT', 'SOLUSDT', 'XRPUSDT']);
});
test('검증: 손절 필수 · 방향별 손절/익절 위치 · 익절 순서 · 수량·증거금 중 하나 · 레버리지 범위', () => {
  const w = world(), reg = f => manualRegister(w.reg(), { ...ETH, ...f });
  userErr(() => reg({ stop: '' }), /손절가를 입력/); userErr(() => reg({ stop: '2010' }), /LONG 손절가는 진입가보다 아래/); userErr(() => reg({ dir: 'SHORT', stop: '1970' }), /SHORT 손절가는 진입가보다 위/);
  userErr(() => reg({ tp1: '1990' }), /1차 익절가는 진입가보다 위/); userErr(() => reg({ tp1: '2060', tp2: '2045' }), /더 멀어야/); userErr(() => reg({ tp1: '', tp2: '2060' }), /1차부터/);
  userErr(() => reg({ qty: '', margin: '' }), /수량 또는 증거금/); userErr(() => reg({ leverage: '0' }), /레버리지/); userErr(() => reg({ leverage: '200' }), /125/); userErr(() => reg({ entry: 'abc' }), /진입가/); userErr(() => reg({ dir: 'UP' }), /LONG 또는 SHORT/);
  assert.equal(storeList(w.se, 'fill').length, 0); assert.equal(storeList(w.se, 'manualpos').length, 0);                                    // 검증 실패 시 아무것도 저장하지 않는다
});
test('규칙 경고(차단 아님): 레버리지 3배 초과 · 위험 1.5% 초과 · 청산가가 손절보다 먼저', () => {
  const w = world({ challenge: true });
  const r = manualRegister(w.reg(), { ...ETH, leverage: '20', qty: '1', margin: '100', stop: '1900' }); assert.equal(r.status, 'added');
  assert.ok(r.warnings.some(x => /20배/.test(x))); assert.ok(r.warnings.some(x => /1\.5% 한도/.test(x))); assert.ok(r.flags.includes('risk-over-2pct'));
  const s = manualRegister(w.reg(), { formId: 'g', symbol: 'BTC', dir: 'LONG', entry: '100', qty: '1', leverage: '20', stop: '90' }); assert.ok(s.warnings.some(x => /청산가/.test(x)));
});
test('중복 방지: 같은 폼 재제출은 1건 · 같은 종목 이중 등록 거부(force 로만) · 동시 보유 상한', () => {
  const w = world(); manualRegister(w.reg(), ETH); const again = manualRegister(w.reg(), ETH); assert.equal(again.status, 'duplicate'); assert.equal(storeList(w.se, 'fill').length, 1);
  w.now += 60000; assert.equal(manualRegister(w.reg(), ETH).status, 'duplicate');                                                                // 시각이 달라도(재시도) 같은 기록
  userErr(() => manualRegister(w.reg(), { ...ETH, formId: 'other' }), /이미 보유 중/); assert.equal(manualRegister(w.reg(), { ...ETH, formId: 'other', force: true }).status, 'added');
  const x = world(); for (let i = 0; i < 10; i++) manualRegister(x.reg(), { ...ETH, formId: 'a' + i, symbol: 'T' + String.fromCharCode(65 + i) + 'C' });
  userErr(() => manualRegister(x.reg(), { ...ETH, formId: 'z', symbol: 'ZZZ' }), /10개까지/);
});
test('종목 확인: 두 시세 출처 모두 "없음"이면 등록 거부 · 응답을 못 받으면 경고와 함께 허용', () => {
  const w = world(); w.check = 'unknown'; userErr(() => manualRegister(w.reg(), ETH), /찾지 못했습니다/); assert.equal(storeList(w.se, 'manualpos').length, 0);
  w.check = 'unverified'; const r = manualRegister(w.reg(), ETH); assert.ok(r.warnings.some(x => /확인하지 못했습니다/.test(x))); assert.equal(storeList(w.se, 'manualpos')[0].data.symbolCheck, 'unverified');
  assert.equal(watchSymbolVerdict({ code: '0', data: [{ last: '1', ts: '1' }] }, null), 'ok'); assert.equal(watchSymbolVerdict({ code: '51001', data: [] }, { retCode: 0, result: { list: [] }, time: 1 }), 'unknown');
  assert.equal(watchSymbolVerdict({ code: '51001', data: [] }, null), 'unverified'); assert.equal(watchSymbolVerdict(null, null), 'unverified');
  assert.equal(watchSymbolVerdict(null, { retCode: 0, result: { list: [{ lastPrice: '5' }] }, time: 1 }), 'ok');
});
test('손절·익절 수정: 손절은 좁히기만(넓히기 거부) · 익절은 자유 · 방향 검사 · 이력 보존', () => {
  const w = world(); manualRegister(w.reg(), ETH);
  userErr(() => manualUpdate(w.reg(), 'M-ETH-L-f1', { stop: '1950' }), /넓힐 수 없습니다/); userErr(() => manualUpdate(w.reg(), 'M-ETH-L-f1', { tp1: '1999' }), /익절가는 진입가보다 위/);
  assert.equal(manualUpdate(w.reg(), 'M-ETH-L-f1', { stop: '1990' }).stop, '1990'); assert.equal(manualUpdate(w.reg(), 'M-ETH-L-f1', { stop: '1990' }).status, 'unchanged');
  const u = manualUpdate(w.reg(), 'M-ETH-L-f1', { tp1: '2050', tp2: '' }); assert.deepEqual([u.tp1, u.tp2], ['2050', null]);
  assert.equal(storeHistory(w.se, 'manualpos', 'M-ETH-L-f1').length, 3); userErr(() => manualUpdate(w.reg(), 'nope', { stop: '1' }), /수동 등록/);
});
test('등록된 실제 보유 포지션만 감시: 미등록 종목 0 · 청산되면 감시 종료와 상태 정리', () => {
  const w = world(); w.mode = 'on'; assert.equal(w.tick().status, 'idle'); manualRegister(w.reg(), ETH);
  const r = w.tick(); assert.equal(r.status, 'ok'); assert.equal(r.positions, 1); assert.deepEqual(r.market.map(m => m.symbol), ['ETHUSDT']);
  storeCreate(w.se, 'fill', { origin: 'real', fillId: 'M-ETH-L-f1:out', sid: 'M-ETH-L-f1', kind: 'close', dir: 'LONG', at: T0 + 1, price: '2040', qty: '0.15', fee: { state: 'missing' }, funding: { state: 'missing' } }, { actor: 't' });
  assert.equal(w.tick().status, 'idle'); assert.ok(![...w.kv.keys()].some(k => k.startsWith('pos:')));
});
test('손절 접근 → 손절 이탈: 각각 한 번만 · critical · 모의 Telegram 본문에 종목/방향/손절가', () => {
  const w = world(); manualRegister(w.reg(), ETH);
  w.prices.ETHUSDT = 1985; assert.equal(w.tick().sent, 0);                                                    // 15 > 0.25R(7.5): 아직 접근 아님
  w.prices.ETHUSDT = 1975; const a = w.tick(); assert.equal(a.sent, 1); assert.match(w.texts()[0], /ETH LONG · ⚠️ 손절 임박/); assert.match(w.texts()[0], /현재 손절 기준: 1970\.00/);
  w.now += 300000; assert.equal(w.tick().sent, 0);                                                            // 5분 뒤 같은 상태: 중복 없음
  w.prices.ETHUSDT = 1968; const b = w.tick(); assert.equal(b.sent, 1); assert.match(w.texts()[1], /🛑 손절가 이탈/); assert.match(w.texts()[1], /아래로 넘었습니다/);
  w.now += 300000; assert.equal(w.tick().sent, 0); assert.equal(w.texts().length, 2); assert.ok(w.texts().every(t => /자동 주문 아님/.test(t)));
});
test('SHORT 포지션: 손절은 위쪽, 익절은 아래쪽', () => {
  const w = world(); w.prices = { SOLUSDT: 100 }; manualRegister(w.reg(), { formId: 's', symbol: 'SOL', dir: 'SHORT', entry: '100', qty: '3', leverage: '3', margin: '100', stop: '103', tp1: '97' });
  w.mk = sym => mkt(97, { bars1h: bars(100, { start: 100, drift: 0 }), bars4h: bars(100, { start: 100, drift: 0, step: 4 * H }) }); const a = w.tick(); assert.equal(a.byType.TP1, 1); assert.match(w.texts()[0], /SOL SHORT · 🎯 TP1/); assert.match(w.texts()[0], /1차 익절가 97\.000 도달/);
  w.mk = () => mkt(103.5, { bars1h: bars(100, { start: 100, drift: 0 }), bars4h: bars(100, { start: 100, drift: 0, step: 4 * H }) }); w.tick(); assert.ok(w.texts().some(t => /🛑 손절가 이탈/.test(t) && /위로 넘었습니다/.test(t)));
});
test('익절 도달: 사용자 지정 1차/2차 가격 기준 · 한 번만 · 청산 기록 뒤 같은 단계 재알림 없음 · 미지정이면 R 배수 기본값', () => {
  const w = world(); manualRegister(w.reg(), ETH);
  w.prices.ETHUSDT = 2050; assert.equal(w.tick().byType.TP1, 1); assert.match(w.texts()[0], /1차 익절가 2045\.00 도달/); w.now += 300000; assert.equal(w.tick().sent, 0);
  w.prices.ETHUSDT = 2065; w.now += 300000; const b = w.tick(); assert.equal(b.byType.TP2, 1); assert.ok(w.texts().some(t => /2차 익절가 2060\.00 도달/.test(t)));
  const d = world(); manualRegister(d.reg(), { ...ETH, tp1: '', tp2: '' }); d.prices.ETHUSDT = 2046; assert.equal(d.tick().byType.TP1, 1); assert.match(d.texts()[0], /\+1\.5R/);                         // 2000+1.5×30=2045
});
test('트레일링: 1차 청산 뒤 본전 안내 → 2차 청산 뒤 고점−1R 안내, 유리한 방향·0.25R 단위로만, 같은 값 중복 없음', () => {
  const w = world(); manualRegister(w.reg(), { ...ETH, at: '10-26 09:00' }); const red = (n, at) => storeCreate(w.se, 'fill', { origin: 'real', fillId: 'M-ETH-L-f1:r' + n, sid: 'M-ETH-L-f1', kind: 'reduce', dir: 'LONG', at, price: '2045', qty: '0.04', fee: { state: 'missing' }, funding: { state: 'missing' } }, { actor: 't' });
  red(1, T0 + 10); w.prices.ETHUSDT = 2050; const a = w.tick(); assert.equal(a.byType.TRAIL, 1); const t1 = w.texts().find(t => /추적손절 조정/.test(t)); assert.match(t1, /1차 청산 이후 손절을 평균 진입가\(본전\)로/); assert.match(t1, /2000\.00로 올리세요/);
  w.now += 300000; assert.equal(w.tick().sent, 0);
  manualUpdate(w.reg(), 'M-ETH-L-f1', { stop: '2000' }); w.now += 300000; assert.equal(w.tick().sent, 0);                  // 손절을 올린 뒤에는 같은 안내 없음(R 기준은 처음 손절 유지)
  red(2, T0 + 20); w.now += 300000; const c = w.tick(); assert.equal(c.byType.TRAIL, 1); const t2 = w.texts().filter(t => /추적손절 조정/.test(t))[1]; assert.match(t2, /2차 청산 이후 추적손절/); const px = Number(/Binance 손절 주문을 ([\d.]+)로/.exec(t2)[1]); assert.ok(px > 2000);
  w.now += 300000; assert.equal(w.tick().sent, 0);
});
test('시세 지연·API 장애: 낡은 시세는 알림 없이 건너뜀 · 연속 실패 3회 뒤 장애 알림 1회 · 복구 시 해제 · 일부 종목 실패 알림', () => {
  const w = world(); manualRegister(w.reg(), ETH); w.prices.ETHUSDT = 1968;
  w.mk = () => mkt(1968, { priceAt: w.now - 11 * 60000 }); const s = w.tick(); assert.equal(s.stale, 1); assert.equal(s.sent, 0); assert.equal(s.market[0].why, 'stale-price');
  w.mk = () => ({ ok: false, why: 'http 403' }); for (let i = 0; i < 3; i++) { w.now += 300000; w.tick(); } assert.equal(w.texts().filter(t => /시세 수집 장애/.test(t)).length, 1); w.now += 300000; w.tick(); assert.equal(w.texts().filter(t => /시세 수집 장애/.test(t)).length, 1);
  w.mk = null; w.now += 300000; assert.equal(w.tick().sent, 1); assert.ok(w.texts().some(t => /손절가 이탈/.test(t)));                                         // 복구되면 밀린 손절 이탈을 바로 알림
  const m = world(); manualRegister(m.reg(), ETH); manualRegister(m.reg(), { ...ETH, formId: 'b', symbol: 'SOL', entry: '100', qty: '1', stop: '95', tp1: '', tp2: '' }); m.prices = { ETHUSDT: 2010, SOLUSDT: 100 };
  m.mk = sym => (sym === 'SOLUSDT' ? { ok: false, why: 'http 500' } : mkt(2010, { priceAt: m.now - 60000 })); for (let i = 0; i < 3; i++) { m.now += 300000; m.tick(); }
  assert.equal(m.texts().filter(t => /시세 수집 실패 \(SOL\)/.test(t)).length, 1); m.now += 300000; m.tick(); assert.equal(m.texts().filter(t => /시세 수집 실패/.test(t)).length, 1);
});
test('전송 실패는 같은 본문으로 재시도되고 사용자에게는 한 번만 전달된다', () => {
  const w = world(); manualRegister(w.reg(), ETH); w.prices.ETHUSDT = 1968; w.sendOk = () => false; assert.equal(w.tick().failed, 1); w.sendOk = () => true; w.now += 2 * 60000 + 1000; const r = w.tick(); assert.equal(r.sent, 1); w.now += 300000; w.tick();
  assert.equal(w.texts().length, 1); assert.match(w.texts()[0], /손절가 이탈/);
});
test('일일 손실 한도(−3%) 보호: 한도 도달 시 한 번만 알리고 이후 같은 날 반복하지 않는다', () => {
  const w = world({ challenge: true }); manualRegister(w.reg(), { ...ETH, qty: '3', margin: '2000', leverage: '3', stop: '1900', tp1: '', tp2: '' }); w.prices.ETHUSDT = 1985;       // 평가손실 −45 (평가액 300 의 15%)
  const a = w.tick(); assert.equal(a.status, 'ok'); assert.equal(w.texts().filter(t => /일일 손실 한도\(−3%\)/.test(t)).length, 1); assert.match(w.texts().find(t => /일일 손실 한도/.test(t)), /신규 진입과 추가 진입을 중단/);
  w.now += 300000; w.tick(); w.now += 300000; w.tick(); assert.equal(w.texts().filter(t => /일일 손실 한도/.test(t)).length, 1);
  const ok = world({ challenge: true }); manualRegister(ok.reg(), { ...ETH, qty: '0.15', tp1: '', tp2: '' }); ok.prices.ETHUSDT = 1995; ok.tick(); assert.equal(ok.texts().filter(t => /일일 손실 한도/.test(t)).length, 0);
});
test('실행 시간 한도: 여러 종목 중 한도를 넘기면 나머지는 다음 실행으로 미루고 알려 준다', () => {
  const w = world(); for (const s of ['AAA', 'BBB', 'CCC']) manualRegister(w.reg(), { ...ETH, formId: s, symbol: s, entry: '100', qty: '1', margin: '30', stop: '95', tp1: '', tp2: '' });
  let c = 0; w.env.clock = () => (c += 100000); w.env.budgetMs = 150000; w.mk = () => mkt(100, { priceAt: w.now - 60000, bars1h: bars(100, { start: 100, drift: 0 }), bars4h: bars(100, { start: 100, drift: 0, step: 4 * H }) });
  const r = w.tick(); assert.ok(r.market.filter(m => m.why === 'time-budget').length >= 1); assert.ok(r.market.some(m => m.ok)); assert.equal(r.marketFail, r.market.filter(m => !m.ok).length);
});
test('일지에서도 수동 포지션의 종목이 보인다 · 추천 기록(signals)에는 섞이지 않는다', () => {
  const w = world({ challenge: true }); manualRegister(w.reg(), ETH);
  const j = journalBuild(w.reg(), { now: T0 + 1000 }); assert.equal(j.trades.length, 1); assert.equal(j.trades[0].symbol, 'ETH'); assert.equal(storeList(w.se, 'signal').length, 0);
});
test('같은 폼 id 로 내용을 바꿔 다시 보내면 조용히 중복 처리하지 않고 거부한다', () => {
  const w = world(); manualRegister(w.reg(), ETH); userErr(() => manualRegister(w.reg(), { ...ETH, entry: '2001' }), /같은 입력 id/); userErr(() => manualRegister(w.reg(), { ...ETH, stop: '1960' }), /같은 입력 id/);
  assert.equal(storeList(w.se, 'fill').length, 1);
});
