# COIN RADAR — Fibonacci Trend Pullback (experimental)

This is **an optional confirmation layer on the existing SIGNAL engine**, not an independent scanner, trading bot, or proven strategy. It is based entirely on publicly available, exchange-confirmed OHLCV candles already fetched by the existing signal pipeline. No extra OKX requests, account API, order API, fee model changes, RICH300 button changes, dispatcher changes, Telegram token changes, or state schema migrations.

## Controls

- `RADAR_SIGNAL=off` (default) — no SIGNAL analysis is run; the FIB switch alone does nothing.
- `RADAR_FIB_PULLBACK=off` (default) — existing SIGNAL outputs, scoring, state, messages and paper results remain exactly as before.
- `RADAR_FIB_PULLBACK=preview` — calculate FIB diagnostics in SIGNAL logs, but **do not change existing candidate selection, messages, score, Telegram sends or state**. If `RADAR_SIGNAL=preview`, no Telegram is sent (except separate unrelated radar functionality).
- `RADAR_FIB_PULLBACK=on` — an **extra confirmation gate** for existing SIGNAL candidates, never a standalone or unconfirmed new candidate; failure/missing data becomes OBSERVE instead of CANDIDATE.
- Default on invalid values = off. No actual switch values are changed by merging a PR.

## Data and calculation (not optimized)

1. **4H trend:** latest confirmed 4H candle completed by the 1H analysis timestamp, EMA20/50/200 directional alignment and EMA50 slope. Existing 4H swing-structure/EMA50-200 trend is still a prerequisite.
2. **1H Fibonacci:** most recent confirmed 3-left/3-right pivot in last 30h; preceding impulse extreme (lookback up to 48h) and minimum height 2 ATR(14). LONG: high down to 0.5~0.618; SHORT: low up to 0.5~0.618. Recent 12 one-hour candles must touch the interval without closing beyond its protective boundary. This is an analytical starting rule; no tuned performance claim.
3. **RSI:** Wilder RSI14 on 1H must recover toward 40~70 (long)/30~60 (short), and 15m RSI must re-cross 50 in the past four completed bars.
4. **Approximate volume-at-price profile (informational, not a hard gate):** evenly distribute each confirmed 1H candle's quote turnover over 64 price bins from the last 96h. Show approximate POC proximity (within 0.75 ATR of Fibonacci band) and 1H EMA50 proximity (within one ATR). These values are **not tick-level VPVR or a TradingView fixed-range profile**; never call them real traded-at-price volume.
5. **Entry trigger and protection stay existing SIGNAL logic:** 15m close beyond preceding 8 bars, volume >=1.2× prior 20 bars, chase filter, 1H ATR stop, anchored objective, and minimum net 1st-target R (default >=1.5 after cost).

## Operating recommendation

First merge only after full `radar-pr-check` CI passes. Start with `RADAR_SIGNAL=preview` and `RADAR_FIB_PULLBACK=preview` in an approved operational session. Assess at least several weeks of preview and out-of-sample conditions across BTC/ETH and other high-liquidity pairs; track candidate counts, reasons blocked, fees/slippage, and missing-data rates. Only with explicit user approval, switch the FIB gate to `on`. Do not infer any success rate or activate live Telegram automatically.

**Rollback:** set `RADAR_FIB_PULLBACK=off`. This returns to legacy SIGNAL selection without changing the existing `RADAR_SIGNAL`, `RADAR_OPPORTUNITY`, `RADAR_SCHEDULER`, `RADAR_RICH300_BUTTONS` or `RADAR_RICH300_FEED` settings. As before, the system does not place real orders.
