// run.mjs와의 연결부: 기존 정기 실행(cycle)이 끝난 뒤에만 호출되며, 꺼져 있으면 아무것도 하지 않고 어떤 오류도 밖으로 던지지 않는다.
import { settings } from './config.mjs';
import { runOpportunitySafe } from './step.mjs';

export async function runAfterCycle({ state, save, send = null, env = process.env, out = console.log, now = Date.now(), ...options }) {
  if (settings(env).mode === 'off') return null;
  const result = await runOpportunitySafe({ now, state, save, send, env, log: () => {}, ...options });
  const { preview, ...rest } = result;
  out('OPPORTUNITY ' + JSON.stringify(rest));
  if (preview) {
    if (preview.note) out('OPPORTUNITY ' + preview.note);
    preview.lines.forEach(l => out('OPPORTUNITY ' + l));
    preview.messages.forEach((m, i) => out('===== OPPORTUNITY message ' + (i + 1) + '/' + preview.messages.length + ' =====\n' + m));
  }
  return result;
}
