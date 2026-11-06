// 3분할 진입 차트 "테스트·가상" 이미지 1장 발송(수동 워크플로 telegram-chart-test 전용).
//  · 실제 신호 경로와 같은 렌더러(renderSignalChart)·같은 분할 계산(scalePlanFor)·같은 캡션 조립(signalCaption + scaleCaption)·같은 전송기(telegramPhotoSender)를 쓴다.
//  · 데이터는 합성(가상)이고 이미지 상단 띠와 캡션에 '테스트 · 가상 데이터 · 매매 금지'가 표시된다. 장부·상태·주문 없음.
//  · 버튼은 실제 신호가 아닌 테스트 ID(SG-TESTBTN-…)라 앱은 눌러도 "알 수 없는 신호"로만 응답하고 아무것도 기록하지 않는다(R9 줄 없음).
//  · --dry 는 Telegram 호출 없이 PNG 를 파일로 저장한다(검증용). 토큰·채팅 ID 는 출력하지 않는다.
import { writeFileSync } from 'node:fs';
import { evaluateSignal, M15 } from './evaluate.mjs';
import { renderSignalChart, signalCaption, TEST_BANNER } from './chart.mjs';
import { scalePlanFor, scaleDecorate, scaleCaption } from './scale-decorate.mjs';
import { candidateMessage } from './message.mjs';
import { r9Keyboard } from './rich300.mjs';
import { telegramPhotoSender } from '../service.mjs';
import { mkA, mirrorA, mk15, mirror15 } from '../test/signal-fixture.mjs';
import { H1 } from '../opportunity/indicators.mjs';

const args = process.argv.slice(2), arg = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d), dry = args.includes('--dry');
const dir = String(arg('dir', 'LONG')).toUpperCase(), symbol = String(arg('symbol', 'XRPUSDT')).toUpperCase(), out = arg('out', 'chart-test.png');
if (dir !== 'LONG' && dir !== 'SHORT') { console.error('dir 은 LONG 또는 SHORT'); process.exit(2); }
const K = Number(arg('scale', 0.022));                      // 합성 가격(≈100)을 코인 가격대로 옮긴다(XRP≈2.2)
// 시각을 지금 기준으로 옮긴다: 가장 최근에 15분봉이 확정된 시각을 trigger 마감으로 쓴다.
const now0 = Date.now(), closeT = Math.floor((now0 - 60000) / M15) * M15, T = closeT - M15, now = closeT + 60000;
const base = mkA({ barT: T - H1, asOf: T }), a = dir === 'LONG' ? base : mirrorA(base), bars0 = mk15({ closeT }), c0 = dir === 'LONG' ? bars0 : mirror15(bars0);
const ev0 = evaluateSignal({ a, c15: c0, now }, { minRR: 1.5, validMin: 45 });
if (ev0.status !== 'CANDIDATE') { console.error('가상 신호 생성 실패'); process.exit(1); }
const ev = { ...ev0, entry: ev0.entry * K, stop: ev0.stop * K, level: ev0.level * K, zone: { ...ev0.zone, lo: ev0.zone.lo * K, hi: ev0.zone.hi * K }, t1: { ...ev0.t1, price: ev0.t1.price * K }, t2: ev0.t2 && { ...ev0.t2, price: ev0.t2.price * K } };
const c15 = c0.map(c => ({ ...c, o: c.o * K, h: c.h * K, l: c.l * K, c: c.c * K }));
const env = { RADAR_SCALE_PLAN: 'on', RADAR_PLAN_EQUITY: process.env.RADAR_PLAN_EQUITY || '300' };
const plan = scalePlanFor(symbol, ev, env);
if (!plan || plan.status !== 'ok') { console.error(`분할 계획 없음(${plan ? plan.reason : 'error'}) — 이미지에 계획을 그릴 수 없습니다`); process.exit(1); }
const part = scaleDecorate(candidateMessage(symbol, ev, { now }), symbol, ev, env);
const caption = scaleCaption(signalCaption(symbol, ev, { now, test: true }), part, 0);
const png = await renderSignalChart(symbol, ev, c15, { test: true, plan });
console.log(`계획 ${plan.stagesCount}단계 · 격리 ${plan.lev}배 · 총 증거금 ${plan.totalMargin.toFixed(2)} USDT · 이미지 ${png.length} bytes · ${dir} ${symbol} · ${TEST_BANNER}`);
if (dry) { writeFileSync(out, png); console.log(`저장: ${out}`); process.exit(0); }
const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
if (!token || !chat) { console.error('Telegram 비밀값이 없습니다(값은 출력하지 않습니다)'); process.exit(1); }
const send = telegramPhotoSender(token, chat), sid = `SG-TESTBTN-${dir === 'LONG' ? 'L' : 'S'}-zz0002`;
await send(png, caption, { markup: r9Keyboard(sid) });
console.log('테스트 이미지 1건 전송 확인');
