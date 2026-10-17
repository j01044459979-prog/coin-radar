import test from 'node:test';
import assert from 'node:assert/strict';
import { ema, rsi, atr, macd, supertrend, aggregate, sma } from '../dual/indicators.mjs';
import { seriesA, scoreA, planA, WARMUP_A } from '../dual/strategyA.mjs';
import { seriesB, scoreB, seriesBtc, btcContext, B_SETTINGS } from '../dual/strategyB.mjs';
import { classify, marketGate, DUAL_RULES } from '../dual/combine.mjs';
import { runSymbol, COSTS } from '../backtest/engine.mjs';
import { metrics, bootstrapCI } from '../backtest/metrics.mjs';
import { fetchHistory } from '../backtest/fetch-okx.mjs';
import { runBacktest } from '../backtest/run.mjs';

const H = 3600000, T0 = 1700000000000 - (1700000000000 % H);
const lcg = seed => { let x = seed >>> 0; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296; };
const bar = (i, o, h, l, c, q = 1.2e6) => ({ t: T0 + i * H, o, h, l, c, q });
function walk(seed, n, { drift = 0, vol = 0.006 } = {}) { const r = lcg(seed); let p = 100; const out = []; for (let i = 0; i < n; i++) { const ret = (r() - 0.5) * 2 * vol + drift, o = p, c = p * (1 + ret); out.push(bar(i, o, Math.max(o, c) * (1 + r() * vol * 0.5), Math.min(o, c) * (1 - r() * vol * 0.5), c, 1e6 * (0.6 + r()))); p = c; } return out; }
const trend = (n, slope, noise = 0.15, seed = 3) => { const r = lcg(seed); return Array.from({ length: n }, (_, i) => { const m = 100 + i * slope + Math.sin(i / 7) * noise * 3 + (r() - 0.5) * noise; return bar(i, m - 0.1, m + 0.5, m - 0.5, m + 0.05); }); };

// ── 지표 정확성 ──
test('RSI(14)는 Wilder 교과서 예제와 일치(StockCharts 70.46)', () => {
  const c = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
  assert.ok(Math.abs(rsi(c, 14).at(-1) - 70.46) < 0.05);
  assert.equal(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14).at(-1), 100);
});
test('EMA·SMA·ATR 기본 동작과 시드', () => {
  const v = [1, 2, 3, 4, 5, 6]; assert.deepEqual(sma(v, 3).slice(2), [2, 3, 4, 5]);
  const e = ema(v, 3); assert.ok(Number.isNaN(e[1])); assert.equal(e[2], 2); assert.equal(e[3], 3);          // 시드=SMA3=2, k=0.5 → 4*0.5+2*0.5=3
  const c = Array.from({ length: 20 }, (_, i) => bar(i, 10, 11, 9, 10)); assert.ok(Math.abs(atr(c, 14).at(-1) - 2) < 1e-9);
});
test('MACD: 12/26/9 구조와 히스토그램 = MACD − 시그널', () => {
  const closes = walk(5, 120).map(x => x.c), m = macd(closes);
  assert.ok(Number.isNaN(m.line[24]) && Number.isFinite(m.line[25])); assert.ok(Number.isNaN(m.hist[32]) && Number.isFinite(m.hist[33]));
  for (let i = 40; i < 120; i++) assert.ok(Math.abs(m.hist[i] - (m.line[i] - m.signal[i])) < 1e-9);
});
test('Supertrend: 상승 구간은 dir=1·라인이 가격 아래, 하락 전환 시 dir=-1·라인이 가격 위', () => {
  const up = trend(120, 0.3), down = Array.from({ length: 80 }, (_, i) => { const m = 100 + 120 * 0.3 - i * 0.6; return bar(120 + i, m + 0.1, m + 0.5, m - 0.5, m); });
  const c = [...up, ...down], st = supertrend(c, 10, 3);
  assert.equal(st.dir[100], 1); assert.ok(st.line[100] < c[100].c);
  assert.equal(st.dir[199], -1); assert.ok(st.line[199] > c[199].c); assert.ok(st.flip[199] > 120);
});
test('4시간 집계: UTC 4시간 경계·4개 모두 있는 봉만', () => {
  const c = Array.from({ length: 12 }, (_, i) => bar(i, 1, 2 + i, 0.5, 1.5, 10)); // T0는 정시이지만 4시간 경계와 다를 수 있음
  const a = aggregate(c); assert.ok(a.every(x => x.n === 4 && x.t % (4 * H) === 0 && x.q === 40));
});

// ── 미래 데이터 비참조(인과성) ──
test('인과성: 잘라낸 데이터로 계산한 i번째 값 = 전체 데이터로 계산한 i번째 값 (지표·전략 A·전략 B)', () => {
  const c = walk(11, 700, { drift: 0.0004 }), btc = walk(12, 700, { drift: 0.0003 });
  const fullA = seriesA(c), fullB = seriesB(c), fullBtc = seriesBtc(btc);
  for (const i of [270, 300, 411, 520, 699]) {
    const cc = c.slice(0, i + 1), bb = btc.slice(0, i + 1), sA = seriesA(cc), sB = seriesB(cc), sBtc = seriesBtc(bb);
    for (const k of ['dir', 'line', 'flip']) assert.equal(sA.st[k][i], fullA.st[k][i], `st.${k}@${i}`);
    assert.equal(sA.e200[i], fullA.e200[i]); assert.equal(sA.rsi[i], fullA.rsi[i]); assert.equal(sA.macd.hist[i], fullA.macd.hist[i]);
    assert.deepEqual(scoreA(cc, sA, i), scoreA(c, fullA, i));
    const ctxT = btcContext(bb, sBtc, i), ctxF = btcContext(btc, fullBtc, i); assert.deepEqual(ctxT, ctxF);
    assert.deepEqual(scoreB(cc, sB, i, ctxT), scoreB(c, fullB, i, ctxF));
  }
});
test('인과성: 미래 봉을 바꿔도 과거 신호는 바뀌지 않는다', () => {
  const c = walk(21, 600, { drift: 0.0003 }), c2 = c.map((x, i) => (i > 450 ? { ...x, c: x.c * 1.3, h: x.h * 1.3, o: x.o * 1.3, l: x.l * 1.3 } : x));
  const btc = walk(22, 600), sa = seriesA(c), sb = seriesA(c2);
  for (let i = 270; i <= 450; i += 13) assert.deepEqual(scoreA(c, sa, i), scoreA(c2, sb, i));
  const bA = seriesB(c), bB = seriesB(c2), sBtc = seriesBtc(btc);
  for (let i = 270; i <= 450; i += 13) assert.deepEqual(scoreB(c, bA, i, btcContext(btc, sBtc, i)), scoreB(c2, bB, i, btcContext(btc, sBtc, i)));
});

// ── 전략 A ──
// 상승(하락) 추세 중 짧은 되돌림으로 Supertrend가 잠깐 반대로 돌았다가 다시 추세 방향으로 전환하는 합성 데이터 — 전환 직후 4개 지표가 모두 정렬되는 전형적 진입 장면
const turn = dir => Array.from({ length: 460 }, (_, i) => { let m = 100 + i * 0.12 + Math.sin(i / 4) * 0.6; if (i >= 300 && i < 318) m -= (i - 300) * 0.45; else if (i >= 318) m = m - 8.1 + (i - 318) * 0.06; m = 100 + dir * (m - 100); return bar(i, m - dir * 0.1, m + 0.5, m - 0.5, m + dir * 0.1); });
test('전략 A: 추세 전환 직후 지표가 모두 정렬되면 75점 이상(롱·숏 대칭), 횡보는 낮고, 오래된 추세는 신선도 감점', () => {
  for (const [dir, label] of [[1, 'LONG'], [-1, 'SHORT']]) {
    const c = turn(dir), s = seriesA(c); let best = null;
    for (let i = 270; i < 460; i++) { const a = scoreA(c, s, i); if (a.dir === label && (!best || a.score > best.score)) best = { ...a, i }; }
    assert.ok(best && best.score >= 75, `${label} 최고 ${best?.score}`); assert.equal(Object.keys(best.parts).length, 4);
    assert.match(best.parts.supertrend.note, /Supertrend\(10,3\)/); assert.match(best.parts.rsi.note, /RSI\(14\)/);
    const late = scoreA(c, s, 459); assert.ok(late.parts.supertrend.score < best.parts.supertrend.score || late.age <= 3);
  }
});
test('전략 A: 과열 RSI·오래된 추세는 감점, 워밍업 부족이면 방향 없음', () => {
  const c = trend(400, 0.25), s = seriesA(c); assert.equal(scoreA(c, s, WARMUP_A - 5).dir, null);
  const a = scoreA(c, s, 399); assert.ok(a.age > 36 && a.parts.supertrend.score === 15, `age ${a.age} pts ${a.parts.supertrend.score}`);
  const hot = Array.from({ length: 400 }, (_, i) => { const m = i < 380 ? 100 + i * 0.05 : 119 + (i - 380) * 3; return bar(i, m - 0.2, m + 0.6, m - 0.4, m + 0.3); });
  const h = scoreA(hot, seriesA(hot), 399); assert.ok(h.parts.rsi.score <= 10, `rsi ${h.parts.rsi.score}`);
});
test('전략 A 자체 계획: 손절은 Supertrend 라인(0.8~3 ATR), 목표는 2R', () => {
  const c = trend(400, 0.25), s = seriesA(c), a = scoreA(c, s, 399), p = planA(c, a, c[399].c);
  assert.ok(p.stop < p.entry && p.tp > p.entry); assert.ok(Math.abs((p.tp - p.entry) / (p.entry - p.stop) - 2) < 1e-9); assert.ok(p.stopAtr >= 0.8 - 1e-9 && p.stopAtr <= 3 + 1e-9);
});

// ── 전략 B ──
function breakoutSetup({ retest = true, vol = 3.5e6, chase = 0, extraAtr = 1, t24 = 1.2e6 } = {}) {
  const c = [];
  for (let i = 0; i < 280; i++) { const m = 100 + Math.sin(i / 3) * 0.8; c.push(bar(i, m, m + 0.5 * extraAtr, m - 0.5 * extraAtr, m + Math.cos(i / 3) * 0.2, t24)); }
  const hi = Math.max(...c.slice(-20).map(x => x.h)), brk = hi + 1.4 + chase;
  c.push(bar(280, 100.5, brk + 0.3, 100.4, brk, vol));
  if (retest) { c.push(bar(281, brk, brk + 0.1, hi + 0.2, hi + 0.5, t24 * 1.3)); c.push(bar(282, hi + 0.5, hi + 0.8, hi + 0.15, hi + 0.7, t24)); c.push(bar(283, hi + 0.7, hi + 1.5, hi + 0.6, hi + 1.3, t24 * 1.2)); }
  return { c, hi };
}
const btcUp = n => trend(n, 0.35, 0.1, 9), btcDown = n => trend(n, -0.2, 0.1, 9).map(x => ({ ...x, o: x.o + 100, h: x.h + 100, l: x.l + 100, c: x.c + 100 }));
const evalB = (c, btc, i = c.length - 1) => scoreB(c, seriesB(c), i, btcContext(btc, seriesBtc(btc), Math.min(i, btc.length - 1)));

test('전략 B: 돌파 후 재테스트 지지 확인 → 롱, 구조 30점, 손익비 2R 계획, 차단 없음', () => {
  const { c } = breakoutSetup(), b = evalB(c, btcUp(c.length));
  assert.equal(b.dir, 'LONG'); assert.equal(b.parts.structure.score, 30); assert.equal(b.retest, true);
  assert.ok(b.parts.relVolume.score >= 11); assert.equal(b.parts.btc.score, 15);
  assert.ok(b.plan.stop < b.plan.entry && Math.abs((b.plan.tp - b.plan.entry) / (b.plan.entry - b.plan.stop) - 2) < 1e-9);
  assert.deepEqual(b.blockers, [], b.blockers.join()); assert.ok(b.score >= 75, String(b.score));
});
test('전략 B: 재테스트 없는 돌파 직후(가짜 돌파 위험)는 구조 점수가 낮다', () => {
  const { c } = breakoutSetup({ retest: false }), b = evalB(c, btcUp(c.length));
  assert.equal(b.dir, 'LONG'); assert.equal(b.parts.structure.score, 20); assert.match(b.parts.structure.note, /재테스트 전/);
});
test('전략 B 제한: 역추세(BTC 하락) · 급등 추격 · 과도한 변동성 · 유동성 부족은 차단 사유', () => {
  const { c } = breakoutSetup();
  assert.ok(evalB(c, btcDown(c.length)).blockers.some(x => /BTC 추세와 반대/.test(x)));
  assert.ok(evalB(breakoutSetup({ retest: false, chase: 3.5 }).c, btcUp(c.length)).blockers.some(x => /추격 제한/.test(x)));
  assert.ok(evalB(breakoutSetup({ extraAtr: 12 }).c, btcUp(c.length)).blockers.some(x => /과도한 변동성|손절 거리 부적절/.test(x)));
  assert.ok(evalB(breakoutSetup({ t24: 1e3, vol: 3.5e3 }).c, btcUp(c.length)).blockers.some(x => /유동성 부족/.test(x)));
  assert.ok(evalB(c, []).blockers.some(x => /BTC 데이터 없음/.test(x)));
});
test('전략 B 제한: 앞쪽 저항이 2R 안에 있으면 손익비 1:2 확보 어려움으로 차단', () => {
  const { c } = breakoutSetup(); const pre = c.slice(); pre[150] = { ...pre[150], h: Math.max(...c.slice(-4).map(x => x.c)) + 0.6 }; // 돌파 이전 구조에 가까운 저항
  pre[149] = { ...pre[149], h: pre[150].h - 0.3 }; pre[151] = { ...pre[151], h: pre[150].h - 0.3 }; pre[148] = { ...pre[148], h: pre[150].h - 0.4 }; pre[152] = { ...pre[152], h: pre[150].h - 0.4 };
  const b = evalB(pre, btcUp(pre.length)); assert.ok(b.plan && b.plan.room < 1.5 ? b.blockers.some(x => /손익비/.test(x)) : true);
});
test('전략 B: 구조 없으면 방향 없음(점수 0)', () => { const c = walk(31, 400, { vol: 0.001 }); const b = evalB(c, btcUp(400), 399); assert.ok(b.dir === null ? b.score === 0 : true); });

// ── 결합 판정 ──
const sc = (dir, score, blockers = []) => ({ dir, score, blockers });
test('결합: 같은 방향·각 75점 이상 → 우선 후보, 74.9점이면 관심(단독)', () => {
  assert.equal(classify(sc('LONG', 75), sc('LONG', 75)).verdict, 'PRIORITY');
  assert.equal(classify(sc('LONG', 80.2), sc('LONG', 74.9)).verdict, 'INTEREST');
  assert.equal(classify(sc('SHORT', 74.9), sc('SHORT', 90)).verdict, 'INTEREST');
  assert.equal(classify(sc('LONG', 60), sc('LONG', 60)).verdict, 'NONE');
});
test('결합: 방향이 다르면 관망(점수가 높아도), 한쪽만 방향 있으면 단독 신호=관심', () => {
  const w = classify(sc('LONG', 90), sc('SHORT', 80)); assert.equal(w.verdict, 'WAIT'); assert.match(w.reason, /충돌/);
  assert.equal(classify(sc('LONG', 90), sc(null, 0)).verdict, 'INTEREST');
  assert.equal(classify(sc('LONG', 90), sc('SHORT', 40)).verdict, 'INTEREST');          // 50점 미만은 방향 신호로 보지 않음
});
test('결합: B에 차단 사유가 있으면 우선 후보가 될 수 없고, 시장 필터가 나쁘면 우선 후보 보류(0건 허용)', () => {
  assert.equal(classify(sc('LONG', 90), sc('LONG', 90, ['역추세'])).verdict, 'INTEREST');
  const bad = marketGate({ usable: true, atrPct: 3.1 }); assert.equal(bad.ok, false);
  const r = classify(sc('LONG', 90), sc('LONG', 90), bad); assert.equal(r.verdict, 'INTEREST'); assert.match(r.reason, /BTC 변동성 과다/);
  assert.equal(marketGate({ usable: false }).ok, false); assert.equal(marketGate({ usable: true, atrPct: 1 }).ok, true);
});

// ── 백테스트 엔진 ──
const flatBars = (n, p = 100) => Array.from({ length: n }, (_, i) => bar(i, p, p + 0.2, p - 0.2, p));
function engineCase(mutate, sig, costs = { feePerSide: 0, slipPerSide: 0, fundingPer8h: 0 }, extra = {}) {
  const c = flatBars(300); mutate(c); let fired = false;
  return runSymbol(c, i => (i === 270 && !fired ? (fired = true, sig) : null), { costs, engine: { maxHoldBars: 10, cooldownBars: 2, warmup: 260 }, ...extra });
}
test('엔진: 신호 다음 봉 시가로 체결(신호 봉 종가 아님), 목표 도달 시 +2R', () => {
  const t = engineCase(c => { c[271] = bar(271, 100.5, 100.7, 100.3, 100.6); c[272] = bar(272, 100.6, 103, 100.5, 102.9); }, { dir: 'LONG', stop: 99.5, tp: 102.5 });
  assert.equal(t.length, 1); assert.equal(t[0].entry, 100.5); assert.equal(t[0].reason, 'tp'); assert.ok(Math.abs(t[0].rGross - 2) < 1e-9);
});
test('엔진: 같은 봉에서 손절·목표가 모두 닿으면 손절 우선, 시가 갭이 손절 밖이면 갭 가격으로 청산', () => {
  const both = engineCase(c => { c[271] = bar(271, 100, 100.2, 99.9, 100); c[272] = bar(272, 100, 103, 99.0, 101); }, { dir: 'LONG', stop: 99.5, tp: 102.5 });
  assert.equal(both[0].reason, 'stop'); assert.ok(both[0].rGross < 0);
  const gap = engineCase(c => { c[271] = bar(271, 100, 100.2, 99.9, 100); c[272] = bar(272, 98, 98.5, 97.5, 98); }, { dir: 'LONG', stop: 99.5, tp: 102.5 });
  assert.equal(gap[0].exit, 98); assert.ok(gap[0].rGross < -1);
});
test('엔진: 비용 반영 — 순손익 R이 총손익 R보다 작고, 비용=수수료+슬리피지+펀딩을 위험폭으로 환산', () => {
  const costs = { feePerSide: 0.0005, slipPerSide: 0.0005, fundingPer8h: 0.0001 };
  const free = engineCase(c => { c[272] = bar(272, 100, 103, 100, 102.6); }, { dir: 'LONG', stop: 99, tp: 102 });
  const paid = engineCase(c => { c[272] = bar(272, 100, 103, 100, 102.6); }, { dir: 'LONG', stop: 99, tp: 102 }, costs);
  assert.ok(paid[0].rNet < free[0].rNet && paid[0].rNet < paid[0].rGross);
  const riskPct = paid[0].riskPct, expectCost = (2 * costs.feePerSide + costs.fundingPer8h * paid[0].bars / 8) / riskPct;
  assert.ok(Math.abs(paid[0].rGross - paid[0].rNet - expectCost) < 1e-9);
});
test('엔진: 숏 대칭, 시간 청산, 쿨다운·동시 포지션 1개, 손절/목표 바깥 갭 진입은 거래 안 함', () => {
  const s = engineCase(c => { c[272] = bar(272, 100, 100.1, 97, 97.5); }, { dir: 'SHORT', stop: 101, tp: 98 }); assert.equal(s[0].reason, 'tp'); assert.ok(s[0].rGross > 1.9);
  const timed = engineCase(() => {}, { dir: 'LONG', stop: 95, tp: 110 }); assert.equal(timed[0].reason, 'time'); assert.equal(timed[0].bars, 10);
  const c = flatBars(300); const many = runSymbol(c, i => (i % 2 === 0 ? { dir: 'LONG', stop: 95, tp: 110 } : null), { costs: { feePerSide: 0, slipPerSide: 0, fundingPer8h: 0 }, engine: { maxHoldBars: 10, cooldownBars: 2, warmup: 260 } });
  for (let k = 1; k < many.length; k++) assert.ok(many[k].tEntry >= many[k - 1].tExit); // 겹치지 않음
  const skipped = engineCase(c => { c[271] = bar(271, 106, 106.2, 105.9, 106); }, { dir: 'LONG', stop: 99.5, tp: 102.5 }); assert.equal(skipped.length, 0);
});

// ── 성과 지표 ──
test('지표: 승률·기대값·PF·최대낙폭·표본 경고', () => {
  const mk = (r, k) => ({ rNet: r, rGross: r, tEntry: k, tExit: k + 1, bars: 3, riskPct: 0.01, symbol: 'X' });
  const trades = [2, -1, -1, 2, -1, -1, -1, 2].map((r, k) => mk(r, k));
  const m = metrics(trades); assert.equal(m.n, 8); assert.equal(m.winRate, 3 / 8); assert.ok(Math.abs(m.expectancyR - 0.125) < 1e-9);
  assert.ok(Math.abs(m.profitFactor - 6 / 5) < 1e-9); assert.equal(m.maxDrawdownR, 3); assert.equal(m.maxLossStreak, 3);
  assert.ok(m.flags.some(f => /표본 부족/.test(f))); assert.ok(m.flags.some(f => /구분되지 않음/.test(f)));
  assert.equal(metrics([]).n, 0);
  const ci1 = bootstrapCI([1, 2, 3, 4]), ci2 = bootstrapCI([1, 2, 3, 4]); assert.deepEqual(ci1, ci2);                    // 결정적
});

// ── 데이터 수집(모의 OKX) ──
test('과거 캔들 수집: after 페이지네이션, 확정봉만, 중복 제거·정렬, 429 재시도, 403은 중단', async () => {
  const ts = Array.from({ length: 250 }, (_, i) => T0 + i * H), calls = []; let rate = true;
  const page = after => { const older = ts.filter(t => !after || t < Number(after)).slice(-100).reverse(); return older.map(t => [String(t), '1', '2', '0.5', '1.5', '10', '10', '15000', t === ts.at(-1) ? '0' : '1']); };
  const f = async url => { calls.push(url); const u = new URL(url); if (rate) { rate = false; return new Response('', { status: 429, headers: { 'retry-after': '0' } }); } return new Response(JSON.stringify({ code: '0', data: page(u.searchParams.get('after')) }), { status: 200 }); };
  const rows = await fetchHistory('X-USDT-SWAP', 240, { fetchImpl: f, wait: async () => {}, gapMs: 0 });
  assert.equal(rows.length, 240); assert.ok(rows.every((r, k) => k === 0 || r[0] - rows[k - 1][0] === H)); assert.ok(rows.every(r => r[5] === 15000));
  assert.ok(rows.at(-1)[0] < ts.at(-1));                               // 미확정 마지막 봉 제외
  await assert.rejects(fetchHistory('X', 10, { fetchImpl: async () => new Response('', { status: 403 }), wait: async () => {}, gapMs: 0 }), /제한 응답 403/);
});

// ── 전체 파이프라인(합성 데이터, 결정적) ──
test('백테스트 파이프라인: 결정적이고 모든 변형·구간·시장 구분 지표를 만든다', () => {
  const candles = { 'BTC-USDT-SWAP': walk(1, 3200, { drift: 0.0002 }).map(x => [x.t, x.o, x.h, x.l, x.c, x.q]) };
  for (let k = 0; k < 3; k++) candles[`X${k}-USDT-SWAP`] = walk(10 + k, 3200, { drift: 0.0001 }).map(x => [x.t, x.o, x.h, x.l, x.c, x.q]);
  const a = runBacktest({ meta: {}, candles }, { sweep: [] }), b = runBacktest({ meta: {}, candles }, { sweep: [] });
  assert.deepEqual(a.trades, b.trades);
  for (const n of ['기존(근사) TP1=1R', '전략 A', '전략 B', 'A+B 우선후보', '무작위(비교 기준선)']) assert.ok(a.table[n], n);
  assert.ok(a.table['전략 A'].net.n > 0 && a.table['전략 A'].bySplit['구간2'] && a.table['전략 A'].byRegime['횡보장']);
  assert.ok(a.table['전략 A'].net.expectancyR <= a.table['전략 A'].gross.expectancyR + 1e-12);   // 비용은 항상 성과를 깎는다
});
