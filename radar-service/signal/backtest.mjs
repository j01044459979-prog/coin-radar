// 15분봉 진입 트리거 규칙 과거 데이터 검증(순수 함수, 네트워크·Telegram·상태 저장 없음).
//
// 하는 일: 코인별 15분봉 확정 캔들을 한 봉씩 흘려보내며 *운영과 같은 코드*(1H·4H 분석 + evaluateSignal + signalTransition)로 '진입 후보' 이벤트를 만들고,
// 이후 가격 경로를 시간순으로 따라가 목표 선도달/손절 선도달/미결정, 순손익비(비용 반영), 최대 역행폭(MAE)을 잰다.
// 1H·4H는 15분봉을 집계해서 만든다(마감된 봉만). 따라서 한 종류의 데이터로 세 시간대가 일관된다.
//
// 인과성: 시점 i(15분봉 i가 막 마감)의 판정에는 i번째 봉까지의 15분봉(최근 120개), 그 시각까지 마감된 1H(최근 150개)·4H(최근 300개)만 넣는다.
// 체결은 i+1번째 봉 시가(알림 도착 뒤 시장가 가정). 결과 측정은 i+1번째 봉부터다.
// 두 가지 무효화 모형을 모두 잰다:
//   · 종가 모형(A): 15분봉 *종가*가 손절 기준을 이탈한 봉의 종가에서 종료 — 운영의 무효화 규칙과 같다.
//   · 스탑주문 모형(B): 봉의 *고저가*가 손절 기준에 닿으면 손절가(시가가 이미 넘었으면 시가)에서 종료 — 실제 스탑 주문에 가깝고 더 보수적이다.
//   같은 봉에서 목표와 손절이 모두 가능하면 손절을 먼저 본다(보수적). 비용: 왕복 15bp(수수료 10 + 슬리피지 5) 기본, 30bp 민감도도 함께 낸다.
// 대조군: 같은 맥락(4H·1H 2단계 이상, 손절·목표·손익비 조건 동일)에서 15분 트리거와 거래량 조건만 뺀 '맥락만' 이벤트.
//   트리거·거래량이 실제로 가치를 더하는지는 신호 vs 대조군 비교로만 알 수 있다.
// 한계: 일일 상한·실행 지연 미재현, 포지션 겹침 무시(이벤트별 독립), 생존 편향(현재 거래대금 상위 종목).
import { analyzeCoin } from '../opportunity/analysis.mjs';
import { aggregate, H1, H4 } from '../opportunity/indicators.mjs';
import { clusterBootstrap } from '../opportunity/backtest.mjs';
import { evaluateSignal, M15, SIG } from './evaluate.mjs';
import { signalTransition } from './transition.mjs';

export const SBT = Object.freeze({ win15: 120, win1h: 150, win4h: 300, warm15: 3700, horizon15: 192, costBps: 15, stressBps: 30, minRR: 1.5, validMin: 45 });

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const quant = (a, q) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y), k = (b.length - 1) * q, lo = Math.floor(k), hi = Math.ceil(k); return b[lo] + (b[hi] - b[lo]) * (k - lo); };

// 한 신호의 사후 결과. c15: 전체 15분봉, i: 신호 봉 인덱스(체결은 i+1 시가). stopModel: 'close' | 'wick'. target: 가격 또는 null(목표 없으면 시간 종료만).
export function pathOutcome(c15, i, dir, stop, target, { stopModel = 'wick', horizon = SBT.horizon15, costBps = SBT.costBps, stressBps = SBT.stressBps } = {}) {
  const ent = c15[i + 1];
  if (!ent) return null;
  const s = dir === 'LONG' ? 1 : -1, entry = ent.o, risk = (entry - stop) * s;
  if (!(risk > 0)) return { skipped: 'already-invalid' };
  const last = Math.min(c15.length - 1, i + horizon);
  let exit = null, kind = 'time', mae = 0, mfe = 0, bars = last - i;
  for (let j = i + 1; j <= last; j++) {
    const b = c15[j];
    mae = Math.max(mae, (entry - (s > 0 ? b.l : b.h)) * s / risk); mfe = Math.max(mfe, ((s > 0 ? b.h : b.l) - entry) * s / risk);
    const stopHit = stopModel === 'close' ? (b.c - stop) * s < 0 : (s > 0 ? b.l <= stop : b.h >= stop), tgtHit = target !== null && (s > 0 ? b.h >= target : b.l <= target);
    if (stopHit) { exit = stopModel === 'close' ? b.c : ((b.o - stop) * s < 0 ? b.o : stop); kind = 'stop'; bars = j - i; break; }   // 시가가 이미 손절을 넘었으면(갭) 시가에서 종료
    if (tgtHit) { exit = target; kind = 'target'; bars = j - i; break; }
  }
  if (exit === null) exit = c15[last].c;
  const gross = (exit - entry) * s / risk, cr = bps => entry * bps / 10000 / risk;
  return { kind, entry, risk, riskPct: risk / entry * 100, gross, net: gross - cr(costBps), netStress: gross - cr(stressBps), mae, maePct: mae * risk / entry * 100, mfe, bars };
}

// 15분봉 → 1H·4H (마감된 봉만)
export function buildFrames(c15) { const c1h = aggregate(c15, M15, H1), c4h = aggregate(c1h); return { c1h, c4h }; }

// 코인 하나의 이벤트. 반환 { events, control } — 각 항목에 신호 시점 지표와 두 무효화 모형·두 목표(T1, T2) 결과가 들어 있다.
export function collectSignalEvents(symbol, c15, btc15 = null, { from = SBT.warm15, minRR = SBT.minRR, validMin = SBT.validMin, horizon = SBT.horizon15, control = true, P = SIG } = {}) {
  const { c1h, c4h } = buildFrames(c15), btc4 = btc15 ? buildFrames(btc15).c4h : null;
  const out = { events: [], control: [] };
  const state = { sig: null, ctl: null };
  let p1 = 0, p4 = 0, pb = 0, cacheKey = -1, a = null;
  for (let i = from; i < c15.length - 1; i++) {
    const closeT = c15[i].t + M15, now = closeT + 60000;
    while (p1 < c1h.length && c1h[p1].t + H1 <= closeT) p1++;                                // 신호 시각까지 마감된 1H 봉 수
    while (p4 < c4h.length && c4h[p4].t + H4 <= closeT) p4++;
    while (btc4 && pb < btc4.length && btc4[pb].t + H4 <= closeT) pb++;
    if (p1 < 100 || p4 < 210) continue;
    if (p1 !== cacheKey) {                                                                     // 1H 봉이 새로 마감됐을 때만 상위 분석을 다시 한다(운영도 같은 1H 데이터를 쓴다)
      a = analyzeCoin(c1h.slice(Math.max(0, p1 - SBT.win1h), p1), c4h.slice(Math.max(0, p4 - SBT.win4h), p4), btc4 ? btc4.slice(Math.max(0, pb - SBT.win4h), pb) : null); cacheKey = p1;
    }
    if (a.status !== 'ok') continue;
    const win = c15.slice(Math.max(0, i - SBT.win15 + 1), i + 1);
    for (const [key, ignore, bucket] of [['sig', [], out.events], ['ctl', ['trigger', 'volume'], out.control]]) {
      if (key === 'ctl' && !control) continue;
      const ev = evaluateSignal({ a, c15: win, now }, { minRR, validMin, ignore, P });
      const tr = signalTransition(state[key], ev, { symbol, a, c15: win, now, cooldownMs: SIG.cooldownMs });
      state[key] = tr.committed;                                                               // 알림이 전부 전달됐다고 가정
      if (tr.event?.type !== 'candidate') continue;
      const e = tr.event.ev, t1 = e.t1.price, t2 = e.t2?.price ?? null;
      const res = {};
      for (const model of ['close', 'wick']) { res[model] = pathOutcome(c15, i, e.dir, e.stop, t1, { stopModel: model, horizon }); res[`${model}T2`] = pathOutcome(c15, i, e.dir, e.stop, t2 ?? t1, { stopModel: model, horizon }); }
      if (!res.wick || res.wick.skipped) continue;                                              // 다음 봉 시가가 이미 손절 기준을 넘음
      bucket.push({ symbol, i, t: closeT, dir: e.dir, strategy: 'S', stop: e.stop, stage: a.stage, score: a.score?.total ?? null, volRel: e.volRel, rr1: e.t1.rr, net1: e.t1.net, hasT2: Boolean(e.t2), riskPct: e.riskPct, btcAlign: a.metrics.btcAlign, res });
    }
  }
  return out;
}

// ── 집계 ──
export function summarizeSignals(rows, model = 'wick', { coins, days } = {}) {
  const r = rows.map(x => ({ ...x, o: x.res[model] })).filter(x => x.o && !x.o.skipped), n = r.length, net = r.map(x => x.o.net), kinds = k => r.filter(x => x.o.kind === k).length;
  const ci = clusterBootstrap(r, x => x.o.net), win = net.filter(x => x > 0), loss = net.filter(x => x <= 0);
  return {
    n, perCoinDay: coins && days ? n / coins / days : null, target: n ? kinds('target') / n : null, stop: n ? kinds('stop') / n : null, time: n ? kinds('time') / n : null,
    grossR: mean(r.map(x => x.o.gross)), netR: mean(net), ciLo: ci.lo, ciHi: ci.hi, netStressR: mean(r.map(x => x.o.netStress)), medianNetR: quant(net, 0.5),
    profitFactor: loss.length && loss.reduce((x, y) => x + y, 0) < 0 ? win.reduce((x, y) => x + y, 0) / -loss.reduce((x, y) => x + y, 0) : null,
    plannedRR1: mean(r.map(x => x.rr1)), riskPct: mean(r.map(x => x.o.riskPct)), maeR: mean(r.map(x => x.o.mae)), maeP90R: quant(r.map(x => x.o.mae), 0.9), maePct: mean(r.map(x => x.o.maePct)), maePctP90: quant(r.map(x => x.o.maePct), 0.9),
    mfeR: mean(r.map(x => x.o.mfe)), medianBars: quant(r.map(x => x.o.bars), 0.5),
  };
}
const withT2 = rows => rows.filter(x => x.hasT2);
export const SIGNAL_COHORTS = Object.freeze([
  ['신호 전체 · 스탑주문 모형 · 1차 목표', 'sig', 'wick', r => r],
  ['신호 전체 · 종가 모형(운영 무효화 규칙) · 1차 목표', 'sig', 'close', r => r],
  ['신호 전체 · 스탑주문 모형 · 2차 목표(있는 신호만)', 'sig', 'wickT2', withT2],
  ['신호 LONG', 'sig', 'wick', r => r.filter(x => x.dir === 'LONG')],
  ['신호 SHORT', 'sig', 'wick', r => r.filter(x => x.dir === 'SHORT')],
  ['신호 · 4H·1H 3단계만', 'sig', 'wick', r => r.filter(x => x.stage === 3)],
  ['신호 · 거래량 ×2 이상', 'sig', 'wick', r => r.filter(x => x.volRel >= 2)],
  ['신호 · 기회 점수 75↑', 'sig', 'wick', r => r.filter(x => x.score >= 75)],
  ['신호 · BTC 방향 일치', 'sig', 'wick', r => r.filter(x => x.btcAlign === '일치')],
  ['대조: 맥락만(15분 트리거·거래량 없이) · 스탑주문 모형', 'ctl', 'wick', r => r],
  ['대조: 맥락만 · 종가 모형', 'ctl', 'close', r => r],
]);

export function runSignalBacktest(coinData, btc15, opts = {}) {
  const events = [], control = [];
  for (const [symbol, c15] of Object.entries(coinData)) { const r = collectSignalEvents(symbol, c15, symbol === 'BTCUSDT' ? null : btc15, opts); events.push(...r.events); control.push(...r.control); }
  const n = Object.keys(coinData).length, from = opts.from ?? SBT.warm15, days = Math.max(...Object.values(coinData).map(c => c.length - from)) / 96;
  const sortedT = [...events].sort((a, b) => a.t - b.t), mid = sortedT.length ? sortedT[Math.floor(sortedT.length / 2)].t : 0, pools = { sig: events, ctl: control };
  const cohorts = SIGNAL_COHORTS.map(([name, pool, model, f]) => {
    const rows = f(pools[pool]);
    return { name, model, all: summarizeSignals(rows, model, { coins: n, days }), first: summarizeSignals(rows.filter(x => x.t < mid), model, { coins: n, days: days / 2 }), second: summarizeSignals(rows.filter(x => x.t >= mid), model, { coins: n, days: days / 2 }) };
  });
  return { coins: n, days, events: events.length, control: control.length, midT: mid, cohorts, raw: { events, control } };
}

const f = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? '-' : x.toFixed(d));
const pc = x => (x === null || x === undefined || !Number.isFinite(x) ? '-' : `${(x * 100).toFixed(0)}%`);
export function renderSignalReport(r, meta = {}) {
  const row = c => { const a = c.all; return `| ${c.name} | ${a.n} | ${f(a.perCoinDay, 3)} | ${pc(a.target)}/${pc(a.stop)}/${pc(a.time)} | ${f(a.plannedRR1, 1)} | ${f(a.netR, 3)} [${f(a.ciLo, 2)}, ${f(a.ciHi, 2)}] | ${f(a.netStressR, 3)} | ${f(a.medianNetR, 2)} | ${f(a.profitFactor, 2)} | ${f(a.maeR, 2)} / ${f(a.maeP90R, 2)} | ${f(a.maePct, 1)}% / ${f(a.maePctP90, 1)}% | ${f(c.first.netR, 3)} (${c.first.n}) | ${f(c.second.netR, 3)} (${c.second.n}) |`; };
  return [`### 15분봉 진입 트리거 과거 데이터 검증 (${meta.note ?? ''})`, `종목 ${r.coins}개 · 평가 기간 약 ${r.days.toFixed(0)}일 · 신호 ${r.events}건 · 대조군 ${r.control}건 · 보유 최대 ${SBT.horizon15 / 4}시간 · 비용 왕복 ${SBT.costBps}bp(민감도 ${SBT.stressBps}bp)`, '',
    '| 코호트 | 이벤트 | 이벤트/종목/일 | 목표/손절/미결정 | 계획 손익비(1차) | 평균 순손익비 [95% CI] | 30bp 순손익비 | 중앙값 | PF | MAE 평균/p90 (R) | MAE 평균/p90 (%) | 전반 | 후반 |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|', ...r.cohorts.map(row)].join('\n');
}
