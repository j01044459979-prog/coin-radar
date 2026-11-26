// 1H picture for all three accumulation-watch stages, rendered from confirmed OKX candles.
// Levels are taken directly from the signal. No hypothetical future candles or orders.
import { C, esc, renderPng } from '../chart.mjs';
import { fmtPrice, priceDecimals } from '../format.mjs';
import { H1 } from '../opportunity/indicators.mjs';
import { accumulationNextSteps, accumulationRetestPlan } from './accumulation.mjs';

export const ACC_CHART = Object.freeze({ W: 1080, H: 1290, BARS: 45 });
const { W, H, BARS } = ACC_CHART;
const X0 = 36, X1 = 746, Y0 = 202, Y1 = 870, R0 = 774;
const valid = n => Number.isFinite(n) && n > 0;
const xml = value => esc(value);
const attr = o => Object.entries(o).map(([k, v]) => k + '="' + xml(v) + '"').join(' ');
const rect = o => '<rect ' + attr(o) + '/>';
const line = o => '<line ' + attr(o) + '/>';
const txt = (x, y, v, size = 24, color = C.text, weight = 400, more = {}) =>
  '<text ' + attr({x, y, 'font-size': size, fill: color, 'font-weight': weight, ...more}) + '>' + xml(v) + '</text>';
const kst = t => new Date(t + 9 * H1).toISOString().slice(5, 16).replace('T', ' ');

export function validateAccumulationChart(symbol, x, c1h) {
  if (!/^[A-Z0-9]+USDT$/.test(symbol) ||
      !x || !['WATCH', 'BREAKOUT', 'RETEST'].includes(x.stage) ||
      ![x.asOf, x.upper, x.lower].every(valid) || x.upper <= x.lower)
    throw new Error('매집 차트 신호 오류');
  if (!Array.isArray(c1h) || c1h.length < 26) throw new Error('매집 차트 캔들 부족');
  const candles = c1h.slice(-BARS);
  for (let i = 0; i < candles.length; i++) {
    const b = candles[i];
    if (![b.t, b.o, b.h, b.l, b.c].every(Number.isFinite) ||
        b.l <= 0 || b.l > Math.min(b.o, b.c) || b.h < Math.max(b.o, b.c) ||
        (i && b.t - candles[i - 1].t !== H1)) throw new Error('매집 차트 캔들 비정상');
  }
  if (candles.at(-1).t + H1 !== x.asOf) throw new Error('매집 차트 기준봉 불일치');
  if (x.stage === 'RETEST' && ![x.entry, x.stop, x.t1, x.t2].every(valid))
    throw new Error('매집 재지지 가격 누락');
  return candles;
}

export function buildAccumulationSvg(symbol, x, c1h) {
  const bars = validateAccumulationChart(symbol, x, c1h);
  const isRetest = x.stage === 'RETEST', isBreakout = x.stage === 'BREAKOUT';
  const entry = isRetest ? x.entry : x.close;
  if (!valid(entry)) throw new Error('매집 차트 현재가 누락');
  const f = v => fmtPrice(v, priceDecimals(entry));
  const pct = v => {
    const p = (v / entry - 1) * 100;
    return (p > 0 ? '+' : '') + p.toFixed(2) + '%';
  };
  const priceLevels = [x.upper, x.lower, entry, ...(isRetest ? [x.stop] : [])];
  const allHi = Math.max(...bars.map(b => b.h), ...priceLevels);
  const allLo = Math.min(...bars.map(b => b.l), ...priceLevels);
  const pad = Math.max((allHi - allLo) * .08, allHi * .001);
  const hi = allHi + pad, lo = Math.max(0, allLo - pad);
  const y = p => Y1 - (p - lo) / (hi - lo) * (Y1 - Y0);
  const candleWidth = (X1 - X0 - 16) / bars.length;
  const xi = i => X0 + 8 + (i + .5) * candleWidth;
  const out = [], add = v => out.push(v);
  const head = isRetest ? '3단계 · 돌파 후 재지지' :
    isBreakout ? '2단계 · 거래량 동반 돌파 관찰' : '1단계 · 매집 의심 관찰';
  add(rect({width: W,height: H,fill:C.bg}));
  add(txt(X0, 65, symbol.replace(/USDT$/, '') + '  ·  ACCUMULATION', 47, C.text, 700));
  add(txt(X0, 117, head, 34, isRetest ? C.up : C.entry, 700));
  add(txt(X0, 157, 'OKX 1H 확정봉  ' + kst(x.asOf) + ' KST', 24, C.muted));
  add(rect({x:X0,y:Y0,width:X1-X0,height:Y1-Y0,rx:10,fill:C.panel}));

  // True historical candle region and original 24-hour price box, not a fabricated curve.
  add(rect({x:X0,y:y(x.upper),width:X1-X0,
    height:Math.max(2,y(x.lower)-y(x.upper)),fill:C.entry,'fill-opacity':0.07}));
  for(let i=1;i<=5;i++){
    const p=lo+(hi-lo)*i/6, yy=y(p);
    add(line({x1:X0,y1:yy,x2:X1,y2:yy,stroke:C.grid,'stroke-width':2}));
    add(txt(X0+8,yy-8,f(p),17,C.muted));
  }
  bars.forEach((b,i)=>{
    const col=b.c>=b.o?C.up:C.down, xx=xi(i), top=y(Math.max(b.o,b.c)), bottom=y(Math.min(b.o,b.c));
    add(line({x1:xx,y1:y(b.h),x2:xx,y2:y(b.l),stroke:col,'stroke-width':2.8}));
    add(rect({x:xx-candleWidth*.28,y:top,width:Math.max(4,candleWidth*.56),
      height:Math.max(2,bottom-top),fill:col}));
  });
  const levels=[
    [x.upper,C.entry,'9 6'],
    [x.lower,C.entry,'9 6'],
    [entry,C.up,'2 5'],
    ...(isRetest?[[x.stop,C.down,'8 5']]:[]),
  ];
  levels.forEach(([v,color,dash])=>add(line({x1:X0,y1:y(v),x2:X1,y2:y(v),stroke:color,
    'stroke-width':2.8,'stroke-dasharray':dash})));

  add(rect({x:R0-12,y:Y0,width:W-R0-24,height:Y1-Y0,rx:12,fill:C.panel,stroke:C.grid}));
  add(txt(R0,Y0+45,'핵심 가격',29,C.text,700));
  const vals=[
    ['박스 상단',f(x.upper),C.entry],
    ['박스 하단',f(x.lower),C.entry],
    [isRetest?'진입 관심가':'확정 종가',f(entry),C.up],
    ...(isRetest?[
      ['재지지 손절 '+pct(x.stop),f(x.stop),C.down],
      ['가상 목표 1.5R '+pct(x.t1),f(x.t1),C.up],
      ['가상 목표 2R '+pct(x.t2),f(x.t2),C.up],
    ]:[['돌파 확인',f(x.upper*1.001),C.entry]]),
  ];
  vals.forEach(([label,val,color],i)=>{
    const yy=Y0+100+i*84;
    add(txt(R0,yy,label,20,C.muted));
    add(txt(R0,yy+34,val,30,color,700));
  });

  // Historical confirmed 1H turnover. Missing volume is left blank.
  const V0=889, V1=991;
  add(rect({x:X0,y:V0,width:X1-X0,height:V1-V0,rx:10,fill:C.panel}));
  const volumeMax=Math.max(0,...bars.map(b=>Number.isFinite(b.q)&&b.q>=0?b.q:0));
  if(volumeMax>0)bars.forEach((b,i)=>{
    if(!Number.isFinite(b.q)||b.q<0)return;
    const height=b.q/volumeMax*78;
    add(rect({x:xi(i)-candleWidth*.28,y:V1-height,
      width:Math.max(4,candleWidth*.56),height,
      fill:b.c>=b.o?C.up:C.down,'fill-opacity':.7}));
  });
  add(txt(X0+12,V0+26,'확정봉 거래대금 · USDT',20,C.muted));
  const step=Math.max(1,Math.floor(bars.length/5));
  for(let i=0;i<bars.length;i+=step)
    add(txt(xi(i),1028,kst(bars[i].t).slice(0,11),18,C.muted,400,{'text-anchor':'middle'}));
  add(txt(X0,1085,isRetest?'상단 재접촉 및 확정봉 지지 · 계산상 진입 관심가':
    '변동성 압축/돌파 관찰 · 이 단계는 매수 진입 신호가 아님',25,C.text,700));
  add(txt(X0,1131,'가격선·조건은 알림 당시 확정 봉 기준 (실시간 시세 아님)',22,C.muted));
  add(txt(X0,1174,'미검증 실험 전략 · 예측 경로가 아닌 실제 과거 캔들',22,C.muted));
  add(txt(X0,1217,'자동 주문 없음 · 가짜 돌파 및 레버리지 청산 위험',22,C.muted));
  add(txt(X0,1260,'RICH FUTURES RADAR · OKX USDT SWAP',22,C.text,700));
  return '<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+
    '" viewBox="0 0 '+W+' '+H+'" font-family="Noto Sans KR">'+out.join('')+'</svg>';
}
// Photos are the normal Telegram delivery path, not the text-only fallback.
// Share action/threshold/plan text with the message formatter so the user sees
// the same decision guidance under the image.
export function accumulationCaption(symbol,x){
  const retest=x.stage==='RETEST', f=fmtPrice;
  const lines=[
    '🟡 RICH · 관찰 | '+symbol.replace(/USDT$/,'')+' LONG',
    '📌 전략: '+(retest?'3단계 재지지 관심 후보 · 진입 기록 미연동':x.stage==='BREAKOUT'?'2단계 돌파 관찰':'1단계 매집 감시'),
    '⏱ 1H 확정 '+kst(x.asOf)+' KST',
    '📦 박스 '+f(x.lower)+' ~ '+f(x.upper),
    ...(retest ? [] : ['💰 확정 종가 '+f(x.close)]),
    ...(retest ? accumulationRetestPlan(x) : accumulationNextSteps(x)),
    '※ 시세·체결가 실시간 재확인 · 수익성 미검증',
    '※ 자동주문/진입기록 없음 · 수수료·슬리피지 위험',
  ];
  const caption=lines.join('\n');
  if ([...caption].length > 1024) throw new Error('매집 텔레그램 이미지 설명 1024자 초과');
  return caption;
}
export async function renderAccumulationChart(symbol,x,c1h){
  return renderPng(buildAccumulationSvg(symbol,x,c1h),W);
}
