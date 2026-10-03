// 소셜/커뮤니티 전용 코인 별칭 사전 (Phase 6B). 기본 사전(symbols.js CORE + 거래소 마켓 목록)에 더해
// Telegram / 국내 커뮤니티에서 흔한 줄임말·소문자 표기를 인식합니다. 오탐 방지를 위해 규칙이 엄격합니다.

// 소문자로 써도 코인으로 보는 티커 (일반 영어 단어와 겹치지 않는 것만). link, near, dot, sui, ton, atom, one, gas 등은 제외.
export const LOWER_TICKERS = new Set(['btc', 'eth', 'xrp', 'doge', 'bnb', 'ada', 'avax', 'trx', 'ltc', 'bch', 'shib', 'pepe', 'matic', 'sol', 'usdt', 'etc']);

// 한글 줄임말 → 심볼. 2글자 이상: 단어(+조사) 단위로만 매칭. 1글자(솔)는 아래 문맥 규칙까지 통과해야 함.
export const KO_SHORT = {
  비트: 'BTC', 이더: 'ETH', 리플: 'XRP', 솔: 'SOL', 도지: 'DOGE', 에이다: 'ADA', 트론: 'TRX', 라코: 'LTC', 이클: 'ETC', 시바: 'SHIB', 비캐: 'BCH', 폴카: 'DOT', 체링: 'LINK', 아발: 'AVAX',
};

// 한글 단어 뒤에 붙는 조사 (긴 것부터 검사). 1글자 별칭에는 SAFE_PARTICLES 만 허용 ("솔로" 같은 일반 단어 오탐 방지)
export const PARTICLES = ['으로는', '에서는', '이라고', '에서', '으로', '이나', '까지', '부터', '보다', '처럼', '이랑', '은', '는', '이', '가', '을', '를', '의', '도', '만', '에', '로', '와', '과', '랑', '야', '아'];
export const SAFE_PARTICLES = ['은', '는', '이', '가', '을', '를', '도', '만', '의', '랑', '이랑', '아', '야'];

// 1글자 별칭은 시장 문맥 단어가 함께 있을 때만 인정
export const CONTEXT_WORDS = /코인|가격|시세|상승|하락|급등|급락|펌핑|떡상|떡락|존버|물렸|매수|매도|롱|숏|상장|상폐|호재|악재|거래소|업비트|바이낸스|빗썸|\d\s*%|usdt|krw|원화/i;

// 한글 구간(run)에서 줄임말 심볼을 찾습니다. 반환: 심볼 또는 null
export function matchShortKo(run, fullText) {
  let word = run;
  let particle = '';
  for (const p of PARTICLES) {
    if (word.length > p.length && word.endsWith(p) && KO_SHORT[word.slice(0, -p.length)]) {
      particle = p;
      word = word.slice(0, -p.length);
      break;
    }
  }
  const sym = KO_SHORT[word];
  if (!sym) return null;
  if (word.length === 1) {
    if (particle && !SAFE_PARTICLES.includes(particle)) return null;
    if (!CONTEXT_WORDS.test(fullText)) return null;
  }
  return sym;
}
