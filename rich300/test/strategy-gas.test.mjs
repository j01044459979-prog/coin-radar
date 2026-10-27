// 추천 전략 자동 추적(Strategy.gs): 가짜 Apps Script·가짜 Telegram·가짜 거래소·가짜 피드(GitHub). 실제 전송·네트워크 없음. 시계는 spy.now 로 진행한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { loadProd } from './helpers/gasprod.mjs';
import { seed } from '../perf/bench.mjs';
import { OWNER } from './helpers/faketg.mjs';
import { authSignedString } from '../lib/auth.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const M = 900000, H = 3600000, NOW0 = 1790000000000, CLOSE = Math.floor((NOW0 - 300000) / M) * M, KEY = 'f'.repeat(40), PHRASE = '전략 추적 시작';
const j = v => JSON.parse(JSON.stringify(v)), strip = h => h.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ');
const entry = (o = {}) => ({ sid: 'SG-ETH-L-abc123', symbol: 'ETHUSDT', dir: 'LONG', entry: '2000', stop: '1970', closeT: String(CLOSE), triggerT: String(CLOSE - M), validUntil: String(CLOSE + 45 * 60000), score: '70', rr1: '1.9', evidence: ['4H 상승 · 1H 지지 눌림'], volRel: '1.5', btcAlign: '동행', costPct: '0.15', createdAt: String(CLOSE + 30000), ...o });
const signFeed = (entries, ts, meta = {}) => { const body = { entries, meta: { runId: '9001', attempt: '1', ref: 'refs/heads/main', sha: 'a'.repeat(40), event: 'schedule', mode: 'once', at: String(ts - 30000), ...meta } }, nonce = 'n'.repeat(20); return JSON.stringify({ v: 1, ts, nonce, body, sig: createHmac('sha256', KEY).update(authSignedString(1, ts, nonce, body), 'utf8').digest('hex') }); };
const okxBars = (n, now, { start, drift, step }) => ({ code: '0', data: Array.from({ length: n }, (_, i) => { const idx = n - 1 - i, c = start * (1 + drift * idx), t = Math.floor(now / step) * step - (i + 1) * step + step; return [String(t), String(c), String(c * 1.002), String(c * 0.998), String(c), '100', '0', '0', '1']; }) });
function world({ approved = true, key = true } = {}) {
  const g = loadProd({ props: { RICH300_PROD_APPROVED: 'yes' } }); seed(g, 3); const inst = g.ctx.rich300Install(); g.tele.say(OWNER, `/start ${inst.pairLink.split('=')[1]}`); g.ctx.rich300TgPoll();
  if (!approved) g.P.deleteProperty('RICH300_PROD_APPROVED'); if (key) g.P.setProperty('RICH300_FEED_KEY', KEY);
  const w = { g, hits: [], price: 2005, bars15: [], entries: [entry()] };
  g.spy.now = CLOSE + 5 * 60000;
  g.spy.feedHandler = () => ({ status: 200, body: signFeed(w.entries, g.spy.now - 60000) });
  g.spy.marketHandler = url => {
    w.hits.push(url); const now = g.spy.now, p = w.price;
    if (/ticker/.test(url)) return { status: 200, body: { code: '0', data: [{ last: String(p), ts: String(now - 30000) }] } };
    if (/bar=15m/.test(url)) { const cl = w.bars15.filter(b => b.t + M <= now); return { status: 200, body: { code: '0', data: (cl.length ? cl : [{ t: Math.floor(now / M) * M - M, o: p, h: p, l: p, c: p }]).slice().reverse().map(b => [String(b.t), String(b.o), String(b.h), String(b.l), String(b.c), '1', '0', '0', '1']) } }; }
    return /bar=1H/.test(url) ? { status: 200, body: okxBars(100, now, { start: p * 0.95, drift: 0.0005, step: H }) } : { status: 200, body: okxBars(100, now, { start: p * 0.8, drift: 0.002, step: 4 * H }) };
  };
  g.tele.sent.length = 0; g.cache.evictAll(); w.at = min => { g.spy.now = CLOSE + min * 60000; g.cache.evictAll(); return j(g.ctx.rich300WatchTick()); }; w.sent = () => g.tele.sent.filter(m => /\[RICH300/.test(m.text)).map(m => m.text);
  return w;
}
const b = (k, o, h, l, c) => ({ t: CLOSE + 15 * 60000 + k * M, o, h, l, c });
const trig = g => g.spy.triggers.filter(t => !t.deleted && t.fn === 'rich300WatchTick').length;
const snap = g => Object.fromEntries(g.P.getKeys().sort().map(k => [k, g.P.getProperty(k)]));

test('기본 OFF: 속성이 없으면 피드·시세 호출 0 · 텔레그램 0 · 시트 쓰기 0 · 트리거 0', () => {
  const w = world(); const before = snap(w.g); w.at(5); assert.equal(w.g.spy.feedHits.length, 0); assert.equal(w.hits.length, 0); assert.equal(w.sent().length, 0); assert.equal(w.g.rows('strategy').length, 0); assert.equal(trig(w.g), 0); assert.deepEqual(snap(w.g), before);
});
test('preview: 피드를 읽기 전용으로 가져와 계산만 — 저장·전송·상태 기록 없음', () => {
  const w = world(); w.g.P.setProperty('RICH300_STRATEGY', 'preview'); const r = j(w.g.ctx.rich300StrategyPreview()); assert.equal(r.status, 'ok'); assert.equal(r.created, 1); assert.ok(w.g.spy.feedHits.length >= 1 && w.g.spy.feedHits.every(u => /^https:\/\/raw\.githubusercontent\.com\/j01044459979-prog\/coin-radar\/rich300-feed\/feed\.json/.test(u)));
  assert.equal(w.g.rows('strategy').length, 0); assert.equal(w.sent().length, 0); assert.equal(w.g.P.getKeys().filter(k => k.startsWith('w:sg:')).length, 0); assert.equal(w.g.P.getProperty('strategy:last'), null);
});
test('ON + 운영 승인 + 연결: 새 추천 → 전략 생성 · 신규 전략 메시지 정확히 1건 · 다시 실행해도 중복 없음 · 전략 화면에 표시', () => {
  const w = world(); w.g.P.setProperty('RICH300_STRATEGY', 'on'); const r = w.at(5); assert.equal(w.g.rows('strategy').length, 1); assert.equal(w.sent().length, 1); assert.match(w.sent()[0], /^\[RICH300 매매 전략\]/);
  w.at(10); w.at(15); assert.equal(w.sent().length, 1); assert.equal(w.g.rows('strategy').length, 1); assert.equal(w.g.rows('strategy')[0].state, 'WAIT_ENTRY');
  const last = JSON.parse(w.g.P.getProperty('strategy:last')); assert.deepEqual([last.requested, last.feed.ok, last.feed.signed], ['on', true, true]);
  const t = strip(w.g.ctx.doGet({ parameter: { p: 'strat' } }).html); assert.match(t, /진입 대기 전략 \(1\)/); assert.match(t, /ETH/); assert.match(t, /전략 기준 가상 추적/); assert.match(t, /켜짐\(추천 → 자동 추적·알림\)/);
});
test('종단: 수동 등록 없이 추천 → 진입 → TP1 → 손절 종료까지 자동 · 위치 감시는 꺼져 있어도 동작 · 알림 각 1회 · 최종 가상 성적', () => {
  const w = world(); const fills0 = w.g.rows('fill').length; w.g.P.setProperty('RICH300_STRATEGY', 'on'); w.g.ctx.rich300WatchInstallTrigger(); assert.equal(trig(w.g), 1); assert.equal(w.g.P.getProperty('RICH300_WATCH_ALERTS'), null);
  w.at(5); w.bars15 = [b(0, 2010, 2012, 1999, 2005)]; w.at(31); w.bars15.push(b(1, 2005, 2048, 2003, 2046)); w.price = 2046; w.at(46); w.bars15.push(b(2, 2046, 2047, 1990, 1996)); w.price = 1996; w.at(61);
  const heads = w.sent().map(t => t.split('\n')[0]); assert.ok(heads.some(h => /진입 조건 충족/.test(h))); assert.ok(heads.some(h => /TP1 도달/.test(h))); assert.ok(heads.some(h => /손절 조건 충족/.test(h))); assert.equal(w.g.rows('strategy')[0].state, 'STOP');
  assert.equal(new Set(w.sent()).size, w.sent().length); const n = w.sent().length; w.at(66); w.at(71); assert.equal(w.sent().length, n); assert.match(w.sent().at(-1), /최종 가상 성적: \+/);
  assert.equal(w.g.rows('fill').length, fills0);                      // 가상 체결은 실제 체결 시트에 쓰지 않는다
});
test('실제 포지션과 분리: 전략 추적은 Fills·ManualPositions 를 만들지 않고 위치 감시 상태(w:pos:)를 쓰지 않는다', () => {
  const w = world(); const fills0 = w.g.rows('fill').length; w.g.P.setProperty('RICH300_STRATEGY', 'on'); w.at(5); w.bars15 = [b(0, 2010, 2012, 1999, 2005)]; w.at(31);
  assert.equal(w.g.rows('fill').length, fills0); assert.equal(w.g.rows('manualpos').length, 0); assert.ok(!w.g.P.getKeys().some(k => k.startsWith('w:pos:SG-ETH'))); assert.ok(w.g.P.getKeys().some(k => k.startsWith('w:sg:')));
});
test('운영 승인 전·미연결이면 ON 이어도 전송하지 않고 미리보기로만 동작(텔레그램 0)', () => {
  const w = world({ approved: false }); w.g.P.setProperty('RICH300_STRATEGY', 'on'); w.at(5); assert.equal(w.g.tele.sent.length, 0); assert.equal(w.g.rows('strategy').length, 0); assert.equal(JSON.parse(w.g.P.getProperty('strategy:last')).mode, 'preview');
});
test('피드 장애·위조: 404/서명 불일치/형식 오류는 새 전략 0 · 오류 코드만 기록 · 예외 없음', () => {
  const w = world(); w.g.P.setProperty('RICH300_STRATEGY', 'on'); w.g.spy.feedHandler = () => ({ status: 404, body: 'x' }); w.at(5); assert.equal(JSON.parse(w.g.P.getProperty('strategy:last')).feed.code, 'http-404');
  w.g.spy.feedHandler = () => ({ status: 200, body: signFeed(w.entries, w.g.spy.now - 60000).replace('"2000"', '"1999"') }); w.at(6); assert.equal(JSON.parse(w.g.P.getProperty('strategy:last')).feed.code, 'bad-signature');
  w.g.spy.feedHandler = () => ({ status: 200, body: '<html>' }); w.at(7); assert.equal(JSON.parse(w.g.P.getProperty('strategy:last')).feed.code, 'bad-json'); assert.equal(w.g.rows('strategy').length, 0); assert.equal(w.sent().length, 0);
});
test('위치 감시와 같은 트리거 공유: 전략 추적 실패가 위치 감시를 막지 않고, 위치 감시가 꺼져 있어도 전략은 돈다', () => {
  const w = world(); w.g.P.setProperty('RICH300_STRATEGY', 'on'); const real = w.g.ctx.rich300StrategyRun_; w.g.ctx.rich300StrategyRun_ = () => { throw new Error('boom'); };
  assert.deepEqual(j(w.g.ctx.rich300WatchTick()), { status: 'off' }); w.g.ctx.rich300StrategyRun_ = real; w.at(5); assert.equal(w.g.rows('strategy').length, 1);
});
test('?p=strat: 소유자만 · 기본 화면(주소만 열면) · 열기만 해서는 아무것도 바꾸지 않는다(피드·시세·텔레그램·속성 0)', () => {
  const w = world(); const before = snap(w.g); const h = w.g.ctx.doGet({ parameter: {} }).html, t = strip(h); assert.match(t, /추천 전략/); assert.match(t, /신규 추천 전략 \(0\)/); assert.match(t, /진입 대기 전략 \(0\)/); assert.match(t, /자동 추적 중인 전략 \(0\)/); assert.match(t, /종료 전략 및 성과 \(0\)/); assert.match(t, /실제 보유 포지션 \(선택 기능\)/);
  assert.match(t, /꺼짐\(자동 추적 안 함\)/); assert.deepEqual(snap(w.g), before); assert.equal(w.hits.length, 0); assert.equal(w.g.spy.feedHits.length, 0); assert.equal(w.g.tele.sent.length, 0); assert.match(loadProd({ email: 'other@example.com' }).ctx.doGet({ parameter: { p: 'strat' } }).html, /접근 제한/);
});

// ── 관리 화면: 서명 키·사전 점검·시작·중지 ──
const TOK = 'RICH300_TG_TOKEN';
test('관리: 서명 키 등록(소유자·한 번만·형식 검사·값 비노출) · 비소유자 거부', () => {
  const w = world({ key: false }); assert.equal(j(w.g.ctx.rich300OpsSetFeedKey('short')).code, 'bad-format'); const r = j(w.g.ctx.rich300OpsSetFeedKey(` ${KEY}\n`)); assert.deepEqual([r.ok, r.code], [true, 'saved']); assert.equal(w.g.P.getProperty('RICH300_FEED_KEY'), KEY);
  assert.equal(j(w.g.ctx.rich300OpsSetFeedKey(KEY)).code, 'already-set'); const html = w.g.ctx.doGet({ parameter: { p: 'ops' } }).html; assert.ok(!html.includes(KEY)); assert.ok(!JSON.stringify(r).includes(KEY)); assert.ok(!w.g.P.getProperty('ops:last').includes(KEY));
  const o = loadProd({ email: 'other@example.com' }); for (const [fn, a] of [['rich300OpsSetFeedKey', [KEY]], ['rich300OpsStratPrecheck', []], ['rich300OpsStratEnable', [PHRASE]], ['rich300OpsStratDisable', []]]) assert.deepEqual(j(o.ctx[fn](...a)), { ok: false, code: 'forbidden' }, fn);
});
test('관리: 전략 추적 시작은 사전 점검 통과 + 확인 문구 필요 · 점검만으로는 켜지지 않음 · 시작하면 운영 승인+STRATEGY on+트리거 1개, 재조회 확인', () => {
  const w = world(); w.g.P.deleteProperty('RICH300_PROD_APPROVED'); const before = snap(w.g);
  assert.equal(j(w.g.ctx.rich300OpsStratEnable('')).code, 'phrase'); assert.equal(j(w.g.ctx.rich300OpsStratEnable(PHRASE)).code, 'precheck-required');
  const pre = j(w.g.ctx.rich300OpsStratPrecheck()); assert.equal(pre.pass, true, JSON.stringify(pre)); assert.ok(pre.items.some(i => i.id === 'signed' && i.ok)); assert.equal(w.g.tele.sent.length, 0); assert.equal(trig(w.g), 0); assert.ok(!w.g.P.getProperty('RICH300_STRATEGY')); assert.ok(!w.g.P.getProperty('RICH300_PROD_APPROVED'));
  const r = j(w.g.ctx.rich300OpsStratEnable(PHRASE)); assert.deepEqual([r.ok, r.code, r.triggers], [true, 'enabled', 1], JSON.stringify(r)); assert.equal(w.g.P.getProperty('RICH300_PROD_APPROVED'), 'yes'); assert.equal(w.g.P.getProperty('RICH300_STRATEGY'), 'on'); assert.equal(trig(w.g), 1); assert.ok(!w.g.P.getProperty('RICH300_WATCH_ALERTS'));
  assert.equal(j(w.g.ctx.rich300OpsStratEnable(PHRASE)).code, 'already-on'); assert.equal(trig(w.g), 1); const after = snap(w.g); for (const k of Object.keys(before)) if (!/^(ops:|cache|perf|w:|strategy|RICH300_PROD_APPROVED|RICH300_STRATEGY)/.test(k)) assert.equal(after[k], before[k], k);
  assert.equal(w.g.tele.sent.length, 0);
});
test('관리: 피드가 없으면(404) 사전 점검 실패 → 시작 불가', () => {
  const w = world(); w.g.spy.feedHandler = () => ({ status: 404, body: '' }); const pre = j(w.g.ctx.rich300OpsStratPrecheck()); assert.equal(pre.pass, false); assert.ok(pre.items.some(i => i.id === 'feed' && !i.ok && /RADAR_RICH300_FEED=on/.test(i.text))); assert.equal(j(w.g.ctx.rich300OpsStratEnable(PHRASE)).code, 'precheck-required'); assert.equal(trig(w.g), 0);
});
test('관리: 시작 실패 시 복구(부분 활성화 없음) · 중지는 STRATEGY off · 위치 감시가 켜져 있으면 트리거 유지', () => {
  const w = world(); w.g.P.deleteProperty('RICH300_PROD_APPROVED'); w.g.ctx.rich300OpsStratPrecheck(); const real = w.g.ctx.rich300WatchInstallTrigger; w.g.ctx.rich300WatchInstallTrigger = () => { throw new Error('quota'); };
  const f = j(w.g.ctx.rich300OpsStratEnable(PHRASE)); assert.deepEqual([f.ok, f.code, f.rolledBack], [false, 'exception', true]); assert.equal(w.g.P.getProperty('RICH300_PROD_APPROVED'), null); assert.notEqual(w.g.P.getProperty('RICH300_STRATEGY'), 'on'); assert.equal(trig(w.g), 0);
  w.g.ctx.rich300WatchInstallTrigger = real; w.g.ctx.rich300OpsStratPrecheck(); assert.equal(j(w.g.ctx.rich300OpsStratEnable(PHRASE)).ok, true);
  w.g.P.setProperty('RICH300_WATCH_ALERTS', 'on'); const off = j(w.g.ctx.rich300OpsStratDisable()); assert.deepEqual([off.ok, off.code], [true, 'disabled']); assert.equal(w.g.P.getProperty('RICH300_STRATEGY'), 'off'); assert.equal(trig(w.g), 1);        // 위치 감시가 켜져 있어 트리거 유지
  w.g.P.setProperty('RICH300_WATCH_ALERTS', 'off'); w.g.ctx.rich300OpsStratEnable(PHRASE); w.g.ctx.rich300OpsStratPrecheck(); w.g.ctx.rich300OpsStratEnable(PHRASE); w.g.P.setProperty('RICH300_STRATEGY', 'on'); const off2 = j(w.g.ctx.rich300OpsStratDisable()); assert.deepEqual([off2.ok, off2.triggers], [true, 0]); assert.equal(w.g.tele.sent.length, 0);
});
test('위치 감시 중지는 전략 추적이 켜져 있으면 트리거를 지우지 않는다(공유 트리거)', () => {
  const w = world(); w.g.P.deleteProperty('RICH300_PROD_APPROVED'); w.g.ctx.rich300OpsPrecheck(); assert.equal(j(w.g.ctx.rich300OpsEnable('실전 감시 시작')).ok, true); w.g.P.setProperty('RICH300_STRATEGY', 'on');
  const off = j(w.g.ctx.rich300OpsDisable()); assert.equal(off.ok, true); assert.equal(off.triggers, 1); assert.equal(w.g.P.getProperty('RICH300_WATCH_ALERTS'), 'off'); w.g.P.setProperty('RICH300_STRATEGY', 'off'); assert.equal(j(w.g.ctx.rich300OpsDisable()).triggers, 0);
});
test('허용 목록: 전략 설정은 STRATEGY(on/off)와 FEED_KEY(전용 함수)뿐 · 다른 속성/값 거부', () => {
  const w = world(), c = w.g.ctx; for (const [n, v] of [['RICH300_STRATEGY', 'preview'], ['RICH300_STRATEGY', 'yes'], ['RICH300_FEED_KEY', 'short'], [TOK, 'x']]) assert.throws(() => c.rich300OpsSet_(n, v), /ops-/, n + '=' + v); assert.doesNotThrow(() => c.rich300OpsSet_('RICH300_STRATEGY', 'off'));
});
test('서명 키가 없거나 약하거나 틀리면 피드 거부: 전략 0 · 텔레그램 0 · 사전 점검 실패 · 시작 불가', () => {
  for (const setup of [w0 => {}, w0 => w0.g.P.setProperty('RICH300_FEED_KEY', 'short'), w0 => w0.g.P.setProperty('RICH300_FEED_KEY', 'g'.repeat(40))]) {
    const w = world({ key: false }); setup(w); w.g.P.setProperty('RICH300_STRATEGY', 'on'); w.at(5); w.at(10);
    const last = JSON.parse(w.g.P.getProperty('strategy:last')); assert.equal(last.feed.ok, false); assert.match(last.feed.code, /^(no-key|bad-signature)$/); assert.equal(w.g.rows('strategy').length, 0); assert.equal(w.sent().length, 0);
    const pre = j(w.g.ctx.rich300OpsStratPrecheck()); assert.equal(pre.pass, false); assert.ok(pre.items.some(i => i.id === 'signed' && !i.ok && i.must)); assert.equal(j(w.g.ctx.rich300OpsStratEnable(PHRASE)).code, 'precheck-required');
  }
});
test('서명 오류·되돌림·오래된 피드가 기존 보유 포지션 감시를 방해하지 않는다(위치 감시 알림은 정상)', () => {
  const w = world({ key: false }); w.g.P.setProperty('RICH300_STRATEGY', 'on'); w.g.P.setProperty('RICH300_WATCH_ALERTS', 'on');
  w.price = 1968; w.g.ctx.rich300ManualRegister({ formId: 'p1', symbol: 'ETH', dir: 'LONG', entry: '2000', qty: '0.1', leverage: '3', stop: '1970', tp1: '', tp2: '', at: '' }); w.g.tele.sent.length = 0; w.g.cache.evictAll();
  const out = w.at(5); assert.equal(out.status, 'ok'); assert.equal(JSON.parse(w.g.P.getProperty('strategy:last')).feed.code, 'no-key'); assert.ok(w.sent().some(t => /ETH LONG · 🛑 손절가 이탈/.test(t))); assert.equal(w.sent().filter(t => /^\[RICH300 매매 전략\]|실행 불가/.test(t)).length, 0);
});
test('피드 되돌림(replay)·오래됨은 GAS 경로에서도 거부', () => {
  const w = world(); w.g.P.setProperty('RICH300_STRATEGY', 'on'); w.at(5); assert.equal(w.g.rows('strategy').length, 1); const ts0 = Number(w.g.P.getProperty('w:sgfeedts')); assert.ok(ts0 > 0);
  w.entries = [entry({ sid: 'SG-ETH-L-new999' })]; w.g.spy.feedHandler = () => ({ status: 200, body: signFeed(w.entries, ts0 - 60000) }); w.at(10); assert.equal(JSON.parse(w.g.P.getProperty('strategy:last')).feed.code, 'replay'); assert.equal(w.g.rows('strategy').length, 1);
  w.g.spy.feedHandler = () => ({ status: 200, body: signFeed(w.entries, w.g.spy.now - 40 * 60000 + 600000, { at: String(w.g.spy.now - 50 * 60000) }) }); w.g.P.deleteProperty('w:sgfeedts'); w.at(15); assert.equal(JSON.parse(w.g.P.getProperty('strategy:last')).feed.code, 'stale');
});
test('v10 운영 상태 보존: 위치 감시 ON·수동 포지션·트리거 1개 상태에서 전략 추적 설정이 없으면 v11 코드도 v10 과 같게 동작(피드·전략 시트 호출 0, 기존 속성 불변, 위치 감시 알림 정상)', () => {
  const w = world({ key: false }); w.g.P.setProperty('RICH300_PROD_APPROVED', 'yes'); w.g.P.setProperty('RICH300_WATCH_ALERTS', 'on'); w.g.ctx.rich300WatchInstallTrigger();
  w.price = 1968; w.g.ctx.rich300ManualRegister({ formId: 'v10', symbol: 'ETH', dir: 'LONG', entry: '2000', qty: '0.1', leverage: '3', stop: '1970', tp1: '', tp2: '', at: '' }); w.g.tele.sent.length = 0; w.hits.length = 0; w.g.cache.evictAll();
  const before = snap(w.g), trig0 = trig(w.g); const out = w.at(5); assert.equal(out.status, 'ok'); assert.ok(w.sent().some(t => /ETH LONG · 🛑 손절가 이탈/.test(t))); assert.equal(w.g.spy.feedHits.length, 0); assert.equal(w.g.rows('strategy').length, 0); assert.equal(trig(w.g), trig0);
  const after = snap(w.g); for (const k of Object.keys(before)) if (!/^(w:|watch:last|cache|perf)/.test(k)) assert.equal(after[k], before[k], k); assert.ok(!Object.keys(after).some(k => /^(RICH300_STRATEGY|strategy:|w:sg)/.test(k)));
  assert.ok(strip(w.g.ctx.doGet({ parameter: { p: 'pos' } }).html).includes('ETH')); assert.match(strip(w.g.ctx.doGet({ parameter: { p: 'ops' } }).html), /실제 동작: 전송 중\(실전 감시 켜짐\)/);
});
