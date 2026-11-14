import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTg, OWNER, STRANGER } from './helpers/faketg.mjs';
import { tgPairCreate, tgPoll, tgSendMessage, tgWatchChoices } from '../lib/tg.mjs';
import { w1ParseWatch, w1StripLine, r9ParseSignal } from '../lib/r9.mjs';
import { storeList } from '../lib/store.mjs';
import { watchDecorate } from '../../radar-service/watch-button.mjs';

const AT = 1790000000000;
const flags = { RADAR_WATCH_BUTTONS:'on' };
const part = (symbol, source='B') => watchDecorate({
  text: '🚨 신규 조건 포착\n' + symbol + ' · 롱 관찰 (93점)',
  plain: '🚨 신규 조건 포착\n' + symbol + ' · 롱 관찰 (93점)', html:true
}, { symbol, source, dir:source==='B'?'LONG':'WATCH', at:AT }, flags);
const pair = x => {const code=tgPairCreate(x.env).code;x.tele.say(OWNER,'/pair '+code);tgPoll(x.env);};

test('W1 parses exact message and cannot masquerade as R9 trade signal',()=>{
  const p=part('ALLOUSDT'),data=w1ParseWatch(p.plain);
  assert.equal(data.symbol,'ALLOUSDT');assert.equal(data.source,'B');
  assert.equal(r9ParseSignal(p.plain),null);
  assert.doesNotMatch(w1StripLine(p.plain), /W1 v1/);
  assert.equal(w1ParseWatch(p.plain.replace(' ' + p.watchId + ' ALLOUSDT ', ' ' + p.watchId + ' BTCUSDT ')),null);
  assert.equal(w1ParseWatch(p.plain.replace('W1 v1', 'W1 v2')),null);
});
test('paired owner can interest-register or pass separately; watchlist query works; no RICH300 trade rows',()=>{
  const x=makeTg();pair(x);
  const a=part('ALLOUSDT','B'), b=part('DOGEUSDT','C');
  const send=p=>{assert.equal(tgSendMessage(x.env,OWNER,p.plain,p.markup).ok,true);return x.tele.last()};
  const first=send(a);
  x.tele.click(OWNER,first,a.markup.inline_keyboard[0][0].callback_data,{text:first.text});
  const one=tgPoll(x.env);
  assert.equal(one.actions['watch-added'],1);
  assert.equal(tgWatchChoices(x.env)[0].symbol,'ALLOUSDT');
  assert.equal(tgWatchChoices(x.env)[0].choice,'interest');
  const saved=x.kv.map.get('wc:'+a.watchId);
  assert.ok(saved);
  // Redispatched callback with a new update id is idempotent; conflicting button does not mutate.
  x.tele.click(OWNER,first,a.markup.inline_keyboard[0][1].callback_data,{text:first.text});
  const clash=tgPoll(x.env);
  assert.equal(clash.actions['watch-duplicate'],1);
  assert.equal(x.kv.map.get('wc:'+a.watchId),saved);
  const second=send(b);
  x.tele.click(OWNER,second,b.markup.inline_keyboard[0][1].callback_data,{text:second.text});
  const passed=tgPoll(x.env);
  assert.equal(passed.actions['watch-passed'],1);
  assert.equal(tgWatchChoices(x.env).filter(z=>z.choice==='interest').length,1);
  x.tele.say(OWNER,'/watchlist'); const listed=tgPoll(x.env);
  assert.equal(listed.actions.watchlist,1);
  assert.match(x.tele.last().text,/ALLOUSDT/);
  assert.doesNotMatch(x.tele.last().text,/DOGEUSDT/);
  for (const type of ['signal','response','fill']) assert.equal(storeList(x.mem.env,type).length,0, type);
});
test('watch callbacks require a paired owner and verifiable original W1 line; no data on spoofed buttons',()=>{
  const x=makeTg();pair(x);
  const p=part('ETHUSDT'); const m={message_id:888, chat_id:OWNER};
  x.tele.click(STRANGER,m,p.markup.inline_keyboard[0][0].callback_data,{text:p.plain});
  const foreign=tgPoll(x.env);assert.equal(foreign.actions.unpaired,1);
  x.tele.click(OWNER,m,p.markup.inline_keyboard[0][0].callback_data,{text:'fake watch'});
  const forged=tgPoll(x.env);assert.equal(forged.actions['watch-invalid'],1);
  assert.equal(tgWatchChoices(x.env).length,0);
});
