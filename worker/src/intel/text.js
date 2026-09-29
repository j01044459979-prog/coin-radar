// 외부 피드/공지 텍스트 정리 (순수 함수). 외부 HTML/스크립트는 저장·표시 전에 모두 제거합니다.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    const v = ENTITIES[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

// HTML 태그/스크립트/스타일/CDATA 래퍼를 제거하고 공백을 정리한 순수 텍스트를 돌려줍니다.
export function stripHtml(input, maxLen = 300) {
  if (input === null || input === undefined) return '';
  let s = String(input).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  s = s.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  s = decodeEntities(s); // 인코딩된 태그(&lt;script&gt;)도 한 번 풀어서 아래에서 다시 제거
  s = s.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ');
  // 남은 꺾쇠는 태그로 오해될 수 있으므로 제거 (화면에서는 추가로 이스케이프함)
  s = s.replace(/[<>]/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > maxLen ? s.slice(0, maxLen - 1).trimEnd() + '…' : s;
}

// http/https 만 허용. javascript:, data: 등은 null. 사용자 정보(user:pass@) 포함 URL 도 거부.
export function safeUrl(raw, base) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 2048 || /[\u0000-\u001f\s]/.test(s)) return null;
  try {
    const u = new URL(s, base);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|source$|cmpid$)/i;
// 같은 글을 같은 키로 인식하기 위한 URL 정규화 (추적 파라미터/해시/끝 슬래시 제거, 호스트 소문자)
export function urlKey(url) {
  const u = new URL(url);
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  const path = u.pathname.replace(/\/+$/, '') || '/';
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  return host + path + (u.search || '');
}

// 발행 시각 → epoch ms. 알 수 없거나 미래(시계 오차 10분 초과)면 null (수집 시각과 혼동하지 않음)
export function parseTime(v, now) {
  if (v === null || v === undefined || v === '') return null;
  const t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(String(v));
  if (!Number.isFinite(t) || t <= 0) return null;
  if (t > now + 10 * 60000) return null;
  return t;
}
