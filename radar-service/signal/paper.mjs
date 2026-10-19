// 모의매매(페이퍼) 성과 추적 — 주문이 아니다. '진입 후보'를 가상으로 기록하고, 이후 *확정* 15분봉으로 결과(목표/손절 선도달·순손익비·최대 역행폭)를 확정한다.
// 목적: 백테스트로 우위가 입증되지 않은 신호를 실제 시장에서 앞으로 얼마나 맞는지 쌓아서 보는 것(전향 검증). 어떤 Telegram 메시지도 만들지 않고, 주문·계정 API를 쓰지 않는다.
//
// 규칙은 backtest.mjs의 pathOutcome과 같다(체결 = 신호 다음 15분봉 시가, 같은 봉에서 목표·손절이 겹치면 손절 먼저, 비용 왕복 15bp·민감도 30bp, 최대 48시간).
//   모형 3개를 동시에 추적한다: wick(스탑주문, 1차 목표) · close(종가 이탈 = 운영 무효화 규칙, 1차 목표) · wickT2(스탑주문, 2차 목표가 있으면 2차).
// 증분 처리: 새로 확정된 봉만 순서대로 먹인다(미래·미확정 봉 사용 금지). 봉이 끊기면(누락) 그 거래는 '데이터 공백'으로 닫고 통계에서 뺀다.
import { clusterBootstrap } from '../opportunity/backtest.mjs';
import { M15, SIG } from './evaluate.mjs';
import { signalTransition } from './transition.mjs';

export const PAPER = Object.freeze({ horizon15: 192, costBps: 15, stressBps: 30, keepClosed: 150, maxOpen: 40, minSample: 30 });
const MODELS = ['wick', 'close', 'wickT2'];

export const blankPaper = () => ({ v: 1, coins: {}, open: [], closed: [], gaps: 0, skipped: 0, dropped: 0, since: null, slot: null });

export function normalizePaper(input) {
  let raw = input; try { raw = input === undefined ? undefined : structuredClone(input); } catch { raw = undefined; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 1) return blankPaper();
  const out = { ...blankPaper(), ...raw };
  out.coins = raw.coins && typeof raw.coins === 'object' && !Array.isArray(raw.coins) ? Object.fromEntries(Object.entries(raw.coins).filter(([k, c]) => /^[A-Z0-9]+USDT$/.test(k) && c && ['active', 'closed'].includes(c.status))) : {};
  out.open = Array.isArray(raw.open) ? raw.open.filter(t => t && typeof t.id === 'string' && Number.isFinite(t.startT) && ['LONG', 'SHORT'].includes(t.dir) && t.m && typeof t.m === 'object') : [];
  out.closed = Array.isArray(raw.closed) ? raw.closed.filter(t => t && typeof t.id === 'string' && t.res && typeof t.res === 'object') : [];
  for (const k of ['gaps', 'skipped', 'dropped']) out[k] = Number.isFinite(out[k]) ? out[k] : 0;
  return out;
}

const newModel = (stop, target, stopModel) => ({ stop, target, stopModel, done: false, n: 0, entry: null, risk: null, mae: 0, mfe: 0 });
// 모델 하나에 봉 하나를 먹인다(pathOutcome과 같은 판정). 반환: 끝났으면 true
function stepModel(m, dir, bar) {
  if (m.done) return;
  const s = dir === 'LONG' ? 1 : -1;
  if (m.entry === null) { m.entry = bar.o; m.risk = (bar.o - m.stop) * s; if (!(m.risk > 0)) { m.done = true; m.kind = 'skipped'; return; } }
  m.n++;
  m.mae = Math.max(m.mae, (m.entry - (s > 0 ? bar.l : bar.h)) * s / m.risk); m.mfe = Math.max(m.mfe, ((s > 0 ? bar.h : bar.l) - m.entry) * s / m.risk);
  const stopHit = m.stopModel === 'close' ? (bar.c - m.stop) * s < 0 : (s > 0 ? bar.l <= m.stop : bar.h >= m.stop), tgtHit = m.target !== null && (s > 0 ? bar.h >= m.target : bar.l <= m.target);
  if (stopHit) { m.done = true; m.kind = 'stop'; m.exit = m.stopModel === 'close' ? bar.c : ((bar.o - m.stop) * s < 0 ? bar.o : m.stop); return; }
  if (tgtHit) { m.done = true; m.kind = 'target'; m.exit = m.target; return; }
  if (m.n >= PAPER.horizon15) { m.done = true; m.kind = 'time'; m.exit = bar.c; }
}
const r4 = x => Number(x.toFixed(4)), p8 = x => Number(x.toPrecision(8));            // 상태 파일 크기를 줄이기 위한 저장 정밀도(통계 영향 없음)
const result = (m, dir) => {
  if (m.kind === 'skipped') return { kind: 'skipped' };
  const s = dir === 'LONG' ? 1 : -1, gross = (m.exit - m.entry) * s / m.risk, cr = bps => m.entry * bps / 10000 / m.risk;
  return { kind: m.kind, net: r4(gross - cr(PAPER.costBps)), netStress: r4(gross - cr(PAPER.stressBps)), mae: r4(m.mae), maePct: r4(m.mae * m.risk / m.entry * 100), mfe: r4(m.mfe), bars: m.n };   // 요약에 쓰는 값만 저장(진입가·위험폭은 거래 헤더에 한 번만)
};

// 새 모의 거래(진입 후보 이벤트). ev는 evaluateSignal의 CANDIDATE 결과.
export function openTrade(symbol, ev, now) {
  return { id: `${symbol}:${ev.dir}:${ev.zoneKey}:${ev.triggerT}`, symbol, dir: ev.dir, signalAt: now, triggerT: ev.triggerT, startT: ev.triggerCloseT, lastBarT: 0, stop: ev.stop, t1: ev.t1.price, t2: ev.t2?.price ?? null, rr1: ev.t1.rr, net1: ev.t1.net, volRel: ev.volRel, score: ev.score, btcAlign: ev.btcAlign,
    m: { wick: newModel(ev.stop, ev.t1.price, 'wick'), close: newModel(ev.stop, ev.t1.price, 'close'), wickT2: newModel(ev.stop, ev.t2?.price ?? ev.t1.price, 'wick') } };
}

// 확정 15분봉 목록(오래된 순)을 먹인다. 반환: 'open' | 'closed' | 'gap'
export function advanceTrade(trade, bars) {
  const next = bars.filter(b => b.t >= trade.startT && b.t > trade.lastBarT);
  for (const b of next) {
    const expect = trade.lastBarT === 0 ? trade.startT : trade.lastBarT + M15;
    if (b.t !== expect) return 'gap';                                                          // 봉이 끊김: 시간순 체결을 보장할 수 없다
    for (const k of MODELS) stepModel(trade.m[k], trade.dir, b);
    trade.lastBarT = b.t;
    if (MODELS.every(k => trade.m[k].done)) return 'closed';
  }
  return MODELS.every(k => trade.m[k].done) ? 'closed' : 'open';
}
export const closedRecord = trade => ({ id: trade.id, symbol: trade.symbol, dir: trade.dir, triggerT: trade.triggerT, t: trade.startT, entry: trade.m.wick.entry === null ? null : p8(trade.m.wick.entry), riskPct: trade.m.wick.risk > 0 ? r4(trade.m.wick.risk / trade.m.wick.entry * 100) : null, rr1: r4(trade.rr1), net1: r4(trade.net1), volRel: r4(trade.volRel), score: trade.score, btcAlign: trade.btcAlign, stop: p8(trade.stop), t1: p8(trade.t1), t2: trade.t2 === null ? null : p8(trade.t2), res: Object.fromEntries(MODELS.map(k => [k, result(trade.m[k], trade.dir)])) });

// 한 번의 실행에서 호출: 새 후보 기록 + 열린 거래 진행. candidates: [{ symbol, ev, a, c15 }] (모든 점검 코인의 평가 결과), bars: { SYMBOL: 확정 15분봉[] }
export function paperStep(paper, { evaluations, bars, now }) {
  paper.since ??= now;
  let opened = 0, closed = 0;
  // 1) 새 후보: 실제 신호와 같은 전이 규칙(중복 방지·쿨다운)으로 기록
  for (const { symbol, ev, a, c15 } of evaluations) {
    const tr = signalTransition(paper.coins[symbol] ?? null, ev, { symbol, a, c15, now, cooldownMs: SIG.cooldownMs });
    paper.coins[symbol] = tr.committed;
    if (tr.event?.type === 'candidate') {
      if (paper.open.length >= PAPER.maxOpen) { paper.skipped++; continue; }
      if (paper.open.some(t => t.id === tr.event.id) || paper.closed.some(t => t.id === tr.event.id)) continue;
      paper.open.push(openTrade(symbol, ev, now)); opened++;
    }
  }
  // 2) 열린 거래 진행(해당 코인의 확정 15분봉이 있을 때만)
  const still = [];
  for (const t of paper.open) {
    const state = bars[t.symbol] ? advanceTrade(t, bars[t.symbol]) : 'open';
    if (state === 'closed') { paper.closed.push(closedRecord(t)); closed++; }
    else if (state === 'gap') paper.gaps++;
    else still.push(t);
  }
  paper.open = still;
  if (paper.closed.length > PAPER.keepClosed) { paper.dropped += paper.closed.length - PAPER.keepClosed; paper.closed = paper.closed.slice(-PAPER.keepClosed); }
  return { opened, closed };
}

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const quant = (a, q) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y), k = (b.length - 1) * q, lo = Math.floor(k), hi = Math.ceil(k); return b[lo] + (b[hi] - b[lo]) * (k - lo); };
// 누적 성과. 표본이 minSample 미만이면 sufficient=false(결론 금지).
export function paperSummary(paper, now = Date.now()) {
  const out = { open: paper.open.length, closed: paper.closed.length, gaps: paper.gaps, skipped: paper.skipped, since: paper.since, days: paper.since ? Math.max(0, (now - paper.since) / 86400000) : 0, sufficient: paper.closed.length >= PAPER.minSample, models: {} };
  for (const k of MODELS) {
    const rows = paper.closed.map(t => ({ t: t.t, o: t.res[k] })).filter(r => r.o && r.o.kind !== 'skipped'), n = rows.length, net = rows.map(r => r.o.net), win = net.filter(x => x > 0), loss = net.filter(x => x <= 0), kind = x => (n ? rows.filter(r => r.o.kind === x).length / n : null), ci = clusterBootstrap(rows, r => r.o.net);
    out.models[k] = { n, target: kind('target'), stop: kind('stop'), time: kind('time'), meanNetR: mean(net), ciLo: ci.lo, ciHi: ci.hi, medianNetR: quant(net, 0.5), meanNetStressR: mean(rows.map(r => r.o.netStress)), profitFactor: loss.length && loss.reduce((x, y) => x + y, 0) < 0 ? win.reduce((x, y) => x + y, 0) / -loss.reduce((x, y) => x + y, 0) : null, maeR: mean(rows.map(r => r.o.mae)), maeP90R: quant(rows.map(r => r.o.mae), 0.9), maePct: mean(rows.map(r => r.o.maePct)), maePctP90: quant(rows.map(r => r.o.maePct), 0.9) };
  }
  // 한 줄 판정: 신뢰구간이 0을 완전히 넘어설 때만 '양'/'음'이라고 쓴다. 그 전에는 '미확정'.
  const w = out.models.wick;
  out.verdict = !out.sufficient ? '표본 부족(결론 금지)' : w.ciLo > 0 ? '평균 순손익비 양(95% 신뢰구간이 0 초과)' : w.ciHi < 0 ? '평균 순손익비 음(95% 신뢰구간이 0 미만)' : '0과 구별되지 않음(미확정)';
  return out;
}
const f = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? '-' : x.toFixed(d)), pc = x => (x === null || x === undefined || !Number.isFinite(x) ? '-' : `${(x * 100).toFixed(0)}%`);
// 로그용 한 줄(모의 · 미검증 표시 포함)
export function paperLine(s) {
  const w = s.models.wick;
  return `[모의·미검증] 열림 ${s.open} · 종료 ${s.closed} · 공백 ${s.gaps} · ${s.days.toFixed(1)}일 | 스탑주문 1차: 목표/손절/미결정 ${pc(w.target)}/${pc(w.stop)}/${pc(w.time)} · 평균 순손익비 ${f(w.meanNetR, 3)} [${f(w.ciLo, 2)}, ${f(w.ciHi, 2)}] · 중앙값 ${f(w.medianNetR, 2)} · MAE ${f(w.maeR, 2)}R(p90 ${f(w.maeP90R, 2)}R) | 판정: ${s.verdict}`;
}
