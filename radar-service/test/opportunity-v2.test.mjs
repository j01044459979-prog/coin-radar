// 기회 포착 레이더 고도화(조건 적합도·가격 계획·거래량·메시지·과거 검증 도구) 테스트. 모든 데이터는 합성이며 네트워크·Telegram은 쓰지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { aggregate, H1 } from '../opportunity/indicators.mjs';
import { analyzeCoin } from '../opportunity/analysis.mjs';
import { fitScore, volumeState, SCORE_WEIGHTS, SCORE_TOTAL, GRADE } from '../opportunity/score.mjs';
import { watchBlock, formatAlerts, DISCLAIMER } from '../opportunity/message.mjs';
import { sortAlerts } from '../opportunity/priority.mjs';
import { outcome, collectEvents, runBacktest, scoreMonotonic, clusterBootstrap, summarize, COHORTS } from '../opportunity/backtest.mjs';
import { ETH, SOL, BTC, at, find, ethStage } from './opportunity-fixture.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };

// ── 기존 판정 불변 ──
test('[회귀] 단계·점검·무효화·구간 판정은 main(PR #27) 코드와 4500개 봉에서 완전히 같다', () => {
  // 이 해시는 고도화 전 main의 analyzeCoin 출력(상태·방향·단계·충족 수·무효화·반대편·구간·이유·미충족·추세·상대 거래량·추격 위험)을 같은 합성 시계열에 돌려 얻은 값이다.
  const h = createHash('sha256'); let n = 0; const st = [0, 0, 0, 0];
  for (const c of [ETH, SOL, BTC]) {
    for (let i = 1100; i < c.length; i++) {
      const s = c.slice(0, i + 1), a = analyzeCoin(s.slice(-150), aggregate(s).slice(-300), aggregate(BTC.slice(0, i + 1)).slice(-300));
      if (a.status !== 'ok') { h.update('x'); continue; }
      h.update(JSON.stringify([a.state, a.dir, a.stage, a.met, a.invalidation, a.opposing, a.zone, a.reasons, a.unmet, a.trend, a.metrics.relVol, a.metrics.chase])); n++; st[a.stage]++;
    }
  }
  assert.equal(n, 4500); assert.equal(st.join('/'), '4273/57/125/45'); assert.equal(h.digest('hex').slice(0, 16), '48a55c2e2a74118e');
});

// ── 조건 적합도 ──
test('조건 적합도: 가중치 합 100, 점수는 0~100 정수, 항목별 점수는 만점을 넘지 않고 합계와 일치', () => {
  assert.equal(SCORE_TOTAL, 100); assert.equal(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  let n = 0;
  for (const c of [ETH, SOL]) for (let i = 1100; i < c.length; i += 3) {
    const a = at(c, i); if (a.status !== 'ok') continue;
    if (a.stage === 0) { assert.equal(a.score, null); assert.equal(a.plan, null); continue; }
    n++; const sc = a.score;
    assert.ok(Number.isInteger(sc.total) && sc.total >= 0 && sc.total <= 100, `total ${sc.total}`);
    for (const p of sc.parts) assert.ok(p.score >= 0 && p.score <= p.max, `${p.key} ${p.score}/${p.max}`);
    assert.equal(sc.total, Math.round(sc.parts.reduce((s, p) => s + p.score, 0)));
    assert.equal(sc.grade, sc.total >= GRADE.high ? '높음' : sc.total >= GRADE.mid ? '보통' : '낮음');
  }
  assert.ok(n > 30);
});
test('조건 적합도: 같은 봉에서 LONG/SHORT 거울 시계열은 BTC 항목을 뺀 점수가 같다(대칭)', () => {
  let n = 0;
  for (let i = 1100; i < ETH.length; i += 2) {
    const a = at(ETH, i), b = at(SOL, i); if (a.status !== 'ok' || a.stage < 1) continue;
    n++; const pa = Object.fromEntries(a.score.parts.map(p => [p.key, p.score])), pb = Object.fromEntries(b.score.parts.map(p => [p.key, p.score]));
    for (const k of ['trend', 'pullback', 'reward', 'risk']) assert.ok(Math.abs(pa[k] - pb[k]) < 0.11, `${k} @${i}: ${pa[k]} vs ${pb[k]}`);
  }
  assert.ok(n > 20);
});
test('조건 적합도: 거래량 결측이면 거래량 항목에 점수를 주지 않고, 반대편 장애물이 없으면 손익비는 절반, 기준 구간이 없으면 0', () => {
  const a = at(ETH, ethStage[3][0]);
  const noVol = fitScore({ ...a, metrics: { ...a.metrics, volume: volumeState(null, null), relVol: null } });
  assert.equal(noVol.parts.find(p => p.key === 'volume').score, 0); assert.match(noVol.parts.find(p => p.key === 'volume').note, /확인 불가/);
  const noTarget = fitScore({ ...a, plan: { ...a.plan, target: null, rr: null } });
  assert.equal(noTarget.parts.find(p => p.key === 'reward').score, SCORE_WEIGHTS.reward / 2);
  const noPlan = fitScore({ ...a, plan: null }); assert.equal(noPlan.parts.find(p => p.key === 'reward').score, 0);
  const btcUnknown = fitScore({ ...a, metrics: { ...a.metrics, btcAlign: '확인 불가' } }); assert.equal(btcUnknown.parts.find(p => p.key === 'btc').score, 0);
});
test('조건 적합도: 조건이 더 갖춰질수록 같거나 높다(3단계 평균 ≥ 2단계 평균 ≥ 1단계 평균)', () => {
  const avg = st => { const v = []; for (const c of [ETH, SOL]) for (let i = 1100; i < c.length; i++) { const a = at(c, i); if (a.status === 'ok' && a.stage === st) v.push(a.score.total); } return v.reduce((x, y) => x + y, 0) / v.length; };
  const [s1, s2, s3] = [1, 2, 3].map(avg); assert.ok(s3 >= s2 && s2 >= s1, `${s1} / ${s2} / ${s3}`);
});
test('거래량 상태: 확대/보통/위축/확인 불가, 눌림 중 위축 판정', () => {
  assert.equal(volumeState(1.5, 0.5).level, '확대'); assert.equal(volumeState(1.5, 0.5).confirmed, true); assert.equal(volumeState(1.5, 0.5).dry, true);
  assert.equal(volumeState(1.0, 1.1).level, '보통'); assert.equal(volumeState(1.0, 1.1).dry, false);
  assert.equal(volumeState(0.5, null).level, '위축'); assert.equal(volumeState(0.5, null).dry, null);
  assert.equal(volumeState(null, null).level, '확인 불가'); assert.equal(volumeState(NaN, 0.5).confirmed, false);
});

// ── 가격 계획 ──
test('가격 계획: 계산된 값만 담고, LONG은 무효화 < 관찰 가격 < 목표, SHORT는 반대, 손익비는 거리 비율과 일치', () => {
  let nL = 0, nS = 0;
  for (const [c, dir] of [[ETH, 'LONG'], [SOL, 'SHORT']]) for (let i = 1100; i < c.length; i += 2) {
    const a = at(c, i); if (a.status !== 'ok' || a.stage < 1) continue;
    const p = a.plan; assert.ok(p, '단계 1 이상이면 계획 존재'); assert.equal(a.dir, dir); assert.equal(p.ref, a.price); assert.equal(p.invalidation, a.invalidation);
    const s = dir === 'LONG' ? 1 : -1, risk = (p.ref - p.invalidation) * s; assert.ok(risk > 0, '위험폭 양수'); assert.ok(Math.abs(p.riskPct - risk / p.ref * 100) < 1e-9);
    if (p.target) {
      assert.equal(p.target.price, a.opposing); assert.ok((p.target.price - p.ref) * s > 0, '목표는 진행 방향'); assert.ok(Math.abs(p.rr - (p.target.price - p.ref) * s / risk) < 1e-9);
      assert.match(p.target.source, dir === 'LONG' ? /고점/ : /저점/); assert.ok(p.target.pct > 0);
    } else { assert.equal(p.rr, null); assert.equal(a.opposing, null); }
    dir === 'LONG' ? nL++ : nS++;
  }
  assert.ok(nL > 30 && nS > 30);
});
test('가격 계획: 단계 0(대기)에서는 가격·점수를 만들지 않는다', () => {
  let seen = 0;
  for (let i = 1100; i < ETH.length; i += 5) { const a = at(ETH, i); if (a.status === 'ok' && a.stage === 0) { seen++; assert.equal(a.plan, null); assert.equal(a.score, null); assert.equal(a.zone, null); assert.equal(a.invalidation, null); } }
  assert.ok(seen > 10);
});
test('가격 계획: 진행 중인 마지막 봉(미확정)을 뒤에 붙여도 결과가 바뀌지 않는다는 기존 보장 위에서 계획·점수도 같다', () => {
  const i = ethStage[3][0], a = at(ETH, i), b = (() => { const s = ETH.slice(0, i + 1); return analyzeCoin(s, aggregate(s), aggregate(BTC.slice(0, i + 1))); })();
  assert.deepEqual(a.plan, b.plan); assert.deepEqual(a.score, b.score);
});

// ── 메시지 ──
const item = (sym, series, i, type = 'new') => { const s = series.slice(0, i + 1), a = analyzeCoin(s, aggregate(s), aggregate(BTC.slice(0, i + 1))); return { symbol: sym, event: { type, to: { dir: a.dir, stage: a.stage }, prevDir: null }, analysis: a, price: a.price }; };
const stage2i = ethStage[2].find(i => at(ETH, i).dir === 'LONG');
test('메시지: 3단계(조건 충족)와 2단계(눌림 진행 중)는 머리줄부터 구분되고 근거·위험·가격이 함께 있다', () => {
  const m3 = watchBlock('ETHUSDT', item('ETHUSDT', ETH, ethStage[3][0]).analysis, { type: 'new' });
  const m2 = watchBlock('ETHUSDT', item('ETHUSDT', ETH, stage2i).analysis, { type: 'new' });
  assert.match(m3, /^✅/); assert.match(m3, /3단계 · 조건 충족<\/b> — 점검 7\/7 모두 통과/); assert.ok(!/남은 조건/.test(m3));
  assert.match(m2, /2단계 · 눌림 진행 중<\/b> — 관찰 단계, 점검 \d\/7/); assert.match(m2, /🔜 3단계까지 남은 조건/); assert.ok(!/^✅/.test(m2)); assert.ok(!/3단계 · /.test(m2));
  for (const m of [m3, m2]) for (const need of ['조건 적합도', '관찰 가격', '확정 1H 종가', '무효화', '📈 근거', '⚠️ 위험', '거래량', 'BTC 4H', '변동성']) assert.ok(m.includes(need), `${need} 없음`);
  assert.match(m3, /목표 [\d.]+ \(\+/); assert.match(m3, /손익비 [\d.]+R/);
});
test('메시지: 계산 근거가 없으면 가격 줄을 만들지 않는다(목표 없음 → 산정 불가, 계획 없음 → 가격 줄 없음)', () => {
  const a = item('ETHUSDT', ETH, ethStage[3][0]).analysis;
  const noTarget = watchBlock('ETHUSDT', { ...a, plan: { ...a.plan, target: null, rr: null }, opposing: null }, { type: 'new' });
  assert.match(noTarget, /목표 산정 불가/); assert.ok(!/⚖️/.test(noTarget)); assert.match(noTarget, /🛑 무효화/);
  const noPlan = watchBlock('ETHUSDT', { ...a, plan: null }, { type: 'new' });
  assert.ok(!/🛑|🎯|⚖️/.test(noPlan)); assert.match(noPlan, /💰 관찰 가격/);
});
test('메시지: SHORT는 무효화가 위(+)·목표가 아래(−)로 표시되고, 퍼센트는 가격 변화 기준이다', () => {
  const j = find(SOL, a => a.stage === 3)[0], a = item('SOLUSDT', SOL, j).analysis, m = watchBlock('SOLUSDT', a, { type: 'new' });
  assert.match(m, /무효화 [\d.]+ \(\+[\d.]+%\)/); assert.match(m, /목표 [\d.]+ \(−[\d.]+%\)/); assert.match(m, /상향 이탈하면 해제/);
});
test('메시지: 금지 표현이 없고(승률·확률·매수·매도·주문·손절·레버리지·진입 추천), HTML은 <b>만 쓰며, 한 줄이 모바일에서 읽을 만큼 짧다', () => {
  const FORBID = /승률|확률|레버리지|매수|매도|진입 추천|주문|수익 보장|손절/;
  const parts = formatAlerts([item('ETHUSDT', ETH, ethStage[3][0]), item('ETHUSDT', ETH, stage2i), item('SOLUSDT', SOL, find(SOL, a => a.stage === 3)[0])], { now: Date.UTC(2024, 5, 1, 3, 0, 20) });
  for (const p of parts) {
    assert.ok(!FORBID.test(p.text.replace(DISCLAIMER, '')), p.text.match(FORBID)?.[0]); assert.ok(!/<(?!\/?b>)/.test(p.text.replace(/&lt;|&gt;/g, '')), '허용되지 않은 HTML 태그'); assert.ok(p.text.length <= 4000);
    for (const line of p.plain.split('\n').filter(l => !l.startsWith('※'))) assert.ok([...line].length <= 70, `줄이 길다(${[...line].length}): ${line}`);
  }
  assert.match(DISCLAIMER, /수익성은 검증되지 않았습니다/); assert.match(DISCLAIMER, /확률이 아닙니다/);
});
test('메시지: 종목명 등 외부 문자열은 이스케이프되고 3600자 분할 기준을 지킨다', () => {
  const base = item('ETHUSDT', ETH, ethStage[3][0]), many = Array.from({ length: 12 }, (_, k) => ({ ...base, symbol: `C${k}USDT` }));
  const parts = formatAlerts(many, { now: Date.UTC(2024, 5, 1, 3, 0, 20) }); assert.ok(parts.length >= 3);
  for (const p of parts) assert.ok(p.text.length <= 3600 + 20, `분할 초과 ${p.text.length}`); assert.equal(parts.flatMap(p => p.items).length, 12);
});
test('우선순위: 같은 순위·같은 충족 개수에서는 조건 적합도 높은 순, 점수가 없으면 기존 순서(종목명)', () => {
  const a = item('AUSDT', ETH, ethStage[3][0]), b = { ...item('BUSDT', ETH, ethStage[3][0]) };
  b.analysis = { ...b.analysis, score: { ...b.analysis.score, total: b.analysis.score.total + 5 } };
  assert.deepEqual(sortAlerts([a, b]).map(x => x.symbol), ['BUSDT', 'AUSDT']);
  const a2 = { ...a, analysis: { ...a.analysis, score: undefined } }, b2 = { ...b, analysis: { ...b.analysis, score: undefined } };
  assert.deepEqual(sortAlerts([b2, a2]).map(x => x.symbol), ['AUSDT', 'BUSDT']);
});

// ── 과거 검증 도구 ──
const bar = (t, o, h, l, c) => ({ t, o, h, l, c, q: 1000 });
test('outcome: 목표 도달 / 무효화 종가 이탈 / 같은 봉 동시 발생은 무효화 / 시간 만료, 비용과 MAE·MFE 계산', () => {
  const T = 0, base = [bar(T, 100, 101, 99, 100)];
  const mk = rows => [...base, ...rows.map((r, k) => bar(T + (k + 1) * H1, ...r))];
  // 롱: 다음 봉 시가 100, 무효화 98 → 위험 2R, 목표 104(= 2R)
  let o = outcome(mk([[100, 103, 99.5, 102], [102, 104.5, 101, 104]]), 0, 'LONG', 98, 104, { costBps: 0 });
  assert.equal(o.kind, 'target'); assert.ok(Math.abs(o.gross - 2) < 1e-9); assert.ok(Math.abs(o.mae - 0.25) < 1e-9); assert.ok(Math.abs(o.mfe - 2.25) < 1e-9);
  o = outcome(mk([[100, 101, 97, 97.5]]), 0, 'LONG', 98, 104, { costBps: 0 }); assert.equal(o.kind, 'stop'); assert.ok(Math.abs(o.gross + 1.25) < 1e-9);   // 종가에서 종료(갭 포함)
  o = outcome(mk([[100, 105, 99, 97.9]]), 0, 'LONG', 98, 104, { costBps: 0 }); assert.equal(o.kind, 'stop', '동시 발생은 보수적으로 무효화');
  o = outcome(mk([[100, 100.5, 99.9, 100.2], [100.2, 100.9, 100, 100.4]]), 0, 'LONG', 98, 104, { horizon: 2, costBps: 0 }); assert.equal(o.kind, 'time'); assert.ok(Math.abs(o.gross - 0.2) < 1e-9);
  o = outcome(mk([[100, 100.5, 99.9, 100.2]]), 0, 'LONG', 98, null, { horizon: 1, costBps: 10 }); assert.ok(Math.abs(o.net - (0.1 - 100 * 0.001 / 2)) < 1e-9, '비용 10bp = 0.05R');   // 위험 2 → 수수료 0.1/2
  // 숏 대칭
  o = outcome(mk([[100, 100.5, 96, 96.5]]), 0, 'SHORT', 102, 96, { costBps: 0 }); assert.equal(o.kind, 'target'); assert.ok(Math.abs(o.gross - 2) < 1e-9);
  assert.deepEqual(outcome(mk([[99, 99.5, 98, 98.5]]), 0, 'LONG', 99.5, 104), { skipped: 'already-invalid' });   // 체결 시가가 이미 무효화 아래
  assert.equal(outcome(base, 0, 'LONG', 98, 104), null);
});
test('백테스트 인과성: 뒤에 데이터를 더 붙여도 앞선 이벤트·결과(기간 안에 끝난 것)는 그대로다', () => {
  const short = ETH.slice(0, 1900), long = ETH.slice(0, 2500), H = 48;
  const a = collectEvents('ETHUSDT', short, BTC.slice(0, 1900), { horizon: H }).events, b = collectEvents('ETHUSDT', long, BTC.slice(0, 2500), { horizon: H }).events;
  const key = e => [e.i, e.stage, e.score, e.type, e.o.kind, e.o.net.toFixed(9), e.o.mae.toFixed(9)].join('|');
  const lim = 1900 - 1 - H, A = a.filter(e => e.i < lim).map(key), B = b.filter(e => e.i < lim).map(key);
  assert.ok(A.length > 3, `이벤트 ${A.length}`); assert.deepEqual(A, B);
});
test('백테스트: 이벤트는 운영과 같은 중복 방지를 따른다(같은 에피소드에서 같은 단계 재알림 없음) 그리고 2단계 이상만', () => {
  const ev = collectEvents('ETHUSDT', ETH, BTC).events, seen = new Set();
  assert.ok(ev.length > 5 && ev.every(e => e.stage >= 2));
  for (const e of ev) assert.ok(e.o.risk > 0 && Number.isFinite(e.o.net) && e.o.mae >= 0 && e.o.mfe >= 0);
  const sorted = [...ev].sort((a, b) => a.i - b.i);
  for (let k = 1; k < sorted.length; k++) assert.ok(sorted[k].i > sorted[k - 1].i, '같은 봉에 이벤트 중복');
  for (const e of sorted) seen.add(`${e.i}`);
  assert.equal(seen.size, sorted.length);
});
test('백테스트: LONG/SHORT 거울 시계열은 같은 이벤트 수와 같은 결과(BTC 맥락 없이)', () => {
  const a = collectEvents('ETHUSDT', ETH, null).events, b = collectEvents('SOLUSDT', SOL, null).events;
  assert.equal(a.length, b.length); assert.ok(a.length > 5);
  for (let k = 0; k < a.length; k++) { assert.equal(a[k].i, b[k].i); assert.equal(a[k].dir, 'LONG'); assert.equal(b[k].dir, 'SHORT'); assert.equal(a[k].o.kind, b[k].o.kind); }
});
test('백테스트 집계: 코호트 분할이 일관되고(3단계+2단계=전체) 점수 단조성·부트스트랩은 결정적이다', () => {
  const r = runBacktest({ ETHUSDT: ETH, SOLUSDT: SOL, BTCUSDT: BTC }, BTC), by = n => r.cohorts.find(c => c.name === n).all;
  assert.equal(r.cohorts.length, COHORTS.length); assert.equal(by('기존: 3단계(조건 충족)만').n + by('기존: 2단계만').n, by('기존: 2단계 이상 알림 전체').n);
  assert.equal(by('점수 75↑ (높음)').n + by('점수 55~74 (보통)').n + by('점수 55↓ (낮음)').n, by('기존: 2단계 이상 알림 전체').n);
  const all = by('기존: 2단계 이상 알림 전체'); assert.ok(all.n > 10 && all.target + all.stop + all.time > 0.999 && all.target + all.stop + all.time < 1.001);
  assert.ok(all.ciLo <= all.meanNetR && all.meanNetR <= all.ciHi); assert.ok(all.maeP90R >= all.maeR * 0 && all.maeR >= 0);
  const r2 = runBacktest({ ETHUSDT: ETH, SOLUSDT: SOL, BTCUSDT: BTC }, BTC); assert.deepEqual(r2.cohorts, r.cohorts); assert.deepEqual(r2.control, r.control);
  assert.ok(r.control.n > 0);
});
test('점수 단조성 도구: 점수가 오를수록 결과가 좋으면 rho>0, 거꾸로면 rho<0, 표본이 적으면 판단하지 않음', () => {
  const mkRows = f => Array.from({ length: 80 }, (_, k) => ({ score: 30 + k % 60, t: k * 3600000, o: { net: f(30 + k % 60), kind: 'time', mae: 1 } }));
  assert.ok(scoreMonotonic(mkRows(s => s / 50)).rho > 0.9); assert.ok(scoreMonotonic(mkRows(s => -s / 50)).rho < -0.9);
  const q = scoreMonotonic(mkRows(s => s / 50)).quartiles; assert.ok(q[3].meanNetR > q[0].meanNetR);
  assert.equal(scoreMonotonic(mkRows(s => s).slice(0, 5)).rho, null);
  const rows = mkRows(s => s / 50); assert.deepEqual(clusterBootstrap(rows, r => r.o.net), clusterBootstrap(rows, r => r.o.net));
  assert.equal(summarize([]).n, 0);
});
test('보고서: 코호트 표·대조군·점수 단조성 표가 만들어지고 비어 있는 값은 -로 표시', async () => {
  const { renderReport } = await import('../opportunity/backtest.mjs');
  const r = runBacktest({ ETHUSDT: ETH, SOLUSDT: SOL, BTCUSDT: BTC }, BTC), t = renderReport(r, { note: '합성' });
  for (const need of ['기존: 3단계(조건 충족)만', '점수 75↑', '(대조)', '스피어먼', '| 코호트 |']) assert.ok(t.includes(need), need);
  assert.ok(!/NaN|undefined|Infinity/.test(t), t.match(/NaN|undefined|Infinity/)?.[0]);
  assert.ok(renderReport({ ...r, cohorts: [], events: 0, scoreMonotonic: { n: 0, rho: null, quartiles: [] }, scoreMonotonic3: { n: 0, rho: null, quartiles: [] }, control: { targetR: 2, ...summarize([]) } }).includes('-'));
});
test('과거 검증 도구는 네트워크·Telegram·주문과 무관하다(모듈에 외부 호출 없음, CLI는 공개 GET만)', async () => {
  const { readFileSync } = await import('node:fs');
  const mod = readFileSync(new URL('../opportunity/backtest.mjs', import.meta.url), 'utf8'), cli = readFileSync(new URL('../opportunity/backtest-cli.mjs', import.meta.url), 'utf8');
  assert.ok(!/fetch\(|jsonRequest|sendText|process\.env|TELEGRAM/.test(mod));
  assert.ok(!/sendText|TELEGRAM_|process\.env|method:\s*['"]POST|\/trade\/|\/account\//i.test(cli));
  const wf = readFileSync(new URL('../../.github/workflows/opportunity-backtest.yml', import.meta.url), 'utf8');
  assert.ok(!/secrets\.|schedule:|cron:/.test(wf) && /contents: read/.test(wf) && /branches: \['claude\/opportunity-radar-v2'\]/.test(wf));
});
