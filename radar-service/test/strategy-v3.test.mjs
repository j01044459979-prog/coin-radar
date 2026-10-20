import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStrategySeries, latestStrategySignal, validateClosedCandles } from '../strategies-v3.mjs';
import { backtestStrategy, conservativeBarExit } from '../strategy-backtest-v3.mjs';

function upwardBars(count = 300, { jumpEvery = 40, jumpSize = 3, strongVolume = true } = {}) {
  return Array.from({ length: count }, (_, i) => {
    const p = 100 + i * 0.12 + Math.floor(i / jumpEvery) * jumpSize;
    return { t: i * 300000, o: p - 0.1, h: p + 0.4, l: p - 0.4, c: p,
      q: strongVolume && i % jumpEvery === 0 ? 7000 : 1000, confirm: '1' };
  });
}

test('거래량을 수반한 확정 돌파 신호를 다음 봉 관찰 후보로 생성', () => {
  const c = upwardBars(121);
  const s = buildStrategySeries(c);
  assert.equal(s[80].signal, 'LONG');
  assert.equal(s[80].setup, 'TREND_BREAKOUT');
  assert.equal(s[80].regime, 'TREND');
  assert.equal(s[80].indicators.trendEvidence, 'LONG');
  assert.equal(s[80].indicators.breakoutEvidence, 'LONG');
  assert.equal(s[80].risk.rewardRisk, 2);
});

test('거래량 미충족 시 돌파로 추천하지 않음', () => {
  const c = upwardBars(121, { strongVolume: false });
  assert.equal(buildStrategySeries(c)[80].signal, 'WAIT');
});

test('미래 캔들을 붙여도 이전 확정봉의 판단은 불변', () => {
  const early = upwardBars(121);
  const signalBefore = latestStrategySignal(early);
  const future = upwardBars(140).slice(121).map(x => ({
    ...x, o: x.o + 200, h: x.h + 200, l: x.l + 200, c: x.c + 200,
  }));
  const after = buildStrategySeries([...early, ...future])[120];
  assert.deepEqual(after, signalBefore);
});

test('미확정 봉 및 비정상 OHLC는 분석을 차단', () => {
  const c = upwardBars(120);
  const badConfirm = c.map(x => ({ ...x }));
  badConfirm[119].confirm = '0';
  assert.throws(() => validateClosedCandles(badConfirm), /Unconfirmed/);
  const badOHLC = c.map(x => ({ ...x }));
  badOHLC[119].l = badOHLC[119].h + 1;
  assert.throws(() => buildStrategySeries(badOHLC), /Invalid/);
});

test('ATR 방향 지표 두 개가 일치해도 독립 투표 2표로 간주하지 않음', () => {
  const c = upwardBars(121, { strongVolume: false });
  const s = latestStrategySignal(c);
  assert.equal(s.indicators.supertrend, 'UP');
  assert.equal(s.indicators.atrTrail, 'UP');
  assert.equal(s.indicators.trendEvidence, 'LONG');
  assert.equal(s.signal, 'WAIT');
});

test('한 캔들에서 손절·익절 모두 닿으면 손절 우선 처리', () => {
  assert.deepEqual(conservativeBarExit({
    direction: 'LONG', stop: 95, target: 110,
  }, { l: 94, h: 111 }), { type: 'STOP', price: 95 });
  assert.deepEqual(conservativeBarExit({
    direction: 'SHORT', stop: 105, target: 90,
  }, { l: 89, h: 106 }), { type: 'STOP', price: 105 });
});

test('백테스트는 다음 봉 시가에서만 체결, 수수료·슬리피지 반영', () => {
  const b = backtestStrategy(upwardBars(320));
  assert.ok(b.trades.length > 0);
  for (const t of b.trades) {
    assert.equal(t.entryIndex, t.signalIndex + 1);
    assert.ok(t.exitIndex >= t.entryIndex);
    assert.ok(t.netPercent < t.grossPercentAfterSlippage);
    assert.equal(t.feePercentRoundTrip, 0.12);
  }
  assert.equal(b.spec.fundingIncluded, false);
  assert.equal(b.spec.liquidationIncluded, false);
  assert.ok(b.spec.splitIndex > 200);
});

test('보유 구간을 분리한 OOS 성과에 경계 횡단 거래가 섞이지 않음', () => {
  const b = backtestStrategy(upwardBars(320));
  const split = b.spec.splitIndex;
  const training = b.trades.filter(x => x.entryIndex < split && x.exitIndex < split);
  const validation = b.trades.filter(x => x.entryIndex >= split);
  assert.equal(b.inSample.trades, training.length);
  assert.equal(b.outOfSample.trades, validation.length);
  assert.equal(b.boundaryTradesExcluded, b.all.trades - training.length - validation.length);
});

test('데이터 부족과 잘못된 테스트 입력은 명시적으로 거부', () => {
  assert.throws(() => backtestStrategy(upwardBars(80)), /At least 200/);
  assert.throws(() => backtestStrategy(upwardBars(220), { trainFraction: 1 }), /configuration/);
});

test('5분봉 누락·시각 비정렬·확정 정보 누락은 거래 신호를 차단', () => {
  const c = upwardBars(121);
  const gap = c.filter((_, i) => i !== 80);
  assert.throws(() => buildStrategySeries(gap), /Missing\/duplicate/);
  const unconfirmed = c.map(x => ({ ...x }));
  delete unconfirmed[60].confirm;
  assert.throws(() => buildStrategySeries(unconfirmed), /Unconfirmed/);
});

test('시가가 손절을 뛰어넘으면 유리한 손절가가 아닌 불리한 시가로 처리', () => {
  assert.deepEqual(conservativeBarExit(
    { direction: 'LONG', stop: 95, target: 110 },
    { o: 92, h: 103, l: 90, c: 100 }
  ), { type: 'STOP_GAP', price: 92 });
  assert.deepEqual(conservativeBarExit(
    { direction: 'SHORT', stop: 105, target: 90 },
    { o: 108, h: 110, l: 99, c: 102 }
  ), { type: 'STOP_GAP', price: 108 });
});
