import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv } from './harness.mjs';

const P = { SHEET_ID: 'SHEET', STAFF_PASSWORD: 'pw-staff', ADMIN_PASSWORD: 'pw-admin' };
const act = (o = {}) => ({ date: '2026-10-09', staff: '전명석', aptId: 'APT011', dongs: '207동, 212동', type: '계단형', entry: '비밀번호 없음', memo: '', ...o });

test('비밀번호 없이/가짜 토큰으로 모든 데이터 API 차단', () => {
  const e = createEnv({ props: P });
  for (const fn of ['getBootstrap', 'listActivities', 'addActivity', 'updateActivity', 'deleteActivity', 'staffActivity', 'analytics', 'updateApartment']) {
    for (const tok of [undefined, null, '', 'x'.repeat(60), { a: 1 }]) {
      const r = e.call(fn, tok, act(), act(), act());
      assert.equal(r.ok, false, fn); assert.equal(r.session, false, fn);
    }
  }
  assert.equal(e.sheets['활동기록'].length, 1);
});

const D1 = 'device-aaaaaaaa', D2 = 'device-bbbbbbbb';
test('잘못된 비밀번호 거부, 5회 실패 시 해당 기기만 잠금 — 다른 기기/직원은 영향 없음', () => {
  const e = createEnv({ props: P });
  for (let i = 0; i < 4; i++) assert.equal(e.call('login', 'bad', D1).ok, false);
  assert.equal(e.call('login', 'bad', D1).locked, true);
  assert.equal(e.call('login', 'pw-staff', D1).ok, false);   // 잠긴 기기는 정답도 거부
  assert.equal(e.call('login', 'pw-staff', D2).ok, true);    // 다른 기기는 정상 로그인
});

test('잠금은 5분 후 해제', () => {
  let t = 1e12; const e = createEnv({ props: P, now: () => t });
  for (let i = 0; i < 5; i++) e.call('login', 'bad', D1);
  t += 301e3; assert.equal(e.call('login', 'pw-staff', D1).ok, true);
});

test('기기 ID를 바꿔가며 대량 시도해도 정답 로그인은 막히지 않고 틀린 시도만 지연', () => {
  const e = createEnv({ props: P });
  let slept = 0; e.g.Utilities.sleep = (ms) => { slept += ms; };
  for (let i = 0; i < 40; i++) e.call('login', 'bad', 'rotating-' + String(i).padStart(4, '0'));
  assert.ok(slept > 0);
  const before = slept;
  assert.equal(e.call('login', 'pw-staff', D2).ok, true);
  assert.equal(slept, before);
});

test('관리자 인증 실패는 해당 세션만 잠금, 다른 세션 영향 없음', () => {
  const e = createEnv({ props: P });
  const a = e.call('login', 'pw-staff', D1).token, b = e.call('login', 'pw-staff', D2).token;
  for (let i = 0; i < 5; i++) e.call('adminLogin', a, 'bad');
  assert.equal(e.call('adminLogin', a, 'pw-admin').ok, false);
  assert.equal(e.call('adminLogin', b, 'pw-admin').ok, true);
});

test('비밀번호 미설정이면 로그인 불가 / 관리자 비밀번호 미설정이면 관리자 꺼짐', () => {
  assert.equal(createEnv({ props: { SHEET_ID: 'SHEET' } }).call('login', '').ok, false);
  const e = createEnv({ props: { SHEET_ID: 'SHEET', STAFF_PASSWORD: 'a' } });
  const { token } = e.call('login', 'a');
  assert.equal(e.call('adminLogin', token, '').ok, false);
  assert.equal(e.call('analytics', token, '2026-10-01', '2026-10-09').ok, false);
});

test('직원 비밀번호만으로 관리자 기능 불가, 관리자 비밀번호로 승격, 직원 PW는 관리자 PW로 안 통함', () => {
  const e = createEnv({ props: P });
  const { token } = e.call('login', 'pw-staff');
  assert.equal(e.call('staffActivity', token, '', '').admin, false);
  assert.equal(e.call('adminLogin', token, 'pw-staff').ok, false);
  assert.equal(e.call('adminLogin', token, 'pw-admin').ok, true);
  assert.equal(e.call('staffActivity', token, '', '').ok, true);
  assert.equal(e.call('login', 'pw-admin').ok, false); // 관리자 PW는 직원 로그인 불가
});

test('관리자 승격은 30분 후 만료', () => {
  let t = 1e12; const e = createEnv({ props: P, now: () => t });
  const { token } = e.call('login', 'pw-staff'); e.call('adminLogin', token, 'pw-admin');
  t += 31 * 60e3; assert.equal(e.call('analytics', token, '2026-10-01', '2026-10-02').admin, false);
});

test('세션 만료·로그아웃 후 차단', () => {
  let t = 1e12; const e = createEnv({ props: P, now: () => t });
  const a = e.call('login', 'pw-staff').token, b = e.call('login', 'pw-staff').token;
  assert.equal(e.call('getBootstrap', a).ok, true);
  e.call('logout', a); assert.equal(e.call('getBootstrap', a).session, false);
  t += 6 * 3600e3 + 1000; assert.equal(e.call('getBootstrap', b).session, false);
});

test('bootstrap: 직원 4명 제한, 비밀번호/시트ID 미노출, QR 추적주소는 신규 URL', () => {
  const e = createEnv({ props: P });
  const { token } = e.call('login', 'pw-staff');
  const b = e.call('getBootstrap', token);
  assert.equal(JSON.stringify(b.staff), JSON.stringify(['전명석', '박영빈', '김소명', '유병규']));
  const s = JSON.stringify(b);
  assert.ok(!s.includes('pw-staff') && !s.includes('pw-admin') && !s.includes('SHEET'));
  assert.equal(b.qr.promoUrl, 'https://script.google.com/macros/s/NEW/exec?qr=promo');
  assert.equal(b.qr.regularUrl, 'https://su.kt.co.kr/SlRIQr5');
  assert.ok(!b.apartments.some((a) => a.id === 'APT099'));
});

test('활동 등록·조회·수정, 아파트DB 집계 갱신, 입력 검증', () => {
  const e = createEnv({ props: P });
  const { token } = e.call('login', 'pw-staff');
  assert.equal(e.call('addActivity', token, act()).ok, true);
  assert.equal(e.call('addActivity', token, act({ staff: '황윤주' })).ok, false);
  assert.equal(e.call('addActivity', token, act({ dongs: 'abc' })).ok, false);
  assert.equal(e.call('addActivity', token, act({ aptId: 'APT099' })).ok, false);
  assert.equal(e.call('addActivity', token, act({ date: '2026/10/09' })).ok, false);
  const r = e.call('addActivity', token, act({ date: '2026-10-10', staff: '박영빈', dongs: '202, 203동, 203동', memo: '=HYPERLINK("x")' }));
  assert.equal(r.ok, true);
  const l = e.call('listActivities', token, { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(l.items.length, 2);
  const it = l.items.find((x) => x.staff === '박영빈');
  assert.equal(it.dongs, '202동, 203동'); assert.equal(it.count, 2); assert.ok(it.memo.startsWith("'="));
  const apt = e.sheets['아파트DB'][2]; assert.equal(apt[10], 4);
  assert.equal(e.call('updateActivity', token, it.id, act({ date: '2026-10-10', staff: '박영빈', dongs: '202동' })).ok, true);
  assert.equal(e.sheets['아파트DB'][2][10], 3);
  assert.equal(e.call('listActivities', token, { staff: '전명석' }).items.length, 1);
  assert.equal(e.call('updateActivity', token, 'NOPE', act()).ok, false);
});

test('삭제는 관리자만, 삭제 후 집계 재계산', () => {
  const e = createEnv({ props: P });
  const { token } = e.call('login', 'pw-staff');
  const id = (e.call('addActivity', token, act()), e.call('listActivities', token, {}).items[0].id);
  assert.equal(e.call('deleteActivity', token, id).admin, false);
  e.call('adminLogin', token, 'pw-admin');
  assert.equal(e.call('deleteActivity', token, id).ok, true);
  assert.equal(e.sheets['활동기록'].length, 1); assert.equal(e.sheets['아파트DB'][2][10], 0);
});

test('분석: 일별/직원별/아파트별/QR/기간비교', () => {
  const e = createEnv({ props: P });
  const { token } = e.call('login', 'pw-staff'); e.call('adminLogin', token, 'pw-admin');
  e.call('addActivity', token, act({ date: '2026-10-08', dongs: '201동' }));
  e.call('addActivity', token, act({ date: '2026-10-09', dongs: '207동, 212동', staff: '유병규' }));
  e.call('addActivity', token, act({ date: '2026-10-02', dongs: '203동', aptId: 'APT002' }));
  e.call('doGet', { parameter: { qr: 'promo' } });
  const r = e.call('analytics', token, '2026-10-08', '2026-10-09');
  assert.equal(r.current.dongs, 3); assert.equal(r.previous.dongs, 0 + 0);
  assert.equal(r.daily.length, 2); assert.equal(r.daily[1].dongs, 2);
  assert.equal(r.staff[0].staff, '유병규'); assert.equal(r.apartments[0].name, '신선마을');
  assert.equal(e.call('analytics', token, '2026-10-09', '2026-10-01').ok, false);
  assert.equal(e.call('analytics', token, '2020-01-01', '2026-10-01').ok, false);
});

test('QR①: 접속 기록 + 신규/지정 URL로 이동, 중복 방지, 데이터 미노출, 시트 장애에도 이동', () => {
  let t = 1e12; const e = createEnv({ props: P, now: () => t });
  const o = e.call('doGet', { parameter: { qr: 'promo' } });
  assert.ok(o.html.includes('https://naver.me/Fm2I607T'));
  assert.ok(!o.html.includes('pw-') && !o.html.includes('APT0') && !o.html.includes('SHEET'));
  assert.equal(e.sheets['QR접속기록'].length, 2);
  assert.equal(e.sheets['QR접속기록'][1][3], '홍보QR');
  e.call('doGet', { parameter: { qr: 'promo' } }); assert.equal(e.sheets['QR접속기록'].length, 2); // 중복
  t += 6e3; e.call('doGet', { parameter: { qr: 'promo' } }); assert.equal(e.sheets['QR접속기록'].length, 3);
  const bad = createEnv({ props: { ...P, SHEET_ID: 'WRONG' } });
  assert.ok(bad.call('doGet', { parameter: { qr: 'promo' } }).html.includes('https://naver.me/Fm2I607T'));
});

test('공개 doGet은 어떤 파라미터로도 데이터를 반환하지 않음', () => {
  const e = createEnv({ props: P });
  for (const p of [{}, { qr: 'x' }, { action: 'list' }, { fn: 'listActivities' }, { qr: 'regular' }]) {
    const o = e.call('doGet', { parameter: p });
    assert.equal(o.file, 'Index'); // 정적 로그인 화면만
  }
});
