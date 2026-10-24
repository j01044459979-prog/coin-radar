/**
 * RICH 300 — 설치 부트스트랩(작은 파일, 한 번만 붙여 넣기). 큰 Code.gs 를 손으로 복사하지 않고, 이 프로젝트 자신에 설치 파일 3개를 자동으로 반영한다.
 *  · 하는 일: GitHub(공개 저장소)에서 MANIFEST.txt 와 설치 파일 3개를 받아 → SHA-256 이 MANIFEST 와 같은지 확인 → 실제 Apps Script V8 에서 문법 검사(실행하지 않음)
 *    → 매니페스트가 '나만 접근·접속한 사용자로 실행'인지 확인 → 이 프로젝트의 내용을 교체(Apps Script API). 하나라도 어긋나면 아무것도 바꾸지 않는다.
 *  · 하지 않는 일: Telegram 호출, 웹 앱 배포, 시트·Drive 접근, 다른 프로젝트 변경, 삭제. 토큰·키는 다루지 않는다.
 *  · 사전 1회: https://script.google.com/home/usersettings 에서 "Google Apps Script API" 를 켠다.
 *  · 실행: rich300BootstrapCheck()(받기·검증만, 변경 없음) → rich300Bootstrap()(검증 후 반영). 반영하면 이 파일은 설치 파일로 대체되어 사라진다.
 */
var RICH300_BOOT_REPO = 'j01044459979-prog/coin-radar';
var RICH300_BOOT_REF = 'release/rich300-prod';
var RICH300_BOOT_DIR = 'rich300/apps-script/';
var RICH300_BOOT_FILES = [{ raw: 'Code.gs', name: 'Code', type: 'SERVER_JS' }, { raw: 'Fill.html', name: 'Fill', type: 'HTML' }, { raw: 'appsscript.json', name: 'appsscript', type: 'JSON' }];

function rich300BootHex_(bytes) { return bytes.map(function (b) { var v = b < 0 ? b + 256 : b, h = v.toString(16); return h.length < 2 ? '0' + h : h; }).join(''); }
function rich300BootGet_(name) {
  var url = 'https://raw.githubusercontent.com/' + RICH300_BOOT_REPO + '/' + RICH300_BOOT_REF + '/' + RICH300_BOOT_DIR + name + '?t=' + Date.now(), res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('다운로드 실패(' + name + ', HTTP ' + res.getResponseCode() + ')');
  return { text: res.getContentText('UTF-8'), sha: rich300BootHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, res.getContent())), size: res.getContent().length };
}
function rich300BootManifest_(text) {
  var m = {}; String(text).split('\n').forEach(function (l) { var p = /^([0-9a-f]{64})\s+(\d+)\s+(\S+)\s*$/.exec(l); if (p) m[p[3]] = { sha: p[1], size: Number(p[2]) }; });
  return m;
}
/** 받기·검증만 한다(변경 없음). 반환: { ok, steps:[{id,status,text}], files } */
function rich300BootVerify_() {
  var steps = [], add = function (id, status, text) { steps.push({ id: id, status: status, text: text }); }, got = null;
  for (var attempt = 0; attempt < 2 && !got; attempt++) {                                                     // GitHub 캐시(수 분)로 파일 간 버전이 어긋나면 한 번 더 시도
    try {
      var mf = rich300BootManifest_(rich300BootGet_('MANIFEST.txt').text), files = {}, bad = [];
      RICH300_BOOT_FILES.forEach(function (f) { var d = rich300BootGet_(f.raw), want = mf[f.raw]; if (!want || want.sha !== d.sha || want.size !== d.size) bad.push(f.raw); files[f.raw] = d; });
      if (!bad.length) got = files; else if (attempt === 0) Utilities.sleep(15000); else add('B1', 'FAIL', '받은 파일이 MANIFEST 와 다릅니다(' + bad.join(', ') + ') — 잘렸거나 아직 갱신 중입니다. 잠시 뒤 다시 실행하세요. 아무것도 바꾸지 않았습니다');
    } catch (err) { if (attempt === 1 || !/다운로드/.test(String(err && err.message))) { add('B1', 'FAIL', String(err && err.message || 'error').replace(/https?:\/\/\S+/g, '').slice(0, 120)); break; } Utilities.sleep(5000); }
  }
  if (!got) return { ok: false, steps: steps };
  add('B1', 'PASS', '설치 파일 3개를 받았고 SHA-256·크기가 MANIFEST 와 같습니다');
  var code = got['Code.gs'].text;
  if (!/\n\}\n$/.test(code)) { add('B2', 'FAIL', 'Code.gs 가 완결되지 않았습니다(끝부분 누락)'); return { ok: false, steps: steps }; }
  try { new Function(code); add('B2', 'PASS', 'Code.gs 문법 검사 통과(' + code.split('\n').length + '줄, 실제 Apps Script V8 에서 구문 분석만 수행)'); }
  catch (err) {
    if (err && err.name === 'SyntaxError') { add('B2', 'FAIL', 'Code.gs 문법 오류: ' + String(err.message || 'error').slice(0, 100)); return { ok: false, steps: steps }; }
    add('B2', 'WARN', '이 환경에서는 구문 검사를 건너뜁니다(' + String(err && err.name || 'error').slice(0, 30) + '). 해시 검증은 통과했으므로 계속합니다');     // 해시가 같으면 내용은 저장소의 시험을 통과한 파일과 같다
  }
  try {
    var man = JSON.parse(got['appsscript.json'].text), w = man.webapp || {};
    if (w.access !== 'MYSELF' || w.executeAs !== 'USER_ACCESSING') throw new Error('manifest-open');
    if (man.runtimeVersion !== 'V8' || man.timeZone !== 'Asia/Seoul') throw new Error('manifest-runtime');
    add('B3', 'PASS', '매니페스트: V8 · Asia/Seoul · 웹 앱은 접속한 사용자로 실행 / 나만 접근');
  } catch (err) { add('B3', 'FAIL', '매니페스트 검사 실패(' + String(err && err.message || 'error').slice(0, 40) + ') — 더 넓은 접근 범위를 허용하는 설정은 설치하지 않습니다'); return { ok: false, steps: steps }; }
  return { ok: true, steps: steps, files: got };
}
function rich300BootFinish_(steps, ok, extra) {
  Logger.log('RICH300 부트스트랩: ' + (ok ? '완료' : '중단') + '\n' + steps.map(function (s) { return '[' + s.status + '] ' + s.id + ' ' + s.text; }).join('\n') + (extra ? '\n' + extra : ''));
  return { ok: ok, steps: steps };
}
function rich300BootstrapCheck() { var v = rich300BootVerify_(); return rich300BootFinish_(v.steps, v.ok, v.ok ? '변경 없음. 이제 rich300Bootstrap 을 실행하면 이 프로젝트에 반영됩니다.' : ''); }
function rich300Bootstrap() {
  var v = rich300BootVerify_(); if (!v.ok) return rich300BootFinish_(v.steps, false, '아무것도 바꾸지 않았습니다.');
  var steps = v.steps, body = { files: RICH300_BOOT_FILES.map(function (f) { return { name: f.name, type: f.type, source: v.files[f.raw].text }; }) };
  var res = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + ScriptApp.getScriptId() + '/content', { method: 'put', contentType: 'application/json', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, payload: JSON.stringify(body), muteHttpExceptions: true });
  var code = res.getResponseCode(), msg = ''; try { msg = String((JSON.parse(res.getContentText()).error || {}).message || ''); } catch (err) { msg = ''; }
  if (code === 200) { steps.push({ id: 'B4', status: 'PASS', text: '이 프로젝트의 내용을 설치 파일 3개로 교체했습니다. 편집기를 새로 고침하세요' }); return rich300BootFinish_(steps, true, '다음: 편집기를 새로 고침 → 함수 rich300Install 실행 → (승인 후) 배포.'); }
  var hint = code === 403 && /not been used|disabled|API/i.test(msg) ? 'Apps Script API 가 꺼져 있습니다. https://script.google.com/home/usersettings 에서 켜고 다시 실행하세요' : code === 401 || code === 403 ? '권한이 없습니다. 권한 동의(script.projects)를 다시 승인하세요' : 'HTTP ' + code;
  steps.push({ id: 'B4', status: 'FAIL', text: '프로젝트 내용을 교체하지 못했습니다 — ' + hint });
  return rich300BootFinish_(steps, false, '아무것도 바꾸지 않았습니다.');
}
