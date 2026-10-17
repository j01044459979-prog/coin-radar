// 백테스트용 전략 함수 묶음. 모든 전략은 같은 캔들·같은 비용 모델·같은 체결 규칙(engine.mjs)으로 평가된다.
import { seriesA, scoreA, planA } from '../dual/strategyA.mjs';
import { seriesB, scoreB, seriesBtc, btcContext } from '../dual/strategyB.mjs';
import { classify, marketGate, DUAL_RULES } from '../dual/combine.mjs';
import { priorHigh, priorLow, avgQuote, atr as atrSeries } from '../dual/indicators.mjs';

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

// 기존(2.x) 전략의 1시간봉 근사 — 가격·거래량 성분만 재현(OI·펀딩은 과거 데이터가 없어 제외). 실제 운영 전략과 동일하지 않다.
//  돌파: 직전 20봉 고(저)점 종가 돌파 + 단순평균 12/48 추세 일치 · 강한 조건: 거래대금 2배 + 레벨 1 ATR 이내 · BTC 1시간 변동 ±0.5% 역행 제외
//  손절: min(레벨−1ATR, 12봉 스윙∓0.1ATR) · 목표: tpR(기존 TP1=1R, TP2=2R)
export function legacyProxy(c, btc, btcIdx, tpR) {
  return i => {
    if (i < 60) return null;
    const hi = priorHigh(c, i, 20), lo = priorLow(c, i, 20);
    const fast = mean(c.slice(i - 11, i + 1).map(x => x.c)), slow = mean(c.slice(i - 47, i + 1).map(x => x.c));
    const base = avgQuote(c, i, 20), vol = base > 0 ? c[i].q / base : 0;
    const atr = mean(c.slice(i - 13, i + 1).map((x, k) => { const p = c[i - 14 + k].c; return Math.max(x.h - x.l, Math.abs(x.h - p), Math.abs(x.l - p)); }));
    let dir = null;
    if (c[i].c > hi && fast > slow) dir = 'LONG'; else if (c[i].c < lo && fast < slow) dir = 'SHORT';
    if (!dir || vol < 2 || !(atr > 0)) return null;
    const level = dir === 'LONG' ? hi : lo;
    if (Math.abs(c[i].c - level) > atr) return null;
    const j = btcIdx.get(c[i].t);
    if (j === undefined || j < 1) return null;
    const bch = (btc[j].c / btc[j - 1].c - 1) * 100;
    if ((dir === 'LONG' && bch < -0.5) || (dir === 'SHORT' && bch > 0.5)) return null;
    const swing = c.slice(i - 11, i + 1), d = dir === 'LONG' ? 1 : -1;
    const entry = c[i].c, stop = dir === 'LONG' ? Math.min(level - atr, Math.min(...swing.map(x => x.l)) - 0.1 * atr) : Math.max(level + atr, Math.max(...swing.map(x => x.h)) + 0.1 * atr);
    const r = (entry - stop) * d;
    if (!(r > 0) || r / entry > 0.08) return null;
    return { dir, stop, tp: entry + d * tpR * r, meta: { strategy: `legacy${tpR}R` } };
  };
}

// 무작위 진입(비교 기준선): 방향·시점을 무작위로, 손절 1.5 ATR · 목표 3 ATR(2R). 전략에 '엣지'가 있는지 비용 구조만 반영한 기준선과 비교하기 위함.
export function randomBaseline(c, seed, prob = 0.004) {
  const a = atrSeries(c, 14); let x = seed >>> 0; const rnd = () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296;
  return i => {
    if (!Number.isFinite(a[i]) || rnd() > prob) return null;
    const dir = rnd() < 0.5 ? 'LONG' : 'SHORT', d = dir === 'LONG' ? 1 : -1, e = c[i].c;
    return { dir, stop: e - d * 1.5 * a[i], tp: e + d * 3 * a[i], meta: { strategy: 'random' } };
  };
}

// A, B, A+B 전략 함수 생성. 동일 신호 계산을 공유한다(신호는 i 마감 후 0..i 데이터만 사용).
export function dualStrategies(c, btc, btcIdx, rules = DUAL_RULES) {
  const sA = seriesA(c), sB = seriesB(c), sBtc = seriesBtc(btc);
  const cache = new Map();
  const evalAt = i => {
    if (cache.has(i)) return cache.get(i);
    const j = btcIdx.get(c[i].t), ctx = j === undefined ? { usable: false } : btcContext(btc, sBtc, j);
    const a = scoreA(c, sA, i), b = scoreB(c, sB, i, ctx), gate = marketGate(ctx);
    const out = { a, b, ctx, gate, cls: classify(a, b, gate, rules) };
    cache.set(i, out); return out;
  };
  const wrap = (pick) => i => { const e = evalAt(i); return pick(e, i); };
  return {
    evalAt,
    A: wrap((e, i) => { if (!e.a.dir || e.a.score < rules.priorityMin) return null; const p = planA(c, e.a, c[i].c); return p ? { dir: p.dir, stop: p.stop, tp: p.tp, meta: { strategy: 'A', scoreA: e.a.score } } : null; }),
    B: wrap(e => { if (!e.b.dir || e.b.score < rules.priorityMin || e.b.blockers.length || !e.b.plan) return null; return { dir: e.b.dir, stop: e.b.plan.stop, tp: e.b.plan.tp, meta: { strategy: 'B', scoreB: e.b.score } }; }),
    AB: wrap(e => { if (e.cls.verdict !== 'PRIORITY' || !e.b.plan) return null; return { dir: e.cls.dir, stop: e.b.plan.stop, tp: e.b.plan.tp, meta: { strategy: 'A+B', scoreA: e.a.score, scoreB: e.b.score } }; }),
  };
}
