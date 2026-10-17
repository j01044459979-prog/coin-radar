// 실시간(운영 데이터) 듀얼 평가: 확정 1시간봉 배열을 받아 가장 최근 마감 봉 기준으로 A·B·결합 판정을 만든다. 백테스트와 같은 함수(scoreA/scoreB/classify)를 쓴다.
import { seriesA, scoreA, planA, WARMUP_A } from './strategyA.mjs';
import { seriesB, scoreB, seriesBtc, btcContext, WARMUP_B } from './strategyB.mjs';
import { classify, marketGate, DUAL_RULES } from './combine.mjs';

export const MIN_CANDLES = Math.max(WARMUP_A, WARMUP_B) + 5;
const H = 3600000;

// candles: [{t,o,h,l,c,q}] 오래된 순, 확정봉만. 연속성·최신성(마지막 확정봉이 직전 마감봉)을 확인한다.
export function validate1H(candles, now) {
  if (!Array.isArray(candles) || candles.length < MIN_CANDLES) return `1시간봉 ${candles?.length ?? 0}개 < 필요 ${MIN_CANDLES}개`;
  for (let i = 1; i < candles.length; i++) if (candles[i].t - candles[i - 1].t !== H) return '1시간봉 누락';
  const expected = Math.floor(now / H) * H - H;                 // 가장 최근 마감 봉의 시작 시각
  const last = candles.at(-1).t;
  if (last !== expected && !(last === expected - H && now - (expected + H) < 90000)) return `1시간봉 지연(마지막 ${new Date(last).toISOString()})`;
  return null;
}

const norm = c => (Array.isArray(c) ? c.map(x => ({ t: x.t, o: x.o, h: x.h, l: x.l, c: x.c, q: Number.isFinite(x.q) ? x.q : 0 })) : c);

export function evaluateDual({ candlesBySymbol: raw, now, rules = DUAL_RULES }) {
  const candlesBySymbol = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, norm(v)]));
  const btc = candlesBySymbol.BTCUSDT;
  const btcErr = validate1H(btc, now);
  const sBtc = btcErr ? null : seriesBtc(btc);
  const ctx = btcErr ? { usable: false } : btcContext(btc, sBtc, btc.length - 1);
  const gate = marketGate(ctx);
  const items = [], skipped = [];
  for (const [symbol, c] of Object.entries(candlesBySymbol)) {
    const err = validate1H(c, now);
    if (err) { skipped.push({ symbol, reason: err }); continue; }
    const i = c.length - 1, a = scoreA(c, seriesA(c), i);
    // BTC 자체는 '시장 필터' 기준이므로 BTC 종목의 B 평가에서는 자기 자신을 맥락으로 쓴다(데이터 일관성)
    const b = scoreB(c, seriesB(c), i, symbol === 'BTCUSDT' ? ctx : ctx);
    const cls = classify(a, b, gate, rules);
    const barT = c[i].t, plan = pickPlan(cls, a, b, c[i].c, c, i);
    items.push({ symbol, a, b, cls, plan, signalBarT: barT, dataAsOf: barT + H, price: c[i].c });
  }
  const dataAsOf = ctx.usable || btc?.length ? btc.at(-1).t + H : null;
  return { items, skipped, gate, btc: ctx, dataAsOf, evaluated: items.length, rules };
}

// 보고에 보여줄 계획: 우선 후보는 B(구조 기반) 계획, 관심은 해당 전략의 계획
export function pickPlan(cls, a, b, ref, c, i) {
  if (cls.verdict === 'PRIORITY') return b.plan ? { ...b.plan, source: 'B' } : null;
  if (cls.verdict !== 'INTEREST') return null;
  if (cls.reason.startsWith('A')) { const p = planA(c, a, ref); return p ? { ...p, source: 'A' } : null; }
  return b.plan ? { ...b.plan, source: 'B' } : null;
}
