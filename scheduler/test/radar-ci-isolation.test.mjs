import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const wf = readFileSync(new URL('../../.github/workflows/radar.yml', import.meta.url), 'utf8');
const on = wf.slice(wf.indexOf('\non:'), wf.indexOf('\npermissions:'));
test('운영 radar.yml: push 트리거 없음(브랜치 push가 운영 concurrency 그룹을 점유하지 않는다), schedule·dispatch 유지', () => {
  assert.doesNotMatch(on, /\n  push:/); assert.doesNotMatch(on, /pull_request/);
  assert.match(on, /\n  schedule:/); assert.match(on, /\n  workflow_dispatch:/);
  assert.match(wf, /group: radar\n  cancel-in-progress: false/);
});
test('PR 검증은 별도 워크플로(radar-pr-check)이고 concurrency 그룹 radar를 쓰지 않는다', () => {
  const pr = readFileSync(new URL('../../.github/workflows/radar-pr-check.yml', import.meta.url), 'utf8');
  assert.match(pr, /pull_request:/); assert.doesNotMatch(pr, /group: radar\b/); assert.doesNotMatch(pr, /TELEGRAM|secrets\./);
});
