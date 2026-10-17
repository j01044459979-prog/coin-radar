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

// 가설 변형(단일 변경점)을 이미 계산된 원시 점수 위에 적용한다 — 점수는 한 번만 계산하고 차단 사유만 추가하므로 변형 간 다른 점은 정확히 그 변경점뿐이다.
//  opts.A.maxAge(H2): Supertrend 전환 후 경과 봉 수(age) > maxAge 이면 A 신규 진입 차단 · opts.B.requireRetest(H1): 재테스트 미완료 B 신호 차단
export function applyOpts(a, b, opts = {}) {
  let a2 = a, b2 = b;
  if (Number.isFinite(opts.A?.maxAge) && a.dir && a.features && a.features.age > opts.A.maxAge) a2 = { ...a, blockers: [...(a.blockers ?? []), `오래된 추세(Supertrend 전환 후 ${a.features.age + 1}봉 > ${opts.A.maxAge + 1}봉)`] };
  if (opts.B?.requireRetest && b.dir && b.features && b.features.structureType !== 'retest') b2 = { ...b, blockers: [...b.blockers, '재테스트 미완료(필수 조건)'] };
  return [a2, b2];
}

// A, B, A+B 전략 함수 생성. 동일 신호 계산을 공유한다(신호는 i 마감 후 0..i 데이터만 사용).
// opts는 기본 변형에만 적용되고, variant(opts)로 같은 점수 캐시를 공유하는 다른 변형 묶음을 만들 수 있다.
export function dualStrategies(c, btc, btcIdx, rules = DUAL_RULES, opts = {}) {
  const sA = seriesA(c), sB = seriesB(c), sBtc = seriesBtc(btc);
  const raw = new Map();
  const rawAt = i => {
    if (raw.has(i)) return raw.get(i);
    const j = btcIdx.get(c[i].t), ctx = j === undefined ? { usable: false } : btcContext(btc, sBtc, j);
    const out = { a: scoreA(c, sA, i), b: scoreB(c, sB, i, ctx), ctx, gate: marketGate(ctx) };
    raw.set(i, out); return out;
  };
  const make = o => {
    const evalAt = i => { const r = rawAt(i), [a, b] = applyOpts(r.a, r.b, o); return { a, b, ctx: r.ctx, gate: r.gate, cls: classify(a, b, r.gate, rules) }; };
    const wrap = pick => i => pick(evalAt(i), i);
    const aSig = (e, i) => { const p = planA(c, e.a, c[i].c); return p ? { dir: p.dir, stop: p.stop, tp: p.tp } : null; };
    return {
      evalAt,
      A: wrap((e, i) => { if (!e.a.dir || e.a.score < rules.priorityMin || e.a.blockers?.length) return null; const p = aSig(e, i); return p ? { ...p, meta: { strategy: 'A', sa: e.a.score, fa: e.a.features } } : null; }),
      B: wrap(e => { if (!e.b.dir || e.b.score < rules.priorityMin || e.b.blockers.length || !e.b.plan) return null; return { dir: e.b.dir, stop: e.b.plan.stop, tp: e.b.plan.tp, meta: { strategy: 'B', sb: e.b.score, fb: e.b.features } }; }),
      AB: wrap(e => { if (e.cls.verdict !== 'PRIORITY' || !e.b.plan) return null; return { dir: e.cls.dir, stop: e.b.plan.stop, tp: e.b.plan.tp, meta: { strategy: 'A+B', sa: e.a.score, sb: e.b.score, fa: e.a.features, fb: e.b.features } }; }),
      // 진단용 원시 신호(임계값·차단 사유를 적용하기 전 후보): 점수 구간·차단 사유별 품질을 보려는 것이며 '전략'이 아니다.
      Araw: wrap((e, i) => { if (!e.a.dir || e.a.score < 50) return null; const p = aSig(e, i); return p ? { ...p, meta: { strategy: 'Araw', sa: e.a.score, fa: e.a.features } } : null; }),
      Braw: wrap(e => { if (!e.b.dir || e.b.score < 50 || !e.b.plan) return null; return { dir: e.b.dir, stop: e.b.plan.stop, tp: e.b.plan.tp, meta: { strategy: 'Braw', sb: e.b.score, fb: e.b.features, blockers: e.b.blockers } }; }),
    };
  };
  return { ...make(opts), variant: make, rawAt };
}

// 시장 국면 제한(H3): 신호 시점의 국면이 allowed에 없으면 신호를 버린다. regimeFn(t) → '상승장'|'하락장'|'횡보장'|null
export function restrictRegime(fn, allowed, regimeAt, c) {
  return i => { const r = regimeAt(c[i].t); if (!r || !allowed.has(r)) return null; return fn(i); };
}
