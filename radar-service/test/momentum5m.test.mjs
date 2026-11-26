// 5분봉 상승 가속 모멘텀 탐지·우선순위 테스트(합성 데이터).
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMomentum5m, allocateLongSlots, LONG_PRIORITY, momentumMode, momentumMessage, MOM5, M5 } from '../signal/momentum5m.mjs';

// 완만한 상승 + 변동성 노이즈 → 마지막 6봉에서 가속. opts 로 단계별 조건을 깬다.
function series({ n = 100, prevStep = 0.0008, recentStep = 0.0022, vol = 1, noise = 0.005, volLast = 3 } = {}) {
  const bars = []; let p = 100;
  for (let i = 0; i < n; i++) {
    const k = n - 1 - i, step = k < 3 ? recentStep : k < 6 ? prevStep : 0.0006, wob = ((i * 7919) % 11 - 5) / 5 * noise * 0.6;
    const o = p, c = o * (1 + step + wob * (k < 6 ? 0 : 1)), h = Math.max(o, c) * (1 + noise * 0.5), l = Math.min(o, c) * (1 - noise * 0.5);
    bars.push({ t: i * M5, o, c, h, l, q: (k < 3 ? volLast : 1) * 1e5 * vol }); p = c;
  }
  return bars;
}
const NOW = bars => bars.at(-1).t + M5 + 60000;

test('가속·거래대금·추세 조건을 만족하면 신호: 진입·손절·목표·비용 반영 손익비 포함', () => {
  const b = series(), r = evaluateMomentum5m(b, null, NOW(b));
  assert.equal(r.status, 'SIGNAL', r.reason); assert.equal(r.dir, 'LONG'); assert.ok(r.stop < r.entry && r.tp1 > r.entry && r.tp2 > r.tp1);
  assert.ok(r.riskPct >= MOM5.minRiskPct && r.riskPct <= MOM5.maxRiskPct); assert.ok(r.net1 < r.rr1 && r.net1 > 0); assert.equal(r.validUntil - r.asOf, MOM5.validMs);
  assert.ok(r.metrics.volMult >= MOM5.volMult);
});
test('조건별 제외 사유: 가속 없음·거래대금 부족·미확정·오래됨·데이터 부족', () => {
  let b = series({ recentStep: 0.0004, prevStep: 0.0004 }); assert.equal(evaluateMomentum5m(b, null, NOW(b)).reason, 'accel');
  b = series({ volLast: 1 }); assert.equal(evaluateMomentum5m(b, null, NOW(b)).reason, 'volume');
  b = series(); assert.equal(evaluateMomentum5m(b, null, b.at(-1).t + 60000).reason, 'unconfirmed'); assert.equal(evaluateMomentum5m(b, null, NOW(b) + 15 * 60000).reason, 'stale');
  assert.equal(evaluateMomentum5m(b.slice(0, 40), null, NOW(b)).reason, 'data'); assert.equal(evaluateMomentum5m(null, null, 1).reason, 'data');
});
test('과도한 추격 제한: 급등 폭·EMA 이격이 크면 제외(사유 chase-*)', () => {
  const b = series({ recentStep: 0.012, prevStep: 0.004 }), r = evaluateMomentum5m(b, null, NOW(b));
  assert.equal(r.status, 'NONE'); assert.match(r.reason, /^chase-|risk-wide/);
});
test('1시간 추세가 꺾여 있으면 제외', () => {
  const b = series(), c1h = Array.from({ length: 60 }, (_, i) => ({ t: i * 3600000, o: 100 - i * 0.1, c: 100 - i * 0.1, h: 101, l: 99 }));
  assert.equal(evaluateMomentum5m(b, c1h, NOW(b)).reason, 'trend-1h');
});
test('초기 탐색 우선순위 35/35/20/10: 합계 보존·결정적', () => {
  assert.deepEqual(LONG_PRIORITY, { momentum: 0.35, ema: 0.35, accumulation: 0.2, sweep: 0.1 });
  for (const t of [1, 2, 6, 7, 10, 20, 33]) { const a = allocateLongSlots(t); assert.equal(Object.values(a).reduce((x, y) => x + y, 0), t); }
  assert.deepEqual(allocateLongSlots(20), { momentum: 7, ema: 7, accumulation: 4, sweep: 2 }); assert.deepEqual(allocateLongSlots(20), allocateLongSlots(20));
});
test('모드: 기본 experimental, off·on 허용, 오타는 experimental', () => {
  assert.equal(momentumMode({}), 'experimental'); assert.equal(momentumMode({ RADAR_MOMENTUM_5M: 'off' }), 'off'); assert.equal(momentumMode({ RADAR_MOMENTUM_5M: 'ON' }), 'on'); assert.equal(momentumMode({ RADAR_MOMENTUM_5M: 'x' }), 'experimental');
});
test('메시지: 🟡 관심종목 관찰 · 실험(미검증), 진입 검토 문구·버튼 없음, 필수 값 표시', () => {
  const b = series(), s = evaluateMomentum5m(b, null, NOW(b)), m = momentumMessage('ETHUSDT', s);
  assert.match(m.plain, /^🟡 관심종목 관찰 \| ETH LONG · 실험\(미검증\)/); assert.ok(!/진입 검토/.test(m.plain) && !m.markup);
  for (const re of [/전략: 5분봉 상승 가속 모멘텀/, /손절 기준/, /1\.50R/, /2\.50R/, /비용 반영 손익비/, /참고 유효/, /추격 금지/]) assert.match(m.plain, re);
});

// ── signalStep 통합: 실험 관찰 채널(진입 기록 없음) ──
import { signalStep } from '../signal/step.mjs';
import { NOW as FNOW, mkA, mk15, sender, store, collectors, oppState } from './signal-fixture.mjs';
globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
function runMom(env, c5) {
  const st = { ...oppState() }, sd = sender(), sv = store(), calls = [];
  const col = collectors({ c15: mk15() }), hour = col.collectHour;
  const up1h = Array.from({ length: 120 }, (_, i) => { const c = 90 + i * 0.1; return { t: FNOW - (120 - i) * 3600000, o: c - 0.05, h: c + 0.2, l: c - 0.2, c, q: 1e6 }; });
  col.collectHour = async o => { const r = await hour(o); for (const k of Object.keys(r.coins)) r.coins[k].c1h = up1h; return r; };    // 1H 상승 추세 종목만 5분봉 평가 대상
  const collectM5 = async ({ ids }) => { calls.push(ids); return { calls: ids.length, stopped: null, coins: Object.fromEntries(ids.map(id => [id, { status: 'ok', c5 }])) }; };
  return { st, sd, calls, args: { now: FNOW, state: st, env: { RADAR_SIGNAL: 'on', ...env }, send: sd.send, save: sv.save, analyze: () => mkA(), ...col, collectM5 } };
}
test('통합: 5분봉 신호는 🟡 실험 관찰(진입 기록 버튼 없음)로 전송되고 쿨다운 상태가 저장된다, off 면 5분봉 요청도 없다', async () => {
  const b = series(), shift = FNOW - (b.at(-1).t + M5 + 60000), c5 = b.map(x => ({ ...x, t: x.t + shift }));
  const r = runMom({}, c5); const out = await signalStep(r.args);
  assert.ok(out.momentum.scanned >= 1, JSON.stringify(out.momentum)); assert.equal(out.momentum.mode, 'experimental'); assert.equal(out.momentum.promotion, 'blocked-until-validated'); assert.equal(out.momentum.signals, 1);
  const m = r.sd.sent.find(x => /5분봉 상승 가속/.test(x.text)); assert.ok(m, '메시지 전송'); assert.match(m.text, /실험\(미검증\)/); assert.ok(!m.opt?.markup); assert.ok(r.st.signal.momentum.sent.ETHUSDT);
  const again = await signalStep({ ...r.args, now: FNOW + 5 * 60000 }); assert.equal(r.sd.sent.filter(x => /5분봉 상승 가속/.test(x.text)).length, 1, '쿨다운 3시간');
  const off = runMom({ RADAR_MOMENTUM_5M: 'off' }, c5); const o2 = await signalStep(off.args); assert.equal(off.calls.length, 0); assert.equal(o2.momentum.scanned, 0);
});
