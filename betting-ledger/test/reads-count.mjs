// 서버 API 1회당 BET_LOG/WDL_LOG/SETTINGS 데이터 범위 읽기 횟수 측정 (최적화 전/후 비교용)
import { makeEnv } from './ui-harness.mjs';
const env = makeEnv(); env.setNow(new Date('2026-10-05T03:00:00Z'));
const cnt = { BET_LOG: 0, WDL_LOG: 0, SETTINGS: 0 };
for (const n of Object.keys(cnt)) { const sh = env.sheet(n); const g = sh.getRange; sh.getRange = (r, ...a) => { const rg = g(r, ...a); if (r < 2) return rg; return new Proxy(rg, { get: (t, k) => k === 'getValues' ? () => { cnt[n]++; return t.getValues(); } : t[k] }); }; }
const reset = () => { for (const k in cnt) cnt[k] = 0; };
const mk = id => env.get('apiSaveBet')({ date: '2026-10-05', sport: '축구', league: 'L', name: 'N' + id, pick: 'p', folders: 1, odds: 2, stake: 1000, grade: '메인', reqId: 'r' + id });
const a = mk(1), b = mk(2);
const run = (label, fn) => { reset(); fn(); console.log(label.padEnd(18), JSON.stringify(cnt)); };
run('apiBootstrap', () => env.get('apiBootstrap')());
run('apiGetUnconfirmed', () => env.get('apiGetUnconfirmed')());
run('apiPurchase', () => env.get('apiPurchase')({ kind: 'bet', id: a.id, buy: true, reqId: 'p1' }));
run('apiGetPending', () => env.get('apiGetPending')());
run('apiResolveBet', () => env.get('apiResolveBet')({ id: a.id, result: '적중', ret: 2000, reqId: 'x1' }));
run('apiGetMonthly', () => env.get('apiGetMonthly')('2026-10'));
