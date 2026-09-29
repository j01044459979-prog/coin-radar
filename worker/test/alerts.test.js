// 알림 판정 / 카카오톡 메시지 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importance, isEvent, decideAlerts, formatAlertMessage, dedupKey, kst, fmtKrw } from '../src/alerts.js';
import { classify, radarScore } from '../src/monitor-engine.js';
import { ALERT } from '../src/config.js';

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

test('중요하지 않은 움직임은 알림 없음', () => {
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

test('cooldown: 같은 종목은 30분 동안 다시 알리지 않음', () => {
  const r = row('KRW-A', 5, 2.1, 3.8);
  const history = { sent: [{ market: 'KRW-A', level: 'alert', sent_at: NOW - 10 * MIN }], hourCount: 1, keys: new Set() };
  const d = decideAlerts([r], history, NOW);
  assert.equal(d[0].action, 'skip');
  assert.match(d[0].why, /cooldown/);
  // 30분이 지나면 다시 가능
  const old = { sent: [{ market: 'KRW-A', level: 'alert', sent_at: NOW - 31 * MIN }], hourCount: 1, keys: new Set() };
  assert.equal(decideAlerts([r], old, NOW)[0].action, 'send');
  // 다른 종목은 영향 없음
  assert.equal(decideAlerts([row('KRW-B', 5, 2.1, 3.8)], history, NOW)[0].action, 'send');
});

test('cooldown 중이라도 상태 등급이 올라가면(과열) 1회 허용', () => {
  const hot = row('KRW-A', 5, 3, 6);
  const history = { sent: [{ market: 'KRW-A', level: 'alert', sent_at: NOW - 5 * MIN }], hourCount: 1, keys: new Set() };
  const d = decideAlerts([hot], history, NOW);
  assert.equal(d[0].action, 'send');
  assert.equal(d[0].escalation, true);
  const after = { sent: [...history.sent, { market: 'KRW-A', level: 'overheat', sent_at: NOW - MIN }], hourCount: 2, keys: new Set() };
  assert.equal(decideAlerts([hot], after, NOW)[0].action, 'skip');
});

test('중복 방지: 이미 처리한 같은 이벤트(종목·구간·구간 끝 시각)는 다시 보내지 않음', () => {
  const r = row('KRW-A', 5, 2.1, 3.8);
  assert.equal(dedupKey(r), `KRW-A|5|${Date.UTC(2026, 8, 28, 5, 37)}`);
  const d = decideAlerts([r], { sent: [], hourCount: 0, keys: new Set([dedupKey(r)]) }, NOW);
  assert.equal(d[0].action, 'skip');
  assert.match(d[0].why, /이미 처리/);
});

test('도배 방지: 한 번에 최대 3건, 1시간 최대 10건', () => {
  const many = ['A', 'B', 'C', 'D', 'E'].map((m) => row('KRW-' + m, 5, 2.1, 3.8));
  const d = decideAlerts(many, noHistory(), NOW);
  assert.equal(d.filter((x) => x.action === 'send').length, ALERT.maxPerRun);
  assert.match(d[3].why, /한 번에 최대/);
  const busy = decideAlerts(many, { sent: [], hourCount: 9, keys: new Set() }, NOW);
  assert.equal(busy.filter((x) => x.action === 'send').length, 1);
  assert.match(busy[1].why, /1시간 최대/);
});

test('카카오톡 메시지: 필수 정보 포함, 200자 이내, 추천 표현 없음', () => {
  const r = row('KRW-SOL', 5, 2.1, 3.8, 32e8);
  const text = formatAlertMessage(r, NOW);
  for (const s of ['🚨 COIN RADAR', 'SOL 가격 급변 + 거래량 이상 감지', '⏱ 5분 (14:32~14:37)', '💰 가격변동 +2.10%', '📊 거래활동 3.8배', '🎯 Radar Score 79', '상태\n⚡ 가격 급변\n⚠️ 거래량 이상', '🕒 09-28 14:37 KST · Upbit']) {
    assert.ok(text.includes(s), `메시지에 "${s}" 없음\n${text}`);
  }
  assert.ok(text.length <= 200, `길이 ${text.length}`);
  assert.doesNotMatch(text, /매수|매도|롱|숏|buy|sell|long|short/i);
  const hot = formatAlertMessage(row('KRW-SOL', 5, 3, 6), NOW, { escalation: true });
  assert.match(hot, /COIN RADAR \(상태 상향\)\nSOL 과열 감지/);
  assert.match(hot, /🔥 과열\n⚡ 가격 급변\n⚠️ 거래량 이상/);
  assert.ok(hot.length <= 200);
  // 가장 긴 경우(긴 종목명 + 모든 상태 + 평소 거래 없음)도 200자 이내
  const worst = formatAlertMessage(row('KRW-ABCDEFGHIJ', 15, -12.34, null), NOW, { escalation: true });
  assert.ok(worst.length <= 200, `길이 ${worst.length}`);
});

test('시간/금액 표시', () => {
  assert.equal(kst(NOW), '2026-09-28 14:37:20');
  assert.equal(fmtKrw(1.5e12), '₩1.50조');
  assert.equal(fmtKrw(3.2e9), '₩32.0억');
  assert.equal(fmtKrw(52e6), '₩5200만');
});
