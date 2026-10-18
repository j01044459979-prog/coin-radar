// 기회 포착 레이더 실행 단계: 수집 → 분석 → 상태 전이 → 우선순위 정렬·상한 → Telegram 알림 → 상태 저장.
// 기능 플래그 RADAR_OPPORTUNITY: 'off'(기본, 미설정 포함) | 'preview'(분석·메시지 생성만, 전송·알림 상태 저장 없음) | 'on'(전송). 설정 전체는 config.mjs.
// 기존 운영 알림과 완전히 분리된다: 상태는 state.opportunity 아래에만 쓰고, 어떤 오류도 기존 레이더 실행에 영향을 주지 않는다(runOpportunitySafe).
import { RESTRICTED, sendText, waitMs } from '../service.mjs';
import { analyzeCoin, STAGE } from './analysis.mjs';
import { collectOpportunity, LIMITS } from './collect.mjs';
import { READY_RESERVE, settings } from './config.mjs';
import { formatAlerts, formatBaseline, summaryLines } from './message.mjs';
import { sortAlerts } from './priority.mjs';
import { seedEntry, transition } from './transition.mjs';
import { H1 } from './indicators.mjs';

export { modeOf } from './config.mjs';
export const SETTLE_MS = 20000;            // 정시 직후 거래소가 봉을 확정할 시간
export const MAX_ALERT_COINS = 12;         // 시간당 알림 코인 수 기본값(config.DEFAULTS.maxPerHour와 같음)
export const PENDING_RETRY_MS = 240000;    // 확정 대기 종목 재조회 최소 간격
export const PRUNE_MS = 7 * 24 * H1;
export const DAILY_KEEP = 14;              // 일일 발송량 기록 보관 일수

const fresh = () => ({ v: 1, coins: {}, scanHour: null, attemptHour: null, rescanHour: null, pending: [], pendingHour: null, universe: null, retryAt: 0, lastScanAt: 0, lastError: null, failures: 0, previewHour: null, health: null, baselineDone: false, baselineAt: null, sent: { hour: null, coins: 0, ready: 0, messages: 0 }, daily: {} });

// 저장된 상태가 손상됐거나 형식이 다르면 안전하게 초기화한다. 초기화되면 baselineDone이 false가 되어 첫 실행 정책(기본: 기존 관찰은 알림 없이 기준선 기록)이 다시 적용되므로
// 캐시 유실 뒤에도 기존 관찰 후보가 대량 재발송되지 않는다.
export function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 1 || !raw.coins || typeof raw.coins !== 'object' || Array.isArray(raw.coins)) return fresh();
  const out = { ...fresh(), ...raw, coins: {} };
  for (const [sym, c] of Object.entries(raw.coins)) {
    if (!/^[A-Z0-9]+USDT$/.test(sym) || !c || typeof c !== 'object') continue;
    if (![0, 1, 2, 3].includes(c.stage) || ![null, 'LONG', 'SHORT'].includes(c.dir) || !Number.isFinite(c.lastBarT)) continue;
    out.coins[sym] = c;
  }
  if (!Array.isArray(out.pending)) out.pending = [];
  if (!Array.isArray(out.universe)) out.universe = null;
  if (!out.sent || typeof out.sent !== 'object') out.sent = fresh().sent;
  if (!out.daily || typeof out.daily !== 'object' || Array.isArray(out.daily)) out.daily = {};
  out.baselineDone = out.baselineDone === true;
  return out;
}

const dayKey = now => new Date(now).toISOString().slice(0, 10);
const dayRec = (opp, now) => (opp.daily[dayKey(now)] ||= { coins: 0, messages: 0, ready: 0, held: 0, baseline: 0, failures: 0 });
function pruneDaily(opp, now) {
  const keep = new Set(Array.from({ length: DAILY_KEEP }, (_, k) => dayKey(now - k * 86400000)));
  for (const k of Object.keys(opp.daily)) if (!keep.has(k)) delete opp.daily[k];
}

export async function opportunityStep({ now, state, env = process.env, fetcher = fetch, send = null, save = async () => {}, log = () => {}, collect = collectOpportunity, force = false, gapMs = 260, budgetMs = 60000, deadline = Infinity } = {}) {
  const cfg = settings(env), mode = cfg.mode;
  if (mode === 'off') return { mode, skipped: 'off' };
  const expired = () => Date.now() > deadline;
  const hour = Math.floor(now / H1), hourStart = hour * H1;
  if (state.quiet && state.quiet.hour === hour) return { mode, skipped: 'quiet' };            // 상태 연속성이 의심되는 시간대: 기존 레이더와 같이 전송하지 않는다
  if (now < (state.retryAt || 0)) return { mode, skipped: 'shared-backoff' };                  // 기존 레이더가 거래소 제한 응답으로 대기 중이면 같이 쉰다
  const live = mode === 'on';
  if (live && typeof send !== 'function') return { mode, skipped: 'no-sender' };
  const stored = normalize(state.opportunity);
  const opp = live ? stored : structuredClone(stored);                                          // 미리보기는 실제 상태를 바꾸지 않는다
  if (live) state.opportunity = opp;
  if (now < opp.retryAt) return { mode, skipped: 'backoff', until: opp.retryAt };

  // 저장 실패는 예외로 번지지 않게 기록한다. 저장이 안 된 상태에서 더 보내면 중복이 늘어나므로 호출한 쪽이 전송을 멈춘다.
  let saveError = null;
  const safeSave = async () => { try { await save(state); return true; } catch (error) { saveError = String(error.message).slice(0, 80); opp.lastError = `state save: ${saveError}`; return false; } };

  // 실행 시점 판단: 매 정시 직후 1회 + 확정 대기 종목 재시도
  const pendingRun = opp.pendingHour === hour && opp.pending.length > 0;
  const hourDue = opp.scanHour !== hour && now - hourStart >= SETTLE_MS && (opp.attemptHour !== hour || opp.rescanHour === hour);   // 정시 직후 1회, 전송·저장 실패·수집 실패 때만 같은 시간대에 다시
  if (!force) {
    if (!live && opp.previewHour === hour) return { mode, skipped: 'preview-done' };
    if (!(hourDue || (pendingRun && now - opp.lastScanAt >= PENDING_RETRY_MS))) return { mode, skipped: 'not-due' };
  }
  const retryIds = pendingRun && !hourDue ? opp.pending : null;
  const coll = await collect({ fetcher, now, ids: retryIds, topN: cfg.topN, budgetMs, gapMs });
  if (expired()) return { mode, timedOut: true };                                                // 시간 초과 뒤 늦게 끝난 수집은 아무것도 바꾸지 않는다
  opp.lastScanAt = now; opp.attemptHour = hour;
  if (coll.fatal) {
    opp.failures += 1; opp.rescanHour = hour; opp.lastError = coll.fatal.message;
    opp.retryAt = now + (coll.fatal.status ? waitMs(coll.fatal.status, coll.fatal.retryAfter) : Math.min(600000 * opp.failures, 3600000));
    if (live) await safeSave();
    return { mode, failed: coll.fatal.message, retryAt: opp.retryAt, saveError };
  }
  if (coll.stopped) opp.retryAt = now + waitMs(coll.stopped.status, coll.stopped.retryAfter);
  if (!retryIds) opp.universe = coll.universe;

  // 분석
  const rows = [], excluded = [], newPending = [], analyses = [];
  const grace = now - hourStart < LIMITS.graceMs;
  for (const [instId, entry] of Object.entries(coll.coins)) {
    const symbol = entry.symbol;
    if (entry.status === 'pending' && (grace || coll.stopped)) { newPending.push(instId); rows.push({ symbol, reason: entry.reason }); continue; }
    if (entry.status !== 'fresh') { excluded.push(symbol); rows.push({ symbol, reason: entry.status === 'pending' ? '확정 지연(유예 시간 초과)' : entry.reason }); continue; }
    const analysis = analyzeCoin(entry.c1h, entry.c4h, coll.btc4h);
    rows.push({ symbol, analysis });
    if (analysis.status !== 'ok') { excluded.push(symbol); continue; }
    analyses.push({ symbol, analysis });
  }
  const ok = rows.filter(r => r.analysis?.status === 'ok');
  const states = ok.filter(r => r.analysis.stage >= 1).map(r => ({ symbol: r.symbol, dir: r.analysis.dir, stage: r.analysis.stage, stageLabel: STAGE[r.analysis.stage] }));
  const health = { excluded, failures: opp.failures, states: { analyzed: ok.length, long: ok.filter(r => r.analysis.dir === 'LONG').map(r => r.symbol), short: ok.filter(r => r.analysis.dir === 'SHORT').map(r => r.symbol), wait: ok.filter(r => r.analysis.stage === 0).length } };

  // 첫 실행 정책: 처음 켤 때(또는 상태 유실 뒤) 기존 관찰 상태는 알림 없이 기준선으로 기록한다. alert 정책만 일반 규칙으로 알린다.
  const baselineNeeded = !opp.baselineDone && cfg.firstRun !== 'alert' && analyses.length > 0;
  const base = { mode, analyzed: ok.length, watching: states.length, excluded: excluded.length, pending: newPending.length, calls: coll.calls, stopped: coll.stopped, sendError: null, saveError: null, events: 0, held: 0, sentMessages: 0, baseline: false };
  if (baselineNeeded) {
    const message = cfg.firstRun === 'summary' ? formatBaseline(states, { now, analyzed: ok.length, wait: health.states.wait, excluded: excluded.length }) : null;
    base.baseline = true;
    if (!live) {                                                                                  // 미리보기: 켜면 이렇게 동작한다는 것만 보여준다
      stored.previewHour = hour; state.opportunity = stored; await safeSave();
      // 검토를 돕기 위해, 기준선 이후 새 관찰이 생겼을 때 나가는 개별 알림 메시지의 모양도 함께 보여 준다(실제로는 이 시점에 보내지 않는다).
      const sample = sortAlerts(analyses.map(a => ({ a, t: transition(null, a.analysis, now, { minStage: cfg.minStage }) })).filter(x => x.t.event).map(x => ({ symbol: x.a.symbol, event: x.t.event, analysis: x.a.analysis, price: x.a.analysis.price }))).slice(0, cfg.maxPerHour);
      const sampleMessages = formatAlerts(sample, { now, health }).map(m => m.plain);
      return { ...base, preview: { lines: summaryLines(rows), messages: [...(message ? [message.plain] : []), ...sampleMessages], note: `첫 실행 정책(${cfg.firstRun}): 현재 관찰 ${states.length}종목은 알림 없이 기준선으로 기록됩니다. 아래 ${message ? '둘째 메시지부터는' : '메시지는'} 기준선 이후 새 관찰이 생겼을 때의 개별 알림 모양 예시입니다(지금은 보내지 않음).` } };
    }
    let sendFail = null;
    if (message) { try { await sendText(send, message); } catch (error) { sendFail = error; } }
    if (sendFail) {                                                                               // 요약 전송에 실패하면 기준선도 확정하지 않고 다음 시도에서 처음부터 다시 한다
      const sendError = String(sendFail.message).slice(0, 80);
      opp.failures += 1; opp.lastError = `Telegram: ${sendError}`; opp.rescanHour = hour;
      opp.retryAt = Math.max(opp.retryAt, now + (RESTRICTED.includes(sendFail.status) ? waitMs(sendFail.status, sendFail.retryAfter) : Math.min(600000 * opp.failures, 3600000)));
      await safeSave(); return { ...base, sendError, saveError };
    }
    for (const a of analyses) opp.coins[a.symbol] = seedEntry(a.analysis, now, { silent: cfg.firstRun === 'silent' });
    opp.baselineDone = true; opp.baselineAt = now; opp.failures = 0; opp.lastError = coll.stopped ? `거래소 제한 응답(${coll.stopped.status})` : null;
    if (message) { opp.sent = { hour, coins: 0, ready: 0, messages: (opp.sent.hour === hour ? opp.sent.messages : 0) + 1 }; const d = dayRec(opp, now); d.messages += 1; d.baseline = states.length; }
    opp.pending = newPending; opp.pendingHour = newPending.length ? hour : null; opp.rescanHour = null;
    if (!newPending.length) opp.scanHour = hour;
    pruneDaily(opp, now); opp.health = { at: now, analyzed: ok.length, excluded: excluded.length, pending: newPending.length, held: 0, calls: coll.calls, baseline: true };
    await safeSave();
    return { ...base, sentMessages: message ? 1 : 0, saveError };
  }

  // 일반 경로: 상태 전이
  const items = [], commitNow = {};
  for (const { symbol, analysis } of analyses) {
    const prev = opp.coins[symbol] ?? null;
    if (prev && analysis.barT <= prev.lastBarT) continue;                                       // 같은 봉을 다시 평가하지 않는다
    const t = transition(prev, analysis, now, { minStage: cfg.minStage });
    if (t.event) items.push({ symbol, event: t.event, analysis, price: analysis.price, prev, committed: t.committed });
    else commitNow[symbol] = t.next;
  }
  for (const [symbol, next] of Object.entries(commitNow)) opp.coins[symbol] = next;             // 알림이 필요 없는 상태 변화(1단계 기록 포함)는 바로 기록
  for (const [symbol, c] of Object.entries(opp.coins)) if (now - (c.lastBarT || 0) > PRUNE_MS) delete opp.coins[symbol];

  // 우선순위 정렬 → 시간당·일일 상한 → (조건 충족을 위한 시간당 예비 칸) 적용. 상한을 넘는 항목은 보류하며 다음 시간대에 다시 평가된다.
  if (opp.sent.hour !== hour) opp.sent = { hour, coins: 0, ready: 0, messages: 0 };
  const day = dayRec(opp, now), isReady = it => (it.analysis?.stage ?? 0) >= 3 && it.event.type !== 'cleared' && it.event.type !== 'invalidated';
  const reserve = Math.min(READY_RESERVE, Math.floor(cfg.maxPerHour / 4));
  const sorted = sortAlerts(items);
  const room = Math.max(0, Math.min(cfg.maxPerHour - opp.sent.coins, cfg.maxPerDay - day.coins));
  let otherRoom = Math.max(0, Math.min(room, (cfg.maxPerHour - reserve) - (opp.sent.coins - opp.sent.ready)));
  const toSend = [];
  for (const it of sorted) {
    if (toSend.length >= room) break;
    if (isReady(it)) toSend.push(it);
    else if (otherRoom > 0) { toSend.push(it); otherRoom--; }
  }
  const held = items.length - toSend.length;
  const messages = formatAlerts(toSend, { now, health });
  base.events = items.length; base.held = held;

  let sentMessages = 0, sendError = null;
  if (live) {
    for (const part of messages) {
      if (expired()) break;
      try { await sendText(send, part); }
      catch (error) { sendError = String(error.message).slice(0, 80); opp.lastSendStatus = error.status ?? null; if (RESTRICTED.includes(error.status)) opp.retryAt = Math.max(opp.retryAt, now + waitMs(error.status, error.retryAfter)); break; }
      for (const it of part.items) opp.coins[it.symbol] = it.committed;
      opp.sent.coins += part.items.length; opp.sent.ready += part.items.filter(isReady).length; opp.sent.messages += 1;
      day.coins += part.items.length; day.ready += part.items.filter(isReady).length; day.messages += 1;
      sentMessages++;
      if (!(await safeSave())) break;                                                             // 저장이 안 되면 더 보내지 않는다(재시작 때 중복이 늘어나므로)
    }
  }
  const allSent = !live || sentMessages === messages.length;
  const complete = allSent && newPending.length === 0 && !saveError;                             // 확정 대기·제한 응답으로 못 끝낸 종목, 전송·저장 실패가 있으면 이번 시간대를 끝내지 않고 다시 시도한다
  if (live) {
    if (sendError) { opp.failures += 1; day.failures += 1; opp.lastError = `Telegram: ${sendError}`; opp.retryAt = Math.max(opp.retryAt, now + Math.min(600000 * opp.failures, 3600000)); }
    else if (!saveError) { opp.failures = 0; opp.lastError = coll.stopped ? `거래소 제한 응답(${coll.stopped.status})` : null; }
    if (held > 0) day.held += held;
    opp.pending = newPending; opp.pendingHour = newPending.length ? hour : null; opp.rescanHour = !allSent || saveError ? hour : null;
    if (complete) opp.scanHour = hour;                                                           // 유예 시간이 지나도 확정되지 않은 종목은 분석에서 제외하고(excluded) 마친다
    if (!opp.baselineDone && cfg.firstRun === 'alert' && analyses.length) { opp.baselineDone = true; opp.baselineAt = now; }   // alert 정책: 기준선 없이 일반 규칙(상한 적용)으로 시작 — 분석된 종목이 없던 실행은 시작으로 치지 않는다
    pruneDaily(opp, now);
    opp.health = { at: now, analyzed: ok.length, excluded: excluded.length, pending: newPending.length, held, calls: coll.calls };
    await safeSave();
  } else {
    stored.previewHour = hour; state.opportunity = stored; await safeSave();                    // 미리보기는 같은 시간대에 한 번만 출력(알림 상태는 바꾸지 않는다)
  }
  const summary = { ...base, sentMessages, sendError, saveError, hourlySent: opp.sent.hour === hour ? opp.sent.coins : 0, dailySent: day.coins };
  if (!live) summary.preview = { lines: summaryLines(rows), messages: messages.map(m => m.plain) };
  log(JSON.stringify({ opportunity: { ...summary, preview: undefined } }));
  return summary;
}

// 기존 레이더 실행을 절대 방해하지 않는 래퍼: 예외·시간 초과는 요약으로만 남긴다. 시간 초과 뒤에는 단계가 더 이상 전송·상태 변경을 하지 않는다(deadline).
export async function runOpportunitySafe(args) {
  const timeoutMs = args.timeoutMs ?? 120000;
  let timer;
  try { return await Promise.race([opportunityStep({ ...args, deadline: Date.now() + timeoutMs }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('opportunity step timeout')), timeoutMs); })]); }
  catch (error) { return { mode: settings(args.env).mode, failed: String(error.message).slice(0, 120) }; }
  finally { clearTimeout(timer); }
}
