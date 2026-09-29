// 이상 이벤트 탐지 테스트 (외부 메신저 전송 없음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importance, isEvent } from '../src/alerts.js';
import { classify, radarScore } from '../src/monitor-engine.js';

const MIN = 60000;
const NOW = Date.UTC(2026, 8, 28, 5, 37, 20);

function row(market, window, changePct, ratio, quoteVol = 5e9) {
  const metrics = { status: 'ok', window, changePct, ratio, quoteVol, baselineAvg: ratio ? quoteVol / ratio : 0, baselineCount: 12, windowStart: Date.UTC(2026, 8, 28, 5, 37 - window), windowEnd: Date.UTC(2026, 8, 28, 5, 37) };
  return { market, window, metrics, cls: classify(metrics), score: radarScore(metrics) };
}
const noHistory = () => ({ sent: [], hourCount: 0, keys: new Set() });

test('중요 이벤트 판단', () => {
  assert.equal(importance(row('KRW-A', 5, 2.1, 3.8)).important, true); // 가격 급변 + 거래량 이상 (79점)
  assert.equal(importance(row('KRW-A', 5, 2.1, 3.8)).reason, '가격 급변 + 거래 활동 증가 동시 발생');
  assert.equal(importance(row('KRW-A', 5, 3, 6)).reason, '과열');
  assert.equal(importance(row('KRW-A', 5, 0.9, 6)).reason, '거래 활동 5배 이상 급증'); // 19 + 50 = 69점
  assert.equal(importance(row('KRW-A', 15, -3.08, 3.6)).important, true); // 사용자 예시 70점
});

test('중요하지 않은 움직임은 중요 이벤트 아님', () => {
  assert.equal(importance(row('KRW-A', 5, 0.3, 1.2)).important, false); // 관찰
  assert.equal(importance(row('KRW-A', 5, 1.3, 1.0)).important, false); // 가격만 (점수 27)
  assert.equal(importance(row('KRW-A', 5, 0.1, 3.5)).important, false); // 거래량만 (점수 33)
  assert.equal(importance(row('KRW-A', 5, 2.1, 3.8, 1e8)).reason, '구간 거래대금 기준 미달'); // 1억 < 2억
  assert.equal(importance({ metrics: { status: 'collecting' } }).important, false);
});

test('이벤트 저장 기준 (점수 50 이상 또는 거래량 이상 이상)', () => {
  assert.equal(isEvent(row('KRW-A', 5, 0.1, 3.5)), true);
  assert.equal(isEvent(row('KRW-A', 5, 0.3, 1.2)), false);
  assert.equal(isEvent({ metrics: { status: 'collecting' } }), false);
});
