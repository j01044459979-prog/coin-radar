import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const api=readFileSync(new URL('../gas/Api.gs',import.meta.url),'utf8');
const quick=readFileSync(new URL('../gas/Quick.gs',import.meta.url),'utf8');
const html=readFileSync(new URL('../gas/Quick.html',import.meta.url),'utf8');
const packed=readFileSync(new URL('../apps-script/Quick.html',import.meta.url),'utf8');
const manifest=readFileSync(new URL('../apps-script/MANIFEST.txt',import.meta.url),'utf8');
const PW=process.env.RICH300_PLAYWRIGHT||'/opt/node-tools/node_modules/playwright';
const CH=process.env.RICH300_CHROMIUM||'/opt/pw-browsers/chromium';
const have=existsSync(PW);
test('기존 소유자 검사를 유지하고 첫 화면·일지를 간편 마감으로 라우팅한다',()=>{
 assert.match(api,/if \(rich300UiWho_\(\) !== 'owner'\)/);
 assert.match(api,/dash: 'rich300PageQuick_', journal: 'rich300PageQuick_'/);
 assert.match(api,/'classic-dash': 'rich300PageDash_'/);
 assert.match(api,/fill: 'rich300PageFill_'/);
});
test('첫 HTML 응답은 스프레드시트 읽기 없이 즉시 제공하고 조회는 Equity만 사용한다',()=>{
 const get=quick.slice(quick.indexOf('function rich300PageQuick_'),quick.indexOf('function rich300QuickData_'));
 assert.ok(get.includes("createHtmlOutputFromFile('Quick')"));
 assert.doesNotMatch(get,/SpreadsheetApp|storeLoadLedgerInputs|storeInit|UrlFetchApp/);
 const read=quick.slice(quick.indexOf('function rich300QuickData_'),quick.indexOf('function rich300QuickModel'));
 assert.match(read,/storeList\(se, 'equity'/);
 assert.doesNotMatch(read,/ledgerBuildDaily|storeLoadLedgerInputs|storeInit/);
 assert.match(quick,/rich300Guarded_/);
 assert.match(quick,/closeSubmitEquity/);
});
test('모바일 폼은 날짜·마감액만 요구하고 기존 자료와 빌드 무결성을 유지한다',()=>{
 assert.deepEqual([...html.matchAll(/<input\b[^>]*\bid="([^"]+)"/g)].map(m=>m[1]),['closeDay','closeAmount']);
 assert.match(html,/rich300QuickSave/);
 assert.match(html,/targetNext/);
 assert.equal(html,packed);
 assert.ok(manifest.includes(createHash('sha256').update(packed).digest('hex')+'  '));
});

test('320px 모바일: 실제 마감 입력 후 다음 날 복리와 잔여액 자동 재계산', {skip:!have&&'Playwright 없음'}, async()=>{
 const {chromium}=createRequire(PW)(PW),browser=await chromium.launch(existsSync(CH)?{executablePath:CH}:{});
 try{
  const page=await browser.newPage({viewport:{width:320,height:800}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('about:blank');
  await page.evaluate(()=>{
   window.__model={ok:true,configured:true,today:'2026-11-06',startDay:'2026-11-05',startMicro:'300000000',closes:[{day:'2026-11-05',micro:'280000000',equity:'280'}]};
   window.google={script:{run:{
     withSuccessHandler(cb){this.success=cb;return this;},withFailureHandler(cb){this.failure=cb;return this;},
     rich300QuickModel(){this.success(window.__model);},
     rich300QuickSave(p){window.__model.closes.push({day:p.day,micro:String(Math.round(Number(p.equity)*1e6)),equity:p.equity});this.success({ok:true,status:'added',message:'저장했어요.',model:window.__model});}
   }}};
  });
  await page.setContent(html);
  await page.waitForSelector('#content',{state:'visible'});
  assert.equal(await page.locator('#current').textContent(),'280.00');
  assert.equal(await page.locator('#target').textContent(),'294.00');
  assert.equal(await page.locator('#remaining').textContent(),'14.00');
  await page.locator('#closeAmount').fill('290');
  await page.locator('#save').click();
  assert.equal(await page.locator('#current').textContent(),'290.00');
  assert.equal(await page.locator('#target').textContent(),'294.00');
  assert.equal(await page.locator('#remaining').textContent(),'4.00');
  assert.ok((await page.locator('#days').textContent()).includes('304.50'));
  const size=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,inputs:document.querySelectorAll('input').length}));
  assert.ok(size.sw<=size.cw,'가로 스크롤 없이 표시');
  assert.equal(size.inputs,2);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
