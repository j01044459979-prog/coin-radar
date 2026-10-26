// R5 수신 처리(Actions → Apps Script): 인증 → 형식 → 저장. 반환은 항상 { ok, ... } JSON(Apps Script는 HTTP 상태를 정할 수 없음).
//  · 인증 실패는 사유와 무관하게 동일한 외부 응답 {ok:false,error:'unauthorized'}(어떤 검사에서 막혔는지 알려 주지 않는다). 사유는 카운터로만 남긴다.
//  · 시트는 인증이 통과한 뒤에만 연다(env.storeEnv()): 위조 요청이 시트 접근·락을 소모하지 못하게 한다.
//  · 같은 신호(sid)의 재전송은 duplicate(새 nonce로 다시 보내도 안전). 다른 내용은 conflict. 로그에는 아무것도 출력하지 않는다.
import { authVerify } from './auth.mjs';
import { storeCreate } from './store.mjs';
import { StoreError } from './schema.mjs';

export const INGEST_UNAUTHORIZED = Object.freeze({ ok: false, error: 'unauthorized' });
export function ingestHandle(env, raw) {
  let auth;
  try { auth = authVerify(env, raw); } catch (e_) { return { ...INGEST_UNAUTHORIZED }; }
  if (!auth.ok) return { ...INGEST_UNAUTHORIZED };
  const body = auth.body;
  try {
    if (body.type === 'ping') return { ok: true, pong: true };
    if (body.type !== 'signal' || body.signal === null || typeof body.signal !== 'object' || Array.isArray(body.signal)) return { ok: false, error: 'invalid' };
    const r = storeCreate(env.storeEnv(), 'signal', body.signal, { actor: 'api:ingest' });
    if (r.status === 'added') return { ok: true, status: 'added', rev: r.rev };
    if (r.status === 'duplicate') return { ok: true, status: 'duplicate', duplicate: true };
    return { ok: false, error: 'conflict' };
  } catch (e) {
    if (e instanceof StoreError) {
      if (e.code === 'LOCK') return { ok: false, error: 'busy', retry: true };
      if (e.code === 'VALIDATION') return { ok: false, error: 'invalid', message: String(e.message).slice(0, 120) };
    }
    return { ok: false, error: 'server' };                                  // 스택·내부 정보 비노출
  }
}
