// Watch.gs(가짜 Apps Script·가짜 Telegram·가짜 거래소 시세): 기본 OFF, 미리보기, 전송 가드, 한 번만 전송, 상태 분리, 락, 트리거 관리.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProd } from './helpers/gasprod.mjs';
import { seed } from '../perf/bench.mjs';
import { OWNER } from './helpers/faketg.mjs';
import { splanBuild } from '../lib/scaleplan.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const NOW = 1790000000000, H = 3600000, plan = splanBuild({ symbol: 'ETHUSDT', dir: 'LONG', entry: 2000, stop: 1970, equity: 300 }), q1 = plan.stages[0].qty;
const okxBars = (n, { start, drift, step }) => ({ code: '0', data: Array.from({ length: n }, (_, i) => { const idx = n - 1 - i, c = start * (1 + drift * idx), t = NOW - (i + 1) * step; return [String(t), String(c), String(c * 1.002), String(c * 0.998), String(c), '100', '0', '0', '1']; }) });
function market(price, hits) {
  return url => {
    hits.push(url);
    if (/ticker/.test(url)) return { status: 200, body: { code: '0', data: [{ last: String(price), ts: String(NOW - 30000) }] } };
    if (/bar=15m/.test(url)) return { status: 200, body: { code: '0', data: [[String(NOW - 900000), String(price), String(price), String(price), String(price), '1', '0', '0', '1']] } };
    if (/bar=1H/.test(url)) return { status: 200, body: okxBars(100, { start: 1900, drift: 0.001, step: H }) };
    return { status: 200, body: okxBars(100, { start: 1590, drift: 0.003, step: 4 * H }) };
  };
}
function world({ approved = true, paired = true, price = 2050 } = {}) {
  const g = loadProd({ props: approved ? { RICH300_PROD_APPROVED: 'yes' } : {} }); seed(g, 3); g.ctx.rich300Install();
  if (paired && approved) { const r = g.ctx.rich300Install(); g.tele.say(OWNER, `/start ${r.pairLink.split('=')[1]}`); g.ctx.rich300TgPoll(); }
  const se = g.ctx.rich300GasEnv_('sheet'), E = g.ctx.RICH300_ENGINE, A = { actor: 't' };
  E.storeCreate(se, 'signal', { sid: 'W1', strategy: 'A', symbolId: 'ETHUSDT', dir: 'LONG', signalAt: NOW - 3 * H, entry: '2000', stop: '1970', tp1: '2045' }, A);
  E.storeCreate(se, 'fill', { origin: 'real', fillId: 'W1:in', sid: 'W1', kind: 'entry', dir: 'LONG', at: NOW - 2.5 * H, price: '2000', qty: String(q1), margin: '30', leverage: '3', plannedStop: '1970', fee: { state: 'entered', amount: '0.04' }, funding: { state: 'entered', amount: '0' } }, A);
  E.storeCreate(se, 'plan', { sid: 'W1', equity: '300', entry: '2000', stop: '1970', lev: plan.lev, stages: plan.stagesCount, at: NOW - 2.5 * H }, A);
  const hits = []; g.spy.marketHandler = market(price, hits); g.tele.sent.length = 0; g.cache.evictAll();
  return { g, hits, sentWatch: () => g.tele.sent.filter(m => /\[RICH300\]/.test(m.text)) };
}
const tgKeys = g => g.P.getKeys().filter(k => k.startsWith('tg:')).sort().map(k => `${k}=${g.P.getProperty(k)}`);

test('기본 OFF: 속성이 없으면 시세 호출 0 · 텔레그램 0 · 트리거도 설치하지 않는다', () => {
  const w = world(); assert.deepEqual(JSON.parse(JSON.stringify(w.g.ctx.rich300WatchTick())), { status: 'off' }); assert.equal(w.hits.length, 0); assert.equal(w.sentWatch().length, 0);
  assert.equal(w.g.spy.triggers.filter(t => t.fn === 'rich300WatchTick').length, 0);
});
test('미리보기(rich300WatchPreview): 설정과 무관하게 계산만 — 전송 0 · 감시 상태 저장 0 · 시세는 읽기 전용 GET', () => {
  const w = world(); const r = w.g.ctx.rich300WatchPreview(); assert.equal(r.status, 'ok'); assert.ok(r.events >= 1); assert.equal(w.sentWatch().length, 0);
  assert.equal(w.g.P.getKeys().filter(k => k.startsWith('w:')).length, 0); assert.ok(w.hits.length >= 4); assert.ok(w.hits.every(u => /^https:\/\/(www\.okx\.com|api\.bybit\.com)\//.test(u)));
  assert.equal(w.g.P.getProperty('watch:last'), null);                                                          // 미리보기는 어떤 속성도 쓰지 않는다
});
test('ON + 운영 승인 + 연결: TP1 알림이 정확히 1건, 다시 실행해도 추가 없음 · tg: 상태는 건드리지 않는다', () => {
  const w = world(); w.g.P.setProperty('RICH300_WATCH_ALERTS', 'on'); const before = tgKeys(w.g);
  const r1 = w.g.ctx.rich300WatchTick(); assert.equal(r1.sent, 1, JSON.stringify(r1)); const m = w.sentWatch(); assert.equal(m.length, 1); assert.match(m[0].text, /ETH LONG · 🎯 TP1 도달/); assert.match(m[0].text, /자동 주문 아님/);
  assert.equal(w.g.ctx.rich300WatchTick().sent, 0); assert.equal(w.sentWatch().length, 1);
  assert.deepEqual(tgKeys(w.g), before);                                                                            // 텔레그램 입력 상태 불변
  assert.ok(w.g.P.getKeys().some(k => k === 'w:pos:W1')); assert.equal(JSON.parse(w.g.P.getProperty('watch:last')).sent, 0);
});
test('전송 가드: 운영 승인 전이거나 연결 전이면 ON 이어도 전송하지 않고 미리보기로만 동작(텔레그램 호출 0)', () => {
  const a = world({ approved: false }); a.g.P.setProperty('RICH300_WATCH_ALERTS', 'on'); const r = a.g.ctx.rich300WatchTick(); assert.equal(r.mode, 'preview'); assert.equal(a.g.tele.sent.length, 0); assert.equal(a.g.spy.fetches, 0);
  const b = world({ paired: false }); b.g.P.setProperty('RICH300_WATCH_ALERTS', 'on'); assert.equal(b.g.ctx.rich300WatchTick().mode, 'preview'); assert.equal(b.sentWatch().length, 0);
});
test('시세 API 장애·잘못된 응답: 예외 없이 끝나고 알림 없음 · OKX 실패 시 Bybit 로 대체 시도', () => {
  const w = world(); w.g.P.setProperty('RICH300_WATCH_ALERTS', 'on'); w.g.spy.marketHandler = url => { w.hits.push(url); return { status: 503, body: 'down' }; };
  const r = w.g.ctx.rich300WatchTick(); assert.equal(r.status, 'ok'); assert.equal(r.sent, 0); assert.equal(r.marketFail, 1); assert.ok(w.hits.some(u => /okx\.com/.test(u)) && w.hits.some(u => /bybit\.com/.test(u)));
  w.g.spy.marketHandler = () => ({ status: 200, body: '<html>' }); assert.equal(w.g.ctx.rich300WatchTick().sent, 0);
});
test('트리거가 겹치면(사용자 락 사용 중) 실행하지 않고 busy', () => {
  const w = world(); w.g.P.setProperty('RICH300_WATCH_ALERTS', 'on'); w.g.ctx.LockService.getUserLock = () => ({ tryLock: () => false, releaseLock() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(w.g.ctx.rich300WatchTick())), { status: 'busy' }); assert.equal(w.hits.length, 0);
});
test('트리거 설치·제거는 감시 트리거만 바꾼다(기존 트리거 불변) · 5분 간격', () => {
  const w = world(); const before = w.g.spy.triggers.filter(t => !t.deleted).map(t => t.fn).sort();
  w.g.ctx.rich300WatchInstallTrigger(); const mid = w.g.spy.triggers.filter(t => !t.deleted); assert.equal(mid.filter(t => t.fn === 'rich300WatchTick').length, 1);
  w.g.ctx.rich300WatchInstallTrigger(); assert.equal(w.g.spy.triggers.filter(t => !t.deleted && t.fn === 'rich300WatchTick').length, 1);       // 중복 없음
  w.g.ctx.rich300WatchRemoveTrigger(); assert.deepEqual(w.g.spy.triggers.filter(t => !t.deleted).map(t => t.fn).sort(), before);
});
test('홈 화면은 감시와 무관: 감시를 켜도 ?p=dash 의 Sheets·시세 호출이 늘지 않는다', () => {
  const w = world(); const h0 = w.hits.length; w.g.ctx.doGet({ parameter: { p: 'dash' } }); w.g.P.setProperty('RICH300_WATCH_ALERTS', 'on'); w.g.ctx.doGet({ parameter: { p: 'dash' } }); assert.equal(w.hits.length, h0);
});

// ── ?p=watch 진단 화면과 상태 진단 ──
const strip = h => h.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ');
const snapshot = g => JSON.stringify(g.P.getKeys().sort().map(k => [k, g.P.getProperty(k)]));
test('?p=watch 는 소유자만 · 기본 방문은 읽기 전용(시세 0·텔레그램 0·속성 쓰기 0·트리거 0)', () => {
  const w = world(); const before = snapshot(w.g), trig = w.g.spy.triggers.length;
  const t = strip(w.g.ctx.doGet({ parameter: { p: 'watch' } }).html); assert.match(t, /RICH300_WATCH_ALERTS: 속성 없음\(미설정\)/); assert.match(t, /실제 동작\(지금 트리거가 돌면\): 아무것도 하지 않음\(꺼짐\)/); assert.match(t, /감시 트리거: 없음\(설치 안 됨\)/);
  assert.equal(w.hits.length, 0); assert.equal(w.g.tele.sent.length, 0); assert.equal(snapshot(w.g), before); assert.equal(w.g.spy.triggers.length, trig);
  const other = loadProd({ email: 'other@example.com' }); assert.match(other.ctx.doGet({ parameter: { p: 'watch', run: '1' } }).html, /접근 제한/);
});
test('상태 진단: 속성 없음/off/preview/on/인식 불가 값을 구분해 보여 주고, 인식 불가 값은 길이만(값 비노출)·꺼짐과 동일 동작', () => {
  const cases = [[undefined, /속성 없음\(미설정\)/, /아무것도 하지 않음/], ['off', /RICH300_WATCH_ALERTS: off/, /아무것도 하지 않음/], ['preview', /RICH300_WATCH_ALERTS: preview/, /계산만 하고 전송하지 않음/], [' ON ', /RICH300_WATCH_ALERTS: on/, /전송 가능/], ['yes-secret', /인식할 수 없는 값\(길이 10\)/, /아무것도 하지 않음/]];
  for (const [val, re1, re2] of cases) {
    const w = world(); if (val !== undefined) w.g.P.setProperty('RICH300_WATCH_ALERTS', val); const t = strip(w.g.ctx.doGet({ parameter: { p: 'watch' } }).html);
    assert.match(t, re1, String(val)); assert.match(t, re2, String(val)); assert.ok(!/yes-secret/.test(t));
  }
  const g = world({ approved: false }); g.g.P.setProperty('RICH300_WATCH_ALERTS', 'on'); assert.match(strip(g.g.ctx.doGet({ parameter: { p: 'watch' } }).html), /계산만 하고 전송하지 않음/);          // ON 이어도 가드 때문에 전송 불가
});
test('?p=watch&run=1 미리보기: 포지션·이벤트·시세 결과를 보여 주고, ON+승인+연결 상태여도 텔레그램 0 · w: 상태 0 · 트리거 불변', () => {
  const w = world(); w.g.P.setProperty('RICH300_WATCH_ALERTS', 'on'); const trig = w.g.spy.triggers.length, before = snapshot(w.g);
  const t = strip(w.g.ctx.doGet({ parameter: { p: 'watch', run: '1' } }).html);
  assert.match(t, /감시 대상 포지션: 1건/); assert.match(t, /계산된 이벤트: \d+건 \(.*TP1 1/); assert.match(t, /ETHUSDT: 성공\(OKX, 시세 \d+초 전, 봉 15m 1\/1h 100\/4h 100\)/); assert.match(t, /시세 조회: 모두 성공/);
  assert.equal(w.g.tele.sent.length, 0); assert.equal(w.g.P.getKeys().filter(k => k.startsWith('w:')).length, 0); assert.equal(w.g.spy.triggers.length, trig); assert.ok(w.hits.length >= 4); assert.equal(snapshot(w.g), before);          // 속성 전체가 그대로(watch:last 포함)
});
test('시세 조회 실패는 성공으로 보고하지 않는다: 실패 종목과 시도 코드(HTTP 상태)를 표시', () => {
  const w = world(); w.g.spy.marketHandler = url => { w.hits.push(url); return { status: 503, body: 'down' }; };
  const t = strip(w.g.ctx.doGet({ parameter: { p: 'watch', run: '1' } }).html); assert.match(t, /시세 조회 실패 있음/); assert.match(t, /ETHUSDT: \*?\*?실패/); assert.match(t, /OKX\[http 503\/503\/503\/503 ticker bad\]/); assert.match(t, /Bybit\[http 503/);
  assert.ok(!/시세 조회: 모두 성공/.test(t)); assert.ok(!/>정상</.test(w.g.ctx.doGet({ parameter: { p: 'watch', run: '1' } }).html));
  w.g.spy.marketHandler = () => ({ status: 200, body: { code: '51001', msg: 'x' } }); assert.match(strip(w.g.ctx.doGet({ parameter: { p: 'watch', run: '1' } }).html), /ticker bad/);          // 응답 구조가 다르면 실패로 처리
});
test('보유 포지션이 없으면 미리보기는 시세를 호출하지 않는다', () => {
  const g = loadProd(); seed(g, 3); g.ctx.rich300Install(); g.spy.marketHandler = () => ({ status: 200, body: {} }); const t = strip(g.ctx.doGet({ parameter: { p: 'watch', run: '1' } }).html);
  assert.match(t, /보유 포지션 없음\(시세 호출 없음\)/); assert.equal(g.spy.market || 0, 0);
});
test('?p=health 의 감시 줄도 같은 진단을 보여 준다(속성·실제 동작·트리거·가드)', () => {
  const w = world(); const t = strip(w.g.ctx.doGet({ parameter: { p: 'health' } }).html); assert.match(t, /보유 포지션 감시 — 속성 속성 없음 · 실제 동작: 아무것도 하지 않음\(꺼짐\) · 트리거 없음 · 전송 가드 통과\/연결 됨/);
});

// ── 시세 연결 점검(?p=watch&net=1) ──
test('시세 연결 점검: 종목·출처·응답 시간·시세 나이·봉 나이·HTTP 상태를 보여 주고 속성/텔레그램/트리거를 건드리지 않는다', () => {
  const w = world(); const before = snapshot(w.g), trig = w.g.spy.triggers.length; const t = strip(w.g.ctx.doGet({ parameter: { p: 'watch', net: '1' } }).html);
  assert.match(t, /시세 연결 점검/); assert.match(t, /모두 정상/); assert.match(t, /BTCUSDT OKX \d+ms/); assert.match(t, /ETHUSDT OKX \d+ms/); assert.match(t, /OKX: \d+ms · HTTP 200\/200\/200\/200 · 티커 ok · 봉 15m 1\/1h 100\/4h 100/);
  assert.equal(snapshot(w.g), before); assert.equal(w.g.tele.sent.length, 0); assert.equal(w.g.spy.triggers.length, trig);
  assert.ok(w.hits.every(u => /^https:\/\/(www\.okx\.com|api\.bybit\.com)\//.test(u)));
});
test('연결 점검은 캐시를 쓰지 않는다(두 번 호출하면 두 번 조회) · 오래된 시세/봉은 실패로 표시하고 사유 코드를 보여 준다', () => {
  const w = world(); w.g.ctx.doGet({ parameter: { p: 'watch', net: '1' } }); const n1 = w.hits.length; w.g.ctx.doGet({ parameter: { p: 'watch', net: '1' } }); assert.equal(w.hits.length, n1 * 2);
  const old = world(); old.g.spy.marketHandler = url => (/ticker/.test(url) ? { status: 200, body: { code: '0', data: [{ last: '2050', ts: String(NOW - 20 * 60000) }] } } : market(2050, old.hits)(url));
  const t = strip(old.g.ctx.doGet({ parameter: { p: 'watch', net: '1' } }).html); assert.match(t, /실패 있음/); assert.match(t, /stale-price/); assert.ok(!/모두 정상/.test(t));
  const bars = world(); bars.g.spy.marketHandler = url => { const r = market(2050, bars.hits)(url); if (/bar=1H/.test(url)) r.body.data = r.body.data.slice(0, 30); return r; }; assert.match(strip(bars.g.ctx.doGet({ parameter: { p: 'watch', net: '1' } }).html), /few-bars-1h/);
  const gap = world(); gap.g.spy.marketHandler = url => { const r = market(2050, gap.hits)(url); if (/bar=4H/.test(url)) r.body.data.splice(10, 1); return r; }; assert.match(strip(gap.g.ctx.doGet({ parameter: { p: 'watch', net: '1' } }).html), /gap-bars-4h/);
});
test('연결 점검: OKX 실패 시 Bybit 대체, 둘 다 실패하면 실패로 보고(성공 표시 없음)', () => {
  const w = world(); w.g.spy.marketHandler = url => {
    w.hits.push(url); if (/okx\.com/.test(url)) return { status: 429, body: '' };
    const iv = /interval=(\d+)/.exec(url), step = iv ? Number(iv[1]) * 60000 : 0;
    if (/tickers/.test(url)) return { status: 200, body: { retCode: 0, time: NOW - 10000, result: { list: [{ lastPrice: '2050' }] } } };
    const n = /limit=(\d+)/.exec(url)[1], list = Array.from({ length: Number(n) }, (_, i) => { const t = Math.floor(NOW / step) * step - (i + 1) * step, c = 1900 * (1 + 0.001 * (99 - i)); return [String(t), String(c), String(c * 1.002), String(c * 0.998), String(c), '100', '0']; });
    return { status: 200, body: { retCode: 0, result: { list } } };
  };
  const t = strip(w.g.ctx.doGet({ parameter: { p: 'watch', net: '1' } }).html); assert.match(t, /Bybit: \d+ms · HTTP 200\/200\/200\/200 · 티커 ok/); assert.match(t, /OKX: \d+ms · HTTP 429/); assert.match(t, /BTCUSDT Bybit \d+ms/);
  const dead = world(); dead.g.spy.marketHandler = () => ({ status: 503, body: '' }); const d = strip(dead.g.ctx.doGet({ parameter: { p: 'watch', net: '1' } }).html); assert.match(d, /실패 있음/); assert.ok(!/모두 정상/.test(d));
});
