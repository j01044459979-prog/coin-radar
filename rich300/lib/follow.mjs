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
export function followReport({ signal, market, now, enteredAt }) {
  const t1 = watchTrend(market.bars1h), t4 = watchTrend(market.bars4h),
    v1 = watchVolRatio(market.bars1h), price = market.price, dir = signal.dir, sign = dir === 'LONG' ? 1 : -1;
  const entry = Number(signal.entry), stop = Number(signal.stop), tp1 = Number(signal.tp1), tp2 = Number(signal.tp2);
  const stopPassed = (price - stop) * sign <= 0, tp1Passed = (price - tp1) * sign >= 0,
    tp2Passed = Number.isFinite(tp2) && (price - tp2) * sign >= 0;
  const against1 = wAgainst(t1, dir), against4 = wAgainst(t4, dir), aligned1 = wAligned(t1, dir);
  let verdict, reasons;
  if (stopPassed) {
    verdict = '손절 기준 이탈 — 거래소의 실제 손절 체결 여부를 확인';
    reasons = ['현재 공개 시세가 처음 정한 손절 기준을 벗어났습니다.', '이미 체결된 손절 주문이 있는지 직접 확인하세요.'];
  } else if (tp2Passed) {
    verdict = '2차 목표 도달 — 익절 체결 여부 및 잔량 점검';
    reasons = ['현재 공개 시세가 최초 2차 목표를 넘어섰습니다.'];
  } else if (tp1Passed) {
    verdict = '1차 목표 도달 — 부분 익절·손절 보호 조건 점검';
    reasons = ['현재 공개 시세가 최초 1차 목표를 넘어섰습니다.'];
  } else if (against1 && against4) {
    verdict = '추천 추세와 반대 방향 — 손절·보유 근거 재검토';
    reasons = ['1시간과 4시간 추세가 모두 선택한 방향에 반대입니다.'];
  } else if (against1 || against4) {
    verdict = '추세 일부 약화 — 리스크 확대 없이 경과 확인';
    reasons = [against1 ? '1시간 추세가 반대 방향입니다.' : '4시간 추세가 반대 방향입니다.'];
  } else if (aligned1) {
    verdict = '기존 방향 유지 가능성 — 지정 손절선 유효 여부 점검';
    reasons = ['1시간 추세가 추천 방향과 같습니다.', '이것만으로 수익을 보장하지 않습니다.'];
  } else {
    verdict = '방향 미확정 — 기존 계획과 변동성 점검';
    reasons = ['1시간 추세가 명확히 정렬되지 않았습니다.'];
  }
  const time = new Date(now + 9 * FOLLOW_HOUR_MS).toISOString().slice(5, 16).replace('T', ' ');
  const age = Math.round((now - market.priceAt) / 60000);
  const original = typeof signal.summary === 'string' && signal.summary.trim()
    ? signal.summary.trim().slice(0, 120) : '추천 세부 설명 미저장. 최초 진입·손절·목표 기준을 비교합니다.';
  const priceChange = Number.isFinite(entry) && entry > 0 ? (price - entry) * sign / entry * 100 : null;
  return [
    '📊 RICH300 · 1시간 포지션 점검',
    signal.symbolId.replace(/USDT$/, '') + ' ' + dir + ' · ' + time + ' KST',
    '진입 응답: ' + new Date(enteredAt + 9 * FOLLOW_HOUR_MS).toISOString().slice(11,16) + ' KST (실제 체결 미확인)',
    '',
    '최초 추천 기준: ' + original,
    '추천 진입 ' + signal.entry + ' · 손절 ' + signal.stop + ' · TP1 ' + signal.tp1 + (signal.tp2 ? ' · TP2 ' + signal.tp2 : ''),
    '현재 공개 시세 (' + market.source + ', ' + wHhmm(market.priceAt) + ' KST' + (age > 1 ? ', ' + age + '분 전' : '') + '): ' + wFmt(price, price),
    '추천 진입가 대비 방향 변화: ' + (priceChange === null ? '계산 불가' : (priceChange >= 0 ? '+' : '') + priceChange.toFixed(2) + '%') + ' (실제 손익 아님)',
    '1H ' + followTrendLabel(t1.state) + ' · 4H ' + followTrendLabel(t4.state)
      + ' · 1H 거래량 ' + (v1 === null ? '확인 불가' : '평균 대비 ' + v1.toFixed(2) + '배'),
    '',
    '판단 참고: ' + verdict,
    ...reasons.map(x => '• ' + x),
    '※ 자동 주문·청산 없음. 손익은 실제 체결·수수료에 따라 달라집니다.',
    '포지션이 종료됐다면 [정리했어]를 눌러 다음 보고를 중단하세요.'
  ].join('\n').slice(0, 3600);
}
export function followTick(env) {
  const mode = env.mode();
  if (mode !== 'on' && mode !== 'preview') return { status: 'off' };
  const now = env.now(), se = env.storeEnv();
  const signals = new Map(storeList(se, 'signal').map(r => [r.key, r.data]));
  const responses = storeList(se, 'response').map(r => r.data).filter(r => r.choice === 'entered').sort((a,b) => a.at - b.at);
  const tradeMap = pnlComputeAll(storeList(se, 'fill').map(r => r.data), {});
  const out = { status: 'ok', mode, entered: responses.length, active: 0, due: 0, sent: 0, failed: 0, stale: 0, closed: 0, missing: 0, capped: 0 };
  const h = Math.floor(now / FOLLOW_HOUR_MS);
  for (const r of responses) {
    // Only selections made by an existing opt-in button can initiate follow-up.
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
    if (now < next || (st.retryAt && now < st.retryAt) || st.pendingHour === h) continue;
    if (out.due >= FOLLOW_MAX_POSITIONS) { out.capped++; continue; }
    out.due++;
    let market; try { market = env.market(sig.symbolId); } catch (e_) { market = null; }
    if (!market || !market.ok || !watchAssessMarket(market, now).ok) { out.stale++; continue; }
    const text = followReport({ signal: sig, market, now, enteredAt: r.at });
    if (mode === 'preview') continue;
    // Mark the attempt BEFORE Telegram to prevent overlapping scheduler runs from duplicating reports.
    const pending = { ...st, pendingHour: h, retryAt: null };
    env.kv.put(followKey(r.sid), JSON.stringify(pending));
    let sent; try { sent = env.send(text, r.sid); } catch (e_) { sent = { ok: false, code: 'exception' }; }
    if (sent && sent.ok) {
      env.kv.put(followKey(r.sid), JSON.stringify({ ...pending, pendingHour: null, lastSentAt: now }));
      out.sent++;
    } else {
      // Transient error: next check may retry; a time-out with unknown delivery must not retry immediately.
      env.kv.put(followKey(r.sid), JSON.stringify({ ...pending, retryAt: now + FOLLOW_RETRY_MS }));
      out.failed++;
    }
  }
  return out;
}
