// 테스트가 러너의 실제 Job Summary(GITHUB_STEP_SUMMARY)를 오염시키지 않는지 확인한다.
// run.mjs/cache-check.mjs를 자식 프로세스로 띄우는 테스트는 반드시 GITHUB_STEP_SUMMARY를 임시 파일로 덮어써야 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('자식 프로세스를 띄우는 테스트는 모두 GITHUB_STEP_SUMMARY를 덮어쓴다', () => {
  const dir = new URL('.', import.meta.url).pathname;
  for (const f of readdirSync(dir).filter(n => n.endsWith('.test.mjs') && n !== 'summary-isolation.test.mjs')) {
    const lines = readFileSync(join(dir, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/execFileSync\(process\.execPath, \[[^\]]*(run|cache-check)\.mjs/.test(line)) assert.match(line, /GITHUB_STEP_SUMMARY/, `${f}:${i + 1}`);
    });
  }
});

test('손상 상태 게이트를 실행해도 호출자의 요약 파일에는 쓰이지 않고 덮어쓴 임시 파일에만 쓰인다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'si-')); const real = join(dir, 'real-summary.md'), temp = join(dir, 'temp-summary.md');
  execFileSync('mkdir', ['-p', join(dir, 's')]); execFileSync('sh', ['-c', `printf '{bad' > ${join(dir, 's', 'state.json')}; : > ${join(dir, 'o')}`]);
  execFileSync(process.execPath, [new URL('../run.mjs', import.meta.url).pathname, '--gate'], { env: { ...process.env, GITHUB_STEP_SUMMARY: temp, RADAR_STATE_DIR: join(dir, 's'), GITHUB_OUTPUT: join(dir, 'o') }, encoding: 'utf8' });
  assert.equal(existsSync(real), false);
  assert.match(readFileSync(temp, 'utf8'), /corrupt-state/);
});
