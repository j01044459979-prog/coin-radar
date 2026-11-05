import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTg, OWNER, STRANGER } from './helpers/faketg.mjs';
import { tgPairCreate, tgPoll, tgSendSignalPrompt, tgSendFollow } from '../lib/tg.mjs';
import { followRead } from '../lib/follow.mjs';
import { storeCreate, storeList } from '../lib/store.mjs';

const SID='SG-ONDO-S-ABC',T=1790000000000,signal={sid:SID,strategy:'S',symbolId:'ONDOUSDT',dir:'SHORT',signalAt:T-900000,entry:'1',stop:'1.1',tp1:'0.9'};
function setup(){
 const x=makeTg(),{code}=tgPairCreate(x.env);x.tele.say(OWNER,'/pair '+code);tgPoll(x.env);
 storeCreate(x.mem.env,'signal',signal,{actor:'test'});x.tele.sent.length=0;return x;
}
function press(x,msg,act,from=OWNER){const btn=msg.reply_markup.inline_keyboard[0].find(b=>b.text===act);
 if(!btn)throw new Error('버튼 없음 '+act);x.tele.click(from,msg,btn.callback_data,{text:msg.text});return tgPoll(x.env);}
test('진입했어 → 추적 상태 등록, 체결 0건, 보고서는 유지 중/정리했어 두 버튼',()=>{
 const x=setup();tgSendSignalPrompt(x.env,OWNER,SID);const prompt=x.tele.last();
 assert.deepEqual(prompt.reply_markup.inline_keyboard[0].map(b=>b.text),['진입했어','안 했어']);
 press(x,prompt,'진입했어');assert.equal(storeList(x.mem.env,'response')[0].data.choice,'entered');
 assert.equal(storeList(x.mem.env,'fill').length,0);
 assert.equal(followRead(x.kv,SID).status,'open');
 assert.equal(x.tele.sent.length,1); // no noisy /fill follow-up
 const report='1시간 ONDO 점검, 실제 체결 미확인';
 assert.equal(tgSendFollow(x.env,OWNER,report,SID).ok,true);
 const msg=x.tele.last();
 assert.deepEqual(msg.reply_markup.inline_keyboard[0].map(b=>b.text),['유지 중','정리했어']);
 press(x,msg,'유지 중');
 assert.equal(followRead(x.kv,SID).status,'open');
 assert.match(x.tele.answers.at(-1).text,/유지 중/);
 press(x,msg,'정리했어');
 assert.equal(followRead(x.kv,SID).status,'closed');
 assert.match(x.tele.answers.at(-1).text,/1시간 분석 중단/);
 press(x,msg,'유지 중');assert.equal(followRead(x.kv,SID).status,'closed');
 assert.equal(x.tele.sent.length,2);
});
test('안 했어는 일지/추적에서 제외되며 위조·타인 후속 버튼은 처리하지 않는다',()=>{
 const x=setup();tgSendSignalPrompt(x.env,OWNER,SID);const msg=x.tele.last();
 press(x,msg,'안 했어');assert.equal(storeList(x.mem.env,'response')[0].data.choice,'watched');
 assert.equal(followRead(x.kv,SID),null);
 x.tele.click(OWNER,msg,'h1:'+SID+':k',{text:msg.text});tgPoll(x.env);
 assert.equal(followRead(x.kv,SID),null);
 x.tele.click(STRANGER,msg,'h1:'+SID+':c',{text:msg.text});tgPoll(x.env);
 assert.equal(followRead(x.kv,SID),null);
});
