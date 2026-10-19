// 15분봉 진입 트리거 백테스트 도구 테스트(합성 데이터, 네트워크·Telegram·주문 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathOutcome, buildFrames, collectSignalEvents, runSignalBacktest, renderSignalReport, summarizeSignals, SIGNAL_COHORTS, SBT } from '../signal/backtest.mjs';
import { evaluateSignal, M15, SIG } from '../signal/evaluate.mjs';
import { aggregate, H1 } from '../opportunity/indicators.mjs';
import { ETH, SOL, BTC, wave, mirror } from './opportunity-fixture.mjs';
import { expand15, mkA, mk15, NOW } from './signal-fixture.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const bar = (k, o, h, l, c) => ({ t: k * M15, o, h, l, c, q: 1000 });
const path = rows => rows.map((r, k) => bar(k, ...r));

test('경로 결과: 목표 선도달 / 손절 선도달 / 미결정, 비용과 MAE·MFE (LONG, 스탑주문 모형)', () => {
  // 신호 봉 0, 체결 = 봉1 시가 100, 손절 98 → 위험 2
  const ok = (rows, o = {}) => pathOutcome(path([[100, 100, 100, 100], ...rows]), 0, 'LONG', 98, 104, { costBps: 0, stressBps: 0, ...o });
  let r = ok([[100, 101, 99.5, 100.8], [100.8, 104.2, 100.5, 104]]); assert.equal(r.kind, 'target'); assert.ok(Math.abs(r.gross - 2) < 1e-9 && r.net === r.gross); assert.ok(Math.abs(r.mae - 0.25) < 1e-9); assert.ok(Math.abs(r.mfe - 2.1) < 1e-9); assert.equal(r.bars, 2);
  r = ok([[100, 101, 99, 100.5], [100.5, 100.8, 97.9, 99]]); assert.equal(r.kind, 'stop'); assert.ok(Math.abs(r.gross + 1) < 1e-9, '꼬리가 손절가에 닿으면 손절가에서 종료'); assert.ok(r.mae >= 1);
  r = ok([[100, 105, 97.5, 98.5]]); assert.equal(r.kind, 'stop', '같은 봉에서 목표와 손절이 모두 가능하면 손절 먼저(보수적)');
  r = ok([[100, 100.4, 99.7, 100.2], [100.2, 100.6, 99.9, 100.3]], { horizon: 2 }); assert.equal(r.kind, 'time'); assert.ok(Math.abs(r.gross - 0.15) < 1e-9);
  r = pathOutcome(path([[100, 100, 100, 100], [100, 100.4, 99.6, 100], [97, 99, 96.5, 98.5]]), 0, 'LONG', 98, 104, { costBps: 0 }); assert.equal(r.kind, 'stop'); assert.ok(Math.abs(r.gross + 1.5) < 1e-9, '시가가 이미 손절 아래면 시가(갭)에서 종료');
  // 비용: 시가 100, 위험 2 → 15bp = 0.15 / 2 = 0.075R, 30bp = 0.15R
  r = pathOutcome(path([[100, 100, 100, 100], [100, 100.4, 99.9, 100.2]]), 0, 'LONG', 98, null, { horizon: 1 }); assert.ok(Math.abs(r.net - (0.1 - 0.075)) < 1e-9 && Math.abs(r.netStress - (0.1 - 0.15)) < 1e-9);
});
test('경로 결과: 종가 모형은 꼬리만 닿은 손절을 무시하고 종가 이탈에서 종료, 손절이 이미 지난 체결은 건너뜀, 데이터 끝', () => {
  const rows = path([[100, 100, 100, 100], [100, 100.5, 97.0, 99.5], [99.5, 100.2, 99.0, 99.8], [99.8, 100, 96.5, 97.0]]);
  const w = pathOutcome(rows, 0, 'LONG', 98, 104, { stopModel: 'wick', costBps: 0 }), c = pathOutcome(rows, 0, 'LONG', 98, 104, { stopModel: 'close', costBps: 0 });
  assert.equal(w.kind, 'stop'); assert.equal(w.bars, 1); assert.equal(c.kind, 'stop'); assert.equal(c.bars, 3); assert.ok(Math.abs(c.gross + 1.5) < 1e-9, '종가 모형은 세 번째 봉 종가 97에서 종료');
  assert.deepEqual(pathOutcome(path([[100, 100, 100, 100], [97.9, 98.5, 97.5, 98.2]]), 0, 'LONG', 98, 104), { skipped: 'already-invalid' });
  assert.equal(pathOutcome(path([[100, 100, 100, 100]]), 0, 'LONG', 98, 104), null);
});
test('경로 결과: SHORT는 LONG의 거울', () => {
  const L = path([[100, 100, 100, 100], [100, 101, 99.5, 100.8], [100.8, 104.2, 100.5, 104], [104, 104, 104, 104]]), K = 200, S = L.map(b => ({ ...b, o: K - b.o, h: K - b.l, l: K - b.h, c: K - b.c }));
  const a = pathOutcome(L, 0, 'LONG', 98, 104, { costBps: 15 }), b = pathOutcome(S, 0, 'SHORT', K - 98, K - 104, { costBps: 15 });
  for (const k of ['kind', 'gross', 'net', 'netStress', 'mae', 'mfe', 'bars']) assert.equal(typeof a[k] === 'number' ? a[k].toFixed(9) : a[k], typeof b[k] === 'number' ? b[k].toFixed(9) : b[k], k);
});
test('프레임: 15분봉에서 마감된 완전한 1H·4H만 만든다(미완성 시간은 버림), 확장→집계는 원래 1H와 정확히 같다', () => {
  const c15 = expand15(ETH.slice(0, 400)), { c1h, c4h } = buildFrames(c15.slice(0, c15.length - 2));   // 마지막 시간은 15분봉 2개가 빠져 미완성
  assert.equal(c1h.length, 399); assert.deepEqual(c1h.at(-1), { ...c1h.at(-1), t: ETH[398].t }); assert.ok(c4h.every(x => x.n === 4 || x.t !== undefined));
  const full = buildFrames(c15).c1h; assert.equal(full.length, 400);
  for (let k = 0; k < 400; k++) { const x = full[k], y = ETH[k]; assert.ok(x.t === y.t && Math.abs(x.o - y.o) < 1e-9 && Math.abs(x.h - y.h) < 1e-9 && Math.abs(x.l - y.l) < 1e-9 && Math.abs(x.c - y.c) < 1e-9, `1H ${k}`); }
});
// 합성 5000시간 시계열. 파이프라인 검증 전용으로 트리거·거래량·추격·손절폭 임계값을 완화한 TEST_P를 쓴다(운영 임계값 SIG는 바꾸지 않는다).
const E5 = wave(5000, 5), B5 = wave(5000, 9, { amp: 0.04, per: 300 }), C = { ETHUSDT: expand15(E5), SOLUSDT: expand15(mirror(E5)), BTCUSDT: expand15(B5) };
const TEST_P = { ...SIG, volMult: 0.5, chaseAtr1: 3, stopMaxAtr1: 8, stopMinAtr1: 0.3, maxTrigRangeAtr1: 6, trigBars: 3 }, OPT = { P: TEST_P, minRR: 1 };
test('인과성: 뒤에 데이터를 붙여도(미완성 시간 포함) 앞선 신호·결과(기간 안에 끝난 것)는 그대로다', () => {
  const H = 96, cut = 4 * 3500 + 2, a = collectSignalEvents('ETHUSDT', C.ETHUSDT.slice(0, cut), C.BTCUSDT.slice(0, cut), { horizon: H, ...OPT }), b = collectSignalEvents('ETHUSDT', C.ETHUSDT, C.BTCUSDT, { horizon: H, ...OPT });
  const key = e => [e.i, e.dir, e.stage, e.score, e.res.wick.kind, e.res.wick.net.toFixed(9), e.res.close.kind, e.res.wick.mae.toFixed(9)].join('|');
  for (const pool of ['events', 'control']) { const lim = cut - 1 - H, A = a[pool].filter(e => e.i < lim).map(key), B = b[pool].filter(e => e.i < lim).map(key); assert.deepEqual(A, B, pool); }
  assert.ok(a.events.filter(e => e.i < cut - 1 - H).length >= 5 && a.control.length >= 5);
});
test('신호 이벤트는 운영과 같은 규칙을 따른다: 후보 판정·중복 방지·체결은 다음 봉 시가·손절/목표는 신호 계산값', () => {
  const { events, control } = collectSignalEvents('ETHUSDT', C.ETHUSDT, C.BTCUSDT, OPT); assert.ok(events.length >= 10 && control.length > events.length / 2);
  const seen = new Set();
  for (const e of events) {
    assert.ok(e.stage >= 2 && e.volRel >= TEST_P.volMult && e.net1 >= OPT.minRR && e.rr1 > e.net1, JSON.stringify([e.stage, e.volRel, e.net1]));
    const o = e.res.wick; assert.equal(o.entry, C.ETHUSDT[e.i + 1].o, '체결은 다음 15분봉 시가'); assert.ok(o.risk > 0 && o.mae >= 0 && o.mfe >= 0 && Number.isFinite(o.net));
    assert.ok(!seen.has(e.i), '같은 봉 중복'); seen.add(e.i);
  }
  const t = events.map(e => e.t).sort((x, y) => x - y); for (let k = 1; k < t.length; k++) assert.ok(t[k] - t[k - 1] >= 45 * 60000 || events.length < 2, '활성 신호 중 새 신호 없음');
});
test('모형 비교: 스탑주문(꼬리) 모형은 종가 모형보다 손절이 같거나 빠르고 평균 순손익비가 높지 않다(보수적)', () => {
  const r = runSignalBacktest(C, C.BTCUSDT, OPT), by = n => r.cohorts.find(c => c.name === n).all;
  const w = by('신호 전체 · 스탑주문 모형 · 1차 목표'), c = by('신호 전체 · 종가 모형(운영 무효화 규칙) · 1차 목표');
  assert.equal(w.n, c.n); assert.ok(w.stop >= c.stop - 1e-9); assert.ok(w.netR <= c.netR + 1e-9 || Math.abs(w.netR - c.netR) < 1e-9);
});
test('집계·보고서: 비율 합 1, 신뢰구간 포함, 코호트 정의 일관, 결정적, NaN 없음', () => {
  const r = runSignalBacktest(C, C.BTCUSDT, OPT), r2 = runSignalBacktest(C, C.BTCUSDT, OPT);
  assert.deepEqual(r.cohorts, r2.cohorts); assert.equal(r.cohorts.length, SIGNAL_COHORTS.length);
  const all = r.cohorts[0].all; assert.ok(all.n >= 20); assert.ok(Math.abs(all.target + all.stop + all.time - 1) < 1e-9); assert.ok(all.ciLo <= all.netR && all.netR <= all.ciHi); assert.ok(all.netStressR < all.netR, '30bp 비용이 더 크다');
  assert.equal(r.cohorts.find(c => c.name === '신호 LONG').all.n + r.cohorts.find(c => c.name === '신호 SHORT').all.n, all.n);
  const t = renderSignalReport(r, { note: '합성' }); for (const need of ['| 코호트 |', '대조: 맥락만', '30bp', '종가 모형']) assert.ok(t.includes(need), need); assert.ok(!/NaN|undefined|Infinity/.test(t));
  assert.equal(summarizeSignals([]).n, 0);
});
test('백테스트는 읽기 전용이다: 모듈·CLI에 Telegram·주문·계정·비밀값·POST가 없고, 워크플로는 비밀값·스케줄 없이 개발 브랜치에서만 돈다', () => {
  const mod = readFileSync(new URL('../signal/backtest.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, ''), cli = readFileSync(new URL('../signal/backtest-cli.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/fetch\(|jsonRequest|sendText|process\.env|TELEGRAM/.test(mod)); assert.ok(!/sendText|TELEGRAM_|process\.env|method:\s*['"]POST|\/trade\/|\/account\/|\/asset\//i.test(cli));
  const wf = readFileSync(new URL('../../.github/workflows/signal-backtest.yml', import.meta.url), 'utf8');
  assert.ok(!/secrets\.|schedule:|cron:/.test(wf) && /contents: read/.test(wf) && /branches: \['claude\/opportunity-radar-v2'\]/.test(wf));
});
