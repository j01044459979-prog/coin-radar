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

const words = (s) => s.toLowerCase().match(/[a-z0-9]+/g) || [];
const isKorean = (s) => /[ㄱ-힝]/.test(s);

// 거래소 마켓 목록으로 사전을 만듭니다. markets: [{ market:'KRW-SOL', korean_name, english_name }]
export function buildDictionary(markets = []) {
  const tickers = new Set(Object.keys(CORE));
  const names = new Map(); // 정규화한 영문 이름(소문자 단어를 공백으로 연결) → 심볼
  const ko = new Map(); // 한글 이름 → 심볼
  let maxWords = 1;
  let maxKo = 2;
  const addName = (n, sym) => {
    if (isKorean(n)) { ko.set(n, sym); maxKo = Math.max(maxKo, n.length); return; }
    const key = words(n).join(' ');
    if (!key) return;
    names.set(key, sym);
    maxWords = Math.max(maxWords, key.split(' ').length);
  };
  for (const [sym, list] of Object.entries(CORE)) for (const n of list) addName(n, sym);
  for (const m of Array.isArray(markets) ? markets : []) {
    const sym = m && typeof m.market === 'string' ? m.market.split('-')[1] : null;
    if (!sym || !/^[A-Z0-9]{2,10}$/.test(sym)) continue;
    tickers.add(sym);
    const en = m.english_name;
    if (typeof en === 'string' && /^[A-Za-z][A-Za-z0-9 .-]{4,30}$/.test(en) && !names.has(words(en).join(' ')) && !AMBIGUOUS.has(en.toUpperCase())) addName(en, sym);
    const kn = m.korean_name;
    if (typeof kn === 'string' && kn.length >= 2 && kn.length <= 12 && !ko.has(kn) && !/[A-Za-z0-9\s]/.test(kn)) addName(kn, sym);
  }
  return { tickers, names, ko, maxWords: Math.min(maxWords, 4), maxKo: Math.min(maxKo, 12) };
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
  // 3) 영문 이름: 소문자 단어를 1~4개씩 묶어 Map 조회 (단어 경계 보장, 큰 정규식 없이 CPU 를 아낌 — 무료 플랜 CPU 10ms)
  if (dict.names.size) {
    const list = [];
    for (const m of title.toLowerCase().matchAll(/[a-z0-9]+/g)) list.push(m);
    for (let i = 0; i < list.length; i += 1) {
      let phrase = '';
      for (let n = 0; n < dict.maxWords && i + n < list.length; n += 1) {
        phrase += (n ? ' ' : '') + list[i + n][0];
        // 단어 사이가 공백/하이픈뿐일 때만 한 이름으로 봄 ("Bitcoin, Cash" 같은 분리는 제외)
        if (n && /[^\s.\-]/.test(title.slice(list[i + n - 1].index + list[i + n - 1][0].length, list[i + n].index))) break;
        const sym = dict.names.get(phrase);
        if (sym) add(sym, list[i].index);
      }
    }
  }
  // 4) 한글 이름: 한글이 연속된 구간에서 2~maxKo 글자 부분 문자열을 조회 (뒤에 조사가 붙어도 매칭)
  if (dict.ko.size && /[\u3131-\uD79D]/.test(title)) {
    for (const run of title.matchAll(/[\u3131-\uD79D]{2,}/g)) {
      const t = run[0];
      for (let i = 0; i < t.length - 1; i += 1) {
        for (let len = 2; len <= dict.maxKo && i + len <= t.length; len += 1) {
          const sym = dict.ko.get(t.slice(i, i + len));
          if (sym) add(sym, run.index + i);
        }
      }
    }
  }
  // "Bitcoin Cash" 가 있으면 단독 Bitcoin(BTC) 오탐 제거, "Ethereum Classic" 도 동일
  if (found.has('BCH') && !/\bBTC\b/.test(title)) found.delete('BTC');
  if (found.has('ETC') && !/\bETH\b/.test(title)) found.delete('ETH');
  return [...found.entries()].sort((a, b) => a[1] - b[1]).map(([s]) => s).slice(0, 6);
}
