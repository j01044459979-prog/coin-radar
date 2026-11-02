// Synthetic, deterministic tests. No OKX/Telegram/account APIs and no orders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fibMode } from '../signal/config.mjs';
import { FIB, fibRsi, fibAnchors, estimatedVolumeProfile, evaluateFibPullback, applyFibGate } from '../signal/fib-pullback.mjs';
import { signalStep } from '../signal/step.mjs';
import { evaluateSignal } from '../signal/evaluate.mjs';
import { mkA, mk15, T, NOW, collectors, oppState } from './signal-fixture.mjs';
import { H1, H4 } from '../opportunity/indicators.mjs';

test('FIB mode defaults OFF; unknown input never enables trading notifications', () => {
  assert.equal(fibMode({}), 'off');
  assert.equal(fibMode({ RADAR_FIB_PULLBACK: 'true' }), 'off');
  assert.equal(fibMode({ RADAR_FIB_PULLBACK: 'ON' }), 'on');
  assert.equal(fibMode({ RADAR_FIB_PULLBACK: 'preview' }), 'preview');
});

test('RSI14 is causal and has sensible flat/up/down boundaries', () => {
  assert.ok(fibRsi(Array(14).fill(100)).every(x => x === null));
  assert.equal(fibRsi(Array(20).fill(100)).at(-1), 50);
  assert.equal(fibRsi(Array.from({length: 60}, (_,i)=>100+i)).at(-1),100);
  assert.equal(fibRsi(Array.from({length: 60}, (_,i)=>100-i)).at(-1),0);
  const seq = Array.from({length: 50}, (_,i)=>100 + Math.sin(i/3));
  const first = fibRsi(seq).at(-1), second = fibRsi([...seq,10000]).at(-2);
  assert.equal(first,second, 'future candle cannot change earlier RSI');
});

const bars = () => {
  const t0 = Date.UTC(2026, 5, 1);
  return Array.from({length: 120}, (_,i) => {
    const c = i < 105 ? 105 + i*0.15 : i === 105 ? 125 : i <= 114 ? 125 - (i-105)*0.7 : 118.8 + (i-115)*0.35;
    return { t:t0+i*H1, o:c-0.06, h:c+(i===105 ? 1:0.25), l:c-0.25, c, q:2000 + (i % 3)*100 };
  });
};
const reverse = (src, k=300) => src.map(x=>({ ...x, o:k-x.o,c:k-x.c,h:k-x.l,l:k-x.h }));
const fours = (c1, isShort=false) => {
  const end = c1.at(-1).t+H1;
  const b = Array.from({length:220}, (_,i) => {
    const c = 50 + i*0.4;
    return {t:end - (220-i)*H4,o:c-0.1,h:c+0.3,l:c-0.3,c,q:2000};
  });
  return isShort ? reverse(b) : b;
};
const m15 = () => {
  const end = bars().at(-1).t+H1, t = end-80*15*60000;
  return Array.from({length:80}, (_,i)=>{
    const c = i<69 ? 100-i*0.025 : i<76 ? 98.275-(i-69)*0.35 : 96.0+(i-76)*1.2;
    return {t:t+i*15*60000,o:c-0.12,h:c+0.2,l:c-0.2,c,q:1000};
  });
};

test('1H confirmed pivot produces correct LONG and SHORT Fibonacci 0.5/0.618 symmetry', () => {
  const c=bars(), L=fibAnchors(c,'LONG',0.5), S=fibAnchors(reverse(c),'SHORT',0.5);
  assert.ok(L && S,'a pivot completed 3 bars ago must exist');
  assert.equal(L.pivotIndex,105); assert.equal(S.pivotIndex,105);
  assert.ok(L.lo<L.hi);
  assert.ok(Math.abs(L.lo-(L.toPrice-0.618*L.height))<1e-8);
  assert.ok(Math.abs(L.hi-(L.toPrice-0.5*L.height))<1e-8);
  assert.ok(Math.abs(S.lo-(300-L.hi))<1e-8 && Math.abs(S.hi-(300-L.lo))<1e-8);
  const hugeNewHigh={...c.at(-1),t:c.at(-1).t+H1,h:1000,c:1000};
  assert.deepEqual(fibAnchors([...c,hugeNewHigh],'LONG',0.5)?.toPrice,L.toPrice,'non-confirmed breakout cannot replace pivot');
});

test('OHLCV profile is marked approximate; missing turnover gives no invented POC',()=>{
  const c=bars(), p=estimatedVolumeProfile(c);
  assert.ok(p && Number.isFinite(p.poc) && p.bars>=30);
  assert.equal(p.method,'OHLCV-approximation');
  assert.equal(estimatedVolumeProfile(c.map(x=>({...x,q:null}))),null);
  assert.equal(estimatedVolumeProfile(c.slice(0,20)),null);
});

test('FIB diagnostic does not use future 4H candle and produces explicit rationales',()=>{
  const c1=bars(), c4=fours(c1), c15=m15(), asOf=c1.at(-1).t+H1;
  const a={status:'ok',dir:'LONG',asOf};
  const r=evaluateFibPullback({a,c1h:c1,c4h:c4,c15});
  assert.ok(r.fib && r.fib.lo<r.fib.hi);
  assert.ok(Number.isFinite(r.rsi1)&&Number.isFinite(r.rsi15));
  assert.ok(r.profile && r.profile.method==='OHLCV-approximation');
  assert.equal(typeof r.ema50Near,'boolean');
  assert.equal(typeof r.profileNear,'boolean');
  const future={...c4.at(-1),t:asOf,h:999999,c:999999};
  assert.deepEqual(evaluateFibPullback({a,c1h:c1,c4h:[...c4,future],c15}),r,'future 4H candle must not change report');
  assert.ok(r.reasons.every(x=>typeof x==='string'));
  const s=evaluateFibPullback({a:{...a,dir:'SHORT'},c1h:reverse(c1),c4h:fours(c1,true),c15:reverse(c15)});
  assert.ok(s.fib,'SHORT should have symmetric anchors');
});

test('legacy evaluation remains unchanged byte-for-byte in OFF and PREVIEW, ON fails closed',()=>{
  const legacy=evaluateSignal({a:mkA(),c15:mk15(),now:NOW});
  assert.equal(legacy.status,'CANDIDATE');
  const report={ok:false,reasons:['모멘텀 회복 없음']};
  assert.strictEqual(applyFibGate(legacy,report,'off'),legacy);
  assert.strictEqual(applyFibGate(legacy,report,'preview'),legacy);
  const blocked=applyFibGate(legacy,report,'on');
  assert.equal(blocked.status,'OBSERVE');
  assert.ok(blocked.blockers.some(x=>x.includes('모멘텀 회복 없음')));
  assert.equal(blocked.evidence,undefined);
  assert.equal(applyFibGate(legacy,null,'on').status,'OBSERVE');
  const pass={ok:true,reasons:[],evidence:'FIB pass',context:'POC approx'};
  const allowed=applyFibGate(legacy,pass,'on');
  assert.equal(allowed.status,'CANDIDATE');
  assert.match(allowed.evidence[0],/FIB pass/);
  assert.equal(allowed.score,legacy.score);
});

test('SIGNAL preview with fib preview logs diagnostics; fib ON blocks unavailable data safely',async()=>{
  const make = mode => {
    const st=oppState(), sent=[];
    return {state:st, now:NOW, env:{RADAR_SIGNAL:'preview',RADAR_FIB_PULLBACK:mode},
      collectHour:collectors().collectHour,collectM15:collectors().collectM15,
      analyze:()=>mkA(),send:async x=>sent.push(x),save:async()=>{throw new Error('preview must not save');}};
  };
  const preview=await signalStep(make('preview'));
  assert.equal(preview.candidates,1);
  assert.ok(preview.preview.lines.some(x=>x.includes('FIB 미충족 [preview]')));
  const blocked=await signalStep(make('on'));
  assert.equal(blocked.candidates,0);
  assert.equal(blocked.observing,1);
  assert.ok(blocked.preview.lines.some(x=>x.includes('FIB 미충족 [on]')));
});

test('workflow flag defaults off and contains no new order or secret handling',()=>{
  const yml=readFileSync(new URL('../../.github/workflows/radar.yml',import.meta.url),'utf8');
  assert.match(yml,/RADAR_FIB_PULLBACK: \$\{\{ vars\.RADAR_FIB_PULLBACK \|\| 'off' \}\}/);
  const source=readFileSync(new URL('../signal/fib-pullback.mjs',import.meta.url),'utf8');
  assert.ok(!/\/api\/v5\/trade|place-order|TELEGRAM_BOT_TOKEN|RICH300_FEED_KEY/.test(source));
});
