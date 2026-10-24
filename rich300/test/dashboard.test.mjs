import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { memEnv } from './helpers/memenv.mjs';
import { fakeSheetsServices, fakeCache, fakeProps } from './helpers/gasfakes.mjs';
import { storeInit, storeCreate, storeSetupChallenge } from '../lib/store.mjs';
import { StoreError } from '../lib/schema.mjs';
import { dashBuildFromStore, dashBuildModel, dashSampleModel, dashSampleInputs, dashUsd, dashPct, DASH_MIN_SAMPLE } from '../lib/dashboard.mjs';
import { dashRenderHtml, dashRenderError, dashEsc } from '../lib/dashview.mjs';
import { dayStartMs } from '../lib/time.mjs';
import { buildEngine } from '../build.mjs';

const D1 = '2026-10-24', D2 = '2026-10-25', H = 3600000, A = { actor: 't' };
const fresh = () => { const m = memEnv({ fixedClock: true }); storeInit(m.env); return m; };
const fill = (o) => ({ origin: 'real', margin: undefined, fee: { state: 'entered', amount: '0.12' }, funding: { state: 'entered', amount: '0' }, ...o });
function seed(m) {                                         // 손계산 시나리오(문서 R6.md 와 동일)
  storeSetupChallenge(m.env, { startEquity: '300', startDay: D1, rate: '0.05' }, A);
  storeCreate(m.env, 'signal', { sid: 'A-1', strategy: 'A', symbolId: 'BTCUSDT', dir: 'LONG', signalAt: dayStartMs(D1) + 9 * H, entry: '100', stop: '98', tp1: '103' }, A);
  storeCreate(m.env, 'signal', { sid: 'B-1', strategy: 'B', symbolId: 'ETHUSDT', dir: 'SHORT', signalAt: dayStartMs(D2) + 9 * H, entry: '200', stop: '204', tp1: '195' }, A);
  storeCreate(m.env, 'response', { sid: 'A-1', choice: 'entered', at: dayStartMs(D1) + 9 * H }, A); storeCreate(m.env, 'response', { sid: 'B-1', choice: 'entered', at: dayStartMs(D2) + 9 * H }, A);
  for (const f of [fill({ fillId: 'a-in', sid: 'A-1', kind: 'entry', dir: 'LONG', at: dayStartMs(D1) + 10 * H, price: '100', qty: '3' }), fill({ fillId: 'a-out', sid: 'A-1', kind: 'close', dir: 'LONG', at: dayStartMs(D1) + 12 * H, price: '103', qty: '3' }),
    fill({ fillId: 'b-in', sid: 'B-1', kind: 'entry', dir: 'SHORT', at: dayStartMs(D2) + 10 * H, price: '200', qty: '1.5', fee: { state: 'entered', amount: '0.1' } }), fill({ fillId: 'b-out', sid: 'B-1', kind: 'close', dir: 'SHORT', at: dayStartMs(D2) + 12 * H, price: '204', qty: '1.5', fee: { state: 'entered', amount: '0.1' } })]) storeCreate(m.env, 'fill', f, A);
  storeCreate(m.env, 'cashflow', { cfId: 'dep', at: dayStartMs(D2) + H, amount: '100' }, A);
  storeCreate(m.env, 'equity', { day: D1, equity: '308.76' }, A); storeCreate(m.env, 'equity', { day: D2, equity: '402.56' }, A);
  storeCreate(m.env, 'review', { sid: 'A-1', plan: 'plan_ok', mind: 'calm', savedAt: dayStartMs(D1) + 13 * H }, A);
}
const NOW = dayStartMs(D2) + 13 * H;

test('표시 변환: 금액·퍼센트 형식(천 단위, 부호, 음수 0 방지, 반올림)', () => {
  assert.equal(dashUsd(1234567890n), '1,234.57'); assert.equal(dashUsd(-1234567890n, { sign: true }), '−1,234.57'); assert.equal(dashUsd(5000000n, { sign: true }), '+5.00'); assert.equal(dashUsd(-4000n), '0.00'); assert.equal(dashUsd(0n, { sign: true }), '0.00');
  assert.equal(dashPct(25000n), '2.50%'); assert.equal(dashPct(-1234567n, { sign: true }), '−123.46%'); assert.equal(dashPct(150000n, { dp: 0, sign: true }), '+15%'); assert.equal(dashPct(null), '—'); assert.equal(dashPct(-10n), '0.00%');
});
test('뷰 모델: 손계산 시나리오 — 오늘 카드·누적·낙폭·이상선·입출금 분리·미달분 비이월', () => {
  const m = fresh(); seed(m); const v = dashBuildFromStore(m.env, { now: NOW });
  assert.equal(v.sample, false); assert.equal(v.card.day, D2); assert.equal(v.card.n, 2); assert.equal(v.card.rate, '5%');
  assert.deepEqual([v.card.startLabel, v.card.targetLabel, v.card.targetProfitLabel, v.card.actualLabel, v.card.pnlLabel, v.card.cashflowLabel, v.card.source], ['308.76', '324.20', '+15.44', '402.56', '−6.20', '+100.00', 'input']);
  assert.equal(v.card.progressLabel, '−40.2%'); assert.equal(v.card.progressBar, 0); assert.equal(v.card.remainingLabel, '−78.36'); assert.equal(v.card.startMicro, '308760000');      // 목표 = 전일 *실제* 마감 × 1.05 (이상선 330.75 기준 아님, 미달분 비이월)
  assert.deepEqual([v.summary.pnlTotalLabel, v.summary.returnLabel, v.summary.netCashflowLabel, v.summary.maxDdLabel, v.summary.maxDdPct, v.summary.curDdLabel, v.summary.daysTargetMet, v.summary.days, v.summary.idealLabel, v.summary.gapLabel, v.summary.highestLabel], ['+2.56', '+0.85%', '+100.00', '6.20', '2.01%', '6.20', 0, 2, '330.75', '+71.81', '402.56']);
  assert.deepEqual(v.series.map(p => [p.n, p.actual, p.ideal]), [[0, 300, 300], [1, 308.76, 315], [2, 402.56, 330.75]]);
  assert.equal(JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? 'BIGINT' : x)).includes('BIGINT'), false);                       // JSON-안전
  assert.deepEqual(v.warnings.map(w => w.type), ['low-sample']);
});
test('뷰 모델: LONG/SHORT 일지·A/B 비교(응답·진입률·승률·손익·표본 부족)·복기 표시·최신순', () => {
  const m = fresh(); seed(m); storeCreate(m.env, 'signal', { sid: 'A-2', strategy: 'A', symbolId: 'SOLUSDT', dir: 'LONG', signalAt: dayStartMs(D2) + 14 * H - 1, entry: '1', stop: '0.9', tp1: '1.2' }, A);
  storeCreate(m.env, 'response', { sid: 'A-2', choice: 'missed', at: dayStartMs(D2) + 12 * H }, A); storeCreate(m.env, 'signal', { sid: 'A-3', strategy: 'A', symbolId: 'SOLUSDT', dir: 'LONG', signalAt: dayStartMs(D2) + 11 * H, entry: '1', stop: '0.9', tp1: '1.2' }, A);
  const v = dashBuildFromStore(m.env, { now: NOW }), a = v.strategies[0], b = v.strategies[1];
  assert.deepEqual([a.key, a.signals, a.entered, a.missed, a.watched, a.unanswered, a.enteredRate, a.closed, a.wins, a.winRate, a.netLabel, a.avgLabel, a.lowSample], ['A', 3, 1, 1, 0, 1, '33%', 1, 1, '100%', '+8.76', '+8.76', true]);
  assert.deepEqual([b.signals, b.closed, b.wins, b.winRate, b.netLabel, b.netNegative], [1, 1, 0, '0%', '−6.20', true]);
  assert.deepEqual(v.dirs.map(d => [d.dir, d.closed, d.wins, d.netLabel, d.winRate]), [['LONG', 1, 1, '+8.76', '100%'], ['SHORT', 1, 0, '−6.20', '0%']]);
  assert.deepEqual(v.trades.map(t => t.sid), ['B-1', 'A-1']); const t = v.trades[1]; assert.deepEqual([t.dir, t.strategy, t.symbol, t.entryAvg, t.exitAvg, t.netLabel, t.win, t.review], ['LONG', 'A', 'BTC', '100', '103', '+8.76', true, { plan: 'plan_ok', mind: 'calm' }]); assert.equal(v.trades[0].review, null);
  assert.equal(DASH_MIN_SAMPLE, 30);
});
test('뷰 모델: 보유 중 거래·수수료 미입력·장부 근사·장부 불일치 경고를 숨기지 않는다', () => {
  const m = fresh(); storeSetupChallenge(m.env, { startEquity: '300', startDay: D1, rate: '0.05' }, A);
  storeCreate(m.env, 'fill', fill({ fillId: 'o-in', sid: 'O-1', kind: 'entry', dir: 'LONG', at: dayStartMs(D1) + 10 * H, price: '50', qty: '2', fee: { state: 'missing' } }), A);
  storeCreate(m.env, 'fill', fill({ fillId: 'o-r', sid: 'O-1', kind: 'reduce', dir: 'LONG', at: dayStartMs(D1) + 11 * H, price: '55', qty: '1', fee: { state: 'missing' } }), A);
  storeCreate(m.env, 'equity', { day: D1, equity: '500', unrealized: '0' }, A);                    // 장부(305)와 크게 다름
  const v = dashBuildFromStore(m.env, { now: dayStartMs(D1) + 15 * H }), t = v.trades[0];
  assert.deepEqual([t.status, t.openQty, t.entryAvg, t.closedLabel, t.flags.includes('fee-missing')], ['open', '1', '50', null, true]); assert.equal(v.tradesOpen, 1);
  assert.equal(v.card.needsReview, true); assert.equal(v.card.diffLabel, '+195.00'); const types = v.warnings.map(w => w.type); assert.ok(types.includes('ledger-mismatch') && types.includes('fee-missing'));
  const html = dashRenderHtml(v); assert.match(html, /role="alert"/); assert.match(html, /수수료 미입력/); assert.match(html, /보유 중 · 수량 1 @ 50/);
  const m2 = fresh(); storeSetupChallenge(m2.env, { startEquity: '300', startDay: D1, rate: '0.05' }, A); const v2 = dashBuildFromStore(m2.env, { now: dayStartMs(D1) + 15 * H });
  assert.equal(v2.card.source, 'ledger'); assert.ok(v2.warnings.some(w => w.type === 'close-from-ledger')); assert.match(dashRenderHtml(v2), /장부 근사 · 평가액 미입력/);
});
test('샘플: 챌린지 설정이 없을 때만(명시 배너), 설정이 있으면 빈 기록도 실제 화면, 설정은 있는데 일정이 깨지면 샘플로 숨기지 않고 오류', () => {
  const none = fresh(), s = dashBuildFromStore(none.env, { now: NOW }); assert.equal(s.sample, true); assert.match(dashRenderHtml(s), /샘플 데이터/); assert.equal(none.mem?.appends, undefined);
  const real = fresh(); storeSetupChallenge(real.env, { startEquity: '300', startDay: D1, rate: '0.05' }, A); const r = dashBuildFromStore(real.env, { now: NOW }); assert.equal(r.sample, false); assert.ok(!/샘플 데이터/.test(dashRenderHtml(r)));
  const broken = fresh(); storeCreate(broken.env, 'challenge', { startEquity: '300', startDay: D1 }, A); assert.throws(() => dashBuildFromStore(broken.env, { now: NOW }), e => e instanceof StoreError && e.code === 'INTEGRITY');
  const before = fresh(); storeSetupChallenge(before.env, { startEquity: '300', startDay: '2027-01-01', rate: '0.05' }, A); const e = dashBuildFromStore(before.env, { now: NOW }); assert.equal(e.empty, true); assert.match(dashRenderHtml(e), /시작 전/);
});
test('샘플 데이터: 결정적·실제 장부 계산을 통과(평가액 2일 비움 → 장부 근사 표시), 모의 값 없음, 같은 입력은 같은 모델', () => {
  const a = dashSampleModel(NOW), b = dashSampleModel(NOW); assert.deepEqual(a, b); assert.equal(a.sample, true); assert.equal(a.summary.days, 21); assert.equal(a.summary.daysLedgerOnly, 2);
  assert.ok(a.trades.length >= 20 && a.strategies.every(x => x.signals > 0) && a.dirs.every(d => d.closed > 0)); assert.ok(a.series.length === 22);
  const inp = dashSampleInputs().inputs; assert.ok(inp.fills.every(f => f.origin === 'real'));
  assert.ok(a.warnings.every(w => w.type !== 'ledger-mismatch'));
});
test('렌더링: 구조·접근성·XSS 방지·외부 자원 없음·성장선 SVG·표 보기·필터·JSON 안전', () => {
  const m = fresh(); seed(m);
  storeCreate(m.env, 'fill', fill({ fillId: 'x-in', sid: '<img src=x onerror=alert(1)>', kind: 'entry', dir: 'LONG', at: dayStartMs(D2) + 11 * H, price: '10', qty: '1' }), A);
  const html = dashRenderHtml(dashBuildFromStore(m.env, { now: NOW }));
  assert.ok(!html.includes('<img src=x') && html.includes('&lt;img src=x onerror=alert(1)&gt;')); assert.ok(!/<script[^>]+src=|https?:\/\/|@import|eval\(|document\.write|innerHTML/.test(html));
  assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1">/); assert.match(html, /lang="ko"/); assert.match(html, /role="progressbar"/); assert.match(html, /prefers-color-scheme:dark/); assert.match(html, /data-theme="dark"/);
  assert.equal((html.match(/<svg /g) ?? []).length, 2); assert.match(html, /stroke-dasharray/); assert.match(html, /<details><summary>표로 보기/); assert.match(html, /data-filter="ALL"/); assert.match(html, /기록 전용 · 자동 주문 없음/);
  for (const w of ['오늘 시작 평가액', '목표 마감액', '실제 평가액', '누적 수익률', '최대 낙폭', '이상 복리선', 'A전략 · 추세돌파형', 'B전략 · 눌림목 재진입형']) assert.ok(html.includes(w), w);
  const pts = JSON.parse(/<script type="application\/json" id="pts">([\s\S]*?)<\/script>/.exec(html)[1].replace(/\\u003c/g, '<')); assert.equal(pts.length, 3); assert.ok(html.length < 60000);
  const js = /<script>([\s\S]*?)<\/script><\/body>/.exec(html)[1]; assert.doesNotThrow(() => new vm.Script(js));
  assert.equal(dashEsc(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;'); assert.match(dashRenderError(), /불러오지 못했습니다/); assert.ok(!/stack|Error:/.test(dashRenderError()));
  assert.ok(!/자동\s*주문\s*(실행|버튼)|placeOrder|createOrder/.test(readFileSync(new URL('../lib/dashview.mjs', import.meta.url), 'utf8')));
});
test('성능: 1년치 거래(3,285 체결)에서도 뷰 모델+렌더가 1초 안쪽', () => {
  const inputs = { challenge: { startEquity: '300', startDay: '2026-01-01', rateSchedule: [{ from: '2026-01-01', rate: '0.05' }] }, fills: [], cashflows: [], adjustments: [], openingPositions: [], equityInputs: [] }, signals = [];
  for (let d = 0; d < 365; d++) for (let k = 0; k < 4; k++) { const sid = `P${d}-${k}`, at = dayStartMs('2026-01-01') + d * 86400000 + (k + 1) * 3 * H; signals.push({ sid, strategy: k % 2 ? 'B' : 'A', symbolId: 'BTCUSDT', dir: k % 2 ? 'SHORT' : 'LONG', signalAt: at, entry: '1', stop: '0.9', tp1: '1.1' });
    inputs.fills.push({ origin: 'real', fillId: `${sid}i`, sid, kind: 'entry', dir: k % 2 ? 'SHORT' : 'LONG', at, price: '100', qty: '0.1', fee: { state: 'missing' }, funding: { state: 'missing' } }, { origin: 'real', fillId: `${sid}o`, sid, kind: 'close', dir: k % 2 ? 'SHORT' : 'LONG', at: at + H, price: '101', qty: '0.1', fee: { state: 'missing' }, funding: { state: 'missing' } }); }
  const t0 = Date.now(), v = dashBuildModel({ inputs, signals, throughDay: '2026-12-31', now: Date.now() }), html = dashRenderHtml(v); const ms = Date.now() - t0;
  assert.equal(v.tradesTotal, 1460); assert.equal(v.trades.length, 60); assert.ok(ms < 1500, `${ms}ms`); assert.ok(html.length < 100000, String(html.length));
});

// ── Apps Script 환경: Dashboard.gs + 라우터 ──
function loadGas({ email = 'me@example.com', corrupt = false } = {}) {
  const sheets = fakeSheetsServices(), cache = fakeCache({ t: 0 }), props = fakeProps({ RICH300_SHEET_ID: 'sheet', RICH300_OWNER_EMAIL: 'me@example.com' }), spy = { logs: [], out: null };
  const ContentService = { MimeType: { JSON: 'json', TEXT: 'text' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) };
  const HtmlService = { createHtmlOutput: h => { const o = { html: h, title: '', meta: [], setTitle(x) { this.title = x; return this; }, addMetaTag(a, b) { this.meta.push([a, b]); return this; } }; spy.out = o; return o; } };
  const ctx = { console: { log: (...a) => spy.logs.push(a.join(' ')) }, ...sheets.ctx, ContentService, HtmlService, CacheService: cache.service, PropertiesService: props.service, Session: { getActiveUser: () => ({ getEmail: () => email }) } }; vm.createContext(ctx);
  const read = f => readFileSync(new URL(`../gas/${f}`, import.meta.url), 'utf8');
  vm.runInContext([buildEngine(), read('Adapters.gs'), read('Api.gs'), read('Dashboard.gs')].join('\n'), ctx);
  if (corrupt) { ctx.RICH300_ENGINE.storeInit(ctx.rich300GasEnv_('sheet')); sheets.book.get('Challenge').cells.push(['challenge', '1', '0', '1', '{not json']); }
  return { ctx, spy, sheets };
}
test('Dashboard.gs: ?p=dash 는 소유자만, 샘플 배너·viewport 메타, 읽기 전용(시트 데이터 추가 없음), 타인·익명은 빈 응답', () => {
  const g = loadGas(), out = g.ctx.doGet({ parameter: { p: 'dash' } });
  assert.ok(out.html.includes('샘플 데이터') && out.html.includes('RICH 300')); assert.equal(out.title, 'RICH300'); assert.deepEqual(JSON.parse(JSON.stringify(out.meta)), [['viewport', 'width=device-width, initial-scale=1']]);
  const rows = ['Challenge', 'Fills', 'Responses', 'Reviews'].map(n => g.sheets.book.get(n).cells.length); assert.deepEqual(rows, [1, 1, 1, 1]);        // 헤더 행만(대시보드는 쓰지 않음)
  for (const email of ['', 'other@example.com']) assert.equal(loadGas({ email }).ctx.doGet({ parameter: { p: 'dash' } }).text, '');
  assert.equal(g.spy.logs.length, 0);
});
test('Dashboard.gs: 데이터 손상 시 샘플로 숨기지 않고 일반 오류 화면(내부 정보 없음)', () => {
  const g = loadGas({ corrupt: true }), out = g.ctx.doGet({ parameter: { p: 'dash' } });
  assert.ok(out.html.includes('불러오지 못했습니다')); assert.ok(!out.html.includes('샘플 데이터') && !/JSON|not json|INTEGRITY|Error/.test(out.html));
});
test('Dashboard.gs: 로그·콘솔 출력 없음, 외부 호출 없음', () => {
  const src = readFileSync(new URL('../gas/Dashboard.gs', import.meta.url), 'utf8'); assert.ok(!/console\.|Logger\.log|UrlFetchApp/.test(src));
});
