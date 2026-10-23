// A/B 전략 알림 카드: 메시지 유형 표시·전략명·짧은 캡션(2~3줄)·세로형 이미지·실패 시 짧은 텍스트 대체.
// 전략 판정 로직과 무관한 표시 계층이다(전략이 같은 입력 형식 card를 만들어 넘기면 된다). 기존 운영 알림(정기 분석·기회 포착·진입 후보)은 이 모듈을 쓰지 않으며 바뀌지 않는다.
// 표현 원칙: 모의매매 · 미검증 전략. 확정 수익·매수/매도 지시·확률 표현 없음. 이미지·캡션 모두 입력된 실제 값만 쓴다.
import { RESTRICTED } from '../service.mjs';
import { fmtPrice, priceDecimals } from '../format.mjs';
import { displayWidth } from './message.mjs';
import { buildSignalSvg, renderSignalChart, SIGNAL_CHART } from './chart.mjs';

export const PAPER_LABEL = '모의매매 · 미검증 전략';
export const STRATEGIES = Object.freeze({
  A: Object.freeze({ id: 'A', name: 'A전략 · 추세돌파형', emoji: '📈', color: '#38bdf8' }),
  B: Object.freeze({ id: 'B', name: 'B전략 · 눌림목 재진입형', emoji: '📉', color: '#c4b5fd' }),
});
// 메시지 유형 머리말(기존 알림 문구는 바꾸지 않는다: 필요한 곳에서 선택적으로 붙일 수 있게 상수만 제공)
export const MESSAGE_TYPES = Object.freeze({
  regular: '📊 TOP2 시장 분석 · 관찰용',
  opportunity: '🔎 기회 포착 · 진입 전 관찰',
  A: '📈 A전략 · 모의매매 신호',
  B: '📉 B전략 · 모의매매 신호',
});
export const typeLabel = kind => { const t = MESSAGE_TYPES[kind]; if (!t) throw new Error(`알 수 없는 메시지 유형: ${kind}`); return t; };

const FORBID = /승률|확률|매수|매도|주문 접수|수익 보장|보장합니다|확정 수익|무조건/;
export const MAX_REASONS = 3, MAX_REASON_WIDTH = 60, MAX_SUMMARY_WIDTH = 30, MAX_LINE_WIDTH = 64;

// card: { strategy:'A'|'B', symbol:'BTCUSDT', dir:'LONG'|'SHORT', entry, stop, tp1, tp2?, summary:'한 줄 요약(폭 30 이내)', reasons:[2~3개], c15:[실제 확정 15분봉], triggerT, triggerCloseT, validUntil, volRel?, costPct? }
export function validateCard(card) {
  const S = STRATEGIES[card?.strategy];
  if (!S) throw new Error('전략 구분 없음(A/B)');
  if (!/^[A-Z0-9]+USDT$/.test(card.symbol ?? '') || !['LONG', 'SHORT'].includes(card.dir)) throw new Error('종목·방향 오류');
  for (const k of ['entry', 'stop', 'tp1']) if (!Number.isFinite(card[k])) throw new Error(`가격 값 오류: ${k}`);
  if (card.tp2 != null && !Number.isFinite(card.tp2)) throw new Error('가격 값 오류: tp2');
  const s = card.dir === 'LONG' ? 1 : -1;
  if ((card.entry - card.stop) * s <= 0) throw new Error('손절가가 진입가 반대쪽이어야 함');
  if ((card.tp1 - card.entry) * s <= 0 || (card.tp2 != null && (card.tp2 - card.tp1) * s <= 0)) throw new Error('목표가가 진입가 방향이어야 함(TP2는 TP1보다 멀리)');
  if (!Array.isArray(card.reasons) || card.reasons.length < 2 || card.reasons.length > MAX_REASONS || !card.reasons.every(r => typeof r === 'string' && r.trim() && displayWidth(r) <= MAX_REASON_WIDTH)) throw new Error('근거는 2~3개, 각 폭 30자 이내');
  if (typeof card.summary !== 'string' || !card.summary.trim() || displayWidth(card.summary) > MAX_SUMMARY_WIDTH) throw new Error('캡션 요약은 한 줄(폭 30 이내) 필수');
  if ([...card.reasons, card.summary].some(r => FORBID.test(r))) throw new Error('금지 표현 포함');
  return { S, s };
}

// 이미지 렌더러가 쓰는 평가 형식으로 변환: 모든 수치는 입력 가격에서 산식으로만 계산한다(손익비 = 목표 거리 ÷ 손절 거리, 비용 반영 = 손익비 − 비용 R).
export function cardToEval(card) {
  const { s } = validateCard(card), risk = Math.abs(card.entry - card.stop), costPct = card.costPct ?? 0.15, costR = card.entry * costPct / 100 / risk;
  const mk = p => { const rr = (p - card.entry) * s / risk; return { price: p, pct: (p - card.entry) / card.entry * 100, rr, net: rr - costR, source: 'strategy' }; };
  return { status: 'CANDIDATE', dir: card.dir, entry: card.entry, stop: card.stop, riskAbs: risk, riskPct: risk / card.entry * 100, costR, costPct,
    t1: mk(card.tp1), t2: card.tp2 != null ? mk(card.tp2) : null, volRel: card.volRel ?? null, zone: null, level: null,
    triggerT: card.triggerT, triggerCloseT: card.triggerCloseT, validUntil: card.validUntil };
}

// Telegram 캡션 = 이미지 실패 시 대체 텍스트(2~3줄, HTML 없음).
export function strategyCaption(card) {
  const { S } = validateCard(card), dec = priceDecimals(card.entry), f = v => fmtPrice(v, dec);
  const lines = [`${S.emoji} ${S.name} | ${card.symbol} ${card.dir}`,
    `진입 ${f(card.entry)} · 손절 ${f(card.stop)} · TP1 ${f(card.tp1)}${card.tp2 != null ? ` · TP2 ${f(card.tp2)}` : ''}`,
    `${PAPER_LABEL} · ${card.summary.trim()}`];
  lines.forEach(l => { if (displayWidth(l) > MAX_LINE_WIDTH + 12) throw new Error(`캡션 줄이 너무 김: ${l}`); });
  return lines.join('\n');
}

export const strategyOpts = card => ({ strategy: { ...STRATEGIES[card.strategy], reasons: card.reasons.map(r => r.trim()) } });
export const buildStrategySvg = card => buildSignalSvg(card.symbol, cardToEval(card), card.c15, strategyOpts(card));
export const renderStrategyChart = card => renderSignalChart(card.symbol, cardToEval(card), card.c15, strategyOpts(card));

async function withTimeout(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${label} 시간 초과`)), ms); })]); } finally { clearTimeout(timer); }
}
// 사진 우선 전송, 이미지 생성 실패나 사진 거절(HTTP 4xx, 429 제외)이면 같은 캡션 텍스트로 대체한다. 429·5xx·네트워크 오류는 던져서 호출자의 장부·재시도 규칙을 따른다.
export async function deliverCard(card, { send, sendPhoto = null, render = renderStrategyChart, timeoutMs = 15000 } = {}) {
  const caption = strategyCaption(card);
  let chartError = null;
  if (sendPhoto) {
    let png = null;
    try { png = await withTimeout(Promise.resolve().then(() => render(card)), timeoutMs, '차트 렌더링'); if (!png?.length) throw new Error('이미지 없음'); }
    catch (error) { chartError = String(error.message).slice(0, 80); }
    if (png) {
      try { await sendPhoto(png, caption); return { via: 'photo', caption }; }
      catch (error) { if (!(error.status >= 400 && error.status < 500 && !RESTRICTED.includes(error.status))) throw error; chartError = `사진 거절 HTTP ${error.status}`; }
    }
  }
  await send(caption);
  return { via: 'text', caption, chartError };
}
export { SIGNAL_CHART };
