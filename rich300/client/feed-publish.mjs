// RICH300 추천 피드 서명(Node, rich300-feed.yml 에서만): radar 실행이 만든 산출물(feed-raw.json)을 *그 실행이 맞는지 확인한 뒤* 서명해 feed.json 으로 쓴다.
//  · 확인: 실행 결론 success · main 브랜치 · 정기/수동 실행 · 산출물 meta.runId 가 이 워크플로가 받은 실행 id 와 같음 · 산출물이 오래되지 않음. 하나라도 틀리면 쓰지 않는다(게시 없음).
//  · 서명 = 요청 인증(auth.mjs)과 같은 봉투·정규화·HMAC-SHA256, 키는 환경 변수 RICH300_FEED_KEY(GitHub Secret)에서만 읽고 어디에도 출력하지 않는다. meta 는 서명 범위 안이다.
//  · 사용: RICH300_FEED_KEY=… RUN_ID=… RUN_CONCLUSION=… RUN_HEAD_BRANCH=… RUN_EVENT=… node rich300/client/feed-publish.mjs <feed-raw.json> <out/feed.json>
//  · 로그에는 개수·사유 코드만 출력한다(저장소가 공개라 Actions 로그가 공개).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { authBuildRequest, AUTH_MIN_KEY_LEN } from '../lib/auth.mjs';

export const PUBLISH_MAX_AGE_MS = 20 * 60000;
export function buildFeedFile(rawArtifact, { key, run, now = Date.now() } = {}) {
  if (typeof key !== 'string' || key.length < AUTH_MIN_KEY_LEN) return { ok: false, reason: 'no-key' };
  const r = run || {};
  if (r.conclusion !== 'success') return { ok: false, reason: 'run-not-success' };
  if (r.headBranch !== 'main') return { ok: false, reason: 'not-main' };
  if (!['schedule', 'workflow_dispatch'].includes(r.event)) return { ok: false, reason: 'bad-event' };
  let a = rawArtifact; if (typeof a === 'string') { try { a = JSON.parse(a); } catch { return { ok: false, reason: 'bad-artifact' }; } }
  if (!a || a.v !== 1 || !a.meta || !Array.isArray(a.entries)) return { ok: false, reason: 'bad-artifact' };
  const m = a.meta;
  if (String(m.runId) !== String(r.id) || !/^\d{1,20}$/.test(String(r.id))) return { ok: false, reason: 'run-mismatch' };                         // 다른 실행·오래된 산출물 차단
  if (m.ref !== 'refs/heads/main' || m.mode !== 'once' || m.event !== r.event) return { ok: false, reason: 'meta-mismatch' };
  if (!/^\d{10,14}$/.test(String(m.at)) || now - Number(m.at) > PUBLISH_MAX_AGE_MS || Number(m.at) - now > 5 * 60000) return { ok: false, reason: 'stale-artifact' };
  const env = { now: () => now, hmacSha256: (k, msg) => createHmac('sha256', k).update(msg, 'utf8').digest('hex'), newNonce: () => randomBytes(18).toString('base64url') };
  const entries = a.entries.filter(x => x && typeof x === 'object' && !Array.isArray(x)).slice(-30);
  try { return { ok: true, raw: authBuildRequest(env, key, { entries, meta: { runId: String(m.runId), attempt: String(m.attempt || '1'), ref: m.ref, sha: String(m.sha || '').slice(0, 40), event: m.event, mode: 'once', at: String(m.at) } }), count: entries.length }; }
  catch { return { ok: false, reason: 'build-failed' }; }
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [inFile, outFile] = process.argv.slice(2); let raw = null;
  try { raw = readFileSync(inFile, 'utf8'); } catch { console.log('feed-publish: no artifact'); process.exit(0); }
  const e = process.env, r = buildFeedFile(raw, { key: e.RICH300_FEED_KEY, run: { id: e.RUN_ID, conclusion: e.RUN_CONCLUSION, headBranch: e.RUN_HEAD_BRANCH, event: e.RUN_EVENT } });
  if (!r.ok) { console.log(`feed-publish: skipped (${r.reason})`); process.exit(0); }
  mkdirSync(dirname(outFile), { recursive: true }); writeFileSync(outFile, r.raw); console.log(`feed-publish: ${r.count} entries`);
}
