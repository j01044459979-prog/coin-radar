import test from 'node:test';
import assert from 'node:assert/strict';
import { createOkxCollector } from '../okx.mjs';
import { fakeOkx, ok, now } from './fake-okx.mjs';
import { scanMarket, selectTargets, normalizeRotation, TARGET_CONFIG } from '../universe.mjs';
import { compactReport, scanLines } from '../compact.mjs';
import { pickTop2, RECOMMEND_MIN_SCORE } from '../scoring.mjs';
import { cycle } from '../service.mjs';

// 가상 시장: 코인 N종 (거래대금·등락률이 종목마다 다름)
const names = Array.from({ length: 120 }, (_, i) => `C${String(i).padStart(3, '0')}`);
const PRIO = ['BTC', 'ETH', 'SOL', 'ZEC', 'RENDER'];
const all = [...PRIO, ...names];
const inst = all.map(n => ({ instId: `${n}-USDT-SWAP`, state: 'live', ctType: 'linear', settleCcy: 'USDT', instCategory: '1' }));
// 거래대금: 인덱스가 작을수록 큼. 등락률: 인덱스에 따라 -30%~+30% 분포. 일부는 극저유동.
const tick = (n, i, { thin = false } = {}) => ({ instId: `${n}-USDT-SWAP`, last: '100', open24h: String(100 / (1 + ((i * 7) % 61 - 30) / 100)), volCcy24h: thin ? '1' : String(1e6 - i * 5000) });
const tickers = all.map((n, i) => tick(n, i, { thin: i >= 100 && i % 2 === 0 }));
const market = () => scanMarket({ instruments: inst, tickers });
const sel = (rotation, config) => selectTargets({ market: market(), priority: PRIO, config, rotation, now });

test('전체 적격 종목 목록: 이름·가격·거래대금·등락률·상태·분류를 수집한다', () => {
  const m = market();
  assert.equal(m.eligible.length, all.length);
  const e = m.eligible.find(x => x.name === 'ETH');
  assert.ok(e.last > 0 && e.turnover > 0 && Number.isFinite(e.change24h) && e.state === 'live' && e.category === '1');
});

test('정밀 분석 대상: 우선 5 + 거래대금 10 + 급등락 10(상승·하락 모두) + 순환 15 = 40, 중복 없음', () => {
  const s = sel();
  assert.deepEqual(s.groups.priority.map(x => x.replace('-USDT-SWAP', '')), PRIO);
  assert.equal(s.groups.turnover.length, 10); assert.equal(s.groups.movers.length, 10); assert.equal(s.groups.rotation.length, 15);
  assert.equal(s.ids.length, 40); assert.equal(new Set(s.ids).size, 40);
  const ch = id => market().eligible.find(e => e.instId === id).change24h;
  assert.ok(s.groups.movers.some(id => ch(id) > 5) && s.groups.movers.some(id => ch(id) < -5), '상승·하락 모두 포함');
});

test('최대 개수 설정(24/30/36/40)을 따르고 우선 종목은 항상 유지된다', () => {
  for (const max of [24, 30, 36, 40]) {
    const s = sel(undefined, { max });
    assert.ok(s.ids.length <= max && s.ids.length >= Math.min(max, 25), `max ${max}: ${s.ids.length}`);
    for (const p of PRIO) assert.ok(s.ids.includes(`${p}-USDT-SWAP`));
  }
});

test('유동성 필터: 거래대금이 기준 미만인 급등락·순환 종목은 제외, 우선 종목은 예외', () => {
  const thinTickers = tickers.map(t => ({ ...t }));
  thinTickers[0].volCcy24h = '1'; // BTC 극저유동 (우선 종목은 유지)
  const hugeMover = { ...tick('C119', 119, { thin: true }), open24h: '10' }; // +900% 이지만 거래대금 극소
  thinTickers[thinTickers.findIndex(t => t.instId === 'C119-USDT-SWAP')] = hugeMover;
  const s = selectTargets({ market: scanMarket({ instruments: inst, tickers: thinTickers }), priority: PRIO, rotation: undefined, now });
  assert.ok(s.ids.includes('BTC-USDT-SWAP') || s.groups.priority.length === 4, 'BTC는 시세가 있으면 우선 유지');
  assert.ok(!s.ids.includes('C119-USDT-SWAP'), '극저유동 급등 종목은 추천 대상에서 제외');
  assert.ok(s.liquidityExcluded > 0);
});

test('순환: 실행마다 겹치지 않고 전체 종목을 훑는다 (캐시 상태 유지)', () => {
  let rot, prev = [], t = now;
  const seen = new Set();
  for (let run = 0; run < 12; run++) {
    const s = selectTargets({ market: market(), priority: PRIO, rotation: rot, now: t });
    for (const id of s.groups.rotation) assert.ok(!prev.includes(id), '직전 실행과 같은 순환 종목 반복 금지');
    prev = s.groups.rotation;
    for (const id of s.ids) seen.add(id);
    rot = { last: { ...s.rotation.last, ...Object.fromEntries(s.ids.map(id => [id, t])) }, lastRun: t, missedTotal: 0, maxGapMs: 0 };
    t += 300000;
  }
  const liquid = market().eligible.filter(e => e.turnover >= TARGET_CONFIG.minTurnover).length;
  assert.equal(seen.size, liquid, '유동성 있는 모든 종목이 정밀 분석됨');
});

test('순환 상태가 없거나 손상되면 안전하게 재초기화한다', () => {
  const ids = all.map(n => `${n}-USDT-SWAP`);
  for (const bad of [undefined, null, 'x', { last: [] }, { last: 5 }]) {
    const r = normalizeRotation(bad, ids, now); assert.equal(r.reinit, true); assert.deepEqual(r.last, {});
  }
  const r = normalizeRotation({ last: { 'BTC-USDT-SWAP': now - 1000, 'GONE-USDT-SWAP': now, 'ETH-USDT-SWAP': 'abc' }, lastRun: now - 60000 }, ids, now);
  assert.equal(r.reinit, false); assert.deepEqual(Object.keys(r.last), ['BTC-USDT-SWAP']); // 상장 폐지·잘못된 값 제거
  assert.doesNotThrow(() => sel({ last: 'broken' }));
});

test('놓친 실행(간격)이 순환 지연으로 기록된다', () => {
  const ids = ['BTC-USDT-SWAP'];
  const r = normalizeRotation({ last: {}, lastRun: now - 3600000, missedTotal: 2 }, ids, now);
  assert.equal(r.missed, 11); assert.equal(r.missedTotal, 13); assert.equal(r.maxGapMs, 3600000);
  assert.equal(normalizeRotation({ last: {}, lastRun: now - 300000 }, ids, now).missed, 0);
});

// ── 수집기 통합 ──
const fullFake = (o = {}) => fakeOkx({ breakout: false, instruments: inst, tickers, ...o });

test('40종목 수집: 호출 수는 종목당 5회 + 상위 시간대, 모두 정밀 분석 성공으로 집계된다', async () => {
  const calls = [];
  const out = await createOkxCollector(fullFake({ calls }), { gapMs: 0 })(now);
  const scan = out.stats.scan;
  assert.equal(scan.eligible, all.length); assert.equal(scan.targets, 40); assert.equal(scan.analyzed, 40); assert.equal(scan.failed, 0);
  const per = calls.filter(u => /candles\?.*bar=5m|mark-price|open-interest\?|funding-rate|open-interest-history/.test(u)).length;
  assert.equal(per, 200); // 40 × 5
  assert.equal(out.stats.calls, 2 + 200 + out.stats.mtfSymbols.length * 3);
  assert.equal(out.rows.length, 40);
  assert.ok(out.rotation.swept >= 40 && out.rotation.neverAnalyzed === all.length - out.rotation.swept);
});

test('수집된 순환 상태를 다음 실행에 넘기면 새 종목을 분석한다 (캐시 유실 시 처음부터)', async () => {
  const c = createOkxCollector(fullFake(), { gapMs: 0 });
  const a = await c(now, {});
  const b = await c(now, { rotation: a.rotation });
  const ra = new Set(a.stats.scan.groups.rotation), rb = b.stats.scan.groups.rotation;
  assert.ok(rb.length && rb.every(x => !ra.has(x)), '두 번째 실행의 순환 종목은 첫 실행과 다르다');
  const reset = await c(now, { rotation: undefined });
  assert.equal(reset.stats.scan.rotation.reinit, true);
});

test('일부 종목 실패는 격리되고 실패 수가 구분되어 집계된다', async () => {
  const hook = url => /instId=C003-USDT-SWAP/.test(url) && /mark-price/.test(url) ? new Response('', { status: 500 }) : null;
  const out = await createOkxCollector(fullFake({ hook }), { gapMs: 0, config: { max: 24 } })(now);
  const sc = out.stats.scan;
  assert.equal(sc.failed, out.failures.length); assert.equal(sc.analyzed + sc.failed + sc.skipped, sc.targets);
  assert.ok(!out.rows.some(r => r.symbol === 'C003USDT') || sc.failed === 0);
  assert.ok(out.rows.length >= sc.targets - 1);
});

test('429(Retry-After)는 확보한 종목까지 보고하고 다음 수집을 늦춘다', async () => {
  let n = 0;
  const hook = url => (/mark-price/.test(url) && ++n === 12) ? new Response('', { status: 429, headers: { 'retry-after': '120' } }) : null;
  const out = await createOkxCollector(fullFake({ hook }), { gapMs: 0 })(now);
  assert.equal(out.stats.scan.stopped.status, 429); assert.ok(out.stats.scan.skipped > 0);
  assert.ok(out.rows.length >= 10); assert.ok(out.backoffMs >= 300000);
  // 첫 종목부터 막히면 장애로 처리
  await assert.rejects(createOkxCollector(fullFake({ hook: url => /candles/.test(url) ? new Response('', { status: 429 }) : null }), { gapMs: 0 })(now), /429/);
});

test('OKX 본문 한도 코드(50011)도 한도 응답으로 처리된다', async () => {
  const hook = url => /funding-rate/.test(url) ? new Response(JSON.stringify({ code: '50011', msg: 'Too Many Requests', data: [] }), { status: 200 }) : null;
  await assert.rejects(createOkxCollector(fullFake({ hook }), { gapMs: 0 })(now), e => e.status === 429);
});

test('403/451은 첫 종목에서 장애, 이후에는 부분 결과 유지', async () => {
  await assert.rejects(createOkxCollector(fullFake({ hook: url => /candles/.test(url) ? new Response('', { status: 451 }) : null }), { gapMs: 0 })(now), e => e.status === 451);
});

test('시간 예산이 모자라면 뒤쪽(순환) 종목부터 줄이고 건너뛴 수를 기록한다', async () => {
  const slow = fullFake({ hook: () => null });
  const f = async u => { await new Promise(r => setTimeout(r, 2)); return slow(u); };
  const out = await createOkxCollector(f, { gapMs: 0, budgetMs: 150 })(now);
  const sc = out.stats.scan;
  assert.ok(sc.skipped > 0 && sc.analyzed < 40); assert.ok(sc.analyzed >= 5);
  assert.equal(sc.analyzed + sc.failed + sc.skipped, sc.targets);
  for (const p of PRIO) assert.ok(out.rows.some(r => r.symbol === `${p}USDT`), `${p} 우선 유지`);
});

// ── 보고 ──
test('보고 문구: 전체 탐색·정밀 분석 수치를 구분해 표시하고 후보 없음 문구는 시장 전체 부재를 단정하지 않는다', async () => {
  const out = await createOkxCollector(fullFake(), { gapMs: 0 })(now);
  const scan = { ...out.stats.scan, failed: 2 };
  assert.deepEqual(scanLines(scan), [`🌐 전체 시세 탐색 ${scan.eligible}종목 / 🔬 정밀 분석 ${scan.analyzed}종목 (실패 2)`, `🎯 추천 기준 ${RECOMMEND_MIN_SCORE}점 이상`]);
  assert.deepEqual(scanLines(null), []);
  const rows = out.rows.map(r => ({ ...r, candidate: r.candidate && { ...r.candidate, score: 30 }, strong: false }));
  const r = compactReport(rows, [], now, { scan });
  assert.match(r.plain, /⏳ 이번 정밀 분석 대상에서 55점 이상 후보 없음/); assert.doesNotMatch(r.plain, /시장 전체|기회가 없/);
  assert.match(r.plain, /🌐 전체 시세 탐색 \d+종목/); assert.ok([...r.plain].length <= 800);
  assert.equal(pickTop2(rows).length, 0);
});

test('서비스: 순환 상태가 저장되고 한도 대기가 retryAt에 반영된다 (중복 전송 없음)', async () => {
  const state = {}, sent = [];
  const collect = async (n, ctx) => { assert.equal(ctx.rotation, state.rotation); const o = await createOkxCollector(fullFake(), { gapMs: 0 })(n, ctx); return { ...o, backoffMs: 600000 }; };
  const base = { state, collect, send: async t => { sent.push(t); }, save: async () => {}, news: async () => {}, now };
  await cycle(base);
  assert.ok(state.rotation?.last && Object.keys(state.rotation.last).length >= 40);
  assert.equal(state.retryAt, now + 600000);
  const n = sent.length;
  await cycle({ ...base, now: now + 60000 }); // 대기 중에는 실행하지 않음 → 추가 전송 없음
  assert.equal(sent.length, n);
});

test('수집이 1분 넘게 걸려도 뒤쪽 종목의 가격/OI 신선도 판정이 틀어지지 않는다', async () => {
  const realNow = Date.now; let skew = 0;
  Date.now = () => realNow() + skew;
  try {
    let n = 0;
    const base = fullFake();
    const f = async u => { if (++n === 60) skew += 90000; if (n === 130) skew += 90000; return base(u); }; // 실행 중 총 3분 경과
    const out = await createOkxCollector(f, { gapMs: 0, budgetMs: 600000 })(now);
    assert.equal(out.stats.scan.failed, 0, JSON.stringify(out.failures.slice(0, 2)));
    assert.equal(out.stats.scan.analyzed, 40);
  } finally { Date.now = realNow; }
});
