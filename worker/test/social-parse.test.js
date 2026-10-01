// Phase 6B: Telegram/커뮤니티 파싱 · 링크 · 심볼 별칭 · 관심도 계산 (mock 입력. 실제 t.me / Coinpan 응답이 아님)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTelegramPreview, peekMessageIds, parseViews, TELEGRAM_CHANNELS } from '../src/intel/telegram.js';
import { parseCommunity, COMMUNITY_SOURCES } from '../src/intel/community.js';
import { classifyDomain, extractLinks } from '../src/intel/links.js';
import { detectSymbols, buildDictionary } from '../src/intel/symbols.js';
import { windowStat, attentionScore, WINDOWS, bestVerification, buildAttention } from '../src/intel/attention.js';
import { tgPage, tgEmptyPage, tgNoPreviewPage, rssFeed, boardHtml } from './fixtures/social-fixtures.js';

const NOW = Date.UTC(2026, 9, 1, 3, 0, 0);
const MIN = 60000;
const U = 'WeCryptoTogether';

test('Telegram 채널 설정: 요청된 4개 채널, 모두 Tier 3, 공개 미리보기 주소', () => {
  assert.deepEqual(TELEGRAM_CHANNELS.map((c) => c.username), ['WeCryptoTogether', 'emperorcoin', 'enjoymyhobby', 'blockmedia']);
  assert.ok(TELEGRAM_CHANNELS.every((c) => c.reliabilityTier === 3 && c.enabled && c.url === `https://t.me/${c.username}` && /^tg-[a-z]+$/.test(c.id)));
});

test('Telegram 메시지 파싱: ID · URL · UTC 게시시간 · excerpt · 조회수 · 외부 링크', () => {
  const html = tgPage(U, [
    { id: 101, at: NOW - 8 * MIN, text: '업비트 솔라나(SOL) 원화마켓 상장 공지 https://upbit.com/service_center/notice?id=555', views: '1.2K', links: ['https://www.coindesk.com/markets/x?utm_source=tg'] },
    { id: 102, at: NOW - 3 * MIN, text: 'BTC 상승 중' },
  ]);
  const [a, b] = parseTelegramPreview(html, U, NOW);
  assert.equal(a.messageId, '101');
  assert.equal(a.url, 'https://t.me/WeCryptoTogether/101');
  assert.equal(a.publishedAt, NOW - 8 * MIN);
  assert.equal(a.views, 1200);
  assert.match(a.excerpt, /^업비트 솔라나\(SOL\) 원화마켓 상장 공지/);
  assert.deepEqual(a.links.map((l) => l.kind).sort(), ['news_domain', 'official_domain']); // 본문 URL + 링크 태그 (중복 제거)
  assert.equal(b.messageId, '102');
  assert.equal(b.links.length, 0);
  assert.deepEqual(Object.keys(a).sort(), ['excerpt', 'links', 'messageId', 'publishedAt', 'text', 'url', 'views']); // 작성자/사용자 식별 필드 없음
});

test('Telegram: 한글 텍스트 보존, 텍스트 없는 메시지(사진)·다른 채널 글 제외, 빈 채널은 []', () => {
  const html = tgPage(U, [{ id: 1, at: NOW, text: '비트코인 이더리움 한글 테스트 😀' }, { id: 2, at: NOW, noText: true }, { id: 3, at: NOW, text: '다른 채널 전달 글', other: 'someoneelse' }]);
  const items = parseTelegramPreview(html, U, NOW);
  assert.equal(items.length, 1);
  assert.equal(items[0].excerpt, '비트코인 이더리움 한글 테스트 😀');
  assert.deepEqual(parseTelegramPreview(tgEmptyPage(U), U, NOW), []);
});

test('Telegram malformed: 빈 응답/일반 HTML/미리보기 꺼짐은 오류, 잘린 HTML 은 완성된 메시지만', () => {
  assert.throws(() => parseTelegramPreview('', U, NOW), /빈 응답/);
  assert.throws(() => parseTelegramPreview('<html><body>Just a moment...</body></html>', U, NOW), /Telegram 페이지 형식이 아님/);
  assert.throws(() => parseTelegramPreview(tgNoPreviewPage(U), U, NOW), /미리보기가 꺼져/);
  assert.throws(() => parseTelegramPreview(null, U, NOW));
  const cut = tgPage(U, [{ id: 1, at: NOW, text: 'A first' }, { id: 2, at: NOW, text: 'B second' }]);
  const items = parseTelegramPreview(cut.slice(0, cut.lastIndexOf('<div class="tgme_widget_message_footer') - 5), U, NOW);
  assert.ok(items.length >= 1);
});

test('Telegram 보안: script/iframe/이벤트 핸들러 제거, javascript:/data: 링크 거부, 과대 텍스트 제한', () => {
  const raw = '<b>굵게</b><script>window.__x=1</script><iframe src="//evil.example"></iframe><img src=x onerror="alert(1)"> 본문 <a href="javascript:alert(1)">클릭</a> <a href="data:text/html,<script>1</script>">d</a> <a href="https://ok.example.com/a">ok</a>';
  const [m] = parseTelegramPreview(tgPage(U, [{ id: 7, at: NOW, raw }]), U, NOW);
  assert.doesNotMatch(m.excerpt, /[<>]|script|iframe|onerror|__x/i);
  assert.deepEqual(m.links.map((l) => l.url), ['https://ok.example.com/a']);
  const big = parseTelegramPreview(tgPage(U, [{ id: 8, at: NOW, text: '가'.repeat(50000) }]), U, NOW)[0];
  assert.ok(big.excerpt.length <= 280 && big.text.length <= 400);
});

test('Telegram: peekMessageIds 는 번호만, skip 은 파싱 생략, limit 은 최신 N개', () => {
  const html = tgPage(U, Array.from({ length: 12 }, (_, i) => ({ id: 200 + i, at: NOW - (12 - i) * MIN, text: `메시지 ${i} BTC` })));
  assert.deepEqual(peekMessageIds(html, U), Array.from({ length: 12 }, (_, i) => String(200 + i)));
  const skipped = parseTelegramPreview(html, U, NOW, { skip: new Set(['200', '201', '211']) });
  assert.equal(skipped.length, 9);
  assert.ok(!skipped.some((m) => ['200', '201', '211'].includes(m.messageId)));
  assert.deepEqual(parseTelegramPreview(html, U, NOW, { limit: 3 }).map((m) => m.messageId), ['209', '210', '211']);
  assert.equal(parseViews('1.2K'), 1200);
  assert.equal(parseViews('3M'), 3000000);
  assert.equal(parseViews('845'), 845);
  assert.equal(parseViews('abc'), null);
});

test('링크 분석: 도메인 종류, 위험 URL 제거, 중복/추적 파라미터 정리, 최대 5개', () => {
  assert.equal(classifyDomain('https://www.binance.com/en/support/announcement/abc'), 'official_domain');
  assert.equal(classifyDomain('https://upbit.com/service_center/notice?id=1'), 'official_domain');
  assert.equal(classifyDomain('https://www.blockmedia.co.kr/archives/1'), 'news_domain');
  assert.equal(classifyDomain('https://t.me/foo/1'), 'telegram');
  assert.equal(classifyDomain('https://evil-binance.com.attacker.io/x'), 'other'); // 도메인 끝 일치만 인정
  assert.equal(classifyDomain('https://notbinance.com/x'), 'other');
  const links = extractLinks(['javascript:alert(1)', 'data:text/html,1', 'https://a.com/x?utm_source=1', 'https://a.com/x', 'https://u:p@evil.com', 'https://b.com/1', 'https://c.com/1', 'https://d.com/1', 'https://e.com/1', 'https://f.com/1', 'https://g.com/1']);
  assert.equal(links.length, 5);
  assert.equal(links[0].url, 'https://a.com/x?utm_source=1');
  assert.ok(links.every((l) => /^https:\/\//.test(l.url)));
});

test('커뮤니티 RSS 파싱: ID/제목/게시시간/URL, 작성자 정보는 결과에 없음, 게시시간 없으면 null', () => {
  const xml = rssFeed([{ title: 'XRP 급등 중?', link: 'https://coinpan.com/free/1234567', at: NOW - 5 * MIN, desc: '본문 요약' }, { title: '시간 없는 글', link: 'https://coinpan.com/free/1234568' }]);
  const posts = parseCommunity([xml], ['https://coinpan.com/free/rss'], NOW);
  assert.equal(posts.length, 2);
  assert.deepEqual(posts.map((p) => p.messageId), ['1234567', '1234568']);
  assert.equal(posts[0].publishedAt, NOW - 5 * MIN);
  assert.equal(posts[1].publishedAt, null);
  const json = JSON.stringify(posts);
  assert.doesNotMatch(json, /user123|닉네임A|example\.com \(nick\)/); // author / dc:creator 미저장
  assert.deepEqual(Object.keys(posts[0]).sort(), ['comments', 'excerpt', 'messageId', 'publishedAt', 'title', 'url', 'views']);
});

test('커뮤니티 HTML 목록 파싱: 글 링크/제목/댓글수만, 작성자 칸·외부 호스트·공지 링크 제외', () => {
  const html = boardHtml('coinpan.com', [{ id: 9000001, title: '솔라나 어떻게 보세요', comments: 12, author: '비밀닉네임' }, { id: 9000002, title: '비트코인 폭등', comments: 3 }]);
  const posts = parseCommunity([html], ['https://coinpan.com/free'], NOW);
  assert.deepEqual(posts.map((p) => [p.messageId, p.title, p.comments]), [['9000001', '솔라나 어떻게 보세요', 12], ['9000002', '비트코인 폭등', 3]]);
  assert.doesNotMatch(JSON.stringify(posts), /비밀닉네임|member_/);
  assert.ok(posts.every((p) => p.url.startsWith('https://coinpan.com/')));
  assert.equal(posts[0].views, null); // 안정적으로 읽을 수 없는 값은 null
});

test('커뮤니티: 빈 게시판 · 깨진 응답 · 중복 글', () => {
  assert.deepEqual(parseCommunity(['<html><body></body></html>'], ['https://coinpan.com/free'], NOW), []);
  assert.deepEqual(parseCommunity(['garbage <<<>>> not html'], ['https://coinpan.com/free'], NOW), []);
  assert.throws(() => parseCommunity(['<rss><channel><item><title>x</title>'], ['https://coinpan.com/rss'], NOW).length === 0 && (() => { throw new Error('빈'); })());
  const html = boardHtml('coinpan.com', [{ id: 5555, title: '같은 글' }, { id: 5555, title: '같은 글' }]);
  assert.equal(parseCommunity([html, html], ['https://coinpan.com/a', 'https://coinpan.com/b'], NOW).length, 1);
});

test('Coinpan adapter 는 기본 비활성 (RSS/robots/이용조건 미확인)', () => {
  assert.equal(COMMUNITY_SOURCES[0].enabled, false);
  assert.match(COMMUNITY_SOURCES[0].reason, /INTEL_ENABLE=coinpan/);
});

const dict = buildDictionary([{ market: 'KRW-GAS', korean_name: '가스', english_name: 'Gas' }, { market: 'KRW-ONE', korean_name: '하모니', english_name: 'Harmony' }, { market: 'KRW-SOL', korean_name: '솔라나', english_name: 'Solana' }]);
const sym = (t) => detectSymbols(t, dict, { social: true });

test('소셜 심볼 별칭: 한글 이름/줄임말/소문자 티커/캐시태그', () => {
  assert.deepEqual(sym('비트코인 이더리움 솔라나 리플 도지코인 가즈아'), ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE']);
  assert.deepEqual(sym('비트 오른다 이더 도 같이 간다'), ['BTC', 'ETH']);
  assert.deepEqual(sym('오늘 비트가 많이 올랐다'), ['BTC']); // 조사 '가'
  assert.deepEqual(sym('솔이 오늘 급등 상승 중이네'), ['SOL']); // 1글자 별칭: 안전한 조사 + 시장 문맥
  assert.deepEqual(sym('btc eth sol doge 다 오름'), ['BTC', 'ETH', 'SOL', 'DOGE']);
  assert.deepEqual(sym('$sol 가즈아 $doge'), ['SOL', 'DOGE']);
});

test('소셜 심볼 오탐 방지: 솔직히/솔로/GAS/ONE/IN/US/AI/link/near 같은 일반 단어', () => {
  assert.deepEqual(sym('솔직히 말해서 솔로 탈출'), []);
  assert.deepEqual(sym('솔이 먹은 점심'), []); // 시장 문맥 없음
  assert.deepEqual(sym('이번 gas fee 는 비싸다 in us'), []);
  assert.deepEqual(sym('number ONE AI in the US'), []);
  assert.deepEqual(sym('click the link near the dot'), []); // 소문자 link/near/dot 는 코인 아님
  assert.deepEqual(sym('가스 값이 올랐다'), ['GAS']); // 한글 이름은 거래소 마켓 사전에 있을 때 인정 (이름 '가스' 가 사전에 등록된 경우)
  assert.deepEqual(sym('하모니 (ONE) 상장'), ['ONE']); // 문맥이 있는 경우만
  assert.deepEqual(sym('비트코인캐시'), ['BCH']);
  assert.deepEqual(detectSymbols('btc is up', dict), []); // social 옵션 없이는 소문자 티커 무시 (뉴스/공지 규칙 유지)
});

test('관심도 창 계산: 배수 · 데이터 축적 중 · 새로 등장 · 비교 불가', () => {
  const [w15, w1h] = WINDOWS;
  const H = 3600000;
  // 1시간 12건, 직전 24시간 평균 시간당 3건(=72건) → 4.0배
  assert.deepEqual(windowStat(w1h, 12, 72, 30 * H), { count: 12, ratio: 4, state: 'ok' });
  assert.deepEqual(windowStat(w1h, 12, 72, 5 * H), { count: 12, ratio: null, state: 'insufficient' }); // 수집 12시간 미만 → 배수 계산 안 함
  assert.equal(windowStat(w1h, 5, 0, 30 * H).state, 'new');
  assert.equal(windowStat(w1h, 1, 0, 30 * H).state, 'none');
  assert.equal(windowStat(w15, 3, 6, 10 * H).ratio, 12); // 15분 3건 vs 6시간 6건(15분당 0.25건)
  assert.equal(windowStat(WINDOWS[3], 31, 0, 99 * H).state, 'count_only');
});

test('관심도 점수: deterministic, 증가율·개수·채널·최근성, 부분 데이터는 partial', () => {
  const stats = (r1h, c1h) => ({ '15m': { count: 2, ratio: null, state: 'insufficient' }, '1h': { count: c1h, ratio: r1h, state: r1h ? 'ok' : 'insufficient' }, '6h': { count: c1h, ratio: null, state: 'insufficient' }, '24h': { count: c1h, ratio: null, state: 'count_only' } });
  const a = attentionScore({ kind: 'telegram', stats: stats(4, 8), channels1h: 3, lastAt: NOW - 5 * MIN, now: NOW });
  assert.deepEqual(a, attentionScore({ kind: 'telegram', stats: stats(4, 8), channels1h: 3, lastAt: NOW - 5 * MIN, now: NOW })); // 반복 계산 동일
  assert.equal(a.parts.ratio, 30); // (4-1)/4*40
  assert.equal(a.parts.volume, 20);
  assert.equal(a.parts.channels, 17); // (3-1)/3*25
  assert.equal(a.parts.recency, 15);
  assert.equal(a.score, 82);
  assert.equal(a.partial, false);
  const c = attentionScore({ kind: 'community', stats: stats(3.1, 8), channels1h: 0, lastAt: NOW - 20 * MIN, now: NOW });
  assert.equal(c.parts.ratio, 26); // (3.1-1)/4*50 = 26.25
  assert.equal(c.parts.channels, 0); // 커뮤니티는 채널 다양성 없음
  const partial = attentionScore({ kind: 'community', stats: stats(null, 8), channels1h: 0, lastAt: NOW - 20 * MIN, now: NOW });
  assert.equal(partial.partial, true);
  assert.equal(partial.parts.ratio, 0);
  assert.ok(attentionScore({ kind: 'telegram', stats: stats(100, 100), channels1h: 99, lastAt: NOW, now: NOW }).score <= 100);
  assert.equal(bestVerification(['unverified', 'news', 'official']), 'official');
  assert.equal(bestVerification([]), 'unverified');
  const att = buildAttention('telegram', { symbol: 'SOL', c15: 1, c1h: 12, c6h: 14, c24h: 31, b15: 0, b1h: 72, b6h: 100, ch1h: 2, last: NOW - MIN }, 30 * 3600000, NOW);
  assert.equal(att.stats['1h'].ratio, 4);
  assert.equal(att.stats['24h'].count, 31);
});
