// RSS 2.0 / Atom 최소 파서 (외부 의존성 없음, 순수 함수).
// 제목 · 링크 · 게시시간 · 짧은 description 만 뽑고 기사 전문(content:encoded)은 읽지 않습니다.
//
// CPU 절약 (Cloudflare 무료 플랜은 실행당 CPU 약 10ms): 정규식으로 항목 전체를 훑지 않고 indexOf 로 항목 경계를 찾고,
// 항목마다 앞부분(BLOCK_MAX)만 읽습니다. 기사 전문이 들어 있는 큰 피드도 비용이 항목 수에 비례해 일정하게 유지됩니다.
import { stripHtml, safeUrl, parseTime } from './text.js';

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

// 반환: [{ title, url, publishedAt(ms|null), summary }] (형식 오류 항목은 건너뜀). 피드가 아니면 오류를 던집니다.
export function parseFeed(xml, now = Date.now(), baseUrl) {
  if (typeof xml !== 'string' || !xml.trim()) throw new Error('빈 응답');
  const text = xml.length > MAX_XML ? xml.slice(0, MAX_XML) : xml;
  if (!/<(rss|feed|rdf:RDF)\b/i.test(text.slice(0, 4000)) || /<html\b/i.test(text.slice(0, 500))) throw new Error('RSS/Atom 형식이 아님');
  const out = [];
  let pos = 0;
  while (out.length < MAX_ITEMS) {
    const itemAt = text.indexOf('<item', pos);
    const entryAt = text.indexOf('<entry', pos);
    let start = itemAt >= 0 && (entryAt < 0 || itemAt < entryAt) ? itemAt : entryAt;
    if (start < 0) break;
    const kind = start === itemAt ? 'item' : 'entry';
    const c = text.charCodeAt(start + kind.length + 1);
    if (c !== 62 && c !== 32 && c !== 10 && c !== 13 && c !== 9) { pos = start + 1; continue; } // <items>, <entryX> 등
    const gt = text.indexOf('>', start);
    if (gt < 0) break;
    const end = text.indexOf('</' + kind, gt);
    if (end < 0) break; // 잘린 마지막 항목은 버림
    pos = end + kind.length + 3;
    const b = text.slice(gt + 1, Math.min(end, gt + 1 + BLOCK_MAX));
    const title = stripHtml(tagText(b, 'title'), 300);
    const rawLink = tagText(b, 'link');
    const linkText = rawLink && rawLink.trim() ? stripHtml(rawLink, 2048) : atomLink(b) || tagText(b, 'guid');
    const url = safeUrl(linkText ? stripHtml(linkText, 2048) : '', baseUrl);
    if (!title || !url) continue;
    const when = tagText(b, 'pubDate') || tagText(b, 'published') || tagText(b, 'updated') || tagText(b, 'dc:date');
    const desc = tagText(b, 'description') || tagText(b, 'summary');
    out.push({ title, url, publishedAt: parseTime(when && stripHtml(when, 64), now), summary: stripHtml(desc && desc.slice(0, 2000), 280) });
  }
  return out;
}
