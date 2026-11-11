// RICH300 hourly Telegram follow-up: ONLY user-confirmed "entered" signals.
// An entered response is not a Fill; this module never creates trades, profit or exchange orders.
// State in the existing tg: KV namespace (Script Properties), entirely separate from trading ledger.
// Explicit opt-in via response button; explicit stop with "closed" is irreversible from old cards.
// Safe default OFF. Every send has a pre-send attempt marker to prevent scheduler duplicates.
import { storeList } from './store.mjs';
import { pnlComputeAll } from './pnl.mjs';
import { watchAssessMarket, watchTrend, watchVolRatio, wAligned, wAgainst, wFmt, wHhmm } from './watch.mjs';

export const FOLLOW_HOUR_MS = 3600000;
export const FOLLOW_MAX_POSITIONS = 12; // prevent unlimited API calls or alert floods per run
export const FOLLOW_RETRY_MS = 10 * 60000;
export const FOLLOW_MAX_STALE_MS = 10 * 60000;

export const followKey = sid => 'follow:' + sid;
export function followRead(kv, sid) {
  let s; try { s = JSON.parse(kv.get(followKey(sid)) || 'null'); } catch (e_) { s = null; }
  return s && s.v === 1 && (s.status === 'open' || s.status === 'closed') ? s : null;
}
export function followStart(kv, sid, at) {
  const cur = followRead(kv, sid);
  if (cur) return { status: cur.status === 'closed' ? 'closed' : 'duplicate', state: cur };
  const s = { v: 1, status: 'open', enteredAt: at, confirmedAt: at, lastSentAt: null, pendingHour: null, retryAt: null };
  kv.put(followKey(sid), JSON.stringify(s));
  return { status: 'added', state: s };
}
export function followChoice(kv, sid, choice, now) {
  const s = followRead(kv, sid);
  if (!s) return { status: 'not-tracked' };
  if (s.status === 'closed') return { status: 'already-closed' };
  if (choice !== 'keep' && choice !== 'close') return { status: 'invalid' };
  if (choice === 'close') {
    kv.put(followKey(sid), JSON.stringify({ ...s, status: 'closed', closedAt: now, pendingHour: null }));
    return { status: 'closed' };
  }
  kv.put(followKey(sid), JSON.stringify({ ...s, confirmedAt: now }));
  return { status: 'kept' };
}
export function followKeyboard(sid) {
  if (!/^[A-Za-z0-9_.-]{1,54}$/.test(sid)) return null;
  return { inline_keyboard: [[
    { text: '유지 중', callback_data: 'h1:' + sid + ':k' },
    { text: '정리했어', callback_data: 'h1:' + sid + ':c' }
  ]] };
}
const followTrendLabel = t => t === 'up' ? '상승' : t === 'down' ? '하락' : t === 'flat' ? '횡보' : '판단 보류';
const followPrice = value => {
  if (value === null || value === undefined || String(value).trim() === '') return NaN;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : NaN;
};
const followPct = (value, price) => Number.isFinite(value) && price > 0 ? (100 * Math.abs(value) / price).toFixed(2) + '%' : '계산 불가';
const followSigned = value => Number.isFinite(value) ? (value >= 0 ? '+' : '') + value.toFixed(2) : '계산 불가';

// Pure advisory assessment. Signals are NOT verified Binance fills; all price-based
// levels are the original recommendation levels and must be confirmed by the owner.
export function followAssess({ signal, market, now }) {
  const dir = signal.dir, sign = dir === 'LONG' ? 1 : dir === 'SHORT' ? -1 : 0;
  const price = followPrice(market.price), entry = followPrice(signal.entry), stop = followPrice(signal.stop);
  const tp1 = followPrice(signal.tp1), tp2 = followPrice(signal.tp2);
  const risk = sign && Number.isFinite(entry) && Number.isFinite(stop) && (entry - stop) * sign > 0 ? Math.abs(entry - stop) : null;
  const rNow = risk ? (price - entry) * sign / risk : null;
  const movePct = sign && Number.isFinite(entry) ? (price - entry) * sign / entry * 100 : null;
  const stopGap = risk ? (price - stop) * sign : null;
  const stopBreach = risk && stopGap <= 0, stopNear = risk && stopGap > 0 && stopGap <= 0.25 * risk;
  const validTarget = t => Number.isFinite(t) && Number.isFinite(entry) && (t - entry) * sign > 0;
  const tp1Hit = validTarget(tp1) && (price - tp1) * sign >= 0;
  const tp2Hit = validTarget(tp2) && (price - tp2) * sign >= 0;
  const t1 = watchTrend(market.bars1h), t4 = watchTrend(market.bars4h);
  const v1 = watchVolRatio(market.bars1h);
  // Only CLOSED, recent 15m candles may determine a breakout. Compare the last
  // close to the previous four candles' extremes; not intrabar ticker noise.
  const bars = Array.isArray(market.bars15m) ? market.bars15m : [];
  const last = bars.length ? bars[bars.length - 1] : null;
  const closed15 = last && Number.isFinite(last.t) && last.t + 900000 <= now &&
    now - last.t <= 40 * 60000 && Number.isFinite(last.c) && last.c > 0 && bars.length >= 5;
  const prev = closed15 ? bars.slice(-5, -1) : [];
  const boundsOk = prev.length === 4 && prev.every(b => Number.isFinite(b.h) && Number.isFinite(b.l) && b.h > 0 && b.l > 0);
  const low15 = boundsOk ? Math.min(...prev.map(b => b.l)) : null;
  const high15 = boundsOk ? Math.max(...prev.map(b => b.h)) : null;
  const v15 = closed15 ? watchVolRatio(bars) : null;
  const favorable15 = boundsOk && (sign > 0 ? last.c > high15 : last.c < low15);
  const adverse15 = boundsOk && (sign > 0 ? last.c < low15 : last.c > high15);
  const adverse1 = wAgainst(t1, dir), adverse4 = wAgainst(t4, dir);
  const aligned1 = wAligned(t1, dir), aligned4 = wAligned(t4, dir);
  const opposite15 = adverse15 && v15 !== null && v15 >= 1.2;
  let status, verdict, why, next, urgent = null;
  if (stopBreach) {
    status = '손절 기준 이탈'; verdict = '청산 체결 여부 즉시 확인';
    why = '공개 시세가 최초 추천 손절선을 벗어났습니다.';
    next = '거래소에서 손절 주문·잔량을 확인하고 아직 보유 중이라면 청산 여부를 즉시 결정하세요. 손절 폭을 넓히지 마세요.';
    urgent = 'stop';
  } else if (tp2Hit) {
    status = '2차 목표 도달'; verdict = '잔량·익절 체결 확인';
    why = '현재 시세가 최초 TP2 기준에 도달했습니다(체결 확인 아님).';
    next = '계획한 잔량 정리와 실제 TP 체결 여부를 점검하세요. 추가 진입보다 수익 보호가 우선입니다.';
    urgent = 'tp2';
  } else if (tp1Hit) {
    status = '1차 목표 도달'; verdict = '부분 익절·수익 보호 검토';
    why = '현재 시세가 최초 TP1 기준에 도달했습니다(체결 확인 아님).';
    next = '예정된 부분 익절 체결과 잔량을 확인하세요. 실제 익절 후에만 본절·추적손절 조정을 검토하세요.';
    urgent = 'tp1';
  } else if (stopNear) {
    status = '손절선 근접'; verdict = '위험 축소·손절 주문 우선 확인';
    why = '현재가와 손절선 간격이 최초 위험폭 0.25R 이하입니다.';
    next = '거래소 손절 주문이 유효한지 먼저 확인하고, 추가 진입 없이 손절 계획을 유지하세요.';
    urgent = 'near-stop';
  } else if (adverse1 && adverse4) {
    status = '추세 역행'; verdict = '포지션 축소·청산 검토';
    why = '1시간봉과 4시간봉이 모두 최초 추천 방향에 역행합니다.';
    next = '15분봉이 반대 방향 돌파를 확정하면 청산·축소를 우선 재검토하세요. 신규 진입은 보류하세요.';
    urgent = 'reversal';
  } else if (opposite15 && (adverse1 || adverse4)) {
    status = '15분 반대 돌파'; verdict = '유지 근거 재검토';
    why = '확정된 15분봉이 직전 4개 봉의 반대쪽 범위를 거래량 1.2배 이상으로 돌파했습니다.';
    next = '다음 확정봉의 되돌림 여부를 확인하며 기존 손절 기준에 따라 축소·청산을 검토하세요. 추가 진입은 보류하세요.';
    urgent = 'reversal15';
  } else if (adverse1 || adverse4) {
    status = '추세 약화'; verdict = '방어적 유지·추가 진입 보류';
    why = (adverse1 ? '1시간봉' : '4시간봉') + '이 추천 방향과 반대입니다.';
    next = '추세 회복 또는 확정 15분봉의 반대 돌파를 확인하세요. 기존 손절선은 넓히지 마세요.';
  } else if (aligned1 && aligned4) {
    status = '추세 유지'; verdict = '계획대로 유지 우세';
    why = '1시간봉·4시간봉이 모두 추천 방향에 정렬되어 있습니다.' +
      (v1 !== null && v1 < 1 ? ' 다만 1시간 거래량이 평균보다 낮습니다.' : '');
    next = '확정 15분봉의 추세 방향 돌파와 거래량 회복을 확인하세요. TP1 도달 전 임의 본절 이동은 서두르지 마세요.';
  } else {
    status = '방향 혼조'; verdict = '유지 조건 재점검·관망';
    why = '상위 시간봉의 추세 정렬이 명확하지 않습니다.';
    next = '다음 1시간봉 마감과 15분봉의 방향·거래량을 확인하세요. 추가 진입은 보류하세요.';
  }
  const stopText = risk ? wFmt(stop, entry) + ' (현재가에서 ' + followPct(stopGap, price) + ', ' +
    (stopGap >= 0 ? (stopGap / risk).toFixed(2) + 'R 남음' : '기준 이탈') + ')' : '유효한 최초 손절선 없음 · R 계산 불가';
  const targetText = (t, name) => validTarget(t) ? name + ' ' + wFmt(t, price) + ' (' +
    ((t - price) * sign > 0 ? '남은 거리 ' : '현재가 기준 도달 · ') + followPct(t - price, price) + ')' : name + ' 미설정';
  const fifteenText = !closed15 || !boundsOk ? '최근 확정봉 비교 불가' : favorable15
    ? '추천 방향 15분봉 돌파' : adverse15 ? '반대 방향 15분봉 돌파' : '직전 4봉 범위 내';
  const volText = n => n === null ? '확인 불가' : '평균 ' + n.toFixed(2) + '배';
  const trigger = boundsOk ? '15분봉 종가 기준 ' +
    (sign > 0 ? '상단 ' + wFmt(high15, price) + ' 돌파 시 강화 / 하단 ' + wFmt(low15, price) + ' 이탈 시 경고' :
      '하단 ' + wFmt(low15, price) + ' 이탈 시 강화 / 상단 ' + wFmt(high15, price) + ' 돌파 시 경고') :
    '15분 확정봉 범위 재확인';
  return { status, verdict, why, next, urgent, price, entry, stop, tp1, tp2, rNow, movePct, t1, t4, v1, v15,
    fifteenText, trigger, stopText, targetText: targetText(tp1, 'TP1') + ' · ' + targetText(tp2, 'TP2'),
    trendText: '1H ' + followTrendLabel(t1.state) + ' · 4H ' + followTrendLabel(t4.state) + ' · 1H 거래량 ' + volText(v1),
    m15Text: fifteenText + ' · 15분 거래량 ' + volText(v15) };
}
export function followReport({ signal, market, now, enteredAt, urgent = false }) {
  const a = followAssess({ signal, market, now });
  const time = new Date(now + 9 * FOLLOW_HOUR_MS).toISOString().slice(5, 16).replace('T', ' ');
  const age = Math.round((now - market.priceAt) / 60000);
  const original = typeof signal.summary === 'string' && signal.summary.trim()
    ? signal.summary.trim().slice(0, 120) : signal.strategy === 'S'
      ? '4H 추세·1H 눌림 구간·15분 확정 트리거·거래량·비용 반영 손익비가 추천 당시 조건이었습니다.'
      : '추천 세부 설명 미저장. 최초 진입·손절·목표 기준을 비교합니다.';
  const dir = signal.dir;
  return [
    urgent ? '🚨 RICH300 · 포지션 전략 변경 경고' : '📊 RICH300 · 1시간 포지션 점검',
    signal.symbolId.replace(/USDT$/, '') + ' ' + dir + ' · ' + time + ' KST',
    '🔎 판단: [' + a.status + '] ' + a.verdict,
    '진입 응답: ' + new Date(enteredAt + 9 * FOLLOW_HOUR_MS).toISOString().slice(11,16) + ' KST (실제 체결 미확인)',
    '',
    '① 현재 위치 (공개 시세 · 실제 손익 아님)',
    '현재 공개 시세 (' + market.source + ', ' + wHhmm(market.priceAt) + ' KST' +
      (age > 1 ? ', ' + age + '분 전' : '') + '): ' + wFmt(a.price, a.price),
    '추천 진입 ' + signal.entry + ' · 방향 변화 ' + followSigned(a.movePct) + '% · ' +
      (a.rNow === null ? 'R 계산 불가' : followSigned(a.rNow) + 'R (최초 손절폭 기준)'),
    '손절 기준 ' + a.stopText,
    a.targetText,
    '',
    '② 추세 · 확인된 15분봉',
    a.trendText,
    a.m15Text,
    '',
    '③ 지금 판단과 대응',
    '근거: ' + a.why,
    '대응: ' + a.next,
    '다음 점검: ' + a.trigger,
    '',
    '최초 추천 기준: ' + original,
    '※ 전략 기준 가상 추적 · 실제 Binance 체결 아님 · 자동 주문·청산 없음.',
    '※ 손익/수수료/증거금/레버리지는 거래소 체결 내역으로 별도 확인하세요.',
    '포지션이 종료됐다면 [정리했어]를 눌러 다음 보고를 중단하세요.'
  ].join('\n').slice(0, 3600);
}
export const FOLLOW_MONITOR_MS = 15 * 60000;
export const FOLLOW_ALERT_COOLDOWN_MS = 30 * 60000;
export function followTick(env) {
  const mode = env.mode();
  if (mode !== 'on' && mode !== 'preview') return { status: 'off' };
  const now = env.now(), se = env.storeEnv();
  const signals = new Map(storeList(se, 'signal').map(r => [r.key, r.data]));
  const responses = storeList(se, 'response').map(r => r.data).filter(r => r.choice === 'entered').sort((a,b) => a.at - b.at);
  const tradeMap = pnlComputeAll(storeList(se, 'fill').map(r => r.data), {});
  const out = { status: 'ok', mode, entered: responses.length, active: 0, due: 0, scanned: 0,
    alerts: 0, sent: 0, failed: 0, stale: 0, closed: 0, missing: 0, capped: 0 };
  const h = Math.floor(now / FOLLOW_HOUR_MS), slot = Math.floor(now / FOLLOW_MONITOR_MS);
  for (const r of responses) {
    // Only entered responses with an explicit opt-in may be assessed. Never forge fills.
    const st = followRead(env.kv, r.sid);
    if (!st || st.status === 'closed') continue;
    const trade = tradeMap.get(r.sid);
    if (trade && trade.status === 'closed') {
      out.closed++;
      if (mode === 'on') followChoice(env.kv, r.sid, 'close', now);
      continue;
    }
    const sig = signals.get(r.sid);
    if (!sig) { out.missing++; continue; }
    out.active++;
    const next = (st.lastSentAt === null ? Math.max(st.enteredAt, r.at) : st.lastSentAt) + FOLLOW_HOUR_MS;
    const hourly = now >= next && !(st.retryAt && now < st.retryAt) && st.pendingHour !== h;
    // Existing five-minute trigger evaluates market at most once per 15-minute slot
    // between hourly reports. Do not add a trigger or poll the exchange every five minutes.
    if (!hourly && (now < Math.max(st.enteredAt, r.at) || st.lastMonitorSlot === slot)) continue;
    if (out.scanned >= FOLLOW_MAX_POSITIONS) { out.capped++; continue; }
    out.scanned++;
    if (hourly) out.due++;
    let market; try { market = env.market(sig.symbolId); } catch (e_) { market = null; }
    if (!market || !market.ok || !watchAssessMarket(market, now).ok) { out.stale++; continue; }
    const assessment = followAssess({ signal: sig, market, now });
    if (mode === 'preview') continue; // No KV writes, no Telegram, no new fills.
    const observed = { ...st, lastMonitorSlot: slot };
    if (hourly) {
      // Mark attempt BEFORE send so concurrent triggers cannot duplicate messages.
      const pending = { ...observed, pendingHour: h, retryAt: null };
      env.kv.put(followKey(r.sid), JSON.stringify(pending));
      const message = followReport({ signal: sig, market, now, enteredAt: r.at });
      let sent; try { sent = env.send(message, r.sid); } catch (e_) { sent = { ok: false, code: 'exception' }; }
      if (sent && sent.ok) {
        env.kv.put(followKey(r.sid), JSON.stringify({ ...pending, pendingHour: null, lastSentAt: now,
          lastUrgentKey: assessment.urgent, lastUrgentAt: assessment.urgent ? now : st.lastUrgentAt || null }));
        out.sent++;
      } else {
        env.kv.put(followKey(r.sid), JSON.stringify({ ...pending, retryAt: now + FOLLOW_RETRY_MS }));
        out.failed++;
      }
      continue;
    }
    // Significant changes outside the normal hour: stop, TP, close-to-stop or
    // confirmed adverse trend. Alert only on a transition, with a cooldown.
    const changed = assessment.urgent && assessment.urgent !== st.lastUrgentKey;
    const cooldown = now - (st.lastUrgentAt || 0) >= FOLLOW_ALERT_COOLDOWN_MS;
    const shouldAlert = changed && (cooldown || assessment.urgent === 'stop');
    if (!shouldAlert) {
      env.kv.put(followKey(r.sid), JSON.stringify({
        ...observed, lastUrgentKey: assessment.urgent || null }));
      continue;
    }
    // At-most-once best-effort: reserve state before attempting delivery.
    const pending = { ...observed, lastUrgentKey: assessment.urgent, lastUrgentAt: now };
    env.kv.put(followKey(r.sid), JSON.stringify(pending));
    const message = followReport({ signal: sig, market, now, enteredAt: r.at, urgent: true });
    let sent; try { sent = env.send(message, r.sid); } catch (e_) { sent = { ok: false, code: 'exception' }; }
    if (sent && sent.ok) { out.sent++; out.alerts++; }
    else out.failed++;
  }
  return out;
}
