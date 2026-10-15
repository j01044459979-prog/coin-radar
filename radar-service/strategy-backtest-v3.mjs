// RICH STRATEGY RADAR 3.0 — conservative next-bar execution backtest.
// Research tool ONLY: not an exchange simulator, not a live execution engine.
// Funding, liquidation, market impact and order-book depth are NOT simulated.
import { buildStrategySeries, validateClosedCandles } from './strategies-v3.mjs';

export const BACKTEST_DEFAULTS = Object.freeze({
  feeBpsEachSide: 6, slippageBpsEachSide: 3,
  maxHoldBars: 24, cooldownBars: 3, trainFraction: 0.7,
});
// If BOTH stop and take profit are touched in one OHLC bar, assume STOP first.
// The intrabar event sequence cannot be identified from OHLC alone.
export function conservativeBarExit(position, candle) {
  const { direction, stop, target } = position;
  if (direction === 'LONG') {
    if (candle.l <= stop) return { type: 'STOP', price: stop };
    if (candle.h >= target) return { type: 'TARGET', price: target };
  } else {
    if (candle.h >= stop) return { type: 'STOP', price: stop };
    if (candle.l <= target) return { type: 'TARGET', price: target };
  }
  return null;
}
function summarize(trades) {
  let equity = 1, peak = 1, maxDrawdownPct = 0, win = 0, gains = 0, losses = 0;
  let totalNetPct = 0, rTotal = 0;
  for (const t of trades) {
    if (t.netPercent > 0) { win++; gains += t.netPercent; }
    else losses += -t.netPercent;
    totalNetPct += t.netPercent;
    rTotal += t.netPercent / t.initialStopPercent;
    // 100% notional, 1x equivalent, compounded for comparative research ONLY.
    equity *= Math.max(0, 1 + t.netPercent / 100);
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? (peak - equity) / peak * 100 : 0);
  }
  return {
    trades: trades.length,
    winRatePercent: trades.length ? win / trades.length * 100 : null,
    profitFactor: losses > 0 ? gains / losses : gains > 0 ? null : null,
    profitFactorNote: losses === 0 ? '손실 거래 없음: 유효한 무한 PF로 간주 금지' : null,
    netReturnPercent1x: (equity - 1) * 100,
    averageNetTradePercent: trades.length ? totalNetPct / trades.length : null,
    averageR: trades.length ? rTotal / trades.length : null,
    maxClosedTradeDrawdownPercent: maxDrawdownPct,
  };
}
export function backtestStrategy(candles, config = {}, strategyConfig = {}) {
  validateClosedCandles(candles);
  if (candles.length < 200) throw new Error('백테스트는 최소 200개 확정봉이 필요합니다. 실전 평가는 수개월 이상 필요합니다');
  const p = { ...BACKTEST_DEFAULTS, ...config };
  if (p.feeBpsEachSide < 0 || p.slippageBpsEachSide < 0 || p.feeBpsEachSide >= 100 ||
      p.slippageBpsEachSide >= 100 || !Number.isInteger(p.maxHoldBars) || p.maxHoldBars < 1 ||
      !Number.isInteger(p.cooldownBars) || p.cooldownBars < 0 ||
      p.trainFraction < 0.5 || p.trainFraction > 0.9) throw new Error('백테스트 설정 오류');
  const signals = buildStrategySeries(candles, strategyConfig);
  const slip = p.slippageBpsEachSide / 10000, feePctRoundTrip = p.feeBpsEachSide * 2 / 100;
  const trades = [];
  let position = null, pending = null, lastExitIndex = -Infinity;
  const close = (index, rawExit, outcome) => {
    const adverseExit = position.direction === 'LONG' ? rawExit * (1 - slip) : rawExit * (1 + slip);
    const gross = 100 * (position.direction === 'LONG'
      ? (adverseExit - position.entry) / position.entry
      : (position.entry - adverseExit) / position.entry);
    const net = gross - feePctRoundTrip;
    trades.push({
      direction: position.direction, setup: position.setup, signalIndex: position.signalIndex,
      entryIndex: position.entryIndex, exitIndex: index, entry: position.entry, exit: adverseExit,
      stop: position.stop, target: position.target, initialStopPercent: position.initialStopPercent,
      outcome, grossPercentAfterSlippage: gross, netPercent: net,
      feePercentRoundTrip: feePctRoundTrip,
    });
    position = null; lastExitIndex = index;
  };
  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];
    if (pending) {
      const direction = pending.signal;
      const entry = direction === 'LONG' ? bar.o * (1 + slip) : bar.o * (1 - slip);
      const distance = pending.risk.stopDistance;
      if (entry > 0 && distance > 0 && (direction !== 'SHORT' || entry - distance * pending.risk.rewardRisk > 0)) {
        position = {
          direction, setup: pending.setup, signalIndex: pending.index, entryIndex: i, entry,
          stop: direction === 'LONG' ? entry - distance : entry + distance,
          target: direction === 'LONG' ? entry + distance * pending.risk.rewardRisk : entry - distance * pending.risk.rewardRisk,
          initialStopPercent: distance / entry * 100,
        };
      }
      pending = null;
    }
    if (position) {
      const exit = conservativeBarExit(position, bar);
      if (exit) close(i, exit.price, exit.type);
      else if (i - position.entryIndex + 1 >= p.maxHoldBars) close(i, bar.c, 'TIME');
      else if (i === candles.length - 1) close(i, bar.c, 'END');
    }
    // A signal formed at bar i CLOSE is eligible to fill at bar i+1 OPEN only.
    // Never enter on the same bar that created the signal; never pyramid.
    if (!position && i + 1 < candles.length && i - lastExitIndex > p.cooldownBars &&
        signals[i].signal !== 'WAIT' && signals[i].risk) pending = signals[i];
  }
  const splitIndex = Math.floor(candles.length * p.trainFraction);
  const train = trades.filter(t => t.entryIndex < splitIndex && t.exitIndex < splitIndex);
  const test = trades.filter(t => t.entryIndex >= splitIndex);
  const boundaryTradesExcluded = trades.length - train.length - test.length;
  return {
    spec: {
      candles: candles.length, splitIndex, trainFraction: p.trainFraction,
      signalAt: 'closed_bar', fillAt: 'next_bar_open',
      bothStopAndTarget: 'STOP_FIRST', orderSize: '100% notional at 1x illustrative',
      fees: 'per side bps', feeBpsEachSide: p.feeBpsEachSide,
      slippageBpsEachSide: p.slippageBpsEachSide,
      fundingIncluded: false, liquidationIncluded: false,
      noPyramiding: true, cooldownBars: p.cooldownBars,
      closedTradeOnlyDrawdown: true,
    },
    all: summarize(trades),
    inSample: summarize(train),
    outOfSample: summarize(test),
    boundaryTradesExcluded, trades,
    warning: '검증 전 연구 결과. 과최적화/미래정보 누출 방지 필요. 펀딩·강제청산·오더북·시세차 등 미반영. 과거 성과는 미래 결과를 보장하지 않습니다.',
  };
}
