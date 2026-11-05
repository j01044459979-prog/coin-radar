// ?p=pos / 수동 포지션 등록 → 감시 → (모의) Telegram. 가짜 Apps Script·가짜 Telegram·가짜 거래소. 실제 네트워크·실제 전송 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProd } from './helpers/gasprod.mjs';
import { seed } from '../perf/bench.mjs';
import { OWNER } from './helpers/faketg.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const NOW = 1790000000000, H = 3600000;
const okxBars = (n, { start, drift, step }) => ({ code: '0', data: Array.from({ length: n }, (_, i) => { const idx = n - 1 - i, c = start * (1 + drift * idx), t = NOW - (i + 1) * step; return [String(t), String(c), String(c * 1.002), String(c * 0.998), String(c), '100', '0', '0', '1']; }) });
const strip = h => h.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ');
const j = v => JSON.parse(JSON.stringify(v));
function world({ price = { SOLUSDT: 150 }, known = ['SOLUSDT', 'ETHUSDT'] } = {}) {
  const g = loadProd({ props: { RICH300_PROD_APPROVED: 'yes' } }); seed(g, 3); const inst = g.ctx.rich300Install(); g.tele.say(OWNER, `/start ${inst.pairLink.split('=')[1]}`); g.ctx.rich300TgPoll();
  const hits = []; const w = { g, hits, price, known };
  g.spy.marketHandler = url => {
    hits.push(url); const sym = (/instId=([A-Z0-9]+)-USDT/.exec(url) || /symbol=([A-Z0-9]+)/.exec(url) || [])[1], id = /instId/.test(url) ? sym + 'USDT' : sym;
    if (!w.known.includes(id)) return /okx/.test(url) ? { status: 200, body: { code: '51001', msg: 'Instrument ID does not exist', data: [] } } : { status: 200, body: { retCode: 0, result: { list: [] }, time: NOW } };
    const p = w.price[id];
    if (/ticker/.test(url)) return { status: 200, body: { code: '0', data: [{ last: String(p), ts: String(NOW - 30000) }] } };
    if (/bar=15m/.test(url)) return { status: 200, body: { code: '0', data: [[String(NOW - 900000), String(p), String(p), String(p), String(p), '1', '0', '0', '1']] } };
    return /bar=1H/.test(url) ? { status: 200, body: okxBars(100, { start: p * 0.95, drift: 0.0005, step: H }) } : { status: 200, body: okxBars(100, { start: p * 0.8, drift: 0.002, step: 4 * H }) };
  };
  g.tele.sent.length = 0; g.cache.evictAll(); return w;
}
const FORM = { formId: 'abc123', symbol: 'sol', dir: 'LONG', entry: '140', qty: '2', leverage: '3', stop: '135', tp1: '148', tp2: '155', at: '' };
const snapshot = g => JSON.stringify(g.P.getKeys().sort().map(k => [k, g.P.getProperty(k)]));

test('?p=pos: 소유자만 · 메뉴에 "포지션" · 등록 폼과 빈 목록 · 시세 호출 0 · 텔레그램 0 · 트리거 0', () => {
  const w = world(); const trig = w.g.spy.triggers.length, h = w.g.ctx.doGet({ parameter: { p: 'pos' } }).html, t = strip(h);
  assert.match(t, /포지션 등록/); assert.match(t, /등록된 보유 포지션이 없습니다/); assert.match(h, /id="go"/); assert.match(h, /data-sym="BTC"/); assert.match(h, /aria-current="page">포지션</);
  assert.equal(w.hits.length, 0); assert.equal(w.g.tele.sent.length, 0); assert.equal(w.g.spy.triggers.length, trig);
  assert.match(loadProd({ email: 'other@example.com' }).ctx.doGet({ parameter: { p: 'pos' } }).html, /접근 제한/);
});
test('등록은 소유자만: 비소유자 호출은 forbidden · 아무것도 저장하지 않음', () => {
  const o = loadProd({ email: 'other@example.com' }); assert.deepEqual(j(o.ctx.rich300ManualRegister(FORM)), { ok: false, error: 'forbidden' }); assert.deepEqual(j(o.ctx.rich300ManualUpdate('x', { stop: '1' })), { ok: false, error: 'forbidden' });
});
test('등록 → 목록·일지 반영 · 종목 확인은 읽기 전용 시세 2건 · 결과에 경고 · 다시 제출해도 1건', () => {
  const w = world(); const r = j(w.g.ctx.rich300ManualRegister(FORM)); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.status, 'added'); assert.equal(r.symbolId, 'SOLUSDT'); assert.equal(r.margin, '93.3333');
  assert.equal(w.hits.length, 2); assert.ok(w.hits.every(u => /ticker/.test(u) && /^https:\/\/(www\.okx\.com|api\.bybit\.com)\//.test(u)));
  assert.equal(j(w.g.ctx.rich300ManualRegister(FORM)).status, 'duplicate'); assert.equal(w.hits.length, 2);                                   // 두 번째는 종목 확인 캐시
  const t = strip(w.g.ctx.doGet({ parameter: { p: 'pos' } }).html); assert.match(t, /SOL/); assert.match(t, /손절 135/); assert.match(t, /1차 익절 148/); assert.match(t, /2차 익절 155/); assert.match(t, /평균 140/);
  assert.match(w.g.ctx.doGet({ parameter: { p: 'pos' } }).html, /mode=exit&amp;sid=M-SOL-L-abc123/);
  assert.equal(w.g.tele.sent.length, 0);
});
test('없는 종목은 거부 · 잘못된 입력은 한글 사유 · 시세 출처 응답 불가면 경고와 함께 허용', () => {
  const w = world(); const bad = j(w.g.ctx.rich300ManualRegister({ ...FORM, symbol: 'NOSUCHCOIN' })); assert.equal(bad.ok, false); assert.equal(bad.error, 'invalid'); assert.match(bad.message, /찾지 못했습니다/);
  assert.equal(j(w.g.ctx.rich300ManualRegister({ ...FORM, formId: 'x2', stop: '150' })).message.includes('손절가는 진입가보다 아래'), true);
  w.g.spy.marketHandler = () => ({ status: 403, body: 'blocked' }); const ok = j(w.g.ctx.rich300ManualRegister({ ...FORM, formId: 'x3', symbol: 'ETH', entry: '2000', qty: '0.1', stop: '1950', tp1: '', tp2: '' }));
  assert.equal(ok.ok, true); assert.ok(ok.warnings.some(x => /확인하지 못했습니다/.test(x)));
});
test('종단: 수동 등록 → 감시 ON → 손절 접근·이탈·익절 모의 알림(각 1건, 재실행 중복 없음) → 청산 → 감시 종료', () => {
  const w = world(); w.g.ctx.rich300ManualRegister({ ...FORM, at: '' }); w.g.P.setProperty('RICH300_WATCH_ALERTS', 'on'); const all = () => w.g.tele.sent.filter(m => /\[RICH300\]/.test(m.text)), sent = () => all().filter(m => !/일일 손실 한도/.test(m.text));      // 일일 손실 한도 알림은 별도(아래에서 1건만 확인)
  w.price.SOLUSDT = 136.2; w.g.cache.evictAll(); const a = j(w.g.ctx.rich300WatchTick()); assert.equal(a.status, 'ok', JSON.stringify(a)); assert.equal(a.positions, 1); assert.equal(sent().length, 1); assert.match(sent()[0].text, /SOL LONG · ⚠️ 손절 임박/);
  assert.equal(j(w.g.ctx.rich300WatchTick()).sent, 0); assert.equal(sent().length, 1);
  w.price.SOLUSDT = 134; w.g.cache.evictAll(); w.g.ctx.rich300WatchTick(); assert.equal(sent().length, 2); assert.match(sent()[1].text, /🛑 손절가 이탈/);
  w.price.SOLUSDT = 149; w.g.cache.evictAll(); w.g.ctx.rich300WatchTick(); assert.ok(sent().some(m => /🎯 TP1 도달/.test(m.text) && /1차 익절가 148/.test(m.text)));
  assert.ok(all().filter(m => /일일 손실 한도/.test(m.text)).length <= 1); const n = sent().length; w.g.ctx.rich300WatchTick(); w.g.ctx.rich300WatchTick(); assert.equal(sent().length, n);
  w.g.ctx.rich300FillSubmit({ kind: 'exit', formId: 'cl0se1', sid: 'M-SOL-L-abc123', price: '149', qty: '', at: '' });           // 청산 기록(Fill 화면과 같은 경로)
  const z = j(w.g.ctx.rich300WatchTick()); assert.equal(z.status, 'idle'); assert.equal(sent().length, n); assert.ok(!w.g.P.getKeys().some(k => k === 'w:pos:M-SOL-L-abc123'));
  assert.ok(!w.g.tele.sent.some(m => /복기/.test(m.text)));                                                                          // 수동 포지션은 추천 기반 복기 프롬프트 대상이 아니다
});
test('운영 승인·감시 속성이 없으면 등록해도 알림 0 · 트리거 0 · 등록은 승인 속성을 바꾸지 않는다', () => {
  const g = loadProd(); seed(g, 3); g.ctx.rich300Install(); const before = snapshot(g); g.spy.marketHandler = () => ({ status: 200, body: { code: '0', data: [{ last: '150', ts: String(Date.now()) }] } });
  g.ctx.rich300ManualRegister(FORM); const after = JSON.parse(snapshot(g)).map(x => x[0]); assert.ok(!after.includes('RICH300_PROD_APPROVED')); assert.ok(!after.includes('RICH300_WATCH_ALERTS'));
  assert.deepEqual(j(g.ctx.rich300WatchTick()), { status: 'off' }); assert.equal(g.tele.sent.length, 0); assert.equal(g.spy.triggers.filter(t => t.fn === 'rich300WatchTick').length, 0); void before;
});
test('손절·익절 수정(서버): 넓히기 거부 · 좁히기/익절 변경 저장 · 감시는 수정된 손절을 쓴다', () => {
  const w = world(); w.g.ctx.rich300ManualRegister(FORM);
  const wide = j(w.g.ctx.rich300ManualUpdate('M-SOL-L-abc123', { stop: '130' })); assert.equal(wide.ok, false); assert.match(wide.message, /넓힐 수 없습니다/);
  const ok = j(w.g.ctx.rich300ManualUpdate('M-SOL-L-abc123', { stop: '138', tp1: '150', tp2: '' })); assert.deepEqual([ok.ok, ok.stop, ok.tp1, ok.tp2], [true, '138', '150', null]);
  w.g.P.setProperty('RICH300_WATCH_ALERTS', 'on'); w.price.SOLUSDT = 137; w.g.cache.evictAll(); w.g.ctx.rich300WatchTick(); assert.ok(w.g.tele.sent.some(m => /손절가 이탈/.test(m.text) && /현재 손절 기준: 138/.test(m.text)));
});
test('기존 데이터·URL·COIN RADAR 설정 보존: 스키마 시트 추가만 · 기존 속성 변경 없음', () => {
  const g = loadProd({ props: { RICH300_PROD_APPROVED: 'yes' } }); seed(g, 3); g.ctx.rich300Install(); const props = Object.fromEntries(g.P.getKeys().map(k => [k, g.P.getProperty(k)]));
  g.spy.marketHandler = () => ({ status: 200, body: { code: '0', data: [{ last: '150', ts: String(Date.now()) }] } }); g.ctx.rich300ManualRegister(FORM);
  for (const [k, v] of Object.entries(props)) if (!/^(perf|cache|w:)/.test(k)) assert.equal(g.P.getProperty(k), v, k);
});
