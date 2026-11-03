// 상태 캐시 저장 검증 개선(2026-11-03 #1655): 저장 직후 조회 반영 지연으로 일시 miss 가 나도 즉시 실패하지 않고, 짧게 기다려 재조회한다.
// 끝내 확인되지 않으면 여전히 실행을 실패로 표시한다(검증을 지우거나 PASS 처리하지 않는다). 워크플로 YAML 의 조건식을 그대로 평가하는 시뮬레이션이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wf = readFileSync(new URL('../../.github/workflows/radar.yml', import.meta.url), 'utf8');
const region = wf.slice(wf.indexOf('      - name: Verify state saved'), wf.indexOf('      - name: Prolonged degradation alert'));
const steps = region.split(/\n(?=      - name: )/).map(b => b.replace(/^( *#[^\n]*\n)+/gm, '')).filter(b => /- name:/.test(b)).map(b => {
  const g = k => (b.match(new RegExp(`^        ${k}: (.*)$`, 'm')) || [])[1];
  return { name: b.match(/- name: (.*)/)[1].trim(), id: g('id'), cont: g('continue-on-error') === 'true', cond: g('if'), uses: g('uses'), run: g('run'), key: (b.match(/^          key: (.*)$/m) || [])[1], lookup: /lookup-only: true/.test(b), failMiss: /fail-on-cache-miss: true/.test(b), raw: b };
});
const evalCond = (cond, O) => {
  const js = cond.replace(/always\(\)/g, 'true').replace(/steps\.gate\.outputs\.run/g, "'true'").replace(/env\.MODE/g, "'once'").replace(/steps\.(\w+)\.outcome/g, (_, id) => `O[${JSON.stringify(id)}]`);
  return Boolean(new Function('O', `return (${js});`)(O));
};
// failing: 실패시킬 단계 이름 집합. 반환: 실행된 단계, 잠든 총 시간(초), 실행 실패 여부(continue-on-error 아닌 단계가 실패하면 true)
function simulate(failing) {
  const O = {}, ran = []; let sleep = 0, failed = false;
  for (const s of steps) {
    const run = evalCond(s.cond, O);
    if (!run) { if (s.id) O[s.id] = 'skipped'; continue; }
    ran.push(s.name); if (s.run) sleep += Number(s.run.match(/sleep (\d+)/)?.[1] ?? 0);
    const bad = failing.has(s.name);
    if (s.id) O[s.id] = bad ? 'failure' : 'success';
    if (bad && !s.cont) failed = true;
  }
  return { ran, sleep, failed };
}
const V = ['Verify state saved', 'Re-verify state saved (2)', 'Re-verify state saved (3)'], R = ['Verify retry save', 'Re-verify retry save (2)', 'Verify retry save (final)'];

test('정상 경로: 첫 조회가 성공하면 추가 대기·재조회·재저장이 전혀 일어나지 않는다(시간 0, 실행 성공)', () => {
  const r = simulate(new Set()); assert.deepEqual(r.ran, ['Verify state saved']); assert.equal(r.sleep, 0); assert.equal(r.failed, false);
});
test('#1655 재현: 첫 조회만 지연으로 실패해도 5초 뒤 재조회로 확인되면 재저장 없이 실행이 성공한다', () => {
  const r = simulate(new Set([V[0]])); assert.deepEqual(r.ran, [V[0], 'Wait 5s before re-verify', V[1]]); assert.equal(r.sleep, 5); assert.equal(r.failed, false);
});
test('두 번째 조회도 실패하면 10초 더 기다려 세 번째 조회, 거기서 확인되면 재저장 없이 성공', () => {
  const r = simulate(new Set([V[0], V[1]])); assert.ok(r.ran.includes(V[2]) && !r.ran.includes('Retry state save')); assert.equal(r.sleep, 15); assert.equal(r.failed, false);
});
test('세 번 모두 실패하면 다른 키로 재저장하고 재검증한다: 재검증이 확인되면 성공', () => {
  const r = simulate(new Set(V)); assert.ok(r.ran.includes('Retry state save') && r.ran.includes(R[0])); assert.equal(r.failed, false); assert.ok(!r.ran.includes(R[2]));
});
test('끝내 확인되지 않으면 실행을 실패로 표시한다(오류를 PASS 처리하지 않음) · 총 대기 30초 이하', () => {
  const r = simulate(new Set([...V, ...R])); assert.equal(r.failed, true); assert.ok(r.ran.includes(R[2])); assert.ok(r.sleep <= 30, `대기 ${r.sleep}초`);
});
test('재저장 단계 자체가 실패하면 실행이 실패로 표시된다', () => {
  const r = simulate(new Set([...V, 'Retry state save'])); assert.equal(r.failed, true);
});
test('안전 장치: 마지막 검증은 continue-on-error 가 아니고, 모든 조회는 lookup-only + fail-on-cache-miss 이며, 우회 문구가 없다', () => {
  const last = steps.find(s => s.name === R[2]); assert.ok(last && !last.cont);
  for (const s of steps.filter(s => /cache\/restore/.test(s.uses ?? ''))) { assert.ok(s.lookup && s.failMiss, s.name); assert.match(s.key, /^radar-state-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}(-retry)?$/, s.name); }
  assert.doesNotMatch(region, /\|\| true|exit 0|continue-on-error: \$\{\{/); assert.match(wf, /timeout-minutes: 8/);
  assert.ok(wf.indexOf('name: Prolonged degradation alert') > wf.indexOf('name: Verify retry save (final)'));
});
test('상태 연속성 보호는 그대로: 게이트 억제·stale 판정·재복원 단계가 저장 검증 변경과 무관하게 남아 있다', () => {
  for (const k of ['name: Check cache freshness', 'name: Restore newest cache', 'name: Gate', 'name: Save state']) assert.ok(wf.includes(k), k);
  assert.ok(wf.indexOf('name: Save state') < wf.indexOf('name: Verify state saved'));
});
