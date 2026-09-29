// 카테고리 · 정보 중요도 · 검증 상태 (deterministic, 제목 키워드 기반). 문서: docs/INTELLIGENCE.md
// 제목에 없는 사실은 추측하지 않습니다. 중요도는 '정보의 중요도'이며 투자 방향 점수가 아닙니다.
import { MEGA, MAJOR } from './symbols.js';

export const TIER = { official: 1, news: 2, social: 3, community: 4 };
export const CATEGORY_LABEL = {
  listing: '상장', delisting: '상장폐지·거래지원 종료', warning: '투자유의', trading: '거래지원', deposit: '입출금', network: '네트워크',
  maintenance: '점검', airdrop: '에어드롭', promotion: '프로모션', security: '보안사고', regulation: '규제·정책', general: '일반',
};

const RULES = {
  delisting: /delist|removal of|will remove|cease (trading|support)|상장\s*폐지|거래\s*지원\s*종료|거래\s*종료/i,
  warning: /유의\s*종목|투자\s*유의|유의\s*촉구|monitoring tag|caution/i,
  listing: /will list|\bto list\b|new listing|lists?\b.*\b(on|with)\b|listing|상장|디지털\s*자산\s*추가|마켓\s*추가|신규\s*거래\s*지원/i,
  airdrop: /airdrop|hodler|에어\s*드[랍롭]/i,
  trading: /will launch|perpetual|will add|launchpool|launchpad|megadrop|trading pair|거래\s*지원|마켓/i,
  network: /network upgrade|hard ?fork|mainnet|network|upgrade|token swap|migration|redenominat|네트워크|하드\s*포크|메인넷|업그레이드|스왑|토큰\s*교환|리브랜딩/i,
  deposit: /deposit|withdraw|입금|출금|입출금|suspend|resume/i,
  maintenance: /maintenance|점검/i,
  promotion: /promotion|campaign|competition|giveaway|reward|voucher|event|이벤트|프로모션|리워드/i,
  security: /hack|exploit|breach|stolen|drain|rug ?pull|security incident|해킹|탈취|보안\s*사고/i,
  regulation: /\bsec\b|\betf\b|lawsuit|regulat|\bban(s|ned)?\b|court|congress|\blaw\b|approv|규제|승인|소송|법안|금융위|금감원|가상자산법/i,
};
const ORDER_OFFICIAL = ['delisting', 'warning', 'listing', 'airdrop', 'trading', 'network', 'deposit', 'maintenance', 'promotion', 'security', 'regulation'];
// 뉴스는 '보안/규제' 를 먼저 봅니다 (예: "SEC approves ETF listing" 은 상장이 아니라 규제 뉴스)
const ORDER_NEWS = ['delisting', 'security', 'regulation', 'warning', 'listing', 'airdrop', 'trading', 'network', 'deposit', 'maintenance', 'promotion'];
const HINT = { 이벤트: 'promotion', 입출금: 'deposit', 서비스: 'general' };

export function detectCategory(title, sourceType = 'news', hint = '') {
  const order = sourceType === 'official' ? ORDER_OFFICIAL : ORDER_NEWS;
  for (const c of order) if (RULES[c].test(title)) return c;
  return HINT[hint] || 'general';
}

const CATEGORY_POINTS = { delisting: 30, listing: 30, security: 26, warning: 22, regulation: 20, trading: 16, network: 14, deposit: 12, airdrop: 8, maintenance: 6, general: 5, promotion: 3 };
const TIER_POINTS = { official: 30, news: 15, social: 8, community: 4 };
const symbolPoints = (symbols) => (symbols.some((s) => MEGA.has(s)) ? 12 : symbols.some((s) => MAJOR.has(s)) ? 8 : symbols.length ? 4 : 0);

// 항목 하나의 기본 중요도 (0~100) = 출처 계층 + 카테고리 + 관련 코인 규모
export function baseImportance({ sourceType, category, symbols }) {
  return Math.min(100, (TIER_POINTS[sourceType] ?? 4) + (CATEGORY_POINTS[category] ?? 5) + symbolPoints(symbols || []));
}
const MULTI_SOURCE_POINTS = 6; // 독립 출처가 하나 늘 때마다
const MULTI_SOURCE_MAX = 18;
export function multiSourceBonus(sourceCount) {
  return Math.min(MULTI_SOURCE_MAX, Math.max(0, sourceCount - 1) * MULTI_SOURCE_POINTS);
}

// 시장 반응 가점: Upbit 1분봉으로 계산한 게시 후 15분/현재 15분 변화율의 절대값 중 큰 값
export function reactionBonus(changes) {
  const vals = (changes || []).filter((v) => typeof v === 'number' && Number.isFinite(v)).map(Math.abs);
  if (!vals.length) return 0;
  const m = Math.max(...vals);
  return m >= 3 ? 10 : m >= 1.5 ? 6 : m >= 0.7 ? 3 : 0;
}

export function clusterImportance(baseMax, sourceCount, bonus = 0) {
  return Math.max(0, Math.min(100, Math.round(baseMax + multiSourceBonus(sourceCount) + bonus)));
}

// 검증 상태: official(공식 확인) | multi(복수 출처 확인) | news(뉴스 보도) | unverified(미확인)
// items: [{ source, sourceType }]. 공식 출처에서 직접 수집한 경우만 '공식 확인'.
export function verificationOf(items) {
  if (items.some((i) => i.sourceType === 'official')) return 'official';
  const news = new Set(items.filter((i) => i.sourceType === 'news').map((i) => i.source));
  if (news.size >= 2) return 'multi';
  if (news.size === 1) return 'news';
  return 'unverified';
}
