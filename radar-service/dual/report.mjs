// 듀얼 전략 텔레그램 보고서(HTML + 일반 텍스트 대체본). 점수는 승률이 아닌 조건 충족 점수. 전략 A 표기는 '자주 쓰이는 지표 조합'이며 트레이딩뷰 순위·검증 수익률이 아니다.
import { escHtml, fmtPrice, htmlToPlain, visibleLength } from '../format.mjs';
import { RECOMMEND_NOTE } from './texts.mjs';
import { kstLabel } from '../compact.mjs';

const bold = t => `<b>${escHtml(t)}</b>`;
const kst = ms => `${kstLabel(ms)} KST`;
const dirKo = d => (d === 'LONG' ? '롱' : d === 'SHORT' ? '숏' : '관망');
const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

function risks(item) {
  const out = [];
  for (const b of item.b.blockers ?? []) out.push(b);
  const rsiNote = item.a.parts?.rsi?.note; if (/과열/.test(rsiNote ?? '')) out.push(`RSI ${rsiNote.replace(/^RSI\(\d+\)\s*/, '')}`);
  if (item.b.parts?.chase) { const m = item.b.parts.chase.note.match(/ATR ([\d.]+)%/); if (m && Number(m[1]) > 2) out.push(`변동성 큼(ATR ${m[1]}%)`); }
  if (item.b.plan && Number.isFinite(item.b.plan.room) && item.b.plan.room < 2.5) out.push(`앞쪽 구조까지 ${item.b.plan.room.toFixed(1)}R`);
  if (item.a.age !== undefined && item.a.age > 36) out.push(`Supertrend 전환 후 ${item.a.age + 1}봉 경과(늦은 진입 가능)`);
  out.push('수수료·슬리피지·펀딩 반영 전 참고 계획이며 매매 지시가 아님');
  return out.slice(0, 4);
}

function entryText(item) {
  const p = item.plan, d = item.cls.dir === 'LONG';
  if (!p) return ['진입·손절·목표 계산 불가'];
  const level = item.b.level ?? item.a.supertrendLine;
  const cond = item.b.dir === item.cls.dir && item.b.level ? `1시간봉 종가가 ${fmtPrice(item.b.level)} ${d ? '위' : '아래'} 유지되는 동안` : `Supertrend 라인 ${fmtPrice(item.a.supertrendLine)} ${d ? '위' : '아래'} 유지되는 동안`;
  const risk = Math.abs(p.entry - p.stop), rr = risk > 0 ? Math.abs(p.tp - p.entry) / risk : null;
  return [`진입 조건: ${cond} 현재가 ${fmtPrice(p.entry)} 부근 (조건부 참고가)`, `손절 ${fmtPrice(p.stop)} (${(risk / p.entry * 100).toFixed(2)}%) · 목표 ${fmtPrice(p.tp)} · 손익비 1:${rr ? rr.toFixed(1) : '-'}`,
    `무효화: 1시간봉 종가가 ${fmtPrice(p.stop)} ${d ? '아래' : '위'}로 마감하거나 Supertrend 방향이 바뀌면 신호 무효`];
}

export function dualReport(res, now, scan) {
  const html = [], plain = [];
  const put = (h, p = htmlToPlain(h)) => { html.push(h); plain.push(p); };
  const gap = () => put('', '');
  const prios = res.items.filter(x => x.cls.verdict === 'PRIORITY').sort((x, y) => (y.a.score + y.b.score) - (x.a.score + x.b.score)).slice(0, 2);
  const interests = res.items.filter(x => x.cls.verdict === 'INTEREST').sort((x, y) => Math.max(y.a.score, y.b.score) - Math.max(x.a.score, x.b.score)).slice(0, 5);
  const waits = res.items.filter(x => x.cls.verdict === 'WAIT').length;
  put(bold('📡 RICH FUTURES RADAR · 듀얼 전략 3.0'), '📡 RICH FUTURES RADAR · 듀얼 전략 3.0');
  put(escHtml(`추천 시각 ${kst(now)} · 데이터 기준 ${kst(res.dataAsOf)} (1시간 마감봉)`));
  put(escHtml(`🌐 전체 시세 탐색 ${scan?.eligible ?? '-'}종목 / 🔬 듀얼 평가 ${res.evaluated}종목${res.skipped.length ? ` (제외 ${res.skipped.length})` : ''}`));
  put(escHtml(RECOMMEND_NOTE));
  gap();
  if (!res.gate.ok) { put(escHtml(`⛔ 시장 상황 필터: ${res.gate.reason} → 우선 후보 보류`)); gap(); }
  if (!prios.length) { put(bold('⏳ 이번 평가 대상에서 우선 추천 후보 없음'), '⏳ 이번 평가 대상에서 우선 추천 후보 없음'); put(escHtml('(두 전략이 같은 방향이고 각각 75점 이상인 종목이 없음 · 시장 전체에 기회가 없다는 뜻이 아님)')); gap(); }
  prios.forEach((it, k) => {
    put(`${k === 0 ? '🥇' : '🥈'} ${bold(it.symbol)} · ${escHtml(dirKo(it.cls.dir))} · ${escHtml('우선 추천 후보')}`, `${k === 0 ? '🥇' : '🥈'} ${it.symbol} · ${dirKo(it.cls.dir)} · 우선 추천 후보`);
    put(escHtml(`전략 A(지표) ${it.a.score}점: ${clip(Object.values(it.a.parts).map(p => p.note).join(' · '), 150)}`));
    put(escHtml(`전략 B(자체) ${it.b.score}점: ${clip(Object.values(it.b.parts).map(p => p.note).join(' · '), 170)}`));
    entryText(it).forEach(l => put(escHtml(l)));
    risks(it).forEach(l => put(escHtml(`⚠️ ${l}`)));
    gap();
  });
  if (interests.length) {
    put(bold('👀 관심 종목 (단일 전략 신호)'), '👀 관심 종목 (단일 전략 신호)');
    interests.forEach(it => put(escHtml(`• ${it.symbol} ${dirKo(it.cls.dir)} · A ${it.a.score} / B ${it.b.score} · ${clip(it.cls.reason, 60)}`)));
    gap();
  }
  if (waits) put(escHtml(`↔️ 방향 충돌 관망 ${waits}종목`));
  if (res.skipped.length) put(escHtml(`※ 데이터 문제로 제외: ${res.skipped.slice(0, 3).map(s => s.symbol).join(', ')}${res.skipped.length > 3 ? ' 외' : ''}`));
  put(escHtml('※ 전략 A는 트레이딩뷰에서 자주 쓰이는 지표 조합일 뿐 인기 순위·검증 수익률이 아님 · 점수는 승률 아님'));
  const text = html.join('\n'), plainText = plain.join('\n');
  return { text, plain: plainText, prioritySymbols: prios.map(x => x.symbol), interestSymbols: interests.map(x => x.symbol), visible: visibleLength(text) };
}
