// Automatically retain ALL discovered accumulation stage-1 qualifying symbols,
// independently of Telegram message quotas. Interest only: never trade/position data.
// A BREAKOUT has passed stage-1 prerequisites, so it is included too.
import { watchSid } from '../watch-button.mjs';

export const AUTO_INTEREST_KEEP_MS = 30 * 86400000;
export const AUTO_INTEREST_MAX = 200;
const valid = (symbol, x, now) =>
  /^[A-Z0-9]{2,20}USDT$/.test(symbol) && x && x.symbol === symbol &&
  x.source === 'C' && x.dir === 'WATCH' && Number.isSafeInteger(x.at) &&
  x.sid === watchSid(symbol, 'C', x.at) && Number.isSafeInteger(x.lastSeenAt) &&
  now >= x.lastSeenAt && now - x.lastSeenAt <= AUTO_INTEREST_KEEP_MS;

export function accumulationAutoInterests(existing, observed, now) {
  const all = new Map();
  if (existing && typeof existing === 'object' && !Array.isArray(existing))
    for (const [sym, x] of Object.entries(existing)) if (valid(sym, x, now)) all.set(sym, x);
  let added = 0;
  for (const obs of observed ?? []) {
    const { symbol, entry } = obs ?? {};
    if (!entry || !['WATCH', 'BREAKOUT'].includes(entry.stage) ||
        !Number.isSafeInteger(entry.asOf) || entry.asOf > now ||
        now - entry.asOf >= 2 * 3600000) continue;
    const sid = watchSid(symbol, 'C', entry.asOf);
    if (!sid) continue;
    if (!all.has(symbol)) { all.set(symbol, { sid, symbol, source: 'C', dir: 'WATCH',
      at: entry.asOf, lastSeenAt: now }); added++; }
    else all.set(symbol, { ...all.get(symbol), lastSeenAt: now });
  }
  // Limit persistent state and feed size without repeated entries per candle.
  const items = [...all.entries()].sort((a, b) =>
    b[1].lastSeenAt - a[1].lastSeenAt || a[0].localeCompare(b[0])).slice(0, AUTO_INTEREST_MAX);
  return { records: Object.fromEntries(items), added, total: items.length };
}
