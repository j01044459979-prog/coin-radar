// 외부 링크 분석 (Phase 6B): Telegram/커뮤니티 글 안의 URL 을 안전하게 정리하고 도메인 종류를 분류합니다.
// ⚠️ 도메인 분류는 '공식 확인'이 아닙니다. 공식 확인은 같은 URL 이 실제로 수집된 공식 항목(intelligence_items)과 일치할 때만 승격합니다.
import { safeUrl, urlKey } from './text.js';

// 거래소/프로젝트 '공식' 도메인 (링크 표시용 힌트일 뿐 검증 근거가 아님)
export const OFFICIAL_DOMAINS = ['binance.com', 'upbit.com', 'bithumb.com', 'coinone.co.kr', 'korbit.co.kr', 'okx.com', 'bybit.com', 'coinbase.com', 'kraken.com'];
export const NEWS_DOMAINS = ['blockmedia.co.kr', 'coindesk.com', 'cointelegraph.com', 'theblock.co', 'decrypt.co', 'tokenpost.kr', 'coinness.com'];

const host = (u) => new URL(u).hostname.toLowerCase().replace(/^www\./, '');
const under = (h, list) => list.some((d) => h === d || h.endsWith('.' + d));

export function classifyDomain(url) {
  try {
    const h = host(url);
    if (h === 't.me' || h === 'telegram.me') return 'telegram';
    if (under(h, OFFICIAL_DOMAINS)) return 'official_domain';
    if (under(h, NEWS_DOMAINS)) return 'news_domain';
    return 'other';
  } catch {
    return 'other';
  }
}

// 텍스트/링크 목록에서 안전한 URL 만 최대 max 개: [{ url, key, kind }]
export function extractLinks(rawUrls, max = 5) {
  const out = [];
  const seen = new Set();
  for (const raw of rawUrls) {
    const url = safeUrl(typeof raw === 'string' ? raw.replace(/[).,;]+$/, '') : raw);
    if (!url) continue;
    let key;
    try {
      key = urlKey(url);
    } catch {
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url, key, kind: classifyDomain(url) });
    if (out.length >= max) break;
  }
  return out;
}

// 본문 텍스트에 노출된 URL (태그 제거 후)
export function urlsInText(text) {
  return (String(text).match(/https?:\/\/[^\s<>"'`]+/gi) || []).slice(0, 10);
}
