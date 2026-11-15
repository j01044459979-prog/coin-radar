// Experimental consolidation/accumulation-proxy watch. No orders, no entry signal, no whale inference.
// Uses confirmed OKX 1H candles already collected by signalStep. Funding/open interest unavailable.
import { H1, atr } from '../opportunity/indicators.mjs';
import { SIG } from './evaluate.mjs';
import { btcContextLines } from './btc-context.mjs';
import { bold, fmtPrice, htmlToPlain } from '../format.mjs';

export const ACCUMULATION = Object.freeze({
  minBars: 70, boxBars: 24, minBoxPct: 0.8, maxBoxPct: 12,
  squeezeRatio: 0.94, minCmf: 0.07, minFlow: 0.03,
  nearHighPct: 2.5, minBreakPct: 0.1, maxBreakPct: 2.5, breakoutVol: 1.6,
  cooldownMs: 18 * H1, maxPerDay: 4, maxPerRun: 2,
});
const average = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const width = xs => { const mid = average(xs); return mid > 0 ? Math.sqrt(average(xs.map(v => (v - mid) ** 2))) / mid : null; };
const clean = bars => Array.isArray(bars) && bars.every((b, i) =>
  [b.t, b.o, b.h, b.l, b.c, b.q].every(Number.isFinite) &&
  b.c > 0 && b.q >= 0 && b.l > 0 && b.l <= Math.min(b.o, b.c) &&
  b.h >= Math.max(b.o, b.c) && (!i || b.t - bars[i - 1].t === H1));
const two = n => n.toFixed(2);
export function accumulationWatch(c1h, now, P = ACCUMULATION) {
  if (!Array.isArray(c1h) || c1h.length < P.minBars || !Number.isFinite(now)) return null;
  const cs = c1h.slice(-P.minBars);
  if (!clean(cs)) return null;
  const last = cs.at(-1), closeT = last.t + H1;
  if (closeT > now || now - closeT >= H1) return null; // no future/stale bars
  const box = cs.slice(-P.boxBars - 1, -1);
  const upper = Math.max(...box.map(b => b.h)), lower = Math.min(...box.map(b => b.l));
  const boxPct = (upper - lower) / ((upper + lower) / 2) * 100;
  if (!(boxPct >= P.minBoxPct && boxPct <= P.maxBoxPct)) return null;
  // Prior 20h vs recent 20h. The trigger bar cannot manufacture its own "squeeze".
  const older = cs.slice(-45, -25), recent = cs.slice(-25, -5);
  const oldW = width(older.map(b => b.c)), newW = width(recent.map(b => b.c));
  if (!(oldW > 0 && newW !== null && newW / oldW <= P.squeezeRatio)) return null;
  const squeeze = newW / oldW;
  // Quote-turnover-weighted CMF / OBV are imperfect activity proxies, not proof of accumulation.
  const pressure = cs.slice(-21);
  const vol = pressure.slice(1).map(b => b.q), total = vol.reduce((s, v) => s + v, 0);
  if (!(total > 0)) return null;
  let cmfSum = 0, flowSum = 0;
  for (let i = 1; i < pressure.length; i++) {
    const b = pressure[i], range = b.h - b.l;
    cmfSum += (range > 0 ? (2 * b.c - b.h - b.l) / range : 0) * b.q;
    flowSum += Math.sign(b.c - pressure[i - 1].c) * b.q;
  }
  const cmf = cmfSum / total, flow = flowSum / total;
  if (!(cmf >= P.minCmf && flow >= P.minFlow)) return null;
  const meanQ = average(box.slice(-20).map(b => b.q));
  if (!(meanQ > 0)) return null;
  const volMultiple = last.q / meanQ;
  const breakPct = (last.c / upper - 1) * 100;
  const upperWick = last.h - Math.max(last.c, last.o), candle = last.h - last.l;
  const breakout = breakPct >= P.minBreakPct && breakPct <= P.maxBreakPct &&
    volMultiple >= P.breakoutVol && last.c > last.o &&
    candle > 0 && upperWick / candle <= 0.35 && box.at(-1).c <= upper;
  const near = breakPct <= 0 && breakPct >= -P.nearHighPct &&
    volMultiple >= 0.75 && volMultiple < P.breakoutVol * 1.4;
  if (!breakout && !near) return null;
  const stage = breakout ? 'BREAKOUT' : 'WATCH';
  const score = Math.min(100, Math.round(
    25 * Math.max(0, Math.min(1, (1 - squeeze) / 0.5)) +
    25 * Math.max(0, Math.min(1, cmf / 0.25)) +
    20 * Math.max(0, Math.min(1, flow / 0.25)) +
    15 * Math.max(0, Math.min(1, volMultiple / (breakout ? 2 : 1.4))) +
    15 * (breakout ? 1 : Math.max(0, 1 - Math.abs(breakPct) / P.nearHighPct))
  ));
  if (score < 55) return null; // descriptive selection threshold, NOT win probability
  return { stage, score, upper, lower, boxPct, breakPct, squeeze,
    cmf, flow, volMultiple, asOf: closeT, close: last.c };
}
export const accumulationMode = env => {
  const x = String(env?.RADAR_ACCUMULATION_WATCH ?? 'off').trim().toLowerCase();
  return ['off', 'preview', 'on'].includes(x) ? x : 'off';
};
export function accumulationMessage(symbol, candidate, btc) {
  const x = candidate, stage = x.stage === 'BREAKOUT' ? '거래량 동반 돌파 관찰' : '박스권 상단 접근 관찰';
  const lines = [
    '🧭 [실험] ' + bold(String(symbol).replace(/USDT$/, '')) + ' · 매집 의심/변동성 압축',
    bold(stage) + ' · 조건점수 ' + x.score + '/100 (승률 아님)',
    '⏱ 1H 확정봉 ' + new Date(x.asOf + 9 * H1).toISOString().slice(11,16) + ' KST',
    '📦 박스 하단 ' + fmtPrice(x.lower) + ' · 상단 ' + fmtPrice(x.upper),
    '현재 확정 종가 ' + fmtPrice(x.close),
    '폭 ' + two(x.boxPct) + '% · 변동성 압축비 ' + two(x.squeeze),
    'CMF ' + two(x.cmf) + ' · 거래량 ×' + two(x.volMultiple),
    ...(x.stage === 'BREAKOUT' ? ['⚠️ 상단 돌파 확인 · 추격 진입 금지'] :
      ['👀 상단까지 ' + two(Math.max(0, -x.breakPct)) + '% · 돌파 전 대기']),
    '', ...btcContextLines(btc, symbol, 'LONG'), '',
    '※ 큰손 매집 여부는 확인 불가',
    '※ 실험적 관찰 알림 · 진입추천/주문 아님',
    '※ 수익성 미검증 · 가짜 돌파·급락 위험'
  ];
  const text = lines.join('\n');
  return { text, plain: htmlToPlain(text), html: true, kind: 'accumulation-watch' };
}


// Independent stage 3: confirmed 1H breakout retest. A recorded high-volume breakout is
// required first; stage 1 WATCH alone NEVER becomes an entry candidate.
// Deliberately no auto-orders, whale claim, or performance/edge assumption.
export const ACC_RETEST = Object.freeze({
  maxAgeMs: 18 * H1, touchPct: 0.6, holdPct: 0.08, invalidPct: 0.5,
  chasePct: 1.2, bufferAtr: 0.20, minRiskPct: 0.30, maxRiskPct: 4.5,
  cooldownMs: 48 * H1,
});
export function anchorOfBreakout(x) {
  if (!x || x.stage !== 'BREAKOUT' || ![x.asOf, x.upper, x.lower, x.close].every(Number.isFinite)) return null;
  return { status: 'watching', breakoutAt: x.asOf, upper: x.upper, lower: x.lower,
    breakoutClose: x.close, score: x.score };
}
export function accumulationRetest(c1h, anchor, now, P = ACC_RETEST) {
  if (!anchor || anchor.status !== 'watching' ||
    ![anchor.breakoutAt, anchor.upper, anchor.lower].every(Number.isFinite) ||
    !(anchor.upper > anchor.lower && anchor.lower > 0) || !Number.isFinite(now)) return null;
  if (!Array.isArray(c1h) || c1h.length < 25 || !clean(c1h.slice(-25))) return null;
  const last = c1h.at(-1), prior = c1h.at(-2), asOf = last.t + H1;
  // A later, fresh confirmed candle is mandatory; cannot retest inside the breakout candle.
  if (asOf <= anchor.breakoutAt || asOf > now || now - asOf >= H1) return null;
  if (asOf - anchor.breakoutAt > P.maxAgeMs) return { status: 'expired' };
  const after = c1h.filter(b => b.t + H1 > anchor.breakoutAt);
  if (!after.length || after.some(b => b.c < anchor.upper * (1 - P.invalidPct / 100)))
    return { status: 'invalidated' };
  if (last.l > anchor.upper * (1 + P.touchPct / 100) ||
      last.c < anchor.upper * (1 + P.holdPct / 100) ||
      last.c <= last.o || last.c <= prior.c ||
      (last.c / anchor.upper - 1) * 100 > P.chasePct) return null;
  const a1 = atr(c1h, 14).at(-1);
  if (!(a1 > 0)) return null;
  const entry = last.c;
  const stop = Math.min(last.l, anchor.upper) - P.bufferAtr * a1;
  const risk = entry - stop, riskPct = risk / entry * 100;
  if (!(stop > 0 && riskPct >= P.minRiskPct && riskPct <= P.maxRiskPct)) return null;
  const t1 = entry + 1.5 * risk, t2 = entry + 2 * risk;
  const costR = entry * SIG.costPct / 100 / risk;
  return { stage: 'RETEST', dir: 'LONG', asOf, breakoutAt: anchor.breakoutAt,
    upper: anchor.upper, lower: anchor.lower, entry, stop, t1, t2,
    riskPct, costPct: SIG.costPct, netR1: 1.5 - costR, netR2: 2 - costR,
    atr1: a1, retestLow: last.l, score: anchor.score ?? null };
}
export function accumulationRetestMessage(symbol, x, btc) {
  const f = fmtPrice, time = t => new Date(t + 9 * H1).toISOString().slice(5, 16).replace('T', ' ') + ' KST';
  const lines = [
    '🎯 [실험] ' + bold(symbol.replace(/USDT$/, '')) + ' · ' + bold('매집 3단계 진입 관심 후보'),
    '✅ 1H 돌파 → 재접촉 → 종가 상단 지지 확인',
    '⏱ 재지지 확정 ' + time(x.asOf),
    '📦 종전 박스 상단 ' + f(x.upper) + ' · 하단 ' + f(x.lower),
    '💰 진입 관심가 ' + f(x.entry) + ' (확정 종가)',
    '🛑 재지지 저점 기준 손절 ' + f(x.stop) + ' (' + x.riskPct.toFixed(2) + '%)',
    '🎯 1차 1.5R 가상 목표 ' + f(x.t1),
    '🎯 2차 2R 가상 목표 ' + f(x.t2),
    '⚖️ 비용 ' + x.costPct.toFixed(2) + '% 가정 후 ' +
      x.netR1.toFixed(2) + 'R / ' + x.netR2.toFixed(2) + 'R',
    '⚠️ 돌파선 하향 재이탈·손절가 이탈 시 재검토',
    '', ...btcContextLines(btc, symbol, 'LONG'), '',
    '※ 진입 관심 후보 · 현재 호가·실제 체결가 아님',
    '※ 수익성 미검증 · 가짜 돌파/급락/청산 위험',
    '※ 자동 주문 없음 · 매매일지 자동 등록 없음',
  ];
  const text = lines.join('\n');
  return { text, plain: htmlToPlain(text), html: true, kind: 'accumulation-retest' };
}
