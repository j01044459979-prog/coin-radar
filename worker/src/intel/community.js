// 국내 커뮤니티(Coinpan) 수집 (Phase 6B). '사실 검증' 소스가 아니라 개인투자자 관심도 센서입니다.
//
// ⚠️ 이 adapter 는 기본 **비활성**입니다. coinpan.com 의 RSS/공개 피드 존재 여부, robots.txt, 이용조건을 개발 환경에서 확인하지 못했습니다.
//    확인한 뒤 환경변수 INTEL_ENABLE=coinpan 과 COINPAN_BOARDS(게시판 RSS 또는 목록 URL, 쉼표 구분)를 설정하면 켜집니다.
// 수집: 게시글 ID · 제목 · 게시시간 · URL · (공개되고 안정적으로 읽힐 때만) 조회수/댓글수. 작성자 닉네임·회원 ID·IP 는 읽지도 저장하지도 않습니다.
// 우선순위: ① RSS/Atom → ② HTML 목록(링크 패턴, 최후의 수단)
import { stripHtml, safeUrl, parseTime } from './text.js';
import { parseFeed } from './feed.js';

export const COMMUNITY_SOURCES = [
  {
    id: 'coinpan', name: 'Coinpan', site: 'https://coinpan.com/', enabled: false, reliabilityTier: 4,
    reason: 'RSS/robots/이용조건 미확인 — 확인 후 INTEL_ENABLE=coinpan, COINPAN_BOARDS=<게시판 URL,...> 로 활성화',
    defaultBoards: [], // 게시판 URL 은 사이트 구조를 확인한 뒤 환경변수로 지정
  },
];

export const MAX_POSTS = 30;

// HTML 게시판 목록에서 글 링크 추출: 같은 사이트의 /<게시판>/<숫자ID> 또는 ?document_srl=<숫자> 패턴만.
// 제목은 링크 텍스트(태그 제거). 작성자 칸은 읽지 않습니다.
function parseHtmlList(html, baseUrl, now) {
  const base = new URL(baseUrl);
  const out = [];
  const seen = new Set();
  let from = 0;
  for (let n = 0; n < 400 && out.length < MAX_POSTS; n += 1) {
    const i = html.indexOf('<a ', from);
    if (i < 0) break;
    const gt = html.indexOf('>', i);
    const close = html.indexOf('</a>', gt);
    if (gt < 0 || close < 0) break;
    from = close + 4;
    const tag = html.slice(i, gt);
    const hm = /href=["']([^"']+)["']/.exec(tag);
    if (!hm) continue;
    const url = safeUrl(hm[1].replace(/&amp;/g, '&'), baseUrl);
    if (!url) continue;
    const u = new URL(url);
    if (u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
    const id = /[?&]document_srl=(\d{3,12})\b/.exec(u.search) || /^\/(?:[A-Za-z0-9_]+\/)?(\d{4,12})\/?$/.exec(u.pathname);
    if (!id || seen.has(id[1])) continue;
    const title = stripHtml(html.slice(gt + 1, Math.min(close, gt + 600)), 200);
    if (!title || title.length < 2) continue;
    seen.add(id[1]);
    const tail = html.slice(close, close + 400);
    const cm = /(?:replyNum|reply_count|comment[^"']*)["'][^>]*>\s*\[?(\d{1,5})\]?/i.exec(tail);
    out.push({ messageId: id[1], url, title, publishedAt: null, excerpt: '', views: null, comments: cm ? Number(cm[1]) : null });
  }
  return out;
}

// raw: 게시판별 응답 문자열 배열. 반환: [{ messageId, url, title, publishedAt, excerpt, views, comments }]
export function parseCommunity(raws, baseUrls, now = Date.now()) {
  const out = [];
  let firstErr = null;
  const seen = new Set();
  raws.forEach((raw, i) => {
    try {
      let list;
      if (/<(rss|feed|rdf:RDF)\b/i.test(raw.slice(0, 3000)) && !/<html\b/i.test(raw.slice(0, 500))) {
        list = parseFeed(raw, now, baseUrls[i]).map((f) => {
          const id = /[?&]document_srl=(\d{3,12})\b/.exec(f.url) || /\/(\d{4,12})\/?(?:\?.*)?$/.exec(f.url);
          return { messageId: id ? id[1] : null, url: f.url, title: f.title, publishedAt: f.publishedAt, excerpt: f.summary, views: null, comments: null };
        }).filter((p) => p.messageId);
      } else {
        list = parseHtmlList(raw, baseUrls[i], now);
      }
      for (const p of list) if (!seen.has(p.messageId)) { seen.add(p.messageId); out.push(p); }
    } catch (e) {
      firstErr = firstErr || e;
    }
  });
  if (!out.length && firstErr) throw firstErr;
  return out.slice(0, MAX_POSTS);
}
