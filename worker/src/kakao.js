// 카카오톡 "나에게 보내기" (Kakao Developers 공식 REST API)
//
//  - 인가 코드 받기:   GET  https://kauth.kakao.com/oauth/authorize (scope=talk_message)
//  - 토큰 받기/갱신:   POST https://kauth.kakao.com/oauth/token
//  - 나에게 보내기:    POST https://kapi.kakao.com/v2/api/talk/memo/default/send
//
// 토큰 관리
//  - Access Token(약 6시간)은 만료 10분 전에 Refresh Token 으로 자동 갱신합니다 (Cron 이 1분마다 확인).
//  - Refresh Token 은 남은 기간이 1개월 미만일 때 카카오가 새 값을 주며, 받은 즉시 D1 에 저장합니다.
//    → 한 번 연결하면 사람이 토큰을 다시 넣지 않아도 계속 동작합니다.
//  - 토큰은 D1 에 AES-GCM 으로 암호화해 저장합니다. 키는 Cloudflare Secret(KAKAO_CLIENT_SECRET, KAKAO_REST_API_KEY)에서 만듭니다.
//  - 토큰 값은 절대 로그/응답/오류 메시지에 넣지 않습니다.

export const KAUTH = 'https://kauth.kakao.com';
export const KAPI = 'https://kapi.kakao.com';
export const SITE_URL = 'https://j01044459979-prog.github.io/coin-radar/';
const MIN = 60 * 1000;
const REFRESH_MARGIN_MS = 10 * MIN; // 만료 10분 전에 미리 갱신

export const KAKAO_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS kakao_auth (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    access_enc TEXT,
    access_expires_at INTEGER,
    refresh_enc TEXT,
    refresh_expires_at INTEGER,
    updated_at INTEGER NOT NULL,
    last_error TEXT
  )`,
];

export function kakaoConfigured(env) {
  return Boolean(env && env.KAKAO_REST_API_KEY);
}

// ── 암호화 (AES-GCM 256) ──────────────────────────
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function tokenKey(env) {
  const material = `coin-radar/kakao-token/v1|${env.KAKAO_REST_API_KEY || ''}|${env.KAKAO_CLIENT_SECRET || ''}`;
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(material));
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptToken(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(env), enc.encode(plain));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function decryptToken(env, stored) {
  if (!stored || typeof stored !== 'string' || !stored.startsWith('v1.')) return null;
  try {
    const [, iv, ct] = stored.split('.');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await tokenKey(env), unb64(ct));
    return new TextDecoder().decode(pt);
  } catch {
    return null; // 키가 바뀌었거나 손상됨 → 다시 연결 필요
  }
}

// ── D1 토큰 저장소 ────────────────────────────────
let schemaReady = false;
export async function ensureKakaoSchema(db) {
  if (schemaReady) return;
  await db.batch(KAKAO_SCHEMA.map((s) => db.prepare(s)));
  schemaReady = true;
}
export function resetKakaoSchemaFlagForTests() {
  schemaReady = false;
}

async function loadRow(db) {
  await ensureKakaoSchema(db);
  return db.prepare('SELECT * FROM kakao_auth WHERE id = 1').first();
}

// 카카오 토큰 응답을 저장. refresh_token 이 응답에 없으면 기존 값을 유지합니다.
export async function saveTokens(env, db, tok, now) {
  const row = await loadRow(db);
  const accessEnc = tok.access_token ? await encryptToken(env, tok.access_token) : row && row.access_enc;
  const accessExp = tok.access_token ? now + Number(tok.expires_in || 0) * 1000 : row && row.access_expires_at;
  const refreshEnc = tok.refresh_token ? await encryptToken(env, tok.refresh_token) : row && row.refresh_enc;
  // 만료 정보가 없으면(Secret 으로 넣은 토큰) 모름(null)으로 저장
  const refreshExp = tok.refresh_token ? (Number(tok.refresh_token_expires_in) > 0 ? now + Number(tok.refresh_token_expires_in) * 1000 : null) : row && row.refresh_expires_at;
  await db
    .prepare(
      `INSERT INTO kakao_auth (id, access_enc, access_expires_at, refresh_enc, refresh_expires_at, updated_at, last_error)
       VALUES (1, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET access_enc = excluded.access_enc, access_expires_at = excluded.access_expires_at,
         refresh_enc = excluded.refresh_enc, refresh_expires_at = excluded.refresh_expires_at, updated_at = excluded.updated_at, last_error = NULL`,
    )
    .bind(accessEnc || null, accessExp || null, refreshEnc || null, refreshExp || null, now)
    .run();
}

async function setError(db, code, now) {
  await ensureKakaoSchema(db);
  await db
    .prepare(`INSERT INTO kakao_auth (id, updated_at, last_error) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET last_error = excluded.last_error, updated_at = excluded.updated_at`)
    .bind(now, code)
    .run();
}

// 상태 조회 (토큰 값은 절대 포함하지 않음)
export async function kakaoStatus(env, db, now) {
  const configured = kakaoConfigured(env);
  const out = {
    configured,
    client_secret_set: Boolean(env.KAKAO_CLIENT_SECRET),
    admin_token_set: Boolean(env.ADMIN_TOKEN),
    linked: false,
    ready: false,
    access_token_expires_at: null,
    refresh_token_expires_at: null,
    last_error: null,
    setup_page: '/kakao/setup',
  };
  if (!db) return out;
  const row = await loadRow(db);
  if (row) {
    const refresh = await decryptToken(env, row.refresh_enc);
    out.linked = Boolean(refresh);
    out.access_token_expires_at = row.access_expires_at || null;
    out.refresh_token_expires_at = row.refresh_expires_at || null;
    out.last_error = row.last_error || (row.refresh_enc && !refresh ? 'token_undecryptable' : null);
  } else if (env.KAKAO_REFRESH_TOKEN) {
    out.linked = true; // Secret 으로 넣은 Refresh Token 으로 시작 가능
  }
  const expired = out.refresh_token_expires_at !== null && out.refresh_token_expires_at <= now;
  out.ready = configured && out.linked && !expired && out.last_error !== 'reauth_required';
  return out;
}

// ── OAuth ───────────────────────────────────────
export function authorizeUrl(env, redirectUri, state) {
  const q = new URLSearchParams({ client_id: env.KAKAO_REST_API_KEY, redirect_uri: redirectUri, response_type: 'code', scope: 'talk_message', state });
  return `${KAUTH}/oauth/authorize?${q}`;
}

async function tokenRequest(env, params, fetchImpl) {
  const body = new URLSearchParams({ ...params, client_id: env.KAKAO_REST_API_KEY });
  if (env.KAKAO_CLIENT_SECRET) body.set('client_secret', env.KAKAO_CLIENT_SECRET);
  let res;
  try {
    res = await fetchImpl(`${KAUTH}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: body.toString() });
  } catch {
    return { ok: false, error: 'network_error' };
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* 본문 없음 */
  }
  if (!res.ok || !data.access_token) {
    // 오류 코드만 남기고 응답 본문(토큰 포함 가능)은 버림
    return { ok: false, status: res.status, error: typeof data.error === 'string' ? data.error : `http_${res.status}`, code: typeof data.error_code === 'string' ? data.error_code : null };
  }
  return { ok: true, token: data };
}

// 인가 코드 → 토큰 (최초 1회 연결)
export async function exchangeCode(env, db, code, redirectUri, now, fetchImpl = fetch) {
  const r = await tokenRequest(env, { grant_type: 'authorization_code', redirect_uri: redirectUri, code }, fetchImpl);
  if (!r.ok) return r;
  if (!r.token.refresh_token) return { ok: false, error: 'no_refresh_token' };
  const scopes = String(r.token.scope || '');
  await saveTokens(env, db, r.token, now);
  return { ok: true, scopeOk: !scopes || scopes.split(/[ ,]+/).includes('talk_message') };
}

// Refresh Token 으로 Access Token 갱신
export async function refreshTokens(env, db, now, fetchImpl = fetch) {
  const row = await loadRow(db);
  const refresh = (row && (await decryptToken(env, row.refresh_enc))) || env.KAKAO_REFRESH_TOKEN || null;
  if (!refresh) return { ok: false, error: 'not_linked' };
  const r = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: refresh }, fetchImpl);
  if (!r.ok) {
    // invalid_grant = Refresh Token 만료/폐기 → 사용자가 다시 연결해야 함
    await setError(db, r.error === 'invalid_grant' ? 'reauth_required' : `refresh_failed:${r.error}`, now);
    return r;
  }
  if (!r.token.refresh_token && !(row && row.refresh_enc)) {
    // Secret 으로 시작한 경우: 응답에 새 refresh_token 이 없으면 Secret 값을 D1 에 옮겨 저장
    r.token.refresh_token = refresh;
  }
  await saveTokens(env, db, r.token, now);
  return { ok: true, rotated: Boolean(r.token.refresh_token) };
}

// 사용할 수 있는 Access Token (필요하면 갱신)
export async function getAccessToken(env, db, now, fetchImpl = fetch, { force = false } = {}) {
  const row = await loadRow(db);
  if (!force && row && row.access_enc && row.access_expires_at && row.access_expires_at - now > REFRESH_MARGIN_MS) {
    const t = await decryptToken(env, row.access_enc);
    if (t) return { ok: true, token: t };
  }
  const r = await refreshTokens(env, db, now, fetchImpl);
  if (!r.ok) return r;
  const again = await loadRow(db);
  const t = await decryptToken(env, again && again.access_enc);
  return t ? { ok: true, token: t, refreshed: true } : { ok: false, error: 'token_undecryptable' };
}

// Cron 에서 호출: Access Token 이 곧 만료되면 미리 갱신 (Refresh Token 도 자동 연장됨)
export async function maintainTokens(env, db, now, fetchImpl = fetch) {
  if (!kakaoConfigured(env) || !db) return { skipped: true };
  const row = await loadRow(db);
  if (!row && !env.KAKAO_REFRESH_TOKEN) return { skipped: true };
  if (row && row.last_error === 'reauth_required') return { skipped: true, reason: 'reauth_required' };
  if (row && row.access_enc && row.access_expires_at && row.access_expires_at - now > REFRESH_MARGIN_MS) return { skipped: true };
  return refreshTokens(env, db, now, fetchImpl);
}

// ── 나에게 보내기 ────────────────────────────────
export function buildTemplate(text, url = SITE_URL, buttonTitle = 'COIN RADAR 보기') {
  return { object_type: 'text', text: text.length > 200 ? text.slice(0, 199) + '…' : text, link: { web_url: url, mobile_web_url: url }, button_title: buttonTitle };
}

async function postMemo(token, template, fetchImpl) {
  try {
    const res = await fetchImpl(`${KAPI}/v2/api/talk/memo/default/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({ template_object: JSON.stringify(template) }).toString(),
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* 본문 없음 */
    }
    if (res.ok && data.result_code === 0) return { ok: true };
    return { ok: false, status: res.status, code: typeof data.code === 'number' ? data.code : null };
  } catch {
    return { ok: false, status: 0, code: null };
  }
}

// 반환 { ok, skipped?, reason }
export async function sendKakaoMemo(env, db, text, now, fetchImpl = fetch) {
  if (!kakaoConfigured(env)) return { ok: false, skipped: true, reason: 'Kakao Secret 미설정' };
  if (!db) return { ok: false, skipped: true, reason: 'D1 미설정' };
  const template = buildTemplate(text);
  let tok = await getAccessToken(env, db, now, fetchImpl);
  if (!tok.ok) return { ok: false, skipped: tok.error === 'not_linked', reason: tok.error === 'not_linked' ? 'Kakao 미연결' : `Kakao 토큰 오류 (${tok.error})` };
  let r = await postMemo(tok.token, template, fetchImpl);
  if (!r.ok && r.status === 401) {
    // 토큰이 만료/무효 → 한 번 갱신 후 재시도
    tok = await getAccessToken(env, db, now, fetchImpl, { force: true });
    if (!tok.ok) return { ok: false, reason: `Kakao 토큰 오류 (${tok.error})` };
    r = await postMemo(tok.token, template, fetchImpl);
  }
  if (r.ok) return { ok: true };
  if (r.code === -402) return { ok: false, reason: 'Kakao 메시지 동의(talk_message) 없음 - 다시 연결 필요' };
  return { ok: false, reason: `Kakao HTTP ${r.status}${r.code !== null ? ` (code ${r.code})` : ''}` };
}

// ── 연결 페이지용 state (ADMIN_TOKEN 으로 서명, 10분 유효) ──
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64(sig).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function makeState(env, now) {
  const nonce = b64(crypto.getRandomValues(new Uint8Array(12))).replace(/[+/=]/g, '');
  const body = `${now + 10 * MIN}.${nonce}`;
  return `${body}.${await hmac(env.ADMIN_TOKEN, body)}`;
}

export async function verifyState(env, state, now) {
  if (!env.ADMIN_TOKEN || typeof state !== 'string') return false;
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [exp, nonce, sig] = parts;
  if (!(Number(exp) > now)) return false;
  const expect = await hmac(env.ADMIN_TOKEN, `${exp}.${nonce}`);
  return safeEqual(sig, expect);
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
