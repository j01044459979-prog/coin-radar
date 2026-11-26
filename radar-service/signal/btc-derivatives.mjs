// Read-only OKX historical data, no keys or account calls. Contract counts, not USD notional.
import { jsonRequest, RESTRICTED } from '../service.mjs';
const BASE='https://www.okx.com/api/v5', H=3600000, INST='BTC-USDT-SWAP';
const num=x=>x===null||x===undefined||String(x).trim()===''?NaN:Number(x);
export function parseFunding(rows){
  return (Array.isArray(rows)?rows:[]).filter(x=>x?.instId===INST).map(x=>({t:num(x.fundingTime),rate:num(x.realizedRate)}))
    .filter(x=>Number.isSafeInteger(x.t)&&x.t>0&&Number.isFinite(x.rate)&&Math.abs(x.rate)<.1).sort((a,b)=>a.t-b.t);
}
export function parseOi(rows){
  return (Array.isArray(rows)?rows:[]).filter(Array.isArray).map(x=>({t:num(x[0]),oi:num(x[1])}))
    .filter(x=>Number.isSafeInteger(x.t)&&x.t>0&&Number.isFinite(x.oi)&&x.oi>0).sort((a,b)=>a.t-b.t);
}
export function derivativeAt(data,at){
  const {funding=[],oi=[]}=data??{};
  if(!Number.isFinite(at))return {};
  const f=funding.filter(x=>x.t<=at).slice(-2), o=oi.filter(x=>x.t+H<=at).slice(-2);
  // Conservative: hourly OI bucket is not available until one hour after its label.
  const fundingInterval=f.length===2?(f[1].t-f[0].t)/H:0;
  const rate=fundingInterval>=1&&fundingInterval<=12&&at-f[1].t<=fundingInterval*H+H?f[1].rate*100*8/fundingInterval:null;
  const oiPct=o.length===2&&o[1].t-o[0].t===H&&at-o[1].t-H<H*2?(o[1].oi/o[0].oi-1)*100:null;
  return {funding8hPct:Number.isFinite(rate)?rate:null,oi1hPct:Number.isFinite(oiPct)?oiPct:null};
}
export async function collectBtcDerivatives({fetcher=fetch,shouldStop=()=>false}={}){
  let funding=[],oi=[],calls=0,stopped=false;
  for(const [path,parse,set] of [
    ['/public/funding-rate-history?instId='+INST+'&limit=10',parseFunding,x=>{funding=x;}],
    ['/rubik/stat/contracts/open-interest-history?instId='+INST+'&period=1H&limit=8',parseOi,x=>{oi=x;}]
  ]){
    if(shouldStop()||stopped)break;
    try{calls++;const r=await jsonRequest(BASE+path,{timeoutMs:5000},fetcher);if(r?.code==='50011'){stopped=true;continue;}if(r?.code==='0')set(parse(r.data));}
    catch(e){if(RESTRICTED.includes(e.status))stopped=true;}
  }
  return {funding,oi,calls,stopped};
}
