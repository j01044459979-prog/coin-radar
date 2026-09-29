// 카카오 연결 / 테스트 페이지 (브라우저에서 버튼으로 사용)
//  GET  /kakao/setup     연결 상태, 등록할 리다이렉트 URI, 연결·테스트 버튼 (ADMIN_TOKEN 입력)
//  POST /kakao/connect   ADMIN_TOKEN 확인 → 카카오 로그인·동의 화면으로 이동
//  GET  /kakao/callback  카카오가 돌려준 인가 코드로 토큰 발급 → D1 에 암호화 저장 → 확인 메시지 발송
//  POST /kakao/test      ADMIN_TOKEN 확인 → 테스트 메시지 1건 발송
//  POST /api/admin/kakao-test  (Authorization: Bearer <ADMIN_TOKEN>) JSON 응답 버전
import { kakaoConfigured, kakaoStatus, authorizeUrl, exchangeCode, sendKakaoMemo, makeState, verifyState, safeEqual } from './kakao.js';
import { kst } from './alerts.js';
import { json } from './response.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const TEST_MESSAGE = '✅ COIN RADAR 테스트 메시지\n\n카카오톡 알림 연결이 정상입니다.\n중요한 시장 이상 신호가 생기면 이 채팅으로 알려드립니다.\n\n※ 데이터 상태 알림이며 투자 권유가 아닙니다.';
const LINKED_MESSAGE = '🔗 COIN RADAR 카카오톡 알림이 연결되었습니다.\n\n이제 중요한 시장 이상 신호가 생기면 이 채팅으로 알려드립니다.\n\n※ 데이터 상태 알림이며 투자 권유가 아닙니다.';

function page(title, body, status = 200) {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;background:#061019;color:#edf6ff;font-family:system-ui,-apple-system,'Noto Sans KR',sans-serif}.w{max-width:560px;margin:auto;padding:18px}h1{font-size:21px}h2{font-size:15px;margin:0 0 10px}.box{background:#0d1a25;border:1px solid #203344;border-radius:14px;padding:14px;margin:12px 0}.ok{color:#42d486}.bad{color:#ff6576}.warn{color:#ffc857}.m{color:#8ea7ba;font-size:13px;line-height:1.55}code{display:block;background:#09151f;border:1px solid #203344;border-radius:8px;padding:9px;word-break:break-all;font-size:13px;margin:6px 0;user-select:all}input{width:100%;box-sizing:border-box;padding:11px;border-radius:9px;border:1px solid #203344;background:#09151f;color:#edf6ff;font-size:15px;margin:6px 0 10px}button{width:100%;padding:12px;border:0;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer}.y{background:#fee500;color:#191600}.b{background:#12304a;color:#fff;border:1px solid #66aaff}a{color:#66aaff}</style></head><body><div class="w">${body}</div></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

export const redirectUriFor = (request) => `${new URL(request.url).origin}/kakao/callback`;

function adminOk(env, token) {
  return Boolean(env.ADMIN_TOKEN) && safeEqual(String(token || ''), env.ADMIN_TOKEN);
}

async function formToken(request) {
  try {
    const f = await request.formData();
    return f.get('admin_token');
  } catch {
    return null;
  }
}

const mark = (v) => (v ? '<span class="ok">✅ 완료</span>' : '<span class="bad">❌ 필요</span>');
const when = (t) => (t ? `${kst(t, false)} KST` : '-');

export async function handleSetupPage(request, env) {
  const db = env.DB || null;
  const s = await kakaoStatus(env, db, Date.now());
  const redirectUri = redirectUriFor(request);
  const errText = s.last_error === 'reauth_required' ? '<p class="bad">카카오 연결이 만료되었습니다. 아래 "카카오 연결하기"를 다시 눌러 주세요.</p>' : s.last_error ? `<p class="warn">최근 오류: ${esc(s.last_error)}</p>` : '';
  return page(
    'COIN RADAR 카카오 알림 설정',
    `<h1>🚨 COIN RADAR 카카오톡 알림</h1>
<div class="box"><h2>현재 상태</h2><div class="m">
Cloudflare Secret KAKAO_REST_API_KEY: ${mark(s.configured)}<br>
Cloudflare Secret KAKAO_CLIENT_SECRET: ${s.client_secret_set ? '<span class="ok">✅ 완료</span>' : '<span class="warn">⚠️ 없음 (카카오 앱에서 클라이언트 시크릿을 켰다면 필요)</span>'}<br>
Cloudflare Secret ADMIN_TOKEN: ${mark(s.admin_token_set)}<br>
D1 데이터베이스: ${mark(Boolean(db))}<br>
카카오 계정 연결: ${mark(s.linked)}<br>
알림 준비: ${s.ready ? '<span class="ok">✅ 준비 완료</span>' : '<span class="bad">❌ 아직 아님</span>'}<br>
Access Token 만료: ${when(s.access_token_expires_at)} (자동 갱신)<br>
Refresh Token 만료: ${when(s.refresh_token_expires_at)} (자동 연장)</div>${errText}</div>
<div class="box"><h2>① 카카오 앱에 등록할 리다이렉트 URI</h2><div class="m">카카오디벨로퍼스 → 내 앱 → [앱] → [플랫폼 키] → [REST API 키] → [리다이렉트 URI]에 아래 주소를 그대로 등록하세요.</div><code>${esc(redirectUri)}</code></div>
<div class="box"><h2>② 카카오 연결하기 (처음 한 번)</h2><div class="m">ADMIN_TOKEN 을 입력하고 버튼을 누르면 카카오 로그인·동의 화면으로 이동합니다. "카카오톡 메시지 전송"에 동의해 주세요.</div>
<form method="post" action="/kakao/connect"><input type="password" name="admin_token" placeholder="ADMIN_TOKEN" autocomplete="current-password" required><button class="y" type="submit">카카오 연결하기</button></form></div>
<div class="box"><h2>③ 테스트 메시지 보내기</h2><form method="post" action="/kakao/test"><input type="password" name="admin_token" placeholder="ADMIN_TOKEN" autocomplete="current-password" required><button class="b" type="submit">카카오톡으로 테스트 메시지 1건 보내기</button></form></div>
<p class="m">이 페이지에는 토큰 값이 표시되지 않습니다. 상태 확인: <a href="/api/monitor/status">/api/monitor/status</a></p>`,
  );
}

export async function handleConnect(request, env) {
  const token = await formToken(request);
  if (!env.ADMIN_TOKEN) return page('설정 필요', '<h1 class="bad">ADMIN_TOKEN Secret 이 없습니다</h1><p class="m">Cloudflare 에 ADMIN_TOKEN Secret 을 먼저 등록해 주세요.</p>', 400);
  if (!adminOk(env, token)) return page('인증 실패', '<h1 class="bad">ADMIN_TOKEN 이 올바르지 않습니다</h1><p><a href="/kakao/setup">돌아가기</a></p>', 401);
  if (!kakaoConfigured(env)) return page('설정 필요', '<h1 class="bad">KAKAO_REST_API_KEY Secret 이 없습니다</h1><p class="m">Cloudflare 에 Secret 을 먼저 등록해 주세요.</p>', 400);
  if (!env.DB) return page('설정 필요', '<h1 class="bad">D1 이 연결되어 있지 않습니다</h1>', 400);
  const state = await makeState(env, Date.now());
  return new Response(null, { status: 303, headers: { location: authorizeUrl(env, redirectUriFor(request), state), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

export async function handleCallback(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  const now = Date.now();
  const back = '<p><a href="/kakao/setup">설정 페이지로 돌아가기</a></p>';
  if (!(await verifyState(env, url.searchParams.get('state'), now))) {
    return page('연결 실패', `<h1 class="bad">잘못되었거나 만료된 요청입니다</h1><p class="m">설정 페이지에서 "카카오 연결하기"를 다시 눌러 주세요.</p>${back}`, 400);
  }
  const err = url.searchParams.get('error');
  if (err) return page('연결 취소', `<h1 class="warn">카카오 연결이 완료되지 않았습니다</h1><p class="m">사유: ${esc(err)}</p>${back}`, 400);
  const code = url.searchParams.get('code');
  if (!code || !env.DB || !kakaoConfigured(env)) return page('연결 실패', `<h1 class="bad">연결에 필요한 설정이 없습니다</h1>${back}`, 400);
  const r = await exchangeCode(env, env.DB, code, redirectUriFor(request), now, fetchImpl);
  if (!r.ok) {
    const hint = r.error === 'invalid_client' ? 'KAKAO_REST_API_KEY 또는 KAKAO_CLIENT_SECRET 값을 확인해 주세요.' : r.error === 'invalid_grant' ? '리다이렉트 URI 등록 여부를 확인하고 다시 시도해 주세요.' : '잠시 후 다시 시도해 주세요.';
    return page('연결 실패', `<h1 class="bad">토큰 발급 실패</h1><p class="m">오류: ${esc(r.error)}${r.code ? ' / ' + esc(r.code) : ''}<br>${hint}</p>${back}`, 502);
  }
  const sent = await sendKakaoMemo(env, env.DB, LINKED_MESSAGE, now, fetchImpl);
  return page(
    '연결 완료',
    `<h1 class="ok">✅ 카카오톡 연결 완료</h1><p class="m">${sent.ok ? '카카오톡 "나와의 채팅"으로 확인 메시지를 보냈습니다.' : `연결은 되었지만 확인 메시지 전송에 실패했습니다: ${esc(sent.reason)}`}${r.scopeOk ? '' : '<br><span class="warn">"카카오톡 메시지 전송" 동의가 확인되지 않았습니다. 카카오 앱의 동의항목 설정을 확인하고 다시 연결해 주세요.</span>'}</p>${back}`,
  );
}

async function runTest(env, fetchImpl) {
  if (!env.DB) return { ok: false, reason: 'D1 미설정' };
  return sendKakaoMemo(env, env.DB, TEST_MESSAGE, Date.now(), fetchImpl);
}

export async function handleTestForm(request, env, fetchImpl = fetch) {
  const token = await formToken(request);
  if (!adminOk(env, token)) return page('인증 실패', '<h1 class="bad">ADMIN_TOKEN 이 올바르지 않습니다</h1><p><a href="/kakao/setup">돌아가기</a></p>', 401);
  const r = await runTest(env, fetchImpl);
  return page('테스트 결과', r.ok ? '<h1 class="ok">✅ 테스트 메시지를 보냈습니다</h1><p class="m">카카오톡 "나와의 채팅"을 확인해 주세요.</p><p><a href="/kakao/setup">돌아가기</a></p>' : `<h1 class="bad">전송 실패</h1><p class="m">${esc(r.reason)}</p><p><a href="/kakao/setup">돌아가기</a></p>`, r.ok ? 200 : 502);
}

export async function handleTestApi(request, env, fetchImpl = fetch) {
  if (!env.ADMIN_TOKEN) return json({ status: 'not_found', message: '주소가 없습니다.' }, 404);
  if (!safeEqual(request.headers.get('authorization') || '', `Bearer ${env.ADMIN_TOKEN}`)) return json({ status: 'error', message: '인증 실패' }, 401);
  const r = await runTest(env, fetchImpl);
  return json({ ok: r.ok, message: r.ok ? '테스트 메시지를 보냈습니다.' : r.reason });
}
