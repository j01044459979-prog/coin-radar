// 추천 전략 자동 추적 실행(strategyTick): 서명된 피드 → 전략 생성 → 신규 추천 메시지 1회 → 가상 진입·손절·익절 알림 → 종료. 메모리 저장소·가짜 시세·모의 전송(실제 Telegram 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { memEnv } from './helpers/memenv.mjs';
import { storeInit } from '../lib/store.mjs';
import { strategyTick, sgyList, STRAT } from '../lib/strategy.mjs';
import { feedVerify, feedParseEntry } from '../lib/feed.mjs';
import { authSignedString } from '../lib/auth.mjs';

const M = 900000, H = 3600000, T0 = Date.UTC(2026, 9, 26, 3, 0), CLOSE = T0, KEY = 'k'.repeat(40);
const hmac = (key, msg) => createHmac('sha256', key).update(msg, 'utf8').digest('hex');
const entry = (o = {}) => ({ sid: 'SG-ETH-L-abc123', symbol: 'ETHUSDT', dir: 'LONG', entry: '2000', stop: '1970', closeT: String(CLOSE), triggerT: String(CLOSE - M), validUntil: String(CLOSE + 45 * 60000), score: '70', rr1: '1.9', ref1: '2050', ref2: '2090', evidence: ['4H 상승 · 1H 지지 눌림', '15분 돌파 · 거래량 ×1.5'], volRel: '1.5', btcAlign: '동행', stageLabel: '진입 후보', costPct: '0.15', createdAt: String(CLOSE + 30000), ...o });
const signFeed = (entries, { ts = CLOSE + 60000, key = KEY } = {}) => { const body = { entries }, nonce = 'n'.repeat(20); return JSON.stringify({ v: 1, ts, nonce, body, sig: hmac(key, authSignedString(1, ts, nonce, body)) }); };
const bars = (n, { start, drift, step, now }) => Array.from({ length: n }, (_, i) => { const c = start * (1 + drift * i); return { t: now - (n - i) * step, o: c, h: c * 1.002, l: c * 0.998, c, v: 100 }; });
function world({ key = KEY } = {}) {
  const m = memEnv({ now: CLOSE, fixedClock: true }), se = m.env; storeInit(se);
  const w = { se, m, now: CLOSE + 5 * 60000, kv: new Map(), sends: [], sendOk: () => true, feedRaw: signFeed([entry()]), feedFail: null, bars15: [], price: 2005, mkFail: null, mode: 'on', key };
  w.market = sym => {
    if (w.mkFail) return w.mkFail; const floor = Math.floor(w.now / M) * M, closed = w.bars15.filter(b => b.t + M <= w.now);
    return { ok: true, source: 'OKX', price: w.price, priceAt: w.now - 30000, bars15m: closed.length ? closed : [{ t: floor - M, o: w.price, h: w.price, l: w.price, c: w.price, v: 1 }], bars1h: bars(100, { start: 1900, drift: 0.001, step: H, now: Math.floor(w.now / H) * H }), bars4h: bars(100, { start: 1590, drift: 0.003, step: 4 * H, now: Math.floor(w.now / (4 * H)) * 4 * H }) };
  };
  w.env = { now: () => w.now, mode: () => w.mode, storeEnv: () => se, kv: { get: k => (w.kv.has(k) ? w.kv.get(k) : null), put: (k, v) => w.kv.set(k, v), del: k => w.kv.delete(k), keys: () => [...w.kv.keys()] },
    market: sym => w.market(sym), send: t => { const ok = w.sendOk(t); w.sends.push({ ok, t, at: w.now }); return ok ? { ok: true } : { ok: false, code: 'network' }; },
    feed: () => (w.feedFail ? { ok: false, code: w.feedFail } : { ok: true, raw: w.feedRaw }), feedKey: () => w.key, hmacSha256: hmac };
  w.tick = (dt = 0) => { w.now += dt; return strategyTick(w.env); }; w.at = min => { w.now = CLOSE + min * 60000; return strategyTick(w.env); }; w.texts = () => w.sends.filter(s => s.ok).map(s => s.t); w.rows = () => sgyList(se);
  return w;
}
const b = (k, o, h, l, c) => ({ t: CLOSE + 15 * 60000 + k * M, o, h, l, c, v: 100 });

test('피드 검증: 서명 · 형식 · 시각 · 항목 점검 (키가 있으면 서명 필수 · 위조·변조 거부)', () => {
  const env = { now: () => CLOSE + 120000, hmacSha256: hmac }, raw = signFeed([entry()]);
  const ok = feedVerify(env, raw, KEY); assert.equal(ok.ok, true); assert.equal(ok.signed, true); assert.equal(ok.entries.length, 1); assert.equal(ok.stale, false);
  assert.equal(feedVerify(env, raw, 'x'.repeat(40)).reason, 'bad-signature'); assert.equal(feedVerify(env, raw.replace('"2000"', '"2001"'), KEY).reason, 'bad-signature');           // 내용 변조
  assert.equal(feedVerify(env, raw, null).signed, false);                                                                                                                              // 키 미설정: 서명 없이 받되 '미서명'
  assert.equal(feedVerify(env, '{"v":2}', KEY).reason, 'bad-format'); assert.equal(feedVerify(env, 'nope', KEY).reason, 'bad-json'); assert.equal(feedVerify(env, 'x'.repeat(70000), KEY).reason, 'bad-size');
  assert.equal(feedVerify({ ...env, now: () => CLOSE + 40 * 60000 }, raw, KEY).stale, true); assert.equal(feedVerify({ ...env, now: () => CLOSE - 3600000 }, raw, KEY).reason, 'future-ts');
  const bad = [entry({ sid: 'bad id' }), entry({ symbol: 'ETH' }), entry({ dir: 'UP' }), entry({ stop: '2010' }), entry({ entry: '-1' }), entry({ validUntil: String(CLOSE + 9 * 3600000) }), entry({ closeT: 'abc' }), null, 5];
  for (const e of bad) assert.equal(feedParseEntry(e).ok, false, JSON.stringify(e)); const good = feedParseEntry(entry()); assert.deepEqual([good.ok, good.kind, good.entry, good.stop, good.score], [true, 'candidate', 2000, 1970, 70]);
});
test('새 추천 → 전략 생성 → "[RICH300 신규 매매 전략]" 메시지 1건(모든 항목 포함) → 진입 대기 · 같은 피드를 다시 읽어도 중복 생성·전송 없음', () => {
  const w = world(); const r = w.at(5); assert.equal(r.status, 'ok'); assert.deepEqual([r.created, r.sent, r.feed.ok, r.feed.signed], [1, 1, true, true]);
  const t = w.texts()[0]; assert.match(t, /^\[RICH300 신규 매매 전략\]/); for (const re of [/ETH · LONG · 추천 점수 70/, /진입 근거/, /4H 상승/, /현재가 2005\.00 \(OKX /, /진입 유효: ~/, /1차 진입 구간 2000\.00/, /1차 \d+% · 2000\.00/, /2차 \d+% · 1991\.00/, /3차 \d+% · 1982\.00/, /손절 1970\.00/, /예상 최대 손실 −\d+\.\d+ USDT/, /TP1 2045\.00 \(\+1\.5R\) 50%/, /TP2 2060\.00 \(\+2R\) 30%/, /잔여 20% 최고\(최저\)−1R 추적/, /목표 손익비/, /수수료 −/, /슬리피지 −/, /무효화:/, /가상 추적 · 실제 Binance 체결 아님 · 자동 주문 아님/]) assert.match(t, re);
  const row = w.rows()[0]; assert.equal(row.state, 'WAIT_ENTRY'); assert.equal(row.x.startT, CLOSE + 15 * 60000);
  assert.deepEqual([w.at(10).created, w.at(15).sent], [0, 0]); assert.equal(w.texts().length, 1); assert.equal(w.rows().length, 1);
});
test('미리보기(preview): 계산만 — 저장·전송·상태 쓰기 없음', () => {
  const w = world(); w.mode = 'preview'; const r = w.at(5); assert.equal(r.mode, 'preview'); assert.equal(r.created, 1); assert.equal(w.rows().length, 0); assert.equal(w.sends.length, 0); assert.equal(w.kv.size, 0);
  w.mode = 'off'; assert.deepEqual(w.at(10), { status: 'off' });
});
test('피드 장애·위조: 피드를 못 가져오거나 서명이 틀리면 새 전략 0 · 기존 전략 추적은 계속', () => {
  const w = world(); w.feedFail = 'http-503'; const a = w.at(5); assert.deepEqual([a.created, a.feed.ok, a.feed.code], [0, false, 'http-503']); w.feedFail = null; w.feedRaw = signFeed([entry()], { key: 'z'.repeat(40) }); const b2 = w.at(6); assert.deepEqual([b2.created, b2.feed.code], [0, 'bad-signature']);
  w.feedRaw = signFeed([entry()]); assert.equal(w.at(7).created, 1); w.feedFail = 'timeout'; w.bars15 = [b(0, 2010, 2012, 1999, 2005)]; const c = w.at(31); assert.equal(c.feed.ok, false); assert.ok(c.events >= 1);          // 피드 장애 중에도 진입 알림
  const nk = world({ key: null }); assert.equal(nk.at(5).feed.signed, false); assert.equal(nk.rows().length, 1);
});
test('전체 생애주기: 진입 대기 → 진입 → TP1 → TP2 → 트레일링 → 추적 손절 종료, 알림은 각각 1회 · 최종 가상 성적 · 재실행 중복 없음', () => {
  const w = world(); w.at(5); const sent = () => w.texts().map(t => t.split('\n')[0].replace('[RICH300 전략] ', ''));
  w.price = 2040; w.at(7); assert.ok(!sent().some(x => /진입 구간 접근/.test(x))); w.price = 2004; w.at(10); assert.ok(sent().some(x => /진입 구간 접근/.test(x)));
  w.bars15 = [b(0, 2010, 2012, 1999, 2005)]; w.price = 2005; w.at(31); assert.ok(sent().some(x => /✅ 진입 조건 충족\(가상 진입\)/.test(x))); assert.equal(w.rows()[0].state, 'ENTRY_TRIGGERED');
  assert.match(w.texts().find(t => /진입 조건 충족/.test(t)), /실제 Binance 주문이 체결됐다는 뜻이 아닙니다/);
  w.bars15.push(b(1, 2005, 2048, 2003, 2046)); w.price = 2046; w.at(46); assert.ok(sent().some(x => /TP1 도달/.test(x))); assert.ok(sent().some(x => /손절 본전 이동 제안/.test(x)));
  w.bars15.push(b(2, 2046, 2065, 2044, 2062)); w.price = 2062; w.at(61); assert.ok(sent().some(x => /TP2 도달/.test(x))); assert.ok(sent().some(x => /트레일링 기준 변경/.test(x)));
  w.bars15.push(b(3, 2062, 2090, 2060, 2088)); w.price = 2088; w.at(76); assert.equal(w.rows()[0].state, 'TRAILING');
  w.bars15.push(b(4, 2088, 2089, 2050, 2052)); w.price = 2052; w.at(91); const row = w.rows()[0]; assert.equal(row.state, 'STOP'); assert.ok(row.x.result.usdt > 0);
  const last = w.texts().at(-1); assert.match(last, /🛑 손절 조건 충족\(가상 손절\)/); assert.match(last, /추적 손절/); assert.match(last, /최종 가상 성적: \+/);
  const n = w.texts().length; for (const m of [96, 101, 106]) w.at(m); assert.equal(w.texts().length, n);
  assert.equal(new Set(w.texts()).size, w.texts().length);        // 같은 본문이 두 번 나간 적 없음
  const single = ['진입 구간 접근', '진입 조건 충족', 'TP1 도달', 'TP2 도달', '손절 본전 이동 제안', '손절 조건 충족']; for (const h of single) assert.equal(w.texts().filter(t => t.split('\n')[0].includes(h)).length, 1, h);
  assert.ok(w.texts().every(t => /가상 추적 · 실제 Binance 체결 아님/.test(t)));
});
test('손절 시나리오: 손절 접근(시세) → 손절 조건 충족 한 번 · 최종 가상 손실 · 이후 알림 없음', () => {
  const w = world(); w.at(5); w.bars15 = [b(0, 2010, 2012, 1999, 2005)]; w.at(31); w.price = 1975; w.at(36); assert.ok(w.texts().some(t => /손절 접근/.test(t)));
  w.bars15.push(b(1, 2005, 2006, 1968, 1972)); w.price = 1972; w.at(46); const row = w.rows()[0]; assert.equal(row.state, 'STOP'); assert.ok(row.x.result.usdt < 0 && row.x.result.r < 0); assert.match(w.texts().at(-1), /최종 가상 성적: −/);
  const n = w.texts().length; w.at(51); w.at(56); assert.equal(w.texts().length, n);
});
test('진입 대기 중 무효화·만료도 기록하고 알린다: TP1 선도달 / 유효시간 경과', () => {
  const a = world(); a.at(5); a.bars15 = [b(0, 2020, 2050, 2010, 2048)]; a.at(31); assert.equal(a.rows()[0].state, 'INVALIDATED'); assert.match(a.texts().at(-1), /전략 무효화/); assert.match(a.texts().at(-1), /TP1 가격이 먼저 닿음/);
  const e = world(); e.at(5); e.bars15 = [b(0, 2020, 2030, 2010, 2025), b(1, 2025, 2031, 2012, 2028), b(2, 2028, 2032, 2015, 2030)]; e.at(61); assert.equal(e.rows()[0].state, 'EXPIRED'); assert.match(e.texts().at(-1), /전략 만료/); assert.match(e.texts().at(-1), /진입 없음/);
});
test('전송 장애: 신규 메시지 전송 실패 → 같은 본문 재시도(사용자에게 1번) · 계속 실패하면 유효시간 후 조용히 만료 · 전송 성공 기록이 남음', () => {
  const w = world(); w.sendOk = () => false; const a = w.at(5); assert.deepEqual([a.created, a.failed, a.sent], [1, 1, 0]); assert.equal(w.rows()[0].state, 'CANDIDATE');
  w.sendOk = () => true; const b2 = w.at(8); assert.equal(b2.sent, 1); assert.equal(w.rows()[0].state, 'WAIT_ENTRY'); assert.equal(w.texts().length, 1); assert.equal(w.sends.length, 2); assert.equal(w.sends[0].t, w.sends[1].t);
  const x = world(); x.sendOk = () => false; for (const m of [5, 8, 15, 30, 50]) x.at(m); assert.equal(x.rows()[0].state, 'EXPIRED'); assert.equal(x.texts().length, 0);
  const p = world(); p.at(5); const k = [...p.kv.keys()].find(q => q.startsWith('sg:')); assert.equal(JSON.parse(p.kv.get(k)).sent['NEW:SG-ETH-L-abc123'].st, 'sent'); assert.ok(![...p.kv.keys()].some(q => q.startsWith('pos:')));
});
test('시세 지연·API 장애: 낡은 시세/실패면 상태를 바꾸지 않고 알림도 없다 → 복구 후 놓친 봉을 이어서 처리(손절 판정 누락 없음)', () => {
  const w = world(); w.at(5); w.bars15 = [b(0, 2010, 2012, 1999, 2005)]; w.at(31); const n = w.texts().length;
  w.mkFail = { ok: false, why: 'http 503' }; w.bars15.push(b(1, 2005, 2006, 1960, 1965)); const f = w.at(46); assert.equal(f.marketFail, 1); assert.equal(w.texts().length, n); assert.equal(w.rows()[0].state, 'ENTRY_TRIGGERED');
  w.mkFail = null; w.at(51); assert.equal(w.rows()[0].state, 'STOP'); assert.ok(w.texts().length > n);
  const s = world(); s.at(5); const good = s.market; s.market = sym => ({ ...good(sym), priceAt: s.now - 11 * 60000 }); assert.equal(s.at(10).stale >= 1, true);
});
test('위험 한도: 동시 증거금 30% 초과 새 추천은 일반 추천으로 보내지 않고 "추천 제외" 안내 1건', () => {
  const m = world(); m.at(5); const e2 = entry({ sid: 'SG-ETH-L-ddd333', closeT: String(CLOSE + 10 * 60000), triggerT: String(CLOSE), validUntil: String(CLOSE + 55 * 60000) }); m.feedRaw = signFeed([entry(), e2]);
  const rr = m.at(10); const rows = m.rows(); assert.equal(rows.length, 2); assert.equal(rows[1].state, 'CANCELLED'); assert.equal(rows[1].x.reason, 'margin-cap-total'); assert.equal(rr.cancelled, 1);
  assert.match(m.texts().at(-1), /^\[RICH300 추천 제외\]/); assert.match(m.texts().at(-1), /일반 추천으로 보내지 않습니다/); const nn = m.texts().length; m.at(15); assert.equal(m.texts().length, nn);
});
test('일일 손실 한도: 가상 손실이 −3%(−9 USDT)에 닿으면 이후 새 전략은 CANCELLED(day-loss-limit) 로 제외', () => {
  const w = world(); const all = [], bb = (C, k, o, h, l, c) => ({ t: CLOSE + (C + 15) * 60000 + k * M, o, h, l, c, v: 100 }), allBars = [];
  const mk = (i, C) => entry({ sid: `SG-ETH-L-aa${i}000`, score: '95', closeT: String(CLOSE + C * 60000), triggerT: String(CLOSE + (C - 15) * 60000), validUntil: String(CLOSE + (C + 45) * 60000) });
  const lose = (i, C) => { all.push(mk(i, C)); w.feedRaw = signFeed(all, { ts: CLOSE + (C + 3) * 60000 }); w.bars15 = allBars; const r = w.at(C + 5); assert.equal(r.created, 1, `#${i} ${JSON.stringify(r)}`); allBars.push(bb(C, 0, 2010, 2012, 1999, 2005), bb(C, 1, 2005, 2006, 1960, 1965)); w.at(C + 46); assert.equal(w.rows()[i - 1].state, 'STOP'); };
  lose(1, 0); lose(2, 120); const total2 = w.rows().reduce((a, r) => a + r.x.result.usdt, 0); assert.ok(total2 < -7 && total2 > -9, String(total2));                              // 아직 한도 전
  lose(3, 240); const total3 = w.rows().reduce((a, r) => a + r.x.result.usdt, 0); assert.ok(total3 <= -9, String(total3));
  all.push(mk(4, 360)); w.feedRaw = signFeed(all, { ts: CLOSE + 363 * 60000 }); const rr = w.at(365); assert.equal(rr.cancelled, 1); const row4 = w.rows()[3]; assert.deepEqual([row4.state, row4.x.reason], ['CANCELLED', 'day-loss-limit']);
  assert.match(w.texts().at(-1), /^\[RICH300 추천 제외\]/); assert.match(w.texts().at(-1), /일일 가상 손실 한도\(−3%\)/); assert.equal(w.texts().filter(t => /신규 매매 전략/.test(t)).length, 3);
});
test('분리: 추천 전략의 가상 성적은 실제 체결(Fills)·수동 포지션에 쓰이지 않는다 · 시트는 Strategies 한 곳', () => {
  const w = world(); w.at(5); w.bars15 = [b(0, 2010, 2012, 1999, 2005)]; w.at(31); assert.ok(w.m.sheets.has('Strategies')); assert.equal((w.m.sheets.get('Fills') || []).length, 0); assert.equal((w.m.sheets.get('ManualPositions') || []).length, 0);
  assert.equal(w.rows()[0].x.kind, 'virtual');
});
test('COIN RADAR 가 진입 전에 무효화하면 전략도 무효화(진입 후에는 전략 자체 규칙) · 중복 안내 없음', () => {
  const w = world(); w.at(5); const inv = { type: 'invalidated', sid: 'SG-ETH-L-abc123', at: String(CLOSE + 12 * 60000), reason: '구조 소멸' };
  w.feedRaw = signFeed([entry(), inv], { ts: CLOSE + 11 * 60000 }); w.at(12); assert.equal(w.rows()[0].state, 'INVALIDATED'); assert.equal(w.rows()[0].x.reason, 'radar-invalidated'); assert.match(w.texts().at(-1), /COIN RADAR 가 이 추천을 무효화/); const n = w.texts().length; w.at(17); assert.equal(w.texts().length, n);
  const e = world(); e.at(5); e.bars15 = [b(0, 2010, 2012, 1999, 2005)]; e.at(31); e.feedRaw = signFeed([entry(), inv], { ts: CLOSE + 31 * 60000 }); e.at(32); assert.equal(e.rows()[0].state, 'TRACKING');
});
