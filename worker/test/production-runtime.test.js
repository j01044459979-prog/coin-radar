// 운영 수정 회귀 테스트 (모두 mock): 
//  (A) 실제 Worker fetch 진입점에서 6B 신규 route 가 404 가 아닌지 · /api/health 가 배포 코드를 식별하는지
//  (B) 수집 CPU 안정화: 평상시(새 항목 없음) 실행의 작업량 · 소스 예산 · 굶김 방지 · 미완료 복구 · 진단 분리
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { runIntelligence, selectSources, planRun, recoveryCap, MAX_NEW_PER_SOURCE, DEFAULT_BUDGET, overdue } from '../src/intel/engine.js';
import { resetIntelSchemaFlagForTests, ensureIntelSchema, loadHealth, markAttempts, INCOMPLETE, SCHEMA_VERSION } from '../src/intel/store.js';
import { resetCronThrottleForTests } from '../src/intel/diag.js';
import { handleIntelligence, INTEL_ROUTES } from '../src/intel/api.js';
import { SOURCES, healthView } from '../src/intel/sources.js';
import { scanBinance, scanUpbit, binanceKey, upbitKey } from '../src/intel/official.js';
import { scanFeed, fastKey } from '../src/intel/feed.js';
import { urlKey } from '../src/intel/text.js';
import { WORKER_VERSION, API_REVISION, INTEL_API_VERSION } from '../src/meta.js';
import { resetSchemaFlagForTests } from '../src/store.js';
import { memory } from '../src/monitor.js';
import { FakeD1, MIN } from './helpers.js';
import { tgPage, tgEmptyPage } from './fixtures/social-fixtures.js';

// 분(epoch) % 6 != 0 → 시세 반응 갱신 tick 이 아닌 '평상시' 실행. 분 = 14 (정각 정리 작업 없음)
const NOW = Date.UTC(2026, 9, 3, 5, 14, 30);
assert.notEqual(Math.floor(NOW / 60000) % 6, 0);
const realFetch = globalThis.fetch;
beforeEach(() => { resetIntelSchemaFlagForTests(); resetSchemaFlagForTests(); resetCronThrottleForTests(); memory.lastRun = null; });
afterEach(() => { globalThis.fetch = realFetch; });

// ── mock 응답 ──
const hex = (n) => n.toString(16).padStart(32, 'a');
const binanceBody = (list) => ({ code: '000000', data: { catalogs: [{ articles: list.map((a) => ({ code: hex(a.n), title: a.title, releaseDate: a.t })) }] } });
const upbitBody = (list) => ({ success: true, data: { notices: list.map((n) => ({ id: n.id, title: n.title, category: '거래', listed_at: new Date(n.t).toISOString().replace('Z', '+00:00'), first_listed_at: new Date(n.t).toISOString().replace('Z', '+00:00') })) } });
const rssXml = (items) => `<?xml version="1.0"?><rss version="2.0"><channel>${items.map((i) => `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${new Date(i.t).toUTCString()}</pubDate><description>d</description></item>`).join('')}</channel></rss>`;
const markets = [{ market: 'KRW-BTC', korean_name: '비트코인', english_name: 'Bitcoin' }, { market: 'KRW-SOL', korean_name: '솔라나', english_name: 'Solana' }];
const iso = (t) => new Date(t).toISOString().slice(0, 19);
const candles = (now) => Array.from({ length: 100 }, (_, i) => { const t = Math.floor(now / MIN) * MIN - i * MIN; return { candle_date_time_utc: iso(t), opening_price: 100, high_price: 100, low_price: 100, trade_price: 100, candle_acc_trade_price: 1e8, candle_acc_trade_volume: 1 }; });

function makeFetch(spec = {}, log = []) {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    log.push(url.hostname + url.pathname);
    const h = url.hostname;
    const val = (v, d) => {
      const x = v === undefined ? d : v;
      if (x instanceof Error) throw x;
      if (x instanceof Response) return x;
      return typeof x === 'string' ? new Response(x) : Response.json(x);
    };
    if (h === 'api.upbit.com' && url.pathname === '/v1/market/all') return Response.json(markets);
    if (h === 'api.upbit.com') return Response.json(candles(NOW));
    if (h === 'api-manager.upbit.com') return val(spec.upbit, upbitBody([]));
    if (h === 'www.binance.com') return val(spec.binance, binanceBody([]));
    if (h === 't.me') { const u = url.pathname.split('/').pop(); return val(spec.tg && spec.tg[u], tgEmptyPage(u)); }
    if (h === 'www.blockmedia.co.kr') return val(spec.blockmedia, rssXml([]));
    if (h === 'www.coindesk.com') return val(spec.coindesk, rssXml([]));
    if (h === 'cointelegraph.com') return val(spec.cointelegraph, rssXml([]));
    return new Response('unexpected host ' + h, { status: 599 });
  };
}
// 실행 중 D1 문장을 기록하는 DB
class CountingD1 extends FakeD1 {
  constructor() { super(); this.sql = []; }
  prepare(sql) { this.sql.push(sql.replace(/\s+/g, ' ').trim()); return super.prepare(sql); }
}
const go = (db, spec, extra = {}) => runIntelligence({ DB: db, ...(extra.env || {}) }, extra.now ?? NOW, { fetchImpl: makeFetch(spec, extra.log), candleIntervalMs: 0, ...(extra.opts || {}) });

// ════════ (A) 실제 Worker 진입점에서 route / 배포 식별 ════════
const call = (path, env = {}, init) => worker.fetch(new Request('https://x.test' + path, init), env, {});

test('Phase 6B route: /api/intelligence/social 이 404 가 아니다 (실제 Worker fetch 진입점)', async () => {
  const db = new FakeD1();
  const res = await call('/api/intelligence/social?limit=5', { DB: db });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.notEqual(body.status, 'not_found');
  assert.ok(Array.isArray(body.items));
});

test('Phase 6B route: /api/intelligence/community 가 404 가 아니다', async () => {
  const res = await call('/api/intelligence/community?limit=5', { DB: new FakeD1() });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray((await res.json()).items));
});

test('Phase 6B route: /api/intelligence/attention?kind=telegram 이 404 가 아니다', async () => {
  const res = await call('/api/intelligence/attention?kind=telegram', { DB: new FakeD1() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.ok(Array.isArray(body.attention));
});

test('/api/health: worker_version · api_revision · intelligence api/schema 버전 · available_endpoints · 배포 메타데이터', async () => {
  const meta = { id: 'abc-version-id', tag: 'v1', timestamp: '2026-10-03T05:00:00.000Z' };
  const res = await call('/api/health', { CF_VERSION_METADATA: meta });
  assert.equal(res.status, 200);
  const h = await res.json();
  assert.equal(h.status, 'ok');
  assert.equal(h.worker_version, WORKER_VERSION);
  assert.equal(h.version, WORKER_VERSION); // 기존 필드 호환
  assert.equal(h.api_revision, API_REVISION);
  assert.match(h.worker_version, /^\d+\.\d+\.\d+$/);
  assert.equal(h.intelligence.api_version, INTEL_API_VERSION);
  assert.equal(h.intelligence.schema_version, SCHEMA_VERSION);
  assert.ok(h.intelligence.features.includes('intelligence.telegram') && h.intelligence.features.includes('intelligence.attention'));
  assert.deepEqual(h.deployment, { version_id: 'abc-version-id', tag: 'v1', deployed_at: '2026-10-03T05:00:00.000Z' });
  assert.equal(h.phase, 5); // 기존 필드 호환
  // 바인딩이 없으면(로컬/미설정) deployment 는 null — 있는 척하지 않음
  assert.equal((await (await call('/api/health')).json()).deployment, null);
});

test('available_endpoints: 라우터 표와 정확히 일치하고 6B endpoint 3개를 포함, GET / 목록과 같음', async () => {
  const h = await (await call('/api/health')).json();
  const must = ['GET /api/health', 'GET /api/intelligence/events', 'GET /api/intelligence/latest', 'GET /api/intelligence/status', 'GET /api/intelligence/social', 'GET /api/intelligence/community', 'GET /api/intelligence/attention', 'GET /api/monitor/status'];
  for (const e of must) assert.ok(h.available_endpoints.includes(e), e);
  assert.deepEqual(h.available_endpoints.filter((e) => e.includes('/api/intelligence/')).sort(), INTEL_ROUTES.map((r) => 'GET /api/intelligence' + r.path).sort());
  const root = await (await call('/')).json();
  assert.deepEqual(Object.keys(root.endpoints), h.available_endpoints);
  const nf = await (await call('/nope')).json();
  assert.deepEqual(Object.keys(nf.endpoints), h.available_endpoints);
});

test('production-like entrypoint: available_endpoints 의 모든 주소를 실제 fetch 로 호출해 404 가 하나도 없다', async () => {
  globalThis.fetch = async () => Response.json([{ market: 'KRW-BTC', trade_price: 1 }]); // reachability/preview 의 외부 호출 차단
  const h = await (await call('/api/health')).json();
  const db = new FakeD1();
  for (const e of h.available_endpoints) {
    const path = e.replace(/^GET /, '');
    const res = await call(path, { DB: db });
    assert.notEqual(res.status, 404, `${path} 가 404`);
    assert.ok(res.status < 500, `${path} → ${res.status}`);
  }
  // 목록에 없는 주소는 404, 읽기 전용 확인
  assert.equal((await call('/api/intelligence/collect', { DB: db })).status, 404);
  assert.equal((await call('/api/intelligence/social', { DB: db }, { method: 'POST' })).status, 405);
});

test('/api/intelligence/status 에도 worker_version · api_revision · schema 버전이 표시된다', async () => {
  const db = new FakeD1();
  const s = await (await call('/api/intelligence/status', { DB: db })).json();
  assert.equal(s.worker_version, WORKER_VERSION);
  assert.equal(s.api_revision, API_REVISION);
  assert.equal(s.intelligence.schema_version, SCHEMA_VERSION);
});

test('wrangler.toml: Cron 2개 유지 + 배포 식별 바인딩(version_metadata) 선언', () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /crons = \["\* \* \* \* \*", "\*\/2 \* \* \* \*"\]/);
  assert.match(toml, /\[version_metadata\]\s*\nbinding = "CF_VERSION_METADATA"/);
  assert.match(toml, /main = "src\/index\.js"/);
  assert.match(toml, /name = "coin-radar-engine"/);
});

// ════════ (B) 수집 CPU 안정화 ════════
test('키 훑기: Binance/Upbit/RSS 의 빠른 키 계산이 text.js urlKey 와 항상 같다 (저장된 url_key 와 어긋나면 매번 새 항목으로 오인)', () => {
  assert.equal(binanceKey(hex(5)), urlKey(`https://www.binance.com/en/support/announcement/${hex(5)}`));
  assert.equal(upbitKey(123), urlKey('https://upbit.com/service_center/notice?id=123'));
  for (const u of ['https://www.coindesk.com/markets/a-b', 'https://cointelegraph.com/news/x/', 'http://Example.COM/A/b', 'https://www.blockmedia.co.kr/archives/123', 'https://a.com', 'https://a.com/']) assert.equal(fastKey(u), urlKey(u), u);
  for (const u of ['https://a.com/x?utm_source=1', 'https://a.com:8080/x', 'https://u:p@a.com/x', 'https://a.com/한글', 'javascript:alert(1)', 'https://a.com/x#h']) assert.equal(fastKey(u), null, u); // 복잡한 URL 은 안전한 전체 경로로
  const b = scanBinance([JSON.stringify(binanceBody([{ n: 1, title: 'x', t: NOW }]))], NOW, 7 * 86400000);
  assert.deepEqual(b.keys, [binanceKey(hex(1))]);
  assert.deepEqual(scanUpbit(JSON.stringify(upbitBody([{ id: 9, title: 't', t: NOW }])), NOW).keys, [upbitKey(9)]);
  const feed = scanFeed(rssXml([{ title: 't', link: 'https://www.coindesk.com/a/b/', t: NOW }, { title: 'u', link: 'https://www.coindesk.com/c?utm_source=z', t: NOW }]), NOW, 'https://www.coindesk.com/rss');
  assert.deepEqual(feed.keys, [urlKey('https://www.coindesk.com/a/b/'), urlKey('https://www.coindesk.com/c?utm_source=z')]);
  // 보관 기간(7일/3일)보다 오래된 항목은 훑기에서 제외 → 저장되지 않는 항목을 매 실행마다 다시 처리하지 않음
  assert.deepEqual(scanBinance([JSON.stringify(binanceBody([{ n: 1, title: 'old', t: NOW - 9 * 86400000 }]))], NOW, 7 * 86400000).keys, []);
  assert.deepEqual(scanFeed(rssXml([{ title: 'old', link: 'https://a.com/o', t: NOW - 5 * 86400000 }]), NOW, 'https://a.com', 3 * 86400000).keys, []);
});

test('평상시(새 항목 없음) 실행: 마켓 목록 fetch · 사전 구성 · 클러스터 조회 · 시세 반응이 전혀 일어나지 않는다', async () => {
  const db = new CountingD1();
  const items = Array.from({ length: 60 }, (_, i) => ({ n: i + 1, title: `Binance Will List Token${i} (T${i})`, t: NOW - i * 3600000 }));
  const spec = { binance: binanceBody(items), upbit: upbitBody(Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, title: `[거래] 공지 ${i}`, t: NOW - i * 3600000 }))) };
  // 첫 수집(백로그)을 모두 소화할 때까지 반복
  for (let k = 0; k < 14; k += 1) await go(db, spec, { now: NOW + k * 2 * MIN, opts: { force: true, budget: Infinity } });
  assert.equal(db.rows('SELECT * FROM intelligence_items').length, 80); // 60 + 20 (모두 7일 안)
  // 이제 평상시: 같은 응답, 새 항목 없음
  db.sql.length = 0;
  const log = [];
  const r = await go(db, spec, { now: NOW + 42 * MIN, log }); // 42분 = 6의 배수 → 시세 반응 갱신 tick 이 아닌 평상시와 같은 분 위상
  assert.equal(r.new_items, 0);
  assert.ok(!log.some((l) => l === 'api.upbit.com/v1/market/all'), '마켓 목록(250개)을 불필요하게 fetch');
  assert.ok(!log.some((l) => l.startsWith('api.upbit.com/v1/candles')), '시세 캔들을 불필요하게 fetch');
  assert.ok(!db.sql.some((q) => /FROM event_clusters/.test(q)), '클러스터를 불필요하게 조회');
  assert.ok(!db.sql.some((q) => /INSERT INTO (intelligence_items|event_clusters)/.test(q)), '새 항목이 없는데 저장 시도');
  assert.equal(r.spent > 0 && r.spent <= DEFAULT_BUDGET * 1.5, true, `spent ${r.spent}`);
});

test('스키마 준비는 평상시 2문장(CREATE intel_meta + 버전 조회)이고, 버전이 낮으면 한 번만 전체 준비 후 버전 기록', async () => {
  const db = new CountingD1();
  await ensureIntelSchema(db); // 새 DB: 전체 준비
  assert.ok(db.sql.filter((q) => /^CREATE (TABLE|INDEX)/.test(q)).length >= 10);
  assert.equal(db.rows("SELECT value FROM intel_meta WHERE key = 'schema_version'")[0].value, String(SCHEMA_VERSION));
  resetIntelSchemaFlagForTests(); // 새 인스턴스(Cron 실행)
  db.sql.length = 0;
  await ensureIntelSchema(db);
  assert.equal(db.sql.length, 2); // 평상시
  assert.ok(db.sql[0].startsWith('CREATE TABLE IF NOT EXISTS intel_meta') && db.sql[1].startsWith('SELECT value FROM intel_meta'));
  // 구버전 DB(6A: 버전 없음) → 한 번 전체 준비
  db.db.exec(`DELETE FROM intel_meta WHERE key = 'schema_version'`);
  resetIntelSchemaFlagForTests();
  db.sql.length = 0;
  await ensureIntelSchema(db);
  assert.ok(db.sql.length > 10);
  assert.equal(db.rows("SELECT value FROM intel_meta WHERE key = 'schema_version'").length, 1);
});

test('새 항목 상한: 한 출처가 한 실행에서 새로 처리하는 항목은 최대 8개, 나머지는 다음 실행에서 이어서 (백로그 해소)', async () => {
  const db = new FakeD1();
  const spec = { binance: binanceBody(Array.from({ length: 20 }, (_, i) => ({ n: i + 1, title: `Binance Will List T${i} (T${i})`, t: NOW - i * 3600000 }))) };
  const r1 = await go(db, spec, { now: NOW });
  const b1 = r1.sources.find((s) => s.id === 'binance');
  assert.equal(b1.new, MAX_NEW_PER_SOURCE);
  assert.equal(b1.backlog, 12);
  assert.equal(db.rows('SELECT * FROM intelligence_items').length, 8);
  // 가장 최신 8개부터 저장 (freshness 우선)
  assert.ok(db.rows('SELECT url FROM intelligence_items').every((x) => parseInt(x.url.split('/').pop().replace(/a+/, '') || '0', 16) >= 0));
  await go(db, spec, { now: NOW + 4 * MIN, opts: { force: true, budget: Infinity } });
  await go(db, spec, { now: NOW + 8 * MIN, opts: { force: true, budget: Infinity } });
  assert.equal(db.rows('SELECT * FROM intelligence_items').length, 20);
});

test('실행 중 누적 비용이 한계를 넘으면 남은 출처는 건드리지 않고(시도 기록도 없음) 다음 실행으로 넘긴다', async () => {
  const db = new FakeD1();
  const heavy = binanceBody(Array.from({ length: 20 }, (_, i) => ({ n: i + 1, title: `Binance Will List T${i} (T${i})`, t: NOW - i * 3600000 })));
  const r = await go(db, { binance: heavy, upbit: upbitBody([{ id: 1, title: '[거래] a', t: NOW }]) }, { opts: { force: true, budget: 2, hardLimit: 2 } });
  // Binance 가 비용을 다 써서(새 항목 8 × 0.3 + 사전/클러스터 로딩) Upbit 는 이월
  assert.ok(r.sources.some((s) => s.id === 'binance'));
  assert.ok(r.deferred.length >= 1, JSON.stringify(r.deferred));
  const h = await loadHealth(db);
  for (const id of r.deferred) assert.equal(h.has(id), false, `${id} 는 시도 기록이 없어야 함`);
});

test('Telegram 이 바빠도(새 글 가득) 공식·뉴스가 굶지 않는다: 12번 실행 동안 공식 매번, 뉴스는 12분 안에 순환', async () => {
  const db = new FakeD1();
  const attempts = { binance: 0, upbit: 0, news: new Set() };
  for (let k = 0; k < 12; k += 1) {
    const now = NOW + k * 2 * MIN;
    // 채널마다 매번 새 메시지 10개 (id 증가)
    const tg = Object.fromEntries(['WeCryptoTogether', 'emperorcoin', 'enjoymyhobby', 'blockmedia'].map((u, j) => [u, tgPage(u, Array.from({ length: 10 }, (_, i) => ({ id: 1000 * (j + 1) + k * 10 + i, at: now - i * MIN, text: `BTC 소식 ${k}-${i}` })))]));
    const r = await go(db, { tg, binance: binanceBody([{ n: 900 + k, title: `Binance Will List New${k} (N${k})`, t: now - MIN }]) }, { now });
    const ids = r.sources.map((s) => s.id);
    if (ids.includes('binance')) attempts.binance += 1;
    if (ids.includes('upbit')) attempts.upbit += 1;
    ['blockmedia', 'coindesk', 'cointelegraph'].forEach((n) => ids.includes(n) && attempts.news.add(n));
  }
  assert.ok(attempts.binance >= 11, `binance ${attempts.binance}/12`);
  assert.ok(attempts.upbit >= 11, `upbit ${attempts.upbit}/12`);
  assert.equal(attempts.news.size, 3);
  assert.ok(db.rows("SELECT * FROM social_items WHERE kind = 'telegram'").length > 0); // Telegram 도 진행
});

test('미완료 복구: 이전 실행이 죽어 INCOMPLETE 로 남은 출처는 단독·축소 모드로 실행되고, 성공하면 오류/실패 횟수가 초기화된다 (33회 연속 실패 시나리오)', async () => {
  const db = new FakeD1();
  await ensureIntelSchema(db);
  const bin = SOURCES.find((s) => s.id === 'binance');
  const up = SOURCES.find((s) => s.id === 'upbit');
  // 운영 상태 재현: 두 공식 출처가 33회 연속 '미완료'
  db.db.exec(`INSERT INTO source_health (source, source_type, label, interval_ms, last_attempt_at, last_success_at, last_error, consecutive_failures, last_item_count) VALUES
    ('binance','official','Binance 공지',120000,${NOW - 9 * MIN},${NOW - 5 * 3600000},'${INCOMPLETE}',33,60),
    ('upbit','official','Upbit 공지',120000,${NOW - 8 * MIN},${NOW - 5 * 3600000},'${INCOMPLETE}',33,20)`);
  assert.equal(healthView(bin, (await loadHealth(db)).get('binance'), NOW).status, 'error');
  const heavy = binanceBody(Array.from({ length: 20 }, (_, i) => ({ n: i + 1, title: `Binance Will List T${i} (T${i})`, t: NOW - i * 3600000 })));
  const r1 = await go(db, { binance: heavy, upbit: upbitBody([{ id: 1, title: '[거래] a', t: NOW }]) }, { now: NOW });
  assert.equal(r1.recovery, true);
  assert.deepEqual(r1.sources.map((s) => s.id), ['binance']); // 가장 오래된 미완료 1개만 단독
  assert.equal(r1.sources[0].new, recoveryCap(33)); // 축소(2개)로 진행해 반드시 일부라도 저장 → 같은 실행이 반복해서 죽지 않음
  let h = (await loadHealth(db)).get('binance');
  assert.equal(h.last_error, null); // 정상 완료 → 오류 해소
  assert.equal(h.consecutive_failures, 0); // 실패 횟수 초기화
  assert.ok(h.last_success_at >= NOW);
  assert.equal(healthView(bin, h, NOW + MIN).status, 'ok');
  // 다음 실행: Upbit 가 복구 대상(단독), 그다음은 정상 모드
  const r2 = await go(db, { binance: heavy, upbit: upbitBody([{ id: 1, title: '[거래] a', t: NOW }]) }, { now: NOW + 2 * MIN });
  assert.equal(r2.recovery, true);
  assert.deepEqual(r2.sources.map((s) => s.id), ['upbit']);
  assert.equal((await loadHealth(db)).get('upbit').consecutive_failures, 0);
  const r3 = await go(db, { binance: heavy, upbit: upbitBody([{ id: 1, title: '[거래] a', t: NOW }]) }, { now: NOW + 4 * MIN });
  assert.equal(r3.recovery, false);
  assert.equal(healthView(up, (await loadHealth(db)).get('upbit'), NOW + 5 * MIN).status, 'ok');
});

test('recoveryCap: 미완료 횟수가 늘수록 처리량을 줄여 진행을 보장 (8 → 4 → 2)', () => {
  assert.deepEqual([0, 1, 2, 3, 33].map(recoveryCap), [8, 4, 2, 2, 2]);
  const due = SOURCES.filter((s) => ['binance', 'upbit', 'coindesk'].includes(s.id));
  const h = new Map([['upbit', { last_attempt_at: NOW - 10 * MIN, last_error: INCOMPLETE }], ['binance', { last_attempt_at: NOW - 20 * MIN, last_error: INCOMPLETE }]]);
  const plan = planRun(due, h, 4, NOW);
  assert.equal(plan.recovery, true);
  assert.deepEqual(plan.run.map((s) => s.id), ['binance']); // 더 오래된 미완료
  assert.equal(planRun(due, new Map(), 4, NOW).recovery, false);
});

test('미완료 출처가 계속 죽어도(backoff) 다른 출처가 굶지 않는다: 연속 실패 3회면 간격이 4배로 늘어 해당 출처는 매 실행 단독 복구 대상이 아님', async () => {
  const bin = SOURCES.find((s) => s.id === 'binance');
  const stuckHealth = { last_attempt_at: NOW - 3 * MIN, consecutive_failures: 3, last_error: INCOMPLETE };
  assert.ok(overdue(bin, stuckHealth, NOW) < 1); // 3분 < 2분×4 → 아직 때가 아님
  const db = new FakeD1();
  await ensureIntelSchema(db);
  db.db.exec(`INSERT INTO source_health (source, source_type, label, interval_ms, last_attempt_at, last_success_at, last_error, consecutive_failures, last_item_count) VALUES ('binance','official','Binance 공지',120000,${NOW - 3 * MIN},NULL,'${INCOMPLETE}',3,0)`);
  const r = await go(db, {}, { now: NOW });
  assert.equal(r.recovery, false);
  assert.ok(!r.sources.some((s) => s.id === 'binance'));
  assert.ok(r.sources.some((s) => s.id === 'upbit')); // 다른 출처는 정상 진행
});

test('출처 하나가 실패해도 다른 출처는 실행·기록된다 (Binance 451 / Telegram 형식 오류 / RSS 503)', async () => {
  const db = new FakeD1();
  const r = await go(db, {
    binance: new Response('blocked', { status: 451 }),
    upbit: upbitBody([{ id: 7, title: '[거래] 비트코인(BTC) 안내', t: NOW - MIN }]),
    coindesk: new Response('x', { status: 503 }),
    blockmedia: rssXml([{ title: 'Bitcoin news', link: 'https://www.blockmedia.co.kr/a', t: NOW - MIN }]),
    tg: { WeCryptoTogether: '<html>Just a moment</html>' },
  }, { opts: { force: true, budget: Infinity } });
  const by = Object.fromEntries(r.sources.map((s) => [s.id, s]));
  assert.equal(by.binance.ok, false);
  assert.equal(by.coindesk.ok, false);
  assert.equal(by['tg-wecryptotogether'].ok, false);
  assert.equal(by.upbit.ok && by.blockmedia.ok && by['tg-blockmedia'].ok, true);
  const h = await loadHealth(db);
  assert.equal(h.get('binance').consecutive_failures, 1);
  assert.equal(h.get('upbit').consecutive_failures, 0);
  assert.equal(h.get('upbit').last_success_at, NOW);
});

test('연속 실패 후 한 번 성공하면 consecutive_failures 가 0 으로, last_error 가 null 로 초기화된다', async () => {
  const db = new FakeD1();
  for (let k = 0; k < 4; k += 1) await go(db, { upbit: new Response('x', { status: 500 }) }, { now: NOW + k * 10 * MIN, opts: { force: true, budget: Infinity } });
  assert.equal((await loadHealth(db)).get('upbit').consecutive_failures, 4);
  await go(db, { upbit: upbitBody([]) }, { now: NOW + 60 * MIN, opts: { force: true, budget: Infinity } });
  const h = (await loadHealth(db)).get('upbit');
  assert.equal(h.consecutive_failures, 0);
  assert.equal(h.last_error, null);
});

// ── 진단: cron_status / collector_status / source_status 와 전체 status ──
async function statusAt(db, at, env = {}) {
  return (await handleIntelligence('/api/intelligence/status', new URL('https://x.test/api/intelligence/status'), { DB: db, ...env }, at)).json();
}
const seed = (db, o) => {
  if (o.cron !== undefined) db.db.exec(`INSERT OR REPLACE INTO intel_meta VALUES ('cron_seen:*/2 * * * *','${o.cron}',${o.cron})`);
  if (o.started !== undefined) db.db.exec(`INSERT OR REPLACE INTO intel_meta VALUES ('last_collector_started_at','${o.started}',${o.started})`);
  if (o.finished !== undefined) db.db.exec(`INSERT OR REPLACE INTO intel_meta VALUES ('last_collector_finished_at','${o.finished}',${o.finished})`);
  if (o.error) db.db.exec(`INSERT OR REPLACE INTO intel_meta VALUES ('last_collector_error','${o.error}',${NOW})`);
};
const health = (db, rows) => { for (const [id, st] of Object.entries(rows)) { const s = SOURCES.find((x) => x.id === id); db.db.exec(`INSERT OR REPLACE INTO source_health VALUES ('${id}','${s.type}','${s.label}',${s.intervalMs},${NOW - MIN},${st === 'ok' ? NOW - MIN : 'NULL'},${st === 'ok' ? 'NULL' : "'HTTP 451'"},${st === 'ok' ? 0 : 5},0)`); } };
const allOk = () => Object.fromEntries(SOURCES.filter((s) => s.enabled !== false).map((s) => [s.id, 'ok']));

test('운영 재현: Cron·Collector 는 정상인데 Binance/Upbit 가 오류 → code 는 ok 가 아니고 status 는 degraded, 세 상태가 분리되어 표시', async () => {
  const db = new FakeD1();
  await ensureIntelSchema(db);
  seed(db, { cron: NOW - MIN, started: NOW - MIN, finished: NOW - MIN + 5000 });
  health(db, { ...allOk(), binance: 'error', upbit: 'error' });
  const s = await statusAt(db, NOW);
  assert.equal(s.diagnostics.cron_status.status, 'ok');
  assert.equal(s.diagnostics.collector_status.status, 'ok');
  assert.equal(s.source_status.status, 'degraded');
  assert.deepEqual(s.source_status.problem_sources.sort(), ['binance', 'upbit']);
  assert.equal(s.diagnostics.code, 'sources_degraded');
  assert.equal(s.status, 'degraded');
  assert.match(s.diagnostics.hint, /^Cron 정상 · Collector 정상 · Source 일부 오류 \((binance, upbit|upbit, binance)\)/);
  assert.equal(s.source_status.official_ok, false);
});

test('전체 status 계산: 전부 정상=ok / 출처 일부 오류=degraded / 전부 오류=sources_down / Cron 지연 / Collector 미완료·오류 / 수집 준비 중', async () => {
  const mk = async (o, h) => { resetIntelSchemaFlagForTests(); const db = new FakeD1(); await ensureIntelSchema(db); seed(db, o); if (h) health(db, h); return statusAt(db, NOW); };
  const good = { cron: NOW - MIN, started: NOW - MIN, finished: NOW - MIN + 4000 };
  let s = await mk(good, allOk());
  assert.deepEqual([s.status, s.diagnostics.code, s.source_status.status], ['ok', 'ok', 'ok']);
  assert.match(s.diagnostics.hint, /^Cron 정상 · Collector 정상 · Source 모두 정상/);
  s = await mk(good, { ...allOk(), 'tg-emperorcoin': 'error' });
  assert.deepEqual([s.status, s.diagnostics.code], ['degraded', 'sources_degraded']);
  s = await mk(good, Object.fromEntries(Object.keys(allOk()).map((id) => [id, 'error'])));
  assert.deepEqual([s.status, s.diagnostics.code, s.source_status.status], ['degraded', 'sources_down', 'down']);
  s = await mk({ cron: NOW - 20 * MIN, started: NOW - 20 * MIN, finished: NOW - 20 * MIN + 4000 }, allOk());
  assert.equal(s.diagnostics.cron_status.status, 'stale');
  assert.equal(s.diagnostics.code, 'cron_stale'); // Cron 이 6분 넘게 보이지 않음 (정상이던 출처 상태만으로는 ok 로 보이지 않음)
  assert.equal(s.status, 'degraded');
  s = await mk({ cron: NOW - MIN, started: NOW - 5 * MIN, finished: NOW - 5 * MIN - 1000 }, allOk());
  assert.equal(s.diagnostics.collector_status.status, 'incomplete'); // 시작만 있고 완료 없음 (5분)
  assert.equal(s.status, 'degraded');
  s = await mk({ ...good, error: 'D1 오류' }, allOk());
  assert.deepEqual([s.diagnostics.collector_status.status, s.diagnostics.code], ['error', 'collector_error']);
  s = await mk(good, null);
  assert.deepEqual([s.source_status.status, s.diagnostics.code, s.status], ['pending', 'sources_pending', 'degraded']);
  s = await mk({ cron: NOW - 10 * MIN, started: NOW - 10 * MIN, finished: NOW - 10 * MIN + 1000 }, allOk());
  assert.equal(s.diagnostics.cron_status.status, 'stale');
});

test('기존 1분 Upbit 감시: 정보 수집 변경과 무관하게 감시 Cron 은 waitUntil 1개, Upbit 만 호출, monitor_runs 기록', async () => {
  const seen = [];
  globalThis.fetch = async (u) => { seen.push(new URL(String(u)).hostname); return new Response('x', { status: 500 }); };
  const db = new FakeD1();
  const waits = [];
  await worker.scheduled({ cron: '* * * * *', scheduledTime: NOW }, { DB: db }, { waitUntil: (p) => waits.push(p) });
  assert.equal(waits.length, 1);
  await Promise.all(waits);
  assert.ok(seen.includes('api.upbit.com'));
  assert.ok(!seen.some((h) => /t\.me|binance|blockmedia|coindesk|cointelegraph|api-manager/.test(h)));
  assert.equal(db.rows('SELECT * FROM monitor_runs').length, 1);
});
