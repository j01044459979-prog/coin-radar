// Read-only historical comparison: old vs experimental EMA LONG, no Telegram/account/order/state access.
import { jsonRequest } from '../service.mjs';
import { parseCandles } from '../opportunity/collect.mjs';
import { buildFrames, pathOutcome } from './backtest.mjs';
import { emaSetup, evaluateEmaPullback } from './ema-pullback.mjs';
import { H1, H4 } from '../opportunity/indicators.mjs';
import { M15 } from './evaluate.mjs';
const IDS = ['SOL','ETH','XRP','DOGE','ZEC'];
const DAYS = 45, WARM = 16, HORIZON = 192;
const until = Math.floor(Date.now()/M15)*M15;
const start = until-DAYS*96*M15, split = start+Math.floor(DAYS*96/2)*M15;
const pause = ms => new Promise(r=>setTimeout(r,ms));
async function load(symbol) {
  let rows=[], cursor='', attempts=0;
  const floor=start-WARM*96*M15;
  while (!rows.length || Number(rows.at(-1)[0]) > floor) {
    let b;
    try {
      b=await jsonRequest('https://www.okx.com/api/v5/market/history-candles?instId='+symbol+'-USDT-SWAP&bar=15m&limit=100'+(cursor?'&after='+cursor:''));
      if(b.code!=='0'||!Array.isArray(b.data)) throw Error('OKX '+b.code);
    } catch(e) { if(++attempts>3) throw e; await pause(1000*attempts); continue; }
    attempts=0; if(!b.data.length) break;
    const next=b.data.at(-1)[0]; if(cursor===next) throw Error('pagination stalled');
    rows.push(...b.data); cursor=next; await pause(160);
  }
  const bars=parseCandles(rows,M15).candles.filter(b=>b.t>=floor&&b.t+M15<=until);
  if(bars.length < (DAYS+WARM)*96*0.98) throw Error(symbol+' insufficient history '+bars.length);
  if(bars.some((b,i)=>i&&b.t-bars[i-1].t!==M15)) throw Error(symbol+' gaps');
  return bars;
}
const records={baseline:[],early:[]};
function evaluate(symbol,c15) {
  const {c1h,c4h}=buildFrames(c15);
  let p1=0,p4=0,cache=-1,setup=null;
  const next={baseline:-1,early:-1};
  for(let i=0;i<c15.length-HORIZON;i++) {
    const t=c15[i].t+M15;
    while(p1<c1h.length&&c1h[p1].t+H1<=t)p1++;
    while(p4<c4h.length&&c4h[p4].t+H4<=t)p4++;
    if(t<start||p1<100||p4<90||i<120)continue;
    // Avoid training trades overlapping the held-out period.
    if(t<split&&t+HORIZON*M15>=split)continue;
    if(cache!==p1){setup=emaSetup(c1h.slice(Math.max(0,p1-150),p1),c4h.slice(Math.max(0,p4-300),p4),t);cache=p1;}
    if(setup?.dir!=='LONG')continue;
    const win=c15.slice(i-119,i+1);
    for(const key of ['baseline','early']){
      if(i<=next[key])continue;
      const ev=evaluateEmaPullback({setup,c15:win,now:t+1000},{earlyLong:key==='early',minRR:1.5});
      if(ev.status!=='CANDIDATE')continue;
      const entry=c15[i+1].o,risk=entry-ev.stop;
      if(!(risk>0&&entry<ev.t1.price&&(ev.t1.price-entry-entry*0.0015)/risk>=1.5))continue;
      const out=pathOutcome(c15,i,'LONG',ev.stop,ev.t1.price,{horizon:HORIZON});
      if(!out||out.skipped)continue;
      next[key]=i+out.bars+8;
      records[key].push({symbol,t,pattern:ev.earlyLongPattern??'classic',net:out.net,stress:out.netStress,kind:out.kind});
    }
  }
}
const queue=[...IDS]; await Promise.all([0,1].map(async()=>{while(queue.length){const sym=queue.shift();const bars=await load(sym);evaluate(sym,bars);console.log('LOAD',sym,bars.length);}}));
const stats=xs=>({n:xs.length,win:xs.length?xs.filter(x=>x.net>0).length/xs.length:null,
  net:xs.length?xs.reduce((s,x)=>s+x.net,0)/xs.length:null,
  stress:xs.length?xs.reduce((s,x)=>s+x.stress,0)/xs.length:null,
  coins:new Set(xs.map(x=>x.symbol)).size});
const results=Object.fromEntries(Object.entries(records).map(([k,rs])=>[k,{train:stats(rs.filter(x=>x.t<split)),holdout:stats(rs.filter(x=>x.t>=split)),patterns:Object.fromEntries(['classic','cooling','sweep'].map(p=>[p,stats(rs.filter(x=>x.t>=split&&x.pattern===p))]))}]));
const a=results.early.holdout,b=results.baseline.holdout;
const pass=a.n>=50&&a.coins>=3&&a.net>0&&a.stress>0&&b.n>=30&&a.net>=b.net;
console.log(JSON.stringify({start:new Date(start),split:new Date(split),until:new Date(until),results,pass,limits:'fixed 5 coins, 45d, next open fill, 48h max, non-overlap, funding and live slippage not measured; exploratory holdout not proof'},null,2));
if(!pass)process.exitCode=2;
