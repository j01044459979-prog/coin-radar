// radar 5분 슬롯 운영 보고(읽기 전용): 최근 N시간의 radar 실행·피드 게시 이력을 GitHub REST API로 읽어 슬롯 단위로 집계한다. 비밀값·쓰기·Telegram 없음.
//  node scheduler/slot-report.mjs [--hours 24]   (GITHUB_TOKEN, GITHUB_REPOSITORY 필요 · actions: read)
// 한계: Cloudflare Worker가 보낸 '요청 수'는 GitHub에서 접수된 실행으로만 셀 수 있다(접수 전에 거부된 요청은 Cloudflare 로그에만 남는다). 접수된 cloudflare 실행 수 = 접수된 요청 수.
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const SLOT_MS = 300000, LATE_MIN = 20;
const API = 'https://api.github.com';
export function parseTitle(t) {
  const m = /^radar · (\S+) · (\S+) · slot (\S+)$/.exec(String(t || '').trim());
  return m ? { event: m[1], source: m[2] === '-' ? null : m[2], slot: m[3] === '-' ? null : Number(m[3]) } : null;
}
const ms = x => Date.parse(x) || 0, mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null), max = a => (a.length ? Math.max(...a) : null);
const med = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y), k = b.length >> 1; return b.length % 2 ? b[k] : (b[k - 1] + b[k]) / 2; };
export const captureFromGaps = (gaps, lateMin = LATE_MIN) => { const tot = gaps.reduce((x, y) => x + y, 0); return tot > 0 ? gaps.reduce((x, y) => x + Math.min(y, lateMin), 0) / tot : null; };

// 실행 하나의 분류. job: 그 실행의 첫 job({ steps, created_at, started_at, completed_at, conclusion }) 또는 null.
//  analyzed = 게이트를 통과해 'Run radar' 단계가 실제로 실행됨 · gated = 게이트가 건너뜀(중복·롤백·Cloudflare 정상) · failed · cancelled · running · unknown
export function classify(run, job) {
  if (run.status !== 'completed') return 'running';
  if (run.conclusion === 'cancelled') return 'cancelled';
  const step = job?.steps?.find(s => s.name === 'Run radar');
  if (step) { if (step.conclusion === 'skipped') return run.conclusion === 'success' ? 'gated' : 'failed'; return run.conclusion === 'success' ? 'analyzed' : 'failed'; }
  return run.conclusion === 'success' ? 'unknown' : 'failed';
}

export function buildSlotReport({ runs, jobs = {}, feedRuns = [], now, hours = 24 }) {
  const from = now - hours * 3600000, expected = Math.floor(hours * 3600000 / SLOT_MS);
  const rows = runs.filter(r => ms(r.created_at) >= from).map(r => {
    const t = parseTitle(r.display_title || r.name) || { event: r.event, source: null, slot: null }, job = jobs[r.id] ?? null;
    const slot = t.slot ?? Math.floor(ms(r.created_at) / SLOT_MS), kind = classify(r, job);
    const startDelay = t.slot !== null ? ms(r.created_at) - t.slot * SLOT_MS : null;     // 슬롯 시작 → GitHub 실행 생성(디스패치 지연)
    const queue = job?.created_at && job?.started_at ? ms(job.started_at) - ms(job.created_at) : null;
    const dur = job?.started_at && job?.completed_at ? ms(job.completed_at) - ms(job.started_at) : null;
    return { id: r.id, source: t.source || (t.event === 'schedule' ? 'github-schedule' : 'manual'), slot, kind, createdAt: ms(r.created_at), startDelay, queue, dur, conclusion: r.conclusion };
  }).sort((a, b) => a.createdAt - b.createdAt);
  const count = k => rows.filter(r => r.kind === k).length, bySource = {}; for (const r of rows) bySource[r.source] = (bySource[r.source] || 0) + 1;
  const analyzed = rows.filter(r => r.kind === 'analyzed'), slotsAnalyzed = new Set(analyzed.map(r => r.slot));
  const perSlot = new Map(); for (const r of analyzed) perSlot.set(r.slot, (perSlot.get(r.slot) || 0) + 1);
  const gaps = analyzed.slice(1).map((r, i) => (r.createdAt - analyzed[i].createdAt) / 60000);
  const feedBy = new Map(); for (const f of feedRuns) { const m = /radar run (\d+)/.exec(f.display_title || f.name || ''); if (m) feedBy.set(m[1], f); }
  const feed = { published: 0, notPublished: [], pending: 0 };
  for (const r of analyzed.filter(r => r.conclusion === 'success')) { const f = feedBy.get(String(r.id)); if (!f) feed.notPublished.push({ run: r.id, why: '피드 워크플로 실행 없음' }); else if (f.status !== 'completed') feed.pending++; else if (f.conclusion === 'success') feed.published++; else feed.notPublished.push({ run: r.id, why: `피드 워크플로 ${f.conclusion}` }); }
  const cf = rows.filter(r => r.source === 'cloudflare'), sd = cf.map(r => r.startDelay).filter(x => x !== null), q = rows.map(r => r.queue).filter(x => x !== null), d = analyzed.map(r => r.dur).filter(x => x !== null);
  const dupSlots = [...perSlot.entries()].filter(([, n]) => n > 1).map(([s, n]) => ({ slot: s, runs: n }));
  const out = {
    hours, expectedSlots: expected, runs: rows.length, bySource, analyzed: analyzed.length, gated: count('gated'), failed: count('failed'), cancelled: count('cancelled'), running: count('running'), unknown: count('unknown'),
    slotsCovered: slotsAnalyzed.size, coverage: expected ? Math.min(1, slotsAnalyzed.size / expected) : null, duplicateAnalyses: dupSlots,
    gapMin: { mean: mean(gaps), median: med(gaps), max: max(gaps) }, capture: captureFromGaps(gaps),
    cloudflare: { accepted: cf.length, startDelaySec: { mean: sd.length ? mean(sd) / 1000 : null, max: sd.length ? max(sd) / 1000 : null } },
    queueSec: { mean: q.length ? mean(q) / 1000 : null, max: q.length ? max(q) / 1000 : null }, durationSec: { mean: d.length ? mean(d) / 1000 : null, max: d.length ? max(d) / 1000 : null },
    feed, issues: [],
  };
  if (dupSlots.length) out.issues.push(`같은 슬롯에서 분석이 2회 이상 실행됨: ${dupSlots.map(x => `${x.slot}(${x.runs}회)`).join(', ')}`);
  if (out.failed) out.issues.push(`실패한 실행 ${out.failed}건`);
  if (out.cancelled) out.issues.push(`취소된 실행 ${out.cancelled}건(대기열 교체 또는 시간 초과)`);
  if (feed.notPublished.length) out.issues.push(`피드가 게시되지 않은 성공 실행 ${feed.notPublished.length}건`);
  if (out.gapMin.max !== null && out.gapMin.max > 15) out.issues.push(`분석 실행 간격 최대 ${out.gapMin.max.toFixed(0)}분(15분 초과)`);
  return out;
}

const f1 = x => (x === null || x === undefined || !Number.isFinite(x) ? '-' : x.toFixed(1)), pc = x => (x === null || x === undefined || !Number.isFinite(x) ? '-' : `${(x * 100).toFixed(1)}%`);
export function renderSlotReport(r) {
  return [`### radar 5분 슬롯 운영 보고 (최근 ${r.hours}시간)`, '',
    '| 항목 | 값 |', '|---|---|',
    `| 기대 슬롯 | ${r.expectedSlots} |`, `| GitHub 실행(전체) | ${r.runs} (${Object.entries(r.bySource).map(([k, v]) => `${k} ${v}`).join(' · ') || '-'}) |`,
    `| 분석 실행(게이트 통과) | ${r.analyzed} |`, `| 게이트가 건너뜀(중복·백업 대기) | ${r.gated} |`, `| 실패 / 취소 / 진행 중 | ${r.failed} / ${r.cancelled} / ${r.running} |`,
    `| 분석된 슬롯 / 커버리지 | ${r.slotsCovered} / ${pc(r.coverage)} |`, `| 같은 슬롯 중복 분석 | ${r.duplicateAnalyses.length} |`,
    `| 분석 간격(분) 평균 / 중앙값 / 최대 | ${f1(r.gapMin.mean)} / ${f1(r.gapMin.median)} / ${f1(r.gapMin.max)} |`, `| 추정 신호 포착률(20분 한도) | ${pc(r.capture)} |`,
    `| Cloudflare 접수 실행 수 | ${r.cloudflare.accepted} |`, `| 디스패치 지연(슬롯 시작→실행 생성, 초) 평균 / 최대 | ${f1(r.cloudflare.startDelaySec.mean)} / ${f1(r.cloudflare.startDelaySec.max)} |`,
    `| 대기열(초) 평균 / 최대 | ${f1(r.queueSec.mean)} / ${f1(r.queueSec.max)} |`, `| 분석 소요(초) 평균 / 최대 | ${f1(r.durationSec.mean)} / ${f1(r.durationSec.max)} |`,
    `| 피드 게시 성공 / 미게시 / 진행 중 | ${r.feed.published} / ${r.feed.notPublished.length} / ${r.feed.pending} |`, '',
    r.issues.length ? `**점검 필요:**\n${r.issues.map(x => `- ${x}`).join('\n')}` : '**점검 필요 항목 없음**'].join('\n');
}

async function gh(path, token, fetchImpl) {
  const res = await fetchImpl(`${API}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'coin-radar-slot-report' } });
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${path.split('?')[0]}`);
  return res.json();
}
export async function collect({ repo, token, hours, now = Date.now(), fetchImpl = fetch }) {
  const since = new Date(now - hours * 3600000).toISOString().replace(/\.\d+Z$/, 'Z'), runs = [];
  for (let page = 1; page <= 10; page++) {
    const b = await gh(`/repos/${repo}/actions/workflows/radar.yml/runs?branch=main&per_page=100&page=${page}&created=${encodeURIComponent('>=' + since)}`, token, fetchImpl);
    runs.push(...b.workflow_runs); if (b.workflow_runs.length < 100) break;
  }
  const feedRuns = []; for (let page = 1; page <= 10; page++) { const b = await gh(`/repos/${repo}/actions/workflows/rich300-feed.yml/runs?per_page=100&page=${page}&created=${encodeURIComponent('>=' + since)}`, token, fetchImpl); feedRuns.push(...b.workflow_runs); if (b.workflow_runs.length < 100) break; }
  const jobs = {}; for (const r of runs) if (r.status === 'completed' && r.conclusion !== 'cancelled') { try { jobs[r.id] = (await gh(`/repos/${repo}/actions/runs/${r.id}/jobs?per_page=5`, token, fetchImpl)).jobs?.[0] ?? null; } catch { jobs[r.id] = null; } }
  return { runs, jobs, feedRuns, now, hours };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const i = process.argv.indexOf('--hours'), hours = i >= 0 ? Math.max(1, Math.min(168, Number(process.argv[i + 1]) || 24)) : 24;
    const repo = process.env.GITHUB_REPOSITORY, token = process.env.GITHUB_TOKEN; if (!repo || !token) throw new Error('GITHUB_REPOSITORY / GITHUB_TOKEN 이 필요합니다');
    const rep = buildSlotReport(await collect({ repo, token, hours })), md = renderSlotReport(rep);
    console.log(md); console.log('JSON ' + JSON.stringify(rep));
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  } catch (error) { console.log(`::error title=슬롯 보고 실패::${String(error.message).replace(/[\r\n]+/g, ' ').slice(0, 200)}`); process.exit(1); }
}
