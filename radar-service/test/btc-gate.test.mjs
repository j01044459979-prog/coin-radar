import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFunding,parseOi,derivativeAt,collectBtcDerivatives} from '../signal/btc-derivatives.mjs';
import {btcGate,btcGateMode} from '../signal/btc-gate.mjs';
import {priceStages,scaleDecorate,scaleCaption} from '../signal/scale-decorate.mjs';
const H=3600000, at=H*10000;
const bars=(step,n,dir=1)=>Array.from({length:n},(_,i)=>{const c=100+dir*i*.1;return {t:at-(n-i)*step,o:c,h:c+.3,l:c-.3,c,q:100};});
const inputs=()=>({btc1h:bars(H,55),btc4h:bars(4*H,55),btc15m:bars(H/4,22),btc5m:bars(H/12,22),coin1h:bars(H,55),dir:'LONG',at});
test('BTC gate exposes uncollected derivatives rather than inventing points',()=>{
  const g=btcGate(inputs());
  assert.equal(g.available,90);assert.ok(g.score<=90);assert.ok(g.missing.includes('펀딩')&&g.missing.includes('OI'));
  assert.equal(btcGateMode({RADAR_BTC_GATE:'preview'}),'preview');
  assert.equal(btcGateMode({}),'off');
});
test('BTC gate cannot pass missing candles, stale candles or simultaneous opposing trends',()=>{
  const x=inputs();
  assert.equal(btcGate({...x,btc5m:null}).allow,false);
  assert.equal(btcGate({...x,btc5m:x.btc5m.slice(0,-1)}).allow,false);
  const reverse=btcGate({...x,btc1h:bars(H,55,-1),btc4h:bars(4*H,55,-1)});
  assert.equal(reverse.allow,false);assert.ok(reverse.hard.length);
});
test('price only computes same-unit cumulative averages for both directions, independent of account size',()=>{
  const long={dir:'LONG',entry:100,stop:90},short={dir:'SHORT',entry:100,stop:110};
  assert.deepEqual(priceStages(long),[{price:100,average:100},{price:97,average:98.5},{price:94,average:97}]);
  assert.deepEqual(priceStages(short),[{price:100,average:100},{price:103,average:101.5},{price:106,average:103}]);
  assert.equal(priceStages({...long,stop:110}),null);
  const msg={kind:'candidate',text:'entry',plain:'entry'};
  const a=scaleDecorate(msg,'BTCUSDT',long,{RADAR_PRICE_ONLY:'on',RADAR_PLAN_EQUITY:'10'});
  const b=scaleDecorate(msg,'BTCUSDT',long,{RADAR_PRICE_ONLY:'on',RADAR_PLAN_EQUITY:'10000'});
  assert.deepEqual(a,b);assert.match(a.plain,/3단계/);assert.doesNotMatch(a.plain,/증거금|평가액|USDT/);assert.equal(a.scale.plan,undefined);
  assert.equal(scaleCaption('x'.repeat(1000),a),null);
});

test('settled funding and OI use only data available at signal time',()=>{
  const funding=parseFunding([{instId:'BTC-USDT-SWAP',fundingTime:at-8*H,realizedRate:'0.0001'},{instId:'BTC-USDT-SWAP',fundingTime:at,realizedRate:'0.0002'},{instId:'BTC-USDT-SWAP',fundingTime:at+8*H,realizedRate:'0.01'},{instId:'BTC-USDT-SWAP',fundingTime:at-H,realizedRate:''}]);
  const oi=parseOi([[at-2*H,'100'],[at-H,'102'],[at,'1000']]);
  const d=derivativeAt({funding,oi},at);
  assert.ok(Math.abs(d.funding8hPct-.02)<1e-9);
  assert.ok(Math.abs(d.oi1hPct-2)<1e-9);
  assert.equal(btcGate({...inputs(),derivatives:{funding,oi}}).available,100);
  assert.equal(btcGate({...inputs(),derivatives:null}).allow,false);
  assert.equal(derivativeAt({funding,oi},at+24*H).oi1hPct,null);
});
test('derivative collector is bounded, public-only and stops on exchange restriction',async()=>{
  const urls=[];
  const x=await collectBtcDerivatives({fetcher:async url=>{urls.push(String(url));return new Response(JSON.stringify({code:'50011',data:[]}));}});
  assert.equal(x.calls,1);assert.equal(x.stopped,true);assert.match(urls[0],/public\/funding-rate-history/);
});
