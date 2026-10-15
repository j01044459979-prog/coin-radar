import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide, judgeCache, quietReason, slotOfTime, SLOT_MS, MIN_GAP_MS, TAKEOVER_MS } from '../gate.mjs';
import { cycle } from '../service.mjs';
import { createOkxCollector } from '../okx.mjs';
import { fakeOkx, now as T0 } from './fake-okx.mjs';
import { tick } from '../../scheduler/worker.mjs';

// ── 미니 Actions 시뮬레이터: concurrency(한 번에 하나, 직렬) + 상태 캐시 + 게이트 ──
// runs: [{ at(시작 가능 시각), source, slot }]. 각 실행은 2분 걸리고 상태를 캐시에 저장한다.
function simulate(runs, { scheduler = 'cloudflare', state = {}, legacyGate = false } = {}) {
  let t = 0, cache = structuredClone(state); const executed = [], skipped = [];
  for (const r of [...runs].sort((a, b) => a.at - b.at)) {
    t = Math.max(t, r.at);                                   // 앞선 실행이 끝나야 시작(직렬)
    const st = structuredClone(cache);
    if (legacyGate) delete st.lastSlot;                       // 2차 리뷰 이전 게이트(90초 간격만)를 재현
    const d = decide({ source: r.source, scheduler, state: st, now: t, slot: r.slot });
    if (!d.run) { skipped.push({ ...r, start: t, reason: d.reason }); t += 15000; continue; }
    executed.push({ ...r, start: t });
    cache = { ...cache, lastAttempt: t, lastSlot: Math.max(Number(cache.lastSlot) || 0, d.slot) };
    t += 120000;
  }
  return { executed, skipped, cache };
}
const base = 1800000000000, slot = n => slotOfTime(base) + n, at = (n, s = 0) => base + n * SLOT_MS + s * 1000;

test('[2] 90초 간격만 쓰던 이전 게이트는 같은 슬롯 재요청이 2분 뒤 도착하면 중복 분석한다 (재현)', () => {
  const runs = [{ at: at(0), source: 'cloudflare', slot: slot(0) }, { at: at(0, 20), source: 'cloudflare', slot: slot(0) }]; // 같은 슬롯 이중 dispatch
  assert.equal(simulate(runs, { legacyGate: true }).executed.length, 2);   // 두 번째는 첫 실행(2분)이 끝난 뒤라 직전 시도가 90초보다 오래됨
});
test('[2] 슬롯 멱등성: 같은 슬롯 재요청은 몇 분 뒤에 도착해도 실행되지 않는다', () => {
  const runs = [{ at: at(0), source: 'cloudflare', slot: slot(0) }, { at: at(0, 20), source: 'cloudflare', slot: slot(0) }, { at: at(0, 200), source: 'cloudflare', slot: slot(0) }];
  const r = simulate(runs);
  assert.equal(r.executed.length, 1); assert.equal(r.skipped.length, 2); assert.match(r.skipped[0].reason, /이미 처리됨/);
});
test('[2] 늦게 도착한 이전 슬롯 실행은 최신 슬롯 처리 후 무시된다 (뒤바뀐 순서)', () => {
  const r = simulate([{ at: at(1), source: 'cloudflare', slot: slot(1) }, { at: at(1, 200), source: 'cloudflare', slot: slot(0) }]);
  assert.deepEqual(r.executed.map(x => x.slot), [slot(1)]);
});
test('[2] 연속 슬롯은 모두 실행된다 (과잉 억제 없음)', () => {
  const r = simulate(Array.from({ length: 12 }, (_, i) => ({ at: at(i, 5), source: 'cloudflare', slot: slot(i) })));
  assert.equal(r.executed.length, 12); assert.equal(r.skipped.length, 0);
});

// ── [1] 디스패처: 실행 목록 반영 지연·목록 한계에서도 최종 중복 실행은 없다 ──
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
function lagGitHub({ visibleAfterMs = Infinity, hidden = false } = {}) {
  const dispatched = []; const urls = [];
  const f = async (url, opt = {}) => {
    urls.push(url);
    if (opt.method === 'POST') { dispatched.push(JSON.parse(opt.body).inputs); return new Response(null, { status: 204 }); }
    // 목록에 반영이 늦거나(hidden) 아예 보이지 않는 상황
    return json({ workflow_runs: hidden ? [] : dispatched.map(i => ({ display_title: `radar · workflow_dispatch · cloudflare · slot ${i.slot}`, status: 'queued', created_at: new Date(T).toISOString() })) });
  };
  return Object.assign(f, { dispatched, urls });
}
const T = Date.UTC(2026, 9, 15, 8, 0, 0), env = { GITHUB_DISPATCH_TOKEN: 'x', DISPATCH_ENABLED: 'true' };
test('[1] 실행 목록 반영 지연 + 같은 슬롯 cron 재발화: 디스패처는 두 번 보낼 수 있지만(최선의 확인) 실행은 한 번만 일어난다', async () => {
  const gh = lagGitHub({ hidden: true });
  await tick(env, T, { fetchImpl: gh, wait: async () => {}, now: () => T });
  await tick(env, T + 3000, { fetchImpl: gh, wait: async () => {}, now: () => T + 3000 });   // 같은 슬롯, 목록에는 아직 안 보임
  assert.equal(gh.dispatched.length, 2);                                                       // 디스패처 단계의 한계를 인정
  const slotNo = Number(gh.dispatched[0].slot); assert.equal(gh.dispatched[1].slot, gh.dispatched[0].slot);
  const r = simulate(gh.dispatched.map((i, k) => ({ at: T + k * 3000, source: 'cloudflare', slot: Number(i.slot) })));
  assert.equal(r.executed.length, 1);                                                          // 최종 멱등성은 게이트가 보장
  assert.equal(slotNo, slotOfTime(T));
});
test('[1] 목록이 반영되면(정상) 같은 슬롯은 dispatch 1회만', async () => {
  const gh = lagGitHub();
  await tick(env, T, { fetchImpl: gh, wait: async () => {}, now: () => T });
  const second = await tick(env, T + 3000, { fetchImpl: gh, wait: async () => {}, now: () => T + 3000 });
  assert.equal(gh.dispatched.length, 1); assert.equal(second.decision, 'skip-duplicate-slot');
});
test('[1] 조회 범위: 최근 30분·최대 50개로 요청하고 토큰은 Authorization 헤더에만 쓴다', async () => {
  const gh = lagGitHub(); await tick(env, T, { fetchImpl: gh, wait: async () => {}, now: () => T });
  const list = gh.urls.find(u => u.includes('/runs?'));
  assert.match(list, /per_page=50/); assert.match(decodeURIComponent(list), /created=>=2026-10-15T07:30:00Z/); assert.doesNotMatch(list, /token|x$/i);
});
test('[1] 목록 한도(50개)를 넘겨 같은 슬롯 실행이 보이지 않아도 최종 실행은 한 번 (게이트)', () => {
  // 디스패처가 중복 dispatch한 상황을 가정: 같은 슬롯 3건이 서로 다른 시각에 도착
  const r = simulate([0, 40, 400].map(s => ({ at: at(0, s), source: 'cloudflare', slot: slot(0) })));
  assert.equal(r.executed.length, 1);
});

// ── [4] GitHub schedule 15분 자동 복구가 정상 Cloudflare와 충돌하지 않는가 ──
function lcg(seed) { let x = seed; return () => (x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296; }
test('[4] Cloudflare가 정상(지터 0~100초·실행 2분)인 동안 GitHub schedule(약 28분 간격)은 한 번도 실행되지 않고, 슬롯당 최대 1회 분석', () => {
  for (const seed of [1, 7, 42, 99, 2026]) {
    const rnd = lcg(seed), runs = [];
    for (let i = 0; i < 60; i++) runs.push({ at: at(i, rnd() * 100), source: 'cloudflare', slot: slot(i) });
    for (let k = 0, t = at(3, 30); t < at(60); t += (15 + rnd() * 30) * 60000, k++) runs.push({ at: t, source: 'github-schedule', slot: undefined });
    const r = simulate(runs);
    assert.equal(r.executed.filter(x => x.source === 'github-schedule').length, 0, `seed ${seed}`);
    assert.equal(r.executed.length, 60, `seed ${seed}`);
    const slots = r.executed.map(x => x.slot); assert.equal(new Set(slots).size, slots.length);
  }
});
test('[4] Cloudflare가 20분간 멈추면 GitHub schedule이 1회 대신 실행하고, Cloudflare 복귀 후 같은 슬롯 중복은 없다', () => {
  const runs = [];
  for (let i = 0; i < 4; i++) runs.push({ at: at(i, 10), source: 'cloudflare', slot: slot(i) });
  for (let i = 8; i < 14; i++) runs.push({ at: at(i, 10), source: 'cloudflare', slot: slot(i) });       // 슬롯 4~7(20분) 중단
  for (const m of [5, 10, 15, 20, 25]) runs.push({ at: at(3, 10) + m * 60000 + 40000, source: 'github-schedule' });
  const r = simulate(runs);
  const gh = r.executed.filter(x => x.source === 'github-schedule');
  assert.ok(gh.length >= 1 && gh.length <= 2, `GitHub 대신 실행 ${gh.length}회`);        // 15분 넘는 공백에서만, 연속 실행은 90초/슬롯 규칙으로 제한
  assert.ok(gh[0].start - at(3, 10) > TAKEOVER_MS);
  const slotsOf = r.executed.map(x => x.slot ?? slotOfTime(x.start)); assert.equal(new Set(slotsOf).size, slotsOf.length, '슬롯 중복 실행 없음');
});
test('[4] 롤백(github) 상태에서 남아 있는 Cloudflare 디스패치는 전부 무시되어 schedule과 이중 실행되지 않는다', () => {
  const runs = [];
  for (let i = 0; i < 6; i++) { runs.push({ at: at(i * 5, 10), source: 'cloudflare', slot: slot(i * 5) }); runs.push({ at: at(i * 5, 100), source: 'github-schedule' }); }
  const r = simulate(runs, { scheduler: 'github' });
  assert.equal(r.executed.filter(x => x.source === 'cloudflare').length, 0); assert.equal(r.executed.length, 6);
});

// ── [3][5] 오래된/손상 상태 복원 시 Telegram 중복 가능성과 억제 정책 ──
const fullFake = (o = {}) => fakeOkx({ breakout: true, ...o });
async function runCycle(state, nowMs = T0) {
  const sent = [], photos = [];
  await cycle({ now: nowMs, state, collect: n => createOkxCollector(fullFake(), { gapMs: 0 })(n), send: async t => { sent.push(t); }, sendPhoto: async () => { photos.push(1); return true; }, save: async () => {}, news: async () => {}, render: undefined });
  return { sent, photos };
}
const hourOf = ms => Math.floor(ms / 3600000);
test('[3] 정상 상태: 같은 시간대 정기 보고는 한 번만, 긴급 알림은 쿨다운으로 한 번만', async () => {
  const state = {};
  const a = await runCycle(state); const b = await runCycle(state);
  assert.ok(a.sent.length >= 1); assert.equal(b.sent.filter(t => /RICH FUTURES RADAR/.test(t)).length, 0);
  const alertsA = a.sent.filter(t => /신규 조건/.test(t)).length, alertsB = b.sent.filter(t => /신규 조건/.test(t)).length; assert.equal(alertsA + alertsB <= 2, true);
});
test('[3] 오래된 상태(직전 시간대 상태)가 복원되면 같은 시간대 보고가 다시 나갈 수 있다 (재현) — 억제 없을 때', async () => {
  const fresh = {}; const first = await runCycle(fresh);
  const stale = { reportHour: hourOf(T0) - 1, sent: {}, lastAttempt: T0 - 3600000 };       // 직전 시간대 캐시가 복원된 상황
  const again = await runCycle(stale);
  assert.ok(first.sent.length >= 1 && again.sent.some(t => /RICH FUTURES RADAR/.test(t)), '정기 보고 중복 전송 가능');
});
test('[3][5] 억제 시간대(quiet): 오래된·손상 복구 상태에서는 아무것도 보내지 않고 상태만 복구하며, 다음 시간대에 1회 재개', async () => {
  const stale = { reportHour: hourOf(T0) - 1, sent: {}, quiet: { reason: 'cache-stale', hour: hourOf(T0), at: T0 } };
  const q1 = await runCycle(stale), q2 = await runCycle(stale);
  assert.equal(q1.sent.length + q2.sent.length + q1.photos.length + q2.photos.length, 0);
  assert.equal(stale.reportHour, hourOf(T0)); assert.equal(stale.suppressed.reason, 'cache-stale');
  // 강한 신호 쿨다운이 기록되어 억제가 끝난 직후에도 같은 신호가 곧바로 재전송되지 않는다
  // 다음 시간대(모의 거래소 시각이 고정이므로 억제 시간대를 이전 시간대로 바꿔 '지난 것'을 표현): 억제 해제 후 정기 보고 재개, 중복 없음
  stale.quiet.hour = hourOf(T0) - 1; stale.reportHour = hourOf(T0) - 1;
  const next = await runCycle(stale);
  assert.equal(next.sent.filter(t => /RICH FUTURES RADAR/.test(t)).length, 1); assert.equal(stale.quiet, undefined);
});
test('[3][5] 수집 장애 알림 경로는 억제 대상이 아니다(장애를 숨기지 않음)', async () => {
  const sent = []; const state = { quiet: { reason: 'cache-stale', hour: hourOf(T0), at: T0 } };
  await cycle({ now: T0, state, collect: async () => { throw new Error('boom'); }, send: async t => { sent.push(t); }, save: async () => {}, news: async () => {} });
  assert.equal(sent.length, 1); assert.match(sent[0], /수집 장애/);
});

// ── [3] 캐시 최신성 판정 ──
const c = (key, minutes) => ({ key, created_at: new Date(T + minutes * 60000).toISOString() });
test('[3] judgeCache: 복원 키가 가장 최근이면 ok, 더 새 캐시가 있으면 stale, 복원 실패+캐시 존재는 cold-with-caches', () => {
  const caches = [c('radar-state-1-1', 0), c('radar-state-3-1', 10), c('radar-state-2-1', 5)];
  assert.deepEqual(judgeCache({ restoredKey: 'radar-state-3-1', caches, ref: 'refs/heads/main' }), { status: 'ok', newest: 'radar-state-3-1' });
  assert.deepEqual(judgeCache({ restoredKey: 'radar-state-2-1', caches, ref: 'refs/heads/main' }), { status: 'stale', newest: 'radar-state-3-1' });
  assert.deepEqual(judgeCache({ restoredKey: '', caches, ref: 'refs/heads/main' }), { status: 'cold-with-caches', newest: 'radar-state-3-1' });
  assert.equal(judgeCache({ restoredKey: '', caches: [], ref: 'refs/heads/main' }).status, 'cold');      // 최초 실행: 정상 전송
  assert.equal(judgeCache({ restoredKey: 'radar-state-9-1', caches: [], ref: 'refs/heads/main' }).status, 'unverified');
  assert.equal(judgeCache({ restoredKey: 'a', caches: null, ref: 'refs/heads/main' }).status, 'unverified');   // API 실패
  assert.equal(judgeCache({ restoredKey: 'a', caches, ref: 'refs/heads/feature/x' }).status, 'skipped');
});
test('[3][5] quietReason: 손상 복구·stale·cold-with-caches만 억제, 최초 실행/unverified/ok는 억제하지 않음', () => {
  assert.equal(quietReason({ recovered: true }), 'corrupt-state');
  assert.equal(quietReason({ cacheStatus: 'stale' }), 'cache-stale'); assert.equal(quietReason({ cacheStatus: 'cold-with-caches' }), 'cache-cold-with-caches');
  for (const s of ['ok', 'cold', 'unverified', 'skipped', undefined]) assert.equal(quietReason({ cacheStatus: s }), null, String(s));
});
test('[3][5] --gate CLI: 캐시 판정 stale이면 quiet 기록, ok면 기록 없음, 기능 브랜치 확인 스크립트는 네트워크 없이 skipped', () => {
  const run = (cacheStatus, preset) => {
    const dir = mkdtempSync(join(tmpdir(), 'q-')); execFileSync('mkdir', ['-p', join(dir, 's')]);
    writeFileSync(join(dir, 's', 'state.json'), JSON.stringify(preset ?? { lastAttempt: Date.now() - 600000, lastSlot: 1, seq: 3 }));
    const out = join(dir, 'o'); writeFileSync(out, '');
    execFileSync(process.execPath, [new URL('../run.mjs', import.meta.url).pathname, '--gate'], { env: { ...process.env, RADAR_STATE_DIR: join(dir, 's'), GITHUB_OUTPUT: out, RADAR_SOURCE_EVENT: 'cloudflare', RADAR_SCHEDULER: 'cloudflare', RADAR_SLOT: String(slotOfTime(Date.now())), RADAR_CACHE_STATUS: cacheStatus }, encoding: 'utf8' });
    return JSON.parse(readFileSync(join(dir, 's', 'state.json'), 'utf8'));
  };
  assert.equal(run('stale').quiet.reason, 'cache-stale'); assert.equal(run('ok').quiet, undefined); assert.equal(run('unverified').quiet, undefined);
  const dir = mkdtempSync(join(tmpdir(), 'cc-')); const out = join(dir, 'o'); writeFileSync(out, '');
  execFileSync(process.execPath, [new URL('../cache-check.mjs', import.meta.url).pathname], { env: { ...process.env, GITHUB_REF: 'refs/heads/feature/x', GITHUB_OUTPUT: out, GITHUB_REPOSITORY: 'a/b', GITHUB_TOKEN: 'x' }, encoding: 'utf8' });
  assert.match(readFileSync(out, 'utf8'), /status=skipped/);
});
test('--gate는 Run 단계가 같은 슬롯을 다시 처리하지 않도록 lastSlot을 쓰는 경로(--once)와 같은 슬롯 규칙을 사용한다', () => {
  assert.equal(decide({ source: 'cloudflare', scheduler: 'cloudflare', state: { lastAttempt: 1, lastSlot: 100 }, now: base, slot: '100' }).run, false);
  assert.equal(decide({ source: 'cloudflare', scheduler: 'cloudflare', state: { lastAttempt: 1, lastSlot: 100 }, now: base, slot: '101' }).run, true);
  assert.equal(decide({ source: 'cloudflare', scheduler: 'cloudflare', state: { lastAttempt: 1 }, now: base, slot: '' }).run, true);   // 슬롯 정보 없으면 시각 기준
  assert.ok(MIN_GAP_MS < SLOT_MS);
});

// ── 워크플로 구조 ──
const wf = readFileSync(new URL('../../.github/workflows/radar.yml', import.meta.url), 'utf8');
test('워크플로: 캐시 최신성 확인 → 최신 캐시 재복원 → 게이트 순서, actions: read 외 추가 권한 없음, 슬롯 전달', () => {
  const idx = k => wf.indexOf(k);
  assert.ok(idx('name: Restore state') < idx('name: Check cache freshness') && idx('name: Check cache freshness') < idx('name: Restore newest cache') && idx('name: Restore newest cache') < idx('name: Gate'));
  assert.match(wf, /permissions:\n  contents: read\n  actions: read/); assert.doesNotMatch(wf, /(contents|actions|secrets|id-token): write/);
  assert.match(wf, /RADAR_SLOT: \$\{\{ github\.event\.inputs\.slot \}\}/g);
  assert.equal((wf.match(/RADAR_SLOT:/g) || []).length, 2);                                // Gate와 Run radar
  assert.match(wf, /RADAR_CACHE_STATUS: .*restore_newest\.outputs\.cache-hit/);
  assert.match(wf, /id: cachecheck\n\s+continue-on-error: true/);                         // 확인 실패가 레이더를 멈추지 않음
});
