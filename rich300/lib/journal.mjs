// R7 매매일지: 조회(거래·체결 타임라인·수정 이력·마감 상태·통계) + 안전한 수정(체결 수정/취소, 입출금 기록).
//  · 모든 수정은 *추가 전용 이력*으로 남는다(R3 리비전·취소). 이전 값은 사라지지 않고 이력에 diff로 표시된다. 수정에는 사유가 필요하다.
//  · 수정 전에 *계산 가능 여부를 미리 검증*한다(예: 진입 체결을 취소해 청산만 남기거나 잔량보다 많이 청산하게 만들면 저장하지 않음).
//  · 손익·잔고는 R2 결과를 그대로 사용한다. 이 모듈은 표시용 변환과 입력 검증만 한다.
//  · 실제 기록만 다룬다(모의 체결은 저장소가 거부).
import { dec, decToMicro } from './decimal.mjs';
import { kstDayOf, isDayString } from './time.mjs';
import { ledgerBuildDaily } from './ledger.mjs';
import { pnlComputeTrade } from './pnl.mjs';
import { StoreError, ENTITIES, PLAN_CHOICES, MIND_CHOICES, RESPONSE_CHOICES, schemaDecString } from './schema.mjs';
import { storeLoadLedgerInputs, storeList, storeGet, storeCreate, storeRevise, storeVoid, storeReadAudit } from './store.mjs';
import { anBuild, anUsd } from './analytics.mjs';
import { closeStatus, closeDiagnose, CLOSE_WARNING_TEXT } from './close.mjs';
import { nullishOr } from './nullish.mjs';

export const JOURNAL_FILL_EDITABLE = Object.freeze(['price', 'qty', 'at', 'margin', 'leverage', 'plannedStop', 'fee', 'funding', 'note']);
export const JOURNAL_LIMIT = 40;
const JV_KIND = { opening: '시작 포지션', entry: '진입', add: '추가진입', reduce: '부분청산', close: '전량청산' };
const jvKst = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
const jvText = v => {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'object' && v && 'state' in v) return v.state === 'missing' ? '미입력' : `${v.state === 'estimated' ? '추정 ' : ''}${v.amount}`;
  if (typeof v === 'number' && Number.isInteger(v) && v > 1e11) return jvKst(v);
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
};
const jvEditAmt = v => (!v || v.state === 'missing' ? '' : `${v.state === 'estimated' ? '~' : ''}${v.amount}`);   // 입력 칸 표기(R4와 동일: 추정은 ~)
const jvParse = s => { try { return s ? JSON.parse(s) : null; } catch (e_) { return null; } };
const jvFail = m => { throw new StoreError('VALIDATION', m); };

export function journalDiff(before, after) {          // 최상위 필드 단위 변경 목록(표시용)
  const b = (before != null ? before : {}), a = (after != null ? after : {}), keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort(), out = [];
  for (const k of keys) if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) out.push({ field: k, from: jvText(b[k]), to: jvText(a[k]) });
  return out;
}
function journalHistories(se) {                         // Audit 한 번 읽어 (엔티티|키)별 이력 구성
  const m = new Map();
  for (const e of storeReadAudit(se)) {
    const k = `${e.entity}|${e.key}`; if (!m.has(k)) m.set(k, []);
    m.get(k).push({ rev: e.rev, op: e.op, at: e.recordedAt, atLabel: jvKst(e.recordedAt), actor: e.actor, reason: e.reason, changes: e.op === 'create' ? [] : e.op === 'void' ? [] : journalDiff(jvParse(e.before), jvParse(e.after)) });
  }
  return m;
}
export function journalHistory(env, entity, key) { return nullishOr(journalHistories(env.storeEnv()).get(`${entity}|${key}`), []); }

export const JOURNAL_SEARCH_LIMIT = 200;
export function journalBuild(env, { now = env.now(), limit = JOURNAL_LIMIT, day = null, q = null } = {}) {
  const se = env.storeEnv(); let inputs;
  try { inputs = storeLoadLedgerInputs(se); } catch (e) { if (e instanceof StoreError && e.code === 'NOT_FOUND') return { empty: true, reason: 'no-challenge', generatedAt: now }; throw e; }
  const throughDay = kstDayOf(now), led = ledgerBuildDaily({ ...inputs, throughDay });
  let histMemo = null; const hist = { get: k => { if (!histMemo) histMemo = journalHistories(se); return histMemo.get(k); } };      // 수정 이력은 수정된 항목(rev>1)이 화면에 있을 때만 Audit 를 읽는다(보통은 읽지 않음)
  const data = n => storeList(se, n).map(r => r.data), signals = data('signal'), responses = data('response'), reviews = data('review');
  const revRev = new Map(storeList(se, 'review').map(r => [r.key, r.rev])), sig = new Map(signals.map(s => [s.sid, s])), rsp = new Map(responses.map(r => [r.sid, r])), rev = new Map(reviews.map(r => [r.sid, r]));
  const allFills = storeList(se, 'fill', { includeVoid: true }), voided = allFills.filter(r => r.void).map(r => r.key);
  const bySid = new Map();
  for (const r of allFills) { const sid = r.data.sid; if (!bySid.has(sid)) bySid.set(sid, []); bySid.get(sid).push(r); }
  const edits = (entity, key, rev) => (rev > 1 ? (nullishOr(hist.get(`${entity}|${key}`), [])).filter(h => h.rev > 1 || h.op !== 'create') : []);      // rev 1(수정 없음)이면 이력을 찾지 않는다
  const trades = [...led.trades.values()].map(t => {
    const s = sig.get(t.sid), ev = t.events, last = ev[ev.length - 1], net = t.totals.netEnteredMicro, rows = (nullishOr(bySid.get(t.sid), [])).sort((a, b) => a.data.at - b.data.at);
    const rv = rev.get(t.sid), rs = rsp.get(t.sid);
    return { sid: t.sid, dir: t.dir, status: t.status, strategy: s ? s.strategy : null, symbol: s ? s.symbolId.replace(/USDT$/, '') : null, lastAt: last.at, openedAt: ev[0].at, closedAt: t.status === 'closed' ? last.at : null, fillDays: [...new Set(rows.filter(r => !r.void).map(r => kstDayOf(r.data.at)))], openedLabel: jvKst(ev[0].at), closedLabel: t.status === 'closed' ? jvKst(last.at) : null,
      netLabel: anUsd(net, { sign: true }), netMicro: String(net), win: t.status === 'closed' && net > BigInt(0), loss: t.status === 'closed' && net < BigInt(0), flags: t.flags, openQty: t.status === 'open' ? t.openQty : null,
      response: rs ? { choice: rs.choice, label: RESPONSE_CHOICES[rs.choice] } : null,
      fills: rows.filter(r => !r.void).map(r => ({ fillId: r.key, kind: r.data.kind, kindLabel: (JV_KIND[r.data.kind] != null ? JV_KIND[r.data.kind] : r.data.kind), atLabel: jvKst(r.data.at), price: r.data.price, qty: r.data.qty, fee: jvText(r.data.fee), funding: jvText(r.data.funding), feeEdit: jvEditAmt(r.data.fee), fundingEdit: jvEditAmt(r.data.funding), note: (r.data.note != null ? r.data.note : ''), rev: r.rev, margin: (r.data.margin != null ? r.data.margin : null), leverage: (r.data.leverage != null ? r.data.leverage : null), plannedStop: (r.data.plannedStop != null ? r.data.plannedStop : null), edits: edits('fill', r.key, r.rev) })),
      voidedFills: rows.filter(r => r.void).map(r => ({ fillId: r.key, kindLabel: (JV_KIND[r.data.kind] != null ? JV_KIND[r.data.kind] : r.data.kind), atLabel: jvKst(r.data.at), price: r.data.price, qty: r.data.qty, edits: edits('fill', r.key, r.rev) })),
      review: rv ? { plan: PLAN_CHOICES[rv.plan], mind: MIND_CHOICES[rv.mind], memo: (rv.memo != null ? rv.memo : null), savedLabel: jvKst(rv.savedAt), edits: edits('review', t.sid, revRev.get(t.sid)) } : null };
  }).sort((a, b) => b.lastAt - a.lastAt);
  const qDay = typeof day === 'string' && isDayString(day) ? day : null, qSym = typeof q === 'string' ? q.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) : '';      // 검색: 해당 날짜에 체결이 있거나 진입·청산한 거래, 코인 이름 일부
  const found = qDay || qSym ? trades.filter(t => (!qDay || t.fillDays.includes(qDay)) && (!qSym || String((t.symbol != null ? t.symbol : t.sid)).toUpperCase().includes(qSym))) : trades;
  const warnings = [], rows = led.rows, cnt = f => rows.filter(r => r.flags.includes(f)).length;
  const mism = rows.filter(r => r.needsReview);
  if (mism.length) warnings.push({ type: 'ledger-mismatch', text: `장부와 입력 평가액의 차이가 큰 날 ${mism.length}일: ${mism.slice(-5).map(r => `${r.day}(${anUsd(r.diffMicro, { sign: true })})`).join(', ')}` });
  const missCash = rows.filter(r => r.needsReview && closeDiagnose(r, { fillCount: inputs.fills.filter(f => kstDayOf(f.at) === r.day).length, cashCount: inputs.cashflows.filter(c => kstDayOf(c.at) === r.day).length, adjCount: inputs.adjustments.filter(a => kstDayOf(a.at) === r.day).length }).includes('possible-missing-cashflow'));
  if (missCash.length) warnings.push({ type: 'possible-missing-cashflow', text: `입출금 누락 의심 ${missCash.length}일: ${missCash.slice(-5).map(r => r.day).join(', ')} — 거래·입출금이 없는 날인데 평가액이 장부와 다릅니다. 입출금을 기록하세요(자동 보정하지 않음)` });
  if (cnt('close-from-ledger')) warnings.push({ type: 'close-from-ledger', text: `평가액 미입력으로 장부 근사값을 쓴 날 ${cnt('close-from-ledger')}일` });
  const feeM = trades.filter(t => t.flags.includes('fee-missing')).length, fundM = trades.filter(t => t.flags.includes('funding-missing')).length;
  if (feeM) warnings.push({ type: 'fee-missing', text: `수수료 미입력 거래 ${feeM}건(손익에서 제외됨)` }); if (fundM) warnings.push({ type: 'funding-missing', text: `펀딩 미입력 거래 ${fundM}건(손익에서 제외됨)` });
  if (cnt('has-estimates')) warnings.push({ type: 'has-estimates', text: `추정 수수료·펀딩이 있는 날 ${cnt('has-estimates')}일(기본 손익 미포함)` });
  for (const f of led.flags) warnings.push({ type: f.type, text: `범위 밖 입력 ${f.count}건(${f.type})` });
  const closes = closeStatus(env, { now, days: 14 }), cash = storeList(se, 'cashflow').sort((a, b) => b.data.at - a.data.at).slice(0, 10).map(cr => { const c = cr.data; return { cfId: c.cfId, atLabel: jvKst(c.at), amount: c.amount, note: (c.note != null ? c.note : ''), edits: edits('cashflow', c.cfId, cr.rev) }; });
  return { empty: false, generatedAt: now, today: throughDay, startDay: inputs.challenge.startDay, startEquity: inputs.challenge.startEquity, trades: found.slice(0, qDay || qSym ? JOURNAL_SEARCH_LIMIT : limit), tradesTotal: found.length, tradesOpen: found.filter(t => t.status === 'open').length, searched: !!(qDay || qSym), voidedCount: voided.length,
    closes, presetDay: (nullishOr(nullishOr(closes.find(c => c.closed && c.equity === null), closes[0]), { day: throughDay })).day, cashflows: cash, analytics: anBuild({ ledgerTrades: led.trades, fills: inputs.fills, signals, reviews, startMicro: decToMicro(dec(inputs.challenge.startEquity)) }), warnings, warningText: CLOSE_WARNING_TEXT };
}

// ── 수정 ──
function journalGuardReason(reason) { if (typeof reason !== 'string' || !reason.trim()) jvFail('수정 사유를 입력해 주세요'); return reason.trim().slice(0, 200); }
function journalTradeCheck(fills, sid) { try { return pnlComputeTrade(fills.filter(f => f.sid === sid)); } catch (e) { jvFail(`이 수정은 계산이 맞지 않아 저장하지 않습니다: ${String(e.message).slice(0, 80)}`); } }
export function journalReviseFill(env, fillId, patch, { actor = 'ui', reason, now = env.now() } = {}) {
  const why = journalGuardReason(reason), se = env.storeEnv(), cur = storeGet(se, 'fill', fillId);
  if (!cur || cur.void) throw new StoreError('NOT_FOUND', '수정할 체결이 없습니다');
  if (!patch || typeof patch !== 'object' || !Object.keys(patch).length) jvFail('수정할 값이 없습니다');
  for (const k of Object.keys(patch)) if (!JOURNAL_FILL_EDITABLE.includes(k)) jvFail(`수정할 수 없는 항목: ${k}`);
  if (patch.at !== undefined && (!Number.isInteger(patch.at) || patch.at > now + 5 * 60000)) jvFail('체결 시각이 올바르지 않습니다');
  const merged = { ...cur.data }; for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') delete merged[k]; else merged[k] = v; }
  const next = ENTITIES.fill.normalize(merged), all = storeList(se, 'fill').map(r => r.data).map(f => (f.fillId === fillId ? next : f));
  journalTradeCheck(all, next.sid);                                                         // 수정 후에도 계산 가능해야 저장
  const clean = {}; for (const k of Object.keys(patch)) clean[k] = patch[k] === '' ? null : patch[k];
  return storeRevise(se, 'fill', fillId, clean, { actor, reason: why });
}
export function journalVoidFill(env, fillId, { actor = 'ui', reason } = {}) {
  const why = journalGuardReason(reason), se = env.storeEnv(), cur = storeGet(se, 'fill', fillId);
  if (!cur) throw new StoreError('NOT_FOUND', '취소할 체결이 없습니다');
  if (cur.void) return { status: 'unchanged', key: fillId, rev: cur.rev };
  const rest = storeList(se, 'fill').map(r => r.data).filter(f => f.fillId !== fillId); journalTradeCheck(rest, cur.data.sid);
  return storeVoid(se, 'fill', fillId, { actor, reason: why });
}
export function journalAddCashflow(env, { cfId, amount, note, at } = {}, { actor = 'ui', now = env.now() } = {}) {
  const amt = schemaDecString(amount, '입출금 금액', { nonZero: true }), id = typeof cfId === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(cfId) ? `cf-${cfId}` : jvFail('입력 식별자(cfId)가 필요합니다');
  const when = at === undefined ? now : at; if (!Number.isInteger(when) || when > now + 5 * 60000) jvFail('시각이 올바르지 않습니다');
  return storeCreate(jvStore(env), 'cashflow', { cfId: id, at: when, amount: amt, ...(typeof note === 'string' && note.trim() ? { note: note.trim().slice(0, 200) } : {}) }, { actor });
}
export function journalVoidCashflow(env, cfId, { actor = 'ui', reason } = {}) { return storeVoid(env.storeEnv(), 'cashflow', cfId, { actor, reason: journalGuardReason(reason) }); }
const jvStore = env => env.storeEnv();
