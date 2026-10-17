// 전략 B — 리치 자체 규칙 전략: 가격 구조(20봉 돌파·재테스트) · 상대 거래량/유동성 · BTC 정합성 · ATR 손절/목표(최소 손익비 1:2) · 추격·과변동·역추세 제한.
// 점수는 조건 충족 점수(승률 아님). 모든 판단은 확정 1시간봉의 0..i번째 캔들만 사용한다.
import { atr as atrSeries, ema, priorHigh, priorLow, avgQuote } from './indicators.mjs';

export const B_SETTINGS = { timeframe: '1H', breakoutBars: 20, retestWindow: 8, atr: 14, minRR: 2, chaseAtr: 1.5, maxAtrPct: 4, minTurnover24h: 1e6, rrRoomBlock: 1.5 };
export const WARMUP_B = 260;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function seriesB(c) { return { atr: atrSeries(c, B_SETTINGS.atr) }; }

// BTC 맥락(시장 상태): 1시간봉 종가·EMA50·EMA200. 상승=종가>EMA50>EMA200, 하락=반대, 그 외 횡보/혼조.
export function seriesBtc(btc) {
  const closes = btc.map(x => x.c);
  return { e50: ema(closes, 50), e200: ema(closes, 200), atr: atrSeries(btc, 14) };
}
export function btcContext(btc, s, i) {
  const e50 = s.e50[i], e200 = s.e200[i], a = s.atr[i], x = btc[i];
  if (![e50, e200, a].every(Number.isFinite)) return { dir: null, atrPct: null, usable: false };
  const dir = x.c > e50 && e50 > e200 ? 'LONG' : x.c < e50 && e50 < e200 ? 'SHORT' : 'FLAT';
  const ret24 = i >= 24 ? (x.c / btc[i - 24].c - 1) * 100 : 0;
  return { dir, atrPct: a / x.c * 100, ret24, usable: true };
}

// 돌파·재테스트 구조 탐색(한 방향). 반환: 구조 정보 또는 null
function structure(c, i, dir, atrv) {
  const long = dir === 'LONG', d = long ? 1 : -1, W = B_SETTINGS.retestWindow, N = B_SETTINGS.breakoutBars;
  for (let j = Math.max(N, i - W); j <= i; j++) {
    const lvl = long ? priorHigh(c, j, N) : priorLow(c, j, N);
    if ((c[j].c - lvl) * d <= 0) continue;           // j봉 종가가 직전 20봉 고(저)점을 넘은 첫 돌파
    // 같은 레벨을 j 이후 다시 확인: 돌파 봉이 가장 이른 것을 쓰되, j 이전 봉이 이미 돌파였다면 건너뜀(첫 돌파 기준)
    const prevBroken = j > N && (c[j - 1].c - (long ? priorHigh(c, j - 1, N) : priorLow(c, j - 1, N))) * d > 0;
    if (prevBroken) continue;
    // 재테스트: j+1..i 중 레벨 근처(0.35 ATR)까지 되돌린 봉이 있고 레벨을 종가로 지켰으며 현재 봉(i)이 레벨 위(아래)에서 마감
    let retest = false;
    for (let k = j + 1; k <= i; k++) {
      const touched = long ? c[k].l <= lvl + 0.35 * atrv : c[k].h >= lvl - 0.35 * atrv;
      const held = (c[k].c - (lvl - d * 0.2 * atrv)) * d >= 0;
      if (touched && held) retest = true;
    }
    const nowOk = (c[i].c - lvl) * d > 0;
    const confirm = i === j ? true : (c[i].c - c[i].o) * d > 0 || (c[i].c - c[i - 1].c) * d > 0; // 재진입 확인(방향 마감)
    return { level: lvl, j, age: i - j, retest: retest && i > j && nowOk && confirm, fresh: i === j, extension: (c[i].c - lvl) * d / atrv };
  }
  return null;
}

// 가장 가까운 반대편 구조(진입 방향 앞쪽): 최근 100봉 중 진입가 앞쪽의 스윙 고점(저점)
// 돌파 봉 자체와 그 이후의 고점(저점)은 돌파로 만들어진 '추진 구간'이지 저항(지지)이 아니므로 제외하고, 돌파 이전에 형성된 구조만 본다.
function nearestAhead(c, i, dir, entry, lastIdx) {
  const long = dir === 'LONG'; let best = null;
  for (let j = Math.max(2, i - 150); j <= Math.min(i - 3, lastIdx - 2); j++) {
    const pivot = long ? (c[j].h > c[j - 1].h && c[j].h > c[j - 2].h && c[j].h >= c[j + 1].h && c[j].h >= c[j + 2].h) : (c[j].l < c[j - 1].l && c[j].l < c[j - 2].l && c[j].l <= c[j + 1].l && c[j].l <= c[j + 2].l);
    if (!pivot) continue;
    const p = long ? c[j].h : c[j].l;
    if (long ? p > entry : p < entry) best = best === null ? p : (long ? Math.min(best, p) : Math.max(best, p));
  }
  return best;
}

// opts.requireRetest(연구용 H1): 재테스트 완료를 필수 조건으로 만든다(미완료면 차단 사유). 점수 계산은 변경 없음.
export function scoreB(c, s, i, btcCtx, opts = {}) {
  const empty = reason => ({ dir: null, score: 0, parts: {}, blockers: [], reasons: [reason], settings: B_SETTINGS });
  const a = s.atr[i];
  if (i < WARMUP_B || !Number.isFinite(a) || !(a > 0)) return empty('지표 계산에 필요한 캔들 부족');
  let best = null;
  for (const dir of ['LONG', 'SHORT']) {
    const st = structure(c, i, dir, a);
    if (!st) continue;
    const pts = st.retest ? 30 : st.fresh ? 20 : st.extension <= 1 ? 12 : 0;
    if (pts === 0) continue;
    if (!best || pts > best.pts) best = { dir, st, pts };
  }
  if (!best) return empty('20봉 돌파·재테스트 구조 없음');
  const { dir, st, pts } = best, d = dir === 'LONG' ? 1 : -1, x = c[i];
  const parts = {}, blockers = [], reasons = [];
  parts.structure = { score: pts, max: 30, note: st.retest ? `20봉 ${dir === 'LONG' ? '고점' : '저점'} 돌파 후 재테스트 지지 확인(${st.age}봉 전 돌파)` : st.fresh ? '20봉 돌파 직후(재테스트 전, 가짜 돌파 위험)' : `돌파 ${st.age}봉 경과, 재테스트 미확인` };
  // 상대 거래량: 돌파 봉의 거래대금 / 직전 20봉 평균
  const rv = avgQuote(c, st.j, 20) > 0 ? c[st.j].q / avgQuote(c, st.j, 20) : 0;
  parts.relVolume = { score: rv >= 2 ? 15 : rv >= 1.5 ? 11 : rv >= 1.2 ? 6 : 0, max: 15, note: `돌파 봉 거래대금 ${rv.toFixed(2)}배` };
  // 유동성: 최근 24봉 거래대금 합(USDT)
  let t24 = 0; for (let j = Math.max(0, i - 23); j <= i; j++) t24 += c[j].q;
  parts.liquidity = { score: t24 >= 2e7 ? 10 : t24 >= 5e6 ? 7 : t24 >= B_SETTINGS.minTurnover24h ? 3 : 0, max: 10, note: `24시간 거래대금 ${(t24 / 1e6).toFixed(1)}M USDT` };
  if (t24 < B_SETTINGS.minTurnover24h) blockers.push('유동성 부족(24시간 거래대금 1M USDT 미만)');
  // BTC 정합성
  if (!btcCtx?.usable) { parts.btc = { score: 0, max: 15, note: 'BTC 데이터 없음' }; blockers.push('BTC 데이터 없음'); }
  else {
    const same = btcCtx.dir === dir, flat = btcCtx.dir === 'FLAT';
    parts.btc = { score: same ? 15 : flat ? 8 : 0, max: 15, note: `BTC 1H 구조 ${btcCtx.dir === 'LONG' ? '상승' : btcCtx.dir === 'SHORT' ? '하락' : '혼조'}` };
    if (!same && !flat) blockers.push('BTC 추세와 반대 방향(역추세 진입 제한)');
  }
  // 손절·손익비: 손절 = 레벨(또는 재테스트 저점/고점) 바깥 0.3 ATR, 목표 = 2R 이상
  const entry = x.c;
  let ext = st.level; if (st.retest) for (let k = st.j + 1; k <= i; k++) ext = dir === 'LONG' ? Math.min(ext, c[k].l) : Math.max(ext, c[k].h);
  const stop = dir === 'LONG' ? Math.min(st.level, ext) - 0.3 * a : Math.max(st.level, ext) + 0.3 * a;
  const risk = (entry - stop) * d;
  const stopAtr = risk / a;
  const ahead = risk > 0 ? nearestAhead(c, i, dir, entry, st.j - 1) : null;
  const room = ahead === null ? Infinity : (ahead - entry) * d / risk;
  let geo = 0;
  if (risk > 0) { geo += stopAtr >= 0.8 && stopAtr <= 2.5 ? 12 : stopAtr >= 0.5 && stopAtr <= 3.2 ? 6 : 0; geo += room >= 2 ? 8 : room >= 1.5 ? 4 : 0; }
  parts.risk = { score: geo, max: 20, note: `손절 ${stopAtr.toFixed(2)} ATR · 앞쪽 구조까지 ${Number.isFinite(room) ? room.toFixed(1) + 'R' : '없음'}` };
  if (!(risk > 0) || stopAtr > 3.2 || stopAtr < 0.5) blockers.push(`손절 거리 부적절(${Number.isFinite(stopAtr) ? stopAtr.toFixed(2) : '-'} ATR)`);
  if (room < B_SETTINGS.rrRoomBlock) blockers.push(`손익비 1:2 확보 어려움(앞쪽 구조까지 ${room.toFixed(1)}R)`);
  // 추격·과변동
  const atrPct = a / x.c * 100, ext2 = st.extension;
  const volPts = atrPct <= 1.5 ? 5 : atrPct <= 2.5 ? 3 : atrPct <= B_SETTINGS.maxAtrPct ? 1 : 0;
  const chasePts = ext2 <= 0.8 ? 5 : ext2 <= 1.2 ? 3 : 0;
  parts.chase = { score: volPts + chasePts, max: 10, note: `ATR ${atrPct.toFixed(2)}% · 레벨 이격 ${ext2.toFixed(2)} ATR` };
  if (atrPct > B_SETTINGS.maxAtrPct) blockers.push(`과도한 변동성(ATR ${atrPct.toFixed(1)}%)`);
  if (ext2 > B_SETTINGS.chaseAtr) blockers.push(`급등·급락 추격 제한(레벨에서 ${ext2.toFixed(1)} ATR 이격)`);
  if (opts.requireRetest && !st.retest) blockers.push('재테스트 미완료(필수 조건)');
  const score = Math.round(Object.values(parts).reduce((q, p) => q + p.score, 0) * 10) / 10;
  const features = { structureType: st.retest ? 'retest' : st.fresh ? 'fresh' : 'extended', breakoutAge: st.age, rv, t24, btcDir: btcCtx?.dir ?? null, btcAlign: !btcCtx?.usable ? 'none' : btcCtx.dir === dir ? 'same' : btcCtx.dir === 'FLAT' ? 'flat' : 'opposite', stopAtr, room: Number.isFinite(room) ? room : null, atrPct, extension: ext2, level: st.level };
  reasons.push(...Object.values(parts).map(p => p.note));
  const plan = risk > 0 ? { dir, entry, stop, tp: entry + d * B_SETTINGS.minRR * risk, rr: B_SETTINGS.minRR, stopAtr, ahead, room, level: st.level, basis: '레벨/재테스트 극값 바깥 0.3 ATR 손절, 2R 목표' } : null;
  return { dir, score, parts, blockers, reasons, plan, features, settings: B_SETTINGS, atr: a, atrPct, level: st.level, retest: st.retest };
}
