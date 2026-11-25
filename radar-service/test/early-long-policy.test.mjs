import test from 'node:test';
import assert from 'node:assert/strict';
import { H1 } from '../opportunity/indicators.mjs';
import { earlyLongAlertsOn, btcAllowsLong, candidateLongBucket, prioritizeCandidates, longBudget, countLongAlert, LONG_CAPS } from '../signal/early-long-policy.mjs';

test('long-only allocation is opt-in and does not consume short slots',()=>{
  assert.equal(earlyLongAlertsOn({}),false);
  assert.equal(earlyLongAlertsOn({RADAR_EARLY_LONG_ALERTS:'on'}),true);
  const d={},b=longBudget(d);
  for (const [kind,n] of Object.entries(LONG_CAPS)){
    for(let j=0;j<n;j++){assert.equal(b(kind),true);countLongAlert(d,kind);}
    assert.equal(b(kind),false);
  }
  assert.equal(b(null),true);
  assert.equal(longBudget(d)('breakout'),false);
  assert.equal(candidateLongBucket({dir:'SHORT',strategy:'ema-pullback'}),null);
});
test('BTC requires fresh confirmed candles and excludes hourly selloff',()=>{
  const t=100*H1, bars=[{t:t-2*H1,c:100},{t:t-H1,c:99.5}];
  assert.equal(btcAllowsLong(bars,t),true);
  assert.equal(btcAllowsLong([bars[0],{...bars[1],c:98.5}],t),false);
  assert.equal(btcAllowsLong(bars,t+H1),false);
  assert.equal(btcAllowsLong(bars,t-1),false);
  assert.equal(btcAllowsLong(null,t),false);
});
test('priority favors pullback then sweep, keeps shorts and deduplicates early EMA versus legacy',()=>{
  const item=(symbol,dir,channel,strategy,pattern)=>({symbol,channel,score:50,rr:2,event:{ev:{dir,strategy,earlyLongPattern:pattern}}});
  const s=item('BTCUSDT','SHORT',null), old=item('ETHUSDT','LONG',null), ema=item('ETHUSDT','LONG','ema','ema-pullback','cooling'), sweep=item('SOLUSDT','LONG','ema','ema-pullback','sweep'), b=item('XRPUSDT','LONG',null);
  const out=prioritizeCandidates([old,s,b,sweep,ema]);
  assert.deepEqual(out,[ema,s,sweep,b]);
});
