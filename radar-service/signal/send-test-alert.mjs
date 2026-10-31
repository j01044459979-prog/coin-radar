// 새 A급 Telegram 사진 알림 형식 점검용 '테스트 신호' 1건 전송기(일회용). 가상 데이터만 쓰며 실제 시세·상태 캐시·피드·장부를 읽거나 쓰지 않는다. 주문 기능 없음.
// 사진 위쪽 띠와 워터마크, 캡션 첫 줄에 '테스트 · 가상 데이터 · 매매 금지'가 표시된다. 환경변수: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
import { evaluateSignal, M15 } from './evaluate.mjs';
import { renderSignalChart, signalCaption } from './chart.mjs';
import { candidateMessage } from './message.mjs';
import { telegramPhotoSender } from '../service.mjs';
import { mkA, mk15, NOW } from '../test/signal-fixture.mjs';

const now = Date.now(), closeT = Math.floor(now / M15) * M15;
let ev = evaluateSignal({ a: mkA(), c15: mk15(), now: NOW }, { minRR: 1.5, validMin: 45 });
if (ev.status !== 'CANDIDATE') { console.log('가상 후보 생성 실패'); process.exit(1); }
ev = { ...ev, triggerT: closeT - M15, triggerCloseT: closeT, validUntil: closeT + 45 * 60000 };              // 시각만 지금 기준으로 옮긴다(가격은 가상)
const bars = mk15({ closeT }), symbol = 'TESTUSDT';
const head = '🧪 테스트 신호 — 실제 신호·주문 아님';
const caption = `${head}\n${signalCaption(symbol, ev, { now, test: true })}`;
console.log('--- 캡션(전송 내용) ---\n' + caption + '\n--- 텍스트 알림 형식(전송 안 함) ---\n' + candidateMessage(symbol, ev, { now }).plain);
const must = [ev.entry.toFixed(2), ev.stop.toFixed(2), ev.t1.price.toFixed(2), '유효 종료', '남은', '테스트 · 가상 데이터 · 매매 금지', '테스트 신호'];
for (const m of must) if (!caption.includes(m)) { console.log('캡션 검증 실패: ' + m); process.exit(1); }
if (caption.length > 1024) { console.log('캡션 길이 초과'); process.exit(1); }
if (process.env.DRY_RUN === '1') { console.log('DRY_RUN: 전송하지 않음'); process.exit(0); }
const png = await renderSignalChart(symbol, ev, bars, { test: true });
await telegramPhotoSender(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID)(png, caption);
console.log(`테스트 신호 사진 1건 전송 확인(message_id 수신) · PNG ${png.length}바이트`);
