// S0 프로브 오프라인 테스트: Code.gs를 가짜 Apps Script 서비스 위에서 실행하고, GAS 배포를 흉내 낸 로컬 서버로 probe.mjs를 검증한다.
// (실제 Google 동작은 이 테스트가 아니라 S0 실측에서 확인한다 — 헤더 비노출·302는 흉내 낸 가정이다.)
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { run, makeBody, sign } from '../s0/probe.mjs';

function loadGas() {
  const store = new Map(), rows = [];
  const sheet = { appendRow: r => rows.push(r), getLastRow: () => rows.length, getRange: () => ({ getValues: () => rows.slice(-30) }), getDataRange: () => ({ getValues: () => rows }), setName() {} };
  const ss = { getId: () => 'sheet1', getSheets: () => [sheet], getSheetByName: () => sheet };
  const out = obj => ({ text: obj, setMimeType() { return this; } });
  const ctx = { console, JSON, Date, Math, Number, String, Object, Array,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => store.get(k) ?? null, setProperty: (k, v) => store.set(k, v) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: { create: () => ss, openById: () => ss },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: txt => out(txt) },
    Session: { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => 'owner@example.test' }), getScriptTimeZone: () => 'Asia/Seoul' },
    Utilities: { computeHmacSha256Signature: (msg, key) => [...createHmac('sha256', key).update(msg).digest()].map(b => (b > 127 ? b - 256 : b)), formatDate: (d, tz, f) => d.toISOString() },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create() {} }), everyDays: () => ({ atHour: () => ({ create() {} }) }) }) }) } };
  vm.createContext(ctx); vm.runInContext(readFileSync(new URL('../s0/Code.gs', import.meta.url), 'utf8'), ctx);
  return { ctx, rows, store };
}
// GAS 웹앱 흉내: POST는 실행 후 302(Location=에코 URL), 에코 URL은 결과 JSON. 헤더는 이벤트 객체에 넣지 않는다(가정 ①).
function serve(gas) {
  const echo = new Map(); let id = 0;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      if (u.pathname.startsWith('/echo/')) { res.setHeader('content-type', 'application/json'); return res.end(echo.get(u.pathname.slice(6)) ?? '{}'); }
      const e = { parameter: Object.fromEntries(u.searchParams), queryString: u.search.slice(1), contentLength: body.length, postData: { type: req.headers['content-type'], contents: body } };
      const r = req.method === 'POST' ? gas.ctx.doPost(e) : gas.ctx.doGet(e), text = r.text;
      if (req.method === 'POST') { const k = String(++id); echo.set(k, text); res.statusCode = 302; res.setHeader('location', `http://127.0.0.1:${srv.address().port}/echo/${k}`); return res.end(); }
      res.setHeader('content-type', 'application/json'); res.end(text);
    });
  });
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

test('S0 프로브: Code.gs와 probe.mjs가 서명 검증·변조 거부·오래된 ts 거부·락 카운터·302 관찰을 올바르게 수행한다', async () => {
  const gas = loadGas(), srv = await serve(gas), url = `http://127.0.0.1:${srv.address().port}/exec`, logs = [];
  try {
    const r = await run({ url, log: m => logs.push(m), n: 6 }), c = r.checks;
    assert.equal(c.postRedirect.redirected, true); assert.equal(c.postRedirect.firstStatus, 302);
    assert.equal(c.signature.sigOk, true); assert.equal(c.signature.tsOk, true); assert.equal(c.tamperRejected, true); assert.equal(c.staleTsRejected, true);
    assert.deepEqual(c.headersVisible.headerLikeKeys, []); assert.equal(c.headersVisible.customHeaderSeen, false);
    assert.equal(c.executionsForThreePosts, 3); assert.equal(c.lockAndCounter.lockedCorrectly, true);
    assert.equal(c.latencyMsSequential.n, 6); assert.ok(logs.some(l => l.startsWith('S0_RESULT ')));
  } finally { srv.close(); }
});
test('S0 프로브: URL(Secret)이 없으면 건너뛰고 아무것도 요청하지 않는다, 로그에 URL을 출력하지 않는다', async () => {
  const logs = [], r = await run({ url: '', fetcher: async () => { throw new Error('요청 금지'); }, log: m => logs.push(m) }); assert.equal(r.skipped, true);
  const gas = loadGas(), srv = await serve(gas), url = `http://127.0.0.1:${srv.address().port}/exec`, logs2 = [];
  try { await run({ url, log: m => logs2.push(m), n: 2 }); assert.ok(logs2.every(l => !l.includes(url) && !l.includes('/exec')), 'URL 비출력'); } finally { srv.close(); }
});
test('S0 Code.gs: 시험 키는 비밀이 아님을 명시하고, Telegram·토큰·외부 전송 코드가 없다', () => {
  const src = readFileSync(new URL('../s0/Code.gs', import.meta.url), 'utf8');
  assert.match(src, /비밀이 아니다/); assert.ok(!/UrlFetchApp|api\.telegram|bot[0-9]+:/i.test(src));
  assert.equal(sign(1, 1, 'n', { a: 1 }), createHmac('sha256', 's0-throwaway-key-not-a-secret').update('1.1.n.{"a":1}').digest('hex'));
  assert.ok(makeBody().includes('"sig"'));
});

test('S0 호환성 프로브(s0Compat): V8 문법·BigInt·SHA-256 검사 함수가 동작하고 기대 항목을 모두 보고한다', async () => {
  const { createHash } = await import('node:crypto');
  const gas = loadGas(); gas.ctx.Utilities.DigestAlgorithm = { SHA_256: 'sha256' }; gas.ctx.Utilities.Charset = { UTF_8: 'utf8' };
  gas.ctx.Utilities.computeDigest = (alg, str) => [...createHash('sha256').update(str).digest()].map(b => (b > 127 ? b - 256 : b));
  const r = JSON.parse(gas.ctx.doGet({ parameter: { action: 'compat' } }).text);
  assert.equal(r.bigintLiteralAndPow, '3000000000000000000000000'); assert.equal(r.bigintDivRound, '3,-1'); assert.equal(r.optionalChaining, true); assert.equal(r.nullish, true);
  assert.equal(r.padEnd, '700'); assert.equal(r.objectFromEntries, '{"a":1}'); assert.equal(r.mapSet, true); assert.equal(r.bigintJsonThrows, 'throws'); assert.equal(r.numberFromBigint, 315000000); assert.equal(r.toFixed12, '0.100000000000');
  assert.equal(r.sha256Hex, r.expectedSha256Abc); assert.equal(JSON.stringify(gas.ctx.s0EngineBench()), '{"engine":false}');
});
