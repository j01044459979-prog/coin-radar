// Phase 6A: 심볼 매칭 · 카테고리 · 중요도 · 검증 상태 · 클러스터링 · 시장 반응 계산 (순수 함수)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSymbols, buildDictionary } from '../src/intel/symbols.js';
import { detectCategory, baseImportance, clusterImportance, multiSourceBonus, verificationOf, reactionBonus } from '../src/intel/classify.js';
import { findCluster, matches, titleTokens } from '../src/intel/cluster.js';
import { reactionFromCandles } from '../src/intel/market.js';
import { MIN } from '../src/config.js';

const dict = buildDictionary([
  { market: 'KRW-SOL', korean_name: '솔라나', english_name: 'Solana' },
  { market: 'KRW-ONE', korean_name: '하모니', english_name: 'Harmony' },
  { market: 'KRW-AI', korean_name: '에이아이', english_name: 'Sleepless AI' },
  { market: 'KRW-WAXP', korean_name: '왁스', english_name: 'WAX' },
  { market: 'KRW-MOCA', korean_name: '모카버스', english_name: 'Moca Coin' },
]);

test('심볼: 이름/티커/한글 이름 매칭', () => {
  assert.deepEqual(detectSymbols('Bitcoin and Ethereum rally as SOL jumps', dict), ['BTC', 'ETH', 'SOL']);
  assert.deepEqual(detectSymbols('솔라나 ETF 신청 소식', dict), ['SOL']);
  assert.deepEqual(detectSymbols('Binance Will List Solana (SOL) with Seed Tag Applied', dict), ['SOL']);
  assert.deepEqual(detectSymbols('[거래] 리플(XRP) KRW 마켓 디지털 자산 추가', dict), ['XRP']);
  assert.deepEqual(detectSymbols('Dogecoin DOGE surges', dict), ['DOGE']);
  assert.deepEqual(detectSymbols('ETHUSDT and BTCUSDT volumes', dict).sort(), ['BTC', 'ETH']);
});

test('심볼 오탐 방지: ONE / AI / IN / US 같은 일반 단어', () => {
  assert.deepEqual(detectSymbols('Number ONE reason to buy', dict), []);
  assert.deepEqual(detectSymbols('AI stocks rally as US regulators look IN to it', dict), []);
  assert.deepEqual(detectSymbols('one of the biggest days in the US', dict), []);
  assert.deepEqual(detectSymbols('SEC approves ETF, CEO says', dict), []); // 금융 약어는 코인이 아님
  assert.deepEqual(detectSymbols('Binance will list Harmony (ONE)', dict), ['ONE']);
  assert.deepEqual(detectSymbols('ONE/USDT pair added', dict), ['ONE']);
  assert.deepEqual(detectSymbols('$ONE token pumps', dict), ['ONE']);
  assert.deepEqual(detectSymbols('Sleepless AI (AI) listed', dict), ['AI']);
  assert.deepEqual(detectSymbols('Harmony token news', dict), ['ONE']);
});

test('심볼: Bitcoin Cash 는 BTC 오탐이 아님, 부분 문자열 오탐 없음', () => {
  assert.deepEqual(detectSymbols('Bitcoin Cash hard fork', dict), ['BCH']);
  assert.deepEqual(detectSymbols('SOLID plan for POLITICS', dict), []);
  assert.deepEqual(detectSymbols('Solanaville is a town', dict), []);
  assert.deepEqual(detectSymbols('', dict), []);
  assert.deepEqual(detectSymbols(null, dict), []);
});

test('카테고리 감지 (공식 공지)', () => {
  const o = (t, hint) => detectCategory(t, 'official', hint);
  assert.equal(o('Binance Will List Solana (SOL) with Seed Tag Applied'), 'listing');
  assert.equal(o('Binance Will Delist ABC, XYZ on 2026-10-01'), 'delisting');
  assert.equal(o('Notice of Removal of Spot Trading Pairs - 2026-10-01'), 'delisting');
  assert.equal(o('[거래] ABC 거래지원 종료 안내'), 'delisting');
  assert.equal(o('[거래] 솔라나(SOL) KRW 마켓 디지털 자산 추가'), 'listing');
  assert.equal(o('[거래] ABC 투자 유의 종목 지정'), 'warning');
  assert.equal(o('Binance Will Launch USDⓈ-M SOL Perpetual Contract'), 'trading');
  assert.equal(o('Binance Completes Network Upgrade for ABC'), 'network');
  assert.equal(o('[입출금] ABC 입출금 일시 중단'), 'deposit');
  assert.equal(o('Binance HODLer Airdrops: New Token'), 'airdrop');
  assert.equal(o('Scheduled System Maintenance'), 'maintenance');
  assert.equal(o('Trading Competition: win rewards'), 'promotion');
  assert.equal(o('Something else entirely'), 'general');
  assert.equal(o('[이벤트] 무언가', '이벤트'), 'promotion'); // 힌트는 키워드가 없을 때만
});

test('카테고리: 뉴스에서 "SEC approves ETF listing" 은 상장이 아니라 규제', () => {
  assert.equal(detectCategory('SEC approves spot ETF listing', 'news'), 'regulation');
  assert.equal(detectCategory('Exchange hacked, $50M stolen', 'news'), 'security');
  assert.equal(detectCategory('Coinbase to list new token', 'news'), 'listing');
});

test('중요도: 결정적이며 0~100, 출처·카테고리·코인 규모 반영, 방향 정보 없음', () => {
  const a = baseImportance({ sourceType: 'official', category: 'listing', symbols: ['BTC'] });
  const b = baseImportance({ sourceType: 'official', category: 'listing', symbols: ['SOL'] });
  const c = baseImportance({ sourceType: 'news', category: 'listing', symbols: ['SOL'] });
  const d = baseImportance({ sourceType: 'news', category: 'general', symbols: [] });
  assert.equal(a, 72);
  assert.equal(b, 68);
  assert.equal(c, 53);
  assert.equal(d, 20);
  assert.ok(a > b && b > c && c > d);
  assert.equal(baseImportance({ sourceType: 'official', category: 'listing', symbols: ['BTC'] }), a); // 반복해도 같음
  assert.equal(multiSourceBonus(1), 0);
  assert.equal(multiSourceBonus(3), 12);
  assert.equal(multiSourceBonus(99), 18);
  assert.equal(clusterImportance(95, 4, 10), 100); // 상한
  assert.equal(clusterImportance(20, 1, 0), 20);
  assert.equal(reactionBonus([null, undefined]), 0);
  assert.equal(reactionBonus([0.3, -0.5]), 0);
  assert.equal(reactionBonus([-1.6, 0.2]), 6);
  assert.equal(reactionBonus([3.2]), 10);
});

test('검증 상태: 공식 확인 / 복수 출처 / 뉴스 보도 / 미확인', () => {
  const it = (source, sourceType) => ({ source, sourceType });
  assert.equal(verificationOf([it('binance', 'official')]), 'official');
  assert.equal(verificationOf([it('coindesk', 'news'), it('binance', 'official')]), 'official');
  assert.equal(verificationOf([it('coindesk', 'news'), it('cointelegraph', 'news')]), 'multi');
  assert.equal(verificationOf([it('coindesk', 'news'), it('coindesk', 'news')]), 'news'); // 같은 출처 2건은 독립 출처가 아님
  assert.equal(verificationOf([it('coindesk', 'news')]), 'news');
  assert.equal(verificationOf([it('tg', 'social')]), 'unverified');
  assert.equal(verificationOf([]), 'unverified');
});

const T0 = Date.UTC(2026, 8, 29, 3, 0, 0);
const cl = (title, symbols, category, lastTime = T0) => ({ title, symbols, category, lastTime });

test('클러스터: 같은/유사 제목은 묶고, 다른 코인·먼 시간은 묶지 않음', () => {
  const c = cl('SEC approves spot Solana ETF', ['SOL'], 'regulation');
  assert.ok(matches({ title: 'SEC approves spot Solana ETF', eventTime: T0 + 5 * MIN, symbols: ['SOL'], category: 'regulation' }, c)); // 동일 제목
  assert.ok(matches({ title: 'SEC approval of spot Solana ETF announced', eventTime: T0 + 9 * MIN, symbols: ['SOL'], category: 'regulation' }, c)); // 같은 코인·카테고리·핵심 단어 2개(sec, spot, etf 중)
  assert.ok(!matches({ title: 'SEC approves spot Solana ETF', eventTime: T0 + 30 * 3600000, symbols: ['SOL'], category: 'regulation' }, c)); // 30시간 뒤
  assert.ok(!matches({ title: 'SEC approves spot XRP ETF', eventTime: T0, symbols: ['XRP'], category: 'regulation' }, c)); // 다른 코인
  const list1 = cl('Binance Will List AAA', ['AAA'], 'listing');
  assert.ok(!matches({ title: 'Binance Will List BBB', eventTime: T0, symbols: ['BBB'], category: 'listing' }, list1)); // Jaccard 높아도 다른 코인이면 분리
  assert.ok(!matches({ title: 'Weather is nice today', eventTime: T0, symbols: [], category: 'general' }, c));
});

test('클러스터: 심볼 없는 동일 제목은 묶음, 가장 비슷한 클러스터 선택', () => {
  const a = cl('Fed holds rates steady amid inflation worries', [], 'general');
  const b = cl('Fed holds rates steady', [], 'general');
  const pick = findCluster({ title: 'Fed holds rates steady amid inflation worries', eventTime: T0, symbols: [], category: 'general' }, [b, a]);
  assert.equal(pick, a);
  assert.equal(findCluster({ title: 'Totally unrelated headline', eventTime: T0, symbols: [], category: 'general' }, [a, b]), null);
  assert.ok(titleTokens('The SEC, and the ETF!').has('sec'));
});

// ── 시장 반응 (Upbit 1분봉 형식의 테스트 입력) ──
const iso = (t) => new Date(t).toISOString().slice(0, 19);
function candles(now, n, priceAt) {
  const m0 = Math.floor(now / MIN) * MIN;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const t = m0 - i * MIN;
    const p = priceAt(t);
    out.push({ candle_date_time_utc: iso(t), opening_price: p, high_price: p, low_price: p, trade_price: p, candle_acc_trade_price: 1e8, candle_acc_trade_volume: 1 });
  }
  return out;
}

test('시장 반응: 게시 후 5/15분, 현재 5/15분 변화율을 실제 봉으로 계산', () => {
  const now = T0 + 20 * MIN + 10000;
  const pub = T0;
  // 게시 시각까지 100, 이후 10분 동안 선형으로 103 까지 상승, 이후 유지
  const price = (t) => (t <= pub ? 100 : t >= pub + 10 * MIN ? 103 : 100 + ((t - pub) / (10 * MIN)) * 3);
  const r = reactionFromCandles(candles(now, 100, price), pub, now);
  assert.equal(r.price_now, 103);
  assert.equal(r.change_pre5, 0);
  assert.ok(r.change_post5 > 1 && r.change_post5 < 3);
  assert.ok(Math.abs(r.change_post15 - 3) < 0.01);
  assert.equal(r.change_5m, 0);
});

test('시장 반응: 데이터 없음/부족이면 null (임의 값 없음), 게시 시각 모르면 게시 기준 값은 null', () => {
  assert.equal(reactionFromCandles([], T0, T0), null);
  assert.equal(reactionFromCandles(null, T0, T0), null);
  assert.equal(reactionFromCandles([{ bad: 1 }], T0, T0), null);
  const now = T0 + 3 * MIN;
  const r = reactionFromCandles(candles(now, 60, () => 100), T0, now);
  assert.equal(r.change_post5, null); // 아직 5분이 지나지 않음
  assert.equal(r.change_post15, null);
  const r2 = reactionFromCandles(candles(now, 60, () => 100), null, now);
  assert.equal(r2.change_pre5, null);
  assert.equal(r2.change_5m, 0);
  // 게시 시각이 수집된 봉 범위보다 오래됨 → 게시 기준 값 null
  const r3 = reactionFromCandles(candles(now, 20, () => 100), now - 3 * 3600000, now);
  assert.equal(r3.price_at_pub, null);
  assert.equal(r3.change_post15, null);
});
