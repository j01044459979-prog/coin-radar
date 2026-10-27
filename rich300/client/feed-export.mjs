// RICH300 추천 피드 내보내기(Node, GitHub Actions 에서 radar 실행 직후): state.signal.feed 를 서명해 feed.json 으로 쓴다. 저장소 브랜치에 올리는 일은 별도 job 이 한다.
//  · 서명 = 요청 인증(auth.mjs)과 같은 봉투·정규화·HMAC-SHA256. 키는 환경 변수 RICH300_FEED_KEY(GitHub Secret)에서만 읽고 어디에도 출력하지 않는다.
//  · 사용: RICH300_FEED_KEY=… node rich300/client/feed-export.mjs <state.json> <out/feed.json>   (키가 없거나 피드가 꺼져 있으면 아무것도 쓰지 않고 정상 종료)
//  · 로그에는 개수만 출력한다(저장소가 공개라 Actions 로그가 공개).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { authBuildRequest } from '../lib/auth.mjs';

export function buildFeedFile(state, { key, now = Date.now(), maxAgeMs = 24 * 3600000 } = {}) {
  if (typeof key !== 'string' || key.length < 32) return { ok: false, reason: 'no-key' };
  const list = Array.isArray(state?.signal?.feed) ? state.signal.feed : [];
  const entries = list.filter(x => x && typeof x === 'object' && now - Number(x.createdAt ?? x.at ?? now) <= maxAgeMs).slice(-30);
  const env = { now: () => now, hmacSha256: (k, m) => createHmac('sha256', k).update(m, 'utf8').digest('hex'), newNonce: () => randomBytes(18).toString('base64url') };
  try { return { ok: true, raw: authBuildRequest(env, key, { entries }), count: entries.length }; } catch { return { ok: false, reason: 'build-failed' }; }
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [stateFile, outFile] = process.argv.slice(2); let state = null;
  try { state = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { console.log('feed: no state'); process.exit(0); }
  const r = buildFeedFile(state, { key: process.env.RICH300_FEED_KEY });
  if (!r.ok) { console.log(`feed: skipped (${r.reason})`); process.exit(0); }
  mkdirSync(dirname(outFile), { recursive: true }); writeFileSync(outFile, r.raw); console.log(`feed: ${r.count} entries`);
}
