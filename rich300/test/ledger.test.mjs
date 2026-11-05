import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerBuildDaily } from '../lib/ledger.mjs';
import { dayStartMs } from '../lib/time.mjs';

const M = n => BigInt(Math.round(n * 1e6));
const D1 = '2026-10-24', D2 = '2026-10-25', D3 = '2026-10-26';
const at = (day, h = 12) => dayStartMs(day) + h * 3600000;
const ch = (o = {}) => ({ startEquity: '300', startDay: D1, rateSchedule: [{ from: D1, rate: '0.05' }], ...o });
const fill = (o = {}) => ({ origin: 'real', fillId: 'f1', sid: 'S1', kind: 'entry', dir: 'LONG', at: at(D1, 1), price: '100', qty: '1', fee: { state: 'entered', amount: '0' }, funding: { state: 'entered', amount: '0' }, ...o });

test('입출금은 손익과 분리: 100 입금한 날 마감 415, 일 손익 = 415 − 315 − 100 = 0', () => {
  const r = ledgerBuildDaily({ challenge: ch(), throughDay: D2, equityInputs: [{ day: D1, equity: '315' }, { day: D2, equity: '415' }], cashflows: [{ cfId: 'c1', at: at(D2), amount: '100' }] });
  assert.equal(r.rows[1].pnlMicro, 0n); assert.equal(r.rows[1].cashflowMicro, M(100)); assert.equal(r.rows[1].targetCloseMicro, M(330.75)); assert.equal(r.rows[1].startMicro, M(315));   // 입금은 목표 기준(전일 마감)에 안 섞임
  assert.equal(r.summary.pnlTotalMicro, M(15)); assert.equal(r.summary.netCashflowMicro, M(100));
  const out = ledgerBuildDaily({ challenge: ch(), throughDay: D2, equityInputs: [{ day: D1, equity: '315' }, { day: D2, equity: '280' }], cashflows: [{ cfId: 'c2', at: at(D2), amount: '-50' }] });
  assert.equal(out.rows[1].pnlMicro, M(15));                                                                  // 280 − 315 − (−50) = +15
});
test('실제 손익이 장부와 일치하면 차이 0·확인 불필요, LONG 체결 반영(+10, 수수료 0.2)', () => {
  const fills = [fill({ price: '100', qty: '1', fee: { state: 'entered', amount: '0.1' } }), fill({ fillId: 'f2', kind: 'close', price: '110', at: at(D1, 5), fee: { state: 'entered', amount: '0.1' } })];
  const r = ledgerBuildDaily({ challenge: ch(), throughDay: D1, fills, equityInputs: [{ day: D1, equity: '309.8' }] });
  assert.equal(r.rows[0].ledgerWalletMicro, M(309.8)); assert.equal(r.rows[0].diffMicro, 0n); assert.equal(r.rows[0].needsReview, false); assert.equal(r.rows[0].realizedGrossMicro, M(10));
  assert.equal(r.rows[0].closeSource, 'input'); assert.deepEqual(r.rows[0].flags, []);
});
test('누락 거래: 입력 평가액이 장부보다 5 USDT 크면 차이를 숨기지 않고 확인 요청(자동 흡수 없음)', () => {
  const r = ledgerBuildDaily({ challenge: ch(), throughDay: D2, equityInputs: [{ day: D1, equity: '305' }, { day: D2, equity: '312' }] });
  assert.equal(r.rows[0].diffMicro, M(5)); assert.equal(r.rows[0].needsReview, true); assert.ok(r.rows[0].flags.includes('ledger-mismatch'));
  assert.equal(r.rows[0].pnlMicro, M(5));                                                                       // 손익은 입력 평가액 기준 그대로
  assert.equal(r.rows[1].ledgerWalletMicro, M(300));                                                            // 장부는 입력으로 덮어쓰지 않는다
  assert.equal(r.rows[1].diffMicro, M(12)); assert.equal(r.summary.daysNeedingReview, 2);
  const adj = ledgerBuildDaily({ challenge: ch(), throughDay: D1, equityInputs: [{ day: D1, equity: '305' }], adjustments: [{ adjId: 'a1', at: at(D1), amount: '5', reason: '누락 체결 수동 확인' }] });
  assert.equal(adj.rows[0].diffMicro, 0n); assert.equal(adj.rows[0].adjustmentMicro, M(5));                      // 명시 조정만 차이를 설명
});
test('허용 오차: 1 USDT 이하 또는 0.5% 이하 차이는 확인 불필요, 초과는 필요', () => {
  const run = e => ledgerBuildDaily({ challenge: ch({ startEquity: '1000' }), throughDay: D1, equityInputs: [{ day: D1, equity: e }] }).rows[0];
  assert.equal(run('1004.9').needsReview, false); assert.equal(run('1005.1').needsReview, true); assert.equal(run('995.1').needsReview, false); assert.equal(run('995.0').needsReview, true);   // 허용치 = max(1, 0.5%×평가액): 995.0은 차이 5.0 > 4.975
  assert.equal(ledgerBuildDaily({ challenge: ch(), throughDay: D1, equityInputs: [{ day: D1, equity: '301.1' }] }).rows[0].needsReview, false);   // 차이 1.1 ≤ 1.5(0.5%)
  assert.equal(ledgerBuildDaily({ challenge: ch(), throughDay: D1, equityInputs: [{ day: D1, equity: '302' }] }).rows[0].needsReview, true);   // 허용치 = max(1, 0.5%×302 = 1.51): 차이 2 > 1.51
});
test('평가액 미입력일: 장부 근사로 표시(closeSource=ledger, 플래그), 다음 날 목표는 그 값 기준이며 숨기지 않음', () => {
  const r = ledgerBuildDaily({ challenge: ch(), throughDay: D3, fills: [fill(), fill({ fillId: 'f2', kind: 'close', price: '103', at: at(D1, 5) })], equityInputs: [{ day: D3, equity: '310' }] });
  assert.equal(r.rows[0].closeSource, 'ledger'); assert.ok(r.rows[0].flags.includes('close-from-ledger')); assert.equal(r.rows[0].closeMicro, M(303)); assert.equal(r.rows[1].startMicro, M(303)); assert.equal(r.rows[1].targetCloseMicro, M(318.15));
  assert.equal(r.summary.daysLedgerOnly, 2); assert.equal(r.summary.daysWithInput, 1);
});
test('미결제 포지션: 미실현손익 미입력이면 불확실 표시, 입력하면 장부+미실현과 비교', () => {
  const open = [fill({ at: at(D1, 1) })];
  const missing = ledgerBuildDaily({ challenge: ch(), throughDay: D1, fills: open, equityInputs: [{ day: D1, equity: '310' }] }).rows[0];
  assert.equal(missing.uncertain, true); assert.ok(missing.flags.includes('unrealized-missing')); assert.equal(missing.openPositions, 1);
  const ok = ledgerBuildDaily({ challenge: ch(), throughDay: D1, fills: open, equityInputs: [{ day: D1, equity: '310', unrealized: '10' }] }).rows[0];
  assert.equal(ok.uncertain, false); assert.equal(ok.expectedEquityMicro, M(310)); assert.equal(ok.diffMicro, 0n);
});
test('시작 시 미결제 포지션: 시작 마크 100(원 진입 90) 롱 1개를 105에 청산 → 챌린지 손익 +5(시작 전 +10 제외), 평가액 일치', () => {
  // 시작 평가액 300 = 지갑 290 + 시작 시 미실현 10. 청산 후 지갑 295+... : 지갑 290 + (105−90)=305 = 평가액 305
  const opening = [{ sid: 'OPEN1', dir: 'LONG', qty: '1', startMark: '100', origEntry: '90' }];
  const r = ledgerBuildDaily({ challenge: ch(), throughDay: D1, openingPositions: opening, fills: [{ origin: 'real', fillId: 'c1', sid: 'OPEN1', kind: 'close', dir: 'LONG', at: at(D1, 6), price: '105', qty: '1', fee: { state: 'entered', amount: '0' }, funding: { state: 'entered', amount: '0' } }], equityInputs: [{ day: D1, equity: '305' }] });
  assert.equal(r.rows[0].realizedGrossMicro, M(5)); assert.equal(r.rows[0].pnlMicro, M(5)); assert.equal(r.rows[0].diffMicro, 0n); assert.equal(r.rows[0].needsReview, false);
  const still = ledgerBuildDaily({ challenge: ch(), throughDay: D1, openingPositions: opening, equityInputs: [{ day: D1, equity: '305', unrealized: '15' }] }).rows[0];   // 아직 보유, 거래소 미실현 +15(원 진입 기준), 지갑 290
  assert.equal(still.expectedEquityMicro, M(305)); assert.equal(still.diffMicro, 0n); assert.equal(still.pnlMicro, M(5));
  const unknown = ledgerBuildDaily({ challenge: ch(), throughDay: D1, openingPositions: [{ sid: 'OPEN1', dir: 'LONG', qty: '1', startMark: '100' }], equityInputs: [{ day: D1, equity: '305', unrealized: '15' }] }).rows[0];
  assert.equal(unknown.uncertain, true); assert.ok(unknown.flags.includes('opening-basis-unknown'));
});
test('누적 수익률·최고 평가액·최대 낙폭: 입출금이 가짜 고점/낙폭을 만들지 않는다', () => {
  // 300 → 330(+30) → 입금 100 후 400(손익 −30) → 420(+20)
  const eq = [{ day: D1, equity: '330' }, { day: D2, equity: '400' }, { day: D3, equity: '420' }];
  const r = ledgerBuildDaily({ challenge: ch(), throughDay: D3, equityInputs: eq, cashflows: [{ cfId: 'c', at: at(D2), amount: '100' }] }), s = r.summary;
  assert.equal(s.pnlTotalMicro, M(20)); assert.equal(s.returnOnStartPpm, 66667n);                                // (420−300−100)/300
  assert.equal(s.highestEquityMicro, M(420)); assert.equal(s.maxDrawdownMicro, M(30)); assert.equal(s.maxDrawdownPpm, 90909n);   // 고점 330(조정) → 300(조정): 30/330
  assert.equal(s.currentDrawdownMicro, M(10)); assert.equal(s.daysTargetMet, 2);   // 1일차 +30 ≥ 15, 3일차 +20 ≥ 20(목표 = 400×5%)
  const up = ledgerBuildDaily({ challenge: ch(), throughDay: D2, equityInputs: [{ day: D1, equity: '320' }, { day: D2, equity: '340' }] }).summary; assert.equal(up.daysTargetMet, 2); assert.equal(up.maxDrawdownMicro, 0n);   // 첫날 +20 ≥ 15, 둘째날 +20 ≥ 16
  assert.equal(up.gapToIdealMicro, M(340 - 330.75));
});
test('목표 달성률: 오늘 손익 ÷ 오늘 목표 수익금(음수 허용), 시작 전 날짜는 빈 결과', () => {
  const r = ledgerBuildDaily({ challenge: ch(), throughDay: D2, equityInputs: [{ day: D1, equity: '307.5' }, { day: D2, equity: '300' }] });
  assert.equal(r.rows[0].achievementPpm, 500000n); assert.equal(r.rows[1].achievementPpm, -487805n);          // −7.5 ÷ 15.375
  assert.deepEqual(ledgerBuildDaily({ challenge: ch(), throughDay: '2026-10-20' }).rows, []);
});
test('중복 기록 방지: 같은 입출금·체결 재전송은 한 번만, 같은 id 다른 내용은 오류, 같은 날 평가액 중복 오류, 전체 재실행 결과 동일(멱등)', () => {
  const cash = { cfId: 'c1', at: at(D1), amount: '10' }, f = [fill(), fill({ fillId: 'f2', kind: 'close', price: '102', at: at(D1, 3) })];
  const once = ledgerBuildDaily({ challenge: ch(), throughDay: D1, fills: f, cashflows: [cash], equityInputs: [{ day: D1, equity: '312' }] });
  const twice = ledgerBuildDaily({ challenge: ch(), throughDay: D1, fills: [...f, ...f], cashflows: [cash, { ...cash }], equityInputs: [{ day: D1, equity: '312' }] });
  assert.deepEqual(twice.rows, once.rows); assert.equal(once.rows[0].cashflowMicro, M(10));
  assert.throws(() => ledgerBuildDaily({ challenge: ch(), throughDay: D1, cashflows: [cash, { ...cash, amount: '11' }] }), /입출금 충돌/);
  assert.throws(() => ledgerBuildDaily({ challenge: ch(), throughDay: D1, fills: [fill(), fill({ price: '101' })] }), /체결 충돌/);
  assert.throws(() => ledgerBuildDaily({ challenge: ch(), throughDay: D1, equityInputs: [{ day: D1, equity: '1' }, { day: D1, equity: '2' }] }), /평가액 중복/);
  const again = ledgerBuildDaily({ challenge: ch(), throughDay: D1, fills: f, cashflows: [cash], equityInputs: [{ day: D1, equity: '312' }] }); assert.deepEqual(again.rows, once.rows);
});
test('수수료·펀딩 미입력은 추정하지 않고 경고, 추정치는 별도 플래그(장부 합계에는 실제 입력만)', () => {
  const f = [fill({ fee: { state: 'missing' } }), fill({ fillId: 'f2', kind: 'close', price: '110', at: at(D1, 3), fee: { state: 'estimated', amount: '1' }, funding: { state: 'missing' } })];
  const r = ledgerBuildDaily({ challenge: ch(), throughDay: D1, fills: f, equityInputs: [{ day: D1, equity: '310' }] }).rows[0];
  assert.equal(r.ledgerWalletMicro, M(310)); assert.ok(r.flags.includes('fee-missing') && r.flags.includes('funding-missing') && r.flags.includes('has-estimates'));
});
test('모의 체결은 실제 장부에 들어올 수 없다(origin=paper 거부)', () => {
  assert.throws(() => ledgerBuildDaily({ challenge: ch(), throughDay: D1, fills: [fill({ origin: 'paper' })] }), /실제 체결만/);
});
test('KST 일 경계: 23:59:59.999는 전날, 00:00:00은 다음 날로 귀속', () => {
  const edge = dayStartMs(D2);
  const f = [fill({ at: edge - 3600000 }), fill({ fillId: 'c', kind: 'close', price: '101', at: edge - 1 }), fill({ fillId: 'g', sid: 'S2', at: edge - 5000 }), fill({ fillId: 'h', sid: 'S2', kind: 'close', price: '95', at: edge })];
  const r = ledgerBuildDaily({ challenge: ch(), throughDay: D2, fills: f, equityInputs: [] });
  assert.equal(r.rows[0].realizedGrossMicro, M(1)); assert.equal(r.rows[1].realizedGrossMicro, M(-5));
});
test('결정성: 같은 입력이면 항상 같은 BigInt 결과(부동소수 의존 없음) — 200일 시뮬레이션', () => {
  let seed = 7; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const eqs = []; let cur = 300; const days = []; let d = D1;
  for (let i = 0; i < 200; i++) { cur = Math.max(1, cur * (1 + (rnd() - 0.45) * 0.1)); days.push(d); eqs.push({ day: d, equity: cur.toFixed(2) }); d = new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10); }
  const a = ledgerBuildDaily({ challenge: ch(), throughDay: days.at(-1), equityInputs: eqs }), b = ledgerBuildDaily({ challenge: ch(), throughDay: days.at(-1), equityInputs: eqs });
  assert.deepEqual(a.rows, b.rows); assert.equal(a.rows.length, 200); assert.ok(a.rows.every((r, i) => i === 0 || r.startMicro === a.rows[i - 1].closeMicro));
  assert.ok(a.rows.every(r => r.pnlMicro === r.closeMicro - r.startMicro - r.cashflowMicro));
});

test('검토 반영: 범위 밖 입력(시작 전·종료 후 체결/입출금/조정, 범위 밖 평가액)은 조용히 버리지 않고 개수 경고', () => {
  const edge = dayStartMs(D1);
  const r = ledgerBuildDaily({ challenge: ch(), throughDay: D2,
    fills: [fill({ fillId: 'old', sid: 'OLD', at: edge - 1000 }), fill({ fillId: 'late', sid: 'LATE', at: dayStartMs('2026-10-27') })],
    cashflows: [{ cfId: 'cb', at: edge - 5, amount: '5' }, { cfId: 'ca', at: dayStartMs('2026-10-28'), amount: '5' }],
    adjustments: [{ adjId: 'ab', at: edge - 5, amount: '1', reason: 'x' }],
    equityInputs: [{ day: '2026-10-20', equity: '1' }, { day: '2026-10-30', equity: '1' }, { day: D1, equity: '300' }] });
  const by = Object.fromEntries(r.flags.map(f => [f.type, f.count]));
  assert.deepEqual(by, { 'fills-before-start': 1, 'fills-after-through': 1, 'cashflows-before-start': 1, 'cashflows-after-through': 1, 'adjustments-before-start': 1, 'equity-outside-range': 2 });
  assert.equal(r.rows[0].cashflowMicro, 0n); assert.equal(r.rows[0].realizedGrossMicro, 0n);                   // 범위 밖은 계산에 반영되지 않음
  assert.deepEqual(ledgerBuildDaily({ challenge: ch(), throughDay: D1, equityInputs: [{ day: D1, equity: '300' }] }).flags, []);
});
test('성능: 365일·체결 3천 건 전체 재계산이 1초 이내(일별 미결제 상태는 한 번만 훑어 갱신)', () => {
  const fills = [], eq = []; let d = D1;
  for (let i = 0; i < 365; i++) { const base = dayStartMs(d); for (let k = 0; k < 3; k++) { const sid = `P${i}-${k}`; fills.push(fill({ fillId: `${sid}a`, sid, at: base + 3600000 * (1 + k), qty: '2' }), fill({ fillId: `${sid}b`, sid, kind: 'reduce', at: base + 3600000 * (2 + k), price: '101', qty: '1' }), fill({ fillId: `${sid}c`, sid, kind: 'close', at: base + 3600000 * (3 + k), price: '102', qty: '1' })); } eq.push({ day: d, equity: String(300 + i) }); d = new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10); }
  const t0 = performance.now(); const r = ledgerBuildDaily({ challenge: ch(), throughDay: d, fills, equityInputs: eq }); const ms = performance.now() - t0;
  assert.ok(ms < 1000, `${ms}ms`); assert.equal(r.rows.length, 366);
});
