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
    getRange(r, c, nr = 1, nc = 1) {
      const rng = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (grid[r - 1 + i] && grid[r - 1 + i][c - 1 + j] !== undefined) ? grid[r - 1 + i][c - 1 + j] : '')),
        setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { (grid[r - 1 + i] = grid[r - 1 + i] || [])[c - 1 + j] = x; })); return rng; },
      };
      const prx = new Proxy(rng, { get: (t, k) => k in t ? t[k] : () => prx });
      return prx;
    },
    clear() { grid.length = 0; return sh; },
  };
  return new Proxy(sh, { get: (t, k) => k in t ? t[k] : () => sh });
}

function makeContext(now = new Date('2026-10-03T03:00:00Z')) {
  const sheets = [];
  const props = {}; const cache = {};
  let uuidN = 0;
  const ss = {
    getId: () => 'SS1',
    getSheetByName: n => sheets.find(s => s.name === n) || null,
    insertSheet: n => { const s = makeSheet(n); sheets.push(s); return s; },
    getSheets: () => sheets,
    deleteSheet: s => sheets.splice(sheets.indexOf(s), 1),
  };
  const RealDate = Date;
  const ctx = {
    console, Date: class extends RealDate { constructor(...a) { a.length ? super(...a) : super(now.getTime()); } static now() { return now.getTime(); } },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      getUuid: () => 'uuid-' + String(++uuidN).padStart(8, '0') + '-aaaa-bbbb-cccc-dddddddddddd',
      formatDate(d, tz, fmt) {
        const k = new RealDate(d.getTime() + 9 * 3600 * 1000); // Asia/Seoul
        const p = n => String(n).padStart(2, '0');
        const Y = k.getUTCFullYear(), M = p(k.getUTCMonth() + 1), D = p(k.getUTCDate());
        return fmt === 'yyyy-MM-dd' ? `${Y}-${M}-${D}` : fmt === 'yyyyMMdd' ? `${Y}${M}${D}`
          : `${Y}-${M}-${D} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}:${p(k.getUTCSeconds())}`;
      },
    },
    HtmlService: {},
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  const get = n => vm.runInContext(n, ctx);
  return { ctx, ss, sheets, get, sheet: n => ss.getSheetByName(n) };
}

/* ---------- 도우미 ---------- */
const GAMES = Array(14).fill('승');
let seq = 0;
const bet = (env, o) => env.get('apiSaveBet')(Object.assign({ date: '2026-10-03', sport: '축구', league: 'K리그', name: 'A경기', pick: '홈승', folders: 1, odds: 2.2, stake: 5000, grade: '메인', memo: '', reqId: 'r' + (++seq) }, o));
const wdl = (env, o) => env.get('apiSaveWdl')(Object.assign({ round: '100', date: '2026-10-03', combo: '주력', games: GAMES, stake: 5000, memo: '', reqId: 'r' + (++seq) }, o));
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
  assert.strictEqual(env.sheet('BET_LOG').grid[0].join('|'), 'ID|베팅일|종목|리그|경기/조합명|픽 내용|폴더수|총배당|베팅금액|결과|반환금|손익|ROI|리치등급|메모|등록일시');
  assert.strictEqual(env.sheet('WDL_LOG').grid[0].join('|'), 'ID|회차|구매일|조합구분|' + Array.from({ length: 14 }, (_, i) => (i + 1) + '경기').join('|') + '|베팅금액|적중개수|등수|당첨금|손익|메모|등록일시');
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
  assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 2);
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
  assert.deepStrictEqual([row[9], row[10], row[11], row[12]], ['적중', 11000, 6000, 120]);
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
  assert.strictEqual(env.sheet('WDL_LOG').getLastRow(), 4);
});

test('6. 같은 회차 5,000+3,000+3,000 → 10,000 초과 차단', () => {
  const env = setup();
  wdl(env, { combo: '주력', stake: 5000 }); wdl(env, { combo: '보조1', stake: 3000 });
  const r = wdl(env, { combo: '보조2', stake: 3000 });
  assert.strictEqual(r.ok, false); assert.match(r.error, /회차 최대 10,000원 초과/);
  assert.strictEqual(env.sheet('WDL_LOG').getLastRow(), 3);
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
    .filter(r => String(r[dateCol]).startsWith(monthPrefix)).reduce((s, r) => s + r[col], 0);
  const raw = sumCol('BET_LOG', 8, '2026-10', 1) + sumCol('WDL_LOG', 18, '2026-10', 2);
  assert.strictEqual(raw, 5000 + 4000 + 3000 + 6000 + 4000);
  const s = dash(env).summary;
  assert.strictEqual(s.used, raw); assert.strictEqual(s.remain, 200000 - raw);
  const dg = env.sheet('DASHBOARD').grid;
  const cardRow = dg.find(r => r[0] === 200000);
  assert.strictEqual(cardRow[1], raw); assert.strictEqual(cardRow[2], 200000 - raw);
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
  const a = bet(env, { stake: 1000, reqId: 'same' }), b = bet(env, { stake: 1000, reqId: 'same' });
  assert.ok(a.ok && b.ok && b.duplicate); assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 2);
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

console.log(results.join('\n'));
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
