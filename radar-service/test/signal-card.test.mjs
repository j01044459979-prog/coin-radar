// A/B 전략 알림 카드(표시 계층) 테스트. 모든 데이터는 합성이며 네트워크·Telegram은 모의다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STRATEGIES, MESSAGE_TYPES, PAPER_LABEL, typeLabel, validateCard, cardToEval, strategyCaption, buildStrategySvg, renderStrategyChart, deliverCard } from '../signal/card.mjs';
import { buildSignalSvg, DIR_COLOR, SIGNAL_CHART } from '../signal/chart.mjs';
import { evaluateSignal } from '../signal/evaluate.mjs';
import { displayWidth } from '../signal/message.mjs';
import { NOW, mkA, mk15, mirror15 } from './signal-fixture.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const FORBID = /승률|확률|매수|매도|주문 접수|수익 보장|보장합니다|확정 수익/;
let resvg = true; try { await import('@resvg/resvg-js'); } catch { resvg = false; }
const needPng = { skip: resvg ? false : '@resvg/resvg-js 미설치' };
const mkCard = (o = {}) => { const c15 = o.dir === 'SHORT' ? mirror15(mk15()) : mk15(), last = c15.at(-1), L = o.dir !== 'SHORT', s = L ? 1 : -1;
  return { strategy: 'A', symbol: 'BTCUSDT', dir: 'LONG', entry: last.c, stop: last.c - 2.5 * s, tp1: last.c + 5 * s, tp2: last.c + 8 * s, summary: '15분봉 돌파·거래량 확인', reasons: ['15분봉 확정 종가가 직전 2시간 고점 돌파', '거래량 직전 20봉 평균의 2배'], c15,
    triggerT: last.t, triggerCloseT: last.t + 900000, validUntil: last.t + 900000 + 45 * 60000, ...o }; };
const photo = ({ fail = null } = {}) => { const sent = []; return { sent, fn: async (png, caption) => { if (fail) throw fail; sent.push({ png, caption }); } }; };
const text = () => { const sent = []; return { sent, fn: async t => { sent.push(t); } }; };

test('전략명·메시지 유형 문구가 요구사항과 정확히 같다', () => {
  assert.equal(STRATEGIES.A.name, 'A전략 · 추세돌파형'); assert.equal(STRATEGIES.B.name, 'B전략 · 눌림목 재진입형');
  assert.equal(MESSAGE_TYPES.regular, '📊 TOP2 시장 분석 · 관찰용'); assert.equal(MESSAGE_TYPES.opportunity, '🔎 기회 포착 · 진입 전 관찰');
  assert.equal(MESSAGE_TYPES.A, '📈 A전략 · 모의매매 신호'); assert.equal(MESSAGE_TYPES.B, '📉 B전략 · 모의매매 신호'); assert.equal(PAPER_LABEL, '모의매매 · 미검증 전략');
  assert.throws(() => typeLabel('x'), /알 수 없는/); assert.equal(typeLabel('regular'), MESSAGE_TYPES.regular);
});
test('캡션: 3줄, 전략명·종목·방향 / 진입·손절·TP1·TP2 / 모의매매·미검증, 금지 표현 없음', () => {
  for (const [st, dir] of [['A', 'LONG'], ['B', 'SHORT']]) {
    const c = mkCard({ strategy: st, dir }), cap = strategyCaption(c), l = cap.split('\n');
    assert.equal(l.length, 3); assert.equal(l[0], `${STRATEGIES[st].emoji} ${STRATEGIES[st].name} | BTCUSDT ${dir}`);
    assert.match(l[1], /^진입 [\d.]+ · 손절 [\d.]+ · TP1 [\d.]+ · TP2 [\d.]+$/); assert.ok(l[2].startsWith(`${PAPER_LABEL} · `));
    l.forEach(x => assert.ok(displayWidth(x) <= 76, x)); assert.ok(!FORBID.test(cap)); assert.ok(!/<|>/.test(cap));
  }
  assert.ok(!strategyCaption(mkCard({ tp2: undefined })).includes('TP2'));
});
test('입력 검증: 전략 구분·방향·손절/목표 방향·근거 개수·요약·금지 표현', () => {
  assert.throws(() => validateCard(mkCard({ strategy: 'C' })), /전략 구분/);
  assert.throws(() => validateCard(mkCard({ dir: 'UP' })), /종목·방향/);
  assert.throws(() => validateCard(mkCard({ stop: mkCard().entry + 1 })), /손절가/);
  assert.throws(() => validateCard(mkCard({ tp1: mkCard().entry - 1 })), /목표가/);
  assert.throws(() => validateCard(mkCard({ tp2: mkCard().tp1 - 1 })), /목표가/);
  assert.throws(() => validateCard(mkCard({ entry: NaN })), /가격 값/);
  assert.throws(() => validateCard(mkCard({ reasons: ['하나뿐'] })), /근거는 2~3개/);
  assert.throws(() => validateCard(mkCard({ reasons: ['a', 'b', 'c', 'd'] })), /근거는 2~3개/);
  assert.throws(() => validateCard(mkCard({ summary: undefined })), /요약/);
  assert.throws(() => validateCard(mkCard({ summary: '지금 매수 기회' })), /금지 표현/);
  assert.throws(() => validateCard(mkCard({ reasons: ['승률 높음', '정상'] })), /금지 표현/);
});
test('손익비는 입력 가격에서만 계산된다(임의 값 없음)', () => {
  const c = mkCard(), ev = cardToEval(c), risk = c.entry - c.stop;
  assert.ok(Math.abs(ev.t1.rr - (c.tp1 - c.entry) / risk) < 1e-12); assert.ok(Math.abs(ev.t2.rr - (c.tp2 - c.entry) / risk) < 1e-12); assert.ok(Math.abs(ev.t1.net - (ev.t1.rr - c.entry * 0.0015 / risk)) < 1e-12);
  const s = cardToEval(mkCard({ dir: 'SHORT' })); assert.ok(s.t1.rr > 0 && s.t1.pct < 0);
});
test('전략 이미지 SVG: 전략명·방향 크게, TP1/TP2/진입가/손절가를 차트에 표시, 모의매매·미검증, 근거 2~3개', () => {
  for (const [st, dir] of [['A', 'LONG'], ['B', 'SHORT']]) {
    const c = mkCard({ strategy: st, dir, reasons: st === 'A' ? ['근거 하나입니다', '근거 둘입니다', '근거 셋입니다'] : ['근거 하나입니다', '근거 둘입니다'] }), svg = buildStrategySvg(c);
    assert.ok(svg.includes(STRATEGIES[st].name)); assert.ok(svg.includes(`>${dir}<`)); assert.ok(svg.includes(DIR_COLOR[dir])); assert.ok(svg.includes(STRATEGIES[st].color));
    for (const k of ['TP1', 'TP2', '진입가', '손절가', '모의매매 신호', '모의매매 · 미검증 전략']) assert.ok(svg.includes(k), k);
    for (const v of [c.entry, c.stop, c.tp1, c.tp2]) assert.ok(svg.includes(v.toFixed(2)), `가격 ${v}`);
    assert.equal(c.reasons.every(r => svg.includes(r)), true); assert.ok(!svg.includes('1차 목표') && !svg.includes('진입 관심가'));
    assert.ok(!FORBID.test(svg.replace(/주문 권고 아님/g, '')));
    const big = [...svg.matchAll(/font-size="(\d+)"/g)].map(m => Number(m[1])); assert.ok(Math.min(...big) >= 16, '글씨 최소 크기');
  }
});
test('기존 진입 후보 이미지(전략 옵션 없음)는 그대로: 1차/2차 목표·진입 관심가 라벨, 전략 문구 없음', () => {
  const ev = evaluateSignal({ a: mkA(), c15: mk15(), now: NOW }, { minRR: 1.5, validMin: 45 }), svg = buildSignalSvg('ETHUSDT', ev, mk15());
  for (const k of ['1차 목표', '2차 목표', '진입 관심가', '손절 기준', '진입 후보']) assert.ok(svg.includes(k), k);
  assert.ok(!svg.includes('TP1') && !svg.includes('A전략') && !svg.includes('모의매매 신호'));
});
test('PNG 렌더링: A·B 모두 세로형 1080×1560', needPng, async () => {
  for (const c of [mkCard(), mkCard({ strategy: 'B', dir: 'SHORT' })]) {
    const png = await renderStrategyChart(c);
    assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]); assert.equal(png.readUInt32BE(16), SIGNAL_CHART.W); assert.equal(png.readUInt32BE(20), SIGNAL_CHART.H); assert.ok(png.length > 20000 && png.length < 600000);
  }
});
test('전송: 사진+캡션 1건, 이미지 실패·사진 4xx 거절이면 같은 캡션 텍스트로 대체, 429·네트워크 오류는 던짐', async () => {
  const png = async () => Buffer.from([1, 2, 3]), c = mkCard(), cap = strategyCaption(c);
  { const p = photo(), t = text(), r = await deliverCard(c, { send: t.fn, sendPhoto: p.fn, render: png }); assert.equal(r.via, 'photo'); assert.equal(p.sent.length, 1); assert.equal(p.sent[0].caption, cap); assert.equal(t.sent.length, 0); }
  { const p = photo(), t = text(), r = await deliverCard(c, { send: t.fn, sendPhoto: p.fn, render: async () => { throw new Error('boom'); } }); assert.equal(r.via, 'text'); assert.equal(t.sent[0], cap); assert.equal(p.sent.length, 0); assert.match(r.chartError, /boom/); }
  { const p = photo(), t = text(), r = await deliverCard(c, { send: t.fn, sendPhoto: p.fn, render: async () => new Promise(() => {}), timeoutMs: 20 }); assert.equal(r.via, 'text'); assert.match(r.chartError, /시간 초과/); }
  { const p = photo({ fail: Object.assign(new Error('bad'), { status: 400 }) }), t = text(), r = await deliverCard(c, { send: t.fn, sendPhoto: p.fn, render: png }); assert.equal(r.via, 'text'); assert.equal(t.sent.length, 1); }
  for (const err of [Object.assign(new Error('limit'), { status: 429 }), Object.assign(new Error('srv'), { status: 502 }), new Error('network')]) {
    const t = text(); await assert.rejects(deliverCard(c, { send: t.fn, sendPhoto: photo({ fail: err }).fn, render: png }), e => e === err); assert.equal(t.sent.length, 0);
  }
  { const t = text(), r = await deliverCard(c, { send: t.fn }); assert.equal(r.via, 'text'); assert.equal(t.sent[0], cap); }
});
test('운영 경로는 바뀌지 않았다: run·step·integrate는 카드 모듈을 쓰지 않고, 워크플로 변수는 그대로', () => {
  for (const f of ['../run.mjs', '../signal/step.mjs', '../signal/integrate.mjs', '../signal/message.mjs', '../message.mjs'].filter(f => { try { readFileSync(new URL(f, import.meta.url)); return true; } catch { return false; } })) assert.ok(!/signal\/card|\.\/card\.mjs/.test(readFileSync(new URL(f, import.meta.url), 'utf8')), f);
  const yml = readFileSync(new URL('../../.github/workflows/radar.yml', import.meta.url), 'utf8');
  assert.match(yml, /RADAR_SIGNAL: \$\{\{ vars\.RADAR_SIGNAL \|\| 'off' \}\}/); assert.match(yml, /cron: '\*\/5 \* \* \* \*'/);
});
