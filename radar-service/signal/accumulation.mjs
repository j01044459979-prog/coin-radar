// Experimental consolidation/accumulation-proxy watch. No orders, no entry signal, no whale inference.
// Uses confirmed OKX 1H candles already collected by signalStep. Funding/open interest unavailable.
import { H1 } from '../opportunity/indicators.mjs';
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
