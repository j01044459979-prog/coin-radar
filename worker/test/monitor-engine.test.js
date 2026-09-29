// Upbit 감시 계산 엔진 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as M from '../src/monitor-engine.js';
import { STABLE_BASES } from '../src/config.js';
import { MIN, makeUpbitMinute, makeUpbitFifteen } from './helpers.js';

const require = createRequire(import.meta.url);
const NOW = Date.UTC(2026, 8, 28, 5, 37, 20); // 05:37:20 UTC → 진행 중인 분 05:37
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('Upbit 캔들 파싱', () => {
  const c = M.parseUpbitCandle({ candle_date_time_utc: '2026-09-28T05:36:00', opening_price: 100, high_price: 101, low_price: 99, trade_price: 100.5, candle_acc_trade_price: 123456789, candle_acc_trade_volume: 12.3 });
  assert.deepEqual(c, { t: Date.UTC(2026, 8, 28, 5, 36), o: 100, h: 101, l: 99, c: 100.5, q: 123456789, v: 12.3 });
  assert.equal(M.parseUpbitCandle({ candle_date_time_utc: 'x' }), null);
  assert.equal(M.parseUpbitCandle({ candle_date_time_utc: '2026-09-28T05:36:00', opening_price: 'a', high_price: 1, low_price: 1, trade_price: 1, candle_acc_trade_price: 1, candle_acc_trade_volume: 1 }), null);
  assert.equal(M.parseUpbitCandle(null), null);
});

test('1분봉 연속화: 진행 중 캔들 제외, 체결 없는 분 = 거래 0 · 직전 종가', () => {
  const raw = makeUpbitMinute('KRW-A', 20, NOW, { skip: [2, 3] }); // 마지막 완료 분에서 2,3분 전 캔들 없음
  const s = M.buildMinuteSeries(raw, NOW);
  const last = Date.UTC(2026, 8, 28, 5, 36);
  assert.equal(s.last, last);
  assert.equal(s.candles.at(-1).t, last);
  const gap = s.candles.find((c) => c.t === last - 2 * MIN);
  assert.equal(gap.q, 0);
  assert.equal(gap.empty, true);
  assert.equal(gap.o, gap.c);
  // 1분 간격으로 빈틈 없음
  for (let i = 1; i < s.candles.length; i += 1) assert.equal(s.candles[i].t - s.candles[i - 1].t, MIN);
  // 최근 몇 분 동안 체결이 없으면 마지막 완료 분까지 거래 0 으로 채움
  const s2 = M.buildMinuteSeries(makeUpbitMinute('KRW-A', 20, NOW, { skip: [0, 1] }), NOW);
  assert.equal(s2.last, last);
  assert.equal(s2.candles.at(-1).q, 0);
  assert.equal(M.buildMinuteSeries([], NOW), null);
});

function metricsFor(spec, W, count = 70) {
  const s = M.buildMinuteSeries(makeUpbitMinute('KRW-A', count, NOW, spec), NOW);
  const b = M.buildBucketMap(makeUpbitFifteen('KRW-A', 15, NOW), NOW);
  return M.windowMetrics(s, W, b);
}

test('1분 / 5분 / 15분 가격 변화율과 거래 활동 배수', () => {
  const spec = { spike: { minutes: 5, q: 4e8, pricePct: 3 } };
  const m5 = metricsFor(spec, 5);
  assert.equal(m5.status, 'ok');
  close(m5.changePct, 3);
  close(m5.ratio, 4); // 20억 ÷ 평소 5억
  close(m5.quoteVol, 20e8);
  assert.equal(m5.baselineCount, 12);
  assert.equal(m5.direction, 'up');
  assert.equal(m5.windowEnd, Date.UTC(2026, 8, 28, 5, 37));

  const m1 = metricsFor(spec, 1);
  close(m1.ratio, 2); // 4억 ÷ (4억×4 + 1억×8)/12
  close(m1.changePct, (6 / 1024) * 100);

  const m15 = metricsFor(spec, 15);
  close(m15.changePct, 3);
  close(m15.quoteVol, 30e8);
  close(m15.baselineAvg, 15e8); // Upbit 15분봉 12개 평균
  close(m15.ratio, 2);
  assert.equal(m15.baselineCount, 12);
});

test('15분 평소 거래대금: 받은 범위 안의 없는 15분봉은 0, 범위 밖은 사용 안 함', () => {
  const s = M.buildMinuteSeries(makeUpbitMinute('KRW-A', 70, NOW), NOW);
  const all = makeUpbitFifteen('KRW-A', 15, NOW);
  const holes = all.filter((_, i) => i !== 3); // 하나 빠짐 (체결 없음)
  const m = M.windowMetrics(s, 15, M.buildBucketMap(holes, NOW));
  close(m.baselineAvg, (15e8 * 11) / 12);
  // 15분봉이 5개뿐이면 데이터 부족
  const few = M.windowMetrics(s, 15, M.buildBucketMap(all.slice(0, 5), NOW));
  assert.equal(few.status, 'collecting');
});

test('데이터 부족이면 수집 중 (추정값 없음)', () => {
  const m = metricsFor({}, 5, 20);
  assert.equal(m.status, 'collecting');
  assert.equal(m.remainingMin, 35 - 19);
  assert.equal(M.windowMetrics(null, 1, null).status, 'collecting');
  assert.equal(M.windowMetrics(M.buildMinuteSeries(makeUpbitMinute('KRW-A', 70, NOW), NOW), 15, null).status, 'collecting');
});

test('평소 거래대금이 0 이면 배수 null', () => {
  const m = metricsFor({ baseQ: 0, spike: { minutes: 1, q: 5e8, pricePct: 1 } }, 1);
  assert.equal(m.ratio, null);
  assert.equal(M.radarScore(m).volumePart, 0);
});

test('상태 판정 / 레이더 점수가 브라우저 Binance 레이더와 같은 공식', () => {
  const E = require('../../assets/radar-engine.js');
  const cases = [[5, 0.3, 1.1], [5, 2.1, 3.8], [5, 2.4, 5], [1, -0.6, 2], [15, -3.08, 3.6], [15, 1.9, 1], [5, 0, null]];
  for (const [window, changePct, ratio] of cases) {
    const m = { status: 'ok', window, changePct, ratio, quoteVol: 1, baselineAvg: 1, baselineCount: 12 };
    assert.deepEqual(M.radarScore(m), E.radarScore(m));
    const a = M.classify(m);
    const b = E.classify(m);
    assert.deepEqual([a.labels, a.level], [b.labels, b.level]);
  }
  // 사용자 확인 예시: 15분 -3.08%, 화면 표시 3.6배(반올림, 실제 3.55배) → 70점, 가격 급변 + 거래량 이상
  const near = { status: 'ok', window: 15, changePct: -3.08, ratio: 3.55 };
  assert.equal(M.radarScore(near).score, 70);
  assert.deepEqual(M.classify(near).labels, ['가격 급변', '거래량 이상']);
});

test('종목 분석 + 종목별 최고 구간', () => {
  const now = NOW;
  const rowsA = M.analyzeMarket('KRW-A', makeUpbitMinute('KRW-A', 70, now, { spike: { minutes: 5, q: 4e8, pricePct: 3 } }), makeUpbitFifteen('KRW-A', 15, now), now);
  const rowsB = M.analyzeMarket('KRW-B', makeUpbitMinute('KRW-B', 70, now), makeUpbitFifteen('KRW-B', 15, now), now);
  assert.deepEqual(rowsA.map((r) => r.window), [1, 5, 15]);
  const best = M.bestPerMarket([...rowsA, ...rowsB]);
  assert.equal(best[0].market, 'KRW-A');
  assert.equal(best[0].window, 5);
  assert.equal(best[0].score.score, 88);
  assert.deepEqual(best[0].cls.labels, ['가격 급변', '거래량 이상']);
  assert.equal(best[1].score.score, 0);
});

test('감시 종목: 24H 거래대금 상위 KRW 마켓, 스테이블코인 제외', () => {
  const t = [
    { market: 'KRW-USDT', acc_trade_price_24h: 9e12 },
    { market: 'KRW-BTC', acc_trade_price_24h: 5e11 },
    { market: 'BTC-ETH', acc_trade_price_24h: 9e12 },
    { market: 'KRW-XRP', acc_trade_price_24h: 7e11 },
    { market: 'KRW-DOGE', acc_trade_price_24h: 1e11 },
  ];
  assert.deepEqual(M.pickMarkets(t, 2, STABLE_BASES), ['KRW-XRP', 'KRW-BTC']);
});
