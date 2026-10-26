// R9: COIN RADAR 진입 후보 메시지의 'R9 v1 …' 한 줄을 읽어 신호(signal) 데이터로 바꾼다. 순수 함수(저장·네트워크 없음).
//  · 줄 형식: R9 v1 <sid> <SYMBOLUSDT> <LONG|SHORT> <entry> <stop> <tp1> <tp2|-> <전략 A|B|S> <점수|-> <신호시각ms>
//  · 이 줄은 radar가 보낸 메시지(버튼을 누른 메시지)에서만 읽는다. 값 검증은 저장소 스키마(signal)가 다시 한다.
export const R9_LINE_RE = /(?:^|\n)R9 v1 ([A-Za-z0-9_.-]{1,54}) ([A-Z0-9]{2,20}USDT) (LONG|SHORT) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?|-) ([ABS]) (\d{1,3}|-) (\d{10,14})(?=\n|$)/;
export function r9ParseSignal(text) {
  const m = R9_LINE_RE.exec(String((text != null ? text : ''))); if (!m) return null;
  const signalAt = Number(m[10]); if (!Number.isSafeInteger(signalAt)) return null;
  return { sid: m[1], symbolId: m[2], dir: m[3], entry: m[4], stop: m[5], tp1: m[6], ...(m[7] === '-' ? {} : { tp2: m[7] }), strategy: m[8], ...(m[9] === '-' ? {} : { score: Number(m[9]) }), signalAt };
}
// 버튼을 누른 뒤 메시지를 다시 쓸 때 기계 줄은 빼고 사람이 읽는 부분만 남긴다.
export const r9StripLine = text => String((text != null ? text : '')).replace(R9_LINE_RE, '').replace(/\n{3,}/g, '\n\n').trimEnd();
