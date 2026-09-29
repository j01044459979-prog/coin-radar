// 뉴스/공지 제목에서 관련 코인 심볼을 찾습니다 (deterministic, 순수 함수).
//
// 사전 = 기본 alias(아래 CORE) + 거래소 마켓 목록에서 동적으로 만든 항목(buildDictionary).
// 오탐 방지 규칙:
//  1) 티커는 대문자 그대로 단어 경계에서만 매칭 (소문자 'one', 'in', 'us' 는 무시)
//  2) 일반 단어와 겹치는 티커(ONE, AI, IN, US ...)는 문맥이 명확할 때만: (ONE) · $ONE · ONE/USDT · ONEUSDT · "ONE token/coin"
//  3) 일반 금융 약어(ETF, SEC, USD ...)는 코인으로 보지 않음

// name: 영문/한글 이름 alias (단어 경계, 대소문자 무시). tickers 는 심볼과 같은 문자열.
export const CORE = {
  BTC: ['Bitcoin', '비트코인'], ETH: ['Ethereum', '이더리움'], XRP: ['Ripple', '리플'], SOL: ['Solana', '솔라나'],
  BNB: ['BNB Chain', '바이낸스코인'], DOGE: ['Dogecoin', '도지코인'], ADA: ['Cardano', '카르다노'], TRX: ['Tron', '트론'],
  AVAX: ['Avalanche', '아발란체'], LINK: ['Chainlink', '체인링크'], DOT: ['Polkadot', '폴카닷'], LTC: ['Litecoin', '라이트코인'],
  BCH: ['Bitcoin Cash', '비트코인캐시'], SUI: ['Sui Network', '수이'], TON: ['Toncoin', '톤코인'], XLM: ['Stellar', '스텔라루멘'],
  ATOM: ['Cosmos', '코스모스'], NEAR: ['NEAR Protocol', '니어프로토콜'], APT: ['Aptos', '앱토스'], ARB: ['Arbitrum', '아비트럼'],
  OP: ['Optimism', '옵티미즘'], MATIC: ['Polygon', '폴리곤'], POL: [], SHIB: ['Shiba Inu', '시바이누'], PEPE: ['Pepe', '페페'],
  ETC: ['Ethereum Classic', '이더리움클래식'], FIL: ['Filecoin', '파일코인'], HBAR: ['Hedera', '헤데라'], UNI: ['Uniswap', '유니스왑'],
  AAVE: ['Aave', '에이브'], ICP: ['Internet Computer', '인터넷컴퓨터'], ENA: ['Ethena', '에테나'], WLD: ['Worldcoin', '월드코인'],
  ONE: ['Harmony', '하모니'], AI: [], IN: [], US: [], IT: [], ON: [], UP: [], GO: [], BE: [], DO: [], ME: [], HOT: [], SUN: [], FLOW: [],
};

// 대형 코인(중요도 가점용)
export const MEGA = new Set(['BTC', 'ETH']);
export const MAJOR = new Set(['XRP', 'SOL', 'BNB', 'DOGE', 'ADA', 'TRX', 'AVAX', 'LINK', 'DOT', 'LTC', 'BCH', 'SUI', 'TON', 'XLM', 'HBAR', 'SHIB', 'ATOM', 'NEAR', 'UNI', 'APT', 'ARB', 'OP', 'AAVE', 'ETC', 'FIL', 'ICP']);

// 일반 단어와 겹쳐 문맥이 있어야만 인정하는 티커
export const AMBIGUOUS = new Set(['ONE', 'AI', 'IN', 'US', 'IT', 'ON', 'UP', 'GO', 'BE', 'DO', 'ME', 'HOT', 'SUN', 'FLOW', 'OP', 'NOT', 'ALL', 'NEW', 'ANY', 'FOR', 'ARE', 'CAN', 'WAR', 'OPEN', 'LOVE', 'BAT', 'SAFE', 'GAS', 'POWER', 'PLAY', 'TRUE', 'REAL']);
// 코인이 아닌 약어 (사전에 있어도 무시)
export const NOT_COINS = new Set(['ETF', 'SEC', 'USD', 'USA', 'CEO', 'CFO', 'FBI', 'DOJ', 'IPO', 'NFT', 'DEX', 'CEX', 'FUD', 'ATH', 'API', 'KRW', 'EUR', 'GBP', 'JPY', 'CFTC', 'IRS', 'FED', 'FOMC', 'CPI', 'GDP', 'AMA', 'KYC', 'AML', 'DAO', 'TVL', 'APY', 'APR', 'OI', 'UTC', 'KST', 'PR', 'AND', 'THE', 'ETFS', 'DEFI', 'WEB3', 'AIRDROP']);

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isKorean = (s) => /[ㄱ-힝]/.test(s);

// 거래소 마켓 목록으로 사전을 만듭니다. markets: [{ market:'KRW-SOL', korean_name, english_name }]
export function buildDictionary(markets = []) {
  const tickers = new Set(Object.keys(CORE));
  const names = new Map(); // 소문자 이름 → 심볼 (영문 이름)
  const ko = new Map(); // 한글 이름 → 심볼
  for (const [sym, list] of Object.entries(CORE)) {
    for (const n of list) (isKorean(n) ? ko : names).set(isKorean(n) ? n : n.toLowerCase(), sym);
  }
  for (const m of Array.isArray(markets) ? markets : []) {
    const sym = m && typeof m.market === 'string' ? m.market.split('-')[1] : null;
    if (!sym || !/^[A-Z0-9]{2,10}$/.test(sym)) continue;
    tickers.add(sym);
    const en = m.english_name;
    if (typeof en === 'string' && /^[A-Za-z][A-Za-z0-9 .-]{4,30}$/.test(en) && !names.has(en.toLowerCase()) && !AMBIGUOUS.has(en.toUpperCase())) names.set(en.toLowerCase(), sym);
    const kn = m.korean_name;
    if (typeof kn === 'string' && kn.length >= 2 && kn.length <= 12 && !ko.has(kn) && !/[A-Za-z0-9\s]/.test(kn)) ko.set(kn, sym);
  }
  return { tickers, names, ko };
}

function nameRegex(dict) {
  if (dict._re === undefined) {
    const names = [...dict.names.keys()].sort((a, b) => b.length - a.length);
    dict._re = names.length ? new RegExp(`(?<![a-z0-9])(${names.map(escRe).join('|')})(?![a-z0-9])`, 'g') : null;
  }
  return dict._re;
}

let defaultDict = null;
const getDefault = () => (defaultDict ||= buildDictionary());

// 제목에서 심볼 배열 반환 (등장 순서, 중복 없음, 최대 6개)
export function detectSymbols(title, dict = getDefault()) {
  if (typeof title !== 'string' || !title) return [];
  const found = new Map(); // symbol → 첫 등장 위치
  const add = (sym, pos) => { if (!found.has(sym)) found.set(sym, pos); };

  // 1) 티커: 대문자/숫자 2~10자
  for (const m of title.matchAll(/(?<![A-Za-z0-9])\$?([A-Z][A-Z0-9]{1,9})(?![A-Za-z0-9])/g)) {
    const sym = m[1];
    if (NOT_COINS.has(sym) || !dict.tickers.has(sym)) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (AMBIGUOUS.has(sym)) {
      const before = title[start - 1];
      const after = title.slice(end, end + 12);
      const ctx = m[0][0] === '$' || (before === '(' && title[end] === ')') || /^\/(USDT|USDC|BTC|KRW|USD)\b/.test(after) || /^\s+(token|coin)\b/i.test(after);
      if (!ctx) continue;
    } else if (sym.length === 2 && !CORE[sym] && !(title[start - 1] === '(' && title[end] === ')') && !m[0].startsWith('$')) {
      continue; // 2글자 동적 티커는 괄호/$ 문맥에서만 (예: "(XX)")
    }
    add(sym, start);
  }
  // 2) 심볼+USDT 형태 (ONEUSDT 등)
  for (const m of title.matchAll(/(?<![A-Za-z0-9])([A-Z0-9]{2,10})(USDT|USDC)(?![A-Za-z0-9])/g)) {
    if (dict.tickers.has(m[1]) && !NOT_COINS.has(m[1])) add(m[1], m.index);
  }
  // 3) 영문 이름 (단어 경계, 대소문자 무시). 이름 전체를 하나의 정규식으로 미리 만들어 CPU 를 아낍니다.
  const lower = title.toLowerCase();
  const re = nameRegex(dict);
  if (re) for (const m of lower.matchAll(re)) add(dict.names.get(m[1]), m.index + m[0].indexOf(m[1]));
  // 4) 한글 이름 (조사가 붙으므로 부분 문자열 허용, 2자 이상)
  for (const [name, sym] of dict.ko) {
    const i = title.indexOf(name);
    if (i >= 0) add(sym, i);
  }
  // "Bitcoin Cash" 가 있으면 단독 Bitcoin(BTC) 오탐 제거, "Ethereum Classic" 도 동일
  if (found.has('BCH') && !/\bBTC\b/.test(title)) found.delete('BTC');
  if (found.has('ETC') && !/\bETH\b/.test(title)) found.delete('ETH');
  return [...found.entries()].sort((a, b) => a[1] - b[1]).map(([s]) => s).slice(0, 6);
}
