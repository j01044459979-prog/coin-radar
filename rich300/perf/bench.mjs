// RICH300 웹앱 성능 측정(오프라인). 가짜 Apps Script/Sheets 위에서 *실제 운영 코드*를 돌리며 Sheets·Lock·UrlFetch 호출 수를 세고, 호출 비용 모델로 서버 처리 시간을 추정한다.
//  · 호출 수와 읽은 셀 수는 측정값이다. 시간(ms)은 아래 COST 모델(가정)로 환산한 추정치이며 실제 Google 지연이 아니다 — 실제 응답시간은 배포 후 ?p=health 의 실측 칸에서 확인한다.
//  · 사용: node rich300/perf/bench.mjs [--days 90] [--json 출력경로]   (같은 파일을 변경 전 코드에서도 실행해 전후를 비교한다)
import { writeFileSync } from 'node:fs';
import { loadProd } from '../test/helpers/gasprod.mjs';

export const COST = { openById: 150, getSheetByName: 12, getLastRow: 15, getLastColumn: 15, getRange: 5, getValuesBase: 60, setValuesBase: 80, perCell: 0.02, setNumberFormat: 50, insertRows: 120, flush: 200, lockTry: 30, lockRelease: 20, urlFetch: 450, cacheOp: 25, propsOp: 8 };
const sec = (a, i) => a.indexOf(i) >= 0 && a[a.indexOf(i) + 1];
export function instrument(g) {
  const m = { calls: {}, cells: 0, ms: 0 }, hit = (k, ms, cells = 0) => { m.calls[k] = (m.calls[k] || 0) + 1; m.cells += cells; m.ms += ms + cells * COST.perCell; };
  const wrapRange = (r, nr, nc) => new Proxy(r, { get: (t, k) => { const v = t[k]; if (typeof v !== 'function') return v; return (...a) => { const out = v.apply(t, a);
    if (k === 'getValues') hit('getValues', COST.getValuesBase, nr * nc); else if (k === 'setValues') hit('setValues', COST.setValuesBase, nr * nc); else if (k === 'setNumberFormat') hit('setNumberFormat', COST.setNumberFormat); return out === t ? wrapRange(t, nr, nc) : out; }; } });
  const wrapSheet = s => new Proxy(s, { get: (t, k) => { const v = t[k]; if (typeof v !== 'function') return v;
    if (k === 'getRange') return (r, c, nr = 1, nc = 1) => { hit('getRange', COST.getRange); return wrapRange(t.getRange(r, c, nr, nc), nr, nc); };
    return (...a) => { if (k === 'getLastRow') hit('getLastRow', COST.getLastRow); else if (k === 'getLastColumn') hit('getLastColumn', COST.getLastColumn); else if (k === 'insertRowsAfter') hit('insertRows', COST.insertRows); return v.apply(t, a); }; } });
  const SA = g.ctx.SpreadsheetApp, open = SA.openById.bind(SA);
  SA.openById = id => { hit('openById', COST.openById); const ss = open(id); return { getSheetByName: n => { hit('getSheetByName', COST.getSheetByName); const s = ss.getSheetByName(n); return s && wrapSheet(s); }, insertSheet: n => { hit('insertSheet', 200); return wrapSheet(ss.insertSheet(n)); } }; };
  SA.flush = () => hit('flush', COST.flush);
  const LS = g.ctx.LockService, gl = LS.getScriptLock.bind(LS); LS.getScriptLock = () => { const l = gl(); return { tryLock: ms => { hit('lock', COST.lockTry); return l.tryLock(ms); }, releaseLock: () => { hit('lock', COST.lockRelease); l.releaseLock(); } }; };
  const UA = g.ctx.UrlFetchApp, fe = UA.fetch.bind(UA); UA.fetch = (u, o) => { hit('urlFetch', COST.urlFetch); return fe(u, o); };
  const CS = g.ctx.CacheService, gc = CS.getScriptCache.bind(CS); CS.getScriptCache = () => { const c = gc(); return { get: k => { hit('cache', COST.cacheOp); return c.get(k); }, put: (k, v, t) => { hit('cache', COST.cacheOp); c.put(k, v, t); } }; };
  return { snapshot: () => JSON.parse(JSON.stringify(m)), reset: () => { m.calls = {}; m.cells = 0; m.ms = 0; } };
}
export function seed(g, days) {        // 거래일 days × 하루 3건(신호·응답·진입·전량청산) 이력을 직접 기록한다
  const E = g.ctx.RICH300_ENGINE; g.ctx.rich300Setup_('prod'); const se = g.ctx.rich300GasEnv_('sheet'); E.storeInit(se);
  const now = 1790000000000, today = E.kstDayOf(now), start = E.addDays(today, -days);
  E.storeSetupChallenge(se, { startEquity: '300', startDay: start, rate: '0.05' }, { actor: 'seed' });
  let n = 0; const day0 = E.dayStartMs(start);
  for (let d = 0; d < days; d++) for (let j = 0; j < 3; j++) {
    const sid = `S${String(++n).padStart(5, '0')}`, at = day0 + d * 86400000 + (9 + j * 4) * 3600000, entry = 100 + (n % 37), dir = n % 2 ? 'LONG' : 'SHORT', stop = dir === 'LONG' ? entry - 1.5 : entry + 1.5, tp = dir === 'LONG' ? entry + 2.2 : entry - 2.2;
    E.storeCreate(se, 'signal', { sid, strategy: 'A', symbolId: 'ETHUSDT', dir, signalAt: at - 600000, entry: entry.toFixed(2), stop: stop.toFixed(2), tp1: tp.toFixed(2) }, { actor: 'seed' });
    E.storeCreate(se, 'response', { sid, choice: 'entered', at: at - 300000 }, { actor: 'seed' });
    E.storeCreate(se, 'fill', { origin: 'real', fillId: `${sid}:in`, sid, kind: 'entry', dir, at, price: entry.toFixed(2), qty: '1.000000', margin: '30', leverage: '10', plannedStop: stop.toFixed(2), fee: { state: 'entered', amount: '0.04' }, funding: { state: 'entered', amount: '0' } }, { actor: 'seed' });
    E.storeCreate(se, 'fill', { origin: 'real', fillId: `${sid}:out`, sid, kind: 'close', dir, at: at + 3600000, price: tp.toFixed(2), qty: '1.000000', fee: { state: 'entered', amount: '0.04' }, funding: { state: 'entered', amount: '0' } }, { actor: 'seed' });
  }
  return { sids: n, last: `S${String(n).padStart(5, '0')}` };
}
export async function runBench({ days = 90 } = {}) {
  const out = { days, scenarios: [] };
  for (const label of ['first(초기 실행: 캐시 비어 있음)', 'repeat(재실행: 직전 실행 뒤)']) {
    const g = loadProd({ props: { RICH300_PROD_APPROVED: '' } }), info = seed(g, days); g.pm.set('RICH300_SHEET_ID', 'sheet'); g.ctx.rich300Install && g.ctx.rich300Install();
    const inst = instrument(g), run = (name, fn) => { inst.reset(); const t0 = process.hrtime.bigint(); const r = fn(); const wall = Number(process.hrtime.bigint() - t0) / 1e6; const s = inst.snapshot(); return { name, calls: s.calls, totalCalls: Object.values(s.calls).reduce((a, b) => a + b, 0), cells: s.cells, modeledMs: Math.round(s.ms), nodeCpuMs: Math.round(wall), result: r }; };
    if (label.startsWith('repeat')) { g.ctx.doGet({ parameter: { p: 'dash' } }); g.ctx.doGet({ parameter: { p: 'journal' } }); }          // 직전 실행으로 캐시를 데운다
    const rows = [], sid = info.last, nextSid = 'S99999';
    g.ctx.RICH300_ENGINE.storeCreate(g.ctx.rich300GasEnv_('sheet'), 'signal', { sid: nextSid, strategy: 'A', symbolId: 'ETHUSDT', dir: 'LONG', signalAt: 1789999000000, entry: '100.00', stop: '98.50', tp1: '102.20' }, { actor: 'seed' });
    rows.push(run('첫 화면(?p=dash)', () => String(g.ctx.doGet({ parameter: { p: 'dash' } }).html || '').length));
    rows.push(run('기록 조회(?p=journal)', () => String(g.ctx.doGet({ parameter: { p: 'journal' } }).html || '').length));
    rows.push(run('입력 화면(?p=fill)', () => (g.ctx.doGet({ parameter: { p: 'fill', sid: nextSid } }), 1)));
    rows.push(run('진입 저장(FillSubmit)', () => g.ctx.rich300FillSubmit({ kind: 'entry', formId: 'perf1', sid: nextSid, margin: '30', leverage: '10', entry: '100', qty: '1', stop: '98.5', at: '' }).status));
    rows.push(run('같은 요청 재전송(중복)', () => g.ctx.rich300FillSubmit({ kind: 'entry', formId: 'perf1', sid: nextSid, margin: '30', leverage: '10', entry: '100', qty: '1', stop: '98.5', at: '' }).status));
    rows.push(run('청산 저장(FillSubmit)', () => g.ctx.rich300FillSubmit({ kind: 'exit', formId: 'perf2', sid: nextSid, price: '102', qty: '', fee: '0.04', funding: '0', at: '' }).status));
    out.scenarios.push({ label, signals: info.sids, rows });
  }
  return out;
}
const fmt = o => o.scenarios.map(s => `\n## ${s.label} — 이력 ${o.days}일 / 신호 ${s.signals}건\n` + s.rows.map(r => `${r.name.padEnd(24)} 호출 ${String(r.totalCalls).padStart(4)}회 · 셀 ${String(r.cells).padStart(7)} · 모델 ${String(r.modeledMs).padStart(6)}ms · Node CPU ${String(r.nodeCpuMs).padStart(5)}ms · ${JSON.stringify(r.result)}`).join('\n')).join('\n');
if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  const a = process.argv.slice(2), days = Number(sec(a, '--days')) || 90, o = await runBench({ days }); console.log(fmt(o)); const j = sec(a, '--json'); if (j) writeFileSync(j, JSON.stringify(o, null, 2));
}
