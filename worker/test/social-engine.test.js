// Phase 6B: Telegram/커뮤니티 수집 엔진 · D1 · 검증/클러스터 · 관심도 API · 보안 · 마이그레이션 (모두 mock, 실제 t.me/Coinpan 연결 검증 아님)
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { runIntelligence } from '../src/intel/engine.js';
import { handleIntelligence } from '../src/intel/api.js';
import { resetIntelSchemaFlagForTests, ensureIntelSchema } from '../src/intel/store.js';
import { pruneSocial, SOCIAL_RETENTION } from '../src/intel/social-store.js';
import { resetCronThrottleForTests } from '../src/intel/diag.js';
import { resetSchemaFlagForTests } from '../src/store.js';
import { memory } from '../src/monitor.js';
import { MAX_NEW_PER_RUN } from '../src/intel/social.js';
import { fetchText } from '../src/intel/sources.js';
import { FakeD1, MIN } from './helpers.js';
import { tgPage, tgEmptyPage, tgNoPreviewPage, rssFeed } from './fixtures/social-fixtures.js';

const NOW = Date.UTC(2026, 9, 1, 3, 10, 30); // 분 = 10 (정각 정리 작업이 돌지 않는 시각)
const H = 3600000;
const iso = (t) => new Date(t).toISOString().slice(0, 19);
const rfc = (t) => new Date(t).toUTCString();
const realFetch = globalThis.fetch;
beforeEach(() => { resetIntelSchemaFlagForTests(); resetSchemaFlagForTests(); resetCronThrottleForTests(); memory.lastRun = null; });
afterEach(() => { globalThis.fetch = realFetch; });

const markets = [{ market: 'KRW-BTC', korean_name: '비트코인', english_name: 'Bitcoin' }, { market: 'KRW-SOL', korean_name: '솔라나', english_name: 'Solana' }, { market: 'KRW-XRP', korean_name: '리플', english_name: 'Ripple' }];
const rss = (items) => `<?xml version="1.0"?><rss version="2.0"><channel>${items.map((i) => `<item><title>${i.title}</title><link>${i.link}</link>${i.t ? `<pubDate>${rfc(i.t)}</pubDate>` : ''}</item>`).join('')}</channel></rss>`;
const upbitNotices = (list) => ({ success: true, data: { notices: list.map((n) => ({ id: n.id, title: n.title, category: '거래', listed_at: new Date(n.t).toISOString().replace('Z', '+00:00'), first_listed_at: new Date(n.t).toISOString().replace('Z', '+00:00') })) } });
const candleRows = (now) => Array.from({ length: 100 }, (_, i) => { const t = Math.floor(now / MIN) * MIN - i * MIN; return { candle_date_time_utc: iso(t), opening_price: 100, high_price: 100, low_price: 100, trade_price: 100, candle_acc_trade_price: 1e8, candle_acc_trade_volume: 1 }; });

// spec: { tg: {유저명: html|Response|Error|'hang'}, upbitNotice, coindesk, cointelegraph, coinpan }
function makeFetch(spec = {}, log = []) {
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
    if (h === 'api.upbit.com') return Response.json(candleRows(spec.now || NOW));
    if (h === 'api-manager.upbit.com') return pick(spec.upbitNotice ?? upbitNotices([]));
    if (h === 'www.binance.com') return pick({ code: '000000', data: { catalogs: [{ articles: [] }] } });
    if (h === 't.me') { const u = url.pathname.split('/').pop(); return pick((spec.tg && spec.tg[u]) ?? tgEmptyPage(u)); }
    if (h === 'www.blockmedia.co.kr') return pick(spec.blockmedia ?? rss([]));
    if (h === 'www.coindesk.com') return pick(spec.coindesk ?? rss([]));
    if (h === 'cointelegraph.com') return pick(spec.cointelegraph ?? rss([]));
    if (h === 'coinpan.com') return pick(spec.coinpan ?? rssFeed([]));
    return new Response('unexpected host ' + h, { status: 599 });
  };
}
const run = (db, spec = {}, extra = {}) => runIntelligence({ DB: db, ...(extra.env || {}) }, extra.now || NOW, { fetchImpl: makeFetch(spec, extra.log), force: true, budget: Infinity, candleIntervalMs: 0 });
const tg = (user, ...msgs) => ({ [user]: tgPage(user, msgs) });

test('Telegram 수집 → social_items · social_mentions 저장, 심볼/카테고리, 중복 수집은 언급 증가 없음', async () => {
  const db = new FakeD1();
  const spec = { tg: tg('WeCryptoTogether', { id: 11, at: NOW - 5 * MIN, text: '솔라나 SOL 급등 비트코인도 상승 중' }, { id: 12, at: NOW - 2 * MIN, text: '일반 잡담입니다' }) };
  const r = await run(db, spec);
  assert.equal(r.sources.find((s) => s.id === 'tg-wecryptotogether').new, 2);
  const items = db.rows('SELECT * FROM social_items ORDER BY message_id');
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, 'telegram');
  assert.equal(items[0].source, 'tg-wecryptotogether');
  assert.equal(items[0].url, 'https://t.me/WeCryptoTogether/11');
  assert.equal(items[0].published_at, NOW - 5 * MIN);
  assert.equal(items[0].verification, 'unverified');
  assert.deepEqual(JSON.parse(items[0].symbols), ['SOL', 'BTC']);
  assert.deepEqual(JSON.parse(items[1].symbols), []);
  assert.equal(db.rows('SELECT * FROM social_mentions').length, 2); // 첫 글의 SOL, BTC
  // 같은 페이지를 다시 수집해도 중복 저장/언급 증가 없음
  const again = await run(db, spec, { now: NOW + 7 * MIN });
  assert.equal(again.sources.find((s) => s.id === 'tg-wecryptotogether').new, 0);
  assert.equal(db.rows('SELECT * FROM social_items').length, 2);
  assert.equal(db.rows('SELECT * FROM social_mentions').length, 2);
  // 일부만 겹치는 페이지: 새 메시지만 추가
  const r3 = await run(db, { tg: tg('WeCryptoTogether', { id: 12, at: NOW - 2 * MIN, text: '일반 잡담입니다' }, { id: 13, at: NOW, text: 'SOL 다시 언급' }) }, { now: NOW + 14 * MIN });
  assert.equal(r3.sources.find((s) => s.id === 'tg-wecryptotogether').new, 1);
  assert.equal(db.rows("SELECT * FROM social_mentions WHERE symbol = 'SOL'").length, 2);
});

test('D1 UNIQUE(source, message_id): 같은 번호를 직접 넣으면 무시, 다른 채널의 같은 번호는 별개', async () => {
  const db = new FakeD1();
  await run(db, { tg: { ...tg('WeCryptoTogether', { id: 5, at: NOW, text: 'BTC' }), ...tg('emperorcoin', { id: 5, at: NOW, text: 'ETH' }) } });
  assert.equal(db.rows('SELECT * FROM social_items').length, 2);
  assert.throws(() => db.db.exec(`INSERT INTO social_items (kind, source, channel, message_id, url, excerpt, collected_at, event_time, symbols, category, links, verification) VALUES ('telegram','tg-emperorcoin','x','5','https://t.me/x/5','e',1,1,'[]','general','[]','unverified')`), /UNIQUE/);
});

test('개인정보: social 테이블에 작성자/닉네임/IP/회원 ID 컬럼이 없음', async () => {
  const db = new FakeD1();
  await run(db, {});
  for (const t of ['social_items', 'social_mentions', 'social_hourly']) {
    const cols = db.rows(`PRAGMA table_info(${t})`).map((c) => c.name.toLowerCase());
    assert.ok(!cols.some((c) => /author|nick|user|member|ip$|^ip|writer|name_|creator/.test(c)), `${t}: ${cols}`);
  }
});

test(`실행당 새 메시지 처리 상한(${MAX_NEW_PER_RUN}): 최신부터 저장, 나머지는 다음 실행에서 이어서`, async () => {
  const db = new FakeD1();
  const msgs = Array.from({ length: 15 }, (_, i) => ({ id: 300 + i, at: NOW - (15 - i) * MIN, text: `메시지 ${i} BTC` }));
  const spec = { tg: tg('emperorcoin', ...msgs) };
  const r1 = await run(db, spec);
  assert.equal(r1.sources.find((s) => s.id === 'tg-emperorcoin').new, MAX_NEW_PER_RUN);
  assert.deepEqual(db.rows('SELECT message_id FROM social_items ORDER BY CAST(message_id AS INTEGER)').map((x) => x.message_id), Array.from({ length: MAX_NEW_PER_RUN }, (_, i) => String(300 + 15 - MAX_NEW_PER_RUN + i)));
  const r2 = await run(db, spec, { now: NOW + 7 * MIN });
  assert.equal(r2.sources.find((s) => s.id === 'tg-emperorcoin').new, 15 - MAX_NEW_PER_RUN);
  assert.equal(db.rows('SELECT * FROM social_items').length, 15);
});

test('채널 장애 격리: 한 채널이 451/깨진 응답/미리보기 꺼짐이어도 다른 채널·Coinpan 제외 공식/뉴스는 계속, 각자 상태 기록', async () => {
  const db = new FakeD1();
  const r = await run(db, {
    tg: {
      WeCryptoTogether: new Response('blocked', { status: 451 }),
      emperorcoin: tgNoPreviewPage('emperorcoin'),
      enjoymyhobby: '<html>Just a moment...</html>',
      ...tg('blockmedia', { id: 1, at: NOW - MIN, text: '비트코인 속보' }),
    },
    upbitNotice: upbitNotices([{ id: 9, title: '[거래] 리플(XRP) 안내', t: NOW - MIN }]),
    coindesk: rss([{ title: 'Bitcoin news', link: 'https://www.coindesk.com/b', t: NOW - MIN }]),
  });
  const by = Object.fromEntries(r.sources.map((s) => [s.id, s]));
  assert.equal(by['tg-wecryptotogether'].ok, false);
  assert.match(by['tg-wecryptotogether'].error, /451/);
  assert.match(by['tg-emperorcoin'].error, /미리보기가 꺼져/);
  assert.match(by['tg-enjoymyhobby'].error, /Telegram 페이지 형식이 아님/);
  assert.equal(by['tg-blockmedia'].ok, true);
  assert.equal(by.upbit.ok && by.coindesk.ok, true);
  assert.equal(r.sources.find((s) => s.id === 'coinpan'), undefined); // 비활성
  const h = Object.fromEntries(db.rows('SELECT * FROM source_health').map((x) => [x.source, x]));
  assert.equal(h['tg-wecryptotogether'].consecutive_failures, 1);
  assert.equal(h['tg-blockmedia'].last_error, null);
  assert.equal(h['tg-blockmedia'].last_item_count, 1);
  assert.ok(!h.coinpan);
});

test('빈 채널: 오류가 아니라 정상(0건)', async () => {
  const db = new FakeD1();
  const r = await run(db, {});
  const t = r.sources.find((s) => s.id === 'tg-blockmedia');
  assert.equal(t.ok, true);
  assert.equal(t.fetched, 0);
});

test('채널 timeout(8초): 해당 채널만 시간 초과 오류, 나머지 정상', { timeout: 20000 }, async () => {
  const db = new FakeD1();
  const t0 = Date.now();
  const r = await run(db, { tg: { emperorcoin: 'hang', ...tg('blockmedia', { id: 2, at: NOW, text: 'BTC' }) } });
  assert.ok(Date.now() - t0 >= 7500 && Date.now() - t0 < 13000);
  assert.match(r.sources.find((s) => s.id === 'tg-emperorcoin').error, /시간 초과/);
  assert.equal(r.sources.find((s) => s.id === 'tg-blockmedia').new, 1);
});

// ── 검증 / 클러스터 ──
const SOL_NOTICE = { id: 700, title: '[거래] 솔라나(SOL) KRW 마켓 디지털 자산 추가', t: NOW - 8 * MIN };
const clusters = (db) => db.rows('SELECT * FROM event_clusters ORDER BY id');

test('Telegram 만 있으면 미확인 (클러스터 연결 없음, "공식" 단어가 있어도 공식 확인 아님)', async () => {
  const db = new FakeD1();
  await run(db, { tg: tg('WeCryptoTogether', { id: 1, at: NOW - 5 * MIN, text: '[공식] 솔라나 SOL 업비트 상장 확정!! 공식 발표 임박' }) });
  const m = db.rows('SELECT * FROM social_items')[0];
  assert.equal(m.verification, 'unverified');
  assert.equal(m.cluster_id, null);
  assert.equal(clusters(db).length, 0); // 소셜만으로는 이벤트 클러스터를 만들지 않음
});

test('Telegram + 실제 Upbit 공식 공지(같은 코인·같은 카테고리·3시간 이내) → 공식 확인, 클러스터 집계/관측 순서 기록', async () => {
  const db = new FakeD1();
  await run(db, { upbitNotice: upbitNotices([SOL_NOTICE]), tg: tg('WeCryptoTogether', { id: 1, at: NOW - 5 * MIN, text: '업비트 솔라나 SOL 원화마켓 상장' }) });
  const c = clusters(db);
  assert.equal(c.length, 1);
  assert.equal(c[0].official_count, 1);
  assert.equal(c[0].telegram_count, 1);
  assert.equal(c[0].community_count, 0);
  assert.equal(c[0].official_seen_at, NOW - 8 * MIN);
  assert.equal(c[0].social_seen_at, NOW - 5 * MIN);
  assert.equal(c[0].verification, 'official');
  assert.equal(c[0].importance, c[0].importance_base + c[0].reaction_bonus + 0); // 소셜은 정보 중요도/출처 수를 올리지 않음
  assert.equal(c[0].source_count, 1);
  const m = db.rows('SELECT * FROM social_items')[0];
  assert.equal(m.cluster_id, c[0].id);
  assert.equal(m.verification, 'official');
});

test('Telegram 글의 링크가 이미 수집된 공식 공지 URL 과 같으면 텍스트가 달라도 연결 → 공식 확인', async () => {
  const db = new FakeD1();
  await run(db, { upbitNotice: upbitNotices([SOL_NOTICE]), tg: tg('emperorcoin', { id: 4, at: NOW - 3 * MIN, text: '이거 봐라 가즈아', links: ['https://upbit.com/service_center/notice?id=700&utm_source=tg'] }) });
  const m = db.rows('SELECT * FROM social_items')[0];
  assert.equal(m.verification, 'official');
  assert.ok(m.cluster_id);
});

test('공식 도메인 링크만 있고 수집된 공식 항목이 없으면 미확인 (도메인은 검증 근거가 아님)', async () => {
  const db = new FakeD1();
  await run(db, { tg: tg('emperorcoin', { id: 4, at: NOW - 3 * MIN, text: '업비트 공지 떴다 SOL', links: ['https://upbit.com/service_center/notice?id=99999'] }) });
  const m = db.rows('SELECT * FROM social_items')[0];
  assert.equal(m.verification, 'unverified');
  assert.equal(JSON.parse(m.links)[0].kind, 'official_domain'); // 힌트로만 저장
});

test('Telegram + 독립 뉴스 2개 → 복수 출처 확인', async () => {
  const db = new FakeD1();
  await run(db, {
    coindesk: rss([{ title: 'Upbit lists Solana (SOL) on KRW market', link: 'https://www.coindesk.com/u1', t: NOW - 20 * MIN }]),
    cointelegraph: rss([{ title: 'Upbit lists Solana (SOL) on KRW market today', link: 'https://cointelegraph.com/u2', t: NOW - 18 * MIN }]),
    tg: tg('enjoymyhobby', { id: 8, at: NOW - 5 * MIN, text: '업비트 솔라나 SOL 상장 뜸' }),
  });
  const c = clusters(db);
  assert.equal(c.length, 1);
  assert.equal(c[0].news_count, 2);
  assert.equal(c[0].telegram_count, 1);
  assert.equal(c[0].verification, 'multi');
  assert.equal(db.rows('SELECT verification FROM social_items')[0].verification, 'multi');
});

test('사건 흐름: 공식 → Telegram → 커뮤니티 (집계와 관측 시각), 커뮤니티만 있으면 미확인', async () => {
  const db = new FakeD1();
  const env = { INTEL_ENABLE: 'coinpan', COINPAN_BOARDS: 'https://coinpan.com/free/rss' };
  const r = await run(db, {
    upbitNotice: upbitNotices([SOL_NOTICE]),
    tg: tg('WeCryptoTogether', { id: 1, at: NOW - 6 * MIN, text: '업비트 솔라나 SOL 상장' }),
    coinpan: rssFeed([{ title: '솔라나 SOL 상장 간다 ㅋㅋ', link: 'https://coinpan.com/free/7000001', at: NOW - 4 * MIN }]),
  }, { env });
  assert.equal(r.sources.find((s) => s.id === 'coinpan').ok, true);
  const c = clusters(db)[0];
  assert.deepEqual([c.official_count, c.telegram_count, c.community_count], [1, 1, 1]);
  assert.ok(c.official_seen_at < c.social_seen_at && c.social_seen_at < c.community_seen_at);
  assert.equal(c.verification, 'official');
  // 커뮤니티만
  const db2 = new FakeD1();
  resetIntelSchemaFlagForTests(); // 다른 DB 이므로 스키마 준비 상태 초기화 (운영은 DB 가 하나)
  await run(db2, { coinpan: rssFeed([{ title: 'XRP 리플 얘기 많네요', link: 'https://coinpan.com/free/7000002', at: NOW - MIN }]) }, { env });
  const m = db2.rows('SELECT * FROM social_items')[0];
  assert.equal(m.kind, 'community');
  assert.equal(m.verification, 'unverified');
  assert.equal(m.cluster_id, null);
});

test('과도한 클러스터링 방지: 같은 코인이어도 카테고리가 다르거나 시간이 멀면 연결하지 않음', async () => {
  const db = new FakeD1();
  await run(db, {
    upbitNotice: upbitNotices([SOL_NOTICE]),
    tg: tg('WeCryptoTogether',
      { id: 1, at: NOW - 5 * MIN, text: '솔라나 SOL 에어드랍 이벤트 소식' }, // 카테고리 airdrop ≠ listing
      { id: 2, at: NOW - 5 * H, text: '업비트 솔라나 SOL 원화마켓 상장' }, // 시간 5시간 차이
      { id: 3, at: NOW - 4 * MIN, text: '리플 XRP 상장 소식' }), // 다른 코인
  });
  assert.equal(db.rows('SELECT * FROM social_items WHERE cluster_id IS NOT NULL').length, 0);
  assert.equal(clusters(db)[0].telegram_count, 0);
  assert.equal(db.rows('SELECT * FROM social_items').length, 3);
});

test('6A 클러스터 집계 컬럼: official_count / news_count 도 갱신', async () => {
  const db = new FakeD1();
  await run(db, {
    upbitNotice: upbitNotices([SOL_NOTICE]),
    coindesk: rss([{ title: 'Unrelated Bitcoin ETF flows', link: 'https://www.coindesk.com/etf', t: NOW - 3 * MIN }]),
  });
  const by = Object.fromEntries(clusters(db).map((c) => [c.source, c]));
  assert.deepEqual([by.upbit.official_count, by.upbit.news_count], [1, 0]);
  assert.deepEqual([by.coindesk.official_count, by.coindesk.news_count], [0, 1]);
});

// ── API / 관심도 ──
const call = (path, env, at = NOW + 30 * MIN) => handleIntelligence(path.split('?')[0], new URL('https://x.test' + path), env, at).then((r) => r.json());

// 언급 이력을 직접 삽입 (집계/창 검증용)
function seed(db, { kind = 'telegram', symbol, source = 'tg-blockmedia', times, collectedAt }) {
  times.forEach((ts, i) => {
    const mid = `${source}-${symbol}-${i}-${ts}`;
    db.db.exec(`INSERT INTO social_items (kind, source, channel, message_id, url, excerpt, collected_at, event_time, symbols, category, links, verification) VALUES ('${kind}','${source}','${source}','${mid}','https://t.me/x/${i}','e',${collectedAt ?? ts},${ts},'["${symbol}"]','general','[]','unverified')`);
    db.db.exec(`INSERT INTO social_mentions (item_id, kind, source, channel, symbol, ts) SELECT id, kind, source, channel, '${symbol}', ${ts} FROM social_items WHERE message_id = '${mid}'`);
  });
}

test('Telegram 언급량: 15분/1시간/6시간/24시간 개수 + baseline 배수 + 채널 수', async () => {
  const db = new FakeD1();
  await ensureIntelSchema(db);
  const now = NOW + 30 * MIN;
  const start = now - 40 * H; // 수집이 충분히 오래 진행됨
  // SOL: 최근 1시간 12건(2개 채널), 직전 23시간 동안 시간당 3건 = 69건
  seed(db, { symbol: 'SOL', source: 'tg-blockmedia', times: Array.from({ length: 6 }, (_, i) => now - (i + 1) * 8 * MIN), collectedAt: start });
  seed(db, { symbol: 'SOL', source: 'tg-emperorcoin', times: Array.from({ length: 6 }, (_, i) => now - (i + 1) * 9 * MIN - 60000), collectedAt: start });
  seed(db, { symbol: 'SOL', source: 'tg-blockmedia', times: Array.from({ length: 69 }, (_, i) => now - 70 * MIN - i * 20 * MIN), collectedAt: start });
  const body = await call('/api/intelligence/attention?kind=telegram&symbol=SOL', { DB: db }, now);
  const sol = body.attention[0];
  assert.equal(sol.symbol, 'SOL');
  assert.equal(sol.stats['1h'].count, 12);
  assert.equal(sol.stats['1h'].ratio, 4.2); // 시간당 12건 ÷ 직전 24시간 평균 시간당 2.875건(69건/24h)
  assert.equal(sol.stats['15m'].count, 2);
  assert.equal(sol.channels_1h, 2);
  assert.ok(sol.stats['24h'].count >= 12);
  assert.ok(sol.score > 0 && sol.score <= 100);
  assert.equal(sol.verification, 'unverified');
});

test('수집 기간이 짧으면 배수를 계산하지 않고 "데이터 축적 중"(insufficient), 개수는 표시', async () => {
  const db = new FakeD1();
  await ensureIntelSchema(db);
  const now = NOW + 30 * MIN;
  seed(db, { symbol: 'XRP', times: [now - 5 * MIN, now - 20 * MIN, now - 40 * MIN], collectedAt: now - 2 * H });
  const sol = (await call('/api/intelligence/attention?kind=telegram', { DB: db }, now)).attention[0];
  assert.equal(sol.stats['1h'].state, 'insufficient');
  assert.equal(sol.stats['1h'].ratio, null);
  assert.equal(sol.stats['1h'].count, 3);
  assert.equal(sol.partial, true);
});

test('커뮤니티 관심도: 15분 게시글 8개, 평균 대비 배수, 관심도 점수 (kind=community)', async () => {
  const db = new FakeD1();
  await ensureIntelSchema(db);
  const now = NOW + 30 * MIN;
  const start = now - 30 * H;
  seed(db, { kind: 'community', source: 'coinpan', symbol: 'XRP', times: Array.from({ length: 8 }, (_, i) => now - (i + 1) * MIN), collectedAt: start });
  seed(db, { kind: 'community', source: 'coinpan', symbol: 'XRP', times: Array.from({ length: 24 }, (_, i) => now - 20 * MIN - (i + 1) * 14 * MIN), collectedAt: start }); // 직전 6시간 안에 24건 = 시간당 4건
  const a = (await call('/api/intelligence/attention?kind=community', { DB: db }, now)).attention[0];
  assert.equal(a.kind, 'community');
  assert.equal(a.stats['15m'].count, 8);
  assert.equal(a.stats['15m'].ratio, 8); // 15분 8건 = 시간당 32건 ÷ 시간당 4건
  assert.equal(a.parts.channels, 0);
  assert.ok(a.score >= 50);
});

test('API 소셜/커뮤니티 목록: 필터 · limit 상한 · 안전한 URL · excerpt 만(전문 없음)', async () => {
  const db = new FakeD1();
  await run(db, { tg: tg('blockmedia', ...Array.from({ length: 6 }, (_, i) => ({ id: 50 + i, at: NOW - i * MIN, text: `BTC 메시지 ${i}`, links: [i === 0 ? 'javascript:alert(1)' : 'https://example.com/' + i] }))) });
  const all = await call('/api/intelligence/social?limit=50', { DB: db });
  assert.equal(all.items.length, 6);
  assert.ok(all.items.every((i) => /^https:\/\/t\.me\//.test(i.url) && i.links.every((l) => /^https?:\/\//.test(l.url))));
  assert.equal((await call('/api/intelligence/social?limit=2', { DB: db })).items.length, 2);
  assert.equal((await call('/api/intelligence/social?symbol=btc&channel=tg-blockmedia', { DB: db })).items.length, 6);
  assert.equal((await call('/api/intelligence/social?channel=tg-emperorcoin', { DB: db })).items.length, 0);
  assert.equal((await call('/api/intelligence/community', { DB: db })).items.length, 0);
  db.db.exec(`UPDATE social_items SET url = 'javascript:alert(1)' WHERE message_id = '55'`);
  const bad = await call('/api/intelligence/social?limit=50', { DB: db });
  assert.equal(bad.items.find((i) => i.id === 1).url, null);
});

test('API 입력 검증: limit/symbol/channel/kind, GET 전용(POST 405), 강제 수집 endpoint 없음', async () => {
  const db = new FakeD1();
  await ensureIntelSchema(db);
  for (const q of ['/social?limit=0', '/social?limit=51x', '/social?symbol=BTC%27--', '/social?channel=A', "/social?channel=tg-x'; DROP TABLE social_items;--", '/attention?kind=x', '/attention?limit=-1', '/community?symbol=%25', '/attention?symbol=B']) {
    const res = await worker.fetch(new Request('https://x.test/api/intelligence' + q), { DB: db }, {});
    assert.equal(res.status, 400, q);
  }
  assert.equal((await worker.fetch(new Request('https://x.test/api/intelligence/attention?limit=50&kind=all'), { DB: db }, {})).status, 200);
  assert.equal(db.rows("SELECT name FROM sqlite_master WHERE name = 'social_items'").length, 1);
  for (const p of ['/api/intelligence/social', '/api/intelligence/attention', '/api/intelligence/collect', '/api/intelligence/fetch', '/api/intelligence/run']) {
    const post = await worker.fetch(new Request('https://x.test' + p, { method: 'POST' }), { DB: db }, {});
    assert.equal(post.status, 405, p);
  }
  for (const p of ['/api/intelligence/collect', '/api/intelligence/fetch', '/api/intelligence/run', '/api/intelligence/refresh']) assert.equal((await worker.fetch(new Request('https://x.test' + p), { DB: db }, {})).status, 404, p);
});

test('이벤트 API: counts · timeline(관측 순서) 포함', async () => {
  const db = new FakeD1();
  await run(db, { upbitNotice: upbitNotices([SOL_NOTICE]), tg: tg('WeCryptoTogether', { id: 1, at: NOW - 5 * MIN, text: '업비트 솔라나 SOL 원화마켓 상장' }) });
  const body = await call('/api/intelligence/events?limit=5', { DB: db });
  const e = body.events[0];
  assert.deepEqual(e.counts, { official: 1, news: 0, telegram: 1, community: 0 });
  assert.equal(e.timeline.official_seen_at, NOW - 8 * MIN);
  assert.equal(e.timeline.social_seen_at, NOW - 5 * MIN);
  assert.equal(e.timeline.community_seen_at, null);
  assert.equal(e.verification, 'official');
  // 기존 6A 필드 호환
  for (const k of ['id', 'title', 'url', 'category', 'symbols', 'importance', 'verification', 'source', 'source_type', 'sources', 'published_at', 'market']) assert.ok(k in e, k);
});

test('status: Telegram 채널별 상태 + Coinpan 비활성 이유, 기존 6A 필드 유지', async () => {
  const db = new FakeD1();
  await run(db, {});
  const s = await call('/api/intelligence/status', { DB: db }, NOW + MIN);
  const ids = s.sources.map((x) => x.id);
  for (const id of ['binance', 'upbit', 'blockmedia', 'coindesk', 'cointelegraph', 'tg-wecryptotogether', 'tg-emperorcoin', 'tg-enjoymyhobby', 'tg-blockmedia']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('coinpan'));
  assert.deepEqual(s.disabled, ['coinpan']);
  assert.match(s.disabled_sources[0].reason, /INTEL_ENABLE=coinpan/);
  assert.ok(s.diagnostics && 'code' in s.diagnostics);
  assert.equal(s.sources.find((x) => x.id === 'tg-blockmedia').status, 'ok');
});

// ── 보안 ──
test('응답 크기 제한(1.5MB) 과 예상 밖 호스트로의 리다이렉트 차단', async () => {
  const huge = 'x'.repeat(1_600_000);
  await assert.rejects(fetchText(async () => new Response(huge), 'https://t.me/s/x', 'text/html'), /응답이 너무 큼/);
  const redirected = new Response('<html></html>');
  Object.defineProperty(redirected, 'url', { value: 'https://evil.example/s/x' });
  await assert.rejects(fetchText(async () => redirected, 'https://t.me/s/x', 'text/html', { allowHosts: ['t.me'] }), /예상 밖 호스트/);
  const ok = new Response('<html></html>');
  Object.defineProperty(ok, 'url', { value: 'https://t.me/s/x' });
  assert.equal(await fetchText(async () => ok, 'https://t.me/s/x', 'text/html', { allowHosts: ['t.me'] }), '<html></html>');
});

test('Telegram 글의 스크립트 삽입은 D1 에 태그로 저장되지 않음', async () => {
  const db = new FakeD1();
  await run(db, { tg: tg('blockmedia', { id: 9, at: NOW, raw: 'BTC <script>alert(1)</script><iframe src=x></iframe><img src=x onerror=alert(2)>', links: ['javascript:alert(3)', 'https://ok.example.com/p'] }) });
  const m = db.rows('SELECT * FROM social_items')[0];
  assert.doesNotMatch(JSON.stringify(m), /<|<script|iframe|onerror/i); // 태그 제거 (화면 텍스트에 남은 문자열은 이스케이프되며 링크가 아님)
  assert.doesNotMatch(m.links, /javascript:/i);
  assert.deepEqual(JSON.parse(m.links).map((l) => l.url), ['https://ok.example.com/p']);
});

// ── Retention / 마이그레이션 / Cron ──
test('retention: Telegram 14일 · 커뮤니티 7일 원본 삭제, 시간별 집계는 90일 보존', async () => {
  const db = new FakeD1();
  await ensureIntelSchema(db);
  const D = 86400000;
  const now = Date.UTC(2026, 9, 1, 3, 0, 0);
  seed(db, { symbol: 'BTC', times: [now - 15 * D, now - 13 * D, now - 30 * 60000], collectedAt: now - 15 * D });
  db.db.exec(`UPDATE social_items SET collected_at = ${now - 13 * D} WHERE event_time = ${now - 13 * D}`);
  db.db.exec(`UPDATE social_items SET collected_at = ${now - 30 * 60000} WHERE event_time = ${now - 30 * 60000}`);
  seed(db, { kind: 'community', source: 'coinpan', symbol: 'BTC', times: [now - 8 * D, now - 6 * D], collectedAt: now - 8 * D });
  db.db.exec(`UPDATE social_items SET collected_at = ${now - 6 * D} WHERE event_time = ${now - 6 * D}`);
  db.db.exec(`INSERT INTO social_hourly VALUES ('telegram','BTC',${now - 100 * D},5,2),('telegram','BTC',${now - 80 * D},5,2)`);
  await pruneSocial(db, now);
  assert.equal(SOCIAL_RETENTION.telegramDays, 14);
  assert.deepEqual(db.rows("SELECT event_time FROM social_items WHERE kind = 'telegram' ORDER BY event_time").map((r) => r.event_time), [now - 13 * D, now - 30 * 60000]);
  assert.deepEqual(db.rows("SELECT event_time FROM social_items WHERE kind = 'community'").map((r) => r.event_time), [now - 6 * D]);
  assert.equal(db.rows("SELECT * FROM social_mentions WHERE kind = 'telegram'").length, 2);
  const hourly = db.rows('SELECT * FROM social_hourly ORDER BY hour_ts');
  assert.ok(hourly.some((h) => h.hour_ts === now - 80 * D)); // 90일 이내 집계 유지
  assert.ok(!hourly.some((h) => h.hour_ts === now - 100 * D)); // 90일 초과 삭제
  assert.ok(hourly.some((h) => h.kind === 'telegram' && h.symbol === 'BTC' && h.hour_ts === Math.floor((now - 30 * 60000) / H) * H && h.mentions === 1)); // 최근 시간 버킷 재계산
});

test('마이그레이션: 6A DB(컬럼 없는 event_clusters)에 소셜 컬럼 추가 + 기존 집계 백필, 재실행해도 안전, 동시 호출 경합 없음', async () => {
  const db = new FakeD1();
  db.db.exec(`CREATE TABLE event_clusters (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, url TEXT NOT NULL, category TEXT NOT NULL, symbols TEXT NOT NULL, importance_base INTEGER NOT NULL, reaction_bonus INTEGER NOT NULL DEFAULT 0, importance INTEGER NOT NULL, verification TEXT NOT NULL, source TEXT NOT NULL, source_type TEXT NOT NULL, sources TEXT NOT NULL, item_count INTEGER NOT NULL, source_count INTEGER NOT NULL, published_known INTEGER NOT NULL, event_time INTEGER NOT NULL, last_time INTEGER NOT NULL, first_seen_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  db.db.exec(`INSERT INTO event_clusters (title,url,category,symbols,importance_base,importance,verification,source,source_type,sources,item_count,source_count,published_known,event_time,last_time,first_seen_at,updated_at) VALUES ('old','https://a.com/1','listing','["SOL"]',60,60,'official','upbit','official','[]',2,1,1,1000,1000,1000,1000)`);
  await Promise.all([ensureIntelSchema(db), ensureIntelSchema(db), ensureIntelSchema(db)]); // 동시 호출
  const cols = db.rows('PRAGMA table_info(event_clusters)').map((c) => c.name);
  for (const c of ['official_count', 'news_count', 'telegram_count', 'community_count', 'official_seen_at', 'social_seen_at', 'community_seen_at']) assert.ok(cols.includes(c), c);
  db.db.exec(`INSERT INTO intelligence_items (source, source_type, source_tier, title, url, url_key, published_at, collected_at, event_time, summary, symbols, category, importance, verification, cluster_id) VALUES ('upbit','official',1,'t','https://a.com/1','a.com/1',500,1000,500,'','[]','listing',60,'official',1), ('coindesk','news',2,'t2','https://a.com/2','a.com/2',600,1000,600,'','[]','listing',30,'news',1)`);
  resetIntelSchemaFlagForTests();
  await ensureIntelSchema(db); // 이미 컬럼이 있으면 건너뜀 (백필도 반복하지 않음)
  assert.equal(db.rows('SELECT telegram_count FROM event_clusters')[0].telegram_count, 0);
  // 새 DB 에서 처음부터 만들어도 동일
  const fresh = new FakeD1();
  resetIntelSchemaFlagForTests();
  await ensureIntelSchema(fresh);
  assert.ok(fresh.rows('PRAGMA table_info(event_clusters)').some((c) => c.name === 'community_seen_at'));
});

test('Cron: */2 는 Telegram 포함 정보 수집, 1분 Cron 은 기존 Upbit 감시만 (t.me 요청 없음)', async () => {
  const seen = [];
  globalThis.fetch = async (u) => { seen.push(new URL(String(u)).hostname); return new Response('x', { status: 500 }); };
  const db = new FakeD1();
  const waits = [];
  // 실행당 CPU 예산 안에서 출처가 돌아가며 수집되므로 몇 번 실행하면 Telegram 도 요청됨 (한 번에 전부 하지 않음)
  for (let k = 0; k < 6; k += 1) {
    waits.length = 0;
    await worker.scheduled({ cron: '*/2 * * * *', scheduledTime: NOW + k * 2 * MIN }, { DB: db }, { waitUntil: (p) => waits.push(p) });
    assert.equal(waits.length, 1);
    await Promise.all(waits);
  }
  assert.ok(seen.includes('t.me'));
  assert.ok(!seen.includes('coinpan.com')); // 기본 비활성
  seen.length = 0; waits.length = 0;
  await worker.scheduled({ cron: '* * * * *', scheduledTime: NOW }, { DB: db }, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  assert.ok(seen.includes('api.upbit.com'));
  assert.ok(!seen.includes('t.me') && !seen.includes('coinpan.com'));
});

test('INTEL_ENABLE/INTEL_DISABLED: Coinpan 활성화(보드 미설정이면 오류만 기록), Telegram 채널 개별 비활성', async () => {
  const db = new FakeD1();
  const log = [];
  const r = await run(db, {}, { env: { INTEL_ENABLE: 'coinpan', INTEL_DISABLED: 'tg-enjoymyhobby' }, log });
  assert.match(r.sources.find((s) => s.id === 'coinpan').error, /COINPAN_BOARDS 미설정/);
  assert.ok(!log.some((l) => l.endsWith('/enjoymyhobby')));
  assert.ok(log.some((l) => l.endsWith('/blockmedia')));
  // 허용되지 않은 호스트의 보드 URL 은 무시 (SSRF 방지)
  const log2 = [];
  const r2 = await run(new FakeD1(), {}, { env: { INTEL_ENABLE: 'coinpan', COINPAN_BOARDS: 'https://evil.example/rss, javascript:alert(1)' }, log2 });
  assert.match(r2.sources.find((s) => s.id === 'coinpan').error, /COINPAN_BOARDS 미설정/);
  assert.ok(!log2.some((l) => l.startsWith('evil.example')));
});

// ── 6B 자체 리뷰에서 찾은 문제의 회귀 테스트 ──
test('Telegram 이 공식 공지보다 먼저 올라온 경우: 나중에 공식 공지가 수집되면 재연결 + 공식 확인 + 관측 순서(Telegram → 공식)', async () => {
  const db = new FakeD1();
  await run(db, { tg: tg('WeCryptoTogether', { id: 1, at: NOW - 12 * MIN, text: '업비트 솔라나 SOL 원화마켓 상장 소문' }) });
  let m = db.rows('SELECT * FROM social_items')[0];
  assert.equal(m.verification, 'unverified'); // 그 시점에는 공식 공지 없음
  assert.equal(m.cluster_id, null);
  // 2분 뒤 Upbit 공식 공지 수집 (공지 게시 NOW-8분: Telegram 보다 4분 늦음)
  await run(db, { upbitNotice: upbitNotices([SOL_NOTICE]), tg: tg('WeCryptoTogether', { id: 1, at: NOW - 12 * MIN, text: '업비트 솔라나 SOL 원화마켓 상장 소문' }) }, { now: NOW + 2 * MIN });
  m = db.rows('SELECT * FROM social_items')[0];
  const c = clusters(db)[0];
  assert.equal(m.cluster_id, c.id);
  assert.equal(m.verification, 'official');
  assert.equal(c.telegram_count, 1);
  assert.ok(c.social_seen_at < c.official_seen_at); // 관측 순서: Telegram → 공식 (인과관계 아님)
  // 같은 글이 다시 수집돼도 집계가 중복 증가하지 않음
  await run(db, { upbitNotice: upbitNotices([SOL_NOTICE]), tg: tg('WeCryptoTogether', { id: 1, at: NOW - 12 * MIN, text: '업비트 솔라나 SOL 원화마켓 상장 소문' }) }, { now: NOW + 4 * MIN });
  assert.equal(clusters(db)[0].telegram_count, 1);
});

test('클러스터 검증이 바뀌면(뉴스 1곳 → 독립 뉴스 2곳) 연결된 소셜 글의 검증 상태도 따라감', async () => {
  const db = new FakeD1();
  const news1 = { coindesk: rss([{ title: 'Upbit lists Solana (SOL) on KRW market', link: 'https://www.coindesk.com/u1', t: NOW - 20 * MIN }]) };
  const t1 = tg('enjoymyhobby', { id: 8, at: NOW - 5 * MIN, text: '업비트 솔라나 SOL 상장 뜸' });
  await run(db, { ...news1, tg: t1 });
  assert.equal(db.rows('SELECT verification FROM social_items')[0].verification, 'news');
  await run(db, { ...news1, cointelegraph: rss([{ title: 'Upbit lists Solana (SOL) on KRW market today', link: 'https://cointelegraph.com/u2', t: NOW - 18 * MIN }]), tg: t1 }, { now: NOW + 2 * MIN });
  assert.equal(clusters(db)[0].verification, 'multi');
  assert.equal(db.rows('SELECT verification FROM social_items')[0].verification, 'multi');
});

test('오래된 글만 있는 채널: 14일 지난 글은 저장·분석하지 않음 (DB 에는 아무것도 쌓이지 않음)', async () => {
  const db = new FakeD1();
  const old = tg('emperorcoin', ...Array.from({ length: 5 }, (_, i) => ({ id: 10 + i, at: NOW - 20 * 86400000 - i * H, text: `옛날 글 ${i} BTC` })));
  const r = await run(db, { tg: old });
  assert.equal(r.sources.find((s) => s.id === 'tg-emperorcoin').new, 0);
  assert.equal(db.rows('SELECT * FROM social_items').length, 0);
});

test('Coinpan 보드 URL 호스트 검사: 비슷한 이름(notcoinpan.com)·다른 호스트 거부, 정확한 호스트/서브도메인만 허용', async () => {
  for (const bad of ['https://notcoinpan.com/rss', 'https://coinpan.com.evil.io/rss', 'https://evilcoinpan.com/rss']) {
    const log = [];
    const r = await run(new FakeD1(), {}, { env: { INTEL_ENABLE: 'coinpan', COINPAN_BOARDS: bad }, log });
    assert.match(r.sources.find((s) => s.id === 'coinpan').error, /COINPAN_BOARDS 미설정/, bad);
    assert.ok(!log.some((l) => /notcoinpan|evil/.test(l)), bad);
  }
  const log = [];
  await run(new FakeD1(), { coinpan: rssFeed([]) }, { env: { INTEL_ENABLE: 'coinpan', COINPAN_BOARDS: 'https://www.coinpan.com/free/rss' }, log });
  assert.ok(log.some((l) => l.startsWith('www.coinpan.com'))); // 정확한 호스트의 서브도메인(www)은 허용
});
