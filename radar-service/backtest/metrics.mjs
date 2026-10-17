// 성과 지표. 단위는 R(1R = 거래당 위험 금액). 표본·통계적 유의성 한계를 함께 계산한다.
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
function lcg(seed) { let x = seed >>> 0; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296; }

export function bootstrapCI(rs, { iters = 2000, seed = 7 } = {}) {
  if (rs.length < 2) return null;
  const rnd = lcg(seed), means = [];
  for (let b = 0; b < iters; b++) { let s = 0; for (let k = 0; k < rs.length; k++) s += rs[Math.floor(rnd() * rs.length)]; means.push(s / rs.length); }
  means.sort((a, b) => a - b);
  return [means[Math.floor(iters * 0.025)], means[Math.floor(iters * 0.975)]];
}

export function metrics(trades, { gross = false } = {}) {
  const key = gross ? 'rGross' : 'rNet', n = trades.length;
  if (!n) return { n: 0, flags: ['거래 없음'] };
  const rs = trades.map(t => t[key]), wins = rs.filter(r => r > 0), losses = rs.filter(r => r <= 0);
  const sumW = wins.reduce((s, x) => s + x, 0), sumL = -losses.reduce((s, x) => s + x, 0);
  const ordered = [...trades].sort((a, b) => a.tExit - b.tExit || a.tEntry - b.tEntry);
  let eq = 0, peak = 0, maxDD = 0, curLosses = 0, maxLossStreak = 0;
  for (const t of ordered) { eq += t[key]; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, peak - eq); curLosses = t[key] <= 0 ? curLosses + 1 : 0; maxLossStreak = Math.max(maxLossStreak, curLosses); }
  const ci = bootstrapCI(rs), exp = mean(rs), flags = [];
  if (n < 30) flags.push('표본 부족(n<30)'); else if (n < 100) flags.push('표본 적음(n<100)');
  if (ci && ci[0] <= 0 && ci[1] >= 0) flags.push('기대값이 0과 통계적으로 구분되지 않음');
  const bySymbol = {}; for (const t of trades) bySymbol[t.symbol] = (bySymbol[t.symbol] || 0) + 1;
  const top = Math.max(0, ...Object.values(bySymbol)); if (n >= 10 && top / n > 0.4) flags.push('특정 종목 거래 비중 40% 초과');
  return { n, winRate: wins.length / n, avgR: exp, avgWinR: wins.length ? sumW / wins.length : 0, avgLossR: losses.length ? -sumL / losses.length : 0, expectancyR: exp, profitFactor: sumL > 0 ? sumW / sumL : (sumW > 0 ? Infinity : 0),
    totalR: rs.reduce((s, x) => s + x, 0), maxDrawdownR: maxDD, maxLossStreak, avgBars: mean(trades.map(t => t.bars)), avgRiskPct: mean(trades.map(t => t.riskPct)) * 100, ci95: ci, symbols: Object.keys(bySymbol).length, flags };
}

export const fmt = m => !m.n ? '거래 없음' : `n=${m.n} 승률 ${(m.winRate * 100).toFixed(1)}% 기대값 ${m.expectancyR.toFixed(3)}R PF ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞'} MDD ${m.maxDrawdownR.toFixed(1)}R`;
