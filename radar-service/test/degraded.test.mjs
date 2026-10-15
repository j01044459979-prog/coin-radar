import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, quietReason, slotOfTime, ALERT_HOURS, SLOT_MS } from '../gate.mjs';
import { cycle } from '../service.mjs';
import { createOkxCollector } from '../okx.mjs';
import { fakeOkx, now as T0 } from './fake-okx.mjs';

// 수집 결과는 한 번만 만들고(모의 거래소 시각 고정) 모든 시뮬레이션 실행이 재사용한다. 네트워크·Telegram 호출은 없다.
const baseResult = await createOkxCollector(fakeOkx({ breakout: true }), { gapMs: 0 })(T0);
const HOUR = 3600000, H0 = Math.floor(1800000000000 / HOUR) * HOUR;          // 정시
const lcg = seed => { let x = seed; return () => (x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296; };

// 미니 시뮬레이터: 실행 시각별로 [캐시 복원 → 게이트 평가 → (실행이면) lastSlot 기록 → cycle → 캐시 저장]
function simulate({ times, scheduler, api = () => 'ok', failOpen = true, staleAt = new Set(), initial = {} }) {
  const origFetch = globalThis.fetch; globalThis.fetch = () => { throw new Error('네트워크 호출 금지(모의 테스트)'); };
  return (async () => {
    try {
      const snaps = [structuredClone(initial)]; const log = []; let sentReports = 0;
      for (const [i, t] of times.entries()) {
        const state = structuredClone(snaps[Math.max(0, snaps.length - (staleAt.has(i) ? 2 : 1))]);   // 오래된 캐시 복원 재현
        const source = scheduler === 'cloudflare' ? 'cloudflare' : 'github-schedule';
        const slot = scheduler === 'cloudflare' ? slotOfTime(t) : undefined;
        const d = evaluate({ source, scheduler, state, now: t, slot, cacheStatus: api(t, i), failOpen });
        let reports = 0, alerts = 0;
        if (d.run) {
          state.lastSlot = Math.max(Number(state.lastSlot) || 0, d.slot);
          const sent = [];
          await cycle({ now: t, state, collect: async () => baseResult, send: async x => { sent.push(x); }, sendPhoto: async () => true, save: async () => {}, news: async () => {} });
          reports = sent.filter(x => /RICH FUTURES RADAR/.test(x)).length; alerts = sent.filter(x => /신규 조건/.test(x)).length;
          snaps.push(state);
        }
        sentReports += reports;
        log.push({ i, t, hour: Math.floor(t / HOUR), run: d.run, quiet: d.quiet, alert: d.alert, reports, alerts, degradedHours: d.degradedHours });
      }
      return { log, sentReports, byHour: Object.fromEntries([...new Set(log.map(l => l.hour))].map(h => [h, log.filter(l => l.hour === h).reduce((n, l) => n + l.reports, 0)])) };
    } finally { globalThis.fetch = origFetch; }
  })();
}
// GitHub schedule 지연 재현: 실측 간격 28~44분(15분까지 포함)
function githubTimes(hours, seed) { const r = lcg(seed), out = []; for (let t = H0 + 120000; t < H0 + hours * HOUR; t += (28 + r() * 16) * 60000) out.push(Math.round(t)); return out; }
function cloudflareTimes(hours, jitter = 60) { const out = []; for (let t = H0; t < H0 + hours * HOUR; t += SLOT_MS) out.push(t + 10000 + (t / SLOT_MS % 7) * jitter * 100); return out; }

test('[1] 재현: 이전 정책(unverified 무기한 억제)은 GitHub schedule 30~40분 간격 + 캐시 API 장애가 이어지면 정기 보고가 전부 사라진다', async () => {
  const r = await simulate({ times: githubTimes(10, 5), scheduler: 'github', api: () => 'unverified', failOpen: false });
  assert.equal(r.sentReports, 0);                       // 10시간 동안 정기 보고 0건 = 장시간 누락
  assert.ok(r.log.filter(l => l.run).length >= 12);
});
test('[1][2] 개선: 같은 조건에서 첫 시간대만 억제하고 이후 시간대마다 정기 보고 1건 (최대 1시간 누락, 시간당 중복 없음)', async () => {
  for (const seed of [1, 5, 9, 33]) {
    const r = await simulate({ times: githubTimes(10, seed), scheduler: 'github', api: () => 'unverified' });
    const hours = Object.keys(r.byHour).map(Number).sort((a, b) => a - b);
    assert.equal(r.byHour[hours[0]], 0, `seed ${seed}: 첫 시간대 억제`);
    for (const h of hours.slice(1)) assert.equal(r.byHour[h], 1, `seed ${seed} hour ${h}`);   // 시간당 정확히 1건
    assert.equal(r.log.filter(l => l.quiet).length, 1, '억제는 장애 시작 후 한 번뿐');
  }
});
test('[1] 기준선: 캐시 API가 정상이면 매 시간 정기 보고 1건, 억제·경고 없음', async () => {
  const r = await simulate({ times: githubTimes(10, 5), scheduler: 'github' });
  assert.deepEqual(Object.values(r.byHour), Array(Object.keys(r.byHour).length).fill(1)); assert.equal(r.log.filter(l => l.quiet || l.alert).length, 0);
});
test('[1][2] 장애가 중간에 끝나면(ok 복귀) 추적이 초기화되고, 다음 장애에서는 다시 첫 시간대만 억제한다', async () => {
  const times = githubTimes(12, 7);
  const api = t => (t < H0 + 4 * HOUR || t >= H0 + 8 * HOUR ? 'unverified' : 'ok');
  const r = await simulate({ times, scheduler: 'github', api });
  assert.equal(r.log.filter(l => l.quiet).length, 2);      // 장애 구간 2회 각각 첫 시간대
  assert.ok(Object.values(r.byHour).filter(n => n === 0).length === 2);
  assert.ok(Object.values(r.byHour).every(n => n <= 1));
});
test('[1][2] 중복은 한도 내: 장애 중 오래된 캐시가 복원되면 정기 보고가 최대 1회 더 나갈 수 있다 (시간당 2건 이하, 알림 폭주 없음)', async () => {
  const times = githubTimes(10, 5);
  const staleAt = new Set([times.findIndex(t => t >= H0 + 5 * HOUR) + 1]);           // 5시 보고 직후의 다음 실행이 직전 캐시를 놓침
  const r = await simulate({ times, scheduler: 'github', api: () => 'unverified', staleAt });
  assert.ok(Object.values(r.byHour).every(n => n <= 2)); assert.ok(r.sentReports <= 10);
  const extra = Object.values(r.byHour).filter(n => n === 2).length; assert.ok(extra <= 1, `추가 중복 ${extra}건`);
});
test('[1] Cloudflare 5분 슬롯 + 캐시 API 장애 지속: 슬롯이 이어지므로 억제 없이 매 시간 1건', async () => {
  const times = cloudflareTimes(6);
  const r = await simulate({ times, scheduler: 'cloudflare', api: () => 'unverified', initial: { lastSlot: slotOfTime(times[0]) - 1, lastAttempt: times[0] - SLOT_MS, reportHour: Math.floor(H0 / HOUR) - 1 } });
  assert.deepEqual(Object.values(r.byHour), [1, 1, 1, 1, 1, 1]); assert.equal(r.log.filter(l => l.quiet).length, 0);
});
test('[1] Cloudflare + 장애 + 정시 슬롯 1개 누락: 그 시간대 보고만 1회 생략, 다음 시간대 재개', async () => {
  const times = cloudflareTimes(6).filter((_, i) => i !== 36);                         // 3시 정각(슬롯 36) 누락 → 연속성 깨짐
  const r = await simulate({ times, scheduler: 'cloudflare', api: () => 'unverified', initial: { lastSlot: slotOfTime(times[0]) - 1, lastAttempt: times[0] - SLOT_MS, reportHour: Math.floor(H0 / HOUR) - 1 } });
  assert.deepEqual(Object.values(r.byHour), [1, 1, 1, 0, 1, 1]); assert.equal(r.log.filter(l => l.quiet).length, 1);
});
test('[1] 확실한 이상 신호(stale 유지)는 계속 억제하되, 억제한 실행이 새 캐시를 저장하므로 다음 실행부터 정상 판정되면 즉시 재개', async () => {
  const times = githubTimes(8, 3);
  const api = (t, i) => (i < 2 ? 'stale' : 'ok');
  const r = await simulate({ times, scheduler: 'github', api });
  assert.ok(r.log[0].quiet === 'cache-stale'); assert.ok(r.sentReports >= 6);
});

// ── [3] 장기 장애 경고 ──
test('[3] 이상 상태가 3시간 이상 이어지면 시간당 한 번만 alert, 중간에 정상 복귀하면 초기화', async () => {
  const r = await simulate({ times: githubTimes(8, 11), scheduler: 'github', api: () => 'unverified' });
  const alerts = r.log.filter(l => l.alert); const hours = alerts.map(l => l.hour);
  assert.equal(new Set(hours).size, hours.length, '시간당 최대 1회'); assert.ok(alerts.length >= 5);
  assert.ok(alerts.every(l => l.degradedHours >= ALERT_HOURS)); assert.equal(r.log.find(l => l.degradedHours === ALERT_HOURS - 1)?.alert ?? null, null);
  const flaky = await simulate({ times: githubTimes(8, 11), scheduler: 'github', api: (t, i) => (i % 2 ? 'ok' : 'unverified') });
  assert.equal(flaky.log.filter(l => l.alert).length, 0);
});
test('[3] evaluate: 상태 추적은 종류가 바뀌면 새로 시작하고 ok/cold에서는 삭제', () => {
  const state = {}; const e = (cacheStatus, t) => evaluate({ source: 'github-schedule', scheduler: 'github', state, now: t, cacheStatus });
  e('unverified', H0); e('unverified', H0 + HOUR); assert.equal(state.degraded.hours, 2);
  e('stale', H0 + 2 * HOUR); assert.equal(state.degraded.kind, 'stale'); assert.equal(state.degraded.hours, 1);
  e('ok', H0 + 3 * HOUR); assert.equal(state.degraded, undefined); e('cold', H0 + 4 * HOUR); assert.equal(state.degraded, undefined);
});
test('[3] quietReason fail-open: unverified에서 이미 한 시간 억제했으면 재개, stale/손상은 계속 억제', () => {
  const deg = { kind: 'unverified', quietedHours: 1 };
  assert.equal(quietReason({ cacheStatus: 'unverified', state: {}, slot: 5, degraded: deg }), null);
  assert.equal(quietReason({ cacheStatus: 'unverified', state: {}, slot: 5, degraded: { kind: 'unverified', quietedHours: 0 } }), 'cache-unverified');
  assert.equal(quietReason({ cacheStatus: 'stale', state: {}, slot: 5, degraded: { kind: 'stale', quietedHours: 9 } }), 'cache-stale');
  assert.equal(quietReason({ recovered: true, state: {}, degraded: { quietedHours: 9 } }), 'corrupt-state');
});
test('[3] --gate CLI: 경고 주석·실행 요약·alert 출력, 임계 전에는 alert=false, 임계 도달 시 ::error + alert=true', () => {
  const run = (hoursSoFar) => {
    const dir = mkdtempSync(join(tmpdir(), 'dg-')); execFileSync('mkdir', ['-p', join(dir, 's')]);
    const hour = Math.floor(Date.now() / HOUR);
    writeFileSync(join(dir, 's', 'state.json'), JSON.stringify({ lastAttempt: Date.now() - 1800000, lastSlot: 1, degraded: { kind: 'unverified', since: Date.now() - HOUR * hoursSoFar, hours: hoursSoFar, quietedHours: 1, lastHour: hour - 1 } }));
    const out = join(dir, 'o'), sum = join(dir, 'sum'); writeFileSync(out, ''); writeFileSync(sum, '');
    const log = execFileSync(process.execPath, [new URL('../run.mjs', import.meta.url).pathname, '--gate'], { env: { ...process.env, RADAR_STATE_DIR: join(dir, 's'), GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: sum, RADAR_SOURCE_EVENT: 'github-schedule', RADAR_SCHEDULER: 'github', RADAR_CACHE_STATUS: 'unverified' }, encoding: 'utf8' });
    return { log, out: readFileSync(out, 'utf8'), sum: readFileSync(sum, 'utf8') };
  };
  const early = run(1); assert.match(early.out, /alert=false/); assert.match(early.log, /::warning title=레이더 상태 연속성 경고 \(unverified\)/); assert.doesNotMatch(early.log, /::error/);
  assert.match(early.sum, /레이더 상태 연속성 경고/); assert.match(early.log, /전송은 정상 진행/);      // 이미 한 시간 억제 → fail-open
  const late = run(ALERT_HOURS); assert.match(late.out, /alert=true/); assert.match(late.log, /::error title=레이더 이상 상태 장기화/);
});
test('[3] 워크플로: 장기 이상 시 마지막에 실행을 실패로 표시하는 단계가 있고 Telegram을 보내지 않는다', () => {
  const wf = readFileSync(new URL('../../.github/workflows/radar.yml', import.meta.url), 'utf8');
  const block = wf.slice(wf.indexOf('name: Prolonged degradation alert'));
  assert.match(block, /if: always\(\) && steps\.gate\.outputs\.alert == 'true'/); assert.match(block, /exit 1/); assert.doesNotMatch(block, /TELEGRAM|curl|api\.telegram/);
  assert.ok(wf.indexOf('name: Prolonged degradation alert') > wf.indexOf('name: Verify retry save'));
});
