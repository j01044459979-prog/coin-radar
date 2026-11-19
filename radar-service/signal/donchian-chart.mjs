// Image companion to independent Donchian Telegram alerts.
// Uses the SAME confirmed 1H / 4H candles and levels that generated the text alert.
// No exchange calls, orders, portfolio writes, or RICH300 feed entries.
import { C, esc, renderPng } from '../chart.mjs';
import { fmtPrice, priceDecimals } from '../format.mjs';
import { H1, H4 } from '../opportunity/indicators.mjs';
import { donchianMessage } from './donchian.mjs';

export const DONCHIAN_CHART = Object.freeze({ W: 1080, H: 1370, bars: 42 });
const { W, H } = DONCHIAN_CHART;
const X0 = 42, X1 = 760, Y0 = 242, Y1 = 923, VY0 = 944, VY1 = 1048;
const sideline = 800, sideRight = 1040;
const attrs = a => Object.entries(a).map(([k, v]) => k + '="' + esc(v) + '"').join(' ');
const shape = (n, a) => '<' + n + ' ' + attrs(a) + '/>';
const text = (x, y, str, size = 26, color = C.text, weight = 400, more = {}) =>
  '<text ' + attrs({ x, y, 'font-size': size, 'font-weight': weight,
    fill: color, ...more }) + '>' + esc(str) + '</text>';
const whenKst = t => new Date(t + 9 * H1).toISOString().slice(5, 16).replace('T', ' ') + ' KST';
const valid = n => Number.isFinite(n) && n > 0;

export function validateDonchianChart(symbol, signal, c1h, c4h) {
  if (!/^[A-Z0-9]+USDT$/.test(symbol) || !signal || !['WATCH', 'BREAKOUT'].includes(signal.stage) ||
      !['LONG', 'SHORT'].includes(signal.dir)) throw new Error('돈치안 이미지 신호 정보 오류');
  if (![signal.upper, signal.lower, signal.entry, signal.ema200, signal.asOf].every(valid) ||
      signal.upper <= signal.lower) throw new Error('돈치안 이미지 가격 정보 오류');
  if (signal.stage === 'BREAKOUT' && ![signal.stop, signal.t1, signal.t2].every(valid))
    throw new Error('돈치안 이미지 손절·목표 정보 오류');
  const four = signal.stage === 'BREAKOUT';
  const all = four ? c4h : c1h;
  const tfMs = four ? H4 : H1;
  if (!Array.isArray(all) || all.length < 24) throw new Error('돈치안 차트 캔들 부족');
  const bars = all.slice(-DONCHIAN_CHART.bars);
  if (!bars.every(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite) &&
    c.l > 0 && c.l <= Math.min(c.o, c.c) && c.h >= Math.max(c.o, c.c))) throw new Error('돈치안 캔들 값 오류');
  for (let i = 1; i < bars.length; i++) if (bars[i].t - bars[i - 1].t !== tfMs)
    throw new Error('돈치안 캔들 누락');
  if (bars.at(-1).t + tfMs !== signal.asOf) throw new Error('돈치안 신호 확정봉 불일치');
  return { bars, four };
}

export function buildDonchianSvg(symbol, signal, c1h, c4h) {
  const { bars, four } = validateDonchianChart(symbol, signal, c1h, c4h);
  const s = signal, isLong = s.dir === 'LONG', accent = isLong ? C.up : C.down;
  const f = v => fmtPrice(v, priceDecimals(s.entry));
  const pct = v => { const p = (v / s.entry - 1) * 100; return (p > 0 ? '+' : '') + p.toFixed(2) + '%'; };
  const h = bars.map(c => c.h), l = bars.map(c => c.l);
  const levels = [s.upper, s.lower, s.entry, ...(four ? [s.stop] : [])];
  const hi0 = Math.max(...h, ...levels), lo0 = Math.min(...l, ...levels);
  const pad = Math.max((hi0 - lo0) * 0.08, hi0 * 0.001);
  const top = hi0 + pad, bottom = Math.max(0, lo0 - pad);
  const y = p => Y1 - (p - bottom) / (top - bottom) * (Y1 - Y0);
  const n = bars.length, gutter = 12, w = (X1 - X0 - 2 * gutter) / n;
  const cx = i => X0 + gutter + (i + 0.5) * w, bw = Math.max(5, w * 0.58);
  const out = [], add = x => out.push(x);
  const stage = four ? '4H 확정 돌파 · 진입 관심 후보' : '1H 돌파 접근 · 사전 관찰';

  add(shape('rect', { width: W, height: H, fill: C.bg }));
  add(text(X0, 66, symbol.replace(/USDT$/, '') + ' / ' + s.dir, 54, accent, 700));
  add(text(X0, 115, 'RICH DONCHIAN · ' + stage, 32, C.text, 700));
  add(text(X0, 158, (four ? '4시간봉' : '1시간봉') + ' 실거래소 확정 데이터 · ' + whenKst(s.asOf), 24, C.muted));
  add(shape('line', { x1: X0, y1: 186, x2: W - X0, y2: 186, stroke: C.grid, 'stroke-width': 2 }));

  add(shape('rect', { x: X0, y: Y0, width: X1 - X0, height: Y1 - Y0, rx: 12, fill: C.panel }));
  const upperY = y(s.upper), lowerY = y(s.lower);
  add(shape('rect', { x: X0, y: upperY, width: X1 - X0,
    height: Math.max(1, lowerY - upperY), fill: C.entry, 'fill-opacity': 0.075 }));
  for (let i = 1; i <= 5; i++) {
    const price = bottom + i * (top - bottom) / 6, yy = y(price);
    add(shape('line', { x1: X0, y1: yy, x2: X1, y2: yy, stroke: C.grid, 'stroke-width': 2 }));
    add(text(X0 + 8, yy - 8, f(price), 17, C.muted));
  }

  // Authentic OHLC candle bodies: no hypothetical path or future price candles.
  for (let i = 0; i < n; i++) {
    const c = bars[i], xp = cx(i), col = c.c >= c.o ? C.up : C.down;
    add(shape('line', { x1: xp, y1: y(c.h), x2: xp, y2: y(c.l), stroke: col, 'stroke-width': 3 }));
    add(shape('rect', { x: xp - bw / 2, y: y(Math.max(c.o, c.c)), width: bw,
      height: Math.max(2, y(Math.min(c.o, c.c)) - y(Math.max(c.o, c.c))), fill: col }));
  }

  const levelsToDraw = [
    { v: s.upper, title: '20봉 상단', color: C.entry, dash: '10 7' },
    { v: s.lower, title: '20봉 하단', color: C.entry, dash: '10 7' },
    { v: s.entry, title: four ? '진입 관심가' : '현재 확정 종가', color: accent, dash: '2 5' },
    ...(four ? [{ v: s.stop, title: 'ATR 손절', color: C.down, dash: '9 6' }] : []),
  ];
  for (const item of levelsToDraw) {
    add(shape('line', { x1: X0, y1: y(item.v), x2: X1, y2: y(item.v), stroke: item.color,
      'stroke-width': 3, 'stroke-dasharray': item.dash }));
  }

  // Side panel carries numeric labels so close price lines never overlap.
  add(shape('rect', { x: sideline - 15, y: Y0, width: sideRight - sideline + 30,
    height: Y1 - Y0, rx: 14, fill: C.panel, stroke: C.grid, 'stroke-width': 2 }));
  add(text(sideline, Y0 + 50, '주요 가격', 30, C.text, 700));
  const data = [
    ['채널 상단', f(s.upper), C.entry],
    ['채널 하단', f(s.lower), C.entry],
    [four ? '진입 관심가' : '확정 종가', f(s.entry), accent],
    ...(four ? [
      ['손절 (' + pct(s.stop) + ')', f(s.stop), C.down],
      ['목표 2.5R (' + pct(s.t1) + ')', f(s.t1), C.up],
      ['목표 4R (' + pct(s.t2) + ')', f(s.t2), C.up],
    ] : [
      ['돌파 기준 (' + pct(isLong ? s.upper : s.lower) + ')', f(isLong ? s.upper : s.lower), C.entry],
      ['상태', '4H 마감 대기', C.muted],
    ]),
    ['EMA200 (4H)', f(s.ema200), C.muted],
  ];
  data.forEach((item, i) => {
    const yy = Y0 + 102 + 76 * i;
    add(text(sideline, yy, item[0], 20, C.muted));
    add(text(sideline, yy + 34, item[1], 28, item[2], 700));
  });

  add(shape('rect', { x: X0, y: VY0, width: X1 - X0, height: VY1 - VY0, rx: 10, fill: C.panel }));
  const qmax = Math.max(0, ...bars.map(c => Number.isFinite(c.q) && c.q >= 0 ? c.q : 0));
  if (qmax > 0) {
    bars.forEach((c, i) => {
      if (!Number.isFinite(c.q) || c.q < 0) return;
      const ht = c.q / qmax * (VY1 - VY0 - 30);
      add(shape('rect', { x: cx(i) - bw / 2, y: VY1 - ht, width: bw, height: ht,
        fill: c.c >= c.o ? C.up : C.down, 'fill-opacity': 0.7 }));
    });
    add(text(X0 + 12, VY0 + 24, '거래대금(USDT) · 확정봉', 20, C.muted));
  } else add(text(X0 + 12, VY0 + 40, '거래대금 정보 없음', 22, C.muted));
  const tick = Math.max(1, Math.round(n / 5));
  for (let i = tick; i < n; i += tick)
    add(text(cx(i), 1084, whenKst(bars[i].t).slice(0, 11), 18, C.muted, 400, { 'text-anchor': 'middle' }));
  add(text(X0, 1135, four ? '4H 20봉 채널 돌파 · 2 ATR 손절 참고' : '1H 접근 관찰 · 4H 채널 돌파 확정 전', 26, C.text, 700));
  add(text(X0, 1180, '가격선은 해당 알림의 확정 시점 가격 · 현재 시세가 아닙니다', 22, C.muted));
  add(text(X0, 1225, '실험 전략 · 백테스트 생략 · 수익성 검증되지 않음', 22, C.muted));
  add(text(X0, 1270, '자동 주문 없음 · 추격 진입 주의 · 손절 전 청산·펀딩비 위험', 22, C.muted));
  add(text(X0, 1325, 'OKX USDT 무기한 · RICH FUTURES RADAR', 22, C.text, 700));
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W +
    '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H +
    '" font-family="Noto Sans KR">' + out.join('') + '</svg>';
}

// The PNG caption is what users actually read on Telegram (rather than the fallback
// text message). Derive it from the same message formatter to keep action/stop/TP
// percentages in sync. Telegram photo captions have a 1024-character limit.
export function donchianCaption(symbol, s) {
  const lines = donchianMessage(symbol, s).plain.split('\n');
  lines.splice(0, 2, (s.dir === 'LONG' ? '🟢 ' : '🔴 ') + symbol + ' ' + s.dir + ' · DONCHIAN');
  const caption = lines.join('\n');
  if ([...caption].length > 1024) throw new Error('돈치안 텔레그램 이미지 설명 1024자 초과');
  return caption;
}

export async function renderDonchianChart(symbol, signal, c1h, c4h) {
  return renderPng(buildDonchianSvg(symbol, signal, c1h, c4h), W);
}
