// Basic periodic radar reports are observation-only, not confirmed entry signals.
// This presentation helper never promotes a WATCH to an actionable trade.
// Confirmed RICH300 A-grade alerts use a separate evaluated signal pipeline.
import { fmtPrice } from './format.mjs';

export function watchDecision(row) {
  const c = row?.candidate, dir = c?.dir;
  if (!c || !['LONG', 'SHORT'].includes(dir)) return {
    action: '대기', status: '판단 데이터 미확인',
    trigger: '돌파 기준선 확인 불가', wait: ['조건 확인 대기'],
    conflict: false, structure: null,
  };
  const long = dir === 'LONG';
  const conflict = Boolean(c.mtfConflict);
  const blockers = Array.isArray(c.blockers) ? c.blockers : [];
  const broken = Boolean(row.strong || c.dist?.broken);
  const level = Number.isFinite(c.dist?.level) && c.dist.level > 0 ? c.dist.level : null;
  const action = blockers.length ? '진입 금지'
    : conflict ? '대기 · 추세 역행'
    : row.strong ? (long ? '재지지 대기' : '재저항 대기')
    : !broken ? (long ? '돌파 대기' : '이탈 대기') : '추가 확인 대기';
  const trigger = level === null ? '돌파 기준선 확인 불가'
    : row.strong || broken
      ? `5분봉 ${fmtPrice(level)} ${long ? '돌파' : '이탈'} 후 ${long ? '재지지' : '재저항'} 확인`
      : `5분봉 ${fmtPrice(level)} ${long ? '돌파' : '이탈'} 확정 확인`;
  const opposed = ['1H','4H'].filter(tf => {
    const d = row.mtf?.[tf]?.dir;
    return long ? d === 'DOWN' : d === 'UP';
  });
  const wait = [];
  if (blockers.length) wait.push(blockers[0]);
  if (opposed.length || conflict) wait.push(
    opposed.length ? `${opposed.join('/')} 추세 역행 주의` : '상위 시간대 추세 역행 주의');
  for (const u of c.unmet ?? []) {
    if (/거래대금|OI|펀딩|추세/.test(u)) wait.push(u);
    if (wait.length >= 3) break;
  }
  if (!wait.length) wait.push('재확인 후 판단 · 추격 진입 금지');
  const structure = Number.isFinite(c.plan?.structureAhead) && c.plan.structureAhead > 0
    ? c.plan.structureAhead : null;
  return { action, status: '관찰 · 진입 보류', trigger, wait, conflict,
    structure, level };
}
