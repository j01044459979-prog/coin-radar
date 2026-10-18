// 4.0 연구용 통계 보조: 공정한 포트폴리오(동시 진입 시 미래 정보를 쓰지 않음) · 달력 분기 접힘 · 레버리지/청산 점검 · 고정 시드 사례 추출.

// 포트폴리오 시뮬레이션: 위험 riskFrac(계정 대비), 동시 포지션 상한 maxOpen, 자본은 청산 시점에 복리 반영.
// 3.0 연구의 portfolio()는 같은 시각에 진입한 거래를 청산 시각 순으로 정렬했다 — 청산이 빠른 거래를 우선 채택하는 미래 정보 의존이다. 여기서는 (진입 시각, 종목명) 순으로만 정렬한다.
export function portfolioFair(trades, { riskFrac = 0.005, maxOpen = 3, k = 'rNet' } = {}) {
  const ev = [...trades].sort((a, b) => a.tEntry - b.tEntry || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  let equity = 1, peak = 1, maxDD = 0, taken = 0, skipped = 0, maxConc = 0, openSum = 0;
  const open = [];
  const settle = upTo => { open.sort((a, b) => a.tExit - b.tExit); while (open.length && open[0].tExit <= upTo) { const t = open.shift(); equity += t.riskAmt * t[k]; peak = Math.max(peak, equity); maxDD = Math.max(maxDD, (peak - equity) / peak); } };
  for (const t of ev) {
    settle(t.tEntry);
    if (open.length >= maxOpen) { skipped++; continue; }
    open.push({ ...t, riskAmt: equity * riskFrac }); taken++; maxConc = Math.max(maxConc, open.length); openSum += open.length;
  }
  settle(Infinity);
  return { taken, skipped, endEquity: equity, returnPct: (equity - 1) * 100, maxDrawdownPct: maxDD * 100, maxConcurrent: maxConc };
}

export const quarterOf = t => { const d = new Date(t); return `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`; };

// 레버리지/청산 점검. 포지션 명목가 = 위험금액 ÷ 손절폭 → 계정 대비 필요 레버리지 = riskFrac ÷ 손절폭.
// 사용자가 고정 레버리지 L을 쓰는 격리 마진을 가정: 청산 거리 ≈ 1/L − 유지증거금률(mmr). 거래소별 실제 공식은 다르다(단순화 가정).
//  stopBeyond: 손절폭이 청산 거리 이상 → 손절 전에 청산(그 레버리지로는 이 거래를 할 수 없음)
//  gapLiq: 손절 체결(갭 포함)의 실제 손실률이 청산 거리 이상 → 손절이 지켜지지 않고 청산
export function leverageCheck(trades, { Ls = [3, 5, 10, 20], mmr = 0.005, riskFrac = 0.005 } = {}) {
  const n = trades.length; if (!n) return { n: 0, needed: null, rows: [] };
  const need = trades.map(t => riskFrac / t.riskPct).sort((a, b) => a - b), q = p => need[Math.min(n - 1, Math.floor(p * n))];
  const rows = Ls.map(L => {
    const liq = 1 / L - mmr;
    const stopBeyond = trades.filter(t => t.riskPct >= liq).length;
    const gapLiq = trades.filter(t => t.riskPct < liq && (t.dir === 'LONG' ? t.entry - t.exit : t.exit - t.entry) / t.entry >= liq).length;
    const needMore = need.filter(x => x > L).length;
    return { L, liqPct: liq * 100, stopBeyond, gapLiq, needMore, n };
  });
  return { n, needed: { median: q(0.5), p90: q(0.9), max: need[n - 1] }, rows };
}

// 고정 시드로 사례를 뽑는다(결과를 보고 고르지 않기 위함): 각 거래의 키를 해시해 정렬한 앞쪽 k개
const hash = s => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h; };
export function pickCases(trades, k = 3, salt = 'tp4') {
  const ord = [...trades].sort((a, b) => hash(`${salt}|${a.seg}|${a.t}|${a.dir}`) - hash(`${salt}|${b.seg}|${b.t}|${b.dir}`));
  return { wins: ord.filter(t => t.rNet > 0).slice(0, k), losses: ord.filter(t => t.rNet <= 0).slice(0, k) };
}
