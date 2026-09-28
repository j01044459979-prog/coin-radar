// Telegram Bot API 전송. 토큰/채팅 ID 는 Cloudflare Secret(env)에서만 읽습니다.
// Secret 이 없으면 아무 요청도 보내지 않고 { ok: false, skipped: true } 를 돌려줍니다.

export function telegramConfigured(env) {
  return Boolean(env && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

export async function sendTelegram(env, text, fetchImpl = fetch) {
  if (!telegramConfigured(env)) return { ok: false, skipped: true, reason: 'Telegram Secret 미설정' };
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    });
    if (res.ok) return { ok: true };
    // 응답 본문에 토큰이 들어가지 않도록 상태 코드만 기록
    return { ok: false, reason: `Telegram HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, reason: 'Telegram 네트워크 오류' };
  }
}
