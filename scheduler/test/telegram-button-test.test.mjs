// 버튼 수신 테스트 워크플로 안전 장치(네트워크·Telegram 호출 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const wf = readFileSync(new URL('../../.github/workflows/telegram-button-test.yml', import.meta.url), 'utf8');
test('수동 전용·main 만·확인 문구·최소 권한·1건 전송 후 message_id 확인', () => {
  assert.match(wf, /on:\n  workflow_dispatch:/); assert.doesNotMatch(wf, /\n  (push|schedule|pull_request)/);
  assert.match(wf, /github\.ref == 'refs\/heads\/main'/); assert.match(wf, /confirm == 'send-test-button'/);
  assert.match(wf, /permissions:\n  contents: read/); assert.equal((wf.match(/sendMessage/g) || []).length, 1);
  assert.match(wf, /\.result\.message_id/); assert.match(wf, /exit 1/);
});
test('"테스트·가상" 표시가 있고 R9 기계 줄이 없다(앱이 장부에 쓰지 않는다), 테스트 sid 는 실제 형식과 겹치지 않는다', () => {
  assert.match(wf, /테스트 · 가상 데이터 · 매매 금지/); assert.doesNotMatch(wf, /R9 v1 /);
  const sids = [...wf.matchAll(/r1:(SG-[A-Za-z0-9-]+):[ewm]/g)].map(m => m[1]); assert.ok(sids.length === 3 && new Set(sids).size === 1);
  assert.equal(/^SG-[A-Za-z0-9]{1,14}-[LS]-[a-z0-9]{4,10}$/.test('SG-TESTBTN-L-zz0001'), true, '앱 sid 형식은 통과(콜백 파싱용)');
  assert.doesNotMatch(wf, /SG-(BTC|ETH|SOL|XRP|DOGE|BNB)-/);
});
test('토큰은 환경변수로만, 출력·디버그 없음, 다른 Secret 미사용', () => {
  assert.match(wf, /TELEGRAM_BOT_TOKEN: \$\{\{ secrets\.TELEGRAM_BOT_TOKEN \}\}/); assert.equal((wf.match(/secrets\./g) || []).length, 2);
  assert.doesNotMatch(wf, /echo "?\$TELEGRAM_BOT_TOKEN|set -x|--verbose|curl -v|RADAR_VARS_PAT|RICH300_FEED_KEY|CLOUDFLARE/);
});
