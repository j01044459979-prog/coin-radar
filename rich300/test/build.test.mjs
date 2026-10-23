// GAS 번들 검증: import/export 제거, 이름 충돌 없음, 순수 JS(모듈 시스템 없이)로 실행되고 ESM 결과와 값이 같다(패리티).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildEngine, stripModule, topLevelNames, ENGINE_MODULES } from '../build.mjs';
import { ledgerBuildDaily } from '../lib/ledger.mjs';
import { pnlComputeTrade } from '../lib/pnl.mjs';
import { riskTrade } from '../lib/risk.mjs';
import { compoundIdealSeries } from '../lib/compound.mjs';
import { dayStartMs } from '../lib/time.mjs';

const code = buildEngine();
const ser = v => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `${x}n` : x instanceof Map ? [...x.entries()] : x));
const ctxFor = () => { const ctx = { console }; vm.createContext(ctx); vm.runInContext(code + '\nthis.__api = { ledgerBuildDaily, pnlComputeTrade, riskTrade, compoundIdealSeries };', ctx); return ctx.__api; };

test('번들: import/export/require 없음, 최상위 이름 중복 없음, 모든 모듈 포함', () => {
  assert.ok(!/^\s*(import|export)\s/m.test(code)); assert.ok(!/\brequire\s*\(/.test(code));
  const names = topLevelNames(code); assert.equal(new Set(names).size, names.length);
  for (const n of ['dec', 'ledgerBuildDaily', 'pnlComputeTrade', 'compoundNextTarget', 'dedupeAppend', 'kstDayOf', 'riskTrade', 'storeCreate', 'storeBuildLedger', 'schemaDecString']) assert.ok(names.includes(n), n);
  assert.equal(ENGINE_MODULES.length, 9); assert.doesNotThrow(() => new vm.Script(code)); assert.ok(/var RICH300_ENGINE = \{[^}]*\bstoreCreate\b/.test(code));
});
test('번들 변환 규칙: 금지 구문 거부(export default, export { }, 동적 import, process)', () => {
  assert.throws(() => stripModule('export default 1;', 'x'), /export default/); assert.throws(() => stripModule('const a=1;\nexport { a };', 'x'), /export \{/);
  assert.throws(() => stripModule('const a = import("x");', 'x'), /모듈/); assert.throws(() => stripModule('const a = process.env;', 'x'), /모듈/);
  assert.equal(stripModule("import { a } from './a.mjs';\nexport function f() {}\n", 'x').trim(), 'function f() {}');
});
test('패리티: 번들(전역 스코프, 모듈 없음)과 ESM이 같은 입력에서 완전히 같은 결과 — 일별 장부·체결 손익·위험·이상선', () => {
  const api = ctxFor(), D1 = '2026-10-24', at = (h) => dayStartMs(D1) + h * 3600000;
  const fills = [
    { origin: 'real', fillId: 'a', sid: 'S', kind: 'entry', dir: 'SHORT', at: at(1), price: '2350.5', qty: '1.5', margin: '300', leverage: '12', fee: { state: 'entered', amount: '0.5' }, funding: { state: 'missing' } },
    { origin: 'real', fillId: 'b', sid: 'S', kind: 'reduce', dir: 'SHORT', at: at(3), price: '2300.25', qty: '0.5', fee: { state: 'estimated', amount: '0.2' }, funding: { state: 'entered', amount: '-0.1' } },
    { origin: 'real', fillId: 'c', sid: 'S', kind: 'close', dir: 'SHORT', at: at(5), price: '2400', qty: '1', fee: { state: 'entered', amount: '0.4' }, funding: { state: 'entered', amount: '0.05' } },
  ];
  const input = { challenge: { startEquity: '300', startDay: D1, rateSchedule: [{ from: D1, rate: '0.05' }] }, throughDay: '2026-10-27', fills, cashflows: [{ cfId: 'c1', at: dayStartMs('2026-10-25') + 3600000, amount: '50' }], equityInputs: [{ day: D1, equity: '300.4' }, { day: '2026-10-26', equity: '355' }] };
  const a = ledgerBuildDaily(input), b = api.ledgerBuildDaily(input);
  assert.equal(ser(b.rows), ser(a.rows)); assert.equal(ser(b.summary), ser(a.summary));
  assert.equal(ser(api.pnlComputeTrade(fills)), ser(pnlComputeTrade(fills)));
  const r = { dir: 'LONG', entry: '100', stop: '98', qty: '10', margin: '100', leverage: '10', equityMicro: 300000000n };
  assert.equal(ser(api.riskTrade(r)), ser(riskTrade(r)));
  const c = { startMicro: 300000000n, startDay: D1, schedule: input.challenge.rateSchedule, throughDay: '2027-01-01' };
  assert.equal(ser(api.compoundIdealSeries(c)), ser(compoundIdealSeries(c)));
});

import { readFileSync } from 'node:fs';
test('S0용 Engine.gs는 현재 엔진 번들과 같다(S0 종료 시 함께 삭제). 다르면: node rich300/build.mjs rich300/s0/Engine.gs', () => {
  assert.equal(readFileSync(new URL('../s0/Engine.gs', import.meta.url), 'utf8'), buildEngine());
});
test('S0 엔진 벤치(s0EngineBench): 번들을 붙인 프로젝트를 흉내 낸 vm에서 1년 일별 계산이 끝까지 실행된다', () => {
  const ctx = { console, Date }; vm.createContext(ctx); vm.runInContext(buildEngine() + '\n' + readFileSync(new URL('../s0/Code.gs', import.meta.url), 'utf8').replace(/var S0_TEST_KEY[^\n]*\n/, "var S0_TEST_KEY = 'x';\n"), ctx);
  const r = JSON.parse(JSON.stringify(ctx.s0EngineBench())); assert.equal(r.engine, true); assert.equal(r.days, 365); assert.equal(r.fills, 3285); assert.ok(r.ms < 5000);
});
