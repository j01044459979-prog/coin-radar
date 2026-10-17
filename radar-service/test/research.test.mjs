import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blockBootstrap, blockBootstrapDiff, nonOverlapping, portfolio, concurrency, summary, breakdown } from '../backtest/stats.mjs';
import { runSymbol, simulateTrade, COSTS } from '../backtest/engine.mjs';
import { dualStrategies, applyOpts } from '../backtest/strategies.mjs';
import { seriesA, scoreA } from '../dual/strategyA.mjs';
import { seriesB, scoreB, seriesBtc, btcContext } from '../dual/strategyB.mjs';
import { prepare, universeFor, allowlist, runResearch, periodDefs, EMBARGO, H, DAY, auditTrades } from '../backtest/research.mjs';
import { jointCollector, judge, engineAudit } from '../backtest/research-report.mjs';
import { buildReport, rulesHash } from '../backtest/research-cli.mjs';

const lcg = seed => { let x = seed >>> 0; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296; };
const T0 = Date.UTC(2023, 9, 17);
function gen(seed, n, { drift = 0, vol = 0.006, t0 = T0, qmul = 1 } = {}) { const r = lcg(seed); let p = 100; const rows = []; for (let i = 0; i < n; i++) { const reg = Math.sin(i / 1500) * 0.0003, ret = (r() - 0.5) * 2 * vol + drift + reg, o = p, c = p * (1 + ret); rows.push([t0 + i * H, o, Math.max(o, c) * (1 + r() * vol * 0.6), Math.min(o, c) * (1 - r() * vol * 0.6), c, qmul * 1e6 * (0.6 + r() * (r() < 0.05 ? 6 : 1))]); p = c; } return rows; }
const toC = rows => rows.map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], q: r[5] }));
const SPEC = { tickSz: 0.01, lotSz: 0.01, minSz: 0.01, ctVal: 1 };
let cached; const dataset = () => cached ??= { meta: {}, specs: { 'BTC-USDT-SWAP': SPEC, 'X0-USDT-SWAP': SPEC, 'X1-USDT-SWAP': SPEC }, candles: { 'BTC-USDT-SWAP': gen(1, 26280), 'X0-USDT-SWAP': gen(10, 26280, { qmul: 2 }), 'X1-USDT-SWAP': gen(11, 26280, { qmul: 3 }) } };
let runCache; const research = () => runCache ??= (() => { const jc = jointCollector(); const res = runResearch(dataset(), { costMults: [1, 1.5, 2], onSegment: jc.hook }); return { res, J: jc.J }; })();

// ── 통계 ──
test('블록 부트스트랩: 결정적이고, 블록이 3개 미만이면 산출 불가, 군집(같은 주) 상관이 있으면 독립 부트스트랩보다 넓다', () => {
  const t = Array.from({ length: 60 }, (_, k) => ({ tEntry: Math.floor(k / 6) * 7 * DAY + k, tExit: 0, rNet: Math.floor(k / 6) % 2 ? 1 : -1 }));   // 주 단위로 승/패가 몰림
  assert.deepEqual(blockBootstrap(t), blockBootstrap(t));
  assert.equal(blockBootstrap(t.slice(0, 6)), null);
  const ci = blockBootstrap(t); assert.ok(ci[1] - ci[0] > 0.5, `폭 ${ci[1] - ci[0]}`);
  const iid = t.map((x, k) => ({ ...x, tEntry: k * 7 * DAY })), ci2 = blockBootstrap(iid); assert.ok(ci2[1] - ci2[0] < ci[1] - ci[0]);        // 시간 상관이 없으면 더 좁음
  const d = blockBootstrapDiff(t.slice(0, 30), t.slice(30)); assert.ok(d && d[0] <= d[1]);
});
test('보유기간 겹침 제거·동시 보유·포트폴리오(상한·낙폭·복리)', () => {
  const tr = [{ tEntry: 0, tExit: 10, rNet: 1 }, { tEntry: 5, tExit: 8, rNet: -1 }, { tEntry: 10, tExit: 12, rNet: 2 }, { tEntry: 11, tExit: 13, rNet: -1 }];
  assert.deepEqual(nonOverlapping(tr).map(t => t.tEntry), [0, 10]);
  assert.deepEqual(concurrency(tr), { avg: 1.5, max: 2, n: 4 });
  const p = portfolio(tr, { maxOpen: 1, riskFrac: 0.1 }); assert.equal(p.taken, 2); assert.equal(p.skipped, 2);
  assert.ok(Math.abs(p.endEquity - (1.1 + 0.11 * 2)) < 1e-9);                                                   // 10% 위험으로 +1R, 이어서 +2R(자본 복리)
  const dd = portfolio([{ tEntry: 0, tExit: 1, rNet: -1 }, { tEntry: 2, tExit: 3, rNet: -1 }], { riskFrac: 0.1, maxOpen: 1 }); assert.ok(Math.abs(dd.maxDrawdownPct - 19) < 1e-6);
});

// ── 엔진 ──
const flat = (n, p = 100) => Array.from({ length: n }, (_, i) => ({ t: T0 + i * H, o: p, h: p + 0.2, l: p - 0.2, c: p, q: 1 }));
const free = { feePerSide: 0, slipPerSide: 0, fundingPer8h: 0 };
test('엔진: MFE/MAE(R), 봉 내부 순서 불명(ambiguous) 표시와 낙관 상한', () => {
  const c = flat(300); c[271] = { ...c[271], o: 100, h: 100.2, l: 99.9, c: 100 }; c[272] = { ...c[272], o: 100, h: 103, l: 98.8, c: 101 };
  const r = simulateTrade(c, 270, { dir: 'LONG', stop: 99, tp: 102 }, { costs: free });
  assert.equal(r.reason, 'stop'); assert.equal(r.ambiguous, true); assert.ok(r.rNet < 0 && r.rNetOpt > 1.9);
  assert.ok(r.maeR >= 1 && r.mfeR >= 3);                                                                  // 같은 봉 고가 103 → MFE 3R, 저가 98.8 → MAE 1.2R
  const clean = simulateTrade(Object.assign(flat(300), { 271: { t: T0 + 271 * H, o: 100, h: 102.5, l: 99.5, c: 102 } }), 270, { dir: 'LONG', stop: 99, tp: 102 }, { costs: free }); assert.equal(clean.ambiguous, false); assert.equal(clean.reason, 'tp');
});
test('엔진: 호가 단위는 불리한 방향으로 반올림, 최소 주문 수량 미달이면 거래 안 함, 체결가 범위 유지', () => {
  const c = flat(300, 100.003); c[271] = { ...c[271], o: 100.003, h: 103, l: 99.9, c: 102 };
  const r = simulateTrade(c, 270, { dir: 'LONG', stop: 99, tp: 102 }, { costs: free, inst: { tickSz: 0.01, lotSz: 1, minSz: 1, ctVal: 0.01 } });
  assert.equal(r.status, 'closed'); assert.ok(Math.abs(r.entry - 100.01) < 1e-9);                           // 롱 진입은 올림(불리)
  const exitDown = r.exit; assert.ok(exitDown <= 102 + 1e-9);                                              // 롱 청산은 내림(불리)
  const tiny = simulateTrade(c, 270, { dir: 'LONG', stop: 99, tp: 102 }, { costs: free, inst: { tickSz: 0.01, lotSz: 1, minSz: 100000, ctVal: 0.01 } }); assert.equal(tiny.status, 'skipped'); assert.match(tiny.reason, /최소 주문/);
  assert.ok(Number.isFinite(r.qtyRiskErr) && Math.abs(r.qtyRiskErr) < 0.05);
});
test('엔진: 구간 [from,to) 밖 신호 무시, 경계를 가로지르는 거래는 purge, 데이터 끝의 미청산 거래는 제외', () => {
  const c = flat(400); const sig = i => (i % 5 === 0 ? { dir: 'LONG', stop: 95, tp: 110 } : null);
  const all = runSymbol(c, sig, { costs: free }), win = runSymbol(c, sig, { costs: free, from: c[300].t, to: c[340].t }, );
  assert.ok(win.every(t => t.t >= c[300].t && t.t < c[340].t && t.tExit < c[340].t));
  const stats = {}; runSymbol(c, sig, { costs: free, from: c[300].t, to: c[340].t, stats }); assert.ok((stats.purged ?? 0) >= 1);
  assert.ok(all.every(t => t.i + 48 <= 399));                                                              // 보유기간이 끝까지 가지 못한 거래는 없음(강제 청산 제거)
});

// ── 변형 독립성·인과성 ──
test('가설 변형: 점수는 그대로이고 차단 사유만 추가(applyOpts) — opts 경로와 결과 동일, 변형 신호는 원본 신호의 부분집합', () => {
  const c = toC(gen(21, 3000, { drift: 0.0002 })), btc = toC(gen(22, 3000)), idx = new Map(btc.map((x, i) => [x.t, i]));
  const base = dualStrategies(c, btc, idx), h1 = base.variant({ B: { requireRetest: true } }), h2 = base.variant({ A: { maxAge: 35 } });
  const sA = seriesA(c), sB = seriesB(c), sBtc = seriesBtc(btc); let checked = 0, aSub = 0, bSub = 0;
  for (let i = 300; i < 3000; i += 7) {
    const ctx = btcContext(btc, sBtc, i);
    const a0 = scoreA(c, sA, i), a1 = scoreA(c, sA, i, { maxAge: 35 }), b0 = scoreB(c, sB, i, ctx), b1 = scoreB(c, sB, i, ctx, { requireRetest: true });
    const [pa, pb] = applyOpts(a0, b0, { A: { maxAge: 35 }, B: { requireRetest: true } });
    assert.equal(pa.score, a0.score); assert.equal(pb.score, b0.score); assert.deepEqual(pa.blockers, a1.blockers); assert.deepEqual(pb.blockers, b1.blockers); checked++;
    if (h2.A(i)) { assert.ok(base.A(i)); aSub++; } if (h1.B(i)) { assert.ok(base.B(i)); bSub++; } if (h1.AB(i)) assert.ok(base.AB(i)); if (h2.AB(i)) assert.ok(base.AB(i));
  }
  assert.ok(checked > 300 && aSub > 0 && bSub > 0);
});
test('인과성(전략 함수 전체): 데이터를 i 시점에서 자르거나 미래 봉을 바꿔도 A·B·A+B 신호가 같다', () => {
  const c = toC(gen(31, 2500, { drift: 0.0003 })), btc = toC(gen(32, 2500)), idx = new Map(btc.map((x, i) => [x.t, i]));
  const full = dualStrategies(c, btc, idx);
  for (const i of [420, 777, 1200, 1999, 2400]) {
    const cut = dualStrategies(c.slice(0, i + 1), btc.slice(0, i + 1), new Map(btc.slice(0, i + 1).map((x, k) => [x.t, k])));
    for (const k of ['A', 'B', 'AB', 'Araw', 'Braw']) assert.deepEqual(cut[k](i), full[k](i), `${k}@${i}`);
    const mutated = c.map((x, k) => (k > i ? { ...x, c: x.c * 1.4, h: x.h * 1.4, l: x.l * 1.4, o: x.o * 1.4 } : x));
    const f2 = dualStrategies(mutated, btc, idx); for (const k of ['A', 'B', 'AB']) assert.deepEqual(f2[k](i), full[k](i), `${k} 미래 변경 @${i}`);
  }
});

// ── 연구 하네스 ──
test('데이터 준비: 시간 간극에서 세그먼트 분할, 정시가 아닌 캔들·BTC 간극은 거부', () => {
  const rows = gen(41, 3000), withGap = [...rows.slice(0, 1200), ...rows.slice(1300)];
  const prep = prepare({ meta: {}, candles: { 'BTC-USDT-SWAP': rows, 'X-USDT-SWAP': withGap } });
  assert.equal(prep.gaps.length, 1); assert.equal(prep.gaps[0].missingBars, 100); assert.equal(prep.segs.filter(s => s.base === 'X').length, 2);
  assert.throws(() => prepare({ meta: {}, candles: { 'BTC-USDT-SWAP': withGap } }), /BTC 데이터에 간극/);
  const bad = rows.map(r => [...r]); bad[10][0] += 1000; assert.throws(() => prepare({ meta: {}, candles: { 'BTC-USDT-SWAP': bad } }), /정렬/);
});
test('유니버스: 구간 시작 이전 30일 거래대금만 사용(미래 데이터를 바꿔도 불변), 상장 전 종목 제외, BTC 항상 포함', () => {
  const mk = (qmulX, t0 = T0) => ({ meta: {}, candles: { 'BTC-USDT-SWAP': gen(1, 6000), 'X-USDT-SWAP': gen(2, 6000, { qmul: qmulX }), 'NEW-USDT-SWAP': gen(3, 1000, { qmul: 50, t0: T0 + 5000 * H }) } });
  const from = T0 + 3000 * H, p1 = prepare(mk(5)), p2 = prepare(mk(5));
  const u1 = universeFor(p1, from, 2); assert.ok(u1.has('BTC')); assert.ok(!u1.has('NEW'));                    // 아직 상장 전
  const future = mk(5); future.candles['X-USDT-SWAP'] = future.candles['X-USDT-SWAP'].map((r, i) => (r[0] >= from ? [r[0], r[1], r[2], r[3], r[4], 1e12] : r));
  assert.deepEqual([...universeFor(prepare(future), from, 2)].sort(), [...u1].sort());                         // 미래 거래대금 변경에 불변
  assert.ok(universeFor(prepare(mk(0.001)), from, 1).has('BTC'));
  void p2;
});
test('허용 국면 규칙: 개발 구간 평균 R > 0 이고 거래 ≥ 30인 국면만, 없으면 빈 집합(전략 비활성)', () => {
  const mk = (rg, n, r) => Array.from({ length: n }, (_, k) => ({ regime: rg, rNet: r, tEntry: k * DAY }));
  const a = allowlist([...mk('상승장', 40, 0.2), ...mk('하락장', 40, -0.1), ...mk('횡보장', 10, 0.5)]); assert.deepEqual([...a.allowed], ['상승장']);
  assert.equal(allowlist(mk('상승장', 100, -0.01)).allowed.size, 0);
});
test('연구 실행: 구간 경계(엠바고·purge) 준수, 최종 구간은 --final 없이는 실행되지 않음, 결과 결정적', () => {
  const { res } = research(), PER = res.periods;
  assert.ok(!res.active.includes('final')); assert.equal(res.trades[1].final, undefined);
  for (const p of res.active) for (const [v, list] of Object.entries(res.trades[1][p])) for (const t of list) {
    assert.ok(t.t >= PER[p].from + (p === 'dev' ? 0 : EMBARGO) && t.t < PER[p].to, `${p}/${v} 신호 시각`); assert.ok(t.tExit < PER[p].to, `${p}/${v} 청산이 경계를 넘음`);
  }
  assert.ok(PER.dev.to <= PER.val.from && PER.val.to <= PER.final.from && PER.final.to <= PER.seen.from);         // 시간 순서·비중첩
  assert.deepEqual(Object.keys(res.trades).sort(), ['1', '1.5', '2']);
  const again = runResearch(dataset(), { costMults: [1] }); assert.deepEqual(again.trades[1].dev.A.map(t => [t.t, t.rNet]), res.trades[1].dev.A.map(t => [t.t, t.rNet]));
});
test('연구 실행: 비용 배율이 클수록 같은 신호의 순 R이 작아진다, 불변식 위반 0건', () => {
  const { res } = research();
  for (const p of res.active) { const a = res.trades[1][p].A, b = res.trades[2][p].A; assert.equal(a.length, b.length); for (let k = 0; k < a.length; k += 17) assert.ok(b[k].rNet <= a[k].rNet + 1e-9); }
  assert.equal(engineAudit(res).violations, 0);
  assert.equal(auditTrades(res.prepObj, res.trades[1].val.AB).length, 0);
});
test('연구 실행: H3는 개발 구간 결과로만 허용 국면을 정하며 비허용 국면 신호는 0건, 비활성 전략은 거래 0건', () => {
  const { res } = research();
  for (const k of ['A', 'B', 'AB']) { const allowed = res.allow[k].allowed; for (const p of res.active) for (const t of res.trades[1][p][`${k}_H3`]) assert.ok(allowed.has(t.regime), `${k} ${p} ${t.regime}`); if (!allowed.size) for (const p of res.active) assert.equal(res.trades[1][p][`${k}_H3`].length, 0); }
  // H3 허용 국면 도출에는 개발 구간 거래만 쓰였는지: 개발 거래로 다시 계산하면 같은 결과
  assert.deepEqual([...allowlist(res.trades[1].dev.A).allowed], [...res.allow.A.allowed]);
});
test('사전 등록 판정: 기준을 하나라도 못 채우면 실패, 합성 우위 데이터는 통과하는지 검산', () => {
  const { res } = research(); const j = judge(res, 'A', 'val'); assert.equal(typeof j.pass, 'boolean'); assert.ok(j.checks.length >= 6);
  const fake = { trades: { 1: { val: { X: Array.from({ length: 300 }, (_, k) => ({ tEntry: k * DAY / 3, rNet: k % 3 === 0 ? -1 : 1.2, symbol: ['A', 'B', 'C', 'D', 'E'][k % 5], regime: ['상승장', '하락장', '횡보장'][k % 3] })) } }, 1.5: { val: { X: Array.from({ length: 300 }, (_, k) => ({ tEntry: k * DAY / 3, rNet: k % 3 === 0 ? -1 : 1.15, symbol: ['A', 'B', 'C', 'D', 'E'][k % 5], regime: ['상승장', '하락장', '횡보장'][k % 3] })) } }, 2: { val: { X: Array.from({ length: 300 }, (_, k) => ({ tEntry: k * DAY / 3, rNet: k % 3 === 0 ? -1 : 1.1, symbol: ['A', 'B', 'C', 'D', 'E'][k % 5], regime: ['상승장', '하락장', '횡보장'][k % 3] })) } } } };
  const ok = judge(fake, 'X', 'val'); assert.equal(ok.pass, true, JSON.stringify(ok.checks.filter(c => !c.pass)));
  const bad = judge({ trades: { 1: { val: { X: fake.trades[1].val.X.slice(0, 50) } } } }, 'X', 'val'); assert.equal(bad.pass, false);
});
test('보고서 생성과 최종 테스트 안전장치: 해시 불일치 시 --final 거부', () => {
  const { res, J } = research(), { markdown } = buildReport(res, J, { final: false, hash: rulesHash() });
  for (const s of ['## 1. 백테스트 엔진 검증', '## 2. 손실 원인 분해', '### 3-1) H1', '### 3-2) H2', '### 3-3) H3', '## 5. 사전 등록 기준 판정', '## 6. 시험 기록', '가짜 돌파 비율', 'MFE', '지표 간 중복성', '동일 시점 비교']) assert.ok(markdown.includes(s), s);
  assert.doesNotMatch(markdown, /NaN|undefined|\[object/);
  const dir = mkdtempSync(join(tmpdir(), 'rs-')), file = join(dir, 'd.json.gz'); writeFileSync(file, gzipSync(JSON.stringify({ meta: {}, candles: { 'BTC-USDT-SWAP': gen(1, 500) } })));
  const r = spawnSync(process.execPath, [new URL('../backtest/research-cli.mjs', import.meta.url).pathname, file, '--final', '--expect-hash', 'deadbeef'], { encoding: 'utf8' });
  assert.equal(r.status, 3); assert.match(r.stderr, /해시 불일치/);
});
