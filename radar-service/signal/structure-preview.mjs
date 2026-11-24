// Experimental, preview-only structure patterns. No orders or Telegram changes.
import { evaluateSignal, M15 } from './evaluate.mjs';

const finiteBar = b => b && [b.t,b.o,b.h,b.l,b.c,b.q].every(Number.isFinite) &&
  b.h >= Math.max(b.o,b.c) && b.l <= Math.min(b.o,b.c) && b.l > 0 && b.q >= 0;
const high = a => Math.max(...a.map(b => b.h));
const low = a => Math.min(...a.map(b => b.l));

// Inputs are confirmed candles, as provided by the existing collector.
// Last candle must confirm the structure; no lookahead or intrabar signals.
export function structurePatterns(c15, dir, now) {
  if (!['LONG','SHORT'].includes(dir) || !Array.isArray(c15) || c15.length < 60 ||
      !Number.isFinite(now) || !c15.every(finiteBar) ||
      c15.some((b,i) => i > 0 && b.t - c15[i-1].t !== M15)) return [];
  const n = c15.length, last = c15[n-1], s = dir === 'LONG' ? 1 : -1, L = s === 1;
  if (last.t + M15 > now || now - last.t - M15 > 20*60000 || (last.c-last.o)*s <= 0) return [];
  const found = [];
  // SFP: sweep a preceding 16-bar extreme, close back inside, then break
  // the sweep candle and intervening micro structure on the final closed bar.
  for (let i=n-2; i>=n-5; i--) {
    const sweep = c15[i], prior = c15.slice(i-16,i), level = L ? low(prior) : high(prior);
    const extreme = L ? sweep.l : sweep.h;
    const after = c15.slice(i+1,n-1), trigger = L ? high(c15.slice(i,n-1)) : low(c15.slice(i,n-1));
    if ((extreme-level)*s < 0 && (sweep.c-level)*s > 0 &&
        after.every(b => ((L?b.l:b.h)-extreme)*s > 0 && (b.c-level)*s > 0) &&
        ((L?last.l:last.h)-extreme)*s > 0 && (last.c-trigger)*s > 0) {
      found.push({strategy:'sfp', level, extreme, trigger, patternT:sweep.t}); break;
    }
  }
  // BOS: directional close through prior 16-bar structure; three-candle FVG
  // confirmed before the final candle, then a retest and directional close.
  for (let i=n-3; i>=n-10; i--) {
    const first=c15[i-1], middle=c15[i], third=c15[i+1], prior=c15.slice(i-17,i-1);
    const level=L?high(prior):low(prior);
    const lo=L?first.h:third.h, hi=L?third.l:first.l;
    if (!(hi>lo) || (middle.c-level)*s<=0 || (middle.c-middle.o)*s<=0 ||
        (first.c-level)*s>0 || (third.c-level)*s<=0) continue;
    const after=c15.slice(i+2,n), far=L?lo:hi, near=L?hi:lo;
    if (!after.every(b=> (b.c-far)*s>=0) ||
        !(last.l<=hi && last.h>=lo) || (last.c-near)*s<=0 || (last.c-level)*s<=0) continue;
    found.push({strategy:'bos-fvg',level,lo,hi,patternT:middle.t}); break;
  }
  return found;
}

// Reuse existing structural stop/targets, cost, volume, anti-chase, stage,
// freshness and risk gates. Only replace the old 7-bar trigger in this preview.
export function evaluateStructurePreview(input, cfg={}) {
  const {a,c15,now}=input;
  if (a?.status!=='ok' || a.stage<2 || !a.dir) return [];
  const patterns=structurePatterns(c15,a.dir,now);
  if (!patterns.length) return [];
  const ev=evaluateSignal(input,{...cfg,minRR:Math.max(1.5,cfg.minRR??1.5),ignore:['trigger']});
  if (ev.status!=='CANDIDATE') return [];
  return patterns.map(p=>({...ev,strategy:p.strategy,pattern:p,
    evidence:[p.strategy==='sfp'?'SFP 유동성 스윕 후 구조 회복':'BOS + FVG 리테스트 확정',...ev.evidence.filter((_,i)=>i!==1)]}));
}
