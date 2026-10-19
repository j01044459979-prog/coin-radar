// 신호 실행 단계: 관찰 후보(기회 레이더 2단계 이상) → 1H·4H·15m 확정 데이터 → 판정 → 상태 전이 → Telegram.
// 기능 플래그 RADAR_SIGNAL: 'off'(기본) | 'preview'(계산·메시지 생성만, 전송·상태 저장 없음) | 'on'(전송). 기회 레이더 플래그와 독립이다.
// 상태는 state.signal 아래에만 쓰며 state.opportunity 와 기존 정기 보고 상태는 읽기만 한다(관찰 후보 목록).
// 안정성 계약은 기회 레이더와 같다: 제한 시간이 지나면 새 요청·새 전송·새 상태 변경을 시작하지 않고, 전송 전에 장부(inflight)를 저장하며(최대 2회 시도),
// 저장이 안 되면 보내지 않고, 어떤 예외도 기존 레이더 실행에 번지지 않는다. 주문·계정 API는 사용하지 않는다.
import { RESTRICTED, sendText, waitMs } from '../service.mjs';
import { analyzeCoin } from '../opportunity/analysis.mjs';
import { collectOpportunity } from '../opportunity/collect.mjs';
import { H1 } from '../opportunity/indicators.mjs';
import { signalSettings } from './config.mjs';
import { collect15 } from './collect.mjs';
import { evaluateSignal, M15, SIG } from './evaluate.mjs';
import { candidateMessage, invalidatedMessage, summaryLine } from './message.mjs';
import { signalTransition } from './transition.mjs';
import { normalizePaper, paperStep, paperSummary } from './paper.mjs';

export const SETTLE_MS = 20000;            // 15분봉 마감 직후 거래소가 확정할 시간
export const MAX_ATTEMPTS = 2;             // 같은 메시지를 (전달 여부가 불확실한 채로) 보내 보는 최대 횟수
export const INFLIGHT_TTL_MS = 3600000;
export const PRUNE_MS = 7 * 24 * H1;
export const MAX_MESSAGES_PER_RUN = 6;
class DeadlineError extends Error { constructor() { super('signal deadline passed'); this.code = 'DEADLINE'; } }

const fresh = () => ({ v: 1, coins: {}, slot: null, retryAt: 0, failures: 0, lastError: null, inflight: null, daily: {}, health: null });
export function normalizeSignal(input) {
  let raw = input; try { raw = input === undefined ? undefined : structuredClone(input); } catch { raw = undefined; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 1 || !raw.coins || typeof raw.coins !== 'object' || Array.isArray(raw.coins)) return fresh();
  const out = { ...fresh(), ...raw, coins: {} };
  for (const [sym, c] of Object.entries(raw.coins)) {
    if (!/^[A-Z0-9]+USDT$/.test(sym) || !c || typeof c !== 'object' || !['active', 'closed'].includes(c.status) || ![null, 'LONG', 'SHORT'].includes(c.dir)) continue;
    out.coins[sym] = c;
  }
  if (!out.daily || typeof out.daily !== 'object' || Array.isArray(out.daily)) out.daily = {};
  if (!(out.inflight && typeof out.inflight === 'object' && typeof out.inflight.key === 'string' && Number.isInteger(out.inflight.attempts))) out.inflight = null;
  return out;
}
const dayKey = now => new Date(now).toISOString().slice(0, 10);
const dayRec = (sg, now) => (sg.daily[dayKey(now)] ||= { candidates: 0, invalidated: 0, failures: 0, assumed: 0 });
const instOf = symbol => symbol.replace(/USDT$/, '-USDT-SWAP');

// 관찰 후보 목록: 기회 레이더가 저장한 2단계 이상 코인 + 활성 신호가 있는 코인
export function watchlist(state, sg, now, paper = null) {
  const set = new Set();
  for (const t of paper?.open ?? []) set.add(t.symbol);                                              // 모의 거래가 열려 있는 코인은 결과 확정을 위해 계속 15분봉을 받는다
  for (const [sym, c] of Object.entries(paper?.coins ?? {})) if (c.status === 'active') set.add(sym);
  for (const [sym, c] of Object.entries(state.opportunity?.coins ?? {})) if (c && c.stage >= 2 && c.dir && now - (c.lastBarT || 0) <= 6 * H1 && /^[A-Z0-9]+USDT$/.test(sym)) set.add(sym);
  for (const [sym, c] of Object.entries(sg.coins)) if (c.status === 'active') set.add(sym);
  return [...set].sort();
}

export async function signalStep({ now, state, env = process.env, fetcher = fetch, send = null, save = async () => {}, log = () => {}, collectHour = collectOpportunity, collectM15 = collect15, analyze = analyzeCoin, paperRunner = paperStep, force = false, gapMs = 260, budgetMs = 60000, deadline = Infinity, clock = Date.now, scanAll = false, topN = 20, checkpoint = null } = {}) {
  const cfg = signalSettings(env), mode = cfg.mode;
  if (mode === 'off') return { mode, skipped: 'off' };
  const expired = name => { if (checkpoint) checkpoint(name); return clock() > deadline; };
  const hour = Math.floor(now / H1), slot = Math.floor(now / M15) * M15;
  if (state.quiet && state.quiet.hour === hour) return { mode, skipped: 'quiet' };              // 상태 연속성이 의심되는 시간대: 기존 레이더와 같이 쉰다
  if (now < (state.retryAt || 0)) return { mode, skipped: 'shared-backoff' };
  const live = mode === 'on';
  if (live && typeof send !== 'function') return { mode, skipped: 'no-sender' };
  const sg = normalizeSignal(state.signal), attach = () => { if (live) state.signal = sg; };
  if (now < sg.retryAt) return { mode, skipped: 'backoff', until: sg.retryAt };
  const paperOn = cfg.paper, paper = paperOn ? normalizePaper(sg.paper) : null;                    // 모의매매 추적(기본 off)
  let saveError = null;
  const safeSave = async () => { try { await save(state); return true; } catch (error) { saveError = String(error.message).slice(0, 80); sg.lastError = `state save: ${saveError}`; return false; } };

  const slotDone = live ? sg.slot === slot : Boolean(paperOn && paper.slot === slot);                 // preview는 슬롯 완료를 기록하지 않지만, 모의 추적이 켜져 있으면 paper.slot으로 같은 15분 슬롯의 반복 수집을 막는다
  if (!force && !(now - slot >= SETTLE_MS && !slotDone)) return { mode, skipped: 'not-due' };
  const watch = scanAll ? null : watchlist(state, sg, now, paper);
  if (!scanAll && !watch.length) return { mode, skipped: 'no-watchlist' };

  const base = { mode, watching: watch?.length ?? 0, analyzed: 0, candidates: 0, observing: 0, invalidated: 0, pending: 0, excluded: 0, calls: 0, sendError: null, saveError: null, sentMessages: 0, held: 0, timedOut: false };
  const hourData = await collectHour({ fetcher, now, ids: watch ? watch.map(instOf) : null, topN, budgetMs, gapMs, shouldStop: () => clock() > deadline });
  if (expired('afterCollect')) return { mode, timedOut: true };
  base.calls += hourData.calls ?? 0;
  if (hourData.fatal) {
    attach(); sg.failures += 1; sg.lastError = hourData.fatal.message; sg.retryAt = now + (hourData.fatal.status ? waitMs(hourData.fatal.status, hourData.fatal.retryAfter) : Math.min(300000 * sg.failures, 1800000));
    if (live) await safeSave();
    return { ...base, failed: hourData.fatal.message, saveError };
  }
  // 1H·4H 분석 → 15분봉이 필요한 코인만 추린다
  const rows = [];
  for (const [instId, entry] of Object.entries(hourData.coins)) {
    const symbol = entry.symbol;
    if (entry.status !== 'fresh') { rows.push({ symbol, instId, why: entry.reason ?? entry.status, pending: entry.status === 'pending' }); continue; }
    rows.push({ symbol, instId, a: analyze(entry.c1h, entry.c4h, hourData.btc4h) });
  }
  const need = rows.filter(r => r.a?.status === 'ok' && (r.a.stage >= 2 || sg.coins[r.symbol]?.status === 'active' || paper?.open.some(t => t.symbol === r.symbol) || paper?.coins[r.symbol]?.status === 'active'));
  const m15 = need.length ? await collectM15({ fetcher, now, ids: need.map(r => r.instId), gapMs, budgetMs: Math.max(5000, budgetMs / 2), shouldStop: () => clock() > deadline }) : { coins: {}, calls: 0, stopped: null };
  if (expired('afterCollect15')) return { ...base, timedOut: true };
  base.calls += m15.calls ?? 0;

  // 판정·전이 (동기 계산)
  const items = [], commitNow = {}, lines = [], evaluations = [], barsMap = {};
  for (const r of rows) {
    if (!r.a) { lines.push(`${r.symbol.replace(/USDT$/, '')}: 분석 제외 — ${r.why}`); r.pending ? base.pending++ : base.excluded++; continue; }
    if (r.a.status !== 'ok') { lines.push(summaryLine(r.symbol, null)); base.excluded++; continue; }
    base.analyzed++;
    const c = m15.coins[r.instId], prev = sg.coins[r.symbol] ?? null;
    if (!c || c.status !== 'fresh') {
      if (!c) lines.push(summaryLine(r.symbol, { status: 'WAIT', why: `4H·1H 단계 ${r.a.stage}(15분봉 점검 대상 아님)` }));
      else { lines.push(`${r.symbol.replace(/USDT$/, '')}: 15분봉 ${c.status === 'pending' ? '확정 대기' : '제외'} — ${c.reason}`); c.status === 'pending' ? base.pending++ : base.excluded++; }
      if (prev?.status === 'active') {                                                          // 15분봉이 없어도 활성 신호의 시간 만료·1H 구조 소멸 판정은 계속한다(15분 종가 판정만 건너뜀)
        const tr = signalTransition(prev, { status: 'WAIT' }, { symbol: r.symbol, a: r.a, c15: [], now, cooldownMs: SIG.cooldownMs });
        if (tr.event) items.push({ symbol: r.symbol, event: tr.event, committed: tr.committed, score: 0, rr: 0 }); else if (tr.committed.status !== prev.status) commitNow[r.symbol] = tr.committed;
      }
      continue;
    }
    const ev = evaluateSignal({ a: r.a, c15: c.c15, now }, { minRR: cfg.minRR, validMin: cfg.validMin });
    lines.push(summaryLine(r.symbol, ev));
    evaluations.push({ symbol: r.symbol, ev, a: r.a, c15: c.c15 }); barsMap[r.symbol] = c.c15;
    if (ev.status === 'OBSERVE') base.observing++;
    const tr = signalTransition(prev, ev, { symbol: r.symbol, a: r.a, c15: c.c15, now, cooldownMs: SIG.cooldownMs });
    if (tr.event) items.push({ symbol: r.symbol, event: tr.event, committed: tr.committed, score: ev.score ?? 0, rr: ev.t1?.net ?? 0 });
    else if (JSON.stringify(tr.next) !== JSON.stringify(prev)) commitNow[r.symbol] = tr.next;
  }
  if (expired('afterAnalysis')) return { ...base, timedOut: true };
  const dy = dayRec(sg, now);
  // 무효화 먼저, 그다음 진입 후보(점수·손익비 높은 순). 일일 상한은 진입 후보에만 적용하고 초과분은 보류(기록 없음 → 유효시간 안이면 다음 실행에서 다시 평가).
  const inv = items.filter(i => i.event.type === 'invalidated'), cand = items.filter(i => i.event.type === 'candidate').sort((x, y) => y.score - x.score || y.rr - x.rr || (x.symbol < y.symbol ? -1 : 1));
  const room = Math.max(0, cfg.maxPerDay - dy.candidates), toSend = [...inv, ...cand.slice(0, room)].slice(0, MAX_MESSAGES_PER_RUN);
  base.invalidated = inv.length; base.candidates = cand.length; base.held = items.length - toSend.length;
  const msgs = toSend.map(i => ({ i, m: i.event.type === 'candidate' ? candidateMessage(i.symbol, i.event.ev, { now }) : invalidatedMessage(i.symbol, i.event, { now }) }));
  // 모의매매 추적: 실제 신호 경로와 완전히 격리한다(예외는 삼키고, 전송하지 않으며, state.signal.paper에만 쓴다).
  let paperChanged = false;
  if (paperOn) {
    try { paperRunner(paper, { evaluations, bars: barsMap, now }); if (base.pending === 0 && !m15.stopped) paper.slot = slot; sg.paper = paper; base.paper = paperSummary(paper, now); paperChanged = true; }
    catch (error) { base.paperError = String(error.message).slice(0, 80); }
  }
  if (!live) {
    if (paperChanged) { const keep = normalizeSignal(state.signal); keep.paper = paper; state.signal = keep; await safeSave(); }   // preview 모드에서도 모의 기록(paper)만 저장한다(RADAR_SIGNAL_PAPER=on일 때만). 일일 집계·장부·슬롯 등 다른 신호 상태는 쓰지 않는다
    return { ...base, saveError, preview: { lines, messages: msgs.map(x => x.m.plain) } };
  }

  attach();
  for (const [sym, next] of Object.entries(commitNow)) sg.coins[sym] = next;
  for (const [sym, c] of Object.entries(sg.coins)) if (c.status === 'closed' && now - (c.closedAt || c.lastBar15 || 0) > PRUNE_MS) delete sg.coins[sym];
  const guardedSend = async (text, o) => { if (expired('beforeRequest')) throw new DeadlineError(); return send(text, o); };
  let sendFail = null, timedOut = false;
  async function deliver(part, key, onDelivered) {
    if (expired('beforeSend')) return 'deadline';
    const prevIn = sg.inflight && sg.inflight.key === key && now - (sg.inflight.at ?? 0) < INFLIGHT_TTL_MS ? sg.inflight : null, attempts = (prevIn?.attempts ?? 0) + 1;
    if (attempts > MAX_ATTEMPTS) { sg.inflight = null; onDelivered(true); dy.assumed += 1; return (await safeSave()) ? 'assumed' : 'nosave'; }   // 두 번 시도했는데 확정되지 않음: 전달된 것으로 간주(무한 반복 방지)
    sg.inflight = { key, attempts, at: now };
    if (!(await safeSave())) return 'nosave';                                                  // 장부를 쓸 수 없으면 보내지 않는다
    try { await sendText(guardedSend, part); }
    catch (error) {
      if (error.code === 'DEADLINE') { sg.inflight = null; return 'deadline'; }
      sendFail = error;
      if (error.status) sg.inflight = null;
      if (RESTRICTED.includes(error.status)) sg.retryAt = Math.max(sg.retryAt, now + waitMs(error.status, error.retryAfter));
      return 'failed';
    }
    checkpoint?.('afterSend');
    sg.inflight = null; onDelivered(false);
    return (await safeSave()) ? 'sent' : 'nosave';
  }
  let sent = 0;
  for (const { i, m } of msgs) {
    const key = `${i.event.id}:${i.event.type}`;
    const out = await deliver(m, key, () => { sg.coins[i.symbol] = i.committed; if (i.event.type === 'candidate') dy.candidates += 1; else dy.invalidated += 1; });
    if (out === 'deadline') { timedOut = true; break; }
    if (out === 'failed' || out === 'nosave') break;
    sent++;
  }
  if (timedOut || expired('beforeFinalize')) return { ...base, sentMessages: sent, timedOut: true, saveError };
  if (sendFail) { sg.failures += 1; dy.failures += 1; sg.lastError = `Telegram: ${String(sendFail.message).slice(0, 80)}`; sg.retryAt = Math.max(sg.retryAt, now + Math.min(300000 * sg.failures, 1800000)); }
  else if (!saveError) { sg.failures = 0; sg.lastError = m15.stopped ? `거래소 제한 응답(${m15.stopped.status})` : null; }
  if (m15.stopped) sg.retryAt = Math.max(sg.retryAt, now + waitMs(m15.stopped.status, m15.stopped.retryAfter));
  if (!sendFail && !saveError && sent === msgs.length && base.pending === 0 && !m15.stopped) sg.slot = slot;       // 이 15분 슬롯 완료(확정 대기·실패가 있으면 다음 실행이 같은 슬롯을 이어서 처리)
  for (const k of Object.keys(sg.daily)) if (!Array.from({ length: 14 }, (_, d) => dayKey(now - d * 86400000)).includes(k)) delete sg.daily[k];
  sg.health = { at: now, analyzed: base.analyzed, candidates: base.candidates, calls: base.calls };
  await safeSave();
  const summary = { ...base, sentMessages: sent, sendError: sendFail ? String(sendFail.message).slice(0, 80) : null, saveError, dailySent: dy.candidates };
  log(JSON.stringify({ signal: summary }));
  return summary;
}

// 기존 레이더 실행을 방해하지 않는 래퍼: 예외·시간 초과는 요약으로만 남긴다.
export async function runSignalSafe(args) {
  const timeoutMs = args.timeoutMs ?? 90000, clock = args.clock ?? Date.now, timers = args.timers ?? { set: setTimeout, clear: clearTimeout };
  let timer;
  try {
    const res = await Promise.race([signalStep({ ...args, clock, deadline: clock() + timeoutMs }), new Promise((_, reject) => { timer = timers.set(() => reject(new Error('signal step timeout')), timeoutMs); })]);
    return res?.timedOut ? { ...res, failed: 'signal step timeout' } : res;
  } catch (error) { return { mode: signalSettings(args.env).mode, failed: String(error.message).slice(0, 120) }; }
  finally { timers.clear(timer); }
}
