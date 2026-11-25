// Optional LONG-only alert allocation. Caps are editorial alert budgets, not capital weights or return estimates.
import { H1 } from '../opportunity/indicators.mjs';
export const LONG_CAPS=Object.freeze({pullback:10,accumulation:5,sweep:4,breakout:1});
export const earlyLongAlertsOn=env=>String(env?.RADAR_EARLY_LONG_ALERTS??'off').trim().toLowerCase()==='on';
export function btcAllowsLong(candles,at) {
  if (!Array.isArray(candles)||candles.length<2||!Number.isFinite(at)) return false;
  const [prev,last]=candles.slice(-2);
  if (![prev.t,last.t,prev.c,last.c].every(Number.isFinite)||prev.c<=0||last.c<=0||
      last.t-prev.t!==H1||last.t+H1>at||at-last.t-H1>=H1) return false;
  return last.c/prev.c-1 > -0.01;
}
export function candidateLongBucket(ev) {
  if (ev?.dir!=='LONG') return null;
  if (ev.strategy==='ema-pullback') return ev.earlyLongPattern==='sweep'?'sweep':'pullback';
  return ev.strategy==='pullback'?'pullback':'breakout';
}
export function prioritizeCandidates(items) {
  // Keep SHORT positions in the existing sorted list; reorder only LONG slots.
  const rank={pullback:0,sweep:1,breakout:2};
  const longs=items.filter(i=>i.event?.ev?.dir==='LONG').sort((a,b)=>
    rank[candidateLongBucket(a.event.ev)]-rank[candidateLongBucket(b.event.ev)]||
    Number(b.channel==='ema')-Number(a.channel==='ema')||b.score-a.score||b.rr-a.rr);
  const preferred=new Set(longs.filter(i=>i.channel==='ema').map(i=>i.symbol));
  let k=0;
  return items.map(i=>i.event?.ev?.dir==='LONG'?longs[k++]:i)
    .filter(i=>!(i.event?.ev?.dir==='LONG'&&i.channel!=='ema'&&preferred.has(i.symbol)));
}
export function longBudget(day={}) {
  const counts={...day.longAlerts};
  return bucket=>{
    if(!bucket)return true;
    if(!Object.hasOwn(LONG_CAPS,bucket))return false;
    const n=Number.isSafeInteger(counts[bucket])&&counts[bucket]>=0?counts[bucket]:0;
    if(n>=LONG_CAPS[bucket])return false;
    counts[bucket]=n+1; return true;
  };
}
export function countLongAlert(day,bucket) {
  if(!bucket)return;
  day.longAlerts??={};
  day.longAlerts[bucket]=(Number.isSafeInteger(day.longAlerts[bucket])?day.longAlerts[bucket]:0)+1;
}
