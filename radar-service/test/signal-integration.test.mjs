// 정기 보고(cycle) + 기회 레이더 + 실시간 신호를 같은 상태 객체·같은 전송 경로로 돌리는 통합 회귀 테스트. 모든 네트워크·Telegram은 모의다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cycle } from '../service.mjs';
import { runAfterCycle } from '../opportunity/integrate.mjs';
import { runSignalAfterCycle } from '../signal/integrate.mjs';
import { M15 } from '../signal/evaluate.mjs';
import { aggregate, H1 } from '../opportunity/indicators.mjs';
import { analyzeCoin } from '../opportunity/analysis.mjs';
import { mk15 } from './signal-fixture.mjs';
import { ETH, BTC, IDX, env, fx, row, mixed } from './opportunity-fixture.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };

const MAIN_NOW = 1800000000000;
const rawMain = () => ({
  klines: Array.from({ length: 60 }, (_, i) => { const t = MAIN_NOW - (60 - i) * 300000, c = i === 59 ? 102 : 100 + i / 100; return [t, c - .2, c + .3, c - .3, c, 1, t + 299999, i === 59 ? 300 : 100]; }),
  premium: { symbol: 'BTCUSDT', markPrice: '101.2', lastFundingRate: '0.0001', time: MAIN_NOW }, oi: { symbol: 'BTCUSDT', openInterest: '103', time: MAIN_NOW },
  history: [{ timestamp: MAIN_NOW - 900000, sumOpenInterest: '100', sumOpenInterestValue: '10000' }],
});
// 신호 기준 시각: 1H 신호 봉(IDX)이 마감한 정시 + 16분(12:15 15분봉이 확정된 뒤)
const ASOF = ETH[IDX].t + H1;
const sNow = k => ASOF + (k + 1) * M15 + 60000;
// 실제 분석 결과에 맞춰 마지막 15분봉이 a.price에서 직전 8봉 고점을 돌파하는 15분봉(closeT = ASOF + (k+1)*15분)
const a0 = (() => { const s = ETH.slice(0, IDX + 1); return analyzeCoin(s, aggregate(s), aggregate(BTC.slice(0, IDX + 1))); })();
const bars15 = k => mk15({ closeT: ASOF + (k + 1) * M15, level: a0.price - 0.25 * a0.metrics.atr1, a1: a0.metrics.atr1, lastClose: a0.price, lastOpen: a0.price - 0.35 * a0.metrics.atr1 });
const rows15 = (bars, withOpen = true) => { const r = bars.map(x => row(x.t, x.o, x.h, x.l, x.c, '1', x.q)).reverse(); if (withOpen) r.unshift(row(bars.at(-1).t + M15, 1, 9999, 0.5, 5000, '0')); return r; };   // 진행 중(미확정) 튀는 봉 포함
const series = { 'BTC-USDT-SWAP': BTC.slice(0, IDX + 1), 'ETH-USDT-SWAP': ETH.slice(0, IDX + 1) };
function market(k, { fail15 = false, calls = [] } = {}) {
  const okx = fx(series, { calls });
  return async (url, init) => {
    if (String(url).includes('bar=15m')) { calls.push(url); if (fail15) return new Response('', { status: 500 }); return new Response(JSON.stringify({ code: '0', msg: '', data: rows15(bars15(k)) }), { status: 200 }); }
    return okx(url, init);
  };
}
async function scenario({ opp = true, sig = null, fail15 = false, throwSig = false, roundtrip = false } = {}) {
  const { analyze } = await import('../analysis.mjs'), main = [], oppMsgs = [], sigMsgs = [], calls = [], outs = [];
  let state = {}; const row0 = { ...analyze('BTCUSDT', rawMain(), MAIN_NOW), strong: true };
  const save = async () => {}, mainOpt = { collect: async () => ({ rows: [row0], failures: [] }), send: async t => main.push(t), save };
  // k = 신호 슬롯 번호(0: 12:00~12:15 봉이 막 확정된 시점, 1: 다음 15분 …)
  const steps = [{ main: 0, k: 0 }, { main: 300000, k: 0, dt: 60000 }, { main: 3600000, k: 1 }, { main: 3900000, k: 2 }];
  for (const st of steps) {
    if (roundtrip && st.k === 2) state = JSON.parse(JSON.stringify(state));                         // 캐시 저장·복원(재시작) 모사
    await cycle({ ...mainOpt, now: MAIN_NOW + st.main, state });
    const now = sNow(st.k) + (st.dt ?? 0), f = market(st.k, { fail15, calls });
    if (opp) await runAfterCycle({ state, save, send: async t => oppMsgs.push(t), env: env('on'), out: () => {}, now, gapMs: 0, fetcher: f });
    if (sig) await runSignalAfterCycle({ state, save, send: async t => sigMsgs.push(t), env: { RADAR_SIGNAL: sig }, out: m => outs.push(m), now, gapMs: 0, fetcher: f, elapsedMs: 1000, ...(throwSig ? { collectHour: async () => { throw new Error('boom'); } } : {}) });
  }
  const { opportunity, signal, ...rest } = state; return { main, oppMsgs, sigMsgs, rest, opportunity, signal, state, calls, outs };
}

test('통합: 신호 기능이 off/preview/on/실패/예외여도 정기 보고 메시지·기존 상태·기회 레이더 알림은 그대로다', async () => {
  const base = await scenario({ sig: null });
  assert.ok(base.main.length >= 2 && base.oppMsgs.length >= 1 && base.opportunity.baselineDone);
  for (const o of [{ sig: 'off' }, { sig: 'preview' }, { sig: 'on' }, { sig: 'on', fail15: true }, { sig: 'on', throwSig: true }]) {
    const r = await scenario(o);
    assert.deepEqual(r.main, base.main, JSON.stringify(o)); assert.deepEqual(r.rest, base.rest, JSON.stringify(o));
    assert.deepEqual(r.oppMsgs, base.oppMsgs, `기회 레이더 알림이 달라짐 ${JSON.stringify(o)}`); assert.deepEqual(r.opportunity, base.opportunity, `state.opportunity가 달라짐 ${JSON.stringify(o)}`);
  }
});
test('통합: off·preview에서는 state.signal이 생기지 않고 전송도 없다', async () => {
  for (const sig of ['off', 'preview', null]) { const r = await scenario({ sig }); assert.equal(r.signal, undefined, String(sig)); assert.equal(r.sigMsgs.length, 0, String(sig)); }
});
test('통합: on — 진입 후보는 정확히 1번만 발송되고(같은 슬롯·다음 슬롯·재시작 후 포함) 기회 레이더 메시지와 섞이지 않는다', async () => {
  for (const roundtrip of [false, true]) {
    const r = await scenario({ sig: 'on', roundtrip });
    assert.equal(r.sigMsgs.length, 1, `신호 ${r.sigMsgs.length}건 (roundtrip ${roundtrip})`); assert.match(r.sigMsgs[0], /진입 후보/); assert.match(r.sigMsgs[0], /ETH/);
    assert.ok(r.oppMsgs.every(m => !/진입 후보|진입 관심가/.test(m)), '기회 레이더 알림에 신호 문구가 섞임'); assert.ok(r.sigMsgs.every(m => !/기회 포착 레이더/.test(m)));
    assert.ok(r.main.every(m => !/진입 후보|기회 포착 레이더/.test(String(m))));
    assert.equal(r.signal.coins.ETHUSDT.status, 'active'); assert.equal(r.signal.inflight, null); assert.equal(r.opportunity.inflight, null);
    assert.deepEqual(Object.keys(r.state).filter(k => ['opportunity', 'signal'].includes(k)).sort(), ['opportunity', 'signal']);
    JSON.parse(JSON.stringify(r.state));                                                           // 직렬화 가능(캐시 저장 가능)
  }
});
test('통합: 신호 쪽 수집 실패(15분봉 서버 오류)는 신호만 멈추고 기회 레이더·정기 보고에는 영향이 없다', async () => {
  const base = await scenario({ sig: null }), r = await scenario({ sig: 'on', fail15: true });
  assert.equal(r.sigMsgs.length, 0); assert.deepEqual(r.oppMsgs, base.oppMsgs); assert.ok(r.signal === undefined || Object.values(r.signal.coins).every(c => c.status !== 'active'));
});
test('통합: 15분봉 수집은 확정 봉만 쓴다(미확정 튀는 봉이 있어도 신호 가격에 반영되지 않음)', async () => {
  const r = await scenario({ sig: 'on' }); assert.ok(r.calls.some(u => /bar=15m/.test(u)));
  assert.ok(!r.sigMsgs.join('').includes('5000') && !r.sigMsgs.join('').includes('9999'), '미확정 봉 값이 메시지에 반영됨');
  assert.match(r.sigMsgs[0], new RegExp(`진입 관심가 ${a0.price.toFixed(2)}`));
});
test('통합: 모든 Telegram 전송은 같은 sender를 쓰고 기회 레이더·신호의 장부(inflight)는 서로 독립이다', async () => {
  const r = await scenario({ sig: 'on' });
  assert.equal(r.opportunity.inflight, null); assert.equal(r.signal.inflight, null); assert.notEqual(r.opportunity, r.signal);
  assert.ok(r.signal.daily[new Date(sNow(0)).toISOString().slice(0, 10)].candidates === 1);
});
