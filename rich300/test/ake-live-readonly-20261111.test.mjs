// Read-only, temporary public AKEUSDT market review for November 11, 2026.
// No private exchange credentials, no user positions, no live trading or production changes.
import test from 'node:test';
import assert from 'node:assert/strict';
const URLS=[
  ['OKX-15m','https://www.okx.com/api/v5/market/candles?instId=AKE-USDT-SWAP&bar=15m&limit=100'],
  ['OKX-1H','https://www.okx.com/api/v5/market/candles?instId=AKE-USDT-SWAP&bar=1H&limit=100'],
  ['OKX-4H','https://www.okx.com/api/v5/market/candles?instId=AKE-USDT-SWAP&bar=4H&limit=100'],
  ['Binance-futures-15m','https://fapi.binance.com/fapi/v1/klines?symbol=AKEUSDT&interval=15m&limit=100'],
  ['Binance-futures-1h','https://fapi.binance.com/fapi/v1/klines?symbol=AKEUSDT&interval=1h&limit=100'],
  ['Bybit-futures-15m','https://api.bybit.com/v5/market/kline?category=linear&symbol=AKEUSDT&interval=15&limit=100'],
  ['Bitget-futures-15m','https://api.bitget.com/api/v2/mix/market/candles?symbol=AKEUSDT&productType=USDT-FUTURES&granularity=15m&limit=100'],
  ['Gate-futures-15m','https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=AKE_USDT&interval=15m&limit=100'],
];
async function load([name,url]){
 try{
  const r=await fetch(url,{signal:AbortSignal.timeout(14000),headers:{'User-Agent':'Mozilla/5.0 (ReadOnlyAkeMarketAudit)'}});
  if(!r.ok)throw Error('HTTP '+r.status);
  const body=await r.json();
  let rows=[];
  if(name.startsWith('OKX')){if(body.code!=='0')throw Error('OKX '+body.msg);rows=body.data.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],done:x[8]==='1'}));}
  else if(name.startsWith('Binance')){if(!Array.isArray(body))throw Error('Binance '+body.msg);rows=body.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]}));}
  else if(name.startsWith('Bybit')){if(body.retCode!==0)throw Error('Bybit '+body.retMsg);rows=body.result.list.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]}));}
  else if(name.startsWith('Bitget')){if(body.code!=='00000')throw Error('Bitget '+body.msg);rows=body.data.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]}));}
  else if(name.startsWith('Gate')){if(!Array.isArray(body))throw Error('Gate '+body.message);rows=body.map(x=>({t:+x.t*1000,o:+x.o,h:+x.h,l:+x.l,c:+x.c,v:+x.v}));}
  rows=rows.filter(x=>Number.isFinite(x.h)&&x.h>0).sort((a,b)=>a.t-b.t);
  const now=Date.now();
  const duration=name.includes('4H')?14400000:name.includes('1H')||name.includes('1h')?3600000:900000;
  rows=rows.filter(x=>(x.done===undefined?x.t+duration<=now:x.done));
  const recent=rows.slice(-40);
  const stats=n=>{const a=rows.slice(-n);return a.length?{hi:Math.max(...a.map(x=>x.h)),low:Math.min(...a.map(x=>x.l)),first:new Date(a[0].t).toISOString(),last:new Date(a.at(-1).t).toISOString()}:null};
  console.log('AKE_MARKET '+JSON.stringify({name,at:new Date(now).toISOString(),count:rows.length,last:recent.at(-1),stats4:stats(4),stats12:stats(12),stats24:stats(24),bars:recent}));
  return recent.length;
 }catch(e){console.log('AKE_MARKET '+JSON.stringify({name,error:String(e)}));return 0;}
}
test('AKE public recent market kline audit', {timeout:180000},async()=>{
 const count=await Promise.all(URLS.map(load));
 console.log('AKE_MARKET_SUMMARY '+JSON.stringify({at:new Date().toISOString(),results:URLS.map((x,i)=>({source:x[0],count:count[i]}))}));
 assert.ok(count.some(x=>x>0),'No public exchange endpoint reachable from runner');
});
