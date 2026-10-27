/**
 * RICH 300 — 배포 보조(R8): 환경 분리 가드, 초기 설정, 자가 점검, 트리거 일괄 설치. 엔진 번들과 같은 프로젝트에 둔다.
 *  · 테스트 프로젝트와 운영 프로젝트는 *서로 다른 Apps Script 프로젝트·스프레드시트·봇 토큰*을 쓴다. RICH300_ENV(test|prod)와 시트 Meta 의 환경 표식이 일치해야 한다.
 *  · Telegram 호출 가드(rich300TgGate_): 운영은 RICH300_PROD_APPROVED=yes, 테스트는 RICH300_TEST_TG_ALLOW=yes 일 때만 허용. 그 전에는 어떤 메시지도 나가지 않는다.
 *  · 점검·설정 함수의 출력에는 값이 아니라 상태(존재 여부)만 담는다. 토큰·키·이메일·시트 ID를 출력하지 않는다.
 */
var RICH300_GATE_PURPOSE_ = '';      // 화면의 명시적 동작(rich300TgTestSend·rich300TgPairCheck)이 실행하는 동안에만 설정된다(실행마다 초기화). 트리거·폴링·감시는 설정하지 않는다.
function rich300TgGate_(method) {
  var p = PropertiesService.getScriptProperties();
  return RICH300_ENGINE.deployGate({ env: p.getProperty('RICH300_ENV'), prodApproved: p.getProperty('RICH300_PROD_APPROVED'), readOnlyOk: p.getProperty('RICH300_TG_READONLY_OK'), testTgAllow: p.getProperty('RICH300_TEST_TG_ALLOW'), tgTestOk: p.getProperty('RICH300_TG_TEST_OK') }, method, RICH300_GATE_PURPOSE_);
}
/** 초기 설정(멱등): 환경 이름·소유자 이메일 기록, 시트가 없으면 새로 만들고 저장소 초기화·환경 표식. 트리거·승인 플래그는 건드리지 않는다. */
function rich300SetupTest() { return rich300Setup_('test'); }
function rich300SetupProd() { return rich300Setup_('prod'); }
function rich300Setup_(name) {
  var props = PropertiesService.getScriptProperties(), cur = props.getProperty('RICH300_ENV');
  if (cur && cur !== name) return { ok: false, error: 'env-conflict', note: '이 프로젝트는 이미 ' + cur + ' 환경입니다. 환경이 다르면 새 프로젝트를 만드세요.' };
  props.setProperty('RICH300_ENV', name);
  if (!props.getProperty('RICH300_OWNER_EMAIL')) { var me = Session.getEffectiveUser().getEmail(); if (me) props.setProperty('RICH300_OWNER_EMAIL', me); }
  var created = false, id = props.getProperty('RICH300_SHEET_ID');
  if (!id) { id = SpreadsheetApp.create('RICH300 ' + name).getId(); props.setProperty('RICH300_SHEET_ID', id); created = true; }
  var se = rich300GasEnv_(id); RICH300_ENGINE.storeInit(se);
  try { RICH300_ENGINE.deployMarkEnv(se, name); } catch (err) { return { ok: false, error: String(err && err.code || 'error') }; }
  return { ok: true, env: name, sheetCreated: created, next: ['rich300SelfTest 실행', '봇 토큰·수신 키·UI URL 등 비밀값은 프로젝트 설정의 스크립트 속성에서 직접 입력'] };
}
function rich300CallIf_(name) { if (typeof globalThis[name] === 'function') { globalThis[name](); return true; } return false; }
function rich300InstallAllTriggers() { var done = ['rich300TgInstallPollTrigger', 'rich300InstallCloseTriggers', 'rich300BackupInstallTrigger'].filter(rich300CallIf_); return { ok: true, installed: done.length }; }
function rich300RemoveAllTriggers() { var done = ['rich300TgRemovePollTrigger', 'rich300RemoveCloseTriggers', 'rich300BackupRemoveTrigger'].filter(rich300CallIf_); return { ok: true, removed: done.length }; }

/** 자가 점검: 상태만 반환(값 없음). 실행 로그에도 같은 요약을 남긴다. */
function rich300SelfTestRun_() {
  var p = PropertiesService.getScriptProperties(), has = function (k) { return !!p.getProperty(k); }, info, se = null, integ = null, marker = null, backups = 0;
  try { if (has('RICH300_SHEET_ID')) { se = rich300GasEnv_(p.getProperty('RICH300_SHEET_ID')); RICH300_ENGINE.storeInit(se); var c = RICH300_ENGINE.storeIntegrityCheck(se); integ = { ok: c.ok, issues: c.issues.map(function (i) { return i.type; }) }; marker = RICH300_ENGINE.deployCheckEnv(se, p.getProperty('RICH300_ENV')); } } catch (err) { integ = null; }
  try { backups = rich300BackupList().filter(function (x) { return /^RICH300-backup-/.test(x.name); }).length; } catch (err) { backups = 0; }
  var email = ''; try { email = Session.getActiveUser().getEmail() || ''; } catch (err) { email = ''; }
  var key = p.getProperty('RICH300_INGEST_KEY') || '';
  info = { env: p.getProperty('RICH300_ENV'), tz: Session.getScriptTimeZone(), v8: typeof BigInt === 'function',
    has: { sheetId: has('RICH300_SHEET_ID'), ownerEmail: has('RICH300_OWNER_EMAIL'), tgToken: has('RICH300_TG_TOKEN'), ingestKey: key.length > 0, uiUrl: /^https:\/\//.test(p.getProperty('RICH300_UI_URL') || '') }, ingestKeyLen: key.length,
    flags: { closeSendApproved: p.getProperty('RICH300_CLOSE_SEND_APPROVED') === 'yes', prodApproved: p.getProperty('RICH300_PROD_APPROVED') === 'yes', testTgAllow: p.getProperty('RICH300_TEST_TG_ALLOW') === 'yes' },
    owner: { activeEmailVisible: email.length > 3, matchesOwner: email.length > 3 && email.toLowerCase() === String(p.getProperty('RICH300_OWNER_EMAIL') || '').toLowerCase() },
    triggers: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }), expectTriggers: [['rich300TgInstallPollTrigger', 'rich300TgPoll'], ['rich300InstallCloseTriggers', 'rich300CloseTick'], ['rich300BackupInstallTrigger', 'rich300BackupRun']].filter(function (x) { return typeof globalThis[x[0]] === 'function'; }).map(function (x) { return x[1]; }), integrity: integ, envMarker: marker, backupCount: backups };
  return RICH300_ENGINE.deploySelfTest(info);
}
function rich300SelfTest() {
  var r = rich300SelfTestRun_();
  Logger.log('RICH300 자가 점검: 실패 ' + r.fail + ' · 경고 ' + r.warn + '\n' + r.items.filter(function (i) { return !i.ok; }).map(function (i) { return '[' + i.level + '] ' + i.text; }).join('\n'));
  return r;
}
