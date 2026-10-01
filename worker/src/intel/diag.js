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

// status API 의 diagnostics. code: never_ran | cron_not_seen | incomplete | error | ok
export async function diagnostics(db, now) {
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

  let code = 'ok';
  let hint = '정상: Cron 과 collector 가 실행되고 있습니다.';
  if (started === null && lastIntelCron === null) {
    code = 'cron_not_seen';
    hint = `정보 수집 Cron(${INTEL_CRON}) 실행 기록이 없습니다. Cloudflare Worker 의 Triggers 에 이 Cron 이 등록됐는지, 최신 배포(main)가 적용됐는지 확인하세요.`;
  } else if (started === null) {
    code = 'never_ran';
    hint = 'Cron 은 실행되지만 collector 가 한 번도 시작하지 못했습니다. Worker 로그(Observability)에서 오류를 확인하세요.';
  } else if (finished === null || finished < started) {
    if (now - started > 90000) {
      code = 'incomplete';
      hint = 'collector 가 시작했지만 완료 기록이 없습니다. 실행 시간/CPU 제한 초과가 의심됩니다. INTEL_DISABLED 로 출처를 줄이거나 Worker 로그를 확인하세요.';
    }
  } else if (error) {
    code = 'error';
    hint = '마지막 collector 실행에 오류가 있었습니다 (last_collector_error 참고). 개별 출처 오류는 sources 항목을 보세요.';
  }
  return {
    code,
    hint,
    last_cron_seen_at: seenAt,
    last_cron_expression: seenExpr,
    crons_seen: crons,
    last_collector_started_at: started,
    last_collector_finished_at: finished,
    last_collector_error: error,
  };
}
