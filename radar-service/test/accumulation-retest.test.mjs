import test from 'node:test';
import assert from 'node:assert/strict';
import { H1 } from '../opportunity/indicators.mjs';
import { M15 } from '../signal/evaluate.mjs';
import { anchorOfBreakout, accumulationRetest, accumulationRetestMessage,
  accumulationWatch } from '../signal/accumulation.mjs';
import { buildAccumulationSvg, accumulationCaption, renderAccumulationChart,
  validateAccumulationChart } from '../signal/accumulation-chart.mjs';
import { signalStep, watchlist, expandedWatchlist } from '../signal/step.mjs';

// Logic and renderer smoke checks only; intentionally no profitability backtest.
const NOW = 600 * H1 + M15 + 20_000;
function baseCandles() {
  return Array.from({length:90}, (_,i)=>{
    const j = i - 60, old = i < 60;
    const c = old ? 100 + Math.sin(i * 1.5) * 0.85 :
      100 + j * 0.017 + Math.sin(i * 1.2) * 0.065;
    const o = c - (old ? 0.09 : 0.10);
    return { t:(510+i)*H1, o, c, h:c+(old?0.6:0.2),
      l:c-(old?0.6:0.58),q:1000+(i>59&&i%4!==0?400:0) };
  });
}
function breakoutBars() {
  const bars = baseCandles(), upper = Math.max(...bars.slice(-25,-1).map(b=>b.h));
  const last = bars.at(-1);
  last.o = upper - 0.25; last.c = upper * 1.004; last.h = last.c + 0.07;
  last.l = last.o - 0.22; last.q = 2700;
  return {bars,upper};
}
function retestedBars() {
  const {bars,upper} = breakoutBars();
  const c=upper*1.006, o=upper*1.003;
  bars.push({t:600*H1,o,c,h:c+.09,l:upper*.998,q:1800});
  return {bars,upper};
}
test('RETEST requires a previous confirmed high-volume breakout, not mere WATCH',()=>{
  const {bars} = breakoutBars(), signal = accumulationWatch(bars,NOW);
  assert.equal(signal?.stage,'BREAKOUT');
  const anchor = anchorOfBreakout(signal);
  assert.equal(anchor.status,'watching');
  assert.equal(accumulationRetest(bars,anchor,NOW),null,'same breakout candle cannot retest');
  assert.equal(anchorOfBreakout({...signal,stage:'WATCH'}),null);
  const {bars:later} = retestedBars();
  const ev = accumulationRetest(later,anchor,601*H1+M15+20_000);
  assert.equal(ev?.stage,'RETEST',JSON.stringify(ev));
  assert.ok(ev.entry>anchor.upper && ev.stop<anchor.upper);
  assert.ok(ev.t2>ev.t1 && ev.t1>ev.entry);
  assert.ok(ev.riskPct>0 && ev.riskPct<=4.5);
  const msg = accumulationRetestMessage('BNBUSDT',ev,null).plain;
  assert.match(msg,/재지지|손절|1.5R/);
  assert.match(msg,/상태: 3단계 진입 검토 후보/);
  assert.match(msg,/손절 .*가격 -[0-9.]+%/);
  assert.match(msg,/1차 익절 1.5R .*가격 \+[0-9.]+%/);
  assert.match(msg,/2차 익절 2R .*가격 \+[0-9.]+%/);
});
test('failed close, stale bar, and unconfirmed future close cannot trigger stage 3',()=>{
  const {bars} = breakoutBars(), anchor=anchorOfBreakout(accumulationWatch(bars,NOW));
  const t=601*H1+M15+20_000;
  const {bars:valid} = retestedBars();
  assert.equal(accumulationRetest(valid,anchor,600*H1),null,'future 1H close');
  assert.equal(accumulationRetest(valid,anchor,t+2*H1),null,'stale 1H close');
  const below=structuredClone(valid);
  below.at(-1).c=anchor.upper*.99; below.at(-1).o=anchor.upper;
  below.at(-1).h=anchor.upper*1.001;
  below.at(-1).l=anchor.upper*.985;
  assert.equal(accumulationRetest(below,anchor,t)?.status,'invalidated');
});
test('Stage 2 then stage 3 persists state without RICH300 feed or duplicate sends',async()=>{
  const source=breakoutBars(), state={}, sent=[];
  let bars=source.bars;
  const input={
    now:NOW,state,env:{RADAR_SIGNAL:'on',RADAR_ACCUMULATION_WATCH:'on',
      RADAR_EMA_PULLBACK:'off',RADAR_DONCHIAN:'off',RADAR_RICH300_FEED:'on',
      RADAR_RICH300_BUTTONS:'on'},
    send:async text=>sent.push(text),save:async()=>{},
    collectHour:async()=>({calls:0,coins:{
      'BNB-USDT-SWAP':{symbol:'BNBUSDT',status:'fresh',c1h:bars,c4h:[]},
    },btc4h:null}),
    collectM15:async()=>({calls:0,coins:{}}),
    analyze:()=>({status:'ok',stage:0}),
    scanAll:true,force:true,
  };
  const first=await signalStep(input);
  assert.equal(first.accumulation.selected,1);
  assert.ok(state.signal.accumulation.breakouts.BNBUSDT);
  assert.equal(sent.length,1);
  assert.equal(state.signal.feed,undefined);
  const {bars:ret}=retestedBars();
  bars=ret; input.now=601*H1+M15+20_000;
  const second=await signalStep(input);
  assert.equal(second.accumulation.retestSelected,1,JSON.stringify(second.accumulation));
  assert.equal(sent.length,2);
  assert.match(sent[1],/3단계 진입 관심 후보/);
  assert.equal(state.signal.accumulation.breakouts.BNBUSDT,undefined);
  assert.ok(state.signal.accumulation.sent['BNBUSDT:RETEST']);
  assert.equal(state.signal.feed,undefined);
  assert.deepEqual(state.signal.coins,{});
  const third=await signalStep(input);
  assert.equal(third.accumulation.retestSelected,0);
  assert.equal(sent.length,2,'cooldown prevents repeated entry-interest');
});
test('active breakout is pinned to the rotation watch even without a paper trade',()=>{
  const sg={coins:{},accumulation:{breakouts:{BNBUSDT:{status:'watching',breakoutAt:NOW-H1,
    upper:101,lower:98}}}};
  assert.ok(watchlist({},sg,NOW,null,32,true).includes('BNBUSDT'));
  assert.ok(expandedWatchlist({},sg,NOW,null,Array.from({length:60},(_,i)=>'COIN'+i+'USDT'),32,true).includes('BNBUSDT'));
});
test('Photo SVG uses matching confirmed 1H candle and real breakout/retest levels',()=>{
  const {bars:breaks}=breakoutBars();
  const stage2=accumulationWatch(breaks,NOW);
  const svg2=buildAccumulationSvg('BNBUSDT',stage2,breaks);
  assert.match(svg2,/2단계/);
  assert.doesNotMatch(svg2,/손절 기준|가상 목표 2R/);
  const {bars}=retestedBars(), anchor=anchorOfBreakout(stage2);
  const s=accumulationRetest(bars,anchor,601*H1+M15+20_000);
  const svg3=buildAccumulationSvg('BNBUSDT',s,bars);
  assert.match(svg3,/3단계/);
  assert.match(svg3,/재지지 손절/);
  assert.match(svg3,/가상 목표 1.5R/);
  const caption = accumulationCaption('BNBUSDT',s);
  assert.match(caption,/상태: 3단계 진입 검토 후보/);
  assert.match(caption,/손절 .*가격 -[0-9.]+%/);
  assert.match(caption,/1차 익절 1.5R .*가격 \+[0-9.]+%/);
  assert.match(caption,/2차 익절 2R .*가격 \+[0-9.]+%/);
  assert.ok([...caption].length <= 1024);
  const watchCaption = accumulationCaption('BNBUSDT',stage2);
  assert.match(watchCaption,/상태: 돌파 관찰/);
  assert.match(watchCaption,/재지지 확정 전/);
  assert.doesNotMatch(watchCaption,/1차 익절 1.5R|진입 관심가/);
  assert.ok([...watchCaption].length <= 1024);
  assert.doesNotMatch(svg3,/NaN|Infinity/);
  assert.throws(()=>validateAccumulationChart('BNBUSDT',{...s,asOf:s.asOf+H1},bars),/불일치/);
});
test('PNG renderer smoke check when optional @resvg is installed',async t=>{
  try{await import('@resvg/resvg-js');}
  catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'){t.skip('optional renderer missing in RICH300 CI');return;}throw e;}
  const {bars}=retestedBars();
  const sig=accumulationRetest(bars,anchorOfBreakout(accumulationWatch(breakoutBars().bars,NOW)),601*H1+M15+20_000);
  const png=await renderAccumulationChart('BNBUSDT',sig,bars);
  assert.equal(Buffer.from(png).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
});
