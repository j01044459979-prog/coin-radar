import test from 'node:test';
import assert from 'node:assert/strict';
import { donchianMessage } from '../signal/donchian.mjs';

// Message-only checks with synthetic prices; no trading or profitability claims.
const asOf = Date.UTC(2026, 10, 19, 0);
const watchShort = {
  stage: 'WATCH', dir: 'SHORT', asOf, upper: 0.03004, lower: 0.02629,
  ema200: 0.029, entry: 0.0265,
};
const breakoutShort = {
  ...watchShort, stage: 'BREAKOUT', entry: 0.0265,
  stop: 0.02756, t1: 0.02385, t2: 0.02226,
  riskPct: 4, costR: 0.0375, volRel: 1.5,
};
const breakoutLong = {
  stage: 'BREAKOUT', dir: 'LONG', asOf,
  upper: 99, lower: 90, ema200: 95, entry: 100,
  stop: 98, t1: 105, t2: 108, riskPct: 2, costR: 0.075,
};

test('Donchian SHORT watch says wait and does not invent stop or take-profit prices', () => {
  const msg = donchianMessage('MUBARAKUSDT', watchShort);
  assert.equal(msg.kind, 'donchian-watch');
  assert.match(msg.plain, /지금 할 일: 관망 · 4H 확정봉 대기/);
  assert.match(msg.plain, /진입 확인 조건: 4H 종가 0\.02629 미만 · 음봉 · EMA200 아래/);
  assert.match(msg.plain, /4H 돌파 확인선 0\.02629 \(1H 종가 대비 -0\.79%\)/);
  assert.match(msg.plain, /손절 \/ 🎯 익절: 미산정/);
  assert.doesNotMatch(msg.plain, /1차 익절 2\.5R|2차 익절 4R|손절 0\./);
  assert.ok(!/NaN|Infinity/.test(msg.plain));
});

test('Donchian SHORT breakout shows price-change percentages for stop and both targets', () => {
  const msg = donchianMessage('MUBARAKUSDT', breakoutShort);
  assert.match(msg.plain, /지금 할 일: 실시간 가격 확인 · 추격 진입 금지/);
  assert.match(msg.plain, /충족된 4H 조건: 4H 종가 0\.02629 미만 · 음봉 · EMA200 아래/);
  assert.match(msg.plain, /손절 0\.02756 \(가격 \+4\.00% · 손실\)/);
  assert.match(msg.plain, /1차 익절 2\.5R 0\.02385 \(가격 -10\.00% · 수익\)/);
  assert.match(msg.plain, /2차 익절 4R 0\.02226 \(가격 -16\.00% · 수익\)/);
  assert.match(msg.plain, /레버리지\/비용 미반영/);
  assert.match(msg.plain, /수익성 미검증/);
});

test('Donchian LONG breakout reports downward stop and upward take-profit distances', () => {
  const msg = donchianMessage('ETHUSDT', breakoutLong);
  assert.match(msg.plain, /충족된 4H 조건: 4H 종가 99\.00 초과 · 양봉 · EMA200 위/);
  assert.match(msg.plain, /손절 98\.00 \(가격 -2\.00% · 손실\)/);
  assert.match(msg.plain, /1차 익절 2\.5R 105\.00 \(가격 \+5\.00% · 수익\)/);
  assert.match(msg.plain, /2차 익절 4R 108\.00 \(가격 \+8\.00% · 수익\)/);
  assert.equal(msg.plain.includes('<b>'), false, 'plain text stays HTML-free');
});
