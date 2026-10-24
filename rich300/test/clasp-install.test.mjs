// clasp 설치 스크립트 시험: 가짜 clasp(PATH 대체)·로컬 저장소 사본으로 실행한다. 네트워크·Google 호출 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../deploy/clasp-install.sh', import.meta.url)), DIST = fileURLToPath(new URL('../apps-script', import.meta.url));
const sha = b => createHash('sha256').update(b).digest('hex');
const FAKE = `#!/usr/bin/env bash
echo "$@" >> "$FAKE_LOG"
case "$1" in
  login) [[ "$FAKE_LOGIN_FAIL" == 1 ]] && exit 1; echo '{}' > "$HOME/.clasprc.json" ;;
  push) [[ "$FAKE_PUSH_FAIL" == 1 ]] && exit 1; mkdir -p "$FAKE_REMOTE"; for f in *; do [[ "$f" == .clasp.json ]] || cp "$f" "$FAKE_REMOTE/$f"; done; [[ "$FAKE_CORRUPT" == 1 ]] && echo '// x' >> "$FAKE_REMOTE/Code.gs"; true ;;
  pull) cp "$FAKE_REMOTE"/* . ;;
  logout) rm -f "$HOME/.clasprc.json" ;;
  *) echo "허용되지 않은 clasp 명령: $1" >&2; exit 9 ;;
esac`;
function run({ mutate, env = {}, args = [] } = {}) {
  const root = mkdtempSync(`${tmpdir()}/r300-`), src = `${root}/src`, bin = `${root}/fakeclasp`; mkdirSync(`${src}/rich300`, { recursive: true }); cpSync(DIST, `${src}/rich300/apps-script`, { recursive: true });
  if (mutate) mutate(`${src}/rich300/apps-script`);
  writeFileSync(bin, FAKE, { mode: 0o755 }); mkdirSync(`${root}/home`);
  const e = { PATH: process.env.PATH, HOME: `${root}/home`, RICH300_SRC_DIR: src, RICH300_CLASP: bin, FAKE_LOG: `${root}/clasp.log`, FAKE_REMOTE: `${root}/remote`, ...env };
  const r = spawnSync('bash', [SCRIPT, ...args], { env: e, encoding: 'utf8' }), log = existsSync(e.FAKE_LOG) ? readFileSync(e.FAKE_LOG, 'utf8').trim().split('\n') : [];
  const out = { r, log, remote: e.FAKE_REMOTE, home: `${root}/home`, root }; return out;
}
const fixManifest = d => { const rows = ['Code.gs', 'Fill.html', 'appsscript.json'].map(n => `${sha(readFileSync(`${d}/${n}`))}  ${String(readFileSync(`${d}/${n}`).length).padStart(8)}  ${n}`); writeFileSync(`${d}/MANIFEST.txt`, `RICH300 Apps Script bundle\n${rows.join('\n')}\n`); };

test('정상: 검증 → 로그인 → 이 프로젝트에만 push → 다시 내려받아 일치 확인 → 로그아웃(토큰 삭제), 허용된 clasp 명령만 사용', () => {
  const x = run(); assert.equal(x.r.status, 0, x.r.stdout + x.r.stderr); assert.match(x.r.stdout, /\[PASS\] 설치 파일 3개/); assert.match(x.r.stdout, /\[PASS\] 반영 완료/);
  assert.deepEqual(x.log.map(l => l.split(' ')[0]), ['login', 'push', 'pull', 'logout']); assert.ok(x.log[0].includes('--no-localhost')); assert.equal(existsSync(`${x.home}/.clasprc.json`), false);
  assert.deepEqual(readdirSync(x.remote).sort(), ['Code.gs', 'Fill.html', 'appsscript.json']); assert.equal(readFileSync(`${x.remote}/Code.gs`, 'utf8'), readFileSync(`${DIST}/Code.gs`, 'utf8'));
  assert.ok(!/Telegram|deploy|create|delete|run /i.test(x.log.join('\n')));
});
test('스크립트 ID 인자: 형식이 이상하면 거부(로그인 시도 없음), 올바르면 .clasp.json 에 그 ID 만 사용', () => {
  let x = run({ args: ['bad id; rm -rf /'] }); assert.notEqual(x.r.status, 0); assert.equal(x.log.length, 0); assert.match(x.r.stdout, /형식이 올바르지 않습니다/);
  x = run({ args: ['ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef'] }); assert.equal(x.r.status, 0);
});
test('끝이 잘린 Code.gs(실제 사고)·해시 불일치·문법 오류·더 열린 매니페스트는 로그인 전에 중단한다', () => {
  const cases = [d => { const s = readFileSync(`${d}/Code.gs`, 'utf8'); writeFileSync(`${d}/Code.gs`, s.slice(0, s.lastIndexOf('\n}\n') + 1)); }, d => writeFileSync(`${d}/Fill.html`, '<html></html>'),
    d => { writeFileSync(`${d}/Code.gs`, 'function broken( {\n}\n'); fixManifest(d); }, d => { const m = JSON.parse(readFileSync(`${d}/appsscript.json`, 'utf8')); m.webapp = { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' }; writeFileSync(`${d}/appsscript.json`, JSON.stringify(m)); fixManifest(d); },
    d => { const s = readFileSync(`${d}/Code.gs`, 'utf8'); writeFileSync(`${d}/Code.gs`, s.slice(0, s.lastIndexOf('\n}\n') + 1)); fixManifest(d); }];
  for (const [i, mutate] of cases.entries()) { const x = run({ mutate }); assert.notEqual(x.r.status, 0, `case ${i}`); assert.equal(x.log.length, 0, `case ${i}: 로그인·push 전에 중단`); assert.match(x.r.stdout, /\[FAIL\]/); }
});
test('로그인·push 실패는 FAIL, 쓴 뒤 내용이 다르면 FAIL, 어느 경우든 로그아웃한다', () => {
  let x = run({ env: { FAKE_LOGIN_FAIL: '1' } }); assert.notEqual(x.r.status, 0); assert.ok(x.log.includes('logout'));
  x = run({ env: { FAKE_PUSH_FAIL: '1' } }); assert.notEqual(x.r.status, 0); assert.match(x.r.stdout, /push 실패/); assert.ok(x.log.includes('logout')); assert.ok(!x.log.includes('pull'));
  x = run({ env: { FAKE_CORRUPT: '1' } }); assert.notEqual(x.r.status, 0); assert.match(x.r.stdout, /반영된 Code\.gs 가 설치 파일과 다릅니다/); assert.ok(x.log.includes('logout'));
});
test('스크립트 자체: 새 프로젝트 생성(create)·삭제·배포(deploy)·Telegram·스크립트 속성 변경 명령이 없고 clasp 버전을 고정한다', () => {
  const s = readFileSync(SCRIPT, 'utf8').replace(/^#.*$/gm, ''); assert.ok(!/clasp(\s+-\w+)*\s+(create|deploy|delete|undeploy|run|setting|open)\b|\$CLASP (create|deploy|delete|undeploy|run|setting)\b/.test(s)); assert.ok(!/api\.telegram|TELEGRAM|TG_TOKEN|PROD_APPROVED/.test(s)); assert.match(s, /@google\/clasp@3\.3\.0/);
  assert.match(s, /set -euo pipefail/);
});
