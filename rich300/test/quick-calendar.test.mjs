import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const api=readFileSync(new URL('../gas/Api.gs',import.meta.url),'utf8');
const quick=readFileSync(new URL('../gas/Quick.gs',import.meta.url),'utf8');
const html=readFileSync(new URL('../gas/Quick.html',import.meta.url),'utf8');
const packed=readFileSync(new URL('../apps-script/Quick.html',import.meta.url),'utf8');
const bundledCode=readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8');
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
 assert.match(quick,/f\.quickDelta === true/);
 assert.match(quick,/answer\.savedClose/);
 assert.match(quick,/answer\.model = rich300QuickData_\(\)/);
});
test('모바일 폼은 날짜·마감액만 요구하고 기존 자료와 빌드 무결성을 유지한다',()=>{
 assert.deepEqual([...html.matchAll(/<input\b[^>]*\bid="([^"]+)"/g)].map(m=>m[1]),['closeDay','closeAmount']);
 assert.match(html,/rich300QuickSave/);
 assert.match(html,/targetNext/);
 assert.equal(html,packed);
 assert.ok(bundledCode.endsWith('\n}\n'),'배포용 Code.gs 마지막 줄 완결');
 assert.match(bundledCode,/f\.quickDelta === true/);
 assert.ok(manifest.includes(createHash('sha256').update(packed).digest('hex')+'  '));
});

function forecastLabel(equity,days){
 let micro=BigInt(equity)*1000000n;
 for(let i=0;i<days;i++)micro=(micro*105n+50n)/100n;
 const cents=(micro+5000n)/10000n;
 return (cents/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+(cents%100n).toString().padStart(2,'0');
}
test('7일·30일·365일 예상 자산은 실제 마감 금액 기준으로 별도 표시',()=>{
 for(const d of [7,30,365])assert.match(html,new RegExp('id="forecast'+d+'"'));
 assert.match(html,/renderForecast\(current\)/);
 assert.match(html,/비현실적인 가정/);
 assert.match(html,/projectMemo/);
 assert.match(html,/resetRenderCache/);
 assert.match(html,/quickDelta:true/);
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
     rich300QuickSave(p){
       if(!p.quickDelta)throw Error('delta mode not requested');
       this.success({ok:true,status:'added',message:'저장했어요.',today:window.__model.today,
         savedClose:{day:p.day,micro:String(Math.round(Number(p.equity)*1e6)),equity:p.equity}});
     }
   }}};
  });
  await page.setContent(html);
  await page.waitForSelector('#content',{state:'visible'});
  assert.equal(await page.locator('#current').textContent(),'280.00');
  assert.equal(await page.locator('#target').textContent(),'294.00');
  assert.equal(await page.locator('#remaining').textContent(),'14.00');
  for(const d of [7,30,365])assert.equal(await page.locator('#forecast'+d).textContent(),forecastLabel('280',d));
  await page.locator('#closeAmount').fill('290');
  await page.locator('#save').click();
  assert.equal(await page.locator('#current').textContent(),'290.00');
  assert.equal(await page.locator('#target').textContent(),'294.00');
  assert.equal(await page.locator('#remaining').textContent(),'4.00');
  for(const d of [7,30,365])assert.equal(await page.locator('#forecast'+d).textContent(),forecastLabel('290',d));
  assert.ok((await page.locator('#days').textContent()).includes('304.50'));
  // 과거 마감액을 수정해도 최신 날짜 마감(290)이 예상 자산 기준이어야 한다.
  await page.locator('#closeDay').fill('2026-11-05');
  await page.locator('#closeDay').dispatchEvent('change');
  await page.locator('#closeAmount').fill('350');
  await page.locator('#save').click();
  assert.equal(await page.locator('#current').textContent(),'290.00');
  assert.equal(await page.locator('#target').textContent(),'367.50');
  for(const d of [7,30,365])assert.equal(await page.locator('#forecast'+d).textContent(),forecastLabel('290',d));
  await page.locator('#nextMonth').click();
  await page.locator('#prevMonth').click();
  assert.equal(await page.locator('#target').textContent(),'367.50');
  const size=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,inputs:document.querySelectorAll('input').length}));
  assert.ok(size.sw<=size.cw,'가로 스크롤 없이 표시');
  assert.equal(size.inputs,2);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});


test('마감이 없어도 7·30·365일 미래 금액을 임시 시작금으로 표시하고 실제 잔고와 구분한다', {skip:!have&&'Playwright 없음'}, async()=>{
 const {chromium}=createRequire(PW)(PW),browser=await chromium.launch(existsSync(CH)?{executablePath:CH}:{});
 try {
  const page=await browser.newPage({viewport:{width:320,height:780}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('about:blank');
  await page.evaluate(()=>{
   window.google={script:{run:{
    withSuccessHandler(cb){this.success=cb;return this;},
    withFailureHandler(cb){this.failure=cb;return this;},
    rich300QuickModel(){this.success({ok:true,configured:true,today:'2026-11-11',startDay:'2026-11-01',startMicro:'300000000',closes:[]});},
    rich300QuickSave(p){this.success({ok:true,status:'added',message:'저장했어요.',today:'2026-11-11',
      savedClose:{day:p.day,equity:p.equity,micro:String(Math.round(Number(p.equity)*1e6))}});}
   }}};
  });
  await page.setContent(html);await page.waitForSelector('#content',{state:'visible'});
  assert.match(await page.locator('#currentSub').textContent(),/실제 현재 잔고 미입력/);
  assert.match(await page.locator('#forecastBaseLabel').textContent(),/초기 설정금액 기준/);
  assert.equal(await page.locator('#current').textContent(),'300.00');
  assert.equal(await page.locator('#remaining').textContent(),'—');
  for(const d of [7,30,365])assert.equal(await page.locator('#forecast'+d).textContent(),forecastLabel('300',d));
  await page.locator('#closeAmount').fill('425');
  await page.locator('#save').click();
  assert.equal(await page.locator('#current').textContent(),'425.00');
  assert.match(await page.locator('#forecastBaseLabel').textContent(),/최신 마감 2026-11-11 기준/);
  for(const d of [7,30,365])assert.equal(await page.locator('#forecast'+d).textContent(),forecastLabel('425',d));
  const m=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}));
  assert.ok(m.sw<=m.cw);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
