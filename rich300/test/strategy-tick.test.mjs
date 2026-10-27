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
const META = (ts, o = {}) => ({ runId: '9001', attempt: '1', ref: 'refs/heads/main', sha: 'a'.repeat(40), event: 'schedule', mode: 'once', at: String(ts - 30000), ...o });
const signFeed = (entries, { ts = CLOSE + 60000, key = KEY, meta = {} } = {}) => { const body = { entries, meta: META(ts, meta) }, nonce = 'n'.repeat(20); return JSON.stringify({ v: 1, ts, nonce, body, sig: hmac(key, authSignedString(1, ts, nonce, body)) }); };
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

test('피드 검증(서명 필수): 키 없음·짧은 키·서명 누락/불일치/변조·다른 출처(meta)·미래·오래됨·되돌림은 모두 거부 · 정상만 통과', () => {
  const env = { now: () => CLOSE + 120000, hmacSha256: hmac }, raw = signFeed([entry()]);
  const ok = feedVerify(env, raw, KEY); assert.equal(ok.ok, true); assert.equal(ok.signed, true); assert.equal(ok.entries.length, 1); assert.equal(ok.runId, '9001');
  assert.equal(feedVerify(env, raw, null).reason, 'no-key'); assert.equal(feedVerify(env, raw, undefined).reason, 'no-key'); assert.equal(feedVerify(env, raw, 'short').reason, 'no-key');                  // 키 없음/약함 → 반드시 거부(서명 검사 생략 없음)
  assert.equal(feedVerify(env, raw, 'x'.repeat(40)).reason, 'bad-signature'); assert.equal(feedVerify(env, raw.replace('"2000"', '"2001"'), KEY).reason, 'bad-signature');
  const msg = JSON.parse(raw); const unsigned = JSON.stringify({ v: msg.v, ts: msg.ts, nonce: msg.nonce, body: msg.body }); assert.equal(feedVerify(env, unsigned, KEY).reason, 'bad-format');                       // 서명 필드 누락
  assert.equal(feedVerify(env, JSON.stringify({ ...msg, sig: '0'.repeat(64) }), KEY).reason, 'bad-signature'); assert.equal(feedVerify(env, JSON.stringify({ ...msg, sig: 'zz' }), KEY).reason, 'bad-format');
  assert.equal(feedVerify(env, '{"v":2}', KEY).reason, 'bad-format'); assert.equal(feedVerify(env, 'nope', KEY).reason, 'bad-json'); assert.equal(feedVerify(env, 'x'.repeat(70000), KEY).reason, 'bad-size');
  assert.equal(feedVerify({ ...env, now: () => CLOSE + 40 * 60000 }, raw, KEY).reason, 'stale'); assert.equal(feedVerify({ ...env, now: () => CLOSE - 3600000 }, raw, KEY).reason, 'future-ts');
  const stalePub = signFeed([entry()], { ts: CLOSE + 100000, meta: { at: String(CLOSE - 40 * 60000) } }); assert.equal(feedVerify(env, stalePub, KEY).reason, 'stale');                                    // 게시는 최근이지만 radar 산출물이 오래됨
  for (const m of [{ ref: 'refs/heads/feature/x' }, { mode: 'preview' }, { event: 'push' }, { runId: 'abc' }, { at: 'x' }]) assert.equal(feedVerify(env, signFeed([entry()], { meta: m }), KEY).reason, 'bad-meta', JSON.stringify(m));
  assert.equal(feedVerify(env, JSON.stringify({ ...msg, body: { entries: msg.body.entries } }), KEY).reason, 'bad-signature');
  assert.equal(feedVerify(env, raw, KEY, { lastTs: msg.ts + 1 }).reason, 'replay'); assert.equal(feedVerify(env, raw, KEY, { lastTs: msg.ts }).ok, true); assert.equal(feedVerify(env, raw, KEY, { lastTs: msg.ts - 1 }).ok, true);   // 더 오래된 피드로 되돌리면 거부
  const bad = [entry({ sid: 'bad id' }), entry({ symbol: 'ETH' }), entry({ dir: 'UP' }), entry({ stop: '2010' }), entry({ entry: '-1' }), entry({ validUntil: String(CLOSE + 9 * 3600000) }), entry({ closeT: 'abc' }), null, 5];
  for (const e of bad) assert.equal(feedParseEntry(e).ok, false, JSON.stringify(e)); const good = feedParseEntry(entry()); assert.deepEqual([good.ok, good.kind, good.entry, good.stop, good.score], [true, 'candidate', 2000, 1970, 70]);
});
test('새 추천 → 전략 생성 → "[RICH300 신규 매매 전략]" 메시지 1건(모든 항목 포함) → 진입 대기 · 같은 피드를 다시 읽어도 중복 생성·전송 없음', () => {
  const w = world(); const r = w.at(5); assert.equal(r.status, 'ok'); assert.deepEqual([r.created, r.sent, r.feed.ok, r.feed.signed], [1, 1, true, true]);
  const t = w.texts()[0]; assert.match(t, /^\[RICH300 신규 매매 전략\]\n✅ 실행 가능 전략/); for (const re of [/추천 시각 \d\d:\d\d KST\(COIN RADAR\) → RICH300 전달 \d\d:\d\d KST · 지연 \d+분/, /남은 \d+분/, /ETH · LONG · 추천 점수 70/, /진입 근거/, /4H 상승/, /현재가 2005\.00 \(OKX /, /진입 유효 ~/, /1차 진입 구간 2000\.00/, /1차 \d+% · 2000\.00/, /2차 \d+% · 1991\.00/, /3차 \d+% · 1982\.00/, /손절 1970\.00/, /예상 최대 손실 −\d+\.\d+ USDT/, /TP1 2045\.00 \(\+1\.5R\) 50%/, /TP2 2060\.00 \(\+2R\) 30%/, /잔여 20% 최고\(최저\)−1R 추적/, /목표 손익비/, /수수료 −/, /슬리피지 −/, /무효화:/, /가상 추적 · 실제 Binance 체결 아님 · 자동 주문 아님/]) assert.match(t, re);
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
  const nk = world({ key: null }); const ws = world({ key: 'w'.repeat(10) }); assert.equal(ws.at(5).feed.code, 'no-key'); assert.equal(ws.rows().length, 0); assert.deepEqual([nk.at(5).created, nk.rows().length, nk.sends.length], [0, 0, 0]);                                  // 키가 없으면 피드를 거부: 전략·알림 없음
  assert.equal(JSON.parse(JSON.stringify(nk.at(6))).feed.code, 'no-key');
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
  assert.match(m.texts().at(-1), /^\[RICH300 실행 불가\]/); assert.match(m.texts().at(-1), /진입 추천이 아닙니다/); const nn = m.texts().length; m.at(15); assert.equal(m.texts().length, nn);
});
test('일일 손실 한도: 가상 손실이 −3%(−9 USDT)에 닿으면 이후 새 전략은 CANCELLED(day-loss-limit) 로 제외', () => {
  const w = world(); const all = [], bb = (C, k, o, h, l, c) => ({ t: CLOSE + (C + 15) * 60000 + k * M, o, h, l, c, v: 100 }), allBars = [];
  const mk = (i, C) => entry({ sid: `SG-ETH-L-aa${i}000`, score: '95', closeT: String(CLOSE + C * 60000), triggerT: String(CLOSE + (C - 15) * 60000), validUntil: String(CLOSE + (C + 45) * 60000) });
  const lose = (i, C) => { all.push(mk(i, C)); w.feedRaw = signFeed(all, { ts: CLOSE + (C + 3) * 60000 }); w.bars15 = allBars; const r = w.at(C + 5); assert.equal(r.created, 1, `#${i} ${JSON.stringify(r)}`); allBars.push(bb(C, 0, 2010, 2012, 1999, 2005), bb(C, 1, 2005, 2006, 1960, 1965)); w.at(C + 46); assert.equal(w.rows()[i - 1].state, 'STOP'); };
  lose(1, 0); lose(2, 120); const total2 = w.rows().reduce((a, r) => a + r.x.result.usdt, 0); assert.ok(total2 < -7 && total2 > -9, String(total2));                              // 아직 한도 전
  lose(3, 240); const total3 = w.rows().reduce((a, r) => a + r.x.result.usdt, 0); assert.ok(total3 <= -9, String(total3));
  all.push(mk(4, 360)); w.feedRaw = signFeed(all, { ts: CLOSE + 363 * 60000 }); const rr = w.at(365); assert.equal(rr.cancelled, 1); const row4 = w.rows()[3]; assert.deepEqual([row4.state, row4.x.reason], ['CANCELLED', 'day-loss-limit']);
  assert.match(w.texts().at(-1), /^\[RICH300 실행 불가\]/); assert.match(w.texts().at(-1), /일일 가상 손실 한도\(−3%\)/); assert.equal(w.texts().filter(t => /신규 매매 전략/.test(t)).length, 3);
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
test('되돌림(재사용) 차단: 이미 받은 것보다 오래된 피드는 새 전략을 만들지 않는다 · 같은 피드를 다시 읽는 것은 허용(중복 생성 없음)', () => {
  const w = world(); w.feedRaw = signFeed([], { ts: CLOSE + 4 * 60000 }); w.at(5); assert.equal(w.kv.get('sgfeedts'), String(CLOSE + 4 * 60000));
  w.feedRaw = signFeed([entry()], { ts: CLOSE + 2 * 60000 }); const r = w.at(6); assert.deepEqual([r.created, r.feed.code], [0, 'replay']); assert.equal(w.rows().length, 0); assert.equal(w.sends.length, 0);
  w.feedRaw = signFeed([entry()], { ts: CLOSE + 4 * 60000 }); assert.equal(w.at(7).created, 1); assert.equal(w.at(8).created, 0); assert.equal(w.rows().length, 1);
});
test('오래된 피드: 새 전략·알림 없음(radar 중단 의심) · 이미 만든 전략의 추적과 알림은 계속', () => {
  const w = world(); w.at(5); w.feedRaw = signFeed([entry({ sid: 'SG-ETH-L-zzz999' })], { ts: CLOSE + 30 * 60000, meta: { at: String(CLOSE - 60 * 60000) } }); w.bars15 = [b(0, 2010, 2012, 1999, 2005)];
  const r = w.at(31); assert.equal(r.feed.code, 'stale'); assert.equal(r.created, 0); assert.equal(w.rows().length, 1); assert.ok(r.events >= 1);
});
test('출처 불일치(다른 브랜치·preview·push 실행)·서명 누락 피드는 전략·알림 0', () => {
  const w = world(); for (const m of [{ ref: 'refs/heads/feature/x' }, { mode: 'preview' }, { event: 'push' }]) { w.feedRaw = signFeed([entry()], { meta: m }); const r = w.tick(60000); assert.deepEqual([r.created, r.feed.code], [0, 'bad-meta']); }
  const msg = JSON.parse(signFeed([entry()])); w.feedRaw = JSON.stringify({ v: 1, ts: msg.ts, nonce: msg.nonce, body: msg.body }); assert.equal(w.tick(60000).feed.code, 'bad-format'); assert.equal(w.rows().length, 0); assert.equal(w.sends.length, 0);
});
test('추천 지연·만료: 전달 지연 분과 남은 유효시간을 메시지에 표시 · 유효시간 임박 경고 · 이미 만료되어 도착하면 "실행 불가(전략 만료)" 안내 1건과 CANCELLED 기록', () => {
  const late = world(); late.feedRaw = signFeed([entry({ createdAt: String(CLOSE) })], { ts: CLOSE + 30 * 60000 }); late.at(36); const t = late.texts()[0]; assert.match(t, /지연 36분/); assert.match(t, /남은 9분 ⚠ 얼마 남지 않음/);
  const gone = world(); gone.feedRaw = signFeed([entry({ createdAt: String(CLOSE) })], { ts: CLOSE + 50 * 60000 }); const r = gone.at(50); assert.deepEqual([r.cancelled, r.created], [1, 0]); const row = gone.rows()[0]; assert.deepEqual([row.state, row.x.reason], ['CANCELLED', 'expired-on-arrival']);
  const n = gone.texts()[0]; assert.match(n, /^\[RICH300 실행 불가\]/); assert.match(n, /관찰 후보일 뿐 진입 추천이 아닙니다/); assert.match(n, /지연 50분/); assert.match(n, /전략 만료/); assert.ok(!/신규 매매 전략/.test(n)); gone.at(55); assert.equal(gone.texts().length, 1);
  const old = world(); old.feedRaw = signFeed([entry({ closeT: String(CLOSE - 5 * 3600000), triggerT: String(CLOSE - 5 * 3600000 - M), validUntil: String(CLOSE - 5 * 3600000 + 45 * 60000), createdAt: String(CLOSE - 5 * 3600000) })], { ts: CLOSE + 4 * 60000 }); old.at(5); assert.equal(old.texts().length, 0); assert.equal(old.rows()[0].state, 'CANCELLED');   // 아주 오래된 추천은 조용히 기록만
});
test('관찰 후보와 실행 가능 전략 구분: 위험 한도로 제외된 후보는 "신규 매매 전략"으로 안내하지 않는다', () => {
  const w = world(); const e = entry({ stop: '1999', sid: 'SG-ETH-L-near01' }); w.feedRaw = signFeed([e]); w.at(5); assert.equal(w.rows()[0].state, 'CANCELLED'); assert.equal(w.texts().length, 1); assert.ok(!/^\[RICH300 신규 매매 전략\]/.test(w.texts()[0]) && !/✅ 실행 가능 전략/.test(w.texts()[0])); assert.match(w.texts()[0], /실행 불가/); assert.match(w.texts()[0], /관찰 후보일 뿐 진입 추천이 아닙니다/);
});
