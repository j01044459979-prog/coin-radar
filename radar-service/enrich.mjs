import { biasOf, blockers, scoreRow, triggerDistance, unmetConditions } from './scoring.mjs';
import { planOf, riskOf } from './plan.mjs';

// 시장 상태: BTC 1시간·4시간 추세 기준. BTC 추세 미확인이면 판단불가.
export function marketState(btcMtf) {
  const h = btcMtf?.['1H']?.dir, d = btcMtf?.['4H']?.dir;
  if (!h || !d || h === 'UNKNOWN' || d === 'UNKNOWN') return '판단불가';
  if (h === 'UP' && d === 'UP') return '상승';
  if (h === 'DOWN' && d === 'DOWN') return '하락';
  return '혼조';
}

export function mtfConflict(dir, mtf) {
  const bad = tf => { const t = mtf?.[tf]; return t && ((dir === 'LONG' && t.dir === 'DOWN') || (dir === 'SHORT' && t.dir === 'UP')); };
  return Boolean(dir && (bad('1H') || bad('4H')));
}

// 예비 점수(상위 시간대 제외)로 MTF 조회 대상을 고른다. 호출 수 절약용.
export function preliminary(row, btc) {
  const dir = biasOf(row);
  if (!dir) return { dir: null, score: 0 };
  const s = scoreRow(row, dir, null, btc);
  return { dir, score: s.total };
}

// rows: 분석 완료(applyBtcFilter 이후) 행. mtfBySymbol: {SYMBOL:{'15m':trend,'1H':trend,'4H':trend}}
export function enrich(rows, mtfBySymbol = {}) {
  const btc = rows.find(r => r.symbol === 'BTCUSDT');
  return rows.map(row => {
    const dir = biasOf(row);
    const mtf = mtfBySymbol[row.symbol] ?? null;
    const slim = mtf ? Object.fromEntries(Object.entries(mtf).map(([tf, t]) => [tf, { tf: t.tf, dir: t.dir, label: t.label, arrow: t.arrow, basis: t.basis, lastClosedAt: t.lastClosedAt,
      resistance: t.resistance?.slice(-6), support: t.support?.slice(-6) }])) : null;
    if (!dir) return { ...row, mtf: slim, candidate: null };
    const score = scoreRow(row, dir, slim, btc);
    const plan = planOf(row, dir, slim);
    const { met, unmet } = unmetConditions(row, dir);
    const conflict = mtfConflict(dir, slim);
    if (conflict) unmet.push('상위 시간대 역행 주의');
    // 강한 조건 행은 단일 무효화 기준을 쓴다: 시나리오 손절선과 동일 값
    const stop = plan && row.direction === dir ? plan.stop : row.stop;
    return { ...row, stop, mtf: slim, candidate: {
      dir, score: score.total, parts: score.parts, missing: score.missing, blockers: blockers(row, dir, btc), dist: triggerDistance(row, dir),
      met, unmet, plan, risk: riskOf(row, dir, slim, plan, btc), mtfConflict: conflict,
    } };
  });
}
