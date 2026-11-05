// 회귀(2026-11-01 운영 장애): Apps Script 의 Utilities.computeHmacSha256Signature(문자열, 문자열) 는 한글이 들어간 메시지에서 UTF-8 이 아닌 값을 내
// 실제 피드가 전부 bad-signature 로 거부됐다. 모든 HMAC 호출은 Utilities.Charset.UTF_8 을 명시해야 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { loadProd } from './helpers/gasprod.mjs';
import { gasBytes } from './helpers/gasfakes.mjs';
import { authBuildRequest, authSignedString } from '../lib/auth.mjs';

const KEY = 'k'.repeat(40);
const nodeHmac = (k, m) => createHmac('sha256', k).update(m, 'utf8').digest('hex');
const korean = { entries: [{ sid: 'SG-ETH-L-abc123', symbol: 'ETHUSDT', dir: 'LONG', evidence: ['4H 상승 · 1H 지지 눌림', '15분 돌파 · 거래량 ×2.3', '손절=눌림 저점 · 1차=4H 스윙 고점'] }], meta: { runId: '1', attempt: '1', ref: 'refs/heads/main', sha: 'a'.repeat(40), event: 'schedule', mode: 'once', at: '1790000000000' } };

test('정적 점검: rich300/gas 의 모든 computeHmacSha256Signature 호출이 Utilities.Charset.UTF_8 을 세 번째 인자로 명시한다', () => {
  let calls = 0;
  for (const f of readdirSync(new URL('../gas/', import.meta.url)).filter(n => n.endsWith('.gs'))) {
    const src = readFileSync(new URL(`../gas/${f}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/computeHmacSha256Signature\(([^;]*?)\)\)/g)) { calls++; assert.match(m[1], /^[^,]+,[^,]+,\s*Utilities\.Charset\.UTF_8\s*$/, `${f}: ${m[0]}`); }
  }
  assert.ok(calls >= 3, `HMAC 호출 ${calls}곳(요청 인증·피드·라이브 검증)`);
});
test('테스트 가짜가 실측을 반영한다: 한글 메시지에서 charset 생략은 UTF-8 서명과 다르고, UTF_8 명시는 같다', () => {
  const msg = '1.1.n.' + JSON.stringify(korean), h = (cs) => createHmac('sha256', gasBytes(KEY, cs)).update(gasBytes(msg, cs)).digest('hex');
  assert.notEqual(h(undefined), nodeHmac(KEY, msg)); assert.equal(h('utf8'), nodeHmac(KEY, msg));
  const ascii = 'plain ascii message'; assert.equal(createHmac('sha256', gasBytes(KEY)).update(gasBytes(ascii)).digest('hex'), nodeHmac(KEY, ascii));    // ASCII 는 영향 없음(그래서 한글이 없는 점검은 통과했다)
});
test('운영 경로: 한글이 포함된 실제 형식의 서명 피드가 rich300StrategyEnv_ 의 HMAC 로 feedVerify 를 통과한다(UTF-8 명시)', () => {
  const g = loadProd({ props: { RICH300_PROD_APPROVED: 'yes', RICH300_FEED_KEY: KEY } }), ts = g.spy.now - 60000;
  const raw = authBuildRequest({ now: () => ts, hmacSha256: nodeHmac, newNonce: () => 'n'.repeat(24) }, KEY, { ...korean, meta: { ...korean.meta, at: String(ts - 30000) } });
  const env = g.ctx.rich300StrategyEnv_('preview'), r = g.ctx.RICH300_ENGINE.feedVerify(env, raw, KEY);
  assert.equal(r.reason, undefined); assert.equal(r.ok, true);
  assert.equal(env.hmacSha256(KEY, authSignedString(1, ts, 'n'.repeat(24), JSON.parse(raw).body)), JSON.parse(raw).sig);
});
test('서명 검증은 우회되지 않는다: 본문을 한 글자만 바꾸거나 다른 키면 한글 피드도 bad-signature', () => {
  const g = loadProd({ props: { RICH300_PROD_APPROVED: 'yes' } }), ts = g.spy.now - 60000, mk = key => authBuildRequest({ now: () => ts, hmacSha256: nodeHmac, newNonce: () => 'n'.repeat(24) }, key, { ...korean, meta: { ...korean.meta, at: String(ts - 30000) } });
  const env = g.ctx.rich300StrategyEnv_('preview'), E = g.ctx.RICH300_ENGINE;
  assert.equal(E.feedVerify(env, mk(KEY), 'z'.repeat(40)).reason, 'bad-signature');
  assert.equal(E.feedVerify(env, mk(KEY).replace('눌림 저점', '눌림 고점'), KEY).reason, 'bad-signature');
  assert.equal(E.feedVerify(env, mk(KEY), 'short').reason, 'no-key');
});
test('요청 인증(Api)과 라이브 검증(Verify) 포트도 한글 본문에서 UTF-8 서명을 낸다', () => {
  const g = loadProd({ props: { RICH300_PROD_APPROVED: 'yes' } }), msg = '1.1.n.' + JSON.stringify(korean);
  assert.equal(g.ctx.rich300ApiEnv_().hmacSha256(KEY, msg), nodeHmac(KEY, msg));
  assert.equal(g.ctx.rich300VerifyPorts_().hmacSha256(KEY, msg), nodeHmac(KEY, msg));
});
