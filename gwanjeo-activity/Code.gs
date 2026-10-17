/**
 * 관저중로점 AI 외부활동 — 서버 (Google Apps Script, 소유자 권한 실행)
 *
 * Script Properties (프로젝트 설정 > 스크립트 속성)
 *   SHEET_ID        운영용 구글시트 ID
 *   STAFF_PASSWORD  직원 공용 비밀번호
 *
 * 공개 진입점은 doGet 하나뿐이다. 데이터 함수는 모두 세션 토큰을 검증한다.
 */
var TZ = 'Asia/Seoul';
var STAFF = ['전명석', '박영빈', '김소명', '유병규'];
var STORE = { name: '관저중로점', address: '대전 서구 관저중로 98' };
var QR_PROMO_URL = 'https://naver.me/Fm2I607T';
var QR_REGULAR_URL = 'https://su.kt.co.kr/SlRIQr5';
var SESSION_TTL = 6 * 3600;        // CacheService 최대 6시간
var MAX_FAILS = 5;
var LOCK_SECONDS = 300;
var QR_DEDUPE_SECONDS = 5;
var GLOBAL_FAIL_SOFT = 30;

var SHEETS = {
  apt: { name: '아파트DB', head: ['ID', '아파트명', '주소', '총세대수', '전체동수', '동목록', '아파트형식', '공동현관', '메모', '최근활동일', '누적활동동수', '사용여부'] },
  act: { name: '활동기록', head: ['활동ID', '활동일', '담당자', '아파트ID', '아파트명', '완료동', '활동동수', '아파트형식', '공동현관', '활동메모', '등록일시'] },
  qr: { name: 'QR접속기록', head: ['접속ID', '접속일', '접속시간', 'QR구분', '기록일시'] }
};
var TYPES = ['복도형', '계단형', '혼합형', '미확인'];
var ENTRY = ['미확인', '비밀번호 있음', '비밀번호 없음'];

// ───────── 진입점 ─────────
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.qr === 'promo') return qrPromo_();
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('관저중로점 AI 외부활동')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

// QR① 공개 경로: 접속 1건 기록 후 이동. 어떤 데이터도 읽거나 반환하지 않는다.
function qrPromo_() {
  try { recordQr_(); } catch (err) { console.error('qr log failed: ' + err); }
  var u = QR_PROMO_URL;
  var html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<body style="font-family:sans-serif;text-align:center;padding:40px 16px">' +
    '<p>이동 중입니다…</p><p><a id="go" href="' + u + '" target="_top" style="font-size:18px">바로 이동하기</a></p>' +
    '<script>try{window.top.location.replace(' + JSON.stringify(u) + ')}catch(e){}</script></body>';
  return HtmlService.createHtmlOutput(html).setTitle('이동 중');
}

function recordQr_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('QRD')) return false;      // 중복 집계 방지(짧은 시간 내 재접속)
  cache.put('QRD', '1', QR_DEDUPE_SECONDS);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var now = new Date();
    sheet_('qr').appendRow([
      'QR-' + Utilities.formatDate(now, TZ, 'yyyyMMddHHmmssSSS') + '-' + Utilities.getUuid().slice(0, 5).toUpperCase(),
      now, now, '홍보QR', now
    ]);
  } finally { lock.releaseLock(); }
  return true;
}

// ───────── 인증 ─────────
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }

function safeEq_(a, b) {
  a = String(a); b = String(b);
  var d = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

// 잠금 정책: 다른 직원의 로그인을 막지 않는다.
//  - 실패 횟수 제한은 "기기별"(클라이언트가 만든 임의 ID)로만 적용.
//  - 전역 실패가 많아져도 올바른 비밀번호는 항상 통과. 틀린 시도에만 지연(Utilities.sleep)을 건다.
function cleanId_(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : 'anon'; }

function checkPassword_(kind, input, scope) {
  var cache = CacheService.getScriptCache();
  var lockKey = 'LOCK:' + kind + ':' + scope, failKey = 'FAIL:' + kind + ':' + scope;
  if (cache.get(lockKey)) return { ok: false, locked: true, error: '이 기기에서 시도 횟수를 초과했습니다. 5분 후 다시 시도하세요.' };
  var real = prop_('STAFF_PASSWORD');
  if (!real) return { ok: false, error: '서버 비밀번호가 설정되지 않았습니다.' };
  if (typeof input === 'string' && input.length <= 100 && safeEq_(input, real)) {
    cache.remove(failKey);
    return { ok: true };
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  var n, g;
  try {
    n = Number(cache.get(failKey) || 0) + 1;
    g = Number(cache.get('GFAIL:' + kind) || 0) + 1;
    cache.put(failKey, String(n), 900);
    cache.put('GFAIL:' + kind, String(g), 900);
    if (n >= MAX_FAILS) cache.put(lockKey, '1', LOCK_SECONDS);
  } finally { lock.releaseLock(); }
  if (g > GLOBAL_FAIL_SOFT) Utilities.sleep(2000); // 대량 추측 공격 둔화 (정상 로그인엔 영향 없음)
  if (n >= MAX_FAILS) return { ok: false, locked: true, error: '이 기기에서 시도 횟수를 초과했습니다. 5분 후 다시 시도하세요.' };
  return { ok: false, error: '비밀번호가 올바르지 않습니다. (' + n + '/' + MAX_FAILS + ')' };
}

function login(password, deviceId) {
  var r = checkPassword_('staff', password, cleanId_(deviceId));
  if (!r.ok) return r;
  var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('S:' + token, '{}', SESSION_TTL);
  return { ok: true, token: token, ttlSeconds: SESSION_TTL };
}

function logout(token) {
  if (typeof token === 'string') CacheService.getScriptCache().remove('S:' + token);
  return { ok: true };
}

function session_(token) {
  if (typeof token !== 'string' || token.length < 40 || token.length > 100) return null;
  var raw = CacheService.getScriptCache().get('S:' + token);
  return raw ? JSON.parse(raw) : null;
}

// 모든 데이터 API의 단일 관문: 유효한 세션이 없으면 실행하지 않는다
function guard_(token, fn) {
  if (!session_(token)) return { ok: false, session: false, error: '세션이 만료되었습니다. 다시 로그인하세요.' };
  try { return fn(); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
}

// ───────── 시트 접근 ─────────
function ss_() {
  var id = prop_('SHEET_ID');
  if (!id) throw new Error('SHEET_ID 미설정');
  return SpreadsheetApp.openById(id);
}
function sheet_(key) {
  var def = SHEETS[key], ss = ss_(), sh = ss.getSheetByName(def.name);
  if (!sh) { sh = ss.insertSheet(def.name); sh.appendRow(def.head); }
  return sh;
}
function rows_(key) {
  var sh = sheet_(key), n = sh.getLastRow();
  if (n < 2) return [];
  var w = SHEETS[key].head.length;
  return sh.getRange(2, 1, n - 1, w).getValues().map(function (r, i) { return { row: i + 2, v: r }; });
}
function dkey_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v || '').slice(0, 10);
}
function noon_(s) { return Utilities.parseDate(s + ' 12:00', TZ, 'yyyy-MM-dd HH:mm'); }
function safeText_(s) { s = String(s == null ? '' : s).trim(); return /^[=+\-@]/.test(s) ? "'" + s : s; }

function aptOf_(r) {
  var v = r.v;
  return { id: v[0], name: v[1], address: v[2], households: v[3], dongCount: v[4], dongs: String(v[5] || ''), type: v[6], entry: v[7], memo: v[8], last: dkey_(v[9]), total: v[10], active: v[11] };
}
function actOf_(r) {
  var v = r.v;
  return { id: v[0], date: dkey_(v[1]), staff: v[2], aptId: v[3], aptName: v[4], dongs: String(v[5] || ''), count: Number(v[6]) || 0, type: v[7], entry: v[8], memo: v[9], created: v[10] instanceof Date ? Utilities.formatDate(v[10], TZ, 'yyyy-MM-dd HH:mm') : String(v[10] || '') };
}

function parseDongs_(text) {
  var parts = String(text || '').split(/[,\s/]+/).filter(Boolean), out = [];
  parts.forEach(function (p) {
    var m = /^(\d{1,4})동?$/.exec(p);
    if (!m) throw new Error('동 형식이 올바르지 않습니다: ' + p + ' (예: 202동, 203동)');
    var d = m[1] + '동';
    if (out.indexOf(d) < 0) out.push(d);
  });
  if (!out.length) throw new Error('완료한 동을 입력하세요.');
  return out;
}

function validateActivity_(a, aptRows) {
  if (!a || typeof a !== 'object') throw new Error('잘못된 요청');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date || '')) throw new Error('활동일 형식 오류');
  if (STAFF.indexOf(a.staff) < 0) throw new Error('선택할 수 없는 직원입니다.');
  var apt = aptRows.filter(function (r) { return r.v[0] === a.aptId && r.v[11] !== '미사용'; })[0];
  if (!apt) throw new Error('아파트를 선택하세요.');
  var dongs = parseDongs_(a.dongs);
  var type = TYPES.indexOf(a.type) >= 0 ? a.type : '미확인';
  var entry = ENTRY.indexOf(a.entry) >= 0 ? a.entry : '미확인';
  var memo = safeText_(a.memo).slice(0, 300);
  return { apt: apt, dongs: dongs, type: type, entry: entry, memo: memo };
}

// 아파트DB의 최근활동일·누적활동동수·형식·공동현관을 활동기록 기준으로 다시 계산
function refreshApts_() {
  var acts = rows_('act').map(actOf_), sh = sheet_('apt'), apts = rows_('apt');
  apts.forEach(function (r) {
    var mine = acts.filter(function (x) { return x.aptId === r.v[0]; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var total = mine.reduce(function (s, x) { return s + x.count; }, 0);
    var last = mine.length ? mine[mine.length - 1].date : '';
    var upd = [last ? noon_(last) : '', total];
    sh.getRange(r.row, 10, 1, 2).setValues([upd]);
    var withType = mine.filter(function (x) { return x.type !== '미확인'; }).pop();
    var withEntry = mine.filter(function (x) { return x.entry !== '미확인'; }).pop();
    if (withType) sh.getRange(r.row, 7).setValue(withType.type);
    if (withEntry) sh.getRange(r.row, 8).setValue(withEntry.entry);
  });
}

// ───────── 직원용 API ─────────
function getBootstrap(token) {
  return guard_(token, function () {
    return {
      ok: true, staff: STAFF, store: STORE, types: TYPES, entries: ENTRY,
      today: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'),
      apartments: rows_('apt').map(aptOf_).filter(function (a) { return a.active !== '미사용'; }),
      qr: { promoUrl: ScriptApp.getService().getUrl() + '?qr=promo', regularUrl: QR_REGULAR_URL }
    };
  });
}

function addActivity(token, a) {
  return guard_(token, function () {
    var lock = LockService.getScriptLock(); lock.waitLock(15000);
    try {
      var c = validateActivity_(a, rows_('apt'));
      var now = new Date();
      var id = 'ACT-' + Utilities.formatDate(now, TZ, 'yyyyMMddHHmmss') + '-' + Utilities.getUuid().slice(0, 5).toUpperCase();
      sheet_('act').appendRow([id, noon_(a.date), a.staff, c.apt.v[0], c.apt.v[1], c.dongs.join(', '), c.dongs.length, c.type, c.entry, c.memo, now]);
      refreshApts_();
      return { ok: true, id: id };
    } finally { lock.releaseLock(); }
  });
}

function updateActivity(token, id, a) {
  return guard_(token, function () {
    var lock = LockService.getScriptLock(); lock.waitLock(15000);
    try {
      var target = rows_('act').filter(function (r) { return r.v[0] === id; })[0];
      if (!target) throw new Error('기록을 찾을 수 없습니다.');
      var c = validateActivity_(a, rows_('apt'));
      var created = target.v[10];
      sheet_('act').getRange(target.row, 1, 1, 11).setValues([[id, noon_(a.date), a.staff, c.apt.v[0], c.apt.v[1], c.dongs.join(', '), c.dongs.length, c.type, c.entry, c.memo, created]]);
      refreshApts_();
      return { ok: true };
    } finally { lock.releaseLock(); }
  });
}

// 직원은 날짜 범위 내 활동기록(담당자 필터 선택)만 조회
function listActivities(token, f) {
  return guard_(token, function () {
    f = f || {};
    var list = rows_('act').map(actOf_).filter(function (x) {
      return (!f.from || x.date >= f.from) && (!f.to || x.date <= f.to) && (!f.staff || x.staff === f.staff) && (!f.aptId || x.aptId === f.aptId);
    });
    list.sort(function (a, b) { return a.date === b.date ? (a.created < b.created ? 1 : -1) : (a.date < b.date ? 1 : -1); });
    return { ok: true, items: list.slice(0, 500) };
  });
}

// ───────── 삭제·DB 수정·분석 (로그인한 모든 사용자 동일 권한) ─────────
function deleteActivity(token, id) {
  return guard_(token, function () {
    var lock = LockService.getScriptLock(); lock.waitLock(15000);
    try {
      var t = rows_('act').filter(function (r) { return r.v[0] === id; })[0];
      if (!t) throw new Error('기록을 찾을 수 없습니다.');
      sheet_('act').deleteRow(t.row);
      refreshApts_();
      return { ok: true };
    } finally { lock.releaseLock(); }
  });
}

function updateApartment(token, id, f) {
  return guard_(token, function () {
    var t = rows_('apt').filter(function (r) { return r.v[0] === id; })[0];
    if (!t) throw new Error('아파트를 찾을 수 없습니다.');
    var sh = sheet_('apt');
    if (TYPES.indexOf(f.type) >= 0) sh.getRange(t.row, 7).setValue(f.type);
    if (ENTRY.indexOf(f.entry) >= 0) sh.getRange(t.row, 8).setValue(f.entry);
    if (typeof f.memo === 'string') sh.getRange(t.row, 9).setValue(safeText_(f.memo).slice(0, 300));
    if (f.dongs) sh.getRange(t.row, 6).setValue(parseDongs_(f.dongs).join(', '));
    return { ok: true };
  });
}

function staffActivity(token, from, to) {
  return guard_(token, function () {
    var acts = rows_('act').map(actOf_).filter(function (x) { return (!from || x.date >= from) && (!to || x.date <= to); });
    var by = {};
    STAFF.forEach(function (s) { by[s] = { staff: s, dongs: 0, records: 0, days: {}, last: '' }; });
    acts.forEach(function (x) {
      var b = by[x.staff] || (by[x.staff] = { staff: x.staff + ' (이전 기록)', dongs: 0, records: 0, days: {}, last: '' });
      b.dongs += x.count; b.records++; b.days[x.date] = 1; if (x.date > b.last) b.last = x.date;
    });
    var out = Object.keys(by).map(function (k) { var b = by[k]; return { staff: b.staff, dongs: b.dongs, records: b.records, days: Object.keys(b.days).length, last: b.last }; });
    return { ok: true, items: out };
  });
}

function daysBetween_(a, b) { return Math.round((noon_(b) - noon_(a)) / 86400000); }
function addDays_(s, n) { return Utilities.formatDate(new Date(noon_(s).getTime() + n * 86400000), TZ, 'yyyy-MM-dd'); }

function analytics(token, from, to) {
  return guard_(token, function () {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to) throw new Error('기간 형식 오류');
    var span = daysBetween_(from, to) + 1;
    if (span > 366) throw new Error('기간은 최대 366일입니다.');
    var pFrom = addDays_(from, -span), pTo = addDays_(from, -1);
    var acts = rows_('act').map(actOf_);
    var qrs = rows_('qr').map(function (r) { return dkey_(r.v[1]); });
    function sum(a, b) {
      var inR = acts.filter(function (x) { return x.date >= a && x.date <= b; });
      return { dongs: inR.reduce(function (s, x) { return s + x.count; }, 0), records: inR.length, qr: qrs.filter(function (d) { return d >= a && d <= b; }).length };
    }
    var daily = [], i;
    for (i = 0; i < span; i++) {
      var d = addDays_(from, i);
      daily.push({ date: d, dongs: 0, qr: 0 });
    }
    var idx = {}; daily.forEach(function (r, k) { idx[r.date] = k; });
    acts.forEach(function (x) { if (idx[x.date] != null) daily[idx[x.date]].dongs += x.count; });
    qrs.forEach(function (d) { if (idx[d] != null) daily[idx[d]].qr++; });
    var staff = {}, apt = {};
    acts.filter(function (x) { return x.date >= from && x.date <= to; }).forEach(function (x) {
      staff[x.staff] = (staff[x.staff] || 0) + x.count;
      var a = apt[x.aptId] || (apt[x.aptId] = { name: x.aptName, dongs: 0, records: 0, history: [] });
      a.dongs += x.count; a.records++; a.history.push({ date: x.date, staff: x.staff, dongs: x.dongs });
    });
    return {
      ok: true, from: from, to: to, daily: daily,
      staff: Object.keys(staff).map(function (k) { return { staff: k, dongs: staff[k] }; }).sort(function (a, b) { return b.dongs - a.dongs; }),
      apartments: Object.keys(apt).map(function (k) { return apt[k]; }).sort(function (a, b) { return b.dongs - a.dongs; }),
      current: sum(from, to), previous: sum(pFrom, pTo), previousRange: [pFrom, pTo],
      note: '고정 QR을 사용하므로 QR 유입을 특정 아파트 활동의 결과로 단정할 수 없습니다. 기간 단위 추이만 참고하세요.'
    };
  });
}
