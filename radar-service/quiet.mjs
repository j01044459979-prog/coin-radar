// Telegram 조용한 모드(P1): 일반 후보·정기 보고의 *전송만* 중단한다. 분석·상태 저장·피드·A급 신호·필수 장애 알림은 그대로다.
//  · 플래그 RADAR_TELEGRAM_QUIET = on 일 때만 동작(기본 off → 기존 동작과 한 글자도 다르지 않다).
//  · 억제 대상: 정기 보고(시간별 요약·차트), 주기 분석의 강한 신호 긴급 알림, OPPORTUNITY(관찰 후보) 알림.
//  · 억제하지 않음: A급 신호(signal 단계의 진입 후보·무효화), 수집 장애 알림, 연속성 경고, RICH300 피드.
//  · OPPORTUNITY 는 '무음 전송기'를 받아 평소와 동일하게 상태를 갱신한다(watchlist 가 state.opportunity.coins 에 의존하므로 분석은 멈추지 않는다).
export const quietMode = (env = process.env) => String(env?.RADAR_TELEGRAM_QUIET ?? '').trim().toLowerCase() === 'on';

export function mutedSender() {
  const stat = { count: 0 };
  const send = async () => { stat.count += 1; return { ok: true, muted: true, result: { message_id: 0 } }; };
  return { send, stat };
}
