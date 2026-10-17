// 전략 A — 트레이딩뷰에서 널리 쓰이는 지표 조합(Supertrend · EMA 200 · RSI · MACD)을 규칙으로 옮긴 추세·모멘텀 전략.
// ⚠️ 이 이름은 '자주 쓰이는 지표'라는 뜻일 뿐, 트레이딩뷰의 인기 순위·공식 전략·검증된 수익률이 아니다. 점수는 승률이 아니라 조건 충족 점수다.
// 모든 값은 확정된 1시간봉만 사용하며 i번째 판단은 0..i번째 캔들만 참조한다(미래 데이터 없음).
import { ema, rsi, macd, supertrend } from './indicators.mjs';

export const A_SETTINGS = { supertrend: { period: 10, multiplier: 3 }, ema: 200, rsi: 14, macd: { fast: 12, slow: 26, signal: 9 }, timeframe: '1H' };
export const WARMUP_A = 260; // EMA200 + 여유
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// 시리즈를 한 번 계산해 두고(인과적) 각 i에서 읽는다 — 백테스트와 실시간이 같은 코드를 쓴다.
export function seriesA(c) {
  const closes = c.map(x => x.c);
  return { st: supertrend(c, A_SETTINGS.supertrend.period, A_SETTINGS.supertrend.multiplier), e200: ema(closes, A_SETTINGS.ema), rsi: rsi(closes, A_SETTINGS.rsi), macd: macd(closes, A_SETTINGS.macd.fast, A_SETTINGS.macd.slow, A_SETTINGS.macd.signal) };
}

export function scoreA(c, s, i) {
  const x = c[i], st = s.st, e = s.e200[i], r = s.rsi[i], h = s.macd.hist[i], hp = s.macd.hist[i - 1], ml = s.macd.line[i];
  if (i < WARMUP_A || ![e, r, h, hp, ml, st.dir[i], st.line[i]].every(Number.isFinite)) return { dir: null, score: 0, parts: {}, reasons: ['지표 계산에 필요한 캔들 부족'], settings: A_SETTINGS };
  const dir = st.dir[i] === 1 ? 'LONG' : 'SHORT', d = dir === 'LONG' ? 1 : -1;
  const parts = {}, reasons = [];
  // 1) Supertrend 30: 방향(기준) + 전환 후 경과 봉 수(신선도). 오래된 추세일수록 늦은 진입으로 감점
  const age = i - st.flip[i], fresh = age <= 3 ? 1 : age <= 12 ? 0.85 : age <= 36 ? 0.7 : 0.5;
  parts.supertrend = { score: Math.round(30 * fresh * 10) / 10, max: 30, note: `Supertrend(${A_SETTINGS.supertrend.period},${A_SETTINGS.supertrend.multiplier}) ${dir === 'LONG' ? '상승' : '하락'} ${age + 1}봉째` };
  // 2) EMA200 25: 가격이 EMA200의 같은 방향 쪽(20) + 최근 10봉 EMA200 기울기 일치(5)
  const side = (x.c - e) * d > 0, slope = (e - s.e200[i - 10]) * d > 0;
  parts.ema200 = { score: (side ? 20 : 0) + (slope && side ? 5 : 0), max: 25, note: `종가 ${side ? (dir === 'LONG' ? '위' : '아래') : '반대편'} EMA200 (${((x.c / e - 1) * 100).toFixed(2)}%)${slope ? ' · 기울기 일치' : ''}` };
  // 3) MACD 25: 히스토그램 방향(12) + 모멘텀 확대(8) + MACD선 0선 기준 일치(5)
  const histOk = h * d > 0, expanding = histOk && (h - hp) * d > 0, lineOk = ml * d > 0;
  parts.macd = { score: (histOk ? 12 : 0) + (expanding ? 8 : 0) + (lineOk ? 5 : 0), max: 25, note: `MACD(${A_SETTINGS.macd.fast},${A_SETTINGS.macd.slow},${A_SETTINGS.macd.signal}) 히스토그램 ${h >= 0 ? '+' : '-'}${expanding ? ' 확대' : ''}${lineOk ? ' · 0선 일치' : ''}` };
  // 4) RSI 20: 추세 방향의 건강한 모멘텀 구간이 만점, 과열(추격)·약세 구간은 감점
  const rr = dir === 'LONG' ? r : 100 - r; // 숏은 대칭
  const rsiPts = rr >= 50 && rr <= 68 ? 20 : rr > 68 && rr <= 75 ? 10 : rr >= 40 && rr < 50 ? 8 : 0;
  parts.rsi = { score: rsiPts, max: 20, note: `RSI(${A_SETTINGS.rsi}) ${r.toFixed(1)}${rr > 75 ? ' 과열' : rr > 68 ? ' 다소 과열' : rr < 40 ? ' 약세' : ''}` };
  const score = Math.round(Object.values(parts).reduce((a, p) => a + p.score, 0) * 10) / 10;
  reasons.push(...Object.values(parts).map(p => p.note));
  return { dir, score, parts, reasons, settings: A_SETTINGS, supertrendLine: st.line[i], atr: st.atr[i], age };
}

// 전략 A의 자체 손절·목표: 손절=Supertrend 라인(0.8~3 ATR 범위로 제한), 목표=2R. 진입 기준가 ref(보통 신호봉 종가)를 받는다.
export function planA(c, a, ref) {
  if (!a.dir || !(a.atr > 0)) return null;
  const d = a.dir === 'LONG' ? 1 : -1;
  const dist = clamp((ref - a.supertrendLine) * d, 0.8 * a.atr, 3 * a.atr);
  const stop = ref - d * dist;
  return { dir: a.dir, entry: ref, stop, tp: ref + d * 2 * dist, rr: 2, stopAtr: dist / a.atr, basis: 'Supertrend 라인(0.8~3 ATR 범위) 손절, 2R 목표' };
}
