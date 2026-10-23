// 일회용 신호 이미지 테스트. 이 파일과 워크플로는 실행 직후 삭제한다.
//  · 실제 OKX 공개 15분봉(BTC-USDT-SWAP)을 차트에 쓰고, 진입·손절·목표는 그 봉에서 기계적으로 만든 *가상* 값이다. 이미지 맨 위 띠·워터마크·캡션에 '테스트 · 가상 데이터 · 매매 금지'를 표시한다.
//  · 기존 renderSignalChart와 telegramPhotoSender를 그대로 쓴다. 운영 상태·캐시·모의매매 장부를 읽거나 쓰지 않으며 실제 신호 상태 기계를 거치지 않는다.
//  · MODE=dry: 렌더링만(전송 없음). MODE=send: 사진 1장 전송. 응답에서 message_id만 출력한다(토큰·Chat ID 비출력).
import { pathToFileURL } from 'node:url';
import { telegramPhotoSender } from '../radar-service/service.mjs';
import { collect15 } from '../radar-service/signal/collect.mjs';
import { M15 } from '../radar-service/signal/evaluate.mjs';
import { renderSignalChart, signalCaption, SIGNAL_CHART } from '../radar-service/signal/chart.mjs';

export const GUARD_REF = 'claude/coin-radar-handoff-8f4oju';
const INST = 'BTC-USDT-SWAP', COST_PCT = 0.15;

// 실제 봉에서 만든 가상 롱 진입 후보. 모든 가격은 마지막 확정 종가·최근 봉 범위로부터의 산식 값이다(임의 숫자 없음).
export function virtualCandidate(c15) {
  const last = c15.at(-1), recent = c15.slice(-14), avgRange = recent.reduce((s, c) => s + (c.h - c.l), 0) / recent.length;
  const entry = last.c, risk = avgRange * 3, stop = entry - risk, t1p = entry + risk * 1.8, t2p = entry + risk * 3, costR = entry * COST_PCT / 100 / risk;
  const pre = c15.slice(-9, -1), zoneLo = Math.min(...c15.slice(-13, -1).map(c => c.l)), zoneHi = zoneLo + avgRange;
  const mk = (price, rr) => ({ price, pct: (price - entry) / entry * 100, rr, net: rr - costR, source: '가상' });
  const base = c15.slice(-21, -1).map(c => c.q).filter(Number.isFinite);
  return { status: 'CANDIDATE', dir: 'LONG', entry, stop, riskAbs: risk, riskPct: risk / entry * 100, costPct: COST_PCT, costR, t1: mk(t1p, 1.8), t2: mk(t2p, 3),
    volRel: base.length ? last.q / (base.reduce((a, b) => a + b, 0) / base.length) : 1, zone: { lo: zoneLo, hi: zoneHi }, level: Math.max(...pre.map(c => c.h)),
    triggerT: last.t, triggerCloseT: last.t + M15, validUntil: last.t + M15 + 45 * 60000, btcAlign: '일치' };
}

export async function main({ env = process.env, fetcher = fetch, now = Date.now(), log = console.log } = {}) {
  const mode = env.MODE === 'send' ? 'send' : 'dry';
  if (mode === 'send' && env.GITHUB_REF_NAME !== GUARD_REF) throw new Error(`허용되지 않은 브랜치: ${env.GITHUB_REF_NAME}`);
  const got = await collect15({ fetcher, now, ids: [INST], gapMs: 0 }), c = got.coins[INST];
  if (!c?.c15?.length) throw new Error(`실제 15분봉 수집 실패: ${c?.status} ${c?.reason}`);
  log(`REAL_CANDLES instId=${INST} bars=${c.c15.length} status=${c.status} last=${new Date(c.c15.at(-1).t).toISOString()} close=${c.c15.at(-1).c}`);
  const ev = virtualCandidate(c.c15);
  const png = await renderSignalChart('BTCUSDT', ev, c.c15, { test: true }), caption = signalCaption('BTCUSDT', ev, { test: true });
  log(`PNG ok bytes=${png.length} size=${png.readUInt32BE(16)}x${png.readUInt32BE(20)} expected=${SIGNAL_CHART.W}x${SIGNAL_CHART.H}`);
  log('----- 캡션 -----\n' + caption + '\n----- 끝 -----');
  if (mode === 'dry') { log('MODE=dry — 전송하지 않음'); return null; }
  let messageId = null, calls = 0;
  const watching = async (url, init) => {
    calls++; const res = await fetcher(url, init);
    try { const body = await res.clone().json(); if (body?.ok && body.result?.message_id) { messageId = body.result.message_id; log(`TELEGRAM_RESULT ok=true method=sendPhoto message_id=${messageId} has_photo=${Array.isArray(body.result.photo)} chat_type=${body.result.chat?.type ?? '?'} date=${body.result.date ?? '?'}`); } else log(`TELEGRAM_RESULT ok=${body?.ok} error_code=${body?.error_code ?? '-'}`); } catch { log('TELEGRAM_RESULT 응답 해석 실패'); }
    return res;
  };
  await telegramPhotoSender(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, watching)(png, caption);
  if (calls !== 1 || messageId === null) throw new Error(`전송 확인 실패(요청 ${calls}회, message_id ${messageId})`);
  log('SENT_TEST_PHOTO_COUNT=1');
  return messageId;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
