// 조건 충족 점수(0~100)와 진입 근접 후보. 점수는 조건 충족도이며 수익 확률이 아니다. 결측 데이터에는 점수를 주지 않는다.
export const WEIGHTS = { mtf: 20, structure: 20, volume: 15, oi: 15, funding: 10, btc: 10, volatility: 10 };
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const sign = dir => (dir === 'LONG' ? 1 : -1);
const arrowDir = t => (t?.dir === 'UP' ? 'LONG' : t?.dir === 'DOWN' ? 'SHORT' : null);

// 추세 방향(기본 관찰 방향): 확정 돌파가 있으면 그 방향, 없으면 5분 단순평균 추세
export function biasOf(row) {
  if (row.direction === 'LONG' || row.direction === 'SHORT') return row.direction;
  if (row.trend === '상승') return 'LONG';
  if (row.trend === '하락') return 'SHORT';
  return null;
}

// 돌파 기준선까지 남은 거리 (ATR 단위·%). 이미 넘었으면 0.
export function triggerDistance(row, dir) {
  const level = dir === 'LONG' ? row.high : row.low;
  if (!Number.isFinite(level) || !(row.atr > 0)) return null;
  const gap = dir === 'LONG' ? level - row.price : row.price - level;
  const remaining = Math.max(0, gap);
  return { level, remaining, atrUnits: remaining / row.atr, pct: remaining / row.price * 100, broken: gap <= 0 };
}

// 점수 구성(합계 100). 각 항목: {score, max, note}
export function scoreRow(row, dir, mtf, btc) {
  const parts = {}, missing = [];
  // 1) 다중 시간대 정합성 20: 15분 6 · 1시간 7 · 4시간 7. 동일 방향 만점, 횡보 절반, 역행·미확인 0
  const tfw = { '15m': 6, '1H': 7, '4H': 7 };
  let m = 0; const mnote = [];
  for (const tf of ['15m', '1H', '4H']) {
    const t = mtf?.[tf];
    if (!t || t.dir === 'UNKNOWN') { missing.push(`${tf} 추세`); mnote.push(`${tf} 미확인`); continue; }
    const d = arrowDir(t);
    m += d === dir ? tfw[tf] : d === null ? tfw[tf] / 2 : 0;
    mnote.push(`${tf} ${t.arrow}`);
  }
  parts.mtf = { score: m, max: WEIGHTS.mtf, note: mnote.join(' ') };
  // 2) 돌파·가격 구조 20: 확정 돌파 20, 미돌파는 남은 ATR 거리로 단계화. 5분 추세가 방향과 다르면 절반
  const dist = triggerDistance(row, dir);
  const aligned = (row.trend === '상승' && dir === 'LONG') || (row.trend === '하락' && dir === 'SHORT');
  let st = 0;
  if (dist) {
    const base = row.direction === dir ? 20 : dist.atrUnits <= 0.25 ? 16 : dist.atrUnits <= 0.5 ? 12 : dist.atrUnits <= 1 ? 8 : dist.atrUnits <= 2 ? 4 : 0;
    st = base * (aligned || row.direction === dir ? 1 : 0.5);
  } else missing.push('돌파 기준선');
  parts.structure = { score: st, max: WEIGHTS.structure, note: dist ? (row.direction === dir ? '직전 20봉 돌파 확정' : `기준선까지 ${dist.atrUnits.toFixed(2)} ATR (${dist.pct.toFixed(2)}%)`) : '데이터 없음' };
  // 3) 거래대금 15: 직전 20봉 평균 대비 0.8배 이하 0점, 2배 이상 만점
  parts.volume = { score: Number.isFinite(row.volume) ? WEIGHTS.volume * clamp((row.volume - 0.8) / 1.2) : 0, max: WEIGHTS.volume, note: `${Number(row.volume).toFixed(2)}배` };
  // 4) OI 15: 15분 OI +1% 이상 만점, 0 이하 0점
  parts.oi = { score: Number.isFinite(row.oi15) ? WEIGHTS.oi * clamp(row.oi15 / 1) : 0, max: WEIGHTS.oi, note: `${Number(row.oi15).toFixed(2)}%` };
  // 5) 펀딩 10: |펀딩| 0.01% 이하 만점, 0.05% 이상 0점
  const f = Math.abs(row.funding);
  parts.funding = { score: Number.isFinite(f) ? WEIGHTS.funding * clamp((0.05 - f) / 0.04) : 0, max: WEIGHTS.funding, note: `${Number(row.funding).toFixed(4)}%` };
  // 6) BTC 시장 필터 10: BTC 15분이 같은 방향 10 · 보합(±0.1%) 7 · 소폭 역행(0.5% 이내) 3 · 0.5% 초과 역행 0(차단)
  let b = 0, bnote = 'BTC 데이터 없음';
  if (btc && Number.isFinite(btc.change15)) {
    const x = btc.change15 * sign(dir);
    b = x >= 0.1 ? 10 : x > -0.1 ? 7 : x >= -0.5 ? 3 : 0;
    bnote = `BTC 15분 ${btc.change15.toFixed(2)}%`;
  } else missing.push('BTC 15분 변동');
  parts.btc = { score: b, max: WEIGHTS.btc, note: bnote };
  // 7) 변동성·이격 10: 기준선 이격(5) + ATR/가격(5)
  const gapAtr = dist ? Math.abs(row.price - dist.level) / row.atr : null;
  const gapPts = gapAtr === null ? 0 : gapAtr <= 0.5 ? 5 : gapAtr <= 1 ? 3 : gapAtr <= 2 ? 1 : 0;
  const a = row.atrPct;
  const volPts = !Number.isFinite(a) ? 0 : a <= 0.5 ? 5 : a <= 1 ? 4 : a <= 2 ? 2 : a <= 3 ? 1 : 0;
  parts.volatility = { score: gapPts + volPts, max: WEIGHTS.volatility, note: `이격 ${gapAtr === null ? '-' : gapAtr.toFixed(2)} ATR · ATR ${Number(a).toFixed(2)}%` };
  const total = Math.round(Object.values(parts).reduce((s, p) => s + p.score, 0) * 10) / 10;
  return { total, parts, missing };
}

// 필수 차단: 점수와 무관하게 신호/후보 발송 금지
export function blockers(row, dir, btc) {
  const out = [];
  if (!btc || !Number.isFinite(btc.change15)) out.push('BTC 데이터 없음');
  else if ((dir === 'LONG' && btc.change15 < -0.5) || (dir === 'SHORT' && btc.change15 > 0.5)) out.push('BTC 15분 0.5% 초과 역행');
  return out;
}

// 부족한 조건 (강한 조건 기준: 돌파·거래대금 2배·OI +1%·|펀딩| ≤ 0.05%·기준선 1 ATR 이내)
export function unmetConditions(row, dir) {
  const out = [], met = [];
  const dist = triggerDistance(row, dir);
  if (row.direction === dir) met.push('직전 20봉 돌파 확정'); else if (dist) out.push(`${dir === 'LONG' ? '고점' : '저점'} ${fmtP(dist.level)} 돌파 확정 필요 (${dist.pct.toFixed(2)}% · ${dist.atrUnits.toFixed(2)} ATR 남음)`);
  if (row.volume >= 2) met.push(`거래대금 ${row.volume.toFixed(2)}배`); else out.push(`거래대금 ${row.volume.toFixed(2)}배 → 2배 필요`);
  if (row.oi15 >= 1) met.push(`15분 OI ${row.oi15.toFixed(2)}%`); else out.push(`15분 OI ${row.oi15.toFixed(2)}% → +1% 필요`);
  if (Math.abs(row.funding) <= 0.05) met.push(`펀딩 ${row.funding.toFixed(4)}%`); else out.push(`펀딩 ${row.funding.toFixed(4)}% 과열`);
  const aligned = (row.trend === '상승' && dir === 'LONG') || (row.trend === '하락' && dir === 'SHORT');
  if (aligned) met.push(`5분 추세 ${row.trend}`); else out.push(`5분 추세 ${row.trend}`);
  return { met, unmet: out };
}
const fmtP = n => Number(Number(n).toPrecision(7)).toString();

export const NEAR_MIN_SCORE = 40;
export const NEAR_MAX_ATR = 2;
// 강한 신호가 아닌 종목 중 근접 후보. 실제 후보만 반환(채우기 없음), 최대 3개.
export function pickNear(rows, limit = 3) {
  return rows.filter(r => !r.strong && r.candidate && r.candidate.blockers.length === 0 && r.candidate.score >= NEAR_MIN_SCORE &&
      r.candidate.dist && r.candidate.dist.atrUnits <= NEAR_MAX_ATR)
    .sort((a, b) => b.candidate.score - a.candidate.score).slice(0, limit);
}

// 짧은 "체크 포인트" 문구(고정 어휘). 보고서 요약과 차트 칩이 같이 쓴다. 강한 조건이면 재지지/재저항 확인이 먼저.
export function checkPhrases(row, dir, limit = 2) {
  const c = row.candidate;
  if (!c) return [];
  const out = [];
  if (row.strong) out.push(dir === 'LONG' ? '재지지 확인 필요' : '재저항 확인 필요');
  for (const u of c.unmet || []) {
    if (/OI/.test(u)) out.push('15분 OI 증가 필요');
    else if (/거래대금/.test(u)) out.push('거래대금 증가 필요');
    else if (/돌파 확정/.test(u)) out.push(dir === 'LONG' ? '고점 돌파 확인 필요' : '저점 이탈 확인 필요');
    else if (/펀딩/.test(u)) out.push('펀딩 과열 주의');
    else if (/5분 추세/.test(u)) out.push('5분 추세 확인 필요');
  }
  return [...new Set(out)].slice(0, limit);
}

// ── 추천 관찰 TOP 2 ──────────────────────────────────────────
// 1) 강한 관찰 조건 충족 종목(점수 높은 순) → 2) 근접 후보 중 순위값이 높은 순. 같은 종목은 1회만.
// 순위값 = 조건 충족 점수 − 2 × 위험 점수(상대 평가). 표시 점수는 원래 조건 충족 점수이며 성공 확률이 아니다.
// 적격 후보가 부족하면 1개 또는 0개만 반환한다(차단·저점수 후보로 채우지 않음). 롱/숏 구성은 강제하지 않는다.
// 정기 보고 '추천 관찰 TOP 2'에 노출하는 하한(조건 충족 점수 기준). 내부 근접 후보 감시 하한(NEAR_MIN_SCORE = 40)과 별개이며,
// 위험 점수를 차감한 순위값(rankValue)이 아니라 표시 점수(candidate.score) ≥ 55 여야 한다. 강한 신호 판정·5분 긴급 알림에는 적용하지 않는다.
export const RECOMMEND_MIN_SCORE = 55;
export const rankValue = row => row.candidate.score - 2 * (row.candidate.risk?.points ?? 0);
export function pickTop2(rows, limit = 2) {
  const seen = new Set(), out = [];
  const take = (row, tier) => { if (out.length < limit && !seen.has(row.symbol)) { seen.add(row.symbol); out.push({ row, tier, rank: out.length + 1 }); } };
  rows.filter(r => r.strong && r.candidate && !(r.candidate.blockers?.length) && r.candidate.score >= RECOMMEND_MIN_SCORE).sort((a, b) => b.candidate.score - a.candidate.score).forEach(r => take(r, 'strong'));
  pickNear(rows, rows.length).filter(r => r.candidate.score >= RECOMMEND_MIN_SCORE).sort((a, b) => rankValue(b) - rankValue(a) || b.candidate.score - a.candidate.score).forEach(r => take(r, 'near'));
  return out;
}
