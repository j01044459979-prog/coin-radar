// Cloudflare 계정 ID 확인: CLOUDFLARE_ACCOUNT_ID Secret이 없으면 API 토큰이 접근할 수 있는 계정이 정확히 1개일 때 그 ID를 사용한다.
// 토큰은 환경변수로만 받고 출력하지 않는다. 계정 ID는 비밀값이 아니지만 로그에는 마스킹한다.
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function resolveAccount({ env = process.env, fetchImpl = fetch } = {}) {
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN 이 없습니다');
  const given = (env.CLOUDFLARE_ACCOUNT_ID_SECRET || '').trim();
  if (given) return { id: given, source: 'secret' };
  const res = await fetchImpl('https://api.cloudflare.com/client/v4/accounts?per_page=50', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  let body = null; try { body = await res.json(); } catch { /* 본문 없음 */ }
  if (!res.ok || body?.success === false) throw new Error(`계정 목록 조회 실패(HTTP ${res.status}) — 토큰에 계정 읽기 권한이 없을 수 있습니다. GitHub Secret CLOUDFLARE_ACCOUNT_ID 를 등록하세요`);
  const accounts = Array.isArray(body?.result) ? body.result : [];
  if (accounts.length !== 1) throw new Error(`토큰이 접근하는 계정이 ${accounts.length}개입니다 — 하나로 특정할 수 없으니 GitHub Secret CLOUDFLARE_ACCOUNT_ID 를 등록하세요`);
  return { id: accounts[0].id, source: 'api', name: accounts[0].name };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const r = await resolveAccount();
    console.log(`::add-mask::${r.id}`);
    console.log(`Cloudflare 계정 확인 완료 (출처: ${r.source === 'secret' ? 'GitHub Secret' : 'API 토큰이 접근하는 유일한 계정'})`);
    if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, `CLOUDFLARE_ACCOUNT_ID=${r.id}\n`);
  } catch (error) { console.log(`::error title=Cloudflare 계정 확인 실패::${String(error.message).replace(/[\r\n]+/g, ' ').slice(0, 220)}`); process.exit(1); }
}
