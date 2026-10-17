import test from 'node:test';
import assert from 'node:assert/strict';
import { validate1H, evaluateDual, MIN_CANDLES } from '../dual/live.mjs';
import { dualReport } from '../dual/report.mjs';
import { makeRecord, appendRecords, updateOutcomes, summarize, SETTINGS_HASH, MAX_LOG } from '../dual/reclog.mjs';
import { createOkxCollector } from '../okx.mjs';
import { cycle } from '../service.mjs';
import { fakeOkx, now as NOW } from './fake-okx.mjs';

const H = 3600000;
const mk = (n, endT) => Array.from({ length: n }, (_, i) => { const m = 100 + i * 0.05 + Math.sin(i / 5); return { t: endT - (n - 1 - i) * H, o: m, h: m + 0.6, l: m - 0.6, c: m + 0.1, q: 1e6 }; });
const now = Math.floor(NOW / H) * H + 600000, lastT = Math.floor(now / H) * H - H;

test('1시간봉 검증: 개수·연속성·최신성', () => {
  assert.equal(validate1H(mk(MIN_CANDLES, lastT), now), null);
  assert.match(validate1H(mk(100, lastT), now), /필요/);
  const gap = mk(MIN_CANDLES + 1, lastT); gap.splice(50, 1); assert.match(validate1H(gap, now), /누락/);
  assert.match(validate1H(mk(MIN_CANDLES, lastT - 3 * H), now), /지연/);
  assert.equal(validate1H(mk(MIN_CANDLES, lastT - H), Math.floor(now / H) * H + 30000), null);   // 마감 직후 90초 유예
});
test('실시간 듀얼 평가: BTC가 없거나 지연이면 시장 필터 실패 + 종목은 제외로 기록(가짜 평가 없음)', () => {
  const r = evaluateDual({ candlesBySymbol: { SOLUSDT: mk(MIN_CANDLES, lastT) }, now });
  assert.equal(r.gate.ok, false); assert.match(r.gate.reason, /BTC 데이터 부족/);
  const stale = evaluateDual({ candlesBySymbol: { BTCUSDT: mk(MIN_CANDLES, lastT), SOLUSDT: mk(MIN_CANDLES, lastT - 5 * H) }, now });
  assert.deepEqual(stale.skipped.map(s => s.symbol), ['SOLUSDT']); assert.equal(stale.evaluated, 1); assert.equal(stale.dataAsOf, lastT + H);
});
test('실시간 듀얼 평가: 정상 데이터에서 A·B 점수와 판정이 계산된다', () => {
  const r = evaluateDual({ candlesBySymbol: { BTCUSDT: mk(300, lastT), SOLUSDT: mk(300, lastT) }, now });
  assert.equal(r.evaluated, 2); for (const it of r.items) { assert.ok(Number.isFinite(it.a.score) && Number.isFinite(it.b.score)); assert.ok(['PRIORITY', 'INTEREST', 'WAIT', 'NONE'].includes(it.cls.verdict)); assert.equal(it.signalBarT, lastT); }
});

// ── 보고서 ──
const item = (symbol, verdict, dir, aScore, bScore, extra = {}) => ({ symbol, a: { dir, score: aScore, parts: { supertrend: { note: 'Supertrend(10,3) 상승 3봉째' }, ema200: { note: '종가 위 EMA200 (2.10%)' }, macd: { note: 'MACD(12,26,9) 히스토그램 + 확대' }, rsi: { note: 'RSI(14) 58.2' } }, supertrendLine: 95, age: 2 },
  b: { dir, score: bScore, level: 100, blockers: [], parts: { structure: { note: '20봉 고점 돌파 후 재테스트 지지 확인' }, relVolume: { note: '돌파 봉 거래대금 2.30배' }, btc: { note: 'BTC 1H 구조 상승' } }, plan: { room: 3 } },
  cls: { verdict, dir, label: '', reason: verdict === 'PRIORITY' ? 'A·B 동일' : 'A 전략 단독 신호(다른 전략은 기준 미달)' }, plan: { entry: 102, stop: 98, tp: 110, rr: 2, source: 'B' }, signalBarT: lastT, dataAsOf: lastT + H, price: 102, ...extra });
const res = (items, gate = { ok: true }) => ({ items, skipped: [], gate, btc: { dir: 'LONG' }, dataAsOf: lastT + H, evaluated: items.length });

test('보고서: 우선 후보에 종목·방향·A/B 점수와 근거·진입 조건·손절·목표·손익비·위험·무효화·추천/데이터 시각이 모두 들어간다', () => {
  const r = dualReport(res([item('SOLUSDT', 'PRIORITY', 'LONG', 82, 78), item('AVAXUSDT', 'INTEREST', 'SHORT', 76, 55), item('DOGEUSDT', 'WAIT', null, 60, 60)]), now, { eligible: 286 });
  for (const re of [/SOLUSDT · 롱 · 우선 추천 후보/, /전략 A\(지표\) 82점.*Supertrend\(10,3\)/, /전략 B\(자체\) 78점.*재테스트/, /진입 조건: .*100.*현재가 102/, /손절 98\.\d+ .*목표 110\.\d+ · 손익비 1:2\.0/, /무효화:/, /⚠️/, /추천 시각 .*KST · 데이터 기준 .*KST/, /승률이 아닌 조건 충족 점수/, /트레이딩뷰.*인기 순위.*검증 수익률이 아님/, /🌐 전체 시세 탐색 286종목 \/ 🔬 듀얼 평가 3종목/, /관심 종목[\s\S]*AVAXUSDT 숏/, /방향 충돌 관망 1종목/])
    assert.match(r.plain, re);
  assert.doesNotMatch(r.plain, /<\/?b>/); assert.match(r.text, /<b>SOLUSDT<\/b>/); assert.ok(r.visible < 3500, `길이 ${r.visible}`);
  assert.deepEqual(r.prioritySymbols, ['SOLUSDT']);
});
test('보고서: 우선 후보 0건 허용 — 시장 전체 부재를 단정하지 않고, 시장 필터 문구 표시, 최대 2건', () => {
  const none = dualReport(res([item('A1USDT', 'NONE', null, 10, 5)]), now, { eligible: 286 });
  assert.match(none.plain, /우선 추천 후보 없음/); assert.match(none.plain, /시장 전체에 기회가 없다는 뜻이 아님/); assert.doesNotMatch(none.plain, /🥇/);
  const bad = dualReport(res([item('A1USDT', 'INTEREST', 'LONG', 90, 90)], { ok: false, reason: 'BTC 변동성 과다(1시간 ATR 3.10%)' }), now, null);
  assert.match(bad.plain, /시장 상황 필터: BTC 변동성 과다/);
  const many = dualReport(res(['A', 'B', 'C', 'D'].map((s, k) => item(`${s}USDT`, 'PRIORITY', 'LONG', 90 - k, 90 - k))), now, null);
  assert.equal((many.plain.match(/우선 추천 후보$/gm) || []).length, 2);
});
test('보고서: 동적 텍스트는 HTML 이스케이프된다', () => {
  const r = dualReport(res([item('X<b>USDT', 'PRIORITY', 'LONG', 80, 80)]), now, null); assert.match(r.text, /X&lt;b&gt;USDT/);
});

// ── 추천 성과 로그 ──
const candlesFor = (rows) => rows.map(([t, o, h, l, c]) => ({ t, o, h, l, c, q: 1 }));
test('추천 로그: 레코드 스키마·중복 제거·최대 길이·설정 해시', () => {
  const r = makeRecord(item('SOLUSDT', 'PRIORITY', 'LONG', 82, 78), now);
  for (const k of ['id', 'version', 'settings', 'loggedAt', 'signalBarT', 'dataAsOf', 'symbol', 'dir', 'tier', 'scoreA', 'scoreB', 'entryRef', 'stop', 'tp', 'rr', 'outcome']) assert.ok(k in r, k);
  assert.equal(r.settings, SETTINGS_HASH); assert.equal(r.outcome.status, 'pending');
  const { log, added } = appendRecords([r], [r, makeRecord(item('ETHUSDT', 'INTEREST', 'SHORT', 80, 40), now)]); assert.equal(log.length, 2); assert.equal(added.length, 1);
  const big = appendRecords([], Array.from({ length: MAX_LOG + 20 }, (_, k) => ({ ...r, id: `id${k}` }))); assert.equal(big.log.length, MAX_LOG); assert.equal(big.log.at(-1).id, `id${MAX_LOG + 19}`);
});
test('추천 로그 결과 추적: 목표 도달=+R, 손절=−R, 다음 봉 없음=대기, 진행 중=open, 갭=skipped (엔진과 동일 규칙·비용 포함)', () => {
  const sig = { id: 'a', symbol: 'S', dir: 'LONG', signalBarT: 1000 * H, stop: 98, tp: 104, tier: 'PRIORITY', outcome: { status: 'pending' } };
  const base = [[1000 * H, 100, 101, 99, 100.5]];
  const wins = [{ ...sig }]; updateOutcomes(wins, { S: candlesFor([...base, [1001 * H, 100, 100.5, 99.5, 100], [1002 * H, 100, 104.5, 99.8, 104]]) });
  assert.equal(wins[0].outcome.status, 'closed'); assert.equal(wins[0].outcome.reason, 'tp'); assert.ok(wins[0].outcome.rNet > 0 && wins[0].outcome.rNet < wins[0].outcome.rGross);
  const loses = [{ ...sig, id: 'b' }]; updateOutcomes(loses, { S: candlesFor([...base, [1001 * H, 100, 100.2, 97, 97.5]]) }); assert.equal(loses[0].outcome.reason, 'stop'); assert.ok(loses[0].outcome.rNet < -1);
  const wait = [{ ...sig, id: 'c' }]; updateOutcomes(wait, { S: candlesFor(base) }); assert.equal(wait[0].outcome.status, 'open');
  const run = [{ ...sig, id: 'd' }]; updateOutcomes(run, { S: candlesFor([...base, [1001 * H, 100, 101, 99.5, 100.5]]) }); assert.equal(run[0].outcome.status, 'open');
  const gap = [{ ...sig, id: 'e' }]; updateOutcomes(gap, { S: candlesFor([...base, [1001 * H, 90, 91, 89, 90]]) }); assert.equal(gap[0].outcome.status, 'skipped');
  const closedAlready = [{ ...sig, id: 'f', outcome: { status: 'closed', rNet: 1 } }]; updateOutcomes(closedAlready, { S: [] }); assert.equal(closedAlready[0].outcome.rNet, 1);   // 확정된 결과는 바뀌지 않음
  const miss = [{ ...sig, id: 'g' }]; updateOutcomes(miss, {}); assert.equal(miss[0].outcome.status, 'pending');
});
test('추천 로그 요약: 표본 부족 경고', () => {
  const log = [{ tier: 'PRIORITY', outcome: { status: 'closed', rNet: 1.5 } }, { tier: 'PRIORITY', outcome: { status: 'closed', rNet: -1.1 } }, { tier: 'PRIORITY', outcome: { status: 'open' } }, { tier: 'INTEREST', outcome: { status: 'pending' } }];
  const s = summarize(log); assert.equal(s.PRIORITY.closed, 2); assert.equal(s.PRIORITY.open, 1); assert.ok(Math.abs(s.PRIORITY.expectancyR - 0.2) < 1e-9); assert.match(s.PRIORITY.note, /표본 부족/); assert.equal(s.INTEREST.winRate, null);
});

// ── 수집기·서비스 통합 (모의 OKX, Telegram 전송 없음) ──
test('수집기 듀얼 옵션: 1시간봉을 300개로 받아 평가하고 추가 호출은 dualExtra 이하, 옵션이 꺼져 있으면 호출 수·결과 불변', async () => {
  const callsOff = [], callsOn = [];
  const off = await createOkxCollector(fakeOkx({ calls: callsOff }), { gapMs: 0 })(NOW);
  const on = await createOkxCollector(fakeOkx({ calls: callsOn }), { gapMs: 0, dual: true, dualExtra: 8 })(NOW);
  assert.equal(off.dual, null); assert.equal(callsOff.filter(u => /bar=1H&limit=300/.test(u)).length, 0);
  assert.ok(callsOn.filter(u => /bar=1H&limit=300/.test(u)).length >= 1); assert.ok(callsOn.length - callsOff.length <= 8);
  assert.ok(on.dual.evaluated >= 1); assert.ok(on.dual.items.every(x => x.dataAsOf > 0));
  assert.deepEqual(on.rows.map(r => r.symbol), off.rows.map(r => r.symbol));                 // 기존 분석 결과(종목)는 그대로
  assert.deepEqual(off.rows.map(r => r.candidate?.score), on.rows.map(r => r.candidate?.score).slice(0, off.rows.length));
});
const dualCollect = items => async () => {
  const base = await createOkxCollector(fakeOkx(), { gapMs: 0 })(NOW);
  return { ...base, dual: { items, skipped: [], gate: { ok: true }, btc: { dir: 'LONG' }, dataAsOf: lastT + H, evaluated: items.length, candles: {} } };
};
test('서비스: 듀얼 보고 옵션이 꺼져 있으면 기존 보고 그대로(듀얼 문구 없음), 켜면 듀얼 보고 1건·사진 없음, 같은 시간대 중복 전송 없음', async () => {
  const items = [item('SOLUSDT', 'PRIORITY', 'LONG', 82, 78)];
  const run = async (dualOn) => { const sent = [], photos = [], state = {}; const deps = { now: NOW, state, collect: dualCollect(items), send: async t => { sent.push(t); }, sendPhoto: async () => { photos.push(1); return true; }, save: async () => {}, news: async () => {}, dualReport: dualOn };
    await cycle(deps); const first = sent.length; await cycle(deps); return { sent, photos, state, firstCount: first, total: sent.length }; };
  const off = await run(false); assert.ok(off.sent.every(t => !/듀얼 전략 3\.0/.test(t))); assert.ok(off.state.recLog.length === 1);       // 기록은 남지만 전송 형식은 불변
  const on = await run(true); assert.equal(on.firstCount, 1); assert.match(on.sent[0], /듀얼 전략 3\.0/); assert.equal(on.photos.length, 0); assert.equal(on.total, 1);
  assert.equal(on.state.recLog[0].tier, 'PRIORITY'); assert.ok(on.state.dualSummary.PRIORITY.logged === 1);
});
test('서비스: 억제 시간대(quiet)에는 듀얼 보고도 전송하지 않고, 추적 로그는 계속 기록', async () => {
  const sent = []; const state = { quiet: { reason: 'cache-stale', hour: Math.floor(NOW / H / 1) * 1 * 1 && Math.floor(NOW / 3600000), at: NOW } };
  await cycle({ now: NOW, state, collect: dualCollect([item('SOLUSDT', 'PRIORITY', 'LONG', 82, 78)]), send: async t => { sent.push(t); }, save: async () => {}, news: async () => {}, dualReport: true });
  assert.equal(sent.length, 0); assert.equal(state.recLog.length, 1);
});
