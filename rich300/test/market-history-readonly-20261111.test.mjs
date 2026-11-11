// Temporary read-only market-history audit for public candle prices; no private positions or trades.
import test from 'node:test';
import { strict as assert } from 'node:assert';
const symbols=["LINKUSDT","ARBUSDT","ETHUSDT","ONDOUSDT","TRUMPUSDT","PNUTUSDT","ENAUSDT","BNBUSDT","DOGEUSDT","SUIUSDT","BASEDUSDT","UNIUSDT","BEATUSDT","SOLUSDT","DOTUSDT","CAPUSDT","BTCUSDT","ALLOUSDT","AXSUSDT","FILUSDT","AAVEUSDT","BILLUSDT","BATUSDT","MERLUSDT","WLDUSDT","CHZUSDT","HYPEUSDT","ALGOUSDT","XRPUSDT","AKEUSDT","APEUSDT","INITUSDT","ADAUSDT"];
const START=Date.parse('2026-11-04T12:00:00Z'), END=Date.parse('2026-11-11T04:00:00Z');
async function fetchJson(url) {
 const r=await fetch(url,{signal:AbortSignal.timeout(9000)});
 if(!r.ok)throw Error('HTTP '+r.status);
 return r.json();
}
async function load(symbol) {
 const sources=[
 async()=>{const q=new URLSearchParams({category:'linear',symbol,interval:'15',start:String(START),end:String(END),limit:'1000'});const r=await fetchJson('https://api.bybit.com/v5/market/kline?'+q);if(r.retCode!==0||!Array.isArray(r.result?.list))throw Error('bybit '+r.retMsg);return {src:'Bybit linear',rows:r.result.list.map(x=>[Number(x[0]),Number(x[2]),Number(x[3])])};},
 async()=>{const q=new URLSearchParams({symbol,interval:'15m',startTime:String(START),endTime:String(END),limit:'1000'});const r=await fetchJson('https://data-api.binance.vision/api/v3/klines?'+q);if(!Array.isArray(r))throw Error('binance error');return {src:'Binance spot',rows:r.map(x=>[Number(x[0]),Number(x[2]),Number(x[3])])};}
 ];
 let errors=[];
 for(const fn of sources){try{let a=await fn();a.rows=a.rows.filter(x=>x[0]>=START&&x[0]+900000<=END).sort((x,y)=>x[0]-y[0]);if(a.rows.length<4)throw Error('too few candles '+a.rows.length);return a;}catch(e){errors.push(String(e).slice(0,70));}}
 return {src:'unavailable',rows:[],errors};
}
test('public OHLC read-only exploration; no private orders', {timeout:220000}, async()=>{
 let i=0;const results=new Array(symbols.length);
 async function worker(){while(i<symbols.length){const k=i++,symbol=symbols[k];results[k]=await load(symbol);const a=results[k];console.log('MARKET_DATA '+JSON.stringify({symbol,src:a.src,rows:a.rows,errors:a.errors}));}}
 await Promise.all(Array.from({length:6},worker));
 const ok=results.filter(x=>x.rows.length>0).length;
 console.log('MARKET_DATA_SUMMARY '+JSON.stringify({symbols:symbols.length,available:ok,unavailable:results.length-ok}));
 assert.ok(ok>=1,'At least one exchange candle series needed');
});
