// RICH 300 계산 엔진 → Apps Script 단일 파일 번들. lib/*.mjs 의 import/export 를 제거하고 의존 순서대로 이어 붙인다(전역 함수).
// 모듈 간 최상위 이름이 겹치면 빌드를 실패시킨다. 사용: node rich300/build.mjs [출력경로]  (기본 rich300/dist/engine.gs, 저장소에는 커밋하지 않음)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

// 한 줄에 하나씩 둔다: 독립 PR(R4·R6 등)이 서로 다른 위치에 모듈을 추가해도 병합 충돌이 나지 않게 하기 위함.
export const ENGINE_MODULES = [
  'nullish',
  'decimal',
  'time',
  'compound',
  'dedupe',
  'pnl',
  'risk',
  'scaleplan',
  'ledger',
  'dashboard',
  'dashview',
  'shell',
  'schema',
  'store',
  'backup',
  'deploy',
  'auth',
  'ingest',
  'r9',
  'tg',
  'close',
  'analytics',
  'journal',
  'journalview',
  'siglog',
  'check',
  'livevectors',
  'liveverify',
];
const libUrl = name => new URL(`./lib/${name}.mjs`, import.meta.url);

export function stripModule(src, name) {
  // 한 줄 또는 여러 줄 import 제거
  let out = src.replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*\r?\n/gm, '');
  if (/^\s*export\s+default\b/m.test(out)) throw new Error(`${name}: export default 금지`);
  if (/^\s*export\s*\{/m.test(out)) throw new Error(`${name}: export { } 금지(선언에 직접 export 사용)`);
  out = out.replace(/^export\s+(async\s+function|function|const|let|class)\b/gm, '$1');
  if (/\bimport\s*\(|\brequire\s*\(|\bimport\.meta\b|\bprocess\./.test(out)) throw new Error(`${name}: GAS에서 쓸 수 없는 모듈/Node 참조`);
  return out;
}
export function topLevelNames(code) {
  const names = []; const re = /^(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm; let m;
  while ((m = re.exec(code))) names.push(m[1]); return names;
}
export function exportedNames(src) {
  const names = []; const re = /^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm; let m;
  while ((m = re.exec(src))) names.push(m[1]); return names;
}
export function buildEngine() {
  const seen = new Map(), exported = [], parts = [`// RICH 300 engine bundle — 자동 생성 파일(rich300/build.mjs). 직접 수정하지 마세요.\n`];
  for (const name of ENGINE_MODULES) {
    const raw = readFileSync(libUrl(name), 'utf8'); exported.push(...exportedNames(raw));
    const code = stripModule(raw, name);
    for (const n of topLevelNames(code)) { if (seen.has(n)) throw new Error(`최상위 이름 충돌: ${n} (${seen.get(n)} / ${name})`); seen.set(n, name); }
    parts.push(`// ── ${name}.mjs ──\n${code}`);
  }
  // 최상위 const는 vm/google.script.run에서 전역 속성으로 보이지 않으므로, 내보낸 모든 이름을 한 객체로도 제공한다.
  parts.push(`// ── exports ──\nvar RICH300_ENGINE = { ${exported.join(', ')} };\n`);
  return parts.join('\n');
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const out = process.argv[2] ?? new URL('./dist/engine.gs', import.meta.url).pathname;
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, buildEngine()); console.log(`빌드 완료: ${out}`);
}
