import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker, { tick, slotOf, SLOT_MS } from '../worker.mjs';

const T = Date.UTC(2026, 9, 15, 8, 0, 0);          // 정각 슬롯
const SLOT = slotOf(T);
const env = { GITHUB_DISPATCH_TOKEN: 'ghp_TESTSECRET123', DISPATCH_ENABLED: 'true' };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const run = (title, status, minutesAgo = 1) => ({ display_title: title, status, created_at: new Date(T - minutesAgo * 60000).toISOString() });
const noWait = { wait: async () => {}, now: () => T };

// GitHub 모의: 실행 목록과 dispatch 응답을 순서대로 지정
function fakeGh({ runs = [], dispatch = [204], listStatus = 200 } = {}) {
  const calls = []; let d = 0;
  const f = async (url, opt = {}) => {
    calls.push({ url, method: opt.method, headers: opt.headers, body: opt.body });
    if (opt.method === 'POST') { const r = dispatch[Math.min(d++, dispatch.length - 1)]; if (r instanceof Error) throw r; return typeof r === 'number' ? new Response(null, { status: r }) : r; }
    return json({ workflow_runs: typeof runs === 'function' ? runs(calls) : runs }, listStatus);
  };
  f.calls = calls; return f;
}
const posts = f => f.calls.filter(c => c.method === 'POST');

test('정상: 슬롯 번호와 source=cloudflare를 담아 dispatch를 정확히 1번 호출한다', async () => {
  const f = fakeGh();
  const r = await tick(env, T, { fetchImpl: f, ...noWait });
  assert.equal(r.decision, 'dispatched'); assert.equal(posts(f).length, 1);
  assert.match(posts(f)[0].url, /\/repos\/j01044459979-prog\/coin-radar\/actions\/workflows\/radar\.yml\/dispatches$/);
  assert.deepEqual(JSON.parse(posts(f)[0].body), { ref: 'main', inputs: { source: 'cloudflare', slot: String(SLOT) } });
  assert.equal(posts(f)[0].headers.Authorization, 'Bearer ghp_TESTSECRET123');
});
test('킬 스위치: DISPATCH_ENABLED가 true가 아니면 GitHub를 전혀 호출하지 않는다', async () => {
  for (const v of ['false', undefined, '', 'TRUE ']) {
    const f = fakeGh(); const r = await tick({ ...env, DISPATCH_ENABLED: v }, T, { fetchImpl: f, ...noWait });
    assert.equal(r.decision, 'disabled'); assert.equal(f.calls.length, 0);
  }
  assert.equal((await tick({ DISPATCH_ENABLED: 'true' }, T, { fetchImpl: fakeGh(), ...noWait })).decision, 'no-token');
});
test('같은 슬롯의 실행이 이미 있으면 다시 dispatch하지 않는다 (cron 이중 발화·재시도)', async () => {
  const f = fakeGh({ runs: [run(`radar · workflow_dispatch · cloudflare · slot ${SLOT}`, 'in_progress')] });
  const r = await tick(env, T, { fetchImpl: f, ...noWait });
  assert.equal(r.decision, 'skip-duplicate-slot'); assert.equal(posts(f).length, 0);
  // 슬롯 번호가 접두어만 같은 다른 슬롯은 중복으로 보지 않는다
  const f2 = fakeGh({ runs: [run(`radar · workflow_dispatch · cloudflare · slot ${SLOT}9`, 'completed')] });
  assert.equal((await tick(env, T, { fetchImpl: f2, ...noWait })).decision, 'dispatched');
});
test('이미 대기 중인 실행이 있으면 건너뛰고, 15분 넘게 멈춘 대기 실행은 무시한다', async () => {
  const f = fakeGh({ runs: [run('radar · schedule · - · slot -', 'queued', 2)] });
  assert.equal((await tick(env, T, { fetchImpl: f, ...noWait })).decision, 'skip-pending-exists'); assert.equal(posts(f).length, 0);
  const stale = fakeGh({ runs: [run('radar · schedule · - · slot -', 'queued', 40)] });
  assert.equal((await tick(env, T, { fetchImpl: stale, ...noWait })).decision, 'dispatched');
  // 실행 중(in_progress) 하나만 있으면 다음 슬롯 대기열을 위해 dispatch한다
  const running = fakeGh({ runs: [run(`radar · workflow_dispatch · cloudflare · slot ${SLOT - 1}`, 'in_progress', 4)] });
  assert.equal((await tick(env, T, { fetchImpl: running, ...noWait })).decision, 'dispatched');
});
test('일시 오류(5xx)·네트워크 오류는 재시도하되, 재시도 전에 접수 여부를 확인해 중복 dispatch하지 않는다', async () => {
  // 1) 응답은 오류였지만 GitHub는 이미 접수 → 재조회에서 슬롯 실행 발견 → 추가 POST 없음
  let polls = 0;
  const f = fakeGh({ dispatch: [502], runs: () => (++polls >= 2 ? [run(`radar · workflow_dispatch · cloudflare · slot ${SLOT}`, 'queued', 0)] : []) });
  const r = await tick(env, T, { fetchImpl: f, ...noWait });
  assert.equal(r.decision, 'dispatched-confirmed'); assert.equal(posts(f).length, 1);
  // 2) 네트워크 오류 후 성공
  const g = fakeGh({ dispatch: [new TypeError('network'), 204] });
  const r2 = await tick(env, T, { fetchImpl: g, ...noWait });
  assert.equal(r2.decision, 'dispatched'); assert.equal(r2.attempt, 2); assert.equal(posts(g).length, 2);
  // 3) 계속 실패하면 최대 3회 후 포기(다음 cron에서 새 슬롯으로 재시도)
  const h = fakeGh({ dispatch: [500] });
  const r3 = await tick(env, T, { fetchImpl: h, ...noWait });
  assert.equal(r3.decision, 'failed'); assert.equal(posts(h).length, 3);
});
test('429/403 + Retry-After: 짧으면 기다렸다 재시도, 길면 포기하고 다음 슬롯에 맡긴다', async () => {
  const waits = [];
  const f = fakeGh({ dispatch: [new Response(null, { status: 429, headers: { 'retry-after': '3' } }), 204] });
  const r = await tick(env, T, { fetchImpl: f, wait: async ms => waits.push(ms), now: () => T });
  assert.equal(r.decision, 'dispatched'); assert.deepEqual(waits, [3000]);
  const g = fakeGh({ dispatch: [new Response(null, { status: 403, headers: { 'retry-after': '120' } })] });
  const r2 = await tick(env, T, { fetchImpl: g, ...noWait });
  assert.equal(r2.decision, 'failed'); assert.equal(r2.retryAfter, 120); assert.equal(posts(g).length, 1);
});
test('인증·권한·설정 오류(401/403/404/422)는 재시도하지 않고 원인 힌트를 남긴다 (토큰은 로그에 없음)', async () => {
  for (const status of [401, 403, 404, 422]) {
    const f = fakeGh({ dispatch: [status] });
    const r = await tick(env, T, { fetchImpl: f, ...noWait });
    assert.equal(r.decision, 'rejected'); assert.equal(r.status, status); assert.ok(r.hint); assert.equal(posts(f).length, 1);
    assert.doesNotMatch(JSON.stringify(r), /ghp_TESTSECRET123/);
  }
  const lf = fakeGh({ listStatus: 401 });
  const r = await tick(env, T, { fetchImpl: lf, ...noWait });
  assert.equal(r.decision, 'inspect-failed'); assert.equal(posts(lf).length, 0);
});
test('scheduled(): 결과를 로그로 남기며 토큰을 출력하지 않고, fetch는 정보를 노출하지 않는다', async () => {
  const lines = []; const orig = console.log; console.log = x => lines.push(String(x));
  const origFetch = globalThis.fetch; const f = fakeGh(); globalThis.fetch = f;
  try { await worker.scheduled({ scheduledTime: T }, env, {}); } finally { console.log = orig; globalThis.fetch = origFetch; }
  assert.equal(lines.length, 1); assert.match(lines[0], /"decision":"dispatched"/); assert.doesNotMatch(lines[0], /ghp_|TESTSECRET/);
  assert.equal(worker.fetch().status, 404);
});
test('슬롯 번호: 같은 5분 안의 발화는 같은 슬롯, 다음 5분은 다음 슬롯', () => {
  assert.equal(slotOf(T), slotOf(T + 59999)); assert.equal(slotOf(T + SLOT_MS), slotOf(T) + 1);
  assert.equal(slotOf(T + 2000), SLOT);   // 약간 늦게 발화해도 같은 슬롯
});
test('설정 파일: 비밀값이 없고, workers.dev 공개 URL이 꺼져 있으며 기본값은 디스패치 꺼짐', () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /workers_dev = false/); assert.match(toml, /DISPATCH_ENABLED = "false"/); assert.match(toml, /crons = \["\*\/5 \* \* \* \*"\]/);
  assert.doesNotMatch(toml, /ghp_|github_pat_|TOKEN\s*=/);
  assert.doesNotMatch(readFileSync(new URL('../worker.mjs', import.meta.url), 'utf8'), /ghp_|github_pat_/);
});
