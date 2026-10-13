import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createCollector, cycle, telegramSender } from './service.mjs';
import { reportText } from './analysis.mjs';

const preview = process.argv.includes('--preview');
const directory = process.env.RADAR_STATE_DIR || '/data';
await mkdir(directory, { recursive: true, mode: 0o700 });
let state = {};
try { state = JSON.parse(await readFile(`${directory}/state.json`, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('상태 파일 손상: 운영자 확인 필요'); }
const save = async data => {
  await writeFile(`${directory}/state.tmp`, JSON.stringify(data), { mode: 0o600 });
  await rename(`${directory}/state.tmp`, `${directory}/state.json`);
};
const collect = createCollector();
if (preview) {
  const now = Date.now();
  const { rows, failures } = await collect(now);
  console.log(reportText(rows, failures, now));
} else {
  const send = telegramSender(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID);
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
