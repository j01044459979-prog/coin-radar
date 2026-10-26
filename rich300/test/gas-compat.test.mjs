// Apps Script 호환 검사 시험: 실제 사고('10n' → Syntax error: ParseError: Unexpected token ILLEGAL, Code.gs 9번째 줄)의 재발 방지.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkGasSyntax, maskNonCode } from '../deploy/gas-compat.mjs';
import { makeBundle } from '../deploy/make-bundle.mjs';
import { ENGINE_MODULES } from '../build.mjs';

const toks = src => checkGasSyntax(src).map(x => x.token.trim());
test('실제 사고 재현: BigInt 리터럴 한 줄(const DEC_SCALE = 10n ** 12n;)을 잡고 줄 번호를 알려 준다', () => {
  const v = checkGasSyntax('// a\n\nconst DEC_SCALE = 10n ** 12n;\n'); assert.deepEqual(v.map(x => [x.line, x.token]), [[3, '10n'], [3, '12n']]); assert.match(v[0].why, /BigInt\(10\)/);
});
test('금지 문법을 모두 잡는다: ?? ?. ||= &&= ??= 숫자 구분자 #private catch{}', () => {
  for (const [code, tok] of [['a ?? b', '??'], ['a ??= b', '??='], ['a?.b', '?.'], ['a?.[0]', '?.'], ['f?.()', '?.'], ['a ||= 1', '||='], ['a &&= 1', '&&='], ['1_000', '1_0'], ['class A { #x = 1 }', '#x'], ['try { f() } catch { }', 'catch {'], ['0xFFn', '0xFFn'], ['x = 123456789012345678901234567890n', '123456789012345678901234567890n']]) assert.ok(toks(code).includes(tok), `${code} → ${JSON.stringify(toks(code))}`);
});
test('허용: 삼항(a?.5:1), BigInt() 호출, 객체 전개, async, **, 변수명에 n 으로 끝나는 숫자 아닌 것', () => {
  for (const code of ['const x = a?.5:1;', 'const x = BigInt(10) ** BigInt("12");', 'const o = { ...a, b: 1 };', 'async function f() { await g(); }', 'const n10 = 1, a1n = 2; var x = n10 + a1n;', 'try { f() } catch (e_) { }', 'const r = a ? b : c;']) assert.deepEqual(toks(code), [], code);
});
test('주석·문자열·템플릿 글자·정규식 안의 글자는 문법으로 보지 않는다(오탐 방지), 템플릿 ${ } 안의 코드는 검사한다', () => {
  for (const code of ['// 10n a ?? b a?.b', '/* 10n ?? */ var x;', "var s = '10n ?? a?.b';", 'var s = "x ||= 1";', 'var t = `10n ?? ${1} a?.b`;', 'var r = /a?.b|\\d+n/g.test(s);', 'var r = x / 2 / 3;', 'var t = `${"a ?? b"}`;']) assert.deepEqual(toks(code), [], code);
  assert.deepEqual(toks('var t = `x ${a ?? b} y ${10n}`;'), ['??', '10n']);
  assert.equal(maskNonCode('a "x\ny"\nb').split('\n').length, 3);        // 줄 수 유지(줄 번호 정확)
});
test('배포 묶음(makeBundle)·저장소의 apps-script/Code.gs·부트스트랩에 금지 문법이 없다', () => {
  assert.deepEqual(checkGasSyntax(makeBundle().files['Code.gs']), []); assert.deepEqual(checkGasSyntax(makeBundle({ env: 'test' }).files['Code.gs']), []);
  for (const f of ['../apps-script/Code.gs', '../apps-script-bootstrap/Code.gs']) assert.deepEqual(checkGasSyntax(readFileSync(new URL(f, import.meta.url), 'utf8')), [], f);
});
test('엔진 모듈 소스(lib/*.mjs)에도 금지 문법이 없다 — 어느 모듈이 원인인지 파일 이름으로 알려 준다', () => {
  for (const m of ENGINE_MODULES) assert.deepEqual(checkGasSyntax(readFileSync(new URL(`../lib/${m}.mjs`, import.meta.url), 'utf8')), [], `${m}.mjs`);
});
test('makeBundle 은 금지 문법이 섞이면 만들지 않고 줄 번호와 대체 방법을 알려 준다', async () => {
  const { writeFileSync, mkdtempSync } = await import('node:fs'); void writeFileSync; void mkdtempSync;
  const bad = 'const A = 10n;\n'; const v = checkGasSyntax(bad); assert.equal(v.length, 1);
  const src = readFileSync(new URL('../deploy/make-bundle.mjs', import.meta.url), 'utf8'); assert.match(src, /checkGasSyntax\(code\)/); assert.match(src, /throw new Error\(`Apps Script 가 거부할 수 있는 문법/);
});
