// RICH300 추천 전략 자동 추적: COIN RADAR 가 알린 진입 후보(피드)로 *전략*을 만들고, 추천부터 종료까지 시세만으로 가상 추적한다. 주문·계정 API 없음, 사용자의 수동 등록 불필요.
//  · 모든 진입·익절·손절은 '전략 기준 가상 체결'이다 — 사용자의 실제 Binance 체결이 아니다. 실제 포지션(Fills·ManualPositions)과 별도 시트(Strategies)·별도 성과로만 다룬다.
//  · 상태: CANDIDATE → WAIT_ENTRY → ENTRY_TRIGGERED → TRACKING → TP1 → TP2 → TRAILING … 종료: DONE(전량 익절) · STOP · INVALIDATED · EXPIRED · CANCELLED(위험 한도 등으로 추천 제외)
//  · 보수적 판정(15분 봉 기준, 봉 안에서 선후를 알 수 없을 때 불리한 쪽): ① 진입 체결과 손절이 같은 봉이면 진입 후 손절 ② 같은 봉에서 손절과 익절이 모두 닿으면 손절 ③ 체결이 일어난 봉에서는 익절을 인정하지 않음
//    ④ 본전·추적 손절은 *다음 봉*부터 적용 ⑤ 지정가는 해당 가격에 닿을 때만 체결(통과해도 더 좋은 체결 가정 없음) ⑥ 추천 시각 *이후*에 시작한 봉만 사용(이미 지나간 봉으로 체결을 만들지 않는다)
//  · 위험 한도: 평가액 300 USDT 기준, 거래당 위험 1%(점수 80 이상 1.5%), 격리 최대 3배, 동시 사용 증거금 30%, 일일 가상 손실 −3% 도달 시 신규 추천 제외. 한도를 넘는 전략은 일반 추천으로 보내지 않는다.
//  · 알림은 위치 감시와 같은 전송 규칙(한 번만·실패 재시도·상한)을 쓰되 상태는 별도 접두어(sg:)에 둔다.
import { splanBuild, splanSign, splanTpLegs, splanExec, splanStopExec, splanReasonText, splanQty, splanDecimals } from './scaleplan.mjs';
import { storeList, storeGet, storeCreate, storeRevise } from './store.mjs';
import { kstDayOf } from './time.mjs';
import { nullishOr } from './nullish.mjs';
import { feedVerify, feedParseEntry } from './feed.mjs';
import { WATCH, watchAssessMarket, watchTrend, watchVolRatio, wDeliver, wLoadState, wSaveState, wFmt, wAgainst } from './watch.mjs';

export const STRAT = Object.freeze({
  equity: 300, riskBase: 0.01, riskStrong: 0.015, strongScore: 80, dayLossPct: 0.03, maxMarginUsage: 0.3, maxActive: 10, maxNewPerTick: 3,
  nearEntryR: 0.3, stopNearR: 0.25, stopNearRearmR: 0.5, trailStepR: 0.25, weakStopR: 0.6, weakVol: 1.2, weakCooldownMs: 3600000,
  maxTrackMs: 72 * 3600000, barMs: 900000, keepKvMs: 3 * 86400000, retryNoteMs: 6 * 3600000,
});
export const STRAT_ACTIVE = Object.freeze(['CANDIDATE', 'WAIT_ENTRY', 'ENTRY_TRIGGERED', 'TRACKING', 'TP1', 'TP2', 'TRAILING']);
export const STRAT_ENDED = Object.freeze(['DONE', 'STOP', 'INVALIDATED', 'EXPIRED', 'CANCELLED']);
export const STRAT_LABEL = Object.freeze({ CANDIDATE: '추천 후보', WAIT_ENTRY: '진입 대기', ENTRY_TRIGGERED: '진입 조건 충족', TRACKING: '추적 중', TP1: 'TP1 도달', TP2: 'TP2 도달', TRAILING: '트레일링', DONE: '목표 완료', STOP: '손절', INVALIDATED: '무효화', EXPIRED: '만료', CANCELLED: '추천 취소' });
export const sgyIsActive = st => STRAT_ACTIVE.includes(st);
const sgyOpenOf = x => x.fills.reduce((a, f) => a + f.qty, 0) - x.legs.reduce((a, l) => a + l.qty, 0) - (x.stopExit ? x.stopExit.qty : 0) - (x.timeExit ? x.timeExit.qty : 0);
const sgyEnteredOf = x => x.fills.reduce((a, f) => a + f.qty, 0);
const sgyAvgExec = x => { const q = sgyEnteredOf(x); return q > 0 ? x.fills.reduce((a, f) => a + f.exec * f.qty, 0) / q : null; };
const sgyKst = ms => new Date(ms + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' ');
const sgyHm = ms => new Date(ms + 9 * 3600000).toISOString().slice(11, 16);
const sgyBase = sym => String(sym).replace(/USDT$/, '');
export const sgyRiskPct = score => (Number.isFinite(score) && score >= STRAT.strongScore ? STRAT.riskStrong : STRAT.riskBase);

// ── 생성 ──
// fe: feedParseEntry 결과(candidate). ctx: { now, activeMargin, dayPnl }. 반환 { ok, s } | { ok:false, reason, notify, s? } — 거절도 CANCELLED 기록으로 남긴다.
export function sgyBuild(fe, { now, activeMargin = 0, dayPnl = 0, activeCount = 0 }) {
  const base = { sid: fe.sid, symbolId: fe.symbolId, dir: fe.dir, createdAt: now, updatedAt: now, score: fe.score === null ? undefined : fe.score, entry: String(fe.entry), stop: String(fe.stop) };
  const x0 = { validUntil: fe.validUntil, closeT: fe.closeT, triggerT: fe.triggerT, startT: 0, lastBarT: 0, fills: [], legs: [], events: [], stopPrice: fe.stop, stopKind: 'initial', rr1: fe.rr1, ref1: fe.ref1, ref2: fe.ref2, evidence: fe.evidence, volRel: fe.volRel, btcAlign: fe.btcAlign, costPct: fe.costPct, kind: 'virtual' };
  const cancel = (reason, notify, plan) => ({ ok: false, reason, notify, s: { ...base, state: 'CANCELLED', endedAt: now, x: { ...x0, reason, ...(plan ? { plan } : {}) } } });
  if (now > fe.validUntil) return cancel('expired-on-arrival', false);
  if (activeCount >= STRAT.maxActive) return cancel('too-many-active', true);
  if (dayPnl <= -STRAT.dayLossPct * STRAT.equity) return cancel('day-loss-limit', true);
  const riskPct = sgyRiskPct(fe.score), plan = splanBuild({ symbol: fe.symbolId, dir: fe.dir, entry: fe.entry, stop: fe.stop, equity: STRAT.equity, params: { riskPct } });
  if (plan.status !== 'ok') return cancel(`plan-${plan.reason}`, true);
  if (plan.lev > 3) return cancel('leverage-over-3x', true);
  if (activeMargin + plan.totalMargin > STRAT.maxMarginUsage * STRAT.equity + 1e-9) return cancel('margin-cap-total', true, plan);
  return { ok: true, s: { ...base, state: 'CANDIDATE', x: { ...x0, plan, riskLabel: riskPct === STRAT.riskStrong ? 'strong' : 'base', riskPct } } };
}

// ── 봉 처리(순수) ──
const sgyTouch = (dir, b, p) => (dir === 'LONG' ? b.l <= p : b.h >= p);
const sgyReach = (dir, b, p) => (dir === 'LONG' ? b.h >= p : b.l <= p);
function sgyFinish(s, state, at, reason, markPrice) {
  const x = s.x, plan = x.plan, sg = splanSign(s.dir), f = plan.params.feeBps / 10000, entered = sgyEnteredOf(x);
  s.state = state; s.endedAt = at; x.reason = reason;
  if (entered > 0) {
    let gross = 0, fee = 0; const avg = sgyAvgExec(x);
    for (const fl of x.fills) fee += f * fl.exec * fl.qty;
    for (const l of x.legs) { gross += (l.price - avg) * sg * l.qty; fee += f * l.price * l.qty; }
    if (x.stopExit) { gross += (x.stopExit.exec - avg) * sg * x.stopExit.qty; fee += f * x.stopExit.exec * x.stopExit.qty; }
    const open = sgyOpenOf(x);
    if (open > 1e-12 && markPrice !== undefined) { x.timeExit = { at, price: markPrice, qty: open }; gross += (markPrice - avg) * sg * open; fee += f * markPrice * open; }
    const net = gross - fee;
    x.result = { usdt: net, gross, fee, pct: net / plan.equity, r: net / (plan.R * entered), entered, avgEntry: avg };
  } else x.result = null;
  return s;
}
const sgyEv = (x, type, at, price, extra) => { const e = { type, at, price, ...(extra || {}) }; x.events.push(e); if (x.events.length > 40) x.events.shift(); return e; };

// bars: [{t,o,h,l,c,v,dur,coarse?}] 오래된 것 → 최신, *마감된 봉만*. 반환 { s, events } (s 는 복사본)
export function sgyRunBars(s0, bars, now) {
  const s = JSON.parse(JSON.stringify(s0)), x = s.x, plan = x.plan, sg = splanSign(s.dir), R = plan.R, events = [];
  for (const b of bars) {
    if (!sgyIsActive(s.state) || s.state === 'CANDIDATE') break;
    if (s.state === 'ENTRY_TRIGGERED') s.state = 'TRACKING'; else if (s.state === 'TP2') s.state = 'TRAILING';           // 한 봉 이상 지난 뒤에야 다음 상태로(알림이 나간 상태를 한 번은 보여 준다)
    if (b.t < x.startT || b.t <= x.lastBarT || b.t + b.dur > now) continue;
    x.lastBarT = b.t;
    const note = b.coarse ? { coarse: true } : undefined;
    let entered = sgyEnteredOf(x) > 0, filledNow = false;
    if (!entered && b.t >= x.validUntil) { sgyFinish(s, 'EXPIRED', x.validUntil, 'entry-window-passed'); events.push(sgyEv(x, 'EXPIRED', x.validUntil, undefined)); break; }
    // 진입·추가 진입(사전 지정 가격에 닿을 때만)
    for (const st of plan.stages) {
      if (x.fills.some(fl => fl.n === st.n) || x.events.some(e => e.type === 'ADD_CANCEL' && e.n === st.n)) continue;           // 취소 알림이 나간 단계는 다시 체결하지 않는다
      if (st.n === 1) { if (!sgyTouch(s.dir, b, st.price)) continue; }
      else {
        if (!x.fills.some(fl => fl.n === st.n - 1) || x.legs.length > 0) { if (x.legs.length > 0) { events.push(sgyEv(x, 'ADD_CANCEL', b.t, st.price, { n: st.n, reason: 'after-tp' })); } continue; }
        if (!sgyTouch(s.dir, b, st.price)) continue;
        const bars15 = Math.max(0, Math.floor((b.t - x.closeT) / STRAT.barMs));
        if (Number.isFinite(x.lastClose) && (x.lastClose - plan.add.structurePrice) * sg <= 0) { if (!x.events.some(e => e.type === 'ADD_CANCEL' && e.n === st.n)) events.push(sgyEv(x, 'ADD_CANCEL', b.t, st.price, { n: st.n, reason: 'structure' })); continue; }
        if (bars15 > plan.add.window) { if (!x.events.some(e => e.type === 'ADD_CANCEL' && e.n === st.n)) events.push(sgyEv(x, 'ADD_CANCEL', b.t, st.price, { n: st.n, reason: 'window' })); continue; }
      }
      x.fills.push({ n: st.n, price: st.price, exec: st.execPrice, qty: st.qty, at: b.t, ...(note || {}) }); filledNow = true;
      if (st.n === 1) { s.state = 'ENTRY_TRIGGERED'; x.entryAt = b.t; events.push(sgyEv(x, 'ENTRY', b.t, st.price, { ...(note || {}) })); } else events.push(sgyEv(x, 'ADD', b.t, st.price, { n: st.n, ...(note || {}) }));
    }
    entered = sgyEnteredOf(x) > 0;
    if (!entered) {                                                                         // 진입 전: 목표 1차가 먼저 닿으면 추격 금지(무효)
      if (sgyReach(s.dir, b, plan.tps[0].price)) { sgyFinish(s, 'INVALIDATED', b.t, 'tp1-before-entry'); events.push(sgyEv(x, 'INVALIDATED', b.t, undefined, { reason: 'tp1-before-entry' })); break; }
      x.lastClose = b.c; continue;
    }
    // 손절(진입·추가 체결이 있었던 봉에도 먼저 적용 — 보수적)
    const sp = x.stopPrice;
    if (sg > 0 ? b.l <= sp : b.h >= sp) {
      const open = sgyOpenOf(x), exec = splanStopExec(s.dir, sp, plan.params.stopSlipBps); x.stopExit = { at: b.t, price: sp, exec, qty: open, kind: x.stopKind };
      sgyFinish(s, 'STOP', b.t, x.stopKind === 'initial' ? 'stop' : x.stopKind === 'breakeven' ? 'breakeven-stop' : 'trailing-stop'); events.push(sgyEv(x, 'STOP', b.t, sp, { kind: x.stopKind, ...(note || {}) })); break;
    }
    // 익절(체결이 있었던 봉에서는 인정하지 않는다). 최소 주문 단위 때문에 TP1 수량이 0 으로 합쳐진 계획은 TP1 을 건너뛰고 TP2 에 합쳐 청산한다.
    if (!filledNow) {
      const legs = splanTpLegs(plan, sgyEnteredOf(x)).legs, merged1 = legs[0].qty <= 0;
      for (const leg of legs) {
        if (x.legs.some(l => l.n === leg.n) || leg.qty <= 0) continue;
        if (leg.n === 2 && !merged1 && !x.legs.some(l => l.n === 1)) continue;
        if (!sgyReach(s.dir, b, leg.price)) continue;
        x.legs.push({ n: leg.n, price: leg.price, qty: leg.qty, at: b.t }); s.state = leg.n === 1 ? 'TP1' : 'TP2'; events.push(sgyEv(x, leg.n === 1 ? 'TP1' : 'TP2', b.t, leg.price, { qty: leg.qty, ...(note || {}) }));
      }
    }
    const merged = splanTpLegs(plan, sgyEnteredOf(x)).legs[0].qty <= 0, tp2Done = x.legs.some(l => l.n === 2), tp1Done = x.legs.some(l => l.n === 1) || (merged && tp2Done);
    if (sgyOpenOf(x) <= 1e-12) { sgyFinish(s, 'DONE', b.t, 'all-targets'); events.push(sgyEv(x, 'DONE', b.t, undefined)); break; }
    // 다음 봉부터 적용되는 손절 이동: TP1 후 본전, TP2 후 최고(최저)−1R(본전 아래로 내리지 않음)
    const avg = sgyAvgExec(x);
    if (tp1Done && x.stopKind === 'initial') { x.stopPrice = avg; x.stopKind = 'breakeven'; events.push(sgyEv(x, 'BE', b.t, avg)); }
    if (tp2Done) {
      x.ext = x.ext === undefined ? (sg > 0 ? b.h : b.l) : (sg > 0 ? Math.max(x.ext, b.h) : Math.min(x.ext, b.l));
      const trail = x.ext - sg * plan.params.trailR * R, want = sg > 0 ? Math.max(avg, trail) : Math.min(avg, trail);
      if ((want - x.stopPrice) * sg > 0) { const step = (want - x.stopPrice) * sg; x.stopKind = 'trailing'; x.stopPrice = want; if (step >= STRAT.trailStepR * R || !x.trailAnnounced) { x.trailAnnounced = true; events.push(sgyEv(x, 'TRAIL', b.t, want)); } }
    }
    if (b.t + b.dur - nullishOr(x.entryAt, b.t) > STRAT.maxTrackMs) { sgyFinish(s, 'EXPIRED', b.t + b.dur, 'max-track-time', b.c); events.push(sgyEv(x, 'EXPIRED', b.t + b.dur, b.c, { reason: 'max-track-time' })); break; }
    x.lastClose = b.c;
  }
  if (s.state === 'ENTRY_TRIGGERED' && events.every(e => e.type !== 'ENTRY')) s.state = 'TRACKING'; else if (s.state === 'TP2' && events.every(e => e.type !== 'TP2')) s.state = 'TRAILING';
  s.updatedAt = now;
  return { s, events };
}

// 15분 봉 + 시세 공백 구간은 1시간 봉으로 보충(보수적 규칙 그대로). 마감된 봉만.
export function sgyBarsFor(market, lastBarT, startT, now) {
  const from = Math.max(lastBarT + 1, startT), b15 = (market.bars15m || []).filter(b => b.t >= from && b.t + 900000 <= now).map(b => ({ ...b, dur: 900000 })), out = [];
  const first15 = b15.length ? b15[0].t : now;
  if (first15 - from > 900000) for (const b of (market.bars1h || [])) if (b.t >= from && b.t + 3600000 <= first15) out.push({ ...b, dur: 3600000, coarse: true });
  return out.concat(b15).sort((a, c) => a.t - c.t);
}

// ── 시세 기준 점검(봉 마감 전 알림): 진입 접근·손절 접근·추세 약화·진입 전 4시간 추세 반전 ──
export function sgyNotes(s, { price, market, now }, ns) {
  const x = s.x, plan = x.plan, sg = splanSign(s.dir), R = plan.R, out = [], armed = ns.armed || (ns.armed = {}), last = ns.last || (ns.last = {});
  if (s.state === 'WAIT_ENTRY') {
    const d = (price - plan.stages[0].price) * sg;                                                // >0 이면 진입가보다 유리한 쪽(눌림 전)
    if (armed.entryNear === undefined) armed.entryNear = d > STRAT.nearEntryR * R;                  // 처음 볼 때 이미 가까우면 '접근' 알림 없이 소진(신규 추천 메시지에 이미 현재가가 있다)
    else if (d > STRAT.nearEntryR * R) armed.entryNear = true;
    if (d >= 0 && d <= STRAT.nearEntryR * R && armed.entryNear !== false) { armed.entryNear = false; out.push({ type: 'ENTRY_NEAR', key: `ENTRY_NEAR:${s.sid}`, level: 'info', price }); }
    const t4 = market ? watchTrend(market.bars4h) : { state: 'unknown' };
    if (wAgainst(t4, s.dir)) out.push({ type: 'TREND_INVALID', key: `TREND_INVALID:${s.sid}`, level: 'warn', price, terminal: true, reason: '4h-trend-flip' });
  } else if (['ENTRY_TRIGGERED', 'TRACKING', 'TP1', 'TP2', 'TRAILING'].includes(s.state)) {
    const dStop = (price - x.stopPrice) * sg;
    if (dStop > STRAT.stopNearRearmR * R) armed.stopNear = true;
    if (dStop > 0 && dStop <= STRAT.stopNearR * R && armed.stopNear !== false) { armed.stopNear = false; ns.nNear = (ns.nNear || 0) + 1; out.push({ type: 'STOP_NEAR', key: `STOP_NEAR:${s.sid}:${ns.nNear}`, level: 'critical', price, dStopR: dStop / R }); }
    const t1 = market ? watchTrend(market.bars1h) : { state: 'unknown' }, v1 = market ? watchVolRatio(market.bars1h) : null;
    if (dStop > 0 && dStop <= STRAT.weakStopR * R && wAgainst(t1, s.dir) && v1 !== null && v1 >= STRAT.weakVol && now - nullishOr(last.WEAK, 0) >= STRAT.weakCooldownMs) { last.WEAK = now; out.push({ type: 'WEAK', key: `WEAK:${s.sid}:${market.bars1h[market.bars1h.length - 1].t}`, level: 'warn', price, v1, dStopR: dStop / R }); }
  }
  return out;
}

// ── 메시지 ──
const sgyDp = plan => Math.max(splanDecimals(String(plan.entry)), 2);
const sgyF = (v, plan) => Number(v).toFixed(sgyDp(plan));
const sgyReasonKo = c => ({ 'day-loss-limit': '일일 가상 손실 한도(−3%) 도달 — 오늘 신규 추천 제외', 'too-many-active': `동시 추적 전략 ${STRAT.maxActive}개 초과`, 'margin-cap-total': `동시 사용 증거금이 평가액의 ${Math.round(STRAT.maxMarginUsage * 100)}%를 넘음`, 'leverage-over-3x': '격리 3배 초과 필요', 'expired-on-arrival': '전달 지연으로 유효시간 경과' }[c] || (String(c).startsWith('plan-') ? splanReasonText(String(c).slice(5)) : c));
const SGY_FOOT = '※ 전략 기준 가상 추적 · 실제 Binance 체결 아님 · 자동 주문 아님 · 판단 보조용';
export function sgyNewMessage(s, { price, priceAt, source, now }) {
  const x = s.x, plan = x.plan, F = v => sgyF(v, plan), sg = splanSign(s.dir), icon = s.dir === 'LONG' ? '🟢' : '🔴', L = [];
  L.push(`[RICH300 신규 매매 전략]`, `${icon} ${sgyBase(s.symbolId)} · ${s.dir}${s.score !== undefined ? ` · 추천 점수 ${s.score}` : ''}${x.riskLabel === 'strong' ? ' (강한 조건: 위험 1.5%)' : ' (기본 위험 1%)'}`);
  if (x.evidence && x.evidence.length) { L.push('📈 진입 근거'); for (const e of x.evidence) L.push(`• ${e}`); }
  L.push(`💵 현재가 ${F(price)} (${source || '시세'} ${sgyHm(priceAt)} KST) · 추천 기준가 ${F(plan.entry)}`);
  L.push(`⏱ 진입 유효: ~${sgyKst(x.validUntil)} KST (그 전에 1차가 안 닿으면 만료)`);
  L.push(`🧭 1차 진입 구간 ${F(plan.stages[0].price)}(지정가 기준, 눌림 접근 알림 ${STRAT.nearEntryR}R 이내)`);
  for (const st of plan.stages) L.push(`  ${st.n}차 ${Math.round(st.weight * 100)}% · ${F(st.price)}${st.n > 1 ? ` (−${plan.params.addR[st.n - 2]}R, 구조 유지·TP 전에만)` : ''} · 수량 ${splanQty(st.qty, plan.spec)} · 증거금 ${st.margin.toFixed(2)}`);
  L.push(`🛑 손절 ${F(plan.stop)} (1R=${F(plan.R)}, 고정) · 예상 최대 손실 −${plan.worstLoss.toFixed(2)} USDT (평가액 ${plan.equity} 의 ${(plan.worstLossPct * 100).toFixed(2)}%, 수수료·슬리피지 포함)`);
  L.push(`🎯 TP1 ${F(plan.tps[0].price)} (+${plan.tps[0].r}R) ${Math.round(plan.tps[0].w * 100)}% 청산 → 손절 본전 · TP2 ${F(plan.tps[1].price)} (+${plan.tps[1].r}R) ${Math.round(plan.tps[1].w * 100)}% 청산 · 잔여 ${Math.round(plan.runnerWeight * 100)}% 최고(최저)−${plan.params.trailR}R 추적`);
  L.push(`⚖️ 목표 손익비 TP1 ${plan.tps[0].r}R · TP2 ${plan.tps[1].r}R${x.rr1 ? ` · 비용 반영 1차 ${x.rr1.toFixed(2)}R(참고)` : ''} · 예상 비용 수수료 −${plan.worstFee.toFixed(2)} · 슬리피지 −${plan.worstSlip.toFixed(2)} USDT`);
  L.push(`📊 격리 ${plan.lev}배 · 증거금 ${plan.totalMargin.toFixed(2)} USDT (평가액의 ${(plan.marginUsage * 100).toFixed(1)}%, 한도 ${Math.round(STRAT.maxMarginUsage * 100)}%) · 청산가(근사) ${F(plan.liqPrice)}`);
  if (x.volRel || x.btcAlign) L.push(`🌐 추천 당시: ${x.volRel ? `15분 거래량 ×${x.volRel.toFixed(1)}` : ''}${x.volRel && x.btcAlign ? ' · ' : ''}${x.btcAlign ? `BTC 4H ${x.btcAlign}` : ''}`);
  L.push('🚫 무효화: 15분 봉이 손절가를 터치 · 진입 전 TP1 선도달 · 4시간 추세 반전 · 유효시간 경과');
  L.push(`📌 진입 조건 알림이 와도 이는 '전략 기준 가상 진입'입니다. 실제로 진입하려면 Binance 에서 직접 주문하세요.`, SGY_FOOT);
  return L.join('\n');
}
export function sgyCancelMessage(s) {
  return [`[RICH300 추천 제외] ${sgyBase(s.symbolId)} ${s.dir}`, `사유: ${sgyReasonKo(s.x.reason)}`, '위험 한도를 넘어 일반 추천으로 보내지 않습니다(추적·기록만 남김).', SGY_FOOT].join('\n');
}
const SGY_HEAD = { ENTRY_NEAR: '🧭 진입 구간 접근', ENTRY: '✅ 진입 조건 충족(가상 진입)', ADD: '➕ 추가 진입 조건 충족(가상)', ADD_CANCEL: '✖️ 추가 진입 취소', STOP_NEAR: '⚠️ 손절 접근', STOP: '🛑 손절 조건 충족(가상 손절)', TP1: '🎯 TP1 도달', TP2: '🎯 TP2 도달', BE: '🔼 손절 본전 이동 제안', TRAIL: '🔼 트레일링 기준 변경', WEAK: '⚠️ 추세 약화', TREND_INVALID: '🚫 전략 무효화(4시간 추세 반전)', INVALIDATED: '🚫 전략 무효화', EXPIRED: '⌛ 전략 만료', DONE: '🏁 전량 목표 완료' };
const SGY_ADD_WHY = { 'after-tp': '익절이 시작되어 추가 진입 취소', structure: '구조 유지 조건(직전 15분 종가) 미충족', window: '추가 진입 허용 시간 경과' };
const SGY_INV_WHY = { 'radar-invalidated': 'COIN RADAR 가 이 추천을 무효화(구조 이탈·손절 기준 이탈)', 'tp1-before-entry': '진입 전에 TP1 가격이 먼저 닿음(추격 금지)', '4h-trend-flip': '4시간 추세가 전략 방향과 반대로 전환' };
export function sgyResultLines(s) {
  const r = s.x.result, plan = s.x.plan; if (!r) return ['최종 가상 성적: 진입 없음(손익 0)'];
  return [`최종 가상 성적: ${r.usdt >= 0 ? '+' : '−'}${Math.abs(r.usdt).toFixed(2)} USDT (${r.pct >= 0 ? '+' : '−'}${Math.abs(r.pct * 100).toFixed(2)}% · ${r.r >= 0 ? '+' : '−'}${Math.abs(r.r).toFixed(2)}R) · 평균 진입 ${sgyF(r.avgEntry, plan)} · 수수료·슬리피지 반영`];
}
export function sgyEventMessage(s, ev, { price, now, snap }) {
  const x = s.x, plan = x.plan, F = v => sgyF(v, plan), L = [`[RICH300 전략] ${sgyBase(s.symbolId)} ${s.dir} · ${SGY_HEAD[ev.type] || ev.type}${ev.coarse ? ' (시세 공백 구간: 1시간봉 기준)' : ''}`];
  const sg = splanSign(s.dir), open = sgyOpenOf(x), avg = sgyAvgExec(x);
  switch (ev.type) {
    case 'ENTRY_NEAR': L.push(`현재가 ${F(price)} → 1차 진입가 ${F(plan.stages[0].price)} 근처(유효 ~${sgyHm(x.validUntil)} KST)`); break;
    case 'ENTRY': L.push(`전략 기준 1차 가상 진입 ${F(ev.price)} · 수량 ${splanQty(plan.stages[0].qty, plan.spec)}`, `손절 ${F(plan.stop)} · TP1 ${F(plan.tps[0].price)} · TP2 ${F(plan.tps[1].price)}`, '실제 Binance 주문이 체결됐다는 뜻이 아닙니다.'); break;
    case 'ADD': L.push(`${ev.n}차 가상 추가 진입 ${F(ev.price)} · 평균 ${F(avg)} · 보유 ${splanQty(open, plan.spec)}`); break;
    case 'ADD_CANCEL': L.push(`${ev.n}차 추가 진입 취소: ${SGY_ADD_WHY[ev.reason] || ev.reason}`); break;
    case 'STOP_NEAR': L.push(`현재가 ${F(price)} · 손절 ${F(x.stopPrice)}까지 ${snap && snap.dStopR !== undefined ? snap.dStopR.toFixed(2) + 'R' : ''} 남음`, '전략 손절 조건이 가까워졌습니다.'); break;
    case 'STOP': L.push(`손절 기준 ${F(ev.price)} (${{ initial: '최초 손절', breakeven: '본전 손절', trailing: '추적 손절' }[ev.kind] || ev.kind}) 15분 봉이 터치`, ...sgyResultLines(s)); break;
    case 'TP1': L.push(`TP1 ${F(ev.price)} 도달 · 전략상 ${Math.round(plan.tps[0].w * 100)}% 가상 청산(${splanQty(ev.qty || 0, plan.spec)})`, '다음 봉부터 손절이 본전으로 이동합니다.'); break;
    case 'TP2': L.push(`TP2 ${F(ev.price)} 도달 · 전략상 ${Math.round(plan.tps[1].w * 100)}% 가상 청산 · 잔여는 추적 손절로 관리`); break;
    case 'BE': L.push(`TP1 이후 손절을 평균 진입가 ${F(ev.price)}(본전)로 옮기는 것을 제안합니다(유리한 방향만).`); break;
    case 'TRAIL': L.push(`추적 손절 기준 ${F(ev.price)} (최고·최저 기준 −${plan.params.trailR}R, 본전 아래로는 내리지 않음)`); break;
    case 'WEAK': L.push(`1시간 추세가 전략 방향과 반대 · 거래량 평균의 ${snap && snap.v1 ? snap.v1.toFixed(1) : '?'}배 · 손절까지 ${snap && snap.dStopR !== undefined ? snap.dStopR.toFixed(2) + 'R' : ''}`, '추가 진입은 없습니다. 전략 유지 여부를 점검하세요.'); break;
    case 'TREND_INVALID': case 'INVALIDATED': L.push(`사유: ${SGY_INV_WHY[ev.reason] || SGY_INV_WHY['4h-trend-flip']}`, '진입 전 전략이 취소되었습니다(진입 없음).'); break;
    case 'EXPIRED': L.push(ev.reason === 'max-track-time' ? `추적 최대 시간(72시간) 도달 — 현재가 ${F(price)} 기준으로 종료` : `진입 유효시간(${sgyHm(x.validUntil)} KST)이 지나 만료 — 1차 진입가가 닿지 않아 진입 없음`, ...(x.result ? sgyResultLines(s) : [])); break;
    case 'DONE': L.push('TP1·TP2·잔여 수량이 모두 목표로 청산되었습니다.', ...sgyResultLines(s)); break;
    default: break;
  }
  L.push(SGY_FOOT); return L.join('\n');
}

// ── 요약(웹앱·점검용, 순수) ──
export function sgySummary(rows, now) {
  const ended = rows.filter(r => STRAT_ENDED.includes(r.state)), entered = ended.filter(r => r.x.result), wins = entered.filter(r => r.x.result.usdt > 0), losses = entered.filter(r => r.x.result.usdt < 0);
  const sum = (a, f) => a.reduce((t, r) => t + f(r), 0), day = kstDayOf(now), today = entered.filter(r => kstDayOf(r.endedAt) === day);
  return { total: rows.length, active: rows.filter(r => sgyIsActive(r.state)).length, ended: ended.length, entered: entered.length, notEntered: ended.length - entered.length, wins: wins.length, losses: losses.length, winRate: entered.length ? wins.length / entered.length : null,
    usdt: sum(entered, r => r.x.result.usdt), r: sum(entered, r => r.x.result.r), avgR: entered.length ? sum(entered, r => r.x.result.r) / entered.length : null, todayUsdt: sum(today, r => r.x.result.usdt),
    byState: Object.fromEntries(STRAT_ENDED.map(k => [k, ended.filter(r => r.state === k).length])) };
}

// ── 저장(시트) ──
export function sgyList(se) { return storeList(se, 'strategy').map(r => ({ ...r.data, rev: r.rev })); }
const sgyActor = { actor: 'sys:strategy' };
function sgyPersist(se, s0, s1) {
  if (!s0) return storeCreate(se, 'strategy', s1, sgyActor);
  return storeRevise(se, 'strategy', s1.sid, { state: s1.state, updatedAt: s1.updatedAt, endedAt: s1.endedAt === undefined ? null : s1.endedAt, x: s1.x }, { actor: sgyActor.actor, reason: `전이 ${s0.state}→${s1.state}` });
}

// ── 한 번의 실행 ──
// env: { now(), mode():'off'|'preview'|'on', storeEnv(), kv, market(symbol), send(text), feed():{ok,raw|code}, feedKey():string|null, hmacSha256 }
export function strategyTick(env) {
  const now = env.now(), mode = env.mode(); if (mode !== 'on' && mode !== 'preview') return { status: 'off' };
  const se = env.storeEnv(), live = mode === 'on', out = { status: 'ok', mode, feed: null, created: 0, cancelled: 0, skippedFeed: 0, tracked: 0, events: 0, sent: 0, failed: 0, capped: 0, ended: 0, marketFail: 0, stale: 0 };
  const kv = { get: k => env.kv.get(k === 'cap' ? 'sgcap' : k.replace(/^pos:/, 'sg:')), put: (k, v) => env.kv.put(k === 'cap' ? 'sgcap' : k.replace(/^pos:/, 'sg:'), v), del: k => env.kv.del(k.replace(/^pos:/, 'sg:')), keys: () => env.kv.keys() };
  const env2 = { ...env, kv };
  const rows = new Map(sgyList(se).map(r => [r.sid, r]));
  // 1) 피드 → 새 전략
  const radarInv = new Set();
  let f = null; try { f = env.feed(); } catch (e_) { f = { ok: false, code: 'exception' }; }
  if (f && f.ok) {
    const v = feedVerify(env, f.raw, env.feedKey ? env.feedKey() : null);
    out.feed = v.ok ? { ok: true, signed: v.signed, ageMin: Math.round(v.ageMs / 60000), stale: v.stale, entries: v.entries.length } : { ok: false, code: v.reason };
    if (v.ok) {
      const parsed = v.entries.map(feedParseEntry); for (const e of parsed) if (e.ok && e.kind === 'invalidated') radarInv.add(e.sid);
      const cands = parsed.filter(e => { if (!e.ok) out.skippedFeed++; return e.ok && e.kind === 'candidate'; }).sort((a, b) => a.triggerT - b.triggerT);
      const day = kstDayOf(now); let activeRows = [...rows.values()].filter(r => sgyIsActive(r.state));
      let dayPnl = [...rows.values()].filter(r => STRAT_ENDED.includes(r.state) && r.x.result && kstDayOf(r.endedAt) === day).reduce((a, r) => a + r.x.result.usdt, 0);
      for (const fe of cands) {
        if (rows.has(fe.sid)) continue; if (out.created + out.cancelled >= STRAT.maxNewPerTick) break;
        const margin = activeRows.reduce((a, r) => a + (r.x.plan ? r.x.plan.totalMargin : 0), 0), res = sgyBuild(fe, { now, activeMargin: margin, dayPnl, activeCount: activeRows.length });
        try { if (live) sgyPersist(se, null, res.s); } catch (e_) { out.persistError = (out.persistError || 0) + 1; continue; }      // 저장하지 못하면 만들지 않는다(다음 실행에서 다시)
        if (res.ok) { out.created++; rows.set(res.s.sid, res.s); activeRows.push(res.s); }
        else { out.cancelled++; rows.set(res.s.sid, res.s); if (res.notify) res.s.pendingNotice = true; }
      }
    }
  } else out.feed = { ok: false, code: (f && f.code) || 'no-feed' };
  // 2) 활성 전략 추적
  const markets = new Map();
  const clock = typeof env.clock === 'function' ? env.clock : null, t0 = clock ? clock() : 0, budget = nullishOr(env.budgetMs, 150000);
  const getMarket = sym => { if (markets.has(sym)) return markets.get(sym); if (clock && clock() - t0 > budget) { out.marketFail++; out.budget = true; markets.set(sym, null); return null; } let m; try { m = env.market(sym); } catch (e_) { m = { ok: false }; } const a = m && m.ok ? watchAssessMarket(m, now) : { ok: false, why: 'fetch' }; const r = a.ok ? { ...m } : null; if (!r) { out.marketFail++; if (m && m.ok) out.stale++; } markets.set(sym, r); return r; };
  out.preview = [];
  for (const s0 of [...rows.values()].sort((a, b) => a.createdAt - b.createdAt)) {
    const ns = wLoadState(kv, s0.sid), nsRaw = JSON.stringify(ns), msgs = [];
    const push = (ev, text, level) => msgs.push({ key: ev.key || `${ev.type}:${s0.sid}${ev.n ? ':' + ev.n : ''}${ev.at ? ':' + ev.at : ''}`, sid: s0.sid, level, text });
    let s = s0;
    if (s0.state === 'CANCELLED') {                                                                   // 위험 한도로 제외된 전략: 안내 1회
      if (s0.pendingNotice || (live && !ns.sent[`CANCEL:${s0.sid}`] && now - s0.createdAt < STRAT.retryNoteMs && s0.x.reason !== 'expired-on-arrival')) { push({ key: `CANCEL:${s0.sid}`, type: 'CANCEL' }, sgyCancelMessage(s0), 'info'); }
    } else if (sgyIsActive(s0.state)) {
      out.tracked++;
      const m = getMarket(s0.symbolId);
      if ((s0.state === 'CANDIDATE' || s0.state === 'WAIT_ENTRY') && radarInv.has(s0.sid)) {            // 진입 전 COIN RADAR 가 같은 추천을 무효화했으면 전략도 무효화
        s = JSON.parse(JSON.stringify(s0)); sgyFinish(s, 'INVALIDATED', now, 'radar-invalidated'); s.updatedAt = now; out.ended++;
        if (live) { try { sgyPersist(se, s0, s); } catch (e_) { out.persistError = (out.persistError || 0) + 1; continue; } }
        const evI = { type: 'INVALIDATED', at: now, price: m ? m.price : undefined, reason: 'radar-invalidated' }; out.events++; if (s0.state === 'WAIT_ENTRY') push(evI, sgyEventMessage(s, evI, { price: m ? m.price : s.entry, now, snap: {} }), 'critical');
      } else if (s0.state === 'CANDIDATE') {
        if (now > s0.x.validUntil) { s = { ...JSON.parse(JSON.stringify(s0)), state: 'EXPIRED', endedAt: now, updatedAt: now }; s.x.reason = 'not-delivered'; if (live) sgyPersist(se, s0, s); out.ended++; }
        else if (m) {
          const text = sgyNewMessage(s0, { price: m.price, priceAt: m.priceAt, source: m.source, now });
          if (!live) out.preview.push(text.split('\n').slice(0, 3).join(' | ')); else push({ key: `NEW:${s0.sid}`, type: 'NEW' }, text, 'info');
        }
      } else if (m) {
        const res = sgyRunBars(s0, sgyBarsFor(m, s0.x.lastBarT, s0.x.startT, now), now); s = res.s;
        const price = m.price, snapOf = {};
        const evs = res.events;
        // 종료·상태 변화는 먼저 저장(저장 실패 시 전송하지 않는다)
        const changed = JSON.stringify(s.x) !== JSON.stringify(s0.x) || s.state !== s0.state;
        let note = [];
        if (!sgyIsActive(s.state)) out.ended++;
        else { const ns2 = sgyNotes(s, { price, market: m, now }, ns); for (const n of ns2) { if (n.terminal) { s = sgyFinishTrend(s, now); evs.push({ type: 'TREND_INVALID', at: now, price, reason: n.reason, key: n.key }); out.ended++; break; } note.push(n); } }
        if (changed || s.state !== s0.state) { if (live) { try { sgyPersist(se, s0, s); } catch (e_) { out.persistError = (out.persistError || 0) + 1; continue; } } }
        for (const ev of evs) { out.events++; push({ ...ev, key: ev.key || undefined }, sgyEventMessage(s, ev, { price, now, snap: {} }), ['STOP', 'TREND_INVALID', 'INVALIDATED', 'EXPIRED', 'DONE'].includes(ev.type) ? 'critical' : 'info'); }
        for (const n of note) { out.events++; push(n, sgyEventMessage(s, n, { price, now, snap: n }), n.level); }
      }
    }
    if (!live || !msgs.length) { if (live && JSON.stringify(ns) !== nsRaw) wSaveState(kv, s0.sid, ns); for (const mm of msgs) out.preview.push(mm.text.split('\n')[0]); continue; }
    const st = ns; st.sent = { ...ns.sent };
    for (const mm of msgs) { const r = wDeliver(env2, st, mm, mm.text, now); if (r === 'sent') out.sent++; else if (r === 'failed') out.failed++; else if (r === 'capped') out.capped++; }
    for (const [k, rec] of Object.entries(st.sent)) if (rec.st === 'failed' && now >= rec.next && !msgs.some(e => e.key === k)) { const r = wDeliver(env2, st, { key: k, sid: s0.sid }, rec.text, now); if (r === 'sent') out.sent++; else if (r === 'failed') out.failed++; }
    wSaveState(kv, s0.sid, st);
    // 새 전략 안내가 나갔으면(또는 전송 시도 이후 중단 표시가 남았으면) 진입 대기로 전환 — 이때부터의 봉만 사용한다
    if (s.state === 'CANDIDATE') { const rec = st.sent[`NEW:${s0.sid}`]; if (rec && (rec.st === 'sent' || rec.st === 'pending')) { const s2 = JSON.parse(JSON.stringify(s)); s2.state = 'WAIT_ENTRY'; s2.updatedAt = now; s2.x.startT = Math.ceil(nullishOr(rec.sentAt, now) / STRAT.barMs) * STRAT.barMs; s2.x.sentAt = nullishOr(rec.sentAt, now); try { sgyPersist(se, s, s2); } catch (e_) { out.persistError = (out.persistError || 0) + 1; } } }
  }
  // 종료된 전략의 알림 상태는 며칠 뒤 정리
  if (live) for (const k of env.kv.keys()) if (k.startsWith('sg:')) { const sid = k.slice(3), r = rows.get(sid); if (r && STRAT_ENDED.includes(r.state) && now - nullishOr(r.endedAt, now) > STRAT.keepKvMs) env.kv.del(k); }
  out.active = [...rows.values()].filter(r => sgyIsActive(r.state)).length;
  return out;
}
function sgyFinishTrend(s, now) { const c = JSON.parse(JSON.stringify(s)); sgyFinish(c, 'INVALIDATED', now, '4h-trend-flip'); c.updatedAt = now; return c; }
