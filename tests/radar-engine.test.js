// 단기 레이더 계산 엔진 테스트. 실행: node --test tests/*.test.*
// 아래 1분봉은 계산 검증용 테스트 입력값입니다 (서비스 코드에는 들어가지 않음).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../assets/radar-engine.js');

const MIN = E.MIN;
const T0 = Date.UTC(2026, 8, 28, 12, 0, 0); // 1분 단위로 맞춘 기준 시각

// count 개의 완료된 1분봉을 만든다. f(i) 로 개별 값을 바꿀 수 있음 (i=0 이 가장 오래된 봉)
function series(count, f = () => ({}), endT = T0) {
  const s = new Map();
  for (let i = 0; i < count; i += 1) {
    const t = endT - (count - 1 - i) * MIN;
    s.set(t, { t, o: 100, h: 100, l: 100, c: 100, v: 10, q: 1000, closed: true, ...f(i, count) });
  }
  return s;
}
const nowAfter = (endT = T0) => endT + MIN + 5000; // 마지막 봉이 끝나고 5초 뒤
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('1분 가격 변화율: 마지막 완료 1분봉의 (종가-시가)/시가', () => {
  const s = series(20, (i, n) => (i === n - 1 ? { o: 100, c: 101 } : {}));
  const m = E.windowMetrics(s, 1, nowAfter());
  assert.equal(m.status, 'ok');
  close(m.changePct, 1);
  assert.equal(m.direction, 'up');
  assert.equal(m.windowStart, T0);
  assert.equal(m.windowEnd, T0 + MIN);
});

test('5분 가격 변화율: 5개 봉 중 첫 시가 → 마지막 종가', () => {
  const s = series(60, (i, n) => (i === n - 5 ? { o: 200, c: 201 } : i === n - 1 ? { o: 195, c: 190 } : { o: 200, c: 200 }));
  const m = E.windowMetrics(s, 5, nowAfter());
  close(m.changePct, -5);
  assert.equal(m.direction, 'down');
  assert.equal(m.windowStart, T0 - 4 * MIN);
});

test('15분 가격 변화율', () => {
  const s = series(200, (i, n) => (i === n - 15 ? { o: 50 } : i === n - 1 ? { c: 51 } : {}));
  const m = E.windowMetrics(s, 15, nowAfter());
  assert.equal(m.status, 'ok');
  close(m.changePct, 2);
});

test('거래량 baseline: 직전 같은 길이 12개 구간 평균', () => {
  // 5분 구간. 직전 60분 중 절반 구간은 거래대금 1000, 절반은 3000 → 평균 2000
  const s = series(70, (i, n) => {
    const k = Math.floor((n - 1 - i) / 5); // 0 = 현재 구간, 1..12 = 이전 구간
    if (k === 0) return { q: 2000 };
    return { q: k % 2 ? 1000 : 3000 };
  });
  const m = E.windowMetrics(s, 5, nowAfter());
  assert.equal(m.baselineCount, 12);
  close(m.baselineAvg, 5 * 2000); // 구간당 평균 (5분 합계)
  close(m.quoteVol, 5 * 2000);
  close(m.ratio, 1);
});

test('거래량 배수 = 현재 구간 거래대금 ÷ baseline 평균', () => {
  const s = series(70, (i, n) => (i >= n - 5 ? { q: 3800 } : { q: 1000 }));
  const m = E.windowMetrics(s, 5, nowAfter());
  close(m.ratio, 3.8);
  close(m.quoteVol, 19000);
  close(m.baseVol, 50);
});

test('baseline 이 0 이면 배수는 null (임의 값 없음)', () => {
  const s = series(20, (i, n) => (i === n - 1 ? { q: 500 } : { q: 0 }));
  const m = E.windowMetrics(s, 1, nowAfter());
  assert.equal(m.ratio, null);
  assert.equal(E.radarScore(m).volumePart, 0);
});

test('데이터 부족: 수집 중 + 남은 시간', () => {
  assert.deepEqual(E.windowMetrics(undefined, 5, nowAfter()), { status: 'collecting', window: 5, remainingMin: 35 });
  const m = E.windowMetrics(series(32), 5, nowAfter());
  assert.equal(m.status, 'collecting');
  assert.equal(m.remainingMin, 3);
  assert.equal(E.pendingText(m), '5분 데이터 수집 중 (약 3분 남음)');
  assert.equal(E.windowMetrics(series(104), 15, nowAfter()).status, 'collecting');
  assert.equal(E.windowMetrics(series(105), 15, nowAfter()).status, 'ok');
  assert.equal(E.windowMetrics(series(7), 1, nowAfter()).status, 'ok');
});

test('중간에 1분봉이 빠지면 끊긴 이후만 사용 (빈 곳을 채우지 않음)', () => {
  const s = series(60);
  s.delete(T0 - 10 * MIN);
  const m = E.windowMetrics(s, 5, nowAfter());
  assert.equal(m.status, 'collecting');
  assert.equal(m.remainingMin, 35 - 10);
  assert.equal(E.windowMetrics(s, 1, nowAfter()).status, 'ok');
});

test('진행 중인(미완료) 1분봉은 계산에 쓰지 않음', () => {
  const s = series(20);
  s.set(T0 + MIN, { t: T0 + MIN, o: 100, h: 200, l: 100, c: 200, v: 999, q: 999999, closed: false });
  const m = E.windowMetrics(s, 1, T0 + MIN + 30000);
  assert.equal(m.windowStart, T0);
  close(m.changePct, 0);
});

test('마지막 완료 1분봉이 2분 넘게 없으면 데이터 지연', () => {
  const m = E.windowMetrics(series(60), 5, T0 + MIN + 2 * MIN + 1000);
  assert.equal(m.status, 'stale');
  assert.match(E.pendingText(m), /데이터 지연/);
});

const metric = (window, changePct, ratio) => ({ status: 'ok', window, changePct, ratio, quoteVol: 1, baselineAvg: 1, baselineCount: 12 });

test('상태 판정', () => {
  assert.deepEqual(E.classify(metric(5, 0.3, 1.1)).labels, ['관찰']);
  assert.deepEqual(E.classify(metric(5, 0.3, 2.0)).labels, ['활동 증가']);
  assert.deepEqual(E.classify(metric(5, -1.3, 1.0)).labels, ['가격 급변']);
  assert.deepEqual(E.classify(metric(5, 0.1, 3.0)).labels, ['거래량 이상']);
  assert.deepEqual(E.classify(metric(5, 2.1, 3.8)).labels, ['가격 급변', '거래량 이상']);
  assert.deepEqual(E.classify(metric(5, 2.4, 5.0)).labels, ['과열', '가격 급변', '거래량 이상']);
  assert.equal(E.classify(metric(5, 2.4, 5.0)).level, 'overheat');
  assert.equal(E.classify(metric(1, 0.5, 1)).primary, '가격 급변'); // 1분 기준 0.5%
  assert.equal(E.classify(metric(15, 1.9, 1)).primary, '관찰'); // 15분 기준 2.0%
  assert.deepEqual(E.classify({ status: 'collecting' }).labels, []);
});

test('상태·근거 문구에 투자 추천 표현 없음', () => {
  const words = /매수|매도|롱|숏|buy|sell|long|short/i;
  for (const [c, r] of [[0.1, 1], [3, 6], [-3, 6], [0.1, 2], [2, 1]]) {
    const m = { ...metric(5, c, r), quoteVol: 5e6, baselineAvg: 1e6 };
    const cl = E.classify(m);
    assert.ok(!words.test(cl.labels.join()) && !words.test(E.evidence(m, cl)));
  }
});

test('radar score: 가격 점수 + 거래 점수', () => {
  assert.deepEqual(E.radarScore(metric(5, 2.1, 3.8)), { score: 79, pricePart: 44, volumePart: 35 }); // docs/RADAR.md 예시
  assert.deepEqual(E.radarScore(metric(5, 0, 1)), { score: 0, pricePart: 0, volumePart: 0 });
  assert.deepEqual(E.radarScore(metric(5, -10, 20)), { score: 100, pricePart: 50, volumePart: 50 });
  assert.equal(E.radarScore(metric(5, 1.2, 0.5)).volumePart, 0); // 평소보다 적어도 음수 없음
  assert.equal(E.radarScore({ status: 'collecting' }), null);
});

test('시간 구간 변경: 같은 데이터라도 구간별 결과·순위가 다름', () => {
  const store = new Map();
  // A: 마지막 1분만 급등 / B: 최근 15분 동안 꾸준히 거래 증가 + 상승
  store.set('AUSDT', series(200, (i, n) => (i === n - 1 ? { o: 100, c: 101, q: 5000 } : {})));
  store.set('BUSDT', series(200, (i, n) => (i >= n - 15 ? { o: 100 + (i - (n - 15)) * 0.2, c: 100 + (i - (n - 16)) * 0.2, q: 4000 } : {})));
  const now = nowAfter();
  const r1 = E.analyze(store, ['AUSDT', 'BUSDT'], 1, now);
  const r15 = E.analyze(store, ['AUSDT', 'BUSDT'], 15, now);
  assert.equal(r1.ranked[0].symbol, 'AUSDT');
  assert.equal(r15.ranked[0].symbol, 'BUSDT');
  assert.equal(r1.window, 1);
  assert.equal(r15.ranked[0].metrics.window, 15);
  close(r1.ranked[0].metrics.ratio, 5);
});

test('analyze: 데이터 부족 종목은 순위에서 빠지고 pending 으로', () => {
  const store = new Map([['AUSDT', series(60)], ['BUSDT', series(10)]]);
  const r = E.analyze(store, ['AUSDT', 'BUSDT', 'CUSDT'], 5, nowAfter());
  assert.deepEqual(r.ranked.map((x) => x.symbol), ['AUSDT']);
  assert.deepEqual(r.pending.map((x) => x.symbol), ['BUSDT', 'CUSDT']);
});

test('근거 문구 예시', () => {
  const m = { status: 'ok', window: 5, changePct: 2.1, ratio: 3.8, quoteVol: 3.2e6, baselineAvg: 842105, baselineCount: 12 };
  assert.equal(E.evidence(m, E.classify(m)), '5분 +2.10% (급변 기준 ±1.2%) · 거래대금 3.8배 (현재 $3.20M / 평소 $842.1K, 직전 12구간 평균) → 가격 급변 + 거래량 이상');
});

test('Binance 1분봉 변환 (WebSocket / REST)', () => {
  const k = { t: T0, T: T0 + MIN - 1, s: 'SOLUSDT', i: '1m', o: '150.1', c: '151', h: '152', l: '150', v: '1000', q: '150500', x: true };
  assert.deepEqual(E.klineFromWs(k), { t: T0, o: 150.1, h: 152, l: 150, c: 151, v: 1000, q: 150500, closed: true });
  assert.equal(E.klineFromWs({ ...k, i: '5m' }), null);
  assert.equal(E.klineFromWs({ ...k, o: 'x' }), null);
  const rest = [T0, '1', '2', '0.5', '1.5', '10', T0 + MIN - 1, '15', 5, '1', '1', '0'];
  assert.equal(E.klineFromRest(rest, T0 + MIN + 1).closed, true);
  assert.equal(E.klineFromRest(rest, T0 + 30000).closed, false); // 진행 중
  assert.equal(E.klineFromRest(rest, T0 + MIN + 1).q, 15);
});

test('upsert: 완료된 봉은 진행 중 값으로 덮어쓰지 않음, 완료 시 true 반환', () => {
  const store = new Map();
  const c = { t: T0, o: 1, h: 1, l: 1, c: 1, v: 1, q: 1 };
  assert.equal(E.upsertCandle(store, 'X', { ...c, closed: false }), false);
  assert.equal(E.upsertCandle(store, 'X', { ...c, q: 2, closed: true }), true);
  assert.equal(E.upsertCandle(store, 'X', { ...c, q: 3, closed: false }), false);
  assert.equal(store.get('X').get(T0).q, 2);
});

test('저장/복원: 완료된 봉만, 4시간 이내만, 손상 데이터 무시', () => {
  const store = new Map([['SOLUSDT', series(300)]]);
  store.get('SOLUSDT').set(T0 + MIN, { t: T0 + MIN, o: 1, h: 1, l: 1, c: 1, v: 1, q: 1, closed: false });
  const now = nowAfter();
  const json = JSON.parse(JSON.stringify(E.serializeStore(store, now)));
  assert.equal(json.v, 1);
  assert.equal(json.s.SOLUSDT.length, 240); // 4시간치
  assert.deepEqual(json.s.SOLUSDT.at(-1), [T0, 100, 100, 100, 100, 10, 1000]);
  const back = E.deserializeStore(json, now);
  assert.equal(back.get('SOLUSDT').size, 240);
  assert.equal(E.windowMetrics(back.get('SOLUSDT'), 15, now).status, 'ok');
  // 오래 지난 뒤 복원하면 보관 기간 밖은 버림
  assert.equal(E.deserializeStore(json, now + 239 * MIN).get('SOLUSDT').size, 1);
  // 손상 데이터
  assert.equal(E.deserializeStore(null, now).size, 0);
  assert.equal(E.deserializeStore({ v: 2, s: {} }, now).size, 0);
  const bad = { v: 1, s: { A: [[T0, 'x', 1, 1, 1, 1, 1], [T0 + 1, 1, 1, 1, 1, 1, 1], 'junk'], B: 'junk' } };
  assert.equal(E.deserializeStore(bad, now).size, 0);
});

test('pruneStore: 오래된 봉 삭제', () => {
  const store = new Map([['A', series(300)]]);
  E.pruneStore(store, nowAfter());
  assert.equal(store.get('A').size, 240);
});

test('과거 1분봉 보충 계획', () => {
  const now = nowAfter();
  assert.deepEqual(E.backfillPlan(undefined, now), { limit: E.HISTORY_NEEDED + 5 });
  assert.equal(E.backfillPlan(series(200), now), null); // 이미 충분
  // 최근 3분만 빠진 경우 → 빠진 부분만
  assert.deepEqual(E.backfillPlan(series(200, undefined, T0 - 3 * MIN), now), { startTime: T0 - 2 * MIN, limit: 4 });
  // 이력이 짧으면 전체 다시
  assert.deepEqual(E.backfillPlan(series(20, undefined, T0 - 3 * MIN), now), { limit: E.HISTORY_NEEDED + 5 });
});

test('감시 종목 선택: 거래대금 상위 + 기본 종목, 스테이블/레버리지 제외', () => {
  const rows = [
    { symbol: 'USDCUSDT', quoteVol: 9e9 },
    { symbol: 'BTCUPUSDT', quoteVol: 8e9 },
    { symbol: 'PEPEUSDT', quoteVol: 5e9 },
    { symbol: 'JUPUSDT', quoteVol: 4e9 },
    { symbol: 'ETHBTC', quoteVol: 3e9 },
    { symbol: 'WIFUSDT', quoteVol: 1e9 },
  ];
  assert.deepEqual(E.pickUniverse(rows, 3, ['BTCUSDT']), ['BTCUSDT', 'PEPEUSDT', 'JUPUSDT']);
  assert.deepEqual(E.pickUniverse(rows, 10, []), ['PEPEUSDT', 'JUPUSDT', 'WIFUSDT']);
});

test('규칙 값이 문서(docs/RADAR.md)와 일치', () => {
  const doc = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'docs', 'RADAR.md'), 'utf8');
  assert.deepEqual(E.RULES.priceMovePct, { 1: 0.5, 5: 1.2, 15: 2.0 });
  assert.match(doc, /1분 ±0\.5% · 5분 ±1\.2% · 15분 ±2\.0%/);
  assert.equal(E.RULES.baselineWindows, 12);
  assert.equal(E.RULES.minBaselineWindows, 6);
  assert.equal(E.RULES.volumeAnomalyRatio, 3);
  assert.equal(E.RULES.activityRatio, 1.8);
});
