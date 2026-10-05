// 390px Chromium UI 동작 테스트 (확인창 2단계, 연타 방어, 탭 유지, 호출 수). 실행: node betting-ledger/test/ui-behavior.test.mjs
import assert from 'assert';
import { openApp, makeEnv } from './ui-harness.mjs';

const results = []; let pass = 0;
async function test(name, fn) {
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('테스트 시간 초과(20s)')), 20000))]);
    pass++; results.push('PASS  ' + name);
  }
  catch (e) { results.push('FAIL  ' + name + '\n      ' + String(e.message).split('\n').slice(0, 4).join('\n      ')); }
}
let SEQ = 0;
const NOW = new Date('2026-10-05T03:00:00Z');
const seed = (env) => {
  env.setNow(NOW);
  const bet = (name, stake) => env.get('apiSaveRichPick')({ requestId: 'ui-seed-' + (++SEQ) + '-' + Math.random().toString(36).slice(2, 8), type: 'BET', date: '2026-10-05', sport: '기타', league: 'L', name, pick: name + ' 픽', folders: 1, odds: 2, stake, grade: '메인' });
  return { bet };
};
const rowOf = (env, id) => env.sheet('BET_LOG').grid.slice(1).find(r => r[0] === id);
const card = (page, text) => page.locator('#tab-buy .pend', { hasText: text });
const modalVisible = page => page.evaluate(() => !document.getElementById('cfm').classList.contains('hidden'));
const flush = page => page.waitForTimeout(250);

await test('69. 구매확인 "샀다" 첫 클릭: 서버 호출 없이 확인창만 열림', async () => {
  const env = makeEnv(); const s = seed(env); s.bet('카드A', 3000);
  const app = await openApp({ env }); try {
    const before = app.calls.length;
    await card(app.page, '카드A').locator('.yes').click(); await flush(app.page);
    assert.strictEqual(app.calls.length, before);                                           // 서버 호출 0
    assert.ok(await modalVisible(app.page));
    const txt = await app.page.textContent('#cfm');
    assert.ok(txt.includes('카드A') && txt.includes('3,000원') && txt.includes('샀다 확정') && txt.includes('돌아가기'), txt);
    assert.strictEqual(app.errs.length, 0);
  } finally { await app.close(); }
});
await test('70. 확인창 돌아가기/바깥 터치/Esc → 아무 변경 없음', async () => {
  const env = makeEnv(); const s = seed(env); const r = s.bet('카드B', 2000);
  const app = await openApp({ env }); try {
    const n = app.calls.length;
    for (const how of ['back', 'outside', 'esc']) {
      await card(app.page, '카드B').locator('.no').click(); assert.ok(await modalVisible(app.page));
      if (how === 'back') await app.page.click('#cfmBack');
      else if (how === 'outside') await app.page.mouse.click(190, 20);
      else await app.page.keyboard.press('Escape');
      assert.ok(!(await modalVisible(app.page)), how);
    }
    assert.strictEqual(app.calls.length, n);
    assert.strictEqual(await card(app.page, '카드B').count(), 1);
    assert.strictEqual(rowOf(env, r.id)[16], '미확인');
  } finally { await app.close(); }
});
await test('71. 확인창 확정 → 서버 호출 정확히 1회 (샀다 / 안 샀다 문구)', async () => {
  const env = makeEnv(); const s = seed(env); const a = s.bet('카드C', 2000), b = s.bet('카드D', 1000);
  const app = await openApp({ env }); try {
    const n = app.calls.length;
    await card(app.page, '카드C').locator('.yes').click();
    assert.strictEqual(await app.page.textContent('#cfmTitle'), '구매 처리 확인');
    await app.page.click('#cfmOk'); await app.page.waitForFunction(() => !document.getElementById('cfm') || document.getElementById('cfm').classList.contains('hidden'));
    assert.deepStrictEqual(app.calls.slice(n), ['apiPurchase']);
    assert.deepStrictEqual([rowOf(env, a.id)[16], rowOf(env, a.id)[17]], ['구매', 2000]);
    await card(app.page, '카드D').locator('.no').click();
    assert.deepStrictEqual([await app.page.textContent('#cfmTitle'), await app.page.textContent('#cfmOk')], ['미구매 처리 확인', '안 샀다 확정']);
    await app.page.click('#cfmOk'); await flush(app.page);
    assert.deepStrictEqual(app.calls.slice(n), ['apiPurchase', 'apiPurchase']);
    assert.deepStrictEqual([rowOf(env, b.id)[16], rowOf(env, b.id)[17]], ['미구매', '']);
  } finally { await app.close(); }
});
await test('72. 처리 중 연타: 확정 버튼을 여러 번 눌러도 서버 호출 1회', async () => {
  const env = makeEnv(); const s = seed(env); const a = s.bet('카드E', 2000);
  const app = await openApp({ env, delay: { apiPurchase: 500 } }); try {
    await card(app.page, '카드E').locator('.yes').click();
    await app.page.evaluate(() => { for (let i = 0; i < 6; i++) document.getElementById('cfmOk').click(); });   // 동기 연타
    await app.page.click('#cfmOk', { force: true, timeout: 500 }).catch(() => {});
    await app.page.keyboard.press('Escape');                                                                   // 처리 중 닫기도 불가
    assert.ok(await modalVisible(app.page));
    await app.page.waitForFunction(() => document.getElementById('cfm').classList.contains('hidden'));
    assert.strictEqual(app.calls.filter(c => c === 'apiPurchase').length, 1);
    assert.strictEqual(env.sheet('BET_LOG').getLastRow(), 2); assert.strictEqual(rowOf(env, a.id)[16], '구매');
  } finally { await app.close(); }
});
await test('73. 구매 처리 성공 후: 현재 탭 유지, 페이지 reload 없음, 해당 카드만 갱신(재호출 없음)', async () => {
  const env = makeEnv(); const s = seed(env); s.bet('카드F', 2000); s.bet('카드G', 1000);
  const app = await openApp({ env }); try {
    await app.page.evaluate(() => { window.__noReload = 1; window.__other = [...document.querySelectorAll('#tab-buy .pend')].find(e => e.textContent.includes('카드G')); });
    const n = app.calls.length;
    await card(app.page, '카드F').locator('.yes').click(); await app.page.click('#cfmOk'); await flush(app.page);
    assert.deepStrictEqual(app.calls.slice(n), ['apiPurchase']);                              // 목록 재조회 없음
    const st = await app.page.evaluate(() => ({ keep: window.__noReload, tab: S.tab, on: document.querySelector('.nav button.on').dataset.tab,
      otherSame: document.body.contains(window.__other), cards: document.querySelectorAll('#tab-buy .pend').length,
      toast: document.getElementById('toast').textContent, used: document.getElementById('hUsed').textContent, badge: document.getElementById('navBuy').textContent }));
    assert.deepStrictEqual([st.keep, st.tab, st.on, st.otherSame, st.cards], [1, 'buy', 'buy', true, 1]);
    assert.ok(st.toast.includes('구매 처리 완료') && st.used === '2,000원' && st.badge === '구매 확인 (1)', JSON.stringify(st));
    assert.strictEqual(await card(app.page, '카드F').count(), 0);
  } finally { await app.close(); }
});
await test('74. 최초 진입: 활성 탭(구매 확인) API 1회만 호출, 비활성 탭 API/폴링 없음', async () => {
  const env = makeEnv(); seed(env).bet('카드H', 1000);
  const app = await openApp({ env }); try {
    await app.page.waitForTimeout(1500);
    assert.deepStrictEqual(app.calls, ['apiGetUnconfirmed']);
  } finally { await app.close(); }
});
await test('75. 동일 탭 중복 요청 coalesce + TTL 내 재방문은 서버 호출 없음 + 새로고침은 강제 재조회', async () => {
  const env = makeEnv(); seed(env).bet('카드I', 1000);
  const app = await openApp({ env, delay: { apiGetUnconfirmed: 300 } }); try {
    let n = app.calls.length;
    await app.page.evaluate(() => Promise.all([loadUnconfirmed(), loadUnconfirmed(), loadTab('buy', true)]));   // 동시 3요청
    assert.strictEqual(app.calls.length - n, 1);
    n = app.calls.length;
    await app.page.click('[data-tab=res]'); await app.page.waitForFunction(() => document.querySelector('#pBets').textContent.length > 0);
    await app.page.click('[data-tab=buy]'); await app.page.click('[data-tab=res]'); await app.page.click('[data-tab=buy]'); await flush(app.page);
    assert.deepStrictEqual(app.calls.slice(n), ['apiGetPending']);                           // 재방문 0회 (결과 처리 첫 로드만)
    n = app.calls.length;
    await app.page.click('#btnRefresh'); await app.page.click('#btnRefresh', { force: true }).catch(() => {});
    await app.page.waitForTimeout(700);
    assert.strictEqual(app.calls.length - n, 1);                                            // 새로고침 연타도 1회
    // 캐시 만료(60초 경과) 시 다시 조회
    await app.page.evaluate(() => { S.cache.buy.at = Date.now() - 61000; });
    n = app.calls.length; await app.page.click('[data-tab=res]'); await app.page.click('[data-tab=buy]'); await app.page.waitForTimeout(700);
    assert.ok(app.calls.slice(n).includes('apiGetUnconfirmed'));
  } finally { await app.close(); }
});
await test('87. 결과 처리 확인창: 첫 클릭은 서버 호출 없음 → 확정 시 1회, 카드만 제거/탭 유지', async () => {
  const env = makeEnv(); const s = seed(env); const r = s.bet('결과카드', 1000); env.get('apiPurchase')({ kind: 'bet', id: r.id, buy: true, reqId: 'ui-seed-buy' });
  const app = await openApp({ env }); try {
    await app.page.click('[data-tab=res]'); await app.page.waitForSelector('#pBets .pend');
    const c = app.page.locator('#pBets .pend', { hasText: '결과카드' });
    await c.locator('.rRet').fill('2000'); const n = app.calls.length;
    await c.locator('.rBetSave').click(); await flush(app.page);
    assert.strictEqual(app.calls.length, n); assert.ok(await modalVisible(app.page));
    const txt = await app.page.textContent('#cfm'); assert.ok(txt.includes('결과 처리 확인') && txt.includes('처리 결과: 적중') && txt.includes('2,000원') && txt.includes('적중 확정'), txt);
    await app.page.click('#cfmBack'); await flush(app.page); assert.strictEqual(app.calls.length, n); assert.strictEqual(rowOf(env, r.id)[9], '대기');
    await c.locator('.rBetSave').click(); await app.page.click('#cfmOk'); await flush(app.page);
    assert.deepStrictEqual(app.calls.slice(n), ['apiResolveBet']);
    assert.deepStrictEqual([rowOf(env, r.id)[9], rowOf(env, r.id)[11]], ['적중', 1000]);
    assert.strictEqual(await app.page.evaluate(() => S.tab), 'res'); assert.strictEqual(await app.page.locator('#pBets .pend').count(), 0);
    assert.ok((await app.page.textContent('#hProfit')).includes('+1,000원'));
    assert.strictEqual(app.errs.length, 0);
  } finally { await app.close(); }
});
await test('88. 서버 거절(일 한도)은 확인창 안에 표시되고 상태 변경/카드 제거 없음', async () => {
  const env = makeEnv(); const s = seed(env); const a = s.bet('큰카드', 5000), b = s.bet('작은카드', 1000);
  env.get('apiPurchase')({ kind: 'bet', id: a.id, buy: true, reqId: 'ui-seed-big' });
  const app = await openApp({ env }); try {
    await card(app.page, '작은카드').locator('.yes').click(); await app.page.click('#cfmOk'); await flush(app.page);
    assert.ok(await modalVisible(app.page));
    assert.ok((await app.page.textContent('#cfmErr')).includes('일 최대 5,000원 초과'));
    assert.ok(!(await app.page.isDisabled('#cfmOk')) && !(await app.page.isDisabled('#cfmBack')));
    assert.strictEqual(rowOf(env, b.id)[16], '미확인'); assert.strictEqual(await card(app.page, '작은카드').count(), 1);
    await app.page.click('#cfmBack'); assert.ok(!(await modalVisible(app.page)));
  } finally { await app.close(); }
});
await test('89. 390px: 가로 overflow 없음, 콘솔 에러 없음 (긴 이름/픽 포함)', async () => {
  const env = makeEnv(); const s = seed(env);
  s.bet('아주아주아주긴경기명'.repeat(6), 1000);
  const app = await openApp({ env }); try {
    for (const t of ['buy', 'res', 'mon']) { await app.page.click(`[data-tab=${t}]`); await flush(app.page); assert.ok(!(await app.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), t); }
    await app.page.click('[data-tab=buy]'); await card(app.page, '아주아주').locator('.yes').click();
    assert.ok(!(await app.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    assert.strictEqual(app.errs.length, 0, app.errs.join('|'));
  } finally { await app.close(); }
});

console.log(results.join('\n'));
console.log(`\n${pass}/${results.length} UI tests passed`);
process.exit(pass === results.length ? 0 : 1);
