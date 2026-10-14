// 거래량·추정 매물대 계산(순수 함수). 모든 거래량은 OKX 확정 캔들의 volCcyQuote(USDT 거래대금)를 쓴다.
//
// OKX /market/candles 행: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
//  - vol          : 계약 수량(SWAP). 가격 단위가 아니므로 거래대금으로 쓰지 않는다.
//  - volCcy       : 기초자산 수량(예: BTC 개수)
//  - volCcyQuote  : 호가 통화(USDT) 거래대금  ← 차트·매물대에 사용
// 단위 점검: 한 캔들의 volCcyQuote / volCcy 는 그 캔들의 평균 체결가이므로 반드시 [저가, 고가] 안에 있다(±2%).
// 벗어나면 필드 의미를 잘못 읽은 것이므로 해당 캔들의 거래량을 '비정상'(null)으로 두고 임의로 보정하지 않는다.
export const UNIT_TOLERANCE = 0.02;

// 반환: { q: USDT 거래대금(숫자, 0 가능) | null(누락·비정상), v: 기초자산 수량 | null }
export function parseCandleVolume(row, low, high) {
  const v = Number(row?.[6]), q = Number(row?.[7]);
  if (row?.[6] === undefined || row?.[7] === undefined || row?.[6] === '' || row?.[7] === '' || !Number.isFinite(v) || !Number.isFinite(q) || v < 0 || q < 0) return { q: null, v: null };
  if (q === 0 && v === 0) return { q: 0, v: 0 };
  if (q === 0 || v === 0) return { q: null, v: null };
  const avg = q / v;
  return avg >= low * (1 - UNIT_TOLERANCE) && avg <= high * (1 + UNIT_TOLERANCE) ? { q, v } : { q: null, v: null };
}

const valid = c => Number.isFinite(c?.q) && c.q >= 0;

// 직전 20봉(현재 봉 제외) 평균 거래대금. 유효한 값이 minValid개 미만이면 null.
export function avgPrev(candles, n = 20, minValid = 10) {
  return candles.map((_, i) => {
    const w = candles.slice(Math.max(0, i - n), i).filter(valid);
    return w.length >= minValid ? w.reduce((s, c) => s + c.q, 0) / w.length : null;
  });
}

export const SPIKE_RATIO = 2; // 직전 20봉 평균의 2배 이상이면 거래량 급증으로 표시

// 전체 캔들(과거 포함)로 평균을 계산한 뒤 마지막 n개만 돌려준다.
export function volumeSeries(candles, show = 48) {
  const avg = avgPrev(candles);
  const rows = candles.map((c, i) => ({ q: valid(c) ? c.q : null, avg: avg[i], spike: valid(c) && avg[i] ? c.q >= SPIKE_RATIO * avg[i] : false }));
  const shown = rows.slice(-show);
  const ok = shown.filter(r => r.q !== null).length;
  return { rows: shown, coverage: shown.length ? ok / shown.length : 0, ok };
}

// 가격대별 추정 매물대.
// 규칙: 표시 중인 캔들마다 거래대금 q를 [저가, 고가] 범위에 균등 분포로 가정하고, 각 가격 구간과 겹치는 길이의 비율만큼 배분한다(합계 보존).
//       고가=저가인 캔들은 해당 가격이 속한 구간에 전액 배분. 거래량이 누락·비정상인 캔들은 제외한다.
//       실제 체결 가격 분포가 아니라 캔들 범위 기반의 추정이다.
export function volumeProfile(candles, { bins = 24, price = null, minCoverage = 0.7 } = {}) {
  const used = candles.filter(valid);
  if (!candles.length || used.length < Math.max(10, Math.ceil(candles.length * minCoverage))) return null;
  const lo = Math.min(...candles.map(c => c.l)), hi = Math.max(...candles.map(c => c.h));
  const size = (hi - lo) / bins;
  if (!(size > 0)) return null;
  const vol = new Array(bins).fill(0);
  for (const c of used) {
    if (c.q === 0) continue;
    if (c.h - c.l <= size * 1e-9) { vol[Math.min(bins - 1, Math.max(0, Math.floor((c.c - lo) / size)))] += c.q; continue; }
    const span = c.h - c.l;
    const first = Math.max(0, Math.floor((c.l - lo) / size)), last = Math.min(bins - 1, Math.floor((c.h - lo) / size));
    for (let i = first; i <= last; i++) {
      const overlap = Math.min(c.h, lo + (i + 1) * size) - Math.max(c.l, lo + i * size);
      if (overlap > 0) vol[i] += (c.q * overlap) / span;
    }
  }
  const total = vol.reduce((s, v) => s + v, 0);
  if (!(total > 0)) return null;
  const mk = i => ({ index: i, lo: lo + i * size, hi: lo + (i + 1) * size, mid: lo + (i + 0.5) * size, vol: vol[i], share: vol[i] / total });
  // POC: 거래대금이 가장 큰 구간. 동률(상대오차 1e-9)이면 현재가에 가까운 구간, 그래도 같으면 낮은 구간.
  const max = Math.max(...vol);
  const tied = vol.map((v, i) => (Math.abs(v - max) <= max * 1e-9 ? i : -1)).filter(i => i >= 0);
  const ref = price ?? (lo + hi) / 2;
  const pocIndex = tied.sort((a, b) => Math.abs(mk(a).mid - ref) - Math.abs(mk(b).mid - ref) || a - b)[0];
  const poc = mk(pocIndex);
  // 관찰 구간(최대 2개): POC + 별도의 봉우리 하나. 봉우리 조건: 국소 최대, 거래대금이 POC의 50% 이상, POC와 3구간 이상 떨어짐,
  // POC와의 사이에 자기 거래대금의 80% 이하로 내려가는 골짜기가 있을 것(평평한 분포에서는 두 번째 구간을 만들지 않는다).
  // 구간 폭은 해당 구간 거래대금의 70% 이상인 옆 구간까지 묶되 양옆 최대 2구간까지로 제한한다.
  const valleyOk = i => Math.min(...vol.slice(Math.min(i, pocIndex) + 1, Math.max(i, pocIndex))) <= 0.8 * vol[i];
  const nodes = vol.map((v, i) => ({ i, v })).filter(({ i, v }) => i !== pocIndex && v >= 0.5 * poc.vol && v >= (vol[i - 1] ?? 0) && v >= (vol[i + 1] ?? 0) && Math.abs(i - pocIndex) >= 3 && valleyOk(i)).sort((a, b) => b.v - a.v);
  const picks = [pocIndex];
  for (const n of nodes) if (picks.length < 2 && picks.every(p => Math.abs(p - n.i) >= 3)) picks.push(n.i);
  const zones = picks.map(i => {
    let a = i, b = i;
    while (a > 0 && i - a < 2 && vol[a - 1] >= 0.7 * vol[i]) a--;
    while (b < bins - 1 && b - i < 2 && vol[b + 1] >= 0.7 * vol[i]) b++;
    const zlo = lo + a * size, zhi = lo + (b + 1) * size, share = vol.slice(a, b + 1).reduce((s, v) => s + v, 0) / total;
    const side = price === null ? 'at' : price < zlo ? 'above' : price > zhi ? 'below' : 'at';   // above=현재가 위쪽, below=아래쪽
    return { lo: zlo, hi: zhi, mid: (zlo + zhi) / 2, share, isPoc: i === pocIndex, side };
  });
  return { lo, hi, size, bins: vol.map((v, i) => mk(i)), total, poc, zones, coverage: used.length / candles.length };
}
