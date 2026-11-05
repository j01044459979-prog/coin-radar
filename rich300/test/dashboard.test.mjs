// 집중형 메인 화면(자산·5% 목표·복기) 뷰 모델·렌더 테스트. 모든 데이터는 합성이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dashBuildModel, dashSampleInputs, dashSampleModel, dashBuildFromStore, dashUsd, dashPct } from '../lib/dashboard.mjs';
import { dashRenderHtml, dashRenderError, dashEsc, dashNav } from '../lib/dashview.mjs';
import { ledgerBuildDaily } from '../lib/ledger.mjs';
import { decFormat } from '../lib/decimal.mjs';
import { addDays, dayStartMs } from '../lib/time.mjs';
import { makeTg } from './helpers/faketg.mjs';
import { StoreError } from '../lib/schema.mjs';

const NOW = 1791876554386 + 3600000;
const sample = () => dashSampleInputs();
const build = (inputs, throughDay) => dashBuildModel({ inputs, throughDay, now: NOW });
const text = html => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ');
const simple = () => ({ challenge: { startEquity: '300', startDay: '2026-10-01', rateSchedule: [{ from: '2026-10-01', rate: '0.05' }] }, fills: [], cashflows: [], adjustments: [], openingPositions: [], equityInputs: [] });

test('표시 형식: 금액·퍼센트 부호와 천 단위, 0은 부호 없음', () => {
  assert.equal(dashUsd(1234567890n, { sign: true }), '+1,234.57'); assert.equal(dashUsd(-5000000n, { sign: true }), '−5.00'); assert.equal(dashUsd(0n, { sign: true }), '0.00');
  assert.equal(dashPct(52000n, { sign: true }), '+5.20%'); assert.equal(dashPct(-10000n), '−1.00%'); assert.equal(dashPct(null), '—');
});
test('집중형 홈 항목 순서: 실제 자산 → 누적 성과 → 일일 목표 → 성장 그래프 → 매매일지', () => {
  const m = dashSampleModel(NOW), t = text(dashRenderHtml(m, { appUrl: 'https://script.google.com/macros/s/X/exec' }));
  const order = ['내 실제 총자산', '누적 손익', '누적 수익률', '오늘 복리 목표', '목표까지 남은 금액', '내 자산 증식 현황', '최근 매매일지'].map(k => t.indexOf(k));
  assert.ok(order.every(i => i >= 0), JSON.stringify(order)); assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(t, /목표 = 전일 실제 마감 자산/); assert.match(t, /수익을 보장하지 않으며/);
});
test('성장 그래프: 실제 입력일만 연결하고, 5% 이상 목표와 별개로 표시한다', () => {
  const html = dashRenderHtml(dashSampleModel(NOW));
  assert.match(html, /<svg/); assert.match(html, /이상 5% 복리 목표/);
  assert.ok(!/<canvas|<script|<img/i.test(html));
  const m = build(simple(), '2026-10-03');
  assert.equal(m.daily[0].actualMicro, null);
  assert.ok(m.daily.every(d => d.actualMicro === null));
  assert.equal(m.today.progress, null);
});
test('현재 총자산·누적: 입력 평가액 기준, 입출금은 손익에서 제외(시작 300·입금 50·평가액 590.62 → +240.62, +80.21%)', () => {
  const m = dashSampleModel(NOW); assert.equal(m.current.label, '590.62'); assert.equal(m.current.pnlLabel, '+240.62'); assert.equal(m.current.returnLabel, '+80.21%'); assert.equal(m.current.cashflowLabel, '+50.00');
  const i = simple(); i.cashflows = [{ cfId: 'a', at: dayStartMs('2026-10-01') + 3600000, amount: '100' }]; i.equityInputs = [{ day: '2026-10-01', equity: '400' }];
  const m2 = build(i, '2026-10-01'); assert.equal(m2.current.pnlLabel, '0.00'); assert.equal(m2.current.returnLabel, '0.00%'); assert.equal(m2.current.pnlPositive, false);   // 입금만 있고 손익 없음
  i.cashflows.push({ cfId: 'b', at: dayStartMs('2026-10-01') + 7200000, amount: '-40' }); i.equityInputs = [{ day: '2026-10-01', equity: '372' }];
  assert.equal(build(i, '2026-10-01').current.pnlLabel, '+12.00');                                // 300+100−40=360 → 372은 +12
});
test('평가액을 한 번도 입력하지 않으면 임의 잔액을 만들지 않고 "미입력" 표시(누적·남은 금액 포함)', () => {
  const m = build(simple(), '2026-10-03'); assert.equal(m.current, null); assert.equal(m.today.remainingLabel, null); assert.equal(m.today.achieved, false);
  const html = dashRenderHtml(m, { appUrl: 'https://x.test/exec' }), t = text(html); assert.match(t, /내 실제 총자산 \(입력 평가액\) 미입력/); assert.equal((t.match(/미입력/g) || []).length >= 4, true);
  assert.ok(!/내 실제 총자산 \(입력 평가액\) 300\.00/.test(t));            // 시작 자금을 입력 평가액으로 둔갑시키지 않는다
  assert.match(html, /평가액 입력하기/); assert.match(html, /p=assets/);
});
test('오늘 값: 시작 자산=전일 실제 마감, 목표=전일 마감×1.05, 목표 초과 시 남은 금액 0과 달성 표시(별도)', () => {
  const i = simple(); i.equityInputs = [{ day: '2026-10-01', equity: '320' }, { day: '2026-10-02', equity: '340' }];
  let m = build(i, '2026-10-02'); assert.equal(m.today.startLabel, '320.00'); assert.equal(m.today.targetLabel, '336.00'); assert.equal(m.today.remainingLabel, '0.00'); assert.equal(m.today.achieved, true);
  assert.match(text(dashRenderHtml(m)), /오늘 목표 달성/);
  i.equityInputs = [{ day: '2026-10-01', equity: '320' }, { day: '2026-10-02', equity: '330' }]; m = build(i, '2026-10-02'); assert.equal(m.today.remainingLabel, '6.00'); assert.equal(m.today.achieved, false); assert.ok(!/오늘 목표 달성/.test(text(dashRenderHtml(m))));
});
test('오늘 평가액이 없고 이전 입력만 있으면 입력일을 밝히고, 목표 초과라도 오늘 달성으로 표시하지 않는다', () => {
  const i = simple(); i.equityInputs = [{ day: '2026-10-01', equity: '400' }]; let m = build(i, '2026-10-02');
  assert.equal(m.current.stale, true); assert.equal(m.current.day, '2026-10-01'); assert.equal(m.today.achieved, false); assert.match(text(dashRenderHtml(m)), /2026-10-01 입력 기준/);
  i.cashflows = [{ cfId: 'w', at: dayStartMs('2026-10-02') + 3600000, amount: '-100' }]; m = build(i, '2026-10-03');      // 출금 후 오늘 목표(315)가 낮아져 예전 입력(400)이 목표를 넘는 경우
  assert.equal(m.today.achieved, false); assert.equal(m.today.achievedStale, true); assert.equal(m.today.remainingLabel, null); assert.equal(m.today.progress, null); assert.match(text(dashRenderHtml(m)), /오늘 평가액 없음/); assert.ok(!/오늘 목표 달성/.test(text(dashRenderHtml(m))));
});
test('오늘 실현손익: 오늘 체결의 순손익(수수료·펀딩 반영, 입력된 것만), 입출금과 무관', () => {
  const i = simple(); const day = '2026-10-02', at = dayStartMs(day) + 36000000;
  i.fills = [{ origin: 'real', fillId: 'f1', sid: 'S1', kind: 'entry', dir: 'LONG', at, price: '100', qty: '1', margin: '10', leverage: '10', fee: { state: 'entered', amount: '0.1' }, funding: { state: 'entered', amount: '0' } },
    { origin: 'real', fillId: 'f2', sid: 'S1', kind: 'close', dir: 'LONG', at: at + 3600000, price: '110', qty: '1', fee: { state: 'entered', amount: '0.1' }, funding: { state: 'entered', amount: '-0.3' } }];
  i.cashflows = [{ cfId: 'c', at, amount: '500' }];
  const m = build(i, day); assert.equal(m.today.realizedLabel, '+9.50'); assert.equal(m.today.realizedPositive, true);              // 10 − 0.2 − 0.3
  const short = structuredClone(i); short.fills[0].dir = short.fills[1].dir = 'SHORT'; assert.equal(build(short, day).today.realizedLabel, '−10.50');   // −10 − 0.2 − 0.3
});
test('날짜별 표: 최신 날짜 먼저, 입력일은 마감 자산·손익, 미입력일은 "미입력"과 장부상 실현손익, 목표 달성일 표시', () => {
  const i = simple(); i.equityInputs = [{ day: '2026-10-01', equity: '330' }, { day: '2026-10-03', equity: '350' }]; const m = build(i, '2026-10-03');
  assert.deepEqual(m.daily.map(d => d.day), ['2026-10-03', '2026-10-02', '2026-10-01']); const [d3, d2, d1] = m.daily;
  assert.equal(d1.closeLabel, '330.00'); assert.equal(d1.pnlLabel, '+30.00'); assert.equal(d1.met, true); assert.equal(d2.input, false); assert.equal(d2.closeLabel, null); assert.equal(d2.pnlLabel, '0.00'); assert.equal(d3.today, true);
  const t = text(dashRenderHtml(m)); assert.match(t, /10-02 미입력/); assert.match(t, /장부상 실현손익/); assert.match(t, /10-03 오늘·진행 중/);
});
test('30일을 넘으면 최근 30일만 표시하고 안내한다', () => {
  const s = sample(), i = simple(); i.challenge.startDay = '2026-08-01'; i.challenge.rateSchedule = [{ from: '2026-08-01', rate: '0.05' }];
  const m = build(i, '2026-10-14'); assert.equal(m.daily.length, 30); assert.equal(m.dailyTotal, 75); assert.match(text(dashRenderHtml(m)), /최근 30일/); void s;
});
test('장부와 평가액 차이는 숨기지 않고 표시만 한다(손익에 자동 반영 안 함)', () => {
  const s = sample(); s.inputs.equityInputs = s.inputs.equityInputs.map(e => (e.day === s.throughDay ? { ...e, equity: String(Number(e.equity) + 40) } : e));
  const m = dashBuildModel({ inputs: s.inputs, throughDay: s.throughDay, now: NOW }); assert.equal(m.today.needsReview, true); assert.match(text(dashRenderHtml(m)), /장부와 입력 평가액의 차이/);
});
test('설정 전: 샘플로 대체하지 않는다(없는 잔액 금지). 시작일 전은 안내만', () => {
  const x = makeTg(); const m = dashBuildFromStore(x.mem.env, { now: NOW }); assert.equal(m.noChallenge, true); assert.equal(m.sample, false);
  const t = text(dashRenderHtml(m)); assert.match(t, /설정되지 않았습니다/); assert.ok(!/샘플|\d+\.\d\d/.test(t));
  assert.equal(build(simple(), '2026-09-30').empty, true); assert.match(text(dashRenderHtml(build(simple(), '2026-09-30'))), /시작 전/);
});
test('샘플 화면에는 샘플 배너, 실제 모델에는 없다', () => {
  assert.match(dashRenderHtml(dashSampleModel(NOW)), /샘플 데이터/); const i = simple(); i.equityInputs = [{ day: '2026-10-01', equity: '300' }]; assert.ok(!/샘플/.test(dashRenderHtml(build(i, '2026-10-01'))));
});
test('메뉴: 홈·매매일지 단 두 개, 고급 메뉴는 별도 접근하며 링크 안전성 유지', () => {
  const nav = dashNav('dash', 'https://script.google.com/macros/s/X/exec'); for (const p of ['dash', 'journal']) assert.ok(nav.includes(`p=${p}`)); for (const p of ['signals', 'stats', 'assets', 'strat']) assert.ok(!nav.includes(`p=${p}`)); assert.match(nav, /aria-current="page">홈/); assert.match(nav, /target="_top"/);
  assert.ok(!/href=/.test(dashNav('dash', 'javascript:alert(1)'))); assert.ok(!/href=/.test(dashNav('dash', undefined))); assert.ok(!dashNav('dash', 'https://x.test/exec"onclick="x').includes('onclick="x'));
  const err = dashRenderError(); assert.match(err, /불러오지 못했습니다/); assert.ok(!/stack|Error|at /.test(text(err)));
  assert.equal(dashEsc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});
test('결정적: 같은 입력이면 같은 HTML, 외부 리소스·인라인 이벤트 없음', () => {
  const a = dashRenderHtml(dashSampleModel(NOW), { appUrl: 'https://x.test/exec' }), b = dashRenderHtml(dashSampleModel(NOW), { appUrl: 'https://x.test/exec' }); assert.equal(a, b);
  assert.ok(!/ on\w+=|src=|https?:\/\/(?!x\.test)[^"' ]*\.(js|css|woff)/i.test(a));
});

test('오늘의 실제 평가액 없이는 목표까지 남은 금액과 달성률을 계산하지 않는다', () => {
  const i = simple(); i.equityInputs = [{day:'2026-10-01',equity:'800'}];
  const m = build(i,'2026-10-02');
  assert.equal(m.today.remainingLabel,null); assert.equal(m.today.progress,null);
  assert.match(dashRenderHtml(m), /오늘 평가액 없음/);
});
test('최근 거래는 실체결 장부 기준이며 시뮬레이션 기록을 표시하지 않는다', () => {
  const noFills = build(simple(),'2026-10-03');
  assert.deepEqual(noFills.recentTrades, []);
  const withFill = simple(); const at = dayStartMs('2026-10-01')+3600000;
  withFill.fills=[{origin:'real',fillId:'a',sid:'realS1',kind:'entry',dir:'LONG',at,price:'100',qty:'1',margin:'10',leverage:'10',fee:{state:'entered',amount:'0.1'},funding:{state:'entered',amount:'0'}}];
  const m=build(withFill,'2026-10-03');
  assert.equal(m.recentTrades.length,1);assert.equal(m.recentTrades[0].sid,'realS1');
  assert.match(dashRenderHtml(m), /realS1/);
});
void ledgerBuildDaily; void decFormat; void addDays; void StoreError;
