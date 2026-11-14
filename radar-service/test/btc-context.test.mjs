import test from 'node:test';
import assert from 'node:assert/strict';
import { H1, H4 } from '../opportunity/indicators.mjs';
import { btcContext, btcContextLines } from '../signal/btc-context.mjs';
import { candidateMessage } from '../signal/message.mjs';
import { signalCaption } from '../signal/chart.mjs';

const AT = 500 * H1 + 15 * 60000;
function series(step, count, base, slope) {
  const end = Math.floor(AT / step) * step - step;
  return Array.from({ length: count }, (_, i) => {
    const c = base + i * slope;
    return { t: end - (count - 1 - i) * step, o: c, h: c + 1, l: c - 1, c };
  });
}
test('BTC confirmed 4H trend and matching confirmed 1H pct contrast with alt', () => {
  const btc4h = series(H4, 60, 100, 1);
  const btc1h = series(H1, 30, 150, 1);
  const alt1h = series(H1, 30, 30, -0.1);
  const c = btcContext({ btc4h, btc1h, coin1h: alt1h, dir: 'SHORT', at: AT });
  assert.equal(c.trend4h, '상승');
  assert.equal(c.status, '충돌');
  assert.ok(c.btc1hPct > 0 && c.coin1hPct < 0 && c.changeVsBtc < 0);
  assert.match(btcContextLines(c, 'ETHUSDT', 'SHORT').join('\n'), /BTC 4H·1H이 숏 반대/);
});
test('BTC stale/future bars never produce invented comparisons', () => {
  const btc4h = series(H4, 60, 100, 1);
  const btc1h = series(H1, 30, 150, 1);
  const coin1h = series(H1, 30, 50, -0.1);
  const missing = btcContext({ btc4h: btc4h.map(c => ({ ...c, t: c.t - 2 * H4 })), btc1h: btc1h.map(c => ({ ...c, t: c.t - 3 * H1 })), coin1h, dir: 'LONG', at: AT });
  assert.equal(missing.status, '확인 불가');
  assert.match(btcContextLines(missing, 'SOLUSDT', 'LONG')[0], /데이터 부족/);
  const future = btcContext({ btc4h, btc1h: btc1h.map(c => ({ ...c, t: c.t + 2 * H1 })), coin1h, dir: 'LONG', at: AT });
  assert.equal(future.btc1hPct, null);
  const nonmatching = btcContext({ btc4h, btc1h, coin1h: coin1h.map(c => ({ ...c, t: c.t - H1 })), dir: 'LONG', at: AT });
  assert.equal(nonmatching.coin1hPct, null);
});
test('BTC is informational only, rendered in both text and photo caption without changing R9 payload', () => {
  const ev = { status: 'CANDIDATE', strategy: 'ema-pullback', dir: 'SHORT',
    entry: 100, stop: 101, riskPct: 1, triggerCloseT: AT, validUntil: AT + 45 * 60000,
    t1: { price: 98, pct: -2, rr: 2, net: 1.85 }, t2: null, score: 80, evidence: ['확정봉'],
    costPct: 0.15 };
  const btc = btcContext({ btc4h: series(H4, 60, 100, 1), btc1h: series(H1, 30, 150, 1),
    coin1h: series(H1, 30, 80, -0.2), dir: 'SHORT', at: AT });
  const text = candidateMessage('ETHUSDT', ev, { now: AT, btc }).plain;
  const caption = signalCaption('ETHUSDT', ev, { now: AT, btc });
  assert.match(text, /BTC 비교/); assert.match(caption, /BTC 비교/);
  assert.match(text, /BTC 4H·1H이 숏 반대/);
  assert.match(caption, /BTC 4H·1H이 숏 반대/);
  assert.ok([...caption].length < 900, 'leaves room for RICH300 caption fields');
  assert.equal(ev.btcAlign, undefined, 'message must not mutate scoring or feed');
});
