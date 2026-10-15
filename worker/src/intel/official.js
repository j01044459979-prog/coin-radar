// 거래소 공식 공지 파서 (순수 함수). 공지 제목·링크·게시시간만 사용합니다.
import { stripHtml, safeUrl, parseTime } from './text.js';

export const BINANCE_CATALOGS = [
  { id: 48, name: 'New Cryptocurrency Listing' },
  { id: 161, name: 'Delisting' },
  { id: 49, name: 'Latest Binance News' },
];
export const binanceListUrl = (catalogId) =>
  `https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=${catalogId}&pageNo=1&pageSize=20`;
export const UPBIT_NOTICE_API = 'https://api-manager.upbit.com/api/v1/announcements?os=web&page=1&per_page=20&category=all';

// url_key(text.js urlKey)와 같은 값을 URL 파싱 없이 계산 (호스트 소문자·www 제거·끝 슬래시/추적 파라미터 없음). 테스트로 urlKey 와 일치 확인.
export const binanceKey = (code) => `binance.com/en/support/announcement/${code}`;
export const upbitKey = (id) => `upbit.com/service_center/notice?id=${id}`;

// 1단계(싼 훑기): JSON 을 한 번만 파싱해 항목의 키/시각만 뽑고, 비싼 정리(stripHtml, safeUrl)는 build() 에서 새 항목에만.
// bodies: 응답 JSON 문자열 배열(카탈로그별). maxAgeMs 보다 오래된 항목은 저장하지 않으므로 훑기에서 제외.
export function scanBinance(bodies, now, maxAgeMs = Infinity) {
  const entries = [];
  const seen = new Set();
  let firstErr = null;
  let okCount = 0;
  for (const body of bodies) {
    try {
      const j = JSON.parse(body);
      if (!j || typeof j !== 'object') throw new Error('Binance 응답 형식 오류');
      if (j.success === false || (j.code && j.code !== '000000')) throw new Error('Binance 응답 코드 ' + j.code);
      const catalogs = j.data && Array.isArray(j.data.catalogs) ? j.data.catalogs : null;
      const articles = catalogs ? catalogs.flatMap((c) => (Array.isArray(c.articles) ? c.articles : [])) : j.data && Array.isArray(j.data.articles) ? j.data.articles : null;
      if (!articles) throw new Error('Binance 공지 목록이 없음');
      okCount += 1;
      for (const a of articles) {
        if (!a || typeof a.code !== 'string' || !/^[0-9a-f]{16,64}$/i.test(a.code) || seen.has(a.code)) continue;
        const publishedAt = parseTime(a.releaseDate, now);
        if (publishedAt && now - publishedAt > maxAgeMs) continue;
        seen.add(a.code);
        entries.push({ key: binanceKey(a.code), code: a.code, title: a.title, publishedAt });
      }
    } catch (e) {
      firstErr = firstErr || e;
    }
  }
  if (!okCount) throw firstErr || new Error('Binance 응답 없음');
  entries.sort((x, y) => (y.publishedAt || 0) - (x.publishedAt || 0));
  return {
    keys: entries.map((e) => e.key),
    build(skip, limit = Infinity) {
      const out = [];
      for (const e of entries) {
        if (out.length >= limit) break;
        if (skip && skip.has(e.key)) continue;
        const title = stripHtml(e.title, 300);
        const url = safeUrl(`https://www.binance.com/en/support/announcement/${e.code}`);
        if (title && url) out.push({ title, url, publishedAt: e.publishedAt, summary: '' });
      }
      return out;
    },
  };
}

// Upbit 공지 응답 → 같은 구조
export function scanUpbit(body, now, maxAgeMs = Infinity) {
  const j = JSON.parse(body);
  if (!j || typeof j !== 'object') throw new Error('Upbit 공지 응답 형식 오류');
  const notices = j.data && Array.isArray(j.data.notices) ? j.data.notices : null;
  if (!notices) throw new Error('Upbit 공지 목록이 없음');
  const entries = [];
  for (const n of notices) {
    if (!n || !Number.isInteger(n.id) || n.id <= 0) continue;
    const publishedAt = parseTime(n.first_listed_at || n.listed_at, now);
    if (publishedAt && now - publishedAt > maxAgeMs) continue;
    entries.push({ key: upbitKey(n.id), id: n.id, title: n.title, category: n.category, publishedAt });
  }
  entries.sort((x, y) => (y.publishedAt || 0) - (x.publishedAt || 0));
  return {
    keys: entries.map((e) => e.key),
    build(skip, limit = Infinity) {
      const out = [];
      for (const e of entries) {
        if (out.length >= limit) break;
        if (skip && skip.has(e.key)) continue;
        const title = stripHtml(e.title, 300);
        const url = safeUrl(`https://upbit.com/service_center/notice?id=${e.id}`);
        if (title && url) out.push({ title, url, publishedAt: e.publishedAt, summary: '', hint: typeof e.category === 'string' ? stripHtml(e.category, 20) : '' });
      }
      return out;
    },
  };
}

// Binance 공지 목록 응답 → 항목. { code:'000000', data:{ catalogs:[{ articles:[{ code, title, releaseDate }] }] } }
export function parseBinanceAnnouncements(body, now) {
  if (!body || typeof body !== 'object') throw new Error('Binance 응답 형식 오류');
  if (body.success === false || (body.code && body.code !== '000000')) throw new Error('Binance 응답 코드 ' + body.code);
  const catalogs = body.data && Array.isArray(body.data.catalogs) ? body.data.catalogs : null;
  const articles = catalogs ? catalogs.flatMap((c) => (Array.isArray(c.articles) ? c.articles : [])) : body.data && Array.isArray(body.data.articles) ? body.data.articles : null;
  if (!articles) throw new Error('Binance 공지 목록이 없음');
  const out = [];
  for (const a of articles) {
    if (!a || typeof a.code !== 'string' || !/^[0-9a-f]{16,64}$/i.test(a.code)) continue;
    const title = stripHtml(a.title, 300);
    const url = safeUrl(`https://www.binance.com/en/support/announcement/${a.code}`);
    if (!title || !url) continue;
    out.push({ title, url, publishedAt: parseTime(a.releaseDate, now), summary: '' });
  }
  return out;
}

// Upbit 공지 응답 → 항목. { success, data:{ notices:[{ id, title, category, listed_at, first_listed_at }] } }
export function parseUpbitNotices(body, now) {
  if (!body || typeof body !== 'object') throw new Error('Upbit 공지 응답 형식 오류');
  const notices = body.data && Array.isArray(body.data.notices) ? body.data.notices : null;
  if (!notices) throw new Error('Upbit 공지 목록이 없음');
  const out = [];
  for (const n of notices) {
    if (!n || !Number.isInteger(n.id) || n.id <= 0) continue;
    const title = stripHtml(n.title, 300);
    const url = safeUrl(`https://upbit.com/service_center/notice?id=${n.id}`);
    if (!title || !url) continue;
    out.push({ title, url, publishedAt: parseTime(n.first_listed_at || n.listed_at, now), summary: '', hint: typeof n.category === 'string' ? stripHtml(n.category, 20) : '' });
  }
  return out;
}
