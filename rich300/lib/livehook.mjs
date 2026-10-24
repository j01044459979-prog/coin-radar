// 폴링이 끝날 때마다 호출되는 시험 하니스 진입점(테스트 환경 전용): 안전 점검 → 마법사 진행 → 중간/최종 결과 발송.
//  io = { stats(), counters(), envName(), prodApproved(), removeTriggers(), saveHalt(obj), auto():[...], halt():obj|null }  (Apps Script가 속성으로 구현)
//  중단(halt)은 트리거 제거 + 사유 기록 + [TEST] 알림뿐이며 프로젝트·시트·백업·봇은 삭제하거나 바꾸지 않는다.
import { liveGet, liveSet, liveWizardTick } from './livewizard.mjs';
import { liveSafety } from './livesafe.mjs';
import { liveBuildReport, liveReportTexts } from './livereport.mjs';
import { tgPairedUser, tgSendMessage, tgCall } from './tg.mjs';
import { storeIntegrityCheck } from './store.mjs';

const liveDayKey = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
function liveSendTexts(env, texts) { const p = tgPairedUser(env); if (!p) return false; let ok = true; for (const t of texts) ok = tgSendMessage(env, p.chatId, t).ok && ok; return ok; }
export function liveReportNow(env, io, st) {
  const stats = io.stats(), items = liveBuildReport(env, { now: env.now(), auto: io.auto(), stats: { ...stats, retry: st ? st.retryTotal ?? stats.retry : stats.retry }, counters: io.counters(), halt: io.halt(), intervalMin: st ? st.intervalMin : 1 });
  return items;
}
function liveHalt(env, io, st, v) {
  const now = env.now(); st.phase = 'halted'; st.halt = { reason: v.reason, text: v.text, at: now }; liveSet(env, st); io.saveHalt(st.halt);
  try { io.removeTriggers(); } catch { /* 이미 없음 */ }
  if (v.graceful) { try { liveSendTexts(env, [...liveReportTexts(liveReportNow(env, io, st), { title: 'LIVE 최종 결과' }), '시험 시간이 끝나 폴링을 멈췄습니다(트리거 제거). 데이터·시트·백업은 그대로 있습니다.']); } catch { /* 발송 실패는 무시 */ } }
  else { try { liveSendTexts(env, [`자동 중단: ${v.text}. 트리거를 제거했습니다(데이터·시트·백업은 그대로입니다).`]); } catch { /* 발송이 막혔을 수 있음 */ } }
  return { halted: true, reason: v.reason };
}
export function liveHookRun(env, out, io) {
  let st = liveGet(env); if (!st || st.phase === 'halted') return { skipped: true };
  const now = env.now(), stats = io.stats(), ct = io.counters();
  st.errStreak = out.status === 'ok' || out.status === 'busy' ? 0 : (st.errStreak ?? 0) + 1;
  if (out.status === 'error' && out.code === 'auth') st.authError = true;
  if (out.status === 'exception' && out.quota) st.quotaHit = true;
  st.retryTotal = (st.retryTotal ?? 0) + (out.retry ?? 0);
  if (now - (st.integAt ?? 0) >= 1800000) { st.integAt = now; try { const ic = storeIntegrityCheck(env.storeEnv()); st.integrityBad = !ic.ok && !ic.issues.every(i => i.type === 'missing-view'); } catch { st.integrityBad = true; } }
  liveSet(env, st);
  const v = liveSafety({ env: io.envName(), prodApproved: io.prodApproved(), stats, intervalMin: st.intervalMin, now, startedAt: st.startedAt, errStreak: st.errStreak, authError: !!st.authError, quotaHit: !!st.quotaHit, sentToday: ct[`sent:${liveDayKey(now)}`] ?? 0, integrityBad: !!st.integrityBad });
  if (v.halt) return liveHalt(env, io, st, v);
  st = liveWizardTick(env, out) ?? st;
  if (st.phase === 'done' && !st.interimSent) { st.interimSent = true; liveSet(env, st); try { liveSendTexts(env, liveReportTexts(liveReportNow(env, io, st), { title: 'LIVE 중간 결과(24시간 항목은 WAIT)' })); } catch { /* 다음 틱에 재시도하지 않음(중복 방지) */ } }
  if (st.phase === 'done' && !st.finalSent && now - st.startedAt >= 24 * 3600000) { st.finalSent = true; liveSet(env, st); try { liveSendTexts(env, liveReportTexts(liveReportNow(env, io, st), { title: 'LIVE 최종 결과' })); } catch { /* ignore */ } }
  return { ok: true, phase: st.phase };
}
// 봇 확인: 테스트 봇이 맞는지(이름에 test), 웹훅이 없는지. 운영 봇 토큰을 실수로 넣었을 때 시작을 거부한다. 사용자명은 결과에 남기되 토큰은 다루지 않는다.
export function liveBotCheck(env) {
  const me = tgCall(env, 'getMe', {});
  if (!me.ok) return { ok: false, reason: me.code === 'auth' ? 'token-rejected' : `getMe-failed:${me.code}` };
  const username = String(me.result && me.result.username ? me.result.username : '');
  if (!/test/i.test(username)) return { ok: false, reason: 'not-test-bot' };
  const wh = tgCall(env, 'getWebhookInfo', {}); let removed = false;
  if (wh.ok && wh.result && wh.result.url) { const d = tgCall(env, 'deleteWebhook', { drop_pending_updates: false }); if (!d.ok) return { ok: false, reason: 'webhook-not-removed' }; removed = true; }
  return { ok: true, username, webhookRemoved: removed };
}
