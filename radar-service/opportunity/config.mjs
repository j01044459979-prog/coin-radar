// 기회 포착 레이더 설정(환경 변수). 모두 저장소 변수로만 바꾸며, 잘못된 값은 안전한 기본값으로 되돌린다.
//  RADAR_OPPORTUNITY            off(기본) | preview | on
//  RADAR_OPPORTUNITY_TOP        점검할 종목 수(기본 20, 최대 30)
//  RADAR_OPPORTUNITY_MIN_STAGE  Telegram으로 알리는 최소 단계(기본 2: 눌림 진행 중부터). 1단계(구간 접근)는 기록만 한다. 1~3
//  RADAR_OPPORTUNITY_MAX_PER_HOUR  시간당(UTC 정시 기준) 최대 알림 코인 수(기본 12, 1~30)
//  RADAR_OPPORTUNITY_MAX_PER_DAY   일일(UTC 날짜 기준) 최대 알림 코인 수(기본 80, 1~200)
//  RADAR_OPPORTUNITY_FIRST_RUN  preview/꺼짐에서 on으로 처음 켤 때 정책: summary(기본, 기존 관찰은 기준선으로 기록하고 요약 1건만 전송) | silent(요약도 보내지 않음) | alert(기존 관찰도 일반 규칙으로 알림, 시간당 상한 적용)
export const DEFAULTS = Object.freeze({ topN: 20, minStage: 2, maxPerHour: 12, maxPerDay: 80, firstRun: 'summary' });
export const READY_RESERVE = 3;     // 시간당 상한 중 '조건 충족(3단계)'을 위해 항상 남겨 두는 칸 수(상한이 작으면 1/4)

const int = (v, lo, hi, d) => { const n = Number.parseInt(String(v ?? '').trim(), 10); return Number.isInteger(n) && String(n) === String(v).trim() && n >= lo && n <= hi ? n : d; };
export function modeOf(env = process.env) {
  const v = String(env?.RADAR_OPPORTUNITY ?? '').trim().toLowerCase();
  return v === 'on' ? 'on' : v === 'preview' ? 'preview' : 'off';
}
export function settings(env = process.env) {
  const first = String(env?.RADAR_OPPORTUNITY_FIRST_RUN ?? '').trim().toLowerCase();
  return {
    mode: modeOf(env),
    topN: int(env?.RADAR_OPPORTUNITY_TOP, 1, 30, DEFAULTS.topN),
    minStage: int(env?.RADAR_OPPORTUNITY_MIN_STAGE, 1, 3, DEFAULTS.minStage),
    maxPerHour: int(env?.RADAR_OPPORTUNITY_MAX_PER_HOUR, 1, 30, DEFAULTS.maxPerHour),
    maxPerDay: int(env?.RADAR_OPPORTUNITY_MAX_PER_DAY, 1, 200, DEFAULTS.maxPerDay),
    firstRun: ['summary', 'silent', 'alert'].includes(first) ? first : DEFAULTS.firstRun,
  };
}
