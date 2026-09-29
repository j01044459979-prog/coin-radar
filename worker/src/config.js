// 서버 감시(Phase 4) 설정. 비밀값은 여기에 넣지 않습니다 (Cloudflare Secret 으로만 읽음).

export const MIN = 60 * 1000;

// 레이더 규칙: 브라우저 Binance 레이더(assets/radar-engine.js)와 같은 기준을 사용합니다.
export const RULES = {
  windows: [1, 5, 15],
  baselineWindows: 12,
  minBaselineWindows: 6,
  priceMovePct: { 1: 0.5, 5: 1.2, 15: 2.0 },
  activityRatio: 1.8,
  volumeAnomalyRatio: 3,
  overheat: { priceMult: 2, ratio: 5 },
  score: { priceFullMult: 2, ratioFull: 5 },
};

// Telegram 알림 규칙 (중요 이벤트만)
export const ALERT = {
  minScore: 60, // 레이더 점수 60 이상일 때만 (과열은 항상 100점)
  surgeRatio: 5, // 거래 활동 5배 이상 = 급증
  // 현재 구간 거래대금 최소 기준 (원). 거래가 적은 종목의 작은 체결로 생기는 잡음 방지
  minWindowKrw: { 1: 50_000_000, 5: 200_000_000, 15: 500_000_000 },
  cooldownMinutes: 30, // 같은 종목은 30분 동안 다시 알리지 않음 (단, 상태 등급이 올라가면 1회 허용)
  maxPerRun: 3, // 한 번 실행에 최대 3건
  maxPerHour: 10, // 1시간에 최대 10건
};

// Upbit 요청 설정
export const UPBIT = {
  base: 'https://api.upbit.com',
  minuteCount: 70, // 1분봉: 5분 구간 계산에 5×(1+12)=65개 + 여유
  fifteenCount: 15, // 15분봉: 15분 평소 거래대금(직전 12개 15분봉) + 여유
  candleIntervalMs: 130, // 캔들 요청 간격 (Upbit 캔들 그룹 초당 10회 제한 이하)
};

// 스테이블코인 마켓 제외
export const STABLE_BASES = new Set(['USDT', 'USDC', 'USDS', 'USDE', 'DAI', 'TUSD', 'PYUSD', 'USD1', 'FDUSD']);

export const DEFAULT_MARKETS = 15;
// 무료 플랜 외부 요청 50개 제한: 종목당 2개 + 시세 목록 약 4개 + Telegram 최대 3개 ≤ 50
export const MAX_MARKETS = 20;

export function readConfig(env = {}) {
  const n = Number.parseInt(env.MONITOR_MARKETS, 10);
  return {
    markets: Number.isFinite(n) && n > 0 ? Math.min(n, MAX_MARKETS) : DEFAULT_MARKETS,
    telegramConfigured: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
    d1Configured: Boolean(env.DB && typeof env.DB.prepare === 'function'),
  };
}
