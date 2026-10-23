// R5 송신 클라이언트(Node, radar의 R9 연동에서 사용 예정 — 지금은 운영 코드에 연결하지 않음).
//  · 시도마다 *새 nonce·타임스탬프*로 다시 서명한다(같은 nonce 재전송은 서버가 재전송 공격으로 거부). 같은 신호(sid) 재전송은 서버가 duplicate로 처리하므로 안전하다.
//  · 절대 예외를 던지지 않고 결과 객체를 돌려준다(호출자인 radar 실행을 깨지 않음). 반환·오류에 URL·키·본문을 넣지 않는다(fetch 오류 메시지는 URL을 담을 수 있어 버린다).
//  · 로그를 출력하지 않는다(저장소가 공개라 Actions 로그가 공개).
import { createHmac, randomBytes } from 'node:crypto';
import { authBuildRequest } from '../lib/auth.mjs';

export const nodeAuthEnv = ({ now = Date.now } = {}) => ({
  now, hmacSha256: (key, msg) => createHmac('sha256', key).update(msg, 'utf8').digest('hex'), newNonce: () => randomBytes(18).toString('base64url'),
});
const sleepMs = ms => new Promise(r => setTimeout(r, ms));
export async function postSignal({ url, key, signal, fetcher = fetch, now = Date.now, attempts = 3, timeoutMs = 15000, backoffMs = 1000, sleep = sleepMs, type = 'signal' } = {}) {
  if (!url || !key || (type === 'signal' && !signal)) return { ok: false, error: 'not-configured', attempts: 0 };
  const env = nodeAuthEnv({ now });
  let last = 'unreachable';
  for (let i = 1; i <= attempts; i++) {
    let raw; try { raw = authBuildRequest(env, key, type === 'ping' ? { type: 'ping' } : { type: 'signal', signal }); } catch { return { ok: false, error: 'build-failed', attempts: i - 1 }; }
    try {
      const res = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      let json = null; try { json = await res.json(); } catch { json = null; }
      if (json && json.ok === true) return { ok: true, status: json.status ?? (json.pong ? 'pong' : 'ok'), duplicate: json.duplicate === true, attempts: i };
      if (json && typeof json.error === 'string') {
        if (json.error === 'busy' || json.error === 'server') last = json.error;          // 재시도 대상(새 nonce로)
        else return { ok: false, error: json.error, attempts: i };                       // unauthorized·invalid·conflict는 재시도해도 같은 결과
      } else last = 'bad-response';
    } catch (e) { last = e && e.name === 'TimeoutError' ? 'timeout' : 'network'; }
    if (i < attempts) await sleep(backoffMs * i);
  }
  return { ok: false, error: last, attempts };
}
