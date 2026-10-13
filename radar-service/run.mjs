import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createCollector, cycle, telegramSender } from './service.mjs';
import { createOkxCollector } from './okx.mjs';
import { reportText } from './analysis.mjs';

// 모드: --preview(수집·출력만) | --once(1회 실행, GitHub Actions용) | --telegram-test(연결 확인 메시지 1건) | 기본(상시 루프)
const args = new Set(process.argv.slice(2));
const directory = process.env.RADAR_STATE_DIR || '/data';
await mkdir(directory, { recursive: true, mode: 0o700 });
let state = {};
try { state = JSON.parse(await readFile(`${directory}/state.json`, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('상태 파일 손상: 운영자 확인 필요'); }
const save = async data => {
  await writeFile(`${directory}/state.tmp`, JSON.stringify(data), { mode: 0o600 });
  await rename(`${directory}/state.tmp`, `${directory}/state.json`);
};
// 기본 출처는 OKX. Binance 선택은 접근 가능한 네트워크에서만 쓰며 다른 거래소 가격을 대신 쓰지 않는다.
const collect = process.env.RADAR_SOURCE === 'binance' ? createCollector() : createOkxCollector();
const tokenConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

if (args.has('--preview') || (args.has('--once') && !tokenConfigured)) {
  if (args.has('--once')) console.log('Telegram 비밀값 미설정: 수집·분석만 실행하고 전송/상태 저장은 하지 않습니다.');
  const now = Date.now();
  const { rows, failures } = await collect(now);
  console.log(reportText(rows, failures, now));
  console.log(JSON.stringify({ analyzed: rows.length, failed: failures.length, failures }));
} else if (args.has('--telegram-test')) {
  const send = telegramSender(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID);
  await send(`리치 선물 레이더 · 연결 확인\n${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' })} KST\n이 메시지가 보이면 Telegram 전송이 정상입니다.`);
  console.log('Telegram 연결 확인 메시지 전송 확인(message_id 수신)');
} else {
  const send = telegramSender(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID);
  if (args.has('--once')) {
    console.log(JSON.stringify(await cycle({ now: Date.now(), state, collect, send, save })));
  } else {
    let stopped = false;
    let timer;
    let wake;
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopped = true; clearTimeout(timer); wake?.(); });
    while (!stopped) {
      try { console.log(JSON.stringify(await cycle({ now: Date.now(), state, collect, send, save }))); }
      catch { console.error('분석/알림 처리 실패: 다음 주기에 재확인'); }
      // Start shortly after each 5-minute boundary, never overlap cycles.
      if (!stopped) await new Promise(resolve => { wake = resolve; timer = setTimeout(resolve, 300000 - Date.now() % 300000 + 5000); });
    }
  }
}
