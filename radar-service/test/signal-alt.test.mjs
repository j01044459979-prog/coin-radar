// 독립 전략 후보(눌림목 지정가·돌파 후 되돌림)·단계 분석·포착률 테스트(합성 데이터, 네트워크·Telegram·주문 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { limitOutcome, altTargets, collectAltEvents, summarizeAlt, ALT } from '../signal/alt-strategies.mjs';
import { funnelCoin, mergeFunnel, blankFunnel, captureRate, captureFromGaps } from '../signal/funnel.mjs';
import { collectSignalEvents, SBT } from '../signal/backtest.mjs';
import { M15 } from '../signal/evaluate.mjs';
import { ETH, SOL, BTC, wave, mirror } from './opportunity-fixture.mjs';
import { expand15, mkA } from './signal-fixture.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const bar = (k, o, h, l, c) => ({ t: k * M15, o, h, l, c, q: 1000 });
const path = rows => rows.map((r, k) => bar(k, ...r));
const base = [100, 100, 100, 100];

test('지정가 결과: 체결 후 목표 선도달 / 같은 봉 체결+손절은 손절 / 체결 봉의 목표 도달은 불인정 (LONG)', () => {
  // 지정가 99, 손절 97(위험 2), 1차 목표 103
  let r = limitOutcome(path([base, [100, 100.2, 98.9, 99.5], [99.5, 103.4, 99.2, 103]]), 0, 'LONG', 99, 97, 103, { costBps: 0, stressBps: 0 });
  assert.equal(r.filled, true); assert.equal(r.kind, 'target'); assert.ok(Math.abs(r.gross - 2) < 1e-9); assert.equal(r.fillBar, 1);
  r = limitOutcome(path([base, [100, 103.5, 98.9, 103.2]]), 0, 'LONG', 99, 97, 103, { costBps: 0 });
  assert.equal(r.filled, true); assert.notEqual(r.kind, 'target', '체결과 같은 봉의 목표 도달은 인정하지 않는다(보수적)');
  r = limitOutcome(path([base, [100, 101, 96.5, 98]]), 0, 'LONG', 99, 97, 103, { costBps: 0 });
  assert.equal(r.kind, 'stop'); assert.ok(Math.abs(r.gross + 1) < 1e-9, '같은 봉에서 체결과 손절이 모두 가능하면 체결 후 손절(손절가 종료)');
  assert.ok(r.mae >= 1);
});
test('지정가 결과: 놓침(체결 전 1차 목표 선도달)·만료·무효(체결 전 손절 이탈)는 미체결로 센다, 비용 반영', () => {
  assert.deepEqual(limitOutcome(path([base, [100, 103.5, 99.5, 103]]), 0, 'LONG', 99, 97, 103), { filled: false, why: 'missed' });
  assert.deepEqual(limitOutcome(path([base, ...Array.from({ length: 4 }, () => [100.5, 101, 100.2, 100.6])]), 0, 'LONG', 99, 97, 103, { validBars: 3 }), { filled: false, why: 'expired' });
  const st = limitOutcome(path([base, [100, 100.2, 96.8, 97]]), 0, 'LONG', 99.5, 97, 103, { costBps: 0 });
  assert.equal(st.filled, true); assert.equal(st.kind, 'stop'); assert.ok(Math.abs(st.gross + 1) < 1e-9, '체결 봉에서 손절가까지 내려가면 같은 봉 손절');
  const r = limitOutcome(path([base, [100, 100.2, 98.9, 99.5], [99.5, 103.4, 99.2, 103]]), 0, 'LONG', 99, 97, 103, { costBps: 15, stressBps: 30 });
  assert.ok(Math.abs(r.net - (2 - 99 * 15 / 10000 / 2)) < 1e-9 && Math.abs(r.netStress - (2 - 99 * 30 / 10000 / 2)) < 1e-9);
});
test('지정가 결과: SHORT 대칭', () => {
  const r = limitOutcome(path([base, [100, 101.1, 99.8, 100.5], [100.5, 100.8, 96.6, 97]]), 0, 'SHORT', 101, 103, 97, { costBps: 0 });
  assert.equal(r.filled, true); assert.equal(r.kind, 'target'); assert.ok(Math.abs(r.gross - 2) < 1e-9);
  assert.equal(limitOutcome(path([base, [100, 100.5, 96.5, 97]]), 0, 'SHORT', 101, 103, 97, { costBps: 0 }).why, 'missed');
});
test('목표: 지정가 가격 기준으로 1차(1R 이상)·2차(+0.5R)를 다시 고르고 비용을 R로 뺀다', () => {
  const a = mkA(), t = altTargets(a, 'LONG', 99.2, 97.5, { costBps: 15 });
  assert.equal(t.t1, 105); assert.equal(t.t2, 109); assert.ok(Math.abs(t.risk - 1.7) < 1e-9 && Math.abs(t.net1 - (5.8 / 1.7 - 99.2 * 0.0015 / 1.7)) < 1e-9);
  assert.equal(altTargets(a, 'LONG', 97, 97.5), null, '손절이 지정가보다 위면 계산하지 않는다');
  assert.equal(altTargets({ ...a, obstacles: [] }, 'LONG', 99.2, 97.5), null, '목표 근거가 없으면 만들지 않는다');
});
test('포착률: 실행 간격이 길수록 20분 지연 한도 안에 실행이 있을 확률이 낮아진다', () => {
  assert.equal(captureRate(5), 1); assert.equal(captureRate(20), 1); assert.equal(captureRate(60), 20 / 60); assert.equal(captureRate(200), 0.1);
  assert.ok(Math.abs(captureFromGaps([10, 10, 100]) - (10 + 10 + 20) / 120) < 1e-12);
  assert.equal(captureFromGaps([]), null);
});
test('단계 분석: 병합·집계가 일관되고, 후보가 나온 봉은 맥락 충족 봉 안에 있다 (합성 5000시간)', () => {
  const E5 = wave(5000, 5), B5 = wave(5000, 9, { amp: 0.04, per: 300 }), eth = expand15(E5), btc = expand15(B5);
  const f = funnelCoin(eth, btc, { from: SBT.warm15 });
  assert.equal(f.bars - f.data, f.stage0 + f.stage1 + f.ctx);
  assert.equal(f.ctx, Object.values(f.wait).reduce((x, y) => x + y, 0) + f.observe + f.candidate);
  assert.ok(Object.values(f.sole).every(v => v >= 0) && Object.entries(f.sole).every(([k, v]) => v <= f.tag[k]));
  const m = mergeFunnel(f, f); assert.equal(m.ctx, f.ctx * 2); assert.equal(m.sole.volume, f.sole.volume * 2); assert.deepEqual(mergeFunnel(blankFunnel(), blankFunnel()), blankFunnel());
});
test('대체 전략: 합성 데이터에서도 결정적이고 시간 인과성을 지키며(앞부분 결과가 뒤 데이터로 바뀌지 않음), 요약이 비어 있어도 안전하다', () => {
  const E5 = wave(5000, 5), B5 = wave(5000, 9, { amp: 0.04, per: 300 }), eth = expand15(E5), btc = expand15(B5), cut = 4 * 3500 + 2;
  const a = collectAltEvents('ETHUSDT', eth.slice(0, cut), btc.slice(0, cut), {}), b = collectAltEvents('ETHUSDT', eth, btc, {}), again = collectAltEvents('ETHUSDT', eth, btc, {});
  assert.deepEqual(b, again, '결정적');
  for (const k of Object.keys(a)) for (const e of a[k]) { const same = b[k].find(x => x.i === e.i && x.dir === e.dir && x.limit === e.limit); assert.ok(same, `${k}: 먼저 나온 주문이 전체 데이터에서도 같은 시점에 존재`); assert.equal(same.stop, e.stop); }
  for (const k of Object.keys(b)) for (const e of b[k]) { assert.ok(e.riskAtr >= 1 && e.riskAtr <= 3.5 && e.net1 >= ALT.minRR - 1e-9, `${k}: 손절 거리·비용 반영 손익비 기준 통과`); assert.ok((e.limit - e.stop) * (e.dir === 'LONG' ? 1 : -1) > 0); }
  const s = summarizeAlt(b.PBedge, { coins: 1, days: 10 }); assert.equal(s.armed, b.PBedge.length); assert.ok(s.armed === 0 || (s.fillRate >= 0 && s.fillRate <= 1));
  assert.equal(summarizeAlt([], { coins: 1, days: 1 }).armed, 0);
  const base = collectSignalEvents('ETHUSDT', eth, btc, { control: false }); assert.ok(Array.isArray(base.events), '기존 신호 수집은 영향 없음');
});
