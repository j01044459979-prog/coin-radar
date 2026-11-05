// KST(UTC+9, 서머타임 없음) 거래일 계산. 일 경계는 매일 00:00 KST. 시스템 시간대·Date 지역 설정에 의존하지 않는 순수 산술.
const TIME_KST_OFFSET_MS = 9 * 3600000;
const TIME_DAY_MS = 86400000;
export const isDayString = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dayStringValid(s);
function dayStringValid(s) { const [y, m, d] = s.split('-').map(Number); return m >= 1 && m <= 12 && d >= 1 && d <= timeDaysInMonth(y, m); }
function timeDaysInMonth(y, m) { return [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }
function timeCivilToDays(y, m, d) { y -= m <= 2 ? 1 : 0; const era = Math.floor(y / 400), yoe = y - era * 400, doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1, doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; return era * 146097 + doe - 719468; }
function timeDaysToCivil(z) { z += 719468; const era = Math.floor(z / 146097), doe = z - era * 146097, yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365), y = yoe + era * 400, doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)), mp = Math.floor((5 * doy + 2) / 153), d = doy - Math.floor((153 * mp + 2) / 5) + 1, m = mp + (mp < 10 ? 3 : -9); return [y + (m <= 2 ? 1 : 0), m, d]; }
export function dayToIndex(day) { if (!isDayString(day)) throw new Error(`날짜 형식 오류: ${day}`); const [y, m, d] = day.split('-').map(Number); return timeCivilToDays(y, m, d); }
export function indexToDay(i) { const [y, m, d] = timeDaysToCivil(i); return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
export const kstDayOf = ms => indexToDay(Math.floor((ms + TIME_KST_OFFSET_MS) / TIME_DAY_MS));   // UTC ms → KST 날짜
export const dayStartMs = day => dayToIndex(day) * TIME_DAY_MS - TIME_KST_OFFSET_MS;              // 해당 KST 날짜 00:00의 UTC ms
export const dayEndMs = day => dayStartMs(day) + TIME_DAY_MS;                                      // 다음 날 00:00(배타적 끝)
export const addDays = (day, n) => indexToDay(dayToIndex(day) + n);
export const daysBetween = (a, b) => dayToIndex(b) - dayToIndex(a);
export function dayRange(from, through) { const out = []; for (let i = dayToIndex(from), e = dayToIndex(through); i <= e; i++) out.push(indexToDay(i)); return out; }
