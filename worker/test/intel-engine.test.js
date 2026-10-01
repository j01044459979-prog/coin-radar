// Phase 6A: 수집 엔진 · D1 저장 · 중복 방지 · 출처 실패 격리 · 시장 반응 연결 · API · Cron 통합 테스트
// 모든 외부 응답은 mock 입니다. 실제 Binance/Upbit/뉴스 사이트 응답을 검증한 테스트가 아닙니다.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { runIntelligence, isDue, enrichItem, selectSources } from '../src/intel/engine.js';
import { cronKind, CRONS, MONITOR_CRON, INTEL_CRON } from '../src/cron.js';
import { resetCronThrottleForTests, diagnostics } from '../src/intel/diag.js';
import { markAttempts, loadHealth, INCOMPLETE } from '../src/intel/store.js';
import { readFileSync } from 'node:fs';
import { tgEmptyPage } from './fixtures/social-fixtures.js';
import { resetIntelSchemaFlagForTests, pruneIntel } from '../src/intel/store.js';
import { resetSchemaFlagForTests } from '../src/store.js';
import { memory } from '../src/monitor.js';
import { FakeD1, MIN } from './helpers.js';
import { SOURCES, healthView } from '../src/intel/sources.js';
import { parseQuery, handleIntelligence } from '../src/intel/api.js';

const NOW = Date.UTC(2026, 8, 29, 3, 10, 30); // 분 = 10 (정각 정리 작업이 돌지 않는 시각)
const iso = (t) => new Date(t).toISOString().slice(0, 19);
const rfc = (t) => new Date(t).toUTCString();
const realFetch = globalThis.fetch;
beforeEach(() => {
  resetIntelSchemaFlagForTests();
  resetSchemaFlagForTests();
  resetCronThrottleForTests();
  memory.lastRun = null;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const markets = [
  { market: 'KRW-BTC', korean_name: '비트코인', english_name: 'Bitcoin' },
  { market: 'KRW-SOL', korean_name: '솔라나', english_name: 'Solana' },
  { market: 'BTC-ETH', korean_name: '이더리움', english_name: 'Ethereum' },
];
const rss = (items) => `<?xml version="1.0"?><rss version="2.0"><channel>${items.map((i) => `<item><title>${i.title}</title><link>${i.link}</link>${i.t ? `<pubDate>${rfc(i.t)}</pubDate>` : ''}<description>${i.desc || ''}</description></item>`).join('')}</channel></rss>`;
const upbitNotices = (list) => ({ success: true, data: { notices: list.map((n) => ({ id: n.id, title: n.title, category: '거래', listed_at: new Date(n.t).toISOString().replace('Z', '+00:00'), first_listed_at: new Date(n.t).toISOString().replace('Z', '+00:00') })) } });
// 1분봉: SOL 은 게시(pub) 시각부터 가격이 올라 +3%
function candleRows(market, now, pub) {
  const m0 = Math.floor(now / MIN) * MIN;
  return Array.from({ length: 100 }, (_, i) => {
    const t = m0 - i * MIN;
    const p = market === 'KRW-SOL' ? (t <= pub ? 100 : 103) : 100;
    return { candle_date_time_utc: iso(t), opening_price: p, high_price: p, low_price: p, trade_price: p, candle_acc_trade_price: 1e8, candle_acc_trade_volume: 1 };
  });
}

// spec: { binance, upbitNotice, blockmedia, coindesk, cointelegraph } 값이 Response/객체/Error
function makeFetch(spec = {}, log = []) {
  const now = spec.now || NOW;
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    log.push(url.hostname + url.pathname);
    const pick = (v) => {
      if (v instanceof Error) throw v;
      if (v instanceof Response) return v;
      if (v === 'hang') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
      return typeof v === 'string' ? new Response(v, { status: 200 }) : Response.json(v);
    };
    const h = url.hostname;
    if (h === 'api.upbit.com' && url.pathname === '/v1/market/all') return Response.json(spec.markets ?? markets);
    if (h === 'api.upbit.com' && url.pathname.startsWith('/v1/candles/minutes/1')) return Response.json(candleRows(url.searchParams.get('market'), now, spec.pub || now - 20 * MIN));
    if (h === 'api-manager.upbit.com') return pick(spec.upbitNotice ?? upbitNotices([]));
    if (h === 'www.binance.com') return pick(spec.binance ?? { code: '000000', data: { catalogs: [{ articles: [] }] } });
    if (h === 't.me') {
      const user = url.pathname.split('/').pop();
      return pick((spec.tg && spec.tg[user]) ?? tgEmptyPage(user));
    }
    if (h === 'www.blockmedia.co.kr') return pick(spec.blockmedia ?? rss([]));
    if (h === 'www.coindesk.com') return pick(spec.coindesk ?? rss([]));
    if (h === 'cointelegraph.com') return pick(spec.cointelegraph ?? rss([]));
    return new Response('unexpected', { status: 599 });
  };
}
const run = (db, spec, extra = {}) => runIntelligence({ DB: db, ...(extra.env || {}) }, extra.now || NOW, { fetchImpl: makeFetch(spec, extra.log), force: true, budget: Infinity, candleIntervalMs: 0 });

const bn = (code, title, t) => ({ code, title, releaseDate: t });
const binanceBody = (arts) => ({ code: '000000', data: { catalogs: [{ articles: arts }] } });

test('공식 공지 + 뉴스 수집 → D1 저장, 카테고리/심볼/검증/중요도', async () => {
  const db = new FakeD1();
  const r = await run(db, {
    upbitNotice: upbitNotices([{ id: 9001, title: '[거래] 솔라나(SOL) KRW 마켓 디지털 자산 추가', t: NOW - 8 * MIN }]),
    coindesk: rss([{ title: 'Bitcoin ETF flows hit record', link: 'https://www.coindesk.com/a1', t: NOW - 30 * MIN, desc: '<p>Some <b>text</b></p>' }]),
  });
  assert.equal(r.ok, true);
  assert.equal(r.new_items, 2);
  const items = db.rows('SELECT * FROM intelligence_items ORDER BY id');
  const up = items.find((i) => i.source === 'upbit');
  assert.equal(up.category, 'listing');
  assert.equal(up.source_type, 'official');
  assert.equal(up.source_tier, 1);
  assert.deepEqual(JSON.parse(up.symbols), ['SOL']);
  assert.equal(up.published_at, NOW - 8 * MIN);
  assert.equal(up.collected_at, NOW);
  const news = items.find((i) => i.source === 'coindesk');
  assert.equal(news.summary, 'Some text');
  assert.equal(news.source_tier, 2);
  const cl = db.rows('SELECT * FROM event_clusters ORDER BY id');
  assert.equal(cl.length, 2);
  assert.equal(cl.find((c) => c.source === 'upbit').verification, 'official');
  assert.equal(cl.find((c) => c.source === 'coindesk').verification, 'news');
  // 헬스: 실행한 5개 출처 모두 기록 (수집 성공)
  assert.equal(db.rows('SELECT * FROM source_health WHERE consecutive_failures = 0').length, 9); // 공식 2 + 뉴스 3 + Telegram 4 (force 실행)
});

test('D1 중복 방지: 같은 항목 재수집 시 저장 안 됨, 추적 파라미터만 다른 URL 도 동일', async () => {
  const db = new FakeD1();
  const spec = { blockmedia: rss([{ title: '비트코인 급등', link: 'https://www.blockmedia.co.kr/a?utm_source=x', t: NOW - 3 * MIN }]) };
  await run(db, spec);
  const again = await run(db, { blockmedia: rss([{ title: '비트코인 급등', link: 'https://www.blockmedia.co.kr/a', t: NOW - 3 * MIN }]) });
  assert.equal(again.new_items, 0);
  assert.equal(db.rows('SELECT * FROM intelligence_items').length, 1);
  assert.equal(db.rows('SELECT * FROM event_clusters').length, 1);
});

test('중복 제거: 같은 사건이 여러 언론사에서 나오면 하나의 클러스터, 복수 출처 확인 + 중요도 가점', async () => {
  const db = new FakeD1();
  await run(db, {
    coindesk: rss([{ title: 'SEC approves spot Solana ETF', link: 'https://www.coindesk.com/sol-etf', t: NOW - 20 * MIN }]),
    cointelegraph: rss([{ title: 'SEC approves spot Solana ETF in landmark decision', link: 'https://cointelegraph.com/news/sol-etf', t: NOW - 15 * MIN }]),
    blockmedia: rss([{ title: '전혀 다른 소식', link: 'https://www.blockmedia.co.kr/x', t: NOW - 5 * MIN }]),
  });
  const cl = db.rows('SELECT * FROM event_clusters ORDER BY id');
  assert.equal(cl.length, 2);
  const sol = cl.find((c) => JSON.parse(c.symbols).includes('SOL'));
  assert.equal(sol.item_count, 2);
  assert.equal(sol.source_count, 2);
  assert.equal(sol.verification, 'multi');
  assert.equal(sol.category, 'regulation');
  assert.equal(sol.importance_base, 15 + 20 + 8);
  assert.ok(sol.importance >= sol.importance_base + 6); // 독립 출처 2개 → +6 (시장 반응 가점이 있으면 더)
  assert.equal(db.rows('SELECT DISTINCT cluster_id FROM intelligence_items WHERE cluster_id = ' + sol.id).length, 1);
});

test('공식 공지와 뉴스가 같은 사건이면 한 클러스터로 묶여 공식 확인 + 대표 링크는 공식 출처 (복수 출처 가점 포함)', async () => {
  const db = new FakeD1();
  await run(db, {
    coindesk: rss([{ title: 'Binance will list Solana (SOL) with Seed Tag applied', link: 'https://www.coindesk.com/bn-sol', t: NOW - 6 * MIN }]),
    binance: binanceBody([bn('a1b2c3d4e5f60718293a4b5c6d7e8f90', 'Binance Will List Solana (SOL) with Seed Tag Applied', NOW - 8 * MIN)]),
  });
  const cl = db.rows('SELECT * FROM event_clusters');
  assert.equal(cl.length, 1);
  assert.equal(cl[0].verification, 'official');
  assert.equal(cl[0].source_type, 'official');
  assert.equal(cl[0].url, 'https://www.binance.com/en/support/announcement/a1b2c3d4e5f60718293a4b5c6d7e8f90');
  assert.equal(cl[0].source_count, 2);
  assert.equal(cl[0].event_time, NOW - 8 * MIN); // 가장 먼저 게시된 시각
  assert.equal(cl[0].importance_base, 68); // 공식 30 + 상장 30 + 주요 코인 8
  assert.ok(cl[0].importance >= 74);
});

test('출처 실패 격리: 한 출처가 실패/시간 초과/깨진 응답이어도 나머지는 정상 저장, 실패만 health 에 기록', async () => {
  const db = new FakeD1();
  const r = await run(db, {
    binance: new Response('blocked', { status: 451 }),
    blockmedia: '<html>challenge</html>',
    coindesk: 'hang',
    cointelegraph: rss([{ title: 'Ethereum upgrade goes live', link: 'https://cointelegraph.com/news/eth-up', t: NOW - 2 * MIN }]),
    upbitNotice: upbitNotices([{ id: 1, title: '[거래] 비트코인(BTC) 관련 안내', t: NOW - MIN }]),
  }, {});
  assert.equal(r.ok, true);
  assert.equal(r.new_items, 2);
  const bad = Object.fromEntries(r.sources.filter((s) => !s.ok).map((s) => [s.id, s.error]));
  assert.match(bad.binance, /451/);
  assert.match(bad.blockmedia, /RSS|형식/);
  assert.match(bad.coindesk, /시간 초과/);
  const h = Object.fromEntries(db.rows('SELECT * FROM source_health').map((x) => [x.source, x]));
  assert.equal(h.binance.consecutive_failures, 1);
  assert.equal(h.cointelegraph.consecutive_failures, 0);
  assert.equal(h.cointelegraph.last_success_at, NOW);
});

test('source timeout: 8초 제한 (fake timer 없이 abort 신호로 확인)', { timeout: 15000 }, async () => {
  const db = new FakeD1();
  const t0 = Date.now();
  const r = await run(db, { coindesk: 'hang' });
  assert.ok(Date.now() - t0 >= 7500 && Date.now() - t0 < 12000);
  assert.match(r.sources.find((s) => s.id === 'coindesk').error, /시간 초과/);
});

test('연속 실패: 3회 이상이면 health 가 수집 오류, 성공하면 복구, 실패 시 마지막 성공 시각 유지', async () => {
  const db = new FakeD1();
  await run(db, { coindesk: rss([]) });
  for (let i = 1; i <= 3; i += 1) await run(db, { coindesk: new Response('x', { status: 500 }) }, { now: NOW + i * 5 * MIN });
  const row = db.rows("SELECT * FROM source_health WHERE source = 'coindesk'")[0];
  assert.equal(row.consecutive_failures, 3);
  assert.equal(row.last_success_at, NOW);
  const src = SOURCES.find((s) => s.id === 'coindesk');
  assert.equal(healthView(src, row, NOW + 16 * MIN).status, 'error');
  await run(db, { coindesk: rss([]) }, { now: NOW + 20 * MIN });
  const ok = db.rows("SELECT * FROM source_health WHERE source = 'coindesk'")[0];
  assert.equal(ok.consecutive_failures, 0);
  assert.equal(healthView(src, ok, NOW + 21 * MIN).status, 'ok');
  assert.equal(healthView(src, undefined, NOW).status, 'pending');
});

test('출처별 실행 주기: 공식 2분 · Telegram 6분 · 뉴스 8분(예산 안에서 순환), 실패 시 간격 증가', () => {
  const off = SOURCES.find((s) => s.id === 'upbit');
  const news = SOURCES.find((s) => s.id === 'coindesk');
  assert.equal(off.intervalMs, 2 * MIN);
  assert.equal(news.intervalMs, 8 * MIN);
  assert.equal(SOURCES.find((x) => x.id === 'tg-emperorcoin').intervalMs, 6 * MIN);
  assert.equal(isDue(news, undefined, NOW), true);
  assert.equal(isDue(news, { last_attempt_at: NOW - 2 * MIN, consecutive_failures: 0 }, NOW), false);
  assert.equal(isDue(news, { last_attempt_at: NOW - 8 * MIN, consecutive_failures: 0 }, NOW), true);
  assert.equal(isDue(news, { last_attempt_at: NOW - 9 * MIN, consecutive_failures: 2 }, NOW), false); // 3배 백오프
  assert.equal(isDue(off, { last_attempt_at: NOW - 2 * MIN, consecutive_failures: 0 }, NOW), true);
});

test('Cron 실행(force 없음): 공식은 매번, 나머지는 실행당 CPU 예산(4) 안에서 오래 기다린 순서로 순환', async () => {
  const db = new FakeD1();
  const attempted = new Set();
  for (let k = 0; k < 10; k += 1) { // 2분 간격 10번 = 20분
    const log = [];
    const r = await runIntelligence({ DB: db }, NOW + k * 2 * MIN, { fetchImpl: makeFetch({}, log), candleIntervalMs: 0 });
    const ext = log.filter((l) => !l.startsWith('api.upbit.com'));
    assert.equal(ext.filter((l) => l.startsWith('www.binance.com')).length, 3, `공식(Binance) +${k * 2}분`);
    assert.equal(ext.filter((l) => l.startsWith('api-manager.upbit.com')).length, 1, `공식(Upbit) +${k * 2}분`);
    const ids = r.sources.map((x) => x.id).filter((id) => id !== 'binance' && id !== 'upbit');
    const cost = ids.reduce((t, id) => t + SOURCES.find((x) => x.id === id).cost, 0);
    assert.ok(cost <= 4, `실행당 예산 초과 (+${k * 2}분: ${ids} = ${cost})`);
    assert.ok(ids.filter((id) => ['blockmedia', 'coindesk', 'cointelegraph'].includes(id)).length <= 1, '뉴스 RSS 는 실행당 최대 1개');
    ids.forEach((id) => attempted.add(id));
  }
  // 20분 안에 뉴스 3개와 Telegram 4개가 모두 한 번 이상 시도됨 (굶는 출처 없음). 기본 비활성 Coinpan 은 제외.
  assert.deepEqual([...attempted].sort(), ['blockmedia', 'coindesk', 'cointelegraph', 'tg-blockmedia', 'tg-emperorcoin', 'tg-enjoymyhobby', 'tg-wecryptotogether']);
});

test('selectSources: 공식(cost 0)은 모두, 나머지는 가장 오래 기다린 순서로 예산 안에서', () => {
  const by = (id) => SOURCES.find((s) => s.id === id);
  const due = [by('binance'), by('upbit'), by('blockmedia'), by('coindesk'), by('cointelegraph'), by('tg-wecryptotogether'), by('tg-emperorcoin')];
  const health = new Map([['blockmedia', { last_attempt_at: NOW - 10 * MIN }], ['coindesk', { last_attempt_at: NOW - 30 * MIN }], ['tg-emperorcoin', { last_attempt_at: NOW - 50 * MIN }]]);
  // 시도 기록 없는 cointelegraph(3) → 다음으로 오래된 것 중 남은 예산(1)에 맞는 Telegram(1)
  assert.deepEqual(selectSources(due, health).map((s) => s.id), ['binance', 'upbit', 'cointelegraph', 'tg-wecryptotogether']);
  assert.deepEqual(selectSources(due, health, 1).map((s) => s.id), ['binance', 'upbit', 'tg-wecryptotogether']);
  assert.equal(selectSources(due, health, Infinity).length, 7);
  assert.deepEqual(selectSources([by('coindesk')], new Map(), 1).map((s) => s.id), ['coindesk']); // 예산보다 큰 출처도 단독 실행은 허용
});

test('INTEL_DISABLED 로 특정 출처를 끌 수 있음', async () => {
  const db = new FakeD1();
  const log = [];
  await run(db, {}, { env: { INTEL_DISABLED: 'coindesk, blockmedia' }, log });
  assert.equal(log.some((l) => /^(www\.coindesk\.com|www\.blockmedia\.co\.kr)/.test(l)), false);
});

test('시장 반응 연결: Upbit 원화 마켓이 있는 코인은 실제 1분봉으로 스냅샷 저장, 중요도 가점', async () => {
  const db = new FakeD1();
  const pub = NOW - 20 * MIN;
  const r = await run(db, {
    pub,
    upbitNotice: upbitNotices([{ id: 55, title: '[거래] 솔라나(SOL) KRW 마켓 디지털 자산 추가', t: pub }]),
  });
  assert.equal(r.snapshots, 1);
  const s = db.rows('SELECT * FROM event_market_snapshots')[0];
  assert.equal(s.symbol, 'SOL');
  assert.equal(s.market, 'KRW-SOL');
  assert.equal(s.price_now, 103);
  assert.equal(s.published_at, pub);
  assert.equal(s.change_pre5, 0);
  assert.ok(Math.abs(s.change_post15 - 3) < 0.01);
  const c = db.rows('SELECT * FROM event_clusters')[0];
  assert.equal(c.reaction_bonus, 10);
  assert.equal(c.importance, c.importance_base + 10);
});

test('시장 데이터 없음: 원화 마켓이 없는 코인/시세 요청 실패는 스냅샷 없이 정상 동작', async () => {
  const db = new FakeD1();
  const r = await run(db, { coindesk: rss([{ title: 'Ethereum upgrade', link: 'https://www.coindesk.com/eth', t: NOW - MIN }]) }); // KRW-ETH 없음
  assert.equal(r.snapshots, 0);
  assert.equal(db.rows('SELECT * FROM event_market_snapshots').length, 0);
  const later = makeFetch({ coindesk: rss([{ title: 'Solana rises again', link: 'https://www.coindesk.com/sol2', t: NOW + 59 * MIN }]), now: NOW + 60 * MIN });
  const r2 = await runIntelligence({ DB: db }, NOW + 60 * MIN, {
    force: true, budget: Infinity, candleIntervalMs: 0,
    fetchImpl: (u, init) => (String(u).includes('/candles/') ? Promise.resolve(new Response('x', { status: 429 })) : later(u, init)),
  });
  assert.equal(r2.snapshots, 0);
  assert.ok(r2.errors.some((e) => /시세/.test(e)));
  assert.equal(db.rows(`SELECT reaction_bonus FROM event_clusters WHERE title LIKE 'Solana%'`)[0].reaction_bonus, 0);
});

test('마켓 목록 실패해도 기본 사전으로 수집 계속', async () => {
  const db = new FakeD1();
  const f = makeFetch({ coindesk: rss([{ title: 'Bitcoin hits new high', link: 'https://www.coindesk.com/btc', t: NOW - MIN }]) });
  const r = await runIntelligence({ DB: db }, NOW, { force: true, budget: Infinity, candleIntervalMs: 0, fetchImpl: (u, i) => (String(u).includes('market/all') ? Promise.reject(new Error('net down')) : f(u, i)) });
  assert.equal(r.new_items, 1);
  assert.deepEqual(JSON.parse(db.rows('SELECT symbols FROM intelligence_items')[0].symbols), ['BTC']);
});

test('게시 시간 없는 항목: published_at = null, 수집 시각과 혼동하지 않음', async () => {
  const db = new FakeD1();
  await run(db, { coindesk: rss([{ title: 'No date headline about Bitcoin', link: 'https://www.coindesk.com/nodate' }]) });
  const it = db.rows('SELECT * FROM intelligence_items')[0];
  assert.equal(it.published_at, null);
  assert.equal(it.collected_at, NOW);
  assert.equal(db.rows('SELECT published_known FROM event_clusters')[0].published_known, 0);
});

test('오래된 항목(3일 초과 뉴스)과 위험 URL 은 저장하지 않음', async () => {
  const db = new FakeD1();
  await run(db, {
    coindesk: rss([{ title: 'Old Bitcoin story', link: 'https://www.coindesk.com/old', t: NOW - 4 * 86400000 }, { title: 'Evil link Bitcoin', link: 'javascript:alert(1)', t: NOW - MIN }]),
  });
  assert.equal(db.rows('SELECT * FROM intelligence_items').length, 0);
  assert.equal(enrichItem({ title: 'x', url: 'data:text/html,1', publishedAt: null }, SOURCES[2], NOW, undefined), null);
});

test('retention: 항목 30일 · 클러스터 60일 지난 것만 삭제', async () => {
  const db = new FakeD1();
  await run(db, { coindesk: rss([{ title: 'Bitcoin news A', link: 'https://www.coindesk.com/a', t: NOW - MIN }]) });
  const D = 86400000;
  db.db.exec(`UPDATE intelligence_items SET collected_at = ${NOW - 31 * D}`);
  db.db.exec(`INSERT INTO event_clusters (title,url,category,symbols,importance_base,importance,verification,source,source_type,sources,item_count,source_count,published_known,event_time,last_time,first_seen_at,updated_at) VALUES ('old','https://a.com/o','general','[]',5,5,'news','coindesk','news','[]',1,1,1,${NOW - 61 * D},${NOW - 61 * D},${NOW - 61 * D},${NOW - 61 * D})`);
  await pruneIntel(db, NOW);
  assert.equal(db.rows('SELECT * FROM intelligence_items').length, 0);
  const left = db.rows('SELECT title FROM event_clusters');
  assert.deepEqual(left.map((x) => x.title), ['Bitcoin news A']); // 60일 이내 클러스터는 유지
});

test('D1 없음: 수집을 건너뛰고 오류 없이 반환', async () => {
  const r = await runIntelligence({}, NOW, { fetchImpl: makeFetch() });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /D1/);
});

// ── API ──
const call = (path, env) => worker.fetch(new Request('https://x.test' + path), env, {});

async function seeded() {
  const db = new FakeD1();
  await run(db, {
    upbitNotice: upbitNotices([{ id: 11, title: '[거래] 솔라나(SOL) KRW 마켓 디지털 자산 추가', t: NOW - 8 * MIN }]),
    coindesk: rss(['Bitcoin miners expand capacity in Texas', 'Bitcoin treasury firm buys more coins', 'Bitcoin hashrate reaches record level', 'Bitcoin options expiry looms this Friday', 'Bitcoin lightning network adoption grows'].map((title, i) => ({ title, link: `https://www.coindesk.com/s${i}`, t: NOW - (i + 1) * MIN }))),
  });
  return db;
}

test('API events: 응답 형식, 최신순, 시장 스냅샷 포함, CORS', async () => {
  const db = await seeded();
  const res = await call('/api/intelligence/events?limit=10', { DB: db });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.events.length, 6);
  const times = body.events.map((e) => e.event_time);
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
  const sol = body.events.find((e) => e.symbols.includes('SOL'));
  assert.equal(sol.verification, 'official');
  assert.equal(sol.market[0].symbol, 'SOL');
  assert.equal(sol.published_at, NOW - 8 * MIN);
});

test('API 필터: source / symbol / min_importance / limit', async () => {
  const db = await seeded();
  const j = async (q) => (await (await call('/api/intelligence/events' + q, { DB: db })).json()).events;
  assert.equal((await j('?source=official')).length, 1);
  assert.equal((await j('?source=news')).length, 5);
  assert.equal((await j('?symbol=sol')).length, 1); // 소문자도 허용
  assert.equal((await j('?symbol=BTC')).length, 5);
  assert.equal((await j('?symbol=DOGE')).length, 0);
  assert.equal((await j('?limit=2')).length, 2);
  assert.equal((await j('?min_importance=60')).length, 1);
  const latest = await (await call('/api/intelligence/latest?limit=3&source=news', { DB: db })).json();
  assert.equal(latest.items.length, 3);
  assert.ok(latest.items.every((i) => i.source_type === 'news'));
});

test('API 입력 검증: 잘못된 limit/symbol/source/min_importance 는 400, 상한 50', async () => {
  const db = await seeded();
  for (const q of ['?limit=0', '?limit=-1', '?limit=abc', '?limit=1000', '?limit=5;DROP', "?symbol=BTC'--", '?symbol=B', '?symbol=%25', '?source=x', '?min_importance=101', '?min_importance=-1']) {
    const res = await call('/api/intelligence/events' + q, { DB: db });
    assert.equal(res.status, 400, q);
  }
  assert.equal(parseQuery(new URLSearchParams('limit=50')).limit, 50);
  assert.equal(parseQuery(new URLSearchParams('limit=51')).limit, 50);
  assert.equal(parseQuery(new URLSearchParams('')).limit, 20);
  // SQL 주입 시도가 테이블을 건드리지 않음
  await call("/api/intelligence/events?symbol=BTC%27%3B%20DROP%20TABLE%20event_clusters%3B--", { DB: db });
  assert.equal(db.rows('SELECT * FROM event_clusters').length, 6);
});

test('API status: 출처별 정상/수집 준비 중/수집 오류 표시', async () => {
  const db = new FakeD1();
  await run(db, { coindesk: new Response('x', { status: 503 }) }, {});
  for (let i = 1; i <= 3; i += 1) await run(db, { coindesk: new Response('x', { status: 503 }) }, { now: NOW + i * 10 * MIN });
  const at = NOW + 31 * MIN;
  const body = await (await handleIntelligence('/api/intelligence/status', new URL('https://x.test/api/intelligence/status'), { DB: db, INTEL_DISABLED: 'blockmedia' }, at)).json();
  const by = Object.fromEntries(body.sources.map((s) => [s.id, s]));
  assert.equal(by.coindesk.status, 'error'); // 연속 실패 4회 → 수집 오류
  assert.equal(by.coindesk.consecutive_failures, 4);
  assert.equal(by.upbit.status, 'ok'); // 마지막 성공이 1분 전
  assert.equal(by.upbit.last_success_at, NOW + 30 * MIN);
  assert.ok(body.disabled.includes('blockmedia') && body.disabled.includes('coinpan')); // Coinpan 은 기본 비활성
  assert.match(body.disabled_sources.find((d) => d.id === 'blockmedia').reason, /INTEL_DISABLED/);
  assert.match(body.disabled_sources.find((d) => d.id === 'coinpan').reason, /INTEL_ENABLE/);
  assert.equal(by.blockmedia, undefined);
});

test('API: D1 미연결이면 200 + degraded 안내, 잘못된 하위 경로는 404, POST 405', async () => {
  const res = await call('/api/intelligence/events', {});
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'degraded');
  assert.equal((await call('/api/intelligence/nope', {})).status, 404);
  const post = await worker.fetch(new Request('https://x.test/api/intelligence/events', { method: 'POST' }), {}, {});
  assert.equal(post.status, 405);
});

test('API 응답의 URL 은 http(s) 만: DB 에 위험 URL 이 들어 있어도 null 로 출력', async () => {
  const db = await seeded();
  db.db.exec(`UPDATE event_clusters SET url = 'javascript:alert(1)' WHERE id = 1`);
  const body = await (await call('/api/intelligence/events?limit=50', { DB: db })).json();
  assert.ok(body.events.every((e) => e.url === null || /^https?:\/\//.test(e.url)));
  assert.ok(body.events.some((e) => e.url === null));
});

// ── Cron 분기 ──
test('Cron: */2 는 정보 수집, 그 외(1분)는 기존 Upbit 감시 — 서로 영향 없음', async () => {
  const seen = [];
  globalThis.fetch = async (u) => {
    seen.push(new URL(String(u)).hostname);
    return new Response('nope', { status: 500 });
  };
  const db = new FakeD1();
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  await worker.scheduled({ cron: '*/2 * * * *', scheduledTime: NOW }, { DB: db }, ctx);
  await Promise.all(waits);
  assert.ok(seen.includes('api-manager.upbit.com') && seen.includes('www.blockmedia.co.kr'));
  assert.ok(!seen.includes('api.binance.com') && !seen.includes('fapi.binance.com'));
  seen.length = 0;
  waits.length = 0;
  await worker.scheduled({ cron: '* * * * *', scheduledTime: NOW }, { DB: db }, ctx);
  await Promise.all(waits);
  assert.ok(seen.includes('api.upbit.com'));
  assert.ok(!seen.includes('www.blockmedia.co.kr') && !seen.includes('www.binance.com'));
  // cron 정보가 없는 호출(기존 방식)은 그대로 Upbit 감시
  seen.length = 0;
  waits.length = 0;
  await worker.scheduled({ scheduledTime: NOW }, { DB: db }, ctx);
  await Promise.all(waits);
  assert.ok(!seen.includes('www.binance.com'));
});

// ════════════════════════════════════════════════════════════════════════════
// Phase 6A 운영 수정: "모든 출처가 수집 전 / last_run_at null" 회귀 테스트 (mock, 실제 Cloudflare 확인 아님)
// ════════════════════════════════════════════════════════════════════════════

test('wrangler.toml 의 Cron 은 코드가 기대하는 표현식과 정확히 일치하고, 각각 올바른 작업으로 분기됨', () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const line = toml.split('\n').find((l) => /^\s*crons\s*=/.test(l));
  const crons = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(crons, CRONS);
  assert.deepEqual(crons, [MONITOR_CRON, INTEL_CRON]);
  assert.equal(new Set(crons).size, crons.length); // 서로 다른 표현식 (같으면 Cloudflare 가 하나로 합침)
  assert.equal(cronKind(MONITOR_CRON), 'monitor');
  assert.equal(cronKind(INTEL_CRON), 'intel');
});

test('Cron 분기: 1분 표현식/정보 없음만 Upbit 감시, 그 외 모든 표현식은 정보 수집 (표현식 표기가 달라도 수집이 멈추지 않음)', () => {
  for (const c of [undefined, null, '', '   ', '* * * * *', ' *  * * * * ']) assert.equal(cronKind(c), 'monitor', String(c));
  for (const c of ['*/2 * * * *', '0/2 * * * *', '*/2  * * * *', '*/5 * * * *', '0,2,4,6 * * * *']) assert.equal(cronKind(c), 'intel', c);
});

async function fireCron(cron, env, now = NOW) {
  const waits = [];
  await worker.scheduled({ cron, scheduledTime: now }, env, { waitUntil: (p) => waits.push(p) });
  assert.equal(waits.length, 1); // 감시 Cron 도 waitUntil 1개 (기존 동작 유지)
  await Promise.all(waits);
}

test('scheduled(*/2): collector 실행 → source_health · 진단(meta) 기록 → status 진단 값', async () => {
  const db = new FakeD1();
  globalThis.fetch = makeFetch({
    binance: new Response('blocked', { status: 451 }),
    upbitNotice: upbitNotices([{ id: 1, title: '[거래] 비트코인(BTC) 관련 안내', t: NOW - MIN }]),
    blockmedia: rss([{ title: 'Bitcoin news', link: 'https://www.blockmedia.co.kr/1', t: NOW - MIN }]),
  });
  await fireCron('*/2 * * * *', { DB: db });
  const h = Object.fromEntries(db.rows('SELECT * FROM source_health').map((x) => [x.source, x]));
  assert.ok(h.binance && h.upbit && h.blockmedia); // 이번 실행 대상(공식 2 + 뉴스 1)은 모두 기록됨
  assert.equal(h.binance.consecutive_failures, 1);
  assert.match(h.binance.last_error, /451/);
  assert.equal(h.upbit.last_success_at, NOW);
  assert.equal(h.upbit.last_error, null);
  assert.equal(h.blockmedia.last_success_at, NOW);
  const s = await (await worker.fetch(new Request('https://x.test/api/intelligence/status'), { DB: db }, {})).json();
  const d = s.diagnostics;
  assert.equal(d.last_cron_expression, '*/2 * * * *');
  assert.equal(d.last_cron_seen_at, NOW);
  assert.equal(d.last_collector_started_at, NOW);
  assert.ok(d.last_collector_finished_at >= NOW);
  assert.equal(d.last_collector_error, null);
  assert.equal(d.code, 'ok');
  assert.ok(s.last_run_at);
});

test('scheduled: 감시 Cron(* * * * *) 은 Upbit 감시만 실행하고 정보 수집 요청을 하지 않음, 진단 기록은 10분에 1번', async () => {
  const seen = [];
  globalThis.fetch = async (u) => { seen.push(new URL(String(u)).hostname); return new Response('x', { status: 500 }); };
  const db = new FakeD1();
  await fireCron('* * * * *', { DB: db });
  assert.ok(seen.includes('api.upbit.com'));
  assert.ok(!seen.some((h) => /binance|blockmedia|coindesk|cointelegraph|api-manager/.test(h)));
  assert.equal(db.rows('SELECT * FROM monitor_runs').length, 1);
  await fireCron('* * * * *', { DB: db }, NOW + MIN);
  const m = db.rows("SELECT * FROM intel_meta WHERE key LIKE 'cron_seen:%'");
  assert.equal(m.length, 1);
  assert.equal(m[0].key, 'cron_seen:* * * * *');
  assert.equal(m[0].value, String(NOW)); // 두 번째 실행은 10분 이내라 다시 쓰지 않음
});

test('진단 코드: 실행 기록 없음 → cron_not_seen, Cron 만 실행 → never_ran, 시작만 있고 완료 없음 → incomplete', async () => {
  const db = new FakeD1();
  const status = async (at) => (await (await handleIntelligence('/api/intelligence/status', new URL('https://x.test/api/intelligence/status'), { DB: db }, at)).json());
  let s = await status(NOW);
  assert.equal(s.diagnostics.code, 'cron_not_seen');
  assert.match(s.diagnostics.hint, /Cron\(\*\/2 \* \* \* \*\)/);
  assert.equal(s.last_run_at, null);
  assert.ok(s.sources.every((x) => x.status === 'pending')); // 첫 수집 전 = 모두 수집 준비 중
  // 정보 Cron 만 보임
  db.db.exec(`INSERT INTO intel_meta VALUES ('cron_seen:*/2 * * * *', '${NOW}', ${NOW})`);
  assert.equal((await status(NOW + MIN)).diagnostics.code, 'never_ran');
  // collector 시작만 기록되고 완료 없음
  db.db.exec(`INSERT INTO intel_meta VALUES ('last_collector_started_at', '${NOW}', ${NOW})`);
  assert.equal((await status(NOW + 10 * 1000)).diagnostics.code, 'ok'); // 아직 진행 중일 수 있음
  const inc = await status(NOW + 5 * MIN);
  assert.equal(inc.diagnostics.code, 'incomplete');
  assert.match(inc.diagnostics.hint, /CPU/);
  assert.equal(inc.diagnostics.last_collector_finished_at, null);
});

test('실행 도중 종료돼도(시작 기록만 남음) 출처가 "수집 준비 중" 이 아니라 "수집 오류/미완료" 로 드러나고 반복되면 실패 횟수 증가', async () => {
  const db = new FakeD1();
  await store_ensure(db);
  const src = SOURCES.find((s) => s.id === 'coindesk');
  await markAttempts(db, [src], NOW); // 시작 직후 종료된 것과 같은 상태
  let h = (await loadHealth(db)).get('coindesk');
  assert.equal(h.last_error, INCOMPLETE);
  assert.equal(h.consecutive_failures, 0);
  assert.equal(healthView(src, h, NOW + MIN).status, 'error'); // 성공한 적 없이 시도만 있음
  await markAttempts(db, [src], NOW + 6 * MIN); // 다음 실행 시작 시 이전 미완료가 실패로 집계
  h = (await loadHealth(db)).get('coindesk');
  assert.equal(h.consecutive_failures, 1);
  await markAttempts(db, [src], NOW + 30 * MIN);
  assert.equal((await loadHealth(db)).get('coindesk').consecutive_failures, 2);
  // 정상 완료하면 오류/실패가 지워짐
  const r = await run(db, { coindesk: rss([]) }, { now: NOW + 40 * MIN });
  assert.equal(r.ok, true);
  h = (await loadHealth(db)).get('coindesk');
  assert.equal(h.last_error, null);
  assert.equal(h.consecutive_failures, 0);
});
async function store_ensure(db) {
  const { ensureIntelSchema } = await import('../src/intel/store.js');
  await ensureIntelSchema(db);
}

test('저장 단계에서 예외가 나도(클러스터 테이블 손상) 전체 collector 가 죽지 않고 모든 출처의 상태가 기록됨', async () => {
  const db = new FakeD1();
  await run(db, {}); // 스키마 생성
  db.db.exec('DROP TABLE event_clusters');
  const r = await run(db, {
    upbitNotice: upbitNotices([{ id: 3, title: '[거래] 솔라나(SOL) KRW 마켓 디지털 자산 추가', t: NOW - MIN }]),
    blockmedia: rss([{ title: 'Ethereum news today', link: 'https://www.blockmedia.co.kr/e', t: NOW - MIN }]),
  }, { now: NOW + 10 * MIN });
  assert.equal(r.sources.length, 9); // 공식 2 + 뉴스 3 + Telegram 4
  const health = db.rows('SELECT source, last_error, last_attempt_at FROM source_health');
  assert.equal(health.length, 9); // 모두 기록
  assert.ok(health.find((x) => x.source === 'upbit').last_error); // 저장 실패는 해당 출처의 오류로 기록
  assert.ok(db.rows("SELECT * FROM intel_meta WHERE key = 'last_collector_finished_at'").length === 1);
  assert.match(db.rows("SELECT value FROM intel_meta WHERE key = 'last_collector_error'")[0].value, /클러스터/);
});

test('출처 독립성: Binance 451 이어도 Upbit/BlockMedia/CoinDesk/Cointelegraph 는 모두 시도되고 각자 기록됨', async () => {
  const db = new FakeD1();
  const log = [];
  const r = await run(db, {
    binance: new Response('Service unavailable from a restricted location', { status: 451 }),
    upbitNotice: upbitNotices([{ id: 4, title: '[거래] 리플(XRP) 안내', t: NOW - MIN }]),
    blockmedia: rss([{ title: 'BM Bitcoin', link: 'https://www.blockmedia.co.kr/b', t: NOW - MIN }]),
    coindesk: new Response('x', { status: 503 }),
    cointelegraph: rss([{ title: 'CT Ethereum', link: 'https://cointelegraph.com/c', t: NOW - MIN }]),
  }, { log });
  for (const h of ['www.binance.com', 'api-manager.upbit.com', 'www.blockmedia.co.kr', 'www.coindesk.com', 'cointelegraph.com']) assert.ok(log.some((l) => l.startsWith(h)), h + ' 미시도');
  const h = Object.fromEntries(db.rows('SELECT * FROM source_health').map((x) => [x.source, x]));
  assert.match(h.binance.last_error, /451/);
  assert.equal(h.binance.consecutive_failures, 1);
  assert.equal(h.binance.last_success_at, null);
  assert.match(h.coindesk.last_error, /503/);
  for (const ok of ['upbit', 'blockmedia', 'cointelegraph']) {
    assert.equal(h[ok].last_error, null, ok);
    assert.equal(h[ok].last_success_at, NOW, ok);
    assert.equal(h[ok].consecutive_failures, 0, ok);
  }
  assert.equal(r.new_items, 3);
});

test('fetchRaw 가 동기 예외를 던지는 출처가 있어도 다른 출처는 정상 수집', async () => {
  const src = SOURCES.find((s) => s.id === 'coindesk');
  const orig = src.fetchRaw;
  src.fetchRaw = () => { throw new Error('boom(sync)'); };
  try {
    const db = new FakeD1();
    const r = await run(db, { blockmedia: rss([{ title: 'Bitcoin ok', link: 'https://www.blockmedia.co.kr/ok', t: NOW - MIN }]) });
    assert.equal(r.sources.find((s) => s.id === 'coindesk').ok, false);
    assert.equal(r.sources.find((s) => s.id === 'blockmedia').ok, true);
    assert.match(db.rows("SELECT last_error FROM source_health WHERE source = 'coindesk'")[0].last_error, /boom/);
  } finally {
    src.fetchRaw = orig;
  }
});

test('진단 기록(meta) 이 실패해도 수집은 계속됨', async () => {
  const db = new FakeD1();
  await run(db, {});
  db.db.exec('DROP TABLE intel_meta');
  const r = await run(db, { blockmedia: rss([{ title: 'Bitcoin still works', link: 'https://www.blockmedia.co.kr/w', t: NOW - MIN }]) }, { now: NOW + 10 * MIN });
  assert.equal(r.new_items, 1);
  await worker.scheduled({ cron: '*/2 * * * *', scheduledTime: NOW }, { DB: db }, { waitUntil: (p) => p });
});

test('큰 RSS(기사 전문 포함 약 440KB)도 항목 25개만 앞부분에서 읽고 전문은 저장하지 않음', async () => {
  const { parseFeed } = await import('../src/intel/feed.js');
  const body = 'SECRET-FULL-TEXT <p>x</p> '.repeat(400);
  const xml = `<rss><channel>${Array.from({ length: 40 }, (_, i) => `<item><title>T${i} Bitcoin</title><link>https://a.com/${i}</link><description>short ${i}</description><content:encoded><![CDATA[${body}]]></content:encoded></item>`).join('')}</channel></rss>`;
  assert.ok(xml.length > 400_000 && xml.length < 600_000);
  const items = parseFeed(xml, NOW);
  assert.equal(items.length, 25);
  assert.equal(items[3].summary, 'short 3');
  assert.ok(items.every((i) => !i.summary.includes('SECRET')));
});

test('시장 반응 연결이 실패해도 수집 결과와 출처 상태는 정상 기록', async () => {
  const db = new FakeD1();
  const f = makeFetch({ upbitNotice: upbitNotices([{ id: 8, title: '[거래] 솔라나(SOL) KRW 마켓 디지털 자산 추가', t: NOW - MIN }]) });
  const r = await runIntelligence({ DB: db }, NOW, { force: true, budget: Infinity, candleIntervalMs: 0, fetchImpl: (u, i) => (String(u).includes('/candles/') ? Promise.reject(new Error('candles down')) : f(u, i)) });
  assert.equal(r.new_items, 1);
  assert.equal(db.rows("SELECT last_error FROM source_health WHERE source = 'upbit'")[0].last_error, null);
});
