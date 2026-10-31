// B급 공격형 판정·백테스트 비교 테스트(합성 데이터, 네트워크·Telegram·주문 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateB, SIGB } from '../signal/gradeb.mjs';
import { evaluateSignal, M15 } from '../signal/evaluate.mjs';
import { collectGradeEvents, usdtStats, gradeVerdict, renderGradeReport, runGradeBacktest, budgetA, budgetB } from '../signal/gradeb-backtest.mjs';
import { ETH, wave, mirror } from './opportunity-fixture.mjs';
import { expand15, mkA, mirrorA, mirror15, T, NOW } from './signal-fixture.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const K = 200;
// 15분봉 구성: 앞 62봉은 100.4 근처 횡보 후, 지정한 마지막 봉들을 붙인다. rows: [o,h,l,c,q]. 마지막 봉 마감 시각 = T + 15분(NOW 기준 1분 경과).
function bars(rows, { closeT = T + M15 } = {}) {
  const tail = rows.length, n = 62 + tail, out = [];
  for (let k = 0; k < n; k++) {
    const t = closeT - (n - k) * M15;
    if (k < 62) { const w = ((k * 7) % 5) / 10; out.push({ t, o: 100.4 + w * 0.2, h: 100.7 + w * 0.2, l: 100.1 - w * 0.1, c: 100.4 - w * 0.1 + 0.1, q: 1000 }); }
    else { const [o, h, l, c, q] = rows[k - 62]; out.push({ t, o, h, l, c, q }); }
  }
  return out;
}
// 눌림(저점 98.9 = 구간 지지 98.8~99.6 시험) → 반등 → 단기 고점 99.55 → 마지막 봉이 99.55 위로 마감하는 구조 회복. 15분 8봉 고점(≈100.7)은 아직 돌파하지 않음 → A급은 대기.
const OK = [
  [100.3, 100.4, 99.9, 100.0, 1000], [100.0, 100.1, 99.5, 99.6, 1000], [99.6, 99.7, 99.1, 99.2, 1000], [99.2, 99.3, 98.9, 99.1, 1100], [99.1, 99.4, 99.0, 99.3, 1000],
  [99.3, 99.5, 99.1, 99.2, 900], [99.2, 99.45, 99.1, 99.4, 1000], [99.4, 99.55, 99.2, 99.3, 900], [99.3, 99.4, 99.15, 99.35, 1000], [99.35, 99.95, 99.3, 99.9, 1500],
];
const evB = (rows, a = mkA(), o = {}) => evaluateB({ a, c15: bars(rows), now: NOW }, o);

test('B급: 구간 시험 뒤 구조 회복 확인이 되면 A급보다 먼저 진입 후보(손절=눌림 저점−0.25ATR, 비용 반영 ≥2R)', () => {
  const a = mkA(), c = bars(OK), ev = evaluateB({ a, c15: c, now: NOW });
  assert.equal(ev.status, 'CANDIDATE', JSON.stringify(ev.blockers)); assert.equal(ev.grade, 'B'); assert.equal(ev.dir, 'LONG');
  assert.ok(Math.abs(ev.swing - 98.9) < 1e-9 && Math.abs(ev.stop - (98.9 - 0.25)) < 1e-9, '손절 = 눌림 저점 − 0.25 ATR(1H)');
  assert.ok(ev.stop >= a.invalidation, '1H 무효화보다 멀지 않다(위험 예산을 키우지 않음)'); assert.ok(ev.t1.net >= SIGB.minRR2 && ev.t1.price === 105);
  assert.ok(ev.riskAtr >= SIGB.stopMinAtr1 && ev.riskAtr <= SIGB.stopMaxAtr1); assert.equal(ev.evidence.length, 3);
  const evA = evaluateSignal({ a, c15: c, now: NOW });
  assert.equal(evA.status, 'OBSERVE'); assert.ok(evA.tags.includes('trigger'), 'A급은 8봉 돌파를 아직 기다린다 → B급이 더 빠르다');
});
test('B급: 회복·저점 유지·확인 봉·거래량·구간 접근·깊이·목표 손익비·손절 한도 중 하나라도 어기면 후보가 아니다(사유 태그)', () => {
  const mod = (idx, patch) => OK.map((r, k) => (k === idx ? r.map((v, j) => (patch[j] === undefined ? v : patch[j])) : r));
  const tag = (rows, a, t) => { const ev = evB(rows, a); assert.equal(ev.status, 'OBSERVE', `${t}: ${ev.status} ${JSON.stringify(ev.blockers)}`); assert.ok(ev.tags.includes(t), `${t} 태그 필요: ${ev.tags}`); };
  tag(mod(9, [99.35, 99.5, 99.3, 99.45, 1500]), mkA(), 'recovery');                 // 마지막 종가가 단기 고점(99.55) 아래
  tag(mod(9, [99.85, 99.95, 99.3, 99.4, 1500]), mkA(), 'confirm');                  // 음봉 확인 봉
  tag(mod(9, [99.35, 99.95, 99.3, 99.9, 300]), mkA(), 'volume');                    // 거래량 부족
  tag(OK.map(r => r.map((v, j) => (j < 4 ? v + 2 : v))), mkA(), 'touch');           // 구간까지 내려오지 않음
  tag(OK.map((r, k) => (k === 3 ? [99.2, 99.3, 97.8, 99.1, 1100] : r)), mkA(), 'depth');   // 구간 하단 아래로 0.75ATR 넘게 이탈
  tag(OK, mkA({ obstacles: [{ price: 101.6, source: '근거 없음 테스트' }] }), 'target');   // 1차 목표 비용 반영 2R 미만
  tag(OK, mkA({ invalidation: 98.7 }), 'depth');                                       // 손절이 1H 무효화보다 느슨
  tag(OK.map((r, k) => (k === 9 ? [99.35, 100.9, 99.3, 100.85, 1500] : r)), mkA(), 'spike');   // 큰 봉 → 급변·추격
  tag(OK, mkA({ metrics: { ...mkA().metrics, atr1: 5 } }), 'stop');                         // 손절 거리가 0.5 ATR(1H) 미만으로 너무 좁음
});
test('B급: 저점을 다시 깨면(최근 3봉이 눌림 저점 갱신) 새 저점 직후라 회복 전, 시험 후 12봉 넘게 지나면 오래됨', () => {
  const lower = OK.map((r, k) => (k === 8 ? [99.3, 99.4, 98.8, 99.35, 1000] : r));
  const ev = evB(lower); assert.equal(ev.status, 'OBSERVE'); assert.ok(ev.tags.includes('recovery'));
  const old = [...OK.slice(0, 4), ...Array.from({ length: 12 }, () => [99.45, 99.5, 99.4, 99.45, 1000]), OK[9]].map(r => r.slice());
  const e2 = evaluateB({ a: mkA(), c15: bars(old), now: NOW }); assert.ok(e2.status !== 'CANDIDATE');
});
test('B급: SHORT 대칭, 지연·분석 불가·15분봉 부족은 WAIT, ignore 로 확인 조건을 빼면 대조군 판정', () => {
  const am = mirrorA(mkA()), cm = mirror15(bars(OK)).map(b => ({ ...b, q: b.q })); const ev = evaluateB({ a: am, c15: cm, now: NOW });
  assert.equal(ev.status, 'CANDIDATE', JSON.stringify(ev.blockers)); assert.equal(ev.dir, 'SHORT'); assert.ok(Math.abs(ev.swing - (K - 98.9)) < 1e-9 && ev.stop > ev.swing);
  assert.match(evaluateB({ a: mkA(), c15: bars(OK), now: NOW + 30 * 60000 }).why, /지연/);
  assert.match(evaluateB({ a: { status: 'insufficient', reason: 'x' }, c15: bars(OK), now: NOW }).why, /분석 불가/);
  assert.match(evaluateB({ a: mkA(), c15: bars(OK).slice(-40), now: NOW }).why, /15분봉 부족/);
  assert.match(evaluateB({ a: mkA({ stage: 1 }), c15: bars(OK), now: NOW }).why, /구간 접근/);
  const weak = OK.map((r, k) => (k === 9 ? [99.35, 99.5, 99.3, 99.45, 300] : r));
  assert.equal(evB(weak).status, 'OBSERVE'); const ctl = evB(weak, mkA(), { ignore: ['recovery', 'hold', 'confirm', 'volume'] }); assert.equal(ctl.status, 'CANDIDATE');
});
test('B급: 입력을 바꾸지 않고(순수) 같은 입력이면 같은 결과', () => {
  const a = mkA(), c = bars(OK), s1 = JSON.stringify([a, c]), r1 = evaluateB({ a, c15: c, now: NOW }), r2 = evaluateB({ a, c15: c, now: NOW });
  assert.equal(JSON.stringify([a, c]), s1); assert.deepEqual(r1, r2);
});
test('금액 환산: A급 3 USDT(점수 80 이상 4.5), B급 1.5 USDT, 최대 낙폭·최악의 하루·일 한도(−9) 초과 일수', () => {
  assert.equal(budgetA(70), 3); assert.equal(budgetA(80), 4.5); assert.equal(budgetB(), 1.5); assert.equal(SIGB.riskUsdt, 1.5); assert.equal(SIGB.dayLossUsdt, 9); assert.equal(SIGB.maxLev, 3);
  const d = Date.UTC(2026, 9, 1), mk = (t, net, budget) => ({ t, budget, res: { wick: { net } } });
  const s = usdtStats([mk(d, 2, 1.5), mk(d + 3600000, -1, 1.5), mk(d + 2 * 3600000, -1, 1.5), mk(d + 86400000, -1, 4.5), mk(d + 86400000 + 1000, -1.2, 4.5), mk(d + 86400000 + 2000, -1, 4.5)]);
  assert.equal(s.n, 6); assert.ok(Math.abs(s.total - (3 - 1.5 - 1.5 - 4.5 - 5.4 - 4.5)) < 1e-9); assert.ok(Math.abs(s.worst - -5.4) < 1e-9);
  assert.ok(Math.abs(s.worstDay - -14.4) < 1e-9 && s.daysOverLimit === 1); assert.ok(s.maxDD >= 14.4);
  assert.deepEqual(usdtStats([]), { n: 0, total: 0, perTrade: null, worst: null, maxDD: 0, worstDay: null, daysOverLimit: 0 });
});
test('우위 판정: 표본 부족·신뢰구간 하한 ≤ 0·A급보다 낮으면 미입증, 모두 만족할 때만 가능성', () => {
  const S = (n, netR, ciLo) => ({ n, netR, ciLo });
  assert.equal(gradeVerdict({ A: S(100, 0.1, -0.2), B: S(0, null, null) }).proven, false);
  assert.equal(gradeVerdict({ A: S(100, 0.1, -0.2), B: S(20, 0.5, 0.2) }).proven, false);
  assert.equal(gradeVerdict({ A: S(100, 0.1, -0.2), B: S(100, 0.05, 0.01) }).proven, false);
  assert.equal(gradeVerdict({ A: S(100, 0.1, -0.2), B: S(100, 0.2, -0.05) }).proven, false);
  const ok = gradeVerdict({ A: S(100, 0.1, -0.2), B: S(100, 0.2, 0.03) }); assert.equal(ok.proven, true); assert.match(ok.text, /가능성/);
});
const E5 = wave(5000, 5), B5 = wave(5000, 9, { amp: 0.04, per: 300 }), eth = expand15(E5), btc = expand15(B5);
test('백테스트: 결정적·인과적(뒤 데이터가 앞 결과를 바꾸지 않음)이고 이중 운용 합계는 A 단독과 B 단독의 부분집합이다', () => {
  const cut = 4 * 3500 + 2, a = collectGradeEvents('ETHUSDT', eth.slice(0, cut), btc.slice(0, cut)), b = collectGradeEvents('ETHUSDT', eth, btc), again = collectGradeEvents('ETHUSDT', eth, btc);
  assert.deepEqual(b, again);
  for (const k of Object.keys(a)) for (const e of a[k]) { const same = b[k].find(x => x.i === e.i && x.dir === e.dir && x.grade === e.grade); assert.ok(same, `${k}: 먼저 나온 이벤트가 전체 데이터에서도 존재`); assert.equal(same.stop, e.stop); }
  for (const e of b.B) { assert.equal(e.grade, 'B'); assert.equal(e.budget, 1.5); assert.ok(e.net1 >= SIGB.minRR2 - 1e-9, 'B급 후보는 비용 반영 2R 이상'); }
  for (const e of b.DUAL) assert.ok(['A', 'B'].includes(e.grade));
});
test('백테스트 보고서: 판정 문구와 표 구성', () => {
  const r = runGradeBacktest({ ETHUSDT: eth, BTCUSDT: btc }, btc), md = renderGradeReport(r, { note: '합성' });
  assert.match(md, /A급 확정형 단독/); assert.match(md, /B급 공격형 단독/); assert.match(md, /이중 운용 합계/); assert.match(md, /판정: B급 우위/); assert.ok(r.streams.A && r.streams.B && r.streams.BCTL && r.split.B_not_followed_by_A);
});
