// Watch-only Telegram interest choices for 5-minute basic alerts (B) and squeeze watches (C).
// NOT RICH300 trade/entry records. No execution, market data calls, or signal gating.
import { escHtml } from './format.mjs';

export const watchButtonsEnabled = env =>
  String(env?.RADAR_WATCH_BUTTONS ?? 'off').trim().toLowerCase() === 'on';

export function watchSid(symbol, source, at) {
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol) || !['B','C'].includes(source) ||
      !Number.isSafeInteger(at) || at < 1e12) return null;
  const sid = 'WK-' + symbol.slice(0, -4) + '-' + source + '-' + Math.floor(at / 60000).toString(36);
  return /^[A-Za-z0-9_.-]{1,54}$/.test(sid) ? sid : null;
}
export const watchKeyboard = sid => ({ inline_keyboard: [[
  { text: '👀 관심 등록', callback_data: 'w1:' + sid + ':a' },
  { text: '패스', callback_data: 'w1:' + sid + ':p' },
]] });

/** 'W1' is a machine-readable authenticated-by-message context, not a trade entry or R9 signal. */
export function watchDecorate(part, { symbol, source, dir = 'LONG', at } = {}, env = process.env) {
  if (!watchButtonsEnabled(env) || !part || typeof part.text !== 'string') return part;
  const sid = watchSid(symbol, source, at);
  if (!sid || !['LONG','SHORT','WATCH'].includes(dir)) return part;
  const line = 'W1 v1 ' + [sid, symbol, source, dir, at].join(' ');
  const tail = '\n\n👀 관심 관찰 전용 · 진입 기록 아님\n' + line;
  const text = part.text + escHtml(tail);
  const plain = (part.plain ?? part.text) + tail;
  if (text.length > 3900) return part;
  return { ...part, text, plain, markup: watchKeyboard(sid), watchId: sid };
}
