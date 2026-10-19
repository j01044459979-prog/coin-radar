// run.mjs와의 연결부: 기존 정기 실행·기회 레이더가 끝난 뒤에만 호출되며, 꺼져 있으면 아무것도 하지 않고 어떤 오류도 밖으로 던지지 않는다.
import { signalMode } from './config.mjs';
import { runSignalSafe } from './step.mjs';
import { PROCESS_BUDGET_MS, FINISH_GRACE_MS, MIN_RUN_MS } from '../opportunity/integrate.mjs';

export const MAX_RUN_MS = 90000;

export async function runSignalAfterCycle({ state, save, send = null, env = process.env, out = console.log, now = Date.now(), elapsedMs = process.uptime() * 1000, ...options }) {
  const mode = signalMode(env);
  if (mode === 'off') return null;
  const remaining = PROCESS_BUDGET_MS - elapsedMs - FINISH_GRACE_MS;
  if (remaining < MIN_RUN_MS) { const skipped = { mode, skipped: 'time-budget', elapsedMs: Math.round(elapsedMs) }; out('SIGNAL ' + JSON.stringify(skipped)); return skipped; }
  const timeoutMs = Math.min(MAX_RUN_MS, remaining), budgetMs = Math.max(5000, Math.min(40000, timeoutMs - 30000));
  const result = await runSignalSafe({ now, state, save, send, env, log: () => {}, timeoutMs, budgetMs, ...options });
  const { preview, ...rest } = result;
  if (rest.skipped !== 'off') out('SIGNAL ' + JSON.stringify(rest));
  if (preview) { preview.lines.forEach(l => out('SIGNAL ' + l)); preview.messages.forEach((m, i) => out('===== SIGNAL message ' + (i + 1) + '/' + preview.messages.length + ' =====\n' + m)); }
  return result;
}
