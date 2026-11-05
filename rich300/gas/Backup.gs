/**
 * RICH 300 — 백업·복원 어댑터(R8). DriveApp 으로 스프레드시트 사본을 만들고 검증·보관(최근 N개)한다. 로직은 엔진(backup.mjs)에 있다.
 *  · 주 1회 트리거(일요일 03시 KST) + 수동 실행. 운영 배포·트리거 설치는 승인 이후.
 *  · 백업 폴더(Drive "RICH300-backups")는 처음 실행 때 만든다. 보관 삭제는 휴지통 이동이며 이름 패턴이 맞는 백업만 대상이다.
 *  · Telegram CSV 전송은 구현하지 않는다(이 파일에는 외부 네트워크 호출이 없다).
 *  · 복원은 새 사본 생성·검증까지. 운영 시트 전환은 Script Property 두 개(RICH300_SWITCH_TO, RICH300_SWITCH_CONFIRM=yes)를 사용자가 직접 설정한 뒤 rich300BackupSwitchFromProps 를 실행할 때만(전환 전 자동 백업).
 *  · 필요한 권한: Drive 사본 생성·휴지통 이동(DriveApp). 최소 범위는 drive.file 로 시도하고, 원본 시트를 스크립트가 만들지 않은 경우 drive 범위가 필요할 수 있다(테스트 프로젝트에서 확인).
 */
var RICH300_BACKUP_FOLDER = 'RICH300-backups';

function rich300BackupDrive_(folderName) {
  var folderId = null;
  return {
    ensureFolder: function () {
      if (folderId) return folderId;
      var it = DriveApp.getFoldersByName(folderName);
      folderId = it.hasNext() ? it.next().getId() : DriveApp.createFolder(folderName).getId();
      return folderId;
    },
    list: function (fid) {
      var out = [], it = DriveApp.getFolderById(fid).getFiles();
      while (it.hasNext()) { var f = it.next(); out.push({ id: f.getId(), name: f.getName(), createdAt: f.getDateCreated().getTime() }); }
      return out;
    },
    copy: function (sourceId, name, fid) { var f = DriveApp.getFileById(sourceId).makeCopy(name, DriveApp.getFolderById(fid)); return { id: f.getId() }; },
    openStore: function (id) { return rich300GasEnv_(id); },
    trash: function (id) { DriveApp.getFileById(id).setTrashed(true); }
  };
}
function rich300BackupEnv_() {
  var props = PropertiesService.getScriptProperties(), sid = props.getProperty('RICH300_SHEET_ID'), store = null;
  return { sourceId: sid, storeEnv: function () { if (!store) { store = rich300GasEnv_(sid); RICH300_ENGINE.storeInit(store); } return store; }, drive: rich300BackupDrive_(RICH300_BACKUP_FOLDER) };
}
/** 트리거·수동 진입점. 결과는 개수·이름만 속성에 남긴다(ID·내용 없음). */
function rich300BackupRun() {
  var out;
  try { out = RICH300_ENGINE.backupRun(rich300BackupEnv_(), { now: Date.now() }); } catch (err) { out = { status: 'exception', code: String(err && err.code || 'error') }; }
  PropertiesService.getScriptProperties().setProperty('backup:last', JSON.stringify({ at: Date.now(), status: out.status, name: out.name || null, trashed: (out.trashed || []).length, rotated: out.rotated !== false, reasons: out.reasons || null, warnings: out.warnings || null }));
  return { status: out.status, name: out.name, trashed: out.trashed, warnings: out.warnings };
}
function rich300BackupList() {
  var env = rich300BackupEnv_(), list = env.drive.list(env.drive.ensureFolder()).filter(function (x) { return /^RICH300-(backup|restored)-/.test(x.name); });
  list.sort(function (a, b) { return a.name < b.name ? 1 : -1; });
  return list.map(function (x) { return { name: x.name, createdAt: new Date(x.createdAt).toISOString() }; });          // ID는 반환하지 않는다
}
function rich300BackupInstallTrigger() {
  rich300BackupRemoveTrigger();
  ScriptApp.newTrigger('rich300BackupRun').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
}
function rich300BackupRemoveTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'rich300BackupRun') ScriptApp.deleteTrigger(t); });
}
/** 복원 시험: 가장 최근 백업(또는 RICH300_RESTORE_FROM_NAME 속성에 적은 이름)을 새 사본으로 복원·검증. 운영 시트는 바뀌지 않는다. 새 사본 이름만 반환. */
function rich300BackupRestoreLatest() {
  var env = rich300BackupEnv_(), props = PropertiesService.getScriptProperties(), want = props.getProperty('RICH300_RESTORE_FROM_NAME'), list = env.drive.list(env.drive.ensureFolder()).filter(function (x) { return /^RICH300-backup-\d{8}-\d{4}$/.test(x.name); }).sort(function (a, b) { return a.name < b.name ? 1 : -1; });
  var pick = want ? list.filter(function (x) { return x.name === want; })[0] : list[0];
  if (!pick) return { ok: false, error: 'no-backup' };
  try { var r = RICH300_ENGINE.backupRestore(env, pick.id, { now: Date.now() }); props.setProperty('RICH300_LAST_RESTORED_ID', r.id); return { ok: true, name: r.name, from: r.from, repairable: r.repairable }; }
  catch (err) { return { ok: false, error: String(err && err.code || 'error') }; }
}
/** 운영 시트 전환(사용자가 RICH300_SWITCH_TO=새 시트 ID, RICH300_SWITCH_CONFIRM=yes 를 직접 설정한 경우에만). 전환 전 현재 시트를 자동 백업하고 대상을 점검한다. */
function rich300BackupSwitchFromProps() {
  var props = PropertiesService.getScriptProperties(), to = props.getProperty('RICH300_SWITCH_TO'), ok = props.getProperty('RICH300_SWITCH_CONFIRM');
  if (!to || ok !== 'yes') return { ok: false, error: 'not-confirmed' };
  var env = rich300BackupEnv_(), chk = RICH300_ENGINE.backupSwitchChecks(env, to, { expectEnv: props.getProperty('RICH300_ENV') });
  if (!chk.ok) return { ok: false, error: 'checks-failed', issues: chk.issues };
  var pre = RICH300_ENGINE.backupRun(env, { now: Date.now() });
  if (pre.status !== 'ok' && pre.status !== 'exists') return { ok: false, error: 'pre-backup-failed', status: pre.status };
  props.setProperty('RICH300_SHEET_ID_PREVIOUS', props.getProperty('RICH300_SHEET_ID')); props.setProperty('RICH300_SHEET_ID', to); props.deleteProperty('RICH300_SWITCH_TO'); props.deleteProperty('RICH300_SWITCH_CONFIRM');
  return { ok: true, preBackup: pre.name, note: '이전 시트 ID는 RICH300_SHEET_ID_PREVIOUS 에 보관됨(되돌리기용)' };
}
