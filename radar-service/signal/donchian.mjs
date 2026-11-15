// Independent Donchian trend breakout watch on already-confirmed OKX 1H/4H candles.
// Live Telegram alerts, NOT exchange orders or RICH300 trade/entry records.
// Exploratory thresholds: no backtest or profitability claim.
import { atr, ema, H1, H4, priorHigh, priorLow } from '../opportunity/indicators.mjs';
import { bold, fmtPrice, htmlToPlain } from '../format.mjs';
import { SIG } from './evaluate.mjs';

export const DONCHIAN = Object.freeze({
  bars: 20, trendEma: 200, atrBars: 14, stopAtr: 2, chaseAtr: 1.2,
  watchAtr: 0.55, maxRiskPct: 8, entryAgeMs: 90 * 60000,
  watchCooldownMs: 12 * H1, breakoutCooldownMs: 48 * H1,
  maxPerRun: 2, maxPerDay: 12,
});
const positive = n => Number.isFinite(n) && n > 0;
const changePct = (value, basis) => ((value / basis) - 1) * 100;
const timeKst = ms => new Date(ms + 9 * H1).toISOString().slice(5, 16).replace('T', ' ');

export function evaluateDonchian(c1h, c4h, now, P = DONCHIAN) {
  if (!Number.isFinite(now) || !Array.isArray(c1h) || !Array.isArray(c4h) ||
      c1h.length < 25 || c4h.length < P.trendEma + 2) return null;
  const b4 = c4h.at(-1), b1 = c1h.at(-1);
  const close4 = b4.t + H4, close1 = b1.t + H1;
  if (close4 > now || close1 > now || now - close4 >= H4 ||
      now - close1 >= 2 * H1) return null;
  const upper = priorHigh(c4h, c4h.length - 1, P.bars);
  const lower = priorLow(c4h, c4h.length - 1, P.bars);
  const a4 = atr(c4h, P.atrBars).at(-1);
  const e200 = ema(c4h.map(b => b.c), P.trendEma).at(-1);
  if (![upper, lower, a4, e200].every(positive) || upper <= lower) return null;
  const longTrend = b4.c > e200;
  const shortTrend = b4.c < e200;
  const longBreak = longTrend && b4.c > upper && b4.c > b4.o;
  const shortBreak = shortTrend && b4.c < lower && b4.c < b4.o;
  const chaseLong = (b4.c - upper) / a4, chaseShort = (lower - b4.c) / a4;

  if (now - close4 <= P.entryAgeMs &&
      ((longBreak && chaseLong <= P.chaseAtr) || (shortBreak && chaseShort <= P.chaseAtr))) {
    const dir = longBreak ? 'LONG' : 'SHORT', sign = longBreak ? 1 : -1;
    const entry = b4.c, risk = P.stopAtr * a4;
    if (!(risk / entry * 100 <= P.maxRiskPct)) return null;
    const stop = entry - sign * risk;
    const t1 = entry + sign * 2.5 * risk, t2 = entry + sign * 4 * risk;
    if (![stop, t1, t2].every(positive)) return null;
    const earlier = c4h.slice(-21, -1).map(b => b.q).filter(positive);
    const avgVol = earlier.length >= 10 ? earlier.reduce((a, b) => a + b, 0) / earlier.length : null;
    const volRel = avgVol && positive(b4.q) ? b4.q / avgVol : null;
    return { stage: 'BREAKOUT', dir, entry, stop, t1, t2, riskPct: risk / entry * 100,
      costR: entry * SIG.costPct / 100 / risk, upper, lower, atr4: a4, ema200: e200,
      volRel, asOf: close4, score: Math.max(0, Math.min(100, Math.round(60 + 20 *
        ((longBreak ? chaseLong : chaseShort) / P.chaseAtr) +
        20 * Math.min(1, volRel ?? 0)))) };
  }
  // Earlier heads-up: near previous completed 4H channel on the latest confirmed 1H close.
  if (!longBreak && !shortBreak) {
    const distUp = (upper - b1.c) / a4, distDown = (b1.c - lower) / a4;
    const longNear = longTrend && distUp >= 0 && distUp <= P.watchAtr;
    const shortNear = shortTrend && distDown >= 0 && distDown <= P.watchAtr;
    if (longNear || shortNear) {
      return { stage: 'WATCH', dir: longNear ? 'LONG' : 'SHORT',
        upper, lower, atr4: a4, ema200: e200, entry: b1.c, asOf: close1,
        score: Math.round(50 + 40 * (1 - (longNear ? distUp : distDown) / P.watchAtr)) };
    }
  }
  return null;
}

export function donchianMessage(symbol, signal) {
  const s = signal, L = s.dir === 'LONG';
  const title = s.stage === 'BREAKOUT' ? '4H 확정 돌파 · 진입 관심 후보' : '1H 돌파 접근 · 사전 관찰';
  const lines = [
    (L ? '🟢 ' : '🔴 ') + bold(symbol.replace(/USDT$/, '')) + ' · ' + bold(s.dir),
    '📈 ' + bold('RICH 돈치안 추세 전략'),
    bold(title),
    '🕓 확정봉 ' + timeKst(s.asOf) + ' KST',
    '📦 4H 20봉 채널 ' + fmtPrice(s.lower) + ' ~ ' + fmtPrice(s.upper),
    '📊 4H EMA200 ' + fmtPrice(s.ema200),
  ];
  if (s.stage === 'BREAKOUT') {
    lines.push('💰 확정 종가(관심가) ' + fmtPrice(s.entry),
      '🛑 ATR 기준 손절 ' + fmtPrice(s.stop) + ' (' + s.riskPct.toFixed(2) + '%)',
      '🎯 2.5R 가상 목표 ' + fmtPrice(s.t1),
      '🎯 4R 가상 목표 ' + fmtPrice(s.t2),
      '⚖️ 비용 ' + SIG.costPct.toFixed(2) + '% 가정 시 2.5R ≈ ' + (2.5 - s.costR).toFixed(2) + 'R',
      '↗️ 추세 지속 시 2 ATR 트레일링 검토',
      ...(s.volRel ? ['📊 거래대금 직전 20봉 대비 ×' + s.volRel.toFixed(2)] : []),
      '⚠️ 돌파 후 추격 진입 금지 · 실시간 호가 재확인');
  } else {
    const boundary = L ? s.upper : s.lower;
    lines.push('현재 1H 확정 종가 ' + fmtPrice(s.entry),
      '👀 4H 돌파 확인 기준 ' + fmtPrice(boundary),
      '⚠️ 관찰 전용 · 아직 진입 조건 미완성');
  }
  lines.push('', '※ 신규 실험 전략 · 백테스트 생략 · 수익성 미검증',
    '※ 자동 주문 없음 · 수수료·펀딩비·슬리피지·급변동 위험');
  const text = lines.join('\n');
  return { text, plain: htmlToPlain(text), html: true, kind: 'donchian-watch' };
}
