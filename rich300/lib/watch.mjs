// RICH300 보유 포지션 감시(순수 규칙 + 오케스트레이션). 사용자가 *실제 체결로 등록한* 포지션만 감시하고, 시세는 거래소 공개 데이터(읽기 전용)로만 쓴다. 주문·계정 API 없음.
//  · 입력 구분: 체결(fills)=사용자 기록, 시세(market)=거래소 공개 시세(지연 가능). 메시지에서 두 출처를 따로 표시한다.
//  · 모든 판단은 아래 WATCH 상수와 수치 조건으로 정의한다(테스트 가능). 같은 이벤트는 dedupe 키로 한 번만 전송한다.
//  · 상태 저장은 env.kv(Script Properties 'w:' 접두)에만 한다 — COIN RADAR(GitHub Actions 캐시)·텔레그램 입력 상태('tg:')와 분리.
//  · 전송 의미: 한 번만(at-most-once). 보내기 전에 'pending' 표시를 남기고, 실패(API 오류 응답)일 때만 재시도한다. 프로세스가 전송 직후 죽어 'pending'이 남으면 다시 보내지 않는다.
//  env 포트: { now(), mode():'off'|'preview'|'on', storeEnv(), kv:{get,put,del,keys}, market(symbolId): Promise 아님 — {ok,source,price,priceAt,bars15m,bars1h,bars4h}, send(text):{ok,code?}, equityEnv? }
import { pnlComputeTrade } from './pnl.mjs';
import { splanStatus, splanCheckAdd, splanSign } from './scaleplan.mjs';
import { storeList, storeGet } from './store.mjs';
import { tgPlanOf, tgEquityNow } from './tg.mjs';
import { kstDayOf } from './time.mjs';
import { nullishOr } from './nullish.mjs';

export const WATCH = Object.freeze({
  emaFast: 20, emaSlow: 50, volLook: 20, minBars: 55,
  stopNearR: 0.25, stopNearRearmR: 0.5, stopTrendR: 0.6, stopTrendVol: 1.2,
  tpR: Object.freeze([1.5, 2]), trailStepR: 0.25,
  swingMinR: 2, swingHoldMinR: 1, swingVol4h: 0.9, swingHoldEveryMs: 24 * 3600000,
  addVolMin: 1, dayLossPct: 0.03,
  staleMarketMs: 10 * 60000, barGraceMs: 10 * 60000, marketDownFails: 3,
  cooldownMs: Object.freeze({ STOP_TREND: 60 * 60000, SWING_HOLD: 24 * 3600000 }),
  retryDelaysMs: Object.freeze([2 * 60000, 5 * 60000, 10 * 60000, 20 * 60000]), expireMs: 30 * 60000,
  capHour: 12, capDay: 60, maxPerPosTick: 3, keepSent: 40,
});

// ── 지표 ──
export function watchEma(vals, n) {
  if (!Array.isArray(vals) || vals.length < n) return null;
  const k = 2 / (n + 1); let e = 0; for (let i = 0; i < n; i++) e += vals[i]; e /= n;
  for (let i = n; i < vals.length; i++) e = vals[i] * k + e * (1 - k);
  return e;
}
// bars: 마감된 봉만, 오래된 것 → 최신. { t, o, h, l, c, v }
export function watchTrend(bars) {
  if (!Array.isArray(bars) || bars.length < WATCH.minBars) return { state: 'unknown' };
  const closes = bars.map(b => b.c), fast = watchEma(closes, WATCH.emaFast), slow = watchEma(closes, WATCH.emaSlow), slowPrev = watchEma(closes.slice(0, -5), WATCH.emaSlow), last = closes[closes.length - 1];
  const up = last > slow && fast > slow && slow > slowPrev, down = last < slow && fast < slow && slow < slowPrev;
  return { state: up ? 'up' : down ? 'down' : 'flat', fast, slow, last };
}
export function watchVolRatio(bars, n = WATCH.volLook) {
  if (!Array.isArray(bars) || bars.length < n + 1) return null;
  const prev = bars.slice(-n - 1, -1), avg = prev.reduce((a, b) => a + b.v, 0) / n;
  return avg > 0 ? bars[bars.length - 1].v / avg : null;
}
const wAligned = (trend, dir) => (dir === 'LONG' ? trend.state === 'up' : trend.state === 'down');
const wAgainst = (trend, dir) => (dir === 'LONG' ? trend.state === 'down' : trend.state === 'up');

// ── 포지션 목록(사용자 기록에서만) ──
export function watchOpenPositions(se, { now }) {
  const fills = storeList(se, 'fill').map(r => r.data), by = new Map();
  for (const f of fills) { if (!by.has(f.sid)) by.set(f.sid, []); by.get(f.sid).push(f); }
  const signals = new Map(storeList(se, 'signal').map(r => [r.key, r.data])), today = kstDayOf(now), positions = [], skipped = []; let realizedTodayMicro = 0;
  for (const [sid, list] of by) {
    let t; try { t = pnlComputeTrade(list); } catch (e_) { skipped.push({ sid, reason: 'invalid-fills' }); continue; }
    if (!t) continue;
    for (const e of t.events) if (e.day === today) realizedTodayMicro += Number(e.grossMicro) - (e.feeState === 'entered' ? Number(e.feeMicro) : 0) + (e.fundingState === 'entered' ? Number(e.fundingMicro) : 0);
    if (t.status !== 'open') continue;
    const sg = signals.get(sid); if (!sg) { skipped.push({ sid, reason: 'no-symbol' }); continue; }      // 종목을 알 수 없으면 시세를 볼 수 없다(수동 종목 등록은 별도 기능)
    const sorted = [...list].sort((a, b) => a.at - b.at), entry = sorted[0], hasOpening = sorted.some(f => f.kind === 'opening');
    let plan = null; try { plan = hasOpening ? null : tgPlanOf(se, sid); } catch (e_) { plan = null; }
    const stop0 = plan ? plan.stop : (entry.plannedStop != null ? Number(entry.plannedStop) : null);
    positions.push({ sid, symbolId: sg.symbolId, dir: t.dir, avgEntry: Number(t.avgEntry), openQty: Number(t.openQty), firstAt: sorted[0].at, signalAt: sg.signalAt, plan, stop0,
      fills: sorted.map(f => ({ kind: f.kind, price: Number(f.price), qty: Number(f.qty), at: f.at })) });
  }
  return { positions, skipped, realizedTodayMicro, today };
}

// ── 시세 응답 해석(순수): OKX·Bybit 공개 API. 마감된 봉만, 오래된 것 → 최신으로 돌려준다 ──
export const watchOkxInst = symbolId => (/^[A-Z0-9]{2,20}USDT$/.test(symbolId) ? `${symbolId.replace(/USDT$/, '')}-USDT-SWAP` : null);
export function watchParseOkxBars(json) {
  if (!json || json.code !== '0' || !Array.isArray(json.data)) return null;
  return json.data.filter(r => Array.isArray(r) && r[8] === '1').map(r => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: Number(r[5]) })).filter(b => [b.t, b.o, b.h, b.l, b.c, b.v].every(Number.isFinite)).sort((a, b) => a.t - b.t);
}
export function watchParseOkxTicker(json) {
  const d = json && json.code === '0' && Array.isArray(json.data) ? json.data[0] : null; const price = d ? Number(d.last) : NaN, at = d ? Number(d.ts) : NaN;
  return Number.isFinite(price) && price > 0 && Number.isFinite(at) ? { price, priceAt: at } : null;
}
export function watchParseBybitBars(json, intervalMs, now) {
  if (!json || json.retCode !== 0 || !json.result || !Array.isArray(json.result.list)) return null;
  return json.result.list.map(r => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: Number(r[5]) })).filter(b => [b.t, b.o, b.h, b.l, b.c, b.v].every(Number.isFinite) && b.t + intervalMs <= now).sort((a, b) => a.t - b.t);
}
export function watchParseBybitTicker(json) {
  const d = json && json.retCode === 0 && json.result && Array.isArray(json.result.list) ? json.result.list[0] : null, price = d ? Number(d.lastPrice) : NaN, at = json ? Number(json.time) : NaN;
  return Number.isFinite(price) && price > 0 && Number.isFinite(at) ? { price, priceAt: at } : null;
}

// ── 시세 요청 주소·판정(순수): GAS 어댑터와 실제 연결 점검(perf/market-check.mjs)이 같은 주소·같은 판정을 쓴다 ──
export const WATCH_BAR_MS = Object.freeze({ '15m': 900000, '1h': 3600000, '4h': 14400000 });
export function watchMarketUrls(src, symbolId) {
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbolId)) return null;
  if (src === 'OKX') { const i = watchOkxInst(symbolId), b = 'https://www.okx.com/api/v5/market'; return { ticker: `${b}/ticker?instId=${i}`, '15m': `${b}/candles?instId=${i}&bar=15m&limit=6`, '1h': `${b}/candles?instId=${i}&bar=1H&limit=100`, '4h': `${b}/candles?instId=${i}&bar=4H&limit=100` }; }
  const b = 'https://api.bybit.com/v5/market', k = `${b}/kline?category=linear&symbol=${symbolId}`;
  return { ticker: `${b}/tickers?category=linear&symbol=${symbolId}`, '15m': `${k}&interval=15&limit=6`, '1h': `${k}&interval=60&limit=100`, '4h': `${k}&interval=240&limit=100` };
}
// 응답(JSON 객체들)을 시세 묶음으로 해석. jsons = { ticker, '15m', '1h', '4h' } (없거나 잘못된 응답은 null)
export function watchParseSource(src, jsons, now) {
  const tk = src === 'OKX' ? watchParseOkxTicker(jsons.ticker) : watchParseBybitTicker(jsons.ticker), bars = {};
  for (const k of ['15m', '1h', '4h']) bars[k] = src === 'OKX' ? watchParseOkxBars(jsons[k]) : watchParseBybitBars(jsons[k], WATCH_BAR_MS[k], now);
  return { ticker: tk, bars };
}
// 감시에 쓸 수 있는 시세인가: 신선도(시세 10분·마지막 마감 봉 1시간/4시간 이내)·봉 개수·끊김 없음·티커와 봉 가격 일치. 사유 코드만 돌려준다.
export function watchAssessMarket(m, now) {
  if (!m || !(m.price > 0)) return { ok: false, why: 'no-price' };
  if (now - m.priceAt > WATCH.staleMarketMs) return { ok: false, why: 'stale-price' };
  for (const [k, minN, maxAge] of [['1h', WATCH.minBars, 2 * 3600000 + WATCH.barGraceMs], ['4h', WATCH.minBars, 8 * 3600000 + WATCH.barGraceMs]]) {      // 마지막 *마감* 봉의 시작 시각은 (봉 길이×2)까지 거슬러 올라갈 수 있다 — 실제 점검에서 4h 봉이 7시간 55분 전으로 관측됨. 확정 지연 여유 10분
    const b = m['bars' + k]; if (!Array.isArray(b) || b.length < minN) return { ok: false, why: `few-bars-${k}` };
    if (now - b[b.length - 1].t > maxAge) return { ok: false, why: `stale-bars-${k}` };
    const step = WATCH_BAR_MS[k]; for (let i = b.length - minN + 1; i < b.length; i++) if (b[i].t - b[i - 1].t !== step) return { ok: false, why: `gap-bars-${k}` };
  }
  if (!Array.isArray(m.bars15m) || !m.bars15m.length) return { ok: false, why: 'no-bars-15m' };
  const last = m.bars1h[m.bars1h.length - 1].c; if (Math.abs(m.price - last) / last > 0.2) return { ok: false, why: 'price-mismatch' };
  return { ok: true, why: null };
}

const wFmt = (x, ref) => { const d = Math.abs(ref) >= 100 ? 2 : Math.abs(ref) >= 10 ? 3 : Math.abs(ref) >= 1 ? 4 : 6; return Number(x).toFixed(d); };
const wHhmm = ms => new Date(ms + 9 * 3600000).toISOString().slice(11, 16);

// ── 포지션 한 건 평가 ──
// state(포지션별 저장 상태): { sent:{key:{at,st,tries,next,text}}, armed:{stopNear}, nNear, lastStop, swing:'cand'|'ended'|null, lastHoldAt, last:{type:at} }
export function watchEvaluate({ pos, market, now, state, dayBlocked = false }) {
  const sg = splanSign(pos.dir), p = market.price, avg = pos.avgEntry, plan = pos.plan, events = [], st0 = state, ns = { ...st0, armed: { ...st0.armed }, last: { ...st0.last } };
  const t1 = watchTrend(market.bars1h), t4 = watchTrend(market.bars4h), v1 = watchVolRatio(market.bars1h), v4 = watchVolRatio(market.bars4h);
  const R0 = plan ? plan.R : (pos.stop0 != null ? Math.abs(avg - pos.stop0) : null);
  const closed15 = market.bars15m && market.bars15m.length ? market.bars15m[market.bars15m.length - 1] : null;
  const since = market.bars1h.filter(b => b.t + 3600000 > pos.firstAt);
  const ctx = { lastClose: closed15 ? closed15.c : undefined, lastHigh: since.length ? Math.max(...since.map(b => b.h)) : undefined, lastLow: since.length ? Math.min(...since.map(b => b.l)) : undefined,
    barsSinceSignal: Math.max(0, Math.floor((now - nullishOr(pos.signalAt, now)) / 900000)) };
  const st = plan ? splanStatus(plan, pos.fills, ctx) : null;
  const stopNow = st ? st.stopPrice : pos.stop0, rNow = R0 > 0 ? (p - avg) * sg / R0 : null, pnl = (p - avg) * sg * pos.openQty;
  const snap = { sid: pos.sid, symbolId: pos.symbolId, dir: pos.dir, avg, openQty: pos.openQty, price: p, pnl, rNow, stop: stopNow, t1: t1.state, t4: t4.state, v1, v4 };
  const push = (type, key, level, reason, action, extra) => events.push({ type, key, level, sid: pos.sid, reason, action, ...(extra || {}) });
  const side = pos.dir === 'LONG' ? '롱' : '숏';

  // 1) 손절 위험
  if (stopNow != null && R0 > 0) {
    const dStop = (p - stopNow) * sg;
    if (dStop <= 0) push('STOP_BREACH', `STOP_BREACH:${pos.sid}:${wFmt(stopNow, stopNow)}`, 'critical', [`시세가 손절가 ${wFmt(stopNow, stopNow)}를 ${pos.dir === 'LONG' ? '아래로' : '위로'} 넘었습니다(시세 기준)`], 'Binance에서 손절이 체결됐는지 확인하고, 체결됐다면 웹앱에 청산을 등록하세요. 아직 보유 중이면 즉시 청산 여부를 결정하세요');
    else {
      if (dStop > WATCH.stopNearRearmR * R0) ns.armed.stopNear = true;
      if (dStop <= WATCH.stopNearR * R0 && ns.armed.stopNear !== false) { ns.armed.stopNear = false; ns.nNear = (ns.nNear || 0) + 1; push('STOP_NEAR', `STOP_NEAR:${pos.sid}:${ns.nNear}`, 'critical', [`손절가까지 ${wFmt(dStop, p)} (${(dStop / R0).toFixed(2)}R) 남았습니다`], '손절 주문이 걸려 있는지 확인하세요. 손절을 넓히지 마세요'); }
      else if (dStop <= WATCH.stopTrendR * R0 && wAgainst(t1, pos.dir) && v1 !== null && v1 >= WATCH.stopTrendVol && (now - (nullishOr(ns.last.STOP_TREND, 0))) >= WATCH.cooldownMs.STOP_TREND) {
        ns.last.STOP_TREND = now; push('STOP_TREND', `STOP_TREND:${pos.sid}:${market.bars1h[market.bars1h.length - 1].t}`, 'warn', [`1시간 추세가 포지션 반대(${t1.state === 'down' ? '하락' : '상승'})`, `거래량 평균 대비 ${v1.toFixed(1)}배`, `손절가까지 ${(dStop / R0).toFixed(2)}R`], '손절 유지 여부를 점검하고, 추가 진입은 하지 마세요');
      }
    }
  }
  // 2) 익절 도달(TP1·TP2)
  if (R0 > 0) {
    const legs = st ? st.legs : [0, 1].map(i => ({ n: i + 1, price: avg + sg * WATCH.tpR[i] * R0, qty: pos.openQty * (i === 0 ? 0.5 : 0.3), done: i === 0 ? pos.fills.some(f => f.kind === 'reduce') : false }));
    for (const leg of legs) {
      if (leg.done || (p - leg.price) * sg < 0) continue;
      push(`TP${leg.n}`, `TP${leg.n}:${pos.sid}`, 'info', [`목표 ${leg.n === 1 ? '+1.5R' : '+2R'} 가격 ${wFmt(leg.price, leg.price)} 도달 (현재 ${wFmt(p, p)})`], `Binance에서 ${leg.n === 1 ? '50%' : '30%'}${leg.qty > 0 ? `(약 ${Number(leg.qty)}개)` : ''} 부분 청산 후 웹앱에 청산을 등록하세요`, { leg: leg.n });
    }
  }
  // 3) 추가 진입 조건 충족 / 취소(분할 계획이 있을 때만)
  if (st && st.entered > 0 && st.openQty > 0) {
    for (const pd of st.pending) {
      if (pd.state === 'working' && wAgainst(t4, pos.dir)) push('ADD_CANCEL', `ADD_CANCEL:${pos.sid}:${pd.n}:trend`, 'warn', ['4시간 추세가 포지션 반대로 전환'], `Binance의 ${pd.n}차 미체결 추가 주문을 취소하세요`, { stage: pd.n });
      else if (pd.state === 'working') {
        const tol = plan.add.tolR * plan.R, reached = (p - (pd.price + sg * tol)) * sg <= 0 && (p - plan.stop) * sg > 0;
        if (!reached) continue;
        const chk = splanCheckAdd(plan, pos.fills, { price: pd.price, qty: pd.remainingQty }, ctx), trendOk = wAligned(t1, pos.dir), volOk = v1 !== null && v1 >= WATCH.addVolMin;
        if (chk.ok && trendOk && volOk && !dayBlocked) push('ADD_READY', `ADD_READY:${pos.sid}:${pd.n}`, 'warn', [`사전 지정 ${pd.n}차 가격 ${wFmt(pd.price, pd.price)} 도달 (물타기 구간)`, `1시간 추세 ${side} 유지`, `거래량 평균 대비 ${v1.toFixed(1)}배`, '추가 후 최악 손실이 계획 한도 이내'], `${pd.n}차 ${Number(pd.remainingQty)}개를 지정가로 직접 주문하세요. 체결되면 웹앱에 등록하세요`, { stage: pd.n });
      } else if (pd.state.startsWith('cancel-') && pd.state !== 'cancel-closed') {
        const why = { 'cancel-after-tp': '익절이 시작됨(익절 뒤 추가 진입 금지)', 'cancel-structure': '구조 유지 조건 이탈(직전 15분봉 종가)', 'cancel-window': '추가 진입 허용 시간 경과' }[pd.state] || pd.state;
        push('ADD_CANCEL', `ADD_CANCEL:${pos.sid}:${pd.n}:${pd.state}`, 'warn', [why], `Binance의 ${pd.n}차 미체결 추가 주문을 취소하세요`, { stage: pd.n });
      }
    }
  }
  // 4) 추적손절 조정(유리한 방향으로만)
  if (st && R0 > 0 && (st.stopKind === 'breakeven' || st.stopKind === 'trailing')) {
    const last = nullishOr(ns.lastStop, plan.stop), step = (st.stopPrice - last) * sg;
    if (step > 0 && (step >= WATCH.trailStepR * R0 || ns.lastStop === undefined || ns.lastStop === plan.stop)) {
      ns.lastStop = st.stopPrice;
      push('TRAIL', `TRAIL:${pos.sid}:${wFmt(st.stopPrice, st.stopPrice)}`, 'info', [st.stopKind === 'breakeven' ? 'TP1 이후 손절을 평균 진입가(본전)로' : `TP2 이후 추적손절 (고점 기준 −${plan.params.trailR}R)`], `Binance 손절 주문을 ${wFmt(st.stopPrice, st.stopPrice)}로 ${pos.dir === 'LONG' ? '올리세요' : '내리세요'}(포지션에 유리한 방향만, 반대로 넓히지 마세요)`, { newStop: st.stopPrice });
    }
  }
  // 5) 스윙 전환·유지·종료 후보(수익 포지션만)
  const tp1Done = st ? st.tp1Done : pos.fills.some(f => f.kind === 'reduce'), locked = stopNow != null && (stopNow - avg) * sg >= 0, ema4 = t4.fast, above4 = ema4 != null && (p - ema4) * sg > 0;
  if (R0 > 0 && rNow !== null) {
    const base = wAligned(t4, pos.dir) && above4 && !wAgainst(t1, pos.dir) && v4 !== null && v4 >= WATCH.swingVol4h && locked;
    if (!ns.swing) {
      if (base && tp1Done && rNow >= WATCH.swingMinR) { ns.swing = 'cand'; ns.lastHoldAt = now; push('SWING_CAND', `SWING_CAND:${pos.sid}`, 'info', [`수익 ${rNow.toFixed(1)}R, TP1 이후 손절이 본전 이상으로 잠김`, `4시간 추세 ${side} 유지`, `4시간 거래량 평균 대비 ${v4.toFixed(1)}배`, '가격이 4시간 20EMA 위(구조 유지)'], '일부 수익을 확보한 상태입니다. 잔량을 며칠 보유(스윙)할지 직접 결정하세요. 보유한다면 추적손절을 지키세요. 손실 포지션은 스윙 대상이 아닙니다'); }
    } else if (ns.swing === 'cand') {
      const broke = !wAligned(t4, pos.dir) || !above4 || rNow < WATCH.swingHoldMinR || (stopNow != null && (p - stopNow) * sg <= 0);
      if (broke) { ns.swing = 'ended'; push('SWING_END', `SWING_END:${pos.sid}`, 'warn', ['스윙 유지 조건 이탈: ' + (!wAligned(t4, pos.dir) ? '4시간 추세 약화' : !above4 ? '가격이 4시간 20EMA 아래' : rNow < WATCH.swingHoldMinR ? `수익 ${rNow.toFixed(1)}R로 감소` : '손절선 도달')], '남은 수량 청산을 검토하세요(스윙 종료 후보)'); }
      else if (now - nullishOr(ns.lastHoldAt, 0) >= WATCH.swingHoldEveryMs) { ns.lastHoldAt = now; push('SWING_HOLD', `SWING_HOLD:${pos.sid}:${kstDayOf(now)}`, 'info', [`4시간 추세 ${side} 유지 · 수익 ${rNow.toFixed(1)}R`, `4시간 거래량 평균 대비 ${v4.toFixed(1)}배`], '스윙 유지 조건을 아직 만족합니다. 추적손절을 지키세요'); }
    }
  }
  return { events, state: ns, snap };
}

export function watchMessage(pos, market, ev, snap) {
  const head = { STOP_BREACH: '🛑 손절가 이탈', STOP_NEAR: '⚠️ 손절 임박', STOP_TREND: '⚠️ 손절 위험(추세 반대)', TP1: '🎯 TP1 도달', TP2: '🎯 TP2 도달', ADD_READY: '➕ 추가 진입 조건 충족', ADD_CANCEL: '✖️ 추가 진입 취소', TRAIL: '🔼 추적손절 조정', SWING_CAND: '🔭 스윙 전환 후보', SWING_HOLD: '🔭 스윙 유지', SWING_END: '🔚 스윙 종료 후보' }[ev.type] || ev.type;
  const base = pos.symbolId.replace(/USDT$/, ''), age = Math.max(0, Math.round((market.fetchedAt - market.priceAt) / 60000));
  const pnl = `${snap.pnl >= 0 ? '+' : '−'}${Math.abs(snap.pnl).toFixed(2)} USDT${snap.rNow !== null ? ` (${snap.rNow >= 0 ? '+' : '−'}${Math.abs(snap.rNow).toFixed(2)}R)` : ''}`;
  return [`[RICH300] ${base} ${pos.dir} · ${head}`,
    `내 체결: 평균 ${wFmt(snap.avg, snap.avg)} · 수량 ${snap.openQty}`,
    `시세(${market.source} ${wHhmm(market.priceAt)}${age >= 2 ? `, ${age}분 전` : ''}): ${wFmt(snap.price, snap.price)} · 평가손익 ${pnl} (수수료 제외)`,
    ...(snap.stop != null ? [`현재 손절 기준: ${wFmt(snap.stop, snap.stop)}`] : ['손절가 미입력 — 웹앱에 손절가를 등록하세요']),
    '근거', ...ev.reason.map(r => `• ${r}`), `행동: ${ev.action}`, '※ 기록·공개 시세 기반 안내 · 자동 주문 아님 · Binance 체결가와 다를 수 있음'].join('\n');
}

// ── 저장 상태 ──
const wLoadState = (kv, sid) => { let s = null; try { s = JSON.parse(kv.get(`pos:${sid}`) || 'null'); } catch (e_) { s = null; } return s && s.v === 1 ? s : { v: 1, sent: {}, armed: {}, last: {} }; };
const wSaveState = (kv, sid, s) => {
  const keys = Object.keys(s.sent); if (keys.length > WATCH.keepSent) for (const k of keys.sort((a, b) => s.sent[a].at - s.sent[b].at).slice(0, keys.length - WATCH.keepSent)) delete s.sent[k];
  kv.put(`pos:${sid}`, JSON.stringify(s));
};
function wCapCheck(kv, now) {
  let c = {}; try { c = JSON.parse(kv.get('cap') || '{}'); } catch (e_) { c = {}; }
  const hour = Math.floor(now / 3600000), day = kstDayOf(now); if (c.h !== hour) { c.h = hour; c.nh = 0; } if (c.d !== day) { c.d = day; c.nd = 0; }
  return { c, ok: c.nh < WATCH.capHour && c.nd < WATCH.capDay, commit: () => { c.nh++; c.nd++; kv.put('cap', JSON.stringify(c)); } };
}

// 이벤트 한 건 전송 처리(한 번만 · 실패 재시도 · 상한). 결과: 'sent' | 'failed' | 'skipped' | 'capped'
function wDeliver(env, state, ev, text, now) {
  const kv = env.kv, rec = state.sent[ev.key];
  if (rec && (rec.st === 'sent' || rec.st === 'pending' || rec.st === 'expired')) return 'skipped';            // 이미 보냈거나(또는 전송 직후 중단된 pending) 만료됨 → 다시 보내지 않는다
  if (rec && rec.st === 'failed' && now < rec.next) return 'skipped';
  const cap = wCapCheck(kv, now); if (!cap.ok && ev.level !== 'critical') return 'capped';      // 손절 관련(critical)은 상한과 무관하게 보낸다
  state.sent[ev.key] = { at: nullishOr(rec && rec.at, now), st: 'pending', tries: (rec ? rec.tries : 0) + 1, text: nullishOr(rec && rec.text, text.slice(0, 1200)) };
  wSaveState(kv, ev.sid, state);                                                                                 // 보내기 전에 표시 → 중복 실행·중단에도 한 번만
  let r; try { r = env.send(state.sent[ev.key].text); } catch (e_) { r = { ok: false, code: 'exception' }; }
  if (r && r.ok) { state.sent[ev.key].st = 'sent'; state.sent[ev.key].sentAt = now; cap.commit(); wSaveState(kv, ev.sid, state); return 'sent'; }
  const rec2 = state.sent[ev.key], delay = WATCH.retryDelaysMs[rec2.tries - 1];
  if (delay === undefined || now - rec2.at + delay > WATCH.expireMs) { rec2.st = 'expired'; rec2.code = r && r.code; }
  else { rec2.st = 'failed'; rec2.next = now + delay; rec2.code = r && r.code; }
  wSaveState(kv, ev.sid, state); return 'failed';
}

// 한 번의 감시 실행. 반환: 개수·상태 코드만(금액·ID 없음)
export function watchTick(env) {
  const now = env.now(), mode = env.mode();
  if (mode !== 'on' && mode !== 'preview') return { status: 'off' };
  const se = env.storeEnv(), { positions, skipped, realizedTodayMicro, today } = watchOpenPositions(se, { now });
  const live = new Set(positions.map(p => p.sid));
  if (mode === 'on') for (const k of env.kv.keys()) if (k.startsWith('pos:') && !live.has(k.slice(4))) env.kv.del(k);        // 청산된 포지션의 상태 정리(알림 종료)
  if (!positions.length) return { status: 'idle', positions: 0, skipped: skipped.length };
  const out = { status: 'ok', mode, positions: positions.length, skipped: skipped.length, events: 0, sent: 0, failed: 0, capped: 0, stale: 0, marketFail: 0 };
  const markets = new Map(); out.market = []; out.skippedBy = {}; out.byType = {};
  for (const k of skipped) out.skippedBy[k.reason] = (out.skippedBy[k.reason] || 0) + 1;
  for (const sym of new Set(positions.map(p => p.symbolId))) {
    let m; try { m = env.market(sym); } catch (e_) { m = { ok: false, why: 'exception' }; }
    const assess = m && m.ok ? watchAssessMarket(m, now) : { ok: false, why: null }, good = assess.ok;
    out.market.push({ symbol: sym, ok: good, source: (m && m.source) || null, ageSec: m && m.ok ? Math.round((now - m.priceAt) / 1000) : null, n15: m && m.bars15m ? m.bars15m.length : 0, n1h: m && m.bars1h ? m.bars1h.length : 0, n4h: m && m.bars4h ? m.bars4h.length : 0,
      why: good ? null : (!m || !m.ok ? String((m && m.why) || 'fetch-failed').slice(0, 160) : assess.why) });
    if (good) markets.set(sym, { ...m, fetchedAt: now }); else { out.marketFail++; if (m && m.ok) out.stale++; }
  }
  // 시세 장애: 연속 실패 N회 뒤 한 번만 알림, 복구되면 해제
  let mk = {}; try { mk = JSON.parse(env.kv.get('market') || '{}'); } catch (e_) { mk = {}; }
  if (mode === 'on') {
    if (out.marketFail === new Set(positions.map(p => p.symbolId)).size) { mk.fails = (mk.fails || 0) + 1; if (mk.fails >= WATCH.marketDownFails && !mk.alerted) { const r = env.send('[RICH300] ⚠️ 시세 수집 장애\n보유 포지션 감시용 공개 시세를 가져오지 못하고 있습니다. 감시 알림이 지연됩니다.\n행동: 손절·익절 주문이 거래소에 걸려 있는지 직접 확인하세요.\n※ 자동 주문 아님'); if (r && r.ok) mk.alerted = true; } }
    else { mk.fails = 0; mk.alerted = false; }
    env.kv.put('market', JSON.stringify(mk));
  }
  // 일일 손실 제한(-3%): 추가 진입 조건 알림을 막고 한 번 알린다
  let unreal = 0; for (const p of positions) { const m = markets.get(p.symbolId); if (m) unreal += (m.price - p.avgEntry) * splanSign(p.dir) * p.openQty; }
  let equity = null; try { equity = Number(tgEquityNow({ storeEnv: () => se, now: () => now })); } catch (e_) { equity = null; }
  const dayPnl = realizedTodayMicro / 1e6 + unreal, dayBlocked = equity > 0 && dayPnl <= -WATCH.dayLossPct * equity;
  const pending = [];
  for (const pos of positions) {
    const m = markets.get(pos.symbolId); if (!m) continue;
    const state = wLoadState(env.kv, pos.sid);
    const ev = watchEvaluate({ pos, market: m, now, state, dayBlocked });
    out.events += ev.events.length; for (const e of ev.events) out.byType[e.type] = (out.byType[e.type] || 0) + 1;
    if (mode === 'preview') continue;                                                                           // 미리보기: 계산만(상태·전송 없음)
    const sorted = ev.events.sort((a, b) => ({ critical: 0, warn: 1, info: 2 })[a.level] - ({ critical: 0, warn: 1, info: 2 })[b.level]).slice(0, WATCH.maxPerPosTick);
    let st = ev.state; st.sent = { ...state.sent };
    for (const e of sorted) { const r = wDeliver(env, st, e, watchMessage(pos, m, e, ev.snap), now); if (r === 'sent') out.sent++; else if (r === 'failed') out.failed++; else if (r === 'capped') out.capped++; }
    // 실패한 이전 이벤트 재시도(저장된 본문 그대로, 만료 전만)
    for (const [k, rec] of Object.entries(st.sent)) if (rec.st === 'failed' && now >= rec.next && !sorted.some(e => e.key === k)) { const r = wDeliver(env, st, { key: k, sid: pos.sid }, rec.text, now); if (r === 'sent') out.sent++; else if (r === 'failed') out.failed++; }
    wSaveState(env.kv, pos.sid, st);
    pending.push(pos.sid);
  }
  if (mode === 'on' && dayBlocked) {
    const key = `DAY:${today}`; let d = {}; try { d = JSON.parse(env.kv.get('day') || '{}'); } catch (e_) { d = {}; }
    if (d.key !== key) { const r = env.send(`[RICH300] 🚫 일일 손실 한도(−3%) 도달\n오늘 실현+평가 손익 ${dayPnl.toFixed(2)} USDT (오늘 시작 평가액 ${equity.toFixed(2)} 기준)\n행동: 신규 진입과 추가 진입을 중단하세요. 기존 포지션의 위험 축소·청산은 가능합니다.\n※ 자동 주문 아님`); if (r && r.ok) env.kv.put('day', JSON.stringify({ key })); }
  }
  return out;
}
