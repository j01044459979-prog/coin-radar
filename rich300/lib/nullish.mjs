// Apps Script 문법 검사기는 ES2020 의 '??'·'?.' 를 받지 않을 수 있어(BigInt 리터럴 '10n' 은 실제로 거부됨) 소스에서 쓰지 않는다. 좌변이 호출 결과 등 두 번 계산하면 안 되는 경우의 대체: 값이 null·undefined 일 때만 기본값.
// 기본값(두 번째 인수)은 미리 계산되므로 부작용 없는 값(리터럴·빈 컬렉션·BigInt(0) 등)만 넘긴다.
export function nullishOr(value, fallback) { return value === null || value === undefined ? fallback : value; }
