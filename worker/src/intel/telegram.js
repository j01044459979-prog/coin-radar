// Telegram 공개 채널 수집 (Phase 6B). 로그인/API ID/Hash/Bot 이 필요 없는 공개 웹 미리보기 https://t.me/s/<채널> 의 HTML 만 읽습니다.
//
// ⚠️ 이 방식은 공식 API 가 아닌 '공개 웹 페이지'의 HTML 구조에 의존합니다. 구조가 바뀌면 파서가 오류를 내고 해당 채널만 "수집 오류"가 됩니다.
//    Bot API 는 관리자가 아닌 채널의 과거 메시지를 읽을 수 없고, MTProto(사용자 API)는 API ID/Hash + 로그인 세션이 필요해 사용하지 않습니다.
// 메시지 전문은 저장하지 않습니다: 짧은 excerpt(최대 280자) + 원문 링크 + 심볼/링크 분석 결과만 저장합니다.
// 작성자/조회자 등 개인 식별 정보는 읽지도 저장하지도 않습니다 (채널 이름은 공개 매체 이름).
import { stripHtml, safeUrl, parseTime } from './text.js';
import { extractLinks, urlsInText } from './links.js';

// ── 채널 목록: 채널을 추가하려면 이 배열에 한 줄 추가하면 됩니다 (enabled: false 로 끌 수도 있음) ──
// reliabilityTier: 3 = Telegram 공개 채널 (공식 확인 근거가 아님). username 은 t.me/<username> 의 이름.
export const TELEGRAM_CHANNELS = [
  { id: 'tg-wecryptotogether', name: 'WeCryptoTogether', username: 'WeCryptoTogether', url: 'https://t.me/WeCryptoTogether', enabled: true, reliabilityTier: 3 },
  { id: 'tg-emperorcoin', name: 'emperorcoin', username: 'emperorcoin', url: 'https://t.me/emperorcoin', enabled: true, reliabilityTier: 3 },
  { id: 'tg-enjoymyhobby', name: 'enjoymyhobby', username: 'enjoymyhobby', url: 'https://t.me/enjoymyhobby', enabled: true, reliabilityTier: 3 },
  { id: 'tg-blockmedia', name: 'blockmedia', username: 'blockmedia', url: 'https://t.me/blockmedia', enabled: true, reliabilityTier: 3 },
];

export const TELEGRAM_PREVIEW = (username) => `https://t.me/s/${username}`;
export const MAX_MESSAGES = 20; // 한 페이지(최근 약 20개)에서 읽을 최대 메시지
const BLOCK_MAX = 9000; // 메시지 한 개에서 읽는 최대 HTML 길이
const EXCERPT_MAX = 280;
const DETECT_MAX = 400; // 심볼 탐지에 쓰는 본문 앞부분 길이 (저장하지 않음)

// 속성값 하나 (data-post="user/123")
function attr(block, name) {
  const i = block.indexOf(name + '="');
  if (i < 0) return null;
  const s = i + name.length + 2;
  const e = block.indexOf('"', s);
  return e < 0 ? null : block.slice(s, e);
}

// class 에 cls 가 들어 있는 첫 태그의 여는 태그 끝('>') 다음 위치. 없으면 -1
function afterOpenTag(block, cls) {
  const i = block.indexOf(cls);
  if (i < 0) return -1;
  const gt = block.indexOf('>', i);
  return gt < 0 ? -1 : gt + 1;
}

// 텍스트 div 내부의 href 들 (본문 링크). 내부 div 는 없다고 가정하고 첫 </div> 까지
function hrefsIn(html) {
  const out = [];
  let from = 0;
  for (let n = 0; n < 12; n += 1) {
    const i = html.indexOf('href="', from);
    if (i < 0) break;
    const e = html.indexOf('"', i + 6);
    if (e < 0) break;
    out.push(html.slice(i + 6, e).replace(/&amp;/g, '&'));
    from = e + 1;
  }
  return out;
}

// 페이지의 메시지 번호만 빠르게 훑습니다 (파싱 비용 없음). 이미 저장된 번호를 건너뛰기 위한 용도.
export function peekMessageIds(html, username) {
  const lower = username.toLowerCase();
  const ids = [];
  for (let i = html.indexOf('data-post="'); i >= 0 && ids.length < 60; i = html.indexOf('data-post="', i + 11)) {
    const e = html.indexOf('"', i + 11);
    const m = e > 0 && /^([A-Za-z0-9_]{3,64})\/(\d{1,12})$/.exec(html.slice(i + 11, e));
    if (m && m[1].toLowerCase() === lower) ids.push(m[2]);
  }
  return ids;
}

// options: { skip: Set(messageId) — 이미 저장된 번호는 파싱하지 않음, limit: 가장 최신 N개만, minTime: 이보다 오래된 글은 건너뜀 }
// 반환: [{ messageId, url, publishedAt(ms|null), text(탐지용 앞부분, 저장 안 함), excerpt, links:[{url,key,kind}], views }]
// 텍스트 없는 메시지(사진만 등)는 건너뜁니다. 채널 페이지인데 메시지가 없으면 [] (빈 채널), Telegram 페이지가 아니면 오류.
export function parseTelegramPreview(html, username, now = Date.now(), options = {}) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('빈 응답');
  const text = html.length > 900_000 ? html.slice(0, 900_000) : html;
  const hasMsg = text.indexOf('tgme_widget_message') >= 0;
  if (!hasMsg) {
    if (text.indexOf('tgme_') >= 0 || text.indexOf('telegram') >= 0 || text.indexOf('Telegram') >= 0) {
      if (text.indexOf('tgme_channel_history') >= 0 || text.indexOf('tgme_header') >= 0) return []; // 메시지 없는 공개 채널
      throw new Error('공개 미리보기가 꺼져 있거나 채널이 아님 (t.me/s/ 페이지에 메시지 영역 없음)');
    }
    throw new Error('Telegram 페이지 형식이 아님');
  }
  const out = [];
  const lower = username.toLowerCase();
  const skip = options.skip || null;
  const limit = options.limit || MAX_MESSAGES;
  // 메시지 블록: data-post="<채널>/<번호>" 를 기준으로 다음 data-post 직전까지
  const starts = [];
  for (let i = text.indexOf('data-post="'); i >= 0 && starts.length < 60; i = text.indexOf('data-post="', i + 11)) starts.push(i);
  for (let k = 0; k < starts.length; k += 1) {
    const block = text.slice(starts[k], Math.min(starts[k + 1] ?? text.length, starts[k] + BLOCK_MAX));
    const post = attr(block, 'data-post');
    const m = post && /^([A-Za-z0-9_]{3,64})\/(\d{1,12})$/.exec(post);
    if (!m || m[1].toLowerCase() !== lower) continue; // 다른 채널 글(전달/인용)은 제외
    if (skip && skip.has(m[2])) continue; // 이미 저장됨 → 파싱 생략 (CPU 절약)
    // 게시시간을 먼저 확인: 보관 기간보다 오래된 글은 본문을 파싱하지 않음 (오래된 글만 있는 채널을 매 실행마다 다시 파싱하지 않도록)
    const dt = block.indexOf('datetime="');
    const when = dt >= 0 ? attr(block.slice(dt - 5), 'datetime') : null;
    const publishedAt = parseTime(when, now);
    if (options.minTime && publishedAt && publishedAt < options.minTime) continue;
    const bodyAt = afterOpenTag(block, 'tgme_widget_message_text');
    if (bodyAt < 0) continue;
    const bodyEnd = block.indexOf('</div>', bodyAt);
    const bodyHtml = block.slice(bodyAt, bodyEnd < 0 ? block.length : bodyEnd);
    const plain = stripHtml(bodyHtml.replace(/<br\s*\/?>/gi, ' '), 4000);
    if (!plain) continue;
    const rawLinks = [...hrefsIn(bodyHtml), ...urlsInText(plain)];
    const pv = block.indexOf('tgme_widget_message_link_preview');
    if (pv >= 0) rawLinks.push(...hrefsIn(block.slice(pv, pv + 600)).slice(0, 1));
    const links = extractLinks(rawLinks.filter((u) => !/^https?:\/\/(t\.me|telegram\.me)\/(s\/)?[A-Za-z0-9_]+\/?$/i.test(u)));
    const vi = afterOpenTag(block, 'tgme_widget_message_views');
    out.push({
      messageId: m[2],
      url: safeUrl(`https://t.me/${m[1]}/${m[2]}`),
      publishedAt,
      text: plain.slice(0, DETECT_MAX),
      excerpt: plain.length > EXCERPT_MAX ? plain.slice(0, EXCERPT_MAX - 1).trimEnd() + '…' : plain,
      links,
      views: vi >= 0 ? parseViews(block.slice(vi, vi + 20)) : null,
    });
  }
  // 최신 limit 개만 (페이지는 오래된 → 최신 순). 나머지는 다음 실행에서 이어서 처리됩니다.
  return out.slice(-Math.min(limit, MAX_MESSAGES));
}

// "1.2K" "3M" "845" → 숫자 (공개된 조회수만, 없으면 null)
export function parseViews(s) {
  const m = /^\s*([\d.,]+)\s*([KkMm])?/.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * (m[2] ? (m[2].toLowerCase() === 'k' ? 1e3 : 1e6) : 1));
}
