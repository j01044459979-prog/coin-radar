/**
 * RICH 300 — Apps Script 어댑터: store.mjs 가 요구하는 env 포트(now/sha256/lock/sheets)를 SpreadsheetApp·LockService·Utilities 로 구현한다.
 * 엔진 번들(rich300/build.mjs 산출물)과 같은 프로젝트에 붙여 넣어 쓴다. 이 파일에는 비밀값이 없다(스프레드시트 ID는 호출자가 Script Properties 등에서 읽어 넘긴다).
 *  · 모든 시트 열은 *텍스트 서식('@')*으로 만든다: 그렇지 않으면 Sheets가 "2026-10-24"를 날짜로, "123"을 숫자로 바꿔 키·값이 손상된다.
 *  · 쓰기는 getRange().setValues() 일괄 쓰기 — 호출 하나가 한 번의 쓰기 단위다(store의 선기록 순서를 지키기 위함). flush 는 락을 풀기 직전에 한 번만 한다.
 */
function rich300Hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }

function rich300GasEnv_(spreadsheetId, opts) {
  var ss = SpreadsheetApp.openById(spreadsheetId), lock = LockService.getScriptLock();
  /*
   * 요청 안에서만 쓰는 읽기 캐시(다음 요청으로 넘어가지 않는다 — 실제 잔고·포지션·체결 상태에 오래된 값을 쓰지 않기 위함).
   *  · 같은 시트를 한 요청에서 여러 번 읽어도 Sheets 호출은 1번(rows). 같은 요청의 append 는 캐시에 바로 반영한다.
   *  · 스크립트 락을 새로 잡는 순간 모두 버린다: 락을 기다리는 사이 다른 실행이 쓴 행을 놓치면 안 된다.
   *  · ver[name] 은 시트가 바뀔 때마다 커진다(엔진이 파싱 결과 캐시를 무효화하는 기준).
   */
  var handles = {}, rowsMemo = {}, tailMemo = {}, lastRowMemo = {}, widthMemo = {}, ver = {}, bump = function (n) { ver[n] = (ver[n] || 0) + 1; };
  function sheet(name) { if (ver[name] === undefined) ver[name] = 0; if (!handles[name]) handles[name] = ss.getSheetByName(name); if (!handles[name]) throw new Error('시트 없음: ' + name); return handles[name]; }
  function lastRow(name) { if (lastRowMemo[name] === undefined) lastRowMemo[name] = sheet(name).getLastRow(); return lastRowMemo[name]; }
  function width(name) { if (!widthMemo[name]) widthMemo[name] = sheet(name).getLastColumn(); return widthMemo[name]; }
  function dropMemo() { rowsMemo = {}; tailMemo = {}; lastRowMemo = {}; Object.keys(ver).forEach(bump); }
  // 락을 잡은 직후: 모든 쓰기는 Audit 에 먼저 추가되므로 Audit 의 마지막 행 번호가 그대로면 아무도 쓰지 않은 것 → 읽어 둔 시트를 계속 쓴다. 달라졌거나 모르면 전부 버리고 다시 읽는다.
  function refreshAfterLock() {
    var known = lastRowMemo['Audit'];
    if (known !== undefined) { delete lastRowMemo['Audit']; if (lastRow('Audit') === known) return; }
    dropMemo();
  }
  var initCache = null;
  try { var sc = CacheService.getScriptCache(); initCache = { get: function (k) { return sc.get('i:' + spreadsheetId + ':' + k); }, put: function (k, v, ttl) { sc.put('i:' + spreadsheetId + ':' + k, v, ttl); }, remove: function (k) { sc.remove('i:' + spreadsheetId + ':' + k); } }; } catch (err) { initCache = null; }
  return {
    now: function () { return Date.now(); },
    lockTimeoutMs: (opts && opts.lockTimeoutMs) || 10000,
    sha256: function (s) { return rich300Hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); },
    lock: { tryLock: function (ms) { var ok = lock.tryLock(ms); if (ok) refreshAfterLock(); return ok; }, release: function () { try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); } } },   // 다음 실행이 방금 쓴 행을 보도록 락을 풀기 전 한 번만 반영(append 마다 flush 하지 않는다)
    initCache: initCache,
    sheets: {
      version: function (name) { return ver[name] || 0; },
      flush: function () { SpreadsheetApp.flush(); },
      ensure: function (name, headers) {
        var sh = ss.getSheetByName(name);
        if (!sh) {
          sh = ss.insertSheet(name);
          sh.getRange(1, 1, 1, headers.length).setNumberFormat('@').setValues([headers]);
          sh.setFrozenRows(1);
          handles[name] = sh; delete rowsMemo[name]; delete lastRowMemo[name]; bump(name);
          return;
        }
        handles[name] = sh;
        var cur = sh.getLastRow() >= 1 ? sh.getRange(1, 1, 1, headers.length).getValues()[0].map(String) : [];
        if (JSON.stringify(cur) !== JSON.stringify(headers)) throw new Error('헤더 불일치: ' + name);
      },
      rows: function (name) {
        if (!rowsMemo[name]) {      // getDataRange 한 번으로 머리글 포함 전체를 읽는다(행·열 수를 따로 묻는 호출을 줄임)
          var all = sheet(name).getDataRange().getValues();
          rowsMemo[name] = all.slice(1); lastRowMemo[name] = all.length; delete tailMemo[name];
        }
        return rowsMemo[name].slice();
      },
      tail: function (name, count) {        // 마지막 count 행만 읽는다(전체를 읽지 않음). 이미 읽어 둔 내용이 있으면 호출 없이 잘라 준다
        if (rowsMemo[name]) return rowsMemo[name].slice(-count);
        var m = tailMemo[name]; if (m && (m.count >= count || m.complete)) return m.rows.slice(-count);
        var n = lastRow(name), k = Math.min(Math.max(count, 5), Math.max(n - 1, 0)), got = n <= 1 ? [] : sheet(name).getRange(n - k + 1, 1, k, width(name)).getValues();
        tailMemo[name] = { count: Math.max(count, 5), rows: got, complete: k >= n - 1 }; return got.slice(-count);
      },
      append: function (name, rows) {
        if (!rows.length) return;
        var sh = sheet(name), start = lastRow(name) + 1, w = rows[0].length;
        if (start + rows.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), Math.max(rows.length, 100));
        sh.getRange(start, 1, rows.length, w).setNumberFormat('@').setValues(rows);
        lastRowMemo[name] = start + rows.length - 1;
        if (rowsMemo[name]) rows.forEach(function (r) { rowsMemo[name].push(r.map(String)); });
        if (tailMemo[name]) rows.forEach(function (r) { tailMemo[name].rows.push(r.map(String)); });
        bump(name);
      }
    }
  };
}
