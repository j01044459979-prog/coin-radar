// Phase 6A: 텍스트 정리 · RSS/Atom 파싱 · 거래소 공지 파싱 (mock 입력. 실제 사이트 응답이 아님)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripHtml, safeUrl, urlKey, parseTime, decodeEntities } from '../src/intel/text.js';
import { parseFeed } from '../src/intel/feed.js';
import { parseBinanceAnnouncements, parseUpbitNotices } from '../src/intel/official.js';

const NOW = Date.UTC(2026, 8, 29, 3, 0, 0);

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
<item><title><![CDATA[Bitcoin ETF &amp; SEC news]]></title><link>https://example.com/a?utm_source=x</link><pubDate>Tue, 29 Sep 2026 02:50:00 GMT</pubDate><description><![CDATA[<p>Short <b>desc</b><script>alert(1)</script></p>]]></description></item>
<item><title>Second</title><link>https://example.com/b</link><description>plain</description></item>
</channel></rss>`;

test('RSS: 제목/링크/시간/짧은 설명 파싱, 태그·스크립트 제거', () => {
  const items = parseFeed(RSS, NOW);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Bitcoin ETF & SEC news');
  assert.equal(items[0].url, 'https://example.com/a?utm_source=x');
  assert.equal(items[0].publishedAt, Date.UTC(2026, 8, 29, 2, 50, 0));
  assert.equal(items[0].summary, 'Short desc');
  assert.equal(items[1].publishedAt, null); // 게시 시간이 없으면 null (수집 시각으로 대체하지 않음)
});

test('Atom 파싱', () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom title</title><link rel="alternate" href="https://example.com/x"/><published>2026-09-29T02:00:00Z</published><summary>S</summary></entry></feed>`;
  const [a] = parseFeed(atom, NOW);
  assert.equal(a.url, 'https://example.com/x');
  assert.equal(a.publishedAt, Date.UTC(2026, 8, 29, 2, 0, 0));
});

test('malformed feed: 빈 응답 · HTML 페이지 · 잘린 XML', () => {
  assert.throws(() => parseFeed('', NOW));
  assert.throws(() => parseFeed('<html><body>Cloudflare challenge</body></html>', NOW));
  assert.throws(() => parseFeed('not xml at all', NOW));
  // 잘린 XML: 완성된 item 만 사용, 예외 없음
  const cut = RSS.slice(0, RSS.indexOf('<item><title>Second') + 30);
  assert.equal(parseFeed(cut, NOW).length, 1);
  // 제목/링크 없는 항목은 건너뜀
  assert.equal(parseFeed('<rss><channel><item><title></title><link>https://a.com/1</link></item><item><title>t</title></item></channel></rss>', NOW).length, 0);
});

test('XSS: 피드의 스크립트/이벤트 핸들러/인코딩된 태그는 텍스트에서 제거', () => {
  const xml = `<rss><channel><item><title>&lt;img src=x onerror=alert(1)&gt;Hello &lt;script&gt;alert(2)&lt;/script&gt;</title><link>https://example.com/p</link><description>&lt;iframe src="//evil"&gt;&lt;/iframe&gt;ok</description></item></channel></rss>`;
  const [i] = parseFeed(xml, NOW);
  assert.equal(i.title.includes('<'), false);
  assert.equal(i.title.includes('alert(2)'), false);
  assert.equal(i.summary.includes('<'), false);
  assert.equal(stripHtml('<script>bad()</script>text'), 'text');
  assert.equal(stripHtml('a &lt; b'), 'a b'); // 꺾쇠는 제거됨
});

test('위험 URL 거부: javascript:, data:, 사용자정보, 공백', () => {
  for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'file:///etc/passwd', 'https://user:pw@evil.com/', 'https://a.com/ x', '', null, 42]) {
    assert.equal(safeUrl(u), null, String(u));
  }
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeUrl('/relative', 'https://example.com'), 'https://example.com/relative');
  const xml = `<rss><channel><item><title>bad link</title><link>javascript:alert(1)</link></item></channel></rss>`;
  assert.equal(parseFeed(xml, NOW).length, 0);
});

test('urlKey: 추적 파라미터·해시·www·끝 슬래시를 무시', () => {
  assert.equal(urlKey('https://www.Example.com/a/?utm_source=x&b=1#top'), urlKey('https://example.com/a?b=1'));
  assert.notEqual(urlKey('https://example.com/a?id=1'), urlKey('https://example.com/a?id=2'));
});

test('parseTime: 미래(10분 초과)·잘못된 값은 null', () => {
  assert.equal(parseTime(NOW + 3600000, NOW), null);
  assert.equal(parseTime('garbage', NOW), null);
  assert.equal(parseTime(NOW - 1000, NOW), NOW - 1000);
  assert.equal(parseTime(Math.floor((NOW - 5000) / 1000), NOW), NOW - 5000); // 초 단위도 허용
  assert.equal(decodeEntities('&#x41;&#66;&amp;'), 'AB&');
});

test('Binance 공식 공지 파싱: 링크는 공식 공지 주소로 조립, 게시시간(ms)', () => {
  const body = { code: '000000', data: { catalogs: [{ catalogId: 48, articles: [
    { id: 1, code: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', title: 'Binance Will List Solana (SOL)', releaseDate: NOW - 8 * 60000 },
    { id: 2, code: '<script>', title: 'bad code' },
    { id: 3, code: 'ffffffffffffffffffffffffffffffff', title: '<b>Delist</b> X', releaseDate: null },
  ] }] } };
  const items = parseBinanceAnnouncements(body, NOW);
  assert.equal(items.length, 2);
  assert.equal(items[0].url, 'https://www.binance.com/en/support/announcement/a1b2c3d4e5f60718293a4b5c6d7e8f90');
  assert.equal(items[0].publishedAt, NOW - 8 * 60000);
  assert.equal(items[1].title, 'Delist X');
  assert.equal(items[1].publishedAt, null);
  assert.throws(() => parseBinanceAnnouncements({ code: '000002' }, NOW));
  assert.throws(() => parseBinanceAnnouncements(null, NOW));
  assert.throws(() => parseBinanceAnnouncements({ code: '000000', data: {} }, NOW));
});

test('Upbit 공식 공지 파싱', () => {
  const body = { success: true, data: { notices: [
    { id: 5123, title: '[거래] 솔라나(SOL) KRW 마켓 디지털 자산 추가', category: '거래', listed_at: '2026-09-29T11:50:00+09:00', first_listed_at: '2026-09-29T11:50:00+09:00' },
    { id: 'x', title: 'bad id' },
    { id: 7, title: '', listed_at: 'x' },
  ] } };
  const items = parseUpbitNotices(body, NOW);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://upbit.com/service_center/notice?id=5123');
  assert.equal(items[0].publishedAt, Date.UTC(2026, 8, 29, 2, 50, 0));
  assert.equal(items[0].hint, '거래');
  assert.throws(() => parseUpbitNotices({ data: {} }, NOW));
});
