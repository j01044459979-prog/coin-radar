// RSS 2.0 / Atom 최소 파서 (외부 의존성 없음, 순수 함수).
// 제목 · 링크 · 게시시간 · 짧은 description 만 뽑고 기사 전문(content:encoded)은 읽지 않습니다.
//
// CPU 절약 (Cloudflare 무료 플랜은 실행당 CPU 약 10ms):
//  - 정규식으로 항목 전체를 훑지 않고 indexOf 로 항목 경계를 찾고, 항목마다 앞부분(BLOCK_MAX)만 읽습니다.
//  - 2단계 구조: scanFeed() 는 항목의 '링크 키'와 게시시간만 아주 싸게 뽑고, 이미 저장된 항목은 build() 에서 제외해
//    제목/설명 정리(stripHtml) 같은 비싼 작업을 새 항목에만 합니다.
import { stripHtml, safeUrl, parseTime, urlKey } from './text.js';

const MAX_XML = 600_000;
const MAX_ITEMS = 25;
const BLOCK_MAX = 3500; // title/link/pubDate/description 은 항목 앞쪽에 있음

// <tag ...>내용</tag> 의 내용 (첫 번째만). 없으면 null
function tagText(block, tag) {
  const open = block.indexOf('<' + tag);
  if (open < 0) return null;
  const after = block.charCodeAt(open + tag.length + 1);
  if (after !== 62 && after !== 32 && after !== 10 && after !== 13 && after !== 9 && after !== 47) return null; // <tagX> 는 다른 태그
  const gt = block.indexOf('>', open);
  if (gt < 0 || block.charCodeAt(gt - 1) === 47) return null; // <tag/> 자체 닫힘
  const close = block.indexOf('</' + tag, gt);
  return block.slice(gt + 1, close < 0 ? block.length : close);
}

function atomLink(block) {
  let best = null;
  let from = 0;
  for (let n = 0; n < 8; n += 1) {
    const i = block.indexOf('<link', from);
    if (i < 0) break;
    const gt = block.indexOf('>', i);
    if (gt < 0) break;
    const attrs = block.slice(i + 5, gt);
    from = gt + 1;
    const h = /href=["']([^"']+)["']/i.exec(attrs);
    if (!h) continue;
    if (/rel=["']alternate["']/i.test(attrs)) return h[1];
    if (!best && !/rel=/i.test(attrs)) best = h[1];
  }
  return best;
}

// url_key(text.js urlKey)와 같은 값을 URL 파싱 없이 계산하는 빠른 경로. 단순한 ASCII URL(포트·계정·쿼리·해시·특수문자 없음)만 처리하고,
// 그 밖에는 null → 호출자가 안전한 전체 경로(safeUrl + urlKey)로 처리합니다. 결과가 urlKey 와 같은지 테스트로 확인.
export function fastKey(link) {
  const m = /^https?:\/\/([A-Za-z0-9.-]+)(\/[A-Za-z0-9\-._~\/%]*)?$/.exec(link);
  if (!m || m[1].length > 253) return null;
  return m[1].toLowerCase().replace(/^www\./, '') + ((m[2] || '').replace(/\/+$/, '') || '/');
}

const whenOf = (b) => tagText(b, 'pubDate') || tagText(b, 'published') || tagText(b, 'updated') || tagText(b, 'dc:date');

// 1단계(싼 훑기): 피드가 아니면 오류. 반환: { keys, entries, build(skip, limit, maxAgeMs) }
//  keys    : 이미 저장된 항목인지 D1 에서 확인할 url_key 목록 (보관 기간 안의 항목만)
//  build() : skip(이미 저장된 키 집합)에 없는 항목만 제목/설명을 정리해 [{ title, url, publishedAt, summary }] 로. 최신 limit 개.
export function scanFeed(xml, now = Date.now(), baseUrl, maxAgeMs = Infinity) {
  if (typeof xml !== 'string' || !xml.trim()) throw new Error('빈 응답');
  const text = xml.length > MAX_XML ? xml.slice(0, MAX_XML) : xml;
  if (!/<(rss|feed|rdf:RDF)\b/i.test(text.slice(0, 4000)) || /<html\b/i.test(text.slice(0, 500))) throw new Error('RSS/Atom 형식이 아님');
  const entries = [];
  let pos = 0;
  let seen = 0;
  while (seen < MAX_ITEMS) {
    const itemAt = text.indexOf('<item', pos);
    const entryAt = text.indexOf('<entry', pos);
    const start = itemAt >= 0 && (entryAt < 0 || itemAt < entryAt) ? itemAt : entryAt;
    if (start < 0) break;
    const kind = start === itemAt ? 'item' : 'entry';
    const c = text.charCodeAt(start + kind.length + 1);
    if (c !== 62 && c !== 32 && c !== 10 && c !== 13 && c !== 9) { pos = start + 1; continue; } // <items>, <entryX> 등
    const gt = text.indexOf('>', start);
    if (gt < 0) break;
    const end = text.indexOf('</' + kind, gt);
    if (end < 0) break; // 잘린 마지막 항목은 버림
    pos = end + kind.length + 3;
    seen += 1;
    const b = text.slice(gt + 1, Math.min(end, gt + 1 + BLOCK_MAX));
    const rawLink = tagText(b, 'link');
    const linkText = rawLink && rawLink.trim() ? rawLink.trim() : atomLink(b) || tagText(b, 'guid');
    if (!linkText) continue;
    // 빠른 경로: 순수 텍스트 ASCII URL 이면 URL 파싱 없이 키 계산 (검증은 새 항목을 만들 때 safeUrl 로 한 번 더)
    let key = linkText.length < 400 ? fastKey(linkText) : null;
    let url = null;
    if (!key) {
      url = safeUrl(stripHtml(linkText, 2048), baseUrl);
      if (!url) continue;
      try { key = urlKey(url); } catch { continue; }
    }
    const w = whenOf(b);
    const publishedAt = parseTime(w && (/[<&]/.test(w) ? stripHtml(w, 64) : w.trim()), now);
    if (publishedAt && now - publishedAt > maxAgeMs) continue; // 보관 기간보다 오래된 항목은 저장하지 않으므로 매번 다시 보지 않음
    entries.push({ key, url, link: linkText, b, publishedAt });
  }
  return {
    keys: entries.map((e) => e.key),
    build(skip, limit = MAX_ITEMS) {
      const out = [];
      for (const e of entries) {
        if (skip && skip.has(e.key)) continue;
        const title = stripHtml(tagText(e.b, 'title'), 300);
        if (!title) continue;
        const url = e.url || safeUrl(stripHtml(e.link, 2048), baseUrl); // 새 항목만 전체 URL 검증 (javascript: 등 거부)
        if (!url) continue;
        const desc = tagText(e.b, 'description') || tagText(e.b, 'summary');
        out.push({ title, url, publishedAt: e.publishedAt, summary: stripHtml(desc && desc.slice(0, 2000), 280) });
      }
      return out.slice(0, limit); // 피드는 최신 → 오래된 순이므로 앞에서부터 최신 limit 개
    },
  };
}

// 기존 호환: 전체 항목 파싱. 반환: [{ title, url, publishedAt(ms|null), summary }]
export function parseFeed(xml, now = Date.now(), baseUrl) {
  return scanFeed(xml, now, baseUrl).build(null, MAX_ITEMS);
}
