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
        ['buyStatus', '구매여부'], ['buyStake', '실제베팅금액'], ['buyAt', '구매일시']
      ]),
    textKeys: ['id', 'round', 'date'],
    dtKeys: ['createdAt', 'buyAt'],
    plainKeys: ['id', 'round'],
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

function ensureTable_(ss, tbl) {
  var sh = ss.getSheetByName(tbl.name) || ss.insertSheet(tbl.name);
  var headers = headersOf_(tbl);
  var existed = sh.getLastRow() > 0;
  if (!existed) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    var cur = sh.getRange(1, 1, 1, headers.length).getValues()[0];
    for (var i = 0; i < headers.length; i++) {
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
  ensureTable_(ss, TABLES.WDL);
  if (!ss.getSheetByName(DASH_SHEET_NAME)) ss.insertSheet(DASH_SHEET_NAME);
  ensureSettings_(ss);
  ['Sheet1', '시트1'].forEach(function (n) {
    var d = ss.getSheetByName(n);
    if (d && d.getLastRow() === 0 && ss.getSheets().length > 4) ss.deleteSheet(d);
  });
  return '설정 완료';
}

function getSettings_() {
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
  return {
    budget: read(SETTING_KEYS.BUDGET),
    daily: read(SETTING_KEYS.DAILY),
    wdlRound: read(SETTING_KEYS.WDL_ROUND)
  };
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
  tbl.moneyKeys.concat(['folders', 'odds', 'hits', 'roi']).forEach(function (k) {
    if (k in o) o[k] = numOrNull_(o[k]);
  });
  tbl.dtKeys.forEach(function (k) { o[k + 'Str'] = toDateTimeStr_(o[k]); });
  o.buyStatus = String(o.buyStatus == null ? '' : o.buyStatus).trim() || '미확인';   // 빈값 = 미확인
  if (tbl.roiKey && o[tbl.roiKey] !== null && o[tbl.roiKey] !== undefined) o[tbl.roiKey] = round2_(o[tbl.roiKey] * 100);
  return o;
}

function readRows_(tbl) {
  var sh = getSheet_(tbl.name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, tbl.cols.length).getValues();
  var out = [];
  vals.forEach(function (v, i) {
    if (String(v[0]) === '') return;
    var o = { _row: i + 2 };
    tbl.cols.forEach(function (c, j) { o[c[0]] = v[j]; });
    out.push(normalizeRow_(tbl, o));
  });
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

/** 날짜/일시/ROI 셀의 표시 서식 (값은 Date / 비율 숫자) */
function formatRowCells_(sh, tbl, rowNum) {
  tbl.cols.forEach(function (c, i) {
    var k = c[0];
    if (k === 'date') sh.getRange(rowNum, i + 1).setNumberFormat('yyyy-mm-dd');
    else if (tbl.dtKeys.indexOf(k) >= 0) sh.getRange(rowNum, i + 1).setNumberFormat('yyyy-mm-dd hh:mm');
    else if (k === tbl.roiKey) sh.getRange(rowNum, i + 1).setNumberFormat('0.0%');
  });
}

function appendRow_(tbl, o) {
  var sh = getSheet_(tbl.name);
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, tbl.cols.length).setValues([rowToArray_(tbl, o)]);
  formatRowCells_(sh, tbl, r);
}

/** 연속된 열(keys 순서가 시트 열 순서와 같아야 함)만 갱신 */
function updateCells_(tbl, rowNum, keys, o) {
  var idx = keys.map(function (k) { return tbl.cols.map(function (c) { return c[0]; }).indexOf(k); });
  idx.forEach(function (v, i) { if (v < 0 || v !== idx[0] + i) fail_('내부 오류: 열 순서'); });
  var sh = getSheet_(tbl.name);
  sh.getRange(rowNum, idx[0] + 1, 1, keys.length)
    .setValues([keys.map(function (k) { return o[k] == null ? '' : o[k]; })]);
  formatRowCells_(sh, tbl, rowNum);
}

function updateRow_(tbl, rowNum, o) {
  var sh = getSheet_(tbl.name);
  sh.getRange(rowNum, 1, 1, tbl.cols.length).setValues([rowToArray_(tbl, o)]);
  formatRowCells_(sh, tbl, rowNum);
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
  if (list.indexOf(s) < 0) fail_(label + ': 허용되지 않은 값입니다.');
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

function saveWdl_(p) {
  var rec = {
    round: textField_(p.round, '회차', 20, true),
    date: dateField_(p.date, '구매일'),
    combo: enumField_(p.combo, ENUM.COMBO, '조합구분'),
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

  var wdl = readRows_(TABLES.WDL);
  wdl.forEach(function (r) {
    if (r.round === rec.round && r.combo === rec.combo) fail_(rec.round + '회차에 "' + rec.combo + '" 조합이 이미 있습니다.');
  });

  rec.id = newId_(TABLES.WDL, wdl);
  rec.hits = ''; rec.rank = '대기'; rec.prize = ''; rec.profit = '';
  rec.createdAt = new Date();
  rec.buyStatus = '미확인'; rec.buyStake = ''; rec.buyAt = '';
  appendRow_(TABLES.WDL, rec);
  return { id: rec.id, message: '추천 저장 완료 (' + rec.round + '회차 ' + rec.combo + ' ' + fmtWon_(rec.stake) + ') · 구매 확인에서 처리하세요' };
}

/** 구매 확인: 샀다(구매) / 안 샀다(미구매). 한도는 실제 구매 기준으로 서버에서 다시 검증. */
function purchaseRecord_(p) {
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
      var roundUsed = 0;
      wdl.forEach(function (r) { if (r.buyStatus === '구매' && r.round === rec.round) roundUsed += r.buyStake || 0; });
      if (roundUsed + amount > settings.wdlRound) {
        fail_('회차 최대 ' + fmtWon_(settings.wdlRound) + ' 초과: ' + rec.round + '회차 구매 ' + fmtWon_(roundUsed) + ' + 신규 ' +
          fmtWon_(amount) + ' = ' + fmtWon_(roundUsed + amount));
      }
    }
    var month = purchaseDate.slice(0, 7);
    var used = monthUsage_(month, bets, wdl);
    if (used + amount > settings.budget) {
      fail_('월 예산 ' + fmtWon_(settings.budget) + ' 초과: ' + month + ' 구매 ' + fmtWon_(used) + ' + 신규 ' + fmtWon_(amount) +
        ' = ' + fmtWon_(used + amount));
    }
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

function resolveWdl_(p) {
  var hits = intField_(p.hits, '적중개수');
  if (hits < 0 || hits > 14) fail_('적중개수는 0~14 사이여야 합니다.');
  var rank = enumField_(p.rank, ENUM.RANK_RESOLVE, '등수');
  var prize = intField_(p.prize, '당첨금');
  if (prize < 0) fail_('당첨금은 0 이상이어야 합니다.');
  if (rank === '미당첨') prize = 0;
  else if (prize <= 0) fail_(rank + '은(는) 당첨금을 입력해야 합니다.');
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

function apiGetPending() {
  return readApi_(function () {
    var bets = readRows_(TABLES.BET).filter(function (r) {
      return r.result === '대기' && r.buyStatus !== '미확인';
    })
      .map(function (r) { return { id: r.id, date: r.date, sport: r.sport, name: r.name, pick: r.pick, odds: r.odds, stake: r.stake, grade: r.grade, buy: r.buyStatus }; });
    var wdl = readRows_(TABLES.WDL).filter(function (r) {
      return r.rank === '대기' && r.buyStatus !== '미확인';
    })
      .map(function (r) { return { id: r.id, round: r.round, date: r.date, combo: r.combo, stake: r.stake, buy: r.buyStatus }; });
    bets.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    wdl.sort(function (a, b) { return a.round === b.round ? (a.combo < b.combo ? -1 : 1) : (a.round < b.round ? 1 : -1); });
    return { bets: bets, wdl: wdl };
  });
}

/** 구매 확인 대기(구매여부=미확인) 목록 */
function apiGetUnconfirmed() {
  return readApi_(function () {
    var bets = readRows_(TABLES.BET).filter(function (r) { return r.buyStatus === '미확인'; })
      .map(function (r) { return { id: r.id, date: r.date, sport: r.sport, league: r.league, name: r.name, pick: r.pick, stake: r.stake, odds: r.odds, grade: r.grade }; });
    var wdl = readRows_(TABLES.WDL).filter(function (r) { return r.buyStatus === '미확인'; })
      .map(function (r) {
        var picks = ''; for (var i = 1; i <= 14; i++) picks += r['g' + i];
        return { id: r.id, round: r.round, date: r.date, combo: r.combo, stake: r.stake, picks: picks };
      });
    bets.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    wdl.sort(function (a, b) { return a.round === b.round ? (a.combo < b.combo ? -1 : 1) : (a.round < b.round ? 1 : -1); });
    return { bets: bets, wdl: wdl };
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
      var width = Math.max(sh.getLastColumn(), expected.length);
      var cur = sh.getLastRow() === 0 ? [] : sh.getRange(1, 1, 1, width).getValues()[0];
      expected.forEach(function (h, i) {
        if (String(cur[i] === undefined ? '' : cur[i]).trim() !== h) {
          problems.push(name + ' ' + (i + 1) + '열 헤더: 기대 "' + h + '", 실제 "' + (cur[i] === undefined ? '' : cur[i]) + '"');
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
  var msg = problems.length ? '문제 ' + problems.length + '건:\n- ' + problems.join('\n- ') : '리치 베팅 장부 V1 환경 정상';
  Logger.log(msg);
  return msg;
}
