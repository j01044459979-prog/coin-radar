// RICH 300 저장소 스키마: 엔티티 정의·검증·정규화. 순수 함수(저장소·시간 의존 없음).
//  · 모든 금액·가격·수량은 *정규 십진 문자열*로 저장한다("100.0"·100·"100" → "100"), 부동소수·BigInt 미사용 → 같은 값은 항상 같은 기록(중복 판정 일관).
//  · 기본값으로 기록을 만들지 않는다: 복기는 계획 준수·심리를 *명시적으로* 모두 받아야 저장된다.
import { dec, decFormat, decSign } from './decimal.mjs';
import { isDayString } from './time.mjs';
import { rateFraction } from './compound.mjs';
import { pnlNormalizeFill } from './pnl.mjs';

export const SCHEMA_VERSION = 1;
export class StoreError extends Error { constructor(code, message, detail) { super(message); this.code = code; this.detail = (detail != null ? detail : null); } }
export const PLAN_CHOICES = Object.freeze({ plan_ok: '계획대로 진입·청산', early_exit: '조기 청산', chase_or_average_down: '추격 진입·물타기', other_violation: '기타 위반' });
export const MIND_CHOICES = Object.freeze({ calm: '침착', anxious_rushed: '불안·조급', revenge: '손실 복구 욕심', greedy: '욕심' });
export const RESPONSE_CHOICES = Object.freeze({ entered: '진입했어', watched: '관망했어', missed: '놓쳤어' });
export const SETTING_DEFAULTS = Object.freeze({ backupKeep: '8', backupTelegramCsv: 'off', closeNotify: 'off' });
const bad = (m, d) => { throw new StoreError('VALIDATION', m, d); };

export function schemaDecString(x, name, { positive = false, nonNegative = false, nonZero = false } = {}) {
  let v; try { v = dec(x); } catch (e) { bad(`${name}: ${e.message}`); }
  if (positive && decSign(v) <= 0) bad(`${name}은 0보다 커야 함`);
  if (nonNegative && decSign(v) < 0) bad(`${name}은 0 이상이어야 함`);
  if (nonZero && decSign(v) === 0) bad(`${name}은 0일 수 없음`);
  const s = decFormat(v, 12); return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}
const optDec = (x, name, o) => (x === undefined || x === null || x === '' ? undefined : schemaDecString(x, name, o));
const needStr = (x, name, max = 200) => { if (typeof x !== 'string' || !x.trim() || x.length > max) bad(`${name} 필요(1~${max}자)`); return x; };
const needMs = (x, name) => { if (!Number.isInteger(x) || x < 0) bad(`${name}: 정수 ms 시각 필요`); return x; };
const needDay = (x, name) => { if (!isDayString(x)) bad(`${name}: YYYY-MM-DD 필요`); return x; };
const needEnum = (x, set, name) => { if (!Object.prototype.hasOwnProperty.call(set, x) && !(Array.isArray(set) && set.includes(x))) bad(`${name} 값 오류`); return x; };
const needIntStr = (x, name) => { if (typeof x !== 'string' || !/^-?\d{1,18}$/.test(x)) bad(`${name}: 정수 문자열 필요`); return x; };
const needFlags = (x, name) => { if (x === undefined) return undefined; if (!Array.isArray(x) || x.length > 20 || x.some(f => typeof f !== 'string' || !/^[a-z0-9-]{1,40}$/.test(f))) bad(`${name} 형식 오류`); return [...x]; };
const strip = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const kst = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');

export const ENTITIES = {
  challenge: { sheet: 'Challenge', immutable: true, keyOf: () => 'challenge', headers: ['startEquity', 'startDay'],
    normalize: d => strip({ startEquity: schemaDecString(d.startEquity, 'startEquity', { positive: true }), startDay: needDay(d.startDay, 'startDay'), timezone: 'Asia/Seoul', dayCloseHourKst: 0 }), display: d => [d.startEquity, d.startDay] },
  rate: { sheet: 'Rates', keyOf: d => `rate:${d.from}`, headers: ['from', 'rate'],
    normalize: d => { needDay(d.from, 'from'); const r = String(d.rate); try { rateFraction(r); } catch (e) { bad(`rate: ${e.message}`); } return { from: d.from, rate: schemaDecString(r, 'rate', { nonNegative: true }) }; }, display: d => [d.from, d.rate] },
  setting: { sheet: 'Settings', keyOf: d => `setting:${d.name}`, headers: ['name', 'value'],
    normalize: d => { needEnum(d.name, SETTING_DEFAULTS, 'setting name'); const v = String(d.value); if (d.name === 'backupKeep') { if (!/^\d+$/.test(v) || +v < 1 || +v > 30) bad('backupKeep은 1~30'); } else if (v !== 'on' && v !== 'off') bad(`${d.name}은 on/off`); return { name: d.name, value: v }; }, display: d => [d.name, d.value] },
  signal: { sheet: 'Signals', immutable: true, keyOf: d => d.sid, headers: ['sid', 'strategy', 'dir', 'symbol', 'signalAtKst'],
    normalize: d => strip({ sid: needStr(d.sid, 'sid', 80), strategy: needEnum(d.strategy, ['A', 'B', 'S'], 'strategy'), symbolId: /^[A-Z0-9]{2,20}USDT$/.test((d.symbolId != null ? d.symbolId : '')) ? d.symbolId : bad('symbolId 형식 오류'), dir: needEnum(d.dir, ['LONG', 'SHORT'], 'dir'),
      signalAt: needMs(d.signalAt, 'signalAt'), entry: schemaDecString(d.entry, 'entry', { positive: true }), stop: schemaDecString(d.stop, 'stop', { positive: true }), tp1: schemaDecString(d.tp1, 'tp1', { positive: true }), tp2: optDec(d.tp2, 'tp2', { positive: true }), score: d.score === undefined ? undefined : (Number.isInteger(d.score) && d.score >= 0 && d.score <= 100 ? d.score : bad('score는 0~100 정수')), summary: d.summary === undefined ? undefined : needStr(d.summary, 'summary', 120) }),
    display: d => [d.sid, d.strategy, d.dir, d.symbolId, kst(d.signalAt)] },
  response: { sheet: 'Responses', keyOf: d => d.sid, headers: ['sid', 'choice', 'atKst'],
    normalize: d => ({ sid: needStr(d.sid, 'sid', 80), choice: needEnum(d.choice, RESPONSE_CHOICES, 'choice'), at: needMs(d.at, 'at') }), display: d => [d.sid, d.choice, kst(d.at)] },
  fill: { sheet: 'Fills', keyOf: d => d.fillId, headers: ['sid', 'kind', 'dir', 'atKst', 'price', 'qty'],
    normalize: d => {
      if (d.origin !== 'real') bad(`실제 체결만 저장(origin=real): ${d.origin}`);
      const price = schemaDecString(d.price, 'price', { positive: true }), qty = schemaDecString(d.qty, 'qty', { positive: true });
      const amt = (a, n, nn) => { const st = ((a == null ? undefined : a.state) != null ? (a == null ? undefined : a.state) : 'missing'); if (!['entered', 'estimated', 'missing'].includes(st)) bad(`${n} 상태 오류`); return st === 'missing' ? { state: 'missing' } : { state: st, amount: schemaDecString(a.amount, `${n} 금액`, nn ? { nonNegative: true } : {}) }; };
      const out = strip({ origin: 'real', fillId: needStr(d.fillId, 'fillId', 80), sid: needStr(d.sid, 'sid', 80), kind: d.kind, dir: d.dir, at: needMs(d.at, 'at'), price, qty,
        margin: optDec(d.margin, 'margin', { positive: true }), leverage: optDec(d.leverage, 'leverage', { positive: true }), plannedStop: optDec(d.plannedStop, 'plannedStop', { positive: true }), qtySource: d.qtySource === undefined ? undefined : needEnum(d.qtySource, ['entered', 'derived'], 'qtySource'),
        fee: amt(d.fee, '수수료', true), funding: amt(d.funding, '펀딩', false), note: d.note === undefined ? undefined : needStr(d.note, 'note', 300) });
      try { pnlNormalizeFill(out); } catch (e) { bad(e.message); } return out;
    }, display: d => [d.sid, d.kind, d.dir, kst(d.at), d.price, d.qty] },
  cashflow: { sheet: 'Cashflows', keyOf: d => d.cfId, headers: ['atKst', 'amount'],
    normalize: d => strip({ cfId: needStr(d.cfId, 'cfId', 80), at: needMs(d.at, 'at'), amount: schemaDecString(d.amount, 'amount', { nonZero: true }), note: d.note === undefined ? undefined : needStr(d.note, 'note', 200) }), display: d => [kst(d.at), d.amount] },
  equity: { sheet: 'Equity', keyOf: d => d.day, headers: ['day', 'equity', 'unrealized', 'late'],
    normalize: d => strip({ day: needDay(d.day, 'day'), equity: schemaDecString(d.equity, 'equity', { nonNegative: true }), unrealized: optDec(d.unrealized, 'unrealized'), late: d.late === true ? true : undefined, enteredAt: d.enteredAt === undefined ? undefined : needMs(d.enteredAt, 'enteredAt') }), display: d => [d.day, d.equity, (d.unrealized != null ? d.unrealized : ''), d.late ? 'late' : ''] },
  opening: { sheet: 'OpeningPositions', keyOf: d => d.sid, headers: ['sid', 'dir', 'qty', 'startMark', 'origEntry'],
    normalize: d => strip({ sid: needStr(d.sid, 'sid', 80), dir: needEnum(d.dir, ['LONG', 'SHORT'], 'dir'), qty: schemaDecString(d.qty, 'qty', { positive: true }), startMark: schemaDecString(d.startMark, 'startMark', { positive: true }), origEntry: optDec(d.origEntry, 'origEntry', { positive: true }) }), display: d => [d.sid, d.dir, d.qty, d.startMark, (d.origEntry != null ? d.origEntry : '')] },
  review: { sheet: 'Reviews', keyOf: d => d.sid, headers: ['sid', 'plan', 'mind', 'savedAtKst'],
    normalize: d => strip({ sid: needStr(d.sid, 'sid', 80), plan: needEnum(d.plan, PLAN_CHOICES, '계획 준수'), mind: needEnum(d.mind, MIND_CHOICES, '심리 상태'), memo: d.memo === undefined || d.memo === '' ? undefined : needStr(d.memo, 'memo', 500), savedAt: needMs(d.savedAt, 'savedAt') }), display: d => [d.sid, d.plan, d.mind, kst(d.savedAt)] },
  adjustment: { sheet: 'Adjustments', keyOf: d => d.adjId, headers: ['atKst', 'amount', 'reason'],
    normalize: d => ({ adjId: needStr(d.adjId, 'adjId', 80), at: needMs(d.at, 'at'), amount: schemaDecString(d.amount, 'amount', { nonZero: true }), reason: needStr(d.reason, '조정 사유', 200) }), display: d => [kst(d.at), d.amount, d.reason] },
  // R7 일 마감: 마감 시점의 스냅샷(불변, 같은 날짜는 한 번만) · 마감 알림 상태(리비전으로 pending→sent/failed)
  dayclose: { sheet: 'DayCloses', immutable: true, keyOf: d => d.day, headers: ['day', 'closedAtKst', 'source', 'diff'],
    normalize: d => strip({ day: needDay(d.day, 'day'), closedAt: needMs(d.closedAt, 'closedAt'), source: needEnum(d.source, ['input', 'ledger'], 'source'), startMicro: needIntStr(d.startMicro, 'startMicro'), targetMicro: needIntStr(d.targetMicro, 'targetMicro'),
      closeMicro: needIntStr(d.closeMicro, 'closeMicro'), pnlMicro: needIntStr(d.pnlMicro, 'pnlMicro'), walletMicro: needIntStr(d.walletMicro, 'walletMicro'), diffMicro: d.diffMicro === undefined || d.diffMicro === null ? undefined : needIntStr(d.diffMicro, 'diffMicro'), needsReview: d.needsReview === true, flags: needFlags(d.flags, 'flags') }),
    display: d => [d.day, kst(d.closedAt), d.source, (d.diffMicro != null ? d.diffMicro : '')] },
  closenotice: { sheet: 'CloseNotices', keyOf: d => d.day, headers: ['day', 'status', 'attempts'],
    normalize: d => { const n = d.attempts; if (!Number.isInteger(n) || n < 0 || n > 9) bad('attempts는 0~9 정수'); return strip({ day: needDay(d.day, 'day'), status: needEnum(d.status, ['pending', 'sent', 'failed', 'off', 'unknown'], 'status'), attempts: n, at: needMs(d.at, 'at'), error: d.error === undefined || d.error === null ? undefined : needStr(String(d.error), 'error', 40) }); },
    display: d => [d.day, d.status, String(d.attempts)] },
  // 분할 진입·익절 계획의 *입력*(불변): 첫 진입 기록 때 한 번 저장한다. 계획 자체는 이 값과 결정적 계산(scaleplan.mjs)으로 언제든 같은 결과로 다시 만든다.
  plan: { sheet: 'Plans', immutable: true, keyOf: d => d.sid, headers: ['sid', 'equity', 'entry', 'stop', 'lev', 'stages'],
    normalize: d => { if (![2, 3].includes(d.lev)) bad('lev는 2 또는 3'); if (![1, 2, 3].includes(d.stages)) bad('stages는 1~3'); return { sid: needStr(d.sid, 'sid', 80), equity: schemaDecString(d.equity, 'equity', { positive: true }), entry: schemaDecString(d.entry, 'entry', { positive: true }), stop: schemaDecString(d.stop, 'stop', { positive: true }), lev: d.lev, stages: d.stages, at: needMs(d.at, 'at') }; },
    display: d => [d.sid, d.equity, d.entry, d.stop, String(d.lev), String(d.stages)] },
  // 사용자가 Binance 에서 직접 연 포지션의 *수동 등록*(추천 신호와 무관). 체결(fill)과 같은 sid 로 묶이며, 감시는 이 기록의 종목·손절·익절을 쓴다. 손절·익절은 수정(리비전)할 수 있고 이력이 남는다.
  manualpos: { sheet: 'ManualPositions', keyOf: d => d.sid, headers: ['sid', 'symbol', 'dir', 'stop', 'tp1', 'tp2'],
    normalize: d => { if (d.dir !== 'LONG' && d.dir !== 'SHORT') bad('dir 값 오류'); return strip({ sid: needStr(d.sid, 'sid', 54), symbolId: /^[A-Z0-9]{2,20}USDT$/.test((d.symbolId != null ? d.symbolId : '')) ? d.symbolId : bad('symbolId 형식 오류'), dir: d.dir,
      stop: schemaDecString(d.stop, 'stop', { positive: true }), tp1: optDec(d.tp1, 'tp1', { positive: true }), tp2: optDec(d.tp2, 'tp2', { positive: true }), registeredAt: needMs(d.registeredAt, 'registeredAt'), symbolCheck: d.symbolCheck === undefined ? undefined : needEnum(d.symbolCheck, ['ok', 'unverified'], 'symbolCheck') }); },
    display: d => [d.sid, d.symbolId, d.dir, d.stop, (d.tp1 != null ? d.tp1 : ''), (d.tp2 != null ? d.tp2 : '')] },
  tgupdate: { sheet: 'TgUpdates', immutable: true, keyOf: d => `${d.kind}:${d.id}`, headers: ['kind', 'id'],
    normalize: d => ({ kind: needEnum(d.kind, ['u', 'cb'], 'kind'), id: needStr(String(d.id), 'id', 80), at: needMs(d.at, 'at') }), display: d => [d.kind, d.id] },
};
export const ENTITY_NAMES = Object.keys(ENTITIES);
export const AUDIT_SHEET = 'Audit', META_SHEET = 'Meta';
export const VIEW_HEADERS = e => ['key', 'rev', 'void', 'recordedAt', 'data', ...ENTITIES[e].headers];
export const AUDIT_HEADERS = ['seq', 'recordedAt', 'entity', 'key', 'rev', 'op', 'actor', 'reason', 'before', 'after', 'prevHash', 'hash'];
export const META_HEADERS = ['key', 'value', 'recordedAt'];
