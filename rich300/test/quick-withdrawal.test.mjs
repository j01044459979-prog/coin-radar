import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dec, decToMicro, microFormat } from '../lib/decimal.mjs';
import { dayStartMs, kstDayOf, isDayString } from '../lib/time.mjs';
import { schemaDecString, StoreError, ENTITIES } from '../lib/schema.mjs';
import { ledgerBuildDaily } from '../lib/ledger.mjs';

const code=readFileSync(new URL('../gas/Quick.gs',import.meta.url),'utf8');
function fakeWorld(){
 const now=Date.parse('2026-11-11T11:00:00Z'),records=new Map(),writes=[];
 const se={};
 const rows=(kind)=>[...(records.get(kind)||new Map()).values()].filter(x=>!x.void);
 const insert=(kind,key,data)=>{if(!records.has(kind))records.set(kind,new Map());records.get(kind).set(key,{key,rev:1,void:false,data:kind==='cashflow'?ENTITIES.cashflow.normalize(data):data});};
 insert('challenge','challenge',{startDay:'2026-11-01',startEquity:'300'});
 insert('equity','2026-11-10',{day:'2026-11-10',equity:'350'});
 insert('equity','2026-11-11',{day:'2026-11-11',equity:'300'});
 insert('cashflow','cf-external',{cfId:'cf-external',at:dayStartMs('2026-11-11')+3600000,amount:'-20',note:'manual withdrawal'});
 insert('cashflow','cf-deposit',{cfId:'cf-deposit',at:dayStartMs('2026-11-11')+3600000,amount:'100',note:'deposit not withdrawal'});
 const engine={
  dec,decToMicro,microFormat,dayStartMs,kstDayOf,isDayString,schemaDecString,StoreError,
  storeReadAuditTail(){return []},
  storeList(se,kind){return rows(kind)},
  storeGet(se,kind,key){return (records.get(kind)||new Map()).get(key)||null},
  storeCreate(se,kind,data){
   const normalized=ENTITIES[kind].normalize(data),key=ENTITIES[kind].keyOf(normalized);
   const prev=(records.get(kind)||new Map()).get(key);
   if(prev&&!prev.void)return {status:JSON.stringify(prev.data)===JSON.stringify(normalized)?'duplicate':'conflict'};
   if(!records.has(kind))records.set(kind,new Map());
   records.get(kind).set(key,{key,rev:prev?prev.rev+1:1,void:false,data:normalized});
   writes.push({action:'create',kind,key});
   return {status:'added'};
  },
  storeRevise(se,kind,key,patch){
   const cur=records.get(kind)?.get(key);
   if(!cur||cur.void)throw Error('missing record');
   const next=ENTITIES[kind].normalize({...cur.data,...patch});
   if(JSON.stringify(next)===JSON.stringify(cur.data))return {status:'unchanged'};
   records.get(kind).set(key,{...cur,rev:cur.rev+1,data:next});
   writes.push({action:'revise',kind,key});
   return {status:'revised'};
  },
  storeVoid(se,kind,key){
   const cur=records.get(kind)?.get(key);
   if(!cur||cur.void)return {status:'unchanged'};
   records.get(kind).set(key,{...cur,void:true,rev:cur.rev+1});
   writes.push({action:'void',kind,key});
   return {status:'voided'};
  },
 };
 class DateForTest extends Date {static now(){return now;}}
 const context={
  Date:DateForTest,BigInt,String,Math,PropertiesService:{getScriptProperties(){return{getProperty(){return'fake-id'}}}},
  rich300GasEnv_(){return se},RICH300_ENGINE:engine,
  rich300Guarded_(fn){try{return fn({storeEnv(){return se}})}catch(e){return {ok:false,code:e.code||'error',message:String(e.message)}}},
  HtmlService:{createHtmlOutputFromFile(){return{setTitle(){return this},addMetaTag(){return this}}}}
 };
 vm.createContext(context);vm.runInContext(code,context);
 return {context,rows,records,writes};
}
test('existing negative Cashflows feed calendar and total, deposits never counted as withdrawals',()=>{
 const w=fakeWorld(),r=w.context.rich300QuickData_();
 assert.equal(r.configured,true);
 assert.deepEqual(JSON.parse(JSON.stringify(r.withdrawals)),[{day:'2026-11-11',micro:'20000000'}]);
 assert.deepEqual(JSON.parse(JSON.stringify(r.closes)).map(c=>c.equity),['350','300']);
});
test('Quick daily withdrawal is total per date, replay idempotent, edit replaces, never subtract from Equity',()=>{
 const w=fakeWorld(),save=x=>w.context.rich300QuickWithdrawSave({day:'2026-11-11',amount:x});
 assert.equal(save('50').status,'added'); // existing manual 20 + Quick 30 = requested total 50
 const item=w.rows('cashflow').find(x=>x.key==='quick-withdraw-2026-11-11');
 assert.equal(item.data.amount,'-30');
 assert.equal(item.data.note,'복리 캘린더 일별 출금 기록');
 assert.equal(w.context.rich300QuickData_().withdrawals[0].micro,'50000000');
 assert.equal(save('50').status,'unchanged');
 assert.equal(w.writes.length,1);
 assert.equal(save('60.123456').status,'revised');
 assert.equal(w.rows('cashflow').find(x=>x.key===item.key).data.amount,'-40.123456');
 assert.equal(w.context.rich300QuickData_().withdrawals[0].micro,'60123456');
 assert.equal(save('20').status,'voided'); // preserves unrelated manual 20
 assert.equal(w.context.rich300QuickData_().withdrawals[0].micro,'20000000');
 assert.equal(save('20').status,'unchanged');
 assert.equal(w.rows('equity').find(x=>x.key==='2026-11-11').data.equity,'300');
 assert.equal(w.writes.filter(x=>x.kind==='equity').length,0);
 assert.equal(w.writes.filter(x=>x.kind==='cashflow').length,3);
});
test('invalid/out-of-range/below existing withdrawn amount are rejected without writes',()=>{
 const w=fakeWorld(),save=(day,amount)=>w.context.rich300QuickWithdrawSave({day,amount});
 assert.equal(save('2026-10-30','50').ok,false);
 assert.equal(save('2026-11-12','50').ok,false);
 assert.equal(save('2026-11-11','19').ok,false);
 assert.equal(save('2026-11-11','-10').ok,false);
 assert.equal(save('2026-11-11','0.0000001').ok,false);
 assert.equal(w.writes.length,0);
});
test('withdrawals reduce financial ledger external cashflow, but not a second time from actual Equity',()=>{
 const w=fakeWorld();
 // Audit and P&L book are separate from Quick compound forecast. The same external -20
 // is a cashflow that makes the second-day reported wallet difference NOT a trading loss.
 const data={
   challenge:{startEquity:'300',startDay:'2026-11-10',rateSchedule:[{from:'2026-11-10',rate:'0.05'}]},
   throughDay:'2026-11-11',fills:[],
   cashflows:[{cfId:'withdraw-real',at:dayStartMs('2026-11-11')+3600000,amount:'-50'}],
   equityInputs:[{day:'2026-11-10',equity:'350'},{day:'2026-11-11',equity:'300'}]
 };
 const rows=ledgerBuildDaily(data).rows;
 assert.equal(rows.at(-1).closeMicro,300000000n);
 assert.equal(rows.at(-1).cashflowMicro,-50000000n);
 assert.equal(rows.at(-1).pnlMicro,0n);
});
