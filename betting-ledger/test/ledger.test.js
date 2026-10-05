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
    getLastColumn() { return grid.reduce((m, r) => Math.max(m, r ? r.length : 0), 0); },
    getRange(r, c, nr = 1, nc = 1) {
      const rng = {
        getValue: () => (grid[r - 1] && grid[r - 1][c - 1] !== undefined) ? grid[r - 1][c - 1] : '',
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (grid[r - 1 + i] && grid[r - 1 + i][c - 1 + j] !== undefined) ? grid[r - 1 + i][c - 1 + j] : '')),
        setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { (grid[r - 1 + i] = grid[r - 1 + i] || [])[c - 1 + j] = x; })); return rng; },
      };
      const prx = new Proxy(rng, { get: (t, k) => k in t ? t[k] : (...a) => { (sh.calls = sh.calls || []).push([String(k), c, a[0]]); return prx; } });
      return prx;
    },
    clear() { grid.length = 0; return sh; },
  };
  return new Proxy(sh, { get: (t, k) => k in t ? t[k] : () => sh });
}

function makeContext(now0 = new Date('2026-10-03T03:00:00Z')) {
  let now = now0;
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
      parseDate: (str) => new RealDate(str + 'T00:00:00+09:00'),
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
  return { ctx, ss, sheets, get, sheet: n => ss.getSheetByName(n), setNow: d => { now = d; } };
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
  assert.strictEqual(env.sheet('WDL_LOG').grid[0].join('|'), 'ID|회차|구매일|조합구분|' + Array.from({ length: 14 }, (_, i) => (i + 1) + '경기').join('|') + '|베팅금액|적중개수|등수|당첨금|손익|메모|등록일시|구매여부|실제베팅금액|구매일시');
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
  assert.deepStrictEqual(wc, ['setNumberFormat:1', 'setNumberFormat:2']);
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

console.log(results.join('\n'));
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
