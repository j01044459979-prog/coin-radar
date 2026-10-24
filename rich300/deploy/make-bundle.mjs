// RICH 300 Apps Script 배포 묶음 생성기. 사용: node rich300/deploy/make-bundle.mjs [출력 폴더] [--env test|prod] (기본 prod → rich300/dist/apps-script, test → rich300/dist/apps-script-test)
//  출력: Code.gs(엔진 + gas/*.gs 를 한 파일로), *.html(gas/*.html), appsscript.json(deploy/appsscript.json), MANIFEST.txt(파일 목록·크기·SHA-256)
//  · 붙여 넣기 1회 또는 clasp push 로 올릴 수 있는 형태. 비밀값은 포함하지 않는다(Script Properties 로만 주입). S0 프로브 코드는 포함하지 않는다.
//  · 생성물은 저장소에 커밋하지 않는다(rich300/dist 는 .gitignore).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { buildEngine } from '../build.mjs';

const here = p => new URL(p, import.meta.url);
export const BUNDLE_GAS_ORDER = ['Adapters.gs', 'Api.gs', 'Telegram.gs', 'Dashboard.gs', 'Journal.gs', 'Backup.gs', 'Deploy.gs', 'Verify.gs', 'Install.gs'];
const TEST_ONLY_GAS = [];   // (예약) 테스트 전용 파일 이름. 현재 없음. 있는 것만 포함, 나머지 *.gs 는 알파벳 순으로 뒤에
export function makeBundle({ env = 'prod' } = {}) {
  if (env !== 'test' && env !== 'prod') throw new Error('env 는 test 또는 prod');
  const dir = here('../gas/'), present = readdirSync(dir).filter(f => env === 'test' || !TEST_ONLY_GAS.includes(f)), gs = [...BUNDLE_GAS_ORDER.filter(f => present.includes(f)), ...present.filter(f => f.endsWith('.gs') && !BUNDLE_GAS_ORDER.includes(f)).sort()];
  const parts = [buildEngine(), ...gs.map(f => `// ── gas/${f} ──\n${readFileSync(new URL(f, dir), 'utf8')}`)], code = parts.join('\n');
  const html = Object.fromEntries(present.filter(f => f.endsWith('.html')).map(f => [f, readFileSync(new URL(f, dir), 'utf8')]));
  const manifest = readFileSync(here('./appsscript.json'), 'utf8');
  new vm.Script(code);                                                                  // 문법 검사
  if (/\bs0[A-Z]\w*\s*\(/.test(code)) throw new Error('S0 프로브 코드가 섞였습니다');
  const files = { 'Code.gs': code, ...html, 'appsscript.json': manifest };
  const lines = Object.entries(files).map(([n, c]) => `${createHash('sha256').update(c).digest('hex')}  ${String(Buffer.byteLength(c)).padStart(8)}  ${n}`);
  files['MANIFEST.txt'] = `RICH300 Apps Script bundle\n${lines.join('\n')}\n`;
  return { files, gasFiles: gs };
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2), ei = args.indexOf('--env'), env = ei >= 0 ? args[ei + 1] : 'prod', pos = args.filter((a, i) => !a.startsWith('--') && (ei < 0 || i !== ei + 1));
  const out = pos[0] ?? new URL(env === 'test' ? '../dist/apps-script-test/' : '../dist/apps-script/', import.meta.url).pathname; mkdirSync(out, { recursive: true });
  const { files } = makeBundle({ env }); for (const [n, c] of Object.entries(files)) writeFileSync(`${out.replace(/\/$/, '')}/${n}`, c);
  console.log(`생성 완료: ${out}\n${files['MANIFEST.txt']}`); if (!existsSync(out)) process.exit(1);
}
