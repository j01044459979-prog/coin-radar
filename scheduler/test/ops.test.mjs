// 5분 안정화 운영 도구 테스트: 슬롯 보고 집계, 킬 스위치 워크플로, 24시간 게이트 시뮬레이션(Telegram·네트워크 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTitle, classify, buildSlotReport, renderSlotReport, captureFromGaps, SLOT_MS } from '../slot-report.mjs';
import { evaluateDeploy } from '../verify-deploy.mjs';
import { evaluate, slotOfTime } from '../../radar-service/gate.mjs';

const wf = n => readFileSync(new URL(`../../.github/workflows/${n}`, import.meta.url), 'utf8');
const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);

test('제목 파싱: Cloudflare 디스패치·schedule·수동', () => {
  assert.deepEqual(parseTitle('radar · workflow_dispatch · cloudflare · slot 5888472'), { event: 'workflow_dispatch', source: 'cloudflare', slot: 5888472 });
  assert.deepEqual(parseTitle('radar · schedule · - · slot -'), { event: 'schedule', source: null, slot: null });
  assert.equal(parseTitle('rich300-feed · radar run 1'), null);
});
test('분류: 분석 실행 / 게이트 건너뜀 / 실패 / 취소 / 진행 중', () => {
  const job = c => ({ steps: [{ name: 'Gate', conclusion: 'success' }, { name: 'Run radar', conclusion: c }] });
  assert.equal(classify({ status: 'completed', conclusion: 'success' }, job('success')), 'analyzed');
  assert.equal(classify({ status: 'completed', conclusion: 'success' }, job('skipped')), 'gated');
  assert.equal(classify({ status: 'completed', conclusion: 'failure' }, job('failure')), 'failed');
  assert.equal(classify({ status: 'completed', conclusion: 'cancelled' }, null), 'cancelled');
  assert.equal(classify({ status: 'in_progress', conclusion: null }, null), 'running');
});
// 24시간 합성 이력: 288슬롯 중 Cloudflare 접수 + GitHub schedule 백업(게이트 건너뜀) + 같은 슬롯 중복 1건 + 취소 1건 + 실패 1건
function history({ hours = 24 } = {}) {
  const runs = [], jobs = {}, feedRuns = []; let id = 1000;
  const add = (slot, source, kind, delaySec = 20) => {
    const created = slot * SLOT_MS + delaySec * 1000, r = { id: ++id, event: source === 'github-schedule' ? 'schedule' : 'workflow_dispatch', display_title: source === 'github-schedule' ? 'radar · schedule · - · slot -' : `radar · workflow_dispatch · ${source} · slot ${slot}`, status: kind === 'running' ? 'in_progress' : 'completed', conclusion: kind === 'cancelled' ? 'cancelled' : kind === 'failed' ? 'failure' : kind === 'running' ? null : 'success', created_at: new Date(created).toISOString() };
    runs.push(r);
    if (kind === 'analyzed' || kind === 'gated' || kind === 'failed') jobs[r.id] = { created_at: r.created_at, started_at: new Date(created + 5000).toISOString(), completed_at: new Date(created + (kind === 'analyzed' ? 140000 : 15000)).toISOString(), steps: [{ name: 'Run radar', conclusion: kind === 'analyzed' ? 'success' : kind === 'gated' ? 'skipped' : 'failure' }] };
    if (kind === 'analyzed') feedRuns.push({ display_title: `rich300-feed · radar run ${r.id}`, status: 'completed', conclusion: 'success' });
    return r;
  };
  const end = Math.floor(NOW / SLOT_MS), start = end - hours * 12;
  for (let s = start; s < end; s++) { add(s, 'cloudflare', s === start + 40 ? 'failed' : s === start + 41 ? 'cancelled' : 'analyzed'); if (s % 6 === 0) add(s, 'github-schedule', 'gated', 60); }
  add(start + 100, 'cloudflare', 'gated', 30);                          // 같은 슬롯 중복 디스패치는 게이트가 건너뜀
  return { runs, jobs, feedRuns, now: NOW, hours };
}
test('슬롯 보고: 24시간 합성 이력의 집계(커버리지·건너뜀·실패·취소·피드·간격)', () => {
  const h = history(), r = buildSlotReport(h);
  assert.equal(r.expectedSlots, 288); assert.equal(r.failed, 1); assert.equal(r.cancelled, 1); assert.equal(r.analyzed, 286);
  assert.equal(r.gated, 48 + 1); assert.equal(r.slotsCovered, 286); assert.ok(Math.abs(r.coverage - 286 / 288) < 1e-9);
  assert.deepEqual(r.duplicateAnalyses, []); assert.equal(r.cloudflare.accepted, 288 + 1);
  assert.ok(Math.abs(r.cloudflare.startDelaySec.mean - 20) < 1 && r.cloudflare.startDelaySec.max <= 30);
  assert.equal(r.feed.published, 286); assert.equal(r.feed.notPublished.length, 0);
  assert.ok(r.gapMin.max <= 15.1 + 5 && r.capture > 0.99, `간격 최대 ${r.gapMin.max}분`);
  assert.ok(r.issues.some(x => /실패/.test(x)) && r.issues.some(x => /취소/.test(x)));
  assert.match(renderSlotReport(r), /기대 슬롯 \| 288/);
});
test('슬롯 보고: 같은 슬롯 중복 분석·피드 미게시·긴 공백을 점검 항목으로 올린다', () => {
  const h = history({ hours: 2 });
  const dupSlot = Math.floor(NOW / SLOT_MS) - 3, extra = { id: 1, event: 'workflow_dispatch', display_title: `radar · workflow_dispatch · cloudflare · slot ${dupSlot}`, status: 'completed', conclusion: 'success', created_at: new Date(dupSlot * SLOT_MS + 90000).toISOString() };
  h.runs.push(extra); h.jobs[1] = { created_at: extra.created_at, started_at: extra.created_at, completed_at: extra.created_at, steps: [{ name: 'Run radar', conclusion: 'success' }] };
  h.feedRuns = h.feedRuns.slice(1);
  const r = buildSlotReport(h);
  assert.equal(r.duplicateAnalyses.length, 1); assert.ok(r.feed.notPublished.length >= 2); assert.ok(r.issues.some(x => /2회 이상/.test(x)) && r.issues.some(x => /피드가 게시되지 않은/.test(x)));
  const sparse = { runs: [], jobs: {}, feedRuns: [], now: NOW, hours: 24 }; for (const k of [0, 200, 250]) { const c = new Date(NOW - 20 * 3600000 + k * 300000).toISOString(); const run = { id: 5000 + k, event: 'schedule', display_title: 'radar · schedule · - · slot -', status: 'completed', conclusion: 'success', created_at: c }; sparse.runs.push(run); sparse.jobs[run.id] = { steps: [{ name: 'Run radar', conclusion: 'success' }] }; }
  const s = buildSlotReport(sparse); assert.ok(s.gapMin.max > 600 && s.capture < 0.1 && s.issues.some(x => /간격 최대/.test(x)));
  assert.ok(Math.abs(captureFromGaps([10, 10, 100]) - 40 / 120) < 1e-12);
});
test('킬 스위치 워크플로: 수동 전용·main만·상태별 확인 문구·최소 권한·Secret 출력 없음·웹사이트 Worker/Telegram 미접촉', () => {
  const t = wf('toggle-dispatcher.yml');
  assert.match(t, /on:\n  workflow_dispatch:/); assert.doesNotMatch(t, /\n  (push|schedule|pull_request)/);
  assert.match(t, /github\.ref == 'refs\/heads\/main'/); assert.match(t, /state == 'enabled' && github\.event\.inputs\.confirm == 'dispatch-on'/); assert.match(t, /state == 'disabled' && github\.event\.inputs\.confirm == 'dispatch-off'/);
  assert.match(t, /permissions:\n  contents: read/); assert.doesNotMatch(t, /: write/);
  assert.match(t, /wrangler@4\.146\.0 deploy --name coin-radar-dispatcher --var DISPATCH_ENABLED:true/); assert.match(t, /--var DISPATCH_ENABLED:false/);
  assert.doesNotMatch(t, /secret put|RADAR_DISPATCH_PAT|TELEGRAM|coin-radar-engine|RADAR_SCHEDULER:|echo "?\$CLOUDFLARE_API_TOKEN|set -x|--verbose/);
  assert.ok(t.indexOf('Scheduler tests') < t.indexOf('Deploy dispatcher') && t.indexOf('Deploy dispatcher') < t.indexOf('Verify deployment'));
});
test('슬롯 보고 워크플로: 읽기 전용(Secret·쓰기 없음)', () => {
  const t = wf('radar-slot-report.yml');
  assert.match(t, /permissions:\n  contents: read\n  actions: read/); assert.doesNotMatch(t, /: write|secrets\./);
});
test('배포 검증: 켜짐 상태 기대 시 DISPATCH_ENABLED=true만 통과, 꺼짐 기대 시 true는 실패', () => {
  const base = enabled => ({ schedules: { schedules: [{ cron: '*/5 * * * *' }] }, settings: { bindings: [{ name: 'DISPATCH_ENABLED', type: 'plain_text', text: enabled }, { name: 'GITHUB_DISPATCH_TOKEN', type: 'secret_text' }] }, subdomain: { enabled: false }, scripts: [{ id: 'coin-radar-engine', modified_on: 'x' }, { id: 'coin-radar-dispatcher' }], engineBefore: 'x' });
  assert.equal(evaluateDeploy({ ...base('true'), expectEnabled: true }).ok, true); assert.equal(evaluateDeploy({ ...base('true') }).ok, false);
  assert.equal(evaluateDeploy({ ...base('false'), expectEnabled: true }).ok, false); assert.equal(evaluateDeploy({ ...base('false') }).ok, true);
});

// ── 24시간 게이트 시뮬레이션: Cloudflare 디스패치(지터·지연·이중 발화) + GitHub schedule 백업(불규칙) 동시 작동 ──
function simulate({ scheduler = 'cloudflare', cfOutage = null, hours = 24, seed = 3 } = {}) {
  let x = seed; const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const start = Date.UTC(2026, 9, 31, 0, 0, 0), events = [];
  for (let s = 0; s < hours * 12; s++) {
    const slotStart = start + s * SLOT_MS, slot = slotOfTime(slotStart);
    if (!cfOutage || s < cfOutage[0] || s >= cfOutage[1]) { events.push({ at: slotStart + rnd() * 100000, source: 'cloudflare', slot }); if (rnd() < 0.05) events.push({ at: slotStart + 20000 + rnd() * 120000, source: 'cloudflare', slot }); }   // 이중 발화 5%
    if (rnd() < 0.3) events.push({ at: slotStart + rnd() * 1200000, source: 'github-schedule', slot: undefined });                                                         // 불규칙한 GitHub schedule
  }
  events.sort((a, b) => a.at - b.at);
  const state = {}, runs = []; let analysis = 0;
  for (const e of events) {
    const d = evaluate({ source: e.source, scheduler, state, now: e.at, slot: e.slot, cacheStatus: 'ok' });
    if (d.run) { state.lastAttempt = e.at; state.lastSlot = d.slot; runs.push({ at: e.at, slot: d.slot, source: e.source }); analysis++; }
  }
  return { runs, analysis, events: events.length, hours };
}
test('24시간 시뮬레이션(Cloudflare 모드): 슬롯당 분석 최대 1회(Telegram 중복 불가), 슬롯 단조 증가, 거의 모든 슬롯 실행, GitHub schedule은 대기', () => {
  const r = simulate(), slots = r.runs.map(x => x.slot);
  assert.equal(new Set(slots).size, slots.length, '같은 슬롯 중복 분석 없음'); assert.deepEqual(slots, [...slots].sort((a, b) => a - b), '슬롯 단조 증가');
  assert.ok(r.runs.length >= 280, `실행 ${r.runs.length}/288`); assert.ok(r.runs.every(x => x.source === 'cloudflare'), 'GitHub schedule은 Cloudflare가 정상일 때 실행하지 않음');
  const gaps = r.runs.slice(1).map((x, i) => (x.at - r.runs[i].at) / 60000); assert.ok(Math.max(...gaps) < 10.5, `최대 간격 ${Math.max(...gaps)}분`);
});
test('24시간 시뮬레이션: Cloudflare 2시간 장애 중 GitHub schedule이 15분 공백 뒤 대신 실행(자동 복구), 복귀 후에도 슬롯 중복 없음', () => {
  const r = simulate({ cfOutage: [60, 84], seed: 5 }), slots = r.runs.map(x => x.slot);
  assert.equal(new Set(slots).size, slots.length); assert.ok(r.runs.some(x => x.source === 'github-schedule'), '장애 중 백업 실행');
  const outageStart = Date.UTC(2026, 9, 31, 0, 0, 0) + 60 * SLOT_MS, outageEnd = outageStart + 24 * SLOT_MS, inside = r.runs.filter(x => x.at >= outageStart && x.at < outageEnd);
  assert.ok(inside.every(x => x.source === 'github-schedule') && inside.length >= 3, `장애 구간 실행 ${inside.length}건`);
  assert.ok(r.runs.slice(-100).every(x => x.source === 'cloudflare') || r.runs.at(-1).source === 'cloudflare', '복귀 후 Cloudflare 주기로 돌아옴');
});
test('24시간 시뮬레이션(롤백: RADAR_SCHEDULER=github): Cloudflare 디스패치는 전부 무시되고 GitHub schedule만 실행 — 두 스케줄러 이중 실행 없음', () => {
  const r = simulate({ scheduler: 'github' }); assert.ok(r.runs.every(x => x.source === 'github-schedule')); assert.equal(new Set(r.runs.map(x => x.slot)).size, r.runs.length);
});
