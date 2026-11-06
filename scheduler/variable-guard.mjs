// 승인된 저장소 변수 변경 경로(set-variable 워크플로)의 허용 목록 검사. 목록 밖 이름·값, 그리고 FIB 'on' 은 항상 거부한다.
//  · RADAR_FIB_PULLBACK 는 off|preview 만 허용한다('on' 은 별도 승인·성과 검증 전까지 금지).
//  · 스케줄러·TOP·신호 판정·Secret 등 다른 운영 변수는 이 경로로 바꿀 수 없다.
export const ALLOWED = Object.freeze({
  RADAR_RICH300_BUTTONS: ['on', 'off'],
  RADAR_TELEGRAM_QUIET: ['on', 'off'],
  RADAR_FIB_PULLBACK: ['off', 'preview'],
  RADAR_SCALE_PLAN: ['on', 'off'],          // 텔레그램 추천 이미지·알림에 3분할 진입 계획 표시(계산 참고용, 신호 판정·주문 무관)
});
export function checkVariable(name, value) {
  if (typeof name !== 'string' || !Object.hasOwn(ALLOWED, name)) return { ok: false, why: '허용 목록에 없는 변수' };
  if (typeof value !== 'string' || !ALLOWED[name].includes(value)) return { ok: false, why: `${name} 에 허용되지 않는 값` };
  return { ok: true };
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [name, value] = process.argv.slice(2), r = checkVariable(name, value);
  if (!r.ok) { console.log(`::error title=변수 변경 거부::${r.why}`); process.exit(1); }
  console.log(`허용: ${name}=${value}`);
}
