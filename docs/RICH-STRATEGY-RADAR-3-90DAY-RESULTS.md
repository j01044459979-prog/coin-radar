# RICH STRATEGY RADAR 3.0 - first empirical 90-day results

## Data provenance and process
- Run: https://github.com/j01044459979-prog/coin-radar/actions/runs/38701775945
- Run date: 2026-10-15 (UTC). OKX official **USDT perpetual swap**, NOT Binance.
- Period: 2026-07-17T07:50:00Z through 2026-10-15T07:50:00Z exclusive (90 full days).
- Each instrument: 25,920 **confirmed** 5m bars, 260 OKX history pages, 100% requested coverage, no missing intervals. Sources: BTC-USDT-SWAP / ETH-USDT-SWAP / SOL-USDT-SWAP.
- Strategy and default parameters were fixed before this run; chronological 70% in-sample and 30% out-of-sample validation. Historical next-bar open fills, stop-first on ambiguous intrabar candles, gap-through-stop adverse fill.
- Costs modeled: 6bp each side commissions + 3bp each side slippage. **No funding, liquidation, mark/execution basis, order-book impact or full equity intrabar drawdown**. The compounding model is hypothetical 1x full-notional after each trade.

## OUT-OF-SAMPLE results (last 30% of 90d)
| Market | Trades | Win rate | PF | Net simulated return (1x notional) | Closed-trade DD |
|---|---:|---:|---:|---:|---:|
| BTC-USDT-SWAP | 199 | 24.6% | 0.260 | -29.9% | 29.9% |
| ETH-USDT-SWAP | 180 | 30.0% | 0.395 | -25.6% | 27.1% |
| SOL-USDT-SWAP | 176 | 31.3% | 0.467 | -28.5% | 29.0% |

## IN-SAMPLE results (first 70%)
| Market | Trades | Win rate | PF | Net simulated return (1x notional) |
|---|---:|---:|---:|---:|
| BTC | 477 | 20.3% | 0.214 | -60.9% |
| ETH | 430 | 24.9% | 0.331 | -57.8% |
| SOL | 441 | 25.4% | 0.368 | -60.5% |

## Decision: REJECT current strategy for live signals
- All three independent out-of-sample periods produced materially negative simulated returns and profit factor < 1.
- These are **NOT losses incurred in a user's trading account**, nor proof of future results. They indicate the current prototype provides no demonstrated edge after the assumed costs.
- Do not merge 3.0 live alerts into main. Do not label it 'safe' or claim it beats radar 2.4.
- `research-v3.mjs` now emits `FAILED_VALIDATION` if OOS return <=0, PF<1.2, or DD>10% once >=90 days and >=30 OOS trades are available. No result alone authorizes live rollout.

## Next research hypothesis (must NOT tune on the used validation slice)
1. Root-cause analysis on the original training subset only: break trades down by strategy regime (TREND_BREAKOUT versus RANGE_REVERSION), direction, holding time, fees and stop vs target. Record all decisions in an experiment log.
2. Design slower/rarer candidate models using 1H/4H trend confirmation, volatility regime gating, 5m only for entry timing, cooldown and BTC market context. Do not treat SuperTrend and UT-style ATR trailing as independent votes.
3. Lock rules *before* evaluating a fresh later period. Prefer walk-forward and paper-forward evidence. Distinguish missed opportunity from a high-risk entry.
4. To compare vs radar 2.4, gather period-matched OI, funding and BTC filters or expressly state that a matched fair baseline cannot be reconstructed.
5. Add a no-trade default if exchange data is stale, contradictory, or the fee-adjusted expected edge is not supported.

Status: research findings only. This report records one failed candidate, not an investment recommendation.