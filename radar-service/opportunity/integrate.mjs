// run.mjs와의 연결부: 기존 정기 실행(cycle)이 끝난 뒤에만 호출되며, 꺼져 있으면 아무것도 하지 않고 어떤 오류도 밖으로 던지지 않는다.
import { settings } from './config.mjs';
import { runOpportunitySafe } from './step.mjs';

// 워크플로 전체 제한은 8분이고(앞 단계: 체크아웃·캐시 복원·게이트·설치·단위 테스트), 정기 레이더가 먼저 끝나야 상태 저장 단계가 안전하게 돈다.
// 그래서 'Run radar' 프로세스 시작 후 PROCESS_BUDGET_MS가 지나면 기회 레이더를 건너뛰고, 남은 시간 안(+ 이미 시작한 HTTP 요청의 마무리 여유)에서만 실행한다.
export const PROCESS_BUDGET_MS = 300000;   // 프로세스 시작 후 이 시간까지만 기회 레이더가 일한다(5분)
export const FINISH_GRACE_MS = 15000;      // 시작된 Telegram 요청이 클라이언트 제한(10초)으로 끝나기를 기다릴 여유
export const MIN_RUN_MS = 25000;           // 이보다 적게 남았으면 시작하지 않는다
export const MAX_RUN_MS = 120000;

export async function runAfterCycle({ state, save, send = null, env = process.env, out = console.log, now = Date.now(), elapsedMs = process.uptime() * 1000, ...options }) {
  if (settings(env).mode === 'off') return null;
  const remaining = PROCESS_BUDGET_MS - elapsedMs - FINISH_GRACE_MS;
  if (remaining < MIN_RUN_MS) { const skipped = { mode: settings(env).mode, skipped: 'time-budget', elapsedMs: Math.round(elapsedMs) }; out('OPPORTUNITY ' + JSON.stringify(skipped)); return skipped; }
  const timeoutMs = Math.min(MAX_RUN_MS, remaining), budgetMs = Math.max(5000, Math.min(60000, timeoutMs - 30000));
  const result = await runOpportunitySafe({ now, state, save, send, env, log: () => {}, timeoutMs, budgetMs, ...options });
  const { preview, ...rest } = result;
  out('OPPORTUNITY ' + JSON.stringify(rest));
  if (preview) {
    if (preview.note) out('OPPORTUNITY ' + preview.note);
    preview.lines.forEach(l => out('OPPORTUNITY ' + l));
    preview.messages.forEach((m, i) => out('===== OPPORTUNITY message ' + (i + 1) + '/' + preview.messages.length + ' =====\n' + m));
  }
  return result;
}
