// RICH 300 저장소(Google Sheets 위의 추가 전용 기록). 시트 접근은 env 포트로 주입받으므로 같은 코드를 Node 테스트(메모리 시트)와 Apps Script(SpreadsheetApp)가 쓴다.
//  env = { now(): ms, sha256(str): hex, lock: { tryLock(ms): boolean, release() }, sheets: { ensure(name, headers), rows(name): string[][] (헤더 제외), append(name, rows[][]) } }
//  선택 포트(성능, 없으면 전체 읽기로 대체): sheets.tail(name, n) 마지막 n행만 · sheets.version(name) 시트가 바뀔 때마다 커지는 수(파싱 결과 캐시 기준) · sheets.flush() · initCache{get,put} 초기화 확인 표시(스키마 버전별).
//  · 추가 전용: 엔티티 시트는 *모든 리비전*을 행으로 쌓는다(삭제·덮어쓰기 없음). 현재 값은 키별 최대 rev. 취소는 void 리비전.
//  · 선기록(WAL): 쓰기 = ① Audit 행 추가(해시 체인, 변경 후 전체 내용 포함) → ② 엔티티 시트 행 추가. ②에서 중단돼도 다음 쓰기·읽기가 Audit의 끝부분에서 복구한다. 먼저 ①이 실패하면 아무것도 바뀌지 않는다.
//  · 모든 쓰기는 스크립트 락 안에서 직렬화한다. 락을 못 얻으면 LOCK 오류(호출자가 재시도, 같은 키는 멱등).
//  · 데이터 JSON은 정규 십진 문자열 + 키 정렬 JSON → 같은 내용은 같은 문자열(중복·변조 판정이 결정적).
import { dedupeCanonical } from './dedupe.mjs';
import { StoreError, ENTITIES, VIEW_HEADERS, AUDIT_HEADERS, META_HEADERS, AUDIT_SHEET, META_SHEET, SCHEMA_VERSION, SETTING_DEFAULTS, ENTITY_NAMES } from './schema.mjs';
import { ledgerBuildDaily } from './ledger.mjs';
import { nullishOr } from './nullish.mjs';

const STORE_ZERO_HASH = '0'.repeat(64), STORE_TAIL = 5, STORE_VIEW_TAIL = 50, STORE_RECOVER = 2;
const storeEntity = n => (ENTITIES[n] != null ? ENTITIES[n] : (() => { throw new StoreError('VALIDATION', `알 수 없는 엔티티: ${n}`); })());
const storeCell = v => { if (v instanceof Date) throw new StoreError('INTEGRITY', 'Date로 변환된 셀 — 시트 열을 텍스트 서식으로 지정해야 함'); return v === null || v === undefined ? '' : String(v); };
const storeParse = (s, where) => { try { return JSON.parse(s); } catch (e_) { throw new StoreError('INTEGRITY', `JSON 손상: ${where}`); } };
const storeInt = (v, where) => { const n = Number(storeCell(v)); if (!Number.isInteger(n)) throw new StoreError('INTEGRITY', `정수 아님: ${where}`); return n; };

export function storeInit(env, { force = false } = {}) {
  const ck = `store-init:v${SCHEMA_VERSION}:${ENTITY_NAMES.length}`;                // 이미 확인한 시트는 매 요청마다 14개 시트의 머리글을 다시 읽지 않는다(health 화면은 force 로 다시 확인)
  if (!force && env.initCache && env.initCache.get(ck) === '1') return;
  for (const n of ENTITY_NAMES) env.sheets.ensure(storeEntity(n).sheet, VIEW_HEADERS(n));
  env.sheets.ensure(AUDIT_SHEET, AUDIT_HEADERS); env.sheets.ensure(META_SHEET, META_HEADERS);
  const ver = env.sheets.rows(META_SHEET).filter(r => storeCell(r[0]) === 'schemaVersion').map(r => storeCell(r[1])).pop();
  if (ver === undefined) env.sheets.append(META_SHEET, [['schemaVersion', String(SCHEMA_VERSION), String(env.now())]]);
  else if (Number(ver) !== SCHEMA_VERSION) throw new StoreError('SCHEMA', `스키마 버전 불일치: ${ver} (기대 ${SCHEMA_VERSION})`);
  if (env.sheets.flush) env.sheets.flush();
  if (env.initCache) env.initCache.put(ck, '1', 3600);
}

// ── 읽기 ──
const storeAuditRowOf = (r, i) => ({ seq: storeInt(r[0], `audit[${i}].seq`), recordedAt: storeInt(r[1], `audit[${i}].at`), entity: storeCell(r[2]), key: storeCell(r[3]), rev: storeInt(r[4], `audit[${i}].rev`), op: storeCell(r[5]),
  actor: storeCell(r[6]), reason: storeCell(r[7]), before: storeCell(r[8]), after: storeCell(r[9]), prevHash: storeCell(r[10]), hash: storeCell(r[11]) });
export function storeReadAudit(env) { return env.sheets.rows(AUDIT_SHEET).map(storeAuditRowOf); }
const storeTailRows = (env, sheet, n) => (env.sheets.tail ? env.sheets.tail(sheet, n) : env.sheets.rows(sheet).slice(-n));      // 끝부분만 필요할 때 시트 전체를 읽지 않는다
export const storeReadAuditTail = (env, n = STORE_TAIL) => storeTailRows(env, AUDIT_SHEET, n).map(storeAuditRowOf);
const storeViewRowOf = (entityName, r, i) => ({ key: storeCell(r[0]), rev: storeInt(r[1], `${entityName}[${i}].rev`), void: storeCell(r[2]) === '1', recordedAt: storeInt(r[3], `${entityName}[${i}].at`), raw: storeCell(r[4]), data: storeParse(storeCell(r[4]), `${entityName}[${i}]`) });
const storeViewMemo = new WeakMap();                       // env → 엔티티별 {ver, out}: 시트가 바뀌지 않았으면(version 같음) 같은 요청 안에서 JSON 파싱을 반복하지 않는다. 읽기 전용 배열이므로 호출자는 수정하지 않는다
export function storeReadView(env, entityName) {
  const sheet = storeEntity(entityName).sheet, ver = env.sheets.version ? env.sheets.version(sheet) : null;
  if (ver !== null) { const hit = storeViewMemo.get(env) && storeViewMemo.get(env).get(sheet); if (hit && hit.ver === ver) return hit.out; }
  const out = env.sheets.rows(sheet).map((r, i) => storeViewRowOf(entityName, r, i));
  if (ver !== null) { if (!storeViewMemo.has(env)) storeViewMemo.set(env, new Map()); storeViewMemo.get(env).set(sheet, { ver: env.sheets.version(sheet), out }); }
  return out;
}
const storeReadViewTail = (env, entityName, n) => storeTailRows(env, storeEntity(entityName).sheet, n).map((r, i) => storeViewRowOf(entityName, r, i));
function storeLatestMap(env, entityName, audit) {      // 엔티티 시트 + 아직 반영되지 않은 Audit 끝부분(복구 대기)을 합쳐 키별 최신 리비전
  const m = new Map(), put = r => { const p = m.get(r.key); if (!p || r.rev > p.rev) m.set(r.key, r); };
  const have = new Set();
  for (const r of storeReadView(env, entityName)) { put(r); have.add(`${r.key}|${r.rev}`); }
  for (const e of audit.slice(-STORE_TAIL)) if (e.entity === entityName && !have.has(`${e.key}|${e.rev}`)) put({ key: e.key, rev: e.rev, void: e.op === 'void', recordedAt: e.recordedAt, raw: e.after, data: storeParse(e.after, `audit#${e.seq}`), pending: true });
  return m;
}
export const storeGet = (env, entityName, key) => nullishOr(storeLatestMap(env, entityName, storeReadAuditTail(env)).get(key), null);
export function storeList(env, entityName, { includeVoid = false } = {}) {
  const out = [...storeLatestMap(env, entityName, storeReadAuditTail(env)).values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return includeVoid ? out : out.filter(r => !r.void);
}
export function storeHistory(env, entityName, key) {
  const audit = storeReadAuditTail(env), seen = new Map();
  for (const r of storeReadView(env, entityName)) if (r.key === key) seen.set(r.rev, r);
  for (const e of audit.slice(-STORE_TAIL)) if (e.entity === entityName && e.key === key && !seen.has(e.rev)) seen.set(e.rev, { key, rev: e.rev, void: e.op === 'void', recordedAt: e.recordedAt, raw: e.after, data: storeParse(e.after, `audit#${e.seq}`), pending: true });
  return [...seen.values()].sort((a, b) => a.rev - b.rev);
}

// ── 쓰기 ──
const storeHash = (env, e) => env.sha256([e.prevHash, e.seq, e.recordedAt, e.entity, e.key, e.rev, e.op, e.actor, e.after].join('|'));
const storeAuditRow = e => [String(e.seq), String(e.recordedAt), e.entity, e.key, String(e.rev), e.op, e.actor, e.reason, e.before, e.after, e.prevHash, e.hash];
const storeViewRow = (e, data) => [e.key, String(e.rev), e.op === 'void' ? '1' : '0', String(e.recordedAt), e.after, ...storeEntity(e.entity).display(data)];
function storeApplyView(env, e) { env.sheets.append(storeEntity(e.entity).sheet, [storeViewRow(e, storeParse(e.after, `audit#${e.seq}`))]); }
function storeRecoverTail(env) {                       // 이전 쓰기가 ②에서 중단됐다면 Audit 끝부분에서 엔티티 행을 복원한다(멱등)
  const fixed = [];
  for (const e of storeReadAuditTail(env, STORE_RECOVER)) {      // 쓰기는 항상 Audit→엔티티 순이고 다음 쓰기가 락 안에서 먼저 복구하므로, 끝나지 않은 쓰기는 마지막 항목뿐이다(여유로 2개 확인)
    const has = storeReadViewTail(env, e.entity, STORE_VIEW_TAIL).some(r => r.key === e.key && r.rev === e.rev);      // 최근 쓰기의 엔티티 행은 해당 시트 끝에 있다(Audit 순서 = 시트 추가 순서)
    if (!has) { storeApplyView(env, e); fixed.push(`${e.entity}|${e.key}|${e.rev}`); }
  }
  return fixed;
}
export function storeWithLock(env, fn) {
  if (env.__lockDepth > 0) return fn([]);                // 같은 요청 안에서 이미 락을 쥐고 있으면(여러 기록을 한 번에 저장하는 묶음) 다시 잡지 않는다 — 락·flush 는 바깥에서 한 번
  if (!env.lock.tryLock((env.lockTimeoutMs != null ? env.lockTimeoutMs : 10000))) throw new StoreError('LOCK', '다른 작업이 저장 중입니다(잠시 후 재시도)');
  env.__lockDepth = 1;
  try { const recovered = storeRecoverTail(env); return fn(recovered); } finally { env.__lockDepth = 0; env.lock.release(); }
}
function storeCommit(env, { entity, key, rev, op, actor, reason, before, after }) {
  if (typeof actor !== 'string' || !actor) throw new StoreError('VALIDATION', 'actor 필요');
  const last = storeReadAuditTail(env, 1)[0];
  const e = { seq: last ? last.seq + 1 : 1, recordedAt: env.now(), entity, key, rev, op, actor, reason: (reason != null ? reason : ''), before: before ? dedupeCanonical(before) : '', after: dedupeCanonical(after), prevHash: last ? last.hash : STORE_ZERO_HASH };
  e.hash = storeHash(env, e);
  env.sheets.append(AUDIT_SHEET, [storeAuditRow(e)]);   // ① 선기록(여기서 실패하면 변경 없음)
  storeApplyView(env, e);                                // ② 엔티티 행(여기서 중단돼도 다음 쓰기/읽기가 복구)
  return e;
}
export function storeCreate(env, entityName, raw, { actor }) {
  const E = storeEntity(entityName), data = E.normalize(raw), key = E.keyOf(data);
  return storeWithLock(env, () => {
    const cur = storeLatestMap(env, entityName, storeReadAuditTail(env)).get(key);
    if (cur && !cur.void) return { status: dedupeCanonical(cur.data) === dedupeCanonical(data) ? 'duplicate' : 'conflict', key, rev: cur.rev };
    if (cur && cur.void && E.immutable) return { status: 'conflict', key, rev: cur.rev };
    const rev = cur ? cur.rev + 1 : 1;
    storeCommit(env, { entity: entityName, key, rev, op: 'create', actor, after: data });
    return { status: 'added', key, rev };
  });
}
export function storeRevise(env, entityName, key, patch, { actor, reason }) {
  const E = storeEntity(entityName); if (E.immutable) throw new StoreError('IMMUTABLE', `${entityName}은 수정할 수 없음(시작 설정·신호·수신 기록은 보존)`);
  if (!reason || typeof reason !== 'string') throw new StoreError('VALIDATION', '수정 사유 필요');
  return storeWithLock(env, () => {
    const cur = storeLatestMap(env, entityName, storeReadAuditTail(env)).get(key);
    if (!cur) throw new StoreError('NOT_FOUND', `수정 대상 없음: ${entityName}/${key}`);
    if (cur.void) throw new StoreError('VOID', `취소된 기록은 수정할 수 없음: ${key}`);
    const merged = { ...cur.data }; for (const [k, v] of Object.entries(patch)) { if (v === null) delete merged[k]; else merged[k] = v; }
    const data = E.normalize(merged);
    if (E.keyOf(data) !== key) throw new StoreError('VALIDATION', '키는 수정할 수 없음');
    if (dedupeCanonical(data) === dedupeCanonical(cur.data)) return { status: 'unchanged', key, rev: cur.rev };
    storeCommit(env, { entity: entityName, key, rev: cur.rev + 1, op: 'revise', actor, reason, before: cur.data, after: data });
    return { status: 'revised', key, rev: cur.rev + 1 };
  });
}
export function storeVoid(env, entityName, key, { actor, reason }) {
  const E = storeEntity(entityName); if (E.immutable) throw new StoreError('IMMUTABLE', `${entityName}은 취소할 수 없음`);
  if (!reason || typeof reason !== 'string') throw new StoreError('VALIDATION', '취소 사유 필요');
  return storeWithLock(env, () => {
    const cur = storeLatestMap(env, entityName, storeReadAuditTail(env)).get(key);
    if (!cur) throw new StoreError('NOT_FOUND', `취소 대상 없음: ${entityName}/${key}`);
    if (cur.void) return { status: 'unchanged', key, rev: cur.rev };
    storeCommit(env, { entity: entityName, key, rev: cur.rev + 1, op: 'void', actor, reason, before: cur.data, after: cur.data });
    return { status: 'voided', key, rev: cur.rev + 1 };
  });
}
// 텔레그램 update_id·callback_query.id 선점: 처음이면 true(처리), 이미 있으면 false(무시)
export const storeClaimUpdate = (env, kind, id, actor) => storeCreate(env, 'tgupdate', { kind, id: String(id), at: env.now() }, { actor }).status === 'added';
// 복기 저장: 계획 준수·심리를 *명시적으로* 받아야만 기록(기본값 자동 저장 없음). 같은 내용 재저장은 변경 없음.
export function storeSaveReview(env, { sid, plan, mind, memo }, { actor }) {
  const savedAt = env.now(), cur = storeGet(env, 'review', sid), next = { sid, plan, mind, memo, savedAt };
  if (!cur || cur.void) return storeCreate(env, 'review', next, { actor });
  if (cur.data.plan === plan && cur.data.mind === mind && ((cur.data.memo != null ? cur.data.memo : '')) === ((memo != null ? memo : ''))) return { status: 'unchanged', key: sid, rev: cur.rev };
  return storeRevise(env, 'review', sid, { plan, mind, memo: memo ? memo : null, savedAt }, { actor, reason: '복기 수정' });
}
export function storeSetupChallenge(env, { startEquity, startDay, rate }, { actor }) {
  const a = storeCreate(env, 'challenge', { startEquity, startDay }, { actor });
  if (a.status === 'conflict') return a;                // 시작 자금·시작일은 보존: 다른 값으로 다시 만들 수 없다
  const r = storeCreate(env, 'rate', { from: startDay, rate }, { actor });
  return { status: a.status === 'added' || r.status === 'added' ? 'added' : 'duplicate', challenge: a, rate: r };
}
export function storeGetSettings(env) {
  const out = { ...SETTING_DEFAULTS }; for (const r of storeList(env, 'setting')) out[r.data.name] = r.data.value; return out;
}

// ── 무결성·복구 ──
export function storeIntegrityCheck(env) {
  const issues = [], audit = storeReadAudit(env), canon = new Map();
  let prevHash = STORE_ZERO_HASH; const lastRev = new Map();
  audit.forEach((e, i) => {
    if (e.seq !== i + 1) issues.push({ type: 'audit-seq-gap', seq: e.seq, expected: i + 1 });
    if (e.prevHash !== prevHash) issues.push({ type: 'audit-chain-broken', seq: e.seq });
    if (storeHash(env, e) !== e.hash) issues.push({ type: 'audit-hash-mismatch', seq: e.seq });
    const kk = `${e.entity}|${e.key}`, exp = (nullishOr(lastRev.get(kk), 0)) + 1;
    if (e.rev !== exp) issues.push({ type: 'rev-gap', entity: e.entity, key: e.key, rev: e.rev, expected: exp }); lastRev.set(kk, e.rev);
    canon.set(`${e.entity}|${e.key}|${e.rev}`, e); prevHash = e.hash;
  });
  const seenRows = new Set();
  for (const n of ENTITY_NAMES) for (const r of storeReadView(env, n)) {
    const id = `${n}|${r.key}|${r.rev}`, a = canon.get(id);
    if (seenRows.has(id)) issues.push({ type: 'duplicate-view-row', entity: n, key: r.key, rev: r.rev }); seenRows.add(id);
    if (!a) issues.push({ type: 'orphan-view', entity: n, key: r.key, rev: r.rev });
    else if (r.raw !== a.after || r.void !== (a.op === 'void')) issues.push({ type: 'tampered-view', entity: n, key: r.key, rev: r.rev });
  }
  for (const [id, e] of canon) if (!seenRows.has(id)) issues.push({ type: 'missing-view', entity: e.entity, key: e.key, rev: e.rev });
  return { ok: issues.length === 0, issues, auditCount: audit.length, repairable: issues.filter(i => i.type === 'missing-view').length };
}
// 복구: Audit에는 있는데 엔티티 시트에 없는 행만 추가한다. 기존 행은 절대 수정·삭제하지 않는다(변조·충돌은 보고만).
export function storeRepair(env) {
  return storeWithLock(env, recovered => {
    const appended = [...recovered], audit = storeReadAudit(env), have = new Set();      // 락 진입 시 끝부분 자동 복구분도 함께 보고
    for (const n of ENTITY_NAMES) for (const r of storeReadView(env, n)) have.add(`${n}|${r.key}|${r.rev}`);
    for (const e of audit) if (!have.has(`${e.entity}|${e.key}|${e.rev}`)) { storeApplyView(env, e); appended.push(`${e.entity}|${e.key}|${e.rev}`); }
    return { appended, after: storeIntegrityCheck(env) };
  });
}

// ── R2 계산 엔진 연결 ──
export function storeLoadLedgerInputs(env) {
  const ch = storeGet(env, 'challenge', 'challenge');
  if (!ch || ch.void) throw new StoreError('NOT_FOUND', '챌린지 설정 없음(storeSetupChallenge 필요)');
  const schedule = storeList(env, 'rate').map(r => ({ from: r.data.from, rate: r.data.rate })).sort((a, b) => (a.from < b.from ? -1 : 1));
  if (!schedule.length || schedule[0].from > ch.data.startDay) throw new StoreError('INTEGRITY', '시작일 이전부터 적용되는 목표율 일정이 없음');
  const d = n => storeList(env, n).map(r => r.data);
  return { challenge: { startEquity: ch.data.startEquity, startDay: ch.data.startDay, rateSchedule: schedule }, fills: d('fill'), cashflows: d('cashflow'), adjustments: d('adjustment'), openingPositions: d('opening'),
    equityInputs: d('equity').map(e => ({ day: e.day, equity: e.equity, unrealized: e.unrealized, late: e.late })) };
}
export const storeBuildLedger = (env, { throughDay }) => ledgerBuildDaily({ ...storeLoadLedgerInputs(env), throughDay });
