// 선물 레이더 계산 엔진 테스트. 실행: node --test tests/*.test.*
// 아래 값은 계산 검증용 테스트 입력이며 서비스 코드에는 들어가지 않습니다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../assets/futures-engine.js');

const MIN = 60000;
const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

// 1분 간격 OI 시계열 (i=0 가장 오래됨)
function series(values, endT = NOW) {
  return values.map((oi, i) => ({ t: endT - (values.length - 1 - i) * MIN, oi, notional: null }));
}

test('공식 Binance 선물 주소만 사용', () => {
  assert.equal(F.FUT_RULES.base, 'https://fapi.binance.com');
});

test('Funding(premiumIndex) 파싱: 소수 → % 변환', () => {
  const p = F.parsePremiumIndex({ symbol: 'BTCUSDT', markPrice: '65000.5', indexPrice: '64990', lastFundingRate: '0.00012500', nextFundingTime: 1790640000000, time: 1790612345000 });
  assert.equal(p.symbol, 'BTCUSDT');
  assert.equal(p.markPrice, 65000.5);
  close(p.fundingPct, 0.0125);
  assert.equal(p.nextFundingTime, 1790640000000);
  assert.equal(F.parsePremiumIndex({ symbol: 'X', markPrice: 'bad' }), null);
  assert.equal(F.parsePremiumIndex(null), null);
  const noRate = F.parsePremiumIndex({ symbol: 'XUSDT', markPrice: '1', lastFundingRate: '' });
  assert.equal(noRate.fundingPct, null);
});

test('양수 / 음수 / 중립 펀딩', () => {
  assert.deepEqual(F.fundingState(0.0125), { label: '양수 펀딩', dir: 'up' });
  assert.deepEqual(F.fundingState(-0.018), { label: '음수 펀딩', dir: 'down' });
  assert.deepEqual(F.fundingState(0.001), { label: '중립', dir: 'flat' });
  assert.equal(F.fundingState(null).dir, null);
});

test('OI 파싱 (현재값, 5분 이력)', () => {
  assert.deepEqual(F.parseOpenInterest({ symbol: 'BTCUSDT', openInterest: '81234.5', time: NOW }), { symbol: 'BTCUSDT', oi: 81234.5, t: NOW });
  assert.equal(F.parseOpenInterest({ symbol: 'BTCUSDT', openInterest: 'x', time: NOW }), null);
  const h = F.parseOiHist([
    { symbol: 'BTCUSDT', sumOpenInterest: '100', sumOpenInterestValue: '6500000', timestamp: NOW - 5 * MIN },
    { symbol: 'BTCUSDT', sumOpenInterest: '90', sumOpenInterestValue: '5800000', timestamp: NOW - 10 * MIN },
    { symbol: 'BTCUSDT', sumOpenInterest: 'bad', timestamp: NOW },
  ]);
  assert.deepEqual(h, [{ t: NOW - 10 * MIN, oi: 90, notional: 5800000 }, { t: NOW - 5 * MIN, oi: 100, notional: 6500000 }]);
  assert.deepEqual(F.parseOiHist({ code: -1121 }), []);
});

test('선물 종목 매핑: 무기한 USDT 계약만, 기본 6종목 우선, 선물 없는 종목은 missing', () => {
  const avail = F.availableSymbols([
    { symbol: 'BTCUSDT', markPrice: '1' },
    { symbol: 'ETHUSDT', markPrice: '1' },
    { symbol: 'BTCUSDT_261226', markPrice: '1' }, // 분기물 제외
    { symbol: 'SOLUSDC', markPrice: '1' }, // USDC 마진 제외
    { symbol: 'PEPEUSDT', markPrice: '1' },
    { symbol: 'XRPUSDT', markPrice: '0' }, // 가격 없음 제외
  ]);
  assert.deepEqual([...avail].sort(), ['BTCUSDT', 'ETHUSDT', 'PEPEUSDT']);
  const r = F.pickFuturesSymbols(['PEPEUSDT', 'NEWSPOTUSDT', 'BTCUSDT'], avail, 3, ['BTCUSDT', 'ETHUSDT', 'XRPUSDT']);
  assert.deepEqual(r.symbols, ['BTCUSDT', 'ETHUSDT', 'PEPEUSDT']);
  assert.deepEqual(r.missing, ['XRPUSDT', 'NEWSPOTUSDT']);
  assert.deepEqual(F.pickFuturesSymbols(['A', 'B', 'C'].map((x) => x + 'USDT'), avail, 5, []).symbols, []);
});

test('OI 변화율: 5분 / 15분 / 1시간 (계약 수량 기준)', () => {
  const values = Array.from({ length: 61 }, (_, i) => 1000 + i * 10); // 60분 전 1000 → 지금 1600
  const s = series(values);
  close(F.oiChange(s, 5), ((1600 - 1550) / 1550) * 100);
  close(F.oiChange(s, 15), ((1600 - 1450) / 1450) * 100);
  close(F.oiChange(s, 60), 60);
});

test('OI 변화율: 비교할 과거 값이 없으면 null (추정 없음)', () => {
  assert.equal(F.oiChange([], 5), null);
  assert.equal(F.oiChange(series([100]), 5), null);
  assert.equal(F.oiChange(series([100, 101, 102]), 15), null);
  // 5분 간격 이력: ±2.5분 안에 있으면 사용
  const hist = [{ t: NOW - 15 * MIN - 60000, oi: 100, notional: null }, { t: NOW, oi: 110, notional: null }];
  close(F.oiChange(hist, 15), 10);
  const far = [{ t: NOW - 15 * MIN - 3 * MIN, oi: 100, notional: null }, { t: NOW, oi: 110, notional: null }];
  assert.equal(F.oiChange(far, 15), null);
});

test('OI 상태: 증가 / 급증 / 감소 / 급감 / 변화 작음', () => {
  assert.equal(F.classifyOi(1.2, 15).label, 'OI 증가');
  assert.equal(F.classifyOi(3.5, 15).label, 'OI 급증');
  assert.equal(F.classifyOi(-1.2, 15).label, 'OI 감소');
  assert.equal(F.classifyOi(-3.5, 15).label, 'OI 급감');
  assert.equal(F.classifyOi(0.3, 15).label, 'OI 변화 작음');
  assert.equal(F.classifyOi(0.6, 5).label, 'OI 증가');
  assert.equal(F.classifyOi(null, 15).label, 'OI 수집 중');
});

test('가격 + OI 조합: 4가지 방향과 보합', () => {
  assert.equal(F.priceOiCombo(1.8, 5.1), '가격↑ · OI↑');
  assert.equal(F.priceOiCombo(1.8, -2), '가격↑ · OI↓');
  assert.equal(F.priceOiCombo(-1.8, 2), '가격↓ · OI↑');
  assert.equal(F.priceOiCombo(-1.8, -2), '가격↓ · OI↓');
  assert.equal(F.priceOiCombo(0.05, 2), '가격→ · OI↑');
  assert.equal(F.priceOiCombo(null, 2), null);
});

test('선물시장 활동도 점수', () => {
  assert.deepEqual(F.activityScore({ oi15: 3, price15: 2, ratio15: 5, fundingPct: 0.05 }), { score: 100, parts: { oi: 40, price: 20, volume: 20, funding: 20 }, incomplete: false });
  assert.deepEqual(F.activityScore({ oi15: -1.5, price15: 1, ratio15: 3, fundingPct: -0.0125 }), { score: 45, parts: { oi: 20, price: 10, volume: 10, funding: 5 }, incomplete: false });
  assert.deepEqual(F.activityScore({ oi15: 0, price15: 0, ratio15: 0.5, fundingPct: 0 }).score, 0);
  const partial = F.activityScore({ oi15: 3, price15: null, ratio15: null, fundingPct: null });
  assert.equal(partial.score, 40);
  assert.equal(partial.incomplete, true);
  assert.equal(F.activityScore({ oi15: null, price15: 5, ratio15: 5, fundingPct: 1 }), null); // OI 없으면 계산 안 함
});

test('카드 데이터: OI 금액 = OI 수량 × Mark Price, 지연 판정', () => {
  const s = series(Array.from({ length: 16 }, (_, i) => 100 + i)); // 15분 전 100 → 115
  const premium = F.parsePremiumIndex({ symbol: 'BTCUSDT', markPrice: '65000', lastFundingRate: '0.0001', nextFundingTime: NOW + 3600000 });
  const c = F.evaluate('BTCUSDT', { series: s, premium, updatedAt: NOW - 5000, spot: { changePct: 1.8, ratio: 2 } }, NOW);
  assert.equal(c.notional, 115 * 65000);
  close(c.oi15, 15);
  assert.equal(c.combo, '가격↑ · OI↑');
  assert.equal(c.oiState.label, 'OI 급증');
  assert.equal(c.funding.label, '양수 펀딩');
  assert.equal(c.stale, false);
  assert.equal(c.score.score, 40 + 18 + 5 + 4);
  const old = F.evaluate('BTCUSDT', { series: s, premium, updatedAt: NOW - 4 * MIN, spot: null }, NOW);
  assert.equal(old.stale, true);
  assert.equal(old.combo, null); // 현물 데이터 없으면 조합 표시 안 함
  const none = F.evaluate('ABCUSDT', { series: undefined, premium: undefined, updatedAt: undefined, spot: null }, NOW);
  assert.equal(none.notional, null);
  assert.equal(none.score, null);
  assert.equal(none.stale, true);
});

test('stale data: 3분 초과 시 지연', () => {
  assert.equal(F.isStale(NOW - 2 * MIN, NOW), false);
  assert.equal(F.isStale(NOW - 3 * MIN - 1, NOW), true);
  assert.equal(F.isStale(0, NOW), true);
});

test('정렬: 활동도 높은 순, 지연·점수 없음은 뒤로, 점수 없으면 기본 순서', () => {
  const card = (symbol, score, stale = false) => ({ symbol, score: score === null ? null : { score }, stale });
  const order = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'PEPEUSDT'];
  const r = F.rankCards([card('BTCUSDT', 10), card('ETHUSDT', null), card('SOLUSDT', 90, true), card('PEPEUSDT', 70)], order);
  assert.deepEqual(r.map((c) => c.symbol), ['PEPEUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  const empty = F.rankCards([card('SOLUSDT', null), card('BTCUSDT', null), card('ETHUSDT', null)], order);
  assert.deepEqual(empty.map((c) => c.symbol), ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
});

test('재시도 간격 (backoff): 성공 1분, 실패 5초→10초→…최대 5분, Retry-After 존중', () => {
  const z = () => 0;
  assert.equal(F.nextDelay(0, null, undefined, z), 60000);
  assert.equal(F.nextDelay(1, null, undefined, z), 5000);
  assert.equal(F.nextDelay(2, null, undefined, z), 10000);
  assert.equal(F.nextDelay(4, null, undefined, z), 40000);
  assert.equal(F.nextDelay(20, null, undefined, z), 300000);
  assert.equal(F.nextDelay(1, '120', undefined, z), 120000); // 429 Retry-After 120초
  assert.equal(F.nextDelay(3, 'x', undefined, z), 20000);
});

test('선물 상태 표시 (API 오류·재연결·지연)', () => {
  assert.deepEqual(F.futuresStatusView({ state: 'connecting' }, NOW), { text: '선물 연결 중', level: 'warn' });
  assert.deepEqual(F.futuresStatusView({ state: 'live', lastOk: NOW - 1000 }, NOW), { text: '선물 정상', level: 'ok' });
  assert.deepEqual(F.futuresStatusView({ state: 'live', lastOk: NOW - 5 * MIN }, NOW), { text: '선물 데이터 지연', level: 'warn' });
  assert.deepEqual(F.futuresStatusView({ state: 'retrying', retryAt: NOW + 9500, lastOk: 0 }, NOW), { text: '선물 재연결 중 (10초 후)', level: 'err' });
  assert.equal(F.futuresStatusView({ state: 'retrying', retryAt: NOW + 5000, lastOk: NOW - 30000 }, NOW).level, 'warn');
  assert.equal(F.futuresStatusView({ state: 'paused' }, NOW).text, '선물 일시정지 (화면 숨김)');
});

test('저장/복원: 3시간 보관, 종목당 최대 240개, 레이더 1분봉과 다른 키', () => {
  assert.equal(F.STORAGE_KEY, 'coinradar.futures.v1');
  assert.notEqual(F.STORAGE_KEY, 'coinradar.candles.v1');
  const long = Array.from({ length: 300 }, (_, i) => ({ t: NOW - (299 - i) * MIN, oi: 100 + i, notional: 1 }));
  const obj = JSON.parse(JSON.stringify(F.serialize(new Map([['BTCUSDT', long]]), NOW)));
  assert.equal(obj.v, 1);
  assert.ok(obj.s.BTCUSDT.length <= 181);
  const back = F.deserialize(obj, NOW);
  assert.deepEqual(back.get('BTCUSDT').at(-1), { t: NOW, oi: 399, notional: 1 });
  let s = [];
  for (let i = 0; i < 500; i += 1) s = F.addPoint(s, { t: NOW - (499 - i) * 20000, oi: i }, NOW);
  assert.ok(s.length <= 240);
});

test('localStorage 손상 데이터: 오류 없이 무시', () => {
  for (const bad of [null, 'text', 42, { v: 2, s: {} }, { v: 1 }, { v: 1, s: null }, { v: 1, s: { 'bad key': [[1, 2, 3]], BTCUSDT: 'x', ETHUSDT: [[NOW, 'x', 1], [NOW, -5, 1], 'junk', [NOW + 3600000, 1, 1]] } }]) {
    const r = F.deserialize(bad, NOW);
    assert.equal(r.size, 0, JSON.stringify(bad));
  }
});

test('OI 이력 필요 여부 (1시간 변화 계산용)', () => {
  assert.equal(F.needsHistory([], NOW), true);
  assert.equal(F.needsHistory(series([1, 2, 3]), NOW), true);
  assert.equal(F.needsHistory([{ t: NOW - 60 * MIN, oi: 1 }, { t: NOW, oi: 2 }], NOW), false);
});

test('상태·조합 문구에 투자 추천 표현 없음', () => {
  const words = /매수|매도|롱|숏|진입|추천|buy|sell|long|short/i;
  const texts = [];
  for (const p of [-3, -1, 0, 1, 3]) for (const o of [-4, -1, 0, 1, 4]) texts.push(F.priceOiCombo(p, o), F.classifyOi(o, 15).label);
  for (const f of [-0.1, 0, 0.1]) texts.push(F.fundingState(f).label);
  for (const t of texts) assert.doesNotMatch(t, words, t);
});

test('요청 제한(429/418): Retry-After 헤더를 못 읽어도 최소 2분/5분 대기', () => {
  assert.equal(F.retryAfterFor(429, null), 120);
  assert.equal(F.retryAfterFor(418, null), 300);
  assert.equal(F.retryAfterFor(429, '600'), 600);
  assert.equal(F.retryAfterFor(500, null), null);
  assert.equal(F.retryAfterFor(undefined, undefined), null);
  assert.equal(F.nextDelay(1, F.retryAfterFor(429, null), undefined, () => 0), 120000);
});

test('기준값이 문서(docs/FUTURES-RADAR.md)와 일치', () => {
  const doc = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'docs', 'FUTURES-RADAR.md'), 'utf8');
  const R = F.FUT_RULES;
  assert.deepEqual(R.oiThresholds, { 5: { move: 0.5, surge: 1.5 }, 15: { move: 1.0, surge: 3.0 }, 60: { move: 2.0, surge: 5.0 } });
  assert.match(doc, /\| 15분 \| ±1\.0% 이상 \| ±3\.0% 이상 \|/);
  assert.equal(R.fundingNeutralPct, 0.005);
  assert.match(doc, /\|Funding\\| < 0\.005%/);
  assert.deepEqual(R.score.weights, { oi: 40, price: 20, volume: 20, funding: 20 });
  assert.match(doc, /OI 점수\(40\)\s+= min\(\|15분 OI 변화\| ÷ 3%, 1\) × 40/);
  assert.deepEqual(R.maxSymbols, { desktop: 15, mobile: 10 });
  assert.equal(R.staleMs, 180000);
});
