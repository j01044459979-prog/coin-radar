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
