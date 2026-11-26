// Public-data experiment; no secrets, Telegram, account access or operational state.
import {writeFileSync} from 'node:fs';
import {jsonRequest} from '../service.mjs';
import {scanMarket} from '../universe.mjs';
import {parseCandles} from '../opportunity/collect.mjs';
import {parseFunding,parseOi} from './btc-derivatives.mjs';
import {compareBtcGate} from './btc-gate-backtest.mjs';
const BASE='https://www.okx.com/api/v5', D=86400000, H=3600000, I='BTC-USDT-SWAP';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function get(path){
  for(let k=0;;k++){try{const r=await jsonRequest(BASE+path,{timeoutMs:10000});if(r?.code!=='0'||!Array.isArray(r.data))throw Error('OKX code '+r?.code);await pause(250);return r.data;}catch(e){if(k>=3)throw e;await pause(2000*(k+1));}}
}
const now=Date.now(),end=Math.floor(now/D)*D-D,start=end-45*D,warm=start-12*D;
async function candles(id,tf,step){
  let after='', rows=[];
  while(rows.length<Math.ceil((now-warm)/step)+300){
    const p=await get('/market/history-candles?instId='+id+'&bar='+tf+'&limit=100'+(after?'&after='+after:''));
    if(!p.length)break;const next=String(p.at(-1)[0]);if(after&&Number(next)>=Number(after))throw Error('pagination stalled');
    rows.push(...p);after=next;if(Number(after)<=warm||p.length<100)break;
  }
  const out=parseCandles(rows,step).candles.filter(x=>x.t+step<=now);
  if(out.length<100||out[0].t>warm+2*step||out.at(-1).t+step<end+D)throw Error('incomplete candle history');
  return out;
}
async function history(path,timeOf,query,limit=100){
  let cursor='',rows=[];
  for(let k=0;k<30;k++){
    const p=await get(path+'&limit='+limit+(cursor?'&'+query+'='+cursor:''));
    if(!p.length)break;
    const oldest=Math.min(...p.map(timeOf));if(!Number.isFinite(oldest)||cursor&&oldest>=Number(cursor))break;
    rows.push(...p);cursor=String(oldest-1);
    if(oldest<=warm||p.length<limit)break;
  }return rows;
}
const inst=await get('/public/instruments?instType=SWAP'),tick=await get('/market/tickers?instType=SWAP');
const ids=scanMarket({instruments:inst,tickers:tick}).eligible.filter(x=>x.instId!==I&&x.turnover>=1e6).sort((a,b)=>b.turnover-a.turnover).slice(0,12).map(x=>x.instId);
const btc5m=await candles(I,'5m',300000);
const funding=parseFunding(await history('/public/funding-rate-history?instId='+I,x=>Number(x.fundingTime),'after'));
const oi=parseOi(await history('/rubik/stat/contracts/open-interest-history?instId='+I+'&period=1H',x=>Number(x[0]),'end'));
console.log('DERIVATIVE COVERAGE',JSON.stringify({funding:funding.length,oi:oi.length,fundingFrom:funding[0]?.t,oiFrom:oi[0]?.t}));
const coins={},skipped=[];
for(const id of ids){try{coins[id.replace('-USDT-SWAP','USDT')]=await candles(id,'15m',900000);console.log('LOADED',id,coins[id.replace('-USDT-SWAP','USDT')].length);}catch(e){skipped.push(id+': '+e.message);}}
if(Object.keys(coins).length<10)throw Error('fewer than 10 complete symbols: '+skipped.join('; '));
const r=compareBtcGate({coins,btc5m,derivatives:{funding,oi},start,end});
const result={start,end,symbols:Object.keys(coins),skipped,derivativeCoverage:{funding:funding.length,oi:oi.length},...r};
console.log(JSON.stringify(result,null,2));writeFileSync(process.argv[2]||'btc-gate-backtest.json',JSON.stringify(result,null,2));
