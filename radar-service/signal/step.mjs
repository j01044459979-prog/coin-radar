// 신호 실행 단계: 관찰 후보(기회 레이더 2단계 이상) → 1H·4H·15m 확정 데이터 → 판정 → 상태 전이 → Telegram.
// 기능 플래그 RADAR_SIGNAL: 'off'(기본) | 'preview'(계산·메시지 생성만, 전송·상태 저장 없음) | 'on'(전송). 기회 레이더 플래그와 독립이다.
// 상태는 state.signal 아래에만 쓰며 state.opportunity 와 기존 정기 보고 상태는 읽기만 한다(관찰 후보 목록).
// 안정성 계약은 기회 레이더와 같다: 제한 시간이 지나면 새 요청·새 전송·새 상태 변경을 시작하지 않고, 전송 전에 장부(inflight)를 저장하며(최대 2회 시도),
// 저장이 안 되면 보내지 않고, 어떤 예외도 기존 레이더 실행에 번지지 않는다. 주문·계정 API는 사용하지 않는다.
import { RESTRICTED, sendText, waitMs, jsonRequest } from '../service.mjs';
import { scanMarket, selectTargets } from '../universe.mjs';
import { analyzeCoin } from '../opportunity/analysis.mjs';
import { collectOpportunity } from '../opportunity/collect.mjs';
import { H1 } from '../opportunity/indicators.mjs';
import { signalSettings, fibMode } from './config.mjs';
import { collect15 } from './collect.mjs';
import { evaluateSignal, M15, SIG } from './evaluate.mjs';
import { btcContext } from './btc-context.mjs';
import { evaluatePullback } from './pullback-alert.mjs';
import { emaSetup, evaluateEmaPullback, EMA_PRIORITY } from './ema-pullback.mjs';
import { evaluateFibPullback, applyFibGate } from './fib-pullback.mjs';
import { candidateMessage, invalidatedMessage, summaryLine } from './message.mjs';
import { r9Decorate, r9Caption } from './rich300.mjs';
import { signalTransition } from './transition.mjs';
import { normalizePaper, paperStep, paperSummary } from './paper.mjs';
import { renderSignalChart, signalCaption } from './chart.mjs';
import { scaleDecorate, scaleCaption } from './scale-decorate.mjs';
import { feedEnabled, feedEntryOf, feedInvalidatedOf, feedPush } from './feed.mjs';

export const SETTLE_MS = 20000;            // 15분봉 마감 직후 거래소가 확정할 시간
export const MAX_ATTEMPTS = 2;             // 같은 메시지를 (전달 여부가 불확실한 채로) 보내 보는 최대 횟수
export const INFLIGHT_TTL_MS = 3600000;
export const PRUNE_MS = 7 * 24 * H1;
export const MAX_MESSAGES_PER_RUN = 6;
export const CHART_TIMEOUT_MS = 15000;
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
  if (raw.emaCoins && typeof raw.emaCoins === 'object' && !Array.isArray(raw.emaCoins))
    out.emaCoins = Object.fromEntries(Object.entries(raw.emaCoins).filter(([sym, c]) => validWatchSymbol(sym) && c && ['active', 'closed'].includes(c.status)));
  if (!out.daily || typeof out.daily !== 'object' || Array.isArray(out.daily)) out.daily = {};
  if (!(out.inflight && typeof out.inflight === 'object' && typeof out.inflight.key === 'string' && Number.isInteger(out.inflight.attempts))) out.inflight = null;
  return out;
}
const dayKey = now => new Date(now).toISOString().slice(0, 10);
const dayRec = (sg, now) => (sg.daily[dayKey(now)] ||= { candidates: 0, invalidated: 0, failures: 0, assumed: 0 });
const instOf = symbol => symbol.replace(/USDT$/, '-USDT-SWAP');

// 신호 정밀 감시: 활성 신호 > 2단계 눌림 > 1단계 접근 > 기본 레이더 상위 점수 > 기회 레이더 시세 상위.
// 15분봉 요청은 별도 필요 판정(stage >= 2) 뒤에만 수행한다. 감시 후보가 늘어도 손절·손익비/확정봉 게이트는 그대로다.
// 80개 유동성/변동성 후보는 시세 API 두 번으로 선별하고, 15분봉 슬롯당 최대 32개만 정밀 분석한다.
 // 확정 봉·손절/손익비 기준과 활성/모의 포지션 우선권은 기존과 동일하다.
export const SIGNAL_WATCH_LIMIT = 32;
export const SIGNAL_MARKET_LIMIT = 80;

// 암호화폐 선형 USDT 무기한만 포함. 전체 시세를 우선 훑고(2회 API), 1H/4H는 여기서 받지 않는다.
export async function scanSignalMarket({ fetcher = fetch, now, sg = {} } = {}) {
  const base = 'https://www.okx.com/api/v5';
  const read = async path => {
    const body = await jsonRequest(base + path, { timeoutMs: 6000 }, fetcher);
    if (body?.code !== '0' || !Array.isArray(body.data)) throw new Error('시장 시세/계약 목록 응답 오류');
    return body.data;
  };
  const instruments = await read('/public/instruments?instType=SWAP');
  const tickers = await read('/market/tickers?instType=SWAP');
  const market = scanMarket({ instruments, tickers }); // 자산 분류, 계약 상태, 거래대금 검증
  const rotation = { last: sg.breadth?.last ?? {}, lastRun: sg.breadth?.at ?? null };
  const picked = selectTargets({
    market, now, rotation,
    config: { max: SIGNAL_MARKET_LIMIT, topTurnover: 24, movers: 24, rotation: 32, minTurnover: 1000000 },
  });
  return { symbols: picked.ids.map(id => id.replace('-USDT-SWAP', 'USDT')), eligible: picked.eligibleCount,
    calls: 2, groups: Object.fromEntries(Object.entries(picked.groups).map(([k, v]) => [k, v.length])) };
}
const validWatchSymbol = sym => typeof sym === 'string' && /^[A-Z0-9]+USDT$/.test(sym);
export function watchlist(state, sg, now, paper = null, limit = SIGNAL_WATCH_LIMIT, prioritizeEma = false) {
  const max = Number.isInteger(limit) && limit >= 1 ? limit : SIGNAL_WATCH_LIMIT;
  const watch = [], seen = new Set();
  const add = (sym, pinned = false) => {
    if (!validWatchSymbol(sym) || seen.has(sym) || (!pinned && watch.length >= max)) return;
    seen.add(sym); watch.push(sym);
  };
  // 핀 고정: 현재 활성 신호와 모의 포지션은 알림 후 손절/무효화 판정이 누락되지 않아야 한다.
  for (const [sym, c] of Object.entries(sg.coins ?? {})) if (c?.status === 'active') add(sym, true);
  for (const [sym, c] of Object.entries(sg.emaCoins ?? {})) if (c?.status === 'active') add(sym, true);
  for (const t of paper?.open ?? []) add(t?.symbol, true);
  for (const [sym, c] of Object.entries(paper?.coins ?? {})) if (c?.status === 'active') add(sym, true);
  for (const [sym, c] of Object.entries(paper?.emaCoins ?? {})) if (c?.status === 'active') add(sym, true);
  // Give requested majors priority while leaving the rest of the 80-coin rotation intact.
  if (prioritizeEma) for (const sym of EMA_PRIORITY) add(sym);

  const recent = (t, age) => Number.isFinite(t) && t <= now && now - t <= age;
  const opp = Object.entries(state.opportunity?.coins ?? {}).filter(([sym, c]) =>
    validWatchSymbol(sym) && c && c.dir && recent(c.lastBarT, 6 * H1));
  // 실제 눌림 진행 종목 우선, 그다음 근접 단계: 1단계 종목은 1H·4H 추적만 하고 15분봉은 stage >=2에서 요청.
  opp.filter(([, c]) => c.stage >= 2)
    .sort((a, b) => b[1].stage - a[1].stage || b[1].lastBarT - a[1].lastBarT || a[0].localeCompare(b[0]))
    .forEach(([sym]) => add(sym));
  opp.filter(([, c]) => c.stage === 1 && recent(c.lastBarT, 2 * H1))
    .sort((a, b) => b[1].lastBarT - a[1].lastBarT || a[0].localeCompare(b[0]))
    .forEach(([sym]) => add(sym));

  // 매 5분 기본 레이더가 실제 점검한 최대 40종목 중 유망 후보를 추가.
  // 상태 캐시가 지연/손상된 때 오래된 종목을 재활용하지 않도록 최근 15분 자료만 사용한다.
  if (recent(state.lastSuccess, 15 * 60000) && Array.isArray(state.rows)) {
    state.rows.filter(r => validWatchSymbol(r?.symbol) && Number.isFinite(r.score) && r.score >= 40)
      .sort((a, b) => Number(Boolean(b.strong)) - Number(Boolean(a.strong)) ||
        b.score - a.score || a.symbol.localeCompare(b.symbol))
      .forEach(r => add(r.symbol));
  }
  // 남는 슬롯은 최근 시간대 기회 레이더가 수집한 거래대금 상위 코인으로 채운다.
  if (recent(state.opportunity?.lastScanAt, 2 * H1) && Array.isArray(state.opportunity?.universe)) {
    for (const id of state.opportunity.universe) {
      if (typeof id === 'string' && /^[A-Z0-9]+-USDT-SWAP$/.test(id)) add(id.replace('-USDT-SWAP', 'USDT'));
    }
  }
  return watch;
}

// 활성/모의 포지션과 2단계 이상 관찰을 매 슬롯 우선 검증한다.
// 나머지는 80개 후보 중 마지막 정밀 분석이 가장 오래된 순서로 순환한다.
export function expandedWatchlist(state, sg, now, paper = null, marketPool = null, limit = SIGNAL_WATCH_LIMIT, prioritizeEma = false) {
  const legacy = watchlist(state, sg, now, paper, limit, prioritizeEma);
  if (!Array.isArray(marketPool) || !marketPool.length) return legacy;
  const watch = [], seen = new Set(), add = sym => {
    if (!validWatchSymbol(sym) || seen.has(sym) || watch.length >= limit) return;
    seen.add(sym); watch.push(sym);
  };
  const pinned = new Set([
    ...Object.entries(sg.coins ?? {}).filter(([, c]) => c?.status === 'active').map(([sym]) => sym),
    ...Object.entries(sg.emaCoins ?? {}).filter(([, c]) => c?.status === 'active').map(([sym]) => sym),
    ...(paper?.open ?? []).map(p => p?.symbol),
    ...Object.entries(paper?.coins ?? {}).filter(([, c]) => c?.status === 'active').map(([sym]) => sym),
    ...Object.entries(paper?.emaCoins ?? {}).filter(([, c]) => c?.status === 'active').map(([sym]) => sym),
  ]);
  // 기존 레이더와 동일하게 핀 고정 대상은 제한보다 많아도 우선 보존한다.
  for (const sym of legacy) if (pinned.has(sym) && !seen.has(sym)) { seen.add(sym); watch.push(sym); }
  for (const sym of legacy) {
    const c = state.opportunity?.coins?.[sym];
    if (c?.stage >= 2 && c.dir && Number.isFinite(c.lastBarT) && c.lastBarT <= now && now - c.lastBarT <= 6 * H1) add(sym);
  }
  if (prioritizeEma) for (const sym of EMA_PRIORITY) add(sym);
  const fastTarget = Math.min(limit, Math.max(12, watch.length));
  for (const sym of legacy) { if (watch.length >= fastTarget) break; add(sym); }
  const last = sg.breadth?.last ?? {};
  const rotated = marketPool.map((symbol, index) => ({ symbol, index }))
    .filter(x => validWatchSymbol(x.symbol))
    .sort((a, b) => (Number(last[a.symbol]) || 0) - (Number(last[b.symbol]) || 0) || a.index - b.index);
  for (const { symbol } of rotated) add(symbol);
  for (const sym of legacy) add(sym); // 시세 API 후보가 적으면 기존 우선 목록으로 부족분 보충
  return watch;
}

export async function signalStep({ now, state, env = process.env, fetcher = fetch, send = null, save = async () => {}, log = () => {}, collectHour = collectOpportunity, collectM15 = collect15, sendPhoto = null, renderChart = renderSignalChart, analyze = analyzeCoin, paperRunner = paperStep, marketScan = scanSignalMarket, force = false, gapMs = 260, budgetMs = 60000, deadline = Infinity, clock = Date.now, scanAll = false, topN = 20, checkpoint = null } = {}) {
  const cfg = signalSettings(env), mode = cfg.mode, fibSetting = fibMode(env), emaEnabled = String(env.RADAR_EMA_PULLBACK ?? '').toLowerCase() === 'on';
  // Independent opt-in for *new live* EMA alerts. Paper tracking and prior alert invalidations stay active.
  const emaLive = String(env.RADAR_EMA_LIVE ?? 'off').toLowerCase() === 'on';
  if (mode === 'off') return { mode, skipped: 'off' };
  const expired = name => { if (checkpoint) checkpoint(name); return clock() > deadline; };
  const hour = Math.floor(now / H1), slot = Math.floor(now / M15) * M15;
  if (state.quiet && state.quiet.hour === hour) return { mode, skipped: 'quiet' };              // 상태 연속성이 의심되는 시간대: 기존 레이더와 같이 쉰다
  if (now < (state.retryAt || 0)) return { mode, skipped: 'shared-backoff' };
  const live = mode === 'on';
  if (live && typeof send !== 'function') return { mode, skipped: 'no-sender' };
  const sg = normalizeSignal(state.signal), attach = () => { if (live) state.signal = sg; };
  if (emaEnabled) sg.emaCoins ??= {};
  if (now < sg.retryAt) return { mode, skipped: 'backoff', until: sg.retryAt };
  const paperOn = cfg.paper, paper = paperOn ? normalizePaper(sg.paper) : null;                    // 모의매매 추적(기본 off)
  let saveError = null;
  const safeSave = async () => { try { await save(state); return true; } catch (error) { saveError = String(error.message).slice(0, 80); sg.lastError = `state save: ${saveError}`; return false; } };

  const slotDone = live ? sg.slot === slot : Boolean(paperOn && paper.slot === slot);                 // preview는 슬롯 완료를 기록하지 않지만, 모의 추적이 켜져 있으면 paper.slot으로 같은 15분 슬롯의 반복 수집을 막는다
  if (!force && !(now - slot >= SETTLE_MS && !slotDone)) return { mode, skipped: 'not-due' };
  // 기본 레이더의 최근 성공을 확인한 경우에만 가벼운 전체시장 스캔 추가.
  // 시세 API가 실패/차단되거나 실행시간이 부족하면 기존 32종목 방식으로 안전하게 복귀한다.
  let market = null, marketError = null;
  if (!scanAll && Number.isFinite(state.lastSuccess) && now >= state.lastSuccess && now - state.lastSuccess <= 15 * 60000 && deadline - clock() >= 50000) {
    try { market = await marketScan({ fetcher, now, sg }); }
    catch (error) { marketError = String(error.message).slice(0, 100); }
  }
  if (expired('afterMarket')) return { mode, timedOut: true };
  const watch = scanAll ? null : expandedWatchlist(state, sg, now, paper, market?.symbols, SIGNAL_WATCH_LIMIT, emaEnabled);
  if (!scanAll && !watch.length) return { mode, skipped: 'no-watchlist' };

  const base = { mode, watching: watch?.length ?? 0, analyzed: 0, candidates: 0, observing: 0, invalidated: 0, pending: 0, excluded: 0,
    calls: market?.calls ?? 0, marketPool: market?.symbols?.length ?? 0, marketEligible: market?.eligible ?? null, marketError,
    sendError: null, saveError: null, sentMessages: 0, held: 0, timedOut: false };
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
    rows.push({ symbol, instId, a: analyze(entry.c1h, entry.c4h, hourData.btc4h), c1h: entry.c1h,
      ...(emaEnabled ? { ema: emaSetup(entry.c1h, entry.c4h, now) } : {}),
      ...((fibSetting !== 'off' || emaEnabled) ? { c4h: entry.c4h } : {}) });
  }
  const need = rows.filter(r => r.a?.status === 'ok' && (r.a.stage >= 2 || sg.coins[r.symbol]?.status === 'active' || paper?.open.some(t => t.symbol === r.symbol) || paper?.coins[r.symbol]?.status === 'active' ||
    (emaEnabled && (r.ema || sg.emaCoins[r.symbol]?.status === 'active' || paper?.emaCoins?.[r.symbol]?.status === 'active'))));
  const m15 = need.length ? await collectM15({ fetcher, now, ids: need.map(r => r.instId), gapMs, budgetMs: Math.max(5000, budgetMs / 2), shouldStop: () => clock() > deadline }) : { coins: {}, calls: 0, stopped: null };
  if (expired('afterCollect15')) return { ...base, timedOut: true };
  base.calls += m15.calls ?? 0;

  // 판정·전이 (동기 계산)
  const items = [], commitNow = {}, emaCommitNow = {}, lines = [], evaluations = [], barsMap = {};
  base.emaObserved = 0; base.emaCandidates = 0; base.emaSetups = rows.filter(r => r.ema).length;
  for (const r of rows) {
    if (!r.a) { lines.push(`${r.symbol.replace(/USDT$/, '')}: 분석 제외 — ${r.why}`); r.pending ? base.pending++ : base.excluded++; continue; }
    if (r.a.status !== 'ok') { lines.push(summaryLine(r.symbol, null)); base.excluded++; continue; }
    base.analyzed++;
    const c = m15.coins[r.instId], prev = sg.coins[r.symbol] ?? null, emaPrev = emaEnabled ? sg.emaCoins[r.symbol] ?? null : null;
    const emaContext = r.ema ? { status: 'ok', stage: 2, dir: r.ema.dir, price: r.ema.price, invalidation: emaPrev?.stop ?? null } : { status: 'ok', stage: 0 };
    if (!c || c.status !== 'fresh') {
      if (!c) lines.push(summaryLine(r.symbol, { status: 'WAIT', why: `4H·1H 단계 ${r.a.stage}(15분봉 점검 대상 아님)` }));
      else { lines.push(`${r.symbol.replace(/USDT$/, '')}: 15분봉 ${c.status === 'pending' ? '확정 대기' : '제외'} — ${c.reason}`); c.status === 'pending' ? base.pending++ : base.excluded++; }
      if (prev?.status === 'active') {                                                          // 15분봉이 없어도 활성 신호의 시간 만료·1H 구조 소멸 판정은 계속한다(15분 종가 판정만 건너뜀)
        const tr = signalTransition(prev, { status: 'WAIT' }, { symbol: r.symbol, a: r.a, c15: [], now, cooldownMs: SIG.cooldownMs });
        if (tr.event) items.push({ symbol: r.symbol, event: tr.event, committed: tr.committed, score: 0, rr: 0 }); else if (tr.committed.status !== prev.status) commitNow[r.symbol] = tr.committed;
      }
      if (emaPrev?.status === 'active') {
        const tr = signalTransition(emaPrev, { status: 'WAIT' }, { symbol: r.symbol, a: emaContext, c15: [], now, cooldownMs: SIG.cooldownMs });
        if (tr.event) items.push({ symbol: r.symbol, channel: 'ema', event: tr.event, committed: tr.committed, score: 0, rr: 0 });
        else if (JSON.stringify(tr.next) !== JSON.stringify(emaPrev)) emaCommitNow[r.symbol] = tr.next;
      }
      continue;
    }
    const legacy = evaluateSignal({ a: r.a, c15: c.c15, now }, { minRR: cfg.minRR, validMin: cfg.validMin });
    let fib = null;
    if (fibSetting !== 'off' && ['CANDIDATE', 'OBSERVE'].includes(legacy.status)) {
      try { fib = evaluateFibPullback({ a: r.a, c1h: r.c1h, c4h: r.c4h, c15: c.c15 }); }
      catch { fib = { ok: false, reasons: ['피보나치 계산 오류'], fib: null }; } // 기능 격리: 거래소/Telegram 오류 전파 금지
      lines.push(r.symbol.replace(/USDT$/, '') + ': FIB ' + (fib.ok ? '충족' : '미충족') + ' [' + fibSetting + '] ' + (fib.reasons.join(' / ') || fib.evidence) + (fib.context ? ' / ' + fib.context : ''));
    }
    const baseSignal = applyFibGate(legacy, fib, fibSetting);
    // Add a distinct pullback alert only when the original breakout has not already qualified.
    // FIB on remains a hard gate; FIB preview is diagnostics only. No orders are placed.
    const pullback = baseSignal.status !== 'CANDIDATE' && fibSetting !== 'on'
      ? evaluatePullback({ a: r.a, c1h: r.c1h, c15: c.c15, now }, { minRR: cfg.minRR, validMin: cfg.validMin })
      : null;
    const ev = pullback ?? baseSignal;
    lines.push(summaryLine(r.symbol, ev));
    evaluations.push({ symbol: r.symbol, ev, a: r.a, c15: c.c15 }); barsMap[r.symbol] = c.c15;
    if (ev.status === 'OBSERVE') base.observing++;
    const tr = signalTransition(prev, ev, { symbol: r.symbol, a: r.a, c15: c.c15, now, cooldownMs: SIG.cooldownMs });
    if (tr.event) items.push({ symbol: r.symbol, event: tr.event, committed: tr.committed, score: ev.score ?? 0, rr: ev.t1?.net ?? 0 });
    else if (JSON.stringify(tr.next) !== JSON.stringify(prev)) commitNow[r.symbol] = tr.next;
    if (emaEnabled) {
      const evEma = evaluateEmaPullback({ setup: r.ema ?? null, c15: c.c15, now }, { minRR: Math.max(1.5, cfg.minRR), validMin: cfg.validMin });
      if (evEma.status === 'OBSERVE') base.emaObserved++;
      evaluations.push({ symbol: r.symbol, strategy: 'ema-pullback', ev: evEma, a: emaContext, c15: c.c15 });
      if (evEma.status === 'CANDIDATE') base.emaCandidates++;
      lines.push('EMA ' + summaryLine(r.symbol, evEma));
      const et = signalTransition(emaPrev, evEma, { symbol: r.symbol, a: emaContext, c15: c.c15, now, cooldownMs: SIG.cooldownMs });
      if (et.event && (et.event.type !== 'candidate' || emaLive)) items.push({ symbol: r.symbol, channel: 'ema', event: et.event, committed: et.committed, score: evEma.score ?? 0, rr: evEma.t1?.net ?? 0 });
      else if (JSON.stringify(et.next) !== JSON.stringify(emaPrev)) emaCommitNow[r.symbol] = et.next;
      if (et.event?.type === 'candidate' && !emaLive) base.emaPreviewCandidates = (base.emaPreviewCandidates ?? 0) + 1;
    }
  }
  if (expired('afterAnalysis')) return { ...base, timedOut: true };
  const dy = dayRec(sg, now);
  // 무효화 먼저, 그다음 진입 후보(점수·손익비 높은 순). 일일 상한은 진입 후보에만 적용하고 초과분은 보류(기록 없음 → 유효시간 안이면 다음 실행에서 다시 평가).
  const inv = items.filter(i => i.event.type === 'invalidated'), cand = items.filter(i => i.event.type === 'candidate').sort((x, y) => y.score - x.score || y.rr - x.rr || (x.symbol < y.symbol ? -1 : 1));
  const room = Math.max(0, cfg.maxPerDay - dy.candidates), toSend = [...inv, ...cand.slice(0, room)].slice(0, MAX_MESSAGES_PER_RUN);
  base.invalidated = inv.length; base.candidates = cand.length; base.held = items.length - toSend.length;
  // BTC comparisons are text-only context, not a signal filter. The same snapshot drives caption and fallback text.
  const btcHour = hourData.coins?.['BTC-USDT-SWAP'];
  const btc1h = btcHour?.status === 'fresh' ? btcHour.c1h : null;
  const btcFor = i => btcContext({
    btc4h: hourData.btc4h, btc1h, coin1h: rows.find(r => r.symbol === i.symbol)?.c1h,
    dir: i.event.ev.dir, at: i.event.ev.triggerCloseT,
  });
  const msgs = toSend.map(i => {
    if (i.event.type !== 'candidate') return { i, m: invalidatedMessage(i.symbol, i.event, { now }) };
    const btc = btcFor(i);
    return { i, btc, m: r9Decorate(scaleDecorate(candidateMessage(i.symbol, i.event.ev, { now, btc }), i.symbol, i.event.ev, env), i.symbol, i.event.ev, env) };
  });
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
  // 성공적으로 분석한 후보만 최종 시각을 기록한다. 실패/미분석 종목은 다음 슬롯에서 다시 앞선다.
  if (market?.symbols?.length && base.analyzed > 0) {
    const last = { ...(sg.breadth?.last ?? {}) }, pool = new Set(market.symbols);
    for (const r of rows) if (pool.has(r.symbol) && r.a?.status === 'ok') last[r.symbol] = now;
    const recent = Object.entries(last).filter(([sym, at]) => validWatchSymbol(sym) && Number.isFinite(at) && at <= now && now - at < 7 * 24 * H1)
      .sort((a, b) => b[1] - a[1]).slice(0, 400);
    sg.breadth = { v: 1, at: now, last: Object.fromEntries(recent) };
  }
  for (const [sym, next] of Object.entries(commitNow)) sg.coins[sym] = next;
  for (const [sym, next] of Object.entries(emaCommitNow)) sg.emaCoins[sym] = next;
  for (const [sym, c] of Object.entries(sg.coins)) if (c.status === 'closed' && now - (c.closedAt || c.lastBar15 || 0) > PRUNE_MS) delete sg.coins[sym];
  for (const [sym, c] of Object.entries(sg.emaCoins ?? {})) if (c.status === 'closed' && now - (c.closedAt || c.lastBar15 || 0) > PRUNE_MS) delete sg.emaCoins[sym];
  // 신호 이미지: 진입 후보마다 실제 확정 15분봉으로 PNG 1장을 만든다. 실패·시간 초과는 그 신호만 기존 텍스트 알림으로 대체한다(예외를 던지지 않는다).
  if (sendPhoto) {
    for (const x of msgs) {
      if (x.i.event.type !== 'candidate' || expired('beforeChart')) continue;
      let timer;
      try {
        const png = await Promise.race([renderChart(x.i.symbol, x.i.event.ev, barsMap[x.i.symbol], x.m.scale ? { plan: x.m.scale.plan } : {}), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('chart timeout')), CHART_TIMEOUT_MS); })]);
        const caption = scaleCaption(signalCaption(x.i.symbol, x.i.event.ev, { now, btc: x.btc }), x.m, x.m.r9 ? x.m.r9.plain.length : 0);
        const mergedCaption = r9Caption(caption, x.m);
        if (mergedCaption === null) { x.m.chartError = 'RICH300 button caption too long; text fallback'; x.m.photo = undefined; }
        else x.m.photo = { png, caption: mergedCaption };
      }
      catch (error) { x.m.chartError = String(error.message).slice(0, 80); base.chartFailed = (base.chartFailed ?? 0) + 1; }
      finally { clearTimeout(timer); }
    }
  }
  const guardedSend = async (text, o) => { if (expired('beforeRequest')) throw new DeadlineError(); return send(text, o); };
  const guardedPhoto = async (png, caption, opts) => { if (expired('beforeRequest')) throw new DeadlineError(); return opts ? sendPhoto(png, caption, opts) : sendPhoto(png, caption); };
  // 사진 우선, 같은 신호를 이미 한 번 시도했거나(전달 불확실 재시도) 사진이 거절(HTTP 4xx)되면 텍스트로 대체한다. 429·5xx·네트워크 오류는 장부 규칙대로 재시도한다.
  async function dispatch(part, attempts) {
    if (!part.photo || !sendPhoto || attempts > 1) return sendText(guardedSend, part);
    try { await guardedPhoto(part.photo.png, part.photo.caption, part.markup ? { markup: part.markup } : undefined); base.photoSent = (base.photoSent ?? 0) + 1; }
    catch (error) {
      const rejected = error.status >= 400 && error.status < 500 && !RESTRICTED.includes(error.status);
      if (!rejected) throw error;
      base.photoFallback = (base.photoFallback ?? 0) + 1;
      return sendText(guardedSend, part);
    }
  }
  let sendFail = null, timedOut = false;
  async function deliver(part, key, onDelivered) {
    if (expired('beforeSend')) return 'deadline';
    const prevIn = sg.inflight && sg.inflight.key === key && now - (sg.inflight.at ?? 0) < INFLIGHT_TTL_MS ? sg.inflight : null, attempts = (prevIn?.attempts ?? 0) + 1;
    if (attempts > MAX_ATTEMPTS) { sg.inflight = null; onDelivered(true); dy.assumed += 1; return (await safeSave()) ? 'assumed' : 'nosave'; }   // 두 번 시도했는데 확정되지 않음: 전달된 것으로 간주(무한 반복 방지)
    sg.inflight = { key, attempts, at: now };
    if (!(await safeSave())) return 'nosave';                                                  // 장부를 쓸 수 없으면 보내지 않는다
    try { await dispatch(part, attempts); }
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
    const out = await deliver(m, key, assumed => { (i.channel === 'ema' ? sg.emaCoins : sg.coins)[i.symbol] = i.committed; if (i.event.type === 'candidate') dy.candidates += 1; else dy.invalidated += 1;
      if (feedEnabled(env)) {                                                                    // RICH300 피드: Telegram 전달이 *확인된* 알림만. 두 번 시도해도 확정되지 않아 '전달된 것으로 간주'한 경우(assumed)는 자동 추적 대상에서 제외한다.
        if (assumed) base.feedExcluded = (base.feedExcluded ?? 0) + 1;
        else { try { feedPush(sg, i.event.type === 'candidate' ? feedEntryOf(i.symbol, i.event.ev, { now }) : feedInvalidatedOf(i.symbol, i.event, { now }), now); } catch { /* 피드 기록 실패가 알림 경로에 번지지 않는다 */ } }
      } });
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
