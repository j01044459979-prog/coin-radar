import test from 'node:test';
import assert from 'node:assert/strict';
import { memEnv } from './helpers/memenv.mjs';
import { storeInit, storeCreate, storeList } from '../lib/store.mjs';
import { followStart, followRead, followChoice, followKeyboard, followTick, followReport, followAssess, FOLLOW_HOUR_MS } from '../lib/follow.mjs';
import { dayStartMs } from '../lib/time.mjs';

const NOW = dayStartMs('2026-11-05') + 12 * 3600000 + 12 * 60000;
const AT = NOW - FOLLOW_HOUR_MS - 60000;
const SIG = { sid:'SG-ONDO-S-123', strategy:'S', symbolId:'ONDOUSDT', dir:'SHORT', signalAt: AT - 600000, entry:'1', stop:'1.1', tp1:'0.9', tp2:'0.8' };
const candle = (t,c) => ({t,o:c,h:c*1.002,l:c*0.998,c,v:100});
function market(now=NOW, price=.98) {
  const hour0 = Math.floor(now / 3600000) * 3600000 - 3600000;
  const four0 = Math.floor(now / (4*3600000)) * (4*3600000) - 4*3600000;
  const m150 = Math.floor(now / 900000) * 900000 - 900000;
  return {ok:true,source:'OKX',price,priceAt:now-60000,
    bars1h:Array.from({length:60},(_,i)=>candle(hour0-(59-i)*3600000, 1.2-.003*i)),
    bars4h:Array.from({length:60},(_,i)=>candle(four0-(59-i)*4*3600000, 1.3-.004*i)),
    bars15m:Array.from({length:60},(_,i)=>candle(m150-(59-i)*900000,1.04-.001*i)) };
}
function setup(){
  const m=memEnv();storeInit(m.env);
  storeCreate(m.env,'signal',SIG,{actor:'test'});
  storeCreate(m.env,'response',{sid:SIG.sid,choice:'entered',at:AT},{actor:'test'});
  const map=new Map(),calls=[];let t=NOW;
  const kv={get:k=>map.has(k)?map.get(k):null,put:(k,v)=>map.set(k,String(v)),del:k=>map.delete(k)};
  const env={now:()=>t,mode:()=> 'on',storeEnv:()=>m.env,kv,market:()=>market(t),send:(msg,sid)=>{calls.push({msg,sid});return {ok:true}}};
  return {m,map,calls,kv,env,setNow:v=>{t=v}};
}
test('최초 진입 확인부터 1시간 뒤 첫 보고, 5분 재실행은 중복 전송하지 않는다',()=>{
  const x=setup(),r=followStart(x.kv,SIG.sid,AT);
  assert.equal(r.status,'added');assert.equal(followStart(x.kv,SIG.sid,AT).status,'duplicate');
  let out=followTick(x.env);assert.equal(out.sent,1);assert.equal(x.calls.length,1);
  assert.match(x.calls[0].msg,/4H 추세·1H 눌림/);assert.match(x.calls[0].msg,/실제 체결 미확인/);
  assert.match(x.calls[0].msg,/손절/);assert.match(x.calls[0].msg,/TP1/);
  assert.equal(storeList(x.m.env,'fill').length,0); // fake Telegram entry != exchange execution
  x.setNow(NOW+5*60000);out=followTick(x.env);assert.equal(out.sent,0);assert.equal(x.calls.length,1);
  x.setNow(NOW+FOLLOW_HOUR_MS+5000);out=followTick(x.env);assert.equal(out.sent,1);assert.equal(x.calls.length,2);
});
test('유지 중을 눌러도 1시간 주기 유지, 정리했어는 완전히 중단, 이전 버튼으로 재활성화 불가',()=>{
  const x=setup();followStart(x.kv,SIG.sid,AT);followTick(x.env);
  assert.equal(followChoice(x.kv,SIG.sid,'keep',NOW+1000).status,'kept');
  assert.equal(followRead(x.kv,SIG.sid).confirmedAt,NOW+1000);
  assert.equal(followChoice(x.kv,SIG.sid,'close',NOW+2000).status,'closed');
  assert.equal(followChoice(x.kv,SIG.sid,'keep',NOW+3000).status,'already-closed');
  x.setNow(NOW+5*FOLLOW_HOUR_MS);assert.equal(followTick(x.env).sent,0);assert.equal(x.calls.length,1);
});
test('모드는 기본 차단, 미리보기는 상태·전송을 변경하지 않고 시세가 오래됐으면 분석하지 않는다',()=>{
  const x=setup();followStart(x.kv,SIG.sid,AT);
  const before=x.map.size;
  x.env.mode=()=> 'off';assert.equal(followTick(x.env).status,'off');assert.equal(x.calls.length,0);
  x.env.mode=()=> 'preview';let o=followTick(x.env);assert.equal(o.due,1);assert.equal(o.sent,0);assert.equal(x.map.size,before);
  x.env.mode=()=> 'on';x.env.market=()=>({...market(NOW),priceAt:NOW-20*60000});
  o=followTick(x.env);assert.equal(o.stale,1);assert.equal(o.sent,0);
});
test('초기 상태가 없는 과거 버튼·미진입 신호는 후속 분석하지 않고, 실제 청산이 기록되면 중단한다',()=>{
  const x=setup();assert.equal(followTick(x.env).sent,0);assert.equal(x.calls.length,0);
  followStart(x.kv,SIG.sid,AT);
  const fee={state:'entered',amount:'0'},funding={state:'entered',amount:'0'};
  storeCreate(x.m.env,'fill',{origin:'real',fillId:'e1',sid:SIG.sid,kind:'entry',dir:'SHORT',at:AT,price:'1',qty:'10',margin:'10',leverage:'1',fee,funding},{actor:'test'});
  storeCreate(x.m.env,'fill',{origin:'real',fillId:'c1',sid:SIG.sid,kind:'close',dir:'SHORT',at:AT+1000,price:'0.95',qty:'10',fee,funding},{actor:'test'});
  const out=followTick(x.env);assert.equal(out.closed,1);assert.equal(out.sent,0);
  assert.equal(followRead(x.kv,SIG.sid).status,'closed');
});
test('1시간 리포트는 SHORT 손절가 이탈을 먼저 알리고 실제 손익을 주장하지 않는다',()=>{
  const text=followReport({signal:SIG,market:market(NOW,1.13),now:NOW,enteredAt:AT});
  assert.match(text,/손절 기준 이탈/);assert.match(text,/실제 손익 아님/);
  assert.match(text,/진입 응답/);assert.match(text,/현재 공개 시세/);
});
test('버튼 callback_data는 64바이트 이하, 저장은 기존 텔레그램 KV를 쓴다',()=>{
  const kb=followKeyboard(SIG.sid);assert.deepEqual(kb.inline_keyboard[0].map(x=>x.text),['유지 중','정리했어']);
  assert.deepEqual(kb.inline_keyboard[0].map(x=>x.callback_data),['h1:SG-ONDO-S-123:k','h1:SG-ONDO-S-123:c']);
  assert.ok(kb.inline_keyboard[0].every(x=>Buffer.byteLength(x.callback_data)<=64));
  assert.equal(followKeyboard('hello world'),null);
});


test('행동형 리포트는 R, 손절·익절까지 거리, 다음 확정봉 조건, 체결 미확인을 함께 표시한다',()=>{
  const msg=followReport({signal:SIG,market:market(NOW,.98),now:NOW,enteredAt:AT});
  for (const key of [/판단:/,/R \(최초 손절폭 기준\)/,/손절 기준/,/현재가에서/,/남은 거리/,/확인된 15분봉/,/지금 판단과 대응/,/다음 점검:/,/자동 주문·청산 없음/,/실제 Binance 체결 아님/]) assert.match(msg,key);
  assert.match(msg,/\+0\.20R/);assert.match(msg,/추세 유지/);
  assert.ok(msg.length < 3601);
});

test('SHORT과 LONG 손절 위험·TP 도달을 양방향에서 구분하고 거래소 체결로 착각하지 않는다',()=>{
  const S=p=>followAssess({signal:SIG,market:market(NOW,p),now:NOW});
  assert.equal(S(1.11).urgent,'stop');
  assert.match(S(1.11).verdict,/청산 체결 여부/);
  assert.equal(S(1.09).urgent,'near-stop');
  assert.equal(S(.89).urgent,'tp1');
  assert.equal(S(.79).urgent,'tp2');
  assert.equal(S(.98).urgent,null);
  const long={...SIG,dir:'LONG',entry:'100',stop:'90',tp1:'115',tp2:'120'};
  const assess=p=>followAssess({signal:long,market:market(NOW,p),now:NOW});
  assert.equal(assess(89).urgent,'stop');
  assert.equal(assess(92).urgent,'near-stop');
  assert.equal(assess(115).urgent,'tp1');
  assert.equal(assess(121).urgent,'tp2');
  assert.equal(assess(105).rNow,.5);
});

test('추세 역행·유효하지 않은 위험 가격·오래된 15분봉을 보수적으로 처리한다',()=>{
  const x=market(NOW,.97);
  const rising=arr=>arr.map((b,i)=>({...b,o:1+i*.004,c:1+i*.004,h:(1+i*.004)*1.002,l:(1+i*.004)*.998}));
  const r=followAssess({signal:SIG,market:{...x,bars1h:rising(x.bars1h),bars4h:rising(x.bars4h)},now:NOW});
  assert.equal(r.urgent,'reversal');assert.match(r.next,/청산·축소/);
  const invalid=followAssess({signal:{...SIG,stop:'0.8'},market:x,now:NOW});
  assert.equal(invalid.rNow,null);assert.match(invalid.stopText,/R 계산 불가/);
  const stale=followAssess({signal:SIG,market:{...x,bars15m:x.bars15m.map(b=>({...b,t:b.t-3*3600000}))},now:NOW});
  assert.match(stale.fifteenText,/비교 불가/);assert.equal(stale.v15,null);
});

test('15분 단위 긴급 변경만 추가 전송하고 정상 시간 보고 주기는 유지한다',()=>{
  const x=setup();followStart(x.kv,SIG.sid,AT);
  let r=followTick(x.env);assert.equal(r.sent,1);assert.equal(r.alerts,0);
  x.setNow(NOW+20*60000);x.env.market=()=>market(NOW+20*60000,1.09);
  r=followTick(x.env);assert.equal(r.alerts,1);assert.equal(r.sent,1);
  assert.match(x.calls[1].msg,/포지션 전략 변경 경고/);assert.match(x.calls[1].msg,/손절선 근접/);
  x.setNow(NOW+25*60000);r=followTick(x.env);assert.equal(r.sent,0);assert.equal(x.calls.length,2);
  x.setNow(NOW+40*60000);r=followTick(x.env);assert.equal(r.sent,0);assert.equal(x.calls.length,2);
  x.setNow(NOW+FOLLOW_HOUR_MS+5000);x.env.market=()=>market(NOW+FOLLOW_HOUR_MS+5000,1.09);r=followTick(x.env);
  assert.equal(r.sent,1);assert.equal(r.alerts,0);assert.equal(x.calls.length,3);
  assert.equal(storeList(x.m.env,'fill').length,0);
});

test('긴급 알림도 정리 버튼·오래된 시세·preview 조건에서는 발송하지 않는다',()=>{
  const x=setup();followStart(x.kv,SIG.sid,AT);followTick(x.env);
  x.setNow(NOW+20*60000);
  x.env.market=()=>({...market(NOW+20*60000,1.09),priceAt:NOW-20*60000});
  assert.equal(followTick(x.env).sent,0);
  x.env.mode=()=> 'preview';x.env.market=()=>market(NOW+20*60000,1.09);
  const before=x.map.size;
  assert.equal(followTick(x.env).sent,0);assert.equal(x.map.size,before);
  x.env.mode=()=> 'on';followChoice(x.kv,SIG.sid,'close',NOW+21*60000);
  assert.equal(followTick(x.env).sent,0);
  assert.equal(x.calls.length,1);
});
