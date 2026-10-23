// RICH 300 S0 실측 클라이언트(일회용). GitHub Actions에서 실행한다(이 개발 환경은 Google에 접근 불가).
// 배포 URL은 Secret `RICH300_S0_API_URL`로만 받고 출력하지 않는다. 본 프로브에는 비밀·Telegram·실제 데이터가 없다.
import { createHmac, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const TEST_KEY = 's0-throwaway-key-not-a-secret';
export const sign = (v, ts, nonce, body, key = TEST_KEY) => createHmac('sha256', key).update(`${v}.${ts}.${nonce}.${JSON.stringify(body)}`).digest('hex');
export const makeBody = (body = { hello: 'rich300' }, ts = Date.now(), nonce = randomUUID()) => JSON.stringify({ v: 1, ts, nonce, body, sig: sign(1, ts, nonce, body) });
const stats = a => { const s = [...a].sort((x, y) => x - y), q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, min: s[0], p50: q(0.5), p90: q(0.9), max: s.at(-1) }; };

// 한 번의 POST를 리다이렉트 수동 처리로 관찰: 1차 응답 상태·Location 유무, 최종 본문
export async function postOnce(url, { header = false, body = makeBody() } = {}, fetcher = fetch) {
  const t0 = Date.now(), headers = { 'content-type': 'application/json', ...(header ? { 'x-s0-probe': 'abc123', authorization: 'Bearer s0-test' } : {}) };
  const first = await fetcher(url, { method: 'POST', headers, body, redirect: 'manual' });
  const firstMs = Date.now() - t0, loc = first.headers.get('location');
  let finalJson = null, finalStatus = null;
  if (first.status >= 300 && first.status < 400 && loc) { const r = await fetcher(loc, { redirect: 'follow' }); finalStatus = r.status; try { finalJson = await r.json(); } catch { finalJson = null; } }
  else if (first.status === 200) { try { finalJson = await first.json(); } catch { finalJson = null; } finalStatus = 200; }
  return { firstStatus: first.status, hasLocation: Boolean(loc), locationHost: loc ? new URL(loc).hostname : null, firstMs, totalMs: Date.now() - t0, finalStatus, finalJson };
}

export async function run({ url, fetcher = fetch, log = console.log, n = 8 } = {}) {
  if (!url) { log('RICH300_S0_API_URL 없음 — 건너뜀(Secret 미등록)'); return { skipped: true }; }
  const res = { checks: {} }, c0 = await (await fetcher(`${url}${url.includes('?') ? '&' : '?'}action=counter`, { redirect: 'follow' })).json().catch(() => null);
  const before = c0?.counter ?? null;
  // ② POST 302 여부 + ① 헤더 노출 + 서명 검증
  const a = await postOnce(url, { header: true });
  res.checks.postRedirect = { firstStatus: a.firstStatus, redirected: a.firstStatus >= 300 && a.firstStatus < 400, locationHost: a.locationHost, finalStatus: a.finalStatus };
  res.checks.headersVisible = a.finalJson ? { headerLikeKeys: a.finalJson.headerLikeKeys, eventKeys: a.finalJson.eventKeys, customHeaderSeen: JSON.stringify(a.finalJson).includes('abc123') || JSON.stringify(a.finalJson).includes('s0-test') } : null;
  res.checks.signature = a.finalJson ? { sigOk: a.finalJson.sigOk, tsOk: a.finalJson.tsOk } : null;
  // 변조·재생 거부 확인(서명 불일치, 오래된 ts)
  const bad = JSON.parse(makeBody()); bad.body = { hello: 'tampered' };
  const t = await postOnce(url, { body: JSON.stringify(bad) }); res.checks.tamperRejected = t.finalJson ? t.finalJson.sigOk === false : null;
  const old = await postOnce(url, { body: makeBody({ hello: 'old' }, Date.now() - 3600000) }); res.checks.staleTsRejected = old.finalJson ? old.finalJson.tsOk === false : null;
  // 실행 횟수: 302를 따라가도 POST는 한 번만 실행되는가(같은 본문 재전송은 서버가 sid/nonce로 중복 처리해야 함)
  const afterOne = (await (await fetcher(`${url}${url.includes('?') ? '&' : '?'}action=counter`, { redirect: 'follow' })).json().catch(() => null))?.counter ?? null;
  res.checks.executionsForThreePosts = before !== null && afterOne !== null ? afterOne - before : null;   // 기대값 3(POST 3회 → 서버 실행 3회: 302를 따라가도 중복 실행 없음)
  // 지연 분포 + 동시성(락) : 순차 n회, 동시 n회
  const seq = []; for (let i = 0; i < n; i++) seq.push((await postOnce(url)).totalMs);
  const c1 = (await (await fetcher(`${url}${url.includes('?') ? '&' : '?'}action=counter`, { redirect: 'follow' })).json().catch(() => null))?.counter ?? null;
  const par = await Promise.all(Array.from({ length: n }, () => postOnce(url)));
  const c2 = (await (await fetcher(`${url}${url.includes('?') ? '&' : '?'}action=counter`, { redirect: 'follow' })).json().catch(() => null))?.counter ?? null;
  const counters = par.map(p => p.finalJson?.counter).filter(Number.isFinite), unique = new Set(counters).size;
  res.checks.latencyMsSequential = stats(seq);
  res.checks.latencyMsParallel = stats(par.map(p => p.totalMs));
  res.checks.lockAndCounter = { sentParallel: n, counterDelta: c1 !== null && c2 !== null ? c2 - c1 : null, uniqueCounters: unique, lockedCorrectly: unique === n && c2 - c1 === n };
  res.checks.appendMsSample = stats(par.map(p => p.finalJson?.appendMs).filter(Number.isFinite));
  // GET(UI 배포가 아니라 API 배포의 doGet): 익명 접근 가능 여부
  const g = await fetcher(url, { redirect: 'manual' }); res.checks.anonymousGetStatus = g.status;
  log('S0_RESULT ' + JSON.stringify(res));
  return res;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await run({ url: process.env.RICH300_S0_API_URL });
