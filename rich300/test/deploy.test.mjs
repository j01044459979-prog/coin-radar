import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { liveStore } from './helpers/fakedrive.mjs';
import { StoreError } from '../lib/schema.mjs';
import { deployGate, deployMarkEnv, deployReadEnv, deployCheckEnv, deploySelfTest, DEPLOY_ENVS } from '../lib/deploy.mjs';
import { makeBundle, BUNDLE_GAS_ORDER } from '../deploy/make-bundle.mjs';

test('환경 가드: 운영은 승인 플래그가 있어야, 테스트는 허용 플래그가 있어야 Telegram 호출 허용, 그 밖(미설정·오타)은 차단(fail-closed)', () => {
  const g = (env, prodApproved, testTgAllow) => deployGate({ env, prodApproved, testTgAllow }, 'sendMessage');
  assert.equal(g('prod', 'yes'), null); assert.equal(g('prod', undefined), 'prod-not-approved'); assert.equal(g('prod', 'true'), 'prod-not-approved'); assert.equal(g('prod', 'YES'), 'prod-not-approved'); assert.equal(g('prod', null, 'yes'), 'prod-not-approved');
  assert.equal(g('test', null, 'yes'), null); assert.equal(g('test', 'yes', null), 'test-tg-off'); assert.equal(g('test'), 'test-tg-off');
  for (const e of [undefined, null, '', 'Prod', 'production', 'dev']) assert.equal(g(e, 'yes', 'yes'), 'env-unset', String(e));
  assert.deepEqual(DEPLOY_ENVS, ['test', 'prod']);
});
test('환경 표식: 시트에 최초 1회 기록, 같은 값은 unchanged, 다른 값으로 덮어쓰기 거부, 확인(check)은 기대값과 비교', () => {
  const m = liveStore(); assert.equal(deployReadEnv(m.env), null); assert.deepEqual(deployMarkEnv(m.env, 'test'), { status: 'marked' }); assert.deepEqual(deployMarkEnv(m.env, 'test'), { status: 'unchanged' });
  assert.throws(() => deployMarkEnv(m.env, 'prod'), e => e instanceof StoreError && e.code === 'ENV_MISMATCH'); assert.throws(() => deployMarkEnv(m.env, 'dev'), /test 또는 prod/);
  assert.deepEqual(deployCheckEnv(m.env, 'test'), { ok: true, actual: 'test', expected: 'test' }); assert.deepEqual(deployCheckEnv(m.env, 'prod'), { ok: false, actual: 'test', expected: 'prod' }); assert.equal(m.sheets.get('Meta').filter(r => r[0] === 'envName').length, 1);
});
const ok = (over = {}) => ({ env: 'test', tz: 'Asia/Seoul', v8: true, has: { sheetId: true, ownerEmail: true, tgToken: true, ingestKey: true, uiUrl: true }, ingestKeyLen: 40, flags: { closeSendApproved: false, prodApproved: false, testTgAllow: true }, owner: { activeEmailVisible: true, matchesOwner: true }, triggers: ['rich300TgPoll', 'rich300CloseTick', 'rich300BackupRun'], integrity: { ok: true, issues: [] }, envMarker: { ok: true, actual: 'test', expected: 'test' }, backupCount: 2, ...over });
test('자가 점검: 정상 상태는 실패 0·경고 0, 각 위험은 해당 항목이 실패/경고로 나온다(값은 출력하지 않음)', () => {
  const base = deploySelfTest(ok()); assert.deepEqual([base.fail, base.warn], [0, 0]);
  const failing = [[{ env: null }, 'env'], [{ tz: 'UTC' }, 'timezone'], [{ v8: false }, 'v8'], [{ has: { ...ok().has, sheetId: false } }, 'sheet'], [{ has: { ...ok().has, ownerEmail: false } }, 'owner'], [{ ingestKeyLen: 31 }, 'ingest-key'],
    [{ flags: { closeSendApproved: true, prodApproved: false, testTgAllow: true } }, 'test-no-prod-flags'], [{ flags: { closeSendApproved: false, prodApproved: true, testTgAllow: true } }, 'test-no-prod-flags'], [{ integrity: { ok: false, issues: ['tampered-view'] } }, 'integrity'], [{ integrity: null }, 'integrity'],
    [{ envMarker: { ok: false, actual: 'prod', expected: 'test' } }, 'env-marker'], [{ envMarker: null }, 'env-marker']];
  for (const [over, id] of failing) { const r = deploySelfTest(ok(over)), it = r.items.find(i => i.id === id); assert.ok(it && !it.ok && it.level === 'fail' && r.fail >= 1, id); }
  const warn = [[{ has: { ...ok().has, tgToken: false } }, 'telegram-token'], [{ has: { ...ok().has, ingestKey: false } }, 'ingest-key'], [{ has: { ...ok().has, uiUrl: false } }, 'ui-url'], [{ owner: { activeEmailVisible: false, matchesOwner: false } }, 'owner-visible'], [{ triggers: [] }, 'trigger-rich300CloseTick'], [{ backupCount: 0 }, 'backup']];
  for (const [over, id] of warn) { const it = deploySelfTest(ok(over)).items.find(i => i.id === id); assert.ok(it && !it.ok && it.level === 'warn', id); }
  const prod = deploySelfTest(ok({ env: 'prod', flags: { closeSendApproved: false, prodApproved: false, testTgAllow: false }, envMarker: { ok: true, actual: 'prod', expected: 'prod' } })); assert.equal(prod.fail, 0); assert.match(prod.items.find(i => i.id === 'prod-gate').text, /운영 승인 전: Telegram 호출이 차단/);
  assert.equal(deploySelfTest(ok({ expectTriggers: ['rich300TgPoll'], triggers: ['rich300TgPoll'] })).warn, 0);                          // 설치 대상이 아닌 트리거는 요구하지 않음
  const json = JSON.stringify(deploySelfTest(ok())); assert.ok(!/@|AAF|secret/i.test(json));
});
test('배포 묶음: Code.gs 한 파일(엔진+gas)·HTML·매니페스트, 문법 유효, S0 프로브·비밀값 없음, 필요한 진입 함수 포함, 해시 목록', () => {
  const { files, gasFiles } = makeBundle(); assert.deepEqual(Object.keys(files).sort(), ['Code.gs', 'Fill.html', 'MANIFEST.txt', 'appsscript.json']);
  assert.deepEqual(gasFiles.filter(f => BUNDLE_GAS_ORDER.includes(f)), BUNDLE_GAS_ORDER.filter(f => gasFiles.includes(f))); assert.ok(gasFiles.includes('Deploy.gs') && gasFiles.includes('Backup.gs') && gasFiles.includes('Telegram.gs'));
  const code = files['Code.gs']; assert.doesNotThrow(() => new vm.Script(code));
  for (const fn of ['doGet', 'doPost', 'rich300TgPoll', 'rich300FillSubmit', 'rich300BackupRun', 'rich300SetupTest', 'rich300SetupProd', 'rich300SelfTest', 'rich300InstallAllTriggers', 'rich300BackupSwitchFromProps', 'rich300TgGate_']) assert.match(code, new RegExp(`function ${fn}\\(`), fn);
  assert.ok(!/\bs0[A-Z]\w*/.test(code)); assert.ok(!/S0_TEST_KEY|s0-throwaway/.test(code)); assert.ok(!/\b\d{6,}:[A-Za-z0-9_-]{30,}/.test(code));
  assert.match(files['MANIFEST.txt'], /^[0-9a-f]{64}  +\d+  Code\.gs$/m); assert.ok(code.length < 600000);
  const names = [...code.matchAll(/^function ([A-Za-z0-9_$]+)\(/gm)].map(m => m[1]); const dup = names.filter((n, i) => names.indexOf(n) !== i); assert.deepEqual(dup, []);              // 전역 함수 이름 충돌 없음
});
test('매니페스트: 시간대 Asia/Seoul·V8·최소 권한 범위(스프레드시트·트리거·외부 요청·이메일·drive.file), 넓은 권한 없음', () => {
  const m = JSON.parse(readFileSync(new URL('../deploy/appsscript.json', import.meta.url), 'utf8')); assert.deepEqual([m.timeZone, m.runtimeVersion], ['Asia/Seoul', 'V8']);
  assert.deepEqual([...m.oauthScopes].sort(), ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/script.external_request', 'https://www.googleapis.com/auth/script.scriptapp', 'https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/userinfo.email']);
  assert.ok(!m.oauthScopes.some(s => /\/auth\/drive$|gmail|mail\.google|calendar|contacts|cloud-platform/.test(s))); assert.equal(m.webapp.executeAs, 'USER_DEPLOYING');
});
test('저장소 비밀값 점검: rich300 안의 파일에 토큰·키·이메일·시트 ID 형태의 실제 값이 없다(테스트 센티넬 제외)', () => {
  const root = new URL('../', import.meta.url).pathname, bad = [];
  const walk = d => { for (const n of readdirSync(d)) { const p = `${d}${n}`; if (statSync(p).isDirectory()) { if (!['node_modules', 'dist', 'img'].includes(n)) walk(`${p}/`); } else if (/\.(mjs|gs|html|json|md)$/.test(n)) { const t = readFileSync(p, 'utf8'); for (const re of [/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g, /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, /\bAIza[0-9A-Za-z_-]{35}\b/g, /\b[A-Za-z0-9_-]{44}\b(?=["']\s*[,}\]])/g]) { const hit = (t.match(re) ?? []).filter(x => !/Fake|Test|test|sentinel|ABCDEFGHIJKLMNOPQRSTUVWXYZ/.test(x)); if (hit.length && !p.includes('/test/')) bad.push(`${p}: ${hit[0].slice(0, 12)}…`); } } } };
  walk(root); assert.deepEqual(bad, []);
});

test('화면이 부르는 서버 함수(google.script.run)는 모두 번들에 존재하고 밑줄로 끝나지 않는다(밑줄 함수는 클라이언트에서 호출 불가)', () => {
  const { files } = makeBundle(), code = files['Code.gs'], defined = new Set([...code.matchAll(/^function ([A-Za-z0-9_$]+)\(/gm)].map(m => m[1])), sources = [];
  for (const f of readdirSync(new URL('../gas/', import.meta.url))) if (f.endsWith('.html')) sources.push([f, readFileSync(new URL(`../gas/${f}`, import.meta.url), 'utf8')]);
  for (const f of readdirSync(new URL('../lib/', import.meta.url))) if (/view\.mjs$/.test(f)) sources.push([f, readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8')]);
  let n = 0; for (const [f, t] of sources) for (const m of t.matchAll(/\brich300[A-Z][A-Za-z0-9]*_?/g)) { n++; assert.ok(!m[0].endsWith('_'), `${f}: ${m[0]} 은 비공개 함수`); assert.ok(defined.has(m[0]), `${f}: ${m[0]} 이(가) 번들에 없음`); }
  assert.ok(n >= 1);
});
