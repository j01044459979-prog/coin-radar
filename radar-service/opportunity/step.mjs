// 기회 포착 레이더 실행 단계: 수집 → 분석 → 상태 전이 → Telegram 알림 → 상태 저장.
// 기능 플래그 RADAR_OPPORTUNITY: 'off'(기본, 미설정 포함) | 'preview'(분석·메시지 생성만, 전송·알림 상태 저장 없음) | 'on'(전송).
// 기존 운영 알림과 완전히 분리된다: 상태는 state.opportunity 아래에만 쓰고, 어떤 오류도 기존 레이더 실행에 영향을 주지 않는다(runOpportunitySafe).
import { sendText, waitMs } from '../service.mjs';
import { analyzeCoin } from './analysis.mjs';
import { collectOpportunity, LIMITS } from './collect.mjs';
import { formatAlerts, summaryLines } from './message.mjs';
import { transition } from './transition.mjs';
import { H1 } from './indicators.mjs';

export const SETTLE_MS = 20000;            // 정시 직후 거래소가 봉을 확정할 시간
export const MAX_ALERT_COINS = 12;         // 한 번의 실행에서 알리는 최대 코인 수(초과분은 다음 실행에서)
export const PENDING_RETRY_MS = 240000;    // 확정 대기 종목 재조회 최소 간격
export const PRUNE_MS = 7 * 24 * H1;

export function modeOf(env = process.env) {
  const v = String(env?.RADAR_OPPORTUNITY ?? '').trim().toLowerCase();
  return v === 'on' ? 'on' : v === 'preview' ? 'preview' : 'off';
}
const fresh = () => ({ v: 1, coins: {}, scanHour: null, attemptHour: null, rescanHour: null, pending: [], pendingHour: null, universe: null, retryAt: 0, lastScanAt: 0, lastError: null, failures: 0, previewHour: null, health: null });

// 저장된 상태가 손상됐거나 형식이 다르면 안전하게 초기화한다(초기화되면 현재 관찰 상태가 새 관찰로 한 번 알려질 수 있다).
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
  return out;
}

export async function opportunityStep({ now, state, env = process.env, fetcher = fetch, send = null, save = async () => {}, log = () => {}, collect = collectOpportunity, force = false, gapMs = 260, budgetMs = 60000 } = {}) {
  const mode = modeOf(env);
  if (mode === 'off') return { mode, skipped: 'off' };
  const hour = Math.floor(now / H1), hourStart = hour * H1;
  if (state.quiet && state.quiet.hour === hour) return { mode, skipped: 'quiet' };            // 상태 연속성이 의심되는 시간대: 기존 레이더와 같이 전송하지 않는다
  if (now < (state.retryAt || 0)) return { mode, skipped: 'shared-backoff' };                  // 기존 레이더가 거래소 제한 응답으로 대기 중이면 같이 쉰다
  const live = mode === 'on';
  if (live && typeof send !== 'function') return { mode, skipped: 'no-sender' };
  const stored = normalize(state.opportunity);
  const opp = live ? stored : structuredClone(stored);                                          // 미리보기는 실제 상태를 바꾸지 않는다
  if (live) state.opportunity = opp;
  if (now < opp.retryAt) return { mode, skipped: 'backoff', until: opp.retryAt };

  // 실행 시점 판단: 매 정시 직후 1회 + 확정 대기 종목 재시도
  const pendingRun = opp.pendingHour === hour && opp.pending.length > 0;
  const hourDue = opp.scanHour !== hour && now - hourStart >= SETTLE_MS && (opp.attemptHour !== hour || opp.rescanHour === hour);   // 정시 직후 1회, 전송 실패·알림 보류·수집 실패 때만 같은 시간대에 다시
  if (!force) {
    if (!live && opp.previewHour === hour) return { mode, skipped: 'preview-done' };
    if (!(hourDue || (pendingRun && now - opp.lastScanAt >= PENDING_RETRY_MS))) return { mode, skipped: 'not-due' };
  }
  const retryIds = pendingRun && !hourDue ? opp.pending : null;
  const topN = Number.parseInt(env?.RADAR_OPPORTUNITY_TOP, 10);
  const coll = await collect({ fetcher, now, ids: retryIds, topN: Number.isFinite(topN) ? topN : LIMITS.defaultTop, budgetMs, gapMs });
  opp.lastScanAt = now; opp.attemptHour = hour;
  if (coll.fatal) {
    opp.failures += 1; opp.rescanHour = hour; opp.lastError = coll.fatal.message;
    opp.retryAt = now + (coll.fatal.status ? waitMs(coll.fatal.status, coll.fatal.retryAfter) : Math.min(600000 * opp.failures, 3600000));
    if (live) await save(state);
    return { mode, failed: coll.fatal.message, retryAt: opp.retryAt };
  }
  if (coll.stopped) opp.retryAt = now + waitMs(coll.stopped.status, coll.stopped.retryAfter);
  if (!retryIds) opp.universe = coll.universe;

  const rows = [], items = [], excluded = [], newPending = [], commitNow = {};
  const grace = now - hourStart < LIMITS.graceMs;
  for (const [instId, entry] of Object.entries(coll.coins)) {
    const symbol = entry.symbol;
    if (entry.status === 'pending' && (grace || coll.stopped)) { newPending.push(instId); rows.push({ symbol, reason: entry.reason }); continue; }
    if (entry.status !== 'fresh') { excluded.push(symbol); rows.push({ symbol, reason: entry.status === 'pending' ? '확정 지연(유예 시간 초과)' : entry.reason }); continue; }
    const analysis = analyzeCoin(entry.c1h, entry.c4h, coll.btc4h);
    rows.push({ symbol, analysis });
    if (analysis.status !== 'ok') { excluded.push(symbol); continue; }
    const prev = opp.coins[symbol] ?? null;
    if (prev && analysis.barT <= prev.lastBarT) continue;                                       // 같은 봉을 다시 평가하지 않는다
    const t = transition(prev, analysis, now);
    if (t.event) items.push({ symbol, event: t.event, analysis, price: analysis.price, prev, committed: t.committed });
    else commitNow[symbol] = t.next;
  }
  for (const [symbol, next] of Object.entries(commitNow)) opp.coins[symbol] = next;             // 알림이 필요 없는 상태 변화는 바로 기록
  for (const [symbol, c] of Object.entries(opp.coins)) if (now - (c.lastBarT || 0) > PRUNE_MS) delete opp.coins[symbol];

  // 알림: 코인 수 상한 → 길이 제한으로 분할 → 메시지마다 전송 확인 후 해당 코인 상태 저장
  const held = Math.max(0, items.length - MAX_ALERT_COINS);
  const toSend = items.slice(0, MAX_ALERT_COINS);
  const ok = rows.filter(r => r.analysis?.status === 'ok');
  const health = { excluded, failures: opp.failures, states: { analyzed: ok.length, long: ok.filter(r => r.analysis.dir === 'LONG').map(r => r.symbol), short: ok.filter(r => r.analysis.dir === 'SHORT').map(r => r.symbol), wait: ok.filter(r => r.analysis.stage === 0).length } };
  const messages = formatAlerts(toSend, { now, health });
  let sentMessages = 0, sendError = null;
  if (live) {
    for (const part of messages) {
      try { await sendText(send, part); }
      catch (error) { sendError = String(error.message).slice(0, 80); break; }
      for (const it of part.items) opp.coins[it.symbol] = it.committed;
      sentMessages++; await save(state);
    }
  }
  const allSent = !live || sentMessages === messages.length;
  const complete = allSent && held === 0 && newPending.length === 0;   // 확정 대기·제한 응답으로 못 끝낸 종목, 보류된 알림, 전송 실패가 있으면 이번 시간대를 끝내지 않고 다시 시도한다
  if (live) {
    if (sendError) { opp.failures += 1; opp.lastError = `Telegram: ${sendError}`; opp.retryAt = Math.max(opp.retryAt, now + Math.min(600000 * opp.failures, 3600000)); }
    else { opp.failures = 0; opp.lastError = coll.stopped ? `거래소 제한 응답(${coll.stopped.status})` : null; }
    opp.pending = newPending; opp.pendingHour = newPending.length ? hour : null; opp.rescanHour = !allSent || held > 0 ? hour : null;
    if (complete) opp.scanHour = hour;                                                           // 유예 시간이 지나도 확정되지 않은 종목은 분석에서 제외하고(excluded) 마친다
    opp.health = { at: now, analyzed: rows.filter(r => r.analysis?.status === 'ok').length, excluded: excluded.length, pending: newPending.length, held, calls: coll.calls };
    await save(state);
  } else {
    stored.previewHour = hour; state.opportunity = stored; await save(state);                    // 미리보기는 같은 시간대에 한 번만 출력(알림 상태는 바꾸지 않는다)
  }
  const summary = { mode, analyzed: rows.filter(r => r.analysis?.status === 'ok').length, watching: rows.filter(r => r.analysis?.stage >= 1).length, events: items.length, held, sentMessages, excluded: excluded.length, pending: newPending.length, calls: coll.calls, stopped: coll.stopped, sendError };
  if (!live) summary.preview = { lines: summaryLines(rows), messages: messages.map(m => m.plain) };
  log(JSON.stringify({ opportunity: { ...summary, preview: undefined } }));
  return summary;
}

// 기존 레이더 실행을 절대 방해하지 않는 래퍼: 예외·시간 초과는 요약으로만 남긴다.
export async function runOpportunitySafe(args) {
  const timeoutMs = args.timeoutMs ?? 120000;
  let timer;
  try { return await Promise.race([opportunityStep(args), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('opportunity step timeout')), timeoutMs); })]); }
  catch (error) { return { mode: modeOf(args.env), failed: String(error.message).slice(0, 120) }; }
  finally { clearTimeout(timer); }
}
