import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide, MIN_GAP_MS, TAKEOVER_MS } from '../gate.mjs';

const now = 1800000000000;
const st = ageMs => ({ lastAttempt: now - ageMs });

test('GitHub 모드(기본): 정상 간격이면 schedule 실행, 90초 안의 중복은 건너뜀', () => {
  assert.equal(decide({ source: 'github-schedule', state: st(300000), now }).run, true);
  assert.equal(decide({ source: 'github-schedule', state: st(30000), now }).run, false);
  assert.equal(decide({ source: 'github-schedule', state: {}, now }).run, true); // 캐시 유실 → 실행
});
test('롤백 상태(RADAR_SCHEDULER=github)에서는 Cloudflare 디스패치를 무시한다 — 두 스케줄러 동시 작동 방지', () => {
  const d = decide({ source: 'cloudflare', scheduler: 'github', state: st(600000), now });
  assert.equal(d.run, false); assert.match(d.reason, /롤백/);
});
test('Cloudflare 모드: 디스패치는 실행, 같은 슬롯 중복(90초 내)은 건너뜀', () => {
  assert.equal(decide({ source: 'cloudflare', scheduler: 'cloudflare', state: st(280000), now }).run, true);
  assert.equal(decide({ source: 'cloudflare', scheduler: 'cloudflare', state: st(MIN_GAP_MS - 1), now }).run, false);
  assert.equal(decide({ source: 'cloudflare', scheduler: 'cloudflare', state: st(MIN_GAP_MS), now }).run, true);
});
test('Cloudflare 모드: GitHub schedule은 대기하다가 15분 넘게 공백이면 대신 실행(자동 복구)', () => {
  assert.equal(decide({ source: 'github-schedule', scheduler: 'cloudflare', state: st(300000), now }).run, false);
  assert.equal(decide({ source: 'github-schedule', scheduler: 'cloudflare', state: st(TAKEOVER_MS), now }).run, false);
  assert.equal(decide({ source: 'github-schedule', scheduler: 'cloudflare', state: st(TAKEOVER_MS + 1), now }).run, true);
  assert.equal(decide({ source: 'github-schedule', scheduler: 'cloudflare', state: {}, now }).run, true);
});
test('수동·푸시 실행은 항상 허용되고, 알 수 없는 변수 값은 github 모드로 취급', () => {
  for (const scheduler of ['github', 'cloudflare']) assert.equal(decide({ source: 'manual', scheduler, state: st(1000), now }).run, true);
  assert.equal(decide({ source: 'cloudflare', scheduler: 'whatever', state: st(600000), now }).mode, 'github');
});
test('한 슬롯(5분)에 두 스케줄러가 모두 발화해도 수집은 한 번만', () => {
  const fire = (scheduler, events) => {
    let state = { lastAttempt: now - 300000 }, runs = 0;
    for (const [source, t] of events) if (decide({ source, scheduler, state, now: t }).run) { runs++; state = { lastAttempt: t }; }
    return runs;
  };
  const events = [['cloudflare', now], ['github-schedule', now + 20000], ['cloudflare', now + 40000], ['github-schedule', now + 60000]];
  assert.equal(fire('cloudflare', events), 1);  // Cloudflare 모드: 디스패치 1회만 실행
  assert.equal(fire('github', events), 1);      // 롤백 모드: Cloudflare는 무시, schedule 1회만 실행
});

// ── CLI(--gate) 통합: 실제 run.mjs와 GITHUB_OUTPUT ──
const runGate = (dir, env) => {
  const out = join(dir, 'gh_output'); writeFileSync(out, '');
  const log = execFileSync(process.execPath, [new URL('../run.mjs', import.meta.url).pathname, '--gate'], { env: { ...process.env, RADAR_STATE_DIR: join(dir, 's'), GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: join(dir, 'summary.md'), ...env }, encoding: 'utf8' });
  return { log, out: readFileSync(out, 'utf8') };
};
test('--gate: 상태 없음 → 실행, 최근 시도 → 건너뜀, GITHUB_OUTPUT에 run= 기록', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  assert.match(runGate(dir, { RADAR_SOURCE_EVENT: 'cloudflare', RADAR_SCHEDULER: 'cloudflare' }).out, /run=true/);
  writeFileSync(join(dir, 's', 'state.json'), JSON.stringify({ lastAttempt: Date.now() - 20000, seq: 7 }));
  const r = runGate(dir, { RADAR_SOURCE_EVENT: 'cloudflare', RADAR_SCHEDULER: 'cloudflare' });
  assert.match(r.out, /run=false/); assert.match(r.log, /GATE 건너뜀/); assert.match(r.log, /seq=7/);
});
test('--gate: 손상된 상태 파일은 보존하고 새 상태로 시작한다(레이더 영구 정지 방지)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  runGate(dir, { RADAR_SOURCE_EVENT: 'manual' });
  writeFileSync(join(dir, 's', 'state.json'), '{broken');
  const r = runGate(dir, { RADAR_SOURCE_EVENT: 'github-schedule' });
  assert.match(r.out, /run=true/); assert.match(r.log, /::warning title=레이더 상태 손상/);
  assert.ok(readdirSync(join(dir, 's')).some(f => f.startsWith('state.corrupt-')));
  // 새 상태가 기록되고, 이번 시간대 Telegram 전송 억제(quiet)가 걸린다
  const fresh = JSON.parse(readFileSync(join(dir, 's', 'state.json'), 'utf8'));
  assert.equal(fresh.quiet.reason, 'corrupt-state'); assert.equal(fresh.quiet.hour, Math.floor(Date.now() / 3600000)); assert.match(r.log, /Telegram 전송 억제/);
});

// ── 워크플로 구조 점검 ──
const wf = readFileSync(new URL('../../.github/workflows/radar.yml', import.meta.url), 'utf8');
test('워크플로: 게이트가 수집 단계보다 먼저 있고, 수집·저장 단계는 게이트 결과로 제한된다', () => {
  const idx = k => wf.indexOf(k);
  assert.ok(idx('name: Restore state') < idx('name: Gate') && idx('name: Gate') < idx('name: Run radar'));
  for (const name of ['Run radar', 'Unit tests', 'Save state', 'Verify state saved']) {
    const block = wf.slice(idx(`name: ${name}`), idx(`name: ${name}`) + 300);
    assert.match(block, /steps\.gate\.outputs\.run == 'true'/, name);
  }
  assert.match(wf, /concurrency:\n  group: radar\n  cancel-in-progress: false/); assert.match(wf, /timeout-minutes: 8/);
  assert.match(wf, /run-name: .*slot/); assert.match(wf, /cron: '\*\/5 \* \* \* \*'/); // GitHub schedule은 백업으로 유지
});
test('워크플로: 상태 저장 검증 실패 시 다른 키로 재저장하고 재검증한다', () => {
  assert.match(wf, /id: verify\n\s+continue-on-error: true/); assert.match(wf, /steps\.verify\.outcome == 'failure'/); assert.match(wf, /-retry/);
});
