// 기회 포착 레이더 실행 단계: 수집 → 분석 → 상태 전이 → 우선순위 정렬·상한 → Telegram 알림 → 상태 저장.
// 기능 플래그 RADAR_OPPORTUNITY: 'off'(기본, 미설정 포함) | 'preview'(분석·메시지 생성만, 전송·알림 상태 저장 없음) | 'on'(전송). 설정 전체는 config.mjs.
// 기존 운영 알림과 완전히 분리된다: 상태는 state.opportunity 아래에만 쓰고, 어떤 오류도 기존 레이더 실행에 영향을 주지 않는다(runOpportunitySafe).
//
// ── 제한 시간(deadline) 계약 ──
//  · 제한 시간이 지나면 새 수집 요청, 새 Telegram 요청(HTML 실패 뒤 평문 재전송 포함), 새 상태 변경을 시작하지 않는다.
//  · 예외는 단 하나: 이미 시작된 Telegram 요청이 늦게 성공하면, 그 '전달 완료' 기록(해당 코인 확정 + 저장)만 마친다.
//    기록하지 않으면 이미 전달된 메시지가 다음 실행에서 중복되기 때문이다. 이미 시작된 HTTP 요청 자체는 여기서 취소할 수 없다(아래 문서 참고).
//  · 시간 초과로 중단되면 '이 시간대 미완료' 표시(rescanHour)가 남아 다음 실행이 나머지를 이어서 처리한다.
//
// ── 중복 방지 장부(inflight) ──
//  Telegram에는 멱등키가 없다. 각 메시지를 보내기 전에 {key, attempts}를 저장하고, 전달이 확인되면 지운다.
//  전달 여부를 알 수 없는 실패(네트워크 오류·시간 초과)나 프로세스 중단이 있으면 장부가 남아, 다음 실행은 같은 메시지를 최대 MAX_ATTEMPTS번까지만 보낸다.
//  그 이후에는 '전달된 것으로 간주'하고 확정한다 → 어떤 크래시·저장 실패 반복에서도 같은 메시지는 최대 2회(중복 1회), 무한 반복은 없다. 대신 첫 시도가 실제로 전달되지 않았다면 그 알림은 누락될 수 있다.
//  저장이 안 되면(장부를 쓸 수 없으면) 아예 보내지 않는다.
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
export const MAX_ATTEMPTS = 2;             // 같은 메시지를 (전달 여부가 불확실한 채로) 보내 보는 최대 횟수
export const INFLIGHT_TTL_MS = 6 * H1;     // 이보다 오래된 장부는 같은 조합이 나중에 새로 생긴 정당한 알림과 구분하기 위해 무시한다

const fresh = () => ({ v: 1, coins: {}, scanHour: null, attemptHour: null, rescanHour: null, pending: [], pendingHour: null, universe: null, retryAt: 0, lastScanAt: 0, lastError: null, failures: 0, previewHour: null, health: null, baselineDone: false, baselineAt: null, baselineNotice: null, inflight: null, sent: { hour: null, coins: 0, ready: 0, messages: 0 }, daily: {} });

// 저장된 상태가 손상됐거나 형식이 다르면 안전하게 초기화한다. 초기화되면 baselineDone이 false가 되어 첫 실행 정책(기본: 기존 관찰은 알림 없이 기준선 기록)이 다시 적용되므로
// 캐시 유실 뒤에도 기존 관찰 후보가 대량 재발송되지 않는다. 입력은 복사하므로 원본 state는 바뀌지 않는다.
export function normalize(input) {
  let raw = input; try { raw = input === undefined ? undefined : structuredClone(input); } catch { raw = undefined; }
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
  if (!(out.inflight && typeof out.inflight === 'object' && typeof out.inflight.key === 'string' && Number.isInteger(out.inflight.attempts))) out.inflight = null;
  out.baselineDone = out.baselineDone === true;
  if (![null, 'pending', 'sent'].includes(out.baselineNotice)) out.baselineNotice = null;
  return out;
}

const dayKey = now => new Date(now).toISOString().slice(0, 10);
const dayRec = (opp, now) => (opp.daily[dayKey(now)] ||= { coins: 0, messages: 0, ready: 0, held: 0, baseline: 0, failures: 0, assumed: 0 });
function pruneDaily(opp, now) {
  const keep = new Set(Array.from({ length: DAILY_KEEP }, (_, k) => dayKey(now - k * 86400000)));
  for (const k of Object.keys(opp.daily)) if (!keep.has(k)) delete opp.daily[k];
}
class DeadlineError extends Error { constructor() { super('opportunity deadline passed'); this.code = 'DEADLINE'; } }

export async function opportunityStep({ now, state, env = process.env, fetcher = fetch, send = null, save = async () => {}, log = () => {}, collect = collectOpportunity, force = false, gapMs = 260, budgetMs = 60000, deadline = Infinity, clock = Date.now, checkpoint = null } = {}) {
  const cfg = settings(env), mode = cfg.mode;
  if (mode === 'off') return { mode, skipped: 'off' };
  const expired = name => { if (checkpoint) checkpoint(name); return clock() > deadline; };   // checkpoint: 테스트용 관찰 지점(운영에서는 쓰지 않음)
  const hour = Math.floor(now / H1), hourStart = hour * H1;
  if (state.quiet && state.quiet.hour === hour) return { mode, skipped: 'quiet' };            // 상태 연속성이 의심되는 시간대: 기존 레이더와 같이 전송하지 않는다
  if (now < (state.retryAt || 0)) return { mode, skipped: 'shared-backoff' };                  // 기존 레이더가 거래소 제한 응답으로 대기 중이면 같이 쉰다
  const live = mode === 'on';
  if (live && typeof send !== 'function') return { mode, skipped: 'no-sender' };
  // 작업 사본: 첫 상태 변경 지점(attach)까지 state는 전혀 바뀌지 않는다(시간 초과로 중단돼도 흔적이 없다).
  const opp = normalize(state.opportunity);
  const attach = () => { if (live) state.opportunity = opp; };
  if (now < opp.retryAt) return { mode, skipped: 'backoff', until: opp.retryAt };

  // 저장 실패는 예외로 번지지 않게 기록한다. 저장이 안 된 상태에서 더 보내면 재시작 때 중복이 늘어나므로 호출한 쪽이 전송을 멈춘다.
  let saveError = null;
  const safeSave = async () => { try { await save(state); return true; } catch (error) { saveError = String(error.message).slice(0, 80); opp.lastError = `state save: ${saveError}`; return false; } };

  // 실행 시점 판단: 매 정시 직후 1회 + 확정 대기 종목 재시도
  const pendingRun = opp.pendingHour === hour && opp.pending.length > 0;
  const hourDue = opp.scanHour !== hour && now - hourStart >= SETTLE_MS && (opp.attemptHour !== hour || opp.rescanHour === hour);   // 정시 직후 1회, 중단·전송·저장·수집 실패 때만 같은 시간대에 다시
  if (!force) {
    if (!live && opp.previewHour === hour) return { mode, skipped: 'preview-done' };
    if (!(hourDue || (pendingRun && now - opp.lastScanAt >= PENDING_RETRY_MS))) return { mode, skipped: 'not-due' };
  }
  const retryIds = pendingRun && !hourDue ? opp.pending : null;
  const coll = await collect({ fetcher, now, ids: retryIds, topN: cfg.topN, budgetMs, gapMs, shouldStop: () => clock() > deadline });
  if (expired('afterCollect')) return { mode, timedOut: true };                                  // 시간 초과 뒤 늦게 끝난 수집은 아무것도 바꾸지 않는다
  if (coll.fatal) {
    attach(); opp.lastScanAt = now; opp.attemptHour = hour; opp.failures += 1; opp.rescanHour = hour; opp.lastError = coll.fatal.message;
    opp.retryAt = now + (coll.fatal.status ? waitMs(coll.fatal.status, coll.fatal.retryAfter) : Math.min(600000 * opp.failures, 3600000));
    if (live) await safeSave();
    return { mode, failed: coll.fatal.message, retryAt: opp.retryAt, saveError };
  }

  // 분석(동기 계산)
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
  if (expired('afterAnalysis')) return { mode, timedOut: true };                                 // 분석 직후 시간 초과: 아직 아무것도 바꾸지 않았다
  const ok = rows.filter(r => r.analysis?.status === 'ok');
  const states = ok.filter(r => r.analysis.stage >= 1).map(r => ({ symbol: r.symbol, dir: r.analysis.dir, stage: r.analysis.stage, stageLabel: STAGE[r.analysis.stage] }));
  const health = { excluded, failures: opp.failures, states: { analyzed: ok.length, long: ok.filter(r => r.analysis.dir === 'LONG').map(r => r.symbol), short: ok.filter(r => r.analysis.dir === 'SHORT').map(r => r.symbol), wait: ok.filter(r => r.analysis.stage === 0).length } };
  const base = { mode, analyzed: ok.length, watching: states.length, excluded: excluded.length, pending: newPending.length, calls: coll.calls, stopped: coll.stopped, sendError: null, saveError: null, events: 0, held: 0, sentMessages: 0, baseline: false, timedOut: false };

  // 여기서부터 첫 상태 변경. '이 시간대 미완료' 표시를 미리 두어, 중단돼도 다음 실행이 같은 시간대의 나머지를 이어서 처리한다.
  const markStart = () => { attach(); opp.lastScanAt = now; opp.attemptHour = hour; opp.rescanHour = hour; if (coll.stopped) opp.retryAt = now + waitMs(coll.stopped.status, coll.stopped.retryAfter); if (!retryIds) opp.universe = coll.universe; };
  const hourRec = () => { if (opp.sent.hour !== hour) opp.sent = { hour, coins: 0, ready: 0, messages: 0 }; return opp.sent; };
  const day = () => dayRec(opp, now);
  const previewRecord = async () => { const keep = normalize(state.opportunity); keep.previewHour = hour; state.opportunity = keep; await safeSave(); };   // 미리보기는 '이 시간대에 출력함'만 기록하고 알림 상태는 쓰지 않는다
  const isReady = it => (it.analysis?.stage ?? 0) >= 3 && it.event.type !== 'cleared' && it.event.type !== 'invalidated';
  const guardedSend = async (text, o) => { if (expired('beforeRequest')) throw new DeadlineError(); return send(text, o); };   // sendText의 평문 재전송도 여기를 지난다
  let sendFail = null, timedOut = false;

  // 메시지 1건 전달: 장부 저장 → 전송 → (전달 확인 시) 확정·저장. 반환: 'sent' | 'assumed' | 'failed' | 'deadline' | 'nosave'
  async function deliver(part, key, onDelivered) {
    if (expired('beforeSend')) return 'deadline';
    const prevIn = opp.inflight && opp.inflight.key === key && now - (opp.inflight.at ?? 0) < INFLIGHT_TTL_MS ? opp.inflight : null, attempts = (prevIn?.attempts ?? 0) + 1;
    if (attempts > MAX_ATTEMPTS) {                                                              // 두 번 시도했는데도 확정되지 않은 메시지: 전달된 것으로 간주(무한 반복 방지)
      opp.inflight = null; onDelivered(true); day().assumed += 1;
      return (await safeSave()) ? 'assumed' : 'nosave';
    }
    opp.inflight = { key, hour, attempts, at: now };
    if (!(await safeSave())) return 'nosave';                                                   // 장부를 쓸 수 없으면 보내지 않는다
    try { await sendText(guardedSend, part); }
    catch (error) {
      if (error.code === 'DEADLINE') { opp.inflight = null; return 'deadline'; }                // 요청을 시작하지 않았다
      sendFail = error; opp.lastSendStatus = error.status ?? null;
      if (error.status) opp.inflight = null;                                                     // 거래소가 명확히 거절한 요청은 시도로 치지 않는다. 상태 없는 오류(네트워크·시간 초과)는 전달 여부를 알 수 없어 장부를 남긴다
      if (RESTRICTED.includes(error.status)) opp.retryAt = Math.max(opp.retryAt, now + waitMs(error.status, error.retryAfter));
      return 'failed';
    }
    checkpoint?.('afterSend');                                                                   // 응답은 성공했다 — 제한 시간이 지났더라도 이 전달의 기록은 마친다
    opp.inflight = null; onDelivered(false);
    return (await safeSave()) ? 'sent' : 'nosave';
  }
  const countSent = items => { const h = hourRec(), d = day(), ready = items.filter(isReady).length; h.coins += items.length; h.ready += ready; h.messages += 1; d.coins += items.length; d.ready += ready; d.messages += 1; };

  // 첫 실행 정책: 처음 켤 때(또는 상태 유실 뒤) 기존 관찰 상태는 알림 없이 기준선으로 기록한다. alert 정책만 일반 규칙으로 알린다.
  const baselineNeeded = !opp.baselineDone && cfg.firstRun !== 'alert' && (analyses.length > 0 || Object.keys(opp.coins).length > 0);
  if (baselineNeeded) {
    base.baseline = true;
    const message = cfg.firstRun === 'summary' && opp.baselineNotice !== 'sent' ? formatBaseline(states, { now, analyzed: ok.length, wait: health.states.wait, excluded: excluded.length }) : null;
    if (!live) {                                                                                  // 미리보기: 켜면 이렇게 동작한다는 것만 보여준다
      await previewRecord();
      // 검토를 돕기 위해, 기준선 이후 새 관찰이 생겼을 때 나가는 개별 알림 메시지의 모양도 함께 보여 준다(실제로는 이 시점에 보내지 않는다).
      const sample = sortAlerts(analyses.map(a => ({ a, t: transition(null, a.analysis, now, { minStage: cfg.minStage }) })).filter(x => x.t.event).map(x => ({ symbol: x.a.symbol, event: x.t.event, analysis: x.a.analysis, price: x.a.analysis.price }))).slice(0, cfg.maxPerHour);
      const sampleMessages = formatAlerts(sample, { now, health }).map(m => m.plain);
      return { ...base, preview: { lines: summaryLines(rows), messages: [...(message ? [message.plain] : []), ...sampleMessages], note: `첫 실행 정책(${cfg.firstRun}): 현재 관찰 ${states.length}종목은 알림 없이 기준선으로 기록됩니다. 아래 ${message ? '둘째 메시지부터는' : '메시지는'} 기준선 이후 새 관찰이 생겼을 때의 개별 알림 모양 예시입니다(지금은 보내지 않음).` } };
    }
    // ① 기준선(관찰 상태 기록)을 먼저 저장한다. 저장할 수 없으면 요약도 보내지 않는다 → 저장 실패가 반복돼도 요약이 되풀이되지 않는다.
    markStart();
    for (const a of analyses) opp.coins[a.symbol] = seedEntry(a.analysis, now, { silent: cfg.firstRun === 'silent' });
    if (!newPending.length) { opp.baselineDone = true; opp.baselineAt = now; }                    // 확정 대기 중인 종목이 남았으면 그 종목도 조용히 기록할 때까지 기준선을 끝내지 않는다(개별 알림으로 새는 것 방지)
    if (cfg.firstRun === 'summary' && !opp.baselineNotice) opp.baselineNotice = 'pending';
    if (!(await safeSave())) return { ...base, saveError };
    // ② 요약 1건 전송(장부로 최대 2회까지만 시도)
    let outcome = 'none';
    if (message && opp.baselineNotice === 'pending') {
      outcome = await deliver(message, 'baseline', () => { opp.baselineNotice = 'sent'; const h = hourRec(); h.messages += 1; const d = day(); d.messages += 1; d.baseline = states.length; });
    }
    if (outcome === 'deadline') return { ...base, timedOut: true, saveError };
    if (outcome === 'failed') {
      const e = sendFail; opp.failures += 1; opp.lastError = `Telegram: ${String(e.message).slice(0, 80)}`;
      opp.retryAt = Math.max(opp.retryAt, now + (RESTRICTED.includes(e.status) ? waitMs(e.status, e.retryAfter) : Math.min(600000 * opp.failures, 3600000)));
      await safeSave(); return { ...base, sendError: String(e.message).slice(0, 80), saveError };
    }
    if (outcome === 'nosave') return { ...base, saveError };
    if (expired('beforeFinalize')) return { ...base, timedOut: true };
    opp.failures = 0; opp.lastError = coll.stopped ? `거래소 제한 응답(${coll.stopped.status})` : null;
    opp.pending = newPending; opp.pendingHour = newPending.length ? hour : null; opp.rescanHour = null;
    if (!newPending.length) opp.scanHour = hour;
    pruneDaily(opp, now); opp.health = { at: now, analyzed: ok.length, excluded: excluded.length, pending: newPending.length, held: 0, calls: coll.calls, baseline: true };
    await safeSave();
    return { ...base, sentMessages: outcome === 'sent' || outcome === 'assumed' ? 1 : 0, saveError };
  }

  // 일반 경로: 상태 전이
  const items = [], commitNow = {};
  for (const { symbol, analysis } of analyses) {
    const prev = opp.coins[symbol] ?? null;
    if (prev && analysis.barT <= prev.lastBarT) continue;                                       // 같은 확정봉을 다시 평가하지 않는다
    const t = transition(prev, analysis, now, { minStage: cfg.minStage });
    if (t.event) items.push({ symbol, event: t.event, analysis, price: analysis.price, prev, committed: t.committed });
    else commitNow[symbol] = t.next;
  }
  // 우선순위 정렬 → 시간당·일일 상한 → (조건 충족을 위한 시간당 예비 칸) 적용. 상한을 넘는 항목은 보류하며(상태를 바꾸지 않음) 다음 시간대에 새 확정봉으로 다시 평가된다.
  const hr = hourRec(), dy = day(), reserve = Math.min(READY_RESERVE, Math.floor(cfg.maxPerHour / 4)), sorted = sortAlerts(items);
  const room = Math.max(0, Math.min(cfg.maxPerHour - hr.coins, cfg.maxPerDay - dy.coins));
  let otherRoom = Math.max(0, Math.min(room, (cfg.maxPerHour - reserve) - (hr.coins - hr.ready)));
  const toSend = [];
  for (const it of sorted) {
    if (toSend.length >= room) break;
    if (isReady(it)) toSend.push(it);
    else if (otherRoom > 0) { toSend.push(it); otherRoom--; }
  }
  const held = items.length - toSend.length;
  const messages = formatAlerts(toSend, { now, health });
  base.events = items.length; base.held = held;

  if (!live) { await previewRecord(); return { ...base, held, preview: { lines: summaryLines(rows), messages: messages.map(m => m.plain) } }; }
  markStart();
  for (const [symbol, next] of Object.entries(commitNow)) opp.coins[symbol] = next;             // 알림이 필요 없는 상태 변화(1단계 기록 포함)는 바로 기록
  for (const [symbol, c] of Object.entries(opp.coins)) if (now - (c.lastBarT || 0) > PRUNE_MS) delete opp.coins[symbol];
  // 전송 대기열: 아직 못 보낸 기준선 요약(있으면 맨 앞) → 우선순위 순 알림 메시지
  const queue = [];
  if (opp.baselineDone && opp.baselineNotice === 'pending' && cfg.firstRun === 'summary') {
    queue.push({ part: formatBaseline(states, { now, analyzed: ok.length, wait: health.states.wait, excluded: excluded.length }), key: 'baseline', onDelivered: () => { opp.baselineNotice = 'sent'; hourRec().messages += 1; const d = day(); d.messages += 1; d.baseline = states.length; } });
  }
  for (const part of messages) {
    queue.push({ part, key: part.items.map(i => `${i.symbol}:${i.event.type}:${i.analysis?.stage ?? 0}`).sort().join(','), onDelivered: () => { for (const it of part.items) opp.coins[it.symbol] = it.committed; countSent(part.items); } });
  }
  let sentMessages = 0;
  for (const q of queue) {
    const outcome = await deliver(q.part, q.key, q.onDelivered);
    if (outcome === 'deadline') { timedOut = true; break; }
    if (outcome === 'failed' || outcome === 'nosave') break;
    sentMessages++;
  }
  if (timedOut || expired('beforeFinalize')) return { ...base, held, sentMessages, timedOut: true, saveError };      // 중단: 새 상태 변경 없음(미완료 표시가 남아 다음 실행이 이어서 처리)
  const allSent = sentMessages === queue.length, complete = allSent && newPending.length === 0 && !saveError;
  if (sendFail) { opp.failures += 1; dy.failures += 1; opp.lastError = `Telegram: ${String(sendFail.message).slice(0, 80)}`; opp.retryAt = Math.max(opp.retryAt, now + Math.min(600000 * opp.failures, 3600000)); }
  else if (!saveError) { opp.failures = 0; opp.lastError = coll.stopped ? `거래소 제한 응답(${coll.stopped.status})` : null; }
  if (held > 0) dy.held += held;
  opp.pending = newPending; opp.pendingHour = newPending.length ? hour : null; opp.rescanHour = !allSent || saveError ? hour : null;
  if (complete) opp.scanHour = hour;                                                             // 유예 시간이 지나도 확정되지 않은 종목은 분석에서 제외하고(excluded) 마친다
  if (!opp.baselineDone && cfg.firstRun === 'alert' && analyses.length) { opp.baselineDone = true; opp.baselineAt = now; }   // alert 정책: 기준선 없이 일반 규칙(상한 적용)으로 시작 — 분석된 종목이 없던 실행은 시작으로 치지 않는다
  pruneDaily(opp, now);
  opp.health = { at: now, analyzed: ok.length, excluded: excluded.length, pending: newPending.length, held, calls: coll.calls };
  await safeSave();
  const summary = { ...base, held, sentMessages, sendError: sendFail ? String(sendFail.message).slice(0, 80) : null, saveError, hourlySent: hr.coins, dailySent: dy.coins };
  log(JSON.stringify({ opportunity: summary }));
  return summary;
}

// 기존 레이더 실행을 절대 방해하지 않는 래퍼: 예외·시간 초과는 요약으로만 남긴다. 시간 초과 뒤 단계는 새 전송·새 상태 변경을 시작하지 않는다(deadline 계약, 위 참고).
export async function runOpportunitySafe(args) {
  const timeoutMs = args.timeoutMs ?? 120000, clock = args.clock ?? Date.now, timers = args.timers ?? { set: setTimeout, clear: clearTimeout };   // timers: 테스트에서 제한 시간 도래를 직접 제어하기 위한 주입점
  let timer;
  try {
    const res = await Promise.race([opportunityStep({ ...args, clock, deadline: clock() + timeoutMs }), new Promise((_, reject) => { timer = timers.set(() => reject(new Error('opportunity step timeout')), timeoutMs); })]);
    return res?.timedOut ? { ...res, failed: 'opportunity step timeout' } : res;
  } catch (error) { return { mode: settings(args.env).mode, failed: String(error.message).slice(0, 120) }; }
  finally { timers.clear(timer); }
}
