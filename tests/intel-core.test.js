// 정보(뉴스/공지) 화면 순수 함수 테스트. 실행: node --test tests/*.test.*
// 아래 이벤트 값은 표시 로직 검증용 테스트 입력이며 서비스 코드에는 들어가지 않습니다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const I = require('../assets/intel-core.js');
const C = require('../assets/radar-core.js');

const NOW = Date.UTC(2026, 8, 29, 3, 10, 0);
const MIN = 60000;
const ev = (o = {}) => ({
  id: 1, title: 'Binance Will List Solana (SOL)', url: 'https://www.binance.com/en/support/announcement/abc', category: 'listing', symbols: ['SOL'], importance: 68,
  verification: 'official', source: 'binance', source_type: 'official', sources: ['binance'], published_at: NOW - 6 * MIN, first_seen_at: NOW - 4 * MIN, market: [], ...o,
});

test('버전은 다른 화면 파일과 같음', () => {
  assert.equal(I.VERSION, C.VERSION);
});

test('상대 시간: 방금 전 / N분 전 / N시간 전 / N일 전', () => {
  assert.equal(I.relTime(NOW - 20000, NOW), '방금 전');
  assert.equal(I.relTime(NOW + 5000, NOW), '방금 전'); // 시계 오차
  assert.equal(I.relTime(NOW - 3 * MIN, NOW), '3분 전');
  assert.equal(I.relTime(NOW - 61 * MIN, NOW), '1시간 전');
  assert.equal(I.relTime(NOW - 26 * 3600000, NOW), '1일 전');
  assert.equal(I.relTime(null, NOW), '');
});

test('KST 시각은 브라우저 시간대와 무관하게 UTC+9', () => {
  assert.equal(I.kstTime(Date.UTC(2026, 8, 29, 3, 10, 0)), '09-29 12:10');
  assert.equal(I.kstTime(Date.UTC(2026, 11, 31, 16, 5, 0)), '01-01 01:05'); // 자정 넘김
  assert.equal(I.kstTime(undefined), '');
});

test('게시 시간이 없으면 수집 시각과 혼동하지 않게 표시', () => {
  assert.match(I.timeText(ev(), NOW), /^6분 전 · 09-29 12:04 KST$/);
  const t = I.timeText(ev({ published_at: null }), NOW);
  assert.match(t, /^게시 시간 미확인 · 수집 4분 전$/);
  assert.doesNotMatch(t, /KST/);
});

test('URL 검증: http(s) 만, javascript/data/사용자정보 거부', () => {
  for (const u of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html;base64,AAAA', 'vbscript:x', '//evil.com', 'https://u:p@evil.com', '', null, undefined, 5]) assert.equal(I.safeUrl(u), null, String(u));
  assert.equal(I.safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
});

test('카드: 새 탭 링크에 noopener noreferrer, 위험 URL 이면 링크 없음', () => {
  const html = I.cardHtml(ev(), { rows: [], note: '' }, NOW);
  assert.match(html, /<a class="ilink" href="https:\/\/www\.binance\.com\/en\/support\/announcement\/abc" target="_blank" rel="noopener noreferrer">원문 보기<\/a>/);
  const bad = I.cardHtml(ev({ url: 'javascript:alert(1)' }), { rows: [] }, NOW);
  assert.doesNotMatch(bad, /javascript:/);
  assert.doesNotMatch(bad, /<a /);
  assert.match(bad, /원문 링크 없음/);
});

test('HTML 이스케이프: 제목/출처/심볼/카테고리의 스크립트가 실행 가능한 태그로 남지 않음', () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>"\'&';
  const html = I.cardHtml(ev({ title: evil, symbols: [evil], source: evil, sources: [evil, 'x'], category: evil, verification: evil, url: 'https://a.com/?q="><script>alert(3)</script>' }), { rows: [{ label: evil, parts: [{ text: evil, cls: evil }] }], note: evil, symbol: evil }, NOW);
  assert.doesNotMatch(html, /<img|<script/i);
  assert.doesNotMatch(html, /onerror=alert\(1\)>/);
  assert.doesNotMatch(html, /"><script/);
  const mini = I.miniHtml(ev({ title: evil, symbols: [evil], source: evil }), NOW);
  assert.doesNotMatch(mini, /<img|<script/i);
});

test('카드 내용: 검증 배지·출처·중요도·카테고리, 다른 출처 수', () => {
  const html = I.cardHtml(ev({ verification: 'multi', source_type: 'news', source: 'coindesk', sources: ['coindesk', 'cointelegraph', 'blockmedia'], importance: 82 }), { rows: [] }, NOW);
  assert.match(html, /복수 출처 확인/);
  assert.match(html, /CoinDesk 외 2곳/);
  assert.match(html, /정보 중요도 <b class="iscore">82<\/b>/);
  assert.match(html, /🚨/); // 70 이상
  assert.match(html, /상장/);
  assert.doesNotMatch(I.cardHtml(ev({ importance: 40 }), { rows: [] }, NOW), /🚨/);
  assert.match(I.cardHtml(ev({ verification: 'unverified', source_type: 'social' }), {}, NOW), /미확인/);
  assert.match(I.cardHtml(ev({ symbols: [] }), {}, NOW), /<b class="isym">상장<\/b>/); // 코인이 없으면 카테고리
});

test('시장 데이터 있음: 값이 있는 줄만 표시, 일부만 있으면 나머지는 수집 중', () => {
  const rows = I.reactionRows({ price5: 0.8, price15: 2.1, ratio: 4.2, oi5: null, oi15: 5.8, fundingPct: 0.011 });
  assert.deepEqual(rows.map((r) => r.label), ['가격 5분 / 15분', '거래 활동', 'OI 5분 / 15분', 'Funding']);
  assert.equal(rows[0].parts[1].text, '+2.10%');
  assert.equal(rows[1].parts[0].text, '4.2배');
  assert.equal(rows[2].parts[0].text, '수집 중'); // OI 5분만 없음
  assert.equal(rows[2].parts[1].text, '+5.80%');
  assert.equal(rows[3].parts[0].text, '+0.0110%');
  const html = I.cardHtml(ev(), { rows, note: '', symbol: 'SOL' }, NOW);
  assert.match(html, /시장 반응 · SOL 기준/);
  assert.match(html, /<i class="up">\+2\.10%<\/i>/);
  assert.match(html, /<i class="wait">수집 중<\/i>/);
});

test('시장 데이터 없음: 임의 숫자 없이 줄 자체를 숨기고 안내 문구만', () => {
  assert.deepEqual(I.reactionRows({}), []);
  assert.deepEqual(I.reactionRows({ price5: null, price15: undefined, ratio: NaN, oi5: null, oi15: null, fundingPct: null, upbit: null }), []);
  const none = I.cardHtml(ev(), { rows: [], note: '데이터 수집 중' }, NOW);
  assert.match(none, /시장 반응 · 데이터 수집 중/);
  assert.doesNotMatch(none, /fgrid/);
  assert.doesNotMatch(none, /\d+\.\d+%/);
  assert.doesNotMatch(I.cardHtml(ev({ symbols: [] }), { rows: [], note: '' }, NOW), /시장 반응/); // 코인 없는 뉴스는 반응 영역 없음
});

test('Upbit 게시 전/후 스냅샷 줄', () => {
  const rows = I.reactionRows({ upbit: { change_pre5: -0.2, change_post5: 1.1, change_post15: null } });
  assert.deepEqual(rows.map((r) => r.label), ['Upbit 게시 후 5분 / 15분', 'Upbit 게시 전 5분']);
  assert.equal(rows[0].parts[1].text, '수집 중');
  assert.equal(rows[1].parts[0].text, '-0.20%');
});

test('필터: 전체/공식/뉴스 × 코인(BTC/ETH/SOL/XRP/기타)', () => {
  const list = [
    ev({ id: 1, symbols: ['BTC'], source_type: 'official' }),
    ev({ id: 2, symbols: ['ETH', 'SOL'], source_type: 'news' }),
    ev({ id: 3, symbols: ['DOGE'], source_type: 'news' }),
    ev({ id: 4, symbols: [], source_type: 'news' }),
    ev({ id: 5, symbols: ['XRP'], source_type: 'official' }),
  ];
  const ids = (k, c) => I.filterEvents(list, k, c).map((e) => e.id);
  assert.deepEqual(ids('all', 'ALL'), [1, 2, 3, 4, 5]);
  assert.deepEqual(ids('official', 'ALL'), [1, 5]);
  assert.deepEqual(ids('news', 'ALL'), [2, 3, 4]);
  assert.deepEqual(ids('all', 'SOL'), [2]);
  assert.deepEqual(ids('all', 'OTHER'), [3, 4]);
  assert.deepEqual(ids('official', 'BTC'), [1]);
  assert.deepEqual(ids('news', 'BTC'), []);
});

test('최근 중요 정보 순위: 중요도 높은 순 + 최신성, 48시간 지난 것 제외', () => {
  const list = [
    ev({ id: 1, importance: 80, published_at: NOW - 30 * 3600000 }), // 80 - 40(상한) = 40
    ev({ id: 2, importance: 60, published_at: NOW - 10 * MIN }), // ≈ 59.75
    ev({ id: 3, importance: 50, published_at: NOW - MIN }), // ≈ 49.9
    ev({ id: 4, importance: 95, published_at: NOW - 60 * 3600000 }), // 48시간 초과 제외
    ev({ id: 5, importance: 60, published_at: null, first_seen_at: NOW - 2 * MIN }), // 게시 시각 없으면 수집 시각 기준
  ];
  assert.deepEqual(I.rankTop(list, NOW, 5).map((e) => e.id), [5, 2, 3, 1]);
  assert.equal(I.rankTop(list, NOW, 2).length, 2);
  assert.deepEqual(I.rankTop([], NOW, 5), []);
});

test('한 줄 요약(전체 레이더): 게시 시간 없는 항목은 수집 시각임을 표시', () => {
  assert.match(I.miniHtml(ev(), NOW), /Binance · 6분 전 · 정보 중요도 68/);
  assert.match(I.miniHtml(ev({ published_at: null }), NOW), /\(수집 시각\)/);
});

test('출처 상태 문구: 정상 / 지연 / 수집 오류 / 수집 준비 중 (첫 수집 전과 장애를 구분)', () => {
  assert.equal(I.healthText({ label: 'Binance 공지', status: 'ok', last_success_at: NOW - 2 * MIN }, NOW), 'Binance 공지 정상 · 2분 전');
  assert.equal(I.healthText({ label: 'CoinDesk', status: 'delayed', last_success_at: NOW - 17 * MIN }, NOW), 'CoinDesk 지연 · 17분 전');
  assert.equal(I.healthText({ label: 'BlockMedia', status: 'pending', last_success_at: null }, NOW), 'BlockMedia 수집 준비 중');
  assert.equal(I.healthText({ label: 'Binance 공지', status: 'error', last_success_at: null }, NOW), 'Binance 공지 수집 오류 · 아직 성공 기록 없음');
  assert.equal(I.healthText({ label: 'CoinDesk', status: 'error', last_success_at: NOW - 30 * MIN }, NOW), 'CoinDesk 수집 오류 · 마지막 성공 30분 전');
});

const S = (...st) => st.map((status, i) => ({ id: 's' + i, label: 'S' + i, status }));

test('전체 상태: Worker API 실패일 때만 "정보 서버 연결 실패"', () => {
  assert.deepEqual(I.overallStatus({ apiFailed: true, hasData: false, loaded: false, sources: [] }), { level: 'err', text: '정보 서버 연결 실패' });
  assert.equal(I.overallStatus({ apiFailed: true, hasData: true, loaded: true, sources: S('ok') }).text, '정보 갱신 지연'); // 이전 데이터가 있으면 서버 실패로 단정하지 않음
  // 출처가 전부 오류여도 API 는 응답한 것이므로 서버 연결 실패가 아님
  assert.doesNotMatch(I.overallStatus({ apiFailed: false, loaded: true, sources: S('error', 'error') }).text, /서버 연결 실패/);
});

test('전체 상태: 첫 수집 전(pending) = 수집 준비 중, "정보 정상" 으로 표시하지 않음', () => {
  assert.deepEqual(I.overallStatus({ loaded: true, sources: S('pending', 'pending', 'pending', 'pending', 'pending') }), { level: 'warn', text: '수집 준비 중' });
  assert.equal(I.overallStatus({ loaded: false, sources: [] }).text, '정보 연결 중');
});

test('전체 상태: 일부 출처만 오류면 그 개수만 표시, 전부 정상이면 정보 정상, 전부 오류면 모든 출처 수집 오류', () => {
  assert.deepEqual(I.overallStatus({ loaded: true, sources: S('ok', 'error', 'ok', 'pending', 'ok') }), { level: 'warn', text: '일부 출처 수집 오류 (1개)' });
  assert.equal(I.overallStatus({ loaded: true, sources: S('ok', 'ok', 'pending') }).text, '정보 정상');
  assert.equal(I.overallStatus({ loaded: true, sources: S('error', 'error', 'pending') }).text, '모든 출처 수집 오류');
  assert.equal(I.overallStatus({ loaded: true, degraded: true, sources: [] }).text, '정보 저장소(D1) 미연결');
  assert.equal(I.overallStatus({ loaded: true, sources: [] }).text, '정보 정상'); // status API 만 실패한 경우 이벤트 목록은 정상
});

test('빈 목록 안내: 수집 준비 중 / 출처 오류 / 필터 결과 없음', () => {
  assert.equal(I.emptyText({ hasEvents: false, sources: S('pending', 'pending') }).title, '수집 준비 중');
  assert.match(I.emptyText({ hasEvents: false, sources: S('error', 'pending') }).sub, /수집 오류/);
  assert.equal(I.emptyText({ hasEvents: false, sources: S('ok') }).title, '아직 수집된 정보가 없습니다');
  assert.equal(I.emptyText({ hasEvents: true, sources: S('ok') }).title, '선택한 조건에 맞는 정보가 없습니다');
});

// ── Phase 6B: Telegram / 커뮤니티 표시 로직 ──
const st = (count, ratio, state) => ({ count, ratio, state });
const att = (o = {}) => ({
  kind: 'telegram', symbol: 'SOL', score: 82, partial: false, channels_1h: 3, last_at: NOW - 4 * MIN, verification: 'unverified', clusters: [],
  stats: { '15m': st(2, null, 'insufficient'), '1h': st(12, 3.4, 'ok'), '6h': st(14, null, 'insufficient'), '24h': st(31, null, 'count_only') }, ...o,
});

test('관심도 창 문구: 배수 / 데이터 축적 중 / 새로 등장 / 개수만', () => {
  assert.equal(I.windowText(st(12, 3.4, 'ok')), '12건 · 평균 대비 3.4배');
  assert.equal(I.windowText(st(2, null, 'insufficient')), '2건 · 데이터 축적 중');
  assert.equal(I.windowText(st(5, null, 'new')), '5건 · 새로 등장');
  assert.equal(I.windowText(st(31, null, 'count_only')), '31건');
  assert.equal(I.windowText(null), '');
  assert.equal(I.bestRatio(att()), 3.4);
  assert.equal(I.bestRatio(att({ stats: { '15m': st(1, null, 'insufficient'), '1h': st(1, null, 'insufficient'), '6h': st(1, null, 'insufficient') } })), null);
});

test('소셜 카드: 소셜 관심도 점수는 정보 중요도와 분리, 검증 배지, 연결 이벤트, 동시 채널 수', () => {
  const html = I.socialCardHtml(att({ verification: 'official', clusters: [{ id: 1, title: 'Upbit SOL 관련 공지', url: 'https://upbit.com/service_center/notice?id=1', verification: 'official' }] }), { rows: [], note: '' }, NOW);
  assert.match(html, /공식 확인/);
  assert.match(html, /소셜 관심도 <b class="iatt">82<\/b>\/100/);
  assert.doesNotMatch(html, /정보 중요도/);
  assert.match(html, /3개 채널\(1시간\)/);
  assert.match(html, /연결 이벤트 · <a href="https:\/\/upbit\.com\/service_center\/notice\?id=1" target="_blank" rel="noopener noreferrer">Upbit SOL 관련 공지<\/a>/);
  assert.match(html, /마지막 언급 4분 전/);
  assert.match(I.socialCardHtml(att(), {}, NOW), /미확인/);
  assert.match(I.socialCardHtml(att({ partial: true }), {}, NOW), /일부 요소 수집 중/);
  assert.match(I.socialCardHtml(att({ kind: 'community' }), {}, NOW), /국내 커뮤니티/);
  assert.doesNotMatch(I.socialCardHtml(att({ kind: 'community' }), {}, NOW), /개 채널/); // 커뮤니티는 채널 수 없음
});

test('소셜 카드 시장 반응: 실제 값 있을 때만, 없으면 안내', () => {
  const rows = I.reactionRows({ price15: 2.1, ratio: 4.2, oi15: 3.0, fundingPct: 0.006 });
  const html = I.socialCardHtml(att(), { rows, note: '', symbol: 'SOL' }, NOW);
  assert.match(html, /시장 반응 · SOL 기준/);
  assert.match(html, /\+0\.0060%/);
  const none = I.socialCardHtml(att(), { rows: [], note: '수집 중' }, NOW);
  assert.match(none, /시장 반응 · 수집 중/);
  assert.doesNotMatch(none, /fgrid"><div><span>가격/);
});

test('소셜 보안: 심볼/채널/excerpt/제목/클러스터 제목의 스크립트와 위험 URL 이스케이프', () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>"\'&';
  const card = I.socialCardHtml(att({ symbol: evil, clusters: [{ title: evil, url: 'javascript:alert(3)' }], kind: evil, verification: evil }), { rows: [], note: evil, symbol: evil }, NOW);
  assert.doesNotMatch(card, /<img|<script/i);
  assert.doesNotMatch(card, /javascript:/);
  const msg = I.socialMessageHtml({ id: 1, kind: 'telegram', channel: evil, url: 'javascript:alert(1)', excerpt: evil, symbols: [evil], verification: evil, published_at: NOW, collected_at: NOW }, NOW);
  assert.doesNotMatch(msg, /<img|<script|javascript:|<a /i);
  const ok = I.socialMessageHtml({ id: 2, kind: 'community', channel: 'Coinpan', url: 'https://coinpan.com/free/1', title: '제목', excerpt: '', symbols: ['XRP'], verification: 'unverified', published_at: null, collected_at: NOW - 3 * MIN }, NOW);
  assert.match(ok, /게시 시간 미확인 · 수집 3분 전/);
  assert.match(ok, /target="_blank" rel="noopener noreferrer">원문 보기/);
  const long = I.socialMessageHtml({ id: 3, kind: 'telegram', channel: 'c', url: 'https://t.me/c/1', excerpt: '가'.repeat(500), symbols: [], verification: 'unverified', published_at: NOW, collected_at: NOW }, NOW);
  assert.ok(long.includes('가'.repeat(139) + '…'));
});

test('소셜 신호 판정: 공식 연결·동시 언급·급증·시장 이상 동시만 통과, 노이즈는 제외, 정렬', () => {
  const list = [
    att({ symbol: 'SOL', verification: 'official' }), // 공식 연결 + 급증(3.4배)
    att({ symbol: 'DOGE', channels_1h: 2, stats: { '15m': st(1, null, 'insufficient'), '1h': st(3, null, 'insufficient'), '6h': st(4, null, 'insufficient') }, score: 41 }), // 2개 채널 동시
    att({ kind: 'community', symbol: 'XRP', channels_1h: 1, score: 74, stats: { '15m': st(8, 3.1, 'ok'), '1h': st(14, 2.2, 'ok'), '6h': st(20, null, 'insufficient') } }), // 커뮤니티 급증
    att({ symbol: 'ZZZ', channels_1h: 1, score: 9, stats: { '15m': st(0, null, 'insufficient'), '1h': st(1, null, 'insufficient'), '6h': st(1, null, 'insufficient') } }), // 노이즈
    att({ symbol: 'ADA', channels_1h: 1, stats: { '15m': st(1, 1.2, 'ok'), '1h': st(2, 1.4, 'ok'), '6h': st(3, 1.1, 'ok') }, score: 30 }), // 배수 낮음 → 제외
    att({ symbol: 'NEW', channels_1h: 1, stats: { '15m': st(0, null, 'none'), '1h': st(4, null, 'new'), '6h': st(4, null, 'new') }, score: 50 }), // 새로 등장
  ];
  const sig = I.socialSignals(list, NOW, new Set(['XRP']));
  assert.deepEqual(sig.map((s) => s.symbol), ['SOL', 'XRP', 'NEW', 'DOGE']);
  assert.equal(sig[0].text, 'SOL · Telegram 3.4x');
  assert.deepEqual(sig[0].reasons, ['linked_official', 'multi_channel', 'surge']);
  assert.equal(sig[1].text, 'XRP · 커뮤니티 3.1x');
  assert.deepEqual(sig[1].reasons, ['surge', 'market']); // 시장 이상과 동시
  assert.equal(sig[2].text, 'NEW · Telegram 새로 등장');
  assert.equal(sig[3].text, 'DOGE · Telegram 2개 채널 동시 언급');
  assert.deepEqual(I.socialSignals([], NOW), []);
  assert.ok(Object.keys(I.REASON_LABEL).length === 4);
});

test('이벤트 카드: 소스별 집계와 관측 순서 (게시 시각을 아는 것만, 인과관계 표현 없음)', () => {
  const e = ev({ counts: { official: 1, news: 2, telegram: 3, community: 0 }, timeline: { first_seen_at: NOW, official_seen_at: NOW - 8 * MIN, social_seen_at: NOW - 5 * MIN, community_seen_at: null } });
  assert.equal(I.countsText(e), '공식 1 · 뉴스 2 · Telegram 3');
  assert.equal(I.countsText(ev()), '');
  assert.match(I.observeOrder(e), /^공식 \d\d:\d\d → Telegram \d\d:\d\d$/);
  assert.equal(I.observeOrder(ev({ timeline: { official_seen_at: NOW - MIN, social_seen_at: null, community_seen_at: null } })), ''); // 1개뿐이면 순서 없음
  assert.equal(I.observeOrder(ev({ timeline: { official_seen_at: NOW, social_seen_at: NOW - 5 * MIN, community_seen_at: NOW - MIN } })).startsWith('Telegram'), true); // 시간순 정렬
  const html = I.cardHtml(e, { rows: [] }, NOW);
  assert.match(html, /<span class="ichip icounts">공식 1 · 뉴스 2 · Telegram 3<\/span>/);
  assert.match(html, /관측 순서 공식 \d\d:\d\d → Telegram/);
  assert.match(html, /title="먼저 관측된 순서일 뿐 인과관계가 아닙니다"/);
  assert.doesNotMatch(html, /때문에|원인|영향으로/); // 인과 표현 금지
  assert.doesNotMatch(I.cardHtml(ev(), { rows: [] }, NOW), /관측 순서|icounts/);
});
