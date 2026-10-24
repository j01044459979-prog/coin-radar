// clasp 설치 스크립트 시험: 가짜 clasp(원격 프로젝트 = 임시 디렉터리)·로컬 git 저장소 사본으로 실행한다. 네트워크·Google 호출 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../deploy/clasp-install.sh', import.meta.url)), DIST = fileURLToPath(new URL('../apps-script', import.meta.url));
const ID = 'abcDEF123_ghiJKL456-mnoPQR789stuVWX', LAST6 = ID.slice(-6), FAKE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const sha = b => createHash('sha256').update(b).digest('hex');
const FAKE = `#!/usr/bin/env bash
echo "$@ [id=$(grep -o '"scriptId":"[^"]*"' .clasp.json 2>/dev/null | cut -d'"' -f4)]" >> "$FAKE_LOG"
case "$1" in
  login) [[ "$FAKE_LOGIN_FAIL" == 1 ]] && exit 1; echo '{}' > "$HOME/.clasprc.json" ;;
  push) n=$(cat "$FAKE_STATE/pushes" 2>/dev/null || echo 0); echo $((n+1)) > "$FAKE_STATE/pushes"
        if [[ "$n" == 0 && "$FAKE_PUSH_FAIL" == 1 ]]; then cp Code.gs "$FAKE_REMOTE/Code.gs"; exit 1; fi
        if [[ "$n" -ge 1 && "$FAKE_RESTORE_FAIL" == 1 ]]; then exit 1; fi
        rm -rf "$FAKE_REMOTE"/*; for f in *; do [[ "$f" == .clasp.json ]] || cp "$f" "$FAKE_REMOTE/$f"; done
        [[ "$n" == 0 && "$FAKE_CORRUPT_ONCE" == 1 ]] && echo '// x' >> "$FAKE_REMOTE/Code.gs"; true ;;
  pull) [[ "$FAKE_PULL_FAIL" == 1 ]] && exit 1; cp "$FAKE_REMOTE"/* . ;;
  logout) rm -f "$HOME/.clasprc.json" ;;
  *) echo "허용되지 않은 clasp 명령: $1" >&2; exit 9 ;;
esac`;
const BOOT = "function rich300Bootstrap() {}\nfunction rich300BootstrapCheck() {}\n";
function setup({ remote = { 'Code.gs': BOOT, 'appsscript.json': '{"timeZone":"Asia/Seoul"}', 'Fill.html': '<html></html>' }, mutate } = {}) {
  const root = mkdtempSync(`${tmpdir()}/r300-`), src = `${root}/src`, bin = `${root}/fakeclasp`, rem = `${root}/remote`, state = `${root}/state`;
  mkdirSync(`${src}/rich300`, { recursive: true }); cpSync(DIST, `${src}/rich300/apps-script`, { recursive: true }); if (mutate) mutate(`${src}/rich300/apps-script`);
  mkdirSync(rem); mkdirSync(state); mkdirSync(`${root}/home`); for (const [n, c] of Object.entries(remote)) writeFileSync(`${rem}/${n}`, c);
  writeFileSync(bin, FAKE, { mode: 0o755 }); return { root, src, bin, rem, state, home: `${root}/home`, log: `${root}/clasp.log` };
}
function run(w, { args = [ID, FAKE_COMMIT], env = {} } = {}) {
  const e = { PATH: process.env.PATH, HOME: w.home, RICH300_SRC_DIR: w.src, RICH300_CLASP: w.bin, RICH300_CONFIRM: LAST6, FAKE_LOG: w.log, FAKE_REMOTE: w.rem, FAKE_STATE: w.state, ...env };
  const r = spawnSync('bash', [SCRIPT, ...args], { env: e, encoding: 'utf8', input: '' }); const log = existsSync(w.log) ? readFileSync(w.log, 'utf8').trim().split('\n') : [];
  return { r, log, out: r.stdout + r.stderr, cmds: log.map(l => l.split(' ')[0]), backups: readdirSync(w.home).filter(n => n.startsWith('rich300-backup-')) };
}
const remoteFiles = w => Object.fromEntries(readdirSync(w.rem).map(n => [n, readFileSync(`${w.rem}/${n}`, 'utf8')]));
const fixManifest = d => { const rows = ['Code.gs', 'Fill.html', 'appsscript.json'].map(n => `${sha(readFileSync(`${d}/${n}`))}  ${String(readFileSync(`${d}/${n}`).length).padStart(8)}  ${n}`); writeFileSync(`${d}/MANIFEST.txt`, `RICH300 Apps Script bundle\n${rows.join('\n')}\n`); };

test('정상: 백업 → 대상·변경 표시 → 확인 → push(이 프로젝트 ID 로만) → 다시 내려받아 일치 → 로그아웃, 허용된 clasp 명령만', () => {
  const w = setup({ remote: { 'Code.gs': BOOT, 'appsscript.json': '{}', 'Fill.html': '<x>', 'Extra.gs': 'old' } }), x = run(w); assert.equal(x.r.status, 0, x.out);
  assert.match(x.out, new RegExp(`대상 프로젝트 ID: ${ID}`)); assert.match(x.out, /현재 원격 파일/); assert.match(x.out, /교체: Code\.gs/); assert.match(x.out, /교체: Fill\.html/); assert.match(x.out, /교체: appsscript\.json/); assert.match(x.out, /삭제\(이 프로젝트에서만\): Extra\.gs/); assert.match(x.out, /\[PASS\] 반영 완료/);
  assert.deepEqual(x.cmds, ['login', 'pull', 'push', 'pull', 'logout']); assert.ok(x.log.every(l => l.endsWith(`[id=${ID}]`) || l.startsWith('login') || l.startsWith('logout')));      // 모든 clasp 호출이 지정한 ID 의 .clasp.json 으로만
  assert.equal(x.backups.length, 1); const bdir = `${w.home}/${x.backups[0]}`; assert.ok(x.backups[0].endsWith(LAST6)); assert.equal(readFileSync(`${bdir}/Code.gs`, 'utf8'), BOOT); assert.equal(readFileSync(`${bdir}/Extra.gs`, 'utf8'), 'old'); assert.equal(existsSync(`${w.home}/.clasprc.json`), false);
  assert.deepEqual(Object.keys(remoteFiles(w)).sort(), ['Code.gs', 'Fill.html', 'appsscript.json']); assert.equal(remoteFiles(w)['Code.gs'], readFileSync(`${DIST}/Code.gs`, 'utf8'));
});
test('기본값 없음: 프로젝트 ID·커밋 인자가 없거나 형식이 틀리면 로그인 전에 중단(clasp 호출 0건)', () => {
  for (const args of [[], [ID], [ID, 'main'], [ID, FAKE_COMMIT.slice(0, 12)], ['', FAKE_COMMIT], ['bad id; rm -rf /', FAKE_COMMIT], ['short', FAKE_COMMIT]]) { const x = run(setup(), { args }); assert.notEqual(x.r.status, 0, JSON.stringify(args)); assert.equal(x.log.length, 0, JSON.stringify(args)); assert.match(x.out, /\[FAIL\]/); }
  assert.ok(!/14pE8sbp|SCRIPT_ID="\$\{1:-[^}]/.test(readFileSync(SCRIPT, 'utf8')));                                    // 하드코딩된 기본 ID 없음
});
test('설치 파일도 지정한 커밋 그대로: git 에서 그 커밋만 받아 검증하고, 다른 커밋이면 중단한다', () => {
  const root = mkdtempSync(`${tmpdir()}/r300g-`), repo = `${root}/repo`, g = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  mkdirSync(`${repo}/rich300`, { recursive: true }); cpSync(DIST, `${repo}/rich300/apps-script`, { recursive: true }); spawnSync('git', ['init', '-q', repo]); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'uploadpack.allowAnySHA1InWant', 'true'); g('add', '-A'); g('commit', '-qm', 'one');
  const c1 = g('rev-parse', 'HEAD').stdout.trim(); writeFileSync(`${repo}/rich300/apps-script/Fill.html`, '<html>변조</html>'); g('commit', '-qam', 'two'); const c2 = g('rev-parse', 'HEAD').stdout.trim();
  const w = setup(); const env = { RICH300_SRC_DIR: '', RICH300_REPO: `file://${repo}` };
  let x = run(w, { args: [ID, c1], env }); assert.equal(x.r.status, 0, x.out); assert.match(x.out, new RegExp(`커밋 ${c1.slice(0, 12)}`));                                    // 검증된 커밋: 정상
  const w2 = setup(); x = run(w2, { args: [ID, c2], env }); assert.notEqual(x.r.status, 0); assert.match(x.out, /Fill\.html 가 MANIFEST 와 다릅니다/); assert.equal(x.log.length, 0);          // 그 뒤 변조된 커밋: 로그인 전 중단
  const w3 = setup(); x = run(w3, { args: [ID, 'f'.repeat(40)], env }); assert.notEqual(x.r.status, 0); assert.match(x.out, /받지 못했습니다/); assert.equal(x.log.length, 0);
  assert.match(readFileSync(SCRIPT, 'utf8'), /fetch -q --depth 1 origin "\$COMMIT"/); assert.ok(!/-b "\$REF"|release\/rich300-prod\b.*clone|clone .*-b/.test(readFileSync(SCRIPT, 'utf8').replace(/^#.*$/gm, '')));          // 브랜치 이름으로 받지 않는다
});
test('잘못된 프로젝트 보호: 원격이 RICH300 부트스트랩/설치 상태가 아니거나 S0 프로젝트면 push 없이 중단(백업은 남김)', () => {
  for (const code of ['function myFunction() {}\n', 'function rich300Bootstrap() {}\nfunction s0Compat() {}\n', 'const radar = 1;\n']) {
    const w = setup({ remote: { 'Code.gs': code, 'appsscript.json': '{}' } }), x = run(w); assert.notEqual(x.r.status, 0); assert.match(x.out, /RICH300 부트스트랩\/설치 상태가 아닙니다/); assert.ok(!x.cmds.includes('push')); assert.equal(remoteFiles(w)['Code.gs'], code); assert.equal(x.backups.length, 1);
  }
  const w = setup({ remote: { 'Code.gs': 'function myFunction() {}\n', 'appsscript.json': '{}' } }); const x = run(w, { env: { RICH300_FORCE: '1' } }); assert.equal(x.r.status, 0);                                   // 명시적 강제만 허용
});
test('확인 절차: 프로젝트 ID 마지막 6글자를 입력해야 진행(틀리거나 입력 불가면 push 없이 중단)', () => {
  let w = setup(), x = run(w, { env: { RICH300_CONFIRM: 'WRONG1' } }); assert.notEqual(x.r.status, 0); assert.ok(!x.cmds.includes('push')); assert.match(x.out, /대상 프로젝트 ID/);              // 표시는 하되 진행하지 않음
  w = setup(); x = run(w, { env: { RICH300_CONFIRM: '' } }); assert.notEqual(x.r.status, 0); assert.ok(!x.cmds.includes('push')); assert.match(x.out, /확인을 입력받을 수 없습니다|확인 값이 다릅니다/);
  assert.deepEqual(Object.keys(remoteFiles(w)).sort(), ['Code.gs', 'appsscript.json', 'Fill.html'].sort());
});
test('복구: 반영 결과가 다르면(또는 push 가 중간에 실패하면) 백업으로 되돌리고 되돌린 결과를 확인한다', () => {
  for (const env of [{ FAKE_CORRUPT_ONCE: '1' }, { FAKE_PUSH_FAIL: '1' }]) {
    const w = setup(), x = run(w, { env }); assert.notEqual(x.r.status, 0); assert.match(x.out, /\[복구\]/); assert.match(x.out, /\[복구 완료\]/);
    assert.deepEqual(x.cmds, ['login', 'pull', 'push', ...(env.FAKE_CORRUPT_ONCE ? ['pull'] : []), 'push', 'pull', 'logout']); assert.equal(remoteFiles(w)['Code.gs'], BOOT);                              // 원래 내용으로 복구됨
    assert.equal(readdirSync(w.rem).length, 3);
  }
});
test('복구도 실패하면 백업 폴더 위치와 수동 복구 방법을 알리고 비정상 종료한다', () => {
  const w = setup(), x = run(w, { env: { FAKE_CORRUPT_ONCE: '1', FAKE_RESTORE_FAIL: '1' } }); assert.notEqual(x.r.status, 0); assert.match(x.out, /\[복구 실패\]/); assert.match(x.out, /rich300-backup-/); assert.match(x.out, /clasp@3\.3\.0 push -f/); assert.ok(x.cmds.includes('logout'));
});
test('백업 실패·로그인 실패는 push 전에 중단하고 로그아웃한다', () => {
  let w = setup(), x = run(w, { env: { FAKE_PULL_FAIL: '1' } }); assert.notEqual(x.r.status, 0); assert.ok(!x.cmds.includes('push')); assert.match(x.out, /백업하지 못했습니다/); assert.ok(x.cmds.includes('logout'));
  w = setup(); x = run(w, { env: { FAKE_LOGIN_FAIL: '1' } }); assert.notEqual(x.r.status, 0); assert.ok(!x.cmds.includes('pull'));
});
test('설치 파일 손상(끝 잘림·해시·문법·열린 매니페스트)은 로그인 전에 중단한다', () => {
  const cases = [d => { const s = readFileSync(`${d}/Code.gs`, 'utf8'); writeFileSync(`${d}/Code.gs`, s.slice(0, s.lastIndexOf('\n}\n') + 1)); }, d => writeFileSync(`${d}/Fill.html`, '<html></html>'),
    d => { writeFileSync(`${d}/Code.gs`, 'function broken( {\n}\n'); fixManifest(d); }, d => { const m = JSON.parse(readFileSync(`${d}/appsscript.json`, 'utf8')); m.webapp = { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' }; writeFileSync(`${d}/appsscript.json`, JSON.stringify(m)); fixManifest(d); }];
  for (const [i, mutate] of cases.entries()) { const x = run(setup({ mutate })); assert.notEqual(x.r.status, 0, `case ${i}`); assert.equal(x.log.length, 0, `case ${i}`); }
});
test('스크립트 자체: create·deploy·delete·run·Telegram·스크립트 속성 변경 없음, clasp 버전 고정, fileExtension=gs 로 Code.gs 이름 고정', () => {
  const s = readFileSync(SCRIPT, 'utf8').replace(/^#.*$/gm, ''); assert.ok(!/\$CLASP\s+(create|deploy|delete|undeploy|run|setting|open|versions)\b/.test(s)); assert.ok(!/api\.telegram|TELEGRAM|TG_TOKEN|PROD_APPROVED/.test(s)); assert.match(s, /@google\/clasp@3\.3\.0/); assert.match(s, /"fileExtension":"gs"/); assert.match(s, /set -euo pipefail/);
  assert.ok(!/rm -rf "\$HOME|rm -rf \/|rm -rf "\$BACKUP/.test(s));                                           // 백업은 지우지 않는다
});
