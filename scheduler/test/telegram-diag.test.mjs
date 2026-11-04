// Telegram 진단 워크플로 안전 장치: 읽기 전용(getMe·getWebhookInfo 만), 토큰 비출력.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const wf = readFileSync(new URL('../../.github/workflows/telegram-diag.yml', import.meta.url), 'utf8');
test('수동 전용·main 만·확인 문구·최소 권한', () => {
  assert.match(wf, /on:\n  workflow_dispatch:/); assert.doesNotMatch(wf, /\n  (push|schedule|pull_request)/);
  assert.match(wf, /github\.ref == 'refs\/heads\/main'/); assert.match(wf, /confirm == 'diag-telegram'/); assert.match(wf, /permissions:\n  contents: read/);
});
test('읽기 전용: getMe·getWebhookInfo 만 호출, 전송·getUpdates·webhook 변경·삭제 없음', () => {
  const calls = [...wf.matchAll(/\/bot\$\{TELEGRAM_BOT_TOKEN\}\/(\w+)/g)].map(m => m[1]).sort(); assert.deepEqual(calls, ['getMe', 'getWebhookInfo']);
  assert.doesNotMatch(wf, /sendMessage|sendPhoto|getUpdates|setWebhook|deleteWebhook|answerCallbackQuery|--data|-X POST/);
});
test('토큰·채팅 ID 비출력, 다른 Secret 미사용', () => {
  assert.equal((wf.match(/secrets\./g) || []).length, 1); assert.doesNotMatch(wf, /TELEGRAM_CHAT_ID|echo "?\$TELEGRAM_BOT_TOKEN|set -x|--verbose|curl -v/);
});
