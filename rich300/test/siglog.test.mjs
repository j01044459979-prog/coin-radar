// 추천 기록·일지 검색·신호 레이더(S) 전략 통계 테스트. 합성 데이터만 사용한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTg } from './helpers/faketg.mjs';
import { storeCreate, storeSetupChallenge } from '../lib/store.mjs';
import { siglogBuild, siglogRenderHtml, siglogRenderError } from '../lib/siglog.mjs';
import { journalBuild } from '../lib/journal.mjs';
import { journalRenderHtml } from '../lib/journalview.mjs';
import { kstDayOf, dayStartMs, addDays } from '../lib/time.mjs';

const H = 3600000;
function world() {
  const x = makeTg(); const T = x.clock.t, day = kstDayOf(T), d1 = addDays(day, -1);
  storeSetupChallenge(x.mem.env, { startEquity: '300', startDay: addDays(day, -3), rate: '0.05' }, { actor: 't' });
  const sig = (sid, sym, dir, strategy, score, at, extra = {}) => storeCreate(x.mem.env, 'signal', { sid, strategy, symbolId: `${sym}USDT`, dir, signalAt: at, entry: '100', stop: '98', tp1: '104', ...(score === null ? {} : { score }), ...extra }, { actor: 't' });
  const rsp = (sid, choice, at) => storeCreate(x.mem.env, 'response', { sid, choice, at }, { actor: 't' });
  const fill = (f) => storeCreate(x.mem.env, 'fill', { origin: 'real', fee: { state: 'entered', amount: '0.1' }, funding: { state: 'entered', amount: '0' }, ...f }, { actor: 't' });
  const t0 = dayStartMs(d1) + 3 * H;
  sig('SG-BTC-L-1', 'BTC', 'LONG', 'S', 72, t0); rsp('SG-BTC-L-1', 'entered', t0 + 60000);
  fill({ fillId: 'a-in', sid: 'SG-BTC-L-1', kind: 'entry', dir: 'LONG', at: t0 + 120000, price: '101', qty: '2', margin: '20', leverage: '10', plannedStop: '98' });
  fill({ fillId: 'a-out', sid: 'SG-BTC-L-1', kind: 'close', dir: 'LONG', at: t0 + H, price: '104', qty: '2' });
  sig('SG-ETH-S-2', 'ETH', 'SHORT', 'S', 65, t0 + 2 * H, { tp2: '90' }); rsp('SG-ETH-S-2', 'watched', t0 + 2 * H + 1000);
  sig('SG-SOL-L-3', 'SOL', 'LONG', 'S', null, t0 + 4 * H); rsp('SG-SOL-L-3', 'missed', t0 + 4 * H + 1000);
  sig('SG-XRP-L-4', 'XRP', 'LONG', 'S', 50, t0 + 5 * H);                                           // 미응답
  sig('SG-DOGE-L-5', 'DOGE', 'LONG', 'S', 80, t0 + 6 * H); rsp('SG-DOGE-L-5', 'entered', t0 + 6 * H + 1000);   // 진입 눌렀지만 체결 없음
  return { x, env: { ...x.env, now: () => T }, T, day, d1 };
}
const text = html => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ');

test('추천 기록: 신호별 응답(진입/관망/놓침/미응답)·전략·점수·추천가, 실제 매매 여부와 결과를 분리해 보여 준다', () => {
  const { env } = world(), m = siglogBuild(env, {});
  assert.equal(m.total, 5); assert.deepEqual(m.counts, { entered: 2, watched: 1, missed: 1, none: 1 }); assert.equal(m.tradedCount, 1); assert.equal(m.enteredNoFill, 1);
  const by = Object.fromEntries(m.rows.map(r => [r.sid, r])); assert.equal(by['SG-BTC-L-1'].choiceLabel, '진입했어'); assert.equal(by['SG-BTC-L-1'].traded, true); assert.equal(by['SG-BTC-L-1'].status, 'closed'); assert.equal(by['SG-BTC-L-1'].avgEntry, '101');
  assert.equal(by['SG-BTC-L-1'].entry, '100');                                                  // 추천가와 실제 체결가는 따로
  assert.equal(by['SG-BTC-L-1'].netLabel, '+5.80'); assert.equal(by['SG-BTC-L-1'].win, true);   // (104−101)×2 − 수수료 0.1×2
  assert.equal(by['SG-ETH-S-2'].traded, false); assert.equal(by['SG-ETH-S-2'].netLabel, null); assert.equal(by['SG-XRP-L-4'].choiceLabel, '미응답'); assert.equal(by['SG-SOL-L-3'].score, null);
  assert.deepEqual(m.rows.map(r => r.sid), ['SG-DOGE-L-5', 'SG-XRP-L-4', 'SG-SOL-L-3', 'SG-ETH-S-2', 'SG-BTC-L-1']);                                  // 최신 먼저
});
test('추천 기록 필터와 화면: 응답별 보기, 실제 매매 없음 문구, 체결 없는 진입 경고, 메뉴', () => {
  const { env } = world(); const m = siglogBuild(env, { filter: 'entered' }); assert.deepEqual(m.rows.map(r => r.sid).sort(), ['SG-BTC-L-1', 'SG-DOGE-L-5']); assert.equal(siglogBuild(env, { filter: '<script>' }).filter, 'all');
  const t = text(siglogRenderHtml(siglogBuild(env, {}), { appUrl: 'https://script.google.com/macros/s/X/exec' }));
  assert.match(t, /추천 신호 5 건/); assert.match(t, /실제 매매 없음\(손익에 포함되지 않음\)/); assert.match(t, /체결 기록이 아직 없습니다/); assert.match(t, /실제 진입가 101/); assert.match(t, /72점/); assert.match(t, /전체 5 진입 2 관망 1 놓침 1 미응답 1/);
  const html = siglogRenderHtml(siglogBuild(env, {}), { appUrl: 'https://script.google.com/macros/s/X/exec' }); assert.match(html, /p=signals&amp;r=entered/); assert.match(html, /aria-current="page">추천/); assert.ok(!/<script/.test(html));
  assert.match(siglogRenderError(), /불러오지 못했습니다/);
});
test('추천 기록은 읽기 전용이고 모의 손익을 만들지 않는다(체결 없으면 손익 없음)', () => {
  const { env, x } = world(); const before = x.mem.sheets.get('Audit').length; siglogBuild(env, {}); siglogBuild(env, { filter: 'none' }); assert.equal(x.mem.sheets.get('Audit').length, before);
  assert.equal(siglogBuild(env, {}).rows.filter(r => !r.traded && r.netLabel !== null).length, 0);
});
test('일지 검색: 날짜(체결일)·코인으로 거르고, 검색 결과 수와 전체 보기 링크를 보여 준다', () => {
  const { env, d1, day } = world(), all = journalBuild(env, {}); assert.equal(all.tradesTotal, 1); assert.equal(all.searched, false);
  assert.equal(journalBuild(env, { day: d1 }).tradesTotal, 1); assert.equal(journalBuild(env, { day }).tradesTotal, 0); assert.equal(journalBuild(env, { q: 'btc' }).tradesTotal, 1); assert.equal(journalBuild(env, { q: 'eth' }).tradesTotal, 0);
  assert.equal(journalBuild(env, { day: 'x', q: '$$$' }).searched, false);                          // 잘못된 검색어는 무시(전체)
  const m = journalBuild(env, { day: d1 }), html = journalRenderHtml(m, { appUrl: 'https://script.google.com/macros/s/X/exec', tab: 'journal', query: { day: d1, q: null } });
  assert.match(html, /name="day"/); assert.match(html, new RegExp(`value="${d1}"`)); assert.match(html, /검색 결과 1건/); assert.match(html, /전체 보기/); assert.ok(!/평가액 입력/.test(html));
});
test('전략별 성적: 신호 레이더(S) 신호만 있으면 S 한 칸, A/B 신호가 있으면 A·B(+S는 있을 때만), 승률·손익비·PF·거래 수 표시', () => {
  const { env } = world(); const m = journalBuild(env, {}), keys = m.analytics.strategies.map(s => s.key); assert.deepEqual(keys, ['S']);
  const s = m.analytics.strategies[0]; assert.equal(s.name, 'COIN RADAR 신호 · 눌림 진입 후보'); assert.equal(s.n, 1); assert.equal(s.wins, 1); assert.equal(s.winRate, '100%');
  const html = journalRenderHtml(m, { appUrl: 'https://script.google.com/macros/s/X/exec', tab: 'stats' }); for (const w of ['승률', '평균 이익 / 손실', '손익비', 'Profit factor', '순손익', '청산 거래', 'COIN RADAR 신호']) assert.ok(html.includes(w), w); assert.ok(!/A전략|B전략/.test(html));
  const w2 = world(); storeCreate(w2.x.mem.env, 'signal', { sid: 'A-1', strategy: 'A', symbolId: 'BTCUSDT', dir: 'LONG', signalAt: w2.T - 5000, entry: '1', stop: '0.9', tp1: '1.2' }, { actor: 't' });
  assert.deepEqual(journalBuild(w2.env, {}).analytics.strategies.map(s => s.key), ['A', 'B', 'S']);
});
test('자산 탭: 평가액 입력·입출금·마감 기록이 있고 통계·일지는 없다', () => {
  const { env } = world(), html = journalRenderHtml(journalBuild(env, {}), { appUrl: 'https://script.google.com/macros/s/X/exec', tab: 'assets' });
  for (const w of ['실제 계좌 평가액 입력', '입출금 기록', '일 마감 (매일 00:00 KST)']) assert.ok(html.includes(w), w); assert.ok(!html.includes('Profit factor') && !html.includes('10초 복기 분석')); assert.match(html, /aria-current="page">자산/);
});
