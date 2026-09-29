// RSS 2.0 / Atom 최소 파서 (외부 의존성 없음, 순수 함수).
// 제목 · 링크 · 게시시간 · 짧은 description 만 뽑고 기사 전문(content:encoded)은 읽지 않습니다.
import { stripHtml, safeUrl, parseTime } from './text.js';

const MAX_XML = 600_000; // 피드 앞부분만 읽음 (CPU 절약)
const MAX_ITEMS = 25;

function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'i'));
  return m ? m[1] : null;
}

function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1]);
  const pick = links.find((a) => /rel=["']alternate["']/i.test(a)) || links.find((a) => !/rel=/i.test(a)) || links[0];
  const h = pick && pick.match(/href=["']([^"']+)["']/i);
  return h ? h[1] : null;
}

// 반환: [{ title, url, publishedAt(ms|null), summary }] (형식 오류 항목은 건너뜀). 피드가 아니면 오류를 던집니다.
export function parseFeed(xml, now = Date.now(), baseUrl) {
  if (typeof xml !== 'string' || !xml.trim()) throw new Error('빈 응답');
  const text = xml.length > MAX_XML ? xml.slice(0, MAX_XML) : xml;
  if (!/<(rss|feed|rdf:RDF)\b/i.test(text) || /<html\b/i.test(text.slice(0, 500))) throw new Error('RSS/Atom 형식이 아님');
  const blocks = [];
  for (const m of text.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
    blocks.push(m[2]);
    if (blocks.length >= MAX_ITEMS) break;
  }
  const out = [];
  for (const b of blocks) {
    const title = stripHtml(tagText(b, 'title'), 300);
    const rawLink = tagText(b, 'link');
    const linkText = rawLink && rawLink.trim() ? stripHtml(rawLink, 2048) : atomLink(b) || tagText(b, 'guid');
    const url = safeUrl(linkText ? stripHtml(linkText, 2048) : '', baseUrl);
    if (!title || !url) continue;
    const when = tagText(b, 'pubDate') || tagText(b, 'published') || tagText(b, 'updated') || tagText(b, 'dc:date');
    const desc = tagText(b, 'description') || tagText(b, 'summary');
    out.push({ title, url, publishedAt: parseTime(when && stripHtml(when, 64), now), summary: stripHtml(desc, 280) });
  }
  return out;
}
