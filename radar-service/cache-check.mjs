// 복원된 상태 캐시가 최신인지 GitHub Actions 캐시 목록(GITHUB_TOKEN, actions: read)으로 확인한다. 수집·전송 없음.
// 출력: status(ok|cold|stale|cold-with-caches|unverified|skipped), newest(가장 최근 캐시 키)
import { appendFile } from 'node:fs/promises';
import { judgeCache } from './gate.mjs';

const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_REF, RESTORED_KEY, GITHUB_OUTPUT } = process.env;
let result;
if (GITHUB_REF !== 'refs/heads/main') result = { status: 'skipped', newest: null }; // 기능 브랜치 프리뷰는 비교하지 않음(네트워크 호출 없음)
else try {
  const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/caches?key=radar-state-&ref=${encodeURIComponent(GITHUB_REF)}&sort=created_at&direction=desc&per_page=10`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'coin-radar-cache-check' }, signal: AbortSignal.timeout(15000) });
  result = res.ok ? judgeCache({ restoredKey: RESTORED_KEY || '', caches: (await res.json()).actions_caches, ref: GITHUB_REF }) : { status: 'unverified', newest: null };
} catch { result = { status: 'unverified', newest: null }; }
console.log(`CACHE 복원 키=${RESTORED_KEY || '(없음)'} · 최신 키=${result.newest ?? '(없음)'} · 판정=${result.status}`);
if (result.status === 'stale' || result.status === 'cold-with-caches') console.log('::warning title=상태 캐시 최신성 의심::복원된 캐시보다 새 캐시가 있습니다. 최신 캐시로 재복원을 시도하고, 실패하면 이번 시간대 Telegram 전송을 억제합니다.');
if (GITHUB_OUTPUT) await appendFile(GITHUB_OUTPUT, `status=${result.status}\nnewest=${result.newest ?? ''}\n`);
