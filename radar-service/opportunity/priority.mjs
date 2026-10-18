// 알림 우선순위(순수 함수): 상한을 적용하기 전에 정렬한다. 조건 충족(3단계)이 항상 최우선이다.
//  0 조건 충족(새 관찰·단계 상승·방향 전환 포함) → 1 무효화 이탈 해제 → 2 방향 전환(3단계 미만) → 3 눌림 진행 중 → 4 일반 해제 → 5 구간 접근 중
//  같은 순위에서는 충족 개수가 많은 순 → BTC 4H 일치 → 종목명(결정적 순서)
export function alertRank(it) {
  const t = it.event.type, st = it.analysis?.stage ?? it.event.to?.stage ?? 0;
  if (t === 'invalidated') return 1;
  if (t === 'cleared') return 4;
  if (st >= 3) return 0;
  if (t === 'flip') return 2;
  return st === 2 ? 3 : 5;
}
const btcRank = it => { const b = it.analysis?.metrics?.btcAlign; return b === '일치' ? 0 : b === '역방향' ? 2 : 1; };
export function sortAlerts(items) {
  return [...items].sort((a, b) => alertRank(a) - alertRank(b) || (b.analysis?.met ?? 0) - (a.analysis?.met ?? 0) || btcRank(a) - btcRank(b) || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
}
