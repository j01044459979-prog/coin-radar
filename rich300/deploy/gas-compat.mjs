// Apps Script 호환 검사: 번들(Code.gs)에 Apps Script 의 문법 검사기가 거부할 수 있는 최신 문법이 없는지 확인한다. 의존성 없음.
//  배경: BigInt 리터럴(10n)이 'Syntax error: ParseError: Unexpected token ILLEGAL (Code.gs 9번째 줄)' 로 push 를 막았다. 로컬 Node 의 vm.Script 는 최신 문법을 모두 받아 주므로 이 사고를 잡지 못한다.
//  금지(ES2019 이후 — 검사기가 어디까지 받는지 확인되지 않아 보수적으로 둔다): BigInt 리터럴, ??, ?., ||= &&= ??=, 숫자 구분자(1_000), #private, catch 바인딩 생략(catch {).
//  허용: 객체 전개({...a}, ES2018), async/await, **, 화살표 함수, 템플릿 문자열, BigInt() 함수 호출(런타임 지원은 S0/설치 후 점검에서 확인).
//  사용: node rich300/deploy/gas-compat.mjs <파일...>  (위반이 있으면 줄 번호와 함께 출력하고 종료 코드 1)
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const KEYWORDS_BEFORE_REGEX = /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;
// 주석·문자열·템플릿(리터럴 부분)·정규식 리터럴을 공백으로 바꾼 같은 길이의 코드 반환(줄바꿈 유지) — 이 안에서 문법 토큰만 검사한다.
export function maskNonCode(src) {
  const out = src.split(''); let i = 0, prev = '', prevWord = ''; const n = src.length;
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  const template = start => {   // start 는 여는 백틱 다음 위치. 닫는 백틱 위치 다음을 반환(필요하면 ${ 안의 코드를 재귀로 둔다)
    let k = start; for (; k < n; k++) {
      if (src[k] === '\\') { blank(k, k + 2); k++; continue; }
      if (src[k] === '`') return k + 1;
      if (src[k] === '$' && src[k + 1] === '{') { blank(k, k + 2); k = codeUntilCloseBrace(k + 2) - 1; continue; }
      blank(k, k + 1);
    } return k;
  };
  const codeUntilCloseBrace = start => { let depth = 1; i = start; prev = '{'; scan(() => { if (src[i] === '{') depth++; if (src[i] === '}') { depth--; if (!depth) return true; } return false; }); const end = i + 1; i = end; return end; };
  const scan = stop => {
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (stop && stop()) return;
      if (c === '/' && d === '/') { const e = src.indexOf('\n', i); blank(i, e < 0 ? n : e); i = e < 0 ? n : e; continue; }
      if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); blank(i, e < 0 ? n : e + 2); i = e < 0 ? n : e + 2; continue; }
      if (c === '"' || c === "'") { let k = i + 1; while (k < n && src[k] !== c && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1; blank(i + 1, k); i = k + 1; prev = 'x'; prevWord = ''; continue; }
      if (c === '`') { const e = template(i + 1); i = e; prev = 'x'; prevWord = ''; continue; }
      if (c === '/') {   // 나눗셈인지 정규식인지: 앞 토큰이 값(식별자·숫자·')'·']')이면 나눗셈
        const regexOk = !prev || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || KEYWORDS_BEFORE_REGEX.test(prevWord);
        if (regexOk) { let k = i + 1, cls = false; while (k < n && src[k] !== '\n') { if (src[k] === '\\') { k += 2; continue; } if (src[k] === '[') cls = true; else if (src[k] === ']') cls = false; else if (src[k] === '/' && !cls) break; k++; } if (src[k] === '/') { blank(i + 1, k); i = k + 1; while (/[a-z]/i.test(src[i] ?? '')) i++; prev = 'x'; prevWord = ''; continue; } }
      }
      if (/[A-Za-z_$]/.test(c)) { let k = i; while (/[\w$]/.test(src[k] ?? '')) k++; prevWord = src.slice(i, k); prev = 'x'; i = k; continue; }
      if (/\d/.test(c)) { let k = i; while (/[\w.]/.test(src[k] ?? '')) k++; prev = 'x'; prevWord = ''; i = k; continue; }
      if (!/\s/.test(c)) { prev = c; prevWord = ''; }
      i++;
    }
  };
  scan(null); return out.join('');
}
const RULES = [
  [/(?<![\w$.])(?:0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*)n(?![\w$])/g, 'BigInt 리터럴(10n) — BigInt(10) 로 쓰세요'],
  [/\?\?=?/g, '널 병합 연산자(??) — 값 != null ? 값 : 기본값 또는 nullishOr() 로 쓰세요'],
  [/\?\.(?!\d)/g, '옵셔널 체이닝(?.) — 앞 값 == null ? undefined : 값.속성 으로 쓰세요'],
  [/(?:\|\||&&)=/g, '논리 대입(||= &&=) — a || (a = b) 로 쓰세요'],
  [/\d_\d/g, '숫자 구분자(1_000)'],
  [/(?<![\w$])#[A-Za-z_$]/g, '#private 필드'],
  [/\bcatch\s*\{/g, 'catch 바인딩 생략 — catch (e_) 로 쓰세요'],
];
export function checkGasSyntax(src) {
  const code = maskNonCode(src), lineAt = idx => code.slice(0, idx).split('\n').length, found = [];
  for (const [re, why] of RULES) for (const m of code.matchAll(re)) found.push({ line: lineAt(m.index), idx: m.index, token: m[0], why });
  return found.sort((a, b) => a.idx - b.idx);
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let bad = 0; const files = process.argv.slice(2); if (!files.length) { console.error('사용: node gas-compat.mjs <파일...>'); process.exit(2); }
  for (const f of files) { const v = checkGasSyntax(readFileSync(f, 'utf8')); for (const x of v.slice(0, 20)) console.log(`${f}:${x.line}: ${x.token.trim()} — ${x.why}`); if (v.length > 20) console.log(`... 외 ${v.length - 20}건`); bad += v.length; }
  if (bad) { console.log(`[FAIL] Apps Script 호환 검사: ${bad}건`); process.exit(1); }
  console.log('[PASS] Apps Script 호환 검사: 금지된 최신 문법 없음');
}
