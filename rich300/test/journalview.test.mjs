import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { memEnv } from './helpers/memenv.mjs';
import { storeInit, storeCreate, storeSetupChallenge } from '../lib/store.mjs';
import { journalBuild, journalReviseFill, journalAddCashflow } from '../lib/journal.mjs';
import { journalRenderHtml, journalRenderError, jvEsc } from '../lib/journalview.mjs';
import { closeRun } from '../lib/close.mjs';
import { dayStartMs } from '../lib/time.mjs';

const D1 = '2026-10-24', D2 = '2026-10-25', H = 3600000, A = { actor: 't' };
function setup({ evilSid = false } = {}) {
  const m = memEnv(); storeInit(m.env); storeSetupChallenge(m.env, { startEquity: '300', startDay: D1, rate: '0.05' }, A);
  const clock = { t: dayStartMs(D2) + 3 * H }, env = { now: () => clock.t, storeEnv: () => m.env, sendEnabled: () => false };
  const sid = evilSid ? '<img src=x onerror=alert(1)>' : 'A-1', at = dayStartMs(D1) + 10 * H;
  if (!evilSid) { storeCreate(m.env, 'signal', { sid, strategy: 'A', symbolId: 'BTCUSDT', dir: 'LONG', signalAt: at - H, entry: '100', stop: '98', tp1: '103' }, A); storeCreate(m.env, 'response', { sid, choice: 'entered', at: at - H }, A); }
  for (const f of [{ fillId: 'in', kind: 'entry', at, price: '100', qty: '3' }, { fillId: 'out', kind: 'close', at: at + H, price: '103', qty: '3' }]) storeCreate(m.env, 'fill', { origin: 'real', sid, dir: 'LONG', fee: { state: 'entered', amount: '0.1' }, funding: { state: 'missing' }, ...f }, A);
  storeCreate(m.env, 'review', { sid, plan: 'plan_ok', mind: 'calm', memo: '<b>메모</b>', savedAt: at + 5 * H }, A);
  closeRun(env); return { m, env, clock };
}

test('렌더링: 일 마감·통계(전체/A/B/LONG/SHORT)·복기 분석·입출금·일지·경고가 모두 나오고 구조·접근성이 갖춰진다', () => {
  const x = setup(); journalReviseFill(x.env, 'out', { price: '104' }, { reason: '재확인' }); const html = journalRenderHtml(journalBuild(x.env), { appUrl: 'https://example.com/exec' });
  for (const w of ['일 마감 (매일 00:00 KST)', '실제 계좌 평가액 입력', '통계', 'A전략 · 추세돌파형', 'B전략 · 눌림목 재진입형', '10초 복기 분석', '입출금 기록', '매매일지', '데이터 확인', '손익비', 'Profit factor', '기대값(건당)', '최대 낙폭(거래 기준)', '95% 구간', '표본 부족', '평가액 미입력', '마감됨', '수정 1회', 'price: 103 → 104', '재확인', '새로고침']) assert.ok(html.includes(w.replace('price: 103 → 104', 'price: 103 → 104')), w);
  assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1">/); assert.match(html, /lang="ko"/); assert.match(html, /prefers-color-scheme:dark/); assert.match(html, /<form id="eqForm">/); assert.match(html, /class="fillForm" data-fill="out"/); assert.match(html, /data-orig="104"/);
  assert.match(html, /<option value="2026-10-24" selected>2026-10-24 \(미입력\)<\/option>/);                         // 평가액이 없는 마감일이 기본 선택
  assert.match(html, /href="https:\/\/example\.com\/exec\?p=journal"/); assert.ok(!/<script[^>]+src=|https?:\/\/(?!example\.com)|eval\(|innerHTML|document\.write/.test(html));
  const js = /<script>([\s\S]*?)<\/script><\/body>/.exec(html)[1]; assert.doesNotThrow(() => new vm.Script(js)); assert.ok(html.length < 80000);
  assert.ok(!/자동\s*주문\s*(실행|버튼)|placeOrder|createOrder/.test(html));
});
test('렌더링: 모든 동적 값 이스케이프(신호 ID·복기 메모·수정 사유·입출금 메모), appUrl은 https만, 챌린지 없음·오류 화면', () => {
  const x = setup({ evilSid: true }); storeCreate(x.m.env, 'cashflow', { cfId: 'cf-1', at: x.clock.t - H, amount: '10', note: '<script>alert(1)</script>' }, A);
  journalReviseFill(x.env, 'out', { price: '104' }, { reason: '"><svg onload=alert(1)>' });
  const html = journalRenderHtml(journalBuild(x.env), { appUrl: 'javascript:alert(1)' });
  assert.ok(!html.includes('<img src=x') && !html.includes('<svg onload') && !html.includes('<script>alert') && !html.includes('<b>메모</b>')); assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;') && html.includes('&lt;b&gt;메모&lt;/b&gt;') && html.includes('&quot;&gt;&lt;svg onload=alert(1)&gt;'));
  assert.ok(!html.includes('javascript:') && !html.includes('새로고침'));
  assert.equal(jvEsc(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  const none = memEnv(); storeInit(none.env); assert.match(journalRenderHtml(journalBuild({ now: () => 1, storeEnv: () => none.env })), /챌린지 설정이 없습니다/); assert.match(journalRenderError(), /불러오지 못했습니다/); assert.ok(!/stack|Error:/.test(journalRenderError()));
});
test('렌더링: 마감 경고·알림 상태·입출금 누락 의심이 화면에 보이고, 입출금 취소 폼은 사유 필수 입력을 제공', () => {
  const x = setup(); journalAddCashflow(x.env, { cfId: 'abcdef12', amount: '-20', note: '출금', at: dayStartMs(D1) + H }); storeCreate(x.m.env, 'equity', { day: D2, equity: '500' }, A);
  const html = journalRenderHtml(journalBuild(x.env)); assert.match(html, /입출금 누락 의심/); assert.match(html, /장부와 입력 평가액의 차이가 큰 날/); assert.match(html, /알림 꺼짐/); assert.match(html, /class="cfVoid" data-cf="cf-abcdef12"/); assert.match(html, /placeholder="취소 사유"/);
});
