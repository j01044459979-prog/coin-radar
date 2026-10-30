// 독립 시장 구조 전략 후보의 과거 데이터 검증(순수 함수, 네트워크·Telegram·주문·상태 저장 없음). 운영 신호(evaluateSignal)는 바꾸지 않는다.
//
//  PB  눌림목 지정가 재진입: 4H·1H 2단계 이상(방향·구간·무효화 있음)에서 15분 트리거 없이, 구간 경계(PB-edge) 또는 구간 중앙(PB-mid)에 미리 지정가를 건다.
//      시장가보다 아래(LONG)에 있을 때만, 현재가가 1.5 ATR(1H) 안에 있을 때만 건다. 유효 시간 안에 체결되지 않으면 취소 — 미체결률을 따로 센다.
//  BR  돌파 후 되돌림: 기존 15분 트리거(직전 8봉 극단 확정 돌파 + 방향 봉 + 거래량 ×1.2 + 급변 봉 아님)가 맞았지만 시장가로 쫓지 않고, 돌파한 가격(level)으로 되돌아올 때 지정가로 진입한다.
//
// 공통 보수 가정: 같은 봉에서 체결과 손절이 모두 가능하면 체결 후 손절. 체결과 같은 봉의 목표 도달은 인정하지 않는다(다음 봉부터). 체결 전에 1차 목표가 먼저 닿으면 취소(놓친 이동).
// 갭으로 시가가 이미 지정가보다 유리해도 지정가 가격에 체결한 것으로 본다(유리한 갭을 인정하지 않음). 손절은 꼬리 기준(스탑주문 모형), 갭이면 시가.
// 손절 기준과 목표는 기존 분석(a.invalidation, a.obstacles)을 그대로 쓰고, 지정가 가격 기준으로 손절 거리(1.0~3.5 ATR)·비용 반영 1차 목표 손익비(≥ minRR)를 다시 확인한다.
import { analyzeCoin } from '../opportunity/analysis.mjs';
import { H1, H4 } from '../opportunity/indicators.mjs';
import { clusterBootstrap } from '../opportunity/backtest.mjs';
import { buildFrames, SBT, summarizeSignals } from './backtest.mjs';
import { M15, SIG } from './evaluate.mjs';

export const ALT = Object.freeze({ armBars: 16, retestBars: 8, horizon: SBT.horizon15, approachAtr: 1.5, minRR: SBT.minRR, costBps: SBT.costBps, stressBps: SBT.stressBps, cooldownBars: 8 });

// 지정가 가격 기준 1차·2차 목표(기존 evaluateSignal과 같은 규칙: 1차는 1R 이상 거리, 2차는 1차보다 0.5R 이상 먼 구간). 비용은 R로 환산해 뺀다.
export function altTargets(a, dir, entry, stop, { costBps = ALT.costBps, P = SIG } = {}) {
  const s = dir === 'LONG' ? 1 : -1, risk = (entry - stop) * s;
  if (!(risk > 0)) return null;
  const cand = (a.obstacles ?? []).map(o => ({ ...o, dist: (o.price - entry) * s })).filter(o => o.dist > 0).map(o => ({ ...o, rr: o.dist / risk })).sort((p, q) => p.dist - q.dist);
  const t1 = cand.find(o => o.rr >= P.firstTargetMinR) ?? null, t2 = t1 ? cand.find(o => o.rr >= t1.rr + P.t2ExtraR) ?? null : null, costR = entry * costBps / 10000 / risk;
  return t1 ? { risk, t1: t1.price, rr1: t1.rr, net1: t1.rr - costR, t2: t2?.price ?? null } : null;
}

// 지정가 한 건의 결과. i: 주문을 건 봉(마감), 체결 검사는 i+1 봉부터 validBars개. 반환 { filled:false, why } | { filled:true, kind, gross, net, netStress, mae, mfe, bars, riskPct, fillBar }
export function limitOutcome(c15, i, dir, limit, stop, t1, { validBars = ALT.armBars, horizon = ALT.horizon, costBps = ALT.costBps, stressBps = ALT.stressBps } = {}) {
  const s = dir === 'LONG' ? 1 : -1, risk = (limit - stop) * s;
  if (!(risk > 0)) return { filled: false, why: 'invalid' };
  let fill = -1;
  for (let j = i + 1; j <= Math.min(c15.length - 1, i + validBars); j++) {
    const b = c15[j], touch = s > 0 ? b.l <= limit : b.h >= limit;
    if (touch) { fill = j; break; }
    if ((s > 0 ? b.h >= t1 : b.l <= t1)) return { filled: false, why: 'missed' };                 // 체결 전에 1차 목표가 먼저 닿음
    if ((s > 0 ? b.l <= stop : b.h >= stop)) return { filled: false, why: 'invalid' };
  }
  if (fill < 0) return { filled: false, why: i + validBars >= c15.length ? 'data-end' : 'expired' };
  const last = Math.min(c15.length - 1, fill + horizon);
  let exit = null, kind = 'time', mae = 0, mfe = 0, bars = last - fill;
  for (let j = fill; j <= last; j++) {
    const b = c15[j];
    mae = Math.max(mae, (limit - (s > 0 ? b.l : b.h)) * s / risk); if (j > fill) mfe = Math.max(mfe, ((s > 0 ? b.h : b.l) - limit) * s / risk);
    const stopHit = s > 0 ? b.l <= stop : b.h >= stop, tgtHit = j > fill && (s > 0 ? b.h >= t1 : b.l <= t1);
    if (stopHit) { exit = j > fill && (b.o - stop) * s < 0 ? b.o : stop; kind = 'stop'; bars = j - fill; break; }
    if (tgtHit) { exit = t1; kind = 'target'; bars = j - fill; break; }
  }
  if (exit === null) exit = c15[last].c;
  const gross = (exit - limit) * s / risk, cr = bps => limit * bps / 10000 / risk;
  return { filled: true, kind, gross, net: gross - cr(costBps), netStress: gross - cr(stressBps), mae, maePct: mae * risk / limit * 100, mfe, bars, riskPct: risk / limit * 100, fillBar: fill };
}

const rangeOk = (riskAtr, P = SIG) => riskAtr >= P.stopMinAtr1 && riskAtr <= P.stopMaxAtr1;

// 코인 하나의 전략 후보 이벤트: { PBedge, PBmid, BR } 각 배열에 { symbol, i, t, dir, limit, stop, riskAtr, rr1, net1, res }.
// res 는 limitOutcome 결과(체결 안 됨 포함). 같은 (방향, 구간)은 쿨다운 동안 다시 걸지 않는다.
export function collectAltEvents(symbol, c15, btc15 = null, { from = SBT.warm15, P = SIG, A = ALT } = {}) {
  const { c1h, c4h } = buildFrames(c15), btc4 = btc15 ? buildFrames(btc15).c4h : null;
  const out = { PBedge: [], PBmid: [], BR: [] }, last = { PBedge: new Map(), PBmid: new Map(), BR: new Map() };
  let p1 = 0, p4 = 0, pb = 0, cacheKey = -1, a = null;
  for (let i = from; i < c15.length - 1; i++) {
    const closeT = c15[i].t + M15;
    while (p1 < c1h.length && c1h[p1].t + H1 <= closeT) p1++;
    while (p4 < c4h.length && c4h[p4].t + H4 <= closeT) p4++;
    while (btc4 && pb < btc4.length && btc4[pb].t + H4 <= closeT) pb++;
    if (p1 < 100 || p4 < 210) continue;
    if (p1 !== cacheKey) { a = analyzeCoin(c1h.slice(Math.max(0, p1 - SBT.win1h), p1), c4h.slice(Math.max(0, p4 - SBT.win4h), p4), btc4 ? btc4.slice(Math.max(0, pb - SBT.win4h), pb) : null); cacheKey = p1; }
    if (a.status !== 'ok' || a.stage < 2 || !a.dir || !a.zone || !(a.invalidation > 0) || !(a.metrics.atr1 > 0)) continue;
    const L = a.dir === 'LONG', s = L ? 1 : -1, z = a.zone, a1 = a.metrics.atr1, stop = a.invalidation, bar = c15[i], zoneKey = `${a.dir}:${Number(z.level).toPrecision(8)}`;
    const add = (name, limit) => {
      const k = last[name].get(zoneKey); if (k !== undefined && i - k < A.armBars + A.cooldownBars) return;
      const risk = (limit - stop) * s; if (!(risk > 0) || !rangeOk(risk / a1, P)) return;
      const tg = altTargets(a, a.dir, limit, stop, { costBps: A.costBps, P }); if (!tg || tg.net1 < A.minRR) return;
      last[name].set(zoneKey, i);
      out[name].push({ symbol, i, t: closeT, dir: a.dir, limit, stop, riskAtr: risk / a1, rr1: tg.rr1, net1: tg.net1, stage: a.stage, score: a.score?.total ?? null, res: limitOutcome(c15, i, a.dir, limit, stop, tg.t1, { validBars: name === 'BR' ? A.retestBars : A.armBars, horizon: A.horizon, costBps: A.costBps, stressBps: A.stressBps }) });
    };
    // 눌림목 지정가: 지정가가 시장가보다 유리한 쪽에 있고 1.5 ATR 안에 있을 때만
    for (const [name, limit] of [['PBedge', L ? z.hi : z.lo], ['PBmid', (z.lo + z.hi) / 2]]) if ((bar.c - limit) * s > 0 && (bar.c - limit) * s <= A.approachAtr * a1) add(name, limit);
    // 돌파 후 되돌림: 기존 15분 트리거 + 거래량 + 급변 봉 아님. 돌파한 가격으로 되돌아올 때 지정가
    const prior = c15.slice(i - P.trigBars, i), level = L ? Math.max(...prior.map(x => x.h)) : Math.min(...prior.map(x => x.l)), win = c15.slice(i - P.volBase, i);
    const base = win.reduce((x, y) => x + (Number.isFinite(y.q) ? y.q : 0), 0) / P.volBase, volRel = base > 0 ? bar.q / base : null, dirBar = L ? bar.c > bar.o : bar.c < bar.o;
    if ((bar.c - level) * s > 0 && dirBar && volRel !== null && volRel >= P.volMult && bar.h - bar.l <= P.maxTrigRangeAtr1 * a1) add('BR', level);
  }
  return out;
}

// 집계: 체결률·미체결 사유, 체결된 건의 승률(목표 선도달)·비용 반영 기대값, 신호(주문 건) 단위 기대값(미체결 0R), 최대 손실(R·%).
export function summarizeAlt(rows, { coins, days } = {}) {
  const filled = rows.filter(x => x.res.filled), n = rows.length, why = k => rows.filter(x => !x.res.filled && x.res.why === k).length;
  const sh = summarizeSignals(filled.map(x => ({ ...x, res: { wick: { ...x.res, riskPct: x.res.riskPct } } })), 'wick', { coins, days });
  const netAll = n ? filled.reduce((x, y) => x + y.res.net, 0) / n : null, worst = filled.length ? Math.min(...filled.map(x => x.res.net)) : null;
  const ci = clusterBootstrap(filled, x => x.res.net);
  return { armed: n, filled: filled.length, fillRate: n ? filled.length / n : null, missed: n ? why('missed') / n : null, expired: n ? why('expired') / n : null, invalid: n ? why('invalid') / n : null,
    perCoinDay: coins && days ? filled.length / coins / days : null, win: sh.target, stop: sh.stop, time: sh.time, netR: sh.netR, ciLo: ci.lo, ciHi: ci.hi, netStressR: sh.netStressR, perArmedR: netAll, worstR: worst, maeP90R: sh.maeP90R, plannedRR1: sh.plannedRR1 };
}
