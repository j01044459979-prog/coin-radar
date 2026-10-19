// PR #27 최종 안정성 검증: 보류 알림 재평가 · 시간 초과 경계 · 첫 실행 기준선 저장 실패 · 크래시/재시작 모델.
// 모든 Telegram·OKX 호출은 모의 함수이며, 실제 네트워크는 쓰지 않는다(전역 fetch를 막아 둔다).
import test from 'node:test';
import assert from 'node:assert/strict';
import { H1 } from '../opportunity/indicators.mjs';
import { opportunityStep, runOpportunitySafe, normalize } from '../opportunity/step.mjs';
import { runAfterCycle } from '../opportunity/integrate.mjs';
import { collectOpportunity } from '../opportunity/collect.mjs';
import { ETH, SOL, BTC, ethStage, IDX, NOW, okxFake, mkSend, env, mixed, fx, names, rebase, aligned, dayOf, thisHour, at } from './opportunity-fixture.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };   // 주입하지 않은 호출이 있으면 즉시 실패

// ── 크래시/재시작 모델 ──
// 저장소 = 파일 한 개(원자적 rename 가정). 프로세스(proc)는 파일에서 상태를 읽고 시작하며, save가 예외를 던지면 파일은 바뀌지 않는다(크래시/디스크 오류).
function durable(initial = {}) {
  let file = JSON.stringify(initial); const log = [];
  return {
    get snapshot() { return JSON.parse(file); },
    proc({ fail = null } = {}) { const state = JSON.parse(file); let n = 0; return { state, save: async s => { n++; if (fail && fail(s, n)) { log.push(['fail', n]); throw new Error('disk full'); } file = JSON.stringify(s); log.push(['ok', n]); } }; },
    log,
  };
}
const FIRST = { RADAR_OPPORTUNITY_FIRST_RUN: 'summary' };
const set = (j, extra = {}) => ({ 'BTC-USDT-SWAP': BTC.slice(0, j + 1), 'ETH-USDT-SWAP': ETH.slice(0, j + 1), 'SOL-USDT-SWAP': undefined, ...extra });
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const nowAt = j => ETH[j].t + H1 + 30000;
const common = (extra = {}) => ({ gapMs: 0, ...extra });
async function runProc(store, { series, now, send, fail, envExtra = {}, mode = 'on', ...rest }) {
  const p = store.proc({ fail }), r = await runOpportunitySafe({ env: env(mode, envExtra), state: p.state, save: p.save, send, now, fetcher: fx(clean(series)), gapMs: 0, ...rest });
  return { r, state: p.state };
}

test('[결함 수정 확인 R1] 기준선 요약: 상태를 저장할 수 없는 환경에서는 요약을 보내지 않는다(재시작마다 반복 전송 방지)', async () => {
  const store = durable({}), sent = [], series = mixed({ r: 3, w: 6 });
  for (let k = 0; k < 4; k++) await runProc(store, { series, now: NOW(IDX), send: mkSend(sent), fail: () => true, envExtra: { ...FIRST, RADAR_OPPORTUNITY_TOP: '30' } });   // 재시작 4회, 저장은 항상 실패
  assert.equal(sent.length, 0, `저장 불가 상태에서 ${sent.length}건 전송`);
  assert.deepEqual(store.snapshot, {});
});
test('[결함 수정 확인 R7] 정기 레이더가 오래 걸려 작업 시간이 거의 남지 않았으면 기회 레이더는 건너뛴다(워크플로 8분 제한 보호)', async () => {
  const lines = [], calls = []; const fetcher = async url => { calls.push(url); throw new Error('network'); };
  const r = await runAfterCycle({ state: {}, save: async () => {}, send: async () => {}, env: env('on'), out: l => lines.push(l), now: NOW(IDX), fetcher, elapsedMs: 6 * 60 * 1000 });
  assert.equal(calls.length, 0, '시간 예산이 없는데 수집을 시작함'); assert.equal(r.skipped, 'time-budget');
});
test('[결함 수정 확인 R8] 첫 실행 중 확정 대기(pending)였던 종목이 뒤늦게 개별 알림으로 새지 않는다', async () => {
  const store = durable({}), sent = [], ex = { ...FIRST, RADAR_OPPORTUNITY_TOP: '30' };
  const late = { 'BTC-USDT-SWAP': BTC.slice(0, IDX + 1), 'ETH-USDT-SWAP': ETH.slice(0, IDX + 1), 'SOL-USDT-SWAP': SOL.slice(0, IDX + 1) };
  // 1차: SOL만 직전 봉이 아직 확정되지 않음(pending)
  const f1 = okxFake({ cursor: id => (id === 'SOL-USDT-SWAP' ? IDX - 1 : IDX), series: late });
  const p1 = store.proc(); await runOpportunitySafe({ env: env('on', ex), state: p1.state, save: p1.save, send: mkSend(sent), now: NOW(IDX), fetcher: f1, gapMs: 0 });
  const p2 = store.proc(); await runOpportunitySafe({ env: env('on', ex), state: p2.state, save: p2.save, send: mkSend(sent), now: NOW(IDX) + 300000, fetcher: okxFake({ cursor: () => IDX, series: late }), gapMs: 0 });
  assert.deepEqual(names(sent), [], `기준선 중 대기였던 종목이 개별 알림됨: ${names(sent)}`);
  assert.ok(store.snapshot.opportunity.coins.SOLUSDT, 'SOL이 기준선에 기록되지 않음');
});
test('[결함 수정 확인 R11] 알림 전송 뒤 저장이 계속 실패해도 같은 알림이 재시작마다 무한 반복되지 않는다(메시지당 최대 2회)', async () => {
  const store = durable({}), sent = [], series = mixed({ r: 3 }), ex = { RADAR_OPPORTUNITY_TOP: '30' };
  for (let k = 0; k < 6; k++) await runProc(store, { series, now: NOW(IDX) + k * 300000, send: mkSend(sent), fail: s => Object.values(s.opportunity.coins).some(c => c.alertedStage > 0) && !s.opportunity.inflight, envExtra: ex });   // 재시작 6회: '전송 완료'를 기록하는 저장만 항상 실패
  assert.ok(sent.length <= 2, `같은 알림 ${sent.length}회 전송`);
});

// ════════ 검증 시나리오 ════════
const shift = (series, bars) => Object.fromEntries(Object.entries(series).map(([k, v]) => [k, v.map(x => ({ ...x, t: x.t + bars * H1 }))]));   // 4의 배수 봉만큼 시간 이동(4시간 정렬 유지)
const hourOf = j => Math.floor(nowAt(j) / H1);
const base0 = () => normalize({ v: 1, coins: {} });
const exhausted = (hour, coins = 12, ready = 3) => ({ opportunity: { ...base0(), baselineDone: true, sent: { hour, coins, ready, messages: 4 } } });
const clockOf = () => { const c = { t: 0 }; const fn = () => c.t; fn.expire = (ms = 1e9) => { c.t += ms; }; return fn; };
const ex30 = { RADAR_OPPORTUNITY_TOP: '30' };
const texts = sent => sent.map(m => m.text).join('\n');

// ── 1. 보류된 알림 재평가 ──
test('[보류 1] 한 시간에 후보가 12개를 넘으면 우선순위대로 12개만 보내고, 보류분은 상태를 바꾸지 않았다가 다음 시간대 새 확정봉으로 한 번씩만 보낸다', async () => {
  const store = durable({}), sent = [], s0 = mixed({ r: 3, w: 14 });
  const a = await runProc(store, { series: s0, now: NOW(IDX), send: mkSend(sent), envExtra: ex30 });
  assert.equal(names(sent).length, 12); assert.equal(a.r.held, 5); assert.equal(a.state.opportunity.scanHour, thisHour);
  const heldNames = Object.keys(s0).filter(k => k.startsWith('W')).map(k => k.replace('-USDT-SWAP', 'USDT')).filter(sym => !a.state.opportunity.coins[sym]);
  assert.equal(heldNames.length, 5, '보류된 코인은 상태에 기록되지 않아야 함');                                   // 알린 적이 없으므로 '알림 완료'로 표시되면 안 된다
  const before = names(sent).length;
  const b = await runProc(store, { series: shift(s0, 4), now: NOW(IDX) + 4 * H1, send: mkSend(sent), envExtra: ex30 });     // 다음 시간대(새 확정봉)
  const all = names(sent); assert.equal(all.length, 17); assert.equal(new Set(all).size, 17, '같은 코인이 두 번 알려짐'); assert.equal(all.length - before, 5);
  assert.equal(b.r.held, 0); assert.equal(b.state.opportunity.sent.hour, hourOf(IDX) + 4);
});
test('[보류 2] 일일 상한에 도달하면 모두 보류하고, 날짜가 바뀐 뒤 새 확정봉으로 다시 평가해 한 번씩 보낸다', async () => {
  const store = durable({}), sent = [], s0 = mixed({ r: 4 }), ex = { ...ex30, RADAR_OPPORTUNITY_MAX_PER_DAY: '2' };
  const a = await runProc(store, { series: s0, now: NOW(IDX), send: mkSend(sent), envExtra: ex });
  assert.equal(names(sent).length, 2); assert.equal(a.r.held, 2); const key = dayOf(NOW(IDX)); assert.deepEqual([a.state.opportunity.daily[key].coins, a.state.opportunity.daily[key].held], [2, 2]);
  const same = await runProc(store, { series: shift(s0, 4), now: NOW(IDX) + 4 * H1, send: mkSend(sent), envExtra: ex });       // 같은 날 다음 시간대: 상한 소진 → 계속 보류
  assert.equal(names(sent).length, 2); assert.equal(same.r.held, 2);
  const next = await runProc(store, { series: shift(s0, 24), now: NOW(IDX) + 24 * H1, send: mkSend(sent), envExtra: ex });     // 다음 UTC 날짜
  assert.notEqual(dayOf(NOW(IDX) + 24 * H1), key); const all = names(sent); assert.equal(all.length, 4); assert.equal(new Set(all).size, 4); assert.equal(next.state.opportunity.daily[dayOf(NOW(IDX) + 24 * H1)].coins, 2);
});
test('[보류 3] 2단계 알림이 보류된 사이 3단계로 올라가면 늦은 2단계 알림 없이 3단계(조건 충족)로 한 번만 알린다', async () => {
  const j = 1621, k = 1; assert.equal(at(ETH, j).stage, 2); assert.equal(at(ETH, j + k).stage, 3);
  const store = durable(exhausted(hourOf(j))), sent = [];
  const a = await runProc(store, { series: set(j), now: nowAt(j), send: mkSend(sent) });
  assert.equal(sent.length, 0); assert.equal(a.r.held, 1); assert.equal(a.state.opportunity.coins.ETHUSDT, undefined);
  const b = await runProc(store, { series: set(j + k), now: nowAt(j + k), send: mkSend(sent) });
  assert.equal(sent.length, 1); assert.match(texts(sent), /ETH/); assert.match(texts(sent), /3단계 · 조건 충족[^\n]*\(새 관찰\)/); assert.ok(!/2단계 · 눌림 진행 중/.test(texts(sent))); assert.equal(b.state.opportunity.coins.ETHUSDT.alertedStage, 3);
});
test('[보류 4] 보류 중이던 종목이 대기로 돌아가면 뒤늦게 보내지 않는다', async () => {
  const j = 1148, k = 3; assert.equal(at(ETH, j).stage, 2); assert.equal(at(ETH, j + k).stage, 0);
  const store = durable(exhausted(hourOf(j))), sent = [];
  await runProc(store, { series: set(j), now: nowAt(j), send: mkSend(sent) }); assert.equal(sent.length, 0);
  const b = await runProc(store, { series: set(j + k), now: nowAt(j + k), send: mkSend(sent) });
  assert.equal(sent.length, 0); assert.ok((b.state.opportunity.coins.ETHUSDT?.alertedStage ?? 0) === 0);
});
function crashed(extra) { const last = ETH[IDX], bar = (n, c) => ({ t: last.t + n * H1, o: n === 1 ? last.c : c + 1e-9, h: Math.max(last.c, c) * 1.0005, l: c * 0.999, c, q: last.q }); return extra(bar, last); }
test('[보류 5] 무효화 해제가 보류되는 사이: 가격이 계속 무효화 아래면 다음 시간에 (여전히 유효하므로) 한 번 알리고, 회복했으면 뒤늦게 보내지 않는다', async () => {
  const store = durable({}), sent = [], base = { ...set(IDX) };
  await runProc(store, { series: base, now: NOW(IDX), send: mkSend(sent) });                                      // 시작: ETH 조건 충족 알림
  const inv = store.snapshot.opportunity.coins.ETHUSDT.invalidation; assert.ok(inv > 0 && store.snapshot.opportunity.coins.ETHUSDT.alertedStage === 3);
  const mk = (...closes) => { const eth = [...ETH.slice(0, IDX + 1)]; closes.forEach((c, n) => { const last = eth.at(-1); eth.push({ t: last.t + H1, o: last.c, h: Math.max(last.c, c) * 1.0005, l: Math.min(last.c, c) * 0.999, c, q: last.q }); }); return { 'BTC-USDT-SWAP': BTC.slice(0, IDX + 1 + closes.length), 'ETH-USDT-SWAP': eth }; };
  const snap = store.snapshot; const A = durable(snap), B = durable(snap), sa = [], sb = [];
  const sentOf = (st, hour) => { const s = JSON.parse(JSON.stringify(st)); s.opportunity.sent = { hour, coins: 12, ready: 3, messages: 4 }; return s; };
  const crash = inv * 0.99, recover = ETH[IDX].c;
  for (const [store2, out, closes] of [[A, sa, [crash, crash * 0.995]], [B, sb, [crash, recover]]]) {
    store2.__seed = sentOf(store2.snapshot, hourOf(IDX + 1)); const d = durable(store2.__seed);
    const r1 = await runProc(d, { series: mk(closes[0]), now: nowAt(IDX + 1), send: mkSend(out) });             // 무효화 이탈이 상한 때문에 보류됨
    assert.equal(out.length, 0); assert.equal(r1.r.held, 1);
    await runProc(d, { series: mk(closes[0], closes[1]), now: nowAt(IDX + 2), send: mkSend(out) });             // 다음 시간
    store2.final = d.snapshot;
  }
  assert.equal(sa.length, 1); assert.match(texts(sa), /무효화 이탈로 해제/); assert.equal(A.final?.opportunity.coins.ETHUSDT.stage, 0);
  assert.equal(sb.length, 0, '회복했는데 낡은 해제 알림이 나감');
});
test('[보류 6] 같은 확정봉을 다시 처리해도 중복 전송이 없고, 보류 상태에서 강제로 다시 돌려도 상한을 넘지 않는다', async () => {
  const store = durable({}), sent = [], s0 = mixed({ r: 2, w: 14 });
  await runProc(store, { series: s0, now: NOW(IDX), send: mkSend(sent), envExtra: ex30 });
  const n = sent.length; assert.equal(names(sent).length, 11);                                       // 조건 충족 2 + 눌림 9(일반 칸). 예비 3칸 중 1칸은 쓰이지 않고 남는다
  for (let k = 1; k <= 3; k++) await runProc(store, { series: s0, now: NOW(IDX) + k * 60000, send: mkSend(sent), envExtra: ex30, force: true });   // 같은 봉 강제 재실행 3회
  assert.equal(sent.length, n); assert.equal(new Set(names(sent)).size, 11);
});
test('[보류 7] 3단계용 예비 칸이 실제로 유지된다 — 같은 시간 안에 눌림 알림이 일반 칸(9)을 다 써도 뒤늦게 나온 조건 충족은 보낸다', async () => {
  const store = durable({}), sent = [];
  await runProc(store, { series: mixed({ w: 12 }), now: NOW(IDX), send: mkSend(sent), envExtra: ex30 });
  assert.equal(names(sent).length, 9);
  const b = await runProc(store, { series: mixed({ w: 12, r: 2 }), now: NOW(IDX) + 120000, send: mkSend(sent), envExtra: ex30, force: true });   // 같은 시간대 재점검에서 조건 충족 2종목 등장
  const all = names(sent); assert.equal(all.filter(n => n.startsWith('R')).length, 2); assert.equal(all.filter(n => n.startsWith('W')).length, 9); assert.equal(b.state.opportunity.sent.coins, 11);
  const c = await runProc(store, { series: mixed({ w: 12, r: 5 }), now: NOW(IDX) + 240000, send: mkSend(sent), envExtra: ex30, force: true });   // 상한 12: 남은 1칸만 조건 충족에 사용
  assert.equal(names(sent).filter(n => n.startsWith('R')).length, 3); assert.equal(c.state.opportunity.sent.coins, 12);
});

// ── 2. 시간 초과 직전 전송 ──
test('[시간 초과 1] 수집 중 제한 시간이 지나면 아무 상태도 만들지 않고 전송하지 않는다', async () => {
  const clock = clockOf(), sent = [], state = {}, collect = async args => { const out = await collectOpportunity(args); clock.expire(); return out; };
  const r = await runOpportunitySafe({ env: env('on', ex30), state, save: async () => { throw new Error('저장되면 안 됨'); }, send: mkSend(sent), now: NOW(IDX), fetcher: fx(mixed({ r: 3 })), gapMs: 0, clock, collect });
  assert.match(r.failed, /timeout/); assert.equal(sent.length, 0); assert.equal(state.opportunity, undefined);
});
test('[시간 초과 2] 분석 직후 제한 시간이 지나면 저장도 전송도 시작하지 않는다', async () => {
  const clock = clockOf(), sent = [], store = durable({}), p = store.proc();
  const r = await runOpportunitySafe({ env: env('on', ex30), state: p.state, save: p.save, send: mkSend(sent), now: NOW(IDX), fetcher: fx(mixed({ r: 3 })), gapMs: 0, clock, checkpoint: n => { if (n === 'afterAnalysis') clock.expire(); } });
  assert.match(r.failed, /timeout/); assert.equal(sent.length, 0); assert.equal(p.state.opportunity, undefined); assert.deepEqual(store.snapshot, {}); assert.equal(store.log.length, 0);
});
test('[시간 초과 3] Telegram 전송 직전 제한 시간이 지나면 보내지 않고, 영속 상태는 그대로이며 다음 실행이 정상적으로 이어받는다', async () => {
  const clock = clockOf(), sent = [], store = durable({}), p = store.proc(), series = mixed({ r: 3 });
  const r = await runOpportunitySafe({ env: env('on', ex30), state: p.state, save: p.save, send: mkSend(sent), now: NOW(IDX), fetcher: fx(series), gapMs: 0, clock, checkpoint: n => { if (n === 'beforeSend') clock.expire(); } });
  assert.match(r.failed, /timeout/); assert.equal(sent.length, 0); assert.deepEqual(store.snapshot, {}, '영속 상태가 바뀜'); assert.equal(p.state.opportunity.rescanHour, thisHour);   // 메모리에는 미완료 표시(루프 모드 재시도용)
  const b = await runProc(store, { series, now: NOW(IDX) + 300000, send: mkSend(sent), envExtra: ex30 });                      // 새 프로세스(--once) 재시도
  assert.equal(names(sent).length, 3); assert.equal(b.state.opportunity.scanHour, thisHour);
});
test('[시간 초과 4] 전송 요청이 진행 중일 때 제한 시간이 지나면: 그 전달의 기록만 마치고 다음 메시지는 시작하지 않으며, 나머지는 다음 실행이 이어받는다', async () => {
  const clock = clockOf(), sent = [], store = durable({}), p = store.proc(), series = mixed({ r: 10 }), ex = { ...ex30, RADAR_OPPORTUNITY_MAX_PER_HOUR: '30' };
  const slow = async (text, o) => { clock.expire(); sent.push({ text, o }); };                                                // 요청이 오래 걸려 제한 시간을 넘긴 뒤 성공
  const r = await runOpportunitySafe({ env: env('on', ex), state: p.state, save: p.save, send: slow, now: NOW(IDX), fetcher: fx(series), gapMs: 0, clock });
  assert.match(r.failed, /timeout/); assert.equal(sent.length, 1, '시간 초과 뒤 새 메시지가 시작됨'); assert.equal(store.log.length, 2);   // 장부 저장 + 전달 기록, 그 뒤 저장 없음
  const snap = store.snapshot.opportunity, done = names(sent); assert.ok(done.length >= 1 && done.length < 10);
  for (const n of done) assert.equal(snap.coins[`${n}USDT`].alertedStage, 3);                                                   // 이미 전달된 메시지는 기록됨 → 다음 실행에서 중복되지 않는다
  assert.equal(snap.inflight, null); assert.equal(snap.rescanHour, thisHour); assert.equal(Object.values(snap.coins).filter(c => c.alertedStage === 3).length, done.length);
  const b = await runProc(store, { series, now: NOW(IDX) + 300000, send: mkSend(sent), envExtra: ex });
  const all = names(sent); assert.equal(all.length, 10); assert.equal(new Set(all).size, 10);
});
test('[시간 초과 5] Telegram 응답은 성공했지만 저장 전에 제한 시간이 지난 경우에도 전달 기록은 남고(중복 방지), 그 뒤 새 전송은 없다', async () => {
  const clock = clockOf(), sent = [], store = durable({}), p = store.proc(), series = mixed({ r: 10 }), ex = { ...ex30, RADAR_OPPORTUNITY_MAX_PER_HOUR: '30' };
  const r = await runOpportunitySafe({ env: env('on', ex), state: p.state, save: p.save, send: mkSend(sent), now: NOW(IDX), fetcher: fx(series), gapMs: 0, clock, checkpoint: n => { if (n === 'afterSend') clock.expire(); } });
  assert.match(r.failed, /timeout/); assert.equal(sent.length, 1); const snap = store.snapshot.opportunity;
  for (const n of names(sent)) assert.equal(snap.coins[`${n}USDT`].alertedStage, 3); assert.equal(snap.inflight, null); assert.equal(snap.scanHour, null);   // 시간대 완료 처리는 하지 않음 → 다음 실행이 이어받음
});
test('[시간 초과 6] 래퍼가 이미 제한 시간으로 돌아온 뒤 늦게 끝나는 전송·수집은 새 요청·새 상태 변경을 만들지 않는다 (타이머·시계·Promise를 모두 수동 제어)', async () => {
  const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }, sleep = ms => new Promise(r => setTimeout(r, ms));
  const manualTimers = () => { let fire; return { set: cb => { fire = cb; return 1; }, clear: () => {}, fire: () => fire() }; };
  const series = mixed({ r: 10 }), ex = { ...ex30, RADAR_OPPORTUNITY_MAX_PER_HOUR: '30' };
  // (a) 전송 요청이 진행 중일 때 제한 시간 도래 → 래퍼 반환 → 요청이 늦게 성공
  const sent = [], store = durable({}), p = store.proc(), clock = clockOf(), timers = manualTimers(), gate = deferred(), started = deferred();
  const run = runOpportunitySafe({ env: env('on', ex), state: p.state, save: p.save, send: async (text, o) => { started.resolve(); await gate.promise; sent.push({ text, o }); }, now: NOW(IDX), fetcher: fx(series), gapMs: 0, clock, timers });
  await started.promise; clock.expire(); timers.fire();                                  // 요청이 나간 뒤 제한 시간 도래
  const r = await run; assert.match(r.failed, /timeout/); assert.equal(sent.length, 0);
  gate.resolve(); for (let k = 0; k < 200 && store.log.length < 2; k++) await sleep(5); await sleep(100);       // 진행 중이던 요청 성공 → 전달 기록만 마침
  assert.equal(sent.length, 1, '늦게 끝난 뒤 새 메시지 시작'); assert.equal(store.log.length, 2); const snap = store.snapshot.opportunity; assert.equal(snap.inflight, null);
  for (const n of names(sent)) assert.equal(snap.coins[`${n}USDT`].alertedStage, 3);
  // (b) 수집이 늦게 끝나는 경우
  const g2 = deferred(), c2 = clockOf(), t2 = manualTimers(), st = {}, s2 = [], inCollect = deferred();
  const lateCollect = async args => { inCollect.resolve(); await g2.promise; return collectOpportunity(args); };
  const run2 = runOpportunitySafe({ env: env('on', ex), state: st, save: async () => { throw new Error('저장되면 안 됨'); }, send: mkSend(s2), now: NOW(IDX), fetcher: fx(series), gapMs: 0, clock: c2, timers: t2, collect: lateCollect });
  await inCollect.promise; c2.expire(); t2.fire(); const r2 = await run2; assert.match(r2.failed, /timeout/);
  g2.resolve(); await sleep(250); assert.equal(s2.length, 0); assert.equal(st.opportunity, undefined);
});
test('[시간 초과 7] 시간 초과 뒤 HTML 서식 오류(400)가 나도 평문 재전송을 새로 시작하지 않고, 시간 초과 전에는 기존대로 평문으로 재전송한다', async () => {
  const calls = [], send = async (t, o) => { calls.push(o); throw Object.assign(new Error('Bad Request'), { status: 400 }); };
  const clock = clockOf(); const r = await runOpportunitySafe({ env: env('on', ex30), state: {}, save: async () => {}, send: async (t, o) => { calls.push(o); clock.expire(); throw Object.assign(new Error('Bad Request'), { status: 400 }); }, now: NOW(IDX), fetcher: fx(mixed({ r: 2 })), gapMs: 0, clock });
  assert.equal(calls.length, 1);
  const calls2 = []; await runOpportunitySafe({ env: env('on', ex30), state: {}, save: async () => {}, send: async (t, o) => { calls2.push(o); if (o?.html) throw Object.assign(new Error('Bad Request'), { status: 400 }); }, now: NOW(IDX), fetcher: fx(mixed({ r: 2 })), gapMs: 0 });
  assert.deepEqual(calls2.map(o => Boolean(o?.html)), [true, false]);                                                           // HTML 실패 → 평문 재전송(정상 경로 유지)
});
test('[시간 초과 8] 기회 레이더가 멈추거나 느려도 기존 정기 보고와 상태는 영향이 없고, 시간 예산이 부족하면 시작하지 않는다', async () => {
  const { analyze } = await import('../analysis.mjs'), MAIN_NOW = 1800000000000, msgs = [], state = {};
  const raw = { klines: Array.from({ length: 60 }, (_, i) => { const t = MAIN_NOW - (60 - i) * 300000, c = i === 59 ? 102 : 100 + i / 100; return [t, c - .2, c + .3, c - .3, c, 1, t + 299999, i === 59 ? 300 : 100]; }), premium: { symbol: 'BTCUSDT', markPrice: '101.2', lastFundingRate: '0.0001', time: MAIN_NOW }, oi: { symbol: 'BTCUSDT', openInterest: '103', time: MAIN_NOW }, history: [{ timestamp: MAIN_NOW - 900000, sumOpenInterest: '100', sumOpenInterestValue: '10000' }] };
  const row = { ...analyze('BTCUSDT', raw, MAIN_NOW), strong: true }, { cycle } = await import('../service.mjs');
  await cycle({ collect: async () => ({ rows: [row], failures: [] }), send: async t => msgs.push(t), save: async () => {}, now: MAIN_NOW, state });
  const before = JSON.stringify(state), n = msgs.length; assert.ok(n >= 1);
  const t0 = Date.now(); const out = await runAfterCycle({ state, save: async () => {}, send: () => new Promise(() => {}), env: env('on', ex30), out: () => {}, now: NOW(IDX), fetcher: fx(mixed({ r: 3 })), gapMs: 0, timeoutMs: 120 });
  assert.match(out.failed, /timeout/); assert.ok(Date.now() - t0 < 10000, '기회 레이더가 호출 쪽을 오래 붙잡음'); assert.equal(msgs.length, n);
  const { opportunity, ...rest } = state; assert.deepEqual(JSON.parse(before), rest);                                          // 기존 상태 키는 그대로
  const calls = []; const skipped = await runAfterCycle({ state: {}, save: async () => {}, send: async () => {}, env: env('on'), out: () => {}, now: NOW(IDX), fetcher: async u => { calls.push(u); throw new Error('x'); }, elapsedMs: 4.5 * 60 * 1000 });
  assert.equal(skipped.skipped, 'time-budget'); assert.equal(calls.length, 0);
});
test('[시간 초과 9] 이미 시작한 Telegram HTTP 요청은 취소할 수 없다 — 클라이언트 자체 제한(10초)만 있으며 그 한계를 코드가 보장한다', async () => {
  const { telegramSender } = await import('../service.mjs'); let seen;
  const send = telegramSender('t', '123', async (url, opt) => { seen = opt; return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); });
  await send('x'); assert.ok(seen.signal instanceof AbortSignal && !seen.signal.aborted);        // 요청마다 AbortSignal.timeout(10s) — 호출 쪽이 중간에 취소할 손잡이는 없다
  const { sendText } = await import('../service.mjs'); assert.equal(sendText.length, 2);         // (send, part) — signal 전달 경로 없음
  const src = (await import('node:fs')).readFileSync(new URL('../service.mjs', import.meta.url), 'utf8');
  assert.match(src, /timeoutMs = 10000/);
});

// ── 3. 첫 실행 기준선과 저장 실패 ──
const sumEx = { ...ex30, ...FIRST };
const summaries = sent => sent.filter(m => /활성화 기준선/.test(m.text)).length;
test('[기준선 1] 요약 전송 성공 + 저장 성공: 기준선 기록 → 요약 1건 → 완료 표시, 다음 시간대에는 새 변화만', async () => {
  const store = durable({}), sent = [], s0 = mixed({ r: 3, w: 6 });
  const a = await runProc(store, { series: s0, now: NOW(IDX), send: mkSend(sent), envExtra: sumEx });
  const o = store.snapshot.opportunity; assert.equal(sent.length, 1); assert.equal(summaries(sent), 1); assert.equal(names(sent).length, 0);
  assert.equal(o.baselineDone, true); assert.equal(o.baselineNotice, 'sent'); assert.equal(o.inflight, null); assert.equal(o.scanHour, thisHour); assert.equal(Object.keys(o.coins).length, 10);
  const b = await runProc(store, { series: shift(s0, 4), now: NOW(IDX) + 4 * H1, send: mkSend(sent), envExtra: sumEx });
  assert.equal(sent.length, 1, '기준선 이후 같은 상태가 다시 알려짐');
});
test('[기준선 2] 요약 전송 실패: 기준선은 이미 저장돼 있어 개별 알림이 쏟아지지 않고, 요약만 재시도되어 한 번 전송된다', async () => {
  const store = durable({}), sent = [], s0 = mixed({ r: 3, w: 14 });
  const a = await runProc(store, { series: s0, now: NOW(IDX), send: mkSend(sent, [1]), envExtra: sumEx });
  assert.ok(a.r.sendError); assert.equal(sent.length, 0); let o = store.snapshot.opportunity;
  assert.equal(o.baselineDone, true); assert.equal(o.baselineNotice, 'pending'); assert.equal(o.inflight, null); assert.equal(Object.keys(o.coins).length, 18);
  const early = await runProc(store, { series: s0, now: NOW(IDX) + 60000, send: mkSend(sent), envExtra: sumEx }); assert.equal(early.r.skipped, 'backoff'); assert.equal(sent.length, 0);
  const b = await runProc(store, { series: s0, now: NOW(IDX) + 1200000, send: mkSend(sent), envExtra: sumEx });
  assert.equal(sent.length, 1); assert.equal(summaries(sent), 1); assert.equal(names(sent).length, 0); assert.equal(store.snapshot.opportunity.baselineNotice, 'sent');
  await runProc(store, { series: s0, now: NOW(IDX) + 1500000, send: mkSend(sent), envExtra: sumEx, force: true }); assert.equal(sent.length, 1);
});
test('[기준선 3] 요약 전송 성공 + 상태 저장 실패(계속): 재시작을 반복해도 요약은 최대 2회, 개별 알림 대량 발송 없음', async () => {
  const store = durable({}), sent = [], s0 = mixed({ r: 3, w: 6 });
  for (let k = 0; k < 6; k++) await runProc(store, { series: s0, now: NOW(IDX) + k * 300000, send: mkSend(sent), envExtra: sumEx, fail: s => s.opportunity.baselineNotice === 'sent' });   // '요약 전달 완료'를 기록하는 저장만 계속 실패
  assert.equal(summaries(sent), 2, `요약 ${summaries(sent)}회`); assert.equal(names(sent).length, 0);
});
test('[기준선 4] 기준선 저장 도중 프로세스 종료(저장이 아예 안 됨): 아무것도 보내지 않고, 저장소가 복구되면 요약 1건으로 시작', async () => {
  const store = durable({}), sent = [], s0 = mixed({ r: 3, w: 6 });
  for (let k = 0; k < 5; k++) await runProc(store, { series: s0, now: NOW(IDX) + k * 300000, send: mkSend(sent), envExtra: sumEx, fail: () => true });
  assert.equal(sent.length, 0); assert.deepEqual(store.snapshot, {});
  await runProc(store, { series: s0, now: NOW(IDX) + 5 * 300000, send: mkSend(sent), envExtra: sumEx });
  assert.equal(sent.length, 1); assert.equal(summaries(sent), 1); assert.equal(store.snapshot.opportunity.baselineNotice, 'sent');
});
test('[기준선 5] 기준선은 저장됐지만 장부 저장 직전에 종료(둘째 저장 실패): 다음 실행이 요약만 한 번 보낸다', async () => {
  const store = durable({}), sent = [], s0 = mixed({ r: 3, w: 6 });
  await runProc(store, { series: s0, now: NOW(IDX), send: mkSend(sent), envExtra: sumEx, fail: (s, n) => n === 2 });
  assert.equal(sent.length, 0); const o = store.snapshot.opportunity; assert.equal(o.baselineDone, true); assert.equal(o.baselineNotice, 'pending'); assert.equal(Object.keys(o.coins).length, 10);
  await runProc(store, { series: s0, now: NOW(IDX) + 300000, send: mkSend(sent), envExtra: sumEx });
  assert.equal(sent.length, 1); assert.equal(summaries(sent), 1); assert.equal(names(sent).length, 0);
});
test('[기준선 6] 상태 캐시 손상·유실 뒤 재시작: 요약 1건과 조용한 기준선 재기록만, 개별 알림 대량 발송 없음 (손상이 반복돼도 매번 1건)', async () => {
  const store = durable({}), sent = [], s0 = mixed({ r: 3, w: 14 });
  await runProc(store, { series: s0, now: NOW(IDX), send: mkSend(sent), envExtra: sumEx }); assert.equal(sent.length, 1);
  const raw = durable({ opportunity: 'garbage-from-broken-cache', rows: [1] });                                                  // 손상된 캐시로 재시작
  await runProc(raw, { series: s0, now: NOW(IDX) + 300000, send: mkSend(sent), envExtra: sumEx, force: true });
  assert.equal(sent.length, 2); assert.equal(summaries(sent), 2); assert.equal(names(sent).length, 0);
  const lost = durable({}); await runProc(lost, { series: s0, now: NOW(IDX) + 600000, send: mkSend(sent), envExtra: sumEx }); assert.equal(sent.length, 3); assert.equal(names(sent).length, 0);   // 캐시 완전 유실
  assert.deepEqual(raw.snapshot.rows, [1]);                                                                                        // 기존 상태 키는 보존
});
test('[기준선 7] preview에서 on으로 전환: 미리보기는 기준선 동작을 보여 줄 뿐이고, on 첫 실행은 요약 1건(대량 발송 없음)', async () => {
  const store = durable({}), sent = [], s0 = mixed({ r: 3, w: 14 });
  const p = await runProc(store, { series: s0, now: NOW(IDX), send: null, mode: 'preview', envExtra: sumEx });
  assert.equal(p.r.baseline, true); assert.match(p.r.preview.messages[0], /활성화 기준선/); assert.equal(store.snapshot.opportunity.baselineDone, false); assert.deepEqual(store.snapshot.opportunity.coins, {});
  const o = await runProc(store, { series: s0, now: NOW(IDX) + 300000, send: mkSend(sent), envExtra: sumEx, force: true });
  assert.equal(sent.length, 1); assert.equal(summaries(sent), 1); assert.equal(names(sent).length, 0);
});
test('[기준선 8] silent: 요약도 없고 저장 실패 반복에도 아무것도 보내지 않으며, 기준선 종목의 해제도 조용하다. alert: 일반 규칙(상한)으로 알리되 저장 불가면 보내지 않는다', async () => {
  const store = durable({}), sent = [], s0 = mixed({ r: 3, w: 14 }), si = { ...ex30, RADAR_OPPORTUNITY_FIRST_RUN: 'silent' };
  for (let k = 0; k < 3; k++) await runProc(store, { series: s0, now: NOW(IDX) + k * 300000, send: mkSend(sent), envExtra: si, fail: () => true });
  assert.equal(sent.length, 0);
  await runProc(store, { series: s0, now: NOW(IDX) + 900000, send: mkSend(sent), envExtra: si }); assert.equal(sent.length, 0); const o = store.snapshot.opportunity;
  assert.equal(o.baselineDone, true); assert.equal(o.baselineNotice, null); assert.ok(Object.values(o.coins).every(c => c.stage === 0 || c.silentSeed === true));
  const al = durable({}), s2 = [], ae = { ...ex30, RADAR_OPPORTUNITY_FIRST_RUN: 'alert' };
  await runProc(al, { series: s0, now: NOW(IDX), send: mkSend(s2), envExtra: ae, fail: () => true }); assert.equal(s2.length, 0);       // 저장 불가 → 전송 없음
  await runProc(al, { series: s0, now: NOW(IDX) + 300000, send: mkSend(s2), envExtra: ae }); assert.equal(names(s2).length, 12);         // 복구 후 상한 12 안에서
  assert.equal(al.snapshot.opportunity.baselineDone, true);
});
test('[기준선 9] 첫 실행에서 일부 종목이 확정 대기 중이면 기준선을 끝내지 않고, 그 종목도 조용히 기록한 뒤에 완료한다', async () => {
  const store = durable({}), sent = [], late = { 'BTC-USDT-SWAP': BTC.slice(0, IDX + 1), 'ETH-USDT-SWAP': ETH.slice(0, IDX + 1), 'SOL-USDT-SWAP': SOL.slice(0, IDX + 1) };
  const p1 = store.proc(); await runOpportunitySafe({ env: env('on', sumEx), state: p1.state, save: p1.save, send: mkSend(sent), now: NOW(IDX), fetcher: okxFake({ cursor: id => (id === 'SOL-USDT-SWAP' ? IDX - 1 : IDX), series: late }), gapMs: 0 });
  assert.equal(store.snapshot.opportunity.baselineDone, false); assert.equal(summaries(sent), 1);
  const p2 = store.proc(); await runOpportunitySafe({ env: env('on', sumEx), state: p2.state, save: p2.save, send: mkSend(sent), now: NOW(IDX) + 300000, fetcher: okxFake({ cursor: () => IDX, series: late }), gapMs: 0 });
  assert.equal(store.snapshot.opportunity.baselineDone, true); assert.ok(store.snapshot.opportunity.coins.SOLUSDT); assert.equal(summaries(sent), 1); assert.deepEqual(names(sent), []);
});

// ── 4. 추가 확인 ──
test('[확인 1] 기본 설정: 1단계는 기록만, 2단계 이상만 알림, 3단계가 먼저 — 한 번의 실행에서 함께 나올 때', async () => {
  const store = durable({}), sent = [], series = mixed({ a: 3, w: 3, r: 2 });
  const r = await runProc(store, { series, now: NOW(IDX), send: mkSend(sent), envExtra: ex30 });
  const got = names(sent); assert.deepEqual(got.slice(0, 2), ['R00', 'R01']); assert.equal(got.length, 5); assert.ok(got.every(n => !n.startsWith('A')));
  const o = store.snapshot.opportunity; assert.equal(Object.values(o.coins).filter(c => c.stage === 1 && c.alertedStage === 0).length, 3); assert.ok(r.r.watching >= 8);
});
test('[확인 2] 시간당·일일 상한 준수: 여러 시간에 걸쳐 새 코인이 계속 나와도 합계가 상한을 넘지 않는다', async () => {
  const store = durable({}), sent = []; let total = 0; const ex = { ...ex30, RADAR_OPPORTUNITY_MAX_PER_HOUR: '4', RADAR_OPPORTUNITY_MAX_PER_DAY: '9' };
  const mk = h => { const out = { 'BTC-USDT-SWAP': BTC.slice(0, IDX + 1) }; for (let c = 0; c < 6; c++) out[`H${h}C${c}-USDT-SWAP`] = rebase(ETH, IDX, IDX); return shift(out, 4 * h); };
  const day = new Set();
  for (let h = 0; h < 5; h++) {
    const series = {}; for (let g = 0; g <= h; g++) Object.assign(series, mk(g)); series['BTC-USDT-SWAP'] = BTC.slice(0, IDX + 1).map(x => ({ ...x, t: x.t + 4 * h * H1 }));
    const before = names(sent).length; const r = await runProc(store, { series, now: NOW(IDX) + 4 * h * H1, send: mkSend(sent), envExtra: ex });
    assert.ok(names(sent).length - before <= 4, `시간당 상한 초과: ${names(sent).length - before}`); day.add(dayOf(NOW(IDX) + 4 * h * H1));
  }
  const perDay = {}; for (const [k, v] of Object.entries(store.snapshot.opportunity.daily)) perDay[k] = v.coins;
  assert.ok(Object.values(perDay).every(n => n <= 9), JSON.stringify(perDay)); assert.equal(names(sent).length, Object.values(perDay).reduce((a, b) => a + b, 0)); assert.equal(new Set(names(sent)).size, names(sent).length);
});
test('[확인 3] Telegram 429/403 Retry-After·공개 OKX 제한 응답(403/418/429/451)은 즉시 멈추고 기존 레이더 대기(state.retryAt)는 건드리지 않는다', async () => {
  const { waitMs } = await import('../service.mjs');
  for (const status of [429, 403]) {
    const store = durable({}), sent = []; const e = Object.assign(new Error(`api.telegram.org HTTP ${status}`), { status, retryAfter: 1800 }); let calls = 0;
    const r = await runProc(store, { series: mixed({ r: 10 }), now: NOW(IDX), send: async () => { calls++; throw e; }, envExtra: { ...ex30, RADAR_OPPORTUNITY_MAX_PER_HOUR: '30' } });
    assert.equal(calls, 1, '제한 응답 뒤 같은 실행에서 추가 요청'); assert.ok(store.snapshot.opportunity.retryAt >= NOW(IDX) + waitMs(status, 1800)); assert.equal(store.snapshot.opportunity.inflight, null);
    assert.equal((await runProc(store, { series: mixed({ r: 10 }), now: NOW(IDX) + 300000, send: async () => { calls++; }, envExtra: ex30 })).r.skipped, 'backoff'); assert.equal(calls, 1);
  }
  for (const status of [403, 418, 429, 451]) {
    const state = { retryAt: 0 }, calls = [], series = mixed({ r: 4 });
    const r = await opportunityStep({ env: env('on', ex30), state, save: async () => {}, send: mkSend([]), now: NOW(IDX), gapMs: 0, fetcher: fx(series, { calls, fail: { 'instId=R01-USDT-SWAP&bar=1H': new Response('', { status, headers: { 'retry-after': '600' } }) } }) });
    assert.ok(r.stopped && r.stopped.status === status); assert.ok(state.opportunity.retryAt >= NOW(IDX) + waitMs(status, 600)); assert.equal(state.retryAt, 0, '기존 레이더 대기를 건드림');
    assert.equal(calls.filter(u => /R02|R03/.test(u)).length, 0, '제한 응답 뒤 추가 호출');
  }
});
test('[확인 4] 미확정봉·누락봉은 분석에서 제외되고, 미확정 봉의 이상값은 결과에 반영되지 않는다', async () => {
  const sent = [], state = {}, series = mixed({ r: 2 });
  await opportunityStep({ env: env('on', ex30), state, save: async () => {}, send: mkSend(sent), now: NOW(IDX), gapMs: 0, fetcher: fx(series) });     // 픽스처는 항상 진행 중 봉(고가 9999)을 섞어 보낸다
  const direct = at(ETH, IDX); assert.equal(state.opportunity.coins.R00USDT.price, direct.price); assert.ok(direct.price < 1000);
  const gap = async url => { const res = await fx(series)(url); if (/R00-USDT-SWAP&bar=4H/.test(url)) { const b = await res.json(); b.data.splice(30, 2); return new Response(JSON.stringify(b)); } return res; };    // 4H 중간 누락
  const st2 = {}, s2 = []; await opportunityStep({ env: env('on', ex30), state: st2, save: async () => {}, send: mkSend(s2), now: NOW(IDX), gapMs: 0, fetcher: gap });
  assert.equal(st2.opportunity.coins.R00USDT, undefined); assert.deepEqual(names(s2), ['R01']);
});
test('[확인 5] 기존 레이더 상태와의 격리: 어떤 모드·결과에서도 opportunity 외 상태 키는 바뀌지 않는다', async () => {
  const mainState = () => ({ rows: [{ symbol: 'BTCUSDT' }], sent: { 'BTCUSDT:LONG': 1 }, reportHour: 7, partial: { hour: 7, sent: 1, v: 3 }, retryAt: 0, seq: 5, savedAt: 1, lastSlot: 3, news: { items: [1] }, rotation: { last: { a: 1 } }, chart: { hour: 7 } });
  const before = JSON.stringify(mainState());
  for (const [mode, fetcher, send] of [['on', fx(mixed({ r: 3 })), mkSend([])], ['preview', fx(mixed({ r: 3 })), null], ['on', async () => { throw new Error('down'); }, mkSend([])], ['on', fx(mixed({ r: 3 })), async () => { throw new Error('tg down'); }]]) {
    const state = mainState(); await runOpportunitySafe({ env: env(mode, ex30), state, save: async () => {}, send, now: NOW(IDX), gapMs: 0, fetcher });
    const { opportunity, ...rest } = state; assert.equal(JSON.stringify(rest), before, `모드 ${mode}에서 기존 키가 바뀜`);
  }
});
test('[확인 6] 기능 OFF: 추가 네트워크 호출 0건(주입·전역 모두), 상태 변경 0건', async () => {
  const calls = []; let globalCalls = 0; const orig = globalThis.fetch; globalThis.fetch = async u => { globalCalls++; throw new Error('호출되면 안 됨'); };
  try {
    for (const e of [{}, { RADAR_OPPORTUNITY: 'off' }, { RADAR_OPPORTUNITY: '' }, { RADAR_OPPORTUNITY: 'enabled' }, { RADAR_OPPORTUNITY: 'true' }]) {
      const state = { a: 1 }; const r = await runAfterCycle({ state, save: async () => { throw new Error('저장되면 안 됨'); }, send: async () => { throw new Error('전송되면 안 됨'); }, env: e, out: () => { throw new Error('출력되면 안 됨'); }, now: NOW(IDX), fetcher: async u => { calls.push(u); throw new Error('x'); } });
      assert.equal(r, null); assert.deepEqual(state, { a: 1 });
    }
    assert.equal((await opportunityStep({ now: NOW(IDX), state: {}, env: {} })).skipped, 'off');
  } finally { globalThis.fetch = orig; }
  assert.equal(calls.length, 0); assert.equal(globalCalls, 0);
});
test('[확인 7] 테스트는 실제 Telegram에 전송하지 않는다 — 전송 함수는 모두 모의이고 전역 fetch는 차단돼 있다', async () => {
  const fs = await import('node:fs'), dir = new URL('./', import.meta.url);
  for (const f of ['opportunity.test.mjs', 'opportunity-stability.test.mjs', 'opportunity-fixture.mjs']) {
    const src = fs.readFileSync(new URL(f, dir), 'utf8');
    assert.ok(!/https:\/\/api\.telegram\.org/.test(src), `${f}: 실제 Telegram 주소`); assert.ok(!/process\.env\.TELEGRAM/.test(src), `${f}: 비밀값 참조`);
  }
  const host = ['api', 'telegram', 'org'].join('.');                                                                           // 소스에 실제 주소 문자열을 두지 않기 위해 조립
  await assert.rejects(fetch(`https://${host}/botX/sendMessage`), /실제 네트워크 호출 금지/);
});

test('[확인 8] 전달 여부가 불확실한 채 남은 오래된 장부(6시간 초과)는 나중에 새로 생긴 같은 조합의 정당한 알림을 막지 않는다', async () => {
  const sent = [], key = 'R00USDT:new:3,R01USDT:new:3', store = durable({ opportunity: { ...base0(), baselineDone: true, inflight: { key, hour: 1, attempts: 2, at: NOW(IDX) - 7 * H1 } } });
  await runProc(store, { series: mixed({ r: 2 }), now: NOW(IDX), send: mkSend(sent), envExtra: ex30 });
  assert.deepEqual(names(sent), ['R00', 'R01']);                                                                                // 오래된 장부 → 새 알림으로 처리
  const fresh = durable({ opportunity: { ...base0(), baselineDone: true, inflight: { key, hour: 1, attempts: 2, at: NOW(IDX) - 3600000 } } }), s2 = [];   // 방금 전 불확실한 시도 2회 → 전달된 것으로 간주
  await runProc(fresh, { series: mixed({ r: 2 }), now: NOW(IDX), send: mkSend(s2), envExtra: ex30 });
  assert.equal(s2.length, 0); assert.equal(fresh.snapshot.opportunity.coins.R00USDT.alertedStage, 3); assert.equal(fresh.snapshot.opportunity.inflight, null);
});

test('[결함 수정 확인 R6] 제한 시간이 지나면 수집이 새 거래소 요청을 보내지 않는다 (가짜 시계로 결정적)', async () => {
  const clock = clockOf(), series = mixed({ r: 10, w: 10 }), base = fx(series), calls = [];
  const fetcher = async url => { calls.push(url); if (calls.length === 5) clock.expire(); return base(url); };               // 5번째 요청 도중 제한 시간이 지남
  const r = await runOpportunitySafe({ env: env('on', ex30), state: {}, save: async () => {}, send: mkSend([]), now: NOW(IDX), fetcher, gapMs: 0, clock });
  assert.match(r.failed, /timeout/); assert.ok(calls.length <= 6, `시간 초과 뒤에도 요청 ${calls.length - 5}건 추가`);        // 진행 중이던 종목의 두 번째 요청까지만
});
test('[결함 수정 확인 R5b] 시간 초과 뒤에는 이미 시작한 전송의 기록 말고 새 상태 변경(저장)이 없다 (가짜 시계로 결정적)', async () => {
  const clock = clockOf(), store = durable({}), p = store.proc(), series = mixed({ r: 10 }), sent = [];
  await runOpportunitySafe({ env: env('on', { ...ex30, RADAR_OPPORTUNITY_MAX_PER_HOUR: '30' }), state: p.state, save: p.save, send: async (t, o) => { clock.expire(); sent.push({ t, o }); }, now: NOW(IDX), fetcher: fx(series), gapMs: 0, clock });
  assert.equal(sent.length, 1); assert.equal(store.log.length, 2, `저장 ${store.log.length}회`);                                  // 장부 저장 1회 + 전달 기록 1회뿐 — 마무리 저장 없음
});
