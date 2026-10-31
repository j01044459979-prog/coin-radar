// 신호 Telegram 메시지(HTML <b>만 사용, 외부 문자열은 이스케이프). 모바일 가독성 우선: 한 줄 약 30자 안팎, 가격 줄은 아이콘으로 구분, 근거는 3개 이내.
// 표현 원칙: 주문 권고가 아니다. '진입 관심가'는 관찰 가격이며 체결을 보장하지 않는다. 승률·수익 확률을 말하지 않는다.
import { bold, escHtml, fmtPrice, htmlToPlain } from '../format.mjs';

export const SIGNAL_DISCLAIMER = '※ 판단 보조용 · 주문 권고 아님\n※ 미검증 규칙 · 비용 왕복 {cost}% 가정';
// 화면 폭 근사(한글·전각·이모지 2, 그 밖 1). 모바일 말풍선은 대략 폭 40~44에서 줄이 꺾인다.
export const displayWidth = s => [...String(s)].reduce((n, ch) => { const c = ch.codePointAt(0); return n + (c === 0xfe0f ? 0 : (c > 0x2e80 || (c >= 0x1100 && c <= 0x11ff) || c >= 0x1f000 || (c >= 0x2600 && c <= 0x27bf)) ? 2 : 1); }, 0);
export const baseName = symbol => String(symbol).replace(/USDT$/, '');
const kst = t => new Date(t + 9 * 3600000).toISOString().slice(11, 16);
const pct = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
const icon = dir => (dir === 'LONG' ? '🟢' : '🔴');

/** 후보 신호 종료 날짜와 분석 시각 기준 잔여시간(표시 전용). */
export function signalDeadline(ev, now) {
  const until = Number(ev.validUntil);
  const end = new Date(until + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' ');
  const left = Number.isFinite(now) ? Math.ceil((until - now) / 60000) : null;
  return {
    deadlineLine: `📅 유효 종료 ${end} KST`,
    remainingLine: left === null ? null : left > 0 ? `⏳ 남은 ${left}분 (분석 시점)` : '⛔ 유효시간 경과 · 신규 진입 금지',
  };
}

// 진입 후보 메시지. 레버리지는 권하지 않고, 손절폭 대비 증거금 손실만 사실로 보여 준다.
export function candidateMessage(symbol, ev, { now } = {}) {
  const L = ev.dir === 'LONG', lines = [];
  lines.push(`${icon(ev.dir)} ${bold(baseName(symbol))} · ${bold(ev.dir)} · ${bold('진입 후보')}`);
  lines.push(`상태 관찰 ▶ ${bold('진입 후보')} ▶ 무효화`);
  lines.push(`⏱ 생성 ${kst(ev.triggerCloseT)} KST (15분봉 확정)`, `   유효 ${kst(ev.triggerCloseT)}~${kst(ev.validUntil)} KST`);
  const timing = signalDeadline(ev, now);
  lines.push(timing.deadlineLine);
  if (timing.remainingLine) lines.push(timing.remainingLine);
  lines.push('', `💰 진입 관심가 ${fmtPrice(ev.entry)}`, `🛑 손절 기준 ${fmtPrice(ev.stop)} (${pct(-ev.riskPct * (L ? 1 : -1))})`);
  lines.push(`🎯 1차 ${fmtPrice(ev.t1.price)} (${pct(ev.t1.pct)})`);
  lines.push(ev.t2 ? `🎯 2차 ${fmtPrice(ev.t2.price)} (${pct(ev.t2.pct)})` : '🎯 2차 산정 불가');
  const r = x => x.toFixed(2);
  lines.push(`⚖️ 손익비 1차 ${r(ev.t1.rr)}R${ev.t2 ? ` · 2차 ${r(ev.t2.rr)}R` : ''}`, `   비용 반영 1차 ${r(ev.t1.net)}R${ev.t2 ? ` · 2차 ${r(ev.t2.net)}R` : ''}`);
  lines.push('', '📈 근거', ...ev.evidence.slice(0, 3).map(e => `• ${escHtml(e)}`));
  const lev = [5, 10, 20].map(x => `${x}배 −${(ev.riskPct * x).toFixed(0)}%`).join(' · ');
  lines.push('', `⚠️ 손절폭 ${ev.riskPct.toFixed(2)}%`, '   레버리지 시 증거금 손실', `   ${lev}`, '   고배율은 손절 전 청산 가능');
  if (ev.btcAlign === '역방향') lines.push('⚠️ BTC 4H 방향과 반대');
  lines.push('', '🚫 무효화 조건', `   15분 종가 ${fmtPrice(ev.stop)} ${L ? '하향' : '상향'} 이탈`, '   또는 유효시간 경과');
  lines.push('', '⚠️ 관심가는 신호 당시 종가', '   실시간 시세·체결가 아님', escHtml(SIGNAL_DISCLAIMER.replace('{cost}', ev.costPct.toFixed(2))));
  const text = lines.join('\n');
  return { text, plain: htmlToPlain(text), html: true, kind: 'candidate' };
}

export function invalidatedMessage(symbol, event, { now } = {}) {
  const L = event.dir === 'LONG';
  const lines = [`🚫 ${bold(baseName(symbol))} · ${bold(event.dir)} · ${bold('무효화')}`, `상태 관찰 ▶ 진입 후보 ▶ ${bold('무효화')}`,
    '사유', escHtml(event.reason), `현재 ${fmtPrice(event.price)} · 손절 ${fmtPrice(event.stop)}`, `신호 생성 ${kst(event.triggerT + 15 * 60000)} KST`,
    '', '앞서 알린 진입 후보는', '더 이상 유효하지 않습니다.', '', escHtml('※ 판단 보조용 · 주문 권고 아님'), escHtml('※ 미검증 규칙')];
  const text = lines.join('\n');
  return { text, plain: htmlToPlain(text), html: true, kind: 'invalidated' };
}

// 미리보기·로그용 한 줄 요약
export function summaryLine(symbol, ev) {
  if (!ev) return `${baseName(symbol)}: 분석 제외`;
  if (ev.status === 'CANDIDATE') return `${baseName(symbol)}: ${ev.dir} 진입 후보 (진입 ${fmtPrice(ev.entry)} · 손절 ${fmtPrice(ev.stop)} · 1차 ${fmtPrice(ev.t1.price)} ${ev.t1.rr.toFixed(1)}R)`;
  if (ev.status === 'OBSERVE') return `${baseName(symbol)}: ${ev.dir} 관찰 — ${ev.blockers.join(' / ')}`;
  return `${baseName(symbol)}: WAIT — ${ev.why}`;
}
