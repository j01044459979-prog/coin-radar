// 실시간 신호 테스트 공용 픽스처(합성 데이터). 네트워크·Telegram은 쓰지 않는다.
import { M15 } from '../signal/evaluate.mjs';
import { H1 } from '../opportunity/indicators.mjs';

export const T = Date.UTC(2024, 5, 1, 12, 0, 0);          // 1H 신호 봉이 마감된 시각(12:00 UTC)
export const NOW = T + 16 * 60000;                        // 12:00~12:15 15분봉이 마감(12:15)된 뒤 1분
const K = 200;
const mirrorBar = x => ({ ...x, o: K - x.o, h: K - x.l, l: K - x.h, c: K - x.c });

// 분석 결과(LONG 기준). 가격 100, ATR(1H) 1.0, 지지 구간 98.8~99.6, 구조적 손절 97.5, 위쪽 확정 구간 105·109
export function mkA(over = {}) {
  return {
    status: 'ok', barT: T - H1, asOf: T, price: 100, trend: 'UP', dir: 'LONG', state: 'LONG', stage: 3, stageLabel: '조건 충족', met: 7, total: 7,
    zone: { lo: 98.8, hi: 99.6, level: 99.2, type: '4H 스윙' }, invalidation: 97.5, opposing: 105,
    obstacles: [{ price: 105, source: '4H 스윙 고점' }, { price: 109, source: '최근 72시간 고점' }],
    reasons: [], unmet: [], checks: [], plan: { ref: 100, invalidation: 97.5, riskPct: 2.5, target: { price: 105, source: '4H 스윙 고점', pct: 5 }, rr: 2 },
    score: { total: 80, grade: '높음', parts: [] },
    metrics: { atr1: 1, atr1Pct: 1, atr4Pct: 2, relVol: 1.5, volLabel: '보통', btcAlign: '일치', btcDir: 'UP', chase: '낮음', volume: { level: '확대', sig: 1.5, dry: true } },
    ...over,
  };
}
export const mirrorA = a => ({
  ...a, dir: 'SHORT', state: 'SHORT', trend: 'DOWN', price: K - a.price, zone: { ...a.zone, lo: K - a.zone.hi, hi: K - a.zone.lo, level: K - a.zone.level }, invalidation: K - a.invalidation, opposing: K - a.opposing,
  obstacles: a.obstacles.map(o => ({ ...o, price: K - o.price })), plan: { ...a.plan, ref: K - a.plan.ref, invalidation: K - a.plan.invalidation, target: { ...a.plan.target, price: K - a.plan.target.price } },
});

// 15분봉: 직전 79봉은 레벨(99.9) 아래에서 횡보(고점 ≤ 99.9), 마지막 봉이 확정 종가로 돌파(종가 100.15). 마지막 봉 마감 시각 = closeT.
export function mk15({ closeT = T + M15, n = 80, level = 99.9, a1 = 1, volBase = 1000, volLast = 2000, lastClose = null, lastOpen = null, lastHigh = null, lastLow = null, mutate = null } = {}) {
  const lastT = closeT - M15, bars = [];
  for (let k = 0; k < n - 1; k++) {
    const t = lastT - (n - 1 - k) * M15, wob = ((k * 7) % 5) / 10 * a1;               // 결정적 흔들림
    const o = level - (0.6 - wob * 0.3) * a1, c = level - (0.45 - wob * 0.2) * a1;
    bars.push({ t, o, h: Math.min(level - 0.02 * a1, Math.max(o, c) + 0.1 * a1), l: Math.min(o, c) - 0.15 * a1, c, q: volBase });
  }
  const c = lastClose ?? level + 0.25 * a1, o = lastOpen ?? level - 0.1 * a1;
  bars.push({ t: lastT, o, h: lastHigh ?? c + 0.05 * a1, l: lastLow ?? o - 0.05 * a1, c, q: volLast });
  if (mutate) mutate(bars);
  return bars;
}
export const mirror15 = bars => bars.map(mirrorBar);

// 전송 모의
export function sender({ failTimes = 0, status = undefined } = {}) {
  const sent = []; let calls = 0;
  const send = async (text, opt) => { calls++; if (calls <= failTimes) throw Object.assign(new Error('전송 실패'), status ? { status } : {}); sent.push({ text, opt }); };
  return { send, sent, get calls() { return calls; } };
}
// 저장 모의: 마지막 저장본(깊은 복사)을 snapshot으로 보관
export function store({ failAfter = Infinity } = {}) {
  let n = 0, snapshot = null; const log = [];
  return { save: async st => { n++; if (n > failAfter) throw new Error('disk full'); snapshot = structuredClone(st); log.push(n); }, get snapshot() { return snapshot; }, log };
}
// 수집 모의: 기본 1종목(ETH, LONG)
export function collectors({ symbols = ['ETHUSDT'], c15 = mk15(), status15 = 'fresh', calls = [] } = {}) {
  const collectHour = async ({ ids }) => {
    calls.push(['hour', ids]);
    const coins = {}; for (const sym of symbols) coins[sym.replace(/USDT$/, '-USDT-SWAP')] = { symbol: sym, status: 'fresh', c1h: [], c4h: [], notes: [] };
    return { universe: ids, coins, btc4h: null, stopped: null, calls: symbols.length * 2, fatal: null };
  };
  const collectM15 = async ({ ids }) => { calls.push(['m15', ids]); const coins = {}; for (const id of ids) coins[id] = { status: status15, c15, reason: status15 === 'fresh' ? null : '테스트', notes: [] }; return { coins, stopped: null, calls: ids.length }; };
  return { collectHour, collectM15 };
}
export const oppState = (symbols = ['ETHUSDT'], dir = 'LONG', stage = 3, lastBarT = T - H1) => ({ opportunity: { v: 1, baselineDone: true, coins: Object.fromEntries(symbols.map(s => [s, { dir, stage, lastBarT }])) } });
