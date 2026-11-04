// 승인된 변수 변경 경로: 허용 목록·워크플로 안전 장치(네트워크·GitHub 호출 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ALLOWED, checkVariable } from '../variable-guard.mjs';

const wf = readFileSync(new URL('../../.github/workflows/set-variable.yml', import.meta.url), 'utf8');
test('허용 목록: 버튼·조용한 모드 on/off, FIB off/preview 만. FIB on·목록 밖 변수·목록 밖 값은 거부', () => {
  for (const [n, vs] of Object.entries(ALLOWED)) for (const v of vs) assert.equal(checkVariable(n, v).ok, true, `${n}=${v}`);
  assert.equal(checkVariable('RADAR_FIB_PULLBACK', 'on').ok, false);
  for (const n of ['RADAR_SCHEDULER', 'RADAR_OPPORTUNITY', 'RADAR_OPPORTUNITY_TOP', 'RADAR_SIGNAL', 'RADAR_RICH300_FEED', 'DISPATCH_ENABLED', 'TELEGRAM_BOT_TOKEN', '__proto__', 'toString', '']) assert.equal(checkVariable(n, 'on').ok, false, n);
  for (const v of ['ON', ' on', 'true', '1', '', undefined, 'on;rm']) assert.equal(checkVariable('RADAR_RICH300_BUTTONS', v).ok, false, String(v));
});
test('CLI: 허용 값은 종료 코드 0, FIB on·목록 밖은 1', () => {
  const run = (...a) => { try { execFileSync(process.execPath, [new URL('../variable-guard.mjs', import.meta.url).pathname, ...a], { stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
  assert.equal(run('RADAR_RICH300_BUTTONS', 'on'), 0); assert.equal(run('RADAR_FIB_PULLBACK', 'preview'), 0);
  assert.equal(run('RADAR_FIB_PULLBACK', 'on'), 1); assert.equal(run('RADAR_SCHEDULER', 'github'), 1);
});
test('워크플로: 수동 전용·main 만·확인 문구(set 일 때)·최소 권한·허용 목록 검사가 쓰기보다 먼저·재조회 검증', () => {
  assert.match(wf, /on:\n  workflow_dispatch:/); assert.doesNotMatch(wf, /\n  (push|schedule|pull_request)/);
  assert.match(wf, /github\.ref == 'refs\/heads\/main'/); assert.match(wf, /inputs\.mode == 'read' \|\| github\.event\.inputs\.confirm == 'set-variable'/);
  assert.match(wf, /permissions:\n  contents: read/); assert.doesNotMatch(wf, /: write/);
  assert.ok(wf.indexOf('Guard (allow-list)') < wf.indexOf('Check required secret') && wf.indexOf('Check required secret') < wf.indexOf('gh variable set'));
  assert.ok(wf.indexOf('gh variable set') < wf.indexOf('Read back and verify')); assert.match(wf, /\[ "\$after" != "\$VALUE" \].*exit 1/);
});
test('읽기 검증: 인증 실패를 (unset)으로 오인하지 않는다(목록 조회 성공이 선행, 404 만 unset, 그 밖의 오류는 실패)', () => {
  assert.ok(wf.indexOf('Verify token can read variables') < wf.indexOf('Read current value') && wf.indexOf('Read current value') < wf.indexOf('gh variable set'));
  assert.match(wf, /actions\/variables" --jq '\.total_count'/); assert.match(wf, /grep -q "HTTP 404"/); assert.match(wf, /404 가 아닌 오류[\s\S]{0,160}exit 1/);
  assert.doesNotMatch(wf, /2>\/dev\/null/);
});
test('YAML 불리언 함정: value 옵션과 기본값이 따옴표 문자열이고, 파싱하면 문자열 on/off/preview 로 남는다', () => {
  assert.match(wf, /options: \['off', 'on', 'preview'\]/); assert.match(wf, /default: 'off'/);
  assert.doesNotMatch(wf, /options: \[off, on, preview\]/);
  const py = execFileSync('python3', ['-c', "import yaml,sys,json;d=yaml.safe_load(open(sys.argv[1]));i=d[True]['workflow_dispatch']['inputs']['value'];print(json.dumps([i['options'],i['default']]))", new URL('../../.github/workflows/set-variable.yml', import.meta.url).pathname]).toString();
  assert.deepEqual(JSON.parse(py), [['off', 'on', 'preview'], 'off']);
});
test('워크플로: Secret 은 환경변수로만, 출력·디버그 없음, 다른 Secret·Telegram·Cloudflare 미접촉', () => {
  assert.match(wf, /GH_TOKEN: \$\{\{ secrets\.RADAR_VARS_PAT \}\}/); assert.equal((wf.match(/secrets\./g) || []).length, 1);
  assert.doesNotMatch(wf, /echo "?\$GH_TOKEN|set -x|--verbose|TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID|CLOUDFLARE|RICH300_FEED_KEY|continue-on-error/);
});
