// 기회 포착 레이더 분석(순수 함수): 4시간봉 추세 방향 + 1시간봉 지지·저항 접근/눌림/재진입 확인 + 참고 지표.
//
// 이것은 '관심 가질 만한 차트 조건'을 골라내는 점검표이며 수익이 검증된 매매 전략이 아니다.
// 연구(PR #26)에서 같은 조건 구조(4H 추세 + 1H 눌림목)는 사전 등록한 통과 기준을 넘지 못했다. 그래서 결과를 'LONG 관찰/SHORT 관찰/대기'로만 표현하고
// 점수(충족 개수)는 설명용으로만 쓴다. 승률·수익 확률·주문 가격을 만들지 않는다.
//
// 입력은 거래소가 '확정(confirm=1)'한 캔들만이어야 한다(수집 계층이 보장하고, 여기서도 시간 정합성을 다시 확인한다).
// 신호 봉 = 마지막 확정 1시간봉. 4시간봉은 그 1시간봉의 마감 시각까지 마감된 것만 쓴다.
import { atr, ema, avgQuote, priorHigh, priorLow, H1, H4 } from './indicators.mjs';
import { fmtPrice } from '../format.mjs';

export const OPP = Object.freeze({
  pivotK: 3, swingLookback4h: 60, flipLookback4h: 20, resLookback4h: 120, zoneHalfAtr4h: 0.3,
  pullbackBars: 12, approachAtr4h: 1.5, chaseAtr4h: 1.0, maxRangeAtr1h: 2.0, stopBufAtr1h: 0.5, stopMinAtr1h: 1.0, stopMaxAtr1h: 3.5,
  roomR: 2.0, res1hBars: 72, resMarginAtr1h: 0.1, volBase: 20,
  minBars1h: 100, minBars4h: 210,                       // 데이터가 이보다 적으면 분석하지 않는다(대기가 아니라 '데이터 부족')
  atrLowPct: 1.5, atrHighPct: 3.5,                       // 4H ATR/가격(%) 설명용 구간: 낮음 < 1.5 ≤ 보통 < 3.5 ≤ 높음
  chaseLowAtr4: 0.5,                                    // 구간 경계에서 이격(ATR 4H) ≤ 0.5 낮음, ≤ chaseAtr4h 보통, 초과 높음
});
export const STAGE = Object.freeze({ 0: '대기', 1: '구간 접근 중', 2: '눌림 진행 중', 3: '조건 충족' });
export const CHECK_TOTAL = 7;

const f2 = x => Number(x).toFixed(2);

// 4H 시리즈: EMA · ATR · 스윙 피벗(우측 3봉이 지나야 확정)
export function trendSeries(c4, P = OPP) {
  const closes = c4.map(x => x.c), K = P.pivotK, ph = [], pl = [];
  for (let p = K; p < c4.length - K; p++) {
    let isH = true, isL = true;
    for (let j = 1; j <= K; j++) {
      if (!(c4[p].h > c4[p - j].h) || !(c4[p].h >= c4[p + j].h)) isH = false;
      if (!(c4[p].l < c4[p - j].l) || !(c4[p].l <= c4[p + j].l)) isL = false;
    }
    if (isH) ph.push(p); if (isL) pl.push(p);
  }
  return { c4, e50: ema(closes, 50), e200: ema(closes, 200), a4: atr(c4, 14), ph, pl };
}
const countUpTo = (list, maxP) => { let lo = 0, hi = list.length; while (lo < hi) { const m = (lo + hi) >> 1; if (list[m] <= maxP) lo = m + 1; else hi = m; } return lo; };

// 4H 추세 판정 + 설명. dir: 'UP' | 'DOWN' | null. 확정 피벗만 사용한다.
export function trendInfo(T, d, P = OPP) {
  if (d < 0 || !Number.isFinite(T.e200[d]) || !Number.isFinite(T.e50[d]) || !Number.isFinite(T.a4[d])) return { dir: null, why: '4H 데이터 부족(EMA200 계산 불가)' };
  const nh = countUpTo(T.ph, d - P.pivotK), nl = countUpTo(T.pl, d - P.pivotK);
  if (nh < 2 || nl < 2) return { dir: null, why: '4H 스윙 구조 확인 불가(확정 피벗 부족)' };
  const c4 = T.c4, cl = c4[d].c;
  const hh = c4[T.ph[nh - 1]].h > c4[T.ph[nh - 2]].h, hl = c4[T.pl[nl - 1]].l > c4[T.pl[nl - 2]].l;
  const lh = c4[T.ph[nh - 1]].h < c4[T.ph[nh - 2]].h, ll = c4[T.pl[nl - 1]].l < c4[T.pl[nl - 2]].l;
  const upEma = T.e50[d] > T.e200[d] && cl > T.e200[d], downEma = T.e50[d] < T.e200[d] && cl < T.e200[d];
  if (upEma && hh && hl) return { dir: 'UP' };
  if (downEma && lh && ll) return { dir: 'DOWN' };
  const emaTxt = upEma ? 'EMA 정렬은 상승' : downEma ? 'EMA 정렬은 하락' : 'EMA 정렬이 엇갈림';
  const structTxt = hh && hl ? '구조는 HH·HL' : lh && ll ? '구조는 LH·LL' : '고점·저점 구조가 혼재';
  return { dir: null, why: `4H 추세 혼조(${emaTxt}, ${structTxt})` };
}
// BTC 맥락용: EMA 정렬만 본다
export function emaDirAt(T, d) {
  if (d < 0 || !Number.isFinite(T.e200[d]) || !Number.isFinite(T.e50[d])) return null;
  const cl = T.c4[d].c;
  return T.e50[d] > T.e200[d] && cl > T.e200[d] ? 'UP' : T.e50[d] < T.e200[d] && cl < T.e200[d] ? 'DOWN' : null;
}
// 시각 t(ms)까지 마감된 마지막 4H 봉 인덱스(마감 시각 = t4 + 4h ≤ t). 없으면 -1
export function doneIndex(c4, t) { let d = c4.length - 1; while (d >= 0 && c4[d].t + H4 > t) d--; return d; }

// 지지(상승 추세)/저항(하락 추세) 구간 후보: 최근 4H 스윙 저점(고점) + 4H 종가로 돌파되어 역할이 바뀐 스윙 고점(저점)
export function zonesAt(T, d, dir, P = OPP) {
  const L = dir === 'UP', hw = P.zoneHalfAtr4h * T.a4[d], out = [], c4 = T.c4;
  const nh = countUpTo(T.ph, d - P.pivotK), nl = countUpTo(T.pl, d - P.pivotK);
  const broken = (level, from) => { for (let q = from; q <= d; q++) if (L ? c4[q].c < level - hw : c4[q].c > level + hw) return true; return false; };
  const swings = L ? T.pl : T.ph, ns = L ? nl : nh;
  for (let n = ns - 1; n >= 0; n--) {
    const p = swings[n]; if (p < d - P.swingLookback4h) break;
    const level = L ? c4[p].l : c4[p].h;
    if (!broken(level, p + 1)) out.push({ lo: level - hw, hi: level + hw, level, type: '4H 스윙' });
  }
  const flips = L ? T.ph : T.pl, nf = L ? nh : nl;
  for (let n = nf - 1; n >= 0; n--) {
    const p = flips[n]; if (p < d - P.resLookback4h) break;
    const level = L ? c4[p].h : c4[p].l;
    let q = -1; for (let x = p + 1; x <= d; x++) if (L ? c4[x].c > level : c4[x].c < level) { q = x; break; }
    if (q < 0 || q < d - P.flipLookback4h) continue;
    if (!broken(level, q + 1)) out.push({ lo: level - hw, hi: level + hw, level, type: '돌파 후 역할 전환' });
  }
  return out;
}

const label = (v, lo, hi, names) => (v < lo ? names[0] : v < hi ? names[1] : names[2]);

// c1h, c4h: 확정 캔들(오래된 순). btc4h: BTC 확정 4H 캔들(없으면 null). 반환: 분석 결과 객체(항상 status 포함).
export function analyzeCoin(c1h, c4h, btc4h = null, P = OPP) {
  if (!Array.isArray(c1h) || !Array.isArray(c4h) || c1h.length < P.minBars1h || c4h.length < P.minBars4h) return { status: 'insufficient', reason: `캔들 부족(1H ${c1h?.length ?? 0}/${P.minBars1h}, 4H ${c4h?.length ?? 0}/${P.minBars4h})` };
  const i = c1h.length - 1, x = c1h[i], tClose = x.t + H1;
  const T = trendSeries(c4h, P), d = doneIndex(c4h, tClose);
  const a1 = atr(c1h, 14)[i];
  if (d < 0 || !Number.isFinite(a1) || !(a1 > 0) || !Number.isFinite(T.a4[d])) return { status: 'insufficient', reason: 'ATR/EMA 계산 불가' };
  const atr4 = T.a4[d], trend = trendInfo(T, d, P);
  // 참고 지표: 상대 거래량 · 변동성 · BTC 맥락
  const base = avgQuote(c1h, i, P.volBase), relVol = Number.isFinite(x.q) && base > 0 ? x.q / base : null;
  const atr1Pct = a1 / x.c * 100, atr4Pct = atr4 / x.c * 100;
  let btcDir; if (btc4h && btc4h.length >= P.minBars4h) { const TB = trendSeries(btc4h, P); btcDir = emaDirAt(TB, doneIndex(btc4h, tClose)); } else btcDir = undefined;   // undefined = 확인 불가
  const metrics = { relVol, atr1Pct, atr4Pct, volLabel: label(atr4Pct, P.atrLowPct, P.atrHighPct, ['낮음', '보통', '높음']), btcDir };
  const out = { status: 'ok', barT: x.t, asOf: tClose, price: x.c, trend: trend.dir, trendWhy: trend.why ?? null, state: 'WAIT', dir: null, stage: 0, stageLabel: STAGE[0], zone: null, invalidation: null, opposing: null, checks: [], met: 0, total: CHECK_TOTAL, reasons: [], unmet: [], metrics };
  if (!trend.dir) { out.unmet.push(trend.why); return out; }

  const L = trend.dir === 'UP', s = L ? 1 : -1, dirName = L ? 'LONG' : 'SHORT', zname = L ? '지지' : '저항', oname = L ? '저항' : '지지';
  metrics.btcAlign = btcDir === undefined ? '확인 불가' : btcDir === null ? '중립' : btcDir === trend.dir ? '일치' : '역방향';
  const w0 = i - P.pullbackBars + 1;
  let extreme = L ? Infinity : -Infinity;
  for (let j = w0; j <= i; j++) extreme = L ? Math.min(extreme, c1h[j].l) : Math.max(extreme, c1h[j].h);
  const before = c1h[w0 - 1], prev = c1h[i - 1];
  const evals = zonesAt(T, d, trend.dir, P).map(z => {
    const edge = L ? z.hi : z.lo, far = L ? z.lo : z.hi, dist = (x.c - edge) * s;
    const touched = L ? extreme <= z.hi : extreme >= z.lo;
    let held = true; for (let j = w0; j <= i; j++) if (L ? c1h[j].c < far : c1h[j].c > far) { held = false; break; }
    return { z, edge, dist, touched, held, fromSide: (before.c - edge) * s > 0 };
  });
  const nearest = (arr, key) => arr.sort((p, q) => key(p) - key(q))[0] ?? null;
  const interacting = nearest(evals.filter(e => e.touched && e.held && e.fromSide), e => (x.c - e.edge) * s);
  const approaching = nearest(evals.filter(e => !e.touched && e.dist > 0 && e.dist <= P.approachAtr4h * atr4), e => e.dist);
  const sel = interacting ?? approaching;
  const brokenNear = !sel ? nearest(evals.filter(e => e.touched && !e.held), e => Math.abs(x.c - e.edge)) : null;
  const farNear = !sel ? nearest(evals.filter(e => e.dist > 0), e => e.dist) : null;
  const ref = sel ?? farNear;                                   // 추격 위험·표시용 기준 구간

  // 추격 위험(설명용): 구간 경계에서 이격 + 마지막 봉 고저 폭
  const range = (x.h - x.l) / a1, dist4 = ref ? ref.dist / atr4 : null;
  metrics.chaseAtr4 = dist4; metrics.rangeAtr1 = range;
  metrics.chase = dist4 === null ? '평가 불가(구간 없음)' : range > P.maxRangeAtr1h || dist4 > P.chaseAtr4h ? '높음' : dist4 <= P.chaseLowAtr4 ? '낮음' : '보통';

  const checks = [];
  const add = (key, label, ok, okText, noText) => { checks.push({ key, label, ok: Boolean(ok), detail: ok ? okText : noText }); };
  add('trend', `4H ${L ? '상승' : '하락'} 추세`, true, `4H ${L ? '상승' : '하락'} 추세(EMA50 ${L ? '>' : '<'} EMA200, ${L ? 'HH·HL' : 'LH·LL'})`, '');
  let inv = null, risk = null;
  if (sel) {
    inv = L ? Math.min(extreme, sel.z.lo) - P.stopBufAtr1h * a1 : Math.max(extreme, sel.z.hi) + P.stopBufAtr1h * a1; risk = (x.c - inv) * s;
    out.zone = { lo: sel.z.lo, hi: sel.z.hi, level: sel.z.level, type: sel.z.type }; out.invalidation = inv;
  }
  const zoneTxt = sel ? `${zname} 구간 ${fmtPrice(sel.z.lo)}~${fmtPrice(sel.z.hi)}(${sel.z.type})` : '';
  add('touch', `${zname} 구간 접촉`, interacting, `${zoneTxt}에 최근 ${P.pullbackBars}시간 안에 닿음`,
    approaching ? `${zoneTxt}까지 ${f2(approaching.dist / atr4)} ATR(4H) 남음(아직 닿지 않음)` : brokenNear ? `${zname} 구간 ${fmtPrice(brokenNear.z.lo)}~${fmtPrice(brokenNear.z.hi)}을 1H 종가로 ${L ? '하향' : '상향'} 이탈함` : `${P.approachAtr4h} ATR(4H) 안에 접근한 ${zname} 구간이 없음${farNear ? `(가장 가까운 구간과 ${f2(farNear.dist / atr4)} ATR 이격)` : ''}`);
  add('hold', '구간 유지(눌림 구조)', interacting, `최근 ${P.pullbackBars}시간 1H 종가가 구간을 ${L ? '하향' : '상향'} 이탈하지 않고 구간 밖에서 내려옴`, interacting ? '' : '눌림이 진행되지 않았거나 구간을 이탈함');
  const candle = L ? x.c > x.o && x.c > prev.c : x.c < x.o && x.c < prev.c, recovered = sel ? sel.dist >= 0 : false;
  add('reentry', '재진입 확인 캔들', interacting && candle && recovered, `${L ? '양봉' : '음봉'} 마감 · 직전 종가 ${L ? '상회' : '하회'} · 구간 ${L ? '회복' : '복귀'}`,
    !interacting ? '눌림이 먼저 필요함' : `${L ? '양봉' : '음봉'} 마감 · 직전 종가 ${L ? '상회' : '하회'} · 구간 ${L ? '회복' : '복귀'} 중 일부 미충족`);
  const chaseOk = sel ? sel.dist / atr4 <= P.chaseAtr4h && range <= P.maxRangeAtr1h : false;
  add('chase', '추격 아님', chaseOk, `구간에서 ${f2(dist4)} ATR(4H) 이내 · 마지막 봉 폭 ${f2(range)} ATR(1H)`,
    !sel ? '기준 구간 없음' : `추격 위험: 구간에서 ${f2(sel.dist / atr4)} ATR(4H) 이격(기준 ${P.chaseAtr4h}) · 마지막 봉 폭 ${f2(range)} ATR(1H)(기준 ${P.maxRangeAtr1h})`);
  const riskAtr = risk === null ? null : risk / a1, widthOk = riskAtr !== null && riskAtr >= P.stopMinAtr1h && riskAtr <= P.stopMaxAtr1h;
  add('width', '무효화 거리 적정', widthOk, `무효화 가격까지 ${f2(riskAtr)} ATR(1H)(허용 ${P.stopMinAtr1h}~${P.stopMaxAtr1h})`,
    riskAtr === null ? '기준 구간 없음' : `무효화 가격까지 ${f2(riskAtr)} ATR(1H)로 ${riskAtr < P.stopMinAtr1h ? '너무 좁음' : '너무 넓음'}(허용 ${P.stopMinAtr1h}~${P.stopMaxAtr1h})`);
  // 반대편 장애물까지 공간: 4H 확정 스윙 고점(저점) 120봉 + 최근 72개 1H 최고(최저)
  const margin = P.resMarginAtr1h * a1, obst = [], lst = L ? T.ph : T.pl, nn = countUpTo(lst, d - P.pivotK);
  for (let n = nn - 1; n >= 0; n--) { const p = lst[n]; if (p < d - P.resLookback4h) break; const v = L ? T.c4[p].h : T.c4[p].l; if (L ? v > x.c + margin : v < x.c - margin) obst.push(v); }
  const rv = L ? Math.max(priorHigh(c1h, i, P.res1hBars), x.h) : Math.min(priorLow(c1h, i, P.res1hBars), x.l);
  if (L ? rv > x.c + margin : rv < x.c - margin) obst.push(rv);
  const opp = obst.length ? (L ? Math.min(...obst) : Math.max(...obst)) : null, roomR = opp === null || !(risk > 0) ? null : (opp - x.c) * s / risk;
  out.opposing = opp;
  add('room', `반대편 ${oname}까지 공간`, risk > 0 && (opp === null || roomR >= P.roomR), opp === null ? `가까운 반대편 ${oname} 없음` : `반대편 ${oname} ${fmtPrice(opp)}까지 ${f2(roomR)}R(기준 ${P.roomR}R)`,
    risk > 0 ? `반대편 ${oname} ${fmtPrice(opp)}까지 ${f2(roomR)}R로 ${P.roomR}R 미만` : '기준 구간 없음');

  out.checks = checks; out.met = checks.filter(c => c.ok).length;
  out.reasons = checks.filter(c => c.ok).map(c => c.detail);
  out.unmet = checks.filter(c => !c.ok).map(c => c.detail).filter(Boolean);
  out.stage = interacting ? (out.met === CHECK_TOTAL ? 3 : 2) : approaching ? 1 : 0;
  out.stageLabel = STAGE[out.stage];
  if (out.stage === 0) { out.zone = null; out.invalidation = null; out.opposing = null; } else { out.state = dirName; out.dir = dirName; }
  return out;
}
