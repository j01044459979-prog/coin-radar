import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeStrategy4, trendSeries, trendAt, emaTrendAt, zonesAt, TP4 } from '../dual/strategy4.mjs';
import { aggregate } from '../dual/indicators.mjs';
import { portfolioFair, leverageCheck, pickCases, quarterOf } from '../backtest/stats4.mjs';
import { runSymbol } from '../backtest/engine.mjs';
import { auditTrades } from '../backtest/research.mjs';
import { runResearch4, judge4, poolOf, NAMES4, ACCOUNT4 } from '../backtest/research4.mjs';
import { build4 } from '../backtest/research4-report.mjs';
import { rulesHash4 } from '../backtest/research4-cli.mjs';

const H = 3600000, T0 = Date.UTC(2023, 9, 17);
const lcg = seed => { let x = seed >>> 0; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296; };
// 추세 + 파동(눌림목이 생기는) 합성 시리즈
function wave(n, seed, { amp = 0.06, per = 240, drift = 0.0004, t0 = T0, K = null } = {}) {
  const r = lcg(seed); let p = 100; const rows = [];
  for (let i = 0; i < n; i++) {
    const tgt = 100 * Math.exp(drift * i + amp * Math.sin(2 * Math.PI * i / per)), o = p, c = tgt * (1 + (r() - 0.5) * 0.004);
    rows.push({ t: t0 + i * H, o, h: Math.max(o, c) * (1 + r() * 0.002), l: Math.min(o, c) * (1 - r() * 0.002), c, q: 1e6 * (0.6 + r() * 1.5) }); p = c;
  }
  return rows;
}
const mkS = c => { const idx = new Map(c.map((x, i) => [x.t, i])); return makeStrategy4(c, c, idx, trendSeries(c)); };
const sig = (fn, i) => { const s = fn(i); return s ? [s.dir, s.stop, s.tp] : null; };

test('4H 집계: 마감된 4H 봉만 쓴다 — 4H 봉 중간의 1H 봉에서는 직전 완성 봉을, 마지막 1H 봉에서는 방금 완성된 봉을 가리킨다', () => {
  const c = wave(100, 1, { t0: Date.UTC(2024, 0, 1) }), T = trendSeries(c);
  for (let i = 0; i < c.length; i++) {
    const d = T.doneAt[i], lastHourOf4h = c[i].t % (4 * H) === 3 * H;
    if (d >= 0) assert.ok(T.c4[d].t + 4 * H <= c[i].t + H, '아직 마감되지 않은 4H 봉을 참조');
    if (lastHourOf4h) assert.equal(T.c4[d].t + 4 * H, c[i].t + H, '마지막 1H 봉에서는 그 4H 봉이 완성돼야 함');
    else if (d >= 0) assert.ok(T.c4[d].t + 4 * H <= c[i].t - (c[i].t % (4 * H)) + 0, '봉 중간에서는 직전 4H 봉까지만');
  }
  assert.equal(aggregate(c).length, 25);
});

test('인과성: 신호 봉 이후의 캔들을 바꾸거나 잘라내도 그 봉의 신호가 같다', () => {
  const c = wave(4200, 5), full = mkS(c), at = [];
  for (let i = 300; i < c.length - 2; i++) if (full.A(i)) at.push(i);
  assert.ok(at.length >= 8, `검증할 신호가 부족: ${at.length}`);
  const r = lcg(9);
  for (const i of [...at.slice(0, 12), 500, 1500, 2500, 3500]) {
    const cut = mkS(c.slice(0, i + 1)), mut = mkS(c.map((x, k) => k <= i ? x : { ...x, o: x.o * (1 + r() * 0.2), h: x.h * 1.3, l: x.l * 0.7, c: x.c * (1 + r() * 0.2), q: x.q * 5 }));
    for (const name of ['A', 'B', 'C', 'D']) { assert.deepEqual(sig(cut[name], i), sig(full[name], i), `${name}@${i} 잘라낸 데이터와 다름`); assert.deepEqual(sig(mut[name], i), sig(full[name], i), `${name}@${i} 미래 변형에 영향받음`); }
  }
});

test('롱/숏 대칭: 가격을 K−p로 뒤집으면 같은 봉에서 방향만 반대로 신호가 난다', () => {
  const c = wave(4200, 7), K = 1000, m = c.map(x => ({ t: x.t, o: K - x.o, h: K - x.l, l: K - x.h, c: K - x.c, q: x.q }));
  const a = mkS(c), b = mkS(m); let n = 0, mism = 0;
  for (let i = 300; i < c.length - 2; i++) {
    const x = a.A(i), y = b.A(i); if (x || y) n++;
    if (!!x !== !!y) { mism++; continue; }
    if (x) { assert.notEqual(x.dir, y.dir); assert.ok(Math.abs((K - x.stop) - y.stop) < 1e-6 && Math.abs((K - x.tp) - y.tp) < 1e-6); }
  }
  assert.ok(n >= 10, `신호 수 ${n}`); assert.ok(mism <= 1, `대칭 불일치 ${mism}`);
  assert.ok([...Array(c.length).keys()].some(i => a.A(i)?.dir === 'LONG') && [...Array(c.length).keys()].some(i => b.A(i)?.dir === 'SHORT'));
});

test('신호 불변식: 손절 폭 1~3.5 ATR, 목표는 정확히 2R, 눌림목 확인 봉, 추세 방향과 일치, 변형은 A의 부분집합', () => {
  const c = wave(6000, 5, { amp: 0.08, per: 300 }), s = mkS(c); let n = 0;
  for (let i = 300; i < c.length - 2; i++) {
    const a = s.A(i); if (!a) { assert.equal(s.B(i), null); assert.equal(s.C(i), null); assert.equal(s.D(i), null); continue; }
    n++; const d = a.dir === 'LONG' ? 1 : -1, risk = (c[i].c - a.stop) * d;
    assert.ok(risk > 0); assert.ok(Math.abs((a.tp - c[i].c) * d - 2 * risk) < 1e-9 * c[i].c);
    assert.ok(a.meta.stopAtr >= TP4.stopMinAtr1h - 1e-9 && a.meta.stopAtr <= TP4.stopMaxAtr1h + 1e-9);
    assert.equal(s.trendDirAt(i), d === 1 ? 'UP' : 'DOWN');
    assert.ok(d === 1 ? c[i].c > c[i].o : c[i].c < c[i].o);
    if (s.B(i)) assert.ok(a.meta.volOk); if (s.C(i)) assert.ok(a.meta.btcOk); if (s.D(i)) assert.ok(a.meta.volOk && a.meta.btcOk);
    assert.equal(!!s.D(i), !!(s.B(i) && s.C(i)));
    assert.ok(a.meta.roomR === null || a.meta.roomR >= 2 - 1e-9, `저항 공간 ${a.meta.roomR}`);
  }
  assert.ok(n >= 10);
});

test('4H 추세 판정: HH/HL + EMA 정렬일 때만, 피벗은 우측 3봉이 지난 뒤에만 사용', () => {
  const mk = (highs, lows, ph, pl) => ({ c4: highs.map((h, k) => ({ t: k * 4 * H, o: 100, h, l: lows[k], c: 105, q: 1 })), e50: highs.map(() => 104), e200: highs.map(() => 100), a4: highs.map(() => 2), ph, pl, doneAt: null });
  const hs = Array(20).fill(110), ls = Array(20).fill(100);
  const T = mk(hs, ls, [3, 8], [5, 10]); T.c4[3].h = 120; T.c4[8].h = 130; T.c4[5].l = 95; T.c4[10].l = 98;
  assert.equal(trendAt(T, 13), 'UP');               // 마지막 피벗(10)은 d−3=10 이므로 확정
  assert.equal(trendAt(T, 12), null);               // d=12 → 피벗 10은 아직 확정 전, 저점 피벗이 1개뿐
  T.c4[8].h = 115; assert.equal(trendAt(T, 13), null);   // 고점이 낮아지면(LH) 상승 아님
  const D = mk(hs, ls, [3, 8], [5, 10]); D.c4.forEach(x => { x.c = 95; }); D.e50.fill(96); D.e200.fill(100); D.c4[3].h = 130; D.c4[8].h = 120; D.c4[5].l = 90; D.c4[10].l = 85;
  assert.equal(trendAt(D, 13), 'DOWN');
  assert.equal(emaTrendAt(D, 13), 'DOWN'); assert.equal(emaTrendAt({ ...D, e200: D.e200.map(() => NaN) }, 13), null);
});

test('구간 후보: 깨진 지지는 제외하고, 돌파로 전환된 고점은 최근 돌파만 인정', () => {
  const n = 40, c4 = Array.from({ length: n }, (_, k) => ({ t: k * 4 * H, o: 100, h: 101, l: 99, c: 100, q: 1 }));
  const T = { c4, e50: Array(n).fill(0), e200: Array(n).fill(0), a4: Array(n).fill(2), ph: [5], pl: [8, 12], doneAt: null };
  c4[5].h = 110; c4[8].l = 90; c4[12].l = 95;
  for (let k = 13; k < n; k++) c4[k].c = 112;                          // 110 위로 돌파(q=13) → 전환된 고점 후보
  const z = zonesAt(T, 30, 'UP', TP4);
  assert.ok(z.some(x => x.type === '돌파전환' && x.level === 110));
  assert.ok(z.some(x => x.type === '스윙' && x.level === 90) && z.some(x => x.type === '스윙' && x.level === 95));
  c4[20].c = 80; const z2 = zonesAt(T, 30, 'UP', TP4);                  // 4H 종가가 모든 지지 아래로 마감 → 무효
  assert.equal(z2.filter(x => x.level === 90 || x.level === 95).length, 0);
  c4[20].c = 112; assert.equal(zonesAt(T, 36, 'UP', TP4).filter(x => x.type === '돌파전환').length, 0);   // 돌파(13)가 20개 4H 봉보다 오래되면 전환 인정 안 함
});

test('포트폴리오: 동시 진입 시 청산 시각이 아니라 종목명 순으로 채택한다(미래 정보 비의존), 상한과 낙폭', () => {
  const tr = [{ symbol: 'BBB', tEntry: 0, tExit: 100, rNet: -1 }, { symbol: 'AAA', tEntry: 0, tExit: 5, rNet: 2 }];
  const p = portfolioFair(tr, { maxOpen: 1, riskFrac: 0.1 });
  assert.equal(p.taken, 1); assert.ok(Math.abs(p.endEquity - 1.2) < 1e-9);                   // AAA가 먼저(종목명), 청산이 느린 BBB가 아니다
  const swapped = portfolioFair([{ ...tr[0], tExit: 3 }, { ...tr[1], tExit: 500 }], { maxOpen: 1, riskFrac: 0.1 });
  assert.ok(Math.abs(swapped.endEquity - 1.2) < 1e-9, '청산 시각이 바뀌어도 채택이 같아야 함');
  const dd = portfolioFair([{ symbol: 'A', tEntry: 0, tExit: 1, rNet: -1 }, { symbol: 'A', tEntry: 2, tExit: 3, rNet: -1 }], { riskFrac: 0.1, maxOpen: 3 });
  assert.ok(Math.abs(dd.maxDrawdownPct - 19) < 1e-6);
});

test('레버리지 점검: 청산 거리 = 1/L − 0.5%, 손절이 청산보다 먼 거래와 갭 청산을 센다', () => {
  const t = [
    { dir: 'LONG', entry: 100, exit: 99, riskPct: 0.01 }, { dir: 'LONG', entry: 100, exit: 90, riskPct: 0.02 },
    { dir: 'SHORT', entry: 100, exit: 105, riskPct: 0.04 }, { dir: 'LONG', entry: 100, exit: 100, riskPct: 0.25 },
  ];
  const lc = leverageCheck(t, { Ls: [10, 5], riskFrac: 0.005 });
  const r10 = lc.rows[0], r5 = lc.rows[1];
  assert.ok(Math.abs(r10.liqPct - 9.5) < 1e-9);
  assert.equal(r10.stopBeyond, 1);                    // riskPct 0.25 ≥ 0.095
  assert.equal(r10.gapLiq, 1);                        // 두 번째 거래: 손실 10% ≥ 9.5%
  assert.equal(r5.stopBeyond, 1); assert.equal(r5.gapLiq, 0);
  assert.ok(Math.abs(lc.needed.max - 0.5) < 1e-9);    // 0.005/0.01
});

test('사례 추출은 고정 시드(결과 비의존)이고 분기 라벨', () => {
  const t = Array.from({ length: 40 }, (_, k) => ({ seg: 'S', t: k * H, dir: 'LONG', rNet: k % 2 ? 1 : -1 }));
  assert.deepEqual(pickCases(t, 3), pickCases([...t].reverse(), 3));
  assert.ok(pickCases(t, 3).wins.every(x => x.rNet > 0));
  assert.equal(quarterOf(Date.UTC(2024, 4, 1)), '2024Q2');
});

// ── 통합 ──
const SPEC = { tickSz: 0.01, lotSz: 0.01, minSz: 0.01, ctVal: 1 };
const rows = c => c.map(x => [x.t, x.o, x.h, x.l, x.c, x.q]);
let cached; const dataset = () => cached ??= { meta: {}, specs: { 'BTC-USDT-SWAP': SPEC, 'X0-USDT-SWAP': SPEC, 'X1-USDT-SWAP': SPEC }, candles: { 'BTC-USDT-SWAP': rows(wave(26280, 1, { amp: 0.07, per: 300 })), 'X0-USDT-SWAP': rows(wave(26280, 2, { amp: 0.09, per: 260 })), 'X1-USDT-SWAP': rows(wave(26280, 3, { amp: 0.05, per: 340 })) } };
let rc; const research = () => rc ??= runResearch4(dataset(), { costMults: [1, 1.5, 2] });

test('통합: 모든 변형이 돌고, 거래 불변식 위반 0, 최종 테스트 구간 거래 없음, 구간 경계 준수', () => {
  const res = research(); assert.deepEqual(res.active, ['dev', 'val', 'seen']);
  const all = NAMES4.flatMap(v => res.active.flatMap(p => res.trades[1][p]?.[v] ?? []));
  assert.ok(all.length > 50);
  assert.equal(auditTrades(res.prepObj, all).length, 0);
  assert.ok(all.every(t => !(t.t >= res.periods.final.from && t.t < res.periods.final.to)), '최종 구간 거래가 섞임');
  for (const p of res.active) for (const v of NAMES4) for (const t of res.trades[1][p]?.[v] ?? []) { assert.ok(t.t >= res.periods[p].from && t.tExit < res.periods[p].to); }
  assert.ok((res.trades[1].val?.TP4_A ?? []).length + (res.trades[1].dev?.TP4_A ?? []).length > 0, '신호가 하나도 없음');
  assert.ok(res.trades[1].dev.TP4_A.every(t => t.meta.strategy === 'TP4' && t.meta.ref && typeof t.meta.ref.stAgree === 'boolean'));
});
test('통합: 비용이 높을수록 평균 R이 낮고 부분집합 관계(B,C,D의 거래 수 ≤ A 근처)·동일 계정 가정', () => {
  const res = research(), avg = (m, v) => { const t = poolOf(res, m, v, ['dev', 'val', 'seen']); return t.reduce((a, b) => a + b.rNet, 0) / Math.max(1, t.length); };
  for (const v of ['TP4_A', 'random', 'v3_A']) { if (poolOf(res, 1, v, ['dev', 'val', 'seen']).length) assert.ok(avg(2, v) < avg(1, v) + 1e-9, v); }
  assert.equal(ACCOUNT4.riskFrac, 0.005);
  const n = v => poolOf(res, 1, v, ['dev', 'val', 'seen']).length;
  assert.ok(n('TP4_D') <= n('TP4_B') + 3 && n('TP4_D') <= n('TP4_C') + 3);
});
test('판정: 표본이 100건 미만이면 검증 불충분, 보고서에 모든 절이 있다', () => {
  const res = research(), j = judge4(res, 'TP4_D', ['val', 'seen']);
  assert.ok(j.checks.length >= 9); if (j.n < 100) { assert.equal(j.insufficient, true); assert.equal(j.pass, false); }
  const { markdown } = build4(res, { hash: 'h', final: false, pool: ['val', 'seen'] });
  for (const s of ['## 1. 엔진 점검', '## 2. 전략별 성과 비교', '## 3. OOS 풀 상세', '## 4. 사전 등록 기준 판정', '## 5.', '## 6. 시간 안정성', '## 8. 레버리지', '## 9. 실제 거래 사례', '## 10. 시험 기록']) assert.ok(markdown.includes(s), s);
  assert.ok(!/승률\s*\d+%\s*예상/.test(markdown));
});
test('CLI: 최종 테스트는 해시가 일치하지 않으면 실행되지 않는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'r4-')), file = join(dir, 'd.json.gz'); writeFileSync(file, gzipSync(JSON.stringify({ candles: {} })));
  const cli = new URL('../backtest/research4-cli.mjs', import.meta.url).pathname;
  const r = spawnSync('node', [cli, file, '--final'], { encoding: 'utf8' }); assert.equal(r.status, 3);
  const r2 = spawnSync('node', [cli, file, '--final', '--expect-hash', 'deadbeef'], { encoding: 'utf8' }); assert.equal(r2.status, 3);
  assert.match(rulesHash4(), /^[0-9a-f]{16}$/);
});
