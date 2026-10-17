// 연구 하네스: 기간 분리(개발/검증/최종/이미 본 구간) · 시점별 유동성 유니버스 · 가설 H1/H2/H3 독립 변형 · 비용 스트레스 · 거래 불변식 점검.
// 규칙·임계값은 어디에서도 최적화하지 않는다. H3의 허용 국면만 '개발 구간 결과'에서 사전 정의된 규칙으로 도출한다(아래 allowlist).
import { runSymbol, regimeOf, COSTS, ENGINE } from './engine.mjs';
import { legacyProxy, randomBaseline, dualStrategies, restrictRegime } from './strategies.mjs';
import { summary } from './stats.mjs';

export const H = 3600000, DAY = 24 * H;
export const periodDefs = btcStart => ({
  dev: { from: btcStart + 30 * DAY, to: Date.UTC(2024, 9, 17), label: '개발(탐색 허용)' },
  val: { from: Date.UTC(2024, 9, 17), to: Date.UTC(2025, 3, 17), label: '검증' },
  final: { from: Date.UTC(2025, 3, 17), to: Date.UTC(2025, 9, 17), label: '최종 테스트(규칙 고정 후 1회)' },
  seen: { from: Date.UTC(2025, 9, 17), to: Infinity, label: '이미 결과를 본 구간(참고)' },
});
export const UNIVERSE_N = 20, LIQ_WINDOW = 30 * DAY;
export const EMBARGO = 48 * H;   // 구간 경계 직후 48시간(최대 보유 기간)은 진입 제외(엠바고) — 경계를 가로지르는 거래는 purge로 제외

const toC = rows => rows.map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], q: r[5] }));

// 데이터 준비: 연속성 점검, 간극에서 분할(분할된 조각은 워밍업을 다시 거친다)
export function prepare(dataset) {
  const gaps = [], segs = [];
  for (const [id, rows] of Object.entries(dataset.candles)) {
    const c = toC(rows), base = id.replace('-USDT-SWAP', '');
    if (!c.length) continue;
    if (c.some(x => x.t % H !== 0 || !(x.h >= Math.max(x.o, x.c, x.l)) || !(x.l <= Math.min(x.o, x.c)) || !(x.l > 0) || x.q < 0)) throw new Error(`${id}: 캔들 정렬/가격 오류(시각이 정시가 아니거나 OHLC 범위 이상)`);
    let cur = [c[0]], n = 0;
    const flush = () => { if (cur.length >= ENGINE.warmup + 100) segs.push({ base, id, c: cur, name: n ? `${base}#${n + 1}` : base }); n++; };
    for (let i = 1; i < c.length; i++) {
      if (c[i].t - c[i - 1].t !== H) { gaps.push({ id, at: c[i - 1].t, missingBars: (c[i].t - c[i - 1].t) / H - 1 }); flush(); cur = []; }
      cur.push(c[i]);
    }
    flush();
  }
  const btcSegs = segs.filter(s => s.base === 'BTC');
  if (btcSegs.length !== 1) throw new Error(`BTC 데이터에 간극 ${btcSegs.length - 1}곳 — 연구 중단(BTC 맥락이 끊김)`);
  const btc = btcSegs[0].c, btcIdx = new Map(btc.map((x, i) => [x.t, i]));
  return { btc, btcIdx, segs, gaps, specs: dataset.specs ?? {}, meta: dataset.meta ?? {} };
}

// 시점별 유동성 유니버스: 기간 시작 직전 30일 거래대금 합 상위 N (그 시점에 상장되어 있던 종목만). 생존 편향은 '현재 거래되는 종목만 수집'이라 완전히 제거되지 않는다.
export function universeFor(prep, from, n = UNIVERSE_N) {
  const score = new Map();
  for (const s of prep.segs) { let sum = 0, bars = 0; for (const x of s.c) if (x.t >= from - LIQ_WINDOW && x.t < from) { sum += x.q; bars++; } if (bars >= 600) score.set(s.base, (score.get(s.base) || 0) + sum); }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
  return new Set(ranked.includes('BTC') ? ranked : ['BTC', ...ranked.slice(0, n - 1)]);   // BTC는 시장 맥락용으로 항상 포함
}

// 허용 국면 규칙(사전 정의): 개발 구간에서 거래 수 ≥ 30이고 비용 반영 평균 R > 0인 국면만 허용. 해당 국면이 없으면 전략 비활성(0건).
export function allowlist(devTrades, minN = 30) {
  const out = new Set(), table = {};
  for (const rg of ['상승장', '하락장', '횡보장']) { const t = devTrades.filter(x => x.regime === rg), s = summary(t); table[rg] = { n: s.n, avg: s.avg ?? null }; if (s.n >= minN && s.avg > 0) out.add(rg); }
  return { allowed: out, table };
}

export const VARIANTS = {
  base: ['legacy1', 'legacy2', 'A', 'B', 'AB', 'random'],
  diag: ['Araw', 'Braw'],
  h1: ['B_H1', 'AB_H1'],          // B에서 재테스트 완료 필수(단일 변경)
  h2: ['A_H2', 'AB_H2'],          // A에서 Supertrend 전환 후 36봉 초과 진입 금지(단일 변경, 사전 등록값)
  h2x: ['A_H2x12', 'AB_H2x12'],   // 탐색용 민감도(12봉) — 가설 검정이 아니라 기록용
  h3: ['A_H3', 'B_H3', 'AB_H3', 'random_H3_A', 'random_H3_B', 'random_H3_AB'],
};
export const H2_MAX_AGE = 35;     // 전환 후 36번째 봉(age 0부터) 이후 차단: age > 35
export const H2X_MAX_AGE = 11;

export function runResearch(dataset, { periods = ['dev', 'val', 'seen'], final = false, costMults = [1], universeN = UNIVERSE_N, includeDiag = true, onSegment = null } = {}) {
  const prep = prepare(dataset), PER = periodDefs(prep.btc[0].t), active = [...periods, ...(final ? ['final'] : [])];
  const uni = Object.fromEntries(active.map(p => [p, universeFor(prep, PER[p].from, universeN)]));
  const regimeAt = t => regimeOf(prep.btc, prep.btcIdx.get(t) ?? -1);
  const result = { prep: { gaps: prep.gaps, bars: prep.btc.length, from: prep.btc[0].t, to: prep.btc.at(-1).t, symbols: prep.segs.length }, periods: PER, universe: Object.fromEntries(active.map(p => [p, [...uni[p]]])), trades: {}, audit: { skipped: {} }, active, evaluated: 0, joint: {} };
  const push = (mult, p, v, list) => { ((result.trades[mult] ||= {})[p] ||= {})[v] ||= []; for (const t of list) result.trades[mult][p][v].push(t); };
  const costsOf = mult => ({ ...COSTS, feePerSide: COSTS.feePerSide * mult, slipPerSide: COSTS.slipPerSide * mult, fundingPer8h: COSTS.fundingPer8h * mult });
  const exec = (seg, inst, mult, p, v, fns) => {
    const costs = costsOf(mult);
    for (const fn of fns) {
      const tr = runSymbol(seg.c, fn, { costs, from: PER[p].from + (p === 'dev' ? 0 : EMBARGO), to: PER[p].to, inst, stats: mult === 1 ? result.audit.skipped : {} });
      push(mult, p, v, tr.map(t => ({ ...t, symbol: seg.base, seg: seg.name, period: p, regime: regimeAt(t.t), variant: v })));
      result.evaluated++;
    }
  };
  const mkFns = (seg, base) => {
    const h1 = base.variant({ B: { requireRetest: true } }), h2 = base.variant({ A: { maxAge: H2_MAX_AGE } }), h2x = base.variant({ A: { maxAge: H2X_MAX_AGE } });
    const seed = [...seg.name].reduce((a, ch) => a + ch.charCodeAt(0), 7);
    return {
      legacy1: [legacyProxy(seg.c, prep.btc, prep.btcIdx, 1)], legacy2: [legacyProxy(seg.c, prep.btc, prep.btcIdx, 2)],
      A: [base.A], B: [base.B], AB: [base.AB], Araw: [base.Araw], Braw: [base.Braw],
      B_H1: [h1.B], AB_H1: [h1.AB], A_H2: [h2.A], AB_H2: [h2.AB], A_H2x12: [h2x.A], AB_H2x12: [h2x.AB],
      random: [0, 1, 2].map(k => randomBaseline(seg.c, 1000 + seed * 31 + k * 17)),
    };
  };
  const names = [...VARIANTS.base, ...(includeDiag ? VARIANTS.diag : []), ...VARIANTS.h1, ...VARIANTS.h2, ...VARIANTS.h2x];
  // 1단계: 세그먼트별로 점수를 한 번 계산(메모리 절약을 위해 세그먼트가 끝나면 버린다)하고 모든 기본·가설 변형을 실행
  for (const seg of prep.segs) {
    if (!active.some(p => uni[p].has(seg.base))) continue;
    const inst = prep.specs[seg.id] ?? null, base = dualStrategies(seg.c, prep.btc, prep.btcIdx), fns = mkFns(seg, base);
    for (const mult of costMults) for (const p of active) { if (!uni[p].has(seg.base)) continue; for (const v of names) exec(seg, inst, mult, p, v, fns[v]); }
    if (onSegment) onSegment(seg, base, { uni, PER, active, result });
  }
  // 2단계(H3): 개발 구간 결과로 허용 국면을 도출한 뒤 모든 구간에 적용. 개발 구간 자체의 H3 결과는 표본 내(in-sample)다.
  if (active.includes('dev')) {
    const dev = result.trades[1].dev;
    result.allow = { A: allowlist(dev.A), B: allowlist(dev.B), AB: allowlist(dev.AB) };
    for (const seg of prep.segs) {
      if (!active.some(p => uni[p].has(seg.base))) continue;
      const inst = prep.specs[seg.id] ?? null, base = dualStrategies(seg.c, prep.btc, prep.btcIdx), fns = mkFns(seg, base);
      for (const mult of costMults) for (const p of active) {
        if (!uni[p].has(seg.base)) continue;
        for (const k of ['A', 'B', 'AB']) {
          const set = result.allow[k].allowed;
          exec(seg, inst, mult, p, `${k}_H3`, fns[k].map(fn => restrictRegime(fn, set, regimeAt, seg.c)));
          exec(seg, inst, mult, p, `random_H3_${k}`, fns.random.map(fn => restrictRegime(fn, set, regimeAt, seg.c)));
        }
      }
    }
  }
  result.prepObj = prep;
  return result;
}

// 거래 불변식 점검: 체결 시점·방향·가격 범위·비용 부호. 위반 목록을 반환한다(0건이어야 함).
export function auditTrades(prep, trades) {
  const byName = new Map(prep.segs.map(s => [s.base, s]));
  const bad = []; const idx = new Map();
  for (const t of trades) {
    const seg = prep.segs.find(s => s.base === t.symbol && t.t >= s.c[0].t && t.t <= s.c.at(-1).t);
    if (!seg) { bad.push([t, '구간 없음']); continue; }
    let m = idx.get(seg); if (!m) { m = new Map(seg.c.map((x, i) => [x.t, i])); idx.set(seg, m); }
    const i = m.get(t.t), c = seg.c, d = t.dir === 'LONG' ? 1 : -1;
    if (i === undefined) { bad.push([t, '신호 봉 없음']); continue; }
    if (t.tEntry !== c[i + 1]?.t) bad.push([t, '진입이 다음 봉이 아님']);
    if (!(t.tExit >= t.tEntry)) bad.push([t, '청산이 진입보다 빠름']);
    if (!((t.entry - t.stop) * d > 0 && (t.tp - t.entry) * d > 0)) bad.push([t, '손절/목표 방향 이상']);
    if (!(t.rNet <= t.rGross + 1e-9)) bad.push([t, '비용이 이익을 늘림']);
    const e = c[m.get(t.tEntry)];
    if (e && Math.abs(t.entry - e.o * (1 + d * COSTS.slipPerSide)) > e.o * 0.002) bad.push([t, '진입가가 다음 봉 시가+슬리피지와 다름']);
    const x = c[m.get(t.tExit)];
    if (x && t.reason === 'tp' && !(d === 1 ? x.h >= t.tp : x.l <= t.tp)) bad.push([t, '목표 체결인데 봉 범위에 목표가 없음']);
    if (x && t.reason === 'stop' && !(d === 1 ? x.l <= t.stop || x.o <= t.stop : x.h >= t.stop || x.o >= t.stop)) bad.push([t, '손절 체결인데 봉 범위에 손절가 없음']);
    if (t.reason === 'tp' && t.mfeR < (t.tp - t.entry) * d / ((t.entry - t.stop) * d) - 1e-9) bad.push([t, 'MFE가 목표 거리보다 작음']);
  }
  return bad;
}
