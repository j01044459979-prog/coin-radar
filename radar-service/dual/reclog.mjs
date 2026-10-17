// 추천 성과 추적 로그. 추천/관심 판정이 나올 때마다 한 줄을 남기고, 이후 캔들로 결과(손절/목표/기간 만료)를 같은 체결 규칙으로 채운다.
//  - 저장 위치: state.recLog (최근 N건, Actions 캐시 기반이라 영구 저장소가 아님) + 실행 로그의 JSON Lines 출력. 영구 보관이 필요하면 별도 승인된 저장소가 필요.
//  - 로그에는 전략 버전·설정 해시가 있어 규칙이 바뀐 뒤의 기록과 섞이지 않는다.
import { simulateTrade, COSTS, ENGINE } from '../backtest/engine.mjs';
import { A_SETTINGS } from './strategyA.mjs';
import { B_SETTINGS } from './strategyB.mjs';
import { DUAL_RULES } from './combine.mjs';

export const REC_VERSION = '3.0';
export const MAX_LOG = 300;
const hash = s => { let h = 5381; for (const ch of s) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0; return h.toString(16); };
export const SETTINGS_HASH = hash(JSON.stringify({ A_SETTINGS, B_SETTINGS, DUAL_RULES, COSTS, maxHold: ENGINE.maxHoldBars }));

export function makeRecord(item, loggedAt) {
  const p = item.plan;
  return { v: 1, id: `${item.symbol}-${item.signalBarT}-${item.cls.dir}`, version: REC_VERSION, settings: SETTINGS_HASH, loggedAt, signalBarT: item.signalBarT, dataAsOf: item.dataAsOf,
    symbol: item.symbol, dir: item.cls.dir, tier: item.cls.verdict, scoreA: item.a.score, scoreB: item.b.score, planSource: p?.source ?? null,
    entryRef: p?.entry ?? null, stop: p?.stop ?? null, tp: p?.tp ?? null, rr: p?.rr ?? null, outcome: { status: p ? 'pending' : 'noplan' } };
}

// 로그에 추가(같은 id는 중복 저장하지 않음). 최신 MAX_LOG건만 유지.
export function appendRecords(log, records, max = MAX_LOG) {
  const have = new Set(log.map(r => r.id)), fresh = records.filter(r => !have.has(r.id));
  return { log: [...log, ...fresh].slice(-max), added: fresh };
}

// candlesBySymbol: { SYMBOL: [{t,o,h,l,c,q}] } — 가진 데이터로 가능한 만큼 결과를 갱신한다.
export function updateOutcomes(log, candlesBySymbol) {
  for (const r of log) {
    if (!['pending', 'open'].includes(r.outcome?.status)) continue;
    const c = candlesBySymbol[r.symbol]; if (!c) continue;
    const i = c.findIndex(x => x.t === r.signalBarT);
    if (i < 0) continue;
    const res = simulateTrade(c, i, { dir: r.dir, stop: r.stop, tp: r.tp });
    if (res.status === 'closed') r.outcome = { status: 'closed', reason: res.reason, rNet: round(res.rNet), rGross: round(res.rGross), bars: res.bars, entry: res.entry, exit: res.exit };
    else if (res.status === 'skipped') r.outcome = { status: 'skipped', reason: res.reason };
    else r.outcome = { status: 'open', reason: res.reason };
  }
  return log;
}
const round = x => Math.round(x * 1000) / 1000;

export function summarize(log) {
  const out = {};
  for (const tier of ['PRIORITY', 'INTEREST']) {
    const closed = log.filter(r => r.tier === tier && r.outcome?.status === 'closed');
    const rs = closed.map(r => r.outcome.rNet), wins = rs.filter(x => x > 0).length;
    out[tier] = { logged: log.filter(r => r.tier === tier).length, closed: closed.length, open: log.filter(r => r.tier === tier && ['pending', 'open'].includes(r.outcome?.status)).length,
      winRate: closed.length ? wins / closed.length : null, expectancyR: closed.length ? rs.reduce((a, b) => a + b, 0) / closed.length : null, note: closed.length < 30 ? '표본 부족(n<30): 참고만' : null };
  }
  return out;
}
