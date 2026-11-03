// P1 Telegram 조용한 모드: 일반 후보·정기 보고 전송만 끄고 분석·상태·A급 신호·장애 알림은 유지한다. 모든 외부 호출은 모의 함수다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyze } from '../analysis.mjs';
import { cycle, ApiError } from '../service.mjs';
import { quietMode, mutedSender } from '../quiet.mjs';
import { opportunityStep } from '../opportunity/step.mjs';
import { IDX, NOW, mkSend, env, mixed, fx } from './opportunity-fixture.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };
const now = 1800000000000;
function raw() {
  return { klines: Array.from({ length: 60 }, (_, i) => { const t = now - (60 - i) * 300000, c = i === 59 ? 102 : 100 + i / 100; return [t, c - .2, c + .3, c - .3, c, 1, t + 299999, i === 59 ? 300 : 100]; }),
    premium: { symbol: 'BTCUSDT', markPrice: '102', lastFundingRate: '0.0001', time: now }, oi: { symbol: 'BTCUSDT', openInterest: '103', time: now }, history: [{ timestamp: now - 900000, sumOpenInterest: '100', sumOpenInterestValue: '10000' }] };
}
const strongRow = () => ({ ...analyze('BTCUSDT', raw(), now), strong: true });
const harness = (state, extra = {}) => { const out = { texts: [], photos: [], renders: 0 }; return { out, o: { state, collect: async () => ({ rows: [strongRow()], failures: [], charts: {} }), send: async t => out.texts.push(t), sendPhoto: async () => out.photos.push(1), render: async () => { out.renders++; return Buffer.from('x'); }, save: async () => {}, ...extra } }; };

test('플래그: RADAR_TELEGRAM_QUIET=on 일 때만 켜진다(기본 off, 대소문자·공백 허용)', () => {
  for (const v of [undefined, '', 'off', 'preview', 'true', '1', 'yes']) assert.equal(quietMode({ RADAR_TELEGRAM_QUIET: v }), false, String(v));
  for (const v of ['on', 'ON', ' On ']) assert.equal(quietMode({ RADAR_TELEGRAM_QUIET: v }), true, v);
  assert.equal(quietMode({}), false);
});
test('기본(off)은 기존 동작: 정기 보고가 전송된다', async () => {
  const { o, out } = harness({}); await cycle({ ...o, now });
  assert.ok(out.texts.filter(t => t.includes('📡 RICH')).length >= 1);
});
test('조용한 모드: 정기 보고·차트는 전송·렌더하지 않고, 시간대·쿨다운 상태는 평소처럼 남는다', async () => {
  const state = {}, { o, out } = harness(state); await cycle({ ...o, now, quietReports: true });
  assert.equal(out.texts.length, 0); assert.equal(out.photos.length, 0); assert.equal(out.renders, 0);
  assert.equal(state.reportHour, Math.floor(now / 3600000)); assert.equal(state.sent['BTCUSDT:LONG'], now);
  assert.equal(state.reportMuted.hour, state.reportHour); assert.equal(state.partial, undefined); assert.equal(state.lastSuccess, now); assert.equal(state.rows.length, 1);
});
test('조용한 모드: 같은 시간대 안의 강한 신규 신호 긴급 알림(사이클)도 보내지 않는다', async () => {
  const state = { reportHour: Math.floor(now / 3600000) }, { o, out } = harness(state);
  await cycle({ ...o, now, quietReports: true }); await cycle({ ...o, now: now + 300000, quietReports: true });
  assert.equal(out.texts.length, 0); assert.equal(out.photos.length, 0);
});
test('조용한 모드에서도 수집 장애 알림은 보낸다(필수 시스템 알림, 1시간 1회)', async () => {
  const state = {}, texts = [];
  const o = { state, collect: async () => { throw new ApiError('binance', 403); }, send: async t => texts.push(t), save: async () => {}, quietReports: true };
  await cycle({ ...o, now }); await cycle({ ...o, now: now + 300000 });
  assert.equal(texts.length, 1); assert.match(texts[0], /수집 장애/);
});
test('조용한 모드에서도 연속성 억제(state.quiet)·분석 결과 저장 경로는 그대로다', async () => {
  const state = { quiet: { hour: Math.floor(now / 3600000), reason: 'stale-cache' } }, { o, out } = harness(state);
  const r = await cycle({ ...o, now, quietReports: true });
  assert.equal(r.quiet, 'stale-cache'); assert.equal(out.texts.length, 0);
});
test('OPPORTUNITY: 삼키는 전송기를 써도 분석·상태 갱신은 실제 전송 때와 완전히 같고 Telegram 호출만 없다', async () => {
  const ex = { RADAR_OPPORTUNITY_TOP: '30', RADAR_OPPORTUNITY_FIRST_RUN: 'summary' }, series = mixed({ r: 4 });
  const live = [], stLive = {}, stMuted = {}, muted = mutedSender();
  const a = await opportunityStep({ env: env('on', ex), state: stLive, save: async () => {}, send: mkSend(live), now: NOW(IDX), gapMs: 0, fetcher: fx(series) });
  const b = await opportunityStep({ env: env('on', ex), state: stMuted, save: async () => {}, send: muted.send, now: NOW(IDX), gapMs: 0, fetcher: fx(series) });
  assert.ok(live.length > 0, '비교 기준: 실제 전송 경로에서는 메시지가 있어야 한다'); assert.equal(muted.stat.count, live.length);
  assert.deepEqual(stMuted.opportunity.coins, stLive.opportunity.coins, 'watchlist 의 근거(state.opportunity.coins)가 달라지면 A급 감지가 줄어든다');
  assert.equal(b.analyzed, a.analyzed); assert.equal(b.watching, a.watching); assert.equal(b.sendError, null);
});
test('배선: 워크플로 기본값은 off, run.mjs 는 조용한 모드에서 A급 신호 전송기를 바꾸지 않는다', () => {
  const wf = readFileSync(new URL('../../.github/workflows/radar.yml', import.meta.url), 'utf8'), run = readFileSync(new URL('../run.mjs', import.meta.url), 'utf8');
  assert.match(wf, /RADAR_TELEGRAM_QUIET: \$\{\{ vars\.RADAR_TELEGRAM_QUIET \|\| 'off' \}\}/);
  assert.match(run, /await signal\(\{ send, sendPhoto \}\)/); assert.match(run, /\.\.\.options, \.\.\.\(quiet \? \{ send: muted\.send \} : \{\}\)/);
  assert.match(run, /quietReports: quiet/); assert.doesNotMatch(run, /RADAR_OPPORTUNITY.*= *'off'/);
});
