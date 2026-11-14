import test from 'node:test';
import assert from 'node:assert/strict';
import { watchSid, watchKeyboard, watchDecorate } from '../watch-button.mjs';
import { alertReport } from '../compact.mjs';
import { cycle } from '../service.mjs';

const AT = 1790000000000;
const row = { symbol: 'ALLOUSDT', direction: 'LONG', price: 0.1536,
  strong: true, volume: 120000, candidate: { dir: 'LONG', score: 93, plan: {
    entry: 0.1536, stop: 0.1519, tp1: 0.1552, tp2: 0.1569 } } };

test('only opt-in watch alerts have separate W1 callback ids, never R9 trade ids', () => {
  const part = { ...alertReport(row, AT), html: true };
  assert.equal(watchDecorate(part, { symbol: row.symbol, source:'B', dir:'LONG', at:AT }, {}), part);
  const a = watchDecorate(part, { symbol: row.symbol, source:'B', dir:'LONG', at:AT }, { RADAR_WATCH_BUTTONS:'on' });
  assert.match(a.text, /W1 v1 WK-ALLO-B-/);
  assert.match(a.text, /관심 관찰 전용 · 진입 기록 아님/);
  assert.doesNotMatch(a.text, /R9 v1|체결 등록|진입했어/);
  assert.deepEqual(a.markup.inline_keyboard[0].map(x=>x.text), ['👀 관심 등록','패스']);
  a.markup.inline_keyboard[0].forEach(x=>assert.ok(Buffer.byteLength(x.callback_data)<64));
  const b = watchDecorate(part, {symbol:row.symbol,source:'C',dir:'WATCH',at:AT}, {RADAR_WATCH_BUTTONS:'on'});
  assert.notEqual(b.watchId,a.watchId);
  assert.ok(b.text.includes(' W1 v1') === false);
  assert.equal(watchSid('xxx', 'B', AT), null);
});
test('core 5-minute urgent alert only: watch markup opt-in, report pipeline untouched', async () => {
  const raw = { rows:[row], failures:[], chartData:null };
  const collect = async () => raw;
  for (const val of ['off','on']) {
    const sent = [], state = { reportHour: Math.floor(AT/3600000), sent:{} };
    const result = await cycle({now:AT, state, collect,
      env:{RADAR_WATCH_BUTTONS:val},
      save:async()=>{}, send:async(text,extra)=>{sent.push({text,extra})},
      render:null,sendPhoto:null});
    assert.equal(result.ok,true);
    assert.equal(sent.length,1);
    if(val==='on'){
      assert.match(sent[0].text,/W1 v1 WK-ALLO-B-/);
      assert.equal(sent[0].extra.markup.inline_keyboard[0].length,2);
    }else{
      assert.doesNotMatch(sent[0].text,/W1 v1/);
      assert.equal(sent[0].extra.markup,undefined);
    }
  }
});
