// R8 Google Sheets 백업·복원(순수 로직 + env 포트). 같은 코드를 Node 테스트(메모리 시트)와 Apps Script(DriveApp)가 쓴다.
//  env = { storeEnv(): 원본 저장소 env, drive: { ensureFolder(): folderId, list(folderId): [{id,name,createdAt}], copy(sourceId, name, folderId): {id}, openStore(id): 저장소 env, trash(id) } }
//  원칙
//   · 백업 = 스프레드시트 *사본*(날짜시각 이름). 저장소 락 안에서 복사해 쓰기 도중의 사본이 만들어지지 않게 한다.
//   · 사본은 반드시 검증한다: 무결성 검사 통과 + 원본과 지문(감사 로그 개수·마지막 해시·시트별 행 수) 일치. 검증에 실패한 사본은 휴지통으로 보내고 *기존 백업은 건드리지 않는다*.
//   · 보관은 최근 N개(설정 backupKeep, 기본 8, 1~30). 지우는 대상은 백업 폴더 안에서 *이름 패턴이 정확히 맞는 백업뿐*(그 밖의 파일·복원본·원본은 절대 삭제 대상 아님). 삭제는 휴지통 이동(복구 가능).
//   · 원본이 무결성 문제를 보이면 사본은 증거로 남기되 *회전(삭제)하지 않는다*(좋은 과거 백업을 잃지 않도록).
//   · 복원 = 백업을 *새 사본*으로 만들어 검증까지만 한다. 운영 시트를 덮어쓰지 않는다. 운영 시트 전환은 별도의 명시적 단계(승인·확인 문구)다.
//   · Telegram CSV 자동 전송은 구현하지 않는다(설정 backupTelegramCsv=on 이어도 아무것도 보내지 않고 경고만 반환). 이 모듈에는 네트워크 호출이 없다.
import { StoreError } from './schema.mjs';
import { storeIntegrityCheck, storeReadAudit, storeWithLock, storeGetSettings, storeReadView } from './store.mjs';
import { ENTITY_NAMES, ENTITIES, META_SHEET, SCHEMA_VERSION } from './schema.mjs';

export const BACKUP_RE = /^RICH300-backup-(\d{8})-(\d{4})$/;
export const BACKUP_MIN_KEEP = 1, BACKUP_MAX_KEEP = 30, BACKUP_DEFAULT_KEEP = 8;
const bkStamp = now => { const d = new Date(now + 9 * 3600000).toISOString(); return `${d.slice(0, 10).replace(/-/g, '')}-${d.slice(11, 16).replace(':', '')}`; };   // KST
export const backupName = now => `RICH300-backup-${bkStamp(now)}`;
export const backupRestoredName = now => `RICH300-restored-${bkStamp(now)}`;
export function backupKeepFrom(settings) { const n = Number(settings.backupKeep); return Number.isInteger(n) ? Math.min(BACKUP_MAX_KEEP, Math.max(BACKUP_MIN_KEEP, n)) : BACKUP_DEFAULT_KEEP; }

// 보관 계획: 이름에 든 시각이 최신인 N개를 남기고 나머지 *백업*만 삭제 대상. 이름 패턴이 맞지 않는 항목은 무시(ignored).
export function backupRetention(list, keep) {
  const valid = list.filter(x => BACKUP_RE.test(x.name)).sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return { keep: valid.slice(0, keep), remove: valid.slice(keep), ignored: list.filter(x => !BACKUP_RE.test(x.name)) };
}
// 지문: 사본이 원본을 빠짐없이 재현했는지 비교하는 값(내용이 아니라 개수·해시만, 금액·ID 없음)
export function backupFingerprint(se) {
  const audit = storeReadAudit(se), sheets = {}; for (const n of ENTITY_NAMES) sheets[ENTITIES[n].sheet] = storeReadView(se, n).length;
  const meta = se.sheets.rows(META_SHEET).map(r => String(r[0]));
  return { auditCount: audit.length, lastHash: audit.length ? audit[audit.length - 1].hash : '', sheets, metaKeys: meta.filter(k => k === 'schemaVersion').length, schemaVersion: SCHEMA_VERSION };
}
const bkSame = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function backupRun(env, { now = Date.now() } = {}) {
  const se = env.storeEnv(), settings = storeGetSettings(se), keep = backupKeepFrom(settings), warnings = [];
  if (settings.backupTelegramCsv === 'on') warnings.push('telegram-csv-unsupported');            // 보내지 않음(구현 없음)
  const folder = env.drive.ensureFolder(), name = backupName(now);
  if (env.drive.list(folder).some(x => x.name === name)) return { status: 'exists', name, warnings };    // 같은 분에 중복 실행: 한 번만
  let src = null, copy = null;
  try { storeWithLock(se, () => { src = { integrity: storeIntegrityCheck(se), fp: backupFingerprint(se) }; copy = env.drive.copy(env.sourceId, name, folder); }); }
  catch (e) { if (e instanceof StoreError && e.code === 'LOCK') throw e; if (copy) { try { env.drive.trash(copy.id); } catch (e_) { /* 정리 실패는 무시 */ } } return { status: 'copy-failed', name, warnings }; }
  let ci, cf;
  try { const cs = env.drive.openStore(copy.id); ci = storeIntegrityCheck(cs); cf = backupFingerprint(cs); } catch (e_) { ci = { ok: false, issues: [{ type: 'open-failed' }] }; cf = null; }
  const same = cf !== null && bkSame(cf, src.fp);
  if (src.integrity.ok && !(ci.ok && same)) { env.drive.trash(copy.id); return { status: 'verify-failed', name, reasons: [!ci.ok ? 'copy-integrity' : null, !same ? 'fingerprint-mismatch' : null].filter(Boolean), warnings }; }
  if (!src.integrity.ok) return { status: 'ok-unhealthy-source', name, id: copy.id, fingerprintMatches: same, rotated: false, issues: [...new Set(src.integrity.issues.map(i => i.type))], warnings };       // 증거로 남기고 회전하지 않음
  const plan = backupRetention(env.drive.list(folder), keep), trashed = [];
  for (const x of plan.remove) { env.drive.trash(x.id); trashed.push(x.name); }
  return { status: 'ok', name, id: copy.id, verified: true, keep, kept: plan.keep.length, trashed, warnings };
}

// 복원: 백업 → 새 사본(검증까지). 운영 시트·기존 백업은 건드리지 않는다.
export function backupRestore(env, backupId, { now = Date.now() } = {}) {
  const folder = env.drive.ensureFolder(), entry = env.drive.list(folder).find(x => x.id === backupId && BACKUP_RE.test(x.name));
  if (!entry) throw new StoreError('NOT_FOUND', '백업을 찾을 수 없습니다(백업 폴더의 백업만 복원할 수 있음)');
  const bs = env.drive.openStore(backupId), bi = storeIntegrityCheck(bs);
  if (!bi.ok && !bi.issues.every(i => i.type === 'missing-view')) throw new StoreError('INTEGRITY', '백업이 손상되어 복원하지 않습니다', { issues: [...new Set(bi.issues.map(i => i.type))] });
  const bf = backupFingerprint(bs), name = backupRestoredName(now), copy = env.drive.copy(backupId, name, folder), rs = env.drive.openStore(copy.id), rf = backupFingerprint(rs);
  if (!bkSame(bf, rf)) { env.drive.trash(copy.id); throw new StoreError('INTEGRITY', '복원본이 백업과 일치하지 않아 폐기했습니다'); }
  return { id: copy.id, name, from: entry.name, repairable: bi.repairable, fingerprint: rf };
}
// 운영 시트 전환 전 점검(전환 자체는 하지 않음): 대상이 정상이고 기대 환경(test/prod) 표식과 맞는지
export function backupSwitchChecks(env, newId, { expectEnv } = {}) {
  const ns = env.drive.openStore(newId), integ = storeIntegrityCheck(ns), fp = backupFingerprint(ns), marks = ns.sheets.rows(META_SHEET).filter(r => String(r[0]) === 'envName').map(r => String(r[1])), actual = marks.length ? marks[marks.length - 1] : null;
  const issues = []; if (!integ.ok) issues.push(...new Set(integ.issues.map(i => i.type))); if (expectEnv && actual !== null && actual !== expectEnv) issues.push('env-mismatch'); if (expectEnv && actual === null) issues.push('env-unmarked');
  return { ok: issues.length === 0, issues, auditCount: fp.auditCount, envMarker: actual };
}
