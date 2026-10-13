import test from 'node:test';
import assert from 'node:assert/strict';
import { createOkxCollector, internalSymbol } from '../okx.mjs';
import { fakeOkx, now, open, ok } from './fake-okx.mjs';
import { applyBtcFilter, reportText, signalText } from '../analysis.mjs';
test('OKX collector maps confirmed candles, excludes inverse contracts and labels the source', async () => {
  const calls = [];
  const { rows, failures } = await createOkxCollector(fakeOkx({ calls }), { gapMs: 0 })(now);
  assert.equal(failures.length, 0);
  assert.deepEqual(rows.map(r => r.symbol).sort(), ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  const btc = rows.find(r => r.symbol === 'BTCUSDT');
  assert.equal(btc.direction, 'LONG'); assert.equal(btc.source, 'OKX USDT 무기한(SWAP)');
  assert.equal(btc.candleAt, open - 1); // 미확정 현재 봉은 사용하지 않음
  assert.ok(btc.oi15 > 2 && btc.oi15 < 4, `oi15=${btc.oi15}`);
  assert.ok(!calls.some(u => /binance/i.test(u)));
});
test('OKX report states the exchange, is not Binance, and contains numbers for invalidation', async () => {
  const { rows } = await createOkxCollector(fakeOkx(), { gapMs: 0 })(now);
  const text = reportText(rows, [], now);
  assert.match(text, /OKX/); assert.match(text, /Binance 아님/); assert.match(text, /무효화 참고선/); assert.match(text, /핵심 가격대/);
  assert.doesNotMatch(text, /(승률|확률|수익률)\s*\d/);
});
test('OKX failure code or HTTP block raises an error instead of inventing data', async () => {
  const bad = async () => new Response(JSON.stringify({ code: '50011', msg: 'rate limit', data: [] }), { status: 200 });
  await assert.rejects(createOkxCollector(bad, { gapMs: 0 })(now), /응답 오류/);
  await assert.rejects(createOkxCollector(async () => new Response('', { status: 403 }), { gapMs: 0 })(now), e => e.status === 403);
});
test('a symbol with stale OI is skipped and reported as failure, others continue', async () => {
  const f = fakeOkx(); let eth = 0;
  const wrapped = async url => {
    if (url.includes('open-interest?') && url.includes('ETH-USDT')) return ok([{ instId: 'ETH-USDT-SWAP', oi: '1', oiCcy: '103', ts: String(now - 600000) }]);
    return f(url);
  };
  const { rows, failures } = await createOkxCollector(wrapped, { gapMs: 0 })(now);
  assert.equal(rows.length, 2); assert.equal(failures[0].symbol, 'ETHUSDT');
});
test('safe vs aggressive grade follows BTC alignment, funding, OI and distance', () => {
  const base = { symbol: 'ETHUSDT', direction: 'LONG', strong: true, funding: 0.01, oi15: 2, price: 100.1, level: 100, atr: 1, change15: 0 };
  const btc = { symbol: 'BTCUSDT', change15: 0.1, strong: false, direction: 'WAIT' };
  assert.equal(applyBtcFilter([btc, base])[1].grade, '보수형');
  assert.equal(applyBtcFilter([btc, { ...base, funding: 0.04 }])[1].grade, '공격형');
  assert.equal(applyBtcFilter([btc, { ...base, price: 100.9 }])[1].grade, '공격형');
  assert.equal(applyBtcFilter([{ ...btc, change15: -0.2 }, base])[1].grade, '공격형');
  assert.equal(applyBtcFilter([btc, { ...base, strong: false }])[1].grade, null);
});
test('internal symbol mapping', () => assert.equal(internalSymbol('SOL-USDT-SWAP'), 'SOLUSDT'));
test('signal text carries price, time, levels and source', () => {
  const t = signalText({ symbol: 'BTCUSDT', direction: 'SHORT', grade: '공격형', price: 99, priceAt: now, trend: '하락', change15: -1, oi15: 2, volume: 3, funding: 0.01, atrPct: .3, level: 100, stop: 101, source: 'OKX', sourceUrl: 'u' });
  assert.match(t, /숏 관찰 · 공격형 후보/); assert.match(t, /KST/); assert.match(t, /무효화 참고선 101/);
});
