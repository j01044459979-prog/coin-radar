import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ingestHandle, INGEST_UNAUTHORIZED } from '../lib/ingest.mjs';
import { authBuildRequest } from '../lib/auth.mjs';
import { storeInit, storeReadAudit, storeList, storeIntegrityCheck } from '../lib/store.mjs';
import { nodeAuthEnv, postSignal } from '../client/ingest-client.mjs';
import { memEnv } from './helpers/memenv.mjs';
import { fakeSheetsServices, fakeCache, fakeProps } from './helpers/gasfakes.mjs';
import { buildEngine } from '../build.mjs';

const KEY = 'K'.repeat(8) + 'secretkey'.repeat(4), T = 1790000000000;
const SIG = { sid: 'A-BTC-1', strategy: 'A', symbolId: 'BTCUSDT', dir: 'LONG', signalAt: T, entry: '100', stop: '98', tp1: '103', tp2: '104' };
function server({ now = T, keys = [KEY], lockBusy = false } = {}) {
  const mem = memEnv({ fixedClock: true, lockBusy }); storeInit(mem.env); const st = { now, cache: new Map(), counters: [], storeOpened: 0 };
  const env = { now: () => st.now, hmacSha256: (k, m) => createHmac('sha256', k).update(m, 'utf8').digest('hex'), getKeys: () => keys,
    nonces: { has: n => { const e = st.cache.get(n); return !!e && st.now < e.exp; }, put: (n, ttl) => st.cache.set(n, { exp: st.now + ttl * 1000 }) }, counter: n => st.counters.push(n), storeEnv: () => { st.storeOpened++; return mem.env; } };
  return { env, st, mem };
}
const req = (body, { key = KEY, now = T } = {}) => authBuildRequest(nodeAuthEnv({ now: () => now }), key, body);

test('신호 수신: 정상 서명 → 저장(added) → 같은 신호를 새 nonce로 재전송 → duplicate(중복 기록 없음) → 다른 내용 conflict', () => {
  const s = server(); let r = ingestHandle(s.env, req({ type: 'signal', signal: SIG })); assert.deepEqual(r, { ok: true, status: 'added', rev: 1 });
  r = ingestHandle(s.env, req({ type: 'signal', signal: { ...SIG, entry: '100.0' } })); assert.deepEqual(r, { ok: true, status: 'duplicate', duplicate: true });
  assert.deepEqual(ingestHandle(s.env, req({ type: 'signal', signal: { ...SIG, entry: '101' } })), { ok: false, error: 'conflict' });
  assert.equal(storeReadAudit(s.mem.env).length, 1); assert.equal(storeList(s.mem.env, 'signal')[0].data.entry, '100'); assert.equal(storeIntegrityCheck(s.mem.env).ok, true);
});
test('인증 실패는 사유와 무관하게 외부 응답이 완전히 동일하고, 시트는 열지도 않는다(위조 요청이 락·시트를 소모하지 못함)', () => {
  const s = server(), good = req({ type: 'signal', signal: SIG }), obj = JSON.parse(good);
  const bads = [good.replace('"v":1', '"v":2'), JSON.stringify({ ...obj, sig: '0'.repeat(64) }), req({ type: 'signal', signal: SIG }, { key: 'x'.repeat(40) }), req({ type: 'signal', signal: SIG }, { now: 5 }), '{bad', '', 'x'.repeat(9000), JSON.stringify({ ...obj, body: { a: 1.5 } })];
  const outs = new Set(bads.map(b => JSON.stringify(ingestHandle(s.env, b)))); assert.equal(outs.size, 1); assert.equal([...outs][0], JSON.stringify(INGEST_UNAUTHORIZED));
  assert.equal(s.st.storeOpened, 0); assert.equal(storeReadAudit(s.mem.env).length, 0);
  assert.ok(new Set(s.st.counters).size >= 4);                                                                       // 사유는 카운터로만 구분
  const mis = server({ keys: [] }); assert.equal(JSON.stringify(ingestHandle(mis.env, good)), JSON.stringify(INGEST_UNAUTHORIZED));    // 키 미설정도 동일 응답(구성 정보 비노출)
  const rep = server(); ingestHandle(rep.env, good); assert.equal(JSON.stringify(ingestHandle(rep.env, good)), JSON.stringify(INGEST_UNAUTHORIZED));   // 재전송도 동일
});
test('인증된 요청의 형식 오류·알 수 없는 유형·핑·락 충돌·내부 오류 처리', () => {
  const s = server(); assert.deepEqual(ingestHandle(s.env, req({ type: 'ping' })), { ok: true, pong: true }); assert.equal(storeReadAudit(s.mem.env).length, 0); assert.equal(s.st.storeOpened, 0);
  assert.deepEqual(ingestHandle(s.env, req({ type: 'nope' })), { ok: false, error: 'invalid' }); assert.deepEqual(ingestHandle(s.env, req({ type: 'signal' })), { ok: false, error: 'invalid' }); assert.deepEqual(ingestHandle(s.env, req({ type: 'signal', signal: [1] })), { ok: false, error: 'invalid' });
  const v = ingestHandle(s.env, req({ type: 'signal', signal: { ...SIG, strategy: 'C' } })); assert.equal(v.error, 'invalid'); assert.ok(v.message.length <= 120 && !v.message.includes(KEY));
  const busy = server({ lockBusy: true }); assert.deepEqual(ingestHandle(busy.env, req({ type: 'signal', signal: SIG })), { ok: false, error: 'busy', retry: true });
  const boom = server(); boom.env.storeEnv = () => { throw new Error(`내부 상세 ${KEY}`); }; const r = ingestHandle(boom.env, req({ type: 'signal', signal: SIG })); assert.deepEqual(r, { ok: false, error: 'server' }); assert.ok(!JSON.stringify(r).includes(KEY));
});
test('nonce 캐시가 퇴출돼 같은 요청이 인증을 다시 통과해도 신호는 한 번만 저장(재전송 방어의 2중화)', () => {
  const s = server(), raw = req({ type: 'signal', signal: SIG }); assert.equal(ingestHandle(s.env, raw).status, 'added'); s.st.cache.clear();
  assert.deepEqual(ingestHandle(s.env, raw), { ok: true, status: 'duplicate', duplicate: true }); assert.equal(storeReadAudit(s.mem.env).length, 1);
});
test('Secret 비노출(종단): 모든 응답·감사 로그·시트 어디에도 키와 서명이 저장·반환되지 않는다', () => {
  const s = server(), raw = req({ type: 'signal', signal: SIG }), sig = JSON.parse(raw).sig, outs = [raw, raw, '{bad'].map(r => JSON.stringify(ingestHandle(s.env, r)));
  const dump = JSON.stringify([...s.mem.sheets]) + outs.join('') + s.st.counters.join(''); assert.ok(!dump.includes(KEY) && !dump.includes(sig));
});

// ── 클라이언트 → (GAS처럼 302로 응답하는) 서버 → 핸들러 종단 ──
function gasLike(handler, { dropFirstResponse = false } = {}) {
  const echo = new Map(); let n = 0, posts = 0;
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
    if (req.url.startsWith('/echo/')) { res.setHeader('content-type', 'application/json'); return res.end(echo.get(req.url.slice(6)) ?? '{}'); }
    posts++; const out = JSON.stringify(handler(b));
    if (dropFirstResponse && posts === 1) return req.socket.destroy();                     // 서버는 처리했지만 응답이 유실되는 경우
    const k = String(++n); echo.set(k, out); res.statusCode = 302; res.setHeader('location', `http://127.0.0.1:${srv.address().port}/echo/${k}`); res.end(); }); });
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok({ srv, url: `http://127.0.0.1:${srv.address().port}/exec`, posts: () => posts })));
}
test('종단(클라이언트→302 서버→핸들러): 전송 성공, 같은 신호 재전송은 duplicate, 응답이 유실돼도 새 nonce로 재시도해 정확히 1건만 저장', async () => {
  const s = server({ now: Date.now() }); s.env.now = () => Date.now(); const g = await gasLike(raw => ingestHandle(s.env, raw), { dropFirstResponse: true }), sigNow = { ...SIG, signalAt: Date.now() };
  try {
    const r = await postSignal({ url: g.url, key: KEY, signal: sigNow, attempts: 3, backoffMs: 1, sleep: async () => {} });
    assert.deepEqual([r.ok, r.attempts, r.duplicate, r.status], [true, 2, true, 'duplicate']);                   // 1차는 처리됐으나 응답 유실 → 2차(새 nonce)는 duplicate
    assert.equal(g.posts(), 2); assert.equal(storeReadAudit(s.mem.env).length, 1); assert.equal(storeIntegrityCheck(s.mem.env).ok, true);
    const again = await postSignal({ url: g.url, key: KEY, signal: sigNow, sleep: async () => {} }); assert.equal(again.status, 'duplicate');
  } finally { g.srv.close(); }
});
test('클라이언트: 인증 실패는 재시도 없이 보고, 네트워크 오류는 URL·키 없이 코드만 보고, 예외를 던지지 않고, 로그가 없다', async () => {
  const s = server({ now: Date.now() }); s.env.now = () => Date.now(); const g = await gasLike(raw => ingestHandle(s.env, raw));
  try {
    const bad = await postSignal({ url: g.url, key: 'W'.repeat(40), signal: SIG, sleep: async () => {} }); assert.deepEqual(bad, { ok: false, error: 'unauthorized', attempts: 1 });
    const good = await postSignal({ url: g.url, key: KEY, signal: SIG, attempts: 2, sleep: async () => {} }); assert.deepEqual([good.ok, good.status, good.attempts], [true, 'added', 1]);   // 인증 실패 뒤에도 올바른 키는 정상 처리
  } finally { g.srv.close(); }
  const SECRET_URL = 'https://script.google.com/macros/s/SECRETDEPLOYMENTID/exec';
  const net = await postSignal({ url: SECRET_URL, key: KEY, signal: SIG, attempts: 2, sleep: async () => {}, fetcher: async url => { throw new Error(`connect ECONNREFUSED ${url}`); } });
  assert.deepEqual(net, { ok: false, error: 'network', attempts: 2 }); assert.ok(!JSON.stringify(net).includes('SECRET') && !JSON.stringify(net).includes(KEY));
  const to = await postSignal({ url: SECRET_URL, key: KEY, signal: SIG, attempts: 1, sleep: async () => {}, fetcher: async () => { const e = new Error('x'); e.name = 'TimeoutError'; throw e; } }); assert.equal(to.error, 'timeout');
  assert.equal((await postSignal({ url: '', key: KEY, signal: SIG })).error, 'not-configured'); assert.equal((await postSignal({ url: SECRET_URL, key: 'short', signal: SIG, fetcher: async () => { throw new Error('호출되면 안 됨'); } })).error, 'build-failed');
  const html = await postSignal({ url: SECRET_URL, key: KEY, signal: SIG, attempts: 1, sleep: async () => {}, fetcher: async () => new Response('<html>login</html>', { status: 200 }) }); assert.equal(html.error, 'bad-response');
});

// ── Api.gs: 엔진 번들 + Adapters.gs + Api.gs 를 모듈 없이 vm에서 실행(가짜 Apps Script 서비스) ──
function loadApi({ keys = { RICH300_INGEST_KEY: KEY }, now = T } = {}) {
  const sheets = fakeSheetsServices(), cache = fakeCache({ t: 0 }), props = fakeProps({ RICH300_SHEET_ID: 'sheet', ...keys }), spy = { sheetOpens: 0, logs: [] };
  const origOpen = sheets.ctx.SpreadsheetApp.openById; sheets.ctx.SpreadsheetApp.openById = id => { spy.sheetOpens++; return origOpen(id); };
  const ContentService = { MimeType: { JSON: 'json', TEXT: 'text' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) };
  const ctx = { console: { log: (...a) => spy.logs.push(a.join(' ')) }, Date: class extends Date { static now() { return now; } }, ...sheets.ctx, ContentService, CacheService: cache.service, PropertiesService: props.service }; vm.createContext(ctx);
  vm.runInContext(buildEngine() + '\n' + readFileSync(new URL('../gas/Adapters.gs', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('../gas/Api.gs', import.meta.url), 'utf8'), ctx);
  return { ctx, cache, props, sheets, spy, post: raw => JSON.parse(ctx.doPost({ postData: { contents: raw, type: 'application/json' } }).text) };
}
test('Api.gs(가짜 Apps Script): 서명된 신호 저장·재전송 duplicate·위조는 동일 응답(시트 미접근)·키 회전·키 미설정 시 닫힘·GET 빈 응답·로그 없음', () => {
  const a = loadApi(); assert.equal(a.ctx.doGet().text, '');
  const bad = a.post(req({ type: 'signal', signal: SIG }, { key: 'Z'.repeat(40) })); assert.deepEqual(bad, INGEST_UNAUTHORIZED); assert.equal(a.spy.sheetOpens, 0);          // 위조: 시트를 열지 않음
  assert.deepEqual(a.post('{bad'), INGEST_UNAUTHORIZED); assert.deepEqual(a.post(''), INGEST_UNAUTHORIZED);
  assert.deepEqual(a.post(req({ type: 'ping' })), { ok: true, pong: true }); assert.equal(a.spy.sheetOpens, 0);
  const first = a.post(req({ type: 'signal', signal: SIG })); assert.deepEqual(first, { ok: true, status: 'added', rev: 1 }); assert.ok(a.spy.sheetOpens > 0);
  assert.equal(a.post(req({ type: 'signal', signal: SIG })).status, 'duplicate');                                                      // 새 nonce, 같은 신호
  const raw = req({ type: 'signal', signal: { ...SIG, sid: 'A-BTC-2' } }); assert.equal(a.post(raw).status, 'added'); assert.deepEqual(a.post(raw), INGEST_UNAUTHORIZED);   // 같은 요청 재전송 = 거부
  a.cache.evictAll(); assert.equal(a.post(raw).status, 'duplicate');                                                                    // 캐시 퇴출 후에도 중복 기록 없음
  assert.equal(a.ctx.RICH300_ENGINE.storeReadAudit(a.ctx.rich300GasEnv_('x')).length, 2);
  const rot = loadApi({ keys: { RICH300_INGEST_KEY: 'N'.repeat(40), RICH300_INGEST_KEY_PREV: KEY } }); assert.equal(rot.post(req({ type: 'signal', signal: SIG })).status, 'added');         // 이전 키로 서명한 요청 허용
  const noKey = loadApi({ keys: {} }); assert.deepEqual(noKey.post(req({ type: 'signal', signal: SIG })), INGEST_UNAUTHORIZED); assert.equal(noKey.spy.sheetOpens, 0);
  assert.deepEqual(a.spy.logs, []);
  assert.ok(!JSON.stringify([...a.props.map]).includes('undefined'));
});
