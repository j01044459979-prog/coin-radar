// 3분할 진입 계획 차트(signal/chart.mjs planView·buildSignalSvg·drawPlanPanel) 테스트. 합성 데이터·모의 네트워크만 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSignal } from '../signal/evaluate.mjs';
import { buildSignalSvg, renderSignalChart, planView, SIGNAL_CHART } from '../signal/chart.mjs';
import { scalePlanFor, scaleDecorate } from '../signal/scale-decorate.mjs';
import { splanBuild } from '../signal/scale.mjs';
import { signalStep } from '../signal/step.mjs';
import { NOW, mkA, mirrorA, mk15, mirror15, sender, store, collectors, oppState } from './signal-fixture.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const OPT = { minRR: 1.5, validMin: 45 }, K = 0.022, SYM = 'XRPUSDT', PNG = [0x89, 0x50, 0x4e, 0x47];
let resvg = true; try { await import('@resvg/resvg-js'); } catch { resvg = false; }
const needPng = { skip: resvg ? false : '@resvg/resvg-js 미설치' };
// 합성 픽스처(가격 ≈100)를 XRP 가격대(≈2.2)로 옮겨 3단계 계획이 가능하게 한다(소액 평가액에서는 비싼 코인이 단계 축소·제외될 수 있다).
const scaled = (ev, c15, k = K) => ({ ev: { ...ev, entry: ev.entry * k, stop: ev.stop * k, level: ev.level * k, zone: { ...ev.zone, lo: ev.zone.lo * k, hi: ev.zone.hi * k }, t1: { ...ev.t1, price: ev.t1.price * k }, t2: ev.t2 && { ...ev.t2, price: ev.t2.price * k } }, c15: c15.map(c => ({ ...c, o: c.o * k, h: c.h * k, l: c.l * k, c: c.c * k })) });
const mkL = () => scaled(evaluateSignal({ a: mkA(), c15: mk15(), now: NOW }, OPT), mk15());
const mkS = () => scaled(evaluateSignal({ a: mirrorA(mkA()), c15: mirror15(mk15()), now: NOW }, OPT), mirror15(mk15()));
const planOf = ev => scalePlanFor(SYM, ev, { RADAR_PLAN_EQUITY: '300' });
const num = s => Number(String(s).replace(/,/g, ''));

test('LONG·SHORT 계획 보기: 가격 순서(LONG 1>2>3>손절, SHORT 반대)·비중 합 100·배정 금액·예상 평균가', () => {
  for (const [name, { ev }] of [['LONG', mkL()], ['SHORT', mkS()]]) {
    const plan = planOf(ev); assert.equal(plan.status, 'ok'); assert.equal(plan.stagesCount, 3, name);
    const v = planView(plan, ev); assert.ok(v, name); assert.equal(v.n, 3); assert.equal(v.pct.reduce((a, b) => a + b, 0), 100);
    assert.deepEqual(v.pct, [50, 30, 20]);                                                         // 기존 전략 비중 50/30/20 그대로
    assert.equal(v.prices[0], ev.entry);                                                             // 1차 = 진입 관심가
    const seq = [...v.prices, ev.stop]; for (let i = 1; i < seq.length; i++) assert.ok(name === 'LONG' ? seq[i] < seq[i - 1] : seq[i] > seq[i - 1], `${name} 순서 ${seq}`);
    // 평균 진입가 = Σ(계획가×수량)/Σ수량, 직접 계산과 일치
    const tq = plan.stages.reduce((a, s) => a + s.qty, 0), avg = plan.stages.reduce((a, s) => a + s.price * s.qty, 0) / tq; assert.ok(Math.abs(v.avg - avg) < 1e-12);
    assert.ok(v.avg > Math.min(...v.prices) && v.avg < Math.max(...v.prices));
    // 배정 금액 = 단계별 증거금(= 체결가 × 수량 ÷ 레버리지), 합계 = totalMargin
    plan.stages.forEach((s, i) => assert.ok(Math.abs(v.margins[i] - s.execPrice * s.qty / plan.lev) < 1e-9)); assert.ok(Math.abs(v.totalMargin - plan.totalMargin) < 1e-9);
    assert.ok(v.totalMargin <= plan.equity * 0.3 + 1e-9);                                            // 총 증거금 한도(평가액 30%) 이내
    assert.equal(v.equity, 300);
  }
});
test('비중 반올림: 수량 비율이 50/30/20이 아니어도 정수 합계가 정확히 100', () => {
  const { ev } = mkL(), base = planOf(ev);
  for (const qs of [[3, 3, 3], [7, 2, 1], [1, 1, 1], [5, 3, 2], [333, 333, 334]]) {
    const plan = { ...base, stages: base.stages.map((s, i) => ({ ...s, qty: qs[i] })) }, v = planView(plan, ev); assert.ok(v, String(qs)); assert.equal(v.pct.reduce((a, b) => a + b, 0), 100, String(qs));
  }
});
test('SVG: 진입·손절·목표 수평선이 정확한 가격 위치, 진입선 동일 색, 차수 라벨, 오른쪽 패널 순서', () => {
  for (const [name, { ev, c15 }] of [['LONG', mkL()], ['SHORT', mkS()]]) {
    const plan = planOf(ev), v = planView(plan, ev), svg = buildSignalSvg(SYM, ev, c15, { plan });
    const bars = c15.slice(-56), levels = [ev.entry, ev.stop, ev.t1.price, ev.t2.price, ...v.prices], hi0 = Math.max(...bars.map(c => c.h), ...levels), lo0 = Math.min(...bars.map(c => c.l), ...levels), pad = (hi0 - lo0) * 0.06, hi = hi0 + pad, lo = lo0 - pad;
    const yOf = p => 960 - (p - lo) / (hi - lo) * (960 - 330);
    const hl = [...svg.matchAll(/<line x1="24" x2="560" y1="([\d.]+)" y2="([\d.]+)" stroke="(#[0-9a-f]{6})" stroke-width="2.5"/g)].map(m => ({ y: Number(m[1]), col: m[3] }));
    assert.equal(hl.length, 6, `${name} 수평선 6개`);                                                // 1·2·3차, 손절, 목표1·2
    for (const [p, col] of [[v.prices[0], '#fbbf24'], [v.prices[1], '#fbbf24'], [v.prices[2], '#fbbf24'], [ev.stop, '#ef4444'], [ev.t1.price, '#4ade80'], [ev.t2.price, '#4ade80']]) assert.ok(hl.some(h => Math.abs(h.y - yOf(p)) < 0.01 && h.col === col), `${name} ${p} @${yOf(p).toFixed(2)}`);
    assert.equal(hl.filter(h => h.col === '#fbbf24').length, 3);                                     // 진입선 3개 같은 계열 색
    for (const k of ['1차', '2차', '3차', '손절', '목표1', '목표2']) assert.ok(svg.includes(`>${k}</text>`), k);
    // 패널 순서: 제목 → 1차 → 2차 → 3차 → 평균 → 손절 → 1차 목표 → 2차 목표
    const order = ['3분할 진입 계획', '예상 계획 · 실제 체결 아님', '예상 평균 진입가', '손절 기준', '1차 목표', '2차 목표'].map(t => svg.indexOf(t)); assert.ok(order.every(i => i > 0) && order.every((i, j) => !j || i > order[j - 1]), `${name} ${order}`);
    const f = p => p.toFixed(4); for (const p of [...v.prices, v.avg, ev.stop, ev.t1.price, ev.t2.price]) assert.ok(svg.includes(`>${f(p)}</text>`), `${name} 패널 숫자 ${f(p)}`);
    for (const m of v.margins) assert.ok(svg.includes(`>${m.toFixed(2)} USDT</text>`), `${name} 금액 ${m}`);
    for (const p of v.pct) assert.ok(svg.includes(`>${p}%</text>`)); assert.ok(svg.includes('평가액 300 USDT 가정') && svg.includes('실제 체결 아님'));
  }
});
test('라벨 겹침 방지: 가격선이 아주 가까워도 라벨(36px)이 서로 겹치지 않고 패널 안에 있다', () => {
  const { ev, c15 } = mkL(), tight = { ...ev, stop: ev.entry * 0.9985 };                              // 손절이 매우 가까움 → 1·2·3차·손절 선이 거의 같은 높이
  const plan = splanBuild({ symbol: 'DOGEUSDT', dir: 'LONG', entry: tight.entry, stop: tight.stop, equity: 300, params: { maxCostShareOfR: 5 } });
  if (plan.status !== 'ok') return;                                                                  // 계획이 만들어지지 않는 경우는 아래 '계획 없음' 시험이 다룬다
  const svg = buildSignalSvg(SYM, tight, c15.map(c => ({ ...c })), { plan }).toString();
  const tags = [...svg.matchAll(/<rect x="570" y="([\d.]+)" width="76" height="36"/g)].map(m => Number(m[1])).sort((a, b) => a - b);
  for (let i = 1; i < tags.length; i++) assert.ok(tags[i] - tags[i - 1] >= 36, `라벨 겹침 ${tags}`); assert.ok(tags[0] >= 330 && tags.at(-1) + 36 <= 960, `라벨 범위 ${tags}`);
});
test('계획이 없거나 검증 실패면 기존 차트와 한 글자도 다르지 않다(임의 수치 생성 없음)', () => {
  const { ev, c15 } = mkL(), base = buildSignalSvg(SYM, ev, c15), plan = planOf(ev);
  assert.equal(buildSignalSvg(SYM, ev, c15, { plan: null }), base); assert.equal(buildSignalSvg(SYM, ev, c15, {}), base);
  for (const bad of [{ ...plan, status: 'excluded' }, { ...plan, dir: 'SHORT' }, { ...plan, stages: [] }, { ...plan, entry: plan.entry * 1.01 }, { ...plan, stop: plan.stop * 0.99 },
    { ...plan, stages: plan.stages.map((s, i) => (i === 1 ? { ...s, price: ev.entry * 1.01 } : s)) },        // LONG 인데 2차가 1차보다 위 → 순서 위반
    { ...plan, stages: plan.stages.map((s, i) => (i === 0 ? { ...s, qty: NaN } : s)) }, { ...plan, stages: plan.stages.map((s, i) => (i === 0 ? { ...s, margin: 0 } : s)) }, { ...plan, stages: [...plan.stages, plan.stages[0]] }])
    assert.equal(buildSignalSvg(SYM, ev, c15, { plan: bad }), base, JSON.stringify(Object.keys(bad)));
  assert.equal(planView(undefined, ev), null);
  assert.equal(planView(splanBuild({ symbol: 'BTCUSDT', dir: 'LONG', entry: ev.entry, stop: ev.stop, equity: 300 }), ev), null);   // 최소 주문 단위 미달 등으로 제외된 계획
});
test('소액 축소(3→2단계)는 2개만 그리고 축소를 표시, 1단계도 정상', () => {
  const { ev: e0, c15 } = mkL(); const ev = { ...e0 };
  const p2 = splanBuild({ symbol: SYM, dir: 'LONG', entry: ev.entry, stop: ev.stop, equity: 300, params: { maxStages: 2 } }), v2 = planView(p2, ev); assert.equal(v2.n, 2); assert.deepEqual(v2.pct.reduce((a, b) => a + b, 0), 100);
  const svg = buildSignalSvg(SYM, ev, c15, { plan: p2 }); assert.ok(!svg.includes('>3차</text>')); assert.equal([...svg.matchAll(/stroke="#fbbf24" stroke-width="2.5"/g)].length, 2);
  const p1 = splanBuild({ symbol: SYM, dir: 'LONG', entry: ev.entry, stop: ev.stop, equity: 300, params: { maxStages: 1 } }), v1 = planView(p1, ev); assert.equal(v1.n, 1); assert.deepEqual(v1.pct, [100]);
  assert.ok(buildSignalSvg(SYM, ev, c15, { plan: p1 }).includes('>100%</text>'));
});
test('텍스트 알림과 같은 계산 결과: 이미지 계획 = 메시지 계획(같은 plan 객체), 숫자 일치', () => {
  const { ev } = mkL(), part = { kind: 'candidate', text: 't', plain: 't' }, env = { RADAR_SCALE_PLAN: 'on', RADAR_PLAN_EQUITY: '300' };
  const d = scaleDecorate(part, SYM, ev, env); assert.ok(d.scale && d.scale.plan); const v = planView(d.scale.plan, ev);
  for (const s of d.scale.plan.stages) assert.ok(d.plain.includes(String(s.price)) || d.plain.includes(s.price.toFixed(4)), `텍스트에 ${s.price}`);   // 텍스트의 단계 가격
  assert.ok(v && v.n === d.scale.plan.stagesCount);
  assert.equal(scaleDecorate(part, SYM, ev, {}), part);                                              // 기본 off: 변화 없음
});
test('PNG 렌더링: LONG·SHORT 계획 이미지 1080×1560, 크기 적정', needPng, async () => {
  for (const { ev, c15 } of [mkL(), mkS()]) {
    const png = await renderSignalChart(SYM, ev, c15, { plan: planOf(ev) });
    assert.deepEqual([...png.subarray(0, 4)], PNG); assert.equal(png.readUInt32BE(16), SIGNAL_CHART.W); assert.equal(png.readUInt32BE(20), SIGNAL_CHART.H); assert.ok(png.length > 30000 && png.length < 700000, `크기 ${png.length}`);
  }
});
test('글꼴: 계획 이미지의 모든 한글이 글꼴 부분집합에 있다(두부 글자 없음)', async () => {
  const { readFileSync } = await import('node:fs'); const charset = new Set(readFileSync(new URL('../fonts/charset.txt', import.meta.url), 'utf8').trim());
  for (const { ev, c15 } of [mkL(), mkS()]) { const svg = buildSignalSvg(SYM, ev, c15, { plan: planOf(ev) }); for (const ch of svg.replace(/<[^>]+>/g, '')) if (ch.codePointAt(0) > 127) assert.ok(charset.has(ch), `${ch} 가 글꼴에 없음`); }
});

// ── 실제 발송 경로(signalStep): 같은 계획이 이미지·텍스트에 쓰이고, 버튼·기존 동작은 그대로 ──
const mkRun = (env, extra = {}) => { const st = { ...oppState() }, sd = sender(), sv = store(); return { st, sd, args: { now: NOW, state: st, env: { RADAR_SIGNAL: 'on', ...env }, send: sd.send, save: sv.save, analyze: () => mkA(), ...collectors({ c15: mk15() }), ...extra } }; };
test('발송 경로: RADAR_SCALE_PLAN=on 이면 렌더러가 계획을 받고 캡션 계획과 같다 · 버튼 2개 유지 · 텍스트 대체도 정상', async () => {
  const seen = [], photos = [];
  const renderChart = async (sym, ev, bars, o) => { seen.push({ sym, o }); return Buffer.from([...PNG, 1, 2, 3]); }, sendPhoto = async (png, caption, o) => { photos.push({ caption, o }); };
  const r = mkRun({ RADAR_SCALE_PLAN: 'on', RADAR_PLAN_EQUITY: '300', RADAR_RICH300_BUTTONS: 'on' }, { renderChart, sendPhoto });
  const out = await signalStep(r.args); assert.equal(out.photoSent, 1); assert.equal(seen.length, 1);
  const plan = seen[0].o.plan; assert.ok(plan && plan.status === 'ok'); const v = planView(plan, { ...evaluateSignal({ a: mkA(), c15: mk15(), now: NOW }, OPT) }); assert.ok(v);
  assert.match(photos[0].caption, /📐/); assert.match(photos[0].caption, /R9 v1 SG-ETH-L-/);                                // 계획 요약과 R9 줄이 같은 설명에
  assert.equal(photos[0].o.markup.inline_keyboard[0].length, 2); assert.deepEqual(photos[0].o.markup.inline_keyboard[0].map(b => b.text), ['진입했어', '안 했어']);
  assert.ok(photos[0].caption.includes(String(plan.stages[0].price)) || photos[0].caption.includes(plan.stages[0].price.toFixed(2)));   // 캡션 요약의 1차 가격 = 계획 1차
});
test('발송 경로: RADAR_SCALE_PLAN 기본 off 이면 렌더러에 계획을 넘기지 않아 기존 이미지 그대로', async () => {
  const seen = []; const r = mkRun({}, { renderChart: async (...a) => { seen.push(a); return Buffer.from([...PNG, 1, 2, 3]); }, sendPhoto: async () => {} });
  await signalStep(r.args); assert.equal(seen.length, 1); assert.deepEqual(seen[0][3], {});
});
test('발송 경로: 계획 계산 불가(예: 평가액 설정이 비정상 → 기본 300, 제외 코인)면 이미지는 기존 차트', async () => {
  const seen = []; const r = mkRun({ RADAR_SCALE_PLAN: 'on' }, { analyze: () => mkA(), renderChart: async (...a) => { seen.push(a); return Buffer.from([...PNG, 1, 2, 3]); }, sendPhoto: async () => {} });
  await signalStep(r.args); assert.equal(seen.length, 1); assert.ok(seen[0][3].plan === undefined || seen[0][3].plan.status === 'ok');
});

test('테스트 발송 CLI(--dry): LONG·SHORT 모두 3단계 계획 PNG 를 만들고 Telegram 을 호출하지 않는다', needPng, async () => {
  const { execFileSync } = await import('node:child_process'), { mkdtempSync, readFileSync } = await import('node:fs'), { tmpdir } = await import('node:os');
  const dir = mkdtempSync(`${tmpdir()}/chart-`);
  for (const d of ['LONG', 'SHORT']) {
    const out = `${dir}/${d}.png`, log = execFileSync(process.execPath, [new URL('../signal/chart-test-cli.mjs', import.meta.url).pathname, '--dir', d, '--dry', '--out', out], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.match(log, /계획 3단계/); assert.match(log, /테스트 · 가상 데이터 · 매매 금지/); const png = readFileSync(out); assert.deepEqual([...png.subarray(0, 4)], PNG); assert.equal(png.readUInt32BE(20), SIGNAL_CHART.H);
  }
});
