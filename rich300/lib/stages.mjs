// 분할 진입 가격 산출(순수 함수): 2·3차 가격을 고정 −0.3R/−0.6R 로 찍지 않고 *시장 구조*에서 찾아 검증한다. 주문이 아니라 계산이다.
//  · 후보 가격: 1H 지지·저항 구간 경계 · 돌파 기준선 되돌림 · 1H/4H/15분 스윙 저점(고점) · 1H 20EMA. 각 후보에 가중치(4H 3 · 구간 3 · 1H 2 · 돌파선 2 · 15분 1 · EMA 1)를 주고, 가까운 후보(0.08R 이내)는 한 곳으로 합쳐 근거를 모은다.
//  · 지정가는 지지선 *바로 위*(롱)·저항선 *바로 아래*(숏)에 둔다(ATR 의 10% 또는 0.03R 중 큰 값). 구조 근거 점수가 3 미만이면 그 단계는 만들지 않는다 — 억지로 분할하지 않는다.
//  · 검증: 1차 가격에서 0.25 ATR(1H) 이상 떨어질 것(잡음 체결 방지) · 단계 간격 ≥ max(0.15R, 0.25 ATR) · 손절선에서 0.2R 이상 위일 것 · 2차는 0.2~0.6R, 3차는 2차+0.15R~0.8R 깊이.
//  · 추세: 4H 추세가 포지션 반대면 추가 진입 없음, 1H 추세가 반대면 최대 2차까지. 15분 추세는 근거로만 표시한다.
//  · 모든 이름은 stg 접두사(번들 이름 충돌 방지). 반환 addR 은 scaleplan.mjs 의 params.addR 로 그대로 넘긴다(그 파일은 바꾸지 않는다).
import { splanSign } from './scaleplan.mjs';
import { watchTrend, watchEma } from './watch.mjs';

export const STG = Object.freeze({ s2: Object.freeze([0.2, 0.6]), s3Max: 0.8, gap3R: 0.15, minGapR: 0.15, minGapAtr: 0.25, minFromE1Atr: 0.25, stopRoomR: 0.2, cluster: 0.08, minScore: 3, bufAtr: 0.1, bufR: 0.03, target2: 0.4, target3: 0.65,
  pivots1h: 72, pivots4h: 30, pivots15: 48 });
export function stgAtr(bars, n = 14) {
  if (!Array.isArray(bars) || bars.length < n + 1) return null;
  const tr = []; for (let i = 1; i < bars.length; i++) tr.push(Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c)));
  let a = tr.slice(0, n).reduce((x, y) => x + y, 0) / n; for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return Number.isFinite(a) && a > 0 ? a : null;
}
// 확정된 피벗(좌우 k봉보다 높은(낮은) 점). kind 'low' | 'high'. 최근 last 봉 안에서만.
export function stgPivots(bars, kind, k, last) {
  if (!Array.isArray(bars)) return []; const from = Math.max(k, bars.length - last), out = [];
  for (let i = from; i < bars.length - k; i++) {
    let ok = true, v = kind === 'low' ? bars[i].l : bars[i].h;
    for (let j = 1; j <= k && ok; j++) { const a = kind === 'low' ? bars[i - j].l : bars[i - j].h, b = kind === 'low' ? bars[i + j].l : bars[i + j].h; if (kind === 'low' ? !(v < a && v <= b) : !(v > a && v >= b)) ok = false; }
    if (ok) out.push({ price: v, t: bars[i].t });
  }
  return out;
}
const stgTrendKo = t => ({ up: '상승', down: '하락', flat: '횡보', unknown: '확인 불가' }[t && t.state] || '확인 불가');
// in: { dir, entry, stop, atr1?(없으면 1H 봉으로 계산), zone:{lo,hi}|null, level|null, bars1h, bars4h, bars15m }
// out: { ok, atr, R, trends:{m15,h1,h4}, stages:[{n, price, depthR, score, why:[…]}] (2·3차만), addR:[…], notes:[…], rejected:[…] }
export function stgPlan(inp) {
  const L = inp.dir === 'LONG', s = splanSign(inp.dir), E = Number(inp.entry), S = Number(inp.stop), R = (E - S) * s;
  const out = { ok: false, R, atr: null, trends: {}, stages: [], addR: [], notes: [], rejected: [] };
  if (!(R > 0) || !(E > 0)) { out.notes.push('손절가가 방향과 맞지 않음'); return out; }
  const b1 = inp.bars1h || [], b4 = inp.bars4h || [], b15 = inp.bars15m || [];
  const atr = stgAtr(b1) || (Number(inp.atr1) > 0 ? Number(inp.atr1) : null); out.atr = atr;
  const tr = { m15: watchTrend(b15), h1: watchTrend(b1), h4: watchTrend(b4) }; out.trends = { m15: stgTrendKo(tr.m15), h1: stgTrendKo(tr.h1), h4: stgTrendKo(tr.h4) };
  out.ok = true; if (atr === null) { out.notes.push('변동성(ATR) 계산 불가 — 추가 진입 가격을 만들지 않음'); return out; }
  const against = t => (L ? t.state === 'down' : t.state === 'up');
  let maxStages = 3;
  if (against(tr.h4)) { maxStages = 1; out.notes.push(`4시간 추세가 ${out.trends.h4} — ${L ? '롱' : '숏'} 추가 진입(물타기) 금지, 1차 단독`); }
  else if (against(tr.h1)) { maxStages = 2; out.notes.push(`1시간 추세가 ${out.trends.h1} — 추가 진입은 2차까지만`); }
  if (maxStages === 1) return out;
  const depth = p => (E - p) * s / R, cands = [], add = (price, kind, w, label) => { if (Number.isFinite(price) && price > 0) cands.push({ price, kind, w, label }); };
  const z = inp.zone;
  if (z && Number.isFinite(z.lo) && Number.isFinite(z.hi)) { add(z.lo, 'zone', 3, `1H ${L ? '지지' : '저항'} 구간 ${L ? '하단' : '하단'} ${'{p}'}`); add(z.hi, 'zone', 3, `1H ${L ? '지지' : '저항'} 구간 ${L ? '상단' : '상단'} ${'{p}'}`); }
  if (Number.isFinite(inp.level)) add(Number(inp.level), 'level', 2, `15분 돌파 기준선 되돌림 ${'{p}'}`);
  const kind = L ? 'low' : 'high', nm = L ? '저점' : '고점';
  for (const p of stgPivots(b1, kind, 2, STG.pivots1h)) add(p.price, 'p1h', 2, `1시간 스윙 ${nm} ${'{p}'}`);
  for (const p of stgPivots(b4, kind, 1, STG.pivots4h)) add(p.price, 'p4h', 3, `4시간 스윙 ${nm} ${'{p}'}`);
  for (const p of stgPivots(b15, kind, 2, STG.pivots15)) add(p.price, 'p15', 1, `15분 스윙 ${nm} ${'{p}'}`);
  if (b1.length >= 25) { const e = watchEma(b1.map(b => b.c), 20); if (e) add(e, 'ema', 1, `1H 20EMA ${'{p}'}`); }
  const buf = Math.max(STG.bufAtr * atr, STG.bufR * R), place = c => c + s * buf;
  // 구조 후보를 가까운 것끼리 묶는다(가장 큰 가중치 가격을 대표로, 점수는 합)
  const groups = []; for (const c of [...cands].sort((a, b) => b.w - a.w || depth(a.price) - depth(b.price))) { const g = groups.find(x => Math.abs(x.rep.price - c.price) <= STG.cluster * R); if (g) { g.score += c.w; g.members.push(c); } else groups.push({ rep: c, score: c.w, members: [c] }); }
  const usable = g => { const p = place(g.rep.price), d = depth(p); return { g, p, d }; };
  const valid = (lo, hi, prevP) => groups.map(usable).filter(x => x.d >= lo && x.d <= hi && x.g.score >= STG.minScore && (E - x.p) * s >= STG.minFromE1Atr * atr && (x.p - S) * s >= STG.stopRoomR * R
    && (prevP === undefined || Math.abs(prevP - x.p) >= Math.max(STG.minGapR * R, STG.minGapAtr * atr)));
  for (const g of groups.map(usable)) if (g.g.score < STG.minScore && g.d >= STG.s2[0] && g.d <= STG.s3Max) out.rejected.push({ price: g.p, why: '구조 근거 점수 부족' });
  const fmt = p => Number(p).toFixed(Math.max((String(E).split('.')[1] || '').length, 2));
  const mk = (x, n) => ({ n, price: x.p, depthR: Number(x.d.toFixed(4)), score: x.g.score, why: x.g.members.sort((a, b) => b.w - a.w).slice(0, 3).map(m => m.label.replace('{p}', fmt(m.price))) });
  const c2s = valid(STG.s2[0], STG.s2[1]);
  if (!c2s.length) { out.notes.push('2차로 쓸 만한 구조 가격(지지·저항·스윙)이 눌림 구간에 없음 — 억지로 분할하지 않고 1차 단독'); return out; }
  // 2·3차를 *함께* 놓을 수 있는 조합을 먼저 찾는다(근거 점수 합 → 목표 깊이(0.4R/0.65R)에 가까운 순). 3차가 없으면 2차 단독 최선안.
  let best = null;
  if (maxStages >= 3) for (const c2 of c2s) for (const c3 of valid(c2.d + STG.gap3R, STG.s3Max, c2.p)) { const sc = c2.g.score + c3.g.score, dist = Math.abs(c2.d - STG.target2) + Math.abs(c3.d - STG.target3); if (!best || sc > best.sc || (sc === best.sc && dist < best.dist)) best = { c2, c3, sc, dist }; }
  if (best) { out.stages.push(mk(best.c2, 2), mk(best.c3, 3)); }
  else { c2s.sort((a, b) => b.g.score - a.g.score || Math.abs(a.d - STG.target2) - Math.abs(b.d - STG.target2)); out.stages.push(mk(c2s[0], 2)); if (maxStages >= 3) out.notes.push('3차로 쓸 만한 구조 가격이 없음 — 2차까지만 분할'); }
  out.addR = out.stages.map(x => x.depthR);
  return out;
}
