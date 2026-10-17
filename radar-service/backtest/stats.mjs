// 연구용 통계: 블록 부트스트랩, 보유기간 겹침 제거, 포트폴리오 낙폭, 그룹 분해 표.
// 거래는 같은 시기에 여러 종목이 함께 움직이므로(시장 요인) 거래를 독립으로 보는 부트스트랩은 구간을 과소평가한다 → 주(週) 단위 블록을 통째로 재표집한다.
const WEEK = 7 * 24 * 3600000;
function lcg(seed) { let x = seed >>> 0; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296; }
const key = 'rNet';

// 블록 부트스트랩으로 평균 R의 95% 구간. 블록 = 진입 시각의 주(週). 블록이 3개 미만이면 null(신뢰구간 산출 불가).
export function blockBootstrap(trades, { blockMs = WEEK, iters = 2000, seed = 11, k = key } = {}) {
  const blocks = new Map();
  for (const t of trades) { const b = Math.floor(t.tEntry / blockMs); const e = blocks.get(b) || [0, 0]; e[0] += t[k]; e[1] += 1; blocks.set(b, e); }
  const arr = [...blocks.values()];
  if (arr.length < 3) return null;
  const rnd = lcg(seed), means = [];
  for (let it = 0; it < iters; it++) { let s = 0, n = 0; for (let j = 0; j < arr.length; j++) { const e = arr[Math.floor(rnd() * arr.length)]; s += e[0]; n += e[1]; } means.push(n ? s / n : 0); }
  means.sort((a, b) => a - b);
  return [means[Math.floor(iters * 0.025)], means[Math.floor(iters * 0.975)]];
}

// 쌍체 비교용: 두 거래 집합의 평균 R 차이(A−B)에 대한 블록 부트스트랩 구간
export function blockBootstrapDiff(a, b, { blockMs = WEEK, iters = 2000, seed = 13, k = key } = {}) {
  const blocks = new Map();
  const add = (list, idx) => { for (const t of list) { const id = Math.floor(t.tEntry / blockMs); const e = blocks.get(id) || [0, 0, 0, 0]; e[idx] += t[k]; e[idx + 1] += 1; blocks.set(id, e); } };
  add(a, 0); add(b, 2);
  const arr = [...blocks.values()];
  if (arr.length < 3 || !a.length || !b.length) return null;
  const rnd = lcg(seed), d = [];
  for (let it = 0; it < iters; it++) { let sa = 0, na = 0, sb = 0, nb = 0; for (let j = 0; j < arr.length; j++) { const e = arr[Math.floor(rnd() * arr.length)]; sa += e[0]; na += e[1]; sb += e[2]; nb += e[3]; } if (na && nb) d.push(sa / na - sb / nb); }
  d.sort((x, y) => x - y);
  return d.length ? [d[Math.floor(d.length * 0.025)], d[Math.floor(d.length * 0.975)]] : null;
}

// 전역 보유기간 겹침 제거: 진입 시각 순으로 훑으며 이미 열린 포지션(어느 종목이든)이 있으면 건너뜀 → 서로 겹치지 않는 거래열(통계적 독립성이 가장 깨끗한 표본)
export function nonOverlapping(trades) {
  const out = []; let busyUntil = -Infinity;
  for (const t of [...trades].sort((a, b) => a.tEntry - b.tEntry || a.tExit - b.tExit)) { if (t.tEntry >= busyUntil) { out.push(t); busyUntil = t.tExit; } }
  return out;
}

// 포트폴리오 시뮬레이션: 거래당 위험 riskFrac(자본 대비), 동시 포지션 상한 maxOpen. 자본은 청산 시점에 반영(복리). 상한에 걸린 거래는 건너뜀.
export function portfolio(trades, { riskFrac = 0.01, maxOpen = 5, k = key } = {}) {
  const ev = [...trades].sort((a, b) => a.tEntry - b.tEntry || a.tExit - b.tExit);
  let equity = 1, peak = 1, maxDD = 0, taken = 0, skipped = 0, maxConc = 0, openSum = 0;
  const open = []; const closed = [];
  const settle = upTo => { open.sort((a, b) => a.tExit - b.tExit); while (open.length && open[0].tExit <= upTo) { const t = open.shift(); equity += t.riskAmt * t[k]; peak = Math.max(peak, equity); maxDD = Math.max(maxDD, (peak - equity) / peak); closed.push(t); } };
  for (const t of ev) {
    settle(t.tEntry);
    if (open.length >= maxOpen) { skipped++; continue; }
    open.push({ ...t, riskAmt: equity * riskFrac }); taken++; maxConc = Math.max(maxConc, open.length); openSum += open.length;
  }
  settle(Infinity);
  return { taken, skipped, endEquity: equity, returnPct: (equity - 1) * 100, maxDrawdownPct: maxDD * 100, maxConcurrent: maxConc, avgConcurrentAtEntry: taken ? openSum / taken : 0, calmar: maxDD > 0 ? (equity - 1) / maxDD : null };
}

// 동시 보유 분포(종목 간 겹침 점검): 진입 시점에 열려 있던 다른 포지션 수의 평균·최대
export function concurrency(trades) {
  const ev = [...trades].sort((a, b) => a.tEntry - b.tEntry); let sum = 0, max = 0;
  for (const t of ev) { const n = ev.filter(o => o !== t && o.tEntry <= t.tEntry && o.tExit > t.tEntry).length + 1; sum += n; max = Math.max(max, n); }
  return { avg: ev.length ? sum / ev.length : 0, max, n: ev.length };
}

export function summary(trades, k = key) {
  const n = trades.length; if (!n) return { n: 0 };
  const rs = trades.map(t => t[k]), w = rs.filter(x => x > 0), l = rs.filter(x => x <= 0), sw = w.reduce((a, b) => a + b, 0), sl = -l.reduce((a, b) => a + b, 0);
  return { n, win: w.length / n, avg: rs.reduce((a, b) => a + b, 0) / n, pf: sl > 0 ? sw / sl : (sw > 0 ? Infinity : 0), total: rs.reduce((a, b) => a + b, 0), ci: blockBootstrap(trades, { k }) };
}

// 그룹 분해: groups = [{ label, test(t) }]. 각 그룹의 n·승률·평균 R·PF·블록 부트스트랩 95% 구간.
export function breakdown(trades, groups, k = key) {
  return groups.map(g => ({ label: g.label, ...summary(trades.filter(g.test), k) }));
}
export const bucket = (v, edges, labels) => { for (let i = 0; i < edges.length; i++) if (v < edges[i]) return labels[i]; return labels[edges.length]; };

const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '∞');
export function mdTable(rows, title = '구분') {
  const head = `| ${title} | 거래 수 | 승률 | 평균 R | PF | 평균 R 95% 구간(주 블록) |\n|---|---|---|---|---|---|`;
  return head + '\n' + rows.map(r => !r.n ? `| ${r.label} | 0 | - | - | - | - |` : `| ${r.label} | ${r.n} | ${(r.win * 100).toFixed(1)}% | ${f(r.avg)} | ${f(r.pf, 2)} | ${r.ci ? `[${f(r.ci[0], 2)}, ${f(r.ci[1], 2)}]` : '산출 불가(표본 부족)'}${r.n < 30 ? ' ⚠n<30' : ''} |`).join('\n');
}
