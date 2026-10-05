/**
 * 리치 베팅 장부 V1 — Google Apps Script (스프레드시트 연결형 웹앱)
 *
 * 구조 원칙
 *  - 시트명/헤더는 아래 TABLES 한 곳에서만 정의
 *  - 한도 설정값은 SETTINGS 시트에서 읽음 (코드에 값 없음, setup 시 기본값만 기입)
 *  - 손익/ROI/집계 계산은 이 파일(서버) 한 곳. 프론트는 표시만 담당
 *  - 모든 쓰기는 LockService + 서버 재검증
 */

var CONFIG = {
  SPREADSHEET_ID: '1CiE3iOGJFEmcDbh3HnkuS5_BtSDhN8JPDMWff4IgIZI',
  TZ: 'Asia/Seoul',
  APP_TITLE: '리치 베팅 장부',
  LOCK_WAIT_MS: 20000,
  REQ_CACHE_SEC: 600,
  MAX_TEXT: 200,
  MAX_MEMO: 500
};

var ENUM = {
  SPORT: ['축구', '야구', '농구', '배구', '기타'],
  BET_RESULT: ['대기', '적중', '미적중', '적특', '취소'],
  BET_RESOLVE: ['적중', '미적중', '적특', '취소'],
  GRADE: ['메인', '대박', '기타'],
  COMBO: ['주력', '보조1', '보조2'],
  BUY: ['미확인', '구매', '미구매'],
  PICK: ['승', '무', '패'],
  RANK: ['대기', '1등', '2등', '3등', '4등', '미당첨'],
  RANK_RESOLVE: ['1등', '2등', '3등', '4등', '미당첨']
};

var SETTING_KEYS = {
  BUDGET: '월 예산',
  DAILY: '일반토토 일 최대',
  WDL_ROUND: '승무패 회차 최대'
};
var SETTING_DEFAULTS = [
  [SETTING_KEYS.BUDGET, 200000, '이번달 일반토토 + 승무패 합산 사용 상한(원)'],
  [SETTING_KEYS.DAILY, 5000, '일반토토 하루 최대 베팅금액(원)'],
  [SETTING_KEYS.WDL_ROUND, 10000, '승무패 한 회차(모든 조합 합산) 최대 베팅금액(원)']
];
var SETTINGS_SHEET = { name: 'SETTINGS', headers: ['항목', '값', '설명'] };
var DASH_SHEET_NAME = 'DASHBOARD';
var WDL_MULTI_MAX = 10;   // 한 묶음의 최대 조합 수(조합1 ~ 조합10)

function wdlGameCols_() {
  var cols = [];
  for (var i = 1; i <= 14; i++) cols.push(['g' + i, i + '경기']);
  return cols;
}

// [key, header]
var TABLES = {
  BET: {
    name: 'BET_LOG',
    prefix: 'B',
    cols: [
      ['id', 'ID'], ['date', '베팅일'], ['sport', '종목'], ['league', '리그'],
      ['name', '경기/조합명'], ['pick', '픽 내용'], ['folders', '폴더수'], ['odds', '총배당'],
      ['stake', '베팅금액'], ['result', '결과'], ['ret', '반환금'], ['profit', '손익'],
      ['roi', 'ROI'], ['grade', '리치등급'], ['memo', '메모'], ['createdAt', '등록일시'],
      ['buyStatus', '구매여부'], ['buyStake', '실제베팅금액'], ['buyAt', '구매일시']
    ],
    textKeys: ['id', 'date'],
    dtKeys: ['createdAt', 'buyAt'],
    plainKeys: ['id'],
    moneyKeys: ['stake', 'ret', 'profit', 'buyStake'],
    roiKey: 'roi'
  },
  WDL: {
    name: 'WDL_LOG',
    prefix: 'W',
    cols: [['id', 'ID'], ['round', '회차'], ['date', '구매일'], ['combo', '조합구분']]
      .concat(wdlGameCols_())
      .concat([
        ['stake', '베팅금액'], ['hits', '적중개수'], ['rank', '등수'], ['prize', '당첨금'],
        ['profit', '손익'], ['memo', '메모'], ['createdAt', '등록일시'],
        ['buyStatus', '구매여부'], ['buyStake', '실제베팅금액'], ['buyAt', '구매일시'],
        ['groupId', '구매묶음ID'], ['comboNo', '조합순번']
      ]),
    coreCount: 28,   // 앞 28열은 필수(기존 시트). 구매묶음ID/조합순번은 setupWdlGroupColumns()/setup() 이 비파괴로 추가
    textKeys: ['id', 'round', 'date', 'groupId'],
    dtKeys: ['createdAt', 'buyAt'],
    plainKeys: ['id', 'round', 'groupId'],
    moneyKeys: ['stake', 'prize', 'profit', 'buyStake'],
    roiKey: null
  }
};

/* ------------------------------------------------------------------ */
/* 웹앱 진입점                                                         */
/* ------------------------------------------------------------------ */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(CONFIG.APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/* ------------------------------------------------------------------ */
/* 계산 로직 (단일 위치)                                               */
/* ------------------------------------------------------------------ */

function round2_(n) { return Math.round(n * 100) / 100; }

/** 손익 = 반환금 - 베팅금액 (반환금은 원금 포함 총 반환액) */
function calcProfit_(stake, ret) { return ret - stake; }

/** ROI(%) = 손익 / 베팅금액 * 100, 베팅금액 0이면 0 */
function calcRoi_(stake, profit) { return stake === 0 ? 0 : round2_(profit / stake * 100); }

function calcRate_(hit, miss) { return (hit + miss) > 0 ? round2_(hit / (hit + miss) * 100) : null; }

/* ------------------------------------------------------------------ */
/* 시트 접근                                                           */
/* ------------------------------------------------------------------ */

var ssCache_ = null;

/** 한 번의 API 실행 안에서만 유효한 읽기 메모. 쓰기(appendRow_/updateRow_/updateCells_)와 API 진입마다 비운다. */
var memo_ = {};
function memoClear_(keepSettings) { var st = memo_.settings; memo_ = {}; if (keepSettings && st) memo_.settings = st; }

function getSS_() {
  if (ssCache_) return ssCache_;
  ssCache_ = openSpreadsheet_();
  return ssCache_;
}

function openSpreadsheet_() {
  var ss = null;
  try { ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID); } catch (e) { ss = null; }
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('스프레드시트를 열 수 없습니다. CONFIG.SPREADSHEET_ID 와 접근 권한을 확인하세요.');
  return ss;
}

function getSheet_(name) {
  var sh = getSS_().getSheetByName(name);
  if (!sh) throw new Error('시트 "' + name + '"가 없습니다. setup()을 실행하세요.');
  return sh;
}

function headersOf_(tbl) { return tbl.cols.map(function (c) { return c[1]; }); }
function coreCount_(tbl) { return tbl.coreCount || tbl.cols.length; }
/** 시트에 실제로 존재하는 열 수까지만 읽고/쓴다(선택 열이 아직 없는 기존 시트와도 호환) */
function tblWidth_(sh, tbl) { return Math.min(tbl.cols.length, sh.getMaxColumns()); }
function ensureWidth_(sh, n) {
  if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
}

function ensureTable_(ss, tbl) {
  var sh = ss.getSheetByName(tbl.name) || ss.insertSheet(tbl.name);
  var headers = headersOf_(tbl);
  var existed = sh.getLastRow() > 0;
  ensureWidth_(sh, headers.length);
  if (!existed) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    var cur = sh.getRange(1, 1, 1, headers.length).getValues()[0];
    for (var i = 0; i < headers.length; i++) {
      if (i >= coreCount_(tbl) && String(cur[i] === undefined ? '' : cur[i]).trim() === '') {   // 선택 열 헤더가 비어 있으면 추가(기존 값은 건드리지 않음)
        sh.getRange(1, i + 1).setValue(headers[i]).setFontWeight('bold');
        continue;
      }
      if (String(cur[i]) !== headers[i]) {
        throw new Error(tbl.name + ' 헤더가 예상과 다릅니다(' + (i + 1) + '열: "' + cur[i] + '" ≠ "' + headers[i] + '"). 기존 데이터 보호를 위해 중단합니다.');
      }
    }
  }
  var rows = Math.max(sh.getMaxRows() - 1, 1);
  // 문자열로 저장해야 값이 변형되지 않는 열(ID/회차/등록일시)만 항상 텍스트 서식 지정 (데이터 행 한정)
  tbl.cols.forEach(function (c, i) {
    if (tbl.plainKeys.indexOf(c[0]) >= 0) sh.getRange(2, i + 1, rows, 1).setNumberFormat('@');
  });
  if (existed) return sh;   // 기존 시트: 헤더 스타일/고정행/날짜·금액·ROI 서식은 건드리지 않음
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8eaed');
  sh.setFrozenRows(1);
  tbl.cols.forEach(function (c, i) {
    var col = sh.getRange(2, i + 1, rows, 1);
    if (c[0] === 'date') col.setNumberFormat('yyyy-mm-dd');
    else if (tbl.dtKeys.indexOf(c[0]) >= 0) col.setNumberFormat('yyyy-mm-dd hh:mm');
    else if (tbl.moneyKeys.indexOf(c[0]) >= 0) col.setNumberFormat('#,##0');
    else if (c[0] === tbl.roiKey) col.setNumberFormat('0.0%');
  });
  return sh;
}

function ensureSettings_(ss) {
  var sh = ss.getSheetByName(SETTINGS_SHEET.name) || ss.insertSheet(SETTINGS_SHEET.name);
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, 3).setValues([SETTINGS_SHEET.headers]);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#e8eaed');
  var existing = {};
  var last = sh.getLastRow();
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { existing[String(r[0]).trim()] = true; });
  }
  SETTING_DEFAULTS.forEach(function (d) {
    if (!existing[d[0]]) sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setValues([d]);
  });
  return sh;
}

/** 시트 4개 생성(이미 있으면 유지). 최초 1회 실행. */
function setup() {
  var ss = getSS_();
  ensureTable_(ss, TABLES.BET);
  ensureWdlComboValidation_(ensureTable_(ss, TABLES.WDL));
  if (!ss.getSheetByName(DASH_SHEET_NAME)) ss.insertSheet(DASH_SHEET_NAME);
  ensureSettings_(ss);
  ['Sheet1', '시트1'].forEach(function (n) {
    var d = ss.getSheetByName(n);
    if (d && d.getLastRow() === 0 && ss.getSheets().length > 4) ss.deleteSheet(d);
  });
  return '설정 완료';
}

/** WDL_LOG 에 구매묶음ID/조합순번 열(AC, AD)을 비파괴로 추가한다(기존 값/데이터는 건드리지 않음). 여러 번 실행해도 안전. */
function setupWdlGroupColumns() {
  var ss = getSS_();
  if (!ss.getSheetByName(TABLES.WDL.name)) throw new Error('시트 "' + TABLES.WDL.name + '"가 없습니다. setup()을 실행하세요.');
  var sh = ensureTable_(ss, TABLES.WDL);
  var widened = ensureWdlComboValidation_(sh);
  try {   // 새 열은 옆 열(구매일시)의 날짜 서식을 물려받을 수 있다 → 조합순번은 숫자 서식으로 고정(기존 데이터 값은 그대로)
    var cn = TABLES.WDL.cols.map(function (c) { return c[0]; }).indexOf('comboNo') + 1;
    if (cn > 0 && cn <= sh.getMaxColumns()) sh.getRange(2, cn, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('0');
    SpreadsheetApp.flush();
  } catch (e) { Logger.log('조합순번 서식 지정 실패: ' + richErr_(e)); }
  var msg = 'WDL_LOG 묶음 열 확인 완료 (구매묶음ID, 조합순번)' + (widened ? ' · 조합구분 드롭다운에 조합1~' + WDL_MULTI_MAX + ' 추가' : '');
  Logger.log(msg);
  return msg;
}

function getSettings_() {
  if (memo_.settings) return memo_.settings;
  var sh = getSheet_(SETTINGS_SHEET.name);
  var last = sh.getLastRow();
  var map = {};
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) { map[String(r[0]).trim()] = r[1]; });
  }
  function read(key) {
    var raw = map[key];
    var n = Number(String(raw === undefined ? '' : raw).replace(/,/g, '').trim());
    if (raw === undefined || raw === '' || !isFinite(n) || n <= 0) {
      throw new Error('SETTINGS의 "' + key + '" 값이 올바르지 않습니다(양수 필요).');
    }
    return n;
  }
  memo_.settings = {
    budget: read(SETTING_KEYS.BUDGET),
    daily: read(SETTING_KEYS.DAILY),
    wdlRound: read(SETTING_KEYS.WDL_ROUND)
  };
  return memo_.settings;
}

function toDateStr_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, CONFIG.TZ, 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim().slice(0, 10);
}

function toDateTimeStr_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, CONFIG.TZ, 'yyyy-MM-dd HH:mm:ss');
  return String(v == null ? '' : v).trim().slice(0, 19);
}

function numOrNull_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

function normalizeRow_(tbl, o) {
  tbl.textKeys.forEach(function (k) { o[k] = k === 'date' ? toDateStr_(o[k]) : String(o[k] == null ? '' : o[k]); });
  tbl.moneyKeys.concat(['folders', 'odds', 'hits', 'roi', 'comboNo']).forEach(function (k) {
    if (k in o) o[k] = numOrNull_(o[k]);
  });
  tbl.dtKeys.forEach(function (k) { o[k + 'Str'] = toDateTimeStr_(o[k]); });
  o.buyStatus = String(o.buyStatus == null ? '' : o.buyStatus).trim() || '미확인';   // 빈값 = 미확인
  if (tbl.roiKey && o[tbl.roiKey] !== null && o[tbl.roiKey] !== undefined) o[tbl.roiKey] = round2_(o[tbl.roiKey] * 100);
  return o;
}

function readRows_(tbl) {
  if (memo_[tbl.name]) return memo_[tbl.name];
  var sh = getSheet_(tbl.name);
  var last = sh.getLastRow();
  if (last < 2) return (memo_[tbl.name] = []);
  var width = tblWidth_(sh, tbl);
  var vals = sh.getRange(2, 1, last - 1, width).getValues();
  var out = [];
  vals.forEach(function (v, i) {
    if (String(v[0]) === '') return;
    var o = { _row: i + 2 };
    tbl.cols.forEach(function (c, j) { o[c[0]] = j < width ? v[j] : ''; });
    out.push(normalizeRow_(tbl, o));
  });
  memo_[tbl.name] = out;
  return out;
}

function rowToArray_(tbl, o) {
  return tbl.cols.map(function (c) {
    var v = o[c[0]];
    if (v == null) return '';
    if (c[0] === 'date' && typeof v === 'string' && v !== '') return Utilities.parseDate(v, CONFIG.TZ, 'yyyy-MM-dd');   // 실제 Date 값
    if (c[0] === tbl.roiKey && v !== '') return Math.round(v * 100) / 10000;  // % → 비율(시트 서식 0.0%)
    return v;
  });
}

/** 날짜/일시/ROI 셀의 표시 서식 (값은 Date / 비율 숫자). count 행에 한 번에 적용 */
function formatRowCells_(sh, tbl, rowNum, count) {
  var n = count || 1, width = tblWidth_(sh, tbl);
  tbl.cols.forEach(function (c, i) {
    if (i >= width) return;
    var k = c[0];
    if (k === 'date') sh.getRange(rowNum, i + 1, n, 1).setNumberFormat('yyyy-mm-dd');
    else if (tbl.dtKeys.indexOf(k) >= 0) sh.getRange(rowNum, i + 1, n, 1).setNumberFormat('yyyy-mm-dd hh:mm');
    else if (k === tbl.roiKey) sh.getRange(rowNum, i + 1, n, 1).setNumberFormat('0.0%');
    else if (k === 'comboNo') sh.getRange(rowNum, i + 1, n, 1).setNumberFormat('0');   // 옆 열(구매일시)의 날짜 서식이 번져 1,2,3 이 날짜로 읽히는 사고 방지(실환경 셀프테스트에서 발견)
  });
}

/**
 * 여러 행을 '전부 또는 전무'로 추가한다.
 *  1) 모든 행을 메모리에서 완성하고 열 개수를 검증  2) 단일 setValues  3) flush 로 쓰기 오류를 이 지점에서 확정
 *  4) 다시 읽어 빠진 셀이 없는지 검증  5) 어느 단계든 실패하면 이번에 쓴 행 범위만 즉시 비우고(rollback) 예외를 던진다.
 * 주의(운영 교훈): Sheets 쓰기는 지연 실행된다. 거절형 데이터 검증을 위반하면 그 셀 앞까지만 쓰이고 예외가 flush 시점에
 * 늦게 터지며 뒤에 쌓인 쓰기(예: Inbox ERROR 기록)가 버려진다 → 여기서 즉시 flush 해 예외를 try/catch 안으로 가져온다.
 */
function appendRows_(tbl, recs) {
  if (!recs.length) return;
  var sh = getSheet_(tbl.name), width = tblWidth_(sh, tbl);
  var rows = recs.map(function (o) {
    var a = rowToArray_(tbl, o);
    if (a.length !== tbl.cols.length) fail_(tbl.name + ' 행 열 개수 불일치 (' + a.length + ' ≠ ' + tbl.cols.length + ') — 저장하지 않았습니다.');
    return a.slice(0, width);
  });
  var start = sh.getLastRow() + 1;
  try {
    sh.getRange(start, 1, rows.length, width).setValues(rows);
    SpreadsheetApp.flush();
    var back = sh.getRange(start, 1, rows.length, width).getValues();
    rows.forEach(function (row, i) {
      row.forEach(function (v, j) {
        if (v !== '' && (back[i][j] === '' || back[i][j] == null)) {
          throw new Error('쓰기 검증 실패: ' + (start + i) + '행 ' + (j + 1) + '열(' + tbl.cols[j][1] + ')이 비어 있습니다.');
        }
      });
    });
    formatRowCells_(sh, tbl, start, rows.length);
    SpreadsheetApp.flush();
  } catch (e) {
    try { sh.getRange(start, 1, rows.length, sh.getMaxColumns()).clearContent(); SpreadsheetApp.flush(); } catch (e2) { /* rollback 최선 */ }
    memoClear_(true);
    throw new Error('저장 중 오류가 나서 이번 요청의 ' + rows.length + '행 기록을 모두 되돌렸습니다: ' + (e && e.message ? e.message : e));
  }
  memoClear_(true);
}

function appendRow_(tbl, o) { appendRows_(tbl, [o]); }

/** 연속된 열(keys 순서가 시트 열 순서와 같아야 함)만 갱신 */
function updateCells_(tbl, rowNum, keys, o) {
  var idx = keys.map(function (k) { return tbl.cols.map(function (c) { return c[0]; }).indexOf(k); });
  idx.forEach(function (v, i) { if (v < 0 || v !== idx[0] + i) fail_('내부 오류: 열 순서'); });
  var sh = getSheet_(tbl.name);
  sh.getRange(rowNum, idx[0] + 1, 1, keys.length)
    .setValues([keys.map(function (k) { return o[k] == null ? '' : o[k]; })]);
  SpreadsheetApp.flush();
  formatRowCells_(sh, tbl, rowNum);
  memoClear_(true);
}

/** 여러 행의 같은 열들을 갱신: 연속 행은 한 번의 setValues 로 묶는다(묶음 구매의 원자성). items: [{row, o}] */
function updateCellsBulk_(tbl, keys, items) {
  var idx = keys.map(function (k) { return tbl.cols.map(function (c) { return c[0]; }).indexOf(k); });
  idx.forEach(function (v, i) { if (v < 0 || v !== idx[0] + i) fail_('내부 오류: 열 순서'); });
  var sh = getSheet_(tbl.name);
  var sorted = items.slice().sort(function (a, b) { return a.row - b.row; });
  var runs = [];
  sorted.forEach(function (it) {
    var last = runs[runs.length - 1];
    if (last && last[last.length - 1].row + 1 === it.row) last.push(it); else runs.push([it]);
  });
  runs.forEach(function (run) {
    sh.getRange(run[0].row, idx[0] + 1, run.length, keys.length)
      .setValues(run.map(function (it) { return keys.map(function (k) { return it.o[k] == null ? '' : it.o[k]; }); }));
    SpreadsheetApp.flush();
    formatRowCells_(sh, tbl, run[0].row, run.length);
  });
  memoClear_(true);
}

function updateRow_(tbl, rowNum, o) {
  var sh = getSheet_(tbl.name), width = tblWidth_(sh, tbl);
  sh.getRange(rowNum, 1, 1, width).setValues([rowToArray_(tbl, o).slice(0, width)]);
  SpreadsheetApp.flush();
  formatRowCells_(sh, tbl, rowNum);
  memoClear_(true);
}

/* ------------------------------------------------------------------ */
/* 입력 검증 헬퍼                                                      */
/* ------------------------------------------------------------------ */

function fail_(msg) { throw new Error(msg); }

function fmtWon_(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원'; }

function intField_(v, label) {
  var s = String(v == null ? '' : v).replace(/,/g, '').trim();
  if (!/^-?\d+$/.test(s)) fail_(label + ': 정수로 입력하세요.');
  return Number(s);
}

function stakeField_(v) {
  var n = intField_(v, '베팅금액');
  if (n <= 0) fail_('베팅금액은 0원보다 커야 합니다.');
  return n;
}

function dateField_(v, label) {
  var s = String(v == null ? '' : v).trim();
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) fail_(label + ': 날짜 형식이 올바르지 않습니다.');
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) fail_(label + ': 존재하지 않는 날짜입니다.');
  return s;
}

function enumField_(v, list, label) {
  var s = String(v == null ? '' : v).trim();
  if (list.indexOf(s) < 0) fail_(label + ': 허용되지 않은 값입니다. 허용값: ' + list.join(', '));
  return s;
}

/** 시트 수식 주입 방지 + 길이 제한 */
function textField_(v, label, max, required) {
  var s = String(v == null ? '' : v).trim();
  if (required && !s) fail_(label + '을(를) 입력하세요.');
  if (s.length > max) fail_(label + ': ' + max + '자 이하로 입력하세요.');
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function todayStr_() { return Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd'); }

function newId_(tbl, rows) {
  var used = {};
  rows.forEach(function (r) { used[r.id] = true; });
  var id;
  do {
    id = tbl.prefix + '-' + Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyyMMdd') + '-' +
      Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
  } while (used[id]);
  return id;
}

/** 실제 구매(구매여부=구매)의 실제베팅금액 합계. 월은 구매일시 기준(대시보드 수식과 동일). */
function monthUsage_(month, bets, wdl) {
  var used = 0;
  bets.concat(wdl).forEach(function (r) {
    if (r.buyStatus === '구매' && r.buyAtStr.slice(0, 7) === month) used += r.buyStake || 0;
  });
  return used;
}

/* ------------------------------------------------------------------ */
/* 락 / 중복 요청 방지 / 공통 래퍼                                     */
/* ------------------------------------------------------------------ */

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) fail_('다른 저장이 진행 중입니다. 잠시 후 다시 시도하세요.');
  memoClear_();   // 락을 잡은 뒤에는 항상 최신 시트 상태에서 시작
  try { return fn(); } finally { lock.releaseLock(); }
}

/** 클라이언트 reqId 가 같으면 이전 결과를 그대로 반환(연타/재전송 중복 저장 방지) */
function writeApi_(payload, fn) {
  try {
    var reqId = payload && payload.reqId ? 'req_' + String(payload.reqId).slice(0, 60) : null;
    var cache = null;
    try { cache = reqId ? CacheService.getScriptCache() : null; } catch (e) { cache = null; }
    return withLock_(function () {
      if (cache) {
        var prev = null;
        try { prev = cache.get(reqId); } catch (e) { prev = null; }
        if (prev) { var p = JSON.parse(prev); p.duplicate = true; return p; }
      }
      var res = fn();
      res.ok = true;
      res.summary = buildStats_(monthOf_(todayStr_())).summary;
      res.todayBetUsed = betUsedOn_(todayStr_());
      if (cache) { try { cache.put(reqId, JSON.stringify(res), CONFIG.REQ_CACHE_SEC); } catch (e) { /* 캐시 실패는 무시(구매 상태 검사가 2차 방어) */ } }
      return res;
    });
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

function readApi_(fn) {
  memoClear_();
  try { var r = fn(); r.ok = true; return r; }
  catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; }
}

function monthOf_(dateStr) { return dateStr.slice(0, 7); }

function betUsedOn_(date) {
  var s = 0;
  readRows_(TABLES.BET).forEach(function (r) {
    if (
      r.buyStatus === '구매' &&
      r.buyAtStr &&
      r.buyAtStr.slice(0, 10) === date
    ) {
      s += r.buyStake || 0;
    }
  });
  return s;
}

/* ------------------------------------------------------------------ */
/* 저장 API                                                            */
/* ------------------------------------------------------------------ */

function saveBet_(p) {
  var rec = {
    date: dateField_(p.date, '베팅일'),
    sport: enumField_(p.sport, ENUM.SPORT, '종목'),
    league: textField_(p.league, '리그', CONFIG.MAX_TEXT, false),
    name: textField_(p.name, '경기/조합명', CONFIG.MAX_TEXT, true),
    pick: textField_(p.pick, '픽 내용', CONFIG.MAX_TEXT, false),
    folders: intField_(p.folders, '폴더수'),
    stake: stakeField_(p.stake),
    grade: enumField_(p.grade, ENUM.GRADE, '리치등급'),
    memo: textField_(p.memo, '메모', CONFIG.MAX_MEMO, false)
  };
  if (rec.folders < 1 || rec.folders > 50) fail_('폴더수는 1 이상이어야 합니다.');
  var odds = String(p.odds == null ? '' : p.odds).replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(odds) || Number(odds) < 1) fail_('총배당은 1.00 이상의 숫자로 입력하세요.');
  rec.odds = round2_(Number(odds));

  var bets = readRows_(TABLES.BET);
  rec.id = newId_(TABLES.BET, bets);
  rec.result = '대기';
  rec.ret = ''; rec.profit = ''; rec.roi = '';
  rec.createdAt = new Date();
  rec.buyStatus = '미확인'; rec.buyStake = ''; rec.buyAt = '';
  appendRow_(TABLES.BET, rec);
  return { id: rec.id, message: '추천 저장 완료 (' + fmtWon_(rec.stake) + ') · 구매 확인에서 처리하세요' };
}

/**
 * WDL 한 행(조합) 검증 + 레코드 생성. group 은 서버가 만든 {id, no} 만 받는다(외부 payload 에서 오지 않음).
 * 같은 회차 + 같은 조합구분 중복 금지는 같은 묶음(또는 둘 다 묶음 없음) 안에서만 적용된다.
 */
function buildWdlRec_(p, group, existing, pending) {
  var rec = {
    round: textField_(p.round, '회차', 20, true),
    date: dateField_(p.date, '구매일'),
    combo: group ? p.combo : enumField_(p.combo, ENUM.COMBO, '조합구분'),
    stake: stakeField_(p.stake),
    memo: textField_(p.memo, '메모', CONFIG.MAX_MEMO, false)
  };
  var games = Array.isArray(p.games) ? p.games : [];
  var missing = [];
  for (var i = 1; i <= 14; i++) {
    var gv = String(games[i - 1] == null ? '' : games[i - 1]).trim();
    if (ENUM.PICK.indexOf(gv) < 0) missing.push(i); else rec['g' + i] = gv;
  }
  if (missing.length === 14) fail_('1~14경기의 승/무/패를 모두 선택해주세요.');
  if (missing.length) fail_(missing.join(', ') + '경기의 승/무/패를 선택해주세요.');

  var gid = group ? group.id : '';
  existing.forEach(function (r) {
    if (r.round === rec.round && r.combo === rec.combo && (r.groupId || '') === gid) {
      fail_(rec.round + '회차에 "' + rec.combo + '" 조합이 이미 있습니다.');
    }
  });

  rec.id = newId_(TABLES.WDL, existing.concat(pending || []));
  rec.hits = ''; rec.rank = '대기'; rec.prize = ''; rec.profit = '';
  rec.createdAt = new Date();
  rec.buyStatus = '미확인'; rec.buyStake = ''; rec.buyAt = '';
  rec.groupId = gid; rec.comboNo = group ? group.no : '';
  return rec;
}

function saveWdl_(p) {
  var wdl = readRows_(TABLES.WDL);
  var rec = buildWdlRec_(p, null, wdl, []);
  appendRows_(TABLES.WDL, [rec]);
  return { id: rec.id, message: '추천 저장 완료 (' + rec.round + '회차 ' + rec.combo + ' ' + fmtWon_(rec.stake) + ') · 구매 확인에서 처리하세요' };
}

/** selections(14경기 × 복수 마킹) 정규화: 경기마다 승/무/패 1~3개, 승→무→패 순서로 중복 제거 */
function normalizeSelections_(sel) {
  if (!Array.isArray(sel) || sel.length !== 14) fail_('selections 는 14경기 배열이어야 합니다.');
  return sel.map(function (x, i) {
    var arr = Array.isArray(x) ? x : String(x == null ? '' : x).split(/[\/,\s]+/);
    arr = arr.map(function (v) { return String(v == null ? '' : v).trim(); }).filter(function (v) { return v !== ''; });
    if (!arr.length) fail_((i + 1) + '경기의 승/무/패를 선택해주세요.');
    arr.forEach(function (v) { if (ENUM.PICK.indexOf(v) < 0) fail_((i + 1) + '경기: 승/무/패만 선택할 수 있습니다.'); });
    return ENUM.PICK.filter(function (v) { return arr.indexOf(v) >= 0; });
  });
}

/** 데카르트 곱: 첫 경기가 가장 천천히 바뀐다. 조합 수는 expand 전에 WDL_MULTI_MAX 로 검사한다. */
function expandSelections_(sets) {
  var count = sets.reduce(function (n, set) { return n * set.length; }, 1);
  if (count > WDL_MULTI_MAX) fail_('조합 수는 최대 ' + WDL_MULTI_MAX + '개입니다 (현재 ' + count + '개).');
  var out = [[]];
  sets.forEach(function (set) {
    var next = [];
    out.forEach(function (prefix) { set.forEach(function (v) { next.push(prefix.concat([v])); }); });
    out = next;
  });
  return out;
}

/** WDL_LOG 조합구분(D열) 드롭다운이 주력/보조1/보조2 만 허용하면 조합1~조합N 쓰기가 거절된다 → 규칙에 비파괴로 추가 */
function wdlComboLabels_() {
  var out = [];
  for (var i = 1; i <= WDL_MULTI_MAX; i++) out.push('조합' + i);
  return out;
}

function comboRule_(sh) {
  var col = TABLES.WDL.cols.map(function (c) { return c[0]; }).indexOf('combo') + 1;
  var rule = sh.getRange(2, col).getDataValidation();
  if (!rule || rule.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) return null;
  return { col: col, rule: rule, list: (rule.getCriteriaValues()[0] || []).slice() };
}

function ensureWdlComboValidation_(sh) {
  var info = comboRule_(sh);
  if (!info) return false;
  var missing = wdlComboLabels_().filter(function (v) { return info.list.indexOf(v) < 0; });
  if (!missing.length) return false;
  sh.getRange(2, info.col, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(info.list.concat(missing), true).setAllowInvalid(info.rule.getAllowInvalid()).build());
  SpreadsheetApp.flush();
  return true;
}

function requireComboDropdown_() {
  var info = comboRule_(getSheet_(TABLES.WDL.name));
  if (!info || info.rule.getAllowInvalid()) return;
  var missing = wdlComboLabels_().filter(function (v) { return info.list.indexOf(v) < 0; });
  if (missing.length) fail_('WDL_LOG 조합구분 드롭다운 규칙에 ' + missing[0] + ' 등이 없어 저장할 수 없습니다. setupWdlGroupColumns() 를 먼저 실행하세요.');
}

function requireGroupColumns_() {
  var sh = getSheet_(TABLES.WDL.name), n = TABLES.WDL.cols.length;
  var ok = sh.getMaxColumns() >= n && String(sh.getRange(1, n - 1, 1, 2).getValues()[0][0]).trim() === TABLES.WDL.cols[n - 2][1] &&
    String(sh.getRange(1, n - 1, 1, 2).getValues()[0][1]).trim() === TABLES.WDL.cols[n - 1][1];
  if (!ok) fail_('WDL_LOG 에 구매묶음ID/조합순번 열이 없습니다. setupWdlGroupColumns() 를 먼저 실행하세요.');
}

function newGroupId_(rows) {
  var used = {};
  rows.forEach(function (r) { if (r.groupId) used[r.groupId] = true; });
  var id;
  do {
    id = 'WDLG-' + Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyyMMdd') + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
  } while (used[id]);
  return id;
}

/**
 * 승무패 복수마킹 묶음 저장: p = { round, date, selections[14], stakePerCombo, memo }
 * 서버가 실제 서로 다른 조합으로 확장해 조합당 한 행씩(조합1 ~ 조합N) 한 번에 저장한다. 모두 buyStatus='미확인'.
 */
function saveWdlMulti_(p) {
  requireGroupColumns_();
  requireComboDropdown_();   // 쓰기 전에 검증 규칙 호환 확인(거절되면 아무것도 쓰지 않음)
  var sets = normalizeSelections_(p.selections);
  var combos = expandSelections_(sets);
  var wdl = readRows_(TABLES.WDL);
  var gid = newGroupId_(wdl);
  var recs = [];
  combos.forEach(function (games, i) {
    recs.push(buildWdlRec_({ round: p.round, date: p.date, combo: '조합' + (i + 1), games: games, stake: p.stakePerCombo, memo: p.memo },
      { id: gid, no: i + 1 }, wdl, recs));
  });
  appendRows_(TABLES.WDL, recs);
  var total = recs.reduce(function (n, r) { return n + r.stake; }, 0);
  return { id: gid, groupId: gid, comboCount: recs.length, stakePerCombo: recs[0].stake, total: total, rowIds: recs.map(function (r) { return r.id; }),
    message: '추천 저장 완료 (' + recs[0].round + '회차 ' + recs.length + '조합 · 총 ' + fmtWon_(total) + ') · 구매 확인에서 처리하세요' };
}

/** 구매 확인: 샀다(구매) / 안 샀다(미구매). 한도는 실제 구매 기준으로 서버에서 다시 검증. */
function checkWdlRoundLimit_(settings, wdl, round, amount) {
  var roundUsed = 0;
  wdl.forEach(function (r) { if (r.buyStatus === '구매' && r.round === round) roundUsed += r.buyStake || 0; });
  if (roundUsed + amount > settings.wdlRound) {
    fail_('회차 최대 ' + fmtWon_(settings.wdlRound) + ' 초과: ' + round + '회차 구매 ' + fmtWon_(roundUsed) + ' + 신규 ' +
      fmtWon_(amount) + ' = ' + fmtWon_(roundUsed + amount));
  }
}

function checkMonthLimit_(settings, bets, wdl, month, amount) {
  var used = monthUsage_(month, bets, wdl);
  if (used + amount > settings.budget) {
    fail_('월 예산 ' + fmtWon_(settings.budget) + ' 초과: ' + month + ' 구매 ' + fmtWon_(used) + ' + 신규 ' + fmtWon_(amount) +
      ' = ' + fmtWon_(used + amount));
  }
}

/**
 * 승무패 묶음 구매/미구매: 그룹 전체를 한 번에 처리한다(부분 구매 없음).
 * 1) 전체 상태·한도 사전검사 → 2) 모두 통과할 때만 3) 모든 행을 같은 시각으로 한 번에 기록
 */
function purchaseWdlGroup_(p) {
  var buy = p.buy === true || p.buy === 'true';
  var settings = getSettings_();
  var bets = readRows_(TABLES.BET);
  var wdl = readRows_(TABLES.WDL);
  var gid = String(p.id == null ? '' : p.id).trim();
  var rows = gid ? wdl.filter(function (r) { return r.groupId === gid; }) : [];
  if (!rows.length) fail_('기록을 찾을 수 없습니다.');
  var done = rows.filter(function (r) { return r.buyStatus !== '미확인'; })[0];
  if (done) fail_('이미 처리된 기록입니다 (' + done.buyStatus + ').');

  var now = new Date();
  var purchaseDate = Utilities.formatDate(now, CONFIG.TZ, 'yyyy-MM-dd');
  var total = rows.reduce(function (n, r) { return n + r.stake; }, 0);
  var label = rows[0].round + '회차 ' + rows.length + '조합';
  var keys = ['buyStatus', 'buyStake', 'buyAt'];
  if (buy) {
    checkWdlRoundLimit_(settings, wdl, rows[0].round, total);
    checkMonthLimit_(settings, bets, wdl, purchaseDate.slice(0, 7), total);
    updateCellsBulk_(TABLES.WDL, keys, rows.map(function (r) { return { row: r._row, o: { buyStatus: '구매', buyStake: r.stake, buyAt: now } }; }));
    return { id: gid, groupId: gid, buyStatus: '구매', comboCount: rows.length, total: total, message: '구매 처리 완료 (' + label + ' · ' + fmtWon_(total) + ')' };
  }
  updateCellsBulk_(TABLES.WDL, keys, rows.map(function (r) { return { row: r._row, o: { buyStatus: '미구매', buyStake: '', buyAt: now } }; }));
  return { id: gid, groupId: gid, buyStatus: '미구매', comboCount: rows.length, total: total, message: '미구매로 기록했습니다 (' + label + ')' };
}

function purchaseRecord_(p) {
  if (p && p.kind === 'wdl_group') return purchaseWdlGroup_(p);
  var tbl = p.kind === 'wdl' ? TABLES.WDL : p.kind === 'bet' ? TABLES.BET : null;
  if (!tbl) fail_('구분이 올바르지 않습니다.');
  var buy = p.buy === true || p.buy === 'true';
  var settings = getSettings_();
  var bets = readRows_(TABLES.BET);
  var wdl = readRows_(TABLES.WDL);
  var rec = (tbl === TABLES.BET ? bets : wdl).filter(function (r) { return r.id === String(p.id); })[0];
  if (!rec) fail_('기록을 찾을 수 없습니다.');
  if (rec.buyStatus !== '미확인') fail_('이미 처리된 기록입니다 (' + rec.buyStatus + ').');

  var now = new Date();
  var purchaseDate = Utilities.formatDate(now, CONFIG.TZ, 'yyyy-MM-dd');
  if (buy) {
    var amount = rec.stake;
    if (tbl === TABLES.BET) {
      var dayUsed = 0;
      bets.forEach(function (r) {
        if (
          r.buyStatus === '구매' &&
          r.buyAtStr &&
          r.buyAtStr.slice(0, 10) === purchaseDate
        ) {
          dayUsed += r.buyStake || 0;
        }
      });
      if (dayUsed + amount > settings.daily) {
        fail_('일 최대 ' + fmtWon_(settings.daily) + ' 초과: 해당일 구매 ' + fmtWon_(dayUsed) + ' + 신규 ' + fmtWon_(amount) +
          ' = ' + fmtWon_(dayUsed + amount));
      }
    } else {
      checkWdlRoundLimit_(settings, wdl, rec.round, amount);
    }
    checkMonthLimit_(settings, bets, wdl, purchaseDate.slice(0, 7), amount);
    updateCells_(tbl, rec._row, ['buyStatus', 'buyStake', 'buyAt'], { buyStatus: '구매', buyStake: amount, buyAt: now });
    return { id: rec.id, buyStatus: '구매', message: '구매 처리 완료 (' + fmtWon_(amount) + ')' };
  }
  updateCells_(tbl, rec._row, ['buyStatus', 'buyStake', 'buyAt'], { buyStatus: '미구매', buyStake: '', buyAt: now });
  return { id: rec.id, buyStatus: '미구매', message: '미구매로 기록했습니다' };
}

/** 손익 계산 기준 금액: 구매 건은 실제베팅금액, 그 외(추천 분석용)는 추천 베팅금액 */
function baseStake_(rec) { return rec.buyStatus === '구매' && rec.buyStake ? rec.buyStake : rec.stake; }

function resolveBet_(p) {
  var result = enumField_(p.result, ENUM.BET_RESOLVE, '결과');
  var rows = readRows_(TABLES.BET);
  var rec = rows.filter(function (r) { return r.id === String(p.id); })[0];
  if (!rec) fail_('기록을 찾을 수 없습니다.');
  if (rec.buyStatus === '미확인') {
    fail_('먼저 구매 확인에서 샀다/안 샀다를 처리해주세요.');
  }
  if (rec.result !== '대기') fail_('이미 결과가 처리된 기록입니다.');
  var blank = String(p.ret == null ? '' : p.ret).trim() === '';
  var ret;
  if (result === '미적중') ret = 0;
  else if (result === '취소' && blank) ret = baseStake_(rec);   // 취소 기본 반환금 = 실제 베팅금액
  else {
    ret = intField_(p.ret, '반환금');
    if (ret < 0) fail_('반환금은 0 이상이어야 합니다.');
    if (result === '적중' && ret <= 0) fail_('적중은 반환금(원금 포함)을 입력해야 합니다.');
    if (result === '적특' && ret <= 0) fail_('적특은 실제 반환받은 금액을 입력해주세요.');
  }
  rec.result = result;
  rec.ret = ret;
  var base = baseStake_(rec);
  rec.profit = calcProfit_(base, ret);
  rec.roi = calcRoi_(base, rec.profit);
  updateRow_(TABLES.BET, rec._row, rec);
  return { id: rec.id, profit: rec.profit, roi: rec.roi, message: '결과 저장 완료' };
}

function parseWdlResult_(p) {
  var hits = intField_(p.hits, '적중개수');
  if (hits < 0 || hits > 14) fail_('적중개수는 0~14 사이여야 합니다.');
  var rank = enumField_(p.rank, ENUM.RANK_RESOLVE, '등수');
  var prize = intField_(p.prize, '당첨금');
  if (prize < 0) fail_('당첨금은 0 이상이어야 합니다.');
  if (rank === '미당첨') prize = 0;
  else if (prize <= 0) fail_(rank + '은(는) 당첨금을 입력해야 합니다.');
  return { hits: hits, rank: rank, prize: prize };
}

function resolveWdl_(p) {
  var parsed = parseWdlResult_(p), hits = parsed.hits, rank = parsed.rank, prize = parsed.prize;
  var rows = readRows_(TABLES.WDL);
  var rec = rows.filter(function (r) { return r.id === String(p.id); })[0];
  if (!rec) fail_('기록을 찾을 수 없습니다.');
  if (rec.buyStatus === '미확인') {
    fail_('먼저 구매 확인에서 샀다/안 샀다를 처리해주세요.');
  }
  if (rec.rank !== '대기') fail_('이미 결과가 처리된 기록입니다.');
  rec.hits = hits;
  rec.rank = rank;
  rec.prize = prize;
  rec.profit = calcProfit_(baseStake_(rec), prize);
  updateRow_(TABLES.WDL, rec._row, rec);
  return { id: rec.id, profit: rec.profit, message: '결과 저장 완료' };
}

/* ------------------------------------------------------------------ */
/* 집계 (대시보드/월간 성적 공통)                                      */
/* 확정(결과 처리 완료) 건만 반환금/손익/ROI 에 반영, 대기 건은 사용액에만 포함 */
/* ------------------------------------------------------------------ */

function aggBets_(rows) {
  var g = { count: rows.length, stake: 0, settledStake: 0, pendingStake: 0, ret: 0, hit: 0, miss: 0 };
  rows.forEach(function (r) {
    g.stake += r.buyStake;
    if (r.result === '대기') { g.pendingStake += r.buyStake; return; }
    g.settledStake += r.buyStake;
    g.ret += r.ret || 0;
    if (r.result === '적중') g.hit++;
    if (r.result === '미적중') g.miss++;
  });
  g.profit = calcProfit_(g.settledStake, g.ret);
  g.roi = calcRoi_(g.settledStake, g.profit);
  g.hitRate = calcRate_(g.hit, g.miss);
  return g;
}

function aggWdl_(rows) {
  var rounds = {};
  var g = { rounds: 0, stake: 0, settledStake: 0, pendingStake: 0, prize: 0, bestHits: null, bestRank: null };
  var bestIdx = null;
  rows.forEach(function (r) {
    rounds[r.round] = true;
    g.stake += r.buyStake;
    if (r.rank === '대기') { g.pendingStake += r.buyStake; return; }
    g.settledStake += r.buyStake;
    g.prize += r.prize || 0;
    if (r.hits != null && (g.bestHits === null || r.hits > g.bestHits)) g.bestHits = r.hits;
    var idx = ENUM.RANK_RESOLVE.indexOf(r.rank);
    if (idx >= 0 && (bestIdx === null || idx < bestIdx)) bestIdx = idx;
  });
  g.rounds = Object.keys(rounds).length;
  g.bestRank = bestIdx === null ? null : ENUM.RANK_RESOLVE[bestIdx];
  g.profit = calcProfit_(g.settledStake, g.prize);
  g.roi = calcRoi_(g.settledStake, g.profit);
  return g;
}

function buildStats_(month) {
  var settings = getSettings_();
  // 실제 구매(구매여부=구매)만 집계, 월은 구매일시 기준. 미확인/미구매 추천은 제외.
  function boughtIn(r) { return r.buyStatus === '구매' && r.buyAtStr.slice(0, 7) === month; }
  var bets = readRows_(TABLES.BET).filter(boughtIn);
  var wdl = readRows_(TABLES.WDL).filter(boughtIn);

  var bt = aggBets_(bets);
  var wt = aggWdl_(wdl);

  var used = bt.stake + wt.stake;
  var settledStake = bt.settledStake + wt.settledStake;
  var totalReturn = bt.ret + wt.prize;
  var profit = calcProfit_(settledStake, totalReturn);

  function group(list) { return aggBets_(list); }
  var bySport = ENUM.SPORT.map(function (s) {
    var g = group(bets.filter(function (r) { return r.sport === s; })); g.label = s; return g;
  });
  var byFolder = [['1폴더', function (f) { return f === 1; }], ['2폴더', function (f) { return f === 2; }],
    ['3폴더', function (f) { return f === 3; }], ['4폴더 이상', function (f) { return f >= 4; }]].map(function (d) {
    var g = group(bets.filter(function (r) { return d[1](r.folders); })); g.label = d[0]; return g;
  });
  var byGrade = ['메인', '대박'].map(function (s) {
    var g = group(bets.filter(function (r) { return r.grade === s; })); g.label = s; return g;
  });

  // 승무패 묶음 요약: 묶음 없는 기존 행은 행 하나가 곧 하나의 묶음
  var gmap = {}, gorder = [];
  wdl.forEach(function (r) {
    var k = r.groupId || r.id;
    if (!gmap[k]) { gmap[k] = { groupId: r.groupId || '', key: k, round: r.round, date: r.date, comboCount: 0, stake: 0, settled: 0, bestHits: null, winners: 0, prize: 0 }; gorder.push(k); }
    var g = gmap[k];
    g.comboCount++; g.stake += r.buyStake;
    if (r.rank !== '대기') {
      g.settled++; g.prize += r.prize || 0;
      if (r.hits != null && (g.bestHits === null || r.hits > g.bestHits)) g.bestHits = r.hits;
      if (r.rank !== '미당첨') g.winners++;
    }
  });
  var wdlGroups = gorder.map(function (k) { return gmap[k]; }).sort(function (a, b) { return a.round < b.round ? 1 : a.round > b.round ? -1 : 0; });

  var recent = bets.map(function (r) {
    return { kind: '일반', date: r.date, title: r.name, stake: r.buyStake, status: r.result,
      profit: r.result === '대기' ? null : r.profit, createdAt: r.buyAtStr, id: r.id };
  }).concat(wdl.map(function (r) {
    return { kind: '승무패', date: r.date, title: r.round + '회차 ' + r.combo, stake: r.buyStake, status: r.rank,
      profit: r.rank === '대기' ? null : r.profit, createdAt: r.buyAtStr, id: r.id };
  })).sort(function (a, b) {
    return a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : (a.createdAt < b.createdAt ? 1 : -1);
  }).slice(0, 10);

  return {
    month: month,
    settings: settings,
    summary: {
      budget: settings.budget,
      used: used,
      totalStake: used,   // 총 베팅액 = 사용액 (대기/취소 포함, 반환금과 무관)
      betUsed: bt.stake,
      wdlUsed: wt.stake,
      remain: settings.budget - used,
      totalReturn: totalReturn,
      settledStake: settledStake,
      pendingStake: bt.pendingStake + wt.pendingStake,
      profit: profit,                       // 확정 손익 (확정 건만)
      roi: calcRoi_(settledStake, profit),  // 확정 ROI = 확정 손익 / 확정 베팅액 (대기 제외)
      hitRate: bt.hitRate
    },
    bySport: bySport,
    byFolder: byFolder,
    byGrade: byGrade,
    wdl: wt,
    wdlGroups: wdlGroups,
    recent: recent
  };
}

/* ------------------------------------------------------------------ */
/* 웹앱 API (google.script.run)                                        */
/* ------------------------------------------------------------------ */

function apiBootstrap() {
  return readApi_(function () {
    var today = todayStr_();
    var st = buildStats_(monthOf_(today));
    return { today: today, month: st.month, settings: st.settings, summary: st.summary,
      todayBetUsed: betUsedOn_(today), enums: ENUM };
  });
}

function apiSaveBet(payload) { return writeApi_(payload, function () { return saveBet_(payload); }); }
function apiSaveWdl(payload) { return writeApi_(payload, function () { return saveWdl_(payload); }); }
function apiResolveBet(payload) { return writeApi_(payload, function () { return resolveBet_(payload); }); }
function apiPurchase(payload) { return writeApi_(payload, function () { return purchaseRecord_(payload); }); }
function apiResolveWdl(payload) { return writeApi_(payload, function () { return resolveWdl_(payload); }); }

/** 화면 상단 카드용: 현재 월 + 요약 (별도 호출 없이 각 읽기 API 응답에 포함) */
function viewMeta_() {
  var m = monthOf_(todayStr_());
  return { month: m, summary: buildStats_(m).summary };
}

function wdlOrder_(a, b) {
  return a.round === b.round ? ((a.combo || '') < (b.combo || '') ? -1 : 1) : (a.round < b.round ? 1 : -1);
}

/** 묶음의 경기별 복수 마킹(승/무/패 집합) 복원 */
function selectionsOf_(rows) {
  var out = [];
  for (var i = 1; i <= 14; i++) {
    var set = {};
    rows.forEach(function (r) { set[r['g' + i]] = true; });
    out.push(ENUM.PICK.filter(function (v) { return set[v]; }));
  }
  return out;
}

function groupWdlRows_(rows) {
  var singles = [], groups = {}, order = [];
  rows.forEach(function (r) {
    if (r.groupId) { if (!groups[r.groupId]) { groups[r.groupId] = []; order.push(r.groupId); } groups[r.groupId].push(r); }
    else singles.push(r);
  });
  return { singles: singles, groups: order.map(function (g) { return groups[g]; }) };
}

function apiGetPending() {
  return readApi_(function () {
    var bets = readRows_(TABLES.BET).filter(function (r) {
      return r.result === '대기' && r.buyStatus !== '미확인';
    })
      .map(function (r) { return { id: r.id, date: r.date, sport: r.sport, name: r.name, pick: r.pick, odds: r.odds, stake: r.stake, grade: r.grade, buy: r.buyStatus }; });
    var g = groupWdlRows_(readRows_(TABLES.WDL).filter(function (r) {
      return r.rank === '대기' && r.buyStatus !== '미확인';
    }));
    var wdl = g.singles.map(function (r) { return { id: r.id, round: r.round, date: r.date, combo: r.combo, stake: r.stake, buy: r.buyStatus }; })
      .concat(g.groups.map(function (rows) {
        return { kind: 'wdl_group', groupId: rows[0].groupId, id: rows[0].groupId, round: rows[0].round, date: rows[0].date, combo: '', buy: rows[0].buyStatus,
          comboCount: rows.length, stake: rows.reduce(function (n, r) { return n + r.stake; }, 0),
          combos: rows.map(function (r) { return { id: r.id, no: r.comboNo, label: r.combo, stake: r.stake }; }) };
      }));
    bets.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    wdl.sort(wdlOrder_);
    return { bets: bets, wdl: wdl, meta: viewMeta_() };
  });
}

/** 구매 확인 대기(구매여부=미확인) 목록. 승무패 복수마킹 묶음은 카드 한 장으로 묶어서 돌려준다. */
function apiGetUnconfirmed() {
  return readApi_(function () {
    var bets = readRows_(TABLES.BET).filter(function (r) { return r.buyStatus === '미확인'; })
      .map(function (r) { return { id: r.id, date: r.date, sport: r.sport, league: r.league, name: r.name, pick: r.pick, stake: r.stake, odds: r.odds, grade: r.grade }; });
    var g = groupWdlRows_(readRows_(TABLES.WDL).filter(function (r) { return r.buyStatus === '미확인'; }));
    var wdl = g.singles.map(function (r) {
      var picks = ''; for (var i = 1; i <= 14; i++) picks += r['g' + i];
      return { id: r.id, round: r.round, date: r.date, combo: r.combo, stake: r.stake, picks: picks };
    }).concat(g.groups.map(function (rows) {
      var sels = selectionsOf_(rows);
      return { kind: 'wdl_group', groupId: rows[0].groupId, id: rows[0].groupId, round: rows[0].round, date: rows[0].date, combo: '',
        comboCount: rows.length, stake: rows.reduce(function (n, r) { return n + r.stake; }, 0), stakePerCombo: rows[0].stake,
        selections: sels, multi: sels.map(function (x, i) { return x.length > 1 ? { game: i + 1, picks: x } : null; }).filter(Boolean) };
    }));
    bets.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    wdl.sort(wdlOrder_);
    return { bets: bets, wdl: wdl, meta: viewMeta_() };
  });
}

function apiGetMonthly(month) {
  return readApi_(function () {
    var m = String(month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(m)) m = monthOf_(todayStr_());
    return buildStats_(m);
  });
}

/* ------------------------------------------------------------------ */
/* 리치 자동저장 진입점 (내부 API 계층)                                */
/*  - 최종 저장은 기존 saveBet_ / saveWdl_ 에 위임 (검증·미확인 상태 규칙 동일) */
/*  - 중복 방지: requestId → 저장된 행 ID 를 Script Properties 에 영구 기록   */
/*  - 인증: Script Property 'RICH_API_TOKEN' 이 설정돼 있으면 payload.token 필수 */
/*    (값은 코드에 없음. doGet/doPost 로 공개하지 않음 — google.script.run 전용)  */
/* ------------------------------------------------------------------ */

var RICH = {
  // 명확히 지원하는 alias 만 정규화(그 외 잘못된 값은 saveBet_ 검증 오류 그대로)
  SPORT_ALIAS: { '혼합': '기타' },
  TOKEN_PROP: 'RICH_API_TOKEN',
  REQ_PREFIX: 'RICHREQ_',
  MAX_BATCH: 20,
  MAX_KEYS: 1000,
  PRUNE_COUNT: 200
};

function richAuth_(payload) {
  var token = PropertiesService.getScriptProperties().getProperty(RICH.TOKEN_PROP);
  if (token && (!payload || String(payload.token || '') !== token)) fail_('인증에 실패했습니다.');
}

function richRequestId_(v, label) {
  var s = String(v == null ? '' : v).trim();
  if (!/^[A-Za-z0-9._:#-]{8,80}$/.test(s)) fail_(label + ': 8~80자의 영문/숫자/._:#- 만 사용할 수 있습니다.');
  return s;
}

function richTable_(type) {
  if (type === 'BET' || type === 'BET_RESULT') return TABLES.BET;
  if (type === 'WDL' || type === 'WDL_RESULT' || type === 'WDL_MULTI' || type === 'WDL_MULTI_RESULT') return TABLES.WDL;
  fail_('type 은 BET, WDL 또는 WDL_MULTI 이어야 합니다.');
}

/** 이미 처리된 requestId 면 기존 행 ID 반환. 행이 삭제됐다면 처리되지 않은 것으로 본다. */
function richLookup_(key, type) {
  var raw = PropertiesService.getScriptProperties().getProperty(RICH.REQ_PREFIX + key);
  if (!raw) return null;
  var rec;
  try { rec = JSON.parse(raw); } catch (e) { return null; }
  if (rec.t !== type) fail_('requestId "' + key + '" 는 다른 유형(' + rec.t + ')으로 이미 사용되었습니다.');
  var isGroup = type.indexOf('WDL_MULTI') === 0;
  if (type === 'WDL_MULTI' && rec.n) {   // 완전 저장 여부 판별: 기록된 조합 수와 시트의 행 수가 같아야 '이미 처리됨'
    var have = readRows_(TABLES.WDL).filter(function (r) { return r.groupId === rec.id; }).length;
    if (have === 0) return null;
    if (have !== rec.n) fail_('이전 요청의 저장 상태가 불완전합니다 (기록 ' + rec.n + '행 / 시트 ' + have + '행). 확인이 필요합니다.');
    return rec;
  }
  var exists = readRows_(richTable_(type)).some(function (r) { return isGroup ? r.groupId === rec.id : r.id === rec.id; });
  return exists ? rec : null;
}

function richRemember_(key, type, id, count) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(RICH.REQ_PREFIX + key, JSON.stringify({ t: type, id: id, n: count || 0, at: Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd HH:mm:ss') }));
  var all = props.getProperties();
  var keys = Object.keys(all).filter(function (k) { return k.indexOf(RICH.REQ_PREFIX) === 0; });
  if (keys.length > RICH.MAX_KEYS) {
    keys.sort(function (a, b) {
      var x = '', y = '';
      try { x = JSON.parse(all[a]).at; } catch (e) { x = ''; }
      try { y = JSON.parse(all[b]).at; } catch (e) { y = ''; }
      return x < y ? -1 : x > y ? 1 : 0;
    });
    keys.slice(0, RICH.PRUNE_COUNT).forEach(function (k) { props.deleteProperty(k); });
  }
}

/** 한 건 저장(락 안에서 호출). 기존 저장 함수에 위임하고 requestId 를 기록한다. */
function richSaveOne_(pick, key) {
  var type = String(pick && pick.type != null ? pick.type : '').trim().toUpperCase();
  richTable_(type);
  var prior = richLookup_(key, type);
  if (prior) {
    var dup = { requestId: key, type: type, id: prior.id, duplicate: true, message: '이미 저장된 요청입니다.' };
    if (type === 'WDL_MULTI') {
      dup.groupId = prior.id;
      dup.comboCount = readRows_(TABLES.WDL).filter(function (r) { return r.groupId === prior.id; }).length;
    }
    return dup;
  }
  if (type === 'BET') {
    var alias = RICH.SPORT_ALIAS[String(pick.sport == null ? '' : pick.sport).trim()];
    if (alias) { pick = Object.assign({}, pick); pick.sport = alias; }   // 예: 혼합 → 기타
  }
  var res = type === 'BET' ? saveBet_(pick) : type === 'WDL_MULTI' ? saveWdlMulti_(pick) : saveWdl_(pick);   // buyStatus='미확인' 으로 저장됨
  richRemember_(key, type, res.id, type === 'WDL_MULTI' ? res.comboCount : 0);   // 전체 저장이 끝난 뒤에만 성공 기록
  var out = { requestId: key, type: type, id: res.id, duplicate: false, message: res.message };
  if (type === 'WDL_MULTI') { out.groupId = res.groupId; out.comboCount = res.comboCount; out.total = res.total; }
  return out;
}

function richErr_(e) { return String(e && e.message ? e.message : e); }

/** 내부 저장(인증/락 없음 — 호출자가 책임): requestId 검증 후 richSaveOne_ 에 위임. apiSaveRichPick 과 Inbox 처리기가 공유. */
function saveRichPickInternal_(payload) {
  var key = richRequestId_(payload && payload.requestId, 'requestId');
  return richSaveOne_(payload, key);
}

/** 단건: { requestId, type:'BET'|'WDL', token?, ...saveBet_/saveWdl_ 필드 } */
function apiSaveRichPick(payload) {
  try {
    richAuth_(payload);
    richRequestId_(payload && payload.requestId, 'requestId');
    return withLock_(function () {
      var r = saveRichPickInternal_(payload);
      r.ok = true;
      return r;
    });
  } catch (e) {
    return { ok: false, error: richErr_(e) };
  }
}

/** 여러 건: { requestId, token?, picks:[{type, ...}] } — 건별 성공/실패 반환 */
function apiSaveRichPicks(payload) {
  try {
    richAuth_(payload);
    var batchId = richRequestId_(payload && payload.requestId, 'requestId');
    var picks = payload && payload.picks;
    if (!Array.isArray(picks) || !picks.length) fail_('picks 는 1건 이상의 배열이어야 합니다.');
    if (picks.length > RICH.MAX_BATCH) fail_('한 번에 최대 ' + RICH.MAX_BATCH + '건까지 저장할 수 있습니다.');
    return withLock_(function () {
      var saved = [], failed = [];
      picks.forEach(function (pick, i) {
        var key = null;
        try {
          key = richRequestId_(pick && pick.requestId != null ? pick.requestId : batchId + '#' + (i + 1), 'requestId');
          var r = richSaveOne_(pick, key);
          r.index = i + 1;
          saved.push(r);
        } catch (e) {
          failed.push({ index: i + 1, requestId: key, type: String(pick && pick.type != null ? pick.type : ''), error: richErr_(e) });
        }
      });
      var res = { requestId: batchId, saved: saved, failed: failed,
        savedCount: saved.length, failedCount: failed.length };
      res.ok = failed.length === 0 || saved.length > 0;   // 전부 실패한 경우에만 false
      if (!res.ok) res.error = '저장된 픽이 없습니다.';
      return res;
    });
  } catch (e) {
    return { ok: false, error: richErr_(e) };
  }
}

/* ------------------------------------------------------------------ */
/* RESULT 명령: ChatGPT 가 확인한 경기 결과를 기존 결과 처리 로직으로 반영        */
/*  - 손익/ROI/당첨금 계산은 resolveBet_/resolveWdl_ 한 곳(웹앱 수동 처리와 공용)   */
/*  - 외부 결과를 추측/크롤링하지 않는다. source/checkedAt 은 Inbox payloadJson 에만 남는다 */
/* ------------------------------------------------------------------ */

function sameNumberOrBlank_(given, actual, label) {
  if (given == null || String(given).trim() === '') return;
  if (intField_(given, label) !== actual) fail_('이미 같은 결과로 처리되었지만 ' + label + ' 값이 다릅니다.');
}

/**
 * payload: { requestId, action:'RESULT', targetType:'BET'|'WDL', targetId, ...결과 필드, checkedAt?, source? }
 *  BET: result(적중/미적중/적특/취소), ret(반환금: 적중·적특 필수, 취소 생략 시 실제베팅금액, 미적중 0)
 *  WDL: hits(0~14), rank(1등~4등/미당첨), prize(당첨금)
 * 구매(buyStatus='구매') 건만 처리. 같은 requestId 재전송 / 같은 결과 재전송은 멱등 성공, 상충 결과는 오류.
 */
function resolveRichResultInternal_(payload) {
  var key = richRequestId_(payload && payload.requestId, 'requestId');
  var type = String(payload.targetType == null ? '' : payload.targetType).trim().toUpperCase();
  if (type === 'WDL_MULTI') return resolveRichGroupResult_(payload, key);
  if (type !== 'BET' && type !== 'WDL') fail_('targetType 은 BET, WDL 또는 WDL_MULTI 이어야 합니다.');
  var rtype = type + '_RESULT';
  var prior = richLookup_(key, rtype);
  if (prior) return { requestId: key, type: rtype, id: prior.id, duplicate: true, message: '이미 처리된 결과 요청입니다.' };

  var targetId = String(payload.targetId == null ? '' : payload.targetId).trim();
  if (!targetId) fail_('targetId 가 필요합니다.');
  var rec = readRows_(richTable_(type)).filter(function (r) { return r.id === targetId; })[0];
  if (!rec) fail_('대상 ID를 찾을 수 없습니다.');
  if (rec.buyStatus !== '구매') fail_('구매하지 않은 베팅은 결과 처리할 수 없습니다.');

  var duplicate = false, out = null;
  if (type === 'BET') {
    var result = enumField_(payload.result, ENUM.BET_RESOLVE, '결과');
    if (rec.result !== '대기') {
      if (rec.result !== result) fail_('이미 다른 결과로 처리된 베팅입니다.');
      if (result !== '미적중') sameNumberOrBlank_(payload.ret, rec.ret, '반환금');
      duplicate = true;
      out = { profit: rec.profit, roi: rec.roi };
    } else {
      if ((result === '적중' || result === '적특') && (payload.ret == null || String(payload.ret).trim() === '')) {
        fail_(result + '은(는) 실제 반환금(원금 포함)을 ret 에 넣어야 합니다.');   // 안내용 사전 검사. 계산은 resolveBet_ 가 수행
      }
      out = resolveBet_({ id: targetId, result: result, ret: payload.ret });   // 기존 결과 처리(손익/ROI 계산) 그대로
    }
  } else {
    var rank = enumField_(payload.rank, ENUM.RANK_RESOLVE, '등수');
    if (rec.rank !== '대기') {
      if (rec.rank !== rank) fail_('이미 다른 결과로 처리된 베팅입니다.');
      sameNumberOrBlank_(payload.hits, rec.hits, '적중개수');
      if (rank !== '미당첨') sameNumberOrBlank_(payload.prize, rec.prize, '당첨금');
      duplicate = true;
      out = { profit: rec.profit };
    } else {
      var blankPrize = payload.prize == null || String(payload.prize).trim() === '';
      // 웹앱 결과 처리 화면과 같은 기본값: 미당첨은 당첨금 생략 시 0원
      out = resolveWdl_({ id: targetId, hits: payload.hits, rank: rank, prize: (blankPrize && rank === '미당첨') ? '0' : payload.prize });
    }
  }
  richRemember_(key, rtype, targetId);
  return { requestId: key, type: rtype, id: targetId, duplicate: duplicate, profit: out.profit, roi: out.roi,
    message: duplicate ? '이미 같은 결과로 처리된 베팅입니다.' : '결과 저장 완료' };
}

/**
 * 승무패 묶음 RESULT: { targetType:'WDL_MULTI', targetId:groupId, combos:[{comboNo, hits, rank, prize}] }
 * 조합마다 독립적으로 기존 resolveWdl_ 를 호출한다(결과를 합치지 않음). 한 건이라도 구매 전/상충/검증 오류면 아무것도 쓰지 않는다.
 */
function resolveRichGroupResult_(payload, key) {
  var rtype = 'WDL_MULTI_RESULT';
  var prior = richLookup_(key, rtype);
  if (prior) return { requestId: key, type: rtype, id: prior.id, duplicate: true, message: '이미 처리된 결과 요청입니다.' };
  var gid = String(payload.targetId == null ? '' : payload.targetId).trim();
  var rows = gid ? readRows_(TABLES.WDL).filter(function (r) { return r.groupId === gid; }) : [];
  if (!rows.length) fail_('대상 ID를 찾을 수 없습니다.');
  if (rows.some(function (r) { return r.buyStatus !== '구매'; })) fail_('구매하지 않은 베팅은 결과 처리할 수 없습니다.');
  var list = payload.combos;
  if (!Array.isArray(list) || !list.length) fail_('combos 는 조합별 결과 배열이어야 합니다.');
  var byNo = {};
  rows.forEach(function (r) { byNo[r.comboNo] = r; });
  var seen = {}, plan = [];
  list.forEach(function (c) {
    var no = intField_(c && c.comboNo, 'comboNo');
    var row = byNo[no];
    if (!row) fail_('조합순번 ' + no + ' 이(가) 이 묶음에 없습니다.');
    if (seen[no]) fail_('조합순번 ' + no + ' 이(가) 중복되었습니다.');
    seen[no] = true;
    var blankPrize = c.prize == null || String(c.prize).trim() === '';
    var parsed = parseWdlResult_({ hits: c.hits, rank: c.rank, prize: (blankPrize && String(c.rank).trim() === '미당첨') ? '0' : c.prize });
    if (row.rank !== '대기') {
      if (row.rank !== parsed.rank || row.hits !== parsed.hits || row.prize !== parsed.prize) fail_('조합' + no + ': 이미 다른 결과로 처리된 베팅입니다.');
      return;   // 같은 결과로 이미 처리됨 → 건너뜀
    }
    plan.push({ id: row.id, hits: parsed.hits, rank: parsed.rank, prize: parsed.prize });
  });
  var missing = rows.filter(function (r) { return r.rank === '대기' && !seen[r.comboNo]; }).map(function (r) { return r.comboNo; });
  if (missing.length) fail_('모든 조합의 결과가 필요합니다. 누락된 조합순번: ' + missing.join(', '));
  plan.forEach(function (it) { resolveWdl_(it); });   // 검증이 모두 끝난 뒤에만 기록
  richRemember_(key, rtype, gid);
  return { requestId: key, type: rtype, id: gid, duplicate: plan.length === 0, applied: plan.length, comboCount: rows.length,
    message: plan.length ? '결과 저장 완료 (' + plan.length + '조합)' : '이미 같은 결과로 처리된 묶음입니다.' };
}

/* ------------------------------------------------------------------ */
/* Rich Bridge: RICH_INBOX (시트 큐) → 시간 트리거 → 기존 저장 엔진          */
/*  - 공개 엔드포인트(doPost/웹훅) 없음. 시트가 큐, Apps Script 내부 트리거가 처리 */
/*  - ChatGPT 는 RICH_INBOX 에 행만 추가. BET_LOG/WDL_LOG 에는 직접 쓰지 않음      */
/*  - 토큰은 Inbox/시트에 저장하지 않음(내부 처리는 인증 없이 saveRichPickInternal_ 호출) */
/* ------------------------------------------------------------------ */

var INBOX = {
  name: 'RICH_INBOX',
  headers: ['requestId', 'createdAt', 'payloadJson', 'status', 'processedAt', 'resultId', 'resultType', 'error'],
  STATUS: ['PENDING', 'PROCESSING', 'DONE', 'ERROR'],
  MAX_PER_RUN: 20,
  STALE_MIN: 10,
  TRIGGER_FN: 'processRichInbox',   // 트리거 핸들러(공개 함수). 내부 로직은 processRichInbox_
  TRIGGER_MIN: 1
};

function nowKstStr_() { return Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd HH:mm:ss'); }

function inboxHeaderProblems_(sh) {
  var out = [];
  var width = Math.max(sh.getLastColumn(), INBOX.headers.length);
  var cur = sh.getLastRow() === 0 ? [] : sh.getRange(1, 1, 1, width).getValues()[0];
  INBOX.headers.forEach(function (h, i) {
    if (String(cur[i] === undefined ? '' : cur[i]).trim() !== h) {
      out.push(INBOX.name + ' ' + (i + 1) + '열 헤더: 기대 "' + h + '", 실제 "' + (cur[i] === undefined ? '' : cur[i]) + '"');
    }
  });
  var seen = {};
  cur.forEach(function (h, i) {
    var k = String(h).trim();
    if (!k) return;
    if (seen[k]) out.push(INBOX.name + ' 중복 헤더 "' + k + '" (' + seen[k] + '열, ' + (i + 1) + '열)');
    else seen[k] = i + 1;
  });
  return out;
}

function inboxTriggers_() {
  return ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === INBOX.TRIGGER_FN && t.getEventType() === ScriptApp.EventType.CLOCK;
  });
}

/** RICH_INBOX 생성/검증 + 1분 주기 트리거 설치. 여러 번 실행해도 트리거는 1개만 유지. */
function setupRichBridge() {
  var ss = getSS_();
  var sh = ss.getSheetByName(INBOX.name);
  var created = false;
  if (!sh) { sh = ss.insertSheet(INBOX.name); created = true; }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, INBOX.headers.length).setValues([INBOX.headers]);
  } else {
    var problems = inboxHeaderProblems_(sh);
    if (problems.length) throw new Error(INBOX.name + ' 헤더가 예상과 다릅니다. 기존 데이터 보호를 위해 중단합니다.\n- ' + problems.join('\n- '));
  }
  sh.getRange(1, 1, 1, INBOX.headers.length).setFontWeight('bold').setBackground('#e8eaed');
  // 모든 열을 텍스트 서식으로: payloadJson/error 등이 수식으로 해석되지 않도록
  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), INBOX.headers.length).setNumberFormat('@');
  try {
    sh.getRange(2, 4, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(INBOX.STATUS, true).setAllowInvalid(false).build());
  } catch (e) { /* 검증 규칙 실패는 동작에 영향 없음 */ }
  try {
    if (!sh.isSheetHidden()) {
      var other = ss.getSheetByName(TABLES.BET.name);
      if (other) ss.setActiveSheet(other);   // 활성 시트는 숨길 수 없음
      sh.hideSheet();
    }
  } catch (e) { /* 숨김 실패는 무시 */ }

  var trg = inboxTriggers_();
  for (var i = 1; i < trg.length; i++) ScriptApp.deleteTrigger(trg[i]);   // 중복 트리거 정리
  var made = false;
  if (!trg.length) {
    ScriptApp.newTrigger(INBOX.TRIGGER_FN).timeBased().everyMinutes(INBOX.TRIGGER_MIN).create();
    made = true;
  }
  var msg = 'Rich Bridge 설치 완료: ' + INBOX.name + (created ? ' 생성' : ' 확인') + ', 트리거 ' + (made ? '생성' : '이미 있음') +
    (trg.length > 1 ? ' (중복 ' + (trg.length - 1) + '개 제거)' : '');
  Logger.log(msg);
  return msg;
}

/** 트리거 제거(필요 시 수동 실행) */
function removeRichBridgeTrigger() {
  var trg = inboxTriggers_();
  trg.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  return '트리거 ' + trg.length + '개 제거';
}

/** 행의 D~H(status, processedAt, resultId, resultType, error)를 텍스트 서식 + 문자열로 기록 */
function inboxWrite_(sh, rowNum, c) {
  var rng = sh.getRange(rowNum, 4, 1, 5);
  rng.setNumberFormat('@');
  rng.setValues([[String(c.status), String(c.processedAt || ''), String(c.resultId || ''), String(c.resultType || ''),
    String(c.error || '').slice(0, 500)]]);
  SpreadsheetApp.flush();   // Inbox 상태 기록은 즉시 확정(앞선 쓰기 실패에 휩쓸려 버려지지 않게)
}

/** 처리 시작/생성 시각 기준 경과 분. 시각을 알 수 없으면 오래된 것으로 본다. */
function inboxAgeMin_(startedAt, createdAt) {
  var s = String(startedAt || '').trim() || String(createdAt || '').trim();
  if (!s) return Infinity;
  try {
    return (new Date().getTime() - Utilities.parseDate(s.slice(0, 19), CONFIG.TZ, 'yyyy-MM-dd HH:mm:ss').getTime()) / 60000;
  } catch (e) { return Infinity; }
}

/**
 * RICH_INBOX 의 PENDING(및 10분 이상 방치된 PROCESSING) 행을 최대 20건 처리한다.
 * 행 하나의 실패가 다른 행 처리를 막지 않는다. ERROR/DONE 행은 건드리지 않는다.
 */
function processRichInbox_() {
  var sh = getSheet_(INBOX.name);
  return withLock_(function () {
    var out = { ok: true, processed: 0, done: 0, duplicate: 0, error: 0, recovered: 0, writeFailed: 0 };
    var last = sh.getLastRow();
    if (last < 2) return out;
    var rng = sh.getRange(2, 1, last - 1, INBOX.headers.length);
    var vals = rng.getValues();
    var formulas = rng.getFormulas();
    for (var i = 0; i < vals.length && out.processed < INBOX.MAX_PER_RUN; i++) {
      var row = vals[i];
      var status = String(row[3]).trim();
      if (status === 'PROCESSING') {
        if (inboxAgeMin_(row[4], toDateTimeStr_(row[1])) < INBOX.STALE_MIN) continue;   // 최근 처리 중 → 건드리지 않음
        out.recovered++;
      } else if (status !== 'PENDING') {
        continue;
      }
      var rowNum = i + 2;
      out.processed++;
      // 처리 시작 표시: PROCESSING 동안 processedAt 에는 '처리 시작 시각'이 들어간다
      inboxWrite_(sh, rowNum, { status: 'PROCESSING', processedAt: nowKstStr_() });
      var res = null;
      try {
        if (String(formulas[i][0] || '') !== '' || String(formulas[i][2] || '') !== '') {
          fail_('requestId/payloadJson 셀이 수식입니다. 텍스트로 입력하세요.');
        }
        var raw = String(row[2] == null ? '' : row[2]).trim();
        if (!raw) fail_('payloadJson 이 비어 있습니다.');
        var payload;
        try { payload = JSON.parse(raw); } catch (e) { fail_('payloadJson 이 올바른 JSON 이 아닙니다.'); }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail_('payloadJson 은 JSON 객체여야 합니다.');
        var colId = String(row[0] == null ? '' : row[0]).trim();
        var jsonId = payload.requestId == null ? '' : String(payload.requestId).trim();
        if (colId && jsonId && colId !== jsonId) fail_('requestId 열과 payloadJson 의 requestId 가 다릅니다.');
        payload.requestId = colId || jsonId;
        var action = String(payload.action == null || payload.action === '' ? 'SAVE' : payload.action).trim().toUpperCase();
        if (action === 'RESULT') res = resolveRichResultInternal_(payload);   // 기존 결과 처리 로직(resolveBet_/resolveWdl_)에 위임
        else if (action === 'SAVE') res = saveRichPickInternal_(payload);     // 기존 저장 엔진(saveBet_/saveWdl_)에 위임 + requestId 멱등성
        else fail_('action 은 SAVE 또는 RESULT 여야 합니다.');
      } catch (e) {
        out.error++;
        var errState = { status: 'ERROR', processedAt: nowKstStr_(), error: richErr_(e) };
        try { inboxWrite_(sh, rowNum, errState); }
        catch (e2) {   // 앞선 실패가 쓰기 큐를 망가뜨렸을 수 있으므로 한 번 더 시도 — PROCESSING 으로 방치하지 않는다
          try { inboxWrite_(sh, rowNum, errState); } catch (e3) { out.writeFailed++; }
        }
        continue;
      }
      // 저장 성공(또는 이미 저장된 requestId). DONE 기록이 실패하면 PROCESSING 으로 남고, 10분 후 재처리 시 duplicate 로 복구된다.
      try {
        inboxWrite_(sh, rowNum, { status: 'DONE', processedAt: nowKstStr_(), resultId: res.id, resultType: res.type });
        out.done++;
        if (res.duplicate) out.duplicate++;
      } catch (e3) { out.writeFailed++; }
    }
    return out;
  });
}

/**
 * 배포 직후 1회 실환경 셀프테스트(선택): 배포 스크립트가 `--selftest` 로 만든 Rev.gs 에 CODE_SELFTEST = true 가 있을 때만 동작.
 * 실제 운영과 같은 경로(RICH_INBOX 행 추가 → processRichInbox_ → WDL_MULTI 저장)로 테스트 회차 `SELFTEST-<rev>` 를 8조합 저장하고
 * 행 수/30열 완전 기록/groupId/조합순번/PROCESSING 정체 없음을 확인, 묶음 '안 샀다'까지 확인한 뒤
 * 테스트 행(WDL_LOG, RICH_INBOX)과 멱등 기록을 전부 지운다. 결과는 한 줄 문자열로 돌려준다(점검 행에 기록).
 */
function selfTest_(rev) {
  var props = PropertiesService.getScriptProperties();
  var go = withLock_(function () {
    if (props.getProperty('SELFTEST_REV') === rev) return false;
    props.setProperty('SELFTEST_REV', rev);
    return true;
  });
  if (!go) return '';
  var tag = 'SELFTEST-' + rev, reqId = 'selftest-' + rev + '-wdl-multi', problems = [], info = {};
  var inbox = getSS_().getSheetByName(INBOX.name);
  if (!inbox) return 'SELFTEST 생략: RICH_INBOX 없음';
  try {
    var sel = [['승'], ['승', '무'], ['패'], ['승'], ['승'], ['승'], ['승'], ['무', '패'], ['승', '무'], ['패'], ['승'], ['패'], ['패'], ['승']];
    withLock_(function () {
      var r = inbox.getLastRow() + 1, now = nowKstStr_();
      var rng = inbox.getRange(r, 1, 1, INBOX.headers.length);
      rng.setNumberFormat('@');
      rng.setValues([[reqId, now, JSON.stringify({ requestId: reqId, type: 'WDL_MULTI', round: tag, date: todayStr_(), selections: sel, stakePerCombo: 1000, memo: 'SELFTEST 자동 삭제' }),
        'PENDING', '', '', '', '']]);
      SpreadsheetApp.flush();
    });
    processRichInbox_();   // 실제 처리 경로(락 포함)
    withLock_(function () {
      memoClear_();
      var vals = inbox.getLastRow() < 2 ? [] : inbox.getRange(2, 1, inbox.getLastRow() - 1, INBOX.headers.length).getValues();
      var row = vals.filter(function (v) { return String(v[0]) === reqId; })[0];
      if (!row) { problems.push('Inbox 행 없음'); return; }
      if (String(row[3]) !== 'DONE' || String(row[6]) !== 'WDL_MULTI') problems.push('Inbox 상태=' + row[3] + '/' + row[6] + ' ' + String(row[7]).slice(0, 120));
      var rows = readRows_(TABLES.WDL).filter(function (r) { return r.round === tag; });
      info.rows = rows.length;
      if (rows.length !== 8) problems.push('WDL 행 ' + rows.length + '개(기대 8)');
      var gids = {}; rows.forEach(function (r) { gids[r.groupId] = true; });
      if (Object.keys(gids).length !== 1 || String(row[5]) !== rows[0].groupId) problems.push('groupId 불일치');
      var nos = rows.map(function (r) { return r.comboNo; }).join();
      if (nos !== '1,2,3,4,5,6,7,8') problems.push('조합순번=' + nos);
      var sh = getSheet_(TABLES.WDL.name), keys = TABLES.WDL.cols.map(function (c) { return c[0]; });
      var raw = rows.length ? sh.getRange(rows[0]._row, 1, rows.length, TABLES.WDL.cols.length).getValues() : [];
      var required = keys.filter(function (k) { return ['hits', 'prize', 'profit', 'buyStake', 'buyAt'].indexOf(k) < 0 && k !== 'memo'; });
      raw.forEach(function (rv, i) {
        if (rv.length !== 30) problems.push('열 개수 ' + rv.length);
        required.forEach(function (k) { if (rv[keys.indexOf(k)] === '' || rv[keys.indexOf(k)] == null) problems.push((i + 1) + '번째 행 ' + k + ' 비어 있음'); });
      });
      if (rows.some(function (r) { return r.stake !== 1000 || r.buyStatus !== '미확인'; })) problems.push('stake/buyStatus 불일치');
      var distinct = {}; rows.forEach(function (r) { var g = ''; for (var i = 1; i <= 14; i++) g += r['g' + i]; distinct[g] = true; });
      if (Object.keys(distinct).length !== 8) problems.push('서로 다른 조합 ' + Object.keys(distinct).length + '개');
      if (!problems.length) {   // 묶음 '안 샀다'(예산 영향 없음) — 대량 갱신 경로 확인
        purchaseWdlGroup_({ id: rows[0].groupId, buy: false });
        var after = readRows_(TABLES.WDL).filter(function (r) { return r.round === tag; });
        if (after.some(function (r) { return r.buyStatus !== '미구매' || r.buyAt === ''; })) problems.push('묶음 미구매 처리 불일치');
      }
    });
  } catch (e) {
    problems.push('예외: ' + richErr_(e).slice(0, 160));
  } finally {
    try {
      withLock_(function () {   // 정리: 테스트 행 전부 제거 + 멱등 기록 삭제
        var sh = getSheet_(TABLES.WDL.name);
        var last = sh.getLastRow();
        if (last >= 2) {
          var col = sh.getRange(2, 2, last - 1, 1).getValues();
          col.forEach(function (v, i) { if (String(v[0]) === tag) sh.getRange(i + 2, 1, 1, sh.getMaxColumns()).clearContent(); });
        }
        var il = inbox.getLastRow();
        if (il >= 2) {
          inbox.getRange(2, 1, il - 1, 1).getValues().forEach(function (v, i) { if (String(v[0]) === reqId) inbox.getRange(i + 2, 1, 1, inbox.getMaxColumns()).clearContent(); });
        }
        SpreadsheetApp.flush();
        props.deleteProperty(RICH.REQ_PREFIX + reqId);
        memoClear_();
      });
    } catch (e2) { problems.push('정리 실패: ' + richErr_(e2).slice(0, 120)); }
  }
  return problems.length ? 'SELFTEST FAIL: ' + problems.join('; ').slice(0, 300) : 'SELFTEST OK (WDL_MULTI ' + info.rows + '행 저장·검증·미구매·정리 완료)';
}

/**
 * 배포 스크립트가 `--seed-inbox=<json>` 으로 만든 Rev.gs 의 CODE_SEED_INBOX([{payload, purchase}] 배열)를 처리한다.
 * payload 는 Rich 가 보내는 것과 같은 요청이며 RICH_INBOX 에 PENDING 으로 넣어 processRichInbox_ 가 처리한다(저장은 WDL_MULTI 원자 저장).
 * purchase:true 이고 저장이 DONE 이면 그 묶음 전체를 기존 wdl_group 구매 로직(purchaseRecord_)으로 한 번에 구매 확정한다.
 * 같은 requestId 가 이미 Inbox 에 있으면 다시 넣지 않는다(ERROR/DONE 포함 → 재사용 금지). 구매는 아직 '미확인'인 묶음에만 시도한다.
 */
function seedInbox_() {
  if (typeof CODE_SEED_INBOX === 'undefined' || !CODE_SEED_INBOX || !CODE_SEED_INBOX.length) return '';
  var inbox = getSS_().getSheetByName(INBOX.name);
  if (!inbox) return 'seed 생략: RICH_INBOX 없음';
  var msgs = [];
  CODE_SEED_INBOX.forEach(function (item) {
    var p = item && item.payload, id = String(p && p.requestId || '');
    if (!id) return;
    try {
      withLock_(function () {
        var last = inbox.getLastRow(), exists = false;
        if (last >= 2) inbox.getRange(2, 1, last - 1, 1).getValues().forEach(function (v) { if (String(v[0]) === id) exists = true; });
        if (exists) return;
        var now = nowKstStr_(), rng = inbox.getRange(last + 1, 1, 1, INBOX.headers.length);
        rng.setNumberFormat('@');
        rng.setValues([[id, now, JSON.stringify(p), 'PENDING', '', '', '', '']]);
        SpreadsheetApp.flush();
        msgs.push('seed ' + id);
      });
      processRichInbox_();
      if (!item.purchase) return;
      withLock_(function () {
        memoClear_();
        var last = inbox.getLastRow();
        var row = last < 2 ? null : inbox.getRange(2, 1, last - 1, INBOX.headers.length).getValues().filter(function (v) { return String(v[0]) === id; })[0];
        if (!row || String(row[3]) !== 'DONE' || String(row[6]) !== 'WDL_MULTI') { msgs.push('구매 보류(Inbox ' + (row ? row[3] : '없음') + ')'); return; }
        var gid = String(row[5]);
        var rows = readRows_(TABLES.WDL).filter(function (r) { return r.groupId === gid; });
        if (!rows.length || rows.some(function (r) { return r.buyStatus !== '미확인'; })) { msgs.push('구매 생략(이미 처리/없음)'); return; }
        var res = purchaseRecord_({ kind: 'wdl_group', id: gid, buy: true });
        msgs.push('구매 확정 ' + res.comboCount + '조합 ' + res.total + '원');
      });
    } catch (e) { msgs.push('seed 실패 ' + id + ': ' + richErr_(e).slice(0, 120)); }
  });
  return msgs.join(' / ');
}

/**
 * 배포 직후 1회 자동 점검(시간 트리거가 실행): 배포 스크립트가 만든 Rev.gs 의 CODE_REV 가 이전과 다를 때만 동작한다.
 *  1) WDL_LOG 묶음 열(구매묶음ID/조합순번) + 조합구분 드롭다운(조합1~N)을 비파괴로 보강  2) (선택) 실환경 셀프테스트
 *  3) diagnoseSetup() 실행  4) 결과를 RICH_INBOX 감사 행 1줄로 남김(requestId=system-deploy-<rev>, resultType=POST_DEPLOY_CHECK, error 열=점검 메시지)
 * CODE_REV 가 없으면(수동 붙여넣기 등) 아무것도 하지 않는다.
 */
function postDeployCheck_() {
  var rev = (typeof CODE_REV !== 'undefined') ? String(CODE_REV) : '';
  if (!rev) return null;
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('MAINT_REV') === rev) return null;
  var steps = [];
  withLock_(function () {
    try { steps.push(setupWdlGroupColumns()); } catch (e) { steps.push('setupWdlGroupColumns 실패: ' + richErr_(e)); }
  });
  var selftest = (typeof CODE_SELFTEST !== 'undefined' && CODE_SELFTEST) ? selfTest_(rev) : '';
  var seeded = seedInbox_();
  if (seeded) selftest = (selftest ? selftest + ' | ' : '') + seeded;
  return withLock_(function () {
    if (props.getProperty('MAINT_REV') === rev) return null;
    var diag = diagnoseSetup();
    var inbox = getSS_().getSheetByName(INBOX.name);
    if (inbox) {
      var now = nowKstStr_(), rng = inbox.getRange(inbox.getLastRow() + 1, 1, 1, INBOX.headers.length);
      rng.setNumberFormat('@');
      rng.setValues([['system-deploy-' + rev, now, JSON.stringify({ system: 'post-deploy-check', rev: rev, steps: steps }), 'DONE', now, rev, 'POST_DEPLOY_CHECK',
        String(selftest ? diag + ' | ' + selftest : diag).slice(0, 500)]]);
      SpreadsheetApp.flush();
    }
    props.setProperty('MAINT_REV', rev);
    memoClear_();
    return selftest ? diag + ' | ' + selftest : diag;
  });
}

/** 시간 트리거 핸들러 (트리거는 공개 함수만 호출 가능) */
function processRichInbox() {
  try { postDeployCheck_(); } catch (e) { Logger.log('배포 후 점검 실패: ' + richErr_(e)); }
  try {
    var r = processRichInbox_();
    if (r.processed) Logger.log('RICH_INBOX 처리: ' + JSON.stringify(r));
    return r;
  } catch (e) {
    Logger.log('RICH_INBOX 처리 실패: ' + richErr_(e));
    return { ok: false, error: richErr_(e) };
  }
}

/* ------------------------------------------------------------------ */
/* 진단 (읽기 전용: 시트/데이터/속성을 생성·수정·삭제하지 않음)        */
/* ------------------------------------------------------------------ */

function diagnoseSetup() {
  var problems = [];
  var ss = null;
  try {
    ss = openSpreadsheet_();
  } catch (e) { problems.push('스프레드시트를 열 수 없습니다: ' + e.message); }
  if (!ss) problems.push('스프레드시트를 찾을 수 없습니다. 시트에 연결된 스크립트인지 확인하세요.');
  else {
    function checkHeaders(name, expected) {
      var sh = ss.getSheetByName(name);
      if (!sh) { problems.push('시트 "' + name + '"가 없습니다.'); return null; }
      var width = Math.min(Math.max(sh.getLastColumn(), expected.length), sh.getMaxColumns());
      var cur = sh.getLastRow() === 0 ? [] : sh.getRange(1, 1, 1, width).getValues()[0];
      var core = name === TABLES.WDL.name ? coreCount_(TABLES.WDL) : expected.length;
      expected.forEach(function (h, i) {
        if (String(cur[i] === undefined ? '' : cur[i]).trim() !== h) {
          problems.push(name + ' ' + (i + 1) + '열 헤더: 기대 "' + h + '", 실제 "' + (cur[i] === undefined ? '' : cur[i]) + '"' +
            (i >= core ? ' (setupWdlGroupColumns 실행)' : ''));
        }
      });
      var seen = {};
      cur.forEach(function (h, i) {
        var k = String(h).trim();
        if (!k) return;
        if (seen[k]) problems.push(name + ' 중복 헤더 "' + k + '" (' + seen[k] + '열, ' + (i + 1) + '열)');
        else seen[k] = i + 1;
      });
      return sh;
    }
    checkHeaders(TABLES.BET.name, headersOf_(TABLES.BET));
    checkHeaders(TABLES.WDL.name, headersOf_(TABLES.WDL));
    if (!ss.getSheetByName(DASH_SHEET_NAME)) problems.push('시트 "' + DASH_SHEET_NAME + '"가 없습니다.');
    var set = checkHeaders(SETTINGS_SHEET.name, SETTINGS_SHEET.headers);
    if (set) {
      var last = set.getLastRow();
      var rows = last >= 2 ? set.getRange(2, 1, last - 1, 2).getValues() : [];
      var count = {};
      rows.forEach(function (r) { var k = String(r[0]).trim(); if (k) count[k] = (count[k] || 0) + 1; });
      Object.keys(SETTING_KEYS).forEach(function (k) {
        var key = SETTING_KEYS[k];
        if (!count[key]) { problems.push('SETTINGS에 "' + key + '" 항목이 없습니다.'); return; }
        if (count[key] > 1) problems.push('SETTINGS "' + key + '" 항목이 ' + count[key] + '번 중복되어 있습니다.');
        var r = rows.filter(function (x) { return String(x[0]).trim() === key; })[0];
        var n = Number(String(r[1]).replace(/,/g, '').trim());
        if (String(r[1]).trim() === '' || !isFinite(n) || n <= 0) problems.push('SETTINGS "' + key + '" 값이 올바르지 않습니다: "' + r[1] + '" (양수 필요)');
      });
    }
  }
  // Rich Bridge: 설치된 경우(시트 또는 트리거 존재)에만 검사. 미설치면 기존 문구를 유지하고 로그로만 안내한다.
  var bridge = 'none';
  if (ss) {
    var inbox = ss.getSheetByName(INBOX.name);
    var trg = [];
    try { trg = inboxTriggers_(); } catch (e) { trg = []; }
    if (inbox || trg.length) {
      bridge = 'ok';
      if (!inbox) { problems.push('시트 "' + INBOX.name + '"가 없습니다. (setupRichBridge 실행)'); bridge = 'bad'; }
      else {
        var hp = inboxHeaderProblems_(inbox);
        if (hp.length) { hp.forEach(function (x) { problems.push(x); }); bridge = 'bad'; }
      }
      if (!trg.length) { problems.push('트리거 "' + INBOX.TRIGGER_FN + '"가 없습니다. (setupRichBridge 실행)'); bridge = 'bad'; }
      if (trg.length > 1) { problems.push('트리거 "' + INBOX.TRIGGER_FN + '"가 ' + trg.length + '개 중복되어 있습니다. (setupRichBridge 실행 시 정리)'); bridge = 'bad'; }
    }
  }
  var msg = problems.length ? '문제 ' + problems.length + '건:\n- ' + problems.join('\n- ')
    : '리치 베팅 장부 V1 환경 정상' + (bridge === 'ok' ? ' / Rich Bridge 정상' : '');
  Logger.log(msg);
  if (bridge === 'none') Logger.log('참고: Rich Bridge 미설치 (설치하려면 setupRichBridge 실행)');
  return msg;
}
