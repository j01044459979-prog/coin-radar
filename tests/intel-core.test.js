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

test('출처 상태 문구', () => {
  assert.equal(I.healthText({ label: 'Binance 공지', status: 'ok', last_success_at: NOW - 2 * MIN }, NOW), 'Binance 공지 정상 · 2분 전');
  assert.equal(I.healthText({ label: 'CoinDesk', status: 'delayed', last_success_at: NOW - 17 * MIN }, NOW), 'CoinDesk 지연 · 17분 전');
  assert.equal(I.healthText({ label: 'BlockMedia', status: 'pending', last_success_at: null }, NOW), 'BlockMedia 수집 전');
});
