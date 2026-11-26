// 5분봉 상승 가속 모멘텀(LONG) 탐지: 이미 확정된 5분봉만 사용하는 순수 함수. 주문·장부 기록 없음.
//  · 상태: 검증 전에는 항상 '실험 관찰'(🟡 관심종목 관찰 · 미검증)로만 나간다. 진입 검토(🟢)로 승격하려면 validation.mjs 의 통과 기록과 RADAR_MOMENTUM_5M=on 이 모두 필요하다.
//  · 과도한 추격만 제한한다: 추세·가속·거래대금 조건을 만족해도 EMA20 이격이 크거나 30분 상승이 과하면 제외(제외 사유를 돌려준다).
//  · 임계값은 사전 지정이며(아래 MOM5) 홀드아웃 결과에 맞춰 조정하지 않는다. 성과 주장 없음.
import { ema, atr } from '../opportunity/indicators.mjs';
import { bold, escHtml, fmtPrice, htmlToPlain } from '../format.mjs';

export const M5 = 5 * 60000;
export const MOM5 = Object.freeze({
  minBars: 70, emaFast: 20, emaSlow: 50, atrBars: 14,
  accelBars: 3, minRecentPct: 0.45, accelRatio: 1.3, prevFloorPct: -0.1,       // 최근 15분 상승률 ≥ 0.45% 이고 직전 15분의 1.3배 이상(가속), 직전 구간이 크게 꺾이지 않았을 것
  volBars: 3, volBase: 20, volMult: 1.6,                                        // 최근 3봉 평균 거래대금이 직전 20봉 평균의 1.6배 이상
  closePos: 0.6,                                                                // 마지막 봉 종가가 봉 범위의 상위 40% 안
  maxExtAtr: 2.2, max30mPct: 4.0,                                               // 과도한 추격 제한: EMA20 이격 ≤ 2.2 ATR, 30분 상승 ≤ 4%
  stopLookback: 8, stopAtr: 0.5, maxRiskPct: 2.5, minRiskPct: 0.25,            // 손절: 최근 8봉 저점과 EMA20−0.5ATR 중 낮은 쪽, 위험폭 0.25~2.5%
  tpR: [1.5, 2.5], costPct: 0.20, maxAgeMs: 10 * 60000, validMs: 25 * 60000,    // 목표 1.5R·2.5R, 왕복 비용 0.20%, 신호 유효 25분
  cooldownMs: 3 * 3600000, maxPerDay: 7,
});
const positive = n => Number.isFinite(n) && n > 0;
const pct = (a, b) => (a / b - 1) * 100;

// 반환: { status: 'SIGNAL', ...세부 } 또는 { status: 'NONE', reason }. c5 는 오래된 순 확정 봉, c1h(선택)는 1시간 추세 확인용.
export function evaluateMomentum5m(c5, c1h, now, P = MOM5) {
  const none = reason => ({ status: 'NONE', reason });
  if (!Array.isArray(c5) || c5.length < P.minBars || !Number.isFinite(now)) return none('data');
  const last = c5.at(-1), closeT = last.t + M5;
  if (closeT > now) return none('unconfirmed');
  if (now - closeT > P.maxAgeMs) return none('stale');
  const closes = c5.map(b => b.c), e20 = ema(closes, P.emaFast), e50 = ema(closes, P.emaSlow), a = atr(c5, P.atrBars), n = c5.length - 1;
  const [E20, E50, A] = [e20[n], e50[n], a[n]];
  if (![E20, E50, A].every(positive)) return none('data');
  if (!(last.c > E20 && E20 > E50 && e20[n] > e20[n - 3])) return none('trend');
  if (Array.isArray(c1h) && c1h.length >= 55) { const e = ema(c1h.map(b => b.c), 50).at(-1); if (positive(e) && !(c1h.at(-1).c > e)) return none('trend-1h'); }
  const k = P.accelBars, recent = pct(closes[n], closes[n - k]), prev = pct(closes[n - k], closes[n - 2 * k]);
  if (!(recent >= P.minRecentPct && prev >= P.prevFloorPct && recent >= P.accelRatio * Math.max(prev, 0.05))) return none('accel');
  const qv = j => (Number.isFinite(c5[j].q) ? c5[j].q : null), avg = (from, to) => { let s = 0, m = 0; for (let j = from; j <= to; j++) { const v = qv(j); if (v !== null) { s += v; m++; } } return m >= Math.ceil((to - from + 1) / 2) ? s / m : null; };
  const vRecent = avg(n - P.volBars + 1, n), vBase = avg(n - P.volBars - P.volBase + 1, n - P.volBars);
  if (!(positive(vRecent) && positive(vBase) && vRecent >= P.volMult * vBase)) return none('volume');
  const range = last.h - last.l;
  if (!(last.c > last.o && range > 0 && (last.c - last.l) / range >= P.closePos)) return none('bar');
  const ext = (last.c - E20) / A, r30 = pct(closes[n], closes[n - 6]);
  if (ext > P.maxExtAtr) return none('chase-extension');
  if (r30 > P.max30mPct) return none('chase-30m');
  let lowN = Infinity; for (let j = n - P.stopLookback + 1; j <= n; j++) lowN = Math.min(lowN, c5[j].l);
  const entry = last.c, stop = Math.min(lowN, E20 - P.stopAtr * A), risk = entry - stop, riskPct = risk / entry * 100;
  if (!(stop > 0 && risk > 0)) return none('stop');
  if (riskPct > P.maxRiskPct) return none('risk-wide');
  if (riskPct < P.minRiskPct) return none('risk-tight');
  const cost = P.costPct / 100 * entry, tp = P.tpR.map(r => entry + r * risk), net = P.tpR.map(r => (r * risk - cost) / (risk + cost));
  return { status: 'SIGNAL', strategy: 'momentum-5m', dir: 'LONG', asOf: closeT, validUntil: closeT + P.validMs,
    entry, stop, riskPct, tp1: tp[0], tp2: tp[1], rr1: P.tpR[0], rr2: P.tpR[1], net1: net[0], net2: net[1],
    metrics: { recentPct: recent, prevPct: prev, volMult: vRecent / vBase, extAtr: ext, r30Pct: r30 } };
}

// 초기 탐색 우선순위(투자금 비율 아님): 상승 가속 35 · EMA 눌림목 35 · 매집 재지지 20 · 유동성 스윕 10.
export const LONG_PRIORITY = Object.freeze({ momentum: 0.35, ema: 0.35, accumulation: 0.2, sweep: 0.1 });
// 슬롯 total 개를 우선순위 비율로 나눈다(최대잔여법, 합계 보존).
export function allocateLongSlots(total, weights = LONG_PRIORITY) {
  const keys = Object.keys(weights), sum = keys.reduce((s, k) => s + weights[k], 0), raw = keys.map(k => total * weights[k] / sum), base = raw.map(Math.floor);
  let left = total - base.reduce((a, b) => a + b, 0);
  const ranked = raw.map((x, i) => [x - base[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of ranked) { if (left <= 0) break; base[i]++; left--; }
  return Object.fromEntries(keys.map((k, i) => [k, base[i]]));
}

export const momentumMode = (env = process.env) => { const v = String(env?.RADAR_MOMENTUM_5M ?? 'experimental').trim().toLowerCase(); return ['off', 'experimental', 'on'].includes(v) ? v : 'experimental'; };

const kst = ms => new Date(ms + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' ');
// 실험 관찰 메시지(🟡). 진입 기록 버튼 없음·RICH300 장부 기록 없음. 헤더는 관찰 통합(digest) 규칙과 호환된다.
export function momentumMessage(symbol, s, { btcLines = [] } = {}) {
  const base = String(symbol).replace(/USDT$/, ''), f = v => fmtPrice(v), r = x => x.toFixed(2), p = (a, b) => `${a >= b ? '+' : '−'}${Math.abs((a / b - 1) * 100).toFixed(1)}%`;
  const lines = [
    `🟡 ${bold('관심종목 관찰')} | ${bold(base)} ${bold('LONG')} · ${bold('실험(미검증)')}`,
    '📌 전략: 5분봉 상승 가속 모멘텀', '🧪 검증 전 실험 알림 · 진입 신호 아님 · 기록 버튼 없음',
    `⏱ 5분봉 확정 ${kst(s.asOf)} KST · 참고 유효 ~${kst(s.validUntil)} KST`,
    `📈 15분 +${r(s.metrics.recentPct)}% (직전 ${r(s.metrics.prevPct)}%) · 거래대금 ×${r(s.metrics.volMult)} · EMA20 이격 ${r(s.metrics.extAtr)}ATR`,
    `💰 참고 기준가 ${f(s.entry)} · 🛑 손절 기준 ${f(s.stop)} (−${r(s.riskPct)}%)`,
    `🎯 ${r(s.rr1)}R ${f(s.tp1)} (${p(s.tp1, s.entry)}) · ${r(s.rr2)}R ${f(s.tp2)} (${p(s.tp2, s.entry)})`,
    `⚖️ 비용 반영 손익비 ${r(s.net1)}R · ${r(s.net2)}R`,
    '⚠️ 과도한 추격 구간이면 제외됨 · 현재 호가를 확인하고 급등 추격 금지',
  ];
  if (btcLines.length) lines.push('', ...btcLines.map(l => escHtml(String(l))));
  const text = lines.join('\n');
  return { text, plain: htmlToPlain(text), html: true, kind: 'watch' };
}
