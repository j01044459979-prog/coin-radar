// 4.0 연구 전략: 선별형 추세 + 눌림목. 규칙·임계값은 docs/TREND-PULLBACK-4-0-PREREG.md에 결과를 보기 전에 고정했다(여기서 바꾸지 않는다).
// 4시간봉(마감된 봉만)으로 추세 방향을, 1시간봉으로 지지·저항 구간의 눌림목 + 재진입 확인을 본다.
// 인기 지표(Supertrend·RSI·MACD)는 진입 조건에 쓰지 않고 meta.ref에 '참고 분석용'으로만 기록한다. 연구 전용 — 운영 레이더와 연결되어 있지 않다.
import { ema, atr, aggregate, avgQuote, priorHigh, priorLow, supertrend, rsi, macd } from './indicators.mjs';

export const TP4 = Object.freeze({
  pivotK: 3, swingLookback4h: 60, flipLookback4h: 20, resLookback4h: 120, zoneHalfAtr4h: 0.3,
  pullbackBars: 12, chaseAtr4h: 1.0, maxRangeAtr1h: 2.0, stopBufAtr1h: 0.5, stopMinAtr1h: 1.0, stopMaxAtr1h: 3.5,
  rr: 2.0, volConfirm: 1.2, volPullbackMax: 1.0, volBase: 20, res1hBars: 72, resMarginAtr1h: 0.1,
});
const H = 3600000, H4 = 4 * H;

// 4H 시리즈: 집계 · EMA · ATR · 스윙 피벗 · '1H 인덱스 → 그 시점까지 마감된 마지막 4H 인덱스'
export function trendSeries(c, P = TP4) {
  const c4 = aggregate(c), closes = c4.map(x => x.c), e50 = ema(closes, 50), e200 = ema(closes, 200), a4 = atr(c4, 14), K = P.pivotK;
  const ph = [], pl = [];
  for (let p = K; p < c4.length - K; p++) {
    let isH = true, isL = true;
    for (let j = 1; j <= K; j++) {
      if (!(c4[p].h > c4[p - j].h) || !(c4[p].h >= c4[p + j].h)) isH = false;
      if (!(c4[p].l < c4[p - j].l) || !(c4[p].l <= c4[p + j].l)) isL = false;
    }
    if (isH) ph.push(p); if (isL) pl.push(p);
  }
  const doneAt = new Int32Array(c.length).fill(-1); let k = -1;
  for (let i = 0; i < c.length; i++) { while (k + 1 < c4.length && c4[k + 1].t + H4 <= c[i].t + H) k++; doneAt[i] = k; }
  return { c4, e50, e200, a4, ph, pl, doneAt };
}
const countUpTo = (list, maxP) => { let lo = 0, hi = list.length; while (lo < hi) { const m = (lo + hi) >> 1; if (list[m] <= maxP) lo = m + 1; else hi = m; } return lo; };

// 4H 추세: 'UP' | 'DOWN' | null. 확정 피벗(우측 3봉이 지난 것)만 사용한다.
export function trendAt(T, d, P = TP4) {
  if (d < 0 || !Number.isFinite(T.e200[d]) || !Number.isFinite(T.e50[d]) || !Number.isFinite(T.a4[d])) return null;
  const nh = countUpTo(T.ph, d - P.pivotK), nl = countUpTo(T.pl, d - P.pivotK);
  if (nh < 2 || nl < 2) return null;
  const hh = T.c4[T.ph[nh - 1]].h > T.c4[T.ph[nh - 2]].h, hl = T.c4[T.pl[nl - 1]].l > T.c4[T.pl[nl - 2]].l;
  const lh = T.c4[T.ph[nh - 1]].h < T.c4[T.ph[nh - 2]].h, ll = T.c4[T.pl[nl - 1]].l < T.c4[T.pl[nl - 2]].l;
  const cl = T.c4[d].c;
  if (T.e50[d] > T.e200[d] && cl > T.e200[d] && hh && hl) return 'UP';
  if (T.e50[d] < T.e200[d] && cl < T.e200[d] && lh && ll) return 'DOWN';
  return null;
}
// BTC 필터용: EMA 정렬만 본다(구조 조건 없음)
export function emaTrendAt(T, d) {
  if (d < 0 || !Number.isFinite(T.e200[d]) || !Number.isFinite(T.e50[d])) return null;
  const cl = T.c4[d].c;
  if (T.e50[d] > T.e200[d] && cl > T.e200[d]) return 'UP';
  if (T.e50[d] < T.e200[d] && cl < T.e200[d]) return 'DOWN';
  return null;
}

// 지지(롱)/저항(숏) 구간 후보. 롱: 최근 4H 스윙 저점 + 돌파로 지지 전환된 4H 스윙 고점. 숏은 대칭.
export function zonesAt(T, d, dir, P = TP4) {
  const L = dir === 'UP', hw = P.zoneHalfAtr4h * T.a4[d], out = [], c4 = T.c4;
  const nh = countUpTo(T.ph, d - P.pivotK), nl = countUpTo(T.pl, d - P.pivotK);
  const broken = (level, from) => { for (let q = from; q <= d; q++) if (L ? c4[q].c < level - hw : c4[q].c > level + hw) return true; return false; };
  const swings = L ? T.pl : T.ph, ns = L ? nl : nh;
  for (let n = ns - 1; n >= 0; n--) {
    const p = swings[n]; if (p < d - P.swingLookback4h) break;
    const level = L ? c4[p].l : c4[p].h;
    if (!broken(level, p + 1)) out.push({ lo: level - hw, hi: level + hw, level, type: '스윙', p });
  }
  const flips = L ? T.ph : T.pl, nf = L ? nh : nl;
  for (let n = nf - 1; n >= 0; n--) {
    const p = flips[n]; if (p < d - P.resLookback4h) break;
    const level = L ? c4[p].h : c4[p].l;
    let q = -1; for (let x = p + 1; x <= d; x++) if (L ? c4[x].c > level : c4[x].c < level) { q = x; break; }
    if (q < 0 || q < d - P.flipLookback4h) continue;
    if (!broken(level, q + 1)) out.push({ lo: level - hw, hi: level + hw, level, type: '돌파전환', p, q });
  }
  return out;
}

// 신호 봉 i(마감 완료) 기준 평가. 반환 null 또는 { dir, stop, tp, volOk, btcOk, meta }
export function makeStrategy4(c, btc, btcIdx, btcT, P = TP4) {
  const T = trendSeries(c, P), a1 = atr(c, 14);
  let ref = null;   // 참고 지표(진입 조건 아님) — 필요할 때만 계산
  const getRef = () => ref ||= { st: supertrend(c), rsi: rsi(c.map(x => x.c), 14), macd: macd(c.map(x => x.c)) };
  const cache = new Map();
  const evalAt = i => {
    if (cache.has(i)) return cache.get(i);
    const r = compute(i); cache.set(i, r); return r;
  };
  function compute(i) {
    const d = T.doneAt[i];
    if (i < P.pullbackBars + 1 || d < 0 || !Number.isFinite(a1[i])) return null;
    const tr = trendAt(T, d, P); if (!tr) return null;
    const L = tr === 'UP', s = L ? 1 : -1, x = c[i], pv = c[i - 1];
    if (L ? !(x.c > x.o && x.c > pv.c) : !(x.c < x.o && x.c < pv.c)) return null;                    // 재진입 확인 캔들
    if (x.h - x.l > P.maxRangeAtr1h * a1[i]) return null;                                              // 급등·급락 캔들 추격 제한
    const zones = zonesAt(T, d, tr, P); if (!zones.length) return null;
    const w0 = i - P.pullbackBars + 1;
    let extreme = L ? Infinity : -Infinity;
    for (let j = w0; j <= i; j++) extreme = L ? Math.min(extreme, c[j].l) : Math.max(extreme, c[j].h);
    const before = c[w0 - 1];
    let zone = null;
    for (const z of zones) {
      const touched = L ? extreme <= z.hi : extreme >= z.lo;
      const recovered = L ? x.c >= z.hi : x.c <= z.lo;
      if (!touched || !recovered) continue;
      let held = true; for (let j = w0; j <= i; j++) if (L ? c[j].c < z.lo : c[j].c > z.hi) { held = false; break; }
      if (!held || !(L ? before.c > z.hi : before.c < z.lo)) continue;
      if (!zone || (L ? z.hi > zone.hi : z.lo < zone.lo)) zone = z;
    }
    if (!zone) return null;
    if ((L ? x.c - zone.hi : zone.lo - x.c) > P.chaseAtr4h * T.a4[d]) return null;                    // 구간에서 너무 멀어진 추격 진입 제한
    const stop = L ? Math.min(extreme, zone.lo) - P.stopBufAtr1h * a1[i] : Math.max(extreme, zone.hi) + P.stopBufAtr1h * a1[i];
    const risk = (x.c - stop) * s, riskAtr = risk / a1[i];
    if (!(risk > 0) || riskAtr < P.stopMinAtr1h || riskAtr > P.stopMaxAtr1h) return null;             // 너무 좁거나 넓은 손절 제한
    const tp = x.c + s * P.rr * risk;
    // 실제 저항(롱)/지지(숏)까지의 공간: 가장 가까운 장애물이 목표보다 가까우면 거래 안 함
    const margin = P.resMarginAtr1h * a1[i], obst = [];
    const nh = countUpTo(T.ph, d - P.pivotK), nl = countUpTo(T.pl, d - P.pivotK), lst = L ? T.ph : T.pl, nn = L ? nh : nl;
    for (let n = nn - 1; n >= 0; n--) { const p = lst[n]; if (p < d - P.resLookback4h) break; const v = L ? T.c4[p].h : T.c4[p].l; if (L ? v > x.c + margin : v < x.c - margin) obst.push(v); }
    const rv = L ? Math.max(priorHigh(c, i, P.res1hBars), x.h) : Math.min(priorLow(c, i, P.res1hBars), x.l);
    if (L ? rv > x.c + margin : rv < x.c - margin) obst.push(rv);
    const nearest = obst.length ? (L ? Math.min(...obst) : Math.max(...obst)) : null;
    if (nearest !== null && (L ? nearest < tp : nearest > tp)) return null;
    // 거래량 확인(변형 B·D에서만 사용) — 신호 봉 거래대금과 눌림 구간 평균
    const base = avgQuote(c, i, P.volBase); let pbSum = 0; for (let j = w0; j < i; j++) pbSum += c[j].q;
    const pbAvg = i > w0 ? pbSum / (i - w0) : 0;
    const volOk = base > 0 && x.q >= P.volConfirm * base && pbAvg <= P.volPullbackMax * base;
    // BTC 4H 추세 일치(변형 C·D에서만 사용)
    const j = btcIdx.get(x.t), btcDir = j === undefined ? null : emaTrendAt(btcT, btcT.doneAt[j]);
    const btcOk = btcDir === tr;
    const R = getRef(), cd = (x.c > x.o) === L;
    const hist = R.macd.hist[i], histPrev = R.macd.hist[i - 1];
    return {
      dir: L ? 'LONG' : 'SHORT', stop, tp, volOk, btcOk,
      meta: {
        strategy: 'TP4', zoneType: zone.type, zoneLevel: zone.level, stopAtr: riskAtr, volOk, btcOk, btcDir,
        depthAtr4: ((L ? zone.hi - extreme : extreme - zone.lo) / T.a4[d]), roomR: nearest === null ? null : (L ? nearest - x.c : x.c - nearest) / risk,
        ref: {   // 참고 분석 전용(진입 조건 아님)
          stAgree: R.st.dir[i] === s, rsi: R.rsi[i], rsiAgree: L ? R.rsi[i] >= 50 : R.rsi[i] <= 50,
          macdAgree: (L ? hist > 0 : hist < 0), macdExpanding: Number.isFinite(histPrev) && (L ? hist > histPrev : hist < histPrev), candle: cd,
        },
      },
    };
  }
  const pick = f => i => { const r = evalAt(i); return r && f(r) ? { dir: r.dir, stop: r.stop, tp: r.tp, meta: r.meta } : null; };
  return {
    evalAt,
    A: pick(() => true), B: pick(r => r.volOk), C: pick(r => r.btcOk), D: pick(r => r.volOk && r.btcOk),
    trendDirAt: i => trendAt(T, T.doneAt[i], P),
    // 대조군: 4H 추세 방향으로 무작위 시점에 진입(눌림목 타이밍 효과를 분리). 손절 1.5·목표 3 ATR(1H)
    randomTrend: (seed, prob = 0.004) => {
      let x = seed >>> 0; const rnd = () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296;
      return i => {
        if (!Number.isFinite(a1[i]) || rnd() > prob) return null;
        const tr = trendAt(T, T.doneAt[i], P); if (!tr) return null;
        const s = tr === 'UP' ? 1 : -1, e = c[i].c;
        return { dir: tr === 'UP' ? 'LONG' : 'SHORT', stop: e - s * 1.5 * a1[i], tp: e + s * 3 * a1[i], meta: { strategy: 'randomTrend' } };
      };
    },
  };
}
