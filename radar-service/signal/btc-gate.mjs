// Experimental market-context gate. No account information, orders or win-rate estimates.
import { ema, H1, H4 } from '../opportunity/indicators.mjs';
const M5=300000,M15=900000;
const finite = n => Number.isFinite(n) && n>0;
const clean=(bars,step,n,at)=>{
  if(!Array.isArray(bars)||!Number.isFinite(at))return null;
  const b=bars.filter(x=>x.t+step<=at).slice(-n);
  if(b.length!==n||b.at(-1).t+step>at||at-b.at(-1).t-step>=step)return null;
  return b.every((x,i)=>[x.o,x.h,x.l,x.c].every(finite)&&x.h>=Math.max(x.o,x.c)&&x.l<=Math.min(x.o,x.c)&&(!i||x.t-b[i-1].t===step))?b:null;
};
const change=b=>(b.at(-1).c/b.at(-2).c-1)*100;
const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
export const btcGateMode=(env={})=>['on','preview'].includes(String(env.RADAR_BTC_GATE??'').toLowerCase())?String(env.RADAR_BTC_GATE).toLowerCase():'off';
export function btcGate({btc1h,btc4h,btc5m,btc15m,coin1h,dir,at}={}){
  const s=dir==='LONG'?1:dir==='SHORT'?-1:0;
  const h=clean(btc1h,H1,55,at),f=clean(btc4h,H4,55,at),m=clean(btc15m,M15,22,at),q=clean(btc5m,M5,22,at),a=clean(coin1h,H1,2,at);
  const notes=[],missing=[],hard=[];let score=0,available=0;
  const add=(name,weight,value,detail)=>{if(value===null){missing.push(name);return;}available+=weight;score+=weight*value;notes.push(name+' '+detail);};
  const trend=b=>{const p=b.map(x=>x.c),fast=ema(p,20).at(-1),slow=ema(p,50).at(-1);return Math.sign(fast-slow)===s&&Math.sign(p.at(-1)-fast)===s?1:Math.sign(fast-slow)===-s&&Math.sign(p.at(-1)-fast)===-s?0:.5;};
  for(const [label,b] of [['1H',h],['4H',f]]){const v=b&&s?trend(b):null;add(label,10,v,v===1?'정렬':v===0?'역행':'혼조');}
  for(const [label,b] of [['5m',q],['15m',m]]){const d=b?change(b):null;add(label,10,d===null||!s?null:Math.abs(d)<.05?.5:d*s>0?1:0,d===null?'':d.toFixed(2)+'%');}
  if(m&&s){
    const last=m.at(-1),prev=m.slice(-21,-1),low=Math.min(...prev.map(x=>x.l)),high=Math.max(...prev.map(x=>x.h));
    const loc=(last.c-low)/(high-low||Infinity);
    const near=s>0?loc>=.85:loc<=.15,broken=s>0?last.c<low:last.c>high;
    add('구조',15,broken?0:near?.5:1,'지지 '+low+' / 저항 '+high+(broken?' · 역방향 이탈':near?' · 목표방향 경계 근접':''));
    if(broken)hard.push('BTC 15분 역방향 구조 이탈');
    const vols=prev.map(x=>x.q);const vr=vols.every(finite)&&finite(last.q)?last.q/avg(vols):null;
    add('거래량',10,vr===null?null:change(m)*s>0?Math.min(1,vr/1.5):vr>=1.5?0:.5,vr===null?'':vr.toFixed(2)+'배');
    const tr=prev.slice(1).map((x,i)=>Math.max(x.h-x.l,Math.abs(x.h-prev[i].c),Math.abs(x.l-prev[i].c)));
    const atr=avg(tr),shock=atr>0?Math.abs(last.c-prev.at(-1).c)/atr:null;
    add('변동성',15,shock===null?null:shock>=2.5?0:shock>=1.5?.5:1,shock===null?'':shock.toFixed(2)+' ATR');
    if(shock!==null&&shock>=2.5)hard.push('BTC 급등락 위험');
  }else{for(const [n,w] of [['구조',15],['거래량',10],['변동성',15]])add(n,w,null,'');}
  const rel=h&&a&&h.at(-1).t===a.at(-1).t?change(a)-change(h):null;
  add('상대강도',10,rel===null||!s?null:rel*s>.05?1:Math.abs(rel)<=.05?.5:0,rel===null?'':rel.toFixed(2)+'%p');
  // Derivatives not collected in this version. Never invent or renormalize missing 10 points.
  add('펀딩/OI',10,null,'');
  if(h&&f&&s&&trend(h)===0&&trend(f)===0)hard.push('BTC 1H·4H 동시 역행');
  const core=!!(s&&h&&f&&m&&q&&a&&available>=80);
  const rounded=Math.round(score);
  const grade=hard.length?'C':!core?'B':rounded>=85?'A+':rounded>=70?'A':rounded>=50?'B':'C';
  return {score:rounded,available,grade,allow:core&&!hard.length&&rounded>=70,notes,missing,hard};
}
export function btcGateLines(g){
  return ['BTC 환경 '+g.score+'/100 (확인 '+g.available+'점, '+g.grade+' · 실험)',...g.notes,...(g.missing.length?['미확인: '+g.missing.join(', ')]:[]),...(g.hard.length?['위험: '+g.hard.join(', ')]:[]),'※ 조건점수 · 승률 아님'];
}
