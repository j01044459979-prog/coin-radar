// 복원된 상태 캐시가 최신인지 GitHub Actions 캐시 목록(GITHUB_TOKEN, actions: read)으로 확인한다. 수집·전송 없음.
// 출력: status(ok|cold|stale|cold-with-caches|unverified|skipped), newest(가장 최근 캐시 키)
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { judgeCache } from './gate.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// API 일시 오류(5xx·네트워크·429/403+Retry-After)는 최대 3회까지 짧게 재시도한다. 끝내 실패하면 unverified.
export async function checkCaches({ env, fetchImpl = fetch, wait = sleep }) {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_REF, RESTORED_KEY } = env;
  if (GITHUB_REF !== 'refs/heads/main') return { status: 'skipped', newest: null, attempts: 0 }; // 기능 브랜치 프리뷰는 비교하지 않음(호출 없음)
  const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/caches?key=radar-state-&ref=${encodeURIComponent(GITHUB_REF)}&sort=created_at&direction=desc&per_page=10`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res = null;
    try { res = await fetchImpl(url, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'coin-radar-cache-check' }, signal: AbortSignal.timeout(15000) }); } catch { res = null; }
    if (res?.ok) {
      try { return { ...judgeCache({ restoredKey: RESTORED_KEY || '', caches: (await res.json()).actions_caches, ref: GITHUB_REF }), attempts: attempt }; } catch { /* 본문 오류도 재시도 */ }
    } else if (res && [400, 401, 404, 422].includes(res.status)) break; // 재시도해도 소용없는 오류(권한·요청 오류)
    const retryAfter = Number(res?.headers?.get?.('retry-after')) || 0;
    if (attempt < 3) await wait(Math.min(Math.max(retryAfter, attempt * 2), 10) * 1000);
  }
  return { status: 'unverified', newest: null, attempts: 3 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkCaches({ env: process.env });
  console.log(`CACHE 복원 키=${process.env.RESTORED_KEY || '(없음)'} · 최신 키=${result.newest ?? '(없음)'} · 판정=${result.status} · API 시도 ${result.attempts}회`);
  if (result.status === 'stale' || result.status === 'cold-with-caches') console.log('::warning title=상태 캐시 최신성 의심::복원된 캐시보다 새 캐시가 있습니다. 최신 캐시로 재복원을 시도하고, 실패하면 이번 시간대 Telegram 전송을 억제합니다.');
  if (result.status === 'unverified') console.log('::warning title=상태 캐시 최신성 확인 불가::GitHub 캐시 목록을 읽지 못했습니다. 상태가 직전 슬롯과 이어지지 않으면 이번 시간대 Telegram 전송을 억제합니다.');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `status=${result.status}\nnewest=${result.newest ?? ''}\n`);
}
