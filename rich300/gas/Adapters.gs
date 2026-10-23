/**
 * RICH 300 — Apps Script 어댑터: store.mjs 가 요구하는 env 포트(now/sha256/lock/sheets)를 SpreadsheetApp·LockService·Utilities 로 구현한다.
 * 엔진 번들(rich300/build.mjs 산출물)과 같은 프로젝트에 붙여 넣어 쓴다. 이 파일에는 비밀값이 없다(스프레드시트 ID는 호출자가 Script Properties 등에서 읽어 넘긴다).
 *  · 모든 시트 열은 *텍스트 서식('@')*으로 만든다: 그렇지 않으면 Sheets가 "2026-10-24"를 날짜로, "123"을 숫자로 바꿔 키·값이 손상된다.
 *  · 쓰기는 getRange().setValues() 일괄 쓰기 후 flush() — 호출 하나가 한 번의 쓰기 단위다(store의 선기록 순서를 지키기 위함).
 */
function rich300Hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }

function rich300GasEnv_(spreadsheetId, opts) {
  var ss = SpreadsheetApp.openById(spreadsheetId), lock = LockService.getScriptLock();
  return {
    now: function () { return Date.now(); },
    lockTimeoutMs: (opts && opts.lockTimeoutMs) || 10000,
    sha256: function (s) { return rich300Hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); },
    lock: { tryLock: function (ms) { return lock.tryLock(ms); }, release: function () { lock.releaseLock(); } },
    sheets: {
      ensure: function (name, headers) {
        var sh = ss.getSheetByName(name);
        if (!sh) {
          sh = ss.insertSheet(name);
          sh.getRange(1, 1, 1, headers.length).setNumberFormat('@').setValues([headers]);
          sh.setFrozenRows(1);
          return;
        }
        var cur = sh.getLastRow() >= 1 ? sh.getRange(1, 1, 1, headers.length).getValues()[0].map(String) : [];
        if (JSON.stringify(cur) !== JSON.stringify(headers)) throw new Error('헤더 불일치: ' + name);
      },
      rows: function (name) {
        var sh = ss.getSheetByName(name), n = sh.getLastRow();
        if (n <= 1) return [];
        return sh.getRange(2, 1, n - 1, sh.getLastColumn()).getValues();
      },
      append: function (name, rows) {
        if (!rows.length) return;
        var sh = ss.getSheetByName(name), start = sh.getLastRow() + 1, width = rows[0].length;
        if (start + rows.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), Math.max(rows.length, 100));
        sh.getRange(start, 1, rows.length, width).setNumberFormat('@').setValues(rows);
        SpreadsheetApp.flush();
      }
    }
  };
}
