import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateDeploy, run, DISPATCHER, WEBSITE_WORKER } from '../verify-deploy.mjs';

const wf = readFileSync(new URL('../../.github/workflows/deploy-dispatcher.yml', import.meta.url), 'utf8');
const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

test('배포 워크플로: 수동 전용, main에서만, 확인 문구 필요, 최소 권한', () => {
  assert.match(wf, /on:\n  workflow_dispatch:/); assert.doesNotMatch(wf, /\n  (push|schedule|pull_request)/);
  assert.match(wf, /github\.ref == 'refs\/heads\/main'/); assert.match(wf, /confirm == 'deploy-disabled'/);
  assert.match(wf, /permissions:\n  contents: read/); assert.doesNotMatch(wf, /: write/);
});
test('배포 워크플로: 항상 dispatch 꺼짐으로 배포하고, 디스패처 이름을 고정해 웹사이트 Worker를 덮어쓰지 않는다', () => {
  assert.match(wf, /wrangler@4\.146\.0 deploy --name coin-radar-dispatcher --var DISPATCH_ENABLED:false/);
  assert.doesNotMatch(wf, /DISPATCH_ENABLED:true|RADAR_SCHEDULER/); assert.doesNotMatch(wf, /coin-radar-engine/);
  assert.match(toml, /name = "coin-radar-dispatcher"/); assert.notEqual(DISPATCHER, WEBSITE_WORKER);
  assert.doesNotMatch(wf, /worker\/|wrangler\.toml/);                        // 기존 Worker 설정 경로를 쓰지 않음
});
test('배포 워크플로: 비밀값은 환경변수·표준입력으로만 전달되고 출력되지 않는다', () => {
  assert.match(wf, /printf '%s' "\$DISPATCH_PAT" \| npx --yes wrangler@4\.146\.0 secret put GITHUB_DISPATCH_TOKEN --name coin-radar-dispatcher/);
  assert.doesNotMatch(wf, /echo "?\$(CLOUDFLARE_API_TOKEN|DISPATCH_PAT)|set -x|--verbose|secrets\.[A-Z_]+ *\}\}.*echo/);
  assert.doesNotMatch(wf, /TELEGRAM/);                                          // Telegram 설정 미사용
  assert.ok(wf.indexOf('Deploy dispatcher') < wf.indexOf('Register GitHub token'));   // 먼저 꺼진 상태로 배포 → 그 다음 Secret 등록
  assert.ok(wf.indexOf('Register GitHub token') < wf.indexOf('Verify deployment'));
});

const good = () => ({
  schedules: { schedules: [{ cron: '*/5 * * * *' }] },
  settings: { bindings: [{ name: 'DISPATCH_ENABLED', type: 'plain_text', text: 'false' }, { name: 'GITHUB_REPO', type: 'plain_text', text: 'a/b' }, { name: 'GITHUB_DISPATCH_TOKEN', type: 'secret_text' }] },
  subdomain: { enabled: false },
  scripts: [{ id: 'coin-radar-engine', modified_on: '2026-10-01T00:00:00Z' }, { id: 'coin-radar-dispatcher', modified_on: '2026-10-17T00:00:00Z' }],
  engineBefore: '2026-10-01T00:00:00Z',
});
test('검증 판정: 올바른 배포는 모두 통과', () => { const r = evaluateDeploy(good()); assert.equal(r.ok, true, JSON.stringify(r.checks.filter(c => !c.ok))); });
test('검증 판정: dispatch가 켜져 있거나, Secret 누락, cron 불일치, 웹사이트 Worker 변경, 공개 URL 켜짐은 실패', () => {
  const mutate = f => { const g = good(); f(g); return evaluateDeploy(g); };
  assert.equal(mutate(g => { g.settings.bindings[0].text = 'true'; }).ok, false);
  assert.equal(mutate(g => { g.settings.bindings.pop(); }).ok, false);
  assert.equal(mutate(g => { g.schedules.schedules = [{ cron: '* * * * *' }]; }).ok, false);
  assert.equal(mutate(g => { g.scripts[0].modified_on = '2026-10-17T01:00:00Z'; }).ok, false);
  assert.equal(mutate(g => { g.subdomain.enabled = true; }).ok, false);
  assert.equal(mutate(g => { g.settings.bindings.push({ name: 'TELEGRAM_BOT_TOKEN', type: 'secret_text' }); }).ok, false);
  assert.equal(mutate(g => { g.engineBefore = ''; }).ok, false);               // 사전 기록 없이 통과하지 않음
  assert.equal(mutate(g => { g.subdomain = null; }).ok, true);                  // 응답 없음은 경고로만 처리
});
test('검증 실행: 읽기 전용 GET만 사용하고 토큰은 Authorization 헤더로만 전달', async () => {
  const seen = []; const files = {};
  const api = good();
  const fetchImpl = async (url, opt) => {
    seen.push({ url, method: opt?.method ?? 'GET', auth: opt.headers.Authorization });
    const result = url.endsWith('/schedules') ? api.schedules : url.endsWith('/settings') ? api.settings : url.endsWith('/subdomain') ? api.subdomain : api.scripts;
    return new Response(JSON.stringify({ success: true, result }), { status: 200 });
  };
  const env = { CLOUDFLARE_API_TOKEN: 'cf-secret-token', CLOUDFLARE_ACCOUNT_ID: 'acc123', RUNNER_TEMP: '/tmp/x' };
  const io = { env, fetchImpl, readText: async p => files[p] ?? '', writeText: async (p, t) => { files[p] = t; } };
  const snap = await run('snapshot', io); assert.equal(snap.engineModifiedOn, '2026-10-01T00:00:00Z');
  const out = await run('verify', io); assert.equal(out.ok, true);
  assert.ok(seen.every(s => s.method === 'GET' && s.auth === 'Bearer cf-secret-token')); assert.ok(seen.every(s => !s.url.includes('cf-secret')));
  assert.ok(seen.every(s => s.url.includes('/accounts/acc123/workers/scripts')));
  assert.doesNotMatch(JSON.stringify(out), /cf-secret-token/);
  await assert.rejects(run('verify', { ...io, env: { ...env, CLOUDFLARE_API_TOKEN: '' } }), /필요합니다/);
});
test('검증 실행: 목록 조회가 권한 오류면 명확한 원인 메시지', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ success: false }), { status: 403 });
  await assert.rejects(run('verify', { env: { CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' }, fetchImpl }), /HTTP 403.*토큰 권한/);
});
