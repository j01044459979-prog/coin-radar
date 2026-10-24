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
  login) { tr -d '\n' < appsscript.json; echo; } >> "$FAKE_LOG.scopes" 2>/dev/null; [[ "$FAKE_LOGIN_FAIL" == 1 ]] && exit 1; IFS= read -r line; echo "stdin-line: $line" >> "$FAKE_LOG.stdin"; [[ "$line" == *code=* ]] || { echo 'Missing code in response URL' >&2; exit 1; }; echo '{}' > "$HOME/.clasprc.json" ;;
  push) n=$(cat "$FAKE_STATE/pushes" 2>/dev/null || echo 0); echo $((n+1)) > "$FAKE_STATE/pushes"
        if [[ "$FAKE_NOOP_PUSH" == 1 && "$n" == 0 ]]; then echo "Script is already up to date."; exit 0; fi
        if [[ "$n" == 0 && "$FAKE_PUSH_FAIL" == 1 ]]; then cp Code.gs "$FAKE_REMOTE/Code.gs"; exit 1; fi
        if [[ "$n" -ge 1 && "$FAKE_RESTORE_FAIL" == 1 ]]; then exit 1; fi
        rm -rf "$FAKE_STATE/prev"; mkdir -p "$FAKE_STATE/prev"; cp "$FAKE_REMOTE"/* "$FAKE_STATE/prev/" 2>/dev/null; echo "\${FAKE_STALE_PULLS:-0}" > "$FAKE_STATE/stale"
        rm -rf "$FAKE_REMOTE"/*; for f in *; do [[ "$f" == .clasp.json ]] || cp "$f" "$FAKE_REMOTE/$f"; done
        [[ "$n" == 0 && "$FAKE_CORRUPT_ONCE" == 1 ]] && echo '// x' >> "$FAKE_REMOTE/Code.gs"; echo "Pushed 3 files."; true ;;
  pull) [[ "$FAKE_PULL_FAIL" == 1 ]] && exit 1
        st=$(cat "$FAKE_STATE/stale" 2>/dev/null || echo 0)
        if [[ "$st" -gt 0 ]]; then echo $((st-1)) > "$FAKE_STATE/stale"; cp "$FAKE_STATE/prev"/* . ; else cp "$FAKE_REMOTE"/* . ; fi
        if [[ "$FAKE_REORDER_MANIFEST" == 1 && -f appsscript.json ]]; then node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('appsscript.json','utf8'));if(m.webapp)m.webapp={access:m.webapp.access,executeAs:m.webapp.executeAs};fs.writeFileSync('appsscript.json',JSON.stringify(Object.fromEntries(Object.entries(m).reverse()),null,4)+'\\n')"; fi
        if [[ "$FAKE_CRLF" == 1 && -f Code.gs ]]; then sed -i 's/$/\r/' Code.gs; fi
        echo "Pulled 3 files." ;;
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
const URL_OK = 'http://localhost:8888/?code=4%2F0AXYZ&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fscript.projects';
function run(w, { args = [ID, FAKE_COMMIT], env = {}, ttyLines = [URL_OK], piped = false } = {}) {
  const tty = `${w.root}/tty`; writeFileSync(tty, ttyLines.map(l => `${l}\n`).join(''));
  const e = { PATH: process.env.PATH, HOME: w.home, RICH300_SRC_DIR: w.src, RICH300_CLASP: w.bin, RICH300_CONFIRM: LAST6, RICH300_TTY: tty, RICH300_POLL_SLEEP: '0', RICH300_POLL_TRIES: '3', FAKE_LOG: w.log, FAKE_REMOTE: w.rem, FAKE_STATE: w.state, ...env };
  const r = piped ? spawnSync('bash', ['-s', '--', ...args], { env: e, encoding: 'utf8', input: readFileSync(SCRIPT, 'utf8') }) : spawnSync('bash', [SCRIPT, ...args], { env: e, encoding: 'utf8', input: '' }); const log = existsSync(w.log) ? readFileSync(w.log, 'utf8').trim().split('\n') : [];
  const extra = n => (existsSync(`${w.log}.${n}`) ? readFileSync(`${w.log}.${n}`, 'utf8').trim().split('\n') : []);
  return { r, log, scopes: extra('scopes'), stdin: extra('stdin'), out: r.stdout + r.stderr, cmds: log.map(l => l.split(' ')[0]), backups: readdirSync(w.home).filter(n => n.startsWith('rich300-backup-')) };
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
test('실제 사고 재현: "curl | bash"(stdin=스크립트)로 실행해도 로그인 입력은 터미널에서만 받는다 — clasp 가 스크립트 텍스트를 읽지 않는다', () => {
  const w = setup(), x = run(w, { piped: true }); assert.equal(x.r.status, 0, x.out); assert.equal(x.stdin.length, 1); assert.equal(x.stdin[0], `stdin-line: ${URL_OK}`); assert.ok(!/set -euo|#!\/usr\/bin\/env/.test(x.stdin.join('\n')));
  assert.deepEqual(x.cmds, ['login', 'pull', 'push', 'pull', 'logout']); assert.match(x.out, /\[PASS\] 반영 완료/);
});
test('터미널 입력이 없으면(예: 입력 장치 없음) 로그인 시도 전에 안내하고 중단한다 — 스크립트 텍스트를 입력으로 소비하지 않는다', () => {
  const w = setup(), x = run(w, { piped: true, env: { RICH300_TTY: `${w.root}/없는장치` } }); assert.notEqual(x.r.status, 0); assert.equal(x.log.length, 0); assert.match(x.out, /터미널 입력을 사용할 수 없습니다/); assert.match(x.out, /파일로 받아/);
});
test('붙여 넣은 URL 에 code= 가 없으면 로그인 실패로 안내하고 push 하지 않는다(재시도 방법 포함)', () => {
  const w = setup(), x = run(w, { ttyLines: ['https://accounts.google.com/o/oauth2/v2/auth?client_id=x'] }); assert.notEqual(x.r.status, 0); assert.match(x.out, /code= 가 있어야 합니다/); assert.ok(!x.cmds.includes('pull') && !x.cmds.includes('push'));
});
test('권한 최소화: 로그인은 script.projects·userinfo.email 두 범위만(--use-project-scopes), cloud-platform 등은 요청하지 않는다. RICH300_SCOPES=default 로만 기본 범위', () => {
  let x = run(setup()); assert.ok(x.log[0].includes('--use-project-scopes')); assert.equal(x.scopes.length, 1); assert.deepEqual(JSON.parse(x.scopes[0]).oauthScopes, ['https://www.googleapis.com/auth/script.projects', 'https://www.googleapis.com/auth/userinfo.email']); assert.ok(!/cloud-platform|drive|logging|service\.management/.test(x.scopes[0]));
  x = run(setup(), { env: { RICH300_SCOPES: 'default' } }); assert.ok(!x.log[0].includes('--use-project-scopes')); assert.match(x.out, /경고: clasp 기본 권한 범위/);
});
test('로그인 방식: Cloud Shell/SSH(원격)는 --no-localhost 붙여넣기, 내 PC는 자동(localhost), RICH300_LOGIN 으로 지정 가능', () => {
  assert.ok(run(setup(), { env: { CLOUD_SHELL: 'true' } }).log[0].includes('--no-localhost')); assert.ok(run(setup(), { env: { SSH_CONNECTION: '1 2 3 4' } }).log[0].includes('--no-localhost'));
  const local = run(setup()); assert.ok(!local.log[0].includes('--no-localhost')); assert.ok(run(setup(), { env: { RICH300_LOGIN: 'paste' } }).log[0].includes('--no-localhost')); assert.ok(!run(setup(), { env: { CLOUD_SHELL: 'true', RICH300_LOGIN: 'local' } }).log[0].includes('--no-localhost'));
  const out = run(setup(), { env: { CLOUD_SHELL: 'true' } }).out; assert.match(out, /채팅·메신저에 공유하지 마세요/); assert.match(out, /http:\/\/localhost:8888\/\?code=/);
});
test('확인 입력도 터미널에서 받는다(환경 변수 없이): 올바른 6글자면 진행, 틀리면 중단', () => {
  let x = run(setup(), { env: { RICH300_CONFIRM: '' }, ttyLines: [URL_OK, LAST6] }); assert.equal(x.r.status, 0, x.out); assert.ok(x.cmds.includes('push'));
  x = run(setup(), { env: { RICH300_CONFIRM: '' }, ttyLines: [URL_OK, 'nope12'] }); assert.notEqual(x.r.status, 0); assert.ok(!x.cmds.includes('push')); assert.match(x.out, /확인 값이 다릅니다/);
});
test('이미 로그인돼 있으면 로그인을 건너뛰고 기존 로그인은 지우지 않는다(우리가 만든 로그인만 로그아웃)', () => {
  const w = setup(); writeFileSync(`${w.home}/.clasprc.json`, '{}'); const x = run(w, { ttyLines: [] }); assert.equal(x.r.status, 0, x.out); assert.deepEqual(x.cmds, ['pull', 'push', 'pull']); assert.equal(existsSync(`${w.home}/.clasprc.json`), true); assert.match(x.out, /이미 clasp 로그인 상태/);
});
test('복구: 반영 결과가 다르면(또는 push 가 중간에 실패하면) 백업으로 되돌리고 되돌린 결과를 확인한다', () => {
  for (const env of [{ FAKE_CORRUPT_ONCE: '1' }, { FAKE_PUSH_FAIL: '1' }]) {
    const w = setup(), x = run(w, { env }); assert.notEqual(x.r.status, 0); assert.match(x.out, /\[복구\] 백업으로 되돌립니다/); assert.match(x.out, /\[복구 완료\]/); assert.equal(x.cmds.filter(c => c === 'push').length, 2); assert.equal(x.cmds.at(-1), 'logout');
    assert.equal(remoteFiles(w)['Code.gs'], BOOT); assert.equal(readdirSync(w.rem).length, 3);                                                   // 원래 내용으로 복구됨
    if (env.FAKE_CORRUPT_ONCE) { assert.match(x.out, /반영 결과가 설치 파일과 다릅니다/); assert.match(x.out, /다름: Code \(기준 \d+바이트 sha=[0-9a-f]{12}, 확인 \d+바이트 sha=[0-9a-f]{12}, 첫 차이 \d+번째 줄\)/); assert.match(x.out, /다시 읽은 원격 상태: 설치 완료 상태/); }   // 어디가 어떻게 다른지(값 없이 해시·줄 번호)
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
const INSTALLED = { 'Code.gs': readFileSync(`${DIST}/Code.gs`, 'utf8'), 'Fill.html': readFileSync(`${DIST}/Fill.html`, 'utf8'), 'appsscript.json': readFileSync(`${DIST}/appsscript.json`, 'utf8') };
test('상태 판별: 원격이 부트스트랩/설치 완료/기타 중 무엇인지, 크기·해시(앞 12자리)와 함께 표시한다', () => {
  let x = run(setup()); assert.match(x.out, /현재 원격 상태: 부트스트랩 상태\(설치 전\) — Code \d+바이트 sha256=[0-9a-f]{12}/); assert.match(x.out, /설치할 파일: +Code \d+바이트 sha256=[0-9a-f]{12}/);
  x = run(setup({ remote: { ...INSTALLED, 'Code.gs': INSTALLED['Code.gs'] + '\n// 로컬 수정\n' } }), { env: { RICH300_FORCE: '1' } }); assert.match(x.out, /현재 원격 상태: 설치 완료 상태\(rich300Install 있음\)/);
});
test('이미 설치 완료 상태(원격이 설치 파일과 같음)면 push·복구 없이 PASS — "Script is already up to date" 를 실패로 오인하지 않는다', () => {
  const w = setup({ remote: INSTALLED }), x = run(w); assert.equal(x.r.status, 0, x.out); assert.match(x.out, /\[PASS\] 이미 설치 완료 상태입니다/); assert.deepEqual(x.cmds, ['login', 'pull', 'logout']); assert.ok(!/복구/.test(x.out)); assert.deepEqual(remoteFiles(w), INSTALLED);
  const crlf = run(setup({ remote: INSTALLED }), { env: { FAKE_CRLF: '1' } }); assert.equal(crlf.r.status, 0, crlf.out); assert.match(crlf.out, /이미 설치 완료 상태/);                 // 줄바꿈(CRLF) 차이는 같은 내용으로 본다
});
test('서버 반영 지연: push 직후 몇 번 옛 내용을 돌려줘도 다시 읽어 확인하면 PASS(불필요한 복구 없음)', () => {
  const w = setup(), x = run(w, { env: { FAKE_STALE_PULLS: '2' } }); assert.equal(x.r.status, 0, x.out); assert.match(x.out, /\[PASS\] 반영 완료/); assert.equal(x.cmds.filter(c => c === 'push').length, 1); assert.ok(!/복구/.test(x.out)); assert.equal(remoteFiles(w)['Code.gs'], INSTALLED['Code.gs']);
});
test('매니페스트 서버 정규화(키 순서·들여쓰기 변경)는 의미가 같으면 통과한다(문자열 비교로 오탐하지 않음)', () => {
  const w = setup(), x = run(w, { env: { FAKE_REORDER_MANIFEST: '1' } }); assert.equal(x.r.status, 0, x.out); assert.match(x.out, /\[PASS\] 반영 완료/); assert.ok(!/복구/.test(x.out));
});
test('clasp 가 변경을 건너뛰었는데 원격이 설치 파일과 다르면(다른 프로젝트·동기화 문제) 실패로 알리고 어디가 다른지 보여 주며, 원격이 이미 설치 전 상태면 복구는 불필요로 표시한다', () => {
  const w = setup(), x = run(w, { env: { FAKE_NOOP_PUSH: '1' } }); assert.notEqual(x.r.status, 0); assert.match(x.out, /\[주의\] clasp 가 '이미 최신'이라고 했지만/); assert.match(x.out, /\[FAIL\] 반영 결과가 설치 파일과 다릅니다/); assert.match(x.out, /다름: Code \(기준 \d+바이트 sha=/); assert.match(x.out, /다시 읽은 원격 상태: 부트스트랩 상태/);
  assert.match(x.out, /\[복구 불필요\]/); assert.equal(x.cmds.filter(c => c === 'push').length, 1); assert.equal(remoteFiles(w)['Code.gs'], BOOT);
});
test('스크립트 자체: create·deploy·delete·run·Telegram·스크립트 속성 변경 없음, clasp 버전 고정, fileExtension=gs 로 Code.gs 이름 고정', () => {
  const s = readFileSync(SCRIPT, 'utf8').replace(/^#.*$/gm, ''); assert.ok(!/\$CLASP\s+(create|deploy|delete|undeploy|run|setting|open|versions)\b/.test(s)); assert.ok(!/api\.telegram|TELEGRAM|TG_TOKEN|PROD_APPROVED/.test(s)); assert.match(s, /@google\/clasp@3\.3\.0/); assert.match(s, /"fileExtension":"gs"/); assert.match(s, /set -euo pipefail/);
  assert.ok(!/\$CLASP (pull|push)[^\n]*\)/.test(s.replace(/<\/dev\/null/g, '')) || /\$CLASP (pull|push)[^<\n]*<\/dev\/null/.test(s));          // 로그인 외 clasp 호출은 stdin 을 읽지 않는다
  for (const m of s.matchAll(/\$CLASP (pull|push)[^\n]*/g)) assert.match(m[0], /<\/dev\/null/);
  assert.ok(!/rm -rf "\$HOME|rm -rf \/|rm -rf "\$BACKUP/.test(s));                                           // 백업은 지우지 않는다
});
