import test from 'node:test';
import assert from 'node:assert/strict';
import { structurePatterns, evaluateStructurePreview } from '../signal/structure-preview.mjs';
import { M15 } from '../signal/evaluate.mjs';

const base=()=>Array.from({length:60},(_,i)=>({t:(i+1)*M15,o:101,h:102,l:100,c:101,q:100}));
const edit=(a,i,b)=>Object.assign(a[a.length+i],b);
const mirror=a=>a.map(b=>({...b,o:200-b.o,h:200-b.l,l:200-b.h,c:200-b.c}));
const now=a=>a.at(-1).t+M15;
const sfp=()=>{const a=base();edit(a,-2,{l:98,c:101});edit(a,-1,{o:101,h:104,l:100,c:103,q:200});return a;};
const bos=()=>{const a=base();edit(a,-4,{o:101,h:102,l:100,c:101});edit(a,-3,{o:102,h:106,l:101,c:105});edit(a,-2,{o:105,h:107,l:104,c:106});edit(a,-1,{o:103,h:106,l:103,c:105,q:200});return a;};
test('SFP requires reclaim then closed structure break; long and short mirror',()=>{
  const a=sfp(); assert.ok(structurePatterns(a,'LONG',now(a)).some(p=>p.strategy==='sfp'));
  const b=mirror(a);assert.ok(structurePatterns(b,'SHORT',now(b)).some(p=>p.strategy==='sfp'));
  edit(a,-1,{c:102});assert.ok(!structurePatterns(a,'LONG',now(a)).some(p=>p.strategy==='sfp'));
});
test('BOS FVG requires confirmed gap and retest; long and short mirror',()=>{
  const a=bos();assert.ok(structurePatterns(a,'LONG',now(a)).some(p=>p.strategy==='bos-fvg'));
  const b=mirror(a);assert.ok(structurePatterns(b,'SHORT',now(b)).some(p=>p.strategy==='bos-fvg'));
  edit(a,-1,{l:104.5,o:105,c:105.5});assert.ok(!structurePatterns(a,'LONG',now(a)).some(p=>p.strategy==='bos-fvg'));
});
test('reject stale, unfinished, missing and invalid candles',()=>{
  const a=sfp();assert.deepEqual(structurePatterns(a,'LONG',now(a)-1),[]);
  assert.deepEqual(structurePatterns(a,'LONG',now(a)+21*60000),[]);
  assert.deepEqual(structurePatterns(a.filter((_,i)=>i!==20),'LONG',now(a)),[]);
  edit(a,-1,{q:NaN});assert.deepEqual(structurePatterns(a,'LONG',now(a)),[]);
});
test('preview never bypasses context, volume, risk or target gates',()=>{
  const c15=sfp(), t=now(c15);
  const a={status:'ok',stage:2,dir:'LONG',zone:{lo:99,hi:102,level:100},plan:{},
    asOf:t,metrics:{atr1:4},invalidation:96,obstacles:[{price:120,source:'fixture'}]};
  const good=evaluateStructurePreview({a,c15,now:t});
  assert.ok(good.some(p=>p.strategy==='sfp'));
  assert.deepEqual(evaluateStructurePreview({a:{...a,stage:1},c15,now:t}),[]);
  assert.deepEqual(evaluateStructurePreview({a:{...a,obstacles:[]},c15,now:t}),[]);
  edit(c15,-1,{q:10});assert.deepEqual(evaluateStructurePreview({a,c15,now:t}),[]);
});
