// R7 일 마감(KST 00:00 기준). 순수 로직 + env 포트: 같은 코드를 Node 테스트와 Apps Script가 쓴다.
//  env = { now(): ms, storeEnv(): R3 저장소 env, notify?(msg: {text, url?}): {ok, code?}, sendEnabled?(): boolean, uiUrl?: string }
//  원칙
//   · 마감은 날짜당 한 번: `dayclose`(불변, 키=날짜). 같은 날짜를 동시에·반복 마감해도 한 건만 남는다(저장소 유일키 + 락).
//   · 마감은 그날의 *스냅샷*이다. 평가액을 나중에 입력해도 마감 기록은 바뀌지 않고, 입력은 늦은 입력(late)으로 표시된다. 목표·이상선·장부 계산은 R2 결과를 그대로 쓴다(여기서 다시 계산하지 않음).
//   · 평가액 미입력 알림은 날짜당 *최대 1회*(알림 상태 `closenotice`). 알림은 기본 OFF: 설정(closeNotify)이 on이고 sendEnabled()가 true일 때만 보낸다.
//     확실한 실패일 때만 1번 더 시도하고(총 2회), 결과를 알 수 없는 상태(발송 중 중단)는 다시 보내지 않는다(중복 발송보다 누락을 택함).
//   · 알림 문구에 금액은 장부 잔고 하나만 넣는다. 평가액을 *대신 입력하거나 추정해서 저장하지 않는다*(숫자는 사용자가 직접 입력).
//   · 놓친 날(트리거 누락·장기간 미실행)은 다음 실행에서 날짜 순서대로 한 번씩 마감한다(최대 31일).
import { decFormat, microToDec } from './decimal.mjs';
import { kstDayOf, addDays, dayToIndex, dayEndMs, isDayString } from './time.mjs';
import { ledgerBuildDaily } from './ledger.mjs';
import { StoreError, schemaDecString } from './schema.mjs';
import { storeLoadLedgerInputs, storeGet, storeList, storeCreate, storeRevise, storeGetSettings } from './store.mjs';

export const CLOSE_MAX_CATCHUP = 31;
export const CLOSE_MAX_ATTEMPTS = 2;
export const CLOSE_PENDING_STALE_MS = 15 * 60 * 1000;
export const CLOSE_WARNING_TEXT = Object.freeze({
  'ledger-mismatch': '장부와 입력 평가액의 차이가 큽니다',
  'close-from-ledger': '평가액 미입력(장부 근사값 사용)',
  'fee-missing': '수수료 미입력 체결이 있습니다',
  'funding-missing': '펀딩 미입력 체결이 있습니다',
  'has-estimates': '추정 수수료·펀딩이 포함되어 있습니다',
  'unrealized-missing': '보유 포지션이 있는데 미실현 손익이 없습니다',
  'opening-basis-unknown': '시작 포지션의 기준 진입가를 모릅니다',
  'late-entry': '마감 후에 입력한 평가액입니다',
  'possible-missing-cashflow': '거래·입출금이 없는 날인데 평가액이 장부와 다릅니다 — 입출금 누락 의심',
  'fees-may-explain': '수수료·펀딩 미입력이 차이의 원인일 수 있습니다',
});
export const closeUsd = micro => { const neg = micro < 0n, a = neg ? -micro : micro, s = decFormat(microToDec(a), 2); return `${neg && a >= 5000n ? '−' : ''}${s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`; };

// 진단(경고 코드): 값은 만들지 않고 *원인 후보*만 알려 준다. 자동 보정 없음.
export function closeDiagnose(row, { fillCount = 0, cashCount = 0, adjCount = 0 } = {}) {
  const f = new Set(row.flags);
  const missingFeeFunding = f.has('fee-missing') || f.has('funding-missing');
  if (row.needsReview && fillCount === 0 && cashCount === 0 && adjCount === 0) f.add('possible-missing-cashflow');
  if (row.needsReview && fillCount > 0 && missingFeeFunding) f.add('fees-may-explain');
  return [...f];
}
function closeCounts(inputs, day) {
  const d = at => kstDayOf(at) === day;
  return { fillCount: inputs.fills.filter(x => d(x.at)).length, cashCount: inputs.cashflows.filter(x => d(x.at)).length, adjCount: inputs.adjustments.filter(x => d(x.at)).length };
}
function closeRecord(row, now, flags) {
  return { day: row.day, closedAt: now, source: row.closeSource, startMicro: String(row.startMicro), targetMicro: String(row.targetCloseMicro), closeMicro: String(row.closeMicro), pnlMicro: String(row.pnlMicro), walletMicro: String(row.ledgerWalletMicro),
    ...(row.diffMicro === null ? {} : { diffMicro: String(row.diffMicro) }), needsReview: row.needsReview, flags };
}

// ── 알림 ──
export function closeMessage(items, uiUrl) {          // items: [{day, walletMicro}] (오름차순)
  const first = items[0], last = items[items.length - 1];
  const text = items.length === 1 ? `RICH300 · ${first.day} 마감 평가액 미입력\n장부 잔고 ${closeUsd(BigInt(first.walletMicro))} USDT · 입력하면 차이를 확인합니다`
    : `RICH300 · 마감 평가액 미입력 ${items.length}일 (${first.day} ~ ${last.day})\n최근 장부 잔고 ${closeUsd(BigInt(last.walletMicro))} USDT · 입력하면 차이를 확인합니다`;
  const url = typeof uiUrl === 'string' && /^https:\/\/\S+$/.test(uiUrl) ? `${uiUrl}${uiUrl.includes('?') ? '&' : '?'}p=journal&day=${last.day}#close` : null;
  return { text, url };
}
function closeSend(env, se, days, records) {          // days: 이미 claim(pending)한 날짜들. 결과를 notice에 기록한다.
  const items = days.map(d => ({ day: d, walletMicro: records.get(d).walletMicro }));
  let res; try { res = env.notify(closeMessage(items, env.uiUrl)); } catch { res = { ok: false, code: 'exception' }; }
  const ok = !!(res && res.ok), at = env.now();
  for (const d of days) {
    storeRevise(se, 'closenotice', d, ok ? { status: 'sent', at } : { status: 'failed', at, error: String(res?.code ?? 'failed').slice(0, 40) }, { actor: 'close', reason: ok ? '발송 완료' : '발송 실패' });
  }
  return ok;
}
function closeNotifyDays(env, days, records) {         // 새로 마감된 날짜 중 평가액 미입력인 날
  const se = env.storeEnv(), out = { sent: 0, failed: 0, off: 0, skipped: 0 };
  if (!days.length) return out;
  const on = storeGetSettings(se).closeNotify === 'on', allowed = typeof env.sendEnabled === 'function' && env.sendEnabled() === true && typeof env.notify === 'function';
  if (!on || !allowed) {                               // 꺼져 있으면 보내지 않고, 나중에 켜도 과거 날짜를 소급 발송하지 않도록 기록한다
    for (const d of days) { const r = storeCreate(se, 'closenotice', { day: d, status: 'off', attempts: 0, at: env.now(), error: on ? 'not-approved' : 'setting-off' }, { actor: 'close' }); out[r.status === 'added' ? 'off' : 'skipped']++; }
    return out;
  }
  const claimed = [];
  for (const d of days) { const r = storeCreate(se, 'closenotice', { day: d, status: 'pending', attempts: 1, at: env.now() }, { actor: 'close' }); if (r.status === 'added') claimed.push(d); else out.skipped++; }
  if (claimed.length) { if (closeSend(env, se, claimed, records)) out.sent += claimed.length; else out.failed += claimed.length; }
  return out;
}
// 재시도: 확실히 실패한 알림만(총 2회까지), 발송 중 중단(pending 오래됨)은 unknown으로 두고 재발송하지 않는다.
export function closeRetryNotices(env) {
  const se = env.storeEnv(), now = env.now(), out = { retried: 0, sent: 0, failed: 0, unknown: 0, skipped: 0 };
  const on = storeGetSettings(se).closeNotify === 'on', allowed = typeof env.sendEnabled === 'function' && env.sendEnabled() === true && typeof env.notify === 'function';
  const eq = new Set(storeList(se, 'equity').map(r => r.data.day));
  for (const n of storeList(se, 'closenotice')) {
    const d = n.data;
    if (d.status === 'pending' && now - d.at > CLOSE_PENDING_STALE_MS) { storeRevise(se, 'closenotice', d.day, { status: 'unknown', at: now }, { actor: 'close', reason: '발송 결과 불명(재발송하지 않음)' }); out.unknown++; continue; }
    if (d.status !== 'failed') continue;
    if (!on || !allowed || d.attempts >= CLOSE_MAX_ATTEMPTS || eq.has(d.day)) { out.skipped++; continue; }
    const rec = storeGet(se, 'dayclose', d.day); if (!rec || rec.void) { out.skipped++; continue; }
    storeRevise(se, 'closenotice', d.day, { status: 'pending', attempts: d.attempts + 1, at: now, error: null }, { actor: 'close', reason: '재시도' }); out.retried++;
    if (closeSend(env, se, [d.day], new Map([[d.day, rec.data]]))) out.sent++; else out.failed++;
  }
  return out;
}

// ── 마감 ──
// 계획(읽기만)과 확정(쓰기)을 나눠 둔다: 계획 후 다른 실행이 먼저 확정해도 확정 단계의 유일키가 한 건만 남긴다.
export function closePlan(env, { now = env.now() } = {}) {
  const se = env.storeEnv(); let inputs;
  try { inputs = storeLoadLedgerInputs(se); } catch (e) { if (e instanceof StoreError && e.code === 'NOT_FOUND') return { status: 'no-challenge', todo: [] }; throw e; }
  const startDay = inputs.challenge.startDay, last = addDays(kstDayOf(now), -1);
  if (dayToIndex(last) < dayToIndex(startDay)) return { status: 'not-started', todo: [] };
  const done = new Set(storeList(se, 'dayclose').map(r => r.data.day)), todo = [];
  for (let d = startDay; dayToIndex(d) <= dayToIndex(last) && todo.length < CLOSE_MAX_CATCHUP; d = addDays(d, 1)) if (!done.has(d)) todo.push(d);
  return { status: 'ok', todo, inputs };
}
export function closeCommit(env, plan, { now = env.now() } = {}) {
  if (plan.status !== 'ok') return { status: plan.status, closed: [], skipped: [] };
  if (!plan.todo.length) return { status: 'ok', closed: [], skipped: [], notices: { sent: 0, failed: 0, off: 0, skipped: 0 } };
  const se = env.storeEnv(), inputs = plan.inputs, led = ledgerBuildDaily({ ...inputs, throughDay: plan.todo[plan.todo.length - 1] }), byDay = new Map(led.rows.map(r => [r.day, r]));
  const closed = [], skipped = [], records = new Map(), missing = [];
  for (const day of plan.todo) {
    const row = byDay.get(day), rec = closeRecord(row, now, closeDiagnose(row, closeCounts(inputs, day)));
    const r = storeCreate(se, 'dayclose', rec, { actor: 'close' });
    if (r.status === 'added') { closed.push(day); records.set(day, rec); if (rec.source === 'ledger') missing.push(day); } else skipped.push(day);   // duplicate/conflict: 다른 실행이 이미 마감함
  }
  return { status: 'ok', closed, skipped, notices: closeNotifyDays(env, missing, records) };
}
export const closeRun = (env, { now = env.now() } = {}) => closeCommit(env, closePlan(env, { now }), { now });
// 트리거 한 번(00:00 및 이후 매시간 재확인): 놓친 날 마감 + 확실히 실패한 알림 재시도
export function closeTick(env, { now = env.now() } = {}) {
  const run = closeRun(env, { now }), retry = closeRetryNotices({ ...env, now: () => now });
  return { ...run, retry };
}

// ── 평가액 입력 ──
export function closeCheckEquityDay(env, day, now = env.now()) {       // 입력 가능한 날짜인지(저장 없이) 확인. 오류는 VALIDATION(사용자에게 그대로 안내 가능한 문구)
  const inputs = storeLoadLedgerInputs(env.storeEnv());
  if (!isDayString(day)) throw new StoreError('VALIDATION', '날짜 형식 오류(YYYY-MM-DD)');
  if (dayToIndex(day) < dayToIndex(inputs.challenge.startDay)) throw new StoreError('VALIDATION', '챌린지 시작일 이전입니다');
  if (dayToIndex(day) > dayToIndex(kstDayOf(now))) throw new StoreError('VALIDATION', '미래 날짜에는 입력할 수 없습니다');
  return inputs;
}
export function closeSubmitEquity(env, { day, equity, unrealized, reason } = {}, { actor = 'ui', now = env.now() } = {}) {
  const se = env.storeEnv(); closeCheckEquityDay(env, day, now);
  const eq = schemaDecString(equity, '평가액', { nonNegative: true }), un = unrealized === undefined || unrealized === null || unrealized === '' ? undefined : schemaDecString(unrealized, '미실현 손익');
  const late = now >= dayEndMs(day), data = { day, equity: eq, ...(un === undefined ? {} : { unrealized: un }), ...(late ? { late: true } : {}), enteredAt: now };
  const cur = storeGet(se, 'equity', day); let r;
  if (!cur || cur.void) r = storeCreate(se, 'equity', data, { actor });
  else if (cur.data.equity === eq && (cur.data.unrealized ?? undefined) === un) r = { status: 'unchanged', key: day, rev: cur.rev };
  else r = storeRevise(se, 'equity', day, { equity: eq, unrealized: un === undefined ? null : un, late: late ? true : null, enteredAt: now }, { actor, reason: typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 200) : '평가액 수정' });
  const after = storeLoadLedgerInputs(se), led = ledgerBuildDaily({ ...after, throughDay: day }), row = led.rows[led.rows.length - 1];
  return { status: r.status, day, late, diffMicro: row.diffMicro === null ? null : String(row.diffMicro), expectedMicro: row.expectedEquityMicro === null ? null : String(row.expectedEquityMicro), needsReview: row.needsReview, flags: closeDiagnose(row, closeCounts(after, day)), diffLabel: row.diffMicro === null ? null : closeUsd(row.diffMicro), expectedLabel: row.expectedEquityMicro === null ? null : closeUsd(row.expectedEquityMicro) };
}
// 최근 N일의 마감·입력·알림 상태(일지 화면용)
export function closeStatus(env, { now = env.now(), days = 14 } = {}) {
  const se = env.storeEnv(), today = kstDayOf(now), out = [];
  let inputs; try { inputs = storeLoadLedgerInputs(se); } catch (e) { if (e instanceof StoreError && e.code === 'NOT_FOUND') return []; throw e; }
  const closes = new Map(storeList(se, 'dayclose').map(r => [r.data.day, r])), eqs = new Map(storeList(se, 'equity').map(r => [r.data.day, r])), notices = new Map(storeList(se, 'closenotice').map(r => [r.data.day, r.data]));
  for (let i = 0; i < days; i++) {
    const day = addDays(today, -i); if (dayToIndex(day) < dayToIndex(inputs.challenge.startDay)) break;
    const c = closes.get(day), e = eqs.get(day), n = notices.get(day);
    out.push({ day, today: i === 0, closed: !!c, source: c ? c.data.source : null, equity: e ? e.data.equity : null, late: e ? !!e.data.late : false, equityRev: e ? e.rev : 0, notice: n ? n.status : null, flags: c ? c.data.flags ?? [] : [], needsReview: c ? c.data.needsReview : false, diffMicro: c ? c.data.diffMicro ?? null : null, diffLabel: c && c.data.diffMicro !== undefined ? `${BigInt(c.data.diffMicro) > 0n ? '+' : ''}${closeUsd(BigInt(c.data.diffMicro))}` : null, walletMicro: c ? c.data.walletMicro : null });
  }
  return out;
}
