// 실제 Code.gs 를 메모리 시트 목(mock) 위에서 실행하는 테스트.  실행: node betting-ledger/test/ledger.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

/* ---------- Apps Script 목 ---------- */
function makeSheet(name) {
  const grid = []; // grid[r][c], 0-based
  const sh = {
    name, grid,
    getName: () => name,
    getLastRow() { let l = 0; grid.forEach((r, i) => { if (r && r.some(v => v !== '' && v !== undefined)) l = i + 1; }); return l; },
    getMaxRows: () => 1000,
    getMaxColumns() { return sh._maxCols || 60; },
    insertColumnsAfter(pos, n) { sh._maxCols = (sh._maxCols || 60) + n; return sh; },
    getLastColumn() { return grid.reduce((m, r) => Math.max(m, r ? r.length : 0), 0); },
    getRange(r, c, nr = 1, nc = 1) {
      const rng = {
        getFormulas: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = grid[r - 1 + i] && grid[r - 1 + i][c - 1 + j]; return (typeof v === 'string' && v[0] === '=') ? v : ''; })),
        getValue: () => (grid[r - 1] && grid[r - 1][c - 1] !== undefined) ? grid[r - 1][c - 1] : '',
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (grid[r - 1 + i] && grid[r - 1 + i][c - 1 + j] !== undefined) ? grid[r - 1 + i][c - 1 + j] : '')),
        setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { (grid[r - 1 + i] = grid[r - 1 + i] || [])[c - 1 + j] = x; })); return rng; },
      };
      rng.setValue = v => { (grid[r - 1] = grid[r - 1] || [])[c - 1] = v; return prx; };
      const prx = new Proxy(rng, { get: (t, k) => k in t ? t[k] : (...a) => { (sh.calls = sh.calls || []).push([String(k), c, a[0]]); return prx; } });
      return prx;
    },
    clear() { grid.length = 0; return sh; },
    isSheetHidden() { return !!sh._hidden; },
    hideSheet() { sh._hidden = true; return sh; },
  };
  return new Proxy(sh, { get: (t, k) => k in t ? t[k] : () => sh });
}

function makeContext(now0 = new Date('2026-10-03T03:00:00Z')) {
  let now = now0;
  const sheets = [];
  const props = {}; const cache = {}; const triggers = [];
  let uuidN = 0;
  const ss = {
    getId: () => 'SS1',
    getSheetByName: n => sheets.find(s => s.name === n) || null,
    insertSheet: n => { const s = makeSheet(n); sheets.push(s); return s; },
    getSheets: () => sheets,
    setActiveSheet: s => s,
    deleteSheet: s => sheets.splice(sheets.indexOf(s), 1),
  };
  const RealDate = Date;
  const ctx = {
    console, Date: class extends RealDate { constructor(...a) { a.length ? super(...a) : super(now.getTime()); } static now() { return now.getTime(); } },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, newDataValidation: () => { const o = new Proxy({}, { get: (_, k) => k === 'build' ? () => ({ built: true }) : () => o }); return o; } },
    ScriptApp: {
      EventType: { CLOCK: 'CLOCK' },
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: tr => { const i = triggers.indexOf(tr); if (i >= 0) triggers.splice(i, 1); },
      newTrigger: fn => ({ timeBased: () => ({ everyMinutes: n => ({ create: () => { const tr = { fn, every: n, getHandlerFunction: () => fn, getEventType: () => 'CLOCK' }; triggers.push(tr); return tr; } }) }) })
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }, getProperties: () => Object.assign({}, props), deleteProperty: k => { delete props[k]; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      parseDate: (str) => new RealDate(/\d:\d/.test(str) ? str.replace(' ', 'T') + '+09:00' : str + 'T00:00:00+09:00'),
      getUuid: () => 'uuid-' + String(++uuidN).padStart(8, '0') + '-aaaa-bbbb-cccc-dddddddddddd',
      formatDate(d, tz, fmt) {
        const k = new RealDate(d.getTime() + 9 * 3600 * 1000); // Asia/Seoul
        const p = n => String(n).padStart(2, '0');
        const Y = k.getUTCFullYear(), M = p(k.getUTCMonth() + 1), D = p(k.getUTCDate());
        return fmt === 'yyyy-MM-dd' ? `${Y}-${M}-${D}` : fmt === 'yyyyMMdd' ? `${Y}${M}${D}`
          : `${Y}-${M}-${D} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}:${p(k.getUTCSeconds())}`;
      },
    },
    HtmlService: {}, Logger: { log() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  const get = n => vm.runInContext(n, ctx);
  return { ctx, ss, sheets, get, props, triggers, sheet: n => ss.getSheetByName(n), setNow: d => { now = d; } };
}

/* ---------- 도우미 ---------- */
const GAMES = Array(14).fill('승');
let seq = 0;
const recBet = (env, o) => env.get('apiSaveBet')(Object.assign({ date: '2026-10-03', sport: '축구', league: 'K리그', name: 'A경기', pick: '홈승', folders: 1, odds: 2.2, stake: 5000, grade: '메인', memo: '', reqId: 'r' + (++seq) }, o));
const recWdl = (env, o) => env.get('apiSaveWdl')(Object.assign({ round: '100', date: '2026-10-03', combo: '주력', games: GAMES, stake: 5000, memo: '', reqId: 'r' + (++seq) }, o));
const kst = d => new Date(d + 'T12:00:00+09:00');
const buy = (env, kind, id, yes = true, extra = {}) => env.get('apiPurchase')(Object.assign({ kind, id, buy: yes, reqId: 'r' + (++seq) }, extra));
// 기존 테스트 호환: 추천 저장 후 '샀다'까지 처리. 구매 시각은 해당 기록 날짜 정오(KST)
const bet = (env, o) => { const d = (o && o.date) || '2026-10-03'; env.setNow(kst(d)); const r = recBet(env, o); if (!r.ok) return r; const b = buy(env, 'bet', r.id); return b.ok ? Object.assign(b, { id: r.id }) : b; };
const wdl = (env, o) => { const d = (o && o.date) || '2026-10-03'; env.setNow(kst(d)); const r = recWdl(env, o); if (!r.ok) return r; const b = buy(env, 'wdl', r.id); return b.ok ? Object.assign(b, { id: r.id }) : b; };
const boughtRows = (env, name) => env.sheet(name).grid.slice(1).filter(r => r[name === 'BET_LOG' ? 16 : 25] === '구매').length;
const dash = (env) => env.get('apiGetMonthly')('2026-10');

let pass = 0; const results = [];
function test(name, fn) {
  try { fn(); pass++; results.push('PASS  ' + name); }
  catch (e) { results.push('FAIL  ' + name + '\n      ' + e.message); }
}
const setup = () => { const env = makeContext(); env.get('setup')(); return env; };

/* ---------- 구조 ---------- */
test('setup: 시트 4개 + 헤더 + SETTINGS 기본값', () => {
  const env = setup();
  assert.deepStrictEqual(env.sheets.map(s => s.name).sort(), ['BET_LOG', 'DASHBOARD', 'SETTINGS', 'WDL_LOG']);
  assert.strictEqual(env.sheet('BET_LOG').grid[0].join('|'), 'ID|베팅일|종목|리그|경기/조합명|픽 내용|폴더수|총배당|베팅금액|결과|반환금|손익|ROI|리치등급|메모|등록일시|구매여부|실제베팅금액|구매일시');
  assert.strictEqual(env.sheet('WDL_LOG').grid[0].join('|'), 'ID|회차|구매일|조합구분|' + Array.from({ length: 14 }, (_, i) => (i + 1) + '경기').join('|') + '|베팅금액|적중개수|등수|당첨금|손익|메모|등록일시|구매여부|실제베팅금액|구매일시|구매묶음ID|조합순번');
  const st = env.sheet('SETTINGS').grid.slice(1).map(r => r.slice(0, 2).join('='));
  assert.deepStrictEqual(st, ['월 예산=200000', '일반토토 일 최대=5000', '승무패 회차 최대=10000']);
  env.get('setup')(); // 재실행해도 중복/덮어쓰기 없음
  assert.strictEqual(env.sheet('SETTINGS').getLastRow(), 4);
});

/* ---------- 일반토토 ---------- */
test('1. 5,000원 저장 → 정상', () => {
  const env = setup();
  const r = bet(env, {});
  assert.ok(r.ok, r.error);
  const row = env.sheet('BET_LOG').grid[1];
  assert.strictEqual(row[8], 5000); assert.strictEqual(row[9], '대기'); assert.strictEqual(row[10], '');
});

test('2. 같은 날 1,000원 추가 → 일 최대 초과 차단', () => {
  const env = setup();
  assert.ok(bet(env, {}).ok);
  const r = bet(env, { stake: 1000 });
  assert.strictEqual(r.ok, false); assert.match(r.error, /일 최대 5,000원 초과/);
  assert.strictEqual(boughtRows(env, 'BET_LOG'), 1);
  // 스펙 예: 3,000 + 3,000
  const env2 = setup();
  assert.ok(bet(env2, { stake: 3000 }).ok);
  assert.strictEqual(bet(env2, { stake: 3000 }).ok, false);
  assert.ok(bet(env2, { stake: 2000 }).ok); // 정확히 5,000 은 허용
  assert.ok(bet(env2, { stake: 1000, date: '2026-10-04' }).ok); // 다른 날은 별도
});

test('3. 5,000 베팅 / 11,000 반환 → +6,000 / +120%', () => {
  const env = setup();
  const id = bet(env, {}).id;
  const r = env.get('apiResolveBet')({ id, result: '적중', ret: 11000, reqId: 'x1' });
  assert.ok(r.ok, r.error); assert.strictEqual(r.profit, 6000); assert.strictEqual(r.roi, 120);
  const row = env.sheet('BET_LOG').grid[1];
  assert.deepStrictEqual([row[9], row[10], row[11], row[12]], ['적중', 11000, 6000, 1.2]);  // ROI 는 시트에 비율(0.0% 서식)
});

test('4. 5,000 베팅 / 0 반환 → -5,000 / -100%', () => {
  const env = setup();
  const id = bet(env, {}).id;
  const r = env.get('apiResolveBet')({ id, result: '미적중', ret: 0, reqId: 'x2' });
  assert.ok(r.ok, r.error); assert.strictEqual(r.profit, -5000); assert.strictEqual(r.roi, -100);
  // 이미 처리된 건 재처리 불가
  assert.strictEqual(env.get('apiResolveBet')({ id, result: '적중', ret: 9000, reqId: 'x3' }).ok, false);
});

/* ---------- 승무패 ---------- */
test('5. 같은 회차 5,000+3,000+2,000 → 정상', () => {
  const env = setup();
  assert.ok(wdl(env, { combo: '주력', stake: 5000 }).ok);
  assert.ok(wdl(env, { combo: '보조1', stake: 3000 }).ok);
  const r = wdl(env, { combo: '보조2', stake: 2000 });
  assert.ok(r.ok, r.error);
  assert.strictEqual(boughtRows(env, 'WDL_LOG'), 3);
});

test('6. 같은 회차 5,000+3,000+3,000 → 10,000 초과 차단', () => {
  const env = setup();
  wdl(env, { combo: '주력', stake: 5000 }); wdl(env, { combo: '보조1', stake: 3000 });
  const r = wdl(env, { combo: '보조2', stake: 3000 });
  assert.strictEqual(r.ok, false); assert.match(r.error, /회차 최대 10,000원 초과/);
  assert.strictEqual(boughtRows(env, 'WDL_LOG'), 2);
  // 다른 회차는 별도 한도
  assert.ok(wdl(env, { round: '101', combo: '보조2', stake: 3000 }).ok);
});

/* ---------- 월 예산 ---------- */
// 2026-09: 일반토토 29일×5,000 + 승무패 5회차×10,000 + 3,000 = 198,000
function fill198k(env) {
  for (let d = 1; d <= 29; d++) assert.ok(bet(env, { date: `2026-09-${String(d).padStart(2, '0')}` }).ok);
  for (let i = 1; i <= 5; i++) assert.ok(wdl(env, { round: 'S' + i, date: '2026-09-15', stake: 10000 }).ok);
  assert.ok(wdl(env, { round: 'S6', date: '2026-09-20', stake: 3000 }).ok);
}
test('7. 월 사용 198,000 에서 3,000 신규 → 200,000 초과 차단', () => {
  const env = setup();
  fill198k(env);
  assert.strictEqual(env.get('apiGetMonthly')('2026-09').summary.used, 198000);
  const r = bet(env, { date: '2026-09-30', stake: 3000 });
  assert.strictEqual(r.ok, false); assert.match(r.error, /월 예산 200,000원 초과/);
  assert.ok(bet(env, { date: '2026-09-30', stake: 2000 }).ok); // 정확히 200,000 허용
  assert.strictEqual(bet(env, { date: '2026-09-30', stake: 1000 }).ok, false);
});

/* ---------- 대시보드 ---------- */
function seedMixed(env) {
  const a = bet(env, { stake: 5000, folders: 2, grade: '대박', sport: '야구' }).id;           // 10/03 적중 11,000
  const b = bet(env, { date: '2026-10-02', stake: 4000, folders: 1, grade: '메인' }).id;      // 미적중
  const c = bet(env, { date: '2026-10-01', stake: 3000, folders: 4, sport: '농구' }).id;      // 대기
  env.get('apiResolveBet')({ id: a, result: '적중', ret: 11000, reqId: 'a' });
  env.get('apiResolveBet')({ id: b, result: '미적중', ret: 0, reqId: 'b' });
  const w1 = wdl(env, { round: '100', stake: 6000 }).id;
  wdl(env, { round: '100', combo: '보조1', stake: 4000 });                                     // 대기
  env.get('apiResolveWdl')({ id: w1, hits: 12, rank: '4등', prize: 9000, reqId: 'c' });
  bet(env, { date: '2026-09-30', stake: 2000, sport: '배구' });                                // 다른 달
  return { a, b, c };
}

test('8. BET_LOG + WDL_LOG 합산 사용액 = 대시보드(시트/웹앱) 일치', () => {
  const env = setup(); seedMixed(env);
  const sumCol = (name, col, monthPrefix, dateCol) => env.sheet(name).grid.slice(1)
    .filter(r => env.ctx.toDateStr_(r[dateCol]).startsWith(monthPrefix)).reduce((s, r) => s + r[col], 0);
  const raw = sumCol('BET_LOG', 8, '2026-10', 1) + sumCol('WDL_LOG', 18, '2026-10', 2);
  assert.strictEqual(raw, 5000 + 4000 + 3000 + 6000 + 4000);
  const s = dash(env).summary;
  assert.strictEqual(s.used, raw); assert.strictEqual(s.remain, 200000 - raw);
  assert.strictEqual(env.sheet('DASHBOARD').getLastRow(), 0);   // DASHBOARD 는 코드가 쓰지 않음
});

test('9. 반환금/손익/ROI (확정 건만)', () => {
  const env = setup(); seedMixed(env);
  const s = dash(env).summary;
  // 확정: 5,000(+11,000) / 4,000(0) / 승무패 6,000(+9,000)  → 반환 20,000, 베팅 15,000
  assert.strictEqual(s.settledStake, 15000); assert.strictEqual(s.totalReturn, 20000);
  assert.strictEqual(s.profit, 5000); assert.strictEqual(s.roi, 33.33);
  assert.strictEqual(s.pendingStake, 7000);
  assert.strictEqual(s.hitRate, 50);
  const d = dash(env);
  const f = Object.fromEntries(d.byFolder.map(g => [g.label, g]));
  assert.strictEqual(f['2폴더'].profit, 6000); assert.strictEqual(f['2폴더'].hitRate, 100);
  assert.strictEqual(f['1폴더'].profit, -4000); assert.strictEqual(f['4폴더 이상'].count, 1);
  const g = Object.fromEntries(d.byGrade.map(x => [x.label, x]));
  assert.strictEqual(g['대박'].roi, 120); assert.strictEqual(g['메인'].roi, -100);
  const sp = Object.fromEntries(d.bySport.map(x => [x.label, x]));
  assert.strictEqual(sp['야구'].ret, 11000); assert.strictEqual(sp['농구'].stake, 3000);
  assert.deepStrictEqual([d.wdl.rounds, d.wdl.stake, d.wdl.prize, d.wdl.profit, d.wdl.bestHits, d.wdl.bestRank], [1, 10000, 9000, 3000, 12, '4등']);
  assert.strictEqual(d.recent.length, 5);
});

test('10. 월 변경 시 해당 월 데이터만 집계', () => {
  const env = setup(); seedMixed(env);
  const sep = env.get('apiGetMonthly')('2026-09'), oct = dash(env);
  assert.strictEqual(sep.summary.used, 2000); assert.strictEqual(oct.summary.used, 22000);
  assert.strictEqual(env.get('apiGetMonthly')('2026-08').summary.used, 0);
  assert.strictEqual(env.get('apiGetMonthly')('2026-08').summary.roi, 0);
  assert.strictEqual(sep.recent.length, 1);
});

/* ---------- 추가 방어 ---------- */
test('A. SETTINGS 값 변경이 즉시 반영(코드 하드코딩 없음)', () => {
  const env = setup();
  env.sheet('SETTINGS').grid[2][1] = 8000; // 일 최대
  assert.ok(bet(env, { stake: 8000 }).ok);
  env.sheet('SETTINGS').grid[1][1] = 'abc';
  assert.match(bet(env, { date: '2026-10-05' }).error, /월 예산/);
});
test('B. 동일 reqId 재전송은 한 번만 저장', () => {
  const env = setup();
  const a = recBet(env, { stake: 1000, reqId: 'same' }), b = recBet(env, { stake: 1000, reqId: 'same' });
  assert.ok(a.ok && b.ok && b.duplicate && a.id === b.id); assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 2);
});
test('C. 서버 검증: 0원/음수/잘못된 날짜·종목·배당·승무패 미입력, 수식 주입', () => {
  const env = setup();
  assert.match(bet(env, { stake: 0 }).error, /0원보다/);
  assert.strictEqual(bet(env, { stake: -5 }).ok, false);
  assert.strictEqual(bet(env, { stake: 'abc' }).ok, false);
  assert.strictEqual(bet(env, { date: '2026-02-30' }).ok, false);
  assert.strictEqual(bet(env, { sport: '골프' }).ok, false);
  assert.strictEqual(bet(env, { odds: 0.5 }).ok, false);
  assert.strictEqual(bet(env, { name: '' }).ok, false);
  assert.strictEqual(wdl(env, { games: GAMES.slice(0, 13) }).ok, false);
  assert.ok(bet(env, { name: '=SUM(1)', stake: 1000 }).ok);
  assert.strictEqual(env.sheet('BET_LOG').grid[1][4], "'=SUM(1)");
  assert.ok(wdl(env, {}).ok);
  assert.match(wdl(env, { stake: 1000 }).error, /이미 있습니다/); // 같은 회차 같은 조합
});
test('D. ID 중복 없음', () => {
  const env = setup();
  for (let i = 1; i <= 4; i++) bet(env, { stake: 1000, date: `2026-10-0${i}` });
  const ids = env.sheet('BET_LOG').grid.slice(1).map(r => r[0]);
  assert.strictEqual(new Set(ids).size, 4);
});
test('E. 날짜 셀이 Date 로 변환돼 있어도 집계 정상', () => {
  const env = setup(); bet(env, { stake: 2000 });
  env.sheet('BET_LOG').grid[1][1] = new Date('2026-10-02T15:00:00Z'); // KST 10/03
  assert.strictEqual(dash(env).summary.used, 2000);
  assert.strictEqual(bet(env, { stake: 3000 }).ok, true);
  assert.strictEqual(bet(env, { stake: 1 }).ok, false);
});
test('F. 미적중은 반환금 0 강제, 적중은 반환금 필수, 취소는 환급 처리', () => {
  const env = setup();
  const a = bet(env, { stake: 1000 }).id, b = bet(env, { stake: 1000, date: '2026-10-04' }).id, c = bet(env, { stake: 1000, date: '2026-10-05' }).id;
  assert.strictEqual(env.get('apiResolveBet')({ id: a, result: '미적중', ret: 500, reqId: 'f1' }).profit, -1000);
  assert.strictEqual(env.get('apiResolveBet')({ id: b, result: '적중', ret: 0, reqId: 'f2' }).ok, false);
  const r = env.get('apiResolveBet')({ id: c, result: '취소', ret: 1000, reqId: 'f3' });
  assert.deepStrictEqual([r.profit, r.roi], [0, 0]);
});


/* ---------- V1 안정화 추가 테스트 ---------- */
test('18. 확정 5,000→10,000 + 대기 5,000 → ROI 분모에 대기 제외 (+100%)', () => {
  const env = setup();
  const a = bet(env, { stake: 5000 }).id; bet(env, { stake: 5000, date: '2026-10-04' });
  env.get('apiResolveBet')({ id: a, result: '적중', ret: 10000, reqId: 'n1' });
  const s = dash(env).summary;
  assert.deepStrictEqual([s.totalStake, s.pendingStake, s.settledStake, s.totalReturn, s.profit, s.roi], [10000, 5000, 5000, 10000, 5000, 100]);
  assert.strictEqual(env.sheet('DASHBOARD').getLastRow(), 0);
});
test('19. 적특 실제 반환 7,500 → +2,500 / +50%, 반환금 필수', () => {
  const env = setup();
  const a = bet(env, {}).id, b = bet(env, { date: '2026-10-04' }).id;
  assert.strictEqual(env.get('apiResolveBet')({ id: a, result: '적특', ret: '', reqId: 'n2' }).ok, false);
  assert.strictEqual(env.get('apiResolveBet')({ id: a, result: '적특', ret: 0, reqId: 'n3' }).ok, false);
  const r = env.get('apiResolveBet')({ id: a, result: '적특', ret: 7500, reqId: 'n4' });
  assert.ok(r.ok, r.error); assert.deepStrictEqual([r.profit, r.roi], [2500, 50]);
  const row = env.sheet('BET_LOG').grid[1];
  assert.deepStrictEqual([row[9], row[10], row[11], row[12]], ['적특', 7500, 2500, 0.5]);
  void b;
});
test('20. 취소 → 반환금 자동 5,000 / 손익 0 / ROI 0%', () => {
  const env = setup();
  const a = bet(env, {}).id;
  const r = env.get('apiResolveBet')({ id: a, result: '취소', reqId: 'n5' });
  assert.ok(r.ok, r.error); assert.deepStrictEqual([r.profit, r.roi], [0, 0]);
  const row = env.sheet('BET_LOG').grid[1];
  assert.deepStrictEqual([row[9], row[10], row[11], row[12]], ['취소', 5000, 0, 0]);
});
test('21. 취소·반환·당첨이 있어도 월 사용액/남은 예산은 줄지 않음', () => {
  const env = setup();
  const a = bet(env, {}).id, b = bet(env, { date: '2026-10-04' }).id, c = bet(env, { date: '2026-10-05' }).id;
  env.get('apiResolveBet')({ id: a, result: '취소', reqId: 'n6' });
  env.get('apiResolveBet')({ id: b, result: '적중', ret: 50000, reqId: 'n7' });
  const s = dash(env).summary;
  assert.strictEqual(s.used, 15000); assert.strictEqual(s.remain, 185000);
  // 환급/당첨 후에도 월 한도 검증은 총 베팅액 기준: 9월에 198,000 채우고 취소·당첨 처리해도 차단
  const env2 = setup(); fill198k(env2);
  const first = env2.sheet('BET_LOG').grid[1][0];
  env2.get('apiResolveBet')({ id: first, result: '적중', ret: 100000, reqId: 'n8' });
  assert.strictEqual(env2.get('apiGetMonthly')('2026-09').summary.remain, 2000);
  assert.strictEqual(bet(env2, { date: '2026-09-30', stake: 3000 }).ok, false);
  void c;
});
test('22. 승무패 1경기 미선택 → 차단 + 친절한 메시지', () => {
  const env = setup();
  const g = GAMES.slice(); g[6] = '';
  const r = wdl(env, { games: g });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.error, '7경기의 승/무/패를 선택해주세요.');
  assert.strictEqual(env.sheet('WDL_LOG').getLastRow(), 1);   // 저장 차단 → 행 없음
  assert.strictEqual(wdl(env, { games: Array(14).fill('') }).error, '1~14경기의 승/무/패를 모두 선택해주세요.');
  const g2 = GAMES.slice(); g2[2] = ''; g2[9] = '';
  assert.strictEqual(wdl(env, { games: g2 }).error, '3, 10경기의 승/무/패를 선택해주세요.');
});
test('23. diagnoseSetup: 정상이면 정상 메시지, 데이터 변경 없음', () => {
  const env = setup(); bet(env, { stake: 1000 });
  const snap = JSON.stringify(env.sheets.map(s => [s.name, s.grid]));
  assert.strictEqual(env.get('diagnoseSetup')(), '리치 베팅 장부 V1 환경 정상');
  assert.strictEqual(JSON.stringify(env.sheets.map(s => [s.name, s.grid])), snap);
});
test('24. diagnoseSetup: 빈 스프레드시트는 생성 없이 문제 보고', () => {
  const env = makeContext();
  const msg = env.get('diagnoseSetup')();
  ['BET_LOG', 'WDL_LOG', 'DASHBOARD', 'SETTINGS'].forEach(n => assert.ok(msg.includes('시트 "' + n + '"가 없습니다'), msg));
  assert.strictEqual(env.sheets.length, 0);
});
test('25. diagnoseSetup: 헤더 오류/중복/설정값 누락·불량 위치 안내', () => {
  const env = setup();
  env.sheet('BET_LOG').grid[0][4] = '경기명';        // E열 틀림
  env.sheet('WDL_LOG').grid[0][26] = '메모';          // AA열 중복 헤더(X열 메모와 동일)
  env.sheet('SETTINGS').grid[2][0] = '일반토토 일 최대 ';   // 공백은 허용
  env.sheet('SETTINGS').grid[3][1] = '0';              // 회차 최대 불량
  env.sheet('SETTINGS').grid[1][0] = '월예산';          // 월 예산 누락
  const msg = env.get('diagnoseSetup')();
  assert.ok(msg.includes('BET_LOG 5열 헤더: 기대 "경기/조합명", 실제 "경기명"'), msg);
  assert.ok(msg.includes('WDL_LOG 중복 헤더 "메모"'), msg);
  assert.ok(msg.includes('SETTINGS에 "월 예산" 항목이 없습니다'), msg);
  assert.ok(msg.includes('SETTINGS "승무패 회차 최대" 값이 올바르지 않습니다'), msg);
  assert.ok(!msg.includes('일반토토 일 최대'), msg);
});

/* ---------- 실환경(기존 시트) 보호 ---------- */
function preexisting() {
  const env = makeContext();
  const ss = env.ss;
  env.get('setup')();                       // 구조만 만든 뒤, 사용자가 만든 시트 상태로 재현
  const dash = env.sheet('DASHBOARD'); dash.clear();
  dash.grid[0] = ['리치 베팅 장부']; dash.grid[2] = ['기준월', '=TEXT(TODAY(),"yyyy-mm")']; dash.grid[4] = ['총 베팅액', '=SUMIFS(BET_LOG!I:I,BET_LOG!B:B,">="&EOMONTH(TODAY(),-1)+1)'];
  env.sheets.forEach(s => { s.calls = []; });
  return env;
}
test('26. 기존 DASHBOARD(수식)는 setup/저장/결과처리에도 덮어쓰지 않음', () => {
  const env = preexisting();
  const snap = JSON.stringify(env.sheet('DASHBOARD').grid);
  env.get('setup')();
  const id = bet(env, {}).id; env.get('apiResolveBet')({ id, result: '적중', ret: 11000, reqId: 'p1' });
  assert.strictEqual(JSON.stringify(env.sheet('DASHBOARD').grid), snap);
  assert.deepStrictEqual(env.sheet('DASHBOARD').calls || [], []);
  assert.strictEqual(env.get('diagnoseSetup')(), '리치 베팅 장부 V1 환경 정상');
  assert.strictEqual(dash(env).summary.profit, 6000);   // 웹앱 집계는 정상
});
test('27. 기존 시트: 날짜/금액/ROI 서식·헤더 스타일을 건드리지 않고 ID/회차/등록일시만 텍스트 지정(ID/회차)', () => {
  const env = preexisting();
  env.get('setup')();
  const bc = env.sheet('BET_LOG').calls.map(c => c[0] + ':' + c[1]);
  assert.deepStrictEqual(bc, ['setNumberFormat:1']);   // A(ID) 뿐
  const wc = env.sheet('WDL_LOG').calls.map(c => c[0] + ':' + c[1]);
  assert.deepStrictEqual(wc, ['setNumberFormat:1', 'setNumberFormat:2', 'setNumberFormat:29']);   // + 구매묶음ID(텍스트)
  assert.ok(!env.sheet('BET_LOG').calls.some(c => ['setFontWeight', 'setBackground', 'setFrozenRows'].includes(c[0])));
});

/* ---------- 구매 확인(구매여부) ---------- */
const isDate = v => Object.prototype.toString.call(v) === '[object Date]';
test('28. 추천 저장 = 미확인, 실제베팅금액/구매일시 빈값, 예산 미사용(한도 초과 추천도 저장)', () => {
  const env = setup(); env.setNow(kst('2026-10-03'));
  const r = recBet(env, { stake: 5000 }), big = recBet(env, { stake: 9000, name: '큰추천' }), w = recWdl(env, { stake: 10000 });
  assert.ok(r.ok && big.ok && w.ok, JSON.stringify([r, big, w]));
  const row = env.sheet('BET_LOG').grid[1];
  assert.deepStrictEqual([row[16], row[17], row[18]], ['미확인', '', '']);
  assert.ok(isDate(row[15]), '등록일시는 실제 날짜시간 값(대시보드 수식 호환)');
  const s = dash(env).summary;
  assert.deepStrictEqual([s.used, s.remain, s.totalStake], [0, 200000, 0]);
  assert.strictEqual(env.get('apiBootstrap')().todayBetUsed, 0);
  assert.strictEqual(env.sheet('DASHBOARD').getLastRow(), 0);
});
test('29. 샀다 = 구매 / 실제베팅금액=추천금액 / 구매일시=현재(KST), 안 샀다 = 미구매 / 금액 빈값 / 기록 보존', () => {
  const env = setup(); env.setNow(new Date('2026-10-03T03:04:05Z'));   // KST 12:04:05
  const a = recBet(env, { stake: 4000 }).id, b = recBet(env, { stake: 3000, date: '2026-10-04', name: 'B' }).id;
  const r1 = buy(env, 'bet', a, true); assert.ok(r1.ok, r1.error); assert.strictEqual(r1.buyStatus, '구매');
  const r2 = buy(env, 'bet', b, false); assert.ok(r2.ok, r2.error); assert.strictEqual(r2.buyStatus, '미구매');
  const g = env.sheet('BET_LOG').grid;
  assert.deepStrictEqual([g[1][16], g[1][17], g[1][8]], ['구매', 4000, 4000]);
  assert.ok(isDate(g[1][18]));
  assert.ok(isDate(g[1][1]) && isDate(g[1][15]), '베팅일/등록일시도 실제 Date 값');
  assert.deepStrictEqual([g[2][16], g[2][17], g[2][8]], ['미구매', '', 3000]);   // 추천 기록 보존
  assert.ok(isDate(g[2][18]));
  const bs = env.get('apiGetMonthly')('2026-10'); assert.strictEqual(bs.summary.used, 4000);   // 미구매 제외
  assert.strictEqual(bs.recent.length, 1);
  // 구매일시가 KST 로 읽힘 (diagnose/통계용 문자열)
  assert.strictEqual(env.ctx.toDateTimeStr_(g[1][18]), '2026-10-03 12:04:05');
  assert.strictEqual(env.get('apiGetUnconfirmed')().bets.length, 0);
});
test('30. 일반토토 한도: 실구매 누적 기준(미확인 추천 무시), 초과 시 샀다 차단', () => {
  const env = setup(); env.setNow(kst('2026-10-03'));
  const ids = [3000, 3000, 2000, 1000].map((s, i) => recBet(env, { stake: s, name: 'R' + i }).id);   // 추천 합계 9,000 (저장은 모두 허용)
  assert.ok(buy(env, 'bet', ids[0]).ok);
  const blocked = buy(env, 'bet', ids[1]);
  assert.strictEqual(blocked.ok, false); assert.match(blocked.error, /일 최대 5,000원 초과: 해당일 구매 3,000원 \+ 신규 3,000원 = 6,000원/);
  const row = env.sheet('BET_LOG').grid[2];
  assert.deepStrictEqual([row[16], row[17], row[18]], ['미확인', '', '']);   // 차단 시 상태 변화 없음
  assert.ok(buy(env, 'bet', ids[2]).ok);                                     // 3,000 + 2,000 = 5,000 허용
  assert.strictEqual(buy(env, 'bet', ids[3]).ok, false);                     // +1,000 → 6,000 차단
  assert.ok(buy(env, 'bet', ids[1], false).ok);                              // 안 샀다는 한도와 무관
  assert.strictEqual(env.get('apiBootstrap')().todayBetUsed, 5000);
  env.setNow(kst('2026-10-04'));                                             // 일 한도는 실제 구매일 기준 → 다음 날은 별도 한도
  const other = recBet(env, { stake: 5000, date: '2026-10-04' }).id;
  assert.ok(buy(env, 'bet', other).ok);
  assert.strictEqual(env.get('apiBootstrap')().todayBetUsed, 5000);
});
test('31. 승무패 한도: 회차 실구매 누적 기준, 초과 시 샀다 차단', () => {
  const env = setup(); env.setNow(kst('2026-10-03'));
  const a = recWdl(env, { combo: '주력', stake: 5000 }).id, b = recWdl(env, { combo: '보조1', stake: 3000 }).id, c = recWdl(env, { combo: '보조2', stake: 3000 }).id;
  assert.ok(buy(env, 'wdl', a).ok); assert.ok(buy(env, 'wdl', b).ok);
  const blocked = buy(env, 'wdl', c);
  assert.strictEqual(blocked.ok, false); assert.match(blocked.error, /회차 최대 10,000원 초과: 100회차 구매 8,000원 \+ 신규 3,000원 = 11,000원/);
  assert.deepStrictEqual(env.sheet('WDL_LOG').grid[3].slice(25, 28), ['미확인', '', '']);
  // 보조2 를 2,000원 추천으로 새로 저장하면 구매 가능(합계 10,000)
  const d = recWdl(env, { round: '100', combo: '보조2', stake: 2000 });
  assert.match(d.error, /이미 있습니다/);                       // 같은 회차·조합 중복 추천은 저장 단계에서 차단
  const e = recWdl(env, { round: '101', combo: '주력', stake: 10000 }).id;
  assert.ok(buy(env, 'wdl', e).ok);                              // 다른 회차는 별도 한도, 정확히 10,000 허용
  assert.ok(buy(env, 'wdl', c, false).ok);                       // 미구매 처리는 항상 가능
  const w = env.sheet('WDL_LOG').grid[1];
  assert.deepStrictEqual([w[25], w[26], isDate(w[27])], ['구매', 5000, true]);
});
test('32. 월 예산: 실구매 합계 기준(일·회차 한도와 별개), 초과 시 샀다 차단', () => {
  const env = setup(); fill198k(env);
  env.setNow(kst('2026-09-30'));
  assert.strictEqual(env.get('apiGetMonthly')('2026-09').summary.used, 198000);
  const x = recBet(env, { date: '2026-09-30', stake: 3000 }).id, y = recBet(env, { date: '2026-09-30', stake: 2000, name: 'Y' }).id;
  assert.strictEqual(env.get('apiGetMonthly')('2026-09').summary.used, 198000);   // 추천만으로는 불변
  const r = buy(env, 'bet', x);
  assert.strictEqual(r.ok, false); assert.match(r.error, /월 예산 200,000원 초과: 2026-09 구매 198,000원 \+ 신규 3,000원 = 201,000원/);
  assert.ok(buy(env, 'bet', y).ok);                                                // 정확히 200,000 허용
  assert.strictEqual(env.get('apiGetMonthly')('2026-09').summary.remain, 0);
  assert.ok(buy(env, 'bet', x, false).ok);
  // 반환/당첨은 예산을 되살리지 않음
  env.get('apiResolveBet')({ id: y, result: '적중', ret: 100000, reqId: 'm1' });
  assert.strictEqual(env.get('apiGetMonthly')('2026-09').summary.remain, 0);
});
test('33. 샀다/안 샀다 중복 클릭: 두 번째는 변경 없이 거절, 동일 reqId 는 캐시 응답', () => {
  const env = setup(); env.setNow(new Date('2026-10-03T03:00:00Z'));
  const id = recBet(env, { stake: 2000 }).id;
  const first = buy(env, 'bet', id, true, { reqId: 'click1' });
  assert.ok(first.ok);
  const snap = JSON.stringify(env.sheet('BET_LOG').grid);
  env.setNow(new Date('2026-10-03T03:00:09Z'));                                  // 시각이 달라져도 덮어쓰기 금지
  const dup = buy(env, 'bet', id, true, { reqId: 'click2' });                    // 다른 reqId(재클릭)
  assert.strictEqual(dup.ok, false); assert.match(dup.error, /이미 처리된 기록입니다 \(구매\)/);
  const same = buy(env, 'bet', id, true, { reqId: 'click1' });                   // 동일 reqId 재전송
  assert.ok(same.ok && same.duplicate);
  const flip = buy(env, 'bet', id, false, { reqId: 'click3' });                  // 구매 후 '안 샀다' 로 뒤집기 금지
  assert.strictEqual(flip.ok, false);
  assert.strictEqual(JSON.stringify(env.sheet('BET_LOG').grid), snap);
  assert.strictEqual(boughtRows(env, 'BET_LOG'), 1);
  assert.strictEqual(env.get('apiGetMonthly')('2026-10').summary.used, 2000);   // 이중 집계 없음
  // 미구매 후 '샀다' 도 금지 (기록 보존)
  const id2 = recBet(env, { stake: 1000, name: 'Z' }).id;
  assert.ok(buy(env, 'bet', id2, false).ok);
  assert.strictEqual(buy(env, 'bet', id2, true).ok, false);
  assert.strictEqual(env.sheet('BET_LOG').grid[2][16], '미구매');
});
test('34. 구매 확인 목록: 미확인만 표시(날짜/회차·픽·추천금액·배당/조합), 처리 후 사라짐', () => {
  const env = setup(); env.setNow(kst('2026-10-03'));
  const a = recBet(env, { stake: 2000, pick: '홈승', odds: 1.8 }).id, w = recWdl(env, { combo: '보조1', stake: 3000, round: '77' }).id;
  recBet(env, { stake: 1000, name: 'C' });
  buy(env, 'bet', recBet(env, { stake: 1000, name: 'D' }).id);
  const u = env.get('apiGetUnconfirmed');
  let list = u();
  assert.ok(list.ok); assert.strictEqual(list.bets.length, 2); assert.strictEqual(list.wdl.length, 1);
  const bi = list.bets.find(x => x.id === a);
  assert.deepStrictEqual([bi.date, bi.pick, bi.stake, bi.odds], ['2026-10-03', '홈승', 2000, 1.8]);
  assert.deepStrictEqual([list.wdl[0].round, list.wdl[0].combo, list.wdl[0].stake, list.wdl[0].picks], ['77', '보조1', 3000, '승'.repeat(14)]);
  buy(env, 'bet', a, false); buy(env, 'wdl', w, true);
  list = u(); assert.strictEqual(list.bets.length, 1); assert.strictEqual(list.wdl.length, 0);
  // 구매여부가 비어 있는 기존 행은 미확인으로 취급
  env.sheet('BET_LOG').grid[1][16] = '';
  assert.strictEqual(u().bets.length, 2);
});
test('35. 월 귀속은 구매일시 기준(대시보드 수식과 동일), 구매 후 결과 처리는 실구매 성적에 반영', () => {
  const env = setup();
  env.setNow(kst('2026-09-30')); const id = recBet(env, { date: '2026-09-30', stake: 5000 }).id;
  env.setNow(kst('2026-10-01')); assert.ok(buy(env, 'bet', id).ok);              // 9/30 추천, 10/1 구매
  assert.strictEqual(env.get('apiGetMonthly')('2026-09').summary.used, 0);
  assert.strictEqual(env.get('apiGetMonthly')('2026-10').summary.used, 5000);
  env.get('apiResolveBet')({ id, result: '적중', ret: 11000, reqId: 'o1' });
  const s = env.get('apiGetMonthly')('2026-10').summary;
  assert.deepStrictEqual([s.profit, s.roi, s.hitRate], [6000, 120, 100]);
  // 미구매 추천은 결과 처리해도 실구매 성적/예산에 들어가지 않음 (기록은 추천 분석용으로 보존)
  env.setNow(kst('2026-10-02')); const n = recBet(env, { date: '2026-10-02', stake: 5000, name: 'N' }).id;
  buy(env, 'bet', n, false); env.get('apiResolveBet')({ id: n, result: '적중', ret: 10000, reqId: 'o2' });
  const s2 = env.get('apiGetMonthly')('2026-10').summary;
  assert.deepStrictEqual([s2.used, s2.profit, s2.settledStake], [5000, 6000, 5000]);
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 3);
});

/* ---------- 실제 구매일 기준 한도 / 결과 처리 전 구매 확인 ---------- */
test('36. 추천일이 달라도 실제 구매일 합계 6,000원이면 차단 (일 한도는 구매일 기준)', () => {
  const env = setup();
  env.setNow(kst('2026-09-30'));
  const a = recBet(env, { date: '2026-09-30', stake: 3000, name: 'A' }).id;      // 9/30 추천
  const b = recBet(env, { date: '2026-10-02', stake: 3000, name: 'B' }).id;      // 다른 추천일
  env.setNow(kst('2026-10-01'));                                                  // 둘 다 10/1 에 구매 시도
  assert.ok(buy(env, 'bet', a).ok);
  const r = buy(env, 'bet', b);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /일 최대 5,000원 초과: 해당일 구매 3,000원 \+ 신규 3,000원 = 6,000원/);
  assert.deepStrictEqual(env.sheet('BET_LOG').grid[2].slice(16, 19), ['미확인', '', '']);
  const used = env.get('betUsedOn_');
  assert.deepStrictEqual([used('2026-10-01'), used('2026-09-30'), used('2026-10-02')], [3000, 0, 0]);   // 추천일이 아닌 구매일로 집계
});
test('37. 추천일이 서로 달라도 같은 구매일 3,000 + 2,000 = 5,000원 허용', () => {
  const env = setup();
  env.setNow(kst('2026-10-05'));
  const a = recBet(env, { date: '2026-10-01', stake: 3000, name: 'A' }).id;
  const b = recBet(env, { date: '2026-10-02', stake: 2000, name: 'B' }).id;
  const c = recBet(env, { date: '2026-10-03', stake: 1000, name: 'C' }).id;
  assert.ok(buy(env, 'bet', a).ok); assert.ok(buy(env, 'bet', b).ok);
  assert.strictEqual(env.get('betUsedOn_')('2026-10-05'), 5000);
  assert.strictEqual(env.get('apiBootstrap')().todayBetUsed, 5000);
  assert.strictEqual(buy(env, 'bet', c).ok, false);                               // 5,000 초과분은 차단
  assert.strictEqual(env.get('apiGetMonthly')('2026-10').summary.used, 5000);
});
test('38. 구매여부=미확인 기록은 결과 처리 서버 차단 + 결과 처리 목록에서 제외 (일반/승무패)', () => {
  const env = setup(); env.setNow(kst('2026-10-03'));
  const b = recBet(env, { stake: 2000 }).id, w = recWdl(env, { stake: 3000 }).id;
  const msg = '먼저 구매 확인에서 샀다/안 샀다를 처리해주세요.';
  const r1 = env.get('apiResolveBet')({ id: b, result: '적중', ret: 5000, reqId: 'q1' });
  const r2 = env.get('apiResolveWdl')({ id: w, hits: 12, rank: '4등', prize: 9000, reqId: 'q2' });
  assert.deepStrictEqual([r1.ok, r1.error, r2.ok, r2.error], [false, msg, false, msg]);
  assert.deepStrictEqual([env.sheet('BET_LOG').grid[1][9], env.sheet('BET_LOG').grid[1][10]], ['대기', '']);   // 변경 없음
  assert.deepStrictEqual([env.sheet('WDL_LOG').grid[1][20], env.sheet('WDL_LOG').grid[1][21]], ['대기', '']);
  const p = env.get('apiGetPending')(); assert.deepStrictEqual([p.ok, p.bets.length, p.wdl.length], [true, 0, 0]);
  assert.strictEqual(env.get('apiGetUnconfirmed')().bets.length, 1);                // 구매 확인 화면에는 나옴
  buy(env, 'bet', b, false); buy(env, 'wdl', w, true);
  const p2 = env.get('apiGetPending')(); assert.deepStrictEqual([p2.bets.length, p2.wdl.length], [1, 1]);   // 처리 후 결과 처리 목록에 등장
});
test('39. 미구매 추천 결과 처리는 허용, 실제 예산/실구매 ROI 에는 미반영', () => {
  const env = setup(); env.setNow(kst('2026-10-03'));
  const b = recBet(env, { stake: 5000 }).id, w = recWdl(env, { stake: 4000 }).id;
  assert.ok(buy(env, 'bet', b, false).ok); assert.ok(buy(env, 'wdl', w, false).ok);
  const r1 = env.get('apiResolveBet')({ id: b, result: '적중', ret: 11000, reqId: 'u1' });
  const r2 = env.get('apiResolveWdl')({ id: w, hits: 13, rank: '3등', prize: 20000, reqId: 'u2' });
  assert.ok(r1.ok, r1.error); assert.ok(r2.ok, r2.error);
  assert.deepStrictEqual([env.sheet('BET_LOG').grid[1][9], env.sheet('BET_LOG').grid[1][10], env.sheet('BET_LOG').grid[1][11]], ['적중', 11000, 6000]);   // 추천 성적은 기록
  assert.strictEqual(env.sheet('WDL_LOG').grid[1][20], '3등');
  const s = dash(env).summary;
  assert.deepStrictEqual([s.used, s.remain, s.settledStake, s.totalReturn, s.profit, s.roi], [0, 200000, 0, 0, 0, 0]);
  assert.strictEqual(env.get('betUsedOn_')('2026-10-03'), 0);
  assert.deepStrictEqual([env.sheet('BET_LOG').grid[1][16], env.sheet('BET_LOG').grid[1][17]], ['미구매', '']);   // 상태 보존
});
test('40. 구매 추천 결과 처리 정상 (실구매 손익/ROI 반영)', () => {
  const env = setup(); env.setNow(kst('2026-10-03'));
  const b = recBet(env, { stake: 5000 }).id, w = recWdl(env, { stake: 5000 }).id;
  buy(env, 'bet', b, true); buy(env, 'wdl', w, true);
  const before = env.get('apiGetPending')(); assert.deepStrictEqual([before.bets.length, before.wdl.length], [1, 1]);
  assert.strictEqual(before.bets[0].buy, '구매');
  const r1 = env.get('apiResolveBet')({ id: b, result: '적중', ret: 11000, reqId: 'v1' });
  const r2 = env.get('apiResolveWdl')({ id: w, hits: 12, rank: '4등', prize: 9000, reqId: 'v2' });
  assert.ok(r1.ok && r2.ok, JSON.stringify([r1, r2]));
  assert.deepStrictEqual([r1.profit, r1.roi, r2.profit], [6000, 120, 4000]);
  const row = env.sheet('BET_LOG').grid[1];
  assert.deepStrictEqual([row[9], row[10], row[11], row[12]], ['적중', 11000, 6000, 1.2]);
  const s = dash(env).summary;
  assert.deepStrictEqual([s.used, s.settledStake, s.totalReturn, s.profit, s.roi], [10000, 10000, 20000, 10000, 100]);
  const after = env.get('apiGetPending')(); assert.deepStrictEqual([after.bets.length, after.wdl.length], [0, 0]);
});

/* ---------- UI 정리(입력 메뉴 제거) / 리치 자동저장 진입점 ---------- */
const INDEX_HTML = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
const rp = (o = {}) => Object.assign({ requestId: 'rich-' + (++seq) + '-abcdef', type: 'BET', date: '2026-10-05', sport: '축구', league: 'K리그', name: '리치픽' + seq, pick: '홈승', folders: 1, odds: 1.9, stake: 3000, grade: '메인', memo: '' }, o);
const rw = (o = {}) => Object.assign({ requestId: 'rich-' + (++seq) + '-wdl1234', type: 'WDL', round: 'R' + seq, date: '2026-10-05', combo: '주력', games: GAMES, stake: 5000, memo: '' }, o);
test('41. UI: 일반 토토 입력/승무패 입력 메뉴 없음, 구매 확인/결과 처리/월간 성적만 노출', () => {
  const labels = [...INDEX_HTML.matchAll(/<button data-tab="(\w+)"[^>]*>([^<]+)<\/button>/g)].map(m => m[1] + ':' + m[2]);
  assert.deepStrictEqual(labels, ['buy:구매 확인', 'res:결과 처리', 'mon:월간 성적']);
  assert.ok(!/일반 토토 입력|승무패 입력|id="tab-bet"|id="tab-wdl"/.test(INDEX_HTML));
  // 서버 저장 엔진/API 는 그대로 존재
  assert.ok(/function apiSaveBet\(/.test(CODE) && /function apiSaveWdl\(/.test(CODE) && /function saveBet_\(/.test(CODE) && /function saveWdl_\(/.test(CODE));
});
test('42. 리치 BET 단건 저장: 기존 saveBet_ 규칙대로 미확인/대기로 저장', () => {
  const env = setup(); env.setNow(kst('2026-10-05'));
  const r = env.get('apiSaveRichPick')(rp({ requestId: 'rich-single-0001', stake: 4000 }));
  assert.ok(r.ok, r.error); assert.strictEqual(r.duplicate, false); assert.strictEqual(r.type, 'BET'); assert.match(r.id, /^B-/);
  const row = env.sheet('BET_LOG').grid[1];
  assert.deepStrictEqual([row[0], row[8], row[9], row[10], row[11], row[12], row[16], row[17], row[18]], [r.id, 4000, '대기', '', '', '', '미확인', '', '']);
  assert.ok(isDate(row[15]) && isDate(row[1]));
  const s = dash(env).summary; assert.deepStrictEqual([s.used, s.remain], [0, 200000]);   // 구매 전에는 예산 미사용
});
test('43. 리치 저장도 saveBet_/saveWdl_ 검증을 그대로 적용 (행 생성 없음)', () => {
  const env = setup(); const f = env.get('apiSaveRichPick');
  assert.match(f(rp({ stake: 0 })).error, /0원보다/);
  assert.match(f(rp({ odds: 0.5 })).error, /총배당/);
  assert.match(f(rp({ sport: '골프' })).error, /종목/);
  assert.match(f(rp({ name: '' })).error, /경기\/조합명/);
  const g = GAMES.slice(); g[6] = '';
  assert.strictEqual(f(rw({ games: g })).error, '7경기의 승/무/패를 선택해주세요.');
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 1); assert.strictEqual(env.sheet('WDL_LOG').getLastRow(), 1);
  const nm = f(rp({ name: '=HYPERLINK("x")' })); assert.ok(nm.ok);
  assert.strictEqual(env.sheet('BET_LOG').grid[1][4], "'=HYPERLINK(\"x\")");   // 수식 주입 방지 유지
  assert.ok(f(rw({ requestId: 'rich-wdl-ok-0001' })).ok);
  assert.deepStrictEqual(env.sheet('WDL_LOG').grid[1].slice(25, 28), ['미확인', '', '']);
});
test('44. 동일 requestId 재요청은 중복 행 없음, 다른 requestId 는 신규 저장', () => {
  const env = setup(); const f = env.get('apiSaveRichPick');
  const p = rp({ requestId: 'rich-dup-000001' });
  const a = f(p), b = f(p), c = f(Object.assign({}, p, { stake: 1000 }));   // 같은 requestId, 내용이 달라도 기존 결과 반환
  assert.ok(a.ok && b.ok && c.ok);
  assert.deepStrictEqual([a.duplicate, b.duplicate, c.duplicate], [false, true, true]);
  assert.ok(a.id === b.id && b.id === c.id);
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 2);
  assert.strictEqual(env.sheet('BET_LOG').grid[1][8], 3000);                 // 최초 저장값 유지
  const d = f(rp({ requestId: 'rich-dup-000002' }));
  assert.ok(d.ok && !d.duplicate && d.id !== a.id); assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 3);
  // 같은 requestId 를 다른 유형에 쓰면 거절
  assert.match(f(rw({ requestId: 'rich-dup-000001' })).error, /다른 유형/);
  // 해당 행을 지웠다면(정리) 같은 requestId 로 다시 저장 가능
  env.sheet('BET_LOG').grid.splice(1, 1);
  const e = f(p); assert.ok(e.ok && !e.duplicate);
});
test('45. 배치 저장: 일부 오류여도 정상 건 저장, failed 반환, 재전송 시 중복 없음', () => {
  const env = setup(); const f = env.get('apiSaveRichPicks');
  const picks = [rp({ requestId: undefined, name: 'P1' }), rp({ requestId: undefined, name: 'P2', stake: 0 }), rp({ requestId: undefined, name: 'P3' })].map(x => { delete x.requestId; return x; });
  const r = f({ requestId: 'rich-batch-0001', picks });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual([r.savedCount, r.failedCount], [2, 1]);
  assert.deepStrictEqual([...r.saved.map(x => x.index)], [1, 3]);
  assert.deepStrictEqual([r.failed[0].index, r.failed[0].type], [2, 'BET']); assert.match(r.failed[0].error, /0원보다/);
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 3);
  const again = f({ requestId: 'rich-batch-0001', picks });                       // 전체 재전송
  assert.deepStrictEqual([again.savedCount, again.failedCount], [2, 1]);
  assert.ok(again.saved.every(x => x.duplicate));
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 3);                       // 중복 행 없음
  picks[1].stake = 2000;                                                          // 오류 건만 고쳐 같은 batch 로 재전송
  const fixed = f({ requestId: 'rich-batch-0001', picks });
  assert.deepStrictEqual([fixed.savedCount, fixed.failedCount], [3, 0]);
  assert.deepStrictEqual([...fixed.saved.map(x => x.duplicate)], [true, false, true]);
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 4);
  // 전부 실패하면 ok:false
  const none = f({ requestId: 'rich-batch-0002', picks: [rp({ stake: 0 })] });
  assert.strictEqual(none.ok, false); assert.strictEqual(none.failedCount, 1);
});
test('46. 배치에 BET/WDL 혼합 + 개별 requestId 사용', () => {
  const env = setup(); const f = env.get('apiSaveRichPicks');
  const g = GAMES.slice(); g[0] = '';
  const r = f({ requestId: 'rich-mix-000001', picks: [rp({ requestId: 'rich-own-bet-01' }), rw({ requestId: 'rich-own-wdl-01' }), rw({ games: g, requestId: 'rich-own-wdl-02', round: 'R9' })] });
  assert.ok(r.ok); assert.deepStrictEqual([...r.saved.map(x => x.type)], ['BET', 'WDL']); assert.strictEqual(r.failed[0].error, '1경기의 승/무/패를 선택해주세요.');
  assert.deepStrictEqual([env.sheet('BET_LOG').getLastRow(), env.sheet('WDL_LOG').getLastRow()], [2, 2]);
  const again = f({ requestId: 'rich-mix-other-1', picks: [rp({ requestId: 'rich-own-bet-01' })] });   // 개별 requestId 가 같으면 다른 batch 에서도 중복 방지
  assert.ok(again.saved[0].duplicate); assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 2);
});
test('47. 자동저장 픽: 구매 확인 목록에 노출, 결과 처리 목록엔 미노출, 구매일 기준 한도 그대로', () => {
  const env = setup(); env.setNow(kst('2026-10-05'));
  const r = env.get('apiSaveRichPicks')({ requestId: 'rich-flow-00001', picks: [rp({ requestId: 'rich-flow-bet-01', date: '2026-10-01', stake: 3000, name: 'F1' }), rp({ requestId: 'rich-flow-bet-02', date: '2026-10-02', stake: 3000, name: 'F2' }), rw({ requestId: 'rich-flow-wdl-01', stake: 4000 })] });
  assert.strictEqual(r.savedCount, 3);
  const u = env.get('apiGetUnconfirmed')(); assert.deepStrictEqual([u.bets.length, u.wdl.length], [2, 1]);
  const p = env.get('apiGetPending')(); assert.deepStrictEqual([p.bets.length, p.wdl.length], [0, 0]);
  const [a, b] = r.saved;
  assert.match(env.get('apiResolveBet')({ id: a.id, result: '적중', ret: 5000, reqId: 'z1' }).error, /먼저 구매 확인/);
  assert.ok(buy(env, 'bet', a.id).ok);
  const blocked = buy(env, 'bet', b.id);                                           // 추천일이 달라도 구매일(10/5) 합계 6,000 → 차단
  assert.strictEqual(blocked.ok, false); assert.match(blocked.error, /일 최대 5,000원 초과: 해당일 구매 3,000원 \+ 신규 3,000원 = 6,000원/);
  assert.ok(buy(env, 'bet', b.id, false).ok);
  assert.strictEqual(env.get('apiGetMonthly')('2026-10').summary.used, 3000);
  const p2 = env.get('apiGetPending')(); assert.deepStrictEqual([p2.bets.length, p2.wdl.length], [2, 0]);   // 구매/미구매 처리 후에만 결과 처리 목록에 노출
});
test('48. 토큰: Script Property RICH_API_TOKEN 설정 시 일치해야 저장 (미설정이면 기존 동작)', () => {
  const env = setup(); const f = env.get('apiSaveRichPick'), fb = env.get('apiSaveRichPicks');
  assert.ok(f(rp()).ok);                                                           // 토큰 미설정: 허용(웹앱 자체가 본인 전용)
  env.props['RICH_API_TOKEN'] = 'secret-test-token';
  const n0 = env.sheet('BET_LOG').getLastRow();
  assert.deepStrictEqual([f(rp()).error, f(rp({ token: 'wrong' })).error, fb({ requestId: 'rich-tok-000001', picks: [rp()] }).error], ['인증에 실패했습니다.', '인증에 실패했습니다.', '인증에 실패했습니다.']);
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), n0);
  assert.ok(f(rp({ token: 'secret-test-token' })).ok);
  assert.strictEqual(fb({ requestId: 'rich-tok-000002', token: 'secret-test-token', picks: [rp()] }).savedCount, 1);
  assert.ok(!/secret-test-token/.test(JSON.stringify(env.sheet('BET_LOG').grid)));  // 토큰은 시트에 기록되지 않음
});
test('49. 요청 검증: requestId 필수/형식, picks 비어있음/20건 초과, type 오류', () => {
  const env = setup(); const f = env.get('apiSaveRichPick'), fb = env.get('apiSaveRichPicks');
  assert.match(f(rp({ requestId: '' })).error, /requestId/);
  assert.match(f(rp({ requestId: 'short' })).error, /requestId/);
  assert.match(f(rp({ requestId: 'has space 12345' })).error, /requestId/);
  assert.match(f(rp({ type: 'ETC' })).error, /type/);
  assert.match(fb({ requestId: 'rich-empty-0001', picks: [] }).error, /1건 이상/);
  assert.match(fb({ requestId: 'rich-big-00001', picks: Array(21).fill(0).map(() => rp()) }).error, /최대 20건/);
  assert.match(fb({ picks: [rp()] }).error, /requestId/);
  assert.deepStrictEqual([env.sheet('BET_LOG').getLastRow(), env.sheet('WDL_LOG').getLastRow()], [1, 1]);
  assert.strictEqual(fb({ requestId: 'rich-badtype-01', picks: [rp({ type: 'XX' })] }).failed[0].error, 'type 은 BET, WDL 또는 WDL_MULTI 이어야 합니다.');
});

/* ---------- Rich Bridge: RICH_INBOX → processRichInbox_ ---------- */
const INBOX_HEAD = ['requestId', 'createdAt', 'payloadJson', 'status', 'processedAt', 'resultId', 'resultType', 'error'];
const bridgeEnv = () => { const env = setup(); env.setNow(kst('2026-10-05')); env.get('setupRichBridge')(); return env; };
const ago = (env, min) => env.ctx.Utilities.formatDate(new Date(kst('2026-10-05').getTime() - min * 60000), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
const inboxAdd = (env, id, payload, status = 'PENDING', extra = {}) => {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(Object.assign({ requestId: id }, payload));
  env.sheet('RICH_INBOX').grid.push([id, extra.createdAt || ago(env, 1), raw, status, extra.processedAt || '', '', '', '']);
  return env.sheet('RICH_INBOX').grid.length - 1;
};
const betPayload = (o = {}) => { const x = rp(o); delete x.requestId; return x; };
const wdlPayload = (o = {}) => { const x = rw(o); delete x.requestId; return x; };
const inboxRow = (env, i) => env.sheet('RICH_INBOX').grid[i];
const runInbox = env => env.get('processRichInbox_')();

test('50. setupRichBridge: RICH_INBOX 생성(헤더/숨김/텍스트 서식/상태 검증), 기존 시트 구조 불변', () => {
  const env = setup();
  const before = JSON.stringify([env.sheet('BET_LOG').grid[0], env.sheet('WDL_LOG').grid[0], env.sheet('SETTINGS').grid]);
  assert.ok(!env.sheet('RICH_INBOX'));
  env.get('setupRichBridge')();
  const sh = env.sheet('RICH_INBOX');
  assert.ok(sh); assert.deepStrictEqual([...sh.grid[0]], INBOX_HEAD);
  assert.strictEqual(sh._hidden, true);
  assert.ok(sh.calls.some(c => c[0] === 'setNumberFormat' && c[2] === '@'));
  assert.ok(sh.calls.some(c => c[0] === 'setDataValidation'));
  assert.strictEqual(JSON.stringify([env.sheet('BET_LOG').grid[0], env.sheet('WDL_LOG').grid[0], env.sheet('SETTINGS').grid]), before);
  assert.strictEqual(env.triggers.length, 1);
  assert.deepStrictEqual([env.triggers[0].fn, env.triggers[0].every], ['processRichInbox', 1]);
  // 헤더가 다른 기존 RICH_INBOX 는 덮어쓰지 않고 중단
  const env2 = setup(); env2.get('setupRichBridge')(); env2.sheet('RICH_INBOX').grid[0][2] = 'payload';
  assert.throws(() => env2.get('setupRichBridge')(), /헤더가 예상과 다릅니다/);
});
test('51. setupRichBridge 재실행: 트리거 중복 없음(중복 있으면 정리), removeRichBridgeTrigger', () => {
  const env = setup();
  for (let i = 0; i < 3; i++) env.get('setupRichBridge')();
  assert.strictEqual(env.triggers.length, 1);
  env.ctx.ScriptApp.newTrigger('processRichInbox').timeBased().everyMinutes(1).create();   // 수동으로 중복 생성된 상황
  env.ctx.ScriptApp.newTrigger('otherFn').timeBased().everyMinutes(5).create();
  assert.strictEqual(env.triggers.length, 3);
  env.get('setupRichBridge')();
  assert.strictEqual(env.triggers.filter(t => t.fn === 'processRichInbox').length, 1);
  assert.strictEqual(env.triggers.filter(t => t.fn === 'otherFn').length, 1);           // 다른 트리거는 건드리지 않음
  env.get('removeRichBridgeTrigger')();
  assert.strictEqual(env.triggers.filter(t => t.fn === 'processRichInbox').length, 0);
});
test('52. 정상 BET PENDING 행 → DONE, BET_LOG 저장(미확인/대기)', () => {
  const env = bridgeEnv();
  const i = inboxAdd(env, 'rich-20261005-abcd1234', betPayload({ stake: 3000, name: '울산 vs 전북' }));
  const out = runInbox(env);
  assert.deepStrictEqual([out.processed, out.done, out.error], [1, 1, 0]);
  const bet = env.sheet('BET_LOG').grid[1], r = inboxRow(env, i);
  assert.deepStrictEqual([r[3], r[6], r[7]], ['DONE', 'BET', '']);
  assert.strictEqual(r[5], bet[0]); assert.match(r[4], /^2026-10-05 12:00:00$/);   // 한국시간 문자열
  assert.deepStrictEqual([bet[8], bet[9], bet[10], bet[16], bet[17], bet[18]], [3000, '대기', '', '미확인', '', '']);
  assert.strictEqual(env.get('apiGetUnconfirmed')().bets.length, 1);
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 2);
  assert.strictEqual(runInbox(env).processed, 0);                                   // DONE 은 다시 처리하지 않음
});
test('53. 정상 WDL PENDING 행 → DONE, WDL_LOG 저장', () => {
  const env = bridgeEnv();
  const i = inboxAdd(env, 'rich-wdl-pending-1', wdlPayload({ round: '77', combo: '보조1', stake: 3000 }));
  runInbox(env);
  const r = inboxRow(env, i), w = env.sheet('WDL_LOG').grid[1];
  assert.deepStrictEqual([r[3], r[6], r[5] === w[0]], ['DONE', 'WDL', true]);
  assert.deepStrictEqual([w[1], w[3], w[18], w[20], w[25], w[26], w[27]], ['77', '보조1', 3000, '대기', '미확인', '', '']);
  assert.strictEqual(env.get('apiGetUnconfirmed')().wdl.length, 1);
});
test('54. 잘못된 JSON → ERROR, 다음 정상 행은 계속 처리', () => {
  const env = bridgeEnv();
  const bad = inboxAdd(env, 'rich-badjson-0001', '{"type":"BET", broken');
  const ok = inboxAdd(env, 'rich-after-bad-001', betPayload());
  const arr = inboxAdd(env, 'rich-array-json-01', '[1,2]');
  const out = runInbox(env);
  assert.deepStrictEqual([out.done, out.error], [1, 2]);
  assert.deepStrictEqual([inboxRow(env, bad)[3], inboxRow(env, ok)[3], inboxRow(env, arr)[3]], ['ERROR', 'DONE', 'ERROR']);
  assert.match(inboxRow(env, bad)[7], /JSON/); assert.match(inboxRow(env, bad)[4], /^\d{4}-/);
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 2);
  const mism = inboxAdd(env, 'rich-mismatch-0001', JSON.stringify(Object.assign({ requestId: 'rich-other-id-0001' }, betPayload())));
  runInbox(env); assert.match(inboxRow(env, mism)[7], /requestId/);
});
test('55. 검증 실패 payload → ERROR, BET_LOG/WDL_LOG 행 없음, 오류 문구 기록', () => {
  const env = bridgeEnv();
  const g = GAMES.slice(); g[6] = '';
  const rows = [inboxAdd(env, 'rich-stake-zero-01', betPayload({ stake: 0 })), inboxAdd(env, 'rich-odds-low-0001', betPayload({ odds: 0.3 })),
    inboxAdd(env, 'rich-wdl-missing-1', wdlPayload({ games: g })), inboxAdd(env, 'rich-type-bad-0001', { type: 'ETC' }),
    inboxAdd(env, 'short', betPayload()), inboxAdd(env, 'rich-empty-payload1', '')];
  const out = runInbox(env);
  assert.deepStrictEqual([out.done, out.error], [0, 6]);
  assert.deepStrictEqual([env.sheet('BET_LOG').getLastRow(), env.sheet('WDL_LOG').getLastRow()], [1, 1]);
  const errs = rows.map(i => inboxRow(env, i)[7]);
  assert.match(errs[0], /0원보다/); assert.match(errs[1], /총배당/); assert.strictEqual(errs[2], '7경기의 승/무/패를 선택해주세요.');
  assert.match(errs[3], /type/); assert.match(errs[4], /requestId/); assert.match(errs[5], /비어/);
  assert.ok(rows.every(i => inboxRow(env, i)[3] === 'ERROR' && inboxRow(env, i)[5] === ''));
});
test('56. 같은 requestId 가 Inbox 에 두 번 → 장부 저장 1건, 둘 다 같은 ID 로 DONE(duplicate)', () => {
  const env = bridgeEnv();
  const a = inboxAdd(env, 'rich-same-req-0001', betPayload({ stake: 2000 }));
  const b = inboxAdd(env, 'rich-same-req-0001', betPayload({ stake: 2000 }));
  const out = runInbox(env);
  assert.deepStrictEqual([out.done, out.duplicate, out.error], [2, 1, 0]);
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 2);
  assert.deepStrictEqual([inboxRow(env, a)[3], inboxRow(env, b)[3]], ['DONE', 'DONE']);
  assert.strictEqual(inboxRow(env, a)[5], inboxRow(env, b)[5]);
  assert.strictEqual(inboxRow(env, b)[7], '');                                       // 중복은 ERROR 가 아님
  const c = inboxAdd(env, 'rich-same-req-0001', betPayload({ stake: 2000 }));          // 나중에 다시 들어와도 동일
  runInbox(env); assert.strictEqual(inboxRow(env, c)[3], 'DONE'); assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 2);
});
test('57. 저장 성공 후 DONE 기록 전 중단 → 다음 실행에서 중복 저장 없이 복구', () => {
  const env = bridgeEnv();
  const i = inboxAdd(env, 'rich-crash-after-1', betPayload({ stake: 4000 }));
  // 결함 주입: Inbox 의 DONE 기록 시도에서만 예외 발생(저장은 이미 끝난 상태)
  const sh = env.sheet('RICH_INBOX'); const origGetRange = sh.getRange;
  sh.getRange = (r, c, nr, nc) => {
    const rng = origGetRange(r, c, nr, nc);
    return new Proxy(rng, { get: (t, k) => k === 'setValues' ? (v) => { if (v[0][0] === 'DONE') throw new Error('simulated crash'); return t.setValues(v); } : t[k] });
  };
  const first = runInbox(env);
  assert.strictEqual(first.writeFailed, 1);
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 2);                          // 장부에는 저장됨
  assert.strictEqual(inboxRow(env, i)[3], 'PROCESSING');                             // Inbox 는 PROCESSING 으로 남음
  const savedId = env.sheet('BET_LOG').grid[1][0];
  sh.getRange = origGetRange;                                                        // 장애 해소
  assert.strictEqual(runInbox(env).processed, 0);                                    // 10분 전에는 건드리지 않음
  env.setNow(new Date(kst('2026-10-05').getTime() + 11 * 60000));                    // 11분 경과
  const second = runInbox(env);
  assert.deepStrictEqual([second.recovered, second.done, second.duplicate], [1, 1, 1]);
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 2);                          // 중복 저장 없음
  assert.deepStrictEqual([inboxRow(env, i)[3], inboxRow(env, i)[5], inboxRow(env, i)[6]], ['DONE', savedId, 'BET']);
});
test('58. 오래된 PROCESSING 행(10분 이상) 복구', () => {
  const env = bridgeEnv();
  const a = inboxAdd(env, 'rich-stale-proc-001', betPayload(), 'PROCESSING', { processedAt: ago(env, 11), createdAt: ago(env, 30) });
  const b = inboxAdd(env, 'rich-stale-proc-002', betPayload(), 'PROCESSING', { createdAt: ago(env, 20) });   // 시작 시각이 비어 있으면 createdAt 기준
  const out = runInbox(env);
  assert.deepStrictEqual([out.recovered, out.done], [2, 2]);
  assert.deepStrictEqual([inboxRow(env, a)[3], inboxRow(env, b)[3]], ['DONE', 'DONE']);
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 3);
});
test('59. 최근 PROCESSING 행은 건드리지 않음', () => {
  const env = bridgeEnv();
  const a = inboxAdd(env, 'rich-fresh-proc-001', betPayload(), 'PROCESSING', { processedAt: ago(env, 2), createdAt: ago(env, 30) });
  const out = runInbox(env);
  assert.deepStrictEqual([out.processed, out.recovered], [0, 0]);
  assert.strictEqual(inboxRow(env, a)[3], 'PROCESSING'); assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 1);
});
test('60. ERROR/DONE 행은 자동 재처리하지 않음', () => {
  const env = bridgeEnv();
  const e = inboxAdd(env, 'rich-err-noretry-01', betPayload(), 'ERROR', { processedAt: ago(env, 100) });
  const d = inboxAdd(env, 'rich-done-noretry-1', betPayload(), 'DONE', { processedAt: ago(env, 100) });
  const u = inboxAdd(env, 'rich-unknown-stat-1', betPayload(), 'pending');   // 정확히 PENDING 이 아니면 처리 안 함
  const out = runInbox(env);
  assert.strictEqual(out.processed, 0);
  assert.deepStrictEqual([inboxRow(env, e)[3], inboxRow(env, d)[3], inboxRow(env, u)[3]], ['ERROR', 'DONE', 'pending']);
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 1);
});
test('61. 한 실행 최대 20건 처리', () => {
  const env = bridgeEnv();
  const idx = []; for (let n = 1; n <= 25; n++) idx.push(inboxAdd(env, 'rich-max-run-' + String(n).padStart(4, '0'), betPayload({ stake: 1000, name: 'M' + n })));
  const first = runInbox(env);
  assert.deepStrictEqual([first.processed, first.done], [20, 20]);
  assert.strictEqual(idx.filter(i => inboxRow(env, i)[3] === 'DONE').length, 20);
  assert.strictEqual(idx.filter(i => inboxRow(env, i)[3] === 'PENDING').length, 5);
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 21);
  const second = runInbox(env);
  assert.deepStrictEqual([second.processed, second.done], [5, 5]);
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 26);
});
test('62. 수식 주입 방지: 장부 텍스트 이스케이프 + Inbox 는 텍스트 서식으로만 기록, 수식 셀은 거부', () => {
  const env = bridgeEnv();
  const a = inboxAdd(env, 'rich-inject-ok-0001', betPayload({ name: '=HYPERLINK("http://x")', pick: '@SUM(1)', memo: '+1+1' }));
  const f = inboxAdd(env, 'rich-inject-formula1', '=1+1');                           // payloadJson 셀이 수식으로 입력된 경우
  const j = inboxAdd(env, 'rich-inject-badjson1', '=cmd|bad');
  env.sheet('RICH_INBOX').calls.length = 0;
  runInbox(env);
  const bet = env.sheet('BET_LOG').grid[1];
  assert.deepStrictEqual([bet[4], bet[5], bet[14]], ["'=HYPERLINK(\"http://x\")", "'@SUM(1)", "'+1+1"]);
  assert.strictEqual(inboxRow(env, a)[3], 'DONE');
  assert.deepStrictEqual([inboxRow(env, f)[3], inboxRow(env, j)[3]], ['ERROR', 'ERROR']);
  assert.match(inboxRow(env, f)[7], /수식/);
  const calls = env.sheet('RICH_INBOX').calls;
  assert.ok(calls.filter(c => c[0] === 'setNumberFormat' && c[2] === '@').length >= 6);   // 행마다 기록 전 텍스트 서식 지정
  assert.ok(inboxRow(env, a).every(v => typeof v === 'string'));
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 2);
});
test('63. 회귀: Inbox 저장 픽도 구매일 기준 한도/구매 확인/결과 처리 규칙을 그대로 따름', () => {
  const env = bridgeEnv();
  inboxAdd(env, 'rich-regress-bet-01', betPayload({ date: '2026-10-01', stake: 3000, name: 'R1' }));
  inboxAdd(env, 'rich-regress-bet-02', betPayload({ date: '2026-10-02', stake: 3000, name: 'R2' }));
  runInbox(env);
  const ids = [env.sheet('BET_LOG').grid[1][0], env.sheet('BET_LOG').grid[2][0]];
  const p0 = env.get('apiGetPending')(); assert.deepStrictEqual([p0.bets.length, p0.wdl.length], [0, 0]);   // 미확인은 결과 처리 목록 제외
  assert.match(env.get('apiResolveBet')({ id: ids[0], result: '적중', ret: 5000, reqId: 'g1' }).error, /먼저 구매 확인/);
  assert.ok(buy(env, 'bet', ids[0]).ok);
  const blocked = buy(env, 'bet', ids[1]);
  assert.strictEqual(blocked.ok, false); assert.match(blocked.error, /일 최대 5,000원 초과: 해당일 구매 3,000원 \+ 신규 3,000원 = 6,000원/);
  assert.ok(buy(env, 'bet', ids[1], false).ok);
  const r = env.get('apiResolveBet')({ id: ids[0], result: '적중', ret: 6000, reqId: 'g2' });
  assert.deepStrictEqual([r.ok, r.profit, r.roi], [true, 3000, 100]);
  const s = env.get('apiGetMonthly')('2026-10').summary;
  assert.deepStrictEqual([s.used, s.profit, s.roi], [3000, 3000, 100]);
  // diagnoseSetup: 브리지 설치 후 정상 문구, 트리거 중복/누락 시 문제 보고, 미설치 시 기존 문구 유지
  assert.strictEqual(env.get('diagnoseSetup')(), '리치 베팅 장부 V1 환경 정상 / Rich Bridge 정상');
  env.ctx.ScriptApp.newTrigger('processRichInbox').timeBased().everyMinutes(1).create();
  assert.match(env.get('diagnoseSetup')(), /중복/);
  env.get('removeRichBridgeTrigger')();
  assert.match(env.get('diagnoseSetup')(), /트리거 "processRichInbox"가 없습니다/);
  env.sheet('RICH_INBOX').grid[0][3] = 'state'; env.get('setupRichBridge') && env.ctx.ScriptApp.newTrigger('processRichInbox').timeBased().everyMinutes(1).create();
  assert.match(env.get('diagnoseSetup')(), /RICH_INBOX 4열 헤더/);
  assert.strictEqual(setup().get('diagnoseSetup')(), '리치 베팅 장부 V1 환경 정상');
});

/* ---------- 혼합 종목 정규화 / 구매일 한도 회귀 / RESULT Bridge / 읽기 최적화 ---------- */
const inboxJson = (env, id, obj, status = 'PENDING') => inboxAdd(env, id, Object.assign({ requestId: id }, obj), status);
const resultPayload = (id, o = {}) => Object.assign({ action: 'RESULT', targetType: 'BET', targetId: id, checkedAt: '2026-10-06 05:10:00',
  source: [{ name: '공식 경기결과', url: 'https://example.com/result?id=1' }] }, o);
// 구매 완료된 BET / WDL 만들기 (Rich 저장 → 샀다)
const boughtBet = (env, o = {}, day = '2026-10-05') => { env.setNow(kst(day)); const r = env.get('apiSaveRichPick')(rp(o)); assert.ok(r.ok, r.error); assert.ok(buy(env, 'bet', r.id).ok); return r.id; };
const boughtWdl = (env, o = {}, day = '2026-10-05') => { env.setNow(kst(day)); const r = env.get('apiSaveRichPick')(rw(o)); assert.ok(r.ok, r.error); assert.ok(buy(env, 'wdl', r.id).ok); return r.id; };
const betRow = (env, id) => env.sheet('BET_LOG').grid.slice(1).find(r => r[0] === id);
const wdlRow = (env, id) => env.sheet('WDL_LOG').grid.slice(1).find(r => r[0] === id);

test('64. 실제 사례: sport="혼합" → "기타"로 정규화되어 정상 저장 (Rich API / Inbox)', () => {
  const env = bridgeEnv();
  const r = env.get('apiSaveRichPick')(rp({ requestId: 'rich-mixed-sport-01', sport: '혼합', name: '6486 패 + 6580 승', stake: 3000 }));
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual([betRow(env, r.id)[2], betRow(env, r.id)[16]], ['기타', '미확인']);
  const i = inboxAdd(env, 'rich-20261005-proto118-6486-6580', { requestId: 'rich-20261005-proto118-6486-6580', type: 'BET', date: '2026-10-05', sport: '혼합',
    league: '프로토 승부식 118회차', name: '6486 패 + 6580 승', pick: '6486 패 + 6580 승', folders: 2, odds: 3.1, stake: 3000, grade: '메인', memo: '' });
  runInbox(env);
  assert.deepStrictEqual([inboxRow(env, i)[3], inboxRow(env, i)[7]], ['DONE', '']);
  assert.strictEqual(betRow(env, inboxRow(env, i)[5])[2], '기타');
  // saveBet_ 최종 검증 자체는 그대로: Rich 경로 밖의 직접 저장은 '혼합'을 허용하지 않음
  assert.match(env.get('apiSaveBet')({ date: '2026-10-05', sport: '혼합', league: '', name: 'x', pick: '', folders: 1, odds: 2, stake: 1000, grade: '메인', reqId: 'direct-mixed-1' }).error, /종목/);
  // 앞뒤 공백이 있어도 alias 처리, WDL 에는 영향 없음
  assert.ok(env.get('apiSaveRichPick')(rp({ sport: ' 혼합 ' })).ok);
});
test('65. 임의의 잘못된 sport 는 여전히 ERROR (허용값 안내 포함)', () => {
  const env = bridgeEnv();
  const msg = '종목: 허용되지 않은 값입니다. 허용값: 축구, 야구, 농구, 배구, 기타';
  assert.strictEqual(env.get('apiSaveRichPick')(rp({ sport: '골프' })).error, msg);
  assert.strictEqual(env.get('apiSaveRichPick')(rp({ sport: '혼합경기' })).error, msg);       // 부분 일치는 alias 아님
  assert.strictEqual(env.get('apiSaveRichPick')(rp({ sport: '' })).error, msg);
  const i = inboxJson(env, 'rich-bad-sport-0001', betPayload({ sport: 'e스포츠' }));
  runInbox(env);
  assert.deepStrictEqual([inboxRow(env, i)[3], inboxRow(env, i)[7]], ['ERROR', msg]);
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 1);
});
test('66. 일 구매 2,000 → 3,000: 둘 다 성공 (추천 합계/미구매/미확인은 한도에 불포함)', () => {
  const env = setup(); env.setNow(kst('2026-10-05'));
  recBet(env, { stake: 4000, name: '미확인대기' });                                    // 미확인 4,000 (구매 전)
  const skipped = recBet(env, { stake: 5000, name: '안샀음' }).id; assert.ok(buy(env, 'bet', skipped, false).ok);   // 미구매 5,000
  const a = recBet(env, { stake: 2000, name: 'A' }).id, b = recBet(env, { stake: 3000, name: 'B' }).id;
  assert.ok(buy(env, 'bet', a).ok);
  const r = buy(env, 'bet', b); assert.ok(r.ok, r.error);                              // 합계 정확히 5,000 → 허용
  assert.strictEqual(env.get('betUsedOn_')('2026-10-05'), 5000);
  assert.strictEqual(buy(env, 'bet', recBet(env, { stake: 1, name: 'C' }).id).ok, false);   // 5,001 부터 차단
});
test('67. 일 구매 3,000 → 2,000: 둘 다 성공', () => {
  const env = setup(); env.setNow(kst('2026-10-05'));
  const a = recBet(env, { stake: 3000, name: 'A' }).id, b = recBet(env, { stake: 2000, name: 'B' }).id;
  assert.ok(buy(env, 'bet', a).ok); assert.ok(buy(env, 'bet', b).ok);
  assert.strictEqual(env.get('apiGetMonthly')('2026-10').summary.used, 5000);
});
test('68. 일 구매 2,000 → 3,001: 두 번째 차단 (구매일 buyAt 기준, 추천일 무관)', () => {
  const env = setup(); env.setNow(kst('2026-10-05'));
  const a = recBet(env, { stake: 2000, date: '2026-10-01', name: 'A' }).id, b = recBet(env, { stake: 3001, date: '2026-10-09', name: 'B' }).id;
  assert.ok(buy(env, 'bet', a).ok);
  const r = buy(env, 'bet', b);
  assert.strictEqual(r.ok, false); assert.match(r.error, /일 최대 5,000원 초과: 해당일 구매 2,000원 \+ 신규 3,001원 = 5,001원/);
  assert.deepStrictEqual([...betRow(env, b).slice(16, 19)], ['미확인', '', '']);
});
test('76. RESULT: 구매한 BET 적중 처리 (기존 resolveBet_ 로 손익/ROI 계산)', () => {
  const env = bridgeEnv(); const id = boughtBet(env, { stake: 5000 });
  const i = inboxJson(env, 'rich-result-20261006-0001', resultPayload(id, { result: '적중', ret: 11000 }));
  const out = runInbox(env);
  assert.deepStrictEqual([out.done, out.error], [1, 0]);
  const r = inboxRow(env, i);
  assert.deepStrictEqual([r[3], r[5], r[6], r[7]], ['DONE', id, 'BET_RESULT', '']);
  const row = betRow(env, id);
  assert.deepStrictEqual([row[9], row[10], row[11], row[12]], ['적중', 11000, 6000, 1.2]);
  const s = dash(env).summary; assert.deepStrictEqual([s.profit, s.roi, s.hitRate], [6000, 120, 100]);
  // 적중인데 반환금이 없으면 기존 규칙대로 거절
  const id2 = boughtBet(env, { stake: 1000, date: '2026-10-05', name: 'Z' }, '2026-10-06');
  const j = inboxJson(env, 'rich-result-20261006-0002', resultPayload(id2, { result: '적중' })); runInbox(env);
  assert.match(inboxRow(env, j)[7], /적중은\(는\) 실제 반환금\(원금 포함\)/); assert.strictEqual(betRow(env, id2)[9], '대기');
});
test('77. RESULT: 구매한 BET 미적중 처리 (반환금 0, 손익 -베팅금액)', () => {
  const env = bridgeEnv(); const id = boughtBet(env, { stake: 5000 });
  const i = inboxJson(env, 'rich-result-miss-00001', resultPayload(id, { result: '미적중' }));
  runInbox(env);
  assert.strictEqual(inboxRow(env, i)[3], 'DONE');
  const row = betRow(env, id); assert.deepStrictEqual([row[9], row[10], row[11], row[12]], ['미적중', 0, -5000, -1]);
  const c = boughtBet(env, { stake: 2000, name: 'C' }, '2026-10-06'); inboxJson(env, 'rich-result-cancel-001', resultPayload(c, { result: '취소' })); runInbox(env);
  assert.deepStrictEqual([betRow(env, c)[9], betRow(env, c)[10], betRow(env, c)[11]], ['취소', 2000, 0]);   // 취소 기본 반환금 = 실제 베팅금액
});
test('78. RESULT: 미구매/미확인/없는 대상은 거절 (장부 불변)', () => {
  const env = bridgeEnv();
  const skipped = env.get('apiSaveRichPick')(rp({ name: '안샀음' })).id; assert.ok(buy(env, 'bet', skipped, false).ok);
  const pending = env.get('apiSaveRichPick')(rp({ name: '미확인' })).id;
  const a = inboxJson(env, 'rich-result-skipped-01', resultPayload(skipped, { result: '적중', ret: 9000 }));
  const b = inboxJson(env, 'rich-result-pending-01', resultPayload(pending, { result: '미적중' }));
  const c = inboxJson(env, 'rich-result-missing-01', resultPayload('B-20260101-NOTEXIST', { result: '미적중' }));
  const d = inboxJson(env, 'rich-result-badtype-01', resultPayload(skipped, { targetType: 'ETC', result: '미적중' }));
  const e = inboxJson(env, 'rich-result-noaction-1', { action: 'DELETE' });
  runInbox(env);
  assert.strictEqual(inboxRow(env, a)[7], '구매하지 않은 베팅은 결과 처리할 수 없습니다.');
  assert.strictEqual(inboxRow(env, b)[7], '구매하지 않은 베팅은 결과 처리할 수 없습니다.');
  assert.strictEqual(inboxRow(env, c)[7], '대상 ID를 찾을 수 없습니다.');
  assert.match(inboxRow(env, d)[7], /targetType/); assert.match(inboxRow(env, e)[7], /action/);
  assert.ok([a, b, c, d, e].every(i => inboxRow(env, i)[3] === 'ERROR' && inboxRow(env, i)[5] === ''));
  assert.deepStrictEqual([betRow(env, skipped)[9], betRow(env, pending)[9]], ['대기', '대기']);
});
test('79. 같은 RESULT requestId 재처리 → 중복 손익 처리 없음', () => {
  const env = bridgeEnv(); const id = boughtBet(env, { stake: 5000 });
  const a = inboxJson(env, 'rich-result-same-req-1', resultPayload(id, { result: '적중', ret: 11000 }));
  const b = inboxJson(env, 'rich-result-same-req-1', resultPayload(id, { result: '적중', ret: 11000 }));
  const out = runInbox(env);
  assert.deepStrictEqual([out.done, out.duplicate, out.error], [2, 1, 0]);
  assert.deepStrictEqual([inboxRow(env, a)[3], inboxRow(env, b)[3], inboxRow(env, b)[7]], ['DONE', 'DONE', '']);
  const s = dash(env).summary; assert.deepStrictEqual([s.totalReturn, s.profit, s.settledStake], [11000, 6000, 5000]);
  // 다른 결과 내용으로 같은 requestId 가 다시 와도 기존 처리 결과를 그대로 DONE (덮어쓰기 없음)
  const c = inboxJson(env, 'rich-result-same-req-1', resultPayload(id, { result: '미적중' })); runInbox(env);
  assert.strictEqual(inboxRow(env, c)[3], 'DONE'); assert.strictEqual(betRow(env, id)[9], '적중');
});
test('80. 같은 targetId / 같은 result 를 새 requestId 로 재전송 → 멱등 성공 (값 불변)', () => {
  const env = bridgeEnv(); const id = boughtBet(env, { stake: 5000 });
  inboxJson(env, 'rich-result-first-0001', resultPayload(id, { result: '적중', ret: 11000 })); runInbox(env);
  const snap = JSON.stringify(betRow(env, id));
  const again = inboxJson(env, 'rich-result-again-001', resultPayload(id, { result: '적중', ret: 11000 }));
  const noRet = inboxJson(env, 'rich-result-again-002', resultPayload(id, { result: '적중' }));     // 반환금 생략도 같은 결과로 인정
  const badRet = inboxJson(env, 'rich-result-again-003', resultPayload(id, { result: '적중', ret: 12000 }));
  const out = runInbox(env);
  assert.deepStrictEqual([inboxRow(env, again)[3], inboxRow(env, noRet)[3], inboxRow(env, badRet)[3]], ['DONE', 'DONE', 'ERROR']);
  assert.match(inboxRow(env, badRet)[7], /반환금 값이 다릅니다/);
  assert.strictEqual(out.duplicate, 2); assert.strictEqual(JSON.stringify(betRow(env, id)), snap);
});
test('81. 같은 targetId 에 상충 result → conflict ERROR, 자동 덮어쓰기 없음', () => {
  const env = bridgeEnv(); const id = boughtBet(env, { stake: 5000 });
  inboxJson(env, 'rich-result-win-000001', resultPayload(id, { result: '적중', ret: 11000 })); runInbox(env);
  const snap = JSON.stringify(betRow(env, id));
  const x = inboxJson(env, 'rich-result-lose-00001', resultPayload(id, { result: '미적중' }));
  const y = inboxJson(env, 'rich-result-cncl-00001', resultPayload(id, { result: '취소' }));
  runInbox(env);
  assert.deepStrictEqual([inboxRow(env, x)[3], inboxRow(env, y)[3]], ['ERROR', 'ERROR']);
  assert.strictEqual(inboxRow(env, x)[7], '이미 다른 결과로 처리된 베팅입니다.');
  assert.strictEqual(JSON.stringify(betRow(env, id)), snap);
  const s = dash(env).summary; assert.deepStrictEqual([s.profit, s.totalReturn], [6000, 11000]);
});
test('82. source/checkedAt 은 Inbox payloadJson 에만 보존, 장부 계산/메모/구조 불변', () => {
  const env = bridgeEnv();
  const a = boughtBet(env, { stake: 5000, memo: '기존 메모' }), b = boughtBet(env, { stake: 5000, name: 'B', memo: '기존 메모' }, '2026-10-06');
  const colsBefore = env.sheet('BET_LOG').grid[0].length;
  const i = inboxJson(env, 'rich-result-source-001', resultPayload(a, { result: '적중', ret: 11000 }));
  const j = inboxJson(env, 'rich-result-source-002', { action: 'RESULT', targetType: 'BET', targetId: b, result: '적중', ret: 11000 });   // source/checkedAt 없음
  runInbox(env);
  const saved = JSON.parse(inboxRow(env, i)[2]);
  assert.deepStrictEqual([saved.source[0].url, saved.checkedAt], ['https://example.com/result?id=1', '2026-10-06 05:10:00']);   // 감사 기록 보존
  assert.deepStrictEqual([...betRow(env, a).slice(9, 13)], [...betRow(env, b).slice(9, 13)]);                                    // 계산 동일
  assert.deepStrictEqual([betRow(env, a)[14], betRow(env, b)[14]], ['기존 메모', '기존 메모']);                                   // 메모 불변
  assert.ok(!JSON.stringify(env.sheet('BET_LOG').grid).includes('example.com'));
  assert.strictEqual(env.sheet('BET_LOG').grid[0].length, colsBefore); assert.deepStrictEqual([...env.sheet('RICH_INBOX').grid[0]], INBOX_HEAD);
  assert.strictEqual(inboxRow(env, j)[3], 'DONE');
});
test('83. WDL RESULT: 기존 resolveWdl_ 와 동일 결과, 멱등/충돌/미구매 거절', () => {
  const env = bridgeEnv();
  const w = boughtWdl(env, { stake: 5000, round: 'R-A', combo: '주력' }), ref = boughtWdl(env, { stake: 5000, round: 'R-B', combo: '주력' });
  env.get('apiResolveWdl')({ id: ref, hits: 12, rank: '4등', prize: 9000, reqId: 'manual-ref-1' });      // 웹앱 수동 처리(기준)
  const i = inboxJson(env, 'rich-result-wdl-00001', { action: 'RESULT', targetType: 'WDL', targetId: w, hits: 12, rank: '4등', prize: 9000, checkedAt: '2026-10-06 05:10:00', source: [{ name: 'toto', url: 'https://example.com/wdl' }] });
  runInbox(env);
  assert.deepStrictEqual([inboxRow(env, i)[3], inboxRow(env, i)[5], inboxRow(env, i)[6]], ['DONE', w, 'WDL_RESULT']);
  assert.deepStrictEqual([...wdlRow(env, w).slice(19, 23)], [...wdlRow(env, ref).slice(19, 23)]);        // hits/rank/prize/profit 동일
  assert.deepStrictEqual([wdlRow(env, w)[19], wdlRow(env, w)[20], wdlRow(env, w)[21], wdlRow(env, w)[22]], [12, '4등', 9000, 4000]);
  const same = inboxJson(env, 'rich-result-wdl-00002', { action: 'RESULT', targetType: 'WDL', targetId: w, hits: 12, rank: '4등', prize: 9000 });
  const conflict = inboxJson(env, 'rich-result-wdl-00003', { action: 'RESULT', targetType: 'WDL', targetId: w, hits: 13, rank: '3등', prize: 30000 });
  const skipped = env.get('apiSaveRichPick')(rw({ round: 'R-C' })).id; env.get('apiPurchase')({ kind: 'wdl', id: skipped, buy: false, reqId: 'skip-wdl-1' });
  const nope = inboxJson(env, 'rich-result-wdl-00004', { action: 'RESULT', targetType: 'WDL', targetId: skipped, hits: 5, rank: '미당첨', prize: 0 });
  const lose = boughtWdl(env, { stake: 3000, round: 'R-D', combo: '보조1' });
  const miss = inboxJson(env, 'rich-result-wdl-00005', { action: 'RESULT', targetType: 'WDL', targetId: lose, hits: 8, rank: '미당첨' });
  runInbox(env);
  assert.deepStrictEqual([inboxRow(env, same)[3], inboxRow(env, conflict)[3], inboxRow(env, nope)[3], inboxRow(env, miss)[3]], ['DONE', 'ERROR', 'ERROR', 'DONE']);
  assert.strictEqual(inboxRow(env, conflict)[7], '이미 다른 결과로 처리된 베팅입니다.');
  assert.strictEqual(inboxRow(env, nope)[7], '구매하지 않은 베팅은 결과 처리할 수 없습니다.');
  assert.deepStrictEqual([wdlRow(env, lose)[20], wdlRow(env, lose)[21], wdlRow(env, lose)[22]], ['미당첨', 0, -3000]);
  assert.strictEqual(wdlRow(env, skipped)[20], '대기');
});
test('84. 회귀: 수동 결과 처리(웹앱 API)와 RESULT 가 공존, 월간 성적/미확인 차단 유지', () => {
  const env = bridgeEnv();
  const a = boughtBet(env, { stake: 1000, name: 'A' }), b = boughtBet(env, { stake: 1000, name: 'B' });   // 합계 2,000 ≤ 5,000
  const un = env.get('apiSaveRichPick')(rp({ name: 'U' })).id;
  inboxJson(env, 'rich-result-regress-01', resultPayload(a, { result: '적중', ret: 3000 })); runInbox(env);
  const m = env.get('apiResolveBet')({ id: b, result: '적중', ret: 3000, reqId: 'manual-b' });          // 수동 처리 경로 불변
  assert.deepStrictEqual([m.ok, m.profit, m.roi], [true, 2000, 200]);
  assert.deepStrictEqual([...betRow(env, a).slice(9, 13)], [...betRow(env, b).slice(9, 13)]);            // 자동/수동 결과 동일
  assert.match(env.get('apiResolveBet')({ id: un, result: '미적중', reqId: 'manual-un' }).error, /먼저 구매 확인/);
  const skip = env.get('apiSaveRichPick')(rp({ name: 'S' })).id; buy(env, 'bet', skip, false);
  assert.ok(env.get('apiResolveBet')({ id: skip, result: '적중', ret: 2000, reqId: 'manual-skip' }).ok);   // 수동 경로는 미구매 추천 결과 입력 허용(기존 동작)
  const s = env.get('apiGetMonthly')('2026-10').summary; assert.deepStrictEqual([s.used, s.profit, s.settledStake], [2000, 4000, 2000]);
  const p = env.get('apiGetPending')(); assert.strictEqual(p.bets.length, 0);
  assert.strictEqual(env.get('diagnoseSetup')(), '리치 베팅 장부 V1 환경 정상 / Rich Bridge 정상');
});
test('85. 원래 실패한 ERROR 감사 행은 보존되고, 새 requestId 수정본만 정상 저장', () => {
  const env = bridgeEnv();
  const orig = inboxAdd(env, 'rich-20261005-proto118-6486-6580', betPayload({ sport: '혼합', stake: 3000 }), 'ERROR', { processedAt: ago(env, 120) });
  env.sheet('RICH_INBOX').grid[orig][7] = '종목: 허용되지 않은 값입니다.';
  const origSnap = JSON.stringify(inboxRow(env, orig));
  const fix = inboxAdd(env, 'rich-20261005-proto118-6486-6580-fix', betPayload({ sport: '기타', stake: 3000 }));
  const out = runInbox(env);
  assert.deepStrictEqual([out.processed, out.done], [1, 1]);
  assert.strictEqual(JSON.stringify(inboxRow(env, orig)), origSnap);                                   // ERROR 이력 그대로(재처리/수정/삭제 없음)
  assert.strictEqual(inboxRow(env, fix)[3], 'DONE'); assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 2);
});
test('86. 읽기 최적화: API 1회에서 같은 시트/설정을 반복해서 읽지 않음', () => {
  const env = setup(); env.setNow(kst('2026-10-05'));
  const cnt = {};
  for (const n of ['BET_LOG', 'WDL_LOG', 'SETTINGS']) {
    const sh = env.sheet(n), g = sh.getRange;
    sh.getRange = (r, ...a) => { const rg = g(r, ...a); if (r < 2) return rg; return new Proxy(rg, { get: (tt, k) => k === 'getValues' ? () => { cnt[n] = (cnt[n] || 0) + 1; return tt.getValues(); } : tt[k] }); };
  }
  const a = recBet(env, { stake: 1000 }).id; recWdl(env, { stake: 1000 });
  const reads = fn => { for (const k in cnt) delete cnt[k]; const r = fn(); return Object.assign({ ok: r.ok }, cnt); };
  assert.deepStrictEqual(reads(() => env.get('apiBootstrap')()), { ok: true, BET_LOG: 1, WDL_LOG: 1, SETTINGS: 1 });
  assert.deepStrictEqual(reads(() => env.get('apiGetUnconfirmed')()), { ok: true, BET_LOG: 1, WDL_LOG: 1, SETTINGS: 1 });
  assert.deepStrictEqual(reads(() => env.get('apiGetPending')()), { ok: true, BET_LOG: 1, WDL_LOG: 1, SETTINGS: 1 });
  assert.deepStrictEqual(reads(() => env.get('apiGetMonthly')('2026-10')), { ok: true, BET_LOG: 1, WDL_LOG: 1, SETTINGS: 1 });
  const p = reads(() => env.get('apiPurchase')({ kind: 'bet', id: a, buy: true, reqId: 'perf-1' }));   // 쓰기 후 요약 재계산 1회까지만
  assert.ok(p.BET_LOG <= 2 && p.WDL_LOG <= 2 && p.SETTINGS === 1, JSON.stringify(p));
  // 메모가 쓰기 후 낡은 데이터를 돌려주지 않음
  assert.strictEqual(env.get('apiGetUnconfirmed')().bets.length, 0);
  assert.strictEqual(env.get('apiGetMonthly')('2026-10').summary.used, 1000);
});

/* ---------- 승무패 복수마킹 묶음(WDL_MULTI) ---------- */
const SEL58 = [['승'], ['승', '무'], ['패'], ['승'], ['승'], ['승'], ['승'], ['무', '패'], ['승', '무'], ['패'], ['승'], ['패'], ['패'], ['승']];
const mp = (o = {}) => Object.assign({ requestId: 'rich-wdl-20261005-' + (++seq) + '-58', type: 'WDL_MULTI', round: '58', date: '2026-10-05',
  selections: SEL58, stakePerCombo: 1000, memo: '승무패 58회차 리치 추천' }, o);
const cartesian = sets => sets.reduce((acc, set) => acc.flatMap(pre => set.map(v => pre.concat([v]))), [[]]);
const wdlRows = (env, gid) => env.sheet('WDL_LOG').grid.slice(1).filter(r => !gid || r[28] === gid);
const gamesOf = row => row.slice(4, 18);
const saveMulti = (env, o) => { const r = env.get('apiSaveRichPick')(mp(o)); assert.ok(r.ok, r.error); return r; };
const buyGroup = (env, gid, yes = true, extra = {}) => env.get('apiPurchase')(Object.assign({ kind: 'wdl_group', id: gid, buy: yes, reqId: 'g' + (++seq) }, extra));

test('90. WDL_MULTI 2×2×2 → 정확히 8조합(14경기, 중복 없음, 조합당 1,000원, 총 8,000원, 같은 groupId, 조합순번 1~8)', () => {
  const env = bridgeEnv();
  const r = saveMulti(env);
  assert.deepStrictEqual([r.type, r.duplicate, r.comboCount, r.total], ['WDL_MULTI', false, 8, 8000]);
  const rows = wdlRows(env);
  assert.strictEqual(rows.length, 8);
  const games = rows.map(gamesOf);
  assert.ok(games.every(g => g.length === 14 && g.every(v => ['승', '무', '패'].includes(v))));
  assert.strictEqual(new Set(games.map(g => g.join(''))).size, 8);                                // 중복 조합 없음
  assert.deepStrictEqual(games.map(g => g.join('')), cartesian(SEL58).map(g => g.join('')));      // 데카르트 곱(첫 경기가 가장 천천히)
  assert.strictEqual(games[0].join(''), '승승패승승승승무승패승패패승'); assert.strictEqual(games[7].join(''), '승무패승승승승패무패승패패승');
  assert.ok(rows.every(x => x[18] === 1000)); assert.strictEqual(rows.reduce((n, x) => n + x[18], 0), 8000);
  assert.strictEqual(new Set(rows.map(x => x[28])).size, 1); assert.strictEqual(rows[0][28], r.groupId); assert.match(r.groupId, /^WDLG-20261005-/);
  assert.deepStrictEqual(rows.map(x => x[29]), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepStrictEqual(rows.map(x => x[3]), ['조합1', '조합2', '조합3', '조합4', '조합5', '조합6', '조합7', '조합8']);
  assert.ok(rows.every(x => x[1] === '58' && x[20] === '대기' && x[25] === '미확인' && x[26] === '' && x[27] === ''));   // 구매 전: 미확인, 예산 미사용
  assert.strictEqual(new Set(rows.map(x => x[0])).size, 8);
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 1);
  const s = dash(env).summary; assert.deepStrictEqual([s.used, s.remain], [0, 200000]);
});
test('91. WDL_MULTI 검증: 조합 수 10 초과/형식 오류는 저장 없이 거절', () => {
  const env = bridgeEnv(); const f = env.get('apiSaveRichPick');
  const sel = (n2, n3) => SEL58.map((x, i) => i < n3 ? ['승', '무', '패'] : i < n3 + n2 ? ['승', '무'] : ['승']);
  assert.strictEqual(f(mp({ selections: sel(4, 0) })).error, '조합 수는 최대 10개입니다 (현재 16개).');
  assert.strictEqual(f(mp({ selections: sel(2, 2) })).error, '조합 수는 최대 10개입니다 (현재 36개).');
  assert.match(f(mp({ selections: SEL58.slice(0, 13) })).error, /14경기 배열/);
  const e = SEL58.map(x => x.slice()); e[4] = [];
  assert.strictEqual(f(mp({ selections: e })).error, '5경기의 승/무/패를 선택해주세요.');
  const bad = SEL58.map(x => x.slice()); bad[6] = ['승', '이김'];
  assert.strictEqual(f(mp({ selections: bad })).error, '7경기: 승/무/패만 선택할 수 있습니다.');
  assert.match(f(mp({ stakePerCombo: 0 })).error, /0원보다/); assert.match(f(mp({ round: '' })).error, /회차/);
  assert.deepStrictEqual([wdlRows(env).length], [0]);
  // 3×3=9조합은 허용, 문자열 표기("승/무")와 중복 마킹도 정규화
  const nine = SEL58.map((x, i) => i === 0 || i === 1 ? ['승', '무', '패'] : ['승']);
  const ok = f(mp({ selections: nine })); assert.ok(ok.ok, ok.error); assert.strictEqual(ok.comboCount, 9);
  const mixed = SEL58.map((x, i) => i === 1 ? '무/승/승' : x);
  const ok2 = f(mp({ selections: mixed, round: '59' })); assert.ok(ok2.ok, ok2.error); assert.strictEqual(ok2.comboCount, 8);
});
test('92. WDL_MULTI 멱등성: 같은 requestId 재요청/Inbox 중복에도 8행만, 다른 requestId 는 별도 묶음', () => {
  const env = bridgeEnv();
  const a = inboxAdd(env, 'rich-wdl-20261005-58', mp({ requestId: 'rich-wdl-20261005-58' }));
  const b = inboxAdd(env, 'rich-wdl-20261005-58', mp({ requestId: 'rich-wdl-20261005-58' }));
  const out = runInbox(env);
  assert.deepStrictEqual([out.done, out.duplicate, out.error], [2, 1, 0]);
  const ra = inboxRow(env, a), rb = inboxRow(env, b);
  assert.deepStrictEqual([ra[3], ra[6], rb[3], rb[5] === ra[5], rb[7]], ['DONE', 'WDL_MULTI', 'DONE', true, '']);
  assert.strictEqual(wdlRows(env).length, 8); assert.ok(wdlRows(env).every(x => x[28] === ra[5]));
  const again = env.get('apiSaveRichPick')(mp({ requestId: 'rich-wdl-20261005-58' }));
  assert.deepStrictEqual([again.ok, again.duplicate, again.comboCount, again.groupId], [true, true, 8, ra[5]]);
  assert.strictEqual(wdlRows(env).length, 8);
  const other = saveMulti(env, { requestId: 'rich-wdl-20261005-58-b' });                       // 새 requestId → 새 묶음(조합1~8 이름 재사용 가능)
  assert.notStrictEqual(other.groupId, ra[5]); assert.strictEqual(wdlRows(env).length, 16);
  assert.match(env.get('apiSaveRichPick')(rp({ requestId: 'rich-wdl-20261005-58' })).error, /다른 유형/);
});
test('93. 기존 28열 시트 호환: 단일 WDL 정상, 묶음은 안내 후 거절, setupWdlGroupColumns 로 비파괴 확장', () => {
  const env = bridgeEnv(); const sh = env.sheet('WDL_LOG');
  sh.grid[0].length = 28; sh._maxCols = 28;                                                   // 사용자의 현재 시트 모양(AB까지)
  const single = env.get('apiSaveRichPick')(rw({ round: '57', combo: '주력', stake: 5000 })); assert.ok(single.ok, single.error);
  assert.strictEqual(sh.grid[1].length, 28);                                                   // 28열까지만 기록
  assert.strictEqual(env.get('apiGetUnconfirmed')().wdl.length, 1);
  const m = env.get('apiSaveRichPick')(mp()); assert.strictEqual(m.ok, false); assert.match(m.error, /setupWdlGroupColumns/);
  assert.strictEqual(wdlRows(env).length, 1);
  assert.match(env.get('diagnoseSetup')(), /WDL_LOG 29열 헤더[^\n]*setupWdlGroupColumns/);
  const before = JSON.stringify(sh.grid[1]);
  env.get('setupWdlGroupColumns')();
  assert.ok(sh._maxCols >= 30); assert.deepStrictEqual([sh.grid[0][28], sh.grid[0][29]], ['구매묶음ID', '조합순번']);
  assert.strictEqual(JSON.stringify(sh.grid[1].slice(0, 28)), JSON.stringify(JSON.parse(before).slice(0, 28)));   // 기존 데이터 불변
  env.get('setupWdlGroupColumns')();                                                           // 재실행해도 안전
  assert.strictEqual(env.get('diagnoseSetup')(), '리치 베팅 장부 V1 환경 정상 / Rich Bridge 정상');
  assert.ok(env.get('apiSaveRichPick')(mp()).ok); assert.strictEqual(wdlRows(env).length, 9);
  const legacy = wdlRows(env)[0]; assert.deepStrictEqual([legacy[3], legacy[28] || '', legacy[29] || ''], ['주력', '', '']);
  // 같은 회차에서 기존 주력은 중복 금지 유지, 묶음의 '조합1' 과는 충돌하지 않음
  assert.match(env.get('apiSaveRichPick')(rw({ round: '57', combo: '주력' })).error, /이미 있습니다/);
});
test('94. 구매 확인 목록: 묶음은 카드 1장(8조합/8,000원/복수마킹), 기존 주력/보조 행은 그대로', () => {
  const env = bridgeEnv();
  const g = saveMulti(env); env.get('apiSaveRichPick')(rw({ round: '57', combo: '주력', stake: 5000 })); env.get('apiSaveRichPick')(rw({ round: '57', combo: '보조1', stake: 3000 }));
  const u = env.get('apiGetUnconfirmed')();
  assert.strictEqual(u.wdl.length, 3);                                                          // 묶음 1 + 단일 2 (8행이 8장이 되지 않음)
  const card = u.wdl.find(x => x.kind === 'wdl_group');
  assert.deepStrictEqual([card.groupId, card.round, card.comboCount, card.stake, card.stakePerCombo], [g.groupId, '58', 8, 8000, 1000]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(card.multi)), [{ game: 2, picks: ['승', '무'] }, { game: 8, picks: ['무', '패'] }, { game: 9, picks: ['승', '무'] }]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(card.selections)), SEL58);
  assert.deepStrictEqual([...u.wdl.filter(x => !x.kind).map(x => x.combo).sort()], ['보조1', '주력']);
  assert.strictEqual(env.get('apiGetPending')().wdl.length, 0);
});
test('95. 그룹 "샀다": 8행 모두 구매(1,000원/같은 구매시각), 사용액 8,000원, 월간 집계 반영', () => {
  const env = bridgeEnv(); const g = saveMulti(env);
  const r = buyGroup(env, g.groupId);
  assert.ok(r.ok, r.error); assert.deepStrictEqual([r.buyStatus, r.comboCount, r.total], ['구매', 8, 8000]);
  const rows = wdlRows(env, g.groupId);
  assert.ok(rows.every(x => x[25] === '구매' && x[26] === 1000 && isDate(x[27])));
  assert.strictEqual(new Set(rows.map(x => +x[27])).size, 1);                                    // 모든 행 같은 구매시각
  const s = env.get('apiGetMonthly')('2026-10');
  assert.deepStrictEqual([s.summary.used, s.summary.remain, s.summary.wdlUsed, s.wdl.stake, s.wdl.rounds], [8000, 192000, 8000, 8000, 1]);
  assert.strictEqual(env.get('apiGetUnconfirmed')().wdl.length, 0);
  const p = env.get('apiGetPending')().wdl; assert.deepStrictEqual([p.length, p[0].kind, p[0].comboCount, p[0].combos.length, p[0].buy], [1, 'wdl_group', 8, 8, '구매']);
  assert.match(buyGroup(env, g.groupId).error, /이미 처리된 기록입니다 \(구매\)/);               // 뒤집기/재처리 금지
  assert.match(buyGroup(env, g.groupId, false).error, /이미 처리된 기록입니다/);
});
test('96. 그룹 "안 샀다": 8행 모두 미구매(금액 빈값), 사용액 0, 기록 보존', () => {
  const env = bridgeEnv(); const g = saveMulti(env);
  const r = buyGroup(env, g.groupId, false); assert.ok(r.ok, r.error);
  const rows = wdlRows(env, g.groupId);
  assert.strictEqual(rows.length, 8); assert.ok(rows.every(x => x[25] === '미구매' && x[26] === '' && isDate(x[27]) && x[18] === 1000));
  assert.strictEqual(new Set(rows.map(x => +x[27])).size, 1);
  assert.deepStrictEqual([env.get('apiGetMonthly')('2026-10').summary.used, env.get('apiGetUnconfirmed')().wdl.length], [0, 0]);
  assert.strictEqual(buyGroup(env, g.groupId).ok, false);
  assert.strictEqual(buyGroup(env, 'WDLG-NOPE', true).error, '기록을 찾을 수 없습니다.');
});
test('97. 그룹 구매 한도: 회차 10,000원/월 예산을 그룹 전체 금액으로 사전검증 (거절 시 어떤 행도 변경 없음)', () => {
  const env = bridgeEnv(); env.setNow(kst('2026-10-05'));
  const g = saveMulti(env);
  const single = env.get('apiSaveRichPick')(rw({ round: '58', combo: '주력', stake: 3000 })).id; assert.ok(buy(env, 'wdl', single).ok);   // 58회차 기존 구매 3,000
  const snap = JSON.stringify(wdlRows(env, g.groupId));
  const r = buyGroup(env, g.groupId);
  assert.strictEqual(r.ok, false); assert.strictEqual(r.error, '회차 최대 10,000원 초과: 58회차 구매 3,000원 + 신규 8,000원 = 11,000원');
  assert.strictEqual(JSON.stringify(wdlRows(env, g.groupId)), snap);                           // 부분 구매 없음
  assert.ok(wdlRows(env, g.groupId).every(x => x[25] === '미확인' && x[26] === '' && x[27] === ''));
  assert.strictEqual(env.get('apiGetMonthly')('2026-10').summary.used, 3000);
  // 안 샀다 는 한도와 무관, 다른 회차 8,000원은 정상 구매
  const other = saveMulti(env, { round: '59' }); assert.ok(buyGroup(env, other.groupId).ok);
  assert.ok(buyGroup(env, g.groupId, false).ok);
  // 정확히 10,000원(8,000 + 2,000)은 허용
  const env2 = bridgeEnv(); const g2 = saveMulti(env2); const s2 = env2.get('apiSaveRichPick')(rw({ round: '58', combo: '주력', stake: 2000 })).id;
  assert.ok(buy(env2, 'wdl', s2).ok); assert.ok(buyGroup(env2, g2.groupId).ok);
  // 월 예산: 9월 198,000원 구매 상태에서 8,000원 그룹 → 월 한도로 전체 거절
  const env3 = setup(); env3.get('setupRichBridge')(); fill198k(env3); env3.setNow(kst('2026-09-30'));
  const g3 = env3.get('apiSaveRichPick')(mp({ date: '2026-09-30', round: '70' })); assert.ok(g3.ok, g3.error);
  const m = buyGroup(env3, g3.groupId); assert.strictEqual(m.ok, false); assert.match(m.error, /월 예산 200,000원 초과: 2026-09 구매 198,000원 \+ 신규 8,000원 = 206,000원/);
  assert.ok(wdlRows(env3, g3.groupId).every(x => x[25] === '미확인'));
});
test('98. 그룹 구매는 원자적: 쓰기 중 오류가 나도 일부 행만 구매 처리되지 않음', () => {
  const env = bridgeEnv(); const g = saveMulti(env);
  const sh = env.sheet('WDL_LOG'), orig = sh.getRange;
  sh.getRange = (r, c, nr, nc) => { const rg = orig(r, c, nr, nc); return new Proxy(rg, { get: (tt, k) => k === 'setValues' ? () => { throw new Error('simulated write failure'); } : tt[k] }); };
  const r = buyGroup(env, g.groupId);
  sh.getRange = orig;
  assert.strictEqual(r.ok, false);
  assert.ok(wdlRows(env, g.groupId).every(x => x[25] === '미확인' && x[26] === '' && x[27] === ''));
  assert.strictEqual(env.get('apiGetMonthly')('2026-10').summary.used, 0);
  assert.ok(buyGroup(env, g.groupId).ok);                                                      // 장애 해소 후 정상 구매
  // 같은 reqId 재전송은 캐시된 성공 응답(중복 집계 없음)
  const g2 = saveMulti(env, { round: '60' }); const a = buyGroup(env, g2.groupId, true, { reqId: 'grp-click-1' }), b = buyGroup(env, g2.groupId, true, { reqId: 'grp-click-1' });
  assert.ok(a.ok && b.ok && b.duplicate); assert.strictEqual(env.get('apiGetMonthly')('2026-10').summary.used, 16000);
});
test('99. 그룹 결과: 조합별 독립 결과(WDL 기존 로직 재사용) + 묶음 요약, 충돌/누락/미구매는 전체 거절', () => {
  const env = bridgeEnv(); const g = saveMulti(env); assert.ok(buyGroup(env, g.groupId).ok);
  const ids = wdlRows(env, g.groupId).map(x => x[0]);
  const results = [{ comboNo: 1, hits: 13, rank: '4등', prize: 5000 }].concat([2, 3, 4, 5, 6, 7, 8].map(n => ({ comboNo: n, hits: 8 + (n % 4), rank: '미당첨' })));
  // 한 조합 값이 잘못되면 아무것도 기록되지 않음 (원자적 사전검증)
  const bad = inboxJson(env, 'rich-grp-result-bad-1', { action: 'RESULT', targetType: 'WDL_MULTI', targetId: g.groupId, combos: results.map(c => c.comboNo === 5 ? Object.assign({}, c, { rank: '5등' }) : c) });
  const miss = inboxJson(env, 'rich-grp-result-miss1', { action: 'RESULT', targetType: 'WDL_MULTI', targetId: g.groupId, combos: results.slice(0, 7) });
  const ok = inboxJson(env, 'rich-grp-result-ok-01', { action: 'RESULT', targetType: 'WDL_MULTI', targetId: g.groupId, combos: results, checkedAt: '2026-10-06 05:10:00', source: [{ name: 'toto', url: 'https://example.com/58' }] });
  const out = runInbox(env);
  assert.deepStrictEqual([inboxRow(env, bad)[3], inboxRow(env, miss)[3], inboxRow(env, ok)[3]], ['ERROR', 'ERROR', 'DONE']);
  assert.match(inboxRow(env, miss)[7], /누락된 조합순번: 8/);
  assert.deepStrictEqual([inboxRow(env, ok)[5], inboxRow(env, ok)[6]], [g.groupId, 'WDL_MULTI_RESULT']);
  const rows = wdlRows(env, g.groupId);
  assert.deepStrictEqual([rows[0][19], rows[0][20], rows[0][21], rows[0][22]], [13, '4등', 5000, 4000]);   // 조합1: 당첨, 손익 +4,000
  assert.deepStrictEqual([rows[1][20], rows[1][21], rows[1][22]], ['미당첨', 0, -1000]);               // 나머지: 각각 독립 결과
  assert.ok(rows.every(x => x[20] !== '대기'));
  const m = env.get('apiGetMonthly')('2026-10');
  assert.deepStrictEqual([m.summary.profit, m.summary.totalReturn, m.wdl.prize, m.wdl.bestHits, m.wdl.bestRank], [-3000, 5000, 5000, 13, '4등']);
  const grp = JSON.parse(JSON.stringify(m.wdlGroups[0]));
  assert.deepStrictEqual([grp.groupId, grp.comboCount, grp.stake, grp.bestHits, grp.winners, grp.prize], [g.groupId, 8, 8000, 13, 1, 5000]);
  // 같은 결과 재전송은 멱등 DONE, 상충 결과는 ERROR (덮어쓰기 없음)
  const again = inboxJson(env, 'rich-grp-result-ok-02', { action: 'RESULT', targetType: 'WDL_MULTI', targetId: g.groupId, combos: results });
  const clash = inboxJson(env, 'rich-grp-result-bad-2', { action: 'RESULT', targetType: 'WDL_MULTI', targetId: g.groupId, combos: results.map(c => c.comboNo === 2 ? { comboNo: 2, hits: 14, rank: '1등', prize: 900000 } : c) });
  runInbox(env);
  assert.deepStrictEqual([inboxRow(env, again)[3], inboxRow(env, clash)[3]], ['DONE', 'ERROR']);
  assert.match(inboxRow(env, clash)[7], /조합2: 이미 다른 결과/);
  assert.deepStrictEqual([wdlRows(env, g.groupId)[1][20], env.get('apiGetMonthly')('2026-10').summary.profit], ['미당첨', -3000]);
  // 단일 행 RESULT(targetType WDL)도 그룹 행에 그대로 동작
  const g2 = saveMulti(env, { round: '61' }); buyGroup(env, g2.groupId);
  const one = inboxJson(env, 'rich-grp-result-one-1', { action: 'RESULT', targetType: 'WDL', targetId: wdlRows(env, g2.groupId)[2][0], hits: 12, rank: '미당첨' });
  runInbox(env); assert.strictEqual(inboxRow(env, one)[3], 'DONE'); assert.deepStrictEqual([wdlRows(env, g2.groupId)[2][20], wdlRows(env, g2.groupId)[3][20]], ['미당첨', '대기']);
  // 미구매 묶음은 거절
  const g3 = saveMulti(env, { round: '62' }); buyGroup(env, g3.groupId, false);
  const no = inboxJson(env, 'rich-grp-result-no-01', { action: 'RESULT', targetType: 'WDL_MULTI', targetId: g3.groupId, combos: results });
  runInbox(env); assert.strictEqual(inboxRow(env, no)[7], '구매하지 않은 베팅은 결과 처리할 수 없습니다.'); void ids; void out;
});
test('100. 회귀: 기존 주력/보조1/보조2 WDL(5,000+3,000+2,000 허용, 3,000 추가 차단)은 묶음 도입 후에도 동일', () => {
  const env = bridgeEnv(); env.setNow(kst('2026-10-05'));
  const a = env.get('apiSaveRichPick')(rw({ round: '70', combo: '주력', stake: 5000 })).id, b = env.get('apiSaveRichPick')(rw({ round: '70', combo: '보조1', stake: 3000 })).id;
  const c = env.get('apiSaveRichPick')(rw({ round: '70', combo: '보조2', stake: 3000 })).id;
  assert.ok(buy(env, 'wdl', a).ok && buy(env, 'wdl', b).ok);
  assert.match(buy(env, 'wdl', c).error, /회차 최대 10,000원 초과: 70회차 구매 8,000원 \+ 신규 3,000원 = 11,000원/);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(env.get('apiGetPending')().wdl.map(x => x.kind || 'single'))), ['single', 'single']);
  assert.ok(wdlRows(env).every(x => (x[28] || '') === '' && (x[29] || '') === ''));            // 묶음 열은 기존 행에서 비어 있음
  const r = env.get('apiResolveWdl')({ id: a, hits: 12, rank: '4등', prize: 9000, reqId: 'old-wdl-1' });
  assert.deepStrictEqual([r.ok, r.profit], [true, 4000]);
  const m = env.get('apiGetMonthly')('2026-10');
  assert.deepStrictEqual([m.wdlGroups.length, m.wdlGroups[0].comboCount, m.wdl.rounds, m.wdl.stake], [2, 1, 1, 8000]);   // 기존 행은 행 하나 = 한 묶음
});

test('103. 배포 후 자동 점검: CODE_REV 가 바뀐 첫 트리거 실행에서 열 추가 + diagnose 기록(1회), 이후 반복 없음', () => {
  const env = bridgeEnv(); const sh = env.sheet('WDL_LOG');
  sh.grid[0].length = 28; sh._maxCols = 28;                                                    // 배포 전 사용자 시트(AB까지)
  const pending = inboxAdd(env, 'rich-postdeploy-0001', betPayload({ name: '배포중 들어온 요청' }));
  env.get('processRichInbox')();                                                               // CODE_REV 없음 → 점검 안 함
  assert.strictEqual(sh.grid[0].length, 28); assert.strictEqual(inboxRow(env, pending)[3], 'DONE');
  const n0 = env.sheet('RICH_INBOX').grid.length;
  env.ctx.CODE_REV = 'abc1234';                                                                // 배포 스크립트가 넣는 Rev.gs 와 같은 효과
  inboxAdd(env, 'rich-postdeploy-0002', betPayload({ name: '두번째' }));
  env.get('processRichInbox')();
  assert.deepStrictEqual([sh.grid[0][28], sh.grid[0][29]], ['구매묶음ID', '조합순번']);
  const rows = env.sheet('RICH_INBOX').grid;
  const sys = rows.find(r => r[0] === 'system-deploy-abc1234');
  assert.ok(sys); assert.deepStrictEqual([sys[3], sys[5], sys[6]], ['DONE', 'abc1234', 'POST_DEPLOY_CHECK']);
  assert.strictEqual(sys[7], '리치 베팅 장부 V1 환경 정상 / Rich Bridge 정상');
  assert.strictEqual(rows.filter(r => r[0] === 'system-deploy-abc1234').length, 1);
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 3);                                    // 일반 요청 처리는 정상 계속
  env.get('processRichInbox')(); env.get('processRichInbox')();
  assert.strictEqual(env.sheet('RICH_INBOX').grid.filter(r => r[0] === 'system-deploy-abc1234').length, 1);
  env.ctx.CODE_REV = 'def5678'; env.get('processRichInbox')();                                // 새 배포 → 다시 1회
  assert.strictEqual(env.sheet('RICH_INBOX').grid.filter(r => String(r[0]).startsWith('system-deploy-')).length, 2);
  // 점검에서 문제가 있으면 그대로 기록된다
  env.sheet('SETTINGS').grid[1][0] = '월예산'; env.ctx.CODE_REV = 'bad0001'; env.get('processRichInbox')();
  assert.match(env.sheet('RICH_INBOX').grid.find(r => r[0] === 'system-deploy-bad0001')[7], /문제 1건/);
  assert.ok(n0 > 1);
});

console.log(results.join('\n'));
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
