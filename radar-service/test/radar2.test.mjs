import test from 'node:test';
import assert from 'node:assert/strict';
import { createOkxCollector } from '../okx.mjs';
import { fakeOkx, now } from './fake-okx.mjs';
import { pack, reportMessages, signalText } from '../report.mjs';
import { pickNear, scoreRow, WEIGHTS } from '../scoring.mjs';
import { planOf, riskOf } from '../plan.mjs';
import { enrich, marketState } from '../enrich.mjs';
import { trendOf, TF_MS } from '../indicators.mjs';
import { needsRefresh, refreshNews, relevantNews, newsSources } from '../news.mjs';
import { cycle } from '../service.mjs';
import { alertReport } from '../compact.mjs';
import { applyBtcFilter } from '../analysis.mjs';

const collect = (opts = {}) => createOkxCollector(fakeOkx(opts), { gapMs: 0 })(now);
const base = (o = {}) => ({ symbol: 'ETHUSDT', direction: 'WAIT', strong: false, trend: '상승', high: 101, low: 99, swingHigh: 100.6, swingLow: 99.4,
  price: 100.5, priceAt: now - 1000, collectedAt: now, atr: 0.5, atrPct: 0.5, volume: 1.5, oi15: 0.6, funding: 0.01, change15: 0.2, source: 'OKX', ...o });
const up = { dir: 'UP', arrow: '↑', label: '상승', basis: 'x' }, down = { dir: 'DOWN', arrow: '↓', label: '하락', basis: 'x' }, flat = { dir: 'FLAT', arrow: '→', label: '횡보', basis: 'x' };
const btcRow = { symbol: 'BTCUSDT', change15: 0.3, direction: 'WAIT', strong: false };

test('strong 0개여도 진입 근접 후보가 출력되고 강한 신호처럼 표현되지 않는다', async () => {
  const { rows, failures } = await collect({ breakout: false });
  assert.equal(rows.filter(r => r.strong).length, 0);
  const text = reportMessages(rows, failures, now).join('\n');
  assert.match(text, /현재 확정 조건 없음/); assert.match(text, /\[진입 근접 TOP 3\]\n※ 강한 신호가 아니며/); assert.match(text, /1\) \w+USDT · 롱 관찰 · 점수 [\d.]+\/100/);
  assert.doesNotMatch(text, /즉시 진입 조건 충족/); assert.match(text, /조건부 관찰/);
  assert.match(text, /부족: /); assert.match(text, /조건부 진입 참고가/);
});
test('근접 후보는 실제 후보만 출력(1~2개), 3개로 채우지 않는다', () => {
  const mk = (symbol, score) => ({ ...base({ symbol }), candidate: { dir: 'LONG', score, blockers: [], dist: { atrUnits: 0.5, pct: 0.5, level: 101, broken: false } } });
  assert.equal(pickNear([mk('A', 70)]).length, 1);
  assert.deepEqual(pickNear([mk('A', 70), mk('B', 55), mk('C', 20)]).map(r => r.symbol), ['A', 'B']);
  assert.equal(pickNear([mk('A', 10)]).length, 0);
  assert.equal(pickNear([{ ...mk('A', 90), strong: true }]).length, 0);
});
test('롱·숏 손절·목표 방향과 손익비/퍼센트 계산', () => {
  const l = planOf(base(), 'LONG', null);
  assert.ok(l.stop < l.entry && l.entry < l.tp1 && l.tp1 < l.tp2);
  const r = l.entry - l.stop;
  assert.ok(Math.abs(l.tp1 - (l.entry + r)) < 1e-9 && Math.abs(l.tp2 - (l.entry + 2 * r)) < 1e-9);
  assert.ok(Math.abs(l.stopPct - r / l.entry * 100) < 1e-9); assert.ok(Math.abs(l.tp2Pct - 2 * r / l.entry * 100) < 1e-9);
  assert.equal(l.entry, 101); assert.equal(l.conditional, true); assert.equal(l.entryNote, '조건부 진입 참고가'); assert.equal(l.liquidation, '확인 불가');
  const s = planOf(base({ trend: '하락', price: 99.5 }), 'SHORT', null);
  assert.ok(s.stop > s.entry && s.entry > s.tp1 && s.tp1 > s.tp2); assert.equal(s.entry, 99);
  const broken = planOf(base({ direction: 'LONG', strong: true, price: 101.3 }), 'LONG', null);
  assert.equal(broken.entry, 101.3); assert.equal(broken.conditional, false);
});
test('유효한 손절·목표를 계산할 수 없으면 숫자를 만들지 않는다', () => {
  assert.equal(planOf(base({ atr: 0 }), 'LONG', null), null);
  assert.equal(planOf(base({ high: NaN }), 'LONG', null), null);
  assert.equal(planOf(base({ atr: 50, price: 100 }), 'LONG', null), null); // 손절 거리 8% 초과
  const text = reportMessages([{ ...base({ symbol: 'BTCUSDT' }), candidate: { dir: 'LONG', score: 50, parts: {}, missing: [], blockers: [], plan: null, met: [], unmet: [], risk: { level: '보통', factors: [] }, dist: { level: 101, pct: 1, atrUnits: 1, broken: false } }, strong: true, mtf: null }], [], now).join('\n');
  assert.match(text, /계산 불가/);
});
test('1H 구조가 TP1보다 가까우면 표시하되 목표를 확정가로 부르지 않는다', () => {
  const p = planOf(base(), 'LONG', { '1H': { resistance: [101.3, 110] } });
  assert.equal(p.structureAhead, 101.3); assert.equal(p.tp1BeyondStructure, true);
  assert.match(reportMessages([{ ...base({ symbol: 'BTCUSDT', strong: true, direction: 'LONG' }), candidate: { dir: 'LONG', score: 60, parts: { mtf: { score: 5, max: 20, note: '' } }, missing: [], blockers: [], plan: p, met: [], unmet: [], risk: { level: '보통', factors: [] }, dist: { level: 101, pct: 1, atrUnits: 1, broken: false } }, mtf: null }], [], now).join('\n'), /확정가가 아님/);
});
test('미확정 상위 시간대 캔들은 추세·마지막 확정 시각에 쓰이지 않는다', async () => {
  const { rows } = await collect({ mtf: { '1H': 'up' } });
  const btc = rows.find(r => r.symbol === 'BTCUSDT');
  for (const tf of ['15m', '1H', '4H']) {
    const cur = now - (now % TF_MS[tf]);
    assert.ok(btc.mtf[tf].lastClosedAt < cur, `${tf} 미확정 봉 사용`);
    assert.equal(btc.mtf[tf].dir, 'UP');
  }
});
test('상승·하락·횡보·누락 추세 판정', () => {
  const mk = kind => Array.from({ length: 60 }, (_, i) => { const c = 100 + (kind === 'up' ? i * .4 : kind === 'down' ? -i * .4 : 0) + Math.round(2 * Math.sin(2 * Math.PI * i / 8) * 1e4) / 1e4; return { t: i * 900000, o: c, h: c + .5, l: c - .5, c, end: i * 900000 + 899999 }; });
  assert.equal(trendOf(mk('up'), '15m').dir, 'UP'); assert.equal(trendOf(mk('down'), '15m').dir, 'DOWN'); assert.equal(trendOf(mk('flat'), '15m').dir, 'FLAT');
  const gap = mk('up'); gap.splice(20, 1); assert.equal(trendOf(gap, '15m').dir, 'UNKNOWN');
  assert.equal(trendOf(mk('up').slice(0, 10), '15m').dir, 'UNKNOWN');
});
test('시간대 충돌 시 상위 시간대 역행 주의, 시간대별 화살표 표기', async () => {
  const { rows, failures } = await collect({ breakout: false, mtf: { '15m': 'up', '1H': 'up', '4H': 'down' } });
  const eth = rows.find(r => r.symbol === 'ETHUSDT');
  assert.equal(eth.candidate.mtfConflict, true);
  const text = reportMessages(rows, failures, now).join('\n');
  assert.match(text, /15분 ↑ \/ 1시간 ↑ \/ 4시간 ↓/); assert.match(text, /상위 시간대 역행 주의/); assert.match(text, /4시간 추세와 역행/);
  assert.equal(marketState({ '1H': up, '4H': up }), '상승'); assert.equal(marketState({ '1H': up, '4H': down }), '혼조'); assert.equal(marketState(null), '판단불가');
});
test('상위 시간대 수집 실패는 해당 시간대만 미확인이고 5분 레이더는 계속 동작', async () => {
  const { rows } = await collect({ mtf: { '1H': 'fail' } });
  assert.equal(rows.length, 3);
  const btc = rows.find(r => r.symbol === 'BTCUSDT');
  assert.equal(btc.mtf['1H'].dir, 'UNKNOWN'); assert.equal(btc.mtf['4H'].dir, 'UP');
  assert.ok(btc.candidate.missing.includes('1H 추세')); assert.ok(btc.candidate.parts.mtf.score <= 13);
  assert.match(reportMessages(rows, [], now).join('\n'), /1시간 \?/);
});
test('상위 시간대 429는 추가 호출을 멈추고 5분 분석은 유지', async () => {
  let mtfCalls = 0;
  const f = fakeOkx();
  const { rows } = await createOkxCollector(async url => { if (!url.includes('bar=5m') && url.includes('/market/candles')) { mtfCalls++; return new Response('', { status: 429 }); } return f(url); }, { gapMs: 0 })(now);
  assert.equal(mtfCalls, 1); assert.equal(rows.length, 3);
  assert.equal(rows[0].mtf['1H']?.dir ?? 'UNKNOWN', 'UNKNOWN');
});
test('점수는 0~100, 가중치 합 100, 결측에는 점수가 없다', () => {
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100);
  const full = scoreRow(base({ direction: 'LONG', volume: 3, oi15: 2, funding: 0, atrPct: .3, price: 101.1 }), 'LONG', { '15m': up, '1H': up, '4H': up }, btcRow);
  assert.ok(full.total <= 100 && full.total >= 95, String(full.total));
  const none = scoreRow(base({ volume: NaN, oi15: NaN, funding: NaN, atrPct: NaN, atr: 0, high: NaN }), 'LONG', null, null);
  assert.equal(none.total, 0); assert.ok(none.missing.length >= 4);
});
test('점수와 기존 strong 신호는 독립: 높은 점수여도 strong이 아니고 낮은 점수여도 strong은 유지', async () => {
  const { rows } = await collect({ breakout: false });
  assert.ok(rows.every(r => r.strong === false)); assert.ok(rows.some(r => r.candidate.score >= 60));
  const strongLow = enrich(applyBtcFilter([{ ...btcRow, price: 100, atr: 1, high: 101, low: 99, swingHigh: 101, swingLow: 99, trend: '상승', volume: 1, oi15: 0, funding: 0, atrPct: 1, priceAt: now, collectedAt: now },
    base({ direction: 'LONG', strong: true, volume: 2.1, oi15: 1.1 })]), {});
  assert.equal(strongLow[1].strong, true);
});
test('점수가 높아도 BTC 역행 등 필수 차단이 있으면 strong/근접 후보에서 제외', () => {
  const rows = enrich(applyBtcFilter([{ ...btcRow, change15: -0.9, price: 100, atr: 1, high: 101, low: 99, swingHigh: 101, swingLow: 99, trend: '하락', atrPct: 1, volume: 1, oi15: 0, funding: 0, priceAt: now, collectedAt: now },
    base({ direction: 'LONG', strong: true, volume: 3, oi15: 2, funding: 0, atrPct: .3, price: 101.1 })]), { ETHUSDT: { '15m': up, '1H': up, '4H': up } });
  const eth = rows[1];
  assert.equal(eth.strong, false); assert.ok(eth.candidate.score > 80); assert.deepEqual(eth.candidate.blockers, ['BTC 15분 0.5% 초과 역행']);
  assert.equal(pickNear(rows).length, 0);
  assert.doesNotMatch(reportMessages(rows, [], now).join('\n'), /1\) ETHUSDT/);
});
test('BTC 데이터가 없으면 후보를 차단한다', () => {
  const rows = enrich([base({ direction: 'LONG', strong: false })], { ETHUSDT: { '15m': up, '1H': up, '4H': up } });
  assert.deepEqual(rows[0].candidate.blockers, ['BTC 데이터 없음']); assert.equal(pickNear(rows).length, 0);
});
test('위험 수준: 역행·OI 급증·변동성·손절 거리를 표시하고 청산가는 확인 불가', () => {
  const row = base({ oi15: 4, atrPct: 3, funding: 0.06 });
  const plan = planOf(row, 'LONG', null);
  const r = riskOf(row, 'LONG', { '4H': down, '1H': down, '15m': up }, { ...plan, stopPct: 3.1 }, { change15: -0.3 });
  assert.equal(r.level, '높음');
  for (const w of ['4시간 추세와 역행', 'OI 급증', '높은 변동성', '손절까지 거리 3.1%', 'BTC 단기 방향과 충돌', '레버리지 사용 시 손실 확대 주의']) assert.ok(r.factors.some(x => x.includes(w)), w);
  assert.equal(plan.liquidation, '확인 불가');
});
test('보고서 문구: 안전 보장·승률 표현 없이 점수의 의미를 명시', async () => {
  const { rows, failures } = await collect();
  const text = reportMessages(rows, failures, now).join('\n');
  assert.match(text, /점수는 조건 충족도이며 승률이 아님/); assert.match(text, /보수형=상대적으로 보수적인 조건/);
  assert.doesNotMatch(text, /(승률|확률|수익률)\s*\d|수익 보장!|안전합니다/);
  assert.match(text, /RICH FUTURES RADAR/); assert.match(text, /\(Binance 아님\)/);
});
test('긴 보고서는 순서 있는 여러 메시지로 나뉘고 각 4000자 이하', () => {
  const out = pack(['a'.repeat(3000), 'b'.repeat(3000), 'c'.repeat(9000)]);
  assert.equal(out.length, 3); assert.ok(out.every(m => m.length <= 4000)); assert.match(out[0], /^\(1\/3\) /); assert.match(out[2], /일부 생략/);
  assert.equal(pack(['x']).length, 1); assert.doesNotMatch(pack(['x'])[0], /^\(/);
});
test('정기 보고 메시지는 모두 4000자 이하', async () => {
  const { rows, failures } = await collect({ breakout: false });
  const news = { status: 'ok', checkedAt: now, items: Array.from({ length: 30 }, (_, i) => ({ title: 'ETH ' + 'x'.repeat(130), url: 'https://e.test/' + i, publishedAt: now - i * 60000, label: 'CoinDesk', kind: '보도', symbols: ['ETH', 'BTC'], category: 'general' })) };
  assert.ok(reportMessages(rows, failures, now, { news }).every(m => m.length <= 4000));
});
// ── 뉴스 ──
const rss = items => `<?xml version="1.0"?><rss><channel>${items.map(i => `<item><title>${i.t}</title><link>${i.l}</link><pubDate>${new Date(i.at).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
const newsFetcher = (map, fail = []) => async url => {
  const key = Object.keys(map).find(k => url.includes(k));
  if (!key || fail.includes(key)) return new Response('', { status: 500 });
  return new Response(map[key], { status: 200, headers: { 'content-type': 'application/xml' } });
};
test('뉴스: 기존 intel 파서 재사용, 중복 제거, 게시 시각 없는 항목 제외, Binance 출처 제외', async () => {
  assert.ok(!newsSources().some(s => s.id === 'binance'));
  const state = {};
  const feed = rss([{ t: 'Ethereum ETH jumps on upgrade', l: 'https://c.test/a', at: now - 3600000 }, { t: 'Ethereum ETH jumps on upgrade', l: 'https://c.test/a?utm=1', at: now - 3600000 }, { t: 'Old BTC story', l: 'https://c.test/old', at: now - 5 * 86400000 }]);
  await refreshNews(state, now, { fetcher: newsFetcher({ 'coindesk.com': feed }) });
  assert.equal(state.news.status, 'ok');
  assert.equal(state.news.items.length, 1); assert.equal(state.news.items[0].kind, '보도'); assert.ok(state.news.items[0].symbols.includes('ETH'));
  assert.equal(state.news.health.coindesk.ok, true); assert.equal(state.news.health.cointelegraph.ok, false);
});
test('뉴스 없음 / 장애 / 오래된 뉴스를 원인으로 오인하지 않음', async () => {
  const { rows, failures } = await collect({ breakout: false });
  const none = reportMessages(rows, failures, now, { news: { status: 'ok', checkedAt: now, items: [] } }).join('\n');
  assert.match(none, /최근 확인된 주요 이슈 없음/);
  const down = reportMessages(rows, failures, now, { news: { status: 'unavailable' } }).join('\n');
  assert.match(down, /뉴스 데이터 미확보/); assert.match(down, /RICH FUTURES RADAR/);
  const stale = { status: 'ok', checkedAt: now, items: [{ title: 'ETH surges', url: 'https://x.test/1', publishedAt: now - 30 * 3600000, label: 'CoinDesk', kind: '보도', symbols: ['ETH'], category: 'general' }] };
  assert.deepEqual(relevantNews(stale, ['ETH'], now).bySymbol.ETH, []);
  assert.match(reportMessages(rows, failures, now, { news: stale }).join('\n'), /최근 확인된 주요 이슈 없음/);
});
test('뉴스는 관련 가능 이슈로만 표시하고 원인을 단정하지 않으며 출처·게시 시각·URL을 포함', async () => {
  const { rows, failures } = await collect({ breakout: false });
  const news = { status: 'ok', checkedAt: now, items: [{ title: 'ETH ETF decision nears', url: 'https://x.test/eth', publishedAt: now - 2 * 3600000, label: 'CoinDesk', kind: '보도', symbols: ['ETH'], category: 'regulation' }] };
  const text = reportMessages(rows, failures, now, { news }).join('\n');
  assert.match(text, /ETH 관련 가능 이슈/); assert.match(text, /\[보도\] ETH ETF decision nears/); assert.match(text, /https:\/\/x\.test\/eth/); assert.match(text, /KST/);
  assert.match(text, /원인으로 단정할 수 없는/); assert.doesNotMatch(text, /때문에 (올|상승|하락)/);
});
test('뉴스 전체 실패는 이전 수집분을 stale로 유지하고 갱신 주기를 지킨다', async () => {
  const state = {};
  await refreshNews(state, now, { fetcher: newsFetcher({ 'coindesk.com': rss([{ t: 'BTC news', l: 'https://c.test/b', at: now - 600000 }]) }) });
  assert.equal(needsRefresh(state, now + 60000), false); assert.equal(needsRefresh(state, now + 56 * 60000), true);
  await refreshNews(state, now + 3600000, { fetcher: newsFetcher({}) });
  assert.equal(state.news.status, 'stale'); assert.equal(state.news.items.length, 1);
  assert.equal(needsRefresh(state, now + 3600000 + 60000), false); assert.equal(needsRefresh(state, now + 3600000 + 16 * 60000), true);
  const fresh = {}; await refreshNews(fresh, now, { fetcher: newsFetcher({}) });
  assert.equal(fresh.news.status, 'unavailable');
});
// ── 실행/알림 호환 ──
const strongRow = async () => (await collect()).rows.find(r => r.symbol === 'BTCUSDT');
test('뉴스 수집 실패·시간 초과가 정기 보고를 막지 않는다', async () => {
  const state = {}, sent = [];
  const row = await strongRow();
  await cycle({ now, state, collect: async () => ({ rows: [row], failures: [] }), send: async t => sent.push(t), save: async () => {}, news: async () => { throw new Error('boom'); } });
  assert.ok(sent.length >= 1); assert.match(sent[0], /RICH FUTURES RADAR/); assert.equal(state.newsError, 'boom');
});
test('캐시 복원: 같은 시간대 재실행은 재전송 없음, 캐시 유실 시 보고 1회만(긴급 중복 없음)', async () => {
  const row = await strongRow(); const sent = []; let saved;
  const opts = { collect: async () => ({ rows: [row], failures: [] }), send: async t => sent.push(t), save: async s => { saved = JSON.stringify(s); } };
  await cycle({ ...opts, now, state: {} });
  const n1 = sent.length;
  await cycle({ ...opts, now: now + 300000, state: JSON.parse(saved) });          // 캐시 복원
  assert.equal(sent.length, n1);
  const lost = []; await cycle({ ...opts, send: async t => lost.push(t), now: now + 600000, state: {} }); // 캐시 유실
  assert.equal(lost.length, n1); assert.ok(lost.every(m => !m.startsWith('🚨')));
});
test('강한 신규 신호 알림은 짧은 HTML 요약이며 점수·시나리오·주의를 포함', async () => {
  const row = await strongRow();
  const t = alertReport(row, now).plain;
  assert.match(t, /^🚨 신규 조건 포착\nBTCUSDT · 롱 관찰 \(\d+점\)/); assert.match(t, /진입 참고 [\d.]+\n손절 [\d.]+\nTP1 [\d.]+ · TP2 [\d.]+/); assert.match(t, /조건부 참고값 · 매매 지시 아님/);
  assert.ok(t.length < 400, `길이 ${t.length}`);
  const state = { reportHour: Math.floor(now / 3600000) }, sent = [];
  await cycle({ now, state, collect: async () => ({ rows: [row], failures: [] }), send: async m => sent.push(m), save: async () => {} });
  assert.equal(sent.length, 1); assert.match(sent[0], /^<b>🚨 신규 조건 포착<\/b>/);
  await cycle({ now: now + 300000, state, collect: async () => ({ rows: [row], failures: [] }), send: async m => sent.push(m), save: async () => {} });
  assert.equal(sent.length, 1);
});
test('근접 후보는 긴급 알림을 보내지 않는다(정기 보고에만 포함)', async () => {
  const { rows } = await collect({ breakout: false });
  const state = { reportHour: Math.floor(now / 3600000) }, sent = [];
  await cycle({ now, state, collect: async () => ({ rows, failures: [] }), send: async m => sent.push(m), save: async () => {} });
  assert.equal(sent.length, 0);
});
