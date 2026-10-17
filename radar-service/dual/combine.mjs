// A+B 결합 판정. 규칙(사용자 지정): 두 전략이 같은 방향이고 각각 75점 이상이면 '우선 후보', 방향이 다르면 '관망', 단일 전략 신호는 '관심'.
// 시장 상황이 나쁘면(BTC 데이터 없음·BTC 변동성 과다) 우선 후보를 내지 않는다(0건 허용). 점수는 승률이 아닌 조건 충족 점수.
export const DUAL_RULES = { priorityMin: 75, directionMin: 50, btcMaxAtrPct: 2.5 };

export function marketGate(btcCtx) {
  if (!btcCtx?.usable) return { ok: false, reason: 'BTC 데이터 부족' };
  if (btcCtx.atrPct > DUAL_RULES.btcMaxAtrPct) return { ok: false, reason: `BTC 변동성 과다(1시간 ATR ${btcCtx.atrPct.toFixed(2)}%)` };
  return { ok: true, reason: null };
}

// a, b: scoreA/scoreB 결과. 반환: { verdict: PRIORITY|INTEREST|WAIT|NONE, dir, label, reason }
export function classify(a, b, gate = { ok: true }, R = DUAL_RULES) {
  const aDir = a?.dir && a.score >= R.directionMin ? a.dir : null, bDir = b?.dir && b.score >= R.directionMin ? b.dir : null;
  const bBlocked = Boolean(b?.blockers?.length);
  if (aDir && bDir && aDir !== bDir) return { verdict: 'WAIT', dir: null, label: '관망', reason: `전략 방향 충돌(A ${aDir === 'LONG' ? '롱' : '숏'} · B ${bDir === 'LONG' ? '롱' : '숏'})` };
  const aBlocked = Boolean(a?.blockers?.length);
  const aOk = aDir && a.score >= R.priorityMin && !aBlocked, bOk = bDir && b.score >= R.priorityMin && !bBlocked;
  if (aOk && bOk) {
    if (!gate.ok) return { verdict: 'INTEREST', dir: aDir, label: '관심(우선 후보 보류)', reason: `시장 상황 필터: ${gate.reason}` };
    return { verdict: 'PRIORITY', dir: aDir, label: '우선 추천 후보', reason: `A ${a.score} · B ${b.score} 동일 방향` };
  }
  const single = aDir && a.score >= R.priorityMin && !aBlocked ? 'A' : bDir && b.score >= R.priorityMin && !bBlocked ? 'B' : null;
  if (single) return { verdict: 'INTEREST', dir: single === 'A' ? aDir : bDir, label: '관심 종목', reason: `${single} 전략 단독 신호(다른 전략은 기준 미달)` };
  if (bDir && b.score >= R.priorityMin && bBlocked) return { verdict: 'INTEREST', dir: bDir, label: '관심 종목(차단 조건 있음)', reason: `B 차단: ${b.blockers[0]}` };
  return { verdict: 'NONE', dir: null, label: '신호 없음', reason: '두 전략 모두 기준 미달' };
}
