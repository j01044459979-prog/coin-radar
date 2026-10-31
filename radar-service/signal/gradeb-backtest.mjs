// A급(확정형) vs B급(공격형) 과거 데이터 비교(순수 함수, 네트워크·Telegram·주문·상태 저장 없음).
// 운영과 같은 코드(analyzeCoin + evaluateSignal/evaluateB + signalTransition)를 15분봉 한 봉씩 흘려보낸다. 체결은 다음 봉 시가(시장가 가정), 손절은 꼬리 기준(스탑주문 모형), 같은 봉에서 목표·손절이 모두 가능하면 손절 먼저.
// 스트림: A(A급 단독) · B(B급 단독) · DUAL(실제 이중 운용: 한 코인에 활성 신호는 하나, 같은 봉이면 A급 우선) · BCTL(대조군: 구간 시험+방향만, 회복·저점 유지·확인 봉·거래량 조건 제외 — 확인 조건이 가치를 더하는지 보기 위함).
// 금액 환산: 한 건의 손실 한도 A급 = 평가액 300 × 1%(점수 80 이상 1.5%), B급 = 1.5 USDT. 손익 = 비용 반영 순손익비(R) × 한도. 분할 진입·수수료 세부는 RICH300 계획이 정하고 여기서는 왕복 15bp 단일 진입으로 근사한다.
// 한계: 일일 상한·실행 지연·실행 간격(포착률) 미재현, 생존 편향(현재 거래대금 상위 종목), 표본이 작으면 신뢰구간이 넓다. 우위가 입증되지 않으면 보고서가 그렇게 표시한다.
import { analyzeCoin } from '../opportunity/analysis.mjs';
import { H1, H4 } from '../opportunity/indicators.mjs';
import { clusterBootstrap } from '../opportunity/backtest.mjs';
import { buildFrames, pathOutcome, summarizeSignals, SBT } from './backtest.mjs';
import { evaluateSignal, M15, SIG } from './evaluate.mjs';
import { evaluateB, SIGB } from './gradeb.mjs';
import { signalTransition } from './transition.mjs';

export const budgetA = score => 300 * (Number.isFinite(score) && score >= 80 ? 0.015 : 0.01);
export const budgetB = () => SIGB.riskUsdt;

export function collectGradeEvents(symbol, c15, btc15 = null, { from = SBT.warm15, minRR = SBT.minRR, validMin = SBT.validMin, horizon = SBT.horizon15, P = SIG, PB = SIGB } = {}) {
  const { c1h, c4h } = buildFrames(c15), btc4 = btc15 ? buildFrames(btc15).c4h : null;
  const out = { A: [], B: [], DUAL: [], BCTL: [] }, st = { A: null, B: null, DUAL: null, BCTL: null };
  let p1 = 0, p4 = 0, pb = 0, cacheKey = -1, a = null;
  for (let i = from; i < c15.length - 1; i++) {
    const closeT = c15[i].t + M15, now = closeT + 60000;
    while (p1 < c1h.length && c1h[p1].t + H1 <= closeT) p1++;
    while (p4 < c4h.length && c4h[p4].t + H4 <= closeT) p4++;
    while (btc4 && pb < btc4.length && btc4[pb].t + H4 <= closeT) pb++;
    if (p1 < 100 || p4 < 210) continue;
    if (p1 !== cacheKey) { a = analyzeCoin(c1h.slice(Math.max(0, p1 - SBT.win1h), p1), c4h.slice(Math.max(0, p4 - SBT.win4h), p4), btc4 ? btc4.slice(Math.max(0, pb - SBT.win4h), pb) : null); cacheKey = p1; }
    if (a.status !== 'ok') continue;
    const win = c15.slice(Math.max(0, i - SBT.win15 + 1), i + 1);
    const evA = evaluateSignal({ a, c15: win, now }, { minRR, validMin, P }), evB = evaluateB({ a, c15: win, now }, { validMin, P: PB }), evC = evaluateB({ a, c15: win, now }, { validMin, P: PB, ignore: ['recovery', 'hold', 'confirm', 'volume'] });
    const dualEv = evA.status === 'CANDIDATE' ? evA : evB.status === 'CANDIDATE' ? evB : evA;                       // 같은 봉이면 A급 우선
    for (const [key, ev, grade] of [['A', evA, 'A'], ['B', evB, 'B'], ['DUAL', dualEv, null], ['BCTL', evC, 'B']]) {
      const tr = signalTransition(st[key], ev, { symbol, a, c15: win, now, cooldownMs: SIG.cooldownMs });
      st[key] = tr.committed;
      if (tr.event?.type !== 'candidate') continue;
      const e = tr.event.ev, g = grade ?? e.grade ?? 'A', res = pathOutcome(c15, i, e.dir, e.stop, e.t1.price, { stopModel: 'wick', horizon });
      if (!res || res.skipped) continue;
      out[key].push({ symbol, i, t: closeT, dir: e.dir, grade: g, stop: e.stop, stage: a.stage, score: a.score?.total ?? null, volRel: e.volRel, rr1: e.t1.rr, net1: e.t1.net, hasT2: Boolean(e.t2), riskPct: e.riskPct, btcAlign: a.metrics.btcAlign, budget: g === 'B' ? budgetB() : budgetA(a.score?.total), res: { wick: res } });
    }
  }
  return out;
}

// USDT 환산 요약: 순손익(합), 건당 평균, 최악 1건, 최대 낙폭(시간순 누적), 하루 최악 합, 하루 손실 한도(−9 USDT) 초과 일수
export function usdtStats(rows) {
  const r = rows.filter(x => x.res?.wick && !x.res.wick.skipped).map(x => ({ t: x.t, p: x.res.wick.net * x.budget })).sort((x, y) => x.t - y.t);
  if (!r.length) return { n: 0, total: 0, perTrade: null, worst: null, maxDD: 0, worstDay: null, daysOverLimit: 0 };
  let cum = 0, peak = 0, dd = 0; const day = new Map();
  for (const x of r) { cum += x.p; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); const k = new Date(x.t).toISOString().slice(0, 10); day.set(k, (day.get(k) || 0) + x.p); }
  const days = [...day.values()];
  return { n: r.length, total: cum, perTrade: cum / r.length, worst: Math.min(...r.map(x => x.p)), maxDD: dd, worstDay: Math.min(...days), daysOverLimit: days.filter(v => v <= -SIGB.dayLossUsdt).length };
}

export function runGradeBacktest(coinData, btc15, opts = {}) {
  const pools = { A: [], B: [], DUAL: [], BCTL: [] };
  for (const [symbol, c15] of Object.entries(coinData)) { const r = collectGradeEvents(symbol, c15, symbol === 'BTCUSDT' ? null : btc15, opts); for (const k of Object.keys(pools)) pools[k].push(...r[k]); }
  const n = Object.keys(coinData).length, from = opts.from ?? SBT.warm15, days = Math.max(...Object.values(coinData).map(c => c.length - from)) / 96;
  const sum = rows => summarizeSignals(rows, 'wick', { coins: n, days });
  const streams = {}; for (const k of Object.keys(pools)) streams[k] = { ...sum(pools[k]), usdt: usdtStats(pools[k]) };
  const dual = pools.DUAL, byGrade = g => dual.filter(x => x.grade === g), early = pools.B.filter(b => !pools.A.some(a => a.symbol === b.symbol && a.dir === b.dir && a.t >= b.t && a.t - b.t <= 4 * 3600000));   // B급 중 4시간 안에 A급이 뒤따르지 않은 것
  const split = { DUAL_A: { ...sum(byGrade('A')), usdt: usdtStats(byGrade('A')) }, DUAL_B: { ...sum(byGrade('B')), usdt: usdtStats(byGrade('B')) }, B_not_followed_by_A: { ...sum(early), usdt: usdtStats(early) } };
  return { coins: n, days, streams, split, verdict: gradeVerdict(streams), raw: pools };
}

// 우위 판정: B급이 A급보다 평균 순손익비가 높고 신뢰구간 하한이 0 위일 때만 '우위 가능성', 그렇지 않으면 '우위 미입증'.
export function gradeVerdict(streams) {
  const A = streams.A, B = streams.B, notes = [];
  if (!B.n) return { proven: false, text: 'B급 우위 미입증 — B급 후보가 없습니다.', notes };
  if (B.n < 30) notes.push(`B급 표본 ${B.n}건으로 적습니다(결론 금지)`);
  const better = A.n && B.netR > A.netR, positive = B.ciLo > 0;
  if (!positive) notes.push(`B급 평균 순손익비 ${B.netR.toFixed(3)}R의 95% 신뢰구간 하한 ${B.ciLo.toFixed(2)}R이 0 이하`);
  if (!better) notes.push(`B급 평균 순손익비가 A급(${A.netR === null ? '-' : A.netR.toFixed(3)}R) 이하`);
  const proven = Boolean(better && positive && B.n >= 30);
  return { proven, text: proven ? 'B급 우위 가능성(과거 데이터, 표본·생존 편향 주의)' : 'B급 우위 미입증', notes };
}

const f = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? '-' : x.toFixed(d)), pc = x => (x === null || x === undefined || !Number.isFinite(x) ? '-' : `${(x * 100).toFixed(0)}%`);
export function renderGradeReport(r, meta = {}) {
  const row = (name, s) => `| ${name} | ${s.n} | ${f(s.perCoinDay, 3)} | ${pc(s.target)}/${pc(s.stop)}/${pc(s.time)} | ${f(s.plannedRR1, 1)} | ${f(s.netR, 3)} [${f(s.ciLo, 2)}, ${f(s.ciHi, 2)}] | ${f(s.netStressR, 3)} | ${f(s.maeP90R, 2)} | ${f(s.usdt.total, 1)} | ${f(s.usdt.worst, 2)} | ${f(s.usdt.maxDD, 1)} | ${f(s.usdt.worstDay, 1)} / ${s.usdt.daysOverLimit} |`;
  return [`### A급 확정형 vs B급 공격형 과거 데이터 비교 (${meta.note ?? ''})`, `종목 ${r.coins}개 · 평가 기간 약 ${r.days.toFixed(0)}일 · 비용 왕복 ${SBT.costBps}bp(민감도 ${SBT.stressBps}bp) · 보유 최대 ${SBT.horizon15 / 4}시간 · 금액 = 순손익비 × 건당 손실 한도(A급 3~4.5 USDT, B급 1.5 USDT)`, '',
    '| 전략 | 건수 | 건/종목/일 | 목표/손절/미결정 | 계획 손익비 | 평균 순손익비 [95% CI] | 30bp | MAE p90(R) | 합계 USDT | 최악 1건 USDT | 최대 낙폭 USDT | 최악의 하루 USDT / 한도(−9) 초과 일수 |', '|---|---|---|---|---|---|---|---|---|---|---|---|',
    row('A급 확정형 단독(기존 S)', r.streams.A), row('B급 공격형 단독', r.streams.B), row('이중 운용 합계(A 우선)', r.streams.DUAL), row('  └ 이중 운용 중 A급', r.split.DUAL_A), row('  └ 이중 운용 중 B급', r.split.DUAL_B), row('B급 중 4시간 안에 A급이 뒤따르지 않은 건', r.split.B_not_followed_by_A), row('대조: B급 구간 시험만(확인 조건 제외)', r.streams.BCTL), '',
    `**판정: ${r.verdict.text}**`, ...r.verdict.notes.map(x => `- ${x}`)].join('\n');
}
