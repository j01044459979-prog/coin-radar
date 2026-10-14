import test from 'node:test';
import assert from 'node:assert/strict';
import { createOkxCollector } from '../okx.mjs';
import { fakeOkx, instrumentList, mtfCandles, now } from './fake-okx.mjs';
import { reportMessages, signalText } from '../report.mjs';
import { selectUniverse, ineligibleReason, PRIORITY } from '../universe.mjs';
import { staleReason, trendOf, TF_MS } from '../indicators.mjs';
import { scoreRow } from '../scoring.mjs';

const collect = (opts = {}, copts = {}) => createOkxCollector(fakeOkx(opts), { gapMs: 0, ...copts })(now);
const NON = ['SOXLUSDT', 'SNDKUSDT', 'SKHYNIXUSDT', 'GOLDUSDT', 'MYSTERYUSDT', 'OLDCOINUSDT'];

// ── 1. 암호화폐만 감시 ──
test('주식·원자재·분류 없음·거래 중지 상품은 제외되고 암호화폐만 감시된다', async () => {
  const { rows, stats } = await collect({ universe: 'full' });
  const symbols = rows.map(r => r.symbol);
  assert.deepEqual(symbols.slice(0, 5), ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ZECUSDT', 'RENDERUSDT']); // 우선 감시가 먼저
  for (const x of NON) assert.ok(!symbols.includes(x), x);
  assert.ok(symbols.includes('DOGEUSDT'));
  const excluded = Object.fromEntries(stats.universe.excluded.map(e => [e.id, e.reason]));
  assert.match(excluded['SOXL-USDT-SWAP'], /암호화폐 아님\(instCategory=2\)/);
  assert.match(excluded['GOLD-USDT-SWAP'], /instCategory=3/);
  assert.match(excluded['MYSTERY-USDT-SWAP'], /분류 정보 없음\(기본 제외\)/);
  assert.match(excluded['OLDCOIN-USDT-SWAP'], /거래 불가/);
});
test('주식형 상품이 거래대금 최상위여도 추천 후보·보고서에 나오지 않는다', async () => {
  const { rows, failures } = await collect({ universe: 'full', breakout: false });
  const text = reportMessages(rows, failures, now).join('\n');
  for (const x of ['SOXL', 'SNDK', 'SKHYNIX']) assert.doesNotMatch(text, new RegExp(x));
});
test('적격 종목이 12개 미만이면 억지로 채우지 않는다', async () => {
  const { rows, stats } = await collect({ universe: 'full' });
  assert.equal(rows.length, 6); assert.equal(stats.universe.eligible, 6); assert.equal(stats.universe.selected.length, 6);
});
test('12개 상한: 적격 종목이 많으면 우선 감시 뒤에 거래대금 순으로 채운다', () => {
  const inst = [], tick = [];
  for (let i = 0; i < 20; i++) { const c = i === 0 ? 'BTC' : i === 1 ? 'ETH' : i === 2 ? 'SOL' : `COIN${i}`; inst.push({ instId: `${c}-USDT-SWAP`, state: 'live', ctType: 'linear', settleCcy: 'USDT', instCategory: '1' }); tick.push({ instId: `${c}-USDT-SWAP`, last: '1', volCcy24h: String(100 + i) }); }
  const u = selectUniverse({ instruments: inst, tickers: tick });
  assert.equal(u.ids.length, 12); assert.deepEqual(u.ids.slice(0, 3), ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP']);
  assert.equal(u.ids[3], 'COIN19-USDT-SWAP'); // 다음은 거래대금 최상위
});
test('관심 코인(ZEC, RENDER)은 실제 상장·거래 가능할 때만 우선 감시, 아니면 사유를 기록', () => {
  assert.deepEqual(PRIORITY.slice(0, 3), ['BTC', 'ETH', 'SOL']); assert.ok(PRIORITY.includes('ZEC') && PRIORITY.includes('RENDER'));
  const mk = (c, o = {}) => ({ instId: `${c}-USDT-SWAP`, state: 'live', ctType: 'linear', settleCcy: 'USDT', instCategory: '1', ...o });
  const inst = [mk('BTC'), mk('ETH'), mk('SOL'), mk('ZEC', { state: 'suspend' })]; // RENDER 미상장
  const tick = inst.map(x => ({ instId: x.instId, last: '1', volCcy24h: '10' }));
  const u = selectUniverse({ instruments: inst, tickers: tick });
  assert.equal(u.priorityStatus.ZEC, '제외: 거래 불가(state=suspend)'); assert.equal(u.priorityStatus.RENDER, 'OKX USDT 무기한 미상장'); assert.equal(u.priorityStatus.BTC, '감시');
  assert.ok(!u.ids.includes('ZEC-USDT-SWAP') && !u.ids.includes('RENDER-USDT-SWAP'));
});
test('분류 필드 의미가 달라져 BTC가 암호화폐로 분류되지 않으면 추측하지 않고 중단', async () => {
  const inst = instrumentList().map(x => ({ ...x, instCategory: '9' }));
  await assert.rejects(collect({ instruments: inst }), /종목 분류 점검 실패/);
  const none = instrumentList().map(({ instCategory, ...x }) => x);
  await assert.rejects(collect({ instruments: none }), /종목 분류 점검 실패/);
});
test('부적격 사유 판정', () => {
  const ok = { instId: 'X-USDT-SWAP', state: 'live', ctType: 'linear', settleCcy: 'USDT', instCategory: '1' };
  assert.equal(ineligibleReason(ok), null);
  assert.match(ineligibleReason({ ...ok, instCategory: undefined }), /분류 정보 없음/);
  assert.match(ineligibleReason({ ...ok, ctType: 'inverse' }), /선형/);
  assert.match(ineligibleReason({ ...ok, instId: 'X-USD-SWAP' }), /형식/);
});
test('ZEC 등 승인된 코인 후보가 정상 분석되어 점수·시나리오를 가진다', async () => {
  const { rows } = await collect({ universe: 'full', breakout: false });
  const zec = rows.find(r => r.symbol === 'ZECUSDT');
  assert.ok(zec && zec.candidate && Number.isFinite(zec.candidate.score)); assert.ok(zec.candidate.plan); assert.equal(zec.source, 'OKX USDT 무기한(SWAP)');
  assert.ok(rows.find(r => r.symbol === 'RENDERUSDT').candidate);
});
// ── 2. 상위 시간대 최신성 ──
const bars = (tf, n, endStart) => Array.from({ length: n }, (_, i) => { const t = endStart - (n - 1 - i) * TF_MS[tf]; const c = 100 + i * .4 + Math.round(2 * Math.sin(2 * Math.PI * i / 8) * 1e4) / 1e4; return { t, o: c, h: c + .5, l: c - .5, c, end: t + TF_MS[tf] - 1 }; });
test('마지막 확정봉이 직전 마감봉이면 정상, 뒤처지면 데이터 지연으로 미확인', () => {
  for (const tf of ['15m', '1H', '4H']) {
    const step = TF_MS[tf], T = Math.floor(now / step) * step, expected = T - step;
    assert.equal(staleReason(bars(tf, 40, expected), tf, now), null);
    assert.match(staleReason(bars(tf, 40, expected - 3 * step), tf, now), /데이터 지연/);
    const u = trendOf(bars(tf, 40, expected - 3 * step), tf, now);
    assert.equal(u.dir, 'UNKNOWN'); assert.match(u.basis, /데이터 지연/);
    assert.equal(trendOf(bars(tf, 40, expected), tf, now).dir, 'UP');
  }
});
test('마감 직후 90초 이내에는 한 봉 지연을 허용하고 그 이후엔 허용하지 않는다', () => {
  const tf = '15m', step = TF_MS[tf], T = 1800000000000 - (1800000000000 % step);
  const prev = bars(tf, 40, T - 2 * step); // 한 봉 뒤처진 데이터
  assert.equal(staleReason(prev, tf, T + 30000), null);
  assert.match(staleReason(prev, tf, T + 95000), /데이터 지연/);
});
test('미래 시각·정렬 이상·비정상 캔들은 미확인', () => {
  const tf = '1H', step = TF_MS[tf], T = Math.floor(now / step) * step;
  assert.match(staleReason(bars(tf, 40, T), tf, now), /미래/);       // 아직 마감되지 않은 봉이 확정으로 들어옴
  assert.match(staleReason(bars(tf, 40, T - step + 60000), tf, now), /정렬/);
  assert.equal(trendOf(bars(tf, 40, T - step), tf, now, '비정상 캔들').dir, 'UNKNOWN');
});
test('오래된 상위 시간대 데이터에는 정상 점수를 주지 않고 위험 요인으로 표시', async () => {
  const fresh = (await collect({})).rows.find(r => r.symbol === 'BTCUSDT');
  const stale = (await collect({ mtf: { '4H': 'stale', '1H': 'stale' } })).rows.find(r => r.symbol === 'BTCUSDT');
  assert.equal(stale.mtf['4H'].dir, 'UNKNOWN'); assert.match(stale.mtf['4H'].basis, /데이터 지연/); assert.equal(stale.mtf['1H'].dir, 'UNKNOWN'); assert.equal(stale.mtf['15m'].dir, 'UP');
  assert.equal(fresh.candidate.parts.mtf.score, 20); assert.equal(stale.candidate.parts.mtf.score, 6);
  assert.ok(stale.candidate.missing.includes('4H 추세')); assert.ok(stale.candidate.risk.factors.some(x => x.includes('미확인')));
  assert.match(reportMessages([stale], [], now).join('\n'), /15분 ↑ \/ 1시간 \? \/ 4시간 \?/);
});
test('수집 실패·누락 캔들도 점수 0, 5분 점수 계산은 영향 없음', () => {
  const s = scoreRow({ price: 100, atr: 1, high: 101, low: 99, trend: '상승', direction: 'WAIT', volume: 1, oi15: 0, funding: 0, atrPct: 1 }, 'LONG', { '15m': { dir: 'UNKNOWN' }, '1H': { dir: 'UNKNOWN' }, '4H': { dir: 'UNKNOWN' } }, { change15: 0.2 });
  assert.equal(s.parts.mtf.score, 0); assert.equal(s.missing.length, 3 + 0);
});
// ── 3. 문구 ──
test('강한 조건 문구: 즉시 진입이 아니라 강한 관찰 조건 포착, 시나리오는 조건부 참고값', async () => {
  const { rows, failures } = await collect({});
  const text = reportMessages(rows, failures, now).join('\n');
  assert.doesNotMatch(text, /즉시 진입/); assert.match(text, /강한 관찰 조건 포착/); assert.match(text, /조건부 참고값/);
  assert.match(text, /위험 수준: 낮음 \(상대 평가이며 선물거래 자체의 저위험을 뜻하지 않음\)/);
  assert.match(text, /선물거래 자체의 저위험을 뜻하지 않음/);
  const alert = signalText(rows.find(r => r.strong));
  assert.match(alert, /조건부 참고값/); assert.match(alert, /선물거래 자체의 저위험을 뜻하지 않음/); assert.doesNotMatch(alert, /즉시 진입/);
});
test('근접 후보 보고에도 조건부 문구가 있고 강한 신호 표현이 없다', async () => {
  const { rows, failures } = await collect({ universe: 'full', breakout: false });
  const text = reportMessages(rows, failures, now).join('\n');
  assert.doesNotMatch(text, /즉시 진입|강한 관찰 조건 포착/); assert.match(text, /조건부 관찰/); assert.match(text, /조건부 참고값/);
  assert.ok(reportMessages(rows, failures, now).every(m => m.length <= 4000));
});
