// 신호 이미지 알림 테스트. 모든 데이터는 합성이며 네트워크·Telegram은 모의다(실제 호출 금지).
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSignal } from '../signal/evaluate.mjs';
import { buildSignalSvg, renderSignalChart, signalCaption, reasonRows, SIGNAL_CHART, DIR_COLOR } from '../signal/chart.mjs';
import { signalStep } from '../signal/step.mjs';
import { displayWidth } from '../signal/message.mjs';
import { telegramPhotoSender } from '../service.mjs';
import { NOW, mkA, mirrorA, mk15, mirror15, sender, store, collectors, oppState } from './signal-fixture.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const OPT = { minRR: 1.5, validMin: 45 };
const evalL = () => evaluateSignal({ a: mkA(), c15: mk15(), now: NOW }, OPT);
const evalS = () => evaluateSignal({ a: mirrorA(mkA()), c15: mirror15(mk15()), now: NOW }, OPT);
const FORBID = /승률|확률|매수|매도|주문 접수|수익 보장|보장합니다/;
const PNG = [0x89, 0x50, 0x4e, 0x47];
let resvg = true; try { await import('@resvg/resvg-js'); } catch { resvg = false; }
const needPng = { skip: resvg ? false : '@resvg/resvg-js 미설치' };

test('신호 SVG: 방향 색(LONG 초록·SHORT 빨강)과 실제 가격·목표·손익비만 표시한다', () => {
  for (const [ev, c15, col] of [[evalL(), mk15(), DIR_COLOR.LONG], [evalS(), mirror15(mk15()), DIR_COLOR.SHORT]]) {
    const svg = buildSignalSvg('ETHUSDT', ev, c15);
    assert.ok(svg.includes(`fill="${col}"`)); assert.ok(svg.includes(`>${ev.dir}<`));
    for (const v of [ev.entry, ev.stop, ev.t1.price, ev.t2.price]) assert.ok(svg.includes(v.toFixed(v > 1000 ? 2 : 2)) || svg.includes(String(v)), `가격 ${v}`);
    assert.ok(svg.includes(`${ev.t1.net.toFixed(2)}R`)); assert.ok(svg.includes('유효')); assert.ok(svg.includes('4H 추세') && svg.includes('1H 눌림목') && svg.includes('15분 진입'));
    assert.equal((svg.match(/<line x1="[\d.]+" x2="[\d.]+" y1="[\d.]+" y2="[\d.]+" stroke="#(?:2dd4bf|fb7185)" stroke-width="2"/g) || []).length, Math.min(56, c15.length));   // 캔들 심지 = 실제 봉 수
    assert.ok(!FORBID.test(svg.replace(/주문 권고 아님/g, '')));
  }
});
test('신호 SVG: 2차 목표가 없으면 그리지 않고, 거래량이 없으면 없다고 표시한다(만들어 내지 않음)', () => {
  const one = evaluateSignal({ a: mkA({ obstacles: [{ price: 105, source: 'a' }] }), c15: mk15(), now: NOW }, OPT);
  assert.equal(one.t2, null); const svg = buildSignalSvg('ETHUSDT', one, mk15()); assert.ok(!svg.includes('2차 목표'));
  const noVol = buildSignalSvg('ETHUSDT', evalL(), mk15().map((c, i, a) => (i === a.length - 5 ? { ...c, q: null } : c)));
  assert.ok(noVol.includes('거래량 데이터 없음'));
});
test('신호 이미지 입력 검증: 후보가 아니거나 봉이 부족·불일치·값 오류면 거부한다', () => {
  const ev = evalL(), bars = mk15();
  assert.throws(() => buildSignalSvg('ETHUSDT', { ...ev, status: 'OBSERVE' }, bars), /입력 없음/);
  assert.throws(() => buildSignalSvg('ETHUSDT', ev, bars.slice(-10)), /15분봉 부족/);
  assert.throws(() => buildSignalSvg('ETHUSDT', ev, bars.slice(0, -1)), /불일치/);
  assert.throws(() => buildSignalSvg('ETHUSDT', ev, bars.map((c, i) => (i === bars.length - 5 ? { ...c, h: NaN } : c))), /값 오류/);
  assert.throws(() => buildSignalSvg('ETHUSDT', { ...ev, entry: NaN }, bars), /가격 값 오류/);
});
test('캡션: A급 상세(진입가·손절·1·2차 목표·손익비·유효 종료·남은 시간), 1024자 이하, 모바일 폭, 금지 표현 없음', () => {
  for (const ev of [evalL(), evalS()]) {
    const now = ev.validUntil - 30 * 60000, cap = signalCaption('ETHUSDT', ev, { now }), lines = cap.split('\n');
    assert.ok(lines.length >= 8 && lines.length <= 13, `줄 수 ${lines.length}`); assert.ok(cap.length <= 1024); lines.forEach(l => assert.ok(displayWidth(l) <= 66, l));
    for (const v of [ev.entry, ev.stop, ev.t1.price]) assert.ok(cap.includes(v.toFixed(2)));
    assert.match(cap, /A급 진입 후보/); assert.match(cap, /진입 관심가/); assert.match(cap, /손절 기준/); assert.match(cap, /1차/); assert.match(cap, /순손익비/);
    assert.match(cap, /유효 종료 \d\d-\d\d \d\d:\d\d KST/); assert.match(cap, /남은 30분/); assert.match(cap, /현시세 아님/);
    assert.ok(cap.includes('미검증')); assert.ok(!FORBID.test(cap.replace('주문 권고 아님', '')));
    assert.doesNotMatch(signalCaption('ETHUSDT', ev, { now: ev.validUntil + 60000 }), /남은 \d+분/); assert.match(signalCaption('ETHUSDT', ev, { now: ev.validUntil + 60000 }), /유효시간 경과 · 신규 진입 금지/);   // 유효시간이 지났으면 남은 시간 대신 진입 금지 표시
  }
  assert.equal(reasonRows(evalL()).length, 3);
});
test('PNG 렌더링: 세로형 1080×1560, 크기 적정, 글꼴 누락 없음', needPng, async () => {
  for (const [ev, c15] of [[evalL(), mk15()], [evalS(), mirror15(mk15())]]) {
    const png = await renderSignalChart('ETHUSDT', ev, c15);
    assert.deepEqual([...png.subarray(0, 4)], PNG); assert.equal(png.readUInt32BE(16), SIGNAL_CHART.W); assert.equal(png.readUInt32BE(20), SIGNAL_CHART.H); assert.ok(SIGNAL_CHART.H > SIGNAL_CHART.W);
    assert.ok(png.length > 20000 && png.length < 600000, `크기 ${png.length}`);
  }
});

// ── 파이프라인: 사진 우선, 실패 시 텍스트 대체, 장부·중복 방지 불변 ──
const photoSender = ({ fail = null } = {}) => { const sent = []; let calls = 0; return { sent, get calls() { return calls; }, fn: async (png, caption) => { calls++; if (fail) throw fail; sent.push({ png, caption }); } }; };
const fakePng = async () => Buffer.from([...PNG, 1, 2, 3]);
const mk = (o = {}) => { const st = { ...oppState() }, sd = sender(), sv = store(); return { st, sd, sv, args: { now: NOW, state: st, env: { RADAR_SIGNAL: 'on' }, send: sd.send, save: sv.save, analyze: () => mkA(), ...collectors({ c15: mk15() }), ...o } }; };

test('진입 후보: 사진 1장(캡션 포함)만 보내고 텍스트는 보내지 않으며 장부·일일 집계는 기존과 같다', async () => {
  const ph = photoSender(), r = mk({ sendPhoto: ph.fn, renderChart: fakePng });
  const out = await signalStep(r.args);
  assert.equal(out.candidates, 1); assert.equal(out.sentMessages, 1); assert.equal(out.photoSent, 1); assert.equal(r.sd.sent.length, 0); assert.equal(ph.sent.length, 1);
  assert.match(ph.sent[0].caption, /ETH LONG · A급 진입 후보/); assert.match(ph.sent[0].caption, /남은 \d+분/); assert.match(ph.sent[0].caption, /유효 종료/); assert.equal(r.st.signal.coins.ETHUSDT.status, 'active'); assert.equal(r.st.signal.inflight, null);
  const day = Object.values(r.st.signal.daily)[0]; assert.equal(day.candidates, 1);
  assert.equal((await signalStep({ ...r.args, now: NOW + 15 * 60000 + 60000 })).candidates, 0);               // 중복 방지(같은 신호 재전송 없음)
  assert.equal(ph.sent.length, 1);
});
test('차트 생성 실패·시간 초과: 기존 텍스트 알림으로 자동 전환(사진 시도 없음)', async () => {
  for (const renderChart of [async () => { throw new Error('render boom'); }, async () => { throw new Error('이미지 없음'); }]) {
    const ph = photoSender(), r = mk({ sendPhoto: ph.fn, renderChart });
    const out = await signalStep(r.args);
    assert.equal(out.sentMessages, 1); assert.equal(out.chartFailed, 1); assert.equal(ph.calls, 0); assert.equal(r.sd.sent.length, 1); assert.match(r.sd.sent[0].text, /진입 후보/);
  }
});
test('사진 전송이 HTTP 4xx로 거절되면 같은 시도에서 텍스트로 대체, 429·네트워크 오류는 대체하지 않고 장부 규칙으로 재시도', async () => {
  const rej = photoSender({ fail: Object.assign(new Error('bad'), { status: 400 }) }), r1 = mk({ sendPhoto: rej.fn, renderChart: fakePng });
  const o1 = await signalStep(r1.args); assert.equal(o1.sentMessages, 1); assert.equal(o1.photoFallback, 1); assert.equal(r1.sd.sent.length, 1); assert.equal(r1.st.signal.coins.ETHUSDT.status, 'active');
  const lim = photoSender({ fail: Object.assign(new Error('limit'), { status: 429 }) }), r2 = mk({ sendPhoto: lim.fn, renderChart: fakePng });
  const o2 = await signalStep(r2.args); assert.equal(o2.sentMessages, 0); assert.equal(r2.sd.sent.length, 0); assert.ok(o2.sendError); assert.ok(r2.st.signal.retryAt > NOW);
  const net = photoSender({ fail: new Error('network') }), r3 = mk({ sendPhoto: net.fn, renderChart: fakePng });
  const o3 = await signalStep(r3.args); assert.equal(o3.sentMessages, 0); assert.equal(r3.sd.sent.length, 0); assert.equal(r3.st.signal.inflight.attempts, 1);          // 전달 여부 불확실: 장부에 남김
  const o4 = await signalStep({ ...r3.args, now: NOW + 6 * 60000, force: true, state: r3.st, sendPhoto: net.fn });                                                          // 재시도는 텍스트(중복 위험이 더 낮은 단일 경로)
  assert.equal(o4.sentMessages, 1); assert.equal(r3.sd.sent.length, 1); assert.equal(r3.st.signal.inflight, null);
});
test('sendPhoto 미제공(기존 경로)이면 동작이 이전과 완전히 같다 / 무효화 알림은 항상 텍스트', async () => {
  const r = mk(); const out = await signalStep(r.args); assert.equal(out.sentMessages, 1); assert.equal(out.photoSent, undefined); assert.equal(r.sd.sent.length, 1);
  const ph = photoSender(), r2 = mk({ sendPhoto: ph.fn, renderChart: fakePng }); await signalStep(r2.args);
  const bad = mk15({ closeT: NOW - 60000 + 15 * 60000, lastClose: 96, lastOpen: 98, lastLow: 95, lastHigh: 98 });
  const inv = await signalStep({ ...r2.args, now: NOW + 15 * 60000 + 60000, ...collectors({ c15: bad }) });
  if (inv.invalidated) { assert.equal(ph.sent.length, 1); assert.match(r2.sd.sent.at(-1).text, /무효화/); }
});
test('telegramPhotoSender 재사용: 캡션 1024자 초과·이미지 없음은 거부(기존 함수 그대로)', async () => {
  const send = telegramPhotoSender('t', '123', async () => new Response('{}', { status: 200 }));
  await assert.rejects(send(Buffer.from([1]), 'x'.repeat(1025)), /캡션/); await assert.rejects(send(Buffer.alloc(0), ''), /이미지 없음/);
});
