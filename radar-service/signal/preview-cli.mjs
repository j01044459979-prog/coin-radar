// 읽기 전용 미리보기: 공개 OKX 시세로 관찰 후보를 찾고 15분봉 트리거를 판정해 '보냈을 메시지'를 출력만 한다. Telegram·비밀값·상태 저장·주문 없음.
// 사용: node radar-service/signal/preview-cli.mjs [--top 20]
import { runSignalSafe } from './step.mjs';
const args = process.argv.slice(2), top = Number(args.includes('--top') ? args[args.indexOf('--top') + 1] : 20);
const out = await runSignalSafe({ now: Date.now(), state: {}, env: { RADAR_SIGNAL: 'preview' }, send: null, save: async () => {}, force: true, scanAll: true, topN: top, log: () => {} });
const { preview, ...rest } = out;
console.log('SIGNAL ' + JSON.stringify(rest));
if (preview) { console.log('--- per-coin ---'); preview.lines.forEach(l => console.log(l)); console.log(`--- messages that would be sent (${preview.messages.length}) ---`); preview.messages.forEach((m, i) => console.log(`[${i + 1}]\n${m}\n`)); }
