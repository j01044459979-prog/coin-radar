// 사용자 동작별 google.script.run 호출 수 측정:  node perf-calls.mjs [Index.html 경로]
import path from 'path';
import { openApp, makeEnv, here } from './ui-harness.mjs';
const html = process.argv[2] ? path.resolve(process.argv[2]) : path.join(here, '..', 'Index.html');
const env = makeEnv(); env.setNow(new Date('2026-10-05T03:00:00Z'));
const save = (o) => env.get('apiSaveBet')(Object.assign({ date: '2026-10-05', sport: '축구', league: 'K리그1', name: 'N', pick: '홈승', folders: 1, odds: 2, stake: 1000, grade: '메인', reqId: 'seed' + Math.random() }, o));
const a = save({ name: '구매대상A', stake: 2000 }), b = save({ name: '구매대상B', stake: 1000 });
const c = save({ name: '결과대상C', stake: 1000 });
env.get('apiPurchase')({ kind: 'bet', id: c.id, buy: true, reqId: 'seedbuy' });          // 구매 완료 + 결과 대기 1건
const app = await openApp({ html, env, autoOpen: false });
const { page, calls } = app;
const mark = () => calls.length;
const out = {};
let m = mark();
await app.open(); await page.waitForSelector('#tab-buy .pend');
out['최초 진입'] = calls.length - m; out['  (호출 목록)'] = calls.join(',');
m = mark(); await page.click('[data-tab=res]'); await page.waitForSelector('#pBets .pend'); out['결과 처리 탭 첫 로드'] = calls.length - m;
m = mark(); await page.click('[data-tab=buy]'); await page.waitForTimeout(400); out['같은 탭(구매 확인) 재방문'] = calls.length - m;
const confirmIfModal = async () => { const ok = await page.$('#cfmOk'); if (ok && await ok.isVisible()) await ok.click(); };
m = mark(); await page.locator('#tab-buy .pend', { hasText: '구매대상A' }).locator('.yes').click(); await confirmIfModal(); await page.waitForTimeout(600);
out['구매 액션 1회(샀다)'] = calls.length - m;
await page.click('[data-tab=res]'); await page.waitForSelector('#pBets .pend'); await page.waitForTimeout(300);
m = mark(); const card = page.locator('#pBets .pend', { hasText: '결과대상C' });
await card.locator('.rRet').fill('2000'); await card.locator('.rBetSave').click(); await confirmIfModal(); await page.waitForTimeout(600);
out['결과 액션 1회(적중)'] = calls.length - m;
out['콘솔/페이지 에러'] = app.errs.length;
out['가로 overflow'] = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) ? 1 : 0;
console.log(JSON.stringify(out, null, 1));
await app.close();
