// 기회 포착 레이더 과거 데이터 검증(순수 함수, 네트워크·Telegram·상태 저장 없음).
//
// 하는 일: 코인별 1H 확정 캔들을 한 봉씩 흘려보내며 *운영과 같은 코드*(analyzeCoin + transition, minStage 2)로 알림 이벤트를 만든 뒤,
// 각 이벤트 이후의 실제 가격 경로로 결과(목표 도달/무효화/시간 만료, 순손익비 R, 최대 역행폭 MAE, 최대 순행폭 MFE)를 잰다.
// 그리고 이벤트를 코호트(기존 방식 전체, 3단계만, 거래량 확인, 점수 구간 …)로 나눠 비교한다.
//
// 인과성: 시점 i의 판정에는 i번째 봉까지의 확정 캔들만 넣는다(1H는 운영과 같이 최근 150개, 4H는 신호 봉 마감 시각까지 마감된 것만).
// 결과 측정은 i+1번째 봉 시가에서 시작한다(알림은 봉 마감 뒤에 도착하므로 마감가 체결을 가정하지 않는다).
// 한계: 시간당 상한(12)·일일 상한(80)·쿨다운 외의 운영 상한은 재현하지 않는다(상한이 걸리면 실제 알림은 이보다 적다). 생존 편향 — 현재 거래대금 상위 종목만 쓴다.
import { analyzeCoin } from './analysis.mjs';
import { aggregate, H1, H4 } from './indicators.mjs';
import { transition, blank } from './transition.mjs';

export const BT = Object.freeze({ win1h: 150, win4h: 300, warm1h: 900, horizon: 48, costBps: 10 });   // 비용: 왕복 0.10%(수수료+슬리피지 가정)

const lcg = seed => { let x = seed >>> 0; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296; };

// 한 방향 포지션 가정의 사후 결과(관찰 가격이 실제로 체결된다고 가정한 계산용 모형이며 주문 기능이 아니다).
//  entryIdx = 신호 봉 인덱스. 체결 = 다음 봉 시가. 무효화 = 1H 종가가 inv를 이탈한 봉의 종가에서 종료(운영 규칙과 동일). 목표 = 봉 고가(저가)가 닿으면 목표가에서 종료.
//  같은 봉에서 목표 도달과 무효화 종가 이탈이 모두 일어나면 보수적으로 무효화로 본다. 기간 안에 끝나지 않으면 마지막 봉 종가에서 종료.
export function outcome(c1h, entryIdx, dir, inv, target, { horizon = BT.horizon, costBps = BT.costBps } = {}) {
  const s = dir === 'LONG' ? 1 : -1, ent = c1h[entryIdx + 1];
  if (!ent) return null;
  const entry = ent.o, risk = (entry - inv) * s;
  if (!(risk > 0)) return { skipped: 'already-invalid' };
  const last = Math.min(c1h.length - 1, entryIdx + horizon);
  if (last <= entryIdx) return null;
  let exit = null, kind = 'time', mae = 0, mfe = 0;
  for (let j = entryIdx + 1; j <= last; j++) {
    const b = c1h[j];
    mae = Math.max(mae, (entry - (s > 0 ? b.l : b.h)) * s / risk); mfe = Math.max(mfe, ((s > 0 ? b.h : b.l) - entry) * s / risk);
    const stopHit = (b.c - inv) * s < 0, tgtHit = target !== null && (s > 0 ? b.h >= target : b.l <= target);
    if (stopHit) { exit = b.c; kind = 'stop'; break; }
    if (tgtHit) { exit = target; kind = 'target'; break; }
  }
  if (exit === null) exit = c1h[last].c;
  const gross = (exit - entry) * s / risk, cost = entry * costBps / 10000 / risk;
  return { kind, entry, risk, riskPct: risk / entry * 100, gross, net: gross - cost, mae, maePct: mae * risk / entry * 100, mfe, bars: 0 };
}

// 코인 하나의 알림 이벤트와 사후 결과. c1h: 전체 1H 확정 캔들(오래된 순), btc1h: 같은 구간 BTC 1H(없으면 null).
export function collectEvents(symbol, c1h, btc1h = null, { from = BT.warm1h, horizon = BT.horizon, minStage = 2, sampleControl = null } = {}) {
  const all4 = aggregate(c1h), btc4 = btc1h ? aggregate(btc1h) : null, events = [], controls = [];
  let prev = null, p4 = 0, pb = 0;
  for (let i = from; i < c1h.length - 1; i++) {
    const t = c1h[i].t + H1;
    while (p4 < all4.length && all4[p4].t + H4 <= t) p4++;                                  // 신호 봉 마감 시각까지 마감된 4H 봉 수
    while (btc4 && pb < btc4.length && btc4[pb].t + H4 <= t) pb++;
    const a = analyzeCoin(c1h.slice(Math.max(0, i - BT.win1h + 1), i + 1), all4.slice(Math.max(0, p4 - BT.win4h), p4), btc4 ? btc4.slice(Math.max(0, pb - BT.win4h), pb) : null);
    if (a.status !== 'ok') continue;
    const tr = transition(prev, { ...a, barT: a.barT }, t, { minStage });
    prev = tr.committed;                                                                      // 알림이 전부 전달됐다고 가정(상한·전송 실패 없음)
    if (tr.event && ['new', 'upgrade', 'flip'].includes(tr.event.type) && a.plan) {
      const o = outcome(c1h, i, a.dir, a.plan.invalidation, a.plan.target?.price ?? null, { horizon });
      if (o && !o.skipped) events.push({ symbol, i, t, type: tr.event.type, dir: a.dir, stage: a.stage, met: a.met, score: a.score.total, parts: Object.fromEntries(a.score.parts.map(p => [p.key, p.score])), rr: a.plan.rr, hasTarget: Boolean(a.plan.target), relVol: a.metrics.relVol, volLevel: a.metrics.volume.level, volDry: a.metrics.volume.dry, btcAlign: a.metrics.btcAlign, volLabel: a.metrics.volLabel, o });
    }
    if (sampleControl && a.trend && sampleControl(i)) {                                       // 무작위 대조군: 4H 추세 방향이 있는 아무 봉(눌림 조건 없음)
      const dir = a.trend === 'UP' ? 'LONG' : 'SHORT', a1 = a.metrics.atr1Pct / 100 * a.price, ent = c1h[i + 1].o, inv = dir === 'LONG' ? ent - 2 * a1 : ent + 2 * a1;
      controls.push({ symbol, i, t, dir, inv, ent });
    }
  }
  return { events, controls };
}

// ── 집계 ──
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const quant = (a, q) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y), k = (b.length - 1) * q, lo = Math.floor(k), hi = Math.ceil(k); return b[lo] + (b[hi] - b[lo]) * (k - lo); };
const dayOf = t => Math.floor(t / 86400000);

// 일(UTC) 단위 군집 부트스트랩: 같은 날의 이벤트는 시장 전체 움직임에 함께 묶여 독립이 아니므로 날짜를 재표집한다.
export function clusterBootstrap(rows, pick, { iters = 1000, seed = 7 } = {}) {
  if (!rows.length) return { mean: null, lo: null, hi: null };
  const by = new Map(); for (const r of rows) { const k = dayOf(r.t); (by.get(k) || by.set(k, []).get(k)).push(pick(r)); }
  const days = [...by.values()], rnd = lcg(seed), means = [];
  for (let b = 0; b < iters; b++) { let s = 0, n = 0; for (let k = 0; k < days.length; k++) { const d = days[Math.floor(rnd() * days.length)]; for (const v of d) { s += v; n++; } } means.push(s / n); }
  return { mean: mean(rows.map(pick)), lo: quant(means, 0.025), hi: quant(means, 0.975) };
}

export function summarize(rows, { coins, days } = {}) {
  const n = rows.length, net = rows.map(r => r.o.net), win = net.filter(x => x > 0), loss = net.filter(x => x <= 0);
  const kinds = k => rows.filter(r => r.o.kind === k).length;
  const ci = clusterBootstrap(rows, r => r.o.net);
  return {
    n, perCoinDay: coins && days ? n / coins / days : null,
    target: n ? kinds('target') / n : null, stop: n ? kinds('stop') / n : null, time: n ? kinds('time') / n : null,
    meanNetR: mean(net), ciLo: ci.lo, ciHi: ci.hi, medianNetR: quant(net, 0.5),
    profitFactor: loss.length && loss.reduce((x, y) => x + y, 0) < 0 ? win.reduce((x, y) => x + y, 0) / -loss.reduce((x, y) => x + y, 0) : null,
    plannedRR: mean(rows.filter(r => r.hasTarget).map(r => r.rr)), withTarget: n ? rows.filter(r => r.hasTarget).length / n : null,
    riskPct: mean(rows.map(r => r.o.riskPct)),
    maeR: mean(rows.map(r => r.o.mae)), maeP90R: quant(rows.map(r => r.o.mae), 0.9), maePct: mean(rows.map(r => r.o.maePct)), maePctP90: quant(rows.map(r => r.o.maePct), 0.9),
    mfeR: mean(rows.map(r => r.o.mfe)),
  };
}

// 코호트 정의. 'old' = 지금 운영 중인 방식(2단계 이상 알림 이벤트 전부). 나머지는 사후 필터(알림 규칙을 바꾸지 않고 '이 조건을 더하면 어땠나'를 본다).
export const COHORTS = Object.freeze([
  ['기존: 2단계 이상 알림 전체', r => true],
  ['기존: 3단계(조건 충족)만', r => r.stage === 3],
  ['기존: 2단계만', r => r.stage === 2],
  ['3단계 + 거래량 확대(×1.2↑)', r => r.stage === 3 && r.volLevel === '확대'],
  ['2·3단계 + 거래량 확대', r => r.volLevel === '확대'],
  ['2·3단계 + 눌림 중 거래 위축', r => r.volDry === true],
  ['점수 75↑ (높음)', r => r.score >= 75],
  ['점수 55~74 (보통)', r => r.score >= 55 && r.score < 75],
  ['점수 55↓ (낮음)', r => r.score < 55],
  ['3단계 + 점수 75↑', r => r.stage === 3 && r.score >= 75],
  ['손익비 3R↑ (목표 있음)', r => r.hasTarget && r.rr >= 3],
  ['변동성 높음 제외', r => r.volLabel !== '높음'],
  ['BTC 방향 일치만', r => r.btcAlign === '일치'],
]);

// 점수 단조성: 점수 구간(사분위)이 오를수록 평균 순손익비가 오르는가. 스피어먼 순위상관(점수 ↔ 순손익비)도 같이 낸다.
export function scoreMonotonic(rows) {
  if (rows.length < 20) return { n: rows.length, rho: null, quartiles: [] };
  const sorted = [...rows].sort((a, b) => a.score - b.score), q = Math.floor(sorted.length / 4), groups = [0, 1, 2, 3].map(k => sorted.slice(k * q, k === 3 ? undefined : (k + 1) * q));
  const rank = arr => { const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]), r = Array(arr.length); let k = 0; while (k < idx.length) { let e = k; while (e + 1 < idx.length && idx[e + 1][0] === idx[k][0]) e++; for (let m = k; m <= e; m++) r[idx[m][1]] = (k + e) / 2; k = e + 1; } return r; };
  const rx = rank(rows.map(r => r.score)), ry = rank(rows.map(r => r.o.net)), mx = mean(rx), my = mean(ry);
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < rx.length; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
  return { n: rows.length, rho: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null, quartiles: groups.map(g => ({ n: g.length, scoreLo: g[0].score, scoreHi: g.at(-1).score, meanNetR: mean(g.map(r => r.o.net)), target: g.filter(r => r.o.kind === 'target').length / g.length, maeR: mean(g.map(r => r.o.mae)) })) };
}

// 무작위 대조군 결과: 같은 4H 추세 방향의 아무 봉에서 2 ATR(1H) 무효화, 목표는 target R 고정(이벤트의 계획 손익비 중앙값).
export function controlOutcomes(coinData, controls, targetR, { horizon = BT.horizon } = {}) {
  const out = [];
  for (const c of controls) {
    const c1h = coinData[c.symbol], s = c.dir === 'LONG' ? 1 : -1, risk = (c.ent - c.inv) * s;
    const o = outcome(c1h, c.i, c.dir, c.inv, c.ent + s * risk * targetR, { horizon });
    if (o && !o.skipped) out.push({ symbol: c.symbol, t: c.t, o, score: 0 });
  }
  return out;
}

// 전체 실행: coinData = { SYMBOL: c1h[] }, btc = BTC 1H. 반환: 이벤트·코호트 요약·점수 단조성·대조군.
export function runBacktest(coinData, btc, { from = BT.warm1h, horizon = BT.horizon, controlEvery = 24, seed = 11 } = {}) {
  const rnd = lcg(seed), events = [], controls = [];
  for (const [symbol, c1h] of Object.entries(coinData)) {
    const r = collectEvents(symbol, c1h, symbol === 'BTCUSDT' ? null : btc, { from, horizon, sampleControl: () => rnd() < 1 / controlEvery });
    events.push(...r.events); controls.push(...r.controls);
  }
  const n = Object.keys(coinData).length, span = Math.max(...Object.values(coinData).map(c => c.length)) - from, days = span / 24;
  const mid = events.length ? [...events].sort((a, b) => a.t - b.t)[Math.floor(events.length / 2)].t : 0;
  const cohorts = COHORTS.map(([name, f]) => { const rows = events.filter(f); return { name, all: summarize(rows, { coins: n, days }), first: summarize(rows.filter(r => r.t < mid), { coins: n, days: days / 2 }), second: summarize(rows.filter(r => r.t >= mid), { coins: n, days: days / 2 }) }; });
  const rrs = events.filter(e => e.hasTarget).map(e => e.rr), targetR = rrs.length ? quant(rrs, 0.5) : 2;
  const ctrl = controlOutcomes(coinData, controls, targetR, { horizon });
  return { coins: n, days, events: events.length, midT: mid, cohorts, scoreMonotonic: scoreMonotonic(events), scoreMonotonic3: scoreMonotonic(events.filter(e => e.stage === 3)), control: { targetR, ...summarize(ctrl, { coins: n, days }) }, raw: events };
}

// ── 보고서(마크다운 표) ──
const f = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? '-' : x.toFixed(d));
const pc = x => (x === null || x === undefined || !Number.isFinite(x) ? '-' : `${(x * 100).toFixed(0)}%`);
export function renderReport(r, meta = {}) {
  const row = c => { const a = c.all, h1 = c.first, h2 = c.second; return `| ${c.name} | ${a.n} | ${f(a.perCoinDay, 3)} | ${pc(a.target)}/${pc(a.stop)}/${pc(a.time)} | ${f(a.plannedRR, 1)} | ${f(a.meanNetR, 3)} [${f(a.ciLo, 2)}, ${f(a.ciHi, 2)}] | ${f(a.medianNetR, 2)} | ${f(a.profitFactor, 2)} | ${f(a.maeR, 2)} / ${f(a.maeP90R, 2)} | ${f(a.maePct, 1)}% / ${f(a.maePctP90, 1)}% | ${f(h1.meanNetR, 3)} (${h1.n}) | ${f(h2.meanNetR, 3)} (${h2.n}) |`; };
  const lines = [`### 과거 데이터 검증 (${meta.note ?? ''})`, `종목 ${r.coins}개 · 평가 기간 약 ${r.days.toFixed(0)}일 · 알림 이벤트 ${r.events}건 · 기간 ${BT.horizon}시간 · 비용 왕복 ${BT.costBps}bp`, '',
    '| 코호트 | 이벤트 | 이벤트/종목/일 | 목표/무효화/만료 | 계획 손익비 | 평균 순손익비 [95% CI] | 중앙값 | PF | MAE 평균/p90 (R) | MAE 평균/p90 (%) | 전반 | 후반 |', '|---|---|---|---|---|---|---|---|---|---|---|---|', ...r.cohorts.map(row)];
  const c = r.control; lines.push(`| (대조) 무작위 추세방향 진입 · 2ATR 무효화 · 목표 ${f(c.targetR, 1)}R | ${c.n} | ${f(c.perCoinDay, 3)} | ${pc(c.target)}/${pc(c.stop)}/${pc(c.time)} | ${f(c.targetR, 1)} | ${f(c.meanNetR, 3)} [${f(c.ciLo, 2)}, ${f(c.ciHi, 2)}] | ${f(c.medianNetR, 2)} | ${f(c.profitFactor, 2)} | ${f(c.maeR, 2)} / ${f(c.maeP90R, 2)} | ${f(c.maePct, 1)}% / ${f(c.maePctP90, 1)}% | - | - |`);
  for (const [name, m] of [['전체 알림', r.scoreMonotonic], ['3단계만', r.scoreMonotonic3]]) {
    lines.push('', `**점수 단조성 (${name})** 표본 ${m.n} · 스피어먼 ρ(점수↔순손익비) = ${f(m.rho, 3)}`);
    if (m.quartiles.length) lines.push('| 사분위 | 표본 | 점수 범위 | 평균 순손익비 | 목표 도달 | MAE(R) |', '|---|---|---|---|---|---|', ...m.quartiles.map((q, k) => `| Q${k + 1} | ${q.n} | ${q.scoreLo}~${q.scoreHi} | ${f(q.meanNetR, 3)} | ${pc(q.target)} | ${f(q.maeR, 2)} |`));
  }
  return lines.join('\n');
}
