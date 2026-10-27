// ?p=ops 실전 감시 관리: 가짜 Apps Script·가짜 Telegram·가짜 거래소. 가상 포지션과 모의 알림만 사용(실제 Telegram 전송·실제 속성 변경 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProd } from './helpers/gasprod.mjs';
import { seed } from '../perf/bench.mjs';
import { OWNER } from './helpers/faketg.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const NOW = 1790000000000, H = 3600000, TOKEN = '123456789:AAFakeTokenForOfflineTestsOnly_0123456789abc', PHRASE = '실전 감시 시작';
const okxBars = (n, { start, drift, step }) => ({ code: '0', data: Array.from({ length: n }, (_, i) => { const idx = n - 1 - i, c = start * (1 + drift * idx), t = NOW - (i + 1) * step; return [String(t), String(c), String(c * 1.002), String(c * 0.998), String(c), '100', '0', '0', '1']; }) });
const j = v => JSON.parse(JSON.stringify(v)), strip = h => h.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ');
const snap = g => Object.fromEntries(g.P.getKeys().sort().map(k => [k, g.P.getProperty(k)]));
function world({ paired = true, positions = false, down = false } = {}) {
  const g = loadProd({ props: { RICH300_PROD_APPROVED: 'yes' } }); seed(g, 3); const inst = g.ctx.rich300Install();
  if (paired) { g.tele.say(OWNER, `/start ${inst.pairLink.split('=')[1]}`); g.ctx.rich300TgPoll(); }
  assert.equal(g.P.getProperty('RICH300_TG_TOKEN'), TOKEN);
  g.P.deleteProperty('RICH300_PROD_APPROVED');                                  // 현재 운영 상태: 페어링됨 · 운영 승인 없음 · 감시 꺼짐
  const hits = [], w = { g, hits, price: 150, down };
  g.spy.marketHandler = url => {
    hits.push(url); if (w.down) return { status: 503, body: 'down' }; const p = w.price;
    if (/ticker/.test(url)) return { status: 200, body: { code: '0', data: [{ last: String(p), ts: String(NOW - 30000) }] } };
    if (/bar=15m/.test(url)) return { status: 200, body: { code: '0', data: [[String(NOW - 900000), String(p), String(p), String(p), String(p), '1', '0', '0', '1']] } };
    return /bar=1H/.test(url) ? { status: 200, body: okxBars(100, { start: p * 0.95, drift: 0.0005, step: H }) } : { status: 200, body: okxBars(100, { start: p * 0.8, drift: 0.002, step: 4 * H }) };
  };
  if (positions) { g.ctx.rich300ManualRegister({ formId: 'o1', symbol: 'SOL', dir: 'LONG', entry: '140', qty: '2', leverage: '3', stop: '135', tp1: '148', tp2: '', at: '' }); hits.length = 0; }
  g.tele.sent.length = 0; g.cache.evictAll(); return w;
}
const watchTrig = g => g.spy.triggers.filter(t => !t.deleted && t.fn === 'rich300WatchTick').length;
const sentWatch = g => g.tele.sent.filter(m => /\[RICH300\]/.test(m.text));

test('?p=ops 는 소유자만 · 열기만 해서는 아무것도 바꾸지 않는다(속성·트리거·텔레그램·시세 0) · 현재 상태를 값 없이 보여 준다', () => {
  const w = world(); const before = snap(w.g), trig = w.g.spy.triggers.length, h = w.g.ctx.doGet({ parameter: { p: 'ops' } }).html, t = strip(h);
  assert.match(t, /실전 감시 관리/); assert.match(t, /토큰 있음 · 페어링 됨/); assert.match(t, /운영 승인\(RICH300_PROD_APPROVED\): 없음/); assert.match(t, /감시 설정\(RICH300_WATCH_ALERTS\): 없음\(꺼짐\)/); assert.match(t, /5분 감시 트리거: 0개/); assert.match(t, /실제 동작: 아무것도 하지 않음\(꺼짐\)/);
  assert.match(h, /id="on" class="go" type="button" disabled/); assert.deepEqual(snap(w.g), before); assert.equal(w.g.spy.triggers.length, trig); assert.equal(w.hits.length, 0); assert.equal(w.g.tele.sent.length, 0);
  assert.ok(!h.includes(TOKEN) && !h.includes(String(OWNER))); assert.match(loadProd({ email: 'other@example.com' }).ctx.doGet({ parameter: { p: 'ops' } }).html, /접근 제한/);
});
test('비소유자의 직접 함수 호출은 모두 forbidden · 아무것도 바뀌지 않는다', () => {
  const w = world(); w.g.ctx.rich300Session && 0; const o = loadProd({ email: 'other@example.com' }), before = snap(o);
  for (const [fn, args] of [['rich300OpsPrecheck', []], ['rich300OpsEnable', [PHRASE]], ['rich300OpsDisable', []]]) assert.deepEqual(j(o.ctx[fn](...args)), { ok: false, code: 'forbidden' }, fn);
  assert.deepEqual(snap(o), before); assert.equal(watchTrig(o), 0);
});
test('허용 목록: 운영 승인(yes)과 감시 설정(on/off)만 쓸 수 있다 · 임의 속성/값은 거부 · 클라이언트 호출 함수는 이름·값을 받지 않는다', () => {
  const w = world(), c = w.g.ctx;
  for (const [n, v] of [['RICH300_TG_TOKEN', 'x'], ['RICH300_OWNER_EMAIL', 'a@b.c'], ['RICH300_SHEET_ID', 'x'], ['RICH300_WATCH_ALERTS', 'preview'], ['RICH300_PROD_APPROVED', 'no'], ['RICH300_WATCH_ALERTS', ''], ['x', 'y']]) assert.throws(() => c.rich300OpsSet_(n, v), /ops-/, n + '=' + v);
  for (const n of ['RICH300_TG_TOKEN', 'RICH300_SHEET_ID', 'w:cap', 'tg:paired']) assert.throws(() => c.rich300OpsDel_(n), /ops-not-allowed/, n);
  assert.equal(c.rich300OpsEnable.length, 1); assert.equal(c.rich300OpsDisable.length, 0); assert.equal(c.rich300OpsPrecheck.length, 0); assert.equal(w.g.P.getProperty('RICH300_TG_TOKEN'), TOKEN);
});
test('활성화 전제: 사전 점검 통과 기록과 확인 문구가 없으면 거부(서버 검증) · 아무것도 바뀌지 않는다', () => {
  const w = world(), before = snap(w.g);
  assert.equal(j(w.g.ctx.rich300OpsEnable('')).code, 'phrase'); assert.equal(j(w.g.ctx.rich300OpsEnable('시작')).code, 'phrase'); assert.equal(j(w.g.ctx.rich300OpsEnable(PHRASE)).code, 'precheck-required');
  assert.deepEqual(snap(w.g), before); assert.equal(watchTrig(w.g), 0);
});
test('사전 점검(보유 포지션 0건): 통과 · 읽기 전용 시세 GET 만 · 텔레그램 0 · 감시/승인/트리거 불변 · 통과 기록만 저장', () => {
  const w = world(), before = snap(w.g); const r = j(w.g.ctx.rich300OpsPrecheck()); assert.equal(r.ok, true); assert.equal(r.pass, true, JSON.stringify(r)); assert.ok(r.items.some(i => /정상 대기/.test(i.text)));
  assert.ok(w.hits.length >= 4 && w.hits.every(u => /^https:\/\/(www\.okx\.com|api\.bybit\.com)\//.test(u))); assert.equal(w.g.tele.sent.length, 0); assert.equal(watchTrig(w.g), 0);
  const after = snap(w.g), diff = Object.keys(after).filter(k => after[k] !== before[k]); assert.deepEqual(diff.filter(k => !/^(ops:precheck|cache|perf)/.test(k)), []); assert.ok(JSON.parse(after['ops:precheck']).ok);
  assert.ok(!JSON.stringify(r).includes(TOKEN));
});
test('사전 점검 실패: 시세 장애·미페어링·토큰 없음이면 pass=false 이고 활성화는 precheck-required', () => {
  const a = world({ down: true }); const ra = j(a.g.ctx.rich300OpsPrecheck()); assert.equal(ra.pass, false); assert.ok(ra.items.some(i => !i.ok && i.must && /시세/.test(i.text))); assert.equal(j(a.g.ctx.rich300OpsEnable(PHRASE)).code, 'precheck-required');
  const b = world({ paired: false }); const rb = j(b.g.ctx.rich300OpsPrecheck()); assert.equal(rb.pass, false); assert.ok(rb.items.some(i => i.id === 'paired' && !i.ok));
  const c = world(); c.g.P.deleteProperty('RICH300_TG_TOKEN'); const rc = j(c.g.ctx.rich300OpsPrecheck()); assert.equal(rc.pass, false); assert.ok(rc.items.some(i => i.id === 'token' && !i.ok));
});
test('사전 점검 통과 기록은 15분 뒤·다른 빌드면 무효', () => {
  const w = world(); w.g.ctx.rich300OpsPrecheck(); const rec = JSON.parse(w.g.P.getProperty('ops:precheck'));
  w.g.P.setProperty('ops:precheck', JSON.stringify({ ...rec, at: Date.now() - 16 * 60000 })); assert.equal(j(w.g.ctx.rich300OpsEnable(PHRASE)).code, 'precheck-required');
  w.g.P.setProperty('ops:precheck', JSON.stringify({ ...rec, build: 'other' })); assert.equal(j(w.g.ctx.rich300OpsEnable(PHRASE)).code, 'precheck-required'); assert.equal(watchTrig(w.g), 0); assert.ok(!w.g.P.getProperty('RICH300_WATCH_ALERTS'));
});
test('활성화: 운영 승인 yes + 감시 on + 트리거 정확히 1개 · 다시 조회해 확인 · 기존 트리거/속성 보존 · 텔레그램 전송 0 · 재실행은 변화 없음', () => {
  const w = world(); const others = w.g.spy.triggers.filter(t => !t.deleted).map(t => t.fn).sort(), before = snap(w.g); assert.equal(j(w.g.ctx.rich300OpsPrecheck()).pass, true);
  const r = j(w.g.ctx.rich300OpsEnable(` ${PHRASE} `)); assert.deepEqual([r.ok, r.code, r.triggers], [true, 'enabled', 1], JSON.stringify(r));
  assert.equal(w.g.P.getProperty('RICH300_PROD_APPROVED'), 'yes'); assert.equal(w.g.P.getProperty('RICH300_WATCH_ALERTS'), 'on'); assert.equal(watchTrig(w.g), 1); assert.equal(w.g.tele.sent.length, 0);
  assert.deepEqual(w.g.spy.triggers.filter(t => !t.deleted && t.fn !== 'rich300WatchTick').map(t => t.fn).sort(), others);
  const after = snap(w.g); for (const k of Object.keys(before)) if (!/^(ops:|cache|perf|RICH300_PROD_APPROVED|RICH300_WATCH_ALERTS)/.test(k)) assert.equal(after[k], before[k], k);
  assert.match(strip(w.g.ctx.doGet({ parameter: { p: 'ops' } }).html), /실제 동작: 전송 중\(실전 감시 켜짐\)/); assert.match(strip(w.g.ctx.doGet({ parameter: { p: 'watch' } }).html), /전송 가능/);
  const again = j(w.g.ctx.rich300OpsEnable(PHRASE)); assert.deepEqual([again.ok, again.code], [true, 'already-on']); assert.equal(watchTrig(w.g), 1);          // 중복 클릭: 트리거 중복 없음
  assert.ok(!JSON.stringify([r, again]).includes(TOKEN));
});
test('종단: 활성화 후 첫 실행은 등록 포지션에 한해 모의 알림 1건 · 중복 없음 · 중지하면 이후 전송 0', () => {
  const w = world({ positions: true }); w.price = 134; w.g.cache.evictAll();                                    // 손절(135) 아래
  assert.equal(j(w.g.ctx.rich300OpsPrecheck()).pass, true); assert.equal(j(w.g.ctx.rich300OpsEnable(PHRASE)).ok, true); assert.equal(w.g.tele.sent.length, 0);
  const t1 = j(w.g.ctx.rich300WatchTick()); assert.equal(t1.status, 'ok', JSON.stringify(t1)); const n = sentWatch(w.g).length; assert.ok(n >= 1); assert.ok(sentWatch(w.g).some(m => /손절가 이탈/.test(m.text)));
  w.g.ctx.rich300WatchTick(); assert.equal(sentWatch(w.g).length, n);
  const off = j(w.g.ctx.rich300OpsDisable()); assert.deepEqual([off.ok, off.code, off.triggers], [true, 'disabled', 0]); assert.equal(w.g.P.getProperty('RICH300_WATCH_ALERTS'), 'off'); assert.equal(watchTrig(w.g), 0);
  assert.deepEqual(j(w.g.ctx.rich300WatchTick()), { status: 'off' }); assert.equal(sentWatch(w.g).length, n); assert.equal(w.g.P.getProperty('RICH300_PROD_APPROVED'), 'yes'); assert.equal(w.g.P.getProperty('RICH300_TG_TOKEN'), TOKEN);
});
test('실패 시 부분 활성화 없음: 트리거 설치 예외 → 감시 off · 트리거 0 · 운영 승인 이전 상태(없음)로 복원', () => {
  const w = world(); w.g.ctx.rich300OpsPrecheck(); const real = w.g.ctx.rich300WatchInstallTrigger; w.g.ctx.rich300WatchInstallTrigger = () => { throw new Error('quota'); };
  const r = j(w.g.ctx.rich300OpsEnable(PHRASE)); assert.deepEqual([r.ok, r.code, r.rolledBack], [false, 'exception', true]);
  assert.equal(w.g.P.getProperty('RICH300_PROD_APPROVED'), null); assert.notEqual(w.g.P.getProperty('RICH300_WATCH_ALERTS'), 'on'); assert.equal(watchTrig(w.g), 0); assert.match(w.g.P.getProperty('ops:last'), /rolled-back/);
  w.g.ctx.rich300WatchInstallTrigger = real;
});
test('실패 시 부분 활성화 없음: 확인 단계 실패(트리거가 2개) → 되돌림 · 되돌림 자체가 실패하면 rollback-failed 로 알림', () => {
  const w = world(); w.g.ctx.rich300OpsPrecheck(); const real = w.g.ctx.rich300WatchInstallTrigger;
  w.g.ctx.rich300WatchInstallTrigger = () => { real(); w.g.ctx.ScriptApp.newTrigger('rich300WatchTick').timeBased().everyMinutes(5).create(); };
  const r = j(w.g.ctx.rich300OpsEnable(PHRASE)); assert.deepEqual([r.ok, r.code, r.rolledBack], [false, 'verify-failed', true]); assert.equal(watchTrig(w.g), 0); assert.equal(w.g.P.getProperty('RICH300_PROD_APPROVED'), null); assert.equal(w.g.P.getProperty('RICH300_WATCH_ALERTS'), 'off');
  w.g.ctx.rich300OpsPrecheck(); const del = w.g.ctx.ScriptApp.deleteTrigger; w.g.ctx.ScriptApp.deleteTrigger = () => { throw new Error('perm'); };
  const r2 = j(w.g.ctx.rich300OpsEnable(PHRASE)); assert.deepEqual([r2.ok, r2.code, r2.rolledBack], [false, 'rollback-failed', false]); w.g.ctx.ScriptApp.deleteTrigger = del;
  assert.equal(w.g.P.getProperty('RICH300_WATCH_ALERTS'), 'off');                                                         // 트리거가 남아도 감시 설정은 off 라 아무것도 보내지 않는다
});
test('동시 실행·중복 클릭 방지: 락을 못 잡으면 busy(아무것도 바뀌지 않음) · 중지는 락 없이도 진행', () => {
  const w = world(); w.g.ctx.rich300OpsPrecheck(); const before = snap(w.g), L = w.g.ctx.LockService.getScriptLock;
  w.g.ctx.LockService.getScriptLock = () => ({ tryLock: () => false, releaseLock() {} });
  assert.equal(j(w.g.ctx.rich300OpsEnable(PHRASE)).code, 'busy'); assert.equal(j(w.g.ctx.rich300OpsPrecheck()).code, 'busy'); assert.deepEqual(snap(w.g), before); assert.equal(watchTrig(w.g), 0);
  w.g.ctx.LockService.getScriptLock = L; assert.equal(j(w.g.ctx.rich300OpsEnable(PHRASE)).ok, true);
  w.g.ctx.LockService.getScriptLock = () => ({ tryLock: () => false, releaseLock() {} }); const off = j(w.g.ctx.rich300OpsDisable()); assert.deepEqual([off.ok, off.lockless], [true, true]); assert.equal(watchTrig(w.g), 0);
  w.g.ctx.LockService.getScriptLock = L;
});
test('중지는 멱등: 꺼진 상태·트리거 없음에서도 성공 · 감시 트리거가 여러 개 남아 있어도 모두 제거', () => {
  const w = world(); assert.equal(j(w.g.ctx.rich300OpsDisable()).ok, true); for (let i = 0; i < 3; i++) w.g.ctx.ScriptApp.newTrigger('rich300WatchTick').timeBased().everyMinutes(5).create();
  assert.equal(watchTrig(w.g), 3); const r = j(w.g.ctx.rich300OpsDisable()); assert.deepEqual([r.ok, r.triggers], [true, 0]); assert.equal(watchTrig(w.g), 0);
});
test('활성화가 COIN RADAR 설정·Telegram 폴링/마감/백업 트리거·시트 데이터를 바꾸지 않는다', () => {
  const w = world({ positions: true }); const trig0 = w.g.spy.triggers.filter(t => !t.deleted).map(t => t.fn).sort(); const se = w.g.ctx.rich300GasEnv_('sheet'), E = w.g.ctx.RICH300_ENGINE, rows = () => JSON.stringify(E.storeList(se, 'fill').map(r => r.key));
  const r0 = rows(); w.g.ctx.rich300OpsPrecheck(); w.g.ctx.rich300OpsEnable(PHRASE); w.g.ctx.rich300OpsDisable();
  assert.equal(rows(), r0); assert.deepEqual(w.g.spy.triggers.filter(t => !t.deleted).map(t => t.fn).sort(), trig0); assert.ok(!w.g.P.getKeys().some(k => /RADAR|radar/.test(k)));
});
