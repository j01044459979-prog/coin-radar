// TEMP READ-ONLY public OKX/Bitget/Gate market-kline snapshot. DO NOT MERGE.
import test from 'node:test';
import assert from 'node:assert/strict';
const urls=[
 ['OKX-15m','https://www.okx.com/api/v5/market/candles?instId=AKE-USDT-SWAP&bar=15m&limit=100'],
 ['OKX-1H','https://www.okx.com/api/v5/market/candles?instId=AKE-USDT-SWAP&bar=1H&limit=100'],
 ['OKX-4H','https://www.okx.com/api/v5/market/candles?instId=AKE-USDT-SWAP&bar=4H&limit=100'],
 ['OKX-ticker','https://www.okx.com/api/v5/market/ticker?instId=AKE-USDT-SWAP'],
 ['Bitget-15m','https://api.bitget.com/api/v2/mix/market/candles?symbol=AKEUSDT&productType=USDT-FUTURES&granularity=15m&limit=100'],
 ['Gate-15m','https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=AKE_USDT&interval=15m&limit=100']
];
async function read([name,url]){
 try{
  const r=await fetch(url,{signal:AbortSignal.timeout(13000)});
  if(!r.ok)throw Error('HTTP '+r.status);
  const b=await r.json(),at=Date.now(),ONE=name.includes('4H')?14400000:name.includes('1H')?3600000:900000;
  if(name==='OKX-ticker'){if(b.code!=='0')throw Error('API code '+b.code);console.log('AKE_SNAPSHOT '+JSON.stringify({name,at:new Date(at).toISOString(),ticker:b.data?.[0]}));return true;}
  let bars;
  if(name.startsWith('OKX')){if(b.code!=='0')throw Error('API code '+b.code);bars=b.data.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],confirmed:x[8]==='1'}));}
  else if(name.startsWith('Bitget')){if(b.code!=='00000')throw Error('API code '+b.code);bars=b.data.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]}));}
  else if(name.startsWith('Gate')){if(!Array.isArray(b))throw Error('Gate data unexpected');bars=b.map(x=>({t:+x.t*1000,o:+x.o,h:+x.h,l:+x.l,c:+x.c,v:+x.v}));}
  bars=bars.filter(x=>Number.isFinite(x.c)&&x.c>0&&(x.confirmed===undefined?x.t+ONE<=at:x.confirmed)).sort((a,b)=>a.t-b.t);
  const range=n=>{const a=bars.slice(-n);return {n:a.length,low:Math.min(...a.map(x=>x.l)),high:Math.max(...a.map(x=>x.h))}};
  console.log('AKE_SNAPSHOT '+JSON.stringify({name,at:new Date(at).toISOString(),latest:bars.at(-1),range4:range(4),range12:range(12),range24:range(24),rows:bars.slice(-26)}));
  return true;
 }catch(e){console.log('AKE_SNAPSHOT '+JSON.stringify({name,error:String(e)}));return false;}
}
test('public AKE latest price / 15m 1h 4h trends read-only', {timeout:160000}, async()=>{
 const status=await Promise.all(urls.map(read));
 console.log('AKE_SNAPSHOT_SUMMARY '+JSON.stringify({n:status.filter(Boolean).length,total:status.length}));
 assert.ok(status.some(Boolean),'All exchange market feeds unavailable');
});
