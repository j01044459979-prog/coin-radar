import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memEnv } from './helpers/memenv.mjs';
import { storeInit, storeCreate, storeSetupChallenge, storeList, storeGet, storeIntegrityCheck } from '../lib/store.mjs';
import { StoreError } from '../lib/schema.mjs';
import { closeRun, closePlan, closeCommit, closeTick, closeRetryNotices, closeSubmitEquity, closeStatus, closeMessage, closeDiagnose, closeUsd, CLOSE_PENDING_STALE_MS } from '../lib/close.mjs';
import { dayStartMs } from '../lib/time.mjs';

const D1 = '2026-10-24', D2 = '2026-10-25', D3 = '2026-10-26', D4 = '2026-10-27', H = 3600000, A = { actor: 't' };
function setup({ notifyResults = [], sendEnabled = false, setting, uiUrl = 'https://example.com/exec' } = {}) {
  const m = memEnv({ fixedClock: true }); storeInit(m.env); storeSetupChallenge(m.env, { startEquity: '300', startDay: D1, rate: '0.05' }, A);
  if (setting) storeCreate(m.env, 'setting', { name: 'closeNotify', value: setting }, A);
  const sent = [], q = [...notifyResults], clock = { t: dayStartMs(D2) + 30 * 60000 };
  const env = { now: () => clock.t, storeEnv: () => m.env, uiUrl, sendEnabled: () => sendEnabled, notify: msg => { sent.push(msg); return q.length ? q.shift() : { ok: true }; } };
  return { m, env, sent, clock, set: (d, h = 0) => { clock.t = dayStartMs(d) + h * H + 30 * 60000; } };
}
const rows = (x, e) => storeList(x.m.env, e).map(r => r.data);
const trade = (x, sid, day, entry, exit, qty = '3') => { const at = dayStartMs(day) + 10 * H; for (const f of [{ fillId: `${sid}i`, kind: 'entry', at, price: entry }, { fillId: `${sid}o`, kind: 'close', at: at + H, price: exit }]) storeCreate(x.m.env, 'fill', { origin: 'real', sid, dir: 'LONG', qty, fee: { state: 'entered', amount: '0' }, funding: { state: 'entered', amount: '0' }, ...f }, A); };

test('마감: 어제 하루를 한 번 마감(스냅샷), 같은 날 재실행·재트리거는 변화 없음, 300/5% 유지', () => {
  const x = setup(); assert.equal(closeRun(x.env).closed.length, 1); const [c] = rows(x, 'dayclose');
  assert.deepEqual([c.day, c.source, c.startMicro, c.targetMicro, c.closeMicro, c.pnlMicro, c.walletMicro, c.needsReview], [D1, 'ledger', '300000000', '315000000', '300000000', '0', '300000000', false]); assert.ok(c.flags.includes('close-from-ledger'));
  const audit = x.m.sheets.get('Audit').length; for (let i = 0; i < 3; i++) { const r = closeRun(x.env); assert.deepEqual([r.closed, r.skipped], [[], []]); } assert.equal(x.m.sheets.get('Audit').length, audit);
  x.clock.t = dayStartMs(D2) + 23 * H; assert.deepEqual(closeRun(x.env).closed, []);                            // 같은 KST 날(D2) 안에서는 D1 외에 더 마감할 날이 없다
  x.set(D3); assert.deepEqual(closeRun(x.env).closed, [D2]); assert.equal(rows(x, 'dayclose').length, 2);
  const c2 = rows(x, 'dayclose').find(d => d.day === D2); assert.equal(c2.targetMicro, '315000000');         // 목표 = 전일 *실제* 마감(300) × 1.05 가 아니라, 입력 없으면 장부 근사 300 → 315. 미달분 비이월
  assert.equal(storeIntegrityCheck(x.m.env).ok, true);
});
test('마감: 시작 전·챌린지 없음은 아무것도 하지 않고, 자정 직전(23:59)은 오늘을 마감하지 않는다', () => {
  const x = setup(); x.clock.t = dayStartMs(D1) + 23 * H + 59 * 60000; assert.deepEqual(closeRun(x.env), { status: 'not-started', closed: [], skipped: [] }); assert.equal(rows(x, 'dayclose').length, 0);
  x.clock.t = dayStartMs(D2); assert.deepEqual(closeRun(x.env).closed, [D1]);                                  // 00:00:00 정각부터
  const empty = memEnv({ fixedClock: true }); storeInit(empty.env); assert.equal(closeRun({ now: () => dayStartMs(D2), storeEnv: () => empty.env }).status, 'no-challenge');
});
test('마감: 동시 실행 — 계획 후 다른 트리거가 먼저 마감해도 같은 날은 한 건만 남고, 락 실패는 아무것도 쓰지 않는다', () => {
  const x = setup(); const planB = closePlan(x.env); assert.deepEqual(planB.todo, [D1]);       // B는 D1이 아직 열려 있다고 읽음
  assert.deepEqual(closeRun(x.env).closed, [D1]);                                                // A가 먼저 마감
  const r = closeCommit(x.env, planB, { now: x.clock.t + 5000 }); assert.deepEqual([r.closed, r.skipped], [[], [D1]]); assert.equal(rows(x, 'dayclose').length, 1); assert.equal(rows(x, 'dayclose')[0].closedAt, x.clock.t);   // 먼저 쓴 기록이 유지됨
  assert.equal(x.sent.length, 0);                                                                // 뒤진 실행은 알림도 만들지 않는다
  const y = setup({ sendEnabled: true, setting: 'on' }); const p1 = closePlan(y.env), p2 = closePlan(y.env); closeCommit(y.env, p1); closeCommit(y.env, p2); assert.equal(y.sent.length, 1); assert.equal(rows(y, 'dayclose').length, 1);
  y.m.setLockBusy(true); assert.throws(() => closeRun({ ...y.env, now: () => dayStartMs(D3) }), e => e instanceof StoreError && e.code === 'LOCK'); y.m.setLockBusy(false); assert.equal(rows(y, 'dayclose').length, 1);
  assert.deepEqual(closeRun({ ...y.env, now: () => dayStartMs(D3) }).closed, [D2]);
});
test('마감: 놓친 날은 순서대로 한 번씩(최대 31일), 미입력 알림은 하나로 묶인다', () => {
  const x = setup({ sendEnabled: true, setting: 'on' }); x.set(D4); const r = closeRun(x.env); assert.deepEqual(r.closed, [D1, D2, D3]); assert.deepEqual(r.notices, { sent: 3, failed: 0, off: 0, skipped: 0 });
  assert.equal(x.sent.length, 1); assert.match(x.sent[0].text, /^RICH300 · 마감 평가액 미입력 3일 \(2026-10-24 ~ 2026-10-26\)\n최근 장부 잔고 300\.00 USDT · 입력하면 차이를 확인합니다$/);
  assert.equal(x.sent[0].url, 'https://example.com/exec?p=journal&day=2026-10-26#close');
  const far = setup(); far.clock.t = dayStartMs('2027-02-01'); assert.equal(closeRun(far.env).closed.length, 31); assert.equal(closeRun(far.env).closed.length, 31);
});
test('알림 기본 OFF: 설정 off·미승인·sendEnabled=false에서는 보내지 않고, 나중에 켜도 과거 날짜는 소급 발송하지 않는다', () => {
  const x = setup({ sendEnabled: true }); closeRun(x.env); assert.equal(x.sent.length, 0); assert.deepEqual(rows(x, 'closenotice').map(n => [n.day, n.status, n.error]), [[D1, 'off', 'setting-off']]);
  storeCreate(x.m.env, 'setting', { name: 'closeNotify', value: 'on' }, A); x.set(D3); closeRun(x.env);     // 이제 on: D2는 새로 마감 → 발송
  assert.equal(x.sent.length, 1); assert.match(x.sent[0].text, /2026-10-25/); assert.equal(x.sent.some(s => s.text.includes(D1)), false); assert.equal(closeTick(x.env).retry.retried, 0);
  const y = setup({ sendEnabled: false, setting: 'on' }); closeRun(y.env); assert.equal(y.sent.length, 0); assert.equal(rows(y, 'closenotice')[0].error, 'not-approved');
  const z = setup({ setting: 'on' }); z.env.notify = undefined; z.env.sendEnabled = () => true; closeRun(z.env); assert.equal(rows(z, 'closenotice')[0].status, 'off');
  assert.equal(readFileSync(new URL('../lib/schema.mjs', import.meta.url), 'utf8').includes("closeNotify: 'off'"), true);
});
test('알림 1회: 평가액을 입력해 둔 날은 알림 없음, 보낸 날은 재실행해도 다시 보내지 않는다', () => {
  const x = setup({ sendEnabled: true, setting: 'on' }); storeCreate(x.m.env, 'equity', { day: D1, equity: '300' }, A); closeRun(x.env); assert.equal(x.sent.length, 0); assert.equal(rows(x, 'closenotice').length, 0); assert.equal(rows(x, 'dayclose')[0].source, 'input');
  x.set(D3); closeRun(x.env); assert.equal(x.sent.length, 1); assert.equal(rows(x, 'closenotice')[0].status, 'sent'); for (let i = 0; i < 4; i++) closeTick(x.env); assert.equal(x.sent.length, 1);
});
test('알림 실패: 확실한 실패만 총 2회까지 재시도, 평가액을 입력하면 재시도 중단, 발송 중 중단은 재발송하지 않는다', () => {
  const x = setup({ sendEnabled: true, setting: 'on', notifyResults: [{ ok: false, code: 'network' }, { ok: false, code: 'rate-limit' }] }); closeRun(x.env);
  assert.deepEqual(rows(x, 'closenotice').map(n => [n.status, n.attempts, n.error]), [['failed', 1, 'network']]);
  let r = closeTick(x.env); assert.deepEqual([r.retry.retried, r.retry.failed], [1, 1]); assert.deepEqual(rows(x, 'closenotice').map(n => [n.status, n.attempts]), [['failed', 2]]);
  r = closeTick(x.env); assert.equal(r.retry.retried, 0); assert.equal(x.sent.length, 2);                      // 총 2회에서 멈춤
  const y = setup({ sendEnabled: true, setting: 'on', notifyResults: [{ ok: false, code: 'network' }] }); closeRun(y.env); storeCreate(y.m.env, 'equity', { day: D1, equity: '300' }, A); assert.equal(closeTick(y.env).retry.retried, 0); assert.equal(y.sent.length, 1);
  const z = setup({ sendEnabled: true, setting: 'on' }); storeCreate(z.m.env, 'closenotice', { day: D1, status: 'pending', attempts: 1, at: z.clock.t - CLOSE_PENDING_STALE_MS - 1 }, A); closeRun(z.env);
  const u = closeRetryNotices(z.env); assert.equal(u.unknown, 1); assert.equal(rows(z, 'closenotice')[0].status, 'unknown'); assert.equal(closeTick(z.env).retry.retried, 0); assert.equal(z.sent.length, 0);
  const t = setup({ sendEnabled: true, setting: 'on' }); t.env.notify = () => { throw new Error('boom secret'); }; closeRun(t.env); assert.deepEqual(rows(t, 'closenotice').map(n => [n.status, n.error]), [['failed', 'exception']]);
});
test('평가액 입력: 신규·같은 값(unchanged)·수정(사유 기록)·늦은 입력 표시·날짜 검증·차이 계산(자동 흡수 없음)', () => {
  const x = setup(); trade(x, 'S1', D1, '100', '103');          // 장부: 300 + 9 = 309
  let r = closeSubmitEquity(x.env, { day: D1, equity: '309' }, { now: dayStartMs(D1) + 20 * H }); assert.deepEqual([r.status, r.late, r.diffLabel, r.needsReview, r.expectedLabel], ['added', false, '0.00', false, '309.00']);
  r = closeSubmitEquity(x.env, { day: D1, equity: '309.00' }, { now: dayStartMs(D1) + 21 * H }); assert.equal(r.status, 'unchanged');
  r = closeSubmitEquity(x.env, { day: D1, equity: '315', reason: '거래소 화면 재확인' }, { now: dayStartMs(D2) + H }); assert.deepEqual([r.status, r.late, r.diffLabel, r.needsReview], ['revised', true, '6.00', true]);
  assert.equal(storeGet(x.m.env, 'equity', D1).rev, 2); assert.equal(rows(x, 'equity')[0].late, true); assert.equal(storeIntegrityCheck(x.m.env).ok, true);
  for (const bad of [{ day: '2026-10-23', equity: '1' }, { day: '2026-13-01', equity: '1' }, { day: D4, equity: '1' }, { day: D1, equity: 'abc' }, { day: D1, equity: '-1' }]) assert.throws(() => closeSubmitEquity(x.env, bad, { now: dayStartMs(D2) }), e => e instanceof StoreError && e.code === 'VALIDATION');
  const w = setup(); r = closeSubmitEquity(w.env, { day: D1, equity: '305', unrealized: '2.5' }, { now: dayStartMs(D2) + H }); assert.equal(r.diffLabel, '2.50');
});
test('진단: 거래·입출금 없는 날의 큰 차이=입출금 누락 의심, 수수료·펀딩 미입력+차이=원인 후보, 평가액만 있고 정상이면 경고 없음', () => {
  const x = setup(); let r = closeSubmitEquity(x.env, { day: D1, equity: '350' }, { now: dayStartMs(D2) + H }); assert.deepEqual([r.needsReview, r.flags.includes('possible-missing-cashflow'), r.flags.includes('ledger-mismatch')], [true, true, true]);
  const y = setup(); const at = dayStartMs(D1) + 10 * H; for (const f of [{ fillId: 'i', kind: 'entry', at, price: '100' }, { fillId: 'o', kind: 'close', at: at + H, price: '110' }]) storeCreate(y.m.env, 'fill', { origin: 'real', sid: 'F', dir: 'LONG', qty: '3', fee: { state: 'missing' }, funding: { state: 'missing' }, ...f }, A);
  r = closeSubmitEquity(y.env, { day: D1, equity: '320' }, { now: dayStartMs(D2) + H }); assert.deepEqual([r.flags.includes('fees-may-explain'), r.flags.includes('possible-missing-cashflow'), r.flags.includes('fee-missing')], [true, false, true]);
  const ok = setup(); r = closeSubmitEquity(ok.env, { day: D1, equity: '300' }, { now: dayStartMs(D1) + 23 * H }); assert.deepEqual(r.flags, []);
  assert.deepEqual(closeDiagnose({ needsReview: true, flags: ['ledger-mismatch'] }, { fillCount: 0, cashCount: 1, adjCount: 0 }), ['ledger-mismatch']);
  const c = setup(); storeCreate(c.m.env, 'cashflow', { cfId: 'd', at: dayStartMs(D1) + H, amount: '50' }, A); r = closeSubmitEquity(c.env, { day: D1, equity: '350' }, { now: dayStartMs(D2) + H }); assert.deepEqual([r.needsReview, r.diffLabel], [false, '0.00']);          // 입출금을 기록하면 차이 해소
});
test('마감 기록과 상태: 마감 후 늦은 입력은 기록을 바꾸지 않고 상태에 늦은 입력으로 나온다', () => {
  const x = setup(); closeRun(x.env); const before = JSON.stringify(rows(x, 'dayclose')); closeSubmitEquity(x.env, { day: D1, equity: '300' }, { now: dayStartMs(D2) + 2 * H });
  assert.equal(JSON.stringify(rows(x, 'dayclose')), before); const s = closeStatus(x.env, { now: dayStartMs(D2) + 3 * H }); assert.deepEqual(s.map(d => [d.day, d.today, d.closed, d.equity, d.late, d.source]), [[D2, true, false, null, false, null], [D1, false, true, '300', true, 'ledger']]);
});
test('문구·형식: 한 날 알림은 2줄, URL은 https만, 금액 표기', () => {
  const m = closeMessage([{ day: D1, walletMicro: '1234567890' }], 'https://x.io/exec'); assert.equal(m.text.split('\n').length, 2); assert.equal(m.text, 'RICH300 · 2026-10-24 마감 평가액 미입력\n장부 잔고 1,234.57 USDT · 입력하면 차이를 확인합니다'); assert.equal(m.url, 'https://x.io/exec?p=journal&day=2026-10-24#close');
  assert.equal(closeMessage([{ day: D1, walletMicro: '1' }], 'http://x.io').url, null); assert.equal(closeMessage([{ day: D1, walletMicro: '1' }], undefined).url, null); assert.equal(closeMessage([{ day: D1, walletMicro: '1' }], 'https://x.io/e?a=1').url, 'https://x.io/e?a=1&p=journal&day=2026-10-24#close');
  assert.equal(closeUsd(-1n), '0.00'); assert.equal(closeUsd(-5000n), '−0.01'); assert.equal(closeUsd(0n), '0.00');
  const src = readFileSync(new URL('../lib/close.mjs', import.meta.url), 'utf8'); assert.ok(!/console\.|Logger\.log|UrlFetchApp|fetch\(/.test(src));
});
