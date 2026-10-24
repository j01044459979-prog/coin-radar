// 부트스트랩(작은 파일)이 설치 파일을 안전하게 받아 기존 프로젝트에 반영하는지 검사한다. GitHub·Apps Script API 는 가짜(실제 호출 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const BOOT = readFileSync(new URL('../apps-script-bootstrap/Code.gs', import.meta.url), 'utf8');
const DIST = n => readFileSync(new URL(`../apps-script/${n}`, import.meta.url), 'utf8');
const sha = s => createHash('sha256').update(s).digest('hex');
const signed = b => [...b].map(x => (x > 127 ? x - 256 : x));
const manifestOf = files => `RICH300 Apps Script bundle\n${Object.entries(files).map(([n, c]) => `${sha(c)}  ${String(Buffer.byteLength(c)).padStart(8)}  ${n}`).join('\n')}\n`;

function world({ files = { 'Code.gs': DIST('Code.gs'), 'Fill.html': DIST('Fill.html'), 'appsscript.json': DIST('appsscript.json') }, manifest, putStatus = 200, putBody = '{}', serve = null } = {}) {
  const spy = { fetches: [], puts: [], logs: [], sleeps: 0 }, mf = manifest ?? manifestOf(files), serveFiles = { ...files, 'MANIFEST.txt': mf };
  const resp = (code, text) => ({ getResponseCode: () => code, getContentText: () => text, getContent: () => signed(Buffer.from(text, 'utf8')) });
  const ctx = { Logger: { log: m => spy.logs.push(m) }, Date, Function, JSON, Buffer: undefined,
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, bytes) => signed(createHash('sha256').update(Buffer.from(bytes.map(b => (b < 0 ? b + 256 : b)))).digest()), sleep: () => { spy.sleeps++; } },
    ScriptApp: { getScriptId: () => 'SCRIPT_ID_X', getOAuthToken: () => 'OAUTH_TOKEN_X' },
    UrlFetchApp: { fetch: (url, opt = {}) => { spy.fetches.push({ url, method: opt.method ?? 'get' });
      if (url.startsWith('https://script.googleapis.com/')) { spy.puts.push({ url, opt: { ...opt, payload: JSON.parse(opt.payload) } }); return resp(putStatus, putBody); }
      const m = /\/rich300\/apps-script\/([^?]+)/.exec(url); const name = m && m[1]; const text = serve ? serve(name, spy) : serveFiles[name]; return text === undefined ? resp(404, 'Not Found') : resp(200, text); } } };
  vm.createContext(ctx); vm.runInContext(BOOT, ctx); return { ctx, spy };
}
const stepOf = (r, id) => r.steps.find(s => s.id === id)?.status;

test('부트스트랩: 정상 — 3개 파일을 검증하고 이 프로젝트(스크립트 ID)에만 PUT, 파일 이름·종류·내용이 설치 파일과 같다', () => {
  const w = world(), r = w.ctx.rich300Bootstrap(); assert.equal(r.ok, true); assert.deepEqual(['B1', 'B2', 'B3', 'B4'].map(i => stepOf(r, i)), ['PASS', 'PASS', 'PASS', 'PASS']);
  assert.equal(w.spy.puts.length, 1); const p = w.spy.puts[0]; assert.equal(p.url, 'https://script.googleapis.com/v1/projects/SCRIPT_ID_X/content'); assert.equal(p.opt.method, 'put'); assert.equal(p.opt.headers.Authorization, 'Bearer OAUTH_TOKEN_X');
  assert.deepEqual(p.opt.payload.files.map(f => [f.name, f.type]), [['Code', 'SERVER_JS'], ['Fill', 'HTML'], ['appsscript', 'JSON']]);
  assert.equal(p.opt.payload.files[0].source, DIST('Code.gs')); assert.equal(p.opt.payload.files[1].source, DIST('Fill.html')); assert.equal(p.opt.payload.files[2].source, DIST('appsscript.json'));
  assert.deepEqual(w.spy.fetches.filter(f => !f.url.startsWith('https://script.googleapis.com/')).map(f => f.url.split('?')[0].split('/').pop()).sort(), ['Code.gs', 'Fill.html', 'MANIFEST.txt', 'appsscript.json']);
  assert.ok(w.spy.fetches.every(f => f.url.startsWith('https://raw.githubusercontent.com/j01044459979-prog/coin-radar/') || f.url.startsWith('https://script.googleapis.com/v1/projects/SCRIPT_ID_X/')));
  assert.ok(!w.spy.logs.join('\n').includes('OAUTH_TOKEN_X'));
});
test('rich300BootstrapCheck 는 받기·검증만 하고 PUT 하지 않는다', () => { const w = world(), r = w.ctx.rich300BootstrapCheck(); assert.equal(r.ok, true); assert.equal(w.spy.puts.length, 0); assert.match(w.spy.logs.join(''), /변경 없음/); });
test('실제 사고 재현: Code.gs 끝이 잘려(마지막 닫는 } 한 줄 누락) 내려오면 해시 불일치로 중단하고 아무것도 바꾸지 않는다', () => {
  const full = DIST('Code.gs'), cut = full.slice(0, full.lastIndexOf('\n}\n') + 1);        // 마지막 '}' 줄 제거
  const w = world({ serve: (n, spy) => (n === 'Code.gs' ? cut : n === 'MANIFEST.txt' ? manifestOf({ 'Code.gs': full, 'Fill.html': DIST('Fill.html'), 'appsscript.json': DIST('appsscript.json') }) : DIST(n)) });
  const r = w.ctx.rich300Bootstrap(); assert.equal(r.ok, false); assert.equal(stepOf(r, 'B1'), 'FAIL'); assert.equal(w.spy.puts.length, 0); assert.match(r.steps[0].text, /Code\.gs/); assert.equal(w.spy.sleeps, 1);     // 한 번 재시도 후 중단
});
test('일시적 캐시 불일치(첫 시도만 어긋남)는 한 번 재시도해 성공한다', () => {
  let n = 0; const w = world({ serve: (name) => (name === 'Code.gs' && n++ === 0 ? DIST('Code.gs').slice(0, -50) : name === 'MANIFEST.txt' ? manifestOf({ 'Code.gs': DIST('Code.gs'), 'Fill.html': DIST('Fill.html'), 'appsscript.json': DIST('appsscript.json') }) : DIST(name)) });
  const r = w.ctx.rich300Bootstrap(); assert.equal(r.ok, true); assert.equal(w.spy.puts.length, 1); assert.equal(w.spy.sleeps, 1);
});
test('문법 오류가 있는 Code.gs(해시는 일치)는 Apps Script V8 구문 검사에서 걸려 반영하지 않는다', () => {
  const files = { 'Code.gs': DIST('Code.gs').replace(/\n\}\n$/, '\n'), 'Fill.html': DIST('Fill.html'), 'appsscript.json': DIST('appsscript.json') };
  files['Code.gs'] += '\nfunction broken( {\n}\n'; const w = world({ files }); const r = w.ctx.rich300Bootstrap(); assert.equal(stepOf(r, 'B2'), 'FAIL'); assert.equal(w.spy.puts.length, 0); assert.match(r.steps.find(s => s.id === 'B2').text, /문법 오류/);
  const noEnd = world({ files: { ...files, 'Code.gs': DIST('Code.gs').slice(0, -3) } }); assert.equal(stepOf(noEnd.ctx.rich300Bootstrap(), 'B2'), 'FAIL'); assert.equal(noEnd.spy.puts.length, 0);
});
test('구문 검사 수단이 막힌 환경(Function 생성자가 EvalError)에서는 건너뛰고(WARN) 해시 검증만으로 계속한다', () => {
  const w = world(); w.ctx.Function = function () { const e = new Error('blocked'); e.name = 'EvalError'; throw e; }; const r = w.ctx.rich300Bootstrap(); assert.equal(stepOf(r, 'B2'), 'WARN'); assert.equal(r.ok, true); assert.equal(w.spy.puts.length, 1);
});
test('더 넓은 접근 범위(공개·소유자 실행)의 매니페스트나 런타임이 다른 매니페스트는 설치하지 않는다', () => {
  for (const mut of [m => ({ ...m, webapp: { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' } }), m => ({ ...m, webapp: { executeAs: 'USER_ACCESSING', access: 'ANYONE' } }), m => ({ ...m, webapp: undefined }), m => ({ ...m, runtimeVersion: 'DEPRECATED_ES5' }), m => ({ ...m, timeZone: 'UTC' })]) {
    const files = { 'Code.gs': DIST('Code.gs'), 'Fill.html': DIST('Fill.html'), 'appsscript.json': JSON.stringify(mut(JSON.parse(DIST('appsscript.json')))) }; const w = world({ files }); const r = w.ctx.rich300Bootstrap(); assert.equal(stepOf(r, 'B3'), 'FAIL'); assert.equal(w.spy.puts.length, 0);
  }
});
test('Apps Script API 가 꺼져 있으면(403) 안내만 하고 실패, 권한 문제도 구분, 토큰은 로그에 없다', () => {
  let w = world({ putStatus: 403, putBody: JSON.stringify({ error: { message: 'Apps Script API has not been used in project 1 before or it is disabled.' } }) }), r = w.ctx.rich300Bootstrap(); assert.equal(r.ok, false); assert.match(r.steps.at(-1).text, /usersettings/);
  w = world({ putStatus: 401, putBody: '{}' }); r = w.ctx.rich300Bootstrap(); assert.match(r.steps.at(-1).text, /권한/); assert.ok(!w.spy.logs.join('').includes('OAUTH_TOKEN_X'));
  w = world({ putStatus: 500, putBody: 'x' }); assert.match(w.ctx.rich300Bootstrap().steps.at(-1).text, /HTTP 500/);
});
test('다운로드 실패(404·네트워크 예외)는 중단, PUT 없음', () => {
  let w = world({ serve: () => undefined }); assert.equal(w.ctx.rich300Bootstrap().ok, false); assert.equal(w.spy.puts.length, 0);
  w = world({ serve: () => { throw new Error('boom https://raw.githubusercontent.com/secret'); } }); const r = w.ctx.rich300Bootstrap(); assert.equal(r.ok, false); assert.ok(!JSON.stringify(r).includes('raw.githubusercontent.com')); assert.equal(w.spy.puts.length, 0);
});
test('부트스트랩 파일 자체: 작고(10KB 미만), 최소 권한 범위 2개, 삭제·Telegram·시트·Drive 접근 없음, 설치 대상은 release 브랜치의 3개 파일', () => {
  assert.ok(BOOT.length < 10000); const man = JSON.parse(readFileSync(new URL('../apps-script-bootstrap/appsscript.json', import.meta.url), 'utf8'));
  assert.deepEqual(man.oauthScopes, ['https://www.googleapis.com/auth/script.projects', 'https://www.googleapis.com/auth/script.external_request']); assert.equal(man.runtimeVersion, 'V8'); assert.equal(man.timeZone, 'Asia/Seoul'); assert.equal(man.webapp, undefined);
  assert.ok(!/SpreadsheetApp|DriveApp|api\.telegram|PropertiesService|deleteTrigger|setTrashed|method: 'delete'|deployments/.test(BOOT)); assert.match(BOOT, /RICH300_BOOT_REF = 'release\/rich300-prod'/);
});
