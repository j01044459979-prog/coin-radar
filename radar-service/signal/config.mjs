// 실시간 매매 판단 지원 신호 설정(환경 변수). 모두 저장소 변수로만 바꾸며, 잘못된 값은 안전한 기본값으로 되돌린다.
//  RADAR_SIGNAL               off(기본) | preview | on     — 기회 포착 레이더(RADAR_OPPORTUNITY)와 독립된 별도 플래그
//  RADAR_SIGNAL_VALID_MIN     신호 유효시간(분, 15~120, 기본 45)
//  RADAR_SIGNAL_MIN_RR        1차 목표까지 비용 반영 최소 손익비(1~5, 기본 1.5)
//  RADAR_SIGNAL_MAX_PER_DAY   하루(UTC) 최대 '진입 후보' 알림 수(1~50, 기본 20). 무효화 알림은 상한에 포함하지 않는다
// 이 기능은 주문을 내지 않는다. 실제 주문 API·계정 API는 어디에도 연결되어 있지 않다.
export const SIGNAL_DEFAULTS = Object.freeze({ validMin: 45, minRR: 1.5, maxPerDay: 20 });
const int = (v, lo, hi, d) => { const t = String(v ?? '').trim(), n = Number.parseInt(t, 10); return Number.isInteger(n) && String(n) === t && n >= lo && n <= hi ? n : d; };
const num = (v, lo, hi, d) => { const t = String(v ?? '').trim(), n = Number(t); return t !== '' && Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
export function signalMode(env = process.env) {
  const v = String(env?.RADAR_SIGNAL ?? '').trim().toLowerCase();
  return v === 'on' ? 'on' : v === 'preview' ? 'preview' : 'off';
}
export function signalSettings(env = process.env) {
  return { mode: signalMode(env), validMin: int(env?.RADAR_SIGNAL_VALID_MIN, 15, 120, SIGNAL_DEFAULTS.validMin), minRR: num(env?.RADAR_SIGNAL_MIN_RR, 1, 5, SIGNAL_DEFAULTS.minRR), maxPerDay: int(env?.RADAR_SIGNAL_MAX_PER_DAY, 1, 50, SIGNAL_DEFAULTS.maxPerDay) };
}
