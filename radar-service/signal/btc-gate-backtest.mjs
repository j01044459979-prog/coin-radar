// Read-only comparison of candidate strategies with/without BTC gate. No exchange orders.
// A signal is executed at next 15m open, fixed original stop and TP1, 24h timeout.
// Equal-risk R, not account sizing. Conservative stop-first intrabar ambiguity.
import { aggregate,H1,H4 } from '../opportunity/indicators.mjs';
import { analyzeCoin } from '../opportunity/analysis.mjs';
import { evaluateSignal,M15,SIG } from './evaluate.mjs';
import { evaluatePullback } from './pullback-alert.mjs';
import { emaSetup,evaluateEmaPullback } from './ema-pullback.mjs';
import { btcGate } from './btc-gate.mjs';
const M5=300000;
const before=(bars,step,t,n)=>{
  let l=0,r=bars.length;while(l<r){const m=(l+r)>>1;if(bars[m].t+step<=t)l=m+1;else r=m;}return bars.slice(Math.max(0,l-n),l);
};
export function simulateCandidate(c15,i,ev,costMultiplier=1){
  const b=c15[i+1],s=ev.dir==='LONG'?1:-1;
  if(!b||b.t!==c15[i].t+M15||!Number.isFinite(b.o))return null;
  const entry=b.o,r=(entry-ev.stop)*s, originalRisk=(ev.entry-ev.stop)*s;
  if(!(r>0&&originalRisk>0&&(ev.t1.price-entry)*s>0))return null;
  const maxEnd=i+96;if(maxEnd>=c15.length)return null;
  let exit=null,at=null;
  for(let k=i+1;k<=maxEnd;k++){
    const bar=c15[k];if(bar.t!==c15[i].t+(k-i)*M15)return null;
    const stopHit=s>0?bar.l<=ev.stop:bar.h>=ev.stop;
    const tpHit=s>0?bar.h>=ev.t1.price:bar.l<=ev.t1.price;
    if(stopHit){exit=s>0?Math.min(bar.o,ev.stop):Math.max(bar.o,ev.stop);at=bar.t+M15;break;}
    if(tpHit){exit=ev.t1.price;at=bar.t+M15;break;}
    if(k===maxEnd){exit=bar.c;at=bar.t+M15;}
  }
  return {r:((exit-entry)*s-entry*ev.costPct/100*costMultiplier)/originalRisk,exitAt:at};
}
const summarize=rows=>{
  let sum=0,peak=0,dd=0;
  // Event-sequence drawdown is not portfolio equity drawdown; overlapping trades may exist.
  for(const x of [...rows].sort((a,b)=>a.exitAt-b.exitAt||a.symbol.localeCompare(b.symbol))){sum+=x.r;peak=Math.max(peak,sum);dd=Math.max(dd,peak-sum);}
  return {n:rows.length,winRate:rows.length?rows.filter(x=>x.r>0).length/rows.length:null,netR:sum,meanR:rows.length?sum/rows.length:null,eventDrawdownR:dd};
};
export function compareBtcGate({coins,btc5m,derivatives,start,end}){
  const btc15=aggregate(btc5m,M5,M15),btc1=aggregate(btc5m,M5,H1),btc4=aggregate(btc5m,M5,H4);
  const rows=[],missing={};let examined=0;
  for(const [symbol,c15] of Object.entries(coins)){
    if(symbol==='BTCUSDT')continue;
    const c1=aggregate(c15,M15,H1),c4=aggregate(c15,M15,H4);
    const last={};
    for(let i=119;i<c15.length-96;i++){
      const at=c15[i].t+M15;if(at<start||at>end)continue;
      const h=before(c1,H1,at,150),f=before(c4,H4,at,300),b4=before(btc4,H4,at,300);
      if(h.length<100||f.length<60||b4.length<60)continue;
      const c=c15.slice(i-119,i+1),a=analyzeCoin(h,f,b4);
      if(a?.status!=='ok')continue;
      const primary=evaluateSignal({a,c15:c,now:at});
      const legacy=primary.status==='CANDIDATE'?primary:(evaluatePullback({a,c1h:h,c15:c,now:at},{minRR:1.5,validMin:45})??primary);
      const ema=evaluateEmaPullback({setup:emaSetup(h,f,at),c15:c,now:at});
      for(const [strategy,ev] of [['legacy',legacy],['ema',ema]]){
        if(ev?.status!=='CANDIDATE'||at-(last[strategy]??-Infinity)<SIG.cooldownMs)continue;
        last[strategy]=at;examined++;
        const gate=btcGate({btc1h:before(btc1,H1,at,150),btc4h:b4,btc15m:before(btc15,M15,at,120),btc5m:before(btc5m,M5,at,100),coin1h:h,derivatives,dir:ev.dir,at});
        for(const m of gate.missing)missing[m]=(missing[m]??0)+1;
        const result=simulateCandidate(c15,i,ev),stress=simulateCandidate(c15,i,ev,2);
        if(result&&stress)rows.push({symbol,strategy,dir:ev.dir,at,allow:gate.allow,coverage:gate.available,...result,stressR:stress.r});
      }
    }
  }
  const cut=start+.7*(end-start),hold=rows.filter(x=>x.at>=cut);
  const breakdown={};for(const strategy of ['legacy','ema'])for(const dir of ['LONG','SHORT']){
    const a=hold.filter(x=>x.strategy===strategy&&x.dir===dir);
    breakdown[strategy+' '+dir]={baseline:summarize(a),filtered:summarize(a.filter(x=>x.allow)),blocked:summarize(a.filter(x=>!x.allow))};
  }
  const baseline=summarize(hold),filtered=summarize(hold.filter(x=>x.allow)),stress=summarize(hold.filter(x=>x.allow).map(x=>({...x,r:x.stressR})));
  const coverage=hold.length?hold.filter(x=>x.coverage===100).length/hold.length:0;
  const passed=hold.length>=100&&filtered.n>=40&&coverage>=.95&&filtered.meanR>0&&filtered.meanR>baseline.meanR&&stress.meanR>0&&filtered.netR>=baseline.netR&&filtered.eventDrawdownR<=baseline.eventDrawdownR;
  return {examined,executed:rows.length,cut,all:{baseline:summarize(rows),filtered:summarize(rows.filter(x=>x.allow))},holdout:{baseline,filtered,blocked:summarize(hold.filter(x=>!x.allow)),stress,coverage,breakdown},missing,passed,warning:'Offline candidate replay only: no live quota, FIB off, fixed cooldown, TP1 exit; current-coin selection survivor bias, funding cashflows not simulated. Not portfolio drawdown. No automatic activation.'};
}
