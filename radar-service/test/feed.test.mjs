// RICH300 추천 피드(radar 쪽): 플래그 OFF 동치 · 전달 확인된 후보만 · 중복 없음 · 서명·형식(RICH300 검증기와 호환)
import test from 'node:test';
import assert from 'node:assert/strict';
import { feedEnabled, feedEntryOf, feedInvalidatedOf, feedPush, FEED_MAX } from '../signal/feed.mjs';
import { r9Sid } from '../signal/rich300.mjs';
import { buildFeedFile } from '../../rich300/client/feed-export.mjs';
import { feedVerify, feedParseEntry } from '../../rich300/lib/feed.mjs';
import { createHmac } from 'node:crypto';

const T = 1790000000000, KEY = 'q'.repeat(40);
const ev = (o = {}) => ({ dir: 'LONG', entry: 2000.5, stop: 1970.25, triggerT: T - 900000, triggerCloseT: T, validUntil: T + 45 * 60000, score: 72.4, t1: { price: 2050, net: 1.83, rr: 1.9 }, t2: { price: 2090 }, evidence: ['4H 상승', '15분 돌파'], volRel: 1.46, btcAlign: '동행', stageLabel: '진입 후보', costPct: 0.15, ...o });
test('플래그: RADAR_RICH300_FEED=on 일 때만(기본 off)', () => { assert.equal(feedEnabled({}), false); assert.equal(feedEnabled({ RADAR_RICH300_FEED: 'off' }), false); assert.equal(feedEnabled({ RADAR_RICH300_FEED: ' ON ' }), true); });
test('항목: 숫자는 문자열 · sid 는 R9 고유 ID 와 같다 · 잘못된 입력은 null', () => {
  const e = feedEntryOf('ETHUSDT', ev(), { now: T + 30000 }); assert.equal(e.sid, r9Sid('ETHUSDT', ev())); assert.deepEqual([e.entry, e.stop, e.score, e.rr1, e.ref1, e.ref2, e.closeT], ['2000.5', '1970.25', '72', '1.83', '2050', '2090', String(T)]); assert.ok(Object.values(e).every(v => typeof v === 'string' || Array.isArray(v)));
  assert.equal(feedEntryOf('ETH', ev(), { now: T }), null); assert.equal(feedEntryOf('ETHUSDT', ev({ entry: NaN }), { now: T }), null); assert.equal(feedEntryOf('ETHUSDT', ev({ dir: 'UP' }), { now: T }), null);
});
test('링: 같은 신호는 한 번만 · 24시간 지난 항목과 상한 초과분은 지운다', () => {
  const sg = {}; const e1 = feedEntryOf('ETHUSDT', ev(), { now: T }); assert.equal(feedPush(sg, e1, T), true); assert.equal(feedPush(sg, e1, T + 1), false); assert.equal(sg.feed.length, 1);
  assert.equal(feedPush(sg, feedInvalidatedOf('ETHUSDT', { dir: 'LONG', triggerT: T - 900000, reason: 'x' }, { now: T + 5 }), T + 5), true); assert.equal(sg.feed.length, 2);
  feedPush(sg, feedEntryOf('SOLUSDT', ev({ triggerT: T + 900000 }), { now: T + 25 * 3600000 }), T + 25 * 3600000); assert.ok(sg.feed.every(x => T + 25 * 3600000 - Number(x.createdAt ?? x.at) <= 24 * 3600000));
  const big = {}; for (let i = 0; i < FEED_MAX + 10; i++) feedPush(big, feedEntryOf('ETHUSDT', ev({ triggerT: T + i * 900000, triggerCloseT: T + i * 900000 + 900000, validUntil: T + i * 900000 + 3600000 }), { now: T + i }), T + i); assert.equal(big.feed.length, FEED_MAX);
});
test('내보내기 ↔ RICH300 검증기 호환: 서명 통과 · 항목 해석 · 키 없음/짧음은 쓰지 않음 · 변조 거부', () => {
  const state = { signal: { feed: [feedEntryOf('ETHUSDT', ev(), { now: T + 30000 })] } };
  assert.deepEqual(buildFeedFile(state, { key: undefined, now: T }), { ok: false, reason: 'no-key' }); assert.equal(buildFeedFile(state, { key: 'short', now: T }).ok, false);
  const f = buildFeedFile(state, { key: KEY, now: T + 60000 }); assert.equal(f.ok, true); assert.equal(f.count, 1); assert.ok(!f.raw.includes(KEY));
  const env = { now: () => T + 120000, hmacSha256: (k, m) => createHmac('sha256', k).update(m, 'utf8').digest('hex') }, v = feedVerify(env, f.raw, KEY); assert.equal(v.ok, true); assert.equal(v.signed, true);
  const p = feedParseEntry(v.entries[0]); assert.deepEqual([p.ok, p.kind, p.symbolId, p.dir, p.entry, p.stop, p.score, p.validUntil], [true, 'candidate', 'ETHUSDT', 'LONG', 2000.5, 1970.25, 72, T + 45 * 60000]);
  assert.equal(feedVerify(env, f.raw.replace('2000.5', '2000.6'), KEY).reason, 'bad-signature'); assert.equal(feedVerify(env, f.raw, 'x'.repeat(40)).reason, 'bad-signature');
  assert.equal(buildFeedFile({ signal: { feed: [feedEntryOf('ETHUSDT', ev(), { now: T - 25 * 3600000 })] } }, { key: KEY, now: T }).count, 0);          // 24시간 지난 항목은 내보내지 않음
});

// ── 실제 신호 단계(signalStep)와의 연결: 합성 데이터·모의 전송 ──
import { signalStep } from '../signal/step.mjs';
import { mkA, mk15, sender, store, collectors, oppState, NOW } from './signal-fixture.mjs';
const mkRun = (env, o = {}) => { const st = { ...oppState() }, sd = sender(), sv = store(); return { st, sd, args: { now: NOW, state: st, env: { RADAR_SIGNAL: 'on', ...env }, send: sd.send, save: sv.save, analyze: () => mkA(), ...collectors({ c15: mk15() }), ...o } }; };
test('플래그 off: 신호 상태에 feed 가 생기지 않고 전송 결과가 기존과 같다', async () => {
  const r = mkRun({}); const out = await signalStep(r.args); assert.equal(out.sentMessages, 1); assert.equal(r.st.signal.feed, undefined);
});
test('플래그 on: 전달 확인된 진입 후보만 피드에 남고, 재실행해도 한 번만 · 전송 메시지는 기존과 같다', async () => {
  const off = mkRun({}); await signalStep(off.args); const on = mkRun({ RADAR_RICH300_FEED: 'on' }); const out = await signalStep(on.args);
  assert.equal(out.sentMessages, 1); assert.equal(on.sd.sent[0].text, off.sd.sent[0].text); assert.equal(on.st.signal.feed.length, 1); const e = on.st.signal.feed[0]; assert.match(e.sid, /^SG-ETH-L-/); assert.equal(e.symbol, 'ETHUSDT'); assert.equal(e.dir, 'LONG'); assert.ok(Number(e.validUntil) > Number(e.closeT));
  await signalStep({ ...on.args, now: NOW + 16 * 60000 }); assert.equal(on.st.signal.feed.length, 1);
});
test('플래그 on 이어도 전송이 실패하면 피드에 남기지 않는다(전달 확인 전 추천은 전달하지 않음)', async () => {
  const sd = sender(); const r = mkRun({ RADAR_RICH300_FEED: 'on' }, { send: async () => { const e = new Error('down'); e.status = 500; throw e; } }); const out = await signalStep(r.args);
  assert.equal(out.sentMessages, 0); assert.ok(!r.st.signal.feed || r.st.signal.feed.length === 0); void sd;
});

import { readFileSync } from 'node:fs';
test('워크플로 분리: radar.yml 은 변수 하나(기본 off)만 더하고, 게시 워크플로는 플래그·키가 있을 때만 · 기존 Secret 을 쓰지 않는다', () => {
  const radar = readFileSync(new URL('../../.github/workflows/radar.yml', import.meta.url), 'utf8'), feed = readFileSync(new URL('../../.github/workflows/rich300-feed.yml', import.meta.url), 'utf8');
  assert.match(radar, /RADAR_RICH300_FEED: \$\{\{ vars\.RADAR_RICH300_FEED \|\| 'off' \}\}/); assert.ok(!/RICH300_FEED_KEY/.test(radar)); assert.ok(!/contents: write/.test(radar));
  assert.match(feed, /vars\.RADAR_RICH300_FEED == 'on'/); assert.deepEqual([...new Set([...feed.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(m => m[1]))], ['RICH300_FEED_KEY']); assert.ok(!/TELEGRAM|sendMessage/.test(feed));
  assert.match(feed, /contents: write/); assert.match(feed, /workflows: \[radar\]/); assert.ok(!/schedule:/.test(feed));
});
