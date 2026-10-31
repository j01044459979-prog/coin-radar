// 통합(오프라인): radar 신호 단계 → 산출물(서명 전) → 서명(워크플로 스크립트) → 가짜 GitHub 공개 주소 → Apps Script 읽기·검증 → 전략 생성 → 가상 추적 → 모의 Telegram.
// 실제 GitHub Actions·Telegram·거래소 호출은 없다(전부 모의). 실제 Actions 실행은 main 반영 뒤 workflow_dispatch 로 따로 확인한다(docs/STRATEGY.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { signalStep } from '../../radar-service/signal/step.mjs';
import { feedArtifactOf } from '../../radar-service/signal/feed.mjs';
import { mkA, mk15, sender, store, collectors, oppState, NOW } from '../../radar-service/test/signal-fixture.mjs';
import { buildFeedFile } from '../client/feed-publish.mjs';
import { loadProd } from './helpers/gasprod.mjs';
import { seed } from '../perf/bench.mjs';
import { OWNER } from './helpers/faketg.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const M = 900000, H = 3600000, KEY = 'e'.repeat(40), j = v => JSON.parse(JSON.stringify(v));
const ENVA = { RADAR_RICH300_FEED: 'on', MODE: 'once', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'schedule', GITHUB_RUN_ID: '7001', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'b'.repeat(40) };
const RUN = { id: '7001', conclusion: 'success', headBranch: 'main', event: 'schedule' };
async function radar(extra = {}, { env = {} } = {}) { const st = { ...oppState() }, sd = sender(), sv = store(); const out = await signalStep({ now: NOW, state: st, env: { RADAR_SIGNAL: 'on', RADAR_RICH300_FEED: 'on', ...env }, send: sd.send, save: sv.save, analyze: () => mkA(), ...collectors({ c15: mk15() }), ...extra }); return { st, sd, out }; }
const okxBars = (n, now, { start, drift, step }) => ({ code: '0', data: Array.from({ length: n }, (_, i) => { const idx = n - 1 - i, c = start * (1 + drift * idx), t = Math.floor(now / step) * step - (i + 1) * step + step; return [String(t), String(c), String(c * 1.002), String(c * 0.998), String(c), '100', '0', '0', '1']; }) });
function gas({ key = KEY, raw = null } = {}) {
  const g = loadProd({ props: { RICH300_PROD_APPROVED: 'yes' } }); seed(g, 3); const inst = g.ctx.rich300Install(); g.tele.say(OWNER, `/start ${inst.pairLink.split('=')[1]}`); g.ctx.rich300TgPoll(); if (key) g.P.setProperty('RICH300_FEED_KEY', key); g.P.setProperty('RICH300_STRATEGY', 'on');
  const w = { g, raw, price: 100.4, bars15: [] }; g.spy.now = NOW + 6 * 60000;
  g.spy.feedHandler = () => (w.raw ? { status: 200, body: w.raw } : { status: 404, body: '' });
  g.spy.marketHandler = url => { const now = g.spy.now, p = w.price; if (/ticker/.test(url)) return { status: 200, body: { code: '0', data: [{ last: String(p), ts: String(now - 30000) }] } };
    if (/bar=15m/.test(url)) { const cl = w.bars15.filter(b => b.t + M <= now); return { status: 200, body: { code: '0', data: (cl.length ? cl : [{ t: Math.floor(now / M) * M - M, o: p, h: p, l: p, c: p }]).slice().reverse().map(b => [String(b.t), String(b.o), String(b.h), String(b.l), String(b.c), '1', '0', '0', '1']) } }; }
    return /bar=1H/.test(url) ? { status: 200, body: okxBars(100, now, { start: p * 0.95, drift: 0.0005, step: H }) } : { status: 200, body: okxBars(100, now, { start: p * 0.8, drift: 0.002, step: 4 * H }) }; };
  g.tele.sent.length = 0; g.cache.evictAll(); w.at = ms => { g.spy.now = NOW + ms; g.cache.evictAll(); return j(g.ctx.rich300WatchTick()); }; w.sent = () => g.tele.sent.filter(m => /\[RICH300/.test(m.text)).map(m => m.text);
  return w;
}
const publish = (st, { now = NOW + 4 * 60000, key = KEY, run = RUN, env = ENVA } = {}) => { const a = feedArtifactOf(st, env, now - 60000); return a.ok ? buildFeedFile(a.artifact, { key, run, now }) : a; };
const bar = (k, o, h, l, c) => ({ t: Math.ceil((NOW + 6 * 60000) / M) * M + k * M, o, h, l, c });

test('통합: radar 후보 전달 → 산출물 → 서명 → 공개 피드 → Apps Script 검증 → 전략 생성 → 진입·TP1·손절 가상 추적 · 알림 각 1회 · 수동 등록 없음', async () => {
  const r = await radar(); assert.equal(r.out.sentMessages, 1); const f = publish(r.st); assert.equal(f.ok, true, JSON.stringify(f)); assert.equal(f.count, 1);
  const w = gas({ raw: f.raw }); const fills0 = w.g.rows('fill').length; const t1 = w.at(6 * 60000); assert.equal(w.g.rows('strategy').length, 1, JSON.stringify(t1)); assert.match(w.sent()[0], /^\[RICH300 매매 전략\] \[A급 확정형\]\n🟢 ETH \/ LONG[\s\S]*✅ 신규 · 실행 가능 전략/); assert.match(w.sent()[0], /ETH \/ LONG \/ 추천 점수 80 \(강한 조건: 위험 1\.5%\)/);
  assert.match(w.sent()[0], /지연 \d+분/); assert.match(w.sent()[0], /2차 진입: [\d.]+ \/ \d+% \/ 수량 [\d.]+ \/ 증거금 [\d.]+ USDT\n   근거: .*(1H 지지 구간|스윙 저점)/); assert.match(w.sent()[0], /전체 예상 최대 손실: −/);       // 구조 정보(피드)로 2차 가격 산출 assert.equal(w.g.rows('strategy')[0].state, 'WAIT_ENTRY'); w.at(11 * 60000); assert.equal(w.sent().length, 1);                    // 같은 피드를 다시 읽어도 중복 없음
  const start = Math.ceil((NOW + 6 * 60000) / M) * M; assert.equal(w.g.rows('strategy')[0].x.startT, start);
  w.bars15 = [bar(0, 100.4, 100.5, 100.1, 100.3)]; w.price = 100.3; w.at(start - NOW + M + 60000); w.bars15.push(bar(1, 100.3, 104.4, 100.2, 104.2)); w.price = 104.2; w.at(start - NOW + 2 * M + 60000);
  w.bars15.push(bar(2, 104.2, 104.3, 100.0, 100.05)); w.price = 100.05; w.at(start - NOW + 3 * M + 60000);
  const heads = w.sent().map(t => t.split('\n')[0]); assert.ok(heads.some(h => /진입 조건 충족/.test(h))); assert.ok(heads.some(h => /TP1 도달/.test(h))); assert.ok(heads.some(h => /손절 조건 충족/.test(h))); assert.equal(w.g.rows('strategy')[0].state, 'STOP'); assert.match(w.sent().at(-1), /최종 가상 성적/);
  assert.equal(new Set(w.sent()).size, w.sent().length); assert.equal(w.g.rows('fill').length, fills0); assert.equal(w.g.rows('manualpos').length, 0);
});
test('잘못된 키: 서명에 쓴 키와 Apps Script 키가 다르면 피드 거부 · 전략·알림 0', async () => {
  const r = await radar(); const w = gas({ key: 'x'.repeat(40), raw: publish(r.st).raw }); w.at(6 * 60000); assert.equal(w.g.rows('strategy').length, 0); assert.equal(w.sent().length, 0); assert.equal(JSON.parse(w.g.P.getProperty('strategy:last')).feed.code, 'bad-signature');
  const nokey = gas({ key: null, raw: publish(r.st).raw }); nokey.at(6 * 60000); assert.equal(nokey.g.rows('strategy').length, 0); assert.equal(JSON.parse(nokey.g.P.getProperty('strategy:last')).feed.code, 'no-key');
});
test('오래된 데이터: 40분 뒤에 읽으면 거부(stale) · 이미 만든 전략은 계속 추적', async () => {
  const r = await radar(); const w = gas({ raw: publish(r.st).raw }); w.at(6 * 60000); assert.equal(w.g.rows('strategy').length, 1);
  const r2 = await radar({}, { env: {} }); r2.st.signal.feed[0] = { ...r2.st.signal.feed[0], sid: 'SG-ETH-L-newone' }; w.raw = publish(r2.st).raw; w.at(46 * 60000); assert.equal(JSON.parse(w.g.P.getProperty('strategy:last')).feed.code, 'stale'); assert.equal(w.g.rows('strategy').length, 1);
});
test('실패한 실행·미리보기·다른 브랜치·push 실행은 피드가 만들어지지 않는다', async () => {
  const r = await radar(); for (const [run, env] of [[{ ...RUN, conclusion: 'failure' }, ENVA], [{ ...RUN, headBranch: 'feature/x' }, ENVA], [{ ...RUN, id: '7999' }, ENVA], [RUN, { ...ENVA, MODE: 'preview' }], [RUN, { ...ENVA, GITHUB_REF: 'refs/heads/feature/x' }], [RUN, { ...ENVA, GITHUB_EVENT_NAME: 'push' }]]) { const f = publish(r.st, { run, env }); assert.equal(f.ok, false, JSON.stringify({ run, env: env.MODE })); }
  const w = gas({ raw: null }); w.at(6 * 60000); assert.equal(w.g.rows('strategy').length, 0); assert.equal(w.sent().length, 0); assert.equal(JSON.parse(w.g.P.getProperty('strategy:last')).feed.code, 'http-404');
});
test('전송 실패·불확실 전달: Telegram 전송이 실패했거나 전달 확인이 안 된 추천은 피드에 없어 전략이 만들어지지 않는다', async () => {
  const fail = await radar({ send: async () => { const e = new Error('down'); e.status = 500; throw e; } }); assert.equal(fail.out.sentMessages, 0); assert.ok(!fail.st.signal.feed || fail.st.signal.feed.length === 0);
  const f = publish(fail.st); const w = gas({ raw: f.raw }); w.at(6 * 60000); assert.equal(w.g.rows('strategy').length, 0); assert.equal(w.sent().length, 0);
  const unc = await radar({ send: async () => { throw new Error('socket hang up'); } }); for (let k = 1; k <= 4; k++) await signalStep({ now: NOW + k * 16 * 60000, state: unc.st, env: { RADAR_SIGNAL: 'on', RADAR_RICH300_FEED: 'on' }, send: async () => { throw new Error('socket hang up'); }, save: store().save, analyze: () => mkA(), ...collectors({ c15: mk15() }) });
  assert.ok(!unc.st.signal.feed || unc.st.signal.feed.length === 0);
});
test('플래그 off(기본): radar 상태에 피드가 없고 산출물도 만들어지지 않는다', async () => {
  const r = await radar({}, { env: { RADAR_RICH300_FEED: 'off' } }); assert.equal(r.out.sentMessages, 1); assert.equal(r.st.signal.feed, undefined); assert.deepEqual(feedArtifactOf(r.st, { ...ENVA, RADAR_RICH300_FEED: 'off' }), { ok: false, reason: 'flag-off' });
});
