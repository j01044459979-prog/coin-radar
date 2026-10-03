// 운영 진단: Cron 이 실제로 실행되는지, collector 가 시작/완료했는지를 D1(intel_meta)에 기록하고 status API 에 보여줍니다.
// 공개 강제수집 endpoint 는 만들지 않습니다 (읽기 전용 상태만 노출, 값은 짧은 시각/문자열).
import * as store from './store.js';
import { cronKind, INTEL_CRON } from '../cron.js';

const lastWrite = new Map(); // 같은 인스턴스에서 Cron 표현식별 마지막 기록 시각 (1분 감시 Cron 의 D1 쓰기를 줄이기 위함)
const MONITOR_THROTTLE_MS = 10 * 60000;

// Cron 이 실행될 때마다(감시 Cron 은 10분에 한 번만) 표현식과 시각을 기록. 실패해도 절대 예외를 던지지 않습니다.
export async function recordCronSeen(env, cron, now) {
  try {
    const db = env && env.DB && typeof env.DB.prepare === 'function' ? env.DB : null;
    if (!db) return;
    const expr = typeof cron === 'string' && cron.trim() ? cron.trim() : '(표현식 정보 없음)';
    if (cronKind(cron) === 'monitor' && now - (lastWrite.get(expr) || 0) < MONITOR_THROTTLE_MS) return;
    lastWrite.set(expr, now);
    await store.ensureIntelSchema(db);
    await store.setMeta(db, 'cron_seen:' + expr, now, now);
  } catch { /* 진단 기록 실패는 무시 */ }
}
export function resetCronThrottleForTests() {
  lastWrite.clear();
}

const num = (m, key) => (m.get(key) ? Number(m.get(key).value) : null);

// 출처 상태 요약: ok(모두 정상) | degraded(일부 오류/지연) | down(정상인 출처 없음) | pending(아직 한 번도 수집 안 함)
export function summarizeSources(sources) {
  const counts = { total: sources.length, ok: 0, error: 0, delayed: 0, pending: 0 };
  for (const s of sources) counts[s.status] = (counts[s.status] || 0) + 1;
  const problem = sources.filter((s) => s.status === 'error' || s.status === 'delayed').map((s) => s.id);
  const status = problem.length ? (counts.ok === 0 ? 'down' : 'degraded') : counts.pending === counts.total && counts.total > 0 ? 'pending' : 'ok';
  const official = sources.filter((s) => s.type === 'official');
  return { status, counts, problem_sources: problem, official_ok: official.length > 0 && official.every((s) => s.status === 'ok') };
}

const CRON_STALE_MS = 6 * 60000; // 정보 Cron 은 2분마다 → 6분 넘게 안 보이면 지연
const COLLECTOR_STALL_MS = 10 * 60000; // 완료 기록이 10분 넘게 갱신되지 않으면 멈춘 것으로 봄
const ago = (t, now) => (t ? `${Math.max(0, Math.round((now - t) / 60000))}분 전` : '기록 없음');

// status API 의 diagnostics. Cron · Collector · Source 를 따로 판정하고, 전부 정상일 때만 code 'ok'.
//  code: ok | cron_not_seen | never_ran | cron_stale | incomplete | collector_error | sources_down | sources_degraded | sources_pending
export async function diagnostics(db, now, sourceSummary = null) {
  const m = await store.loadMeta(db);
  const crons = {};
  let seenAt = null;
  let seenExpr = null;
  for (const [k, v] of m) {
    if (!k.startsWith('cron_seen:')) continue;
    const t = Number(v.value);
    crons[k.slice('cron_seen:'.length)] = t;
    if (seenAt === null || t > seenAt) { seenAt = t; seenExpr = k.slice('cron_seen:'.length); }
  }
  const started = num(m, 'last_collector_started_at');
  const finished = num(m, 'last_collector_finished_at');
  const error = m.get('last_collector_error') ? m.get('last_collector_error').value || null : null;
  const intelSeen = Object.entries(crons).filter(([e]) => cronKind(e) === 'intel').map(([, t]) => t);
  const lastIntelCron = intelSeen.length ? Math.max(...intelSeen) : null;

  // ① Cron
  const cronStatus = lastIntelCron === null && started === null ? 'not_seen' : now - Math.max(lastIntelCron || 0, started || 0) <= CRON_STALE_MS ? 'ok' : 'stale';
  // ② Collector
  let collectorStatus;
  if (started === null) collectorStatus = 'never_ran';
  else if (finished === null || finished < started) collectorStatus = now - started > 90000 ? 'incomplete' : 'running';
  else if (now - finished > COLLECTOR_STALL_MS && cronStatus === 'ok') collectorStatus = 'incomplete'; // Cron 은 오는데 완료 기록이 멈춤
  else if (error) collectorStatus = 'error';
  else collectorStatus = 'ok';
  // ③ Source
  const src = sourceSummary || { status: 'ok', counts: null, problem_sources: [] };

  let code = 'ok';
  if (cronStatus === 'not_seen' && collectorStatus === 'never_ran') code = 'cron_not_seen';
  else if (collectorStatus === 'never_ran') code = 'never_ran';
  else if (collectorStatus === 'incomplete') code = 'incomplete';
  else if (cronStatus === 'stale') code = 'cron_stale';
  else if (collectorStatus === 'error') code = 'collector_error';
  else if (src.status === 'down') code = 'sources_down';
  else if (src.status === 'degraded') code = 'sources_degraded';
  else if (src.status === 'pending') code = 'sources_pending';

  const cronText = cronStatus === 'ok' ? '정상' : cronStatus === 'stale' ? `지연 (마지막 ${ago(lastIntelCron, now)})` : '실행 기록 없음';
  const colText = { ok: '정상', running: '실행 중', incomplete: '미완료 (실행 시간/CPU 제한 의심)', error: '오류', never_ran: '시작 기록 없음' }[collectorStatus];
  const srcText = { ok: '모두 정상', degraded: `일부 오류 (${src.problem_sources.join(', ')})`, down: `전체 오류 (${src.problem_sources.join(', ')})`, pending: '수집 준비 중' }[src.status] || '확인 불가';
  let hint = `Cron ${cronText} · Collector ${colText} · Source ${srcText}`;
  if (code === 'cron_not_seen') hint += ` — 정보 수집 Cron(${INTEL_CRON}) 실행 기록이 없습니다. Cloudflare Worker 의 Triggers 에 이 Cron 이 등록됐는지, 최신 배포(main)가 적용됐는지 확인하세요.`;
  else if (code === 'never_ran') hint += ' — Cron 은 실행되지만 collector 가 한 번도 시작하지 못했습니다. Worker 로그(Observability)에서 오류를 확인하세요.';
  else if (code === 'incomplete') hint += ' — collector 가 시작했지만 완료 기록이 없습니다. 실행 시간/CPU 제한 초과가 의심됩니다. INTEL_DISABLED 로 출처를 줄이거나 Worker 로그를 확인하세요.';
  else if (code === 'sources_degraded' || code === 'sources_down') hint += ' — 오류 출처의 last_error 는 sources 항목을 보세요 (한 출처의 오류는 다른 출처 수집에 영향 없음).';
  return {
    code,
    hint,
    cron_status: { status: cronStatus, last_seen_at: lastIntelCron, expression: INTEL_CRON, seconds_since_last_seen: lastIntelCron ? Math.round((now - lastIntelCron) / 1000) : null },
    collector_status: { status: collectorStatus, started_at: started, finished_at: finished, last_error: error },
    source_status: src,
    last_cron_seen_at: seenAt,
    last_cron_expression: seenExpr,
    crons_seen: crons,
    last_collector_started_at: started,
    last_collector_finished_at: finished,
    last_collector_error: error,
  };
}
