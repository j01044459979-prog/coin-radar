// COIN RADAR 5분 디스패처 (Cloudflare Workers 무료 플랜 Cron Trigger)
// 5분마다 GitHub REST API(workflow_dispatch)로 radar 워크플로를 시작한다. 분석·Telegram 전송은 하지 않는다.
// 비밀값(GITHUB_DISPATCH_TOKEN)은 Cloudflare Secret으로만 저장한다. 이 파일·로그에는 토큰을 쓰지 않는다.
export const SLOT_MS = 300000;
const API = 'https://api.github.com';
const PENDING = new Set(['queued', 'waiting', 'pending', 'requested']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const slotOf = scheduledTime => Math.floor(scheduledTime / SLOT_MS);

function config(env) {
  return { repo: env.GITHUB_REPO || 'j01044459979-prog/coin-radar', workflow: env.GITHUB_WORKFLOW || 'radar.yml', ref: env.GITHUB_REF_NAME || 'main', enabled: String(env.DISPATCH_ENABLED) === 'true', token: env.GITHUB_DISPATCH_TOKEN };
}

async function gh(fetchImpl, token, method, path, body) {
  const res = await fetchImpl(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'coin-radar-dispatcher', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

// 최근 실행 중 이 슬롯 것이 있는지 / 대기 중인 실행이 있는지 확인한다.
async function inspect(fetchImpl, c, slot, now) {
  // 최근 30분 이내 실행만 최대 50개 조회(반영 지연·목록 길이 제한이 있을 수 있으므로 이 확인은 '최선의 중복 방지'이고, 최종 멱등성은 워크플로 Gate(state.lastSlot)가 보장한다)
  const since = new Date(now - 1800000).toISOString().replace(/\.\d+Z$/, 'Z');
  const res = await gh(fetchImpl, c.token, 'GET', `/repos/${c.repo}/actions/workflows/${c.workflow}/runs?branch=${encodeURIComponent(c.ref)}&per_page=50&created=${encodeURIComponent('>=' + since)}`);
  if (!res.ok) return { error: res.status };
  const runs = (await res.json()).workflow_runs ?? [];
  const sameSlot = runs.some(r => String(r.display_title || '').includes(`slot ${slot} `) || String(r.display_title || '').endsWith(`slot ${slot}`));
  // 15분보다 오래 대기 중인 실행은 멈춘 것으로 보고 무시한다(영구 차단 방지)
  const pending = runs.some(r => PENDING.has(r.status) && now - Date.parse(r.created_at) < 900000);
  return { sameSlot, pending };
}

// 한 번의 cron 발화를 처리한다. 결과 객체를 반환하며(로그용) 예외를 던지지 않는다.
export async function tick(env, scheduledTime, { fetchImpl = fetch, wait = sleep, now = Date.now } = {}) {
  const c = config(env), slot = slotOf(scheduledTime);
  const out = (decision, extra = {}) => ({ slot, decision, ...extra });
  if (!c.enabled) return out('disabled'); // 킬 스위치: DISPATCH_ENABLED != "true"
  if (!c.token) return out('no-token');
  try {
    const seen = await inspect(fetchImpl, c, slot, now());
    if (seen.error) return out('inspect-failed', { status: seen.error });
    if (seen.sameSlot) return out('skip-duplicate-slot');   // cron 이중 발화·재시도 중복 방지
    if (seen.pending) return out('skip-pending-exists');    // 이미 대기 중인 실행이 곧 처리함
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try { res = await gh(fetchImpl, c.token, 'POST', `/repos/${c.repo}/actions/workflows/${c.workflow}/dispatches`, { ref: c.ref, inputs: { source: 'cloudflare', slot: String(slot) } }); }
      catch { res = null; } // 네트워크 오류: 요청이 도착했는지 알 수 없다 → 아래에서 재조회 후 판단
      if (res && res.status === 204) return out('dispatched', { attempt: attempt + 1 });
      if (res && [401, 403, 404, 422].includes(res.status) && !(res.status === 403 && res.headers.get('retry-after'))) return out('rejected', { status: res.status, hint: { 401: '토큰 만료/오류', 403: '토큰 권한 부족', 404: '저장소·워크플로 이름 확인', 422: '워크플로(main)에 slot/source 입력이 아직 없음' }[res.status] });
      const retryAfter = Number(res?.headers.get('retry-after')) || 0;
      if (retryAfter > 10 || attempt === 2) return out('failed', { status: res?.status ?? 'network', retryAfter });
      await wait(Math.max(retryAfter * 1000, 1000 * (attempt + 1) * 2));
      // 응답을 못 받았거나 일시 오류였더라도 GitHub가 이미 접수했을 수 있으므로 재시도 전에 이 슬롯의 실행이 생겼는지 먼저 확인한다.
      const again = await inspect(fetchImpl, c, slot, now());
      if (again.sameSlot) return out('dispatched-confirmed', { attempt: attempt + 1 });
    }
    return out('failed');
  } catch (error) { return out('error', { message: String(error.message).slice(0, 80) }); }
}

export default {
  async scheduled(event, env, ctx) {
    const result = await tick(env, event.scheduledTime);
    console.log(JSON.stringify({ t: new Date(event.scheduledTime).toISOString(), ...result }));
  },
  fetch() { return new Response('not found', { status: 404 }); }, // 공개 URL이 있어도 정보를 노출하지 않는다
};
