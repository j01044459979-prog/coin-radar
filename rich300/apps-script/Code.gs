// RICH 300 engine bundle — 자동 생성 파일(rich300/build.mjs). 직접 수정하지 마세요.

// ── nullish.mjs ──
// Apps Script 문법 검사기는 ES2020 의 '??'·'?.' 를 받지 않을 수 있어(BigInt 리터럴 '10n' 은 실제로 거부됨) 소스에서 쓰지 않는다. 좌변이 호출 결과 등 두 번 계산하면 안 되는 경우의 대체: 값이 null·undefined 일 때만 기본값.
// 기본값(두 번째 인수)은 미리 계산되므로 부작용 없는 값(리터럴·빈 컬렉션·BigInt(0) 등)만 넘긴다.
function nullishOr(value, fallback) { return value === null || value === undefined ? fallback : value; }

// ── decimal.mjs ──
// 고정소수점 십진수(BigInt, 단위 10^-12). 부동소수 오차 없이 가격·수량·금액을 계산한다.
//  · 내부 값 = 십진수 × 10^12 인 BigInt. 입력은 십진 문자열(권장), 숫자(소수 12자리로 반올림), 정수 BigInt(정수 단위).
//  · 문자열 입력은 소수 12자리를 넘으면 오류(조용히 반올림하지 않는다).
//  · 금액(USDT)은 장부 경계에서 마이크로 USDT(10^-6) 정수 BigInt로 반올림한다. 동률은 0에서 먼 쪽(half away from zero).
// 이 파일은 GAS 번들(build.mjs)로도 쓰이므로 최상위 이름이 다른 모듈과 겹치지 않아야 한다.
const DEC_SCALE = BigInt(10) ** BigInt(12);
const DEC_MICRO_DIV = BigInt(10) ** BigInt(6);
const DEC_DIGITS = 12;

function decRoundDiv(n, d) {                       // n/d 를 반올림(동률은 0에서 먼 쪽)
  if (d === BigInt(0)) throw new Error('0으로 나눌 수 없음');
  let q = n / d; const r = n % d;
  const twice = (r < BigInt(0) ? -r : r) * BigInt(2), ad = d < BigInt(0) ? -d : d;
  if (twice >= ad) q += (n < BigInt(0)) === (d < BigInt(0)) ? BigInt(1) : -BigInt(1);
  return q;
}
function dec(x) {
  if (typeof x === 'bigint') return x * DEC_SCALE;
  if (typeof x === 'number') { if (!Number.isFinite(x) || Math.abs(x) >= 1e15) throw new Error(`숫자 범위 오류: ${x}`); x = x.toFixed(DEC_DIGITS); }
  if (typeof x !== 'string') throw new Error('숫자 형식 오류');
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(x.trim());
  if (!m) throw new Error(`숫자 형식 오류: ${String(x).slice(0, 24)}`);
  const frac = (m[3] != null ? m[3] : '');
  if (frac.length > DEC_DIGITS) throw new Error(`소수 ${DEC_DIGITS}자리 초과: ${String(x).slice(0, 24)}`);
  const v = BigInt(m[2]) * DEC_SCALE + BigInt(frac.padEnd(DEC_DIGITS, '0'));
  return m[1] === '-' ? -v : v;
}
const decAdd = (a, b) => a + b;
const decSub = (a, b) => a - b;
const decNeg = a => -a;
const decAbs = a => (a < BigInt(0) ? -a : a);
const decMul = (a, b) => decRoundDiv(a * b, DEC_SCALE);
const decDiv = (a, b) => decRoundDiv(a * DEC_SCALE, b);
const decCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const decSign = a => (a < BigInt(0) ? -1 : a > BigInt(0) ? 1 : 0);
const decIsZero = a => a === BigInt(0);
const decToMicro = a => decRoundDiv(a, DEC_MICRO_DIV);        // 십진수 → 마이크로 정수(반올림)
const microToDec = m => m * DEC_MICRO_DIV;
function decFormat(a, dp = 6) {                                // 문자열 표시(반올림)
  if (dp < 0 || dp > DEC_DIGITS) throw new Error('자릿수 범위 오류');
  const neg = a < BigInt(0), unit = BigInt(10) ** BigInt(DEC_DIGITS - dp), v = decRoundDiv(neg ? -a : a, unit), p = BigInt(10) ** BigInt(dp);
  const s = `${v / p}${dp ? '.' + String(v % p).padStart(dp, '0') : ''}`;
  return neg && v !== BigInt(0) ? `-${s}` : s;
}
const microFormat = (m, dp = 6) => decFormat(microToDec(m), dp);
function microToNumber(m) {                                    // Sheets 등 배정밀도 저장용(안전 범위만)
  if (m > BigInt("9007199254740991") || m < -BigInt("9007199254740991")) throw new Error('안전 정수 범위 초과');
  return Number(m);
}
const microFromNumber = n => { if (!Number.isInteger(n)) throw new Error('마이크로 정수가 아님'); return BigInt(n); };

// ── time.mjs ──
// KST(UTC+9, 서머타임 없음) 거래일 계산. 일 경계는 매일 00:00 KST. 시스템 시간대·Date 지역 설정에 의존하지 않는 순수 산술.
const TIME_KST_OFFSET_MS = 9 * 3600000;
const TIME_DAY_MS = 86400000;
const isDayString = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dayStringValid(s);
function dayStringValid(s) { const [y, m, d] = s.split('-').map(Number); return m >= 1 && m <= 12 && d >= 1 && d <= timeDaysInMonth(y, m); }
function timeDaysInMonth(y, m) { return [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }
function timeCivilToDays(y, m, d) { y -= m <= 2 ? 1 : 0; const era = Math.floor(y / 400), yoe = y - era * 400, doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1, doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; return era * 146097 + doe - 719468; }
function timeDaysToCivil(z) { z += 719468; const era = Math.floor(z / 146097), doe = z - era * 146097, yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365), y = yoe + era * 400, doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)), mp = Math.floor((5 * doy + 2) / 153), d = doy - Math.floor((153 * mp + 2) / 5) + 1, m = mp + (mp < 10 ? 3 : -9); return [y + (m <= 2 ? 1 : 0), m, d]; }
function dayToIndex(day) { if (!isDayString(day)) throw new Error(`날짜 형식 오류: ${day}`); const [y, m, d] = day.split('-').map(Number); return timeCivilToDays(y, m, d); }
function indexToDay(i) { const [y, m, d] = timeDaysToCivil(i); return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
const kstDayOf = ms => indexToDay(Math.floor((ms + TIME_KST_OFFSET_MS) / TIME_DAY_MS));   // UTC ms → KST 날짜
const dayStartMs = day => dayToIndex(day) * TIME_DAY_MS - TIME_KST_OFFSET_MS;              // 해당 KST 날짜 00:00의 UTC ms
const dayEndMs = day => dayStartMs(day) + TIME_DAY_MS;                                      // 다음 날 00:00(배타적 끝)
const addDays = (day, n) => indexToDay(dayToIndex(day) + n);
const daysBetween = (a, b) => dayToIndex(b) - dayToIndex(a);
function dayRange(from, through) { const out = []; for (let i = dayToIndex(from), e = dayToIndex(through); i <= e; i++) out.push(indexToDay(i)); return out; }

// ── compound.mjs ──
// 복리 도전 목표 계산(정수·유리수 연산, 부동소수 없음).
//  · 당일 목표 마감 잔고 = 전일 *실제* 마감 잔고 × (1 + 목표율). 미달분을 다음 날 목표에 더하지 않는다(보정 없음).
//  · 이상 복리선 = 시작 자금 × Π(1 + 그날 목표율). 실제 성적과 무관하게 고정된 기준선이다.
//  · 모든 금액은 마이크로 USDT(BigInt). 목표율은 십진 문자열("0.05").

function rateFraction(rate) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(rate).trim());
  if (!m) throw new Error(`목표율 형식 오류: ${rate}`);
  const frac = (m[2] != null ? m[2] : ''), den = BigInt(10) ** BigInt(frac.length), num = BigInt(m[1] + frac);
  if (num > den) throw new Error('목표율은 0~100%');            // 0 이상 1 이하(100%)
  return { num, den };
}
function compoundNextTarget(prevCloseMicro, rate) {
  const { num, den } = rateFraction(rate);
  const targetCloseMicro = decRoundDiv(prevCloseMicro * (den + num), den);
  return { targetCloseMicro, targetProfitMicro: targetCloseMicro - prevCloseMicro };
}
// 목표율 일정: [{from:'YYYY-MM-DD', rate:'0.05'}] — from 이후 첫 일정부터 적용(과거 날짜는 과거 일정 그대로)
function compoundRateOn(day, schedule) {
  const di = dayToIndex(day); let cur = null, curIdx = -Infinity;
  for (const s of schedule) { const fi = dayToIndex(s.from); if (fi <= di && fi >= curIdx) { cur = s.rate; curIdx = fi; } }
  if (cur === null) throw new Error(`목표율 일정 없음: ${day}`);
  return cur;
}
// 이상선: startDay가 1일차(마감 목표 = 시작 × (1+g)^1). n=0은 시작 전 기준점(= 시작 자금).
function compoundIdealSeries({ startMicro, startDay, schedule, throughDay }) {
  const s = dayToIndex(startDay), e = dayToIndex(throughDay);
  if (e < s) return [{ day: indexToDay(s - 1), n: 0, idealMicro: startMicro }];
  const rows = [{ day: indexToDay(s - 1), n: 0, idealMicro: startMicro }];
  let numer = startMicro, denom = BigInt(1);
  for (let i = s; i <= e; i++) {
    const { num, den } = rateFraction(compoundRateOn(indexToDay(i), schedule));
    numer *= den + num; denom *= den;
    rows.push({ day: indexToDay(i), n: i - s + 1, idealMicro: decRoundDiv(numer, denom) });
  }
  return rows;
}

// ── dedupe.mjs ──
// 중복 기록 방지와 수정 이력(추가 전용). 같은 키의 동일 내용은 무시(재전송 안전), 다른 내용은 충돌로 거부한다. 삭제는 없고 취소는 void 리비전이다.
function dedupeCanonical(v) { return JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `${x}n` : x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x)); }
const dedupeSame = (a, b) => dedupeCanonical(a) === dedupeCanonical(b);
function dedupeAppend(list, rec, keyField) {
  const key = (rec == null ? undefined : rec[keyField]);
  if (key === undefined || key === null || key === '') throw new Error(`${keyField} 필요`);
  const prev = list.find(r => r[keyField] === key);
  if (!prev) return { list: [...list, rec], status: 'added' };
  return dedupeSame(prev, rec) ? { list, status: 'duplicate' } : { list, status: 'conflict' };
}
// 같은 포지션의 같은 종류·가격·수량 체결이 60초 안에 id만 다르게 들어온 경우 후보로 표시(자동 삭제하지 않음)
function dedupePossibleFills(fills, windowMs = 60000) {
  const out = [];
  for (let i = 0; i < fills.length; i++) for (let j = i + 1; j < fills.length; j++) {
    const a = fills[i], b = fills[j];
    if (a.fillId !== b.fillId && a.sid === b.sid && a.kind === b.kind && String(a.price) === String(b.price) && String(a.qty) === String(b.qty) && Math.abs(a.at - b.at) <= windowMs) out.push([a.fillId, b.fillId]);
  }
  return out;
}
// 리비전 로그: 같은 key의 변경은 rev를 올려 *추가*한다(이전 리비전 보존). latest()가 현재 값.
function dedupeRevise(log, key, patch, meta = {}) {
  const prev = dedupeLatest(log).get(key);
  if (!prev) throw new Error(`수정 대상 없음: ${key}`);
  if (prev.void) throw new Error(`취소된 기록은 수정할 수 없음: ${key}`);
  return [...log, { ...prev, ...patch, key, rev: prev.rev + 1, prevRev: prev.rev, at: (meta.at != null ? meta.at : null), reason: (meta.reason != null ? meta.reason : null) }];
}
const dedupeVoid = (log, key, meta = {}) => dedupeRevise(log, key, { void: true }, meta);
function dedupeLatest(log) { const m = new Map(); for (const r of log) { const p = m.get(r.key); if (!p || r.rev > p.rev) m.set(r.key, r); } return m; }

// ── pnl.mjs ──
// 실제 매매 손익 계산(LONG/SHORT, 부분청산·추가 진입, 수수료·펀딩 3상태). 모의매매(origin≠real)는 거부한다 — 모의와 실제는 섞지 않는다.
//  · 평균 진입가는 체결 순서의 가중평균(원가 합계 방식). 원가는 가격×수량을 *반올림 없이* 24자리(10^-24)로 누적하고, 청산 시 비례 원가를 제거해 실현손익을 정확히 계산한 뒤 체결마다 마이크로 USDT로 *한 번만* 반올림한다(검토 결과: 중간 12자리 반올림은 드물게 1마이크로 어긋남).
//  · 수수료(fee): 양수 비용. 펀딩(funding): 부호 있는 현금흐름(+받음 −지급). 상태: entered(실제 입력) / estimated(추정, 별도 집계) / missing(미입력, 합계 제외 + 경고).
//  · 순손익(net) = 총손익 − 수수료 + 펀딩. 기본값(netEntered)은 *실제 입력된 값만* 반영하고, 추정치를 더한 값은 netWithEstimates로 따로 낸다.

const PNL_ENTRY_KINDS = ['opening', 'entry', 'add'];
const PNL_EXIT_KINDS = ['reduce', 'close'];
const PNL_STATES = ['entered', 'estimated', 'missing'];
const PNL_E24_TO_MICRO = BigInt(10) ** BigInt(18);                    // 10^-24 단위 → 마이크로(10^-6) 변환 나눗수

function pnlNormalizeAmount(a, name, nonNegative) {
  const state = ((a == null ? undefined : a.state) != null ? (a == null ? undefined : a.state) : 'missing');
  if (!PNL_STATES.includes(state)) throw new Error(`${name} 상태 오류: ${state}`);
  if (state === 'missing') return { state, micro: BigInt(0) };
  if (a.amount === undefined || a.amount === null || a.amount === '') throw new Error(`${name} 금액 필요(상태 ${state})`);
  const micro = decToMicro(dec(a.amount));
  if (nonNegative && micro < BigInt(0)) throw new Error(`${name}은 0 이상이어야 함`);
  return { state, micro };
}
function pnlNormalizeFill(f) {
  if (!f || typeof f !== 'object') throw new Error('체결 형식 오류');
  if (f.origin !== 'real') throw new Error(`실제 체결만 허용(origin=real): ${f.origin}`);
  if (typeof f.fillId !== 'string' || !f.fillId || typeof f.sid !== 'string' || !f.sid) throw new Error('fillId·sid 필요');
  if (![...PNL_ENTRY_KINDS, ...PNL_EXIT_KINDS].includes(f.kind)) throw new Error(`체결 종류 오류: ${f.kind}`);
  if (f.dir !== 'LONG' && f.dir !== 'SHORT') throw new Error('방향 오류');
  if (!Number.isFinite(f.at)) throw new Error('체결 시각 오류');
  const price = dec(f.price), qty = dec(f.qty);
  if (decSign(price) <= 0 || decSign(qty) <= 0) throw new Error('가격·수량은 0보다 커야 함');
  return { fillId: f.fillId, sid: f.sid, kind: f.kind, dir: f.dir, at: f.at, price, qty,
    margin: f.margin === undefined || f.margin === null ? null : dec(f.margin), leverage: f.leverage === undefined || f.leverage === null ? null : dec(f.leverage),
    fee: pnlNormalizeAmount(f.fee, '수수료', true), funding: pnlNormalizeAmount(f.funding, '펀딩', false) };
}

// 한 포지션(sid)의 체결 목록 → 손익. cutoffMs가 있으면 그 시각 이전(<) 체결만 사용한다.
function pnlComputeTrade(fillsIn, { cutoffMs = Infinity } = {}) {
  const fills = fillsIn.map(pnlNormalizeFill).filter(f => f.at < cutoffMs).map((f, i) => ({ f, i })).sort((a, b) => a.f.at - b.f.at || a.i - b.i).map(x => x.f);
  if (!fills.length) return null;
  const sid = fills[0].sid, dir = fills[0].dir, sign = dir === 'LONG' ? BigInt(1) : -BigInt(1);
  let qty = BigInt(0), cost = BigInt(0), marginMicro = BigInt(0), marginAll = true, first = true;
  const events = [], flags = new Set(), seen = new Set();
  for (const f of fills) {
    if (f.sid !== sid) throw new Error('한 번에 하나의 sid만 계산');
    if (f.dir !== dir) throw new Error(`방향이 일치하지 않음: ${f.fillId}`);
    if (seen.has(f.fillId)) throw new Error(`중복 fillId: ${f.fillId}`); seen.add(f.fillId);
    if (first && !['entry', 'opening'].includes(f.kind)) throw new Error('첫 체결은 entry 또는 opening이어야 함');
    if (!first && f.kind === 'entry') throw new Error('추가 진입은 kind=add');
    if (!first && f.kind === 'opening') throw new Error('opening은 첫 체결만');
    first = false;
    let grossMicro = BigInt(0);
    if (PNL_ENTRY_KINDS.includes(f.kind)) {
      qty = decAdd(qty, f.qty); cost += f.price * f.qty;                                     // 원가: 반올림 없는 10^-24 단위
      if (f.kind !== 'opening') { if (f.margin === null) marginAll = false; else marginMicro += decToMicro(f.margin); }
    } else {
      if (f.qty > qty) throw new Error(`청산 수량(${decFormat(f.qty, 8)})이 보유 수량(${decFormat(qty, 8)})보다 큼: ${f.fillId}`);
      if (f.kind === 'close' && f.qty !== qty) throw new Error(`close는 잔량 전체여야 함: ${f.fillId}`);
      const removed = f.qty === qty ? cost : decRoundDiv(cost * f.qty, qty), proceeds = f.price * f.qty;   // 비례 원가(10^-24 단위, 오차 < 1e-24)
      grossMicro = decRoundDiv(sign === BigInt(1) ? proceeds - removed : removed - proceeds, PNL_E24_TO_MICRO);
      qty = decSub(qty, f.qty); cost = decSub(cost, removed);
    }
    events.push({ fillId: f.fillId, at: f.at, day: kstDayOf(f.at), kind: f.kind, grossMicro, feeMicro: f.fee.micro, feeState: f.fee.state, fundingMicro: f.funding.micro, fundingState: f.funding.state, qtyAfter: qty });
  }
  const t = { grossMicro: BigInt(0), feeEnteredMicro: BigInt(0), feeEstimatedMicro: BigInt(0), feeMissingCount: 0, fundingEnteredMicro: BigInt(0), fundingEstimatedMicro: BigInt(0), fundingMissingCount: 0 };
  for (const e of events) {
    t.grossMicro += e.grossMicro;
    if (e.feeState === 'entered') t.feeEnteredMicro += e.feeMicro; else if (e.feeState === 'estimated') t.feeEstimatedMicro += e.feeMicro; else t.feeMissingCount++;
    if (e.fundingState === 'entered') t.fundingEnteredMicro += e.fundingMicro; else if (e.fundingState === 'estimated') t.fundingEstimatedMicro += e.fundingMicro; else t.fundingMissingCount++;
  }
  t.netEnteredMicro = t.grossMicro - t.feeEnteredMicro + t.fundingEnteredMicro;
  t.netWithEstimatesMicro = t.netEnteredMicro - t.feeEstimatedMicro + t.fundingEstimatedMicro;
  if (t.feeMissingCount) flags.add('fee-missing'); if (t.fundingMissingCount) flags.add('funding-missing');
  if (t.feeEstimatedMicro || events.some(e => e.feeState === 'estimated')) flags.add('fee-estimated');
  if (events.some(e => e.fundingState === 'estimated')) flags.add('funding-estimated');
  const status = qty === BigInt(0) ? 'closed' : 'open';
  const margin = marginAll && marginMicro > BigInt(0) ? marginMicro : null;
  return { sid, dir, status, openQty: decFormat(qty, 12), openQtyDec: qty, avgEntry: qty > BigInt(0) ? decFormat(decRoundDiv(cost, qty), 10) : null, costE24: cost, marginMicro: margin,
    roePpm: margin && status === 'closed' ? decRoundDiv(t.netEnteredMicro * BigInt(1000000), margin) : null, totals: t, events, flags: [...flags] };
}
// 여러 sid의 체결 → 포지션 맵
function pnlComputeAll(fills, opts) {
  const by = new Map(); for (const f of fills) { if (!by.has(f.sid)) by.set(f.sid, []); by.get(f.sid).push(f); }
  const out = new Map(); for (const [sid, list] of by) { const t = pnlComputeTrade(list, opts); if (t) out.set(sid, t); } return out;
}
// 날짜(KST)별 흐름 합계: 체결 시각 기준으로 실현손익·수수료·펀딩을 귀속
function pnlDailyFlows(trades) {
  const days = new Map();
  for (const t of trades.values()) for (const e of t.events) {
    const d = nullishOr(days.get(e.day), { grossMicro: BigInt(0), feeEnteredMicro: BigInt(0), feeEstimatedMicro: BigInt(0), fundingEnteredMicro: BigInt(0), fundingEstimatedMicro: BigInt(0), netEnteredMicro: BigInt(0) });
    d.grossMicro += e.grossMicro;
    if (e.feeState === 'entered') d.feeEnteredMicro += e.feeMicro; else if (e.feeState === 'estimated') d.feeEstimatedMicro += e.feeMicro;
    if (e.fundingState === 'entered') d.fundingEnteredMicro += e.fundingMicro; else if (e.fundingState === 'estimated') d.fundingEstimatedMicro += e.fundingMicro;
    d.netEnteredMicro = d.grossMicro - d.feeEnteredMicro + d.fundingEnteredMicro; days.set(e.day, d);
  }
  return days;
}
const pnlMicroToString = (m, dp = 6) => decFormat(microToDec(m), dp);

// ── risk.mjs ──
// 거래당 위험·청산 위험 표시(경고용 근사). 차단하지 않고 값과 경고만 낸다. 거래소별 유지증거금·수수료 구조가 달라 청산가는 *근사*다.

function riskTrade({ dir, entry, stop, qty, margin, leverage, equityMicro, mmr = '0.005' }) {
  if (dir !== 'LONG' && dir !== 'SHORT') throw new Error('방향 오류');
  const e = dec(entry), s = dec(stop), q = dec(qty), lev = dec(leverage), m = margin === undefined || margin === null ? null : dec(margin), r = dec(mmr), one = dec(1);
  if (decSign(e) <= 0 || decSign(q) <= 0 || decSign(lev) <= 0) throw new Error('진입가·수량·레버리지는 0보다 커야 함');
  const sign = dir === 'LONG' ? 1 : -1, dist = decMul(decSub(e, s), dec(sign));      // 손절까지 불리한 거리(양수여야 정상)
  const flags = [];
  if (decSign(dist) <= 0) flags.push('stop-on-wrong-side');
  const notional = decMul(e, q), lossMicro = decToMicro(decMul(decAbs(decSub(e, s)), q));
  const impliedLev = m && decSign(m) > 0 ? decDiv(notional, m) : null;
  if (impliedLev !== null && decAbs(decSub(impliedLev, lev)) * BigInt(20) > lev) flags.push('leverage-mismatch');           // 증거금·수량으로 계산한 레버리지가 입력과 5% 넘게 다름
  const liq = dir === 'LONG' ? decMul(e, decAdd(decSub(one, decDiv(one, lev)), r)) : decMul(e, decSub(decAdd(one, decDiv(one, lev)), r));   // 격리 마진 근사
  const liqBeforeStop = dir === 'LONG' ? liq >= s : liq <= s;
  if (liqBeforeStop && decSign(dist) > 0) flags.push('liquidation-before-stop');
  let riskPpm = null;
  if (equityMicro !== undefined && equityMicro !== null && equityMicro > BigInt(0)) { riskPpm = decRoundDiv(lossMicro * BigInt(1000000), equityMicro); if (riskPpm > BigInt(20000)) flags.push('risk-over-2pct'); }
  return { notionalMicro: decToMicro(notional), impliedLeverage: impliedLev === null ? null : decFormat(impliedLev, 4), stopLossMicro: lossMicro, riskPpmOfEquity: riskPpm,
    liquidationApprox: decFormat(liq, 8), liquidationIsApproximate: true, liquidationBeforeStop: liqBeforeStop && decSign(dist) > 0, flags };
}
const riskMicroLabel = m => decFormat(microToDec(m), 2);

// ── scaleplan.mjs ──
// 안전 중심 분할 진입·분할 익절 계획(순수 함수, 의존성·네트워크·주문 없음). 주문이 아니라 *계산*이다 — 실제 주문은 사용자가 거래소에서 직접 한다.
// 이 파일은 radar-service/signal/scale.mjs 와 rich300/lib/scaleplan.mjs 에 *바이트 단위로 같은 내용*으로 존재한다(테스트가 동기화를 확인).
// 모든 이름은 splan/SPLAN 접두사: RICH300 Apps Script 번들(한 파일)에서 다른 모듈과 이름이 겹치지 않게 한다. import/export default/export { } 를 쓰지 않는다.
//
// 용어: R = |1차 진입가 − 손절가|(계획 1R). 손절가는 계획 전체에서 고정(이동·확대 금지). 방향 dir 은 'LONG' | 'SHORT'.
// 규칙(기본값 SPLAN):
//  · 진입 3분할 50/30/20. 2·3차 가격은 1차 진입가에서 손절 쪽으로 0.3R·0.6R 떨어진 *사전 지정 가격*의 지정가. 확인 조건을 모두 만족할 때만 허용(splanAddRules).
//    손절선(1R) 안에서만, TP 체결 전에만, 단계 순서대로만, 계획 수량 안에서만. 손실을 만회하려는 무계획 추가(물타기)는 금지 — 어긋나면 splanCheckAdd 가 거부한다.
//  · 익절 TP1 1.5R 50% · TP2 2R 30% · 잔여 20% 는 추적 손절(TP2 이후 최고가−1R, 단 본전 아래로 내리지 않음). TP1 체결 후 손절은 평균 진입가(본전)로 올린다.
//  · 수량: 계좌 평가액의 0.5%(riskPct) 를 거래당 계획 손실 한도로 삼아, 3단계가 모두 체결된 뒤 손절되는 *최악의 경우*(수수료·슬리피지 포함)가 한도를 넘지 않도록 계산한다.
//    수량은 거래소 최소 단위로 *내림*한다(반올림해서 한도를 넘는 일이 없다). 내림 후 최악 손실을 다시 계산해 확인한다.
//  · 격리 3배 기본, 청산가가 손절선보다 충분히 멀지 않으면 2배, 그래도 안 되면 거래 제외. 총 증거금은 평가액의 maxMarginUsage 를 넘지 않는다(초과하면 수량을 줄이고, 계획의 minSizeRatio 미만이면 제외).
//  · 소액이라 단계별 수량이 최소 주문 단위에 못 미치면 3→2→1 단계로 줄인다(degraded 표시). 그래도 안 되면 제외.
//  · 비용: 수수료 편도 feeBps(양쪽 체결), 진입 슬리피지 entrySlipBps(불리한 방향), 손절 슬리피지 stopSlipBps. 펀딩비는 계획에 포함하지 않는다(보유 시간에 따라 달라짐).

const SPLAN_NOTE = '계획은 참고용 계산이며 주문이 아닙니다';
const SPLAN = Object.freeze({
  weights: Object.freeze([0.5, 0.3, 0.2]), addR: Object.freeze([0.3, 0.6]), tp: Object.freeze([Object.freeze({ r: 1.5, w: 0.5 }), Object.freeze({ r: 2, w: 0.3 })]), trailR: 1, beAfterTp1: true,
  riskPct: 0.005, feeBps: 5, entrySlipBps: 5, stopSlipBps: 10, levs: Object.freeze([3, 2]), mmr: 0.005, liqBuffer: 0.6,
  maxMarginUsage: 0.3, minSizeRatio: 0.4, maxCostShareOfR: 0.35, structureR: 0.25, addWindowBars: 16, addPriceTolR: 0.15,
});

const splanSign = dir => (dir === 'LONG' ? 1 : -1);
const splanDecimals = step => { const t = String(step); return t.includes('.') ? t.split('.')[1].length : 0; };
const splanFloor = (x, step) => Number((Math.floor(x / step) * step).toFixed(splanDecimals(step)));      // 내림(부동소수 오차로 한 단위 모자라는 쪽으로만 틀린다 = 안전한 쪽)
const splanFloorTol = (x, step) => Number((Math.floor(x / step + 1e-9) * step).toFixed(splanDecimals(step)));   // TP 배분용: 0.7×0.5/0.001 같은 부동소수 경계에서 한 단위 모자라지 않게(진입 수량에는 쓰지 않음)
const splanRound = (x, dec) => Number(x.toFixed(dec));
const splanMean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// 거래소 주문 규격의 *참고 기본값*. 실제 규격은 거래소 화면에서 확인해야 한다(틀리면 거래소가 주문을 거절하므로 안전한 쪽으로만 영향).
const SPLAN_SPECS = Object.freeze({
  BTC: { step: 0.001, minQty: 0.001, minNotional: 100 }, ETH: { step: 0.001, minQty: 0.001, minNotional: 20 }, BNB: { step: 0.01, minQty: 0.01, minNotional: 5 }, SOL: { step: 1, minQty: 1, minNotional: 5 },
  XRP: { step: 0.1, minQty: 0.1, minNotional: 5 }, DOGE: { step: 1, minQty: 1, minNotional: 5 }, ADA: { step: 1, minQty: 1, minNotional: 5 }, AVAX: { step: 1, minQty: 1, minNotional: 5 }, LINK: { step: 0.01, minQty: 0.01, minNotional: 5 },
});
function splanSpec(symbol, price) {
  const base = String(symbol || '').replace(/USDT$/, '').toUpperCase();
  if (SPLAN_SPECS[base]) return { ...SPLAN_SPECS[base], source: 'table' };
  const p = Number(price), step = p >= 1000 ? 0.001 : p >= 100 ? 0.01 : p >= 10 ? 0.1 : 1;
  return { step, minQty: step, minNotional: 5, source: 'price-tier' };
}

// 단계 가중치(활성 단계 수 n 에 맞춰 정규화): n=3 → 0.5/0.3/0.2, n=2 → 0.625/0.375, n=1 → 1
const splanWeights = (p, n) => { const w = p.weights.slice(0, n), s = w.reduce((a, b) => a + b, 0); return w.map(x => x / s); };

// 단계별 *계획 체결가*(슬리피지 반영 전) — 1차는 entry, 2·3차는 손절 쪽으로 addR×R. 표시 자릿수(dp)로 반올림.
function splanStagePrices(dir, entry, stop, p, n, dp) {
  const s = splanSign(dir), R = (entry - stop) * s, out = [splanRound(entry, dp)];
  for (let k = 1; k < n; k++) out.push(splanRound(entry - s * p.addR[k - 1] * R, dp));
  return out;
}
const splanExec = (dir, price, bps) => price * (1 + splanSign(dir) * bps / 10000);                 // 진입 체결가(불리한 방향 슬리피지)
const splanStopExec = (dir, stop, bps) => stop * (1 - splanSign(dir) * bps / 10000);               // 손절 체결가(불리한 방향 슬리피지)

// 수량 배열(qtys[i])로 3단계가 모두 체결된 뒤 손절되는 최악의 손실(수수료·슬리피지 포함, 계좌 통화 단위). prices 는 계획 체결가.
function splanWorstLoss(dir, prices, qtys, stop, p) {
  const s = splanSign(dir), x = splanStopExec(dir, stop, p.stopSlipBps), f = p.feeBps / 10000;
  let loss = 0, fee = 0, slip = 0;
  for (let i = 0; i < qtys.length; i++) {
    const e = splanExec(dir, prices[i], p.entrySlipBps), q = qtys[i];
    loss += (e - x) * s * q + f * (e + x) * q;
    fee += f * (e + x) * q; slip += (e - prices[i]) * s * q + (stop - x) * s * q;
  }
  return { loss, fee, slip };
}

// 계획 만들기. input: { symbol, dir, entry, stop, equity, spec?, lev?, params? }. 반환 plan.status === 'ok' | 'excluded'.
function splanBuild(input) {
  const p = { ...SPLAN, ...(input.params || {}) }, dir = input.dir, symbol = input.symbol, E1 = Number(input.entry), S = Number(input.stop), equity = Number(input.equity);
  const exclude = (reason, extra) => ({ status: 'excluded', reason, note: SPLAN_NOTE, symbol, dir, entry: E1, stop: S, equity, ...(extra || {}) });
  if ((dir !== 'LONG' && dir !== 'SHORT') || !(E1 > 0) || !(S > 0)) return exclude('bad-input');
  if (!(equity > 0)) return exclude('no-equity');
  const sg = splanSign(dir), R = (E1 - S) * sg;
  if (!(R > 0)) return exclude('stop-on-wrong-side');
  const dp = Math.max(splanDecimals(String(E1)), splanDecimals(String(S)), 2), spec = input.spec || splanSpec(symbol, E1);
  const budget = equity * p.riskPct, costPerUnit = (p.feeBps / 10000) * (E1 + S) + E1 * p.entrySlipBps / 10000 + S * p.stopSlipBps / 10000;
  if (costPerUnit > p.maxCostShareOfR * R) return exclude('cost-heavy', { R, costShareOfR: costPerUnit / R });          // 손절폭 대비 비용이 너무 크면(손절이 너무 가까움) 계획 불가
  const levs = input.lev ? [input.lev] : p.levs, tried = [];
  for (const lev of levs) {
    for (let n = Math.min(3, p.maxStages || 3, p.weights.length); n >= 1; n--) {
      const r = splanTry(p, { dir, symbol, E1, S, R, dp, equity, budget, spec, lev, n });
      tried.push({ lev, n, ok: r.ok, reason: r.reason });
      if (r.ok) return { ...r.plan, degraded: n < Math.min(3, p.maxStages || 3, p.weights.length) ? `${Math.min(3, p.maxStages || 3, p.weights.length)}→${n}` : null, tried };
      if (r.reason === 'liq-buffer') break;                                                                       // 이 배율은 청산 여유가 부족: 단계 수를 줄여도 소용없으니 다음 배율로
    }
  }
  const last = tried.filter(t => t.reason);
  const pick = ['liq-buffer', 'margin-cap', 'min-size'].find(k => last.some(t => t.reason === k)) || 'size-too-small';
  return exclude(pick, { tried });
}

function splanTry(p, c) {
  const { dir, symbol, E1, S, R, dp, equity, budget, spec, lev, n } = c, sg = splanSign(dir), w = splanWeights(p, n), prices = splanStagePrices(dir, E1, S, p, n, dp);
  // 청산 여유: 단계별 누적 평균가 기준으로 손절 거리가 (격리 청산 거리 × liqBuffer) 이내여야 한다.
  const x = splanStopExec(dir, S, p.stopSlipBps), f = p.feeBps / 10000;
  let liqWorst = 0, cum = 0, cumQ = 0;
  for (let i = 0; i < n; i++) { const e = splanExec(dir, prices[i], p.entrySlipBps); cum += e * w[i]; cumQ += w[i]; const avg = cum / cumQ, liqDist = avg * (1 / lev - p.mmr - f), stopDist = (avg - x) * sg; liqWorst = Math.max(liqWorst, stopDist / liqDist); }
  if (!(liqWorst <= p.liqBuffer)) return { ok: false, reason: 'liq-buffer' };
  const unit = splanWorstLoss(dir, prices, w, S, p).loss;                                                         // 총수량 1 당 최악 손실
  if (!(unit > 0)) return { ok: false, reason: 'bad-input' };
  const qRisk = budget / unit, mUnit = w.reduce((a, wi, i) => a + wi * splanExec(dir, prices[i], p.entrySlipBps), 0) / lev, qCap = p.maxMarginUsage * equity / mUnit;
  const q = Math.min(qRisk, qCap);
  if (q < qRisk * p.minSizeRatio) return { ok: false, reason: 'margin-cap' };
  const qtys = w.map(wi => splanFloor(q * wi, spec.step));                                                        // 내림
  for (let i = 0; i < n; i++) if (!(qtys[i] >= spec.minQty) || qtys[i] * prices[i] < spec.minNotional) return { ok: false, reason: 'min-size' };
  const total = qtys.reduce((a, b) => a + b, 0), worst = splanWorstLoss(dir, prices, qtys, S, p);
  if (worst.loss > budget) return { ok: false, reason: 'internal-risk' };                                         // 이론상 발생하지 않음(내림이므로). 방어용
  const stages = qtys.map((qty, i) => {
    const e = splanExec(dir, prices[i], p.entrySlipBps), margin = e * qty / lev, lossIfStop = (e - x) * sg * qty + f * (e + x) * qty;
    return { n: i + 1, weight: splanRound(qtys[i] / total, 4), price: prices[i], execPrice: e, qty, margin, lossIfStop };
  });
  const totalMargin = stages.reduce((a, s) => a + s.margin, 0), avgE = stages.reduce((a, s) => a + s.execPrice * s.qty, 0) / total, liqDist = avgE * (1 / lev - p.mmr - f);
  const tps = p.tp.map((t, i) => ({ n: i + 1, r: t.r, w: t.w, price: splanRound(E1 + sg * t.r * R, dp) }));
  return { ok: true, plan: {
    status: 'ok', note: SPLAN_NOTE, symbol, dir, entry: E1, stop: S, R, riskPct: R / E1, equity, lev, spec, params: { riskPct: p.riskPct, feeBps: p.feeBps, entrySlipBps: p.entrySlipBps, stopSlipBps: p.stopSlipBps, maxMarginUsage: p.maxMarginUsage, addR: p.addR.slice(0, n - 1), trailR: p.trailR, beAfterTp1: p.beAfterTp1 },
    stagesCount: n, stages, tps, runnerWeight: splanRound(1 - p.tp.reduce((a, t) => a + t.w, 0), 4), totalQty: total, riskBudget: budget, worstLoss: worst.loss, worstLossPct: worst.loss / equity, worstFee: worst.fee, worstSlip: worst.slip,
    totalMargin, marginUsage: totalMargin / equity, minAvailable: equity - totalMargin, equityAfterWorst: equity - worst.loss, liqPrice: dir === 'LONG' ? avgE - liqDist : avgE + liqDist, liqRatio: liqWorst,
    add: { window: p.addWindowBars, structurePrice: splanRound(S + sg * p.structureR * R, dp), tolR: p.addPriceTolR },
  } };
}

// TP 수량 배분: 열린 수량(open)을 TP1 50% · TP2 30% · 잔여로 내림 배분. 최소 주문 단위보다 작은 구간은 다음 구간에 합친다(TP1→TP2→잔여).
function splanTpLegs(plan, openQty) {
  const step = plan.spec.step, minQ = plan.spec.minQty, legs = plan.tps.map(t => ({ n: t.n, r: t.r, price: t.price, w: t.w, qty: splanFloorTol(openQty * t.w, step) }));
  let used = legs.reduce((a, l) => a + l.qty, 0), runner = Number((openQty - used).toFixed(splanDecimals(step)));
  for (let i = 0; i < legs.length; i++) if (legs[i].qty < minQ) { const carry = legs[i].qty; legs[i].qty = 0; legs[i].merged = true; if (i + 1 < legs.length) legs[i + 1].qty = Number((legs[i + 1].qty + carry).toFixed(splanDecimals(step))); else runner = Number((runner + carry).toFixed(splanDecimals(step))); }
  return { legs, runner: Math.max(0, runner), openQty };
}

// 체결 기록(fills: [{ kind:'entry'|'add'|'reduce'|'close', price, qty, at }])로 현재 상태를 계산한다. ctx(선택): { lastClose, lastHigh, lastLow, barsSinceSignal }.
function splanStatus(plan, fillsIn, ctx) {
  const c = ctx || {}, fills = [...fillsIn].sort((a, b) => a.at - b.at), sg = splanSign(plan.dir), step = plan.spec.step, warnings = [];
  const stages = plan.stages.map(s => ({ n: s.n, price: s.price, plannedQty: s.qty, filled: 0 }));
  let idx = 0, entered = 0, cost = 0, reduced = 0;
  for (const f of fills) {
    if (f.kind === 'entry' || f.kind === 'add') {
      let rest = f.qty; entered += f.qty; cost += f.qty * f.price;
      while (rest > step / 2 && idx < stages.length) { const room = stages[idx].plannedQty - stages[idx].filled, take = Math.min(room, rest); stages[idx].filled += take; rest -= take; if (stages[idx].filled >= stages[idx].plannedQty - step / 2) idx++; }
      if (rest > step / 2) warnings.push('over-plan-qty');
    } else if (f.kind === 'reduce' || f.kind === 'close') reduced += f.qty;
  }
  const open = Number((entered - reduced).toFixed(splanDecimals(step))), avgEntry = entered > 0 ? cost / entered : null;
  const eps = step / 2, legsTotal = splanTpLegs(plan, entered), cum1 = legsTotal.legs[0].qty, cum2 = cum1 + legsTotal.legs[1].qty;
  const tp2Done = reduced > eps && cum2 > 0 && reduced >= cum2 - eps, tp1Done = reduced > eps && (cum1 > 0 ? reduced >= cum1 - eps : tp2Done);          // 최소 단위 미만 구간은 다음 구간에 합쳐져 있다
  let stopPrice = plan.stop, stopKind = 'initial';
  if (tp1Done && plan.params.beAfterTp1 && avgEntry !== null) { stopPrice = avgEntry; stopKind = 'breakeven'; }
  if (tp2Done && Number.isFinite(c.lastHigh) && avgEntry !== null) {                                                // 추적 손절: TP2 이후 최고가−trailR×R, 본전 아래로는 내리지 않음
    const ext = plan.dir === 'LONG' ? c.lastHigh : c.lastLow, trail = ext - sg * plan.params.trailR * plan.R;
    if (Number.isFinite(ext)) { stopPrice = sg > 0 ? Math.max(avgEntry, trail) : Math.min(avgEntry, trail); stopKind = 'trailing'; }
  }
  const stopHit = open <= 0 && entered > 0;
  const pending = stages.filter(s => s.filled < s.plannedQty - step / 2 && s.n > 1).map(s => {
    const rem = Number((s.plannedQty - s.filled).toFixed(splanDecimals(step)));
    let state = 'working';
    if (entered === 0) state = 'waiting-first'; else if (tp1Done || reduced > 0) state = 'cancel-after-tp'; else if (stopHit) state = 'cancel-closed';
    else if (Number.isFinite(c.lastClose) && (c.lastClose - plan.add.structurePrice) * sg <= 0) state = 'cancel-structure';
    else if (Number.isFinite(c.barsSinceSignal) && c.barsSinceSignal > plan.add.window) state = 'cancel-window';
    return { n: s.n, price: s.price, remainingQty: rem, partiallyFilled: s.filled > 0, state };
  });
  const sx = splanStopExec(plan.dir, stopPrice, plan.params.stopSlipBps), f = plan.params.feeBps / 10000;
  const lossNow = open > 0 && avgEntry !== null ? ((avgEntry - sx) * sg + f * (avgEntry + sx)) * open : 0;                       // 지금 포지션이 현재 손절선에서 청산될 때 손실(음수면 이익 잠금)
  const workable = pending.filter(s => s.state === 'working');
  let potential = lossNow;
  if (workable.length && open > 0) potential = ((avgEntry * open + workable.reduce((a, s) => a + s.price * s.remainingQty, 0)) / (open + workable.reduce((a, s) => a + s.remainingQty, 0)) - sx) * sg * (open + workable.reduce((a, s) => a + s.remainingQty, 0)) + f * (open + workable.reduce((a, s) => a + s.remainingQty, 0)) * (avgEntry + sx);
  if (lossNow > plan.riskBudget * 1.0000001) warnings.push('risk-over-budget');
  const shown = entered > 0 ? legsTotal : splanTpLegs(plan, plan.totalQty);
  return { stages, entered, reduced, openQty: open, avgEntry, stopQty: open, stopPrice, stopKind, tp1Done, tp2Done, pending, lossNow, worstIfPendingFill: potential, riskBudget: plan.riskBudget, legs: shown.legs.map(l => ({ n: l.n, price: l.price, qty: l.qty, done: l.n === 1 ? tp1Done : tp2Done })), runnerQty: shown.runner, warnings, closed: stopHit };
}

// 추가 진입 규칙(문서화된 사전 조건). 사용자 입력 add:{price, qty} 를 계획·체결 상태와 대조한다. 반환 { ok, reasons:[코드…] }.
function splanCheckAdd(plan, fills, add, ctx) {
  const reasons = [], c = ctx || {};
  if (!plan || plan.status !== 'ok') return { ok: false, reasons: ['no-plan'] };
  const st = splanStatus(plan, fills, c), sg = splanSign(plan.dir), tol = plan.add.tolR * plan.R;
  if (st.entered === 0) reasons.push('first-entry-missing');                                                         // 1차 없이 2·3차 금지
  if (st.closed) reasons.push('position-closed');
  if (st.reduced > 0 || st.tp1Done) reasons.push('after-take-profit');                                              // TP 체결 후에는 추가 진입 금지
  const next = st.stages.find(s => s.n > 1 && s.filled < s.plannedQty - plan.spec.step / 2);
  if (!next) reasons.push('no-stage-left');
  else {
    const prev = st.stages[next.n - 2]; if (prev.filled < prev.plannedQty * 0.5) reasons.push('previous-stage-unfilled');
    if (Math.abs(add.price - next.price) > tol) reasons.push((add.price - next.price) * sg < 0 ? 'price-deeper-than-plan' : 'price-not-at-plan-level');   // 사전 지정 가격 밖(더 깊은 물타기 포함)
    if (add.qty > (next.plannedQty - next.filled) + plan.spec.step / 2) reasons.push('qty-over-plan');
  }
  if ((add.price - plan.stop) * sg <= 0) reasons.push('beyond-stop');
  if (Number.isFinite(c.lastClose) && (c.lastClose - plan.add.structurePrice) * sg <= 0) reasons.push('structure-broken');
  if (Number.isFinite(c.barsSinceSignal) && c.barsSinceSignal > plan.add.window) reasons.push('window-passed');
  if (!reasons.length) {                                                                                             // 추가 후 최악 손실이 한도 이하인가
    const q = st.openQty + add.qty, avg = (st.avgEntry * st.openQty + add.price * add.qty) / q, sx = splanStopExec(plan.dir, plan.stop, plan.params.stopSlipBps), f = plan.params.feeBps / 10000;
    const worst = ((avg * (1 + sg * plan.params.entrySlipBps / 10000) - sx) * sg + f * (avg + sx)) * q;
    if (worst > plan.riskBudget * 1.0000001) reasons.push('risk-over-budget');
  }
  return { ok: reasons.length === 0, reasons };
}
const SPLAN_REASON_TEXT = Object.freeze({
  'over-plan-qty': '계획보다 많은 수량이 체결됐습니다', 'no-plan': '이 신호에는 분할 계획이 없습니다', 'first-entry-missing': '1차 진입이 먼저 기록돼야 합니다', 'position-closed': '이미 청산된 포지션입니다', 'after-take-profit': '익절이 시작된 뒤에는 추가 진입을 하지 않습니다', 'no-stage-left': '계획된 추가 진입 단계가 남아 있지 않습니다',
  'previous-stage-unfilled': '이전 단계가 아직 충분히 체결되지 않았습니다', 'price-deeper-than-plan': '계획 가격보다 더 깊은 가격입니다(손실 만회용 추가 진입 금지)', 'price-not-at-plan-level': '사전에 정한 추가 진입 가격이 아닙니다', 'qty-over-plan': '계획 수량을 넘습니다',
  'beyond-stop': '손절선을 넘은 가격입니다', 'structure-broken': '구조 유지 조건(직전 15분봉 종가)을 만족하지 않습니다', 'window-passed': '추가 진입 허용 시간이 지났습니다', 'risk-over-budget': '추가하면 최악 손실이 계획 한도를 넘습니다',
  'bad-input': '입력값이 올바르지 않습니다', 'no-equity': '계좌 평가액이 없습니다', 'stop-on-wrong-side': '손절가가 방향과 반대쪽입니다', 'cost-heavy': '손절폭 대비 수수료·슬리피지가 너무 큽니다', 'liq-buffer': '청산가가 손절선에 비해 충분히 멀지 않습니다(2배도 불충분)',
  'margin-cap': '증거금 사용률 한도 때문에 계획 수량을 확보할 수 없습니다', 'min-size': '최소 주문 수량·금액에 못 미칩니다(계좌 대비 너무 작은 계획)', 'size-too-small': '계획 수량이 너무 작습니다', 'internal-risk': '내부 위험 검증 실패',
});
const splanReasonText = code => SPLAN_REASON_TEXT[code] || code;

// ── 표시 ──
const splanFmtNum = (x, dp) => Number(x).toFixed(dp);
const splanQty = (q, spec) => Number(q).toFixed(splanDecimals(spec.step));
function splanLines(plan, opts) {
  const o = opts || {}, dp = Math.max(splanDecimals(String(plan.entry)), 2), u = 'USDT';
  if (plan.status !== 'ok') return [`📐 분할 계획: 거래 제외 — ${splanReasonText(plan.reason)}`];
  const eq = splanFmtNum(plan.equity, 2), lines = [];
  if (o.compact) {
    lines.push(`📐 ${plan.stagesCount}분할 · 격리 ${plan.lev}배 · 평가액 ${eq} 가정 · 최악 −${splanFmtNum(plan.worstLoss, 2)} ${u}(${splanFmtNum(plan.worstLossPct * 100, 2)}%)`);
    lines.push(plan.stages.map(s => `${s.n}차 ${Math.round(s.weight * 100)}% ${splanFmtNum(s.price, dp)}`).join(' · ') + ` · 손절 ${splanFmtNum(plan.stop, dp)}`);
    lines.push(plan.tps.map(t => `TP${t.n} ${t.r}R ${Math.round(t.w * 100)}% ${splanFmtNum(t.price, dp)}`).join(' · ') + ` · 잔여 ${Math.round(plan.runnerWeight * 100)}% 추적`);
    return lines;
  }
  lines.push(`📐 ${plan.stagesCount}분할 진입 계획 · 격리 ${plan.lev}배${plan.lev === 2 ? '(대안)' : ''} · 평가액 ${eq} ${u}${o.assumed ? ' 가정' : ''}${plan.degraded ? ` · 소액으로 ${plan.degraded} 단계 축소` : ''}`);
  for (const s of plan.stages) lines.push(`  ${s.n}차 ${Math.round(s.weight * 100)}% · ${splanFmtNum(s.price, dp)}${s.n > 1 ? ` (−${plan.params.addR[s.n - 2]}R)` : ''} · 수량 ${splanQty(s.qty, plan.spec)} · 증거금 ${splanFmtNum(s.margin, 2)} · 손절 시 −${splanFmtNum(s.lossIfStop, 2)}`);
  lines.push(`  추가 진입은 2·3차 가격에서만, 직전 15분봉 종가가 ${splanFmtNum(plan.add.structurePrice, dp)} ${plan.dir === 'LONG' ? '위' : '아래'}(구조 유지)·TP 체결 전·신호 후 ${plan.add.window * 15}분 안일 때만. 손실 만회용 추가 금지`);
  lines.push(`  손절 ${splanFmtNum(plan.stop, dp)} (1R=${splanFmtNum(plan.R, dp)}, 고정) · 최악 손실 −${splanFmtNum(plan.worstLoss, 2)} ${u} = 평가액의 ${splanFmtNum(plan.worstLossPct * 100, 2)}% (한도 ${splanFmtNum(plan.params.riskPct * 100, 2)}% · 수수료·슬리피지 포함)`);
  lines.push(`  익절 ${plan.tps.map(t => `TP${t.n} ${splanFmtNum(t.price, dp)} (${t.r}R) ${Math.round(t.w * 100)}%`).join(' · ')} · 잔여 ${Math.round(plan.runnerWeight * 100)}% 추적 손절(TP1 후 손절=본전, TP2 후 최고가−${plan.params.trailR}R)`);
  lines.push(`  총 증거금 ${splanFmtNum(plan.totalMargin, 2)} ${u} (평가액의 ${splanFmtNum(plan.marginUsage * 100, 1)}%, 한도 ${Math.round(plan.params.maxMarginUsage * 100)}%) · 유지할 가용 잔고 ≥ ${splanFmtNum(plan.minAvailable, 2)} ${u} · 청산가(근사) ${splanFmtNum(plan.liqPrice, dp)}`);
  lines.push(`  수량은 거래소 최소 단위(${plan.spec.step})로 내림 · 전량 체결 총 ${splanQty(plan.totalQty, plan.spec)} · ${plan.note}`);
  return lines;
}
function splanStatusLines(plan, st) {
  const dp = Math.max(splanDecimals(String(plan.entry)), 2), lines = [], f = x => splanFmtNum(x, dp);
  lines.push(`📐 계획 상태 · ${plan.symbol} ${plan.dir} · 보유 ${splanQty(st.openQty, plan.spec)}${st.avgEntry === null ? '' : ` @ ${f(st.avgEntry)}`}`);
  lines.push(`  손절 수량 = 보유 수량 ${splanQty(st.stopQty, plan.spec)} · 손절가 ${f(st.stopPrice)}(${{ initial: '최초', breakeven: '본전으로 이동', trailing: '추적' }[st.stopKind]})`);
  for (const s of st.stages) lines.push(`  ${s.n}차 ${f(s.price)} · ${splanQty(s.filled, plan.spec)}/${splanQty(s.plannedQty, plan.spec)} 체결`);
  for (const p of st.pending) lines.push(`  미체결 ${p.n}차 ${f(p.price)} 잔량 ${splanQty(p.remainingQty, plan.spec)}${p.partiallyFilled ? '(부분 체결)' : ''} → ${{ working: '유지', 'waiting-first': '1차 체결 전', 'cancel-after-tp': '익절 시작: 취소하세요', 'cancel-closed': '청산됨: 취소하세요', 'cancel-structure': '구조 훼손: 취소하세요', 'cancel-window': '시간 초과: 취소하세요' }[p.state]}`);
  for (const l of st.legs) lines.push(`  TP${l.n} ${f(l.price)} ${splanQty(l.qty, plan.spec)}${l.done ? ' ✔체결' : ''}`);
  lines.push(`  잔여 추적 ${splanQty(st.runnerQty, plan.spec)} · 지금 손절 시 ${st.lossNow >= 0 ? `손실 −${splanFmtNum(st.lossNow, 2)}` : `이익 +${splanFmtNum(-st.lossNow, 2)}`} USDT(한도 ${splanFmtNum(st.riskBudget, 2)})${st.pending.some(p => p.state === 'working') ? ` · 미체결이 모두 체결되면 최악 −${splanFmtNum(st.worstIfPendingFill, 2)}` : ''}`);
  if (st.warnings.length) lines.push(`  ⚠ ${st.warnings.map(splanReasonText).join(' · ')}`);
  return lines;
}

// ── ledger.mjs ──
// 일별 계좌 성장·목표·정합성 계산(순수 함수).
//  · 입출금은 매매 손익과 분리: 일 손익 = 마감 평가액 − 시작 평가액 − 당일 순입출금.
//  · 당일 목표 = 전일 *실제* 마감 잔고 × (1+목표율). 미달분을 다음 날에 더하지 않는다(compound.mjs).
//  · 실제 마감 = 사용자가 입력한 평가액. 없으면 장부 근사값(closeSource='ledger')으로 표시한다(숨기지 않음).
//  · 장부 잔고 = 시작 평가액 + 실현 순손익(입력된 수수료·펀딩만) + 입출금 + 명시 조정. 입력 평가액과의 차이는 항상 표시하고 자동으로 손익에 흡수하지 않는다.
//  · 시작 시 미결제 포지션은 시작 시점 마크가격을 새 기준가로 삼아(opening) 시작 이후 변동분만 반영한다.

const LEDGER_REVIEW_ABS_MICRO = BigInt(1000000);        // 1 USDT
const LEDGER_REVIEW_PPM = BigInt(5000);                  // 0.5%

const ledgerMicro = v => decToMicro(dec(v));
function ledgerUnique(list, keyField, label) {
  let out = [];
  for (const r of (list != null ? list : [])) { const x = dedupeAppend(out, r, keyField); if (x.status === 'conflict') throw new Error(`${label} 충돌(같은 ${keyField}, 다른 내용): ${r[keyField]}`); out = x.list; }
  return out;                                              // 같은 id·같은 내용의 재전송은 한 번만 반영
}

function ledgerBuildDaily({ challenge, fills = [], cashflows = [], equityInputs = [], adjustments = [], openingPositions = [], throughDay }) {
  const startMicro = ledgerMicro(challenge.startEquity), startDay = challenge.startDay, schedule = challenge.rateSchedule;
  if (dayToIndex(throughDay) < dayToIndex(startDay)) return { rows: [], summary: null, flags: ['through-before-start'], trades: new Map() };
  const uFills = ledgerUnique(fills, 'fillId', '체결'), uCash = ledgerUnique(cashflows, 'cfId', '입출금'), uAdj = ledgerUnique(adjustments, 'adjId', '조정');
  const eqByDay = new Map(); for (const e of equityInputs) { if (eqByDay.has(e.day)) throw new Error(`같은 날 평가액 중복: ${e.day}`); eqByDay.set(e.day, e); }
  // opening 포지션 → 시작일 00:00 KST의 기준가 체결(수수료·펀딩 0 입력)
  const startMs = dayStartMs(startDay), openingSids = new Map(), allFills = [...uFills];
  for (const o of openingPositions) { allFills.push({ origin: 'real', fillId: `${o.sid}:opening`, sid: o.sid, kind: 'opening', dir: o.dir, at: startMs, price: o.startMark, qty: o.qty, fee: { state: 'entered', amount: '0' }, funding: { state: 'entered', amount: '0' } }); openingSids.set(o.sid, o); }
  // 범위 밖 입력은 조용히 버리지 않고 경고로 알린다(개수만, 값은 노출하지 않음)
  const endAll = dayEndMs(throughDay), inputFlags = [], flag = (type, n) => { if (n) inputFlags.push({ type, count: n }); };
  flag('fills-before-start', uFills.filter(f => f.at < startMs).length); flag('fills-after-through', uFills.filter(f => f.at >= endAll).length);
  flag('cashflows-before-start', uCash.filter(c => c.at < startMs).length); flag('cashflows-after-through', uCash.filter(c => c.at >= endAll).length);
  flag('adjustments-before-start', uAdj.filter(a => a.at < startMs).length); flag('adjustments-after-through', uAdj.filter(a => a.at >= endAll).length);
  flag('equity-outside-range', equityInputs.filter(e => dayToIndex(e.day) < dayToIndex(startDay) || dayToIndex(e.day) > dayToIndex(throughDay)).length);
  const usable = allFills.filter(f => f.at >= startMs && f.at < endAll), trades = pnlComputeAll(usable, {}), flows = pnlDailyFlows(trades);
  const days = dayRange(startDay, throughDay), ideal = compoundIdealSeries({ startMicro, startDay, schedule, throughDay });
  const rows = []; let prevClose = startMicro, ledgerWallet = startMicro;
  // 한 번만 훑는 색인: 일별 입출금·조정 합계, 체결 시간순 이벤트(미결제 상태 갱신), 일별 미입력 수수료·펀딩 표시
  const cashByDay = new Map(), adjByDay = new Map(), missingByDay = new Map(), evs = [];
  for (const c of uCash) { const k = kstDayOf(c.at); cashByDay.set(k, (nullishOr(cashByDay.get(k), BigInt(0))) + ledgerMicro(c.amount)); }
  for (const a of uAdj) { const k = kstDayOf(a.at); adjByDay.set(k, (nullishOr(adjByDay.get(k), BigInt(0))) + ledgerMicro(a.amount)); }
  for (const t of trades.values()) for (const e of t.events) {
    evs.push({ at: e.at, sid: t.sid, dir: t.dir, qtyAfter: e.qtyAfter });
    if (e.feeState === 'missing' || e.fundingState === 'missing') { const m = nullishOr(missingByDay.get(e.day), new Set()); if (e.feeState === 'missing') m.add('fee-missing'); if (e.fundingState === 'missing') m.add('funding-missing'); missingByDay.set(e.day, m); }
  }
  evs.sort((a, b) => a.at - b.at); let evPtr = 0; const openQty = new Map();
  for (let i = 0; i < days.length; i++) {
    const day = days[i], endMs = dayEndMs(day), rate = compoundRateOn(day, schedule);
    const fl = nullishOr(flows.get(day), { netEnteredMicro: BigInt(0), grossMicro: BigInt(0), feeEnteredMicro: BigInt(0), feeEstimatedMicro: BigInt(0), fundingEnteredMicro: BigInt(0), fundingEstimatedMicro: BigInt(0) });
    const cash = nullishOr(cashByDay.get(day), BigInt(0)), adj = nullishOr(adjByDay.get(day), BigInt(0));
    ledgerWallet += fl.netEnteredMicro + cash + adj;
    const target = compoundNextTarget(prevClose, rate);
    const eq = nullishOr(eqByDay.get(day), null), equityIn = eq ? ledgerMicro(eq.equity) : null;
    // 그날 끝 미결제 포지션과 opening 기준 미실현 보정
    while (evPtr < evs.length && evs[evPtr].at < endMs) { const e = evs[evPtr++]; if (e.qtyAfter > BigInt(0)) openQty.set(e.sid, { dir: e.dir, qty: e.qtyAfter }); else openQty.delete(e.sid); }
    const openNow = [...openQty.entries()].map(([sid, v]) => ({ sid, dir: v.dir, openQtyDec: v.qty }));
    let openingU = BigInt(0), openingUnknown = false;
    for (const t of openNow) {
      const o = openingSids.get(t.sid); if (!o) continue;
      if (o.origEntry === undefined || o.origEntry === null) { openingUnknown = true; continue; }
      const oq = dec(o.qty), q = t.openQtyDec < oq ? t.openQtyDec : oq;
      openingU += decToMicro(decMul(decMul(decSub(dec(o.startMark), dec(o.origEntry)), q), dec(t.dir === 'LONG' ? 1 : -1)));
    }
    const unrl = eq && eq.unrealized !== undefined && eq.unrealized !== null ? ledgerMicro(eq.unrealized) : null;
    const rowFlags = [];
    let diffMicro = null, uncertain = false, needsReview = false, expected = null;
    if (equityIn !== null) {
      if (unrl === null && openNow.length) { uncertain = true; rowFlags.push('unrealized-missing'); expected = ledgerWallet; }
      else if (openingUnknown) { uncertain = true; rowFlags.push('opening-basis-unknown'); expected = ledgerWallet + ((unrl != null ? unrl : BigInt(0))); }
      else expected = ledgerWallet + ((unrl != null ? unrl : BigInt(0))) - openingU;
      diffMicro = equityIn - expected;
      const rel = decRoundDiv((equityIn < BigInt(0) ? -equityIn : equityIn) * LEDGER_REVIEW_PPM, BigInt(1000000)), tol = rel > LEDGER_REVIEW_ABS_MICRO ? rel : LEDGER_REVIEW_ABS_MICRO;
      needsReview = (diffMicro < BigInt(0) ? -diffMicro : diffMicro) > tol;
      if (needsReview) rowFlags.push('ledger-mismatch');
      if (eq.late) rowFlags.push('late-entry');
    }
    // 실제 마감: 입력 평가액 우선, 없으면 장부 근사(미실현 미반영)
    const close = equityIn !== null ? equityIn : prevClose + cash + fl.netEnteredMicro + adj;
    const closeSource = equityIn !== null ? 'input' : 'ledger';
    if (closeSource === 'ledger') rowFlags.push('close-from-ledger');
    if (fl.feeEstimatedMicro || fl.fundingEstimatedMicro) rowFlags.push('has-estimates');
    for (const f of nullishOr(missingByDay.get(day), [])) if (!rowFlags.includes(f)) rowFlags.push(f);
    const pnl = close - prevClose - cash;
    rows.push({ day, n: i + 1, rate, startMicro: prevClose, targetCloseMicro: target.targetCloseMicro, targetProfitMicro: target.targetProfitMicro,
      idealMicro: ideal[i + 1].idealMicro, closeMicro: close, closeSource, cashflowMicro: cash, adjustmentMicro: adj, pnlMicro: pnl,
      achievementPpm: target.targetProfitMicro > BigInt(0) ? decRoundDiv(pnl * BigInt(1000000), target.targetProfitMicro) : null,
      ledgerWalletMicro: ledgerWallet, expectedEquityMicro: expected, diffMicro, needsReview, uncertain,
      realizedGrossMicro: fl.grossMicro, realizedNetMicro: fl.netEnteredMicro, feesEnteredMicro: fl.feeEnteredMicro, fundingEnteredMicro: fl.fundingEnteredMicro, openPositions: openNow.length, flags: rowFlags });
    prevClose = close;
  }
  return { rows, summary: ledgerSummarize(rows, startMicro), flags: inputFlags, trades };
}

// 요약: 누적 수익률(시작 자금 대비 단순), 최고 평가액, 최대 낙폭(입출금을 제거한 곡선 기준)
function ledgerSummarize(rows, startMicro) {
  if (!rows.length) return null;
  let cum = BigInt(0), peak = startMicro, maxDd = BigInt(0), maxDdPpm = BigInt(0), highest = startMicro, met = 0, inputDays = 0, ledgerDays = 0, review = 0, curve = startMicro;
  for (const r of rows) {
    cum += r.cashflowMicro; curve = r.closeMicro - cum;
    if (curve > peak) peak = curve;
    const dd = peak - curve; if (dd > maxDd) { maxDd = dd; maxDdPpm = peak > BigInt(0) ? decRoundDiv(dd * BigInt(1000000), peak) : BigInt(0); }
    if (r.closeMicro > highest) highest = r.closeMicro;
    if (r.targetProfitMicro > BigInt(0) && r.pnlMicro >= r.targetProfitMicro) met++;
    if (r.closeSource === 'input') inputDays++; else ledgerDays++;
    if (r.needsReview) review++;
  }
  const last = rows[rows.length - 1], pnlTotal = last.closeMicro - startMicro - cum, curDd = peak - curve;
  return { startMicro, latestCloseMicro: last.closeMicro, netCashflowMicro: cum, pnlTotalMicro: pnlTotal, returnOnStartPpm: startMicro > BigInt(0) ? decRoundDiv(pnlTotal * BigInt(1000000), startMicro) : null,
    highestEquityMicro: highest, maxDrawdownMicro: maxDd, maxDrawdownPpm: maxDdPpm, currentDrawdownMicro: curDd, currentDrawdownPpm: peak > BigInt(0) ? decRoundDiv(curDd * BigInt(1000000), peak) : BigInt(0),
    daysTargetMet: met, days: rows.length, daysWithInput: inputDays, daysLedgerOnly: ledgerDays, daysNeedingReview: review, idealLatestMicro: last.idealMicro, gapToIdealMicro: last.closeMicro - last.idealMicro };
}
const ledgerMicroLabel = (m, dp = 2) => decFormat(microToDec(m), dp);

// ── dashboard.mjs ──
// 메인 화면 뷰 모델(순수 함수, R6 수정판: 숫자 중심·그래프 없음). R2 장부 계산 결과를 화면용 JSON-안전 값으로 정리한다.
//  · 금액 계산은 전부 R2(마이크로 USDT BigInt)가 하고, 이 모듈은 *표시용 변환*(문자열·차트용 숫자)만 한다. 새 손익 계산식을 만들지 않는다.
//  · 실제 기록(origin=real)만 사용한다. 모의 거래는 어떤 경로로도 들어오지 않는다(저장소가 거부).
//  · 챌린지 설정이 없으면 샘플로 대체하지 않고 '설정 전' 상태를 돌려 준다(없는 잔액을 만들어 보여 주지 않음). 샘플은 화면 검증용(dashSampleModel)으로만 쓴다.
//  · 현재 총자산은 *사용자가 입력한 평가액*만 쓴다. 입력이 하나도 없으면 null(화면은 '미입력'). 장부 근사값을 현재 자산처럼 보여 주지 않는다.
//  · 목표 미달분을 다음 날에 더하지 않는다는 R2 규칙을 그대로 따른다(여기서 목표를 다시 계산하지 않음).


const dashGroup = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
function dashUsd(micro, { sign = false, dp = 2 } = {}) {      // 마이크로 → "1,234.56" (sign=true면 +/− 부호)
  const neg = micro < BigInt(0), a = neg ? -micro : micro, s = decFormat(a * BigInt(1000000), dp), [i, f] = s.split('.');
  const body = f === undefined ? dashGroup(i) : `${dashGroup(i)}.${f}`, zero = /^[0.,]*$/.test(body);
  return `${neg && !zero ? '−' : sign && !zero ? '+' : ''}${body}`;
}
function dashPct(ppm, { sign = false, dp = 2 } = {}) {        // ppm(1e6=100%) → "12.34%"
  if (ppm === null || ppm === undefined) return '—';
  const neg = ppm < BigInt(0), a = neg ? -ppm : ppm, s = decFormat(a * BigInt(100000000), dp), zero = /^[0.]*$/.test(s);   // ppm/1e4 = %, 십진 1e-12 단위로 변환
  return `${neg && !zero ? '−' : sign && !zero ? '+' : ''}${s}%`;
}
const dashTrim = v => { const t = String(v); return t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t; };
const dashRatePct = rate => `${dashTrim(decFormat(decMul(dec(rate), dec(100)), 2))}%`;

const DASH_DAILY_LIMIT = 30;
const dashZeroFloor = v => (v < BigInt(0) ? BigInt(0) : v);

// inputs: storeLoadLedgerInputs 형태
function dashBuildModel({ inputs, throughDay, now, sample = false }) {
  const startDay = inputs.challenge.startDay, led = ledgerBuildDaily({ ...inputs, throughDay });
  const startMicro = decToMicro(dec(inputs.challenge.startEquity)), model = { sample, generatedAt: now, today: throughDay, startDay, startEquity: dashUsd(startMicro), empty: !led.rows.length };
  if (!led.rows.length) return { ...model, daily: [], warnings: [{ type: 'not-started', text: '챌린지 시작일 전입니다' }] };
  const rows = led.rows, t = rows[rows.length - 1];
  // ── 1~3. 현재 총자산·누적 손익·누적 수익률: 입력된 평가액 기준(외부 입출금은 손익에서 제외) ──
  let cur = null, cum = BigInt(0), curCash = BigInt(0);
  for (const r of rows) { cum += r.cashflowMicro; if (r.closeSource === 'input') { cur = r; curCash = cum; } }
  const todayInput = t.closeSource === 'input';
  if (cur) {
    const pnl = cur.closeMicro - startMicro - curCash, ppm = decRoundDiv(pnl * BigInt(1000000), startMicro);
    model.current = { label: dashUsd(cur.closeMicro), micro: String(cur.closeMicro), day: cur.day, today: todayInput, stale: !todayInput, pnlLabel: dashUsd(pnl, { sign: true }), pnlPositive: pnl > BigInt(0), pnlNegative: pnl < BigInt(0),
      returnLabel: dashPct(ppm, { sign: true }), cashflowLabel: curCash === BigInt(0) ? null : dashUsd(curCash, { sign: true }) };
  } else model.current = null;
  // ── 4~7. 오늘: 시작 자산·목표 자산·실현손익·목표까지 남은 금액(달성 여부는 따로 표시) ──
  const rem = cur ? dashZeroFloor(t.targetCloseMicro - cur.closeMicro) : null, met = cur ? cur.closeMicro >= t.targetCloseMicro : null;
  const real = t.realizedNetMicro;
  model.today = { day: t.day, n: t.n, rate: dashRatePct(t.rate), startLabel: dashUsd(t.startMicro), targetLabel: dashUsd(t.targetCloseMicro), targetProfitLabel: dashUsd(t.targetProfitMicro, { sign: true }),
    realizedLabel: dashUsd(real, { sign: true }), realizedPositive: real > BigInt(0), realizedNegative: real < BigInt(0), remainingLabel: rem === null ? null : dashUsd(rem), achieved: met === true && todayInput, achievedStale: met === true && !todayInput,
    needsReview: t.needsReview, diffLabel: t.diffMicro === null ? null : dashUsd(t.diffMicro, { sign: true }), ledgerLabel: dashUsd(t.ledgerWalletMicro), openPositions: t.openPositions };
  // ── 8. 날짜별 마감 자산·일간 손익(표). 평가액이 없는 날은 마감 자산을 '미입력'으로 두고 장부상 실현손익만 보여 준다 ──
  model.daily = rows.slice(-DASH_DAILY_LIMIT).reverse().map(r => {
    const input = r.closeSource === 'input', isToday = r.day === throughDay, p = input ? r.pnlMicro : r.realizedNetMicro;
    return { day: r.day, n: r.n, today: isToday, input, closeLabel: input ? dashUsd(r.closeMicro) : null, pnlLabel: dashUsd(p, { sign: true }), pnlPositive: p > BigInt(0), pnlNegative: p < BigInt(0), pnlBasis: input ? 'equity' : 'realized',
      targetLabel: dashUsd(r.targetCloseMicro), met: input && r.closeMicro >= r.targetCloseMicro, review: r.needsReview };
  });
  model.dailyTotal = rows.length;
  // ── 데이터 품질 경고(숨기지 않음) ──
  const w = [], cnt = f => rows.filter(r => r.flags.includes(f)).length;
  if (cnt('ledger-mismatch')) w.push({ type: 'ledger-mismatch', text: `장부와 입력 평가액의 차이가 큰 날 ${cnt('ledger-mismatch')}일(확인 필요, 자동으로 손익에 반영하지 않음)` });
  if (cnt('close-from-ledger')) w.push({ type: 'close-from-ledger', text: `평가액을 입력하지 않은 날 ${cnt('close-from-ledger')}일(마감 자산 미입력, 장부상 실현손익만 표시)` });
  for (const f of led.flags) w.push({ type: f.type, text: `범위 밖 입력 ${f.count}건(${f.type})` });
  model.warnings = w;
  return model;
}

// 저장소에서 읽어 만든다. 챌린지 설정이 없으면 샘플로 대체하지 않고 설정 전 상태를 돌려 준다(설정이 있는데 오류가 나면 던진다).
function dashBuildFromStore(env, { now }) {
  let inputs;
  try { inputs = storeLoadLedgerInputs(env); } catch (e) { if (e instanceof StoreError && e.code === 'NOT_FOUND') return { sample: false, empty: true, noChallenge: true, generatedAt: now, daily: [], warnings: [] }; throw e; }
  return dashBuildModel({ inputs, throughDay: kstDayOf(now), now });
}

// ── 샘플 데이터(화면 검증용, 결정적) ──
function dashSampleInputs() {
  let seed = 20260924; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const startDay = '2026-09-24', days = 21, rateSchedule = [{ from: startDay, rate: '0.05' }], base = { BTC: 100000, ETH: 4000, SOL: 200 };
  const fills = [], signals = [], responses = [], reviews = [], cashflows = [];
  let eq = 300, sidN = 0;
  for (let d = 0; d < days; d++) {
    const day = addDays(startDay, d), ds = dayStartMs(day), k = d === days - 1 ? 2 : rnd() < 0.2 ? 0 : rnd() < 0.5 ? 1 : 2;
    if (d === 9) cashflows.push({ cfId: 'cf-dep-1', at: ds + 3600000, amount: '50', note: '입금(샘플)' });
    for (let j = 0; j < k; j++) {
      const sym = ['BTC', 'ETH', 'SOL'][Math.floor(rnd() * 3)], strategy = rnd() < 0.55 ? 'A' : 'B', dir = rnd() < 0.5 ? 'LONG' : 'SHORT', lev = 10, sid = `S${String(++sidN).padStart(3, '0')}`;
      const entry = base[sym] * (0.97 + rnd() * 0.06), stop = dir === 'LONG' ? entry * 0.985 : entry * 1.015, tp1 = dir === 'LONG' ? entry * 1.0225 : entry * 0.9775, at0 = ds + (9 + j * 5) * 3600000 + Math.floor(rnd() * 3000000);
      const fmt = (v, n) => v.toFixed(n), margin = Math.max(20, eq * (0.25 + rnd() * 0.15)), qty = (margin * lev) / entry, win = rnd() < 0.58, move = win ? 0.012 + rnd() * 0.02 : -(0.008 + rnd() * 0.008), exit = dir === 'LONG' ? entry * (1 + move) : entry * (1 - move);
      const pnl = (dir === 'LONG' ? exit - entry : entry - exit) * qty; eq += pnl - (entry + exit) * qty * 0.0004;
      signals.push({ sid, strategy, symbolId: `${sym}USDT`, dir, signalAt: at0 - 600000, entry: fmt(entry, 2), stop: fmt(stop, 2), tp1: fmt(tp1, 2) });
      const rsp = d === days - 1 && j === k - 1 ? 'watched' : 'entered';
      responses.push({ sid, choice: rsp, at: at0 - 300000 }); if (rsp === 'watched') continue;
      const feeIn = { state: 'entered', amount: fmt(entry * qty * 0.0004, 4) }, feeOut = rnd() < 0.12 ? { state: 'missing' } : { state: 'entered', amount: fmt(exit * qty * 0.0004, 4) };
      fills.push({ origin: 'real', fillId: `${sid}:in`, sid, kind: 'entry', dir, at: at0, price: fmt(entry, 2), qty: fmt(qty, 6), margin: fmt(margin, 2), leverage: String(lev), plannedStop: fmt(stop, 2), fee: feeIn, funding: { state: 'entered', amount: '0' } });
      fills.push({ origin: 'real', fillId: `${sid}:out`, sid, kind: 'close', dir, at: at0 + (1 + Math.floor(rnd() * 3)) * 3600000, price: fmt(exit, 2), qty: fmt(qty, 6), fee: feeOut, funding: rnd() < 0.15 ? { state: 'missing' } : { state: 'entered', amount: fmt((rnd() - 0.6) * 0.1, 4) } });
      if (rnd() < 0.7) reviews.push({ sid, plan: rnd() < 0.7 ? 'plan_ok' : 'early_exit', mind: rnd() < 0.65 ? 'calm' : 'anxious_rushed', savedAt: at0 + 5 * 3600000 });
    }
    if (d === 9) eq += 50;
  }
  const inputs = { challenge: { startEquity: '300', startDay, rateSchedule }, fills, cashflows, adjustments: [], openingPositions: [], equityInputs: [] }, throughDay = addDays(startDay, days - 1);
  // 평가액 입력은 장부 잔고를 기준으로 만들되, 이틀은 일부러 비워 "장부 근사" 표시를 보여 준다.
  const led = ledgerBuildDaily({ ...inputs, throughDay });
  inputs.equityInputs = led.rows.filter((r, i) => i !== 5 && i !== 14).map(r => ({ day: r.day, equity: decFormat(r.ledgerWalletMicro * BigInt(1000000), 2) }));
  return { inputs, signals, responses, reviews, throughDay };
}
function dashSampleModel(now) { const s = dashSampleInputs(); return dashBuildModel({ inputs: s.inputs, throughDay: s.throughDay, now, sample: true }); }

// ── dashview.mjs ──
// 메인 화면 HTML 렌더러(서버 측 렌더링, 순수 함수, R6 수정판). 숫자 중심: 그래프·차트·장식 없음. 모바일 우선 단일 HTML 문자열.
//  · 외부 스크립트·폰트·이미지 없음(인라인 CSS만, 스크립트 없음). 모든 동적 값은 dashEsc 로 이스케이프한다(시트 값이 HTML이 될 수 없음).
//  · 색은 토큰(:root)으로 정의하고 다크 모드는 prefers-color-scheme. 색만으로 의미를 전달하지 않는다(▲▼ 기호·텍스트 라벨 병행).
//  · 일일 5%는 '목표치'이며 수익을 보장하지 않는다는 문구를 항상 표시하고, 실제 성과(입력 평가액)와 목표를 다른 줄·다른 라벨로 구분한다.
const dashEsc = v => String((v != null ? v : '')).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DASH_ARROW = (pos, neg) => (pos ? '▲' : neg ? '▼' : '■');
const dashTone = (pos, neg) => (pos ? 'pos' : neg ? 'neg' : 'zero');

const DASH_PAGES = Object.freeze([['dash', '홈'], ['journal', '일지'], ['signals', '추천'], ['stats', '성적'], ['assets', '자산']]);

const DASH_CSS = `
:root{color-scheme:light;--bg:#f6f7f9;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#3f3e3b;--mute:#5c5b57;--line:#dcdbd6;--accent:#2a78d6;--good:#17794f;--bad:#c62828;--warnbg:#fff4d6;--warnink:#6b4a00;--track:#e8e7e2}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#111110;--surface:#1a1a19;--ink:#f0efec;--ink2:#d4d3c9;--mute:#a9a89f;--line:#33332f;--accent:#5aa0f0;--good:#3ddc97;--bad:#ff7b7b;--warnbg:#3a3000;--warnink:#ffd866;--track:#2a2a27}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Noto Sans KR","Apple SD Gothic Neo",sans-serif;font-variant-numeric:tabular-nums;padding:0 max(16px,env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
main{max-width:560px;margin:0 auto}
header{padding:14px 0 4px}h1{font-size:17px;margin:0}h2{font-size:14px;margin:0 0 8px;color:var(--ink2);font-weight:600}
nav.tabs{display:flex;gap:6px;margin:8px 0 4px;overflow-x:auto}nav.tabs a{flex:1 0 auto;text-align:center;font-size:14px;padding:9px 12px;min-height:40px;border:1px solid var(--line);background:var(--surface);color:var(--ink2);border-radius:999px;text-decoration:none}nav.tabs a[aria-current="page"]{border-color:var(--accent);color:var(--ink);font-weight:650}
.sub{font-size:12px;color:var(--mute)}
section{margin:14px 0}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px}
.hero{padding:18px 14px}.hero .k{font-size:13px}.hero .big{font-size:46px;font-weight:700;line-height:1.1;letter-spacing:-.5px}.hero .big small{font-size:16px;font-weight:500;color:var(--mute);margin-left:4px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.grid2>div{min-width:0}
.k{font-size:12px;color:var(--mute)}.v{font-size:24px;font-weight:650;line-height:1.25}.v small{font-size:12px;font-weight:500;color:var(--mute)}
.pos{color:var(--good)}.neg{color:var(--bad)}.zero{color:var(--ink2)}
.badge{display:inline-block;font-size:12px;border:1px solid var(--line);border-radius:999px;padding:1px 9px;color:var(--ink2);white-space:nowrap}.badge.ok{border-color:var(--good);color:var(--good);font-weight:650}
.notice{background:var(--warnbg);color:var(--warnink);border-radius:10px;padding:10px 12px;font-size:13px;margin:8px 0}
.sample{background:var(--warnbg);color:var(--warnink);border-radius:10px;padding:10px 12px;font-size:13px;margin:8px 0}
.alert{border-left:4px solid var(--bad);padding:6px 10px;margin-top:10px;font-size:13px;background:var(--bg);border-radius:6px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:8px 4px;border-bottom:1px solid var(--line);text-align:right;vertical-align:top}th{font-size:12px;color:var(--mute);font-weight:600}th:first-child,td:first-child{text-align:left}
td .sub{display:block}
.warn{margin:0;padding-left:18px;font-size:13px;color:var(--ink2)}.warn li{margin:3px 0}
.cta{display:inline-block;margin-top:8px;padding:10px 14px;border:1px solid var(--accent);border-radius:10px;color:var(--ink);text-decoration:none;font-size:14px}
footer{font-size:11px;color:var(--mute);margin:18px 0 0;text-align:center}
`;
const dashHead = title => `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${dashEsc(title)}</title><style>${DASH_CSS}</style></head>`;
const dashUrl = (appUrl, p) => (typeof appUrl === 'string' && /^https:\/\/\S+$/.test(appUrl) ? `${appUrl}${appUrl.includes('?') ? '&' : '?'}p=${p}` : null);
// 모든 페이지 공통 상단 메뉴(Apps Script 웹앱은 iframe 안에서 열리므로 target=_top 으로 이동)
function dashNav(active, appUrl) {
  return `<nav class="tabs" aria-label="메뉴">${DASH_PAGES.map(([p, label]) => { const u = dashUrl(appUrl, p); return u ? `<a target="_top" href="${dashEsc(u)}"${p === active ? ' aria-current="page"' : ''}>${label}</a>` : `<a${p === active ? ' aria-current="page"' : ' aria-disabled="true"'}>${label}</a>`; }).join('')}</nav>`;
}
const dashFooter = m => `<footer>기록 전용 · 자동 주문 없음 · 갱신 ${dashEsc(new Date(m.generatedAt + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' '))} KST</footer>`;

function dashRenderError(appUrl) {
  return `${dashHead('RICH300')}<body><main><header><h1>RICH 300</h1></header>${dashNav('dash', appUrl)}<section class="card"><p>화면을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.</p></section></main></body></html>`;
}
function dashRenderHtml(m, { appUrl } = {}) {
  const title = 'RICH300', head = `<header><h1>RICH 300</h1></header>${dashNav('dash', appUrl)}`, sampleBox = m.sample ? '<div class="sample" role="note"><strong>샘플 데이터</strong> — 화면 검증용 예시입니다. 실제 계좌와 무관합니다.</div>' : '';
  if (m.noChallenge) return `${dashHead(title)}<body><main>${head}<section class="card"><p>챌린지가 아직 설정되지 않았습니다.</p><p class="sub">Apps Script에서 설치 함수를 실행하면 시작 자금 300 USDT로 설정됩니다.</p></section></main></body></html>`;
  if (m.empty) return `${dashHead(title)}<body><main>${head}${sampleBox}<section class="card"><p>아직 시작 전입니다. 시작일: ${dashEsc(m.startDay)}</p></section></main></body></html>`;
  const c = m.current, t = m.today, assetsUrl = dashUrl(appUrl, 'assets');
  const input = assetsUrl ? `<a class="cta" target="_top" href="${dashEsc(assetsUrl)}">평가액 입력하기</a>` : '';
  const hero = c
    ? `<div class="k">현재 총자산 (입력 평가액)</div><div class="big">${dashEsc(c.label)}<small>USDT</small></div><div class="sub">${c.today ? '오늘 입력' : `${dashEsc(c.day)} 입력 기준 — 오늘 평가액은 아직 없습니다`}${c.cashflowLabel ? ` · 입출금 ${dashEsc(c.cashflowLabel)}(손익과 분리)` : ''}</div>`
    : `<div class="k">현재 총자산</div><div class="big zero">미입력<small>USDT</small></div><div class="sub">거래소 평가액을 입력하면 표시됩니다. 입력이 없을 때 임의의 잔액을 만들어 보여 주지 않습니다.</div>${input}`;
  const goalNote = c && t.achieved ? '<span class="badge ok">✔ 오늘 목표 달성</span>' : c && t.achievedStale ? '<span class="badge">입력 시점 기준 목표 초과(오늘 평가액 없음)</span>' : '';
  return `${dashHead(title)}<body><main>
${head}
${sampleBox}
<section aria-label="현재 자산"><div class="card hero">${hero}</div></section>
<section aria-label="시작 자금 대비 성과"><div class="card"><div class="grid2">
<div><div class="k">시작 자금 대비 누적 손익</div>${c ? `<div class="v ${dashTone(c.pnlPositive, c.pnlNegative)}">${DASH_ARROW(c.pnlPositive, c.pnlNegative)} ${dashEsc(c.pnlLabel)} <small>USDT</small></div>` : '<div class="v zero">미입력</div>'}</div>
<div><div class="k">시작 자금 대비 누적 수익률</div>${c ? `<div class="v ${dashTone(c.pnlPositive, c.pnlNegative)}">${DASH_ARROW(c.pnlPositive, c.pnlNegative)} ${dashEsc(c.returnLabel)}</div>` : '<div class="v zero">미입력</div>'}</div></div>
<div class="sub" style="margin-top:8px">시작 자금 ${dashEsc(m.startEquity)} USDT · 입출금은 손익에서 제외</div></div></section>
<section aria-labelledby="h-today"><h2 id="h-today">오늘 (${dashEsc(t.day)}) · ${t.n}일차</h2><div class="card"><div class="grid2">
<div><div class="k">오늘 시작 자산</div><div class="v">${dashEsc(t.startLabel)} <small>USDT</small></div></div>
<div><div class="k">오늘 목표 자산 (+${dashEsc(t.rate)})</div><div class="v">${dashEsc(t.targetLabel)} <small>${dashEsc(t.targetProfitLabel)}</small></div></div>
<div><div class="k">오늘 실현손익</div><div class="v ${dashTone(t.realizedPositive, t.realizedNegative)}">${DASH_ARROW(t.realizedPositive, t.realizedNegative)} ${dashEsc(t.realizedLabel)} <small>USDT</small></div></div>
<div><div class="k">목표까지 남은 금액</div>${t.remainingLabel === null ? '<div class="v zero">미입력</div>' : `<div class="v">${dashEsc(t.remainingLabel)} <small>USDT</small></div>`}</div></div>
${goalNote ? `<div style="margin-top:8px">${goalNote}</div>` : ''}
${t.needsReview ? `<div class="alert" role="alert">⚠ 장부와 입력 평가액의 차이 ${dashEsc(t.diffLabel)} USDT — 확인이 필요합니다(자동으로 손익에 반영하지 않음).</div>` : ''}
<div class="sub" style="margin-top:8px">목표 = 전일 실제 마감 자산 × (1+${dashEsc(t.rate)}). 목표치일 뿐 수익을 보장하지 않으며 실제 성과는 입력 평가액 기준입니다.</div></div></section>
<section aria-labelledby="h-daily"><h2 id="h-daily">날짜별 마감 자산 · 일간 손익${m.dailyTotal > m.daily.length ? ` <span class="sub">(최근 ${m.daily.length}일)</span>` : ''}</h2><div class="card"><table><thead><tr><th>날짜</th><th>마감 자산</th><th>일간 손익</th></tr></thead><tbody>
${m.daily.map(d => `<tr><td>${dashEsc(d.day.slice(5))}${d.today ? ' <span class="sub">오늘·진행 중</span>' : ''}${d.met ? ' <span class="badge ok">달성</span>' : ''}</td><td>${d.input ? dashEsc(d.closeLabel) : '<span class="sub">미입력</span>'}${d.review ? ' <span class="sub">⚠ 장부 차이</span>' : ''}</td><td class="${dashTone(d.pnlPositive, d.pnlNegative)}">${DASH_ARROW(d.pnlPositive, d.pnlNegative)} ${dashEsc(d.pnlLabel)}${d.input ? '' : '<span class="sub">장부상 실현손익</span>'}</td></tr>`).join('')}
</tbody></table></div></section>
${m.warnings.length ? `<section aria-labelledby="h-w"><h2 id="h-w">데이터 확인</h2><div class="card"><ul class="warn">${m.warnings.map(w => `<li>${dashEsc(w.text)}</li>`).join('')}</ul></div></section>` : ''}
${dashFooter(m)}
</main></body></html>`;
}

// ── shell.mjs ──
// 웹앱 공통 화면(서버 측, 순수 함수): 접근 거부·오류(재시도 버튼)·상태 점검. 시트를 읽지 않으므로 저장소가 느리거나 고장 나도 *항상 즉시* 열린다 — 무한 로딩 대신 원인과 다시 시도 버튼을 보여 준다.
//  · 비밀값·이메일·시트 ID·금액은 어디에도 넣지 않는다. 오류는 짧은 코드(StoreError 코드·오류 이름)와 안내 문장만 보여 준다.

const shellUrl = (appUrl, p) => (typeof appUrl === 'string' && /^https:\/\/\S+$/.test(appUrl) ? `${appUrl}${appUrl.includes('?') ? '&' : '?'}p=${p}` : null);
// 오류 → 화면에 보여도 안전한 짧은 코드(메시지 본문은 쓰지 않는다: 시트 값·ID가 섞일 수 있음)
function shellErrorCode(err) {
  if (!err) return 'ERROR';
  if (typeof err.code === 'string' && /^[A-Z_]{2,20}$/.test(err.code)) return err.code;
  const n = String(err.name || 'Error').replace(/[^A-Za-z]/g, '').slice(0, 24).toUpperCase(); return n || 'ERROR';
}
const SHELL_HINTS = {
  LOCK: '다른 작업이 저장 중입니다. 몇 초 뒤 다시 시도하면 됩니다.',
  SCHEMA: '시트 구조 버전이 코드와 다릅니다. 상태 점검 화면에서 확인하세요.',
  INTEGRITY: '시트 내용에 이상이 감지되었습니다. 상태 점검 화면에서 확인하세요(데이터는 지우지 않았습니다).',
  NO_SHEET: '스크립트 속성에 시트 설정이 없습니다. Apps Script 편집기에서 rich300Install 을 한 번 실행하세요.',
  EXCEPTION: 'Google 서버가 일시적으로 응답하지 않았을 수 있습니다. 잠시 후 다시 시도하세요.',
};
const SHELL_JS = `<script>(function(){var b=document.getElementById('retry');if(b)b.addEventListener('click',function(e){if(!b.getAttribute('href')){e.preventDefault();location.reload()}})})()</script>`;
const shellPage = (title, body) => `${dashHead(title)}<body><main>${body}</main>${SHELL_JS}</body></html>`;

function shellRenderError({ title = '화면', code = 'ERROR', appUrl = '', page = 'dash' } = {}) {
  const retry = shellUrl(appUrl, page), health = shellUrl(appUrl, 'health'), hint = SHELL_HINTS[code] || '잠시 후 다시 시도하세요. 계속되면 상태 점검 화면에서 원인을 확인할 수 있습니다.';
  return shellPage(`RICH300 ${title}`, `<header><h1>RICH 300 · ${dashEsc(title)}</h1></header>${dashNav(page === 'health' ? '' : page, appUrl)}<section class="card" role="alert"><p><strong>화면을 불러오지 못했습니다.</strong></p><p>${dashEsc(hint)}</p><p class="sub">오류 코드: ${dashEsc(code)} · 기록된 데이터는 변경되지 않았습니다.</p>
<a id="retry" class="cta" target="_top"${retry ? ` href="${dashEsc(retry)}"` : ''}>다시 시도</a>${health ? ` <a class="cta" target="_top" href="${dashEsc(health)}">상태 점검</a>` : ''}</section>`);
}
function shellRenderDenied({ appUrl = '' } = {}) {
  void appUrl;
  return shellPage('접근 제한', `<header><h1>접근 제한</h1></header><section class="card" role="alert"><p><strong>이 페이지는 소유자 Google 계정으로 로그인한 브라우저에서만 열립니다.</strong></p><p>계정을 확인한 뒤 다시 열어 주세요. 텔레그램·메신저 안에서 열린 링크는 로그인 정보가 전달되지 않아 계속 로딩되거나 빈 화면이 될 수 있습니다. Chrome·Safari 에서 같은 주소를 열어 보세요.</p><a id="retry" class="cta" target="_top">다시 시도</a></section>`);
}
// 상태 점검: steps = [{ id, status: 'PASS'|'FAIL'|'WAIT', text, ms }], perf = { recent: [{p, ms, cold, at}], summary: [...] }
function shellRenderHealth({ steps = [], build = 'dev', appUrl = '', totalMs = 0, perf = null } = {}) {
  const fail = steps.filter(s => s.status === 'FAIL').length, wait = steps.filter(s => s.status === 'WAIT').length, verdict = fail ? `문제 ${fail}건 — 아래 FAIL 항목을 먼저 확인하세요` : wait ? `정상 · 확인할 일 ${wait}건` : '정상';
  const li = s => `<li><span class="badge${s.status === 'PASS' ? ' ok' : ''}">${dashEsc(s.status)}</span> ${dashEsc(s.text)}${s.ms != null ? ` <span class="sub">${dashEsc(String(s.ms))}ms</span>` : ''}</li>`;
  const perfRows = perf && perf.recent && perf.recent.length ? `<table><tr><th>화면</th><th>구분</th><th>서버 처리</th></tr>${perf.recent.map(r => `<tr><td>${dashEsc(r.p)}</td><td>${r.cold ? '첫 실행' : '재실행'}</td><td>${dashEsc(String(r.ms))}ms</td></tr>`).join('')}</table>` : '<div class="sub">아직 기록이 없습니다. 화면을 몇 번 연 뒤 다시 확인하세요.</div>';
  const links = ['dash', 'journal', 'signals', 'stats', 'assets', 'fill', 'check'].map(p => [p, shellUrl(appUrl, p)]).filter(x => x[1]);
  return shellPage('RICH300 상태 점검', `<header><h1>RICH 300 · 상태 점검</h1></header>${dashNav('', appUrl)}<section class="card"><div class="k">결과</div><div class="v">${dashEsc(verdict)}</div><div class="sub">빌드 ${dashEsc(build)} · 점검 ${dashEsc(String(totalMs))}ms · 이 화면은 읽기 전용입니다</div></section>
<section class="card"><h2>점검 항목</h2><ul class="warn" style="list-style:none;padding:0">${steps.map(li).join('')}</ul></section>
<section class="card"><h2>최근 응답시간(서버 처리 기준)</h2>${perfRows}<div class="sub">목표: 첫 화면 3초 · 기록 조회·저장 2초 이내. '첫 실행'은 최근 10분간 실행이 없던 뒤의 첫 요청입니다.</div></section>
<section class="card"><h2>바로가기</h2>${links.map(([p, u]) => `<a class="cta" target="_top" href="${dashEsc(u)}">${dashEsc(p)}</a>`).join(' ')}</section>`);
}
// 감시 점검 화면(?p=watch): state = rich300WatchState_() 결과, result = 미리보기 실행 결과(개수·코드만). 값·ID·이메일·토큰 없음.
function shellRenderWatch({ state, result = null, net = null, ran = false, error = null, ms = 0, appUrl = '', build = 'dev' } = {}) {
  const propText = { unset: '속성 없음(미설정)', off: 'off', preview: 'preview', on: 'on', invalid: `인식할 수 없는 값(길이 ${state.invalidLen}) — 꺼짐과 동일하게 동작` }[state.prop], eff = { nothing: '아무것도 하지 않음(꺼짐)', 'preview-only': '계산만 하고 전송하지 않음', sends: '전송 가능' }[state.effective];
  const runUrl = shellUrl(appUrl, 'watch&run=1'), li = t => `<li>${dashEsc(t)}</li>`;
  const rows = [`스크립트 속성 RICH300_WATCH_ALERTS: ${propText}`, `실제 동작(지금 트리거가 돌면): ${eff}`, `감시 트리거: ${state.triggers ? `${state.triggers}개 설치됨` : '없음(설치 안 됨)'}`, `텔레그램 전송 가드: ${state.gateBlocked ? '막힘(운영 승인 전)' : '통과'} · 연결: ${state.paired ? '됨' : '안 됨'}`,
    state.last ? `마지막 실행 기록: ${Math.round((Date.now() - state.last.at) / 60000)}분 전 · ${state.last.status} (요청 ${state.last.requested})` : '마지막 실행 기록: 없음'];
  let body = `<section class="card"><div class="k">감시 상태(읽기 전용 진단)</div><ul class="warn" style="list-style:none;padding:0">${rows.map(li).join('')}</ul></section>`;
  if (ran && net) {
    const row = r => `<tr><td>${dashEsc(r.symbol)}</td><td>${dashEsc(r.source || '-')}</td><td>${r.totalMs}ms</td><td>${r.priceAgeSec === null ? '-' : r.priceAgeSec + '초'}</td><td>${r.bar1hAgeMin === null ? '-' : r.bar1hAgeMin + '분'}</td><td>${r.bar4hAgeMin === null ? '-' : r.bar4hAgeMin + '분'}</td><td>${r.ok ? '정상' : '<strong>실패</strong> ' + dashEsc(r.why)}</td></tr>`;
    const att = net.flatMap(r => r.attempts.map(a => `${r.symbol} ${a.src}: ${a.ms}ms · HTTP ${a.http.join('/')} · 티커 ${a.ticker ? 'ok' : 'bad'} · 봉 15m ${a.n['15m'] === undefined ? '캐시' : a.n['15m']}/1h ${a.n['1h'] === undefined ? '캐시' : a.n['1h']}/4h ${a.n['4h'] === undefined ? '캐시' : a.n['4h']}`));
    const allOk = net.length > 0 && net.every(r => r.ok);
    body += `<section class="card"><div class="k">시세 연결 점검 (캐시 없이 새로 조회 · 읽기 전용 · ${dashEsc(String(ms))}ms)</div><div class="v">${allOk ? '모두 정상' : '실패 있음'}</div><table><tr><th>종목</th><th>출처</th><th>응답</th><th>시세 나이</th><th>1h 봉</th><th>4h 봉</th><th>판정</th></tr>${net.map(row).join('')}</table><ul class="warn" style="list-style:none;padding:0">${att.map(li).join('')}</ul><div class="sub">판정 기준: 시세 10분 이내 · 마지막 마감 1h 봉 2시간 이내 · 4h 봉 8시간 이내 · 봉 55개 이상·끊김 없음 · 티커와 봉 가격 일치. 하나라도 어긋나면 그 종목은 감시에서 제외됩니다.</div></section>`;
  }
  if (ran && error) body += `<section class="card" role="alert"><p><strong>점검을 실행하지 못했습니다.</strong></p><p class="sub">오류 코드: ${dashEsc(error)}</p></section>`;
  if (result) {
    {
      const mk = (result.market || []).map(m => `${m.symbol}: ${m.ok ? `성공(${m.source}, 시세 ${m.ageSec}초 전, 봉 15m ${m.n15}/1h ${m.n1h}/4h ${m.n4h})` : `**실패** — ${m.why}`}`);
      const bt = Object.entries(result.byType || {}).map(([k, v]) => `${k} ${v}`).join(', ') || '없음', sb = Object.entries(result.skippedBy || {}).map(([k, v]) => `${k} ${v}`).join(', ') || '없음';
      const failed = result.marketFail > 0;
      body += `<section class="card"><div class="k">미리보기 결과 (전송 없음 · ${dashEsc(String(ms))}ms)</div><div class="v">${result.status === 'ok' ? (failed ? '시세 조회 실패 있음' : '정상') : result.status === 'idle' ? '보유 포지션 없음(시세 호출 없음)' : result.status === 'busy' ? '다른 감시 실행 중(잠시 후 다시)' : dashEsc(String(result.status))}</div><ul class="warn" style="list-style:none;padding:0">${[`감시 대상 포지션: ${result.positions || 0}건 (제외: ${sb})`, `계산된 이벤트: ${result.events || 0}건 (${bt})`, `시세 조회: ${failed ? `${result.marketFail}개 종목 실패` : (result.market && result.market.length ? '모두 성공' : '조회할 종목 없음')}`, ...mk.map(x => x.replace(/\*\*/g, ''))].map(li).join('')}</ul></section>`;
    }
  }
  const netUrl = shellUrl(appUrl, 'watch&net=1'), links = (runUrl ? `<a class="cta" target="_top" href="${dashEsc(runUrl)}">미리보기 실행(전송 없음)</a> ` : '') + (netUrl ? `<a class="cta" target="_top" href="${dashEsc(netUrl)}">시세 연결 점검</a>` : '');
  return shellPage('RICH300 감시 점검', `<header><h1>RICH 300 · 감시 점검</h1></header>${dashNav('', appUrl)}${body}<section class="card"><div class="sub">빌드 ${dashEsc(build)} · 이 화면은 텔레그램을 보내지 않고 트리거를 만들지 않으며 감시 설정을 바꾸지 않습니다. 미리보기는 거래소 공개 시세를 읽기만 합니다.</div>${links}</section>`);
}
// RICH300 전용 Telegram 연결 준비·진단(?p=tg): d = rich300TgDiagState_() 결과(존재 여부·코드만). 토큰·채팅 ID·봇 이름은 어디에도 표시하지 않는다(토큰은 입력창에서 서버로만 가며 화면에 되돌려 주지 않는다).
function shellRenderTgDiag({ d, check = null, nonce = null, pairCode = null, appUrl = '', build = 'dev' } = {}) {
  const li = t => `<li>${dashEsc(t)}</li>`, test = d.test || null, selfUrl = shellUrl(appUrl, 'tg');
  const stateText = !test ? '아직 보낸 적 없음' : { pending: '전송 중이었는데 결과를 기록하지 못함(상태 불명)', sent: '전송 API 성공 — 수신 확인 대기', failed: `전송 실패(${test.code || 'error'})`, acked: '전송 API 성공 + 사용자가 수신 확인함', unacked: '전송했으나 사용자가 못 받았다고 표시' }[test.state];
  const rows = [`환경: ${d.env || '미설정'}`, `봇 토큰 속성: ${d.tokenSet ? '있음' : '없음'}`, `운영 승인(RICH300_PROD_APPROVED): ${d.prodApproved ? '있음' : '없음'} — 감시·폴링·버튼 알림은 이것이 있어야 전송됩니다`, `테스트 전송 허용(RICH300_TG_TEST_OK): ${d.testAllow ? '허용됨' : '꺼짐'} — 읽기 점검·페어링 확인 1회·테스트 메시지 1건만 허용(그 밖은 계속 차단)`,
    `메시지 전송 가드(일반): ${d.gateSend ? `막힘(${d.gateSend})` : '통과'}`, `테스트 메시지 가드: ${d.gateTestSend ? `막힘(${d.gateTestSend})` : '통과'}`, `수신 계정 연결(페어링): ${d.paired ? '됨' : '안 됨'}${d.pairingActive ? ' · 페어링 코드 대기 중' : ''}`, `수신 폴링 트리거: ${d.pollTriggers ? d.pollTriggers + '개' : '없음'}`, d.lastPoll ? `마지막 폴링: ${d.lastPoll.ageMin}분 전 · ${d.lastPoll.status}` : '마지막 폴링: 기록 없음', `테스트 메시지: ${stateText}`];
  let body = `<section class="card"><div class="k">Telegram 연결 상태 (값 비노출)</div><ul class="warn" style="list-style:none;padding:0">${rows.map(li).join('')}</ul></section>`;
  if (check) body += `<section class="card"><div class="k">Telegram 읽기 점검 (getMe·getWebhookInfo 두 호출만 · 메시지 없음)</div><ul class="warn" style="list-style:none;padding:0">${(check.items || []).map(li).join('')}</ul></section>`;
  const canTest = !!nonce && !d.gateTestSend && d.paired && d.tokenSet && (!test || test.state === 'failed' || test.state === 'unacked'), waitingAck = !!test && (test.state === 'sent' || test.state === 'pending');
  const step = (n, title, inner) => `<div class="day"><div class="row"><strong>${n}. ${dashEsc(title)}</strong></div>${inner}</div>`;
  let steps = '';
  steps += step(1, '봇 토큰 등록', d.tokenSet ? '<div class="sub">완료 (값은 표시하지 않습니다)</div>' : '<div class="sub">BotFather 의 /mybots → 봇 선택 → API Token 값을 붙여 넣으세요. 화면에 다시 표시되지 않고 Script Properties 에만 저장됩니다. 채팅·URL·로그에 붙여 넣지 마세요.</div><input id="tok" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="123456789:AA…"><button id="tokBtn" class="cta" type="button">토큰 저장</button>');
  steps += step(2, '테스트 전송 허용 (운영 승인과 별개)', d.testAllow ? '<div class="sub">허용됨.</div><button id="allowOff" class="cta" type="button">허용 해제</button>' : (d.tokenSet ? '<div class="sub">테스트 목적의 getMe·페어링 확인·테스트 메시지 1건만 허용합니다. 감시·폴링·추천 알림은 계속 막힙니다. 아래 칸에 <strong>테스트 전송 허용</strong> 이라고 입력하세요.</div><input id="phrase" autocomplete="off" placeholder="테스트 전송 허용"><button id="allowOn" class="cta" type="button">허용</button>' : '<div class="sub">먼저 토큰을 등록하세요.</div>'));
  steps += step(3, '연결 읽기 점검', checkUrlBlock(d, selfUrl));
  steps += step(4, '소유자 Telegram 계정 페어링', d.paired ? '<div class="sub">완료.</div>' : (d.tokenSet && d.testAllow ? `<div class="sub">① 코드를 만들고 ② Telegram 에서 이 봇에게 <code>/start 코드</code> 를 보낸 뒤(10분 이내, 개인 대화) ③ 확인을 누르세요. 확인은 1회 조회이며 메시지를 보내지 않습니다.</div><button id="pairStart" class="cta" type="button">코드 만들기</button> <button id="pairCheck" class="cta" type="button">페어링 확인</button>${pairCode ? `<div class="v">${dashEsc(pairCode)}</div>` : ''}<div id="codeBox" class="v"></div>` : '<div class="sub">토큰 등록과 테스트 전송 허용이 필요합니다.</div>'));
  steps += step(5, '테스트 메시지 1건', canTest ? `<div class="sub">[RICH300 TEST] 메시지를 <strong>딱 1건</strong> 보냅니다. 버튼은 한 번만 눌러 주세요(연타해도 서버가 한 번만 보냅니다).</div><button id="sendTest" class="cta" type="button">테스트 메시지 1건 보내기</button>` : (waitingAck ? '<div class="sub">전송했습니다. Telegram 에서 [RICH300 TEST] 를 확인하세요. 이 화면은 다시 보내지 않습니다.</div>' : `<div class="sub">${d.gateTestSend ? '테스트 전송 허용이 필요합니다.' : !d.paired ? '페어링이 필요합니다.' : test && test.state === 'acked' ? '완료.' : '대기 중.'}</div>`));
  steps += step(6, '수신 확인', waitingAck ? '<div class="sub">메시지를 받으셨나요?</div><button id="ackYes" class="cta" type="button">받았음</button> <button id="ackNo" class="cta" type="button">못 받음</button>' : `<div class="sub">${test && test.state === 'acked' ? '수신 확인됨.' : '전송 후에 표시됩니다.'}</div>`);
  const script = `<script>(function(){var m=document.getElementById('msg');function say(t){m.textContent=t}function $(i){return document.getElementById(i)}
var call=function(fn,args,ok){say('처리 중…');var r=google.script.run.withSuccessHandler(function(x){ok(x||{})}).withFailureHandler(function(){say('연결 오류 — 결과가 불확실합니다. 새로고침해서 상태를 확인하세요(자동 재시도 없음).')});r[fn].apply(r,args)};
var done=function(t){say(t+' 아래 새로고침을 눌러 상태를 확인하세요.');var a=$('reload');if(a)a.hidden=false};
if($('tokBtn'))$('tokBtn').onclick=function(){var v=$('tok').value;$('tok').value='';$('tokBtn').disabled=true;call('rich300TgSetToken',[v],function(r){done(r.ok?'토큰을 저장했습니다.':'저장하지 않음: '+(r.code||'error'))})};
if($('allowOn'))$('allowOn').onclick=function(){var v=$('phrase').value;$('phrase').value='';call('rich300TgSetTestAllow',[true,v],function(r){done(r.ok?'테스트 전송 허용을 켰습니다.':'변경하지 않음: '+(r.code||'error'))})};
if($('allowOff'))$('allowOff').onclick=function(){call('rich300TgSetTestAllow',[false,''],function(r){done('테스트 전송 허용을 껐습니다.')})};
if($('pairStart'))$('pairStart').onclick=function(){call('rich300TgPairStart',[],function(r){if(r.ok){$('codeBox').textContent=r.pairCode;say('이 코드를 Telegram 의 봇 대화에 /start '+r.pairCode+' 로 보내고(10분 이내) “페어링 확인”을 누르세요.')}else say('만들지 않음: '+(r.code||'error'))})};
if($('pairCheck'))$('pairCheck').onclick=function(){call('rich300TgPairCheck',[],function(r){if(r.ok&&r.code==='paired')done('페어링되었습니다.');else say(r.ok?'아직 메시지를 찾지 못했습니다('+r.code+'). 봇에게 /start 코드 를 보낸 뒤 다시 눌러 주세요.':'확인하지 못함: '+(r.code||'error'))})};
if($('sendTest'))$('sendTest').onclick=function(){$('sendTest').disabled=true;call('rich300TgTestSend',[${JSON.stringify(String(nonce || '')).replace(/</g, '\\u003c')}],function(r){done(r.ok?'전송 API 성공(Telegram이 메시지를 받았습니다). Telegram 에서 [RICH300 TEST] 를 확인하고 “받았음/못 받음”을 눌러 주세요.':'보내지 않았거나 실패: '+(r.code||'error'))})};
if($('ackYes'))$('ackYes').onclick=function(){call('rich300TgTestAck',[true],function(){done('수신 확인을 기록했습니다.')})};
if($('ackNo'))$('ackNo').onclick=function(){call('rich300TgTestAck',[false],function(){done('미수신으로 기록했습니다(1회 더 시도할 수 있습니다).')})};
})()</script>`;
  return `${dashHead('RICH300 텔레그램 점검')}<body><main><header><h1>RICH 300 · 텔레그램 연결</h1></header>${dashNav('', appUrl)}${body}<section class="card"><div class="k">연결 준비 순서</div>${steps}<div id="msg" class="sub" role="status"></div>${selfUrl ? `<a id="reload" hidden class="cta" target="_top" href="${dashEsc(selfUrl)}">새로고침</a>` : ''}<div class="sub">빌드 ${dashEsc(build)} · 이 화면은 감시 알림·폴링 트리거·자동 전송을 켜지 않습니다. 테스트 메시지는 추천·매매 알림이 아닙니다.</div></section></main>${script}</body></html>`;
}
const checkUrlBlock = (d, selfUrl) => { const u = selfUrl ? `${selfUrl}&check=1` : null; return d.tokenSet && !d.gateRead && u ? `<a class="cta" target="_top" href="${dashEsc(u)}">읽기 점검(getMe)</a>` : `<div class="sub">${!d.tokenSet ? '먼저 토큰을 등록하세요.' : '테스트 전송 허용(또는 읽기 점검 허용) 후에 사용할 수 있습니다.'}</div>`; };

// ── schema.mjs ──
// RICH 300 저장소 스키마: 엔티티 정의·검증·정규화. 순수 함수(저장소·시간 의존 없음).
//  · 모든 금액·가격·수량은 *정규 십진 문자열*로 저장한다("100.0"·100·"100" → "100"), 부동소수·BigInt 미사용 → 같은 값은 항상 같은 기록(중복 판정 일관).
//  · 기본값으로 기록을 만들지 않는다: 복기는 계획 준수·심리를 *명시적으로* 모두 받아야 저장된다.

const SCHEMA_VERSION = 1;
class StoreError extends Error { constructor(code, message, detail) { super(message); this.code = code; this.detail = (detail != null ? detail : null); } }
const PLAN_CHOICES = Object.freeze({ plan_ok: '계획대로 진입·청산', early_exit: '조기 청산', chase_or_average_down: '추격 진입·물타기', other_violation: '기타 위반' });
const MIND_CHOICES = Object.freeze({ calm: '침착', anxious_rushed: '불안·조급', revenge: '손실 복구 욕심', greedy: '욕심' });
const RESPONSE_CHOICES = Object.freeze({ entered: '진입했어', watched: '관망했어', missed: '놓쳤어' });
const SETTING_DEFAULTS = Object.freeze({ backupKeep: '8', backupTelegramCsv: 'off', closeNotify: 'off' });
const bad = (m, d) => { throw new StoreError('VALIDATION', m, d); };

function schemaDecString(x, name, { positive = false, nonNegative = false, nonZero = false } = {}) {
  let v; try { v = dec(x); } catch (e) { bad(`${name}: ${e.message}`); }
  if (positive && decSign(v) <= 0) bad(`${name}은 0보다 커야 함`);
  if (nonNegative && decSign(v) < 0) bad(`${name}은 0 이상이어야 함`);
  if (nonZero && decSign(v) === 0) bad(`${name}은 0일 수 없음`);
  const s = decFormat(v, 12); return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}
const optDec = (x, name, o) => (x === undefined || x === null || x === '' ? undefined : schemaDecString(x, name, o));
const needStr = (x, name, max = 200) => { if (typeof x !== 'string' || !x.trim() || x.length > max) bad(`${name} 필요(1~${max}자)`); return x; };
const needMs = (x, name) => { if (!Number.isInteger(x) || x < 0) bad(`${name}: 정수 ms 시각 필요`); return x; };
const needDay = (x, name) => { if (!isDayString(x)) bad(`${name}: YYYY-MM-DD 필요`); return x; };
const needEnum = (x, set, name) => { if (!Object.prototype.hasOwnProperty.call(set, x) && !(Array.isArray(set) && set.includes(x))) bad(`${name} 값 오류`); return x; };
const needIntStr = (x, name) => { if (typeof x !== 'string' || !/^-?\d{1,18}$/.test(x)) bad(`${name}: 정수 문자열 필요`); return x; };
const needFlags = (x, name) => { if (x === undefined) return undefined; if (!Array.isArray(x) || x.length > 20 || x.some(f => typeof f !== 'string' || !/^[a-z0-9-]{1,40}$/.test(f))) bad(`${name} 형식 오류`); return [...x]; };
const strip = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const kst = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');

const ENTITIES = {
  challenge: { sheet: 'Challenge', immutable: true, keyOf: () => 'challenge', headers: ['startEquity', 'startDay'],
    normalize: d => strip({ startEquity: schemaDecString(d.startEquity, 'startEquity', { positive: true }), startDay: needDay(d.startDay, 'startDay'), timezone: 'Asia/Seoul', dayCloseHourKst: 0 }), display: d => [d.startEquity, d.startDay] },
  rate: { sheet: 'Rates', keyOf: d => `rate:${d.from}`, headers: ['from', 'rate'],
    normalize: d => { needDay(d.from, 'from'); const r = String(d.rate); try { rateFraction(r); } catch (e) { bad(`rate: ${e.message}`); } return { from: d.from, rate: schemaDecString(r, 'rate', { nonNegative: true }) }; }, display: d => [d.from, d.rate] },
  setting: { sheet: 'Settings', keyOf: d => `setting:${d.name}`, headers: ['name', 'value'],
    normalize: d => { needEnum(d.name, SETTING_DEFAULTS, 'setting name'); const v = String(d.value); if (d.name === 'backupKeep') { if (!/^\d+$/.test(v) || +v < 1 || +v > 30) bad('backupKeep은 1~30'); } else if (v !== 'on' && v !== 'off') bad(`${d.name}은 on/off`); return { name: d.name, value: v }; }, display: d => [d.name, d.value] },
  signal: { sheet: 'Signals', immutable: true, keyOf: d => d.sid, headers: ['sid', 'strategy', 'dir', 'symbol', 'signalAtKst'],
    normalize: d => strip({ sid: needStr(d.sid, 'sid', 80), strategy: needEnum(d.strategy, ['A', 'B', 'S'], 'strategy'), symbolId: /^[A-Z0-9]{2,20}USDT$/.test((d.symbolId != null ? d.symbolId : '')) ? d.symbolId : bad('symbolId 형식 오류'), dir: needEnum(d.dir, ['LONG', 'SHORT'], 'dir'),
      signalAt: needMs(d.signalAt, 'signalAt'), entry: schemaDecString(d.entry, 'entry', { positive: true }), stop: schemaDecString(d.stop, 'stop', { positive: true }), tp1: schemaDecString(d.tp1, 'tp1', { positive: true }), tp2: optDec(d.tp2, 'tp2', { positive: true }), score: d.score === undefined ? undefined : (Number.isInteger(d.score) && d.score >= 0 && d.score <= 100 ? d.score : bad('score는 0~100 정수')), summary: d.summary === undefined ? undefined : needStr(d.summary, 'summary', 120) }),
    display: d => [d.sid, d.strategy, d.dir, d.symbolId, kst(d.signalAt)] },
  response: { sheet: 'Responses', keyOf: d => d.sid, headers: ['sid', 'choice', 'atKst'],
    normalize: d => ({ sid: needStr(d.sid, 'sid', 80), choice: needEnum(d.choice, RESPONSE_CHOICES, 'choice'), at: needMs(d.at, 'at') }), display: d => [d.sid, d.choice, kst(d.at)] },
  fill: { sheet: 'Fills', keyOf: d => d.fillId, headers: ['sid', 'kind', 'dir', 'atKst', 'price', 'qty'],
    normalize: d => {
      if (d.origin !== 'real') bad(`실제 체결만 저장(origin=real): ${d.origin}`);
      const price = schemaDecString(d.price, 'price', { positive: true }), qty = schemaDecString(d.qty, 'qty', { positive: true });
      const amt = (a, n, nn) => { const st = ((a == null ? undefined : a.state) != null ? (a == null ? undefined : a.state) : 'missing'); if (!['entered', 'estimated', 'missing'].includes(st)) bad(`${n} 상태 오류`); return st === 'missing' ? { state: 'missing' } : { state: st, amount: schemaDecString(a.amount, `${n} 금액`, nn ? { nonNegative: true } : {}) }; };
      const out = strip({ origin: 'real', fillId: needStr(d.fillId, 'fillId', 80), sid: needStr(d.sid, 'sid', 80), kind: d.kind, dir: d.dir, at: needMs(d.at, 'at'), price, qty,
        margin: optDec(d.margin, 'margin', { positive: true }), leverage: optDec(d.leverage, 'leverage', { positive: true }), plannedStop: optDec(d.plannedStop, 'plannedStop', { positive: true }), qtySource: d.qtySource === undefined ? undefined : needEnum(d.qtySource, ['entered', 'derived'], 'qtySource'),
        fee: amt(d.fee, '수수료', true), funding: amt(d.funding, '펀딩', false), note: d.note === undefined ? undefined : needStr(d.note, 'note', 300) });
      try { pnlNormalizeFill(out); } catch (e) { bad(e.message); } return out;
    }, display: d => [d.sid, d.kind, d.dir, kst(d.at), d.price, d.qty] },
  cashflow: { sheet: 'Cashflows', keyOf: d => d.cfId, headers: ['atKst', 'amount'],
    normalize: d => strip({ cfId: needStr(d.cfId, 'cfId', 80), at: needMs(d.at, 'at'), amount: schemaDecString(d.amount, 'amount', { nonZero: true }), note: d.note === undefined ? undefined : needStr(d.note, 'note', 200) }), display: d => [kst(d.at), d.amount] },
  equity: { sheet: 'Equity', keyOf: d => d.day, headers: ['day', 'equity', 'unrealized', 'late'],
    normalize: d => strip({ day: needDay(d.day, 'day'), equity: schemaDecString(d.equity, 'equity', { nonNegative: true }), unrealized: optDec(d.unrealized, 'unrealized'), late: d.late === true ? true : undefined, enteredAt: d.enteredAt === undefined ? undefined : needMs(d.enteredAt, 'enteredAt') }), display: d => [d.day, d.equity, (d.unrealized != null ? d.unrealized : ''), d.late ? 'late' : ''] },
  opening: { sheet: 'OpeningPositions', keyOf: d => d.sid, headers: ['sid', 'dir', 'qty', 'startMark', 'origEntry'],
    normalize: d => strip({ sid: needStr(d.sid, 'sid', 80), dir: needEnum(d.dir, ['LONG', 'SHORT'], 'dir'), qty: schemaDecString(d.qty, 'qty', { positive: true }), startMark: schemaDecString(d.startMark, 'startMark', { positive: true }), origEntry: optDec(d.origEntry, 'origEntry', { positive: true }) }), display: d => [d.sid, d.dir, d.qty, d.startMark, (d.origEntry != null ? d.origEntry : '')] },
  review: { sheet: 'Reviews', keyOf: d => d.sid, headers: ['sid', 'plan', 'mind', 'savedAtKst'],
    normalize: d => strip({ sid: needStr(d.sid, 'sid', 80), plan: needEnum(d.plan, PLAN_CHOICES, '계획 준수'), mind: needEnum(d.mind, MIND_CHOICES, '심리 상태'), memo: d.memo === undefined || d.memo === '' ? undefined : needStr(d.memo, 'memo', 500), savedAt: needMs(d.savedAt, 'savedAt') }), display: d => [d.sid, d.plan, d.mind, kst(d.savedAt)] },
  adjustment: { sheet: 'Adjustments', keyOf: d => d.adjId, headers: ['atKst', 'amount', 'reason'],
    normalize: d => ({ adjId: needStr(d.adjId, 'adjId', 80), at: needMs(d.at, 'at'), amount: schemaDecString(d.amount, 'amount', { nonZero: true }), reason: needStr(d.reason, '조정 사유', 200) }), display: d => [kst(d.at), d.amount, d.reason] },
  // R7 일 마감: 마감 시점의 스냅샷(불변, 같은 날짜는 한 번만) · 마감 알림 상태(리비전으로 pending→sent/failed)
  dayclose: { sheet: 'DayCloses', immutable: true, keyOf: d => d.day, headers: ['day', 'closedAtKst', 'source', 'diff'],
    normalize: d => strip({ day: needDay(d.day, 'day'), closedAt: needMs(d.closedAt, 'closedAt'), source: needEnum(d.source, ['input', 'ledger'], 'source'), startMicro: needIntStr(d.startMicro, 'startMicro'), targetMicro: needIntStr(d.targetMicro, 'targetMicro'),
      closeMicro: needIntStr(d.closeMicro, 'closeMicro'), pnlMicro: needIntStr(d.pnlMicro, 'pnlMicro'), walletMicro: needIntStr(d.walletMicro, 'walletMicro'), diffMicro: d.diffMicro === undefined || d.diffMicro === null ? undefined : needIntStr(d.diffMicro, 'diffMicro'), needsReview: d.needsReview === true, flags: needFlags(d.flags, 'flags') }),
    display: d => [d.day, kst(d.closedAt), d.source, (d.diffMicro != null ? d.diffMicro : '')] },
  closenotice: { sheet: 'CloseNotices', keyOf: d => d.day, headers: ['day', 'status', 'attempts'],
    normalize: d => { const n = d.attempts; if (!Number.isInteger(n) || n < 0 || n > 9) bad('attempts는 0~9 정수'); return strip({ day: needDay(d.day, 'day'), status: needEnum(d.status, ['pending', 'sent', 'failed', 'off', 'unknown'], 'status'), attempts: n, at: needMs(d.at, 'at'), error: d.error === undefined || d.error === null ? undefined : needStr(String(d.error), 'error', 40) }); },
    display: d => [d.day, d.status, String(d.attempts)] },
  // 분할 진입·익절 계획의 *입력*(불변): 첫 진입 기록 때 한 번 저장한다. 계획 자체는 이 값과 결정적 계산(scaleplan.mjs)으로 언제든 같은 결과로 다시 만든다.
  plan: { sheet: 'Plans', immutable: true, keyOf: d => d.sid, headers: ['sid', 'equity', 'entry', 'stop', 'lev', 'stages'],
    normalize: d => { if (![2, 3].includes(d.lev)) bad('lev는 2 또는 3'); if (![1, 2, 3].includes(d.stages)) bad('stages는 1~3'); return { sid: needStr(d.sid, 'sid', 80), equity: schemaDecString(d.equity, 'equity', { positive: true }), entry: schemaDecString(d.entry, 'entry', { positive: true }), stop: schemaDecString(d.stop, 'stop', { positive: true }), lev: d.lev, stages: d.stages, at: needMs(d.at, 'at') }; },
    display: d => [d.sid, d.equity, d.entry, d.stop, String(d.lev), String(d.stages)] },
  tgupdate: { sheet: 'TgUpdates', immutable: true, keyOf: d => `${d.kind}:${d.id}`, headers: ['kind', 'id'],
    normalize: d => ({ kind: needEnum(d.kind, ['u', 'cb'], 'kind'), id: needStr(String(d.id), 'id', 80), at: needMs(d.at, 'at') }), display: d => [d.kind, d.id] },
};
const ENTITY_NAMES = Object.keys(ENTITIES);
const AUDIT_SHEET = 'Audit', META_SHEET = 'Meta';
const VIEW_HEADERS = e => ['key', 'rev', 'void', 'recordedAt', 'data', ...ENTITIES[e].headers];
const AUDIT_HEADERS = ['seq', 'recordedAt', 'entity', 'key', 'rev', 'op', 'actor', 'reason', 'before', 'after', 'prevHash', 'hash'];
const META_HEADERS = ['key', 'value', 'recordedAt'];

// ── store.mjs ──
// RICH 300 저장소(Google Sheets 위의 추가 전용 기록). 시트 접근은 env 포트로 주입받으므로 같은 코드를 Node 테스트(메모리 시트)와 Apps Script(SpreadsheetApp)가 쓴다.
//  env = { now(): ms, sha256(str): hex, lock: { tryLock(ms): boolean, release() }, sheets: { ensure(name, headers), rows(name): string[][] (헤더 제외), append(name, rows[][]) } }
//  선택 포트(성능, 없으면 전체 읽기로 대체): sheets.tail(name, n) 마지막 n행만 · sheets.version(name) 시트가 바뀔 때마다 커지는 수(파싱 결과 캐시 기준) · sheets.flush() · initCache{get,put} 초기화 확인 표시(스키마 버전별).
//  · 추가 전용: 엔티티 시트는 *모든 리비전*을 행으로 쌓는다(삭제·덮어쓰기 없음). 현재 값은 키별 최대 rev. 취소는 void 리비전.
//  · 선기록(WAL): 쓰기 = ① Audit 행 추가(해시 체인, 변경 후 전체 내용 포함) → ② 엔티티 시트 행 추가. ②에서 중단돼도 다음 쓰기·읽기가 Audit의 끝부분에서 복구한다. 먼저 ①이 실패하면 아무것도 바뀌지 않는다.
//  · 모든 쓰기는 스크립트 락 안에서 직렬화한다. 락을 못 얻으면 LOCK 오류(호출자가 재시도, 같은 키는 멱등).
//  · 데이터 JSON은 정규 십진 문자열 + 키 정렬 JSON → 같은 내용은 같은 문자열(중복·변조 판정이 결정적).

const STORE_ZERO_HASH = '0'.repeat(64), STORE_TAIL = 5, STORE_VIEW_TAIL = 50, STORE_RECOVER = 2;
const storeEntity = n => (ENTITIES[n] != null ? ENTITIES[n] : (() => { throw new StoreError('VALIDATION', `알 수 없는 엔티티: ${n}`); })());
const storeCell = v => { if (v instanceof Date) throw new StoreError('INTEGRITY', 'Date로 변환된 셀 — 시트 열을 텍스트 서식으로 지정해야 함'); return v === null || v === undefined ? '' : String(v); };
const storeParse = (s, where) => { try { return JSON.parse(s); } catch (e_) { throw new StoreError('INTEGRITY', `JSON 손상: ${where}`); } };
const storeInt = (v, where) => { const n = Number(storeCell(v)); if (!Number.isInteger(n)) throw new StoreError('INTEGRITY', `정수 아님: ${where}`); return n; };

function storeInit(env, { force = false } = {}) {
  const ck = `store-init:v${SCHEMA_VERSION}`;                // 이미 확인한 시트는 매 요청마다 14개 시트의 머리글을 다시 읽지 않는다(health 화면은 force 로 다시 확인)
  if (!force && env.initCache && env.initCache.get(ck) === '1') return;
  for (const n of ENTITY_NAMES) env.sheets.ensure(storeEntity(n).sheet, VIEW_HEADERS(n));
  env.sheets.ensure(AUDIT_SHEET, AUDIT_HEADERS); env.sheets.ensure(META_SHEET, META_HEADERS);
  const ver = env.sheets.rows(META_SHEET).filter(r => storeCell(r[0]) === 'schemaVersion').map(r => storeCell(r[1])).pop();
  if (ver === undefined) env.sheets.append(META_SHEET, [['schemaVersion', String(SCHEMA_VERSION), String(env.now())]]);
  else if (Number(ver) !== SCHEMA_VERSION) throw new StoreError('SCHEMA', `스키마 버전 불일치: ${ver} (기대 ${SCHEMA_VERSION})`);
  if (env.sheets.flush) env.sheets.flush();
  if (env.initCache) env.initCache.put(ck, '1', 3600);
}

// ── 읽기 ──
const storeAuditRowOf = (r, i) => ({ seq: storeInt(r[0], `audit[${i}].seq`), recordedAt: storeInt(r[1], `audit[${i}].at`), entity: storeCell(r[2]), key: storeCell(r[3]), rev: storeInt(r[4], `audit[${i}].rev`), op: storeCell(r[5]),
  actor: storeCell(r[6]), reason: storeCell(r[7]), before: storeCell(r[8]), after: storeCell(r[9]), prevHash: storeCell(r[10]), hash: storeCell(r[11]) });
function storeReadAudit(env) { return env.sheets.rows(AUDIT_SHEET).map(storeAuditRowOf); }
const storeTailRows = (env, sheet, n) => (env.sheets.tail ? env.sheets.tail(sheet, n) : env.sheets.rows(sheet).slice(-n));      // 끝부분만 필요할 때 시트 전체를 읽지 않는다
const storeReadAuditTail = (env, n = STORE_TAIL) => storeTailRows(env, AUDIT_SHEET, n).map(storeAuditRowOf);
const storeViewRowOf = (entityName, r, i) => ({ key: storeCell(r[0]), rev: storeInt(r[1], `${entityName}[${i}].rev`), void: storeCell(r[2]) === '1', recordedAt: storeInt(r[3], `${entityName}[${i}].at`), raw: storeCell(r[4]), data: storeParse(storeCell(r[4]), `${entityName}[${i}]`) });
const storeViewMemo = new WeakMap();                       // env → 엔티티별 {ver, out}: 시트가 바뀌지 않았으면(version 같음) 같은 요청 안에서 JSON 파싱을 반복하지 않는다. 읽기 전용 배열이므로 호출자는 수정하지 않는다
function storeReadView(env, entityName) {
  const sheet = storeEntity(entityName).sheet, ver = env.sheets.version ? env.sheets.version(sheet) : null;
  if (ver !== null) { const hit = storeViewMemo.get(env) && storeViewMemo.get(env).get(sheet); if (hit && hit.ver === ver) return hit.out; }
  const out = env.sheets.rows(sheet).map((r, i) => storeViewRowOf(entityName, r, i));
  if (ver !== null) { if (!storeViewMemo.has(env)) storeViewMemo.set(env, new Map()); storeViewMemo.get(env).set(sheet, { ver: env.sheets.version(sheet), out }); }
  return out;
}
const storeReadViewTail = (env, entityName, n) => storeTailRows(env, storeEntity(entityName).sheet, n).map((r, i) => storeViewRowOf(entityName, r, i));
function storeLatestMap(env, entityName, audit) {      // 엔티티 시트 + 아직 반영되지 않은 Audit 끝부분(복구 대기)을 합쳐 키별 최신 리비전
  const m = new Map(), put = r => { const p = m.get(r.key); if (!p || r.rev > p.rev) m.set(r.key, r); };
  const have = new Set();
  for (const r of storeReadView(env, entityName)) { put(r); have.add(`${r.key}|${r.rev}`); }
  for (const e of audit.slice(-STORE_TAIL)) if (e.entity === entityName && !have.has(`${e.key}|${e.rev}`)) put({ key: e.key, rev: e.rev, void: e.op === 'void', recordedAt: e.recordedAt, raw: e.after, data: storeParse(e.after, `audit#${e.seq}`), pending: true });
  return m;
}
const storeGet = (env, entityName, key) => nullishOr(storeLatestMap(env, entityName, storeReadAuditTail(env)).get(key), null);
function storeList(env, entityName, { includeVoid = false } = {}) {
  const out = [...storeLatestMap(env, entityName, storeReadAuditTail(env)).values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return includeVoid ? out : out.filter(r => !r.void);
}
function storeHistory(env, entityName, key) {
  const audit = storeReadAuditTail(env), seen = new Map();
  for (const r of storeReadView(env, entityName)) if (r.key === key) seen.set(r.rev, r);
  for (const e of audit.slice(-STORE_TAIL)) if (e.entity === entityName && e.key === key && !seen.has(e.rev)) seen.set(e.rev, { key, rev: e.rev, void: e.op === 'void', recordedAt: e.recordedAt, raw: e.after, data: storeParse(e.after, `audit#${e.seq}`), pending: true });
  return [...seen.values()].sort((a, b) => a.rev - b.rev);
}

// ── 쓰기 ──
const storeHash = (env, e) => env.sha256([e.prevHash, e.seq, e.recordedAt, e.entity, e.key, e.rev, e.op, e.actor, e.after].join('|'));
const storeAuditRow = e => [String(e.seq), String(e.recordedAt), e.entity, e.key, String(e.rev), e.op, e.actor, e.reason, e.before, e.after, e.prevHash, e.hash];
const storeViewRow = (e, data) => [e.key, String(e.rev), e.op === 'void' ? '1' : '0', String(e.recordedAt), e.after, ...storeEntity(e.entity).display(data)];
function storeApplyView(env, e) { env.sheets.append(storeEntity(e.entity).sheet, [storeViewRow(e, storeParse(e.after, `audit#${e.seq}`))]); }
function storeRecoverTail(env) {                       // 이전 쓰기가 ②에서 중단됐다면 Audit 끝부분에서 엔티티 행을 복원한다(멱등)
  const fixed = [];
  for (const e of storeReadAuditTail(env, STORE_RECOVER)) {      // 쓰기는 항상 Audit→엔티티 순이고 다음 쓰기가 락 안에서 먼저 복구하므로, 끝나지 않은 쓰기는 마지막 항목뿐이다(여유로 2개 확인)
    const has = storeReadViewTail(env, e.entity, STORE_VIEW_TAIL).some(r => r.key === e.key && r.rev === e.rev);      // 최근 쓰기의 엔티티 행은 해당 시트 끝에 있다(Audit 순서 = 시트 추가 순서)
    if (!has) { storeApplyView(env, e); fixed.push(`${e.entity}|${e.key}|${e.rev}`); }
  }
  return fixed;
}
function storeWithLock(env, fn) {
  if (env.__lockDepth > 0) return fn([]);                // 같은 요청 안에서 이미 락을 쥐고 있으면(여러 기록을 한 번에 저장하는 묶음) 다시 잡지 않는다 — 락·flush 는 바깥에서 한 번
  if (!env.lock.tryLock((env.lockTimeoutMs != null ? env.lockTimeoutMs : 10000))) throw new StoreError('LOCK', '다른 작업이 저장 중입니다(잠시 후 재시도)');
  env.__lockDepth = 1;
  try { const recovered = storeRecoverTail(env); return fn(recovered); } finally { env.__lockDepth = 0; env.lock.release(); }
}
function storeCommit(env, { entity, key, rev, op, actor, reason, before, after }) {
  if (typeof actor !== 'string' || !actor) throw new StoreError('VALIDATION', 'actor 필요');
  const last = storeReadAuditTail(env, 1)[0];
  const e = { seq: last ? last.seq + 1 : 1, recordedAt: env.now(), entity, key, rev, op, actor, reason: (reason != null ? reason : ''), before: before ? dedupeCanonical(before) : '', after: dedupeCanonical(after), prevHash: last ? last.hash : STORE_ZERO_HASH };
  e.hash = storeHash(env, e);
  env.sheets.append(AUDIT_SHEET, [storeAuditRow(e)]);   // ① 선기록(여기서 실패하면 변경 없음)
  storeApplyView(env, e);                                // ② 엔티티 행(여기서 중단돼도 다음 쓰기/읽기가 복구)
  return e;
}
function storeCreate(env, entityName, raw, { actor }) {
  const E = storeEntity(entityName), data = E.normalize(raw), key = E.keyOf(data);
  return storeWithLock(env, () => {
    const cur = storeLatestMap(env, entityName, storeReadAuditTail(env)).get(key);
    if (cur && !cur.void) return { status: dedupeCanonical(cur.data) === dedupeCanonical(data) ? 'duplicate' : 'conflict', key, rev: cur.rev };
    if (cur && cur.void && E.immutable) return { status: 'conflict', key, rev: cur.rev };
    const rev = cur ? cur.rev + 1 : 1;
    storeCommit(env, { entity: entityName, key, rev, op: 'create', actor, after: data });
    return { status: 'added', key, rev };
  });
}
function storeRevise(env, entityName, key, patch, { actor, reason }) {
  const E = storeEntity(entityName); if (E.immutable) throw new StoreError('IMMUTABLE', `${entityName}은 수정할 수 없음(시작 설정·신호·수신 기록은 보존)`);
  if (!reason || typeof reason !== 'string') throw new StoreError('VALIDATION', '수정 사유 필요');
  return storeWithLock(env, () => {
    const cur = storeLatestMap(env, entityName, storeReadAuditTail(env)).get(key);
    if (!cur) throw new StoreError('NOT_FOUND', `수정 대상 없음: ${entityName}/${key}`);
    if (cur.void) throw new StoreError('VOID', `취소된 기록은 수정할 수 없음: ${key}`);
    const merged = { ...cur.data }; for (const [k, v] of Object.entries(patch)) { if (v === null) delete merged[k]; else merged[k] = v; }
    const data = E.normalize(merged);
    if (E.keyOf(data) !== key) throw new StoreError('VALIDATION', '키는 수정할 수 없음');
    if (dedupeCanonical(data) === dedupeCanonical(cur.data)) return { status: 'unchanged', key, rev: cur.rev };
    storeCommit(env, { entity: entityName, key, rev: cur.rev + 1, op: 'revise', actor, reason, before: cur.data, after: data });
    return { status: 'revised', key, rev: cur.rev + 1 };
  });
}
function storeVoid(env, entityName, key, { actor, reason }) {
  const E = storeEntity(entityName); if (E.immutable) throw new StoreError('IMMUTABLE', `${entityName}은 취소할 수 없음`);
  if (!reason || typeof reason !== 'string') throw new StoreError('VALIDATION', '취소 사유 필요');
  return storeWithLock(env, () => {
    const cur = storeLatestMap(env, entityName, storeReadAuditTail(env)).get(key);
    if (!cur) throw new StoreError('NOT_FOUND', `취소 대상 없음: ${entityName}/${key}`);
    if (cur.void) return { status: 'unchanged', key, rev: cur.rev };
    storeCommit(env, { entity: entityName, key, rev: cur.rev + 1, op: 'void', actor, reason, before: cur.data, after: cur.data });
    return { status: 'voided', key, rev: cur.rev + 1 };
  });
}
// 텔레그램 update_id·callback_query.id 선점: 처음이면 true(처리), 이미 있으면 false(무시)
const storeClaimUpdate = (env, kind, id, actor) => storeCreate(env, 'tgupdate', { kind, id: String(id), at: env.now() }, { actor }).status === 'added';
// 복기 저장: 계획 준수·심리를 *명시적으로* 받아야만 기록(기본값 자동 저장 없음). 같은 내용 재저장은 변경 없음.
function storeSaveReview(env, { sid, plan, mind, memo }, { actor }) {
  const savedAt = env.now(), cur = storeGet(env, 'review', sid), next = { sid, plan, mind, memo, savedAt };
  if (!cur || cur.void) return storeCreate(env, 'review', next, { actor });
  if (cur.data.plan === plan && cur.data.mind === mind && ((cur.data.memo != null ? cur.data.memo : '')) === ((memo != null ? memo : ''))) return { status: 'unchanged', key: sid, rev: cur.rev };
  return storeRevise(env, 'review', sid, { plan, mind, memo: memo ? memo : null, savedAt }, { actor, reason: '복기 수정' });
}
function storeSetupChallenge(env, { startEquity, startDay, rate }, { actor }) {
  const a = storeCreate(env, 'challenge', { startEquity, startDay }, { actor });
  if (a.status === 'conflict') return a;                // 시작 자금·시작일은 보존: 다른 값으로 다시 만들 수 없다
  const r = storeCreate(env, 'rate', { from: startDay, rate }, { actor });
  return { status: a.status === 'added' || r.status === 'added' ? 'added' : 'duplicate', challenge: a, rate: r };
}
function storeGetSettings(env) {
  const out = { ...SETTING_DEFAULTS }; for (const r of storeList(env, 'setting')) out[r.data.name] = r.data.value; return out;
}

// ── 무결성·복구 ──
function storeIntegrityCheck(env) {
  const issues = [], audit = storeReadAudit(env), canon = new Map();
  let prevHash = STORE_ZERO_HASH; const lastRev = new Map();
  audit.forEach((e, i) => {
    if (e.seq !== i + 1) issues.push({ type: 'audit-seq-gap', seq: e.seq, expected: i + 1 });
    if (e.prevHash !== prevHash) issues.push({ type: 'audit-chain-broken', seq: e.seq });
    if (storeHash(env, e) !== e.hash) issues.push({ type: 'audit-hash-mismatch', seq: e.seq });
    const kk = `${e.entity}|${e.key}`, exp = (nullishOr(lastRev.get(kk), 0)) + 1;
    if (e.rev !== exp) issues.push({ type: 'rev-gap', entity: e.entity, key: e.key, rev: e.rev, expected: exp }); lastRev.set(kk, e.rev);
    canon.set(`${e.entity}|${e.key}|${e.rev}`, e); prevHash = e.hash;
  });
  const seenRows = new Set();
  for (const n of ENTITY_NAMES) for (const r of storeReadView(env, n)) {
    const id = `${n}|${r.key}|${r.rev}`, a = canon.get(id);
    if (seenRows.has(id)) issues.push({ type: 'duplicate-view-row', entity: n, key: r.key, rev: r.rev }); seenRows.add(id);
    if (!a) issues.push({ type: 'orphan-view', entity: n, key: r.key, rev: r.rev });
    else if (r.raw !== a.after || r.void !== (a.op === 'void')) issues.push({ type: 'tampered-view', entity: n, key: r.key, rev: r.rev });
  }
  for (const [id, e] of canon) if (!seenRows.has(id)) issues.push({ type: 'missing-view', entity: e.entity, key: e.key, rev: e.rev });
  return { ok: issues.length === 0, issues, auditCount: audit.length, repairable: issues.filter(i => i.type === 'missing-view').length };
}
// 복구: Audit에는 있는데 엔티티 시트에 없는 행만 추가한다. 기존 행은 절대 수정·삭제하지 않는다(변조·충돌은 보고만).
function storeRepair(env) {
  return storeWithLock(env, recovered => {
    const appended = [...recovered], audit = storeReadAudit(env), have = new Set();      // 락 진입 시 끝부분 자동 복구분도 함께 보고
    for (const n of ENTITY_NAMES) for (const r of storeReadView(env, n)) have.add(`${n}|${r.key}|${r.rev}`);
    for (const e of audit) if (!have.has(`${e.entity}|${e.key}|${e.rev}`)) { storeApplyView(env, e); appended.push(`${e.entity}|${e.key}|${e.rev}`); }
    return { appended, after: storeIntegrityCheck(env) };
  });
}

// ── R2 계산 엔진 연결 ──
function storeLoadLedgerInputs(env) {
  const ch = storeGet(env, 'challenge', 'challenge');
  if (!ch || ch.void) throw new StoreError('NOT_FOUND', '챌린지 설정 없음(storeSetupChallenge 필요)');
  const schedule = storeList(env, 'rate').map(r => ({ from: r.data.from, rate: r.data.rate })).sort((a, b) => (a.from < b.from ? -1 : 1));
  if (!schedule.length || schedule[0].from > ch.data.startDay) throw new StoreError('INTEGRITY', '시작일 이전부터 적용되는 목표율 일정이 없음');
  const d = n => storeList(env, n).map(r => r.data);
  return { challenge: { startEquity: ch.data.startEquity, startDay: ch.data.startDay, rateSchedule: schedule }, fills: d('fill'), cashflows: d('cashflow'), adjustments: d('adjustment'), openingPositions: d('opening'),
    equityInputs: d('equity').map(e => ({ day: e.day, equity: e.equity, unrealized: e.unrealized, late: e.late })) };
}
const storeBuildLedger = (env, { throughDay }) => ledgerBuildDaily({ ...storeLoadLedgerInputs(env), throughDay });

// ── backup.mjs ──
// R8 Google Sheets 백업·복원(순수 로직 + env 포트). 같은 코드를 Node 테스트(메모리 시트)와 Apps Script(DriveApp)가 쓴다.
//  env = { storeEnv(): 원본 저장소 env, drive: { ensureFolder(): folderId, list(folderId): [{id,name,createdAt}], copy(sourceId, name, folderId): {id}, openStore(id): 저장소 env, trash(id) } }
//  원칙
//   · 백업 = 스프레드시트 *사본*(날짜시각 이름). 저장소 락 안에서 복사해 쓰기 도중의 사본이 만들어지지 않게 한다.
//   · 사본은 반드시 검증한다: 무결성 검사 통과 + 원본과 지문(감사 로그 개수·마지막 해시·시트별 행 수) 일치. 검증에 실패한 사본은 휴지통으로 보내고 *기존 백업은 건드리지 않는다*.
//   · 보관은 최근 N개(설정 backupKeep, 기본 8, 1~30). 지우는 대상은 백업 폴더 안에서 *이름 패턴이 정확히 맞는 백업뿐*(그 밖의 파일·복원본·원본은 절대 삭제 대상 아님). 삭제는 휴지통 이동(복구 가능).
//   · 원본이 무결성 문제를 보이면 사본은 증거로 남기되 *회전(삭제)하지 않는다*(좋은 과거 백업을 잃지 않도록).
//   · 복원 = 백업을 *새 사본*으로 만들어 검증까지만 한다. 운영 시트를 덮어쓰지 않는다. 운영 시트 전환은 별도의 명시적 단계(승인·확인 문구)다.
//   · Telegram CSV 자동 전송은 구현하지 않는다(설정 backupTelegramCsv=on 이어도 아무것도 보내지 않고 경고만 반환). 이 모듈에는 네트워크 호출이 없다.

const BACKUP_RE = /^RICH300-backup-(\d{8})-(\d{4})$/;
const BACKUP_MIN_KEEP = 1, BACKUP_MAX_KEEP = 30, BACKUP_DEFAULT_KEEP = 8;
const bkStamp = now => { const d = new Date(now + 9 * 3600000).toISOString(); return `${d.slice(0, 10).replace(/-/g, '')}-${d.slice(11, 16).replace(':', '')}`; };   // KST
const backupName = now => `RICH300-backup-${bkStamp(now)}`;
const backupRestoredName = now => `RICH300-restored-${bkStamp(now)}`;
function backupKeepFrom(settings) { const n = Number(settings.backupKeep); return Number.isInteger(n) ? Math.min(BACKUP_MAX_KEEP, Math.max(BACKUP_MIN_KEEP, n)) : BACKUP_DEFAULT_KEEP; }

// 보관 계획: 이름에 든 시각이 최신인 N개를 남기고 나머지 *백업*만 삭제 대상. 이름 패턴이 맞지 않는 항목은 무시(ignored).
function backupRetention(list, keep) {
  const valid = list.filter(x => BACKUP_RE.test(x.name)).sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return { keep: valid.slice(0, keep), remove: valid.slice(keep), ignored: list.filter(x => !BACKUP_RE.test(x.name)) };
}
// 지문: 사본이 원본을 빠짐없이 재현했는지 비교하는 값(내용이 아니라 개수·해시만, 금액·ID 없음)
function backupFingerprint(se) {
  const audit = storeReadAudit(se), sheets = {}; for (const n of ENTITY_NAMES) sheets[ENTITIES[n].sheet] = storeReadView(se, n).length;
  const meta = se.sheets.rows(META_SHEET).map(r => String(r[0]));
  return { auditCount: audit.length, lastHash: audit.length ? audit[audit.length - 1].hash : '', sheets, metaKeys: meta.filter(k => k === 'schemaVersion').length, schemaVersion: SCHEMA_VERSION };
}
const bkSame = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function backupRun(env, { now = Date.now() } = {}) {
  const se = env.storeEnv(), settings = storeGetSettings(se), keep = backupKeepFrom(settings), warnings = [];
  if (settings.backupTelegramCsv === 'on') warnings.push('telegram-csv-unsupported');            // 보내지 않음(구현 없음)
  const folder = env.drive.ensureFolder(), name = backupName(now);
  if (env.drive.list(folder).some(x => x.name === name)) return { status: 'exists', name, warnings };    // 같은 분에 중복 실행: 한 번만
  let src = null, copy = null;
  try { storeWithLock(se, () => { src = { integrity: storeIntegrityCheck(se), fp: backupFingerprint(se) }; copy = env.drive.copy(env.sourceId, name, folder); }); }
  catch (e) { if (e instanceof StoreError && e.code === 'LOCK') throw e; if (copy) { try { env.drive.trash(copy.id); } catch (e_) { /* 정리 실패는 무시 */ } } return { status: 'copy-failed', name, warnings }; }
  let ci, cf;
  try { const cs = env.drive.openStore(copy.id); ci = storeIntegrityCheck(cs); cf = backupFingerprint(cs); } catch (e_) { ci = { ok: false, issues: [{ type: 'open-failed' }] }; cf = null; }
  const same = cf !== null && bkSame(cf, src.fp);
  if (src.integrity.ok && !(ci.ok && same)) { env.drive.trash(copy.id); return { status: 'verify-failed', name, reasons: [!ci.ok ? 'copy-integrity' : null, !same ? 'fingerprint-mismatch' : null].filter(Boolean), warnings }; }
  if (!src.integrity.ok) return { status: 'ok-unhealthy-source', name, id: copy.id, fingerprintMatches: same, rotated: false, issues: [...new Set(src.integrity.issues.map(i => i.type))], warnings };       // 증거로 남기고 회전하지 않음
  const plan = backupRetention(env.drive.list(folder), keep), trashed = [];
  for (const x of plan.remove) { env.drive.trash(x.id); trashed.push(x.name); }
  return { status: 'ok', name, id: copy.id, verified: true, keep, kept: plan.keep.length, trashed, warnings };
}

// 복원: 백업 → 새 사본(검증까지). 운영 시트·기존 백업은 건드리지 않는다.
function backupRestore(env, backupId, { now = Date.now() } = {}) {
  const folder = env.drive.ensureFolder(), entry = env.drive.list(folder).find(x => x.id === backupId && BACKUP_RE.test(x.name));
  if (!entry) throw new StoreError('NOT_FOUND', '백업을 찾을 수 없습니다(백업 폴더의 백업만 복원할 수 있음)');
  const bs = env.drive.openStore(backupId), bi = storeIntegrityCheck(bs);
  if (!bi.ok && !bi.issues.every(i => i.type === 'missing-view')) throw new StoreError('INTEGRITY', '백업이 손상되어 복원하지 않습니다', { issues: [...new Set(bi.issues.map(i => i.type))] });
  const bf = backupFingerprint(bs), name = backupRestoredName(now), copy = env.drive.copy(backupId, name, folder), rs = env.drive.openStore(copy.id), rf = backupFingerprint(rs);
  if (!bkSame(bf, rf)) { env.drive.trash(copy.id); throw new StoreError('INTEGRITY', '복원본이 백업과 일치하지 않아 폐기했습니다'); }
  return { id: copy.id, name, from: entry.name, repairable: bi.repairable, fingerprint: rf };
}
// 운영 시트 전환 전 점검(전환 자체는 하지 않음): 대상이 정상이고 기대 환경(test/prod) 표식과 맞는지
function backupSwitchChecks(env, newId, { expectEnv } = {}) {
  const ns = env.drive.openStore(newId), integ = storeIntegrityCheck(ns), fp = backupFingerprint(ns), marks = ns.sheets.rows(META_SHEET).filter(r => String(r[0]) === 'envName').map(r => String(r[1])), actual = marks.length ? marks[marks.length - 1] : null;
  const issues = []; if (!integ.ok) issues.push(...new Set(integ.issues.map(i => i.type))); if (expectEnv && actual !== null && actual !== expectEnv) issues.push('env-mismatch'); if (expectEnv && actual === null) issues.push('env-unmarked');
  return { ok: issues.length === 0, issues, auditCount: fp.auditCount, envMarker: actual };
}

// ── deploy.mjs ──
// R8 배포 준비 로직(순수 함수): 테스트/운영 프로젝트 분리 가드, 배포 자가 점검(비밀값 없이 상태만).
//  · 환경 이름(RICH300_ENV)은 test 또는 prod. 시트 Meta 의 envName 표식과 일치해야 한다(운영 데이터가 테스트 프로젝트에, 또는 그 반대로 연결되는 실수를 막는다).
//  · Telegram 호출 가드: 운영은 RICH300_PROD_APPROVED=yes 일 때만, 테스트는 RICH300_TEST_TG_ALLOW=yes 일 때만 허용. 환경이 비어 있거나 다른 값이면 차단(fail-closed). 승인 전 어떤 메시지도 나가지 않는다.
//  · 점검 결과에는 *값이 아니라 존재 여부·길이 충족 여부*만 담는다(토큰·키·이메일·시트 ID를 출력하지 않는다).

const DEPLOY_ENVS = Object.freeze(['test', 'prod']);
function deployGate(p, method, purpose) {            // 허용이면 null, 차단이면 사유 문자열
  if (p.env !== 'test' && p.env !== 'prod') return 'env-unset';
  if (p.env === 'prod') {
    if (p.prodApproved === 'yes') return null;
    const readOnly = method === 'getMe' || method === 'getWebhookInfo';
    if ((p.readOnlyOk === 'yes' || p.tgTestOk === 'yes') && readOnly) return null;                         // 읽기 점검(RICH300_TG_READONLY_OK 또는 RICH300_TG_TEST_OK=yes): getMe·getWebhookInfo 두 호출만(메시지·수신·설정 변경 없음)
    // 테스트 전송 허용(RICH300_TG_TEST_OK=yes) — 운영 승인과 *분리*된 좁은 허용. 화면의 명시적 동작이 목적(purpose)을 지정한 호출만 통과한다:
    //   'pair-poll'(getUpdates, 페어링 확인 1회 · 답장 없음) 과 'test-send'(sendMessage, 테스트 메시지 1건). 그 밖의 모든 호출(감시 알림·폴링 트리거·버튼 처리·마감 알림)은 운영 승인 전까지 계속 차단된다.
    if (p.tgTestOk === 'yes' && method === 'getUpdates' && purpose === 'pair-poll') return null;
    if (p.tgTestOk === 'yes' && method === 'sendMessage' && purpose === 'test-send') return null;
    return 'prod-not-approved';
  }
  return p.testTgAllow === 'yes' ? null : 'test-tg-off';
}
function deployMarkEnv(se, name) {                   // 최초 1회만 기록(이미 있으면 같은 값인지 확인)
  if (!DEPLOY_ENVS.includes(name)) throw new StoreError('VALIDATION', '환경 이름은 test 또는 prod');
  const cur = deployReadEnv(se);
  if (cur !== null) { if (cur !== name) throw new StoreError('ENV_MISMATCH', `이 시트는 ${cur} 환경으로 표시돼 있습니다`); return { status: 'unchanged' }; }
  se.sheets.append(META_SHEET, [['envName', name, String(se.now())]]); return { status: 'marked' };
}
function deployReadEnv(se) { const v = se.sheets.rows(META_SHEET).filter(r => String(r[0]) === 'envName').map(r => String(r[1])); return v.length ? v[v.length - 1] : null; }
function deployCheckEnv(se, expected) { const actual = deployReadEnv(se); return { ok: actual === expected, actual, expected }; }

// info: Apps Script가 모은 상태(값 없음). 반환: { items:[{id,level,ok,text}], fail, warn }
function deploySelfTest(info) {
  const items = [], add = (id, ok, level, text) => items.push({ id, ok, level: ok ? 'ok' : level, text });
  add('env', DEPLOY_ENVS.includes(info.env), 'fail', `환경 이름 RICH300_ENV 는 test 또는 prod 여야 합니다(현재: ${DEPLOY_ENVS.includes(info.env) ? info.env : '미설정'})`);
  add('timezone', info.tz === 'Asia/Seoul', 'fail', `프로젝트 시간대는 Asia/Seoul 이어야 합니다(현재: ${(info.tz != null ? info.tz : '알 수 없음')})`);
  add('v8', info.v8 === true, 'fail', 'V8 런타임(BigInt 지원)이 필요합니다');
  add('sheet', info.has.sheetId, 'fail', '스프레드시트 ID(RICH300_SHEET_ID)가 설정되어야 합니다');
  add('owner', info.has.ownerEmail, 'fail', '소유자 이메일(RICH300_OWNER_EMAIL)이 없으면 화면 접근이 모두 차단됩니다');
  add('ingest-key', info.has.ingestKey ? info.ingestKeyLen >= 32 : true, 'fail', '수신 키(RICH300_INGEST_KEY)는 쓰는 경우 32자 이상이어야 합니다(없어도 됩니다: 신호는 Telegram 버튼으로 들어옵니다)');
  add('telegram-token', info.has.tgToken, 'warn', 'Telegram 봇 토큰(RICH300_TG_TOKEN)이 없어 Telegram 기능이 꺼져 있습니다');
  add('ui-url', info.has.uiUrl, 'warn', '입력 화면 URL(RICH300_UI_URL, https)이 없어 알림·버튼에 링크가 들어가지 않습니다');
  if (info.env === 'test') {
    add('test-no-prod-flags', !(info.flags.closeSendApproved || info.flags.prodApproved), 'fail', '테스트 프로젝트에 운영 승인 플래그(RICH300_PROD_APPROVED·RICH300_CLOSE_SEND_APPROVED)가 있습니다 — 제거하세요');
  }
  if (info.env === 'prod') add('prod-gate', true, 'warn', info.flags.prodApproved ? '운영 승인 플래그가 켜져 있어 Telegram 호출이 허용됩니다' : '운영 승인 전: Telegram 호출이 차단되어 있습니다(정상)');
  add('integrity', info.integrity ? info.integrity.ok : false, 'fail', info.integrity ? `저장소 무결성 문제: ${info.integrity.issues.join(', ')}` : '저장소를 열 수 없습니다');
  add('env-marker', info.envMarker ? info.envMarker.ok : false, 'fail', info.envMarker ? `시트의 환경 표식(${(info.envMarker.actual != null ? info.envMarker.actual : '없음')})이 이 프로젝트(${info.env})와 다릅니다` : '시트 환경 표식을 확인할 수 없습니다');
  add('owner-visible', info.owner.activeEmailVisible === true, 'warn', '실행 중 사용자 이메일을 읽을 수 없습니다 — "접속한 사용자로 실행" 배포가 아니면 UI 소유자 확인이 항상 거부됩니다(S0 ④ 확인 필요)');
  const need = (info.expectTriggers != null ? info.expectTriggers : ['rich300CloseTick', 'rich300TgPoll', 'rich300BackupRun']), have = new Set(info.triggers);
  for (const t of need) add(`trigger-${t}`, have.has(t), 'warn', `트리거 ${t} 가 설치되어 있지 않습니다`);
  add('backup', info.backupCount > 0, info.env === 'prod' ? 'warn' : 'warn', '아직 백업이 없습니다');
  return { items, fail: items.filter(i => i.level === 'fail').length, warn: items.filter(i => i.level === 'warn').length };
}

// ── auth.mjs ──
// R5 요청 인증(순수 함수, 환경은 주입): 본문 HMAC-SHA256 + 타임스탬프 창 + nonce 재전송 방지.
//  요청: {"v":1,"ts":<ms>,"nonce":"<16~64자 [A-Za-z0-9_-]>","body":{…},"sig":"<hex64>"}
//  서명 문자열 = `${v}.${ts}.${nonce}.${canonical(body)}`, canonical = 키 정렬·공백 없는 JSON. body에는 부동소수·undefined·BigInt를 허용하지 않는다(언어 간 정규화 불일치 방지, 금액은 문자열).
//  Apps Script는 요청 헤더를 읽을 수 없으므로 인증 정보는 전부 본문에 있다(실제 동작은 S0 실측 전까지 미확정).
//  env = { now(): ms, hmacSha256(key, message): hex, getKeys(): string[] (현재 키, 이전 키 선택), nonces: { has(n): boolean, put(n, ttlSec) }, counter?(name) }
//  원칙: 값싼 검사 먼저 → 서명 검증 후에만 nonce를 기록(쓰레기 nonce로 캐시를 채우는 공격 방지) → 실패 사유는 내부 코드로만 반환(호출자가 외부에는 동일한 응답을 낸다). 키·서명·본문은 어떤 반환값·오류에도 넣지 않는다.

const AUTH_VERSION = 1;
const AUTH_WINDOW_MS = 300000;            // ±5분
const AUTH_NONCE_TTL_SEC = 900;           // 창(±5분 = 10분)보다 길게 기억
const AUTH_MAX_BYTES = 8192;
const AUTH_MIN_KEY_LEN = 32;
const AUTH_NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/, AUTH_SIG_RE = /^[0-9a-f]{64}$/;

// 상수 시간 비교(길이가 같을 때 모든 문자를 비교)
function authTimingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function authCheckValue(v, path) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
  if (typeof v === 'number') { if (!Number.isSafeInteger(v)) throw new Error(`본문 숫자는 안전 정수만 허용(소수는 문자열로): ${path}`); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => authCheckValue(x, `${path}[${i}]`)); return; }
  if (typeof v === 'object') { for (const [k, x] of Object.entries(v)) authCheckValue(x, `${path}.${k}`); return; }
  throw new Error(`본문 자료형 오류: ${path}`);
}
function authCanonicalBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('본문은 객체여야 함');
  authCheckValue(body, 'body'); return dedupeCanonical(body);
}
const authSignedString = (v, ts, nonce, body) => `${v}.${ts}.${nonce}.${authCanonicalBody(body)}`;
function authBuildRequest(env, key, body, { nonce } = {}) {
  if (typeof key !== 'string' || key.length < AUTH_MIN_KEY_LEN) throw new Error('키가 너무 짧음');
  const ts = env.now(), n = (nonce != null ? nonce : env.newNonce());
  if (!AUTH_NONCE_RE.test(n)) throw new Error('nonce 형식 오류');
  return JSON.stringify({ v: AUTH_VERSION, ts, nonce: n, body, sig: env.hmacSha256(key, authSignedString(AUTH_VERSION, ts, n, body)) });
}
const fail = (env, reason) => { try { (env.counter == null ? undefined : env.counter(`auth-fail:${reason}`)); } catch (e_) { /* 카운터 실패는 무시 */ } return { ok: false, reason }; };

function authVerify(env, raw) {
  if (typeof raw !== 'string') return fail(env, 'bad-format');
  if (raw.length > AUTH_MAX_BYTES) return fail(env, 'too-large');
  let msg; try { msg = JSON.parse(raw); } catch (e_) { return fail(env, 'bad-format'); }
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return fail(env, 'bad-format');
  const keys = Object.keys(msg).sort().join(',');
  if (keys !== 'body,nonce,sig,ts,v') return fail(env, 'bad-format');                         // 알 수 없는 필드·누락 거부(모호성 제거)
  if (msg.v !== AUTH_VERSION) return fail(env, 'bad-version');
  if (!Number.isSafeInteger(msg.ts)) return fail(env, 'bad-format');
  if (typeof msg.nonce !== 'string' || !AUTH_NONCE_RE.test(msg.nonce)) return fail(env, 'bad-format');
  if (typeof msg.sig !== 'string' || !AUTH_SIG_RE.test(msg.sig)) return fail(env, 'bad-format');
  if (Math.abs(env.now() - msg.ts) > AUTH_WINDOW_MS) return fail(env, 'stale');
  let signed; try { signed = authSignedString(msg.v, msg.ts, msg.nonce, msg.body); } catch (e_) { return fail(env, 'bad-body'); }
  let candidates; try { candidates = env.getKeys().filter(k => typeof k === 'string' && k.length > 0); } catch (e_) { return fail(env, 'misconfigured'); }
  if (!candidates.length || candidates.some(k => k.length < AUTH_MIN_KEY_LEN)) return fail(env, 'misconfigured');   // 키가 없거나 약하면 *닫힌 채로* 실패
  let matched = -1;
  candidates.forEach((k, i) => { const ok = authTimingSafeEqual(env.hmacSha256(k, signed), msg.sig); if (ok && matched < 0) matched = i; });   // 모든 후보를 끝까지 계산
  if (matched < 0) return fail(env, 'bad-signature');
  if (env.nonces.has(msg.nonce)) return fail(env, 'replay');
  env.nonces.put(msg.nonce, AUTH_NONCE_TTL_SEC);                                              // 서명이 맞은 요청의 nonce만 기록
  return { ok: true, body: msg.body, ts: msg.ts, nonce: msg.nonce, usedPreviousKey: matched > 0 };
}

// ── ingest.mjs ──
// R5 수신 처리(Actions → Apps Script): 인증 → 형식 → 저장. 반환은 항상 { ok, ... } JSON(Apps Script는 HTTP 상태를 정할 수 없음).
//  · 인증 실패는 사유와 무관하게 동일한 외부 응답 {ok:false,error:'unauthorized'}(어떤 검사에서 막혔는지 알려 주지 않는다). 사유는 카운터로만 남긴다.
//  · 시트는 인증이 통과한 뒤에만 연다(env.storeEnv()): 위조 요청이 시트 접근·락을 소모하지 못하게 한다.
//  · 같은 신호(sid)의 재전송은 duplicate(새 nonce로 다시 보내도 안전). 다른 내용은 conflict. 로그에는 아무것도 출력하지 않는다.

const INGEST_UNAUTHORIZED = Object.freeze({ ok: false, error: 'unauthorized' });
function ingestHandle(env, raw) {
  let auth;
  try { auth = authVerify(env, raw); } catch (e_) { return { ...INGEST_UNAUTHORIZED }; }
  if (!auth.ok) return { ...INGEST_UNAUTHORIZED };
  const body = auth.body;
  try {
    if (body.type === 'ping') return { ok: true, pong: true };
    if (body.type !== 'signal' || body.signal === null || typeof body.signal !== 'object' || Array.isArray(body.signal)) return { ok: false, error: 'invalid' };
    const r = storeCreate(env.storeEnv(), 'signal', body.signal, { actor: 'api:ingest' });
    if (r.status === 'added') return { ok: true, status: 'added', rev: r.rev };
    if (r.status === 'duplicate') return { ok: true, status: 'duplicate', duplicate: true };
    return { ok: false, error: 'conflict' };
  } catch (e) {
    if (e instanceof StoreError) {
      if (e.code === 'LOCK') return { ok: false, error: 'busy', retry: true };
      if (e.code === 'VALIDATION') return { ok: false, error: 'invalid', message: String(e.message).slice(0, 120) };
    }
    return { ok: false, error: 'server' };                                  // 스택·내부 정보 비노출
  }
}

// ── r9.mjs ──
// R9: COIN RADAR 진입 후보 메시지의 'R9 v1 …' 한 줄을 읽어 신호(signal) 데이터로 바꾼다. 순수 함수(저장·네트워크 없음).
//  · 줄 형식: R9 v1 <sid> <SYMBOLUSDT> <LONG|SHORT> <entry> <stop> <tp1> <tp2|-> <전략 A|B|S> <점수|-> <신호시각ms>
//  · 이 줄은 radar가 보낸 메시지(버튼을 누른 메시지)에서만 읽는다. 값 검증은 저장소 스키마(signal)가 다시 한다.
const R9_LINE_RE = /(?:^|\n)R9 v1 ([A-Za-z0-9_.-]{1,54}) ([A-Z0-9]{2,20}USDT) (LONG|SHORT) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?|-) ([ABS]) (\d{1,3}|-) (\d{10,14})(?=\n|$)/;
function r9ParseSignal(text) {
  const m = R9_LINE_RE.exec(String((text != null ? text : ''))); if (!m) return null;
  const signalAt = Number(m[10]); if (!Number.isSafeInteger(signalAt)) return null;
  return { sid: m[1], symbolId: m[2], dir: m[3], entry: m[4], stop: m[5], tp1: m[6], ...(m[7] === '-' ? {} : { tp2: m[7] }), strategy: m[8], ...(m[9] === '-' ? {} : { score: Number(m[9]) }), signalAt };
}
// 버튼을 누른 뒤 메시지를 다시 쓸 때 기계 줄은 빼고 사람이 읽는 부분만 남긴다.
const r9StripLine = text => String((text != null ? text : '')).replace(R9_LINE_RE, '').replace(/\n{3,}/g, '\n\n').trimEnd();

// ── tg.mjs ──
// R4 Telegram 처리(수신 → 기록). 네트워크·시트·키 저장소는 전부 env 포트로 주입하므로 같은 코드를 Node 테스트(가짜 Telegram)와 Apps Script가 쓴다.
//  env = { now(): ms, sha256(s): hex, randomId(n): string, randomInt(n): 0..n-1 (암호학적 난수), sleep(ms),
//          storeEnv(): R3 저장소 env,
//          kv: { get(k): string|null, put(k, s), del(k) }        (페어링·폴링 오프셋·임시 입력 — 영속 저장소, 만료는 이 모듈이 처리),
//          http: { call(method, payload): { status, body } }      (봇 토큰은 이 어댑터 안에만 있다. 이 모듈은 토큰을 보지 못한다. 네트워크 오류는 throw),
//          uiUrl?: string }                                       (모바일 입력 화면 URL, 선택)
//  원칙
//   · 페어링된 사용자(from.id)만 처리한다. 그 밖의 발신자·그룹 채팅은 *무응답·무기록*(페어링 코드 시도 제외).
//   · 중복 방지: update_id·callback_query.id는 *처리 성공 후* 기록(tgupdate). 기록 전 재전송은 같은 결과(sid·fillId 유일키)로 수렴한다. 이미 기록된 것은 부수효과 없이 무시.
//   · 버튼 한 번 = 명시적 선택(진입/관망/놓침 기록). 체결·복기는 *확인(저장) 버튼*을 눌러야 기록된다. 어떤 기본값도 저장 전에는 기록되지 않는다.
//   · 상태는 최소화: 복기는 callback_data에 선택 상태를 담아 무상태, 체결 초안만 kv에 10분 보관(저장 후에도 만료까지 유지 — 재처리·재클릭은 같은 fillId라 duplicate로 수렴).
//   · Telegram 오류: 429(retry_after)·5xx·네트워크는 짧게 재시도(최대 3회), 400/401/403은 재시도하지 않고 분류만 반환. 오류 값에 본문·토큰을 넣지 않는다.
//   · 자동 주문 기능 없음: 이 모듈은 기록만 한다.

const TG_MAX_ATTEMPTS = 3;
const TG_MAX_WAIT_MS = 10000;                 // 이보다 긴 retry_after는 기다리지 않고 재시도 가능 오류로 반환(다음 트리거에서 재처리)
const TG_DRAFT_TTL_SEC = 600;
const TG_PAIR_TTL_SEC = 600;
const TG_PAIR_MAX_FAILS = 5;
const TG_DUP_WINDOW_MS = 10 * 60 * 1000;      // 같은 신호에서 같은 종류·가격·수량의 체결이 이 안에 또 들어오면 중복 입력으로 보고 막는다(force=1 로 해제)
const TG_POISON_AFTER = 3;                    // 같은 update가 3번 처리 실패하면 건너뛴다(폴링이 영원히 막히지 않게)
const TG_SID_RE = /^[A-Za-z0-9_.-]{1,54}$/;   // callback_data 64바이트 한도: 'v1:'+sid+':XXYY:s' 이 들어가도록 54자
const TG_PAIR_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TG_PLAN_CODES = { ok: 'plan_ok', ee: 'early_exit', ch: 'chase_or_average_down', ov: 'other_violation' };
const TG_MIND_CODES = { ca: 'calm', an: 'anxious_rushed', rv: 'revenge', gr: 'greedy' };
const TG_PLAN_SHORT = { ok: '계획대로', ee: '조기청산', ch: '추격·물타기', ov: '기타위반' };
const TG_MIND_SHORT = { ca: '침착', an: '불안·조급', rv: '손실복구', gr: '욕심' };
const TG_FAMILY = { opening: 'in', entry: 'in', add: 'in', reduce: 'out', close: 'out' };   // 중복 판정: 진입/추가진입, 부분/전량 청산은 같은 계열
const TG_RESP = { e: 'entered', w: 'watched', m: 'missed' };

// ── kv(만료는 여기서 처리) ──
const tgKvGet = (env, k) => { const raw = env.kv.get(k); if (raw === null || raw === undefined) return null; let o; try { o = JSON.parse(raw); } catch (e_) { return null; } if (o.exp && env.now() >= o.exp) { env.kv.del(k); return null; } return o.v; };
const tgKvPut = (env, k, v, ttlSec) => env.kv.put(k, JSON.stringify({ v, exp: ttlSec ? env.now() + ttlSec * 1000 : 0 }));

// ── Telegram 호출(재시도·오류 분류) ──
function tgClassify(status, description) {
  const d = String((description != null ? description : '')).toLowerCase();
  if (status === 0) return 'network';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'server';
  if (status === 401 || status === 404) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (status === 400) {
    if (d.includes('message is not modified')) return 'not-modified';
    if (d.includes('message to edit not found') || d.includes("message can't be edited") || d.includes('message to delete not found')) return 'gone';
    if (d.includes('query is too old') || d.includes('query id is invalid')) return 'stale-callback';
    if (d.includes('chat not found')) return 'chat';
    return 'bad-request';
  }
  return 'other';
}
const TG_BENIGN = Object.freeze(['not-modified', 'gone', 'stale-callback']);
function tgCall(env, method, payload) {
  let attempts = 0;
  for (;;) {
    attempts++;
    let res; try { res = env.http.call(method, payload); } catch (e_) { res = { status: 0, body: null }; }
    const status = Number(((res == null ? undefined : res.status) != null ? (res == null ? undefined : res.status) : 0)), body = ((res == null ? undefined : res.body) != null ? (res == null ? undefined : res.body) : null);
    if (status === 200 && body && body.ok === true) return { ok: true, result: body.result, attempts };
    const code = tgClassify(status, (body == null ? undefined : body.description)), retryAfterSec = Number(((body == null ? undefined : (body.parameters == null ? undefined : body.parameters.retry_after)) != null ? (body == null ? undefined : (body.parameters == null ? undefined : body.parameters.retry_after)) : 0));
    const retryable = code === 'network' || code === 'server' || code === 'rate-limit';
    let wait = code === 'rate-limit' ? Math.max(retryAfterSec, 1) * 1000 : attempts * 500;
    if (retryable && attempts < TG_MAX_ATTEMPTS && wait <= TG_MAX_WAIT_MS) { env.sleep(wait); continue; }
    return { ok: false, status, code, retryable, benign: TG_BENIGN.includes(code), retryAfterSec: code === 'rate-limit' ? retryAfterSec : undefined, attempts };
  }
}
const tgPrefix = env => (typeof env.msgPrefix === 'string' ? env.msgPrefix : '');            // 테스트 환경은 모든 메시지 앞에 '[TEST] '
const tgSend = (env, chatId, text, markup) => tgCall(env, 'sendMessage', { chat_id: chatId, text: tgPrefix(env) + text, disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) });
const tgEdit = (env, cb, text, markup) => (cb.photo      // 사진 메시지는 본문이 아니라 설명(caption)을 고친다(1024자 한도)
  ? tgCall(env, 'editMessageCaption', { chat_id: cb.chatId, message_id: cb.messageId, caption: [...(tgPrefix(env) + text)].slice(0, 1024).join(''), reply_markup: (markup != null ? markup : { inline_keyboard: [] }) })
  : tgCall(env, 'editMessageText', { chat_id: cb.chatId, message_id: cb.messageId, text: tgPrefix(env) + text, reply_markup: (markup != null ? markup : { inline_keyboard: [] }) }));
const tgAnswer = (env, cbId, text) => tgCall(env, 'answerCallbackQuery', { callback_query_id: cbId, ...(text ? { text: String(text).slice(0, 190) } : {}) });
const tgOkOrBenign = r => r.ok || r.benign;
const tgSendMessage = tgSend;                  // 검증 하니스(테스트 환경 전용)가 임의 메시지를 보낼 때 사용
// 일 마감 알림 발송(R7): 텍스트 + 선택적 URL 버튼. 결과 코드만 반환(본문·토큰 없음).
function tgSendNotice(env, chatId, text, url) {
  const r = tgSend(env, chatId, text, url && /^https:\/\/\S+$/.test(url) ? { inline_keyboard: [[{ text: '입력하기', url }]] } : undefined);
  return r.ok ? { ok: true } : { ok: false, code: r.code };
}

// ── 입력 정규화 ──
function tgParseUpdate(u) {
  if (!u || !Number.isSafeInteger(u.update_id)) return null;
  const m = u.message, c = u.callback_query;
  if (m && m.from && Number.isSafeInteger(m.from.id) && m.chat && Number.isSafeInteger(m.chat.id)) return { kind: 'message', updateId: u.update_id, fromId: m.from.id, chatId: m.chat.id, chatType: m.chat.type, isBot: m.from.is_bot === true, dateMs: Number.isFinite(m.date) ? m.date * 1000 : null, text: typeof m.text === 'string' ? m.text.slice(0, 500) : '' };
  if (c && typeof c.id === 'string' && c.from && Number.isSafeInteger(c.from.id)) {
    const cm = c.message; return { kind: 'callback', updateId: u.update_id, fromId: c.from.id, chatId: (cm == null ? undefined : cm.chat) && Number.isSafeInteger(cm.chat.id) ? cm.chat.id : null, chatType: (cm == null ? undefined : (cm.chat == null ? undefined : cm.chat.type)), isBot: c.from.is_bot === true, cbId: c.id, data: typeof c.data === 'string' ? c.data.slice(0, 64) : '', messageId: Number.isSafeInteger((cm == null ? undefined : cm.message_id)) ? cm.message_id : null, msgText: typeof (((cm == null ? undefined : cm.text) != null ? (cm == null ? undefined : cm.text) : (cm == null ? undefined : cm.caption))) === 'string' ? ((cm.text != null ? cm.text : cm.caption)).slice(0, 4096) : '', isPhoto: Array.isArray((cm == null ? undefined : cm.photo)) };
  }
  return null;
}
function tgParseCommand(text) {
  const t = String((text != null ? text : '')).trim(); if (!t.startsWith('/')) return null;
  const parts = t.split(/\s+/), cmd = parts[0].slice(1).split('@')[0].toLowerCase(), pos = [], opt = {};
  for (const p of parts.slice(1)) { const i = p.indexOf('='); if (i > 0) opt[p.slice(0, i).toLowerCase()] = p.slice(i + 1); else pos.push(p); }
  return { cmd, pos, opt };
}
// 체결 시각 입력(KST). 'HH:mm'(오늘, 미래면 어제) · 'MM-DD HH:mm' · 'YYYY-MM-DD HH:mm' (구분은 공백·T·_ 모두 허용). 비우면 undefined(=지금).
const TG_FUTURE_SLACK_MS = 5 * 60 * 1000;
function tgParseAt(raw, now) {
  const t = String((raw != null ? raw : '')).trim().replace(/[T_]/g, ' ').replace(/\s+/g, ' ');
  if (!t) return undefined;
  let m, ms;
  const hm = (day, h, mi) => { if (+h > 23 || +mi > 59) throw tgUserErr('시각 형식이 맞지 않습니다(예: 14:30)'); return dayStartMs(day) + (+h * 60 + +mi) * 60000; };
  const today = kstDayOf(now);
  try {
    if ((m = /^(\d{1,2}):(\d{2})$/.exec(t))) { ms = hm(today, m[1], m[2]); if (ms > now + TG_FUTURE_SLACK_MS) ms = hm(addDays(today, -1), m[1], m[2]); }
    else if ((m = /^(\d{2})-(\d{2}) (\d{1,2}):(\d{2})$/.exec(t))) { const y = today.slice(0, 4); ms = hm(`${y}-${m[1]}-${m[2]}`, m[3], m[4]); if (ms > now + TG_FUTURE_SLACK_MS) ms = hm(`${+y - 1}-${m[1]}-${m[2]}`, m[3], m[4]); }
    else if ((m = /^(\d{4}-\d{2}-\d{2}) (\d{1,2}):(\d{2})$/.exec(t))) ms = hm(m[1], m[2], m[3]);
  } catch (e) { if (e instanceof StoreError) throw e; throw tgUserErr('시각 형식이 맞지 않습니다(예: 14:30 또는 10-24 14:30)'); }
  if (ms === undefined || !Number.isFinite(ms)) throw tgUserErr('시각 형식이 맞지 않습니다(예: 14:30 또는 10-24 14:30)');
  if (ms > now + TG_FUTURE_SLACK_MS) throw tgUserErr('미래 시각은 입력할 수 없습니다');
  return ms;
}
const tgAtMs = (env, p) => (p.atMs === undefined || p.atMs === null || p.atMs === '' ? undefined : (Number.isSafeInteger(+p.atMs) && +p.atMs > 0 ? +p.atMs : (() => { throw tgUserErr('시각 값이 올바르지 않습니다'); })()));
function tgNote(raw) { const t = String((raw != null ? raw : '')).replace(/\s+/g, ' ').trim(); if (!t) return undefined; if (t.length > 300) throw tgUserErr('메모는 300자까지입니다'); return t; }
function tgAmount(raw, name) {                         // "0.12" 입력, "~0.12" 추정, 비우면 미입력
  if (raw === undefined || raw === '') return { state: 'missing' };
  const est = raw.startsWith('~'), v = est ? raw.slice(1) : raw;
  return { state: est ? 'estimated' : 'entered', amount: schemaDecString(v, name) };
}
const tgUserErr = (msg) => new StoreError('USER', msg);

// ── 페어링 ──
function tgPairCreate(env) {                    // UI(소유자 로그인)에서 호출: 10분·1회용 코드. 해시만 저장한다.
  const code = Array.from({ length: 8 }, () => TG_PAIR_ALPHABET[env.randomInt(TG_PAIR_ALPHABET.length)]).join('');
  tgKvPut(env, 'pair', { hash: env.sha256(`rich300-pair|${code}`), createdAt: env.now() }, TG_PAIR_TTL_SEC); tgKvPut(env, 'pairfail', { n: 0 }, TG_PAIR_TTL_SEC);
  return { code, expiresAt: env.now() + TG_PAIR_TTL_SEC * 1000 };
}
const tgPairedUser = env => tgKvGet(env, 'paired');
function tgPairAttempt(env, ev, code, { reply = true } = {}) {                // 실패는 무응답(봇 존재·코드 유무를 알려 주지 않음). 5회 실패 시 코드 폐기.
  const rec = tgKvGet(env, 'pair'), fails = nullishOr(tgKvGet(env, 'pairfail'), { n: 0 });
  if (!rec || fails.n >= TG_PAIR_MAX_FAILS || ev.chatType !== 'private' || ev.isBot) return { status: 'ignored', action: 'pair-rejected' };
  const ok = authTimingSafeEqual(rec.hash, env.sha256(`rich300-pair|${String((code != null ? code : '')).toUpperCase()}`));
  if (!ok) { fails.n++; tgKvPut(env, 'pairfail', fails, TG_PAIR_TTL_SEC); if (fails.n >= TG_PAIR_MAX_FAILS) env.kv.del('pair'); return { status: 'ignored', action: 'pair-rejected' }; }
  env.kv.del('pair'); env.kv.del('pairfail'); tgKvPut(env, 'paired', { userId: ev.fromId, chatId: ev.chatId, at: env.now() });
  if (!reply) return { status: 'handled', action: 'paired', replyFailed: false };           // 화면에서 하는 페어링 확인(1회 폴링)은 메시지를 보내지 않는다
  const s = tgSend(env, ev.chatId, 'RICH300 연결 완료. 이 계정만 응답합니다. /help');
  return { status: 'handled', action: 'paired', replyFailed: !s.ok };
}

// 페어링 확인 1회 폴링(화면의 버튼): getUpdates 한 번 → 코드 생성 *이후*에 온 `/start <코드>` 개인 메시지만 확인한다. 다른 업데이트는 처리하지 않고(주문·체결·버튼 처리 없음), 답장도 보내지 않는다.
//  페어링이 되면 그 업데이트까지만 확인 처리(offset)하고 멈춘다 — 뒤에 쌓인 업데이트는 건드리지 않는다.
function tgPairPoll(env) {
  const rec = tgKvGet(env, 'pair'); if (tgPairedUser(env)) return { status: 'already-paired' };
  if (!rec) return { status: 'no-code' };
  const off = Number(nullishOr(tgKvGet(env, 'offset'), 0)), r = tgCall(env, 'getUpdates', { ...(off ? { offset: off } : {}), limit: 50, timeout: 0, allowed_updates: ['message'] });
  if (!r.ok) return { status: 'error', code: r.code };
  const list = (Array.isArray(r.result) ? r.result : []).filter(u => Number.isSafeInteger((u == null ? undefined : u.update_id))).sort((a, b) => a.update_id - b.update_id), since = (nullishOr(rec.createdAt, 0)) - 60000;
  for (const u of list) {
    const ev = tgParseUpdate(u); if (!ev || ev.kind !== 'message' || !Number.isFinite(ev.dateMs) || ev.dateMs < since) continue;
    const cmd = tgParseCommand(ev.text); if (!cmd || cmd.cmd !== 'start' || !cmd.pos.length) continue;
    const x = tgPairAttempt(env, ev, cmd.pos[0], { reply: false });
    if (x.action === 'paired') { tgKvPut(env, 'offset', u.update_id + 1); return { status: 'paired' }; }
  }
  return { status: 'waiting', seen: list.length };
}

// ── 메시지·버튼 만들기 ──
function tgResponseKeyboard(sid) {
  if (!TG_SID_RE.test(sid)) throw new Error('sid는 영문·숫자·_.- 54자 이하(callback_data 한도)');
  return { inline_keyboard: [[{ text: '진입했어', callback_data: `r1:${sid}:e` }, { text: '관망했어', callback_data: `r1:${sid}:w` }, { text: '놓쳤어', callback_data: `r1:${sid}:m` }]] };
}
function tgSignalText(s) {
  return [`🔔 ${s.strategy}전략 ${s.dir} ${s.symbolId}`, `진입 ${s.entry} · 손절 ${s.stop} · TP1 ${s.tp1}`, '내 판단은?'].join('\n');
}
function tgFillLink(uiUrl, s) {
  if (typeof uiUrl !== 'string' || !/^https:\/\/[^\s]+$/.test(uiUrl)) return null;
  const q = `p=fill&sid=${encodeURIComponent(s.sid)}&dir=${s.dir}&entry=${encodeURIComponent(s.entry)}&stop=${encodeURIComponent(s.stop)}`;
  return `${uiUrl}${uiUrl.includes('?') ? '&' : '?'}${q}`;
}
function tgSendSignalPrompt(env, chatId, sid) {  // 오프라인 테스트용 발송기(R9 연동 전에는 운영에서 호출하지 않는다)
  const sg = storeGet(env.storeEnv(), 'signal', sid); if (!sg || sg.void) return { ok: false, code: 'unknown-signal' };
  if (!TG_SID_RE.test(sid)) return { ok: false, code: 'sid-too-long' };
  return tgSend(env, chatId, tgSignalText(sg.data), tgResponseKeyboard(sid));
}
function tgReviewKeyboard(sid, plan = 'ok', mind = 'ca') {
  const st = `${plan}${mind}`, row = (codes, short, mk) => Object.keys(codes).map(c => ({ text: `${(mk === 'p' ? plan : mind) === c ? '✅ ' : ''}${short[c]}`, callback_data: `v1:${sid}:${mk === 'p' ? c + mind : plan + c}` }));
  return { inline_keyboard: [row(TG_PLAN_CODES, TG_PLAN_SHORT, 'p'), row(TG_MIND_CODES, TG_MIND_SHORT, 'm'), [{ text: `💾 저장 (${TG_PLAN_SHORT[plan]} · ${TG_MIND_SHORT[mind]})`, callback_data: `v1:${sid}:${st}:s` }]] };
}
const tgReviewText = (sid, plan = 'ok', mind = 'ca') => `복기 · ${sid}\n계획: ${TG_PLAN_SHORT[plan]} · 심리: ${TG_MIND_SHORT[mind]}\n(저장 버튼을 눌러야 기록됩니다)`;
function tgSendReviewPrompt(env, chatId, sid) {
  if (!TG_SID_RE.test(sid)) return { ok: false, code: 'sid-too-long' };
  return tgSend(env, chatId, tgReviewText(sid), tgReviewKeyboard(sid));
}

// ── 체결 초안(진입·추가·청산·부분청산) ──
const tgFillsOf = (se, sid) => storeList(se, 'fill').map(r => r.data).filter(f => f.sid === sid);
function tgRiskEquityMicro(env) {                      // 경고용: 오늘 시작 평가액(장부 계산 실패 시 null)
  try { const l = storeBuildLedger(env.storeEnv(), { throughDay: kstDayOf(env.now()) }); const r = l.rows[l.rows.length - 1]; return r ? r.startMicro : null; } catch (e_) { return null; }
}
// ── 분할 진입·익절 계획(계산·경고 전용, 주문 없음) ──
// 저장: 첫 진입 체결 때 입력(평가액·1차 진입가·손절·배율·단계 수)을 'plan'(불변)에 한 번 남긴다. 계획은 이 입력에서 결정적으로 다시 만든다.
// 규칙 위반(무계획 추가 진입 등)은 기본 차단, 명령 끝 force=1 이면 기록하되 요약에 경고를 남긴다.
const tgEquityNow = env => { const m = tgRiskEquityMicro(env); return m === null || m === undefined ? null : (Number(m) / 1e6).toFixed(2); };
function tgPlanBuild(se, sid, sg, inp) {
  return splanBuild({ symbol: sg.symbolId, dir: sg.dir, entry: Number(inp.entry), stop: Number(inp.stop), equity: Number(inp.equity), ...(inp.lev ? { lev: inp.lev } : {}), ...(inp.stages ? { params: { maxStages: inp.stages } } : {}) });
}
function tgPlanOf(se, sid) {
  const r = storeGet(se, 'plan', sid), sg = storeGet(se, 'signal', sid); if (!r || r.void || !sg || sg.void) return null;
  const plan = tgPlanBuild(se, sid, sg.data, r.data); return plan.status === 'ok' ? plan : null;
}
const tgPlanFills = fills => fills.map(f => ({ kind: f.kind, price: Number(f.price), qty: Number(f.qty), at: f.at }));
const tgPlanCtx = (env, sg) => ({ barsSinceSignal: Math.max(0, Math.floor((env.now() - sg.signalAt) / 900000)) });
function tgPlanPreview(env, sid, equityArg) {                // 진입 전: 신호 값과 평가액으로 보여 주기만 한다(저장 없음)
  const se = env.storeEnv(), sg = storeGet(se, 'signal', sid); if (!sg || sg.void) return null;
  const eq = (equityArg != null ? equityArg : tgEquityNow(env)); if (eq === null) return { plan: null, equity: null };
  return { plan: tgPlanBuild(se, sid, sg.data, { entry: sg.data.entry, stop: sg.data.stop, equity: eq }), equity: eq };
}
function tgPlanCheckAdd(env, p, fills, entry, qty) {          // 추가 진입 검사: 통과 못 하면 사유 목록
  const se = env.storeEnv(), sg = storeGet(se, 'signal', p.sid), plan = tgPlanOf(se, p.sid);
  if (!plan) return ['no-plan'];
  return splanCheckAdd(plan, tgPlanFills(fills), { price: Number(entry), qty: Number(qty) }, tgPlanCtx(env, sg.data)).reasons;
}
function tgPlanEntryWarnings(env, p, qty) {                   // 첫 진입 수량이 계획 1차보다 크거나 계획상 거래 제외인 경우 경고
  try {
    const pv = tgPlanPreview(env, p.sid); if (!pv || !pv.plan) return [];
    if (pv.plan.status !== 'ok') return [`계획상 거래 제외: ${splanReasonText(pv.plan.reason)}`];
    const q1 = pv.plan.stages[0].qty; return Number(qty) > q1 + pv.plan.spec.step / 2 ? [`1차 계획 수량 ${splanQty(q1, pv.plan.spec)} 보다 큽니다(1차는 전체의 ${Math.round(pv.plan.stages[0].weight * 100)}%, 나머지는 사전 가격에서만)`] : [];
  } catch (e_) { return []; }
}
function tgBuildEntry(env, p) {                 // p: { sid, margin, leverage, entry, stop, qty?, fee?, funding? } (문자열)
  const se = env.storeEnv(), sg = storeGet(se, 'signal', p.sid);
  if (!sg || sg.void) throw tgUserErr(`알 수 없는 신호: ${String(p.sid).slice(0, 40)}`);
  const resp = storeGet(se, 'response', p.sid);
  if (resp && !resp.void && resp.data.choice !== 'entered') throw tgUserErr(`이 신호는 '${RESPONSE_CHOICES[resp.data.choice]}'로 기록돼 있어 진입을 기록할 수 없습니다(수정은 앱에서)`);
  const fills = tgFillsOf(se, p.sid), trade = fills.length ? tgTradeOrUserError(fills) : null;
  if (trade && trade.status === 'closed') throw tgUserErr('이미 청산된 신호입니다');
  const kind = trade ? 'add' : 'entry';
  const margin = schemaDecString(p.margin, '증거금', { positive: true }), leverage = schemaDecString(p.leverage, '레버리지', { positive: true }), entry = schemaDecString(p.entry, '진입가', { positive: true }), stop = p.stop === undefined || p.stop === '' ? undefined : schemaDecString(p.stop, '손절가', { positive: true });
  let qty, qtySource = 'entered';
  if (p.qty !== undefined && p.qty !== '') qty = schemaDecString(p.qty, '수량', { positive: true });
  else { qty = decFormat(decDiv(decMul(dec(margin), dec(leverage)), dec(entry)), 8); qty = schemaDecString(qty, '수량(계산)', { positive: true }); qtySource = 'derived'; }
  const dir = sg.data.dir, risk = riskTrade({ dir, entry, stop: (stop != null ? stop : entry), qty, margin, leverage, equityMicro: stop === undefined ? null : tgRiskEquityMicro(env) });
  const atMs = tgAtMs(env, p), note = tgNote(p.note);
  const fill = { origin: 'real', sid: p.sid, kind, dir, price: entry, qty, margin, leverage, ...(stop === undefined ? {} : { plannedStop: stop }), qtySource, fee: tgAmount(p.fee, '수수료'), funding: tgAmount(p.funding, '펀딩'), ...(note ? { note } : {}) };
  const extra = [];
  if (kind === 'add') {
    const why = tgPlanCheckAdd(env, p, fills, entry, qty);
    if (why.length && p.force !== true) throw tgUserErr(`계획 밖 추가 진입은 기록하지 않습니다(손실 만회용 물타기 금지): ${why.map(splanReasonText).join(' / ').slice(0, 220)}. 그래도 실제로 체결했다면 명령 끝에 force=1 을 붙여 기록하세요`);
    if (why.length) extra.push(`⚠ 계획 밖 추가 진입(force): ${why.map(splanReasonText).join(' / ').slice(0, 200)}`);
  } else for (const w of tgPlanEntryWarnings(env, p, qty)) extra.push(`⚠ ${w}`);
  return { type: 'fill', fill, risk, summary: [tgEntrySummary(fill, stop === undefined ? { ...risk, noStop: true } : risk, atMs), ...extra].join('\n'), params: { ...p }, force: p.force === true };
}
function tgBuildExit(env, p) {                  // p: { sid, price, qty?('all'), fee?, funding? }
  const se = env.storeEnv(), fills = tgFillsOf(se, p.sid), trade = fills.length ? tgTradeOrUserError(fills) : null;
  if (!trade) throw tgUserErr('이 신호의 진입 기록이 없습니다');
  if (trade.status !== 'open') throw tgUserErr('이미 전량 청산된 포지션입니다');
  const price = schemaDecString(p.price, '청산가', { positive: true });
  const rq = String((p.qty != null ? p.qty : '')).trim(), pm = /^(\d+(?:\.\d+)?)%$/.exec(rq);
  if (pm && !(+pm[1] > 0 && +pm[1] <= 100)) throw tgUserErr('청산 비율은 0 초과 100 이하(%)');
  const all = rq === '' || rq.toLowerCase() === 'all' || (pm && +pm[1] === 100);
  const trim12 = v => decFormat(v, 12).replace(/0+$/, '').replace(/\.$/, '');
  const qty = all ? trim12(trade.openQtyDec) : pm ? trim12(decDiv(decMul(trade.openQtyDec, dec(pm[1])), dec(100))) : schemaDecString(rq, '수량', { positive: true });
  if (!all && pm && !(dec(qty) > BigInt(0))) throw tgUserErr('계산된 청산 수량이 0입니다');
  const qd = dec(qty); if (qd > trade.openQtyDec) throw tgUserErr(`보유 수량(${tgNum(decFormat(trade.openQtyDec, 8))})보다 큽니다`);
  const kind = qd === trade.openQtyDec ? 'close' : 'reduce';
  const atMs = tgAtMs(env, p), note = tgNote(p.note), lastAt = fills.reduce((m, f) => Math.max(m, f.at), 0);
  if (atMs !== undefined && atMs <= lastAt) throw tgUserErr('청산 시각은 이전 체결보다 뒤여야 합니다');
  const fill = { origin: 'real', sid: p.sid, kind, dir: trade.dir, price, qty, fee: tgAmount(p.fee, '수수료'), funding: tgAmount(p.funding, '펀딩'), ...(note ? { note } : {}) };
  const probe = tgTradeOrUserError([...fills, { ...fill, fillId: 'preview', at: (atMs != null ? atMs : tgNextAt(env, fills)) }]), ev = probe.events[probe.events.length - 1];
  return { type: 'exit', fill, summary: tgExitSummary(fill, ev, probe, atMs), params: { ...p }, force: p.force === true };
}
const tgM = m => decFormat(m * BigInt(1000000), 2);
const tgKstLabel = ms => new Date(ms + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' ');
function tgEntrySummary(f, r, atMs) {
  const lines = [`${f.kind === 'add' ? '추가진입' : '진입'} ${f.dir} · ${f.sid}${atMs ? ` · ${tgKstLabel(atMs)} KST` : ''}`, `진입 ${f.price} · 수량 ${f.qty}${f.qtySource === 'derived' ? '(계산)' : ''} · 손절 ${(f.plannedStop != null ? f.plannedStop : '미입력')}`, r.noStop ? `증거금 ${f.margin} · ${f.leverage}x · 손절가 없음(위험 계산 생략)` : `증거금 ${f.margin} · ${f.leverage}x · 손절 시 손실 ${tgM(r.stopLossMicro)} USDT${r.riskPpmOfEquity !== null ? ` (${decFormat(BigInt(r.riskPpmOfEquity) * BigInt(100000000), 2)}%)` : ''}`];
  const fl = r.noStop ? r.flags.filter(x => x === 'leverage-mismatch') : r.flags, w = [fl.includes('stop-on-wrong-side') && '손절가가 방향과 반대쪽', fl.includes('liquidation-before-stop') && '청산가(근사)가 손절보다 먼저', fl.includes('risk-over-2pct') && '손실 2% 초과', fl.includes('leverage-mismatch') && '레버리지 불일치'].filter(Boolean);
  if (w.length) lines.push(`⚠ ${w.join(' · ')}`);
  lines.push(`수수료 ${f.fee.state === 'missing' ? '미입력' : f.fee.amount} · 펀딩 ${f.funding.state === 'missing' ? '미입력' : f.funding.amount}`);
  return lines.join('\n');
}
function tgExitSummary(f, ev, t, atMs) {
  const lines = [`${f.kind === 'close' ? '전량 청산' : '부분 청산'} ${f.dir} · ${f.sid}${atMs ? ` · ${tgKstLabel(atMs)} KST` : ''}`, `청산 ${f.price} · 수량 ${f.qty} · 이번 총손익 ${tgM(ev.grossMicro)} USDT`, `수수료 ${f.fee.state === 'missing' ? '미입력' : f.fee.amount} · 펀딩 ${f.funding.state === 'missing' ? '미입력' : f.funding.amount}`];
  if (f.kind === 'close') lines.push(`포지션 순손익(입력된 수수료·펀딩만) ${tgM(t.totals.netEnteredMicro)} USDT`);
  if (f.note) lines.push(`메모: ${f.note.slice(0, 80)}`);
  return lines.join('\n');
}
const tgTradeOrUserError = fills => { try { return pnlComputeTrade(fills); } catch (e) { throw tgUserErr(`계산할 수 없는 체결입니다: ${String(e.message).slice(0, 80)}`); } };
const tgNextAt = (env, fills) => Math.max(env.now(), fills.reduce((m, f) => Math.max(m, f.at), 0) + 1);
const tgNum = v => { const t = String(v); return t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t; };
function tgRebuild(env, d) {                            // 확인 시점의 *현재 상태*로 다시 계산해 초안과 같은지 확인(그 사이 상태가 바뀐 초안이 잘못 저장되는 것을 막는다)
  let b;
  try { b = d.type === 'fill' ? tgBuildEntry(env, d.params) : tgBuildExit(env, d.params); }
  catch (e) { if (d.type === 'fill' && d.fill.kind === 'entry' && e instanceof StoreError && e.code === 'USER' && tgFillsOf(env.storeEnv(), d.fill.sid).length) throw tgUserErr('그 사이 포지션 상태가 바뀌어 이 초안은 맞지 않습니다. 다시 입력해 주세요'); throw e; }
  if (b.fill.kind !== d.fill.kind || b.fill.qty !== d.fill.qty) throw tgUserErr('그 사이 포지션 상태가 바뀌어 이 초안은 맞지 않습니다. 다시 입력해 주세요');
}
function tgStorePlan(env, f, actor) {                       // 계획은 참고용: 저장·계산에 실패해도 체결 기록은 영향받지 않는다
  try {
    const se = env.storeEnv(), sg = storeGet(se, 'signal', f.sid); if (!sg || sg.void || storeGet(se, 'plan', f.sid)) return;
    const eq = tgEquityNow(env); if (eq === null) return;
    const inp = { entry: f.price, stop: (f.plannedStop != null ? f.plannedStop : sg.data.stop), equity: eq }, plan = tgPlanBuild(se, f.sid, sg.data, inp); if (plan.status !== 'ok') return;
    storeCreate(se, 'plan', { sid: f.sid, ...inp, lev: plan.lev, stages: plan.stagesCount, at: f.at }, { actor });
  } catch (e_) { /* 계획 저장 실패는 무시 */ }
}
function tgCommitFill(env, draft, actor) {             // 확인(저장) 이후에만 호출. fillId는 초안/폼 id로 고정 → 중복 확인·재처리에도 1건.
  const se = env.storeEnv(), have = storeGet(se, 'fill', draft.fillId);
  if (have && !have.void) return { status: 'duplicate', key: draft.fillId, rev: have.rev, kind: have.data.kind };      // 빠른 경로(락 없이)
  if (draft.params) tgRebuild(env, draft);
  return storeWithLock(se, () => {                       // 중복 판정·응답·체결·계획 저장을 락 한 번 안에서(동시에 들어온 두 요청이 서로의 직전 기록을 보고 판정한다)
    const dupe = storeGet(se, 'fill', draft.fillId);
    if (dupe && !dupe.void) return { status: 'duplicate', key: draft.fillId, rev: dupe.rev, kind: dupe.data.kind };
    const same = tgFillsOf(se, draft.fill.sid), customAt = draft.params ? tgAtMs(env, draft.params) : undefined;
    if (customAt !== undefined && same.some(x => x.at >= customAt)) throw tgUserErr('입력한 시각이 이전 체결보다 앞이거나 같습니다');
    const f = { ...draft.fill, at: (customAt != null ? customAt : tgNextAt(env, same)), fillId: draft.fillId };
    if (draft.force !== true && same.some(x => TG_FAMILY[x.kind] === TG_FAMILY[f.kind] && x.price === f.price && x.qty === f.qty && Math.abs(x.at - env.now()) < TG_DUP_WINDOW_MS))
      throw tgUserErr('같은 계열(진입 또는 청산)·가격·수량의 체결이 방금 저장돼 있습니다(중복 저장 방지). 다른 체결이 맞으면 명령 끝에 force=1 을 붙여 다시 입력하세요');
    if (draft.type === 'fill') {
      const cur = storeGet(se, 'response', f.sid);
      if (!cur || cur.void) storeCreate(se, 'response', { sid: f.sid, choice: 'entered', at: f.at }, { actor });
    }
    const r = storeCreate(se, 'fill', f, { actor });
    if (r.status === 'conflict') throw tgUserErr('같은 체결 id에 다른 내용이 이미 있습니다');
    if (f.kind === 'entry') tgStorePlan(env, f, actor);
    return { ...r, kind: f.kind };
  });
}

// ── 입력 화면(모바일 폼) 제출: 폼의 제출 버튼이 곧 확인이다 ──
function tgSubmitFillForm(env, form, { actor = 'ui:form' } = {}) {
  try {
    if (!form || typeof form !== 'object') throw tgUserErr('입력 형식 오류');
    const sid = String((form.sid != null ? form.sid : '')), isExit = form.kind === 'exit', formId = String((form.formId != null ? form.formId : '')).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || env.randomId(8), fillId = `${sid}:${formId}`;
    const dupe = storeGet(env.storeEnv(), 'fill', fillId);          // 같은 폼 재제출(네트워크 재시도·더블탭)은 상태가 바뀌었어도 duplicate로 수렴
    if (dupe && !dupe.void) return { ok: true, status: 'duplicate', kind: dupe.data.kind };
    const atMs = tgParseAt(form.at, env.now()), common = { fee: form.fee ? String(form.fee) : undefined, funding: form.funding ? String(form.funding) : undefined, force: form.force === true, ...(atMs === undefined ? {} : { atMs }), ...(form.note ? { note: String(form.note) } : {}) };
    const built = isExit ? tgBuildExit(env, { sid, price: String((form.price != null ? form.price : '')), qty: form.qty === undefined || form.qty === '' ? undefined : String(form.qty), ...common })
      : tgBuildEntry(env, { sid, margin: String((form.margin != null ? form.margin : '')), leverage: String((form.leverage != null ? form.leverage : '')), entry: String((form.entry != null ? form.entry : '')), stop: form.stop ? String(form.stop) : undefined, qty: form.qty ? String(form.qty) : undefined, ...common });
    const r = tgCommitFill(env, { ...built, fillId }, actor); const out = { ok: true, status: r.status, kind: built.fill.kind, summary: built.summary };
    if (built.fill.kind === 'close') { const p = tgPairedUser(env); if (p) out.reviewPrompt = tgSendReviewPromptIfNeeded(env, p.chatId, sid); }
    return out;
  } catch (e) { if (e instanceof StoreError && (e.code === 'USER' || e.code === 'VALIDATION')) return { ok: false, error: 'invalid', message: String(e.message).slice(0, 160) }; if (e instanceof StoreError && e.code === 'LOCK') return { ok: false, error: 'busy', retry: true }; return { ok: false, error: 'server' }; }
}
function tgSendReviewPromptIfNeeded(env, chatId, sid) {      // 프롬프트는 청산당 1회: 이미 복기했거나 이미 보냈으면 건너뜀. 보낸 뒤 표시(kv)를 남겨, 저장 후 재처리에서도 빠지지 않고 중복도 없다.
  const rv = storeGet(env.storeEnv(), 'review', sid); if (rv && !rv.void) return { ok: true, skipped: true };
  if (env.kv.get(`rp:${sid}`) !== null) return { ok: true, skipped: true };
  const r = tgSendReviewPrompt(env, chatId, sid); if (r.ok) env.kv.put(`rp:${sid}`, String(env.now()));
  return { ok: r.ok, code: r.code };
}

// ── 명령 ──
const TG_HELP = ['RICH300 명령', '/fill 신호ID 증거금 레버리지 진입가 [손절가|-] [qty= at=14:30 fee= funding=]', '/exit 신호ID 청산가 [수량|50%|all] [at=14:30 fee= funding= memo=복기_메모]  (수량이 잔량보다 적으면 부분청산)', '/equity 금액 [날짜] [unrealized=값]  (마감 평가액 입력, 날짜 생략 시 평가액 없는 최근 마감일)', '/plan 신호ID [평가액]  (분할 진입·익절 계획과 현재 상태 — 계산 참고용, 주문 아님)', '/review 신호ID · /status · /help', '수수료·펀딩은 fee=0.12 (추정은 fee=~0.12), 비우면 미입력', '같은 체결이 10분 안에 또 들어오면 중복으로 막습니다(맞으면 force=1)'].join('\n');
function tgConfirmDraft(env, ev, built) {
  const id = env.randomId(8); tgKvPut(env, `d:${id}`, { type: built.type, fill: built.fill, equity: built.equity, params: built.params, force: built.force === true, sid: built.fill ? built.fill.sid : undefined, chatId: ev.chatId, userId: ev.fromId }, TG_DRAFT_TTL_SEC);
  const s = tgSend(env, ev.chatId, `${built.summary}\n저장할까요?`, { inline_keyboard: [[{ text: '저장', callback_data: `f1:${id}:y` }, { text: '취소', callback_data: `f1:${id}:n` }]] });
  return { status: 'handled', action: built.type === 'fill' ? 'fill-draft' : built.type === 'equity' ? 'equity-draft' : 'exit-draft', replyFailed: !s.ok };
}
function tgDefaultEquityDay(env) {                      // 평가액이 없는 가장 최근 *마감된* 날, 없으면 오늘(KST)
  try { const m = closeStatus(env, { now: env.now(), days: 14 }).find(d => d.closed && d.equity === null); if (m) return m.day; } catch (e_) { /* 챌린지 없음 등 */ }
  return kstDayOf(env.now());
}
function tgPlanText(env, sid, equityArg) {
  const se = env.storeEnv(), sg = storeGet(se, 'signal', sid); if (!sg || sg.void) throw tgUserErr(`알 수 없는 신호: ${String(sid).slice(0, 40)}`);
  const stored = equityArg === undefined ? tgPlanOf(se, sid) : null;
  if (stored) {
    const fills = tgFillsOf(se, sid), st = splanStatus(stored, tgPlanFills(fills), tgPlanCtx(env, sg.data));
    return [...splanLines(stored), '', ...splanStatusLines(stored, st), '15분봉 종가 기준 구조 유지·미체결 주문 취소 여부는 거래소 차트에서 직접 확인하세요'].join('\n');
  }
  const pv = tgPlanPreview(env, sid, equityArg);
  if (!pv.plan) return '계획을 만들 평가액이 없습니다. /plan 신호ID 평가액 으로 평가액을 직접 넣어 보세요';
  return [...splanLines(pv.plan, { assumed: equityArg !== undefined }), '', equityArg === undefined ? '※ 오늘 시작 평가액 기준 미리보기. 첫 진입을 기록하면 이 계획이 고정됩니다' : '※ 입력한 평가액 기준 미리보기(저장되지 않음)'].join('\n');
}
function tgPlanCard(env, sid) {                          // [진입했어] 직후 안내: 실패해도 기록·안내에는 영향 없음
  try { return `\n\n${tgPlanText(env, sid)}`; } catch (e_) { return ''; }
}
function tgOnMessage(env, ev) {
  const c = tgParseCommand(ev.text); if (!c) return { status: 'ignored', action: 'not-command' };
  const reply = (t, extra) => { const s = tgSend(env, ev.chatId, t, extra); return { replyFailed: !s.ok }; };
  try {
    if (c.cmd === 'start' || c.cmd === 'help') return { status: 'handled', action: 'help', ...reply(TG_HELP) };
    if (c.cmd === 'fill') {
      if (c.pos.length < 4) return { status: 'handled', action: 'usage', ...reply('사용법: /fill 신호ID 증거금 레버리지 진입가 [손절가|-] [qty= at=14:30 fee= funding=]') };
      const [sid, margin, leverage, entry, stop] = c.pos, atMs = tgParseAt(c.opt.at, env.now()); return tgConfirmDraft(env, ev, tgBuildEntry(env, { sid, margin, leverage, entry, stop: stop === '-' ? undefined : stop, qty: c.opt.qty, fee: c.opt.fee, funding: c.opt.funding, force: c.opt.force === '1', ...(atMs === undefined ? {} : { atMs }), ...(c.opt.memo ? { note: c.opt.memo } : {}) }));
    }
    if (c.cmd === 'exit') {
      if (c.pos.length < 2) return { status: 'handled', action: 'usage', ...reply('사용법: /exit 신호ID 청산가 [수량|50%|all] [at=14:30 fee= funding= memo=복기_메모]') };
      const atMs = tgParseAt(c.opt.at, env.now()); return tgConfirmDraft(env, ev, tgBuildExit(env, { sid: c.pos[0], price: c.pos[1], qty: (c.pos[2] != null ? c.pos[2] : c.opt.qty), fee: c.opt.fee, funding: c.opt.funding, force: c.opt.force === '1', ...(atMs === undefined ? {} : { atMs }), ...(c.opt.memo ? { note: c.opt.memo.replace(/_/g, ' ') } : {}) }));
    }
    if (c.cmd === 'equity') {
      if (c.pos.length < 1) return { status: 'handled', action: 'usage', ...reply('사용법: /equity 금액 [날짜] [unrealized=값]') };
      const day = (c.pos[1] != null ? c.pos[1] : tgDefaultEquityDay(env)); if (!isDayString(day)) return { status: 'handled', action: 'user-error', ...reply('⚠ 날짜 형식은 YYYY-MM-DD 입니다') };
      closeCheckEquityDay(env, day, env.now());
      const amount = schemaDecString(c.pos[0], '평가액', { nonNegative: true }), un = c.opt.unrealized === undefined ? undefined : schemaDecString(c.opt.unrealized, '미실현 손익');
      return tgConfirmDraft(env, ev, { type: 'equity', equity: { day, equity: amount, ...(un === undefined ? {} : { unrealized: un }) }, summary: `평가액 입력 · ${day}\n실제 계좌 평가액 ${amount} USDT${un === undefined ? '' : ` (미실현 ${un})`}\n(장부와 다르면 차이만 표시하고 손익에는 자동 반영하지 않습니다)` });
    }
    if (c.cmd === 'review') {
      const sid = c.pos[0]; if (!sid || !TG_SID_RE.test(sid)) return { status: 'handled', action: 'usage', ...reply('사용법: /review 신호ID') };
      if (!tgFillsOf(env.storeEnv(), sid).length) return { status: 'handled', action: 'review-none', ...reply('이 신호의 체결 기록이 없습니다') };
      const s = tgSendReviewPrompt(env, ev.chatId, sid); return { status: 'handled', action: 'review-prompt', replyFailed: !s.ok };
    }
    if (c.cmd === 'plan') {
      const sid = c.pos[0]; if (!sid || !TG_SID_RE.test(sid)) return { status: 'handled', action: 'usage', ...reply('사용법: /plan 신호ID [평가액]') };
      const eqArg = c.pos[1] === undefined ? undefined : schemaDecString(c.pos[1], '평가액', { positive: true });
      return { status: 'handled', action: 'plan', ...reply(tgPlanText(env, sid, eqArg)) };
    }
    if (c.cmd === 'status') {
      const open = [...pnlComputeAll(storeList(env.storeEnv(), 'fill').map(r => r.data), {}).values()].filter(t => t.status === 'open');
      return { status: 'handled', action: 'status', ...reply(open.length ? ['열린 포지션', ...open.slice(0, 8).map(t => `${t.sid} ${t.dir} ${tgNum(t.openQty)} @ ${tgNum(t.avgEntry)}`)].join('\n') : '열린 포지션 없음') };
    }
    return { status: 'handled', action: 'unknown-command', ...reply('알 수 없는 명령입니다. /help') };
  } catch (e) {
    if (e instanceof StoreError && (e.code === 'USER' || e.code === 'VALIDATION' || e.code === 'NOT_FOUND')) return { status: 'handled', action: 'user-error', ...reply(`⚠ ${String(e.message).slice(0, 160)}`) };
    throw e;
  }
}

// ── 버튼(callback) ──
function tgOnCallback(env, ev) {
  const answer = t => tgAnswer(env, ev.cbId, t), parts = ev.data.split(':');
  const cb = { chatId: ev.chatId, messageId: ev.messageId, photo: ev.isPhoto === true };
  if (parts[0] === 'r1' && parts.length === 3 && TG_RESP[parts[2]]) return tgOnResponse(env, ev, parts[1], TG_RESP[parts[2]], cb, answer);
  if (parts[0] === 'v1' && (parts.length === 3 || (parts.length === 4 && parts[3] === 's'))) return tgOnReview(env, ev, parts, cb, answer);
  if (parts[0] === 'f1' && parts.length === 3 && (parts[2] === 'y' || parts[2] === 'n')) return tgOnDraft(env, ev, parts[1], parts[2], cb, answer);
  answer('처리할 수 없는 버튼입니다'); return { status: 'handled', action: 'unknown-button' };
}
function tgOnResponse(env, ev, sid, choice, cb, answer) {
  const se = env.storeEnv();
  let sg = storeGet(se, 'signal', sid);
  if (!sg || sg.void) {                                  // R9: COIN RADAR 메시지의 'R9 v1' 줄에서 신호를 만든다(같은 sid의 메시지만, 이미 있으면 건드리지 않음)
    const parsed = r9ParseSignal(ev.msgText);
    if (parsed && parsed.sid === sid) {
      try { storeCreate(se, 'signal', parsed, { actor: 'tg:r9' }); } catch (e) { if (!(e instanceof StoreError)) throw e; if (e.code === 'LOCK') throw e; }
      sg = storeGet(se, 'signal', sid);
    }
  }
  if (!sg || sg.void) { answer('알 수 없는 신호입니다'); return { status: 'handled', action: 'unknown-signal' }; }
  const shown = ev.msgText && r9ParseSignal(ev.msgText) ? r9StripLine(ev.msgText) : tgSignalText(sg.data);
  const r = storeCreate(se, 'response', { sid, choice, at: env.now() }, { actor: 'tg' });
  if (r.status === 'conflict') { const cur = storeGet(se, 'response', sid); answer(`이미 '${RESPONSE_CHOICES[cur.data.choice]}'로 기록됨(수정은 앱에서)`); tgEdit(env, cb, shown + `\n→ ${RESPONSE_CHOICES[cur.data.choice]}`); return { status: 'handled', action: 'response-conflict' }; }
  const a = answer(`기록: ${RESPONSE_CHOICES[choice]}`), e = tgEdit(env, cb, `${shown}\n→ ${RESPONSE_CHOICES[choice]}`);
  let replyFailed = !tgOkOrBenign(a) || !tgOkOrBenign(e);
  if (choice === 'entered' && r.status === 'added') {
    const link = tgFillLink(env.uiUrl, sg.data), s = tgSend(env, ev.chatId, `진입 기록: /fill ${sid} 증거금 레버리지 ${sg.data.entry} ${sg.data.stop}${link ? '\n(숫자 입력은 아래 화면이 더 편합니다)' : ''}${tgPlanCard(env, sid)}`, link ? { inline_keyboard: [[{ text: '입력 화면 열기', url: link }]] } : undefined);
    replyFailed = replyFailed || !s.ok;
  }
  return { status: 'handled', action: r.status === 'added' ? 'response-saved' : 'response-duplicate', replyFailed };
}
function tgOnReview(env, ev, parts, cb, answer) {
  const sid = parts[1], st = parts[2], plan = st.slice(0, 2), mind = st.slice(2);
  if (!TG_SID_RE.test(sid) || st.length !== 4 || !TG_PLAN_CODES[plan] || !TG_MIND_CODES[mind]) { answer('처리할 수 없는 버튼입니다'); return { status: 'handled', action: 'unknown-button' }; }
  if (parts.length === 3) {                                   // 선택 변경: 화면만 바꾸고 아무것도 저장하지 않는다
    const e = tgEdit(env, cb, tgReviewText(sid, plan, mind), tgReviewKeyboard(sid, plan, mind)); answer();
    return { status: 'handled', action: 'review-select', replyFailed: !tgOkOrBenign(e) };
  }
  const se = env.storeEnv();
  if (!tgFillsOf(se, sid).length) { answer('체결 기록이 없어 복기할 수 없습니다'); return { status: 'handled', action: 'review-none' }; }
  const r = storeSaveReview(se, { sid, plan: TG_PLAN_CODES[plan], mind: TG_MIND_CODES[mind] }, { actor: 'tg' });
  const e = tgEdit(env, cb, `복기 저장됨 · ${sid}\n${PLAN_CHOICES[TG_PLAN_CODES[plan]]} · ${MIND_CHOICES[TG_MIND_CODES[mind]]}`); answer(r.status === 'unchanged' ? '이미 같은 내용으로 저장됨' : '저장했습니다');
  return { status: 'handled', action: `review-${r.status}`, replyFailed: !tgOkOrBenign(e) };
}
function tgOnDraft(env, ev, id, yn, cb, answer) {
  const d = tgKvGet(env, `d:${id}`);
  if (!d) { answer('만료됐거나 이미 처리됐습니다. 다시 입력해 주세요'); tgEdit(env, cb, '(만료됨)'); return { status: 'handled', action: 'draft-gone' }; }
  if (d.userId !== ev.fromId) { return { status: 'ignored', action: 'draft-other-user' }; }
  if (yn === 'n') { env.kv.del(`d:${id}`); answer('취소했습니다'); tgEdit(env, cb, '취소됨'); return { status: 'handled', action: 'draft-cancelled' }; }
  if (d.type === 'equity') return tgCommitEquity(env, ev, d, cb, answer);
  let r;
  try { r = tgCommitFill(env, { type: d.type, fill: d.fill, params: d.params, force: d.force === true, fillId: `${d.sid}:${id}` }, 'tg'); }
  catch (e) { if (e instanceof StoreError && (e.code === 'USER' || e.code === 'VALIDATION')) { env.kv.del(`d:${id}`); answer('저장하지 못했습니다'); tgEdit(env, cb, `⚠ ${String(e.message).slice(0, 200)}`); return { status: 'handled', action: 'fill-rejected' }; } throw e; }
  const a = answer(r.status === 'duplicate' ? '이미 저장됨' : '저장했습니다'), e = tgEdit(env, cb, `저장됨 ✓\n${d.fill.kind === 'close' ? '전량 청산' : d.fill.kind === 'reduce' ? '부분 청산' : d.fill.kind === 'add' ? '추가진입' : '진입'} ${d.fill.dir} · ${d.sid} · ${d.fill.price} × ${d.fill.qty}`);
  let replyFailed = !tgOkOrBenign(a) || !tgOkOrBenign(e);
  if (d.fill.kind === 'close') { const s = tgSendReviewPromptIfNeeded(env, ev.chatId, d.sid); replyFailed = replyFailed || !s.ok; }
  return { status: 'handled', action: r.status === 'duplicate' ? 'fill-duplicate' : 'fill-saved', replyFailed };
}

function tgCommitEquity(env, ev, d, cb, answer) {        // 확인(저장) 이후에만. 같은 값 재저장은 unchanged, 다른 값은 수정 이력으로 남는다.
  let r;
  try { r = closeSubmitEquity(env, { ...d.equity, reason: 'Telegram 입력' }, { actor: 'tg', now: env.now() }); }
  catch (e) { if (e instanceof StoreError && (e.code === 'VALIDATION' || e.code === 'NOT_FOUND')) { answer('저장하지 못했습니다'); tgEdit(env, cb, `⚠ ${String(e.message).slice(0, 160)}`); return { status: 'handled', action: 'equity-invalid' }; } throw e; }
  const warn = r.flags.map(f => CLOSE_WARNING_TEXT[f]).filter(Boolean).slice(0, 3), lines = [`${r.status === 'unchanged' ? '이미 같은 값' : '저장됨 ✓'} · ${r.day} 평가액 ${d.equity.equity} USDT${r.late ? ' (마감 후 입력)' : ''}`];
  if (r.diffLabel !== null) lines.push(`장부 기준 ${r.expectedLabel} · 차이 ${r.diffMicro && BigInt(r.diffMicro) > BigInt(0) ? '+' : ''}${r.diffLabel}`);
  if (warn.length) lines.push(`⚠ ${warn.join(' · ')}`);
  const a = answer(r.status === 'unchanged' ? '이미 저장됨' : '저장했습니다'), e = tgEdit(env, cb, lines.join('\n'));
  return { status: 'handled', action: `equity-${r.status}`, replyFailed: !tgOkOrBenign(a) || !tgOkOrBenign(e) };
}

// ── 한 건 처리 ──
function tgHandleUpdate(env, update) {
  const ev = tgParseUpdate(update); if (!ev) return { status: 'ignored', action: 'unparsable' };
  if (ev.kind === 'message') { const c = tgParseCommand(ev.text); if (c && (c.cmd === 'pair' || (c.cmd === 'start' && c.pos.length > 0))) return tgPairAttempt(env, ev, c.pos[0]); }      // /pair 코드, 또는 t.me/<봇>?start=코드 링크
  const paired = tgPairedUser(env);
  if (!paired || ev.isBot || ev.fromId !== paired.userId || ev.chatType !== 'private' || (ev.chatId !== null && ev.chatId !== paired.chatId)) return { status: 'ignored', action: 'unpaired' };   // 무응답·무기록
  const se = env.storeEnv();
  if (storeGet(se, 'tgupdate', `u:${ev.updateId}`) || (ev.cbId && storeGet(se, 'tgupdate', `cb:${ev.cbId}`))) return { status: 'duplicate', action: 'already-processed' };
  let out;
  try { out = ev.kind === 'callback' ? (ev.chatId === null || ev.messageId === null ? { status: 'ignored', action: 'no-message' } : tgOnCallback(env, ev)) : tgOnMessage(env, ev); }
  catch (e) { if (e instanceof StoreError && e.code === 'LOCK') return { status: 'retry', action: 'lock' }; return { status: 'retry', action: 'error', errorType: e instanceof StoreError ? e.code : 'exception' }; }
  if (out.status === 'ignored') return out;
  try { storeClaimUpdate(se, 'u', ev.updateId, 'tg'); if (ev.cbId) storeClaimUpdate(se, 'cb', ev.cbId, 'tg'); }
  catch (e) { return { status: 'retry', action: e instanceof StoreError && e.code === 'LOCK' ? 'lock' : 'error', errorType: e instanceof StoreError ? e.code : 'exception' }; }   // 기록은 이미 저장됨: 재처리는 sid·fillId 유일키로 같은 결과(중복 없음)
  return out;
}

// ── 폴링(1분 트리거에서 호출) ──
function tgPoll(env, { limit = 50, leaseMs = 55000 } = {}) {
  const lease = tgKvGet(env, 'poll'); if (lease && lease.until > env.now()) return { status: 'busy' };
  tgKvPut(env, 'poll', { until: env.now() + leaseMs });
  const stats = { status: 'ok', handled: 0, ignored: 0, duplicate: 0, retry: 0, poison: 0, replyFailed: 0, actions: {} };
  try {
    const off = Number(nullishOr(tgKvGet(env, 'offset'), 0)), r = tgCall(env, 'getUpdates', { ...(off ? { offset: off } : {}), limit, timeout: 0, allowed_updates: ['message', 'callback_query'] });
    if (!r.ok) return { ...stats, status: 'error', code: r.code, retryable: r.retryable };
    const list = (Array.isArray(r.result) ? r.result : []).filter(u => Number.isSafeInteger((u == null ? undefined : u.update_id))).sort((a, b) => a.update_id - b.update_id);
    for (const u of list) {
      const x = tgHandleUpdate(env, u);
      if (u.message && Number.isFinite(u.message.date)) ((stats.lags || (stats.lags = []))).push(Math.max(0, env.now() - u.message.date * 1000));      // 메시지 도착→처리 지연(ms, 관측용)
      if (x.status === 'retry') {
        const key = `fail:${u.update_id}`, n = (nullishOr(tgKvGet(env, key), 0)) + 1;
        if (n < TG_POISON_AFTER) { tgKvPut(env, key, n, 3600); stats.retry++; break; }          // 순서 보존: 이 update에서 멈추고 다음 틱에 재시도
        stats.poison++; env.kv.del(key);                                                        // 계속 실패하는 update는 건너뛴다
      } else { stats[x.status === 'handled' ? 'handled' : x.status === 'duplicate' ? 'duplicate' : 'ignored']++; if (x.action) stats.actions[x.action] = ((stats.actions[x.action] != null ? stats.actions[x.action] : 0)) + 1; }
      if (x.replyFailed) stats.replyFailed++;
      tgKvPut(env, 'offset', u.update_id + 1);
    }
    return stats;
  } finally { env.kv.del('poll'); }
}
// 정리: 만료된 초안·실패 카운터와 오래된 복기 표시를 지운다(Script Properties 용량 보호). env.kv.keys()가 없으면 아무것도 하지 않는다. 최대 1시간에 한 번.
function tgGc(env) {
  if (typeof env.kv.keys !== 'function' || tgKvGet(env, 'gc')) return { ran: false };
  tgKvPut(env, 'gc', 1, 3600); let removed = 0;
  for (const k of env.kv.keys()) {
    if (k.startsWith('d:') || k.startsWith('fail:')) { if (tgKvGet(env, k) === null) removed++; }
    else if (k.startsWith('rp:')) { const at = Number(env.kv.get(k)); if (!Number.isFinite(at) || env.now() - at > 30 * 86400000) { env.kv.del(k); removed++; } }
  }
  return { ran: true, removed };
}

// ── watch.mjs ──
// RICH300 보유 포지션 감시(순수 규칙 + 오케스트레이션). 사용자가 *실제 체결로 등록한* 포지션만 감시하고, 시세는 거래소 공개 데이터(읽기 전용)로만 쓴다. 주문·계정 API 없음.
//  · 입력 구분: 체결(fills)=사용자 기록, 시세(market)=거래소 공개 시세(지연 가능). 메시지에서 두 출처를 따로 표시한다.
//  · 모든 판단은 아래 WATCH 상수와 수치 조건으로 정의한다(테스트 가능). 같은 이벤트는 dedupe 키로 한 번만 전송한다.
//  · 상태 저장은 env.kv(Script Properties 'w:' 접두)에만 한다 — COIN RADAR(GitHub Actions 캐시)·텔레그램 입력 상태('tg:')와 분리.
//  · 전송 의미: 한 번만(at-most-once). 보내기 전에 'pending' 표시를 남기고, 실패(API 오류 응답)일 때만 재시도한다. 프로세스가 전송 직후 죽어 'pending'이 남으면 다시 보내지 않는다.
//  env 포트: { now(), mode():'off'|'preview'|'on', storeEnv(), kv:{get,put,del,keys}, market(symbolId): Promise 아님 — {ok,source,price,priceAt,bars15m,bars1h,bars4h}, send(text):{ok,code?}, equityEnv? }

const WATCH = Object.freeze({
  emaFast: 20, emaSlow: 50, volLook: 20, minBars: 55,
  stopNearR: 0.25, stopNearRearmR: 0.5, stopTrendR: 0.6, stopTrendVol: 1.2,
  tpR: Object.freeze([1.5, 2]), trailStepR: 0.25,
  swingMinR: 2, swingHoldMinR: 1, swingVol4h: 0.9, swingHoldEveryMs: 24 * 3600000,
  addVolMin: 1, dayLossPct: 0.03,
  staleMarketMs: 10 * 60000, barGraceMs: 10 * 60000, marketDownFails: 3,
  cooldownMs: Object.freeze({ STOP_TREND: 60 * 60000, SWING_HOLD: 24 * 3600000 }),
  retryDelaysMs: Object.freeze([2 * 60000, 5 * 60000, 10 * 60000, 20 * 60000]), expireMs: 30 * 60000,
  capHour: 12, capDay: 60, maxPerPosTick: 3, keepSent: 40,
});

// ── 지표 ──
function watchEma(vals, n) {
  if (!Array.isArray(vals) || vals.length < n) return null;
  const k = 2 / (n + 1); let e = 0; for (let i = 0; i < n; i++) e += vals[i]; e /= n;
  for (let i = n; i < vals.length; i++) e = vals[i] * k + e * (1 - k);
  return e;
}
// bars: 마감된 봉만, 오래된 것 → 최신. { t, o, h, l, c, v }
function watchTrend(bars) {
  if (!Array.isArray(bars) || bars.length < WATCH.minBars) return { state: 'unknown' };
  const closes = bars.map(b => b.c), fast = watchEma(closes, WATCH.emaFast), slow = watchEma(closes, WATCH.emaSlow), slowPrev = watchEma(closes.slice(0, -5), WATCH.emaSlow), last = closes[closes.length - 1];
  const up = last > slow && fast > slow && slow > slowPrev, down = last < slow && fast < slow && slow < slowPrev;
  return { state: up ? 'up' : down ? 'down' : 'flat', fast, slow, last };
}
function watchVolRatio(bars, n = WATCH.volLook) {
  if (!Array.isArray(bars) || bars.length < n + 1) return null;
  const prev = bars.slice(-n - 1, -1), avg = prev.reduce((a, b) => a + b.v, 0) / n;
  return avg > 0 ? bars[bars.length - 1].v / avg : null;
}
const wAligned = (trend, dir) => (dir === 'LONG' ? trend.state === 'up' : trend.state === 'down');
const wAgainst = (trend, dir) => (dir === 'LONG' ? trend.state === 'down' : trend.state === 'up');

// ── 포지션 목록(사용자 기록에서만) ──
function watchOpenPositions(se, { now }) {
  const fills = storeList(se, 'fill').map(r => r.data), by = new Map();
  for (const f of fills) { if (!by.has(f.sid)) by.set(f.sid, []); by.get(f.sid).push(f); }
  const signals = new Map(storeList(se, 'signal').map(r => [r.key, r.data])), today = kstDayOf(now), positions = [], skipped = []; let realizedTodayMicro = 0;
  for (const [sid, list] of by) {
    let t; try { t = pnlComputeTrade(list); } catch (e_) { skipped.push({ sid, reason: 'invalid-fills' }); continue; }
    if (!t) continue;
    for (const e of t.events) if (e.day === today) realizedTodayMicro += Number(e.grossMicro) - (e.feeState === 'entered' ? Number(e.feeMicro) : 0) + (e.fundingState === 'entered' ? Number(e.fundingMicro) : 0);
    if (t.status !== 'open') continue;
    const sg = signals.get(sid); if (!sg) { skipped.push({ sid, reason: 'no-symbol' }); continue; }      // 종목을 알 수 없으면 시세를 볼 수 없다(수동 종목 등록은 별도 기능)
    const sorted = [...list].sort((a, b) => a.at - b.at), entry = sorted[0], hasOpening = sorted.some(f => f.kind === 'opening');
    let plan = null; try { plan = hasOpening ? null : tgPlanOf(se, sid); } catch (e_) { plan = null; }
    const stop0 = plan ? plan.stop : (entry.plannedStop != null ? Number(entry.plannedStop) : null);
    positions.push({ sid, symbolId: sg.symbolId, dir: t.dir, avgEntry: Number(t.avgEntry), openQty: Number(t.openQty), firstAt: sorted[0].at, signalAt: sg.signalAt, plan, stop0,
      fills: sorted.map(f => ({ kind: f.kind, price: Number(f.price), qty: Number(f.qty), at: f.at })) });
  }
  return { positions, skipped, realizedTodayMicro, today };
}

// ── 시세 응답 해석(순수): OKX·Bybit 공개 API. 마감된 봉만, 오래된 것 → 최신으로 돌려준다 ──
const watchOkxInst = symbolId => (/^[A-Z0-9]{2,20}USDT$/.test(symbolId) ? `${symbolId.replace(/USDT$/, '')}-USDT-SWAP` : null);
function watchParseOkxBars(json) {
  if (!json || json.code !== '0' || !Array.isArray(json.data)) return null;
  return json.data.filter(r => Array.isArray(r) && r[8] === '1').map(r => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: Number(r[5]) })).filter(b => [b.t, b.o, b.h, b.l, b.c, b.v].every(Number.isFinite)).sort((a, b) => a.t - b.t);
}
function watchParseOkxTicker(json) {
  const d = json && json.code === '0' && Array.isArray(json.data) ? json.data[0] : null; const price = d ? Number(d.last) : NaN, at = d ? Number(d.ts) : NaN;
  return Number.isFinite(price) && price > 0 && Number.isFinite(at) ? { price, priceAt: at } : null;
}
function watchParseBybitBars(json, intervalMs, now) {
  if (!json || json.retCode !== 0 || !json.result || !Array.isArray(json.result.list)) return null;
  return json.result.list.map(r => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: Number(r[5]) })).filter(b => [b.t, b.o, b.h, b.l, b.c, b.v].every(Number.isFinite) && b.t + intervalMs <= now).sort((a, b) => a.t - b.t);
}
function watchParseBybitTicker(json) {
  const d = json && json.retCode === 0 && json.result && Array.isArray(json.result.list) ? json.result.list[0] : null, price = d ? Number(d.lastPrice) : NaN, at = json ? Number(json.time) : NaN;
  return Number.isFinite(price) && price > 0 && Number.isFinite(at) ? { price, priceAt: at } : null;
}

// ── 시세 요청 주소·판정(순수): GAS 어댑터와 실제 연결 점검(perf/market-check.mjs)이 같은 주소·같은 판정을 쓴다 ──
const WATCH_BAR_MS = Object.freeze({ '15m': 900000, '1h': 3600000, '4h': 14400000 });
function watchMarketUrls(src, symbolId) {
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbolId)) return null;
  if (src === 'OKX') { const i = watchOkxInst(symbolId), b = 'https://www.okx.com/api/v5/market'; return { ticker: `${b}/ticker?instId=${i}`, '15m': `${b}/candles?instId=${i}&bar=15m&limit=6`, '1h': `${b}/candles?instId=${i}&bar=1H&limit=100`, '4h': `${b}/candles?instId=${i}&bar=4H&limit=100` }; }
  const b = 'https://api.bybit.com/v5/market', k = `${b}/kline?category=linear&symbol=${symbolId}`;
  return { ticker: `${b}/tickers?category=linear&symbol=${symbolId}`, '15m': `${k}&interval=15&limit=6`, '1h': `${k}&interval=60&limit=100`, '4h': `${k}&interval=240&limit=100` };
}
// 응답(JSON 객체들)을 시세 묶음으로 해석. jsons = { ticker, '15m', '1h', '4h' } (없거나 잘못된 응답은 null)
function watchParseSource(src, jsons, now) {
  const tk = src === 'OKX' ? watchParseOkxTicker(jsons.ticker) : watchParseBybitTicker(jsons.ticker), bars = {};
  for (const k of ['15m', '1h', '4h']) bars[k] = src === 'OKX' ? watchParseOkxBars(jsons[k]) : watchParseBybitBars(jsons[k], WATCH_BAR_MS[k], now);
  return { ticker: tk, bars };
}
// 감시에 쓸 수 있는 시세인가: 신선도(시세 10분·마지막 마감 봉 1시간/4시간 이내)·봉 개수·끊김 없음·티커와 봉 가격 일치. 사유 코드만 돌려준다.
function watchAssessMarket(m, now) {
  if (!m || !(m.price > 0)) return { ok: false, why: 'no-price' };
  if (now - m.priceAt > WATCH.staleMarketMs) return { ok: false, why: 'stale-price' };
  for (const [k, minN, maxAge] of [['1h', WATCH.minBars, 2 * 3600000 + WATCH.barGraceMs], ['4h', WATCH.minBars, 8 * 3600000 + WATCH.barGraceMs]]) {      // 마지막 *마감* 봉의 시작 시각은 (봉 길이×2)까지 거슬러 올라갈 수 있다 — 실제 점검에서 4h 봉이 7시간 55분 전으로 관측됨. 확정 지연 여유 10분
    const b = m['bars' + k]; if (!Array.isArray(b) || b.length < minN) return { ok: false, why: `few-bars-${k}` };
    if (now - b[b.length - 1].t > maxAge) return { ok: false, why: `stale-bars-${k}` };
    const step = WATCH_BAR_MS[k]; for (let i = b.length - minN + 1; i < b.length; i++) if (b[i].t - b[i - 1].t !== step) return { ok: false, why: `gap-bars-${k}` };
  }
  if (!Array.isArray(m.bars15m) || !m.bars15m.length) return { ok: false, why: 'no-bars-15m' };
  const last = m.bars1h[m.bars1h.length - 1].c; if (Math.abs(m.price - last) / last > 0.2) return { ok: false, why: 'price-mismatch' };
  return { ok: true, why: null };
}

const wFmt = (x, ref) => { const d = Math.abs(ref) >= 100 ? 2 : Math.abs(ref) >= 10 ? 3 : Math.abs(ref) >= 1 ? 4 : 6; return Number(x).toFixed(d); };
const wHhmm = ms => new Date(ms + 9 * 3600000).toISOString().slice(11, 16);

// ── 포지션 한 건 평가 ──
// state(포지션별 저장 상태): { sent:{key:{at,st,tries,next,text}}, armed:{stopNear}, nNear, lastStop, swing:'cand'|'ended'|null, lastHoldAt, last:{type:at} }
function watchEvaluate({ pos, market, now, state, dayBlocked = false }) {
  const sg = splanSign(pos.dir), p = market.price, avg = pos.avgEntry, plan = pos.plan, events = [], st0 = state, ns = { ...st0, armed: { ...st0.armed }, last: { ...st0.last } };
  const t1 = watchTrend(market.bars1h), t4 = watchTrend(market.bars4h), v1 = watchVolRatio(market.bars1h), v4 = watchVolRatio(market.bars4h);
  const R0 = plan ? plan.R : (pos.stop0 != null ? Math.abs(avg - pos.stop0) : null);
  const closed15 = market.bars15m && market.bars15m.length ? market.bars15m[market.bars15m.length - 1] : null;
  const since = market.bars1h.filter(b => b.t + 3600000 > pos.firstAt);
  const ctx = { lastClose: closed15 ? closed15.c : undefined, lastHigh: since.length ? Math.max(...since.map(b => b.h)) : undefined, lastLow: since.length ? Math.min(...since.map(b => b.l)) : undefined,
    barsSinceSignal: Math.max(0, Math.floor((now - nullishOr(pos.signalAt, now)) / 900000)) };
  const st = plan ? splanStatus(plan, pos.fills, ctx) : null;
  const stopNow = st ? st.stopPrice : pos.stop0, rNow = R0 > 0 ? (p - avg) * sg / R0 : null, pnl = (p - avg) * sg * pos.openQty;
  const snap = { sid: pos.sid, symbolId: pos.symbolId, dir: pos.dir, avg, openQty: pos.openQty, price: p, pnl, rNow, stop: stopNow, t1: t1.state, t4: t4.state, v1, v4 };
  const push = (type, key, level, reason, action, extra) => events.push({ type, key, level, sid: pos.sid, reason, action, ...(extra || {}) });
  const side = pos.dir === 'LONG' ? '롱' : '숏';

  // 1) 손절 위험
  if (stopNow != null && R0 > 0) {
    const dStop = (p - stopNow) * sg;
    if (dStop <= 0) push('STOP_BREACH', `STOP_BREACH:${pos.sid}:${wFmt(stopNow, stopNow)}`, 'critical', [`시세가 손절가 ${wFmt(stopNow, stopNow)}를 ${pos.dir === 'LONG' ? '아래로' : '위로'} 넘었습니다(시세 기준)`], 'Binance에서 손절이 체결됐는지 확인하고, 체결됐다면 웹앱에 청산을 등록하세요. 아직 보유 중이면 즉시 청산 여부를 결정하세요');
    else {
      if (dStop > WATCH.stopNearRearmR * R0) ns.armed.stopNear = true;
      if (dStop <= WATCH.stopNearR * R0 && ns.armed.stopNear !== false) { ns.armed.stopNear = false; ns.nNear = (ns.nNear || 0) + 1; push('STOP_NEAR', `STOP_NEAR:${pos.sid}:${ns.nNear}`, 'critical', [`손절가까지 ${wFmt(dStop, p)} (${(dStop / R0).toFixed(2)}R) 남았습니다`], '손절 주문이 걸려 있는지 확인하세요. 손절을 넓히지 마세요'); }
      else if (dStop <= WATCH.stopTrendR * R0 && wAgainst(t1, pos.dir) && v1 !== null && v1 >= WATCH.stopTrendVol && (now - (nullishOr(ns.last.STOP_TREND, 0))) >= WATCH.cooldownMs.STOP_TREND) {
        ns.last.STOP_TREND = now; push('STOP_TREND', `STOP_TREND:${pos.sid}:${market.bars1h[market.bars1h.length - 1].t}`, 'warn', [`1시간 추세가 포지션 반대(${t1.state === 'down' ? '하락' : '상승'})`, `거래량 평균 대비 ${v1.toFixed(1)}배`, `손절가까지 ${(dStop / R0).toFixed(2)}R`], '손절 유지 여부를 점검하고, 추가 진입은 하지 마세요');
      }
    }
  }
  // 2) 익절 도달(TP1·TP2)
  if (R0 > 0) {
    const legs = st ? st.legs : [0, 1].map(i => ({ n: i + 1, price: avg + sg * WATCH.tpR[i] * R0, qty: pos.openQty * (i === 0 ? 0.5 : 0.3), done: i === 0 ? pos.fills.some(f => f.kind === 'reduce') : false }));
    for (const leg of legs) {
      if (leg.done || (p - leg.price) * sg < 0) continue;
      push(`TP${leg.n}`, `TP${leg.n}:${pos.sid}`, 'info', [`목표 ${leg.n === 1 ? '+1.5R' : '+2R'} 가격 ${wFmt(leg.price, leg.price)} 도달 (현재 ${wFmt(p, p)})`], `Binance에서 ${leg.n === 1 ? '50%' : '30%'}${leg.qty > 0 ? `(약 ${Number(leg.qty)}개)` : ''} 부분 청산 후 웹앱에 청산을 등록하세요`, { leg: leg.n });
    }
  }
  // 3) 추가 진입 조건 충족 / 취소(분할 계획이 있을 때만)
  if (st && st.entered > 0 && st.openQty > 0) {
    for (const pd of st.pending) {
      if (pd.state === 'working' && wAgainst(t4, pos.dir)) push('ADD_CANCEL', `ADD_CANCEL:${pos.sid}:${pd.n}:trend`, 'warn', ['4시간 추세가 포지션 반대로 전환'], `Binance의 ${pd.n}차 미체결 추가 주문을 취소하세요`, { stage: pd.n });
      else if (pd.state === 'working') {
        const tol = plan.add.tolR * plan.R, reached = (p - (pd.price + sg * tol)) * sg <= 0 && (p - plan.stop) * sg > 0;
        if (!reached) continue;
        const chk = splanCheckAdd(plan, pos.fills, { price: pd.price, qty: pd.remainingQty }, ctx), trendOk = wAligned(t1, pos.dir), volOk = v1 !== null && v1 >= WATCH.addVolMin;
        if (chk.ok && trendOk && volOk && !dayBlocked) push('ADD_READY', `ADD_READY:${pos.sid}:${pd.n}`, 'warn', [`사전 지정 ${pd.n}차 가격 ${wFmt(pd.price, pd.price)} 도달 (물타기 구간)`, `1시간 추세 ${side} 유지`, `거래량 평균 대비 ${v1.toFixed(1)}배`, '추가 후 최악 손실이 계획 한도 이내'], `${pd.n}차 ${Number(pd.remainingQty)}개를 지정가로 직접 주문하세요. 체결되면 웹앱에 등록하세요`, { stage: pd.n });
      } else if (pd.state.startsWith('cancel-') && pd.state !== 'cancel-closed') {
        const why = { 'cancel-after-tp': '익절이 시작됨(익절 뒤 추가 진입 금지)', 'cancel-structure': '구조 유지 조건 이탈(직전 15분봉 종가)', 'cancel-window': '추가 진입 허용 시간 경과' }[pd.state] || pd.state;
        push('ADD_CANCEL', `ADD_CANCEL:${pos.sid}:${pd.n}:${pd.state}`, 'warn', [why], `Binance의 ${pd.n}차 미체결 추가 주문을 취소하세요`, { stage: pd.n });
      }
    }
  }
  // 4) 추적손절 조정(유리한 방향으로만)
  if (st && R0 > 0 && (st.stopKind === 'breakeven' || st.stopKind === 'trailing')) {
    const last = nullishOr(ns.lastStop, plan.stop), step = (st.stopPrice - last) * sg;
    if (step > 0 && (step >= WATCH.trailStepR * R0 || ns.lastStop === undefined || ns.lastStop === plan.stop)) {
      ns.lastStop = st.stopPrice;
      push('TRAIL', `TRAIL:${pos.sid}:${wFmt(st.stopPrice, st.stopPrice)}`, 'info', [st.stopKind === 'breakeven' ? 'TP1 이후 손절을 평균 진입가(본전)로' : `TP2 이후 추적손절 (고점 기준 −${plan.params.trailR}R)`], `Binance 손절 주문을 ${wFmt(st.stopPrice, st.stopPrice)}로 ${pos.dir === 'LONG' ? '올리세요' : '내리세요'}(포지션에 유리한 방향만, 반대로 넓히지 마세요)`, { newStop: st.stopPrice });
    }
  }
  // 5) 스윙 전환·유지·종료 후보(수익 포지션만)
  const tp1Done = st ? st.tp1Done : pos.fills.some(f => f.kind === 'reduce'), locked = stopNow != null && (stopNow - avg) * sg >= 0, ema4 = t4.fast, above4 = ema4 != null && (p - ema4) * sg > 0;
  if (R0 > 0 && rNow !== null) {
    const base = wAligned(t4, pos.dir) && above4 && !wAgainst(t1, pos.dir) && v4 !== null && v4 >= WATCH.swingVol4h && locked;
    if (!ns.swing) {
      if (base && tp1Done && rNow >= WATCH.swingMinR) { ns.swing = 'cand'; ns.lastHoldAt = now; push('SWING_CAND', `SWING_CAND:${pos.sid}`, 'info', [`수익 ${rNow.toFixed(1)}R, TP1 이후 손절이 본전 이상으로 잠김`, `4시간 추세 ${side} 유지`, `4시간 거래량 평균 대비 ${v4.toFixed(1)}배`, '가격이 4시간 20EMA 위(구조 유지)'], '일부 수익을 확보한 상태입니다. 잔량을 며칠 보유(스윙)할지 직접 결정하세요. 보유한다면 추적손절을 지키세요. 손실 포지션은 스윙 대상이 아닙니다'); }
    } else if (ns.swing === 'cand') {
      const broke = !wAligned(t4, pos.dir) || !above4 || rNow < WATCH.swingHoldMinR || (stopNow != null && (p - stopNow) * sg <= 0);
      if (broke) { ns.swing = 'ended'; push('SWING_END', `SWING_END:${pos.sid}`, 'warn', ['스윙 유지 조건 이탈: ' + (!wAligned(t4, pos.dir) ? '4시간 추세 약화' : !above4 ? '가격이 4시간 20EMA 아래' : rNow < WATCH.swingHoldMinR ? `수익 ${rNow.toFixed(1)}R로 감소` : '손절선 도달')], '남은 수량 청산을 검토하세요(스윙 종료 후보)'); }
      else if (now - nullishOr(ns.lastHoldAt, 0) >= WATCH.swingHoldEveryMs) { ns.lastHoldAt = now; push('SWING_HOLD', `SWING_HOLD:${pos.sid}:${kstDayOf(now)}`, 'info', [`4시간 추세 ${side} 유지 · 수익 ${rNow.toFixed(1)}R`, `4시간 거래량 평균 대비 ${v4.toFixed(1)}배`], '스윙 유지 조건을 아직 만족합니다. 추적손절을 지키세요'); }
    }
  }
  return { events, state: ns, snap };
}

function watchMessage(pos, market, ev, snap) {
  const head = { STOP_BREACH: '🛑 손절가 이탈', STOP_NEAR: '⚠️ 손절 임박', STOP_TREND: '⚠️ 손절 위험(추세 반대)', TP1: '🎯 TP1 도달', TP2: '🎯 TP2 도달', ADD_READY: '➕ 추가 진입 조건 충족', ADD_CANCEL: '✖️ 추가 진입 취소', TRAIL: '🔼 추적손절 조정', SWING_CAND: '🔭 스윙 전환 후보', SWING_HOLD: '🔭 스윙 유지', SWING_END: '🔚 스윙 종료 후보' }[ev.type] || ev.type;
  const base = pos.symbolId.replace(/USDT$/, ''), age = Math.max(0, Math.round((market.fetchedAt - market.priceAt) / 60000));
  const pnl = `${snap.pnl >= 0 ? '+' : '−'}${Math.abs(snap.pnl).toFixed(2)} USDT${snap.rNow !== null ? ` (${snap.rNow >= 0 ? '+' : '−'}${Math.abs(snap.rNow).toFixed(2)}R)` : ''}`;
  return [`[RICH300] ${base} ${pos.dir} · ${head}`,
    `내 체결: 평균 ${wFmt(snap.avg, snap.avg)} · 수량 ${snap.openQty}`,
    `시세(${market.source} ${wHhmm(market.priceAt)}${age >= 2 ? `, ${age}분 전` : ''}): ${wFmt(snap.price, snap.price)} · 평가손익 ${pnl} (수수료 제외)`,
    ...(snap.stop != null ? [`현재 손절 기준: ${wFmt(snap.stop, snap.stop)}`] : ['손절가 미입력 — 웹앱에 손절가를 등록하세요']),
    '근거', ...ev.reason.map(r => `• ${r}`), `행동: ${ev.action}`, '※ 기록·공개 시세 기반 안내 · 자동 주문 아님 · Binance 체결가와 다를 수 있음'].join('\n');
}

// ── 저장 상태 ──
const wLoadState = (kv, sid) => { let s = null; try { s = JSON.parse(kv.get(`pos:${sid}`) || 'null'); } catch (e_) { s = null; } return s && s.v === 1 ? s : { v: 1, sent: {}, armed: {}, last: {} }; };
const wSaveState = (kv, sid, s) => {
  const keys = Object.keys(s.sent); if (keys.length > WATCH.keepSent) for (const k of keys.sort((a, b) => s.sent[a].at - s.sent[b].at).slice(0, keys.length - WATCH.keepSent)) delete s.sent[k];
  kv.put(`pos:${sid}`, JSON.stringify(s));
};
function wCapCheck(kv, now) {
  let c = {}; try { c = JSON.parse(kv.get('cap') || '{}'); } catch (e_) { c = {}; }
  const hour = Math.floor(now / 3600000), day = kstDayOf(now); if (c.h !== hour) { c.h = hour; c.nh = 0; } if (c.d !== day) { c.d = day; c.nd = 0; }
  return { c, ok: c.nh < WATCH.capHour && c.nd < WATCH.capDay, commit: () => { c.nh++; c.nd++; kv.put('cap', JSON.stringify(c)); } };
}

// 이벤트 한 건 전송 처리(한 번만 · 실패 재시도 · 상한). 결과: 'sent' | 'failed' | 'skipped' | 'capped'
function wDeliver(env, state, ev, text, now) {
  const kv = env.kv, rec = state.sent[ev.key];
  if (rec && (rec.st === 'sent' || rec.st === 'pending' || rec.st === 'expired')) return 'skipped';            // 이미 보냈거나(또는 전송 직후 중단된 pending) 만료됨 → 다시 보내지 않는다
  if (rec && rec.st === 'failed' && now < rec.next) return 'skipped';
  const cap = wCapCheck(kv, now); if (!cap.ok && ev.level !== 'critical') return 'capped';      // 손절 관련(critical)은 상한과 무관하게 보낸다
  state.sent[ev.key] = { at: nullishOr(rec && rec.at, now), st: 'pending', tries: (rec ? rec.tries : 0) + 1, text: nullishOr(rec && rec.text, text.slice(0, 1200)) };
  wSaveState(kv, ev.sid, state);                                                                                 // 보내기 전에 표시 → 중복 실행·중단에도 한 번만
  let r; try { r = env.send(state.sent[ev.key].text); } catch (e_) { r = { ok: false, code: 'exception' }; }
  if (r && r.ok) { state.sent[ev.key].st = 'sent'; state.sent[ev.key].sentAt = now; cap.commit(); wSaveState(kv, ev.sid, state); return 'sent'; }
  const rec2 = state.sent[ev.key], delay = WATCH.retryDelaysMs[rec2.tries - 1];
  if (delay === undefined || now - rec2.at + delay > WATCH.expireMs) { rec2.st = 'expired'; rec2.code = r && r.code; }
  else { rec2.st = 'failed'; rec2.next = now + delay; rec2.code = r && r.code; }
  wSaveState(kv, ev.sid, state); return 'failed';
}

// 한 번의 감시 실행. 반환: 개수·상태 코드만(금액·ID 없음)
function watchTick(env) {
  const now = env.now(), mode = env.mode();
  if (mode !== 'on' && mode !== 'preview') return { status: 'off' };
  const se = env.storeEnv(), { positions, skipped, realizedTodayMicro, today } = watchOpenPositions(se, { now });
  const live = new Set(positions.map(p => p.sid));
  if (mode === 'on') for (const k of env.kv.keys()) if (k.startsWith('pos:') && !live.has(k.slice(4))) env.kv.del(k);        // 청산된 포지션의 상태 정리(알림 종료)
  if (!positions.length) return { status: 'idle', positions: 0, skipped: skipped.length };
  const out = { status: 'ok', mode, positions: positions.length, skipped: skipped.length, events: 0, sent: 0, failed: 0, capped: 0, stale: 0, marketFail: 0 };
  const markets = new Map(); out.market = []; out.skippedBy = {}; out.byType = {};
  for (const k of skipped) out.skippedBy[k.reason] = (out.skippedBy[k.reason] || 0) + 1;
  for (const sym of new Set(positions.map(p => p.symbolId))) {
    let m; try { m = env.market(sym); } catch (e_) { m = { ok: false, why: 'exception' }; }
    const assess = m && m.ok ? watchAssessMarket(m, now) : { ok: false, why: null }, good = assess.ok;
    out.market.push({ symbol: sym, ok: good, source: (m && m.source) || null, ageSec: m && m.ok ? Math.round((now - m.priceAt) / 1000) : null, n15: m && m.bars15m ? m.bars15m.length : 0, n1h: m && m.bars1h ? m.bars1h.length : 0, n4h: m && m.bars4h ? m.bars4h.length : 0,
      why: good ? null : (!m || !m.ok ? String((m && m.why) || 'fetch-failed').slice(0, 160) : assess.why) });
    if (good) markets.set(sym, { ...m, fetchedAt: now }); else { out.marketFail++; if (m && m.ok) out.stale++; }
  }
  // 시세 장애: 연속 실패 N회 뒤 한 번만 알림, 복구되면 해제
  let mk = {}; try { mk = JSON.parse(env.kv.get('market') || '{}'); } catch (e_) { mk = {}; }
  if (mode === 'on') {
    if (out.marketFail === new Set(positions.map(p => p.symbolId)).size) { mk.fails = (mk.fails || 0) + 1; if (mk.fails >= WATCH.marketDownFails && !mk.alerted) { const r = env.send('[RICH300] ⚠️ 시세 수집 장애\n보유 포지션 감시용 공개 시세를 가져오지 못하고 있습니다. 감시 알림이 지연됩니다.\n행동: 손절·익절 주문이 거래소에 걸려 있는지 직접 확인하세요.\n※ 자동 주문 아님'); if (r && r.ok) mk.alerted = true; } }
    else { mk.fails = 0; mk.alerted = false; }
    env.kv.put('market', JSON.stringify(mk));
  }
  // 일일 손실 제한(-3%): 추가 진입 조건 알림을 막고 한 번 알린다
  let unreal = 0; for (const p of positions) { const m = markets.get(p.symbolId); if (m) unreal += (m.price - p.avgEntry) * splanSign(p.dir) * p.openQty; }
  let equity = null; try { equity = Number(tgEquityNow({ storeEnv: () => se, now: () => now })); } catch (e_) { equity = null; }
  const dayPnl = realizedTodayMicro / 1e6 + unreal, dayBlocked = equity > 0 && dayPnl <= -WATCH.dayLossPct * equity;
  const pending = [];
  for (const pos of positions) {
    const m = markets.get(pos.symbolId); if (!m) continue;
    const state = wLoadState(env.kv, pos.sid);
    const ev = watchEvaluate({ pos, market: m, now, state, dayBlocked });
    out.events += ev.events.length; for (const e of ev.events) out.byType[e.type] = (out.byType[e.type] || 0) + 1;
    if (mode === 'preview') continue;                                                                           // 미리보기: 계산만(상태·전송 없음)
    const sorted = ev.events.sort((a, b) => ({ critical: 0, warn: 1, info: 2 })[a.level] - ({ critical: 0, warn: 1, info: 2 })[b.level]).slice(0, WATCH.maxPerPosTick);
    let st = ev.state; st.sent = { ...state.sent };
    for (const e of sorted) { const r = wDeliver(env, st, e, watchMessage(pos, m, e, ev.snap), now); if (r === 'sent') out.sent++; else if (r === 'failed') out.failed++; else if (r === 'capped') out.capped++; }
    // 실패한 이전 이벤트 재시도(저장된 본문 그대로, 만료 전만)
    for (const [k, rec] of Object.entries(st.sent)) if (rec.st === 'failed' && now >= rec.next && !sorted.some(e => e.key === k)) { const r = wDeliver(env, st, { key: k, sid: pos.sid }, rec.text, now); if (r === 'sent') out.sent++; else if (r === 'failed') out.failed++; }
    wSaveState(env.kv, pos.sid, st);
    pending.push(pos.sid);
  }
  if (mode === 'on' && dayBlocked) {
    const key = `DAY:${today}`; let d = {}; try { d = JSON.parse(env.kv.get('day') || '{}'); } catch (e_) { d = {}; }
    if (d.key !== key) { const r = env.send(`[RICH300] 🚫 일일 손실 한도(−3%) 도달\n오늘 실현+평가 손익 ${dayPnl.toFixed(2)} USDT (오늘 시작 평가액 ${equity.toFixed(2)} 기준)\n행동: 신규 진입과 추가 진입을 중단하세요. 기존 포지션의 위험 축소·청산은 가능합니다.\n※ 자동 주문 아님`); if (r && r.ok) env.kv.put('day', JSON.stringify({ key })); }
  }
  return out;
}

// ── close.mjs ──
// R7 일 마감(KST 00:00 기준). 순수 로직 + env 포트: 같은 코드를 Node 테스트와 Apps Script가 쓴다.
//  env = { now(): ms, storeEnv(): R3 저장소 env, notify?(msg: {text, url?}): {ok, code?}, sendEnabled?(): boolean, uiUrl?: string }
//  원칙
//   · 마감은 날짜당 한 번: `dayclose`(불변, 키=날짜). 같은 날짜를 동시에·반복 마감해도 한 건만 남는다(저장소 유일키 + 락).
//   · 마감은 그날의 *스냅샷*이다. 평가액을 나중에 입력해도 마감 기록은 바뀌지 않고, 입력은 늦은 입력(late)으로 표시된다. 목표·이상선·장부 계산은 R2 결과를 그대로 쓴다(여기서 다시 계산하지 않음).
//   · 평가액 미입력 알림은 날짜당 *최대 1회*(알림 상태 `closenotice`). 알림은 기본 OFF: 설정(closeNotify)이 on이고 sendEnabled()가 true일 때만 보낸다.
//     확실한 실패일 때만 1번 더 시도하고(총 2회), 결과를 알 수 없는 상태(발송 중 중단)는 다시 보내지 않는다(중복 발송보다 누락을 택함).
//   · 알림 문구에 금액은 장부 잔고 하나만 넣는다. 평가액을 *대신 입력하거나 추정해서 저장하지 않는다*(숫자는 사용자가 직접 입력).
//   · 놓친 날(트리거 누락·장기간 미실행)은 다음 실행에서 날짜 순서대로 한 번씩 마감한다(최대 31일).

const CLOSE_MAX_CATCHUP = 31;
const CLOSE_MAX_ATTEMPTS = 2;
const CLOSE_PENDING_STALE_MS = 15 * 60 * 1000;
const CLOSE_WARNING_TEXT = Object.freeze({
  'ledger-mismatch': '장부와 입력 평가액의 차이가 큽니다',
  'close-from-ledger': '평가액 미입력(장부 근사값 사용)',
  'fee-missing': '수수료 미입력 체결이 있습니다',
  'funding-missing': '펀딩 미입력 체결이 있습니다',
  'has-estimates': '추정 수수료·펀딩이 포함되어 있습니다',
  'unrealized-missing': '보유 포지션이 있는데 미실현 손익이 없습니다',
  'opening-basis-unknown': '시작 포지션의 기준 진입가를 모릅니다',
  'late-entry': '마감 후에 입력한 평가액입니다',
  'possible-missing-cashflow': '거래·입출금이 없는 날인데 평가액이 장부와 다릅니다 — 입출금 누락 의심',
  'fees-may-explain': '수수료·펀딩 미입력이 차이의 원인일 수 있습니다',
});
const closeUsd = micro => { const neg = micro < BigInt(0), a = neg ? -micro : micro, s = decFormat(microToDec(a), 2); return `${neg && a >= BigInt(5000) ? '−' : ''}${s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`; };

// 진단(경고 코드): 값은 만들지 않고 *원인 후보*만 알려 준다. 자동 보정 없음.
function closeDiagnose(row, { fillCount = 0, cashCount = 0, adjCount = 0 } = {}) {
  const f = new Set(row.flags);
  const missingFeeFunding = f.has('fee-missing') || f.has('funding-missing');
  if (row.needsReview && fillCount === 0 && cashCount === 0 && adjCount === 0) f.add('possible-missing-cashflow');
  if (row.needsReview && fillCount > 0 && missingFeeFunding) f.add('fees-may-explain');
  return [...f];
}
function closeCounts(inputs, day) {
  const d = at => kstDayOf(at) === day;
  return { fillCount: inputs.fills.filter(x => d(x.at)).length, cashCount: inputs.cashflows.filter(x => d(x.at)).length, adjCount: inputs.adjustments.filter(x => d(x.at)).length };
}
function closeRecord(row, now, flags) {
  return { day: row.day, closedAt: now, source: row.closeSource, startMicro: String(row.startMicro), targetMicro: String(row.targetCloseMicro), closeMicro: String(row.closeMicro), pnlMicro: String(row.pnlMicro), walletMicro: String(row.ledgerWalletMicro),
    ...(row.diffMicro === null ? {} : { diffMicro: String(row.diffMicro) }), needsReview: row.needsReview, flags };
}

// ── 알림 ──
function closeMessage(items, uiUrl) {          // items: [{day, walletMicro}] (오름차순)
  const first = items[0], last = items[items.length - 1];
  const text = items.length === 1 ? `RICH300 · ${first.day} 마감 평가액 미입력\n장부 잔고 ${closeUsd(BigInt(first.walletMicro))} USDT · 입력하면 차이를 확인합니다`
    : `RICH300 · 마감 평가액 미입력 ${items.length}일 (${first.day} ~ ${last.day})\n최근 장부 잔고 ${closeUsd(BigInt(last.walletMicro))} USDT · 입력하면 차이를 확인합니다`;
  const url = typeof uiUrl === 'string' && /^https:\/\/\S+$/.test(uiUrl) ? `${uiUrl}${uiUrl.includes('?') ? '&' : '?'}p=journal&day=${last.day}#close` : null;
  return { text, url };
}
function closeSend(env, se, days, records) {          // days: 이미 claim(pending)한 날짜들. 결과를 notice에 기록한다.
  const items = days.map(d => ({ day: d, walletMicro: records.get(d).walletMicro }));
  let res; try { res = env.notify(closeMessage(items, env.uiUrl)); } catch (e_) { res = { ok: false, code: 'exception' }; }
  const ok = !!(res && res.ok), at = env.now();
  for (const d of days) {
    storeRevise(se, 'closenotice', d, ok ? { status: 'sent', at } : { status: 'failed', at, error: String(((res == null ? undefined : res.code) != null ? (res == null ? undefined : res.code) : 'failed')).slice(0, 40) }, { actor: 'close', reason: ok ? '발송 완료' : '발송 실패' });
  }
  return ok;
}
function closeNotifyDays(env, days, records) {         // 새로 마감된 날짜 중 평가액 미입력인 날
  const se = env.storeEnv(), out = { sent: 0, failed: 0, off: 0, skipped: 0 };
  if (!days.length) return out;
  const on = storeGetSettings(se).closeNotify === 'on', allowed = typeof env.sendEnabled === 'function' && env.sendEnabled() === true && typeof env.notify === 'function';
  if (!on || !allowed) {                               // 꺼져 있으면 보내지 않고, 나중에 켜도 과거 날짜를 소급 발송하지 않도록 기록한다
    for (const d of days) { const r = storeCreate(se, 'closenotice', { day: d, status: 'off', attempts: 0, at: env.now(), error: on ? 'not-approved' : 'setting-off' }, { actor: 'close' }); out[r.status === 'added' ? 'off' : 'skipped']++; }
    return out;
  }
  const claimed = [];
  for (const d of days) { const r = storeCreate(se, 'closenotice', { day: d, status: 'pending', attempts: 1, at: env.now() }, { actor: 'close' }); if (r.status === 'added') claimed.push(d); else out.skipped++; }
  if (claimed.length) { if (closeSend(env, se, claimed, records)) out.sent += claimed.length; else out.failed += claimed.length; }
  return out;
}
// 재시도: 확실히 실패한 알림만(총 2회까지), 발송 중 중단(pending 오래됨)은 unknown으로 두고 재발송하지 않는다.
function closeRetryNotices(env) {
  const se = env.storeEnv(), now = env.now(), out = { retried: 0, sent: 0, failed: 0, unknown: 0, skipped: 0 };
  const on = storeGetSettings(se).closeNotify === 'on', allowed = typeof env.sendEnabled === 'function' && env.sendEnabled() === true && typeof env.notify === 'function';
  const eq = new Set(storeList(se, 'equity').map(r => r.data.day));
  for (const n of storeList(se, 'closenotice')) {
    const d = n.data;
    if (d.status === 'pending' && now - d.at > CLOSE_PENDING_STALE_MS) { storeRevise(se, 'closenotice', d.day, { status: 'unknown', at: now }, { actor: 'close', reason: '발송 결과 불명(재발송하지 않음)' }); out.unknown++; continue; }
    if (d.status !== 'failed') continue;
    if (!on || !allowed || d.attempts >= CLOSE_MAX_ATTEMPTS || eq.has(d.day)) { out.skipped++; continue; }
    const rec = storeGet(se, 'dayclose', d.day); if (!rec || rec.void) { out.skipped++; continue; }
    storeRevise(se, 'closenotice', d.day, { status: 'pending', attempts: d.attempts + 1, at: now, error: null }, { actor: 'close', reason: '재시도' }); out.retried++;
    if (closeSend(env, se, [d.day], new Map([[d.day, rec.data]]))) out.sent++; else out.failed++;
  }
  return out;
}

// ── 마감 ──
// 계획(읽기만)과 확정(쓰기)을 나눠 둔다: 계획 후 다른 실행이 먼저 확정해도 확정 단계의 유일키가 한 건만 남긴다.
function closePlan(env, { now = env.now() } = {}) {
  const se = env.storeEnv(); let inputs;
  try { inputs = storeLoadLedgerInputs(se); } catch (e) { if (e instanceof StoreError && e.code === 'NOT_FOUND') return { status: 'no-challenge', todo: [] }; throw e; }
  const startDay = inputs.challenge.startDay, last = addDays(kstDayOf(now), -1);
  if (dayToIndex(last) < dayToIndex(startDay)) return { status: 'not-started', todo: [] };
  const done = new Set(storeList(se, 'dayclose').map(r => r.data.day)), todo = [];
  for (let d = startDay; dayToIndex(d) <= dayToIndex(last) && todo.length < CLOSE_MAX_CATCHUP; d = addDays(d, 1)) if (!done.has(d)) todo.push(d);
  return { status: 'ok', todo, inputs };
}
function closeCommit(env, plan, { now = env.now() } = {}) {
  if (plan.status !== 'ok') return { status: plan.status, closed: [], skipped: [] };
  if (!plan.todo.length) return { status: 'ok', closed: [], skipped: [], notices: { sent: 0, failed: 0, off: 0, skipped: 0 } };
  const se = env.storeEnv(), inputs = plan.inputs, led = ledgerBuildDaily({ ...inputs, throughDay: plan.todo[plan.todo.length - 1] }), byDay = new Map(led.rows.map(r => [r.day, r]));
  const closed = [], skipped = [], records = new Map(), missing = [];
  for (const day of plan.todo) {
    const row = byDay.get(day), rec = closeRecord(row, now, closeDiagnose(row, closeCounts(inputs, day)));
    const r = storeCreate(se, 'dayclose', rec, { actor: 'close' });
    if (r.status === 'added') { closed.push(day); records.set(day, rec); if (rec.source === 'ledger') missing.push(day); } else skipped.push(day);   // duplicate/conflict: 다른 실행이 이미 마감함
  }
  return { status: 'ok', closed, skipped, notices: closeNotifyDays(env, missing, records) };
}
const closeRun = (env, { now = env.now() } = {}) => closeCommit(env, closePlan(env, { now }), { now });
// 트리거 한 번(00:00 및 이후 매시간 재확인): 놓친 날 마감 + 확실히 실패한 알림 재시도
function closeTick(env, { now = env.now() } = {}) {
  const run = closeRun(env, { now }), retry = closeRetryNotices({ ...env, now: () => now });
  return { ...run, retry };
}

// ── 평가액 입력 ──
function closeCheckEquityDay(env, day, now = env.now()) {       // 입력 가능한 날짜인지(저장 없이) 확인. 오류는 VALIDATION(사용자에게 그대로 안내 가능한 문구)
  const inputs = storeLoadLedgerInputs(env.storeEnv());
  if (!isDayString(day)) throw new StoreError('VALIDATION', '날짜 형식 오류(YYYY-MM-DD)');
  if (dayToIndex(day) < dayToIndex(inputs.challenge.startDay)) throw new StoreError('VALIDATION', '챌린지 시작일 이전입니다');
  if (dayToIndex(day) > dayToIndex(kstDayOf(now))) throw new StoreError('VALIDATION', '미래 날짜에는 입력할 수 없습니다');
  return inputs;
}
function closeSubmitEquity(env, { day, equity, unrealized, reason } = {}, { actor = 'ui', now = env.now() } = {}) {
  const se = env.storeEnv(); closeCheckEquityDay(env, day, now);
  const eq = schemaDecString(equity, '평가액', { nonNegative: true }), un = unrealized === undefined || unrealized === null || unrealized === '' ? undefined : schemaDecString(unrealized, '미실현 손익');
  const late = now >= dayEndMs(day), data = { day, equity: eq, ...(un === undefined ? {} : { unrealized: un }), ...(late ? { late: true } : {}), enteredAt: now };
  const cur = storeGet(se, 'equity', day); let r;
  if (!cur || cur.void) r = storeCreate(se, 'equity', data, { actor });
  else if (cur.data.equity === eq && ((cur.data.unrealized != null ? cur.data.unrealized : undefined)) === un) r = { status: 'unchanged', key: day, rev: cur.rev };
  else r = storeRevise(se, 'equity', day, { equity: eq, unrealized: un === undefined ? null : un, late: late ? true : null, enteredAt: now }, { actor, reason: typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 200) : '평가액 수정' });
  const after = storeLoadLedgerInputs(se), led = ledgerBuildDaily({ ...after, throughDay: day }), row = led.rows[led.rows.length - 1];
  return { status: r.status, day, late, diffMicro: row.diffMicro === null ? null : String(row.diffMicro), expectedMicro: row.expectedEquityMicro === null ? null : String(row.expectedEquityMicro), needsReview: row.needsReview, flags: closeDiagnose(row, closeCounts(after, day)), diffLabel: row.diffMicro === null ? null : closeUsd(row.diffMicro), expectedLabel: row.expectedEquityMicro === null ? null : closeUsd(row.expectedEquityMicro) };
}
// 최근 N일의 마감·입력·알림 상태(일지 화면용)
function closeStatus(env, { now = env.now(), days = 14 } = {}) {
  const se = env.storeEnv(), today = kstDayOf(now), out = [];
  let inputs; try { inputs = storeLoadLedgerInputs(se); } catch (e) { if (e instanceof StoreError && e.code === 'NOT_FOUND') return []; throw e; }
  const closes = new Map(storeList(se, 'dayclose').map(r => [r.data.day, r])), eqs = new Map(storeList(se, 'equity').map(r => [r.data.day, r])), notices = new Map(storeList(se, 'closenotice').map(r => [r.data.day, r.data]));
  for (let i = 0; i < days; i++) {
    const day = addDays(today, -i); if (dayToIndex(day) < dayToIndex(inputs.challenge.startDay)) break;
    const c = closes.get(day), e = eqs.get(day), n = notices.get(day);
    out.push({ day, today: i === 0, closed: !!c, source: c ? c.data.source : null, equity: e ? e.data.equity : null, late: e ? !!e.data.late : false, equityRev: e ? e.rev : 0, notice: n ? n.status : null, flags: c ? (c.data.flags != null ? c.data.flags : []) : [], needsReview: c ? c.data.needsReview : false, diffMicro: c ? (c.data.diffMicro != null ? c.data.diffMicro : null) : null, diffLabel: c && c.data.diffMicro !== undefined ? `${BigInt(c.data.diffMicro) > BigInt(0) ? '+' : ''}${closeUsd(BigInt(c.data.diffMicro))}` : null, walletMicro: c ? c.data.walletMicro : null });
  }
  return out;
}

// ── analytics.mjs ──
// R7 거래 통계(순수 함수): 승률·손익비·기대값·최대 낙폭을 전략(A/B)·방향(LONG/SHORT)·복기 항목별로 계산한다.
//  · 입력은 R2가 계산한 *청산된 실제 거래*의 순손익(마이크로 USDT, BigInt)뿐이다. 새 손익식을 만들지 않는다. 모의 거래는 들어오지 않는다.
//  · 표본이 작으면 숨기지 않고 표시한다: n < 30 은 lowSample, 승률에는 95% Wilson 구간을 함께 낸다(작은 표본의 우연을 구분하기 위함).
//  · 최대 낙폭(거래 기준): 청산 시각 순 누적 순손익 곡선에서 고점 대비 최대 하락(USDT, 시작 자금 대비 %). 계좌 평가액 기준 낙폭은 대시보드(R6/R2 요약)가 따로 보여 준다.
//  · 기대값 = 건당 평균 순손익(= 승률×평균이익 − 패율×평균손실). 가능하면 R-배수(순손익 ÷ 계획 손절 위험)도 낸다(계획 손절가가 있는 거래만, 커버리지 표시).
//  · 인사이트는 규칙 기반 문장이며 인과를 주장하지 않는다("참고용"). 표본이 부족하면 문장을 만들지 않는다.

const AN_MIN_SAMPLE = 30;
const AN_INSIGHT_MIN = 5;

function anUsd(micro, { sign = false } = {}) {
  const neg = micro < BigInt(0), a = neg ? -micro : micro, s = decFormat(microToDec(a), 2).replace(/\B(?=(\d{3})+(?!\d))/g, ','), zero = a < BigInt(5000);
  return `${neg && !zero ? '−' : sign && !zero ? '+' : ''}${s}`;
}
const anRatio = ppm => (ppm === null ? '—' : decFormat(ppm * BigInt(1000000), 2));          // 1e6 = 1.00
function anPct(ppm, dp = 0) { if (ppm === null) return '—'; const neg = ppm < BigInt(0), a = neg ? -ppm : ppm, s = decFormat(a * BigInt(100000000), dp); return `${neg && !/^[0.]*$/.test(s) ? '−' : ''}${s}%`; }

function anWilson(w, n) {                                    // 표시용 부동소수(결정 로직에 쓰지 않음)
  if (n === 0) return null; const z = 1.96, p = w / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
// trades: [{ sid, netMicro: bigint, closedAt: ms, riskMicro?: bigint|null }]
function anStats(trades, { startMicro = null } = {}) {
  const t = [...trades].sort((a, b) => a.closedAt - b.closedAt || (a.sid < b.sid ? -1 : 1)), n = t.length;
  let winN = 0, lossN = 0, flatN = 0, sumW = BigInt(0), sumL = BigInt(0), net = BigInt(0), cum = BigInt(0), peak = BigInt(0), maxDd = BigInt(0), rSum = BigInt(0), rN = 0, best = null, worst = null;
  for (const x of t) {
    const v = x.netMicro; net += v; cum += v; if (cum > peak) peak = cum; if (peak - cum > maxDd) maxDd = peak - cum;
    if (v > BigInt(0)) { winN++; sumW += v; } else if (v < BigInt(0)) { lossN++; sumL += v; } else flatN++;
    if (x.riskMicro && x.riskMicro > BigInt(0)) { rSum += decRoundDiv(v * BigInt(1000000), x.riskMicro); rN++; }
    if (best === null || v > best) best = v; if (worst === null || v < worst) worst = v;
  }
  const ci = anWilson(winN, n), avgWin = winN ? decRoundDiv(sumW, BigInt(winN)) : null, avgLoss = lossN ? decRoundDiv(sumL, BigInt(lossN)) : null;
  const payoffPpm = avgWin !== null && avgLoss !== null ? decRoundDiv(avgWin * BigInt(1000000), -avgLoss) : null, pfPpm = sumL < BigInt(0) && sumW > BigInt(0) ? decRoundDiv(sumW * BigInt(1000000), -sumL) : null;
  return { n, wins: winN, losses: lossN, flat: flatN, winRatePpm: n ? decRoundDiv(BigInt(winN) * BigInt(1000000), BigInt(n)) : null, winRate: n ? anPct(decRoundDiv(BigInt(winN) * BigInt(1000000), BigInt(n))) : '—',
    winRateRange: ci ? `${Math.round(ci[0] * 100)}–${Math.round(ci[1] * 100)}%` : '—', avgWinMicro: avgWin === null ? null : String(avgWin), avgLossMicro: avgLoss === null ? null : String(avgLoss), avgWin: avgWin === null ? '—' : anUsd(avgWin, { sign: true }), avgLoss: avgLoss === null ? '—' : anUsd(avgLoss, { sign: true }),
    payoff: anRatio(payoffPpm), profitFactor: anRatio(pfPpm), netMicro: String(net), net: anUsd(net, { sign: true }), netPositive: net > BigInt(0), netNegative: net < BigInt(0),
    expectancyMicro: n ? String(decRoundDiv(net, BigInt(n))) : null, expectancy: n ? anUsd(decRoundDiv(net, BigInt(n)), { sign: true }) : '—', expectancyPositive: n > 0 && net > BigInt(0), expectancyNegative: n > 0 && net < BigInt(0),
    expectancyR: rN ? `${decFormat(decRoundDiv(rSum, BigInt(rN)) * BigInt(1000000), 2).replace('-', '−')}R` : '—', rCoverage: rN, maxDdMicro: String(maxDd), maxDd: anUsd(maxDd), maxDdOfStart: startMicro && startMicro > BigInt(0) ? anPct(decRoundDiv(maxDd * BigInt(1000000), startMicro), 1) : '—',
    best: best === null ? '—' : anUsd(best, { sign: true }), worst: worst === null ? '—' : anUsd(worst, { sign: true }), lowSample: n < AN_MIN_SAMPLE };
}
const AN_STRATEGY_NAME = Object.freeze({ A: 'A전략 · 추세돌파형', B: 'B전략 · 눌림목 재진입형', S: 'COIN RADAR 신호 · 눌림 진입 후보' });
// 신호가 있는 전략만 보여 준다. 이중 전략(A/B)이 없고 신호 레이더(S)만 있으면 A/B 빈 칸을 만들지 않는다.
const anStrategyKeys = signals => { const have = new Set(signals.map(s => s.strategy)); return ['A', 'B', 'S'].filter(k => (k === 'S' ? have.has('S') : have.has('A') || have.has('B') || !have.has('S'))); };
const anGroup = (trades, keyFn, keys, opts) => keys.map(k => ({ key: k, ...anStats(trades.filter(t => keyFn(t) === k), opts) }));

// ledgerTrades: R2 ledger.trades(Map sid→trade), fills: 저장소 체결 data, signals/reviews: data 배열
function anTradesFrom({ ledgerTrades, fills = [], signals = [], reviews = [] }) {
  const sig = new Map(signals.map(s => [s.sid, s])), rev = new Map(reviews.map(r => [r.sid, r])), firstEntry = new Map();
  for (const f of [...fills].sort((a, b) => a.at - b.at)) if ((f.kind === 'entry') && !firstEntry.has(f.sid)) firstEntry.set(f.sid, f);
  const out = [];
  for (const t of ledgerTrades.values()) {
    if (t.status !== 'closed') continue;
    const fe = firstEntry.get(t.sid); let risk = null;
    if (fe && fe.plannedStop) { const d = decAbs(decSub(dec(fe.price), dec(fe.plannedStop))); risk = decToMicro(decMul(d, dec(fe.qty))); if (risk <= BigInt(0)) risk = null; }
    const s = sig.get(t.sid), r = rev.get(t.sid), last = t.events[t.events.length - 1];
    out.push({ sid: t.sid, dir: t.dir, strategy: s ? s.strategy : null, netMicro: t.totals.netEnteredMicro, closedAt: last.at, riskMicro: risk, review: r ? { plan: r.plan, mind: r.mind } : null });
  }
  return out;
}

// 복기 분석: 계획 준수·심리별 성과와 규칙 기반 인사이트
function anReviews(trades, opts) {
  const reviewed = trades.filter(t => t.review), plan = Object.keys(PLAN_CHOICES), mind = Object.keys(MIND_CHOICES);
  const byPlan = plan.map(k => ({ key: k, label: PLAN_CHOICES[k], ...anStats(reviewed.filter(t => t.review.plan === k), opts) })).filter(g => g.n > 0);
  const byMind = mind.map(k => ({ key: k, label: MIND_CHOICES[k], ...anStats(reviewed.filter(t => t.review.mind === k), opts) })).filter(g => g.n > 0);
  const total = trades.length, rate = total ? decRoundDiv(BigInt(reviewed.length) * BigInt(1000000), BigInt(total)) : null, insights = [];
  const cmp = (label, a, b, nameA, nameB) => {
    if (a.n < AN_INSIGHT_MIN || b.n < AN_INSIGHT_MIN) return;
    const ea = BigInt(a.expectancyMicro), eb = BigInt(b.expectancyMicro); if (ea >= eb) return;
    insights.push({ type: label, n: a.n + b.n, text: `${nameA}(${a.n}건)의 건당 기대값 ${anUsd(ea, { sign: true })} USDT는 ${nameB}(${b.n}건)의 ${anUsd(eb, { sign: true })} USDT보다 ${anUsd(eb - ea)} USDT 낮습니다${a.n + b.n < AN_MIN_SAMPLE ? ' — 표본이 적어 참고용입니다' : ''}` });
  };
  const ok = reviewed.filter(t => t.review.plan === 'plan_ok'), bad = reviewed.filter(t => t.review.plan !== 'plan_ok'), calm = reviewed.filter(t => t.review.mind === 'calm'), tense = reviewed.filter(t => t.review.mind !== 'calm');
  cmp('plan-violation', anStats(bad, opts), anStats(ok, opts), '계획과 다르게 한 거래', '계획대로 한 거래');
  cmp('mind-unsettled', anStats(tense, opts), anStats(calm, opts), '침착하지 않았던 거래', '침착했던 거래');
  if (total >= AN_INSIGHT_MIN && rate !== null && rate < BigInt(700000)) insights.push({ type: 'review-rate', n: total, text: `청산 ${total}건 중 복기한 거래는 ${reviewed.length}건(${anPct(rate)})입니다 — 복기가 적으면 위 분석이 한쪽으로 치우칠 수 있습니다` });
  return { total, reviewed: reviewed.length, reviewRate: anPct(rate), byPlan, byMind, insights };
}
function anBuild({ ledgerTrades, fills, signals, reviews, startMicro }) {
  const trades = anTradesFrom({ ledgerTrades, fills, signals, reviews }), opts = { startMicro };
  return { overall: anStats(trades, opts), strategies: anGroup(trades, t => t.strategy, anStrategyKeys(signals), opts).map(g => ({ ...g, name: AN_STRATEGY_NAME[g.key] })), dirs: anGroup(trades, t => t.dir, ['LONG', 'SHORT'], opts),
    matrix: ['A', 'B'].flatMap(s => ['LONG', 'SHORT'].map(d => ({ strategy: s, dir: d, ...anStats(trades.filter(t => t.strategy === s && t.dir === d), opts) }))), unlinked: trades.filter(t => !t.strategy).length, reviews: anReviews(trades, opts), minSample: AN_MIN_SAMPLE };
}

// ── journal.mjs ──
// R7 매매일지: 조회(거래·체결 타임라인·수정 이력·마감 상태·통계) + 안전한 수정(체결 수정/취소, 입출금 기록).
//  · 모든 수정은 *추가 전용 이력*으로 남는다(R3 리비전·취소). 이전 값은 사라지지 않고 이력에 diff로 표시된다. 수정에는 사유가 필요하다.
//  · 수정 전에 *계산 가능 여부를 미리 검증*한다(예: 진입 체결을 취소해 청산만 남기거나 잔량보다 많이 청산하게 만들면 저장하지 않음).
//  · 손익·잔고는 R2 결과를 그대로 사용한다. 이 모듈은 표시용 변환과 입력 검증만 한다.
//  · 실제 기록만 다룬다(모의 체결은 저장소가 거부).

const JOURNAL_FILL_EDITABLE = Object.freeze(['price', 'qty', 'at', 'margin', 'leverage', 'plannedStop', 'fee', 'funding', 'note']);
const JOURNAL_LIMIT = 40;
const JV_KIND = { opening: '시작 포지션', entry: '진입', add: '추가진입', reduce: '부분청산', close: '전량청산' };
const jvKst = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
const jvText = v => {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'object' && v && 'state' in v) return v.state === 'missing' ? '미입력' : `${v.state === 'estimated' ? '추정 ' : ''}${v.amount}`;
  if (typeof v === 'number' && Number.isInteger(v) && v > 1e11) return jvKst(v);
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
};
const jvEditAmt = v => (!v || v.state === 'missing' ? '' : `${v.state === 'estimated' ? '~' : ''}${v.amount}`);   // 입력 칸 표기(R4와 동일: 추정은 ~)
const jvParse = s => { try { return s ? JSON.parse(s) : null; } catch (e_) { return null; } };
const jvFail = m => { throw new StoreError('VALIDATION', m); };

function journalDiff(before, after) {          // 최상위 필드 단위 변경 목록(표시용)
  const b = (before != null ? before : {}), a = (after != null ? after : {}), keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort(), out = [];
  for (const k of keys) if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) out.push({ field: k, from: jvText(b[k]), to: jvText(a[k]) });
  return out;
}
function journalHistories(se) {                         // Audit 한 번 읽어 (엔티티|키)별 이력 구성
  const m = new Map();
  for (const e of storeReadAudit(se)) {
    const k = `${e.entity}|${e.key}`; if (!m.has(k)) m.set(k, []);
    m.get(k).push({ rev: e.rev, op: e.op, at: e.recordedAt, atLabel: jvKst(e.recordedAt), actor: e.actor, reason: e.reason, changes: e.op === 'create' ? [] : e.op === 'void' ? [] : journalDiff(jvParse(e.before), jvParse(e.after)) });
  }
  return m;
}
function journalHistory(env, entity, key) { return nullishOr(journalHistories(env.storeEnv()).get(`${entity}|${key}`), []); }

const JOURNAL_SEARCH_LIMIT = 200;
function journalBuild(env, { now = env.now(), limit = JOURNAL_LIMIT, day = null, q = null } = {}) {
  const se = env.storeEnv(); let inputs;
  try { inputs = storeLoadLedgerInputs(se); } catch (e) { if (e instanceof StoreError && e.code === 'NOT_FOUND') return { empty: true, reason: 'no-challenge', generatedAt: now }; throw e; }
  const throughDay = kstDayOf(now), led = ledgerBuildDaily({ ...inputs, throughDay });
  let histMemo = null; const hist = { get: k => { if (!histMemo) histMemo = journalHistories(se); return histMemo.get(k); } };      // 수정 이력은 수정된 항목(rev>1)이 화면에 있을 때만 Audit 를 읽는다(보통은 읽지 않음)
  const data = n => storeList(se, n).map(r => r.data), signals = data('signal'), responses = data('response'), reviews = data('review');
  const revRev = new Map(storeList(se, 'review').map(r => [r.key, r.rev])), sig = new Map(signals.map(s => [s.sid, s])), rsp = new Map(responses.map(r => [r.sid, r])), rev = new Map(reviews.map(r => [r.sid, r]));
  const allFills = storeList(se, 'fill', { includeVoid: true }), voided = allFills.filter(r => r.void).map(r => r.key);
  const bySid = new Map();
  for (const r of allFills) { const sid = r.data.sid; if (!bySid.has(sid)) bySid.set(sid, []); bySid.get(sid).push(r); }
  const edits = (entity, key, rev) => (rev > 1 ? (nullishOr(hist.get(`${entity}|${key}`), [])).filter(h => h.rev > 1 || h.op !== 'create') : []);      // rev 1(수정 없음)이면 이력을 찾지 않는다
  const trades = [...led.trades.values()].map(t => {
    const s = sig.get(t.sid), ev = t.events, last = ev[ev.length - 1], net = t.totals.netEnteredMicro, rows = (nullishOr(bySid.get(t.sid), [])).sort((a, b) => a.data.at - b.data.at);
    const rv = rev.get(t.sid), rs = rsp.get(t.sid);
    return { sid: t.sid, dir: t.dir, status: t.status, strategy: s ? s.strategy : null, symbol: s ? s.symbolId.replace(/USDT$/, '') : null, lastAt: last.at, openedAt: ev[0].at, closedAt: t.status === 'closed' ? last.at : null, fillDays: [...new Set(rows.filter(r => !r.void).map(r => kstDayOf(r.data.at)))], openedLabel: jvKst(ev[0].at), closedLabel: t.status === 'closed' ? jvKst(last.at) : null,
      netLabel: anUsd(net, { sign: true }), netMicro: String(net), win: t.status === 'closed' && net > BigInt(0), loss: t.status === 'closed' && net < BigInt(0), flags: t.flags, openQty: t.status === 'open' ? t.openQty : null,
      response: rs ? { choice: rs.choice, label: RESPONSE_CHOICES[rs.choice] } : null,
      fills: rows.filter(r => !r.void).map(r => ({ fillId: r.key, kind: r.data.kind, kindLabel: (JV_KIND[r.data.kind] != null ? JV_KIND[r.data.kind] : r.data.kind), atLabel: jvKst(r.data.at), price: r.data.price, qty: r.data.qty, fee: jvText(r.data.fee), funding: jvText(r.data.funding), feeEdit: jvEditAmt(r.data.fee), fundingEdit: jvEditAmt(r.data.funding), note: (r.data.note != null ? r.data.note : ''), rev: r.rev, margin: (r.data.margin != null ? r.data.margin : null), leverage: (r.data.leverage != null ? r.data.leverage : null), plannedStop: (r.data.plannedStop != null ? r.data.plannedStop : null), edits: edits('fill', r.key, r.rev) })),
      voidedFills: rows.filter(r => r.void).map(r => ({ fillId: r.key, kindLabel: (JV_KIND[r.data.kind] != null ? JV_KIND[r.data.kind] : r.data.kind), atLabel: jvKst(r.data.at), price: r.data.price, qty: r.data.qty, edits: edits('fill', r.key, r.rev) })),
      review: rv ? { plan: PLAN_CHOICES[rv.plan], mind: MIND_CHOICES[rv.mind], memo: (rv.memo != null ? rv.memo : null), savedLabel: jvKst(rv.savedAt), edits: edits('review', t.sid, revRev.get(t.sid)) } : null };
  }).sort((a, b) => b.lastAt - a.lastAt);
  const qDay = typeof day === 'string' && isDayString(day) ? day : null, qSym = typeof q === 'string' ? q.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) : '';      // 검색: 해당 날짜에 체결이 있거나 진입·청산한 거래, 코인 이름 일부
  const found = qDay || qSym ? trades.filter(t => (!qDay || t.fillDays.includes(qDay)) && (!qSym || String((t.symbol != null ? t.symbol : t.sid)).toUpperCase().includes(qSym))) : trades;
  const warnings = [], rows = led.rows, cnt = f => rows.filter(r => r.flags.includes(f)).length;
  const mism = rows.filter(r => r.needsReview);
  if (mism.length) warnings.push({ type: 'ledger-mismatch', text: `장부와 입력 평가액의 차이가 큰 날 ${mism.length}일: ${mism.slice(-5).map(r => `${r.day}(${anUsd(r.diffMicro, { sign: true })})`).join(', ')}` });
  const missCash = rows.filter(r => r.needsReview && closeDiagnose(r, { fillCount: inputs.fills.filter(f => kstDayOf(f.at) === r.day).length, cashCount: inputs.cashflows.filter(c => kstDayOf(c.at) === r.day).length, adjCount: inputs.adjustments.filter(a => kstDayOf(a.at) === r.day).length }).includes('possible-missing-cashflow'));
  if (missCash.length) warnings.push({ type: 'possible-missing-cashflow', text: `입출금 누락 의심 ${missCash.length}일: ${missCash.slice(-5).map(r => r.day).join(', ')} — 거래·입출금이 없는 날인데 평가액이 장부와 다릅니다. 입출금을 기록하세요(자동 보정하지 않음)` });
  if (cnt('close-from-ledger')) warnings.push({ type: 'close-from-ledger', text: `평가액 미입력으로 장부 근사값을 쓴 날 ${cnt('close-from-ledger')}일` });
  const feeM = trades.filter(t => t.flags.includes('fee-missing')).length, fundM = trades.filter(t => t.flags.includes('funding-missing')).length;
  if (feeM) warnings.push({ type: 'fee-missing', text: `수수료 미입력 거래 ${feeM}건(손익에서 제외됨)` }); if (fundM) warnings.push({ type: 'funding-missing', text: `펀딩 미입력 거래 ${fundM}건(손익에서 제외됨)` });
  if (cnt('has-estimates')) warnings.push({ type: 'has-estimates', text: `추정 수수료·펀딩이 있는 날 ${cnt('has-estimates')}일(기본 손익 미포함)` });
  for (const f of led.flags) warnings.push({ type: f.type, text: `범위 밖 입력 ${f.count}건(${f.type})` });
  const closes = closeStatus(env, { now, days: 14 }), cash = storeList(se, 'cashflow').sort((a, b) => b.data.at - a.data.at).slice(0, 10).map(cr => { const c = cr.data; return { cfId: c.cfId, atLabel: jvKst(c.at), amount: c.amount, note: (c.note != null ? c.note : ''), edits: edits('cashflow', c.cfId, cr.rev) }; });
  return { empty: false, generatedAt: now, today: throughDay, startDay: inputs.challenge.startDay, startEquity: inputs.challenge.startEquity, trades: found.slice(0, qDay || qSym ? JOURNAL_SEARCH_LIMIT : limit), tradesTotal: found.length, tradesOpen: found.filter(t => t.status === 'open').length, searched: !!(qDay || qSym), voidedCount: voided.length,
    closes, presetDay: (nullishOr(nullishOr(closes.find(c => c.closed && c.equity === null), closes[0]), { day: throughDay })).day, cashflows: cash, analytics: anBuild({ ledgerTrades: led.trades, fills: inputs.fills, signals, reviews, startMicro: decToMicro(dec(inputs.challenge.startEquity)) }), warnings, warningText: CLOSE_WARNING_TEXT };
}

// ── 수정 ──
function journalGuardReason(reason) { if (typeof reason !== 'string' || !reason.trim()) jvFail('수정 사유를 입력해 주세요'); return reason.trim().slice(0, 200); }
function journalTradeCheck(fills, sid) { try { return pnlComputeTrade(fills.filter(f => f.sid === sid)); } catch (e) { jvFail(`이 수정은 계산이 맞지 않아 저장하지 않습니다: ${String(e.message).slice(0, 80)}`); } }
function journalReviseFill(env, fillId, patch, { actor = 'ui', reason, now = env.now() } = {}) {
  const why = journalGuardReason(reason), se = env.storeEnv(), cur = storeGet(se, 'fill', fillId);
  if (!cur || cur.void) throw new StoreError('NOT_FOUND', '수정할 체결이 없습니다');
  if (!patch || typeof patch !== 'object' || !Object.keys(patch).length) jvFail('수정할 값이 없습니다');
  for (const k of Object.keys(patch)) if (!JOURNAL_FILL_EDITABLE.includes(k)) jvFail(`수정할 수 없는 항목: ${k}`);
  if (patch.at !== undefined && (!Number.isInteger(patch.at) || patch.at > now + 5 * 60000)) jvFail('체결 시각이 올바르지 않습니다');
  const merged = { ...cur.data }; for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') delete merged[k]; else merged[k] = v; }
  const next = ENTITIES.fill.normalize(merged), all = storeList(se, 'fill').map(r => r.data).map(f => (f.fillId === fillId ? next : f));
  journalTradeCheck(all, next.sid);                                                         // 수정 후에도 계산 가능해야 저장
  const clean = {}; for (const k of Object.keys(patch)) clean[k] = patch[k] === '' ? null : patch[k];
  return storeRevise(se, 'fill', fillId, clean, { actor, reason: why });
}
function journalVoidFill(env, fillId, { actor = 'ui', reason } = {}) {
  const why = journalGuardReason(reason), se = env.storeEnv(), cur = storeGet(se, 'fill', fillId);
  if (!cur) throw new StoreError('NOT_FOUND', '취소할 체결이 없습니다');
  if (cur.void) return { status: 'unchanged', key: fillId, rev: cur.rev };
  const rest = storeList(se, 'fill').map(r => r.data).filter(f => f.fillId !== fillId); journalTradeCheck(rest, cur.data.sid);
  return storeVoid(se, 'fill', fillId, { actor, reason: why });
}
function journalAddCashflow(env, { cfId, amount, note, at } = {}, { actor = 'ui', now = env.now() } = {}) {
  const amt = schemaDecString(amount, '입출금 금액', { nonZero: true }), id = typeof cfId === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(cfId) ? `cf-${cfId}` : jvFail('입력 식별자(cfId)가 필요합니다');
  const when = at === undefined ? now : at; if (!Number.isInteger(when) || when > now + 5 * 60000) jvFail('시각이 올바르지 않습니다');
  return storeCreate(jvStore(env), 'cashflow', { cfId: id, at: when, amount: amt, ...(typeof note === 'string' && note.trim() ? { note: note.trim().slice(0, 200) } : {}) }, { actor });
}
function journalVoidCashflow(env, cfId, { actor = 'ui', reason } = {}) { return storeVoid(env.storeEnv(), 'cashflow', cfId, { actor, reason: journalGuardReason(reason) }); }
const jvStore = env => env.storeEnv();

// ── journalview.mjs ──
// R7 일지 화면 HTML 렌더러(서버 측, 순수 함수). 모바일 우선 · 외부 자원 없음 · 모든 동적 값 이스케이프 · 읽기/수정은 google.script.run 서버 함수로만(소유자 확인은 서버 측).
//  수정 UI에는 사유 입력이 필수이고, 저장 결과(변경 이력)는 일지에서 diff로 확인한다. 어떤 입력도 기본값으로 자동 저장하지 않는다.
const jvEsc = v => String((v != null ? v : '')).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jvE = jvEsc, JV_ARROW = (p, n) => (p ? '▲' : n ? '▼' : '■'), JV_TONE = (p, n) => (p ? 'pos' : n ? 'neg' : 'zero');
const JV_NOTICE = { off: '알림 꺼짐', sent: '알림 발송됨', failed: '알림 실패', pending: '알림 발송 중', unknown: '알림 결과 불명' };

const JV_CSS = `
:root{color-scheme:light;--bg:#f6f7f9;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--mute:#6b6a66;--line:#dcdbd6;--s1:#2a78d6;--s2:#eb6834;--good:#17794f;--bad:#c62828;--warnbg:#fff4d6;--warnink:#6b4a00;--track:#e8e7e2}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){color-scheme:dark;--bg:#111110;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--mute:#a09f96;--line:#33332f;--s1:#3987e5;--s2:#d95926;--good:#3ddc97;--bad:#ff7b7b;--warnbg:#3a3000;--warnink:#ffd866;--track:#2a2a27}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#111110;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--mute:#a09f96;--line:#33332f;--s1:#3987e5;--s2:#d95926;--good:#3ddc97;--bad:#ff7b7b;--warnbg:#3a3000;--warnink:#ffd866;--track:#2a2a27}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Noto Sans KR","Apple SD Gothic Neo",sans-serif;font-variant-numeric:tabular-nums;padding:0 max(16px,env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
main{max-width:560px;margin:0 auto}header{padding:16px 0 4px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px 8px}
h1{font-size:18px;margin:0}h2{font-size:15px;margin:0 0 8px;color:var(--ink2);font-weight:600}section{margin:16px 0}.sub{font-size:12px;color:var(--mute)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:10px}.pos{color:var(--good)}.neg{color:var(--bad)}.zero{color:var(--ink2)}
.badge{display:inline-block;font-size:11px;border:1px solid var(--line);border-radius:999px;padding:1px 8px;color:var(--ink2);white-space:nowrap}.badge.warn{background:var(--warnbg);color:var(--warnink);border-color:transparent}
.row{display:flex;justify-content:space-between;gap:8px;align-items:center}.day{padding:8px 0;border-top:1px solid var(--line)}.day:first-of-type{border-top:0}
label{display:block;font-size:12px;color:var(--mute);margin:10px 0 4px}input,select{width:100%;padding:10px 12px;font:inherit;font-size:16px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink);min-width:0}
button.act{font:inherit;font-size:15px;min-height:44px;padding:0 16px;border-radius:10px;border:1px solid var(--s1);background:var(--s1);color:#fff;margin-top:10px}button.act.alt{background:none;color:var(--ink);border-color:var(--line)}button.act:disabled{opacity:.5}
.out{margin-top:8px;font-size:13px;white-space:pre-wrap}.out.bad{color:var(--bad)}.out.ok{color:var(--good)}
.stat dl,.mini dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:13px}.stat dt,.mini dt{color:var(--mute)}.stat dd,.mini dd{margin:0;text-align:right}.stat h3{font-size:14px;margin:0 0 6px}
details.trade{border-top:1px solid var(--line);padding:8px 0}details.trade:first-of-type{border-top:0}details.trade>summary{cursor:pointer;min-height:44px;display:flex;justify-content:space-between;align-items:center;gap:8px;list-style:none}details.trade>summary::-webkit-details-marker{display:none}
.pill{display:inline-block;font-size:11px;font-weight:650;border:1px solid currentColor;border-radius:6px;padding:0 6px;margin-right:6px;color:var(--ink2)}
.fill{border-top:1px dashed var(--line);padding:8px 0;font-size:13px}.fill:first-child{border-top:0}.edits{margin:6px 0 0;padding-left:16px;font-size:12px;color:var(--ink2)}.edits li{margin:2px 0}.chg{color:var(--mute)}
details.edit{margin-top:6px}details.edit>summary{cursor:pointer;min-height:36px;display:flex;align-items:center;font-size:13px;color:var(--s1)}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px}
ul.plain{margin:0;padding-left:18px;font-size:13px;color:var(--ink2)}ul.plain li{margin:3px 0}footer{font-size:11px;color:var(--mute);margin:18px 0 0;text-align:center}
`;
const jvHead = t => `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${jvE(t)}</title><style>${JV_CSS}</style></head>`;
const journalRenderError = () => `${jvHead('RICH300 일지')}<body><main><header><h1>RICH 300 일지</h1></header><section class="card"><p>일지를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.</p></section></main></body></html>`;

const jvStat = (name, s) => `<div class="card stat"><h3>${jvE(name)} ${s.lowSample ? '<span class="badge warn">표본 부족</span>' : ''}</h3><dl><dt>청산 거래</dt><dd>${s.n}건 (승 ${s.wins} · 패 ${s.losses}${s.flat ? ` · 무 ${s.flat}` : ''})</dd><dt>승률</dt><dd>${jvE(s.winRate)} <span class="sub">(95% 구간 ${jvE(s.winRateRange)})</span></dd><dt>평균 이익 / 손실</dt><dd>${jvE(s.avgWin)} / ${jvE(s.avgLoss)}</dd><dt>손익비</dt><dd>${jvE(s.payoff)}</dd><dt>Profit factor</dt><dd>${jvE(s.profitFactor)}</dd><dt>기대값(건당)</dt><dd class="${JV_TONE(s.expectancyPositive, s.expectancyNegative)}">${JV_ARROW(s.expectancyPositive, s.expectancyNegative)} ${jvE(s.expectancy)} USDT${s.rCoverage ? ` <span class="sub">(${jvE(s.expectancyR)}, ${s.rCoverage}건 기준)</span>` : ''}</dd><dt>최대 낙폭(거래 기준)</dt><dd>${jvE(s.maxDd)} USDT <span class="sub">(${jvE(s.maxDdOfStart)})</span></dd><dt>순손익</dt><dd class="${JV_TONE(s.netPositive, s.netNegative)}">${JV_ARROW(s.netPositive, s.netNegative)} ${jvE(s.net)} USDT</dd></dl></div>`;
const jvGrp = g => `<div class="card mini"><div class="row"><strong>${jvE(g.label)}</strong><span class="sub">${g.n}건${g.lowSample ? ' · 표본 부족' : ''}</span></div><dl><dt>승률</dt><dd>${jvE(g.winRate)}</dd><dt>기대값</dt><dd class="${JV_TONE(g.expectancyPositive, g.expectancyNegative)}">${jvE(g.expectancy)}</dd><dt>순손익</dt><dd>${jvE(g.net)}</dd></dl></div>`;

function jvCloseHtml(m) {
  const rows = m.closes.map(c => `<div class="day"><div class="row"><strong>${jvE(c.day)}${c.today ? ' <span class="sub">오늘</span>' : ''}</strong><span>${c.closed ? '<span class="badge">마감됨</span>' : '<span class="badge">마감 전</span>'} ${c.equity !== null ? `<span class="badge">평가액 ${jvE(c.equity)}${c.late ? ' · 마감 후 입력' : ''}</span>` : c.closed ? '<span class="badge warn">평가액 미입력</span>' : ''}</span></div>`
    + `${c.diffMicro !== null && c.needsReview ? `<div class="sub">⚠ 장부와 차이(마감 시점 ${jvE(c.diffLabel)} USDT)</div>` : ''}${c.flags.filter(f => m.warningText[f]).map(f => `<div class="sub">· ${jvE(m.warningText[f])}</div>`).join('')}${c.notice ? `<div class="sub">${jvE((JV_NOTICE[c.notice] != null ? JV_NOTICE[c.notice] : c.notice))}</div>` : ''}</div>`).join('');
  const opts = m.closes.map(c => `<option value="${jvE(c.day)}"${c.day === m.presetDay ? ' selected' : ''}>${jvE(c.day)}${c.closed && c.equity === null ? ' (미입력)' : ''}</option>`).join('');
  return `<section id="close" aria-labelledby="h-close"><h2 id="h-close">일 마감 (매일 00:00 KST)</h2><div class="card">${rows || '<div class="sub">아직 마감할 날이 없습니다.</div>'}</div>
<div class="card"><form id="eqForm"><strong>실제 계좌 평가액 입력</strong><div class="sub">거래소 화면의 평가액(미실현 포함)을 직접 입력합니다. 장부와 다르면 차이만 표시하며 손익에는 자동 반영하지 않습니다.</div>
<label for="eqDay">날짜</label><select id="eqDay">${opts}</select><label for="eqVal">평가액 (USDT)</label><input id="eqVal" inputmode="decimal" autocomplete="off"><label for="eqUn">미실현 손익 (선택, 보유 포지션이 있을 때)</label><input id="eqUn" inputmode="decimal" autocomplete="off"><label for="eqWhy">수정 사유 (이미 입력한 날짜를 고칠 때)</label><input id="eqWhy" autocomplete="off">
<button class="act" type="submit">저장</button><div class="out" id="eqOut" role="status"></div></form></div></section>`;
}
function jvTradeHtml(t) {
  const edits = es => (es.length ? `<ul class="edits">${es.map(h => `<li>${jvE(h.atLabel)} · rev ${h.rev} · ${h.op === 'void' ? '취소' : '수정'}${h.reason ? ` — ${jvE(h.reason)}` : ''}${h.changes.map(c => `<div class="chg">${jvE(c.field)}: ${jvE(c.from)} → ${jvE(c.to)}</div>`).join('')}</li>`).join('')}</ul>` : '');
  const fill = f => `<div class="fill"><div class="row"><strong>${jvE(f.kindLabel)}</strong><span>${jvE(f.atLabel)}</span></div><div>${jvE(f.price)} × ${jvE(f.qty)} · 수수료 ${jvE(f.fee)} · 펀딩 ${jvE(f.funding)}${f.edits.length ? ` <span class="badge">수정 ${f.edits.length}회</span>` : ''}</div>${f.note ? `<div class="sub">메모: ${jvE(f.note)}</div>` : ''}${edits(f.edits)}
<details class="edit"><summary>수정 / 취소</summary><form class="fillForm" data-fill="${jvE(f.fillId)}"><div class="grid2"><div><label>가격</label><input name="price" inputmode="decimal" value="${jvE(f.price)}" data-orig="${jvE(f.price)}"></div><div><label>수량</label><input name="qty" inputmode="decimal" value="${jvE(f.qty)}" data-orig="${jvE(f.qty)}"></div><div><label>수수료 (비움=미입력, ~=추정)</label><input name="fee" value="${jvE(f.feeEdit)}" data-orig="${jvE(f.feeEdit)}"></div><div><label>펀딩 (비움=미입력, ~=추정)</label><input name="funding" value="${jvE(f.fundingEdit)}" data-orig="${jvE(f.fundingEdit)}"></div></div>
<label>사유 (필수)</label><input name="reason" autocomplete="off"><div class="row"><button class="act" type="submit" data-act="revise">수정 저장</button><button class="act alt" type="submit" data-act="void">이 체결 취소</button></div><div class="out" role="status"></div></form></details></div>`;
  const dirTone = t.status === 'open' ? 'zero' : JV_TONE(t.win, t.loss);
  return `<details class="trade" data-dir="${jvE(t.dir)}"><summary><span><span class="pill">${jvE(t.dir)}</span><strong>${jvE((t.symbol != null ? t.symbol : t.sid))}</strong>${t.strategy ? ` <span class="badge">${jvE(t.strategy)}전략</span>` : ''}<div class="sub">${jvE(t.openedLabel)}${t.closedLabel ? ` → ${jvE(t.closedLabel)}` : ' · 보유 중'}</div></span><span class="${dirTone}"><strong>${t.status === 'open' ? '진행' : `${JV_ARROW(t.win, t.loss)} ${jvE(t.netLabel)}`}</strong></span></summary>
<div class="sub">${t.response ? `응답: ${jvE(t.response.label)}` : '응답 기록 없음'} · 신호 ${jvE(t.sid)}</div>
${t.review ? `<div class="sub">복기: ${jvE(t.review.plan)} · ${jvE(t.review.mind)}${t.review.memo ? ` · ${jvE(t.review.memo)}` : ''} (${jvE(t.review.savedLabel)})</div>${edits(t.review.edits)}` : '<div class="sub">복기 안 함</div>'}
${t.fills.map(fill).join('')}${t.voidedFills.length ? `<div class="sub" style="margin-top:6px">취소된 체결(손익에서 제외됨)</div>${t.voidedFills.map(v => `<div class="fill"><div>${jvE(v.kindLabel)} · ${jvE(v.atLabel)} · ${jvE(v.price)} × ${jvE(v.qty)}</div>${edits(v.edits)}</div>`).join('')}` : ''}</details>`;
}
const JV_TABS = Object.freeze(['journal', 'stats', 'assets']);
function journalRenderHtml(m, { appUrl, tab = 'all', query = null } = {}) {
  if (m.empty) return `${jvHead('RICH300 일지')}<body><main><header><h1>RICH 300 일지</h1></header><section class="card"><p>챌린지 설정이 없습니다. 먼저 시작 자금과 시작일을 저장해 주세요.</p></section></main></body></html>`;
  const a = m.analytics, rv = a.reviews, active = JV_TABS.includes(tab) ? tab : 'journal';
  const sec = {
    close: `${jvCloseHtml(m)}`,
    stat: `<section aria-labelledby="h-stat"><h2 id="h-stat">통계 <span class="sub">실제 청산 거래만 · 모의 제외</span></h2>${jvStat('전체', a.overall)}<div class="sub" style="margin:-4px 0 8px">승률 구간은 표본이 작을수록 넓어집니다. 30건 미만은 참고용입니다.</div>${a.strategies.map(s => jvStat(s.name, s)).join('')}${a.unlinked ? `<div class="sub">전략을 알 수 없는 거래 ${a.unlinked}건은 전체에만 포함됩니다.</div>` : ''}${a.dirs.map(d => jvStat(d.key, d)).join('')}</section>`,
    rv: `<section aria-labelledby="h-rv"><h2 id="h-rv">10초 복기 분석 <span class="sub">복기율 ${jvE(rv.reviewRate)} (${rv.reviewed}/${rv.total})</span></h2>${rv.byPlan.length ? `<div class="sub">계획 준수</div>${rv.byPlan.map(jvGrp).join('')}` : '<div class="card sub">저장된 복기가 없습니다.</div>'}${rv.byMind.length ? `<div class="sub">심리 상태</div>${rv.byMind.map(jvGrp).join('')}` : ''}${rv.insights.length ? `<div class="card"><strong>참고</strong><ul class="plain">${rv.insights.map(i => `<li>${jvE(i.text)}</li>`).join('')}</ul></div>` : ''}</section>`,
    cf: `<section aria-labelledby="h-cf"><h2 id="h-cf">입출금 기록</h2><div class="card"><form id="cfForm"><div class="sub">거래소와 지갑 사이 입금(+)·출금(−)을 기록합니다. 손익과 분리되어 목표 계산에 영향을 주지 않습니다.</div><label for="cfAmt">금액 (USDT, 입금 +, 출금 −)</label><input id="cfAmt" inputmode="decimal" autocomplete="off"><label for="cfNote">메모 (선택)</label><input id="cfNote" autocomplete="off"><button class="act" type="submit">저장</button><div class="out" id="cfOut" role="status"></div></form></div>
${m.cashflows.length ? `<div class="card">${m.cashflows.map(c => `<div class="day"><div class="row"><span>${jvE(c.atLabel)} · <strong>${jvE(c.amount)}</strong> ${jvE(c.note)}</span></div><form class="cfVoid" data-cf="${jvE(c.cfId)}"><div class="row" style="gap:6px"><input name="reason" placeholder="취소 사유" autocomplete="off" aria-label="취소 사유"><button class="act alt" type="submit" style="margin:0;white-space:nowrap">취소</button></div><div class="out" role="status"></div></form></div>`).join('')}</div>` : ''}</section>`,
    jr: `<section aria-labelledby="h-j"><h2 id="h-j">매매일지 <span class="sub">${m.tradesTotal}건${m.tradesOpen ? ` · 보유 ${m.tradesOpen}` : ''}${m.voidedCount ? ` · 취소된 체결 ${m.voidedCount}` : ''}</span></h2><div class="card">${m.trades.length ? m.trades.map(jvTradeHtml).join('') : '<div class="sub">아직 기록이 없습니다.</div>'}</div>${m.tradesTotal > m.trades.length ? `<div class="sub">최근 ${m.trades.length}건만 표시 (전체 ${m.tradesTotal}건)</div>${m.trades.length < 200 && !(query && (query.day || query.q)) && typeof appUrl === 'string' && /^https:\/\/\S+$/.test(appUrl) ? `<a class="cta" target="_top" href="${jvE(appUrl + (appUrl.includes('?') ? '&' : '?') + 'p=journal&n=' + Math.min(m.trades.length + 40, 200))}">더 보기 (+40건)</a>` : ''}` : ''}</section>`,
    warn: `${m.warnings.length ? `<section aria-labelledby="h-w"><h2 id="h-w">데이터 확인</h2><div class="card"><ul class="plain">${m.warnings.map(w => `<li>${jvE(w.text)}</li>`).join('')}</ul></div></section>` : ''}`,
    search: `<form class="card" method="get" action="${jvE(typeof appUrl === 'string' && /^https:\/\/\S+$/.test(appUrl) ? appUrl : '')}" target="_top"><input type="hidden" name="p" value="journal"><div class="grid2"><div><label for="qDay">날짜 (진입·청산·체결일)</label><input id="qDay" name="day" type="date" value="${jvE(query && query.day ? query.day : '')}"></div><div><label for="qSym">코인</label><input id="qSym" name="q" autocomplete="off" placeholder="BTC" value="${jvE(query && query.q ? query.q : '')}"></div></div><div class="row"><button class="act" type="submit">검색</button>${query && (query.day || query.q) ? `<a target="_top" href="${jvE(typeof appUrl === 'string' && /^https:\/\/\S+$/.test(appUrl) ? appUrl + (appUrl.includes('?') ? '&' : '?') + 'p=journal' : '')}">전체 보기</a>` : ''}</div>${query && (query.day || query.q) ? `<div class="sub">검색 결과 ${m.tradesTotal}건${m.tradesTotal > m.trades.length ? ` 중 ${m.trades.length}건 표시` : ''}</div>` : ''}</form>`,
  };
  const order = tab === 'assets' ? ['close', 'cf', 'warn'] : tab === 'stats' ? ['stat', 'rv'] : tab === 'journal' ? ['search', 'jr', 'warn'] : ['close', 'stat', 'rv', 'cf', 'jr', 'warn'];
  const title = tab === 'assets' ? '자산 관리' : tab === 'stats' ? '전략별 성적' : '매매일지';
  return `${jvHead('RICH300 ' + title)}<body><main>
<header><h1>RICH 300 · ${jvE(title)}</h1><span class="sub">${jvE(m.startDay)} 시작 · 시작 자금 ${jvE(m.startEquity)} USDT</span></header>
${dashNav(tab === 'all' ? 'journal' : tab === 'journal' ? 'journal' : tab, appUrl)}
${order.map(k => sec[k]).join('\n')}
<footer>기록 전용 · 자동 주문 없음 · 수정은 사유와 함께 이력으로 남습니다 · 갱신 ${jvE(new Date(m.generatedAt + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' '))} KST</footer></main><script>${JV_JS}</script></body></html>`;
}
const JV_JS = `(function(){
function $(s,r){return (r||document).querySelector(s)}function say(el,t,ok){el.textContent=t;el.className='out '+(ok?'ok':'bad')}
function call(fn,args,out,done){var run=window.google&&google.script&&google.script.run;if(!run){say(out,'연결할 수 없습니다',false);return}
run.withSuccessHandler(function(r){if(r&&r.ok){say(out,(r.message||'저장됨')+(r.detail?'\\n'+r.detail:''),true);if(done)done(r)}else say(out,(r&&r.message)||(r&&r.error==='busy'?'다른 작업 중입니다. 잠시 후 다시 눌러 주세요(중복 저장되지 않습니다).':'저장하지 못했습니다.'),false);unlock()}).withFailureHandler(function(){say(out,'연결 오류. 다시 눌러 주세요(중복 저장되지 않습니다).',false);unlock()})[fn].apply(null,args)}
var locked=[];function lock(f){locked=[].slice.call(f.querySelectorAll('button'));locked.forEach(function(b){b.disabled=true})}function unlock(){locked.forEach(function(b){b.disabled=false});locked=[]}
function id(){return (window.crypto&&crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9]/g,'').slice(0,24)}
var cfId=id();
document.addEventListener('submit',function(e){e.preventDefault();var f=e.target;
if(f.id==='eqForm'){var out=$('#eqOut');lock(f);call('rich300EquitySubmit',[{day:$('#eqDay').value,equity:$('#eqVal').value.trim(),unrealized:$('#eqUn').value.trim(),reason:$('#eqWhy').value.trim()}],out)}
else if(f.id==='cfForm'){var out2=$('#cfOut');lock(f);call('rich300CashflowSubmit',[{formId:cfId,amount:$('#cfAmt').value.trim(),note:$('#cfNote').value.trim()}],out2,function(){cfId=id()})}
else if(f.classList.contains('cfVoid')){var o3=$('.out',f);if(!f.elements.reason.value.trim()){say(o3,'사유를 입력해 주세요',false);return}lock(f);call('rich300CashflowVoid',[f.getAttribute('data-cf'),f.elements.reason.value.trim()],o3)}
else if(f.classList.contains('fillForm')){var o4=$('.out',f),act=e.submitter&&e.submitter.getAttribute('data-act'),reason=f.elements.reason.value.trim();
if(!reason){say(o4,'사유를 입력해 주세요',false);return}lock(f);
if(act==='void'){call('rich300JournalVoidFill',[f.getAttribute('data-fill'),reason],o4)}
else{var patch={},changed=0;['price','qty'].forEach(function(k){var v=f.elements[k].value.trim();if(v!==f.elements[k].getAttribute('data-orig')){patch[k]=v;changed++}});
['fee','funding'].forEach(function(k){var v=f.elements[k].value.trim();if(v!==f.elements[k].getAttribute('data-orig')){patch[k]=v===''?{state:'missing'}:v.charAt(0)==='~'?{state:'estimated',amount:v.slice(1)}:{state:'entered',amount:v};changed++}});
if(!changed){say(o4,'바뀐 값이 없습니다',false);unlock();return}call('rich300JournalReviseFill',[f.getAttribute('data-fill'),patch,reason],o4)}}
});
})();`;

// ── siglog.mjs ──
// 추천 기록 화면(COIN RADAR 추천 신호 + 내 응답 + 실제 매매 여부). 뷰 모델·HTML 렌더(서버 측, 순수 함수). 읽기 전용.
//  · 응답 = 진입 / 관망 / 놓침 / 미응답. 관망·놓침·미응답은 매매 손익에 들어가지 않는다(체결이 없으면 손익도 없다).
//  · 실제 매매 여부 = 그 신호에 연결된 체결(fill)이 있는지. 체결가는 추천가와 따로 표시한다.

const SIGLOG_LIMIT = 80;
const SIGLOG_FILTERS = Object.freeze({ all: '전체', entered: '진입', watched: '관망', missed: '놓침', none: '미응답' });
const sgKst = ms => new Date(ms + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' ');
const sgTrim = v => (v === undefined || v === null ? null : String(v));
const sgAvg = fs => { let q = BigInt(0), c = BigInt(0); for (const f of fs) if (f.kind === 'entry' || f.kind === 'add') { q += dec(f.qty); c += decMul(dec(f.price), dec(f.qty)); } if (q === BigInt(0)) return null; const t = decFormat(decDiv(c, q), 8); return t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t; };      // 실제 평균 진입가(체결 기준)

function siglogBuild(env, { now = env.now(), filter = 'all' } = {}) {
  const se = env.storeEnv(), data = n => storeList(se, n).map(r => r.data), signals = data('signal'), responses = new Map(data('response').map(r => [r.sid, r])), fills = data('fill');
  const trades = pnlComputeAll(fills, {}), fillsBy = new Map();
  for (const f of fills) { if (!fillsBy.has(f.sid)) fillsBy.set(f.sid, []); fillsBy.get(f.sid).push(f); }
  const f = Object.prototype.hasOwnProperty.call(SIGLOG_FILTERS, filter) ? filter : 'all';
  const rows = signals.sort((a, b) => b.signalAt - a.signalAt || (a.sid < b.sid ? 1 : -1)).map(s => {
    const r = responses.get(s.sid), t = trades.get(s.sid), choice = r ? r.choice : 'none', closed = t && t.status === 'closed', net = closed ? t.totals.netEnteredMicro : null;
    return { sid: s.sid, atLabel: sgKst(s.signalAt), symbol: s.symbolId.replace(/USDT$/, ''), dir: s.dir, strategy: s.strategy, strategyName: (AN_STRATEGY_NAME[s.strategy] != null ? AN_STRATEGY_NAME[s.strategy] : s.strategy), score: (s.score != null ? s.score : null),
      entry: s.entry, stop: s.stop, tp1: s.tp1, tp2: sgTrim(s.tp2), choice, choiceLabel: r ? RESPONSE_CHOICES[r.choice] : '미응답', traded: (nullishOr(fillsBy.get(s.sid), [])).length > 0, status: t ? t.status : null,
      netLabel: net === null ? null : anUsd(net, { sign: true }), win: net !== null && net > BigInt(0), loss: net !== null && net < BigInt(0), avgEntry: sgAvg(nullishOr(fillsBy.get(s.sid), [])) };
  });
  const count = k => rows.filter(x => x.choice === k).length, shown = rows.filter(x => f === 'all' || x.choice === f);
  return { generatedAt: now, filter: f, total: rows.length, counts: { entered: count('entered'), watched: count('watched'), missed: count('missed'), none: count('none') }, tradedCount: rows.filter(x => x.traded).length,
    enteredNoFill: rows.filter(x => x.choice === 'entered' && !x.traded).length, rows: shown.slice(0, SIGLOG_LIMIT), shownTotal: shown.length };
}

const sgUrl = (appUrl, q) => (typeof appUrl === 'string' && /^https:\/\/\S+$/.test(appUrl) ? `${appUrl}${appUrl.includes('?') ? '&' : '?'}${q}` : null);
function siglogRenderHtml(m, { appUrl } = {}) {
  const chips = Object.entries(SIGLOG_FILTERS).map(([k, label]) => { const u = sgUrl(appUrl, `p=signals${k === 'all' ? '' : `&r=${k}`}`), n = k === 'all' ? m.total : m.counts[k]; return `<a class="chip"${u ? ` target="_top" href="${dashEsc(u)}"` : ''}${m.filter === k ? ' aria-current="true"' : ''}>${label} ${n}</a>`; }).join('');
  const item = x => `<article class="sg"><div class="top"><div><span class="pill">${dashEsc(x.dir)}</span><strong>${dashEsc(x.symbol)}</strong> <span class="badge">${dashEsc(x.strategy)}${x.score !== null ? ` · ${x.score}점` : ''}</span></div>`
    + `<div class="ch ${x.choice}">${dashEsc(x.choiceLabel)}</div></div><div class="sub">${dashEsc(x.atLabel)} KST · ${dashEsc(x.strategyName)}</div>`
    + `<div class="px">추천 진입 ${dashEsc(x.entry)} · 손절 ${dashEsc(x.stop)} · 1차 ${dashEsc(x.tp1)}${x.tp2 ? ` · 2차 ${dashEsc(x.tp2)}` : ''}</div>`
    + `<div class="sub">${x.traded ? `실제 매매 있음${x.avgEntry ? ` · 실제 진입가 ${dashEsc(x.avgEntry)}` : ''} · ${x.status === 'open' ? '보유 중' : x.netLabel ? `결과 <span class="${x.win ? 'pos' : x.loss ? 'neg' : 'zero'}">${x.win ? '▲' : x.loss ? '▼' : '■'} ${dashEsc(x.netLabel)} USDT</span>` : ''}` : x.choice === 'entered' ? '진입했다고 눌렀지만 체결 기록이 아직 없습니다' : '실제 매매 없음(손익에 포함되지 않음)'}</div></article>`;
  return `${dashHead('RICH300 추천 기록')}<body><main><header><h1>RICH 300 · 추천 기록</h1></header>${dashNav('signals', appUrl)}
<style>.chips{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px}.chip{font-size:13px;padding:8px 12px;min-height:38px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--ink2);text-decoration:none}.chip[aria-current="true"]{border-color:var(--accent);color:var(--ink);font-weight:650}.sg{border-top:1px solid var(--line);padding:10px 0}.sg:first-child{border-top:0}.top{display:flex;justify-content:space-between;gap:8px;align-items:center}.px{font-size:13px;margin-top:2px}.pill{display:inline-block;font-size:11px;font-weight:650;border:1px solid currentColor;border-radius:6px;padding:0 6px;margin-right:6px;color:var(--ink2)}.ch{font-size:13px;font-weight:650;white-space:nowrap}.ch.entered{color:var(--good)}.ch.none{color:var(--mute)}</style>
<section aria-label="요약"><div class="card"><div class="grid2"><div><div class="k">추천 신호</div><div class="v">${m.total}<small>건</small></div></div><div><div class="k">실제 진입(체결 있음)</div><div class="v">${m.tradedCount}<small>건</small></div></div></div>
<div class="sub" style="margin-top:8px">진입 ${m.counts.entered} · 관망 ${m.counts.watched} · 놓침 ${m.counts.missed} · 미응답 ${m.counts.none}${m.enteredNoFill ? ` · 진입 눌렀지만 체결 기록 없음 ${m.enteredNoFill}` : ''}</div></div></section>
<section aria-label="목록"><div class="chips" role="group" aria-label="응답별 보기">${chips}</div><div class="card">${m.rows.length ? m.rows.map(item).join('') : '<p class="sub">표시할 추천이 없습니다.</p>'}${m.shownTotal > m.rows.length ? `<div class="sub">최근 ${m.rows.length}건만 표시</div>` : ''}</div></section>
<div class="sub">관망·놓침은 추천 기록에만 남고 실제 매매 손익에 포함되지 않습니다. 추천가는 참고 가격이며 실제 체결가와 따로 기록됩니다.</div>
${dashFooter(m)}</main></body></html>`;
}
const siglogRenderError = appUrl => `${dashHead('RICH300 추천 기록')}<body><main><header><h1>RICH 300 · 추천 기록</h1></header>${dashNav('signals', appUrl)}<section class="card"><p>추천 기록을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.</p></section></main></body></html>`;

// ── check.mjs ──
// 설치·검증 결과 화면(?p=check, 소유자 전용). 순수 함수: GAS가 모은 상태(값 없음)를 PASS/FAIL 요약 HTML로 만든다.
//  · 사용자에게 로그·스크린샷을 반복해서 요청하지 않도록, 설치 점검·자동 검증·폴링 실측을 한 화면에 모은다(복사 가능한 텍스트 포함).
//  · 토큰·키·이메일·시트 ID·금액은 어디에도 없다(존재 여부·개수·시간만).

const CHECK_STATUS_LABEL = Object.freeze({ PASS: '통과', FAIL: '실패', WARN: '주의', WAIT: '진행 중', SKIP: '건너뜀' });
// items: [{id,status,text}] (status: PASS|FAIL|WARN|WAIT|SKIP)
function checkSummary(items) {
  const c = { PASS: 0, FAIL: 0, WARN: 0, WAIT: 0, SKIP: 0 }; for (const i of items) if (Object.prototype.hasOwnProperty.call(c, i.status)) c[i.status]++;
  return { ...c, verdict: c.FAIL ? 'FAIL' : c.WAIT ? 'WAIT' : c.WARN ? 'WARN' : 'PASS' };
}
// selfTest 항목({id,level,ok,text})을 같은 형식으로
const checkFromSelfTest = r => (r && Array.isArray(r.items) ? r.items.map(i => ({ id: `S-${i.id}`, status: i.ok ? 'PASS' : i.level === 'fail' ? 'FAIL' : 'WARN', text: i.ok ? i.text.replace(/\s*\(.*$/, '') : i.text })) : []);
// 폴링 통계(tg:stats)를 실측 항목으로: 평균·최대 실행 시간, 간격 이상, 느린 실행
function checkPollItems(st, { minRuns = 20, last = null } = {}) {
  if (last && last.r && last.r.status === 'error' && last.r.code === 'conflict') return [{ id: 'P0', status: 'FAIL', text: '다른 곳에서 같은 봇의 업데이트를 가져가고 있거나 웹훅이 켜져 있습니다(409). 폴링이 동작하지 않습니다 — 설정은 건드리지 않았습니다' }];
  if (!st || !st.runs) return [{ id: 'P1', status: 'WAIT', text: 'Telegram 폴링이 아직 한 번도 실행되지 않았습니다(승인·페어링 후 시작)' }];
  const avg = Math.round(st.totalMs / st.runs), out = [];
  out.push({ id: 'P1', status: st.runs >= minRuns ? 'PASS' : 'WAIT', text: `폴링 ${st.runs}회 실행${st.runs >= minRuns ? '' : `(판정은 ${minRuns}회 이상부터)`}` });
  out.push({ id: 'P2', status: st.maxMs > 60000 ? 'FAIL' : st.maxMs > 30000 ? 'WARN' : 'PASS', text: `실행 시간 평균 ${avg}ms · 최대 ${st.maxMs}ms` });
  out.push({ id: 'P3', status: st.runs < minRuns ? 'WAIT' : (st.gaps90 || 0) > Math.max(2, Math.floor(st.runs * 0.1)) ? 'WARN' : 'PASS', text: `90초를 넘긴 실행 간격 ${st.gaps90 || 0}회(최대 간격 ${Math.round((st.maxGap || 0) / 1000)}초)` });
  out.push({ id: 'P4', status: (st.slow || 0) ? 'WARN' : 'PASS', text: `30초 넘게 걸린 실행 ${st.slow || 0}회 · 잠금 대기(busy) ${st.busy || 0}회` });
  return out;
}
const checkSym = { PASS: '✔', FAIL: '✖', WARN: '▲', WAIT: '…', SKIP: '–' };
function checkReportText(sections) {
  const all = sections.flatMap(s => s.items), sum = checkSummary(all);
  return [`RICH300 점검 결과: ${CHECK_STATUS_LABEL[sum.verdict]} (통과 ${sum.PASS} · 실패 ${sum.FAIL} · 주의 ${sum.WARN} · 진행 중 ${sum.WAIT})`, ...sections.flatMap(s => [`[${s.title}]`, ...s.items.map(i => `${(checkSym[i.status] != null ? checkSym[i.status] : '?')} ${i.id} ${i.text}`)])].join('\n');
}
function checkRenderHtml({ sections, generatedAt, notes = [] }, { appUrl } = {}) {
  const all = sections.flatMap(s => s.items), sum = checkSummary(all), tone = s => (s === 'PASS' ? 'pos' : s === 'FAIL' ? 'neg' : 'zero');
  const sec = s => `<section><h2>${dashEsc(s.title)}</h2><div class="card"><table><tbody>${s.items.map(i => `<tr><td class="${tone(i.status)}">${(checkSym[i.status] != null ? checkSym[i.status] : '?')} ${dashEsc((CHECK_STATUS_LABEL[i.status] != null ? CHECK_STATUS_LABEL[i.status] : i.status))}</td><td style="text-align:left">${dashEsc(i.id)} · ${dashEsc(i.text)}</td></tr>`).join('') || '<tr><td colspan="2" class="sub">항목 없음</td></tr>'}</tbody></table></div></section>`;
  return `${dashHead('RICH300 점검')}<body><main><header><h1>RICH 300 · 설치 점검</h1></header>${dashNav('check', appUrl)}
<section><div class="card hero"><div class="k">전체 판정</div><div class="big ${tone(sum.verdict)}">${dashEsc(CHECK_STATUS_LABEL[sum.verdict])}</div><div class="sub">통과 ${sum.PASS} · 실패 ${sum.FAIL} · 주의 ${sum.WARN} · 진행 중 ${sum.WAIT}${sum.WAIT ? ' — 잠시 뒤 새로 고침' : ''}</div></div></section>
${notes.map(n => `<div class="notice">${dashEsc(n)}</div>`).join('')}
${sections.map(sec).join('\n')}
<section><h2>복사용 요약</h2><div class="card"><pre style="white-space:pre-wrap;word-break:break-word;margin:0;font-size:12px">${dashEsc(checkReportText(sections))}</pre></div></section>
${dashFooter({ generatedAt })}</main></body></html>`;
}
const checkRenderError = appUrl => `${dashHead('RICH300 점검')}<body><main><header><h1>RICH 300 · 설치 점검</h1></header>${dashNav('check', appUrl)}<section class="card"><p>점검 결과를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.</p></section></main></body></html>`;

// 봇 사전 점검(읽기 전용 getMe·getWebhookInfo 결과의 요약 info: {me:{ok,code}, wh:{ok, hasUrl, pending, lastErrorAt, hasAllowed}})
function checkBotItems(info) {
  if (!info) return [{ id: 'B0', status: 'WAIT', text: '봇 사전 점검 전(rich300BotCheck 실행, 읽기 전용 승인 또는 운영 승인 필요)' }];
  const out = [];
  out.push({ id: 'B1', status: info.me && info.me.ok ? 'PASS' : 'FAIL', text: info.me && info.me.ok ? '봇 토큰 유효(getMe)' : `봇 토큰을 확인하지 못했습니다(${info.me ? info.me.code : 'error'})` });
  if (!info.wh || !info.wh.ok) { out.push({ id: 'B2', status: 'FAIL', text: '웹훅 상태를 확인하지 못했습니다' }); return out; }
  out.push({ id: 'B2', status: info.wh.hasUrl ? 'FAIL' : 'PASS', text: info.wh.hasUrl ? '이 봇에는 웹훅이 설정되어 있습니다 — 다른 수신 서비스가 있다는 뜻이며 폴링을 쓸 수 없습니다(설정은 지우지 않음)' : '웹훅 없음(폴링 사용 가능)' });
  out.push({ id: 'B3', status: info.wh.pending > 0 ? 'WARN' : 'PASS', text: info.wh.pending > 0 ? `아직 가져가지 않은 업데이트 ${info.wh.pending}건 — 첫 폴링에서 처리됩니다(페어링 전에는 모두 무시, 기록 없음)` : '대기 중인 업데이트 없음' });
  out.push({ id: 'B4', status: info.wh.lastErrorAt ? 'WARN' : 'PASS', text: info.wh.lastErrorAt ? '웹훅 전달 오류 기록이 있습니다(과거 웹훅 사용 흔적)' : '웹훅 오류 기록 없음' });
  return out;
}

// ── livevectors.mjs ──
// 자동 생성 파일 — 수정하지 마세요. 생성: python3 rich300/test/fixtures/gen_live_vectors.py
// 실제 Apps Script V8에서 BigInt·고정소수점·손익·복리·HMAC 계산이 독립 기준값과 같은지 확인하는 벡터(S0 이후 실환경 검증용).
const LIVE_DEC_VECTORS = [{"a": "4981.172409900000", "b": "160.513200000000", "mul": "799543923264760680", "div": "31032789888308", "micro": "4981172410"}, {"a": "702.074350820000", "b": "6143.340900000000", "mul": "4313082074233454538", "div": "114282173535", "micro": "702074351"}, {"a": "22186585.335000000000", "b": "459193.095000000000", "mul": "10187926787460261825000000", "div": "48316461150183", "micro": "22186585335000"}, {"a": "7889081.216700000000", "b": "6781890.890000000000", "mul": "53502888034007845863000000", "div": "1163256876977", "micro": "7889081216700"}, {"a": "166048996.690000000000", "b": "74125625.500000000000", "mul": "12308485743293679595000000000", "div": "2240102468882", "micro": "166048996690000"}, {"a": "39929430.199000000000", "b": "546231.998000000000", "mul": "21810732436601307602000000", "div": "73099764102432", "micro": "39929430199000"}, {"a": "497158834.230000000000", "b": "7.124252000000", "mul": "3541884819080745960000", "div": "69784004584621655719", "micro": "497158834230000"}, {"a": "120445.666140000000", "b": "86.872643300000", "mul": "10463433391611107862", "div": "1386462545223371", "micro": "120445666140"}, {"a": "402700740.490000000000", "b": "63.233322900000", "mul": "25464105955473274221000", "div": "6368489303129758503", "micro": "402700740490000"}, {"a": "98.989272501000", "b": "47701577.400000000000", "mul": "4721944443976143077400", "div": "2075178", "micro": "98989273"}, {"a": "913588.208770000000", "b": "73.286633800000", "mul": "66953804500124938426", "div": "12465959499015767", "micro": "913588208770"}, {"a": "929.488099240000", "b": "255.669817000000", "mul": "237642052236368639", "div": "3635501875609", "micro": "929488099"}, {"a": "27526.572644000000", "b": "15.100342000000", "mul": "415660661012244248", "div": "1822910543615502", "micro": "27526572644"}, {"a": "45.187519308000", "b": "4599206.460000000000", "mul": "207826730712728329680", "div": "9825069", "micro": "45187519"}, {"a": "927.181259710000", "b": "16.270771100000", "mul": "15085954044951062", "div": "56984469513556", "micro": "927181260"}, {"a": "120071474.390000000000", "b": "287.739950000000", "mul": "34549360037404880500000", "div": "417291635693966027", "micro": "120071474390000"}, {"a": "877514.318610000000", "b": "63874458.500000000000", "mul": "56050751927210222685000000", "div": "13738109711", "micro": "877514318610"}, {"a": "7843.135126500000", "b": "1274.640920000000", "mul": "9997180973326276380", "div": "6153211467980", "micro": "7843135127"}, {"a": "1115.595152300000", "b": "87434890.100000000000", "mul": "97541939537443262230000", "div": "12759153", "micro": "1115595152"}, {"a": "5093849.017600000000", "b": "592156.445000000000", "mul": "3016355525628758432000000", "div": "8602201429387", "micro": "5093849017600"}, {"a": "798.716951990000", "b": "72581867.100000000000", "mul": "57972367659855260529000", "div": "11004359", "micro": "798716952"}, {"a": "664.721688540000", "b": "20679.679000000000", "mul": "13746231143345178660", "div": "32143714056", "micro": "664721689"}, {"a": "2881016.581900000000", "b": "47787875.400000000000", "mul": "137677661441171095260000000", "div": "60287605544", "micro": "2881016581900"}, {"a": "109878.682810000000", "b": "16252347.700000000000", "mul": "1785786557846133037000000", "div": "6760788339", "micro": "109878682810"}];
const LIVE_IDEAL_VECTORS = [[1, "315000000"], [2, "330750000"], [3, "347287500"], [4, "364651875"], [5, "382884469"], [6, "402028692"], [7, "422130127"], [8, "443236633"], [9, "465398465"], [10, "488668388"], [11, "513101807"], [12, "538756898"], [13, "565694743"], [14, "593979480"], [15, "623678454"], [16, "654862377"], [17, "687605495"], [18, "721985770"], [19, "758085059"], [20, "795989312"], [21, "835788777"], [22, "877578216"], [23, "921457127"], [24, "967529983"], [25, "1015906482"], [26, "1066701806"], [27, "1120036897"], [28, "1176038742"], [29, "1234840679"], [30, "1296582713"], [60, "5603755768"], [90, "24219109515"], [180, "1955217552290"], [365, "16263552473351857"]];   // [일수, 300 USDT × 1.05^n 의 마이크로 USDT]
const LIVE_PNL_VECTORS = [{"dir": "SHORT", "fills": [{"fillId": "x0-0", "kind": "entry", "price": "0.447649", "qty": "0.000763034535"}, {"fillId": "x0-1", "kind": "add", "price": "0.388193", "qty": "0.000159318716"}, {"fillId": "x0-2", "kind": "add", "price": "1.478464", "qty": "0.05"}, {"fillId": "x0-3", "kind": "reduce", "price": "56366.32", "qty": "0.035645647276"}, {"fillId": "x0-4", "kind": "reduce", "price": "55999.216", "qty": "0.001527670598"}, {"fillId": "x0-5", "kind": "close", "price": "18573.64", "qty": "0.013749035377"}], "grossMicroPerEvent": ["0", "0", "0", "-2009161932", "-85546126", "-255349565"]}, {"dir": "LONG", "fills": [{"fillId": "x1-0", "kind": "entry", "price": "0.04360707", "qty": "0.08020187"}, {"fillId": "x1-1", "kind": "add", "price": "0.000017547449", "qty": "0.15"}, {"fillId": "x1-2", "kind": "add", "price": "1.071561", "qty": "864.6023"}, {"fillId": "x1-3", "kind": "add", "price": "5.131531", "qty": "0.000105296745"}, {"fillId": "x1-4", "kind": "close", "price": "53228.064", "qty": "864.832607166745"}], "grossMicroPerEvent": ["0", "0", "0", "0", "46032438885413"]}, {"dir": "SHORT", "fills": [{"fillId": "x2-0", "kind": "entry", "price": "0.000063278361", "qty": "0.05"}, {"fillId": "x2-1", "kind": "add", "price": "1.069216", "qty": "876.67025"}, {"fillId": "x2-2", "kind": "add", "price": "0.000098285932", "qty": "6510890"}, {"fillId": "x2-3", "kind": "close", "price": "0.808642", "qty": "6511766.72025"}], "grossMicroPerEvent": ["0", "0", "0", "-5264110785443"]}, {"dir": "SHORT", "fills": [{"fillId": "x3-0", "kind": "entry", "price": "888639.16", "qty": "0.000373501281"}, {"fillId": "x3-1", "kind": "add", "price": "2.436999", "qty": "1.25"}, {"fillId": "x3-2", "kind": "reduce", "price": "1.013071", "qty": "0.125037350128"}, {"fillId": "x3-3", "kind": "close", "price": "1.950474", "qty": "1.125336151153"}], "grossMicroPerEvent": ["0", "0", "33368740", "299263763"]}, {"dir": "LONG", "fills": [{"fillId": "x4-0", "kind": "entry", "price": "3.918458", "qty": "0.01"}, {"fillId": "x4-1", "kind": "reduce", "price": "0.000023034721", "qty": "0.004"}, {"fillId": "x4-2", "kind": "close", "price": "23944.052", "qty": "0.006"}], "grossMicroPerEvent": ["0", "-15674", "143640801"]}, {"dir": "SHORT", "fills": [{"fillId": "x5-0", "kind": "entry", "price": "96472.777", "qty": "1092670"}, {"fillId": "x5-1", "kind": "add", "price": "219141.43", "qty": "0.00077906"}, {"fillId": "x5-2", "kind": "reduce", "price": "19329.917", "qty": "655602.000467436"}, {"fillId": "x5-3", "kind": "close", "price": "0.00004897365", "qty": "437068.000311624"}], "grossMicroPerEvent": ["0", "0", "50575013395119094", "42165163744720914"]}, {"dir": "LONG", "fills": [{"fillId": "x6-0", "kind": "entry", "price": "1.10787", "qty": "439.6775"}, {"fillId": "x6-1", "kind": "close", "price": "147031.23", "qty": "439.6775"}], "grossMicroPerEvent": ["0", "64645836522813"]}, {"dir": "SHORT", "fills": [{"fillId": "x7-0", "kind": "entry", "price": "0.000047920141", "qty": "551.3363"}, {"fillId": "x7-1", "kind": "add", "price": "739813.44", "qty": "0.02"}, {"fillId": "x7-2", "kind": "add", "price": "0.04576657", "qty": "0.25"}, {"fillId": "x7-3", "kind": "add", "price": "0.983679", "qty": "2.5"}, {"fillId": "x7-4", "kind": "close", "price": "0.106261", "qty": "554.1063"}], "grossMicroPerEvent": ["0", "0", "0", "0", "14739885970"]}, {"dir": "SHORT", "fills": [{"fillId": "x8-0", "kind": "entry", "price": "0.935295", "qty": "9042898"}, {"fillId": "x8-1", "kind": "add", "price": "0.06834549", "qty": "0.00079693987"}, {"fillId": "x8-2", "kind": "reduce", "price": "0.000069410896", "qty": "5425738.800478163922"}, {"fillId": "x8-3", "kind": "close", "price": "1.579563", "qty": "3617159.200318775948"}], "grossMicroPerEvent": ["0", "0", "5074289765587", "-2330419923947"]}, {"dir": "LONG", "fills": [{"fillId": "x9-0", "kind": "entry", "price": "68615.966", "qty": "0.02375288"}, {"fillId": "x9-1", "kind": "reduce", "price": "0.499013", "qty": "0.004750576"}, {"fillId": "x9-2", "kind": "reduce", "price": "0.000070108384", "qty": "0.0171020736"}, {"fillId": "x9-3", "kind": "reduce", "price": "0.000074126081", "qty": "0.00057006912"}, {"fillId": "x9-4", "kind": "reduce", "price": "0.03581196", "qty": "0.000532064512"}, {"fillId": "x9-5", "kind": "close", "price": "0.595005", "qty": "0.000798096768"}], "grossMicroPerEvent": ["0", "-325962991", "-1173475299", "-39115843", "-36508101", "-54761706"]}, {"dir": "SHORT", "fills": [{"fillId": "x10-0", "kind": "entry", "price": "0.000096597778", "qty": "0.06335568"}, {"fillId": "x10-1", "kind": "add", "price": "0.000021194731", "qty": "7777798"}, {"fillId": "x10-2", "kind": "reduce", "price": "1.543711", "qty": "7000018.257020112"}, {"fillId": "x10-3", "kind": "reduce", "price": "0.283328", "qty": "77777.9806335568"}, {"fillId": "x10-4", "kind": "close", "price": "0.878064", "qty": "700001.8257020112"}], "grossMicroPerEvent": ["0", "0", "-10805856820055", "-22035031214", "-614631566732"]}, {"dir": "LONG", "fills": [{"fillId": "x11-0", "kind": "entry", "price": "1.647602", "qty": "33546.77"}, {"fillId": "x11-1", "kind": "add", "price": "0.000045315358", "qty": "0.625"}, {"fillId": "x11-2", "kind": "close", "price": "0.09416514", "qty": "33547.395"}], "grossMicroPerEvent": ["0", "0", "-52112730227"]}, {"dir": "LONG", "fills": [{"fillId": "x12-0", "kind": "entry", "price": "1.519805", "qty": "0.000002"}, {"fillId": "x12-1", "kind": "add", "price": "0.000084897851", "qty": "0.15"}, {"fillId": "x12-2", "kind": "add", "price": "0.01615902", "qty": "66358.61"}, {"fillId": "x12-3", "kind": "add", "price": "0.82813", "qty": "37.5"}, {"fillId": "x12-4", "kind": "reduce", "price": "81493.196", "qty": "26558.5040008"}, {"fillId": "x12-5", "kind": "close", "price": "0.09675815", "qty": "39837.7560012"}], "grossMicroPerEvent": ["0", "0", "0", "0", "2164336930665980", "3192620573"]}, {"dir": "LONG", "fills": [{"fillId": "x13-0", "kind": "entry", "price": "7.280237", "qty": "254204.224"}, {"fillId": "x13-1", "kind": "add", "price": "0.852141", "qty": "0.01315842"}, {"fillId": "x13-2", "kind": "close", "price": "163783.64", "qty": "254204.23715842"}], "grossMicroPerEvent": ["0", "0", "41632644598220950"]}, {"dir": "SHORT", "fills": [{"fillId": "x14-0", "kind": "entry", "price": "1.575918", "qty": "284136.707"}, {"fillId": "x14-1", "kind": "add", "price": "0.606972", "qty": "0.375"}, {"fillId": "x14-2", "kind": "add", "price": "0.000024351744", "qty": "0.06334755"}, {"fillId": "x14-3", "kind": "add", "price": "0.000053056772", "qty": "265.5887"}, {"fillId": "x14-4", "kind": "close", "price": "1.705828", "qty": "284402.73404755"}], "grossMicroPerEvent": ["0", "0", "0", "0", "-37365754286"]}, {"dir": "SHORT", "fills": [{"fillId": "x15-0", "kind": "entry", "price": "0.000086927475", "qty": "0.75"}, {"fillId": "x15-1", "kind": "reduce", "price": "0.000017115575", "qty": "0.3"}, {"fillId": "x15-2", "kind": "reduce", "price": "5.790399", "qty": "0.36"}, {"fillId": "x15-3", "kind": "reduce", "price": "1.780148", "qty": "0.045"}, {"fillId": "x15-4", "kind": "close", "price": "0.000094692947", "qty": "0.045"}], "grossMicroPerEvent": ["0", "21", "-2084512", "-80103", "0"]}, {"dir": "SHORT", "fills": [{"fillId": "x16-0", "kind": "entry", "price": "699.8308", "qty": "9522125"}, {"fillId": "x16-1", "kind": "close", "price": "0.863699", "qty": "9522125"}], "grossMicroPerEvent": ["0", "6655652106609625"]}, {"dir": "SHORT", "fills": [{"fillId": "x17-0", "kind": "entry", "price": "0.08710425", "qty": "0.000555691487"}, {"fillId": "x17-1", "kind": "add", "price": "0.610103", "qty": "8.849352"}, {"fillId": "x17-2", "kind": "close", "price": "30713.83", "qty": "8.849907691487"}], "grossMicroPerEvent": ["0", "0", "-271809161287"]}, {"dir": "SHORT", "fills": [{"fillId": "x18-0", "kind": "entry", "price": "267942.24", "qty": "0.0573946"}, {"fillId": "x18-1", "kind": "add", "price": "0.000027878978", "qty": "0.1"}, {"fillId": "x18-2", "kind": "add", "price": "0.000059551261", "qty": "8947602"}, {"fillId": "x18-3", "kind": "reduce", "price": "685205.64", "qty": "7158081.72591568"}, {"fillId": "x18-4", "kind": "reduce", "price": "76384.24", "qty": "1073712.258887352"}, {"fillId": "x18-5", "kind": "reduce", "price": "492889.95", "qty": "286323.2690366272"}, {"fillId": "x18-6", "kind": "close", "price": "625276.13", "qty": "429484.9035549408"}], "grossMicroPerEvent": ["0", "0", "0", "-4904757957449335162", "-82014692964440187", "-141125861250138811", "-268546657624515250"]}, {"dir": "SHORT", "fills": [{"fillId": "x19-0", "kind": "entry", "price": "0.436322", "qty": "24789.749"}, {"fillId": "x19-1", "kind": "reduce", "price": "0.000053758156", "qty": "7436.9247"}, {"fillId": "x19-2", "kind": "close", "price": "667925.68", "qty": "17352.8243"}], "grossMicroPerEvent": ["0", "3244494064", "-11590389399079020"]}, {"dir": "SHORT", "fills": [{"fillId": "x20-0", "kind": "entry", "price": "0.02973717", "qty": "0.02464192"}, {"fillId": "x20-1", "kind": "add", "price": "1.150913", "qty": "0.3"}, {"fillId": "x20-2", "kind": "add", "price": "76474.93", "qty": "83534.846"}, {"fillId": "x20-3", "kind": "reduce", "price": "1.188065", "qty": "41767.58532096"}, {"fillId": "x20-4", "kind": "close", "price": "1.612427", "qty": "41767.58532096"}], "grossMicroPerEvent": ["0", "0", "0", "3194111127772139", "3194093403196097"]}, {"dir": "SHORT", "fills": [{"fillId": "x21-0", "kind": "entry", "price": "0.286956", "qty": "226.3501"}, {"fillId": "x21-1", "kind": "add", "price": "0.000003480528", "qty": "3.75"}, {"fillId": "x21-2", "kind": "close", "price": "90889.24", "qty": "230.1001"}], "grossMicroPerEvent": ["0", "0", "-20913558260392"]}, {"dir": "LONG", "fills": [{"fillId": "x22-0", "kind": "entry", "price": "7816.263", "qty": "0.05"}, {"fillId": "x22-1", "kind": "reduce", "price": "27076.945", "qty": "0.03"}, {"fillId": "x22-2", "kind": "close", "price": "0.000074866715", "qty": "0.02"}], "grossMicroPerEvent": ["0", "577820460", "-156325259"]}, {"dir": "SHORT", "fills": [{"fillId": "x23-0", "kind": "entry", "price": "8373.23", "qty": "0.25"}, {"fillId": "x23-1", "kind": "add", "price": "78430.01", "qty": "0.09023181"}, {"fillId": "x23-2", "kind": "add", "price": "206945.68", "qty": "0.05"}, {"fillId": "x23-3", "kind": "add", "price": "0.214394", "qty": "8908528"}, {"fillId": "x23-4", "kind": "close", "price": "93978.781", "qty": "8908528.39023181"}], "grossMicroPerEvent": ["0", "0", "0", "0", "-837210709165452519"]}, {"dir": "SHORT", "fills": [{"fillId": "x24-0", "kind": "entry", "price": "0.000004588285", "qty": "843111"}, {"fillId": "x24-1", "kind": "add", "price": "1.434966", "qty": "0.05"}, {"fillId": "x24-2", "kind": "add", "price": "0.04783769", "qty": "9.375"}, {"fillId": "x24-3", "kind": "add", "price": "22062.854", "qty": "3554400"}, {"fillId": "x24-4", "kind": "reduce", "price": "1.893732", "qty": "1759008.17"}, {"fillId": "x24-5", "kind": "reduce", "price": "1.890414", "qty": "527702.451"}, {"fillId": "x24-6", "kind": "close", "price": "0.00004051044", "qty": "2110809.804"}], "grossMicroPerEvent": ["0", "0", "0", "0", "31364752214735674", "9409427415337435", "37641699880244723"]}, {"dir": "SHORT", "fills": [{"fillId": "x25-0", "kind": "entry", "price": "0.09591203", "qty": "95898.383"}, {"fillId": "x25-1", "kind": "add", "price": "1.800477", "qty": "0.000133725776"}, {"fillId": "x25-2", "kind": "add", "price": "0.000033950767", "qty": "487.776878"}, {"fillId": "x25-3", "kind": "reduce", "price": "0.000070931362", "qty": "67470.312008208043"}, {"fillId": "x25-4", "kind": "reduce", "price": "818.7963", "qty": "11566.339201407093"}, {"fillId": "x25-5", "kind": "reduce", "price": "9.042128", "qty": "12144.656161477448"}, {"fillId": "x25-6", "kind": "reduce", "price": "25352.289", "qty": "3643.396848443234"}, {"fillId": "x25-7", "kind": "reduce", "price": "0.724558", "qty": "780.727896094979"}, {"fillId": "x25-8", "kind": "reduce", "price": "0.621619", "qty": "234.218368828494"}, {"fillId": "x25-9", "kind": "reduce", "price": "0.000060849032", "qty": "273.254763633242"}, {"fillId": "x25-10", "kind": "reduce", "price": "119.4284", "qty": "163.952858179946"}, {"fillId": "x25-11", "kind": "reduce", "price": "867.3166", "qty": "10.93019054533"}, {"fillId": "x25-12", "kind": "reduce", "price": "49780.348", "qty": "49.185857453984"}, {"fillId": "x25-13", "kind": "reduce", "price": "1.702661", "qty": "4.918585745398"}, {"fillId": "x25-14", "kind": "reduce", "price": "0.02284073", "qty": "26.560363025151"}, {"fillId": "x25-15", "kind": "reduce", "price": "0.000081254739", "qty": "3.541381736687"}, {"fillId": "x25-16", "kind": "reduce", "price": "0.05469966", "qty": "5.666210778699"}, {"fillId": "x25-17", "kind": "reduce", "price": "17622.774", "qty": "3.399726467219"}, {"fillId": "x25-18", "kind": "close", "price": "0.000023565623", "qty": "5.099589700829"}], "grossMicroPerEvent": ["0", "0", "0", "6433692011", "-9469372003610", "-108654609529", "-92368102165622", "-491180257", "-123243873", "26059208", "-19564982027", "-9478892668", "-2448484407087", "-7905319", "1927913", "337655", "230769", "-59912286769", "486517"]}, {"dir": "LONG", "fills": [{"fillId": "x26-0", "kind": "entry", "price": "0.000067710653", "qty": "0.000005"}, {"fillId": "x26-1", "kind": "add", "price": "0.666879", "qty": "7499791"}, {"fillId": "x26-2", "kind": "add", "price": "0.859409", "qty": "0.25"}, {"fillId": "x26-3", "kind": "add", "price": "0.00000216676", "qty": "2.5"}, {"fillId": "x26-4", "kind": "reduce", "price": "92452.992", "qty": "4499876.250003"}, {"fillId": "x26-5", "kind": "reduce", "price": "0.000033526033", "qty": "899975.2500006"}, {"fillId": "x26-6", "kind": "reduce", "price": "0.214818", "qty": "1889948.02500126"}, {"fillId": "x26-7", "kind": "close", "price": "97562.419", "qty": "209994.22500014"}], "grossMicroPerEvent": ["0", "0", "0", "0", "416024022070515071", "-600144227858", "-854371386126", "20487404526350494"]}, {"dir": "SHORT", "fills": [{"fillId": "x27-0", "kind": "entry", "price": "0.000055431686", "qty": "45533.76"}, {"fillId": "x27-1", "kind": "add", "price": "1.742519", "qty": "0.2"}, {"fillId": "x27-2", "kind": "reduce", "price": "141063.05", "qty": "31873.772"}, {"fillId": "x27-3", "kind": "reduce", "price": "1.073807", "qty": "12294.1692"}, {"fillId": "x27-4", "kind": "reduce", "price": "0.307304", "qty": "683.0094"}, {"fillId": "x27-5", "kind": "close", "price": "0.000035928518", "qty": "683.0094"}], "grossMicroPerEvent": ["0", "0", "-4496211491313838", "-13200789367", "-209848433", "18548"]}, {"dir": "LONG", "fills": [{"fillId": "x28-0", "kind": "entry", "price": "1.686998", "qty": "0.000006438168"}, {"fillId": "x28-1", "kind": "add", "price": "9.070132", "qty": "0.05153972"}, {"fillId": "x28-2", "kind": "add", "price": "1.134606", "qty": "3094505"}, {"fillId": "x28-3", "kind": "add", "price": "1.701224", "qty": "18.75"}, {"fillId": "x28-4", "kind": "reduce", "price": "1.971149", "qty": "2785071.421391542351"}, {"fillId": "x28-5", "kind": "close", "price": "657.895", "qty": "309452.380154615817"}], "grossMicroPerEvent": ["0", "0", "0", "0", "2329822072288", "203236066011275"]}, {"dir": "SHORT", "fills": [{"fillId": "x29-0", "kind": "entry", "price": "0.000015806619", "qty": "342.263981"}, {"fillId": "x29-1", "kind": "add", "price": "0.000073321186", "qty": "0.000895848912"}, {"fillId": "x29-2", "kind": "add", "price": "1.993297", "qty": "0.1"}, {"fillId": "x29-3", "kind": "reduce", "price": "309273.07", "qty": "239.655413794238"}, {"fillId": "x29-4", "kind": "close", "price": "29827.92", "qty": "102.709463054674"}], "grossMicroPerEvent": ["0", "0", "0", "-74118965422946", "-3063609585816"]}, {"dir": "SHORT", "fills": [{"fillId": "x30-0", "kind": "entry", "price": "66058.019", "qty": "391.8241"}, {"fillId": "x30-1", "kind": "reduce", "price": "0.000088959006", "qty": "39.18241"}, {"fillId": "x30-2", "kind": "reduce", "price": "6293.13", "qty": "141.056676"}, {"fillId": "x30-3", "kind": "close", "price": "0.06221875", "qty": "211.585014"}], "grossMicroPerEvent": ["0", "2588312380760", "8430236583849", "13976873710372"]}, {"dir": "SHORT", "fills": [{"fillId": "x31-0", "kind": "entry", "price": "0.000068725059", "qty": "6096180"}, {"fillId": "x31-1", "kind": "reduce", "price": "0.89707", "qty": "1828854"}, {"fillId": "x31-2", "kind": "close", "price": "34602.444", "qty": "4267326"}], "grossMicroPerEvent": ["0", "-1640484369681", "-147659908651471769"]}, {"dir": "SHORT", "fills": [{"fillId": "x32-0", "kind": "entry", "price": "0.492253", "qty": "210.246"}, {"fillId": "x32-1", "kind": "add", "price": "49459.738", "qty": "54.958398"}, {"fillId": "x32-2", "kind": "add", "price": "1.503747", "qty": "73442.52"}, {"fillId": "x32-3", "kind": "close", "price": "582908.94", "qty": "73707.724398"}], "grossMicroPerEvent": ["0", "0", "0", "-42962062728220992"]}, {"dir": "SHORT", "fills": [{"fillId": "x33-0", "kind": "entry", "price": "8.514164", "qty": "9105202"}, {"fillId": "x33-1", "kind": "add", "price": "0.21783", "qty": "2.5"}, {"fillId": "x33-2", "kind": "add", "price": "32735.05", "qty": "237.188847"}, {"fillId": "x33-3", "kind": "add", "price": "0.01839539", "qty": "0.1"}, {"fillId": "x33-4", "kind": "close", "price": "0.000070778118", "qty": "9105441.788847"}], "grossMicroPerEvent": ["0", "0", "0", "0", "85286927927497"]}, {"dir": "SHORT", "fills": [{"fillId": "x34-0", "kind": "entry", "price": "41776.11", "qty": "0.000001"}, {"fillId": "x34-1", "kind": "close", "price": "506057.03", "qty": "0.000001"}], "grossMicroPerEvent": ["0", "-464281"]}, {"dir": "SHORT", "fills": [{"fillId": "x35-0", "kind": "entry", "price": "0.000078890922", "qty": "0.1"}, {"fillId": "x35-1", "kind": "add", "price": "0.000062382921", "qty": "0.01"}, {"fillId": "x35-2", "kind": "add", "price": "456.7299", "qty": "0.04408143"}, {"fillId": "x35-3", "kind": "add", "price": "90959.498", "qty": "0.000002"}, {"fillId": "x35-4", "kind": "reduce", "price": "1.36686", "qty": "0.030816686"}, {"fillId": "x35-5", "kind": "reduce", "price": "0.000082523162", "qty": "0.0246533488"}, {"fillId": "x35-6", "kind": "reduce", "price": "58240.63", "qty": "0.03944535808"}, {"fillId": "x35-7", "kind": "close", "price": "0.605177", "qty": "0.05916803712"}], "grossMicroPerEvent": ["0", "0", "0", "0", "4020925", "3250436", "-2292121805", "7765243"]}, {"dir": "LONG", "fills": [{"fillId": "x36-0", "kind": "entry", "price": "0.880092", "qty": "0.000333264833"}, {"fillId": "x36-1", "kind": "reduce", "price": "53755.69", "qty": "0.000266611866"}, {"fillId": "x36-2", "kind": "close", "price": "0.000092329479", "qty": "0.000066652967"}], "grossMicroPerEvent": ["0", "14331670", "-59"]}, {"dir": "SHORT", "fills": [{"fillId": "x37-0", "kind": "entry", "price": "0.06158579", "qty": "0.03200018"}, {"fillId": "x37-1", "kind": "close", "price": "62953.74", "qty": "0.03200018"}], "grossMicroPerEvent": ["0", "-2014529041"]}, {"dir": "SHORT", "fills": [{"fillId": "x38-0", "kind": "entry", "price": "0.000007937081", "qty": "2.5"}, {"fillId": "x38-1", "kind": "add", "price": "1.635054", "qty": "0.000715644048"}, {"fillId": "x38-2", "kind": "add", "price": "1.223227", "qty": "0.000125318406"}, {"fillId": "x38-3", "kind": "close", "price": "0.059573", "qty": "2.500840962454"}], "grossMicroPerEvent": ["0", "0", "0", "-147639"]}, {"dir": "LONG", "fills": [{"fillId": "x39-0", "kind": "entry", "price": "1.605243", "qty": "0.00806692"}, {"fillId": "x39-1", "kind": "add", "price": "91394.06", "qty": "0.000075"}, {"fillId": "x39-2", "kind": "add", "price": "0.07072", "qty": "0.000630232933"}, {"fillId": "x39-3", "kind": "add", "price": "0.03159753", "qty": "3099237"}, {"fillId": "x39-4", "kind": "close", "price": "73404.848", "qty": "3099237.008772152933"}], "grossMicroPerEvent": ["0", "0", "0", "0", "227498923609792920"]}];
const LIVE_HMAC_VECTORS = [{"key": "bhnaGj7MxJu-2tFY8Wtu1mz2S한sPldTzQO2SRIk_NElPZ7bFH8QEpQZW-tS", "v": 1, "ts": 1755697691726, "nonce": "3d32itd3cs6_bijgqwcq8xvf6x_e", "body": {"list": null, "tp1": {"z": "Z/0글 Y글é:Z.1", "tp1": false, "ok": "09: ccéé.0한한"}, "z": "💹X:c1:b한XcZ/", "ok": false, "n": {"sid": null, "symbolId": ":X-9é -aé09:"}}, "canonical": "{\"list\":null,\"n\":{\"sid\":null,\"symbolId\":\":X-9é -aé09:\"},\"ok\":false,\"tp1\":{\"ok\":\"09: ccéé.0한한\",\"tp1\":false,\"z\":\"Z/0글 Y글é:Z.1\"},\"z\":\"💹X:c1:b한XcZ/\"}", "sig": "10f3b2d6aacf93855789a6cbff6dc25042a57737a2654178496bef25d0e52155"}, {"key": "YYOIZDvfXTiKFR08YuLnKuE6mL한X6f13C6lcdoZgbchXb0TtCNvk", "v": 1, "ts": 1782694338145, "nonce": "oqda-n4mrqzu34ty3-l-wdhsokjnu", "body": {"note": ["0/éa9", 52], "stop": "/0XaaX9/a0한_"}, "canonical": "{\"note\":[\"0/éa9\",52],\"stop\":\"/0XaaX9/a0한_\"}", "sig": "1ce9c00971b24916dc9d2a86ab4c76884b5c22d81aba1b44fe8fe95fc23f401a"}, {"key": "JkAZF0ZiUr0Gnh842KvxShP0FZTYEeBU0t2jh3h9WAXoX1sT24RpRadmZ7r", "v": 1, "ts": 1763399528399, "nonce": "4snhnq1b9hngp4v_ix708c", "body": {"tp1": null, "z": "-.Y::/-éé_글글", "list": {"obj": false, "ok": 111426955451, "stop": true}, "entry": "Z/a-_한b0한9éY"}, "canonical": "{\"entry\":\"Z/a-_한b0한9éY\",\"list\":{\"obj\":false,\"ok\":111426955451,\"stop\":true},\"tp1\":null,\"z\":\"-.Y::/-éé_글글\"}", "sig": "4bbcee9c026e4a03c917eb3ff3c401f4c7f4691860f216fd85e9fa902dc8736a"}, {"key": "eZ3xRFQ89t856한hsl6EgSPpYr한JZCZcXVDSv8_hPNV1nDqUTn", "v": 1, "ts": 1771888668155, "nonce": "di0lqi4q-o67acxue2ng6-cwowa6o1kqiwms", "body": {"sid": {"obj": "c글a.Y_9-_한00", "stop": {"z": "1Z💹c💹💹ééb: :", "dir": true}, "dir": null}}, "canonical": "{\"sid\":{\"dir\":null,\"obj\":\"c글a.Y_9-_한00\",\"stop\":{\"dir\":true,\"z\":\"1Z💹c💹💹ééb: :\"}}}", "sig": "b004752551798b6d5c5815825c7ab5872615561fad56b3305977336ed975193b"}, {"key": "xZNZhv2AS8L8zf4vsGTbV8vTpuqqmxggIVPagZNWWja8L-KON7Ns0V", "v": 1, "ts": 1708668211674, "nonce": "gukpcyytd7lzf_p20zhcr", "body": {"obj": [":é💹bX", 26], "n": null, "stop": ["bb한00", 72]}, "canonical": "{\"n\":null,\"obj\":[\":é💹bX\",26],\"stop\":[\"bb한00\",72]}", "sig": "2dadd3a6ef072cb9d050293924fb16143210ecd1c078bc9badf1849a7941fb95"}, {"key": "g5Z69Jzxc2oZaetdp7sIJRdU05AmK8xHPXTf7jRBbtt3YXVP6TeRi7RM5BryY", "v": 1, "ts": 1746893170489, "nonce": "cdo8ps9mj5nkc1oos08w2", "body": {"note": -854613786614, "list": ["90/./", 65], "tp1": ["é -b ", 58]}, "canonical": "{\"list\":[\"90/./\",65],\"note\":-854613786614,\"tp1\":[\"é -b \",58]}", "sig": "304e2ed694d9eb371e1c0d08a4f6984b1ce2137615f1f68c6c81301c0de8d289"}, {"key": "oZhMEIH1d2LdDxfeEvrpcSn0iosjIr_uRV9LaYNsW2EZYNJk05xOY-O92W0Lm72g", "v": 1, "ts": 1716581042287, "nonce": "5jkb50myyozc995tws8c_so-p517z5ckrqo5f", "body": {"entry": "b/9-c한91X Y1", "dir": null, "obj": 558941109918, "note": ":1-1-_Y1b_ac", "a": ":Xab💹éb::c1 "}, "canonical": "{\"a\":\":Xab💹éb::c1 \",\"dir\":null,\"entry\":\"b/9-c한91X Y1\",\"note\":\":1-1-_Y1b_ac\",\"obj\":558941109918}", "sig": "be2efce830726fb7add1d57a4ffa720a339c2cad413bd78a381830dfd23e4729"}, {"key": "j3NpBh2rXpSGOwPHSuvm한jbDxuMIzFOEmLlFM-XEtOdhYTk", "v": 1, "ts": 1736603686455, "nonce": "3_y6j-z4r_kgsm8ewetxnzxm9su", "body": {"note": -300648573853, "sid": {"entry": {"a": "XY-X__ Y::_-", "n": "💹한글c한b💹b.:b0", "stop": 815357666714, "B": 236653339590}, "ok": {"dir": true, "sid": 689419548487, "ok": -998732521287, "stop": "a-한_c한c한💹한b:", "tp1": -21853706994}, "list": "글💹💹1cba _c글한"}, "list": true}, "canonical": "{\"list\":true,\"note\":-300648573853,\"sid\":{\"entry\":{\"B\":236653339590,\"a\":\"XY-X__ Y::_-\",\"n\":\"💹한글c한b💹b.:b0\",\"stop\":815357666714},\"list\":\"글💹💹1cba _c글한\",\"ok\":{\"dir\":true,\"ok\":-998732521287,\"sid\":689419548487,\"stop\":\"a-한_c한c한💹한b:\",\"tp1\":-21853706994}}}", "sig": "ed10b47a34b3880ee6978cc0595def787ab3b2a9e3a5b794c957ee42a6b87e9c"}, {"key": "71Rr5OOnItx_FeeCt한cQDzG2Bd6sOprYkhmSpwqHE5Bs", "v": 1, "ts": 1773991395036, "nonce": "ics571rnu0h5rqd6", "body": {"entry": true, "B": "9Z_X__ 01Y é", "list": 22507878010, "tp1": null}, "canonical": "{\"B\":\"9Z_X__ 01Y é\",\"entry\":true,\"list\":22507878010,\"tp1\":null}", "sig": "8c66f6e1c62ff12b182ee052f42c879d64463f5a6fc39d4dea57d2a7dd61c38a"}, {"key": "lOuJ0Ih8ool2qum5MATH3QvE2HLbXM5DYjeJ-TFSUwto2", "v": 1, "ts": 1774853939590, "nonce": "9wwvgxmh9zqe6llacs3sp2-ix0x9m5o-50b4itwm", "body": {"tp1": "글_ Y글_c 0Y-:", "symbolId": {"n": false}, "a": ".글 .💹bb한ca.c"}, "canonical": "{\"a\":\".글 .💹bb한ca.c\",\"symbolId\":{\"n\":false},\"tp1\":\"글_ Y글_c 0Y-:\"}", "sig": "29f45bcc29910825a2bdb8c8f61245a47956871ec818dc35ae778aba7790fea0"}, {"key": "TRCXGd2Y-wWsNy9_BRkynSbK20HI1PH9SfQy9Ipz4J7afw", "v": 1, "ts": 1765452739994, "nonce": "yuh9aint914fadkhqvys_it8n", "body": {"a": ["éYZc_", 25]}, "canonical": "{\"a\":[\"éYZc_\",25]}", "sig": "5ac4cfa54f1ac90788e4617d8a49ce9e2636d58b8819e15438d02ad91ae7f191"}, {"key": "7LgdNnZLO2ye1OeDE8qFtZYJFnoF1WKdyojW4U한ddXtgEXOp6fN5B4E28iwU0IOx", "v": 1, "ts": 1796157256043, "nonce": "toe07l9wpdizdad8rzezdw91f4cyjfk-hl0thc", "body": {"B": 309832466894, "entry": "0é-c 9cYccY1", "z": {"n": true, "stop": 626597866416, "obj": "글9é💹💹00-XY_X"}, "stop": null, "ok": ["-글a:한", 48]}, "canonical": "{\"B\":309832466894,\"entry\":\"0é-c 9cYccY1\",\"ok\":[\"-글a:한\",48],\"stop\":null,\"z\":{\"n\":true,\"obj\":\"글9é💹💹00-XY_X\",\"stop\":626597866416}}", "sig": "4626ad2693e1e9a637ffd5108288c65e0f6db0604be4b681e6585d9de14c8f26"}, {"key": "fa1bYo5GvSnPeIOBUB_4fk1PjRTI_gg1gzmIRcCsycr6QmwS17nqF9BOsJ_6B", "v": 1, "ts": 1719958494897, "nonce": "l7q9_78grs2auldn2wqr7lp90", "body": {"symbolId": {"sid": "한bYXcéc: 한_b", "note": ["bZ_é글", 40], "tp1": "한c /Z: X0_한글"}, "tp1": {"stop": -599535658677, "ok": [" /1bé", 28], "tp1": "0-💹_.글Y Y:. "}, "note": {"sid": {"tp1": 790184925377, "stop": 732000727620, "ok": -638302354903, "z": "aZ é_Zé.é90글"}, "ok": ".글💹01:Y1cécb"}}, "canonical": "{\"note\":{\"ok\":\".글💹01:Y1cécb\",\"sid\":{\"ok\":-638302354903,\"stop\":732000727620,\"tp1\":790184925377,\"z\":\"aZ é_Zé.é90글\"}},\"symbolId\":{\"note\":[\"bZ_é글\",40],\"sid\":\"한bYXcéc: 한_b\",\"tp1\":\"한c /Z: X0_한글\"},\"tp1\":{\"ok\":[\" /1bé\",28],\"stop\":-599535658677,\"tp1\":\"0-💹_.글Y Y:. \"}}", "sig": "cb9bd73bc61a377144166a908160a7145d5a7312f6a739a22e78fb4d727fcc2c"}, {"key": "8sGgIA6Pt5EKuxeCwKnDjh한ovJqhn6rAfPyXB-ODn한w9zhI7glZTjMdJ9SZ", "v": 1, "ts": 1700217218807, "nonce": "sf1axl0hlv2_suf7geaeqcrnze", "body": {"entry": -298639513650, "ok": " X한0Z글éé::1b", "tp1": {"dir": "한:Y글ZcaY글_-한", "symbolId": "bZ💹:Z.X0 b:.", "tp1": ":b1_한글0한💹/._", "z": -154074055096, "stop": -389367076087}, "stop": "💹.aé글11💹 1é:"}, "canonical": "{\"entry\":-298639513650,\"ok\":\" X한0Z글éé::1b\",\"stop\":\"💹.aé글11💹 1é:\",\"tp1\":{\"dir\":\"한:Y글ZcaY글_-한\",\"stop\":-389367076087,\"symbolId\":\"bZ💹:Z.X0 b:.\",\"tp1\":\":b1_한글0한💹/._\",\"z\":-154074055096}}", "sig": "7a402d0daaf9cbf748f9ef5208e7fd1f48aae9dc2de4369bd7274553d0c933b4"}, {"key": "Z_ZCXF7tHu3한wqdn7uGYP1AbG61F5eeyyoGeN93mEX57R2txWZ0g", "v": 1, "ts": 1725587030634, "nonce": "13ovkh2mbbc35g6ux3ezy3jho6vgkw6alupb9-jh", "body": {"list": ["9:Xé ", 0]}, "canonical": "{\"list\":[\"9:Xé \",0]}", "sig": "89084de93b07f8d7e8217a4575947ecc35748a3889a882a8aaff1bc13a5172a2"}, {"key": "KLskcO3tkTP9rA7cEZRd6p5gOQoRbRvpj", "v": 1, "ts": 1711796956631, "nonce": "5wgquvwbet5uth82", "body": {"ok": "-💹9Y991bZ_💹:", "n": true, "a": ["💹Z1b/", 55]}, "canonical": "{\"a\":[\"💹Z1b/\",55],\"n\":true,\"ok\":\"-💹9Y991bZ_💹:\"}", "sig": "cc81d2bc9b1ef4b061febc187e7e0949ca84ef765638cefeaf35ce986c434b6b"}, {"key": "Fu5IHYMYLz한uzR7jF_QUqKjEL한HTmoYL1rJxS6KEL-UH-SQGRZ", "v": 1, "ts": 1784431860355, "nonce": "g73c5n8-a4ummjyg8o175myuxnwv-e607fo3w", "body": {"sid": {"symbolId": ".💹/éaZ-/:é글-", "B": null, "sid": -1850041103}, "dir": -458162055838, "entry": null, "ok": null, "n": ["한__a/", 60]}, "canonical": "{\"dir\":-458162055838,\"entry\":null,\"n\":[\"한__a/\",60],\"ok\":null,\"sid\":{\"B\":null,\"sid\":-1850041103,\"symbolId\":\".💹/éaZ-/:é글-\"}}", "sig": "8b0ccbe41498a27fac07f6e12bfd86d18aa0fc967e18acef662b913f93a4ba70"}, {"key": "f7yc82TMks5Ow7YW91ZcVA_8bS38OK0GnLqhgtle19rW한ArtZjHFq4970UU83btg", "v": 1, "ts": 1737202485729, "nonce": "66xlz8xfskpne5j2", "body": {"z": true, "sid": ["0한ZZ9", 68], "tp1": "ca/Y.글1_::Ya"}, "canonical": "{\"sid\":[\"0한ZZ9\",68],\"tp1\":\"ca/Y.글1_::Ya\",\"z\":true}", "sig": "1a881a846713305d37b39ddb66fc9496688bedc4f40805fcf13352d8ac6e939f"}, {"key": "T5LVMR3vwzQ3uRQ한5hDSxk0ttvYSlvUEpMOKMEWLWYJ", "v": 1, "ts": 1749428299443, "nonce": "cp_tffmzzrs_arhcqzb0_jx-gaj5hqt5qm0__rr", "body": {"a": "1-a_b글_/-..é", "B": true}, "canonical": "{\"B\":true,\"a\":\"1-a_b글_/-..é\"}", "sig": "75df77c87eda8f4ea662d68d276c749d28da6de60141f26a06b7405a3762bd85"}, {"key": "JPmZ한7한_vCPLsSWvqtJy60msqXU-O4ZT-kjCjRMr4n8XN-vWhW", "v": 1, "ts": 1703602709148, "nonce": "ge-pcjne0saz3c-bssytu1v6omq9fvx00kj1_", "body": {"B": "0글é11글한b💹c91", "sid": [".-:💹é", 89], "n": {"note": -634817909536, "sid": "글XZéX/::./Zb", "z": null, "stop": "글글c_ 9.글b0-a"}}, "canonical": "{\"B\":\"0글é11글한b💹c91\",\"n\":{\"note\":-634817909536,\"sid\":\"글XZéX/::./Zb\",\"stop\":\"글글c_ 9.글b0-a\",\"z\":null},\"sid\":[\".-:💹é\",89]}", "sig": "ced8749e132f623abd51bedfa09caf7f5271c873afba508238a62719bc6c1b60"}, {"key": "3PYQWyRoFPvwZtUzg_85CvFfyAc4ntuT한tAeW5Ba4oNcR", "v": 1, "ts": 1754884578596, "nonce": "705__8hfwdyyaco9k80s7o6g1xt", "body": {"dir": true}, "canonical": "{\"dir\":true}", "sig": "481755f8cbb22966f12bc689a977e70fc8c7740fd6ddb618ab81c8a38cf3c992"}, {"key": "5MoWxIVuK9vF6f한b64Fe83-bOLbSAv한yP7MwxywlBtPbat7iW", "v": 1, "ts": 1710775107152, "nonce": "pc6pez1fp31jn29pla1g", "body": {"entry": ["X-b9:", 21], "stop": {"tp1": 684875500062, "a": -393700087970, "stop": "💹c99111글 b💹.", "entry": null}, "sid": null, "list": "c__ba10--b0💹"}, "canonical": "{\"entry\":[\"X-b9:\",21],\"list\":\"c__ba10--b0💹\",\"sid\":null,\"stop\":{\"a\":-393700087970,\"entry\":null,\"stop\":\"💹c99111글 b💹.\",\"tp1\":684875500062}}", "sig": "f870b2223d09cba89404c2650ea8d528a5e83d4b90f31fb97463fa68469593b9"}, {"key": "0N-BFkTiU1zqd2jFuFXOijY_n-Wzna6lPmfz", "v": 1, "ts": 1763820370261, "nonce": "7znjqr1w0rzqfdj88wt98o0rxxa7hghd", "body": {"dir": true, "n": ["_Y9한c", 84], "z": {"obj": false, "B": {"symbolId": false, "note": 801206042204, "B": false, "obj": -989705479539}, "z": ["./💹.:", 69], "stop": ["ZY💹01", 86]}, "sid": false}, "canonical": "{\"dir\":true,\"n\":[\"_Y9한c\",84],\"sid\":false,\"z\":{\"B\":{\"B\":false,\"note\":801206042204,\"obj\":-989705479539,\"symbolId\":false},\"obj\":false,\"stop\":[\"ZY💹01\",86],\"z\":[\"./💹.:\",69]}}", "sig": "1e6ae00ca5fa8a031e33c26cfd1f0223da84a79000ea4e77862e4145f30b260c"}, {"key": "g5fbiG5qdNx0sg6jTbaBF3KXLAn한fyKBoi39Y2_Tx9sT-QiG_fL", "v": 1, "ts": 1798630258215, "nonce": "zcwm0bfbx3ukc6d76jnlan6_n6skwg", "body": {"list": {"obj": "글Y_./-9Yacb "}, "ok": "./:한/0한YX19X"}, "canonical": "{\"list\":{\"obj\":\"글Y_./-9Yacb \"},\"ok\":\"./:한/0한YX19X\"}", "sig": "97e29d5604e40f444860a8ea148069cc81c527facd373dbe5bbb33a7639cd62d"}, {"key": "QT3FCel3CWPcLEKOVlxe_LSLFpPnSALl1y6eVKCsoCD4WRXCXL", "v": 1, "ts": 1719375493150, "nonce": "xb2zekv_so06-sxmpcynd_udgfpbd5gj_", "body": {"note": "ZY 1한/Z/0한Y-", "tp1": {"z": null, "sid": 668121960995, "ok": true, "obj": "a글aaY한Z//1/-"}, "entry": {"list": null}, "n": null}, "canonical": "{\"entry\":{\"list\":null},\"n\":null,\"note\":\"ZY 1한/Z/0한Y-\",\"tp1\":{\"obj\":\"a글aaY한Z//1/-\",\"ok\":true,\"sid\":668121960995,\"z\":null}}", "sig": "a12073c14bc7d5f64a0f5b49ccc7ef67a9adebe755bb94bf9fe3d52fc51648fa"}, {"key": "KFzuq8lsF4UXyBbUtap6ZYJgDwHdHfGIgYGIxUfEdITGfO한VL3rZfdwmMe7d1", "v": 1, "ts": 1717013998194, "nonce": "qnlssfxtwcd4brc8i5c7deb2m5b", "body": {"a": "글bXab 0éY한:é", "symbolId": -779033932580}, "canonical": "{\"a\":\"글bXab 0éY한:é\",\"symbolId\":-779033932580}", "sig": "69082ecdc0709d6dc1d7339876267a5146a0aa77a4e324e040730ead7e99a553"}, {"key": "Qyu1EHK한1ll-aghYn6vNPdrlS13CM_cSaJ1HzUVoPaodtb6iR6", "v": 1, "ts": 1787232966293, "nonce": "1txu7do1qm7qy5w0jcpj_jln01hehp", "body": {"B": ["//한0/", 92], "list": ["Z/..글", 91], "sid": null}, "canonical": "{\"B\":[\"//한0/\",92],\"list\":[\"Z/..글\",91],\"sid\":null}", "sig": "81b6dc3bc7f5c8dee60e4fc4a55406d9e9906cd9837e7c52d7fd95ef4ad90ea9"}, {"key": "Jp5Zc7OMf9P61Qmt67MJuizqM6ysGX0lv_", "v": 1, "ts": 1766542127405, "nonce": "qb5gm7kkt5au6jdg5dkn3", "body": {"obj": null, "note": false, "a": ["1: -_", 89], "tp1": false}, "canonical": "{\"a\":[\"1: -_\",89],\"note\":false,\"obj\":null,\"tp1\":false}", "sig": "b548f00fcf36f5e8c2e9b6ea6a7b2e5a5ae4a68255149e92f8e218180a5aafe6"}, {"key": "FE9sm6m_rwt한s0Bl6CuGzGBqYK한PLzd한FIBSI18", "v": 1, "ts": 1741905771333, "nonce": "4p4x0-l_k21323jyet6a57g", "body": {"note": ["-/1글1", 96], "list": null, "z": "💹__/💹0/Yab  "}, "canonical": "{\"list\":null,\"note\":[\"-/1글1\",96],\"z\":\"💹__/💹0/Yab  \"}", "sig": "6ce6a99518a386816f275240d85e78d9e8c697e7a08a9dfaf75d45bb70336bd0"}, {"key": "40NOwx5RgkaQJBOM5Be8hP7oit2l한E32CW9mxvj4IDrqyEc6g", "v": 1, "ts": 1724906538128, "nonce": "zq733kqo0xmkkj439s-0yswj72m", "body": {"symbolId": null}, "canonical": "{\"symbolId\":null}", "sig": "823ce17735a74eb374c4ef7ed9b989555ba0b802c949c7fc2af6eb642b8e8401"}];

// ── liveverify.mjs ──
// 실제 Apps Script·Google Sheets·Drive 에서 돌리는 자동 검증(테스트 환경 전용). 같은 코드를 Node(가짜 포트)와 Apps Script(실제 포트)가 쓴다.
//  env 포트: { now():ms, hmacSha256(key,msg):hex, sha256(s):hex, tz():string, formatKst(ms):'yyyy-MM-dd HH:mm', selfTest():deploySelfTest 결과,
//             newScratch(label):{ se, id }  (임시 스프레드시트 + 저장소 env, 환경 표식 test), scratchDrive(): 백업 포트(임시 폴더), realBackup(): backupRun 에 넘길 env(테스트 시트·실제 백업 폴더),
//             tamper(id): 임시 복사본의 체결 셀 하나를 바꾼다, httpCount():이 하니스 어댑터의 외부 호출 누계 }
//  결과 항목: { id, status:'PASS'|'FAIL'|'WARN'|'SKIP', text, ms? } — 텍스트에는 금액·ID·토큰·이메일 없이 개수·시간·판정만 담는다.
//  원칙: 운영 데이터가 없는 테스트 환경에서만 쓰며, 임시 시트·폴더 안에서만 쓰기/삭제(휴지통 이동)를 한다. 시험 결과를 확인하기 전에는 아무것도 지우지 않는다(임시 시트는 남김).

const LIVE_THRESH = Object.freeze({ ledgerPassMs: 3000, ledgerWarnMs: 10000, renderPassMs: 5000, writeP50Ms: 1000, writeP90Ms: 2500, read5kPassMs: 6000, read5kWarnMs: 20000, backupPassMs: 30000 });
const LIVE_SHA_VECTORS = Object.freeze([['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'], ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'], ['한글🙂', 'dfe2c239b4dd154b386d368f1a32320bf4d637035d973e943c9b7b3b790aa047']]);

// ── 순수 JS SHA-256(UTF-8): 시험 데이터를 메모리에서 빠르게 만들기 위한 것(운영 경로는 Utilities 사용). 벡터로 검증한다. ──
function liveUtf8(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.codePointAt(i); if (c > 0xffff) i++;
    if (c < 0x80) out.push(c); else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
const LIVE_K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
function liveSha256(str) {
  const b = liveUtf8(str), l = b.length * 8; b.push(0x80); while (b.length % 64 !== 56) b.push(0);
  const hi = Math.floor(l / 4294967296), lo = l >>> 0; for (const v of [hi, lo]) b.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  let h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const w = new Array(64), rr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < b.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = ((b[o + 4 * i] << 24) | (b[o + 4 * i + 1] << 16) | (b[o + 4 * i + 2] << 8) | b[o + 4 * i + 3]) >>> 0;
    for (let i = 16; i < 64; i++) { const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0; }
    let [a, bb, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25), ch = (e & f) ^ (~e & g), t1 = (hh + S1 + ch + LIVE_K[i] + w[i]) >>> 0, S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22), mj = (a & bb) ^ (a & c) ^ (bb & c), t2 = (S0 + mj) >>> 0; hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0; }
    h = [h[0] + a, h[1] + bb, h[2] + c, h[3] + d, h[4] + e, h[5] + f, h[6] + g, h[7] + hh].map(x => x >>> 0);
  }
  return h.map(x => x.toString(16).padStart(8, '0')).join('');
}

// ── 메모리 저장소(시험 데이터 생성용). 시트 접근이 없어 빠르다. ──
function liveMemStore(now0 = 1790000000000) {
  const sheets = new Map(); let t = now0, held = false;
  const env = { now: () => (t += 1000), sha256: liveSha256, lockTimeoutMs: 1, lock: { tryLock: () => { if (held) return false; held = true; return true; }, release: () => { held = false; } },
    sheets: { ensure(n) { if (!sheets.has(n)) sheets.set(n, []); }, rows: n => sheets.get(n).map(r => [...r]), append(n, rows) { for (const r of rows) sheets.get(n).push(r.map(String)); } } };
  return { env, sheets };
}
// 결정적 데이터: 하루에 신호 A/B 각 1건 + 체결 4건 + 복기·평가액을 쌓아 감사 로그가 target 행에 이를 때까지.
//  store API 로 한 건씩 저장하면 쓸 때마다 전체를 읽어 O(n²)이라 느리므로, 같은 형식(감사 해시 체인 + 엔티티 행)을 직접 만든다. 결과는 storeIntegrityCheck 로 검증된다.
function liveDataset(targetAudit, { startDay = '2026-01-01', sha = liveSha256 } = {}) {
  const m = liveMemStore(), se = m.env; storeInit(se); const ZERO = '0'.repeat(64);
  let seq = 0, prev = ZERO, t = 1790000000000, n = 0, seed = 7; const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const add = (entity, raw) => {
    const E = ENTITIES[entity], d = E.normalize(raw), key = E.keyOf(d), after = dedupeCanonical(d); seq++; t += 1000;
    const hash = sha([prev, seq, t, entity, key, 1, 'create', 'live', after].join('|'));
    m.sheets.get('Audit').push([String(seq), String(t), entity, key, '1', 'create', 'live', '', '', after, prev, hash]); prev = hash;
    m.sheets.get(E.sheet).push([key, '1', '0', String(t), after, ...E.display(d)]);
  };
  add('challenge', { startEquity: '300', startDay }); add('rate', { from: startDay, rate: '0.05' }); let day = startDay;
  while (seq < targetAudit) {
    const ds = dayStartMs(day);
    for (const [k, strat, dir] of [[0, 'A', 'LONG'], [1, 'B', 'SHORT']]) {
      const sid = `LD${n++}`, at = ds + (9 + k * 4) * 3600000, e = 100 + Math.floor(rnd() * 50), x = dir === 'LONG' ? e + 2 : e - 2;
      add('signal', { sid, strategy: strat, symbolId: 'BTCUSDT', dir, signalAt: at - 600000, entry: String(e), stop: String(e - 2), tp1: String(e + 3) }); add('response', { sid, choice: 'entered', at: at - 300000 });
      const fl = { origin: 'real', sid, dir, qty: '1', fee: { state: 'entered', amount: '0.05' }, funding: { state: 'entered', amount: '0' } };
      add('fill', { ...fl, fillId: `${sid}i`, kind: 'entry', at, price: String(e) }); add('fill', { ...fl, fillId: `${sid}o`, kind: 'close', at: at + 3600000, price: String(x) });
      if (rnd() < 0.5) add('review', { sid, plan: 'plan_ok', mind: 'calm', savedAt: at + 7200000 });
    }
    add('equity', { day, equity: '300' }); day = addDays(day, 1);
  }
  return { se, sheets: m.sheets, lastDay: addDays(day, -1), audit: seq };
}
function liveInputs1y() {                                  // 365일 × 9체결 = 3,285체결(장부 계산 시간 측정용, 저장소 없음)
  const fills = [], start = '2026-01-01', ds = dayStartMs(start);
  for (let d = 0; d < 365; d++) for (let k = 0; k < 3; k++) { const sid = `Y${d}-${k}`, at = ds + d * 86400000 + (k + 1) * 3 * 3600000, fl = { origin: 'real', sid, dir: 'LONG', fee: { state: 'entered', amount: '0.04' }, funding: { state: 'missing' } };
    fills.push({ ...fl, fillId: `${sid}a`, kind: 'entry', at, price: '100', qty: '1' }, { ...fl, fillId: `${sid}b`, kind: 'add', at: at + 600000, price: '101', qty: '1' }, { ...fl, fillId: `${sid}c`, kind: 'close', at: at + 3600000, price: '103', qty: '2' }); }
  return { inputs: { challenge: { startEquity: '300', startDay: start, rateSchedule: [{ from: start, rate: '0.05' }] }, fills, cashflows: [], equityInputs: [], adjustments: [], openingPositions: [] }, throughDay: addDays(start, 364), count: fills.length };
}

const liveItem = (id, status, text, ms) => ({ id, status, text, ...(ms === undefined ? {} : { ms }) });
const liveMs = (env, fn) => { const t0 = env.now(); const r = fn(); return { r, ms: env.now() - t0 }; };
const livePct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
function liveBigIntExtras() {
  const ok = [BigInt(2) ** BigInt(200) % BigInt(1000003) === BigInt(973692), -BigInt(7) / BigInt(2) === -BigInt(3), -BigInt(7) % BigInt(2) === -BigInt(1), (BigInt(1) << BigInt(64)) - BigInt(1) === BigInt("18446744073709551615"), BigInt('123456789012345678901234567890') * BigInt(10) === BigInt("1234567890123456789012345678900"), typeof BigInt === 'function'];
  return ok.every(Boolean);
}

// ── A 호환성 ──
function liveCompat(env) {
  const items = [];
  const t0 = env.now(); let bad = 0, total = 0;
  for (const v of LIVE_DEC_VECTORS) { total += 3; const a = dec(v.a), b = dec(v.b); if (String(decMul(a, b)) !== v.mul) bad++; if (String(decDiv(a, b)) !== v.div) bad++; if (String(decToMicro(a)) !== v.micro) bad++; }
  const ideal = compoundIdealSeries({ startMicro: BigInt(300000000), startDay: '2026-01-01', schedule: [{ from: '2026-01-01', rate: '0.05' }], throughDay: addDays('2026-01-01', 364) });
  for (const [n, micro] of LIVE_IDEAL_VECTORS) { total++; if (String(ideal[n].idealMicro) !== micro) bad++; }
  let events = 0;
  LIVE_PNL_VECTORS.forEach((o, i) => { const fills = o.fills.map((f, k) => ({ origin: 'real', sid: `P${i}`, dir: o.dir, at: Date.UTC(2026, 9, 24) + k * 1000, fee: { state: 'entered', amount: '0' }, funding: { state: 'entered', amount: '0' }, ...f })), t = pnlComputeTrade(fills); t.events.forEach((e, k) => { total++; events++; if (String(e.grossMicro) !== o.grossMicroPerEvent[k]) bad++; }); });
  const ext = liveBigIntExtras(); if (!ext) bad++; total++;
  items.push(liveItem('A1', bad === 0 ? 'PASS' : 'FAIL', `BigInt·고정소수점·복리·손익 벡터 ${total - bad}/${total} 일치(손익 ${LIVE_PNL_VECTORS.length}건·${events}체결)`, env.now() - t0));
  let hb = 0; for (const v of LIVE_HMAC_VECTORS) { const signed = `${v.v}.${v.ts}.${v.nonce}.${v.canonical}`; if (authCanonicalBody(v.body) !== v.canonical || env.hmacSha256(v.key, signed) !== v.sig) hb++; }
  let sb = 0; for (const [s, h] of LIVE_SHA_VECTORS) if (env.sha256(s) !== h || liveSha256(s) !== h) sb++;
  items.push(liveItem('A2', hb === 0 && sb === 0 ? 'PASS' : 'FAIL', `HMAC(한글·이모지) ${LIVE_HMAC_VECTORS.length - hb}/${LIVE_HMAC_VECTORS.length}, SHA-256 ${3 - sb}/3 일치`));
  const before = dayStartMs('2026-10-25') - 60000, at0 = dayStartMs('2026-10-25');
  const tzOk = env.tz() === 'Asia/Seoul', f1 = env.formatKst(before), f2 = env.formatKst(at0), kstOk = kstDayOf(before) === '2026-10-24' && kstDayOf(at0) === '2026-10-25' && f1 === '2026-10-24 23:59' && f2 === '2026-10-25 00:00';
  items.push(liveItem('A3', tzOk && kstOk ? 'PASS' : 'FAIL', `프로젝트 시간대 ${tzOk ? 'Asia/Seoul' : '다름'}, KST 날짜 경계 ${kstOk ? '일치' : '불일치'}`));
  const st = env.selfTest(); items.push(liveItem('A4', st.fail === 0 ? (st.warn ? 'WARN' : 'PASS') : 'FAIL', `자가 점검 실패 ${st.fail} · 경고 ${st.warn}${st.fail ? ` (${st.items.filter(i => i.level === 'fail').map(i => i.id).join(', ')})` : ''}`));
  return items;
}

// ── B 엔진 계산 시간 ──
function liveEngine(env) {
  const items = [], w = liveInputs1y(), { r, ms } = liveMs(env, () => ledgerBuildDaily({ ...w.inputs, throughDay: w.throughDay }));
  items.push(liveItem('B1', r.rows.length === 365 ? (ms <= LIVE_THRESH.ledgerPassMs ? 'PASS' : ms <= LIVE_THRESH.ledgerWarnMs ? 'WARN' : 'FAIL') : 'FAIL', `1년 ${w.count}체결 장부 계산 ${ms}ms (기준 ≤${LIVE_THRESH.ledgerPassMs}ms${ms > LIVE_THRESH.ledgerPassMs ? ', 초과 시 R3 읽기 최적화 검토' : ''})`, ms));
  const d = liveDataset(2000), m = liveMs(env, () => journalRenderHtml(journalBuild({ now: () => dayStartMs(d.lastDay) + 20 * 3600000, storeEnv: () => d.se }, { now: dayStartMs(d.lastDay) + 20 * 3600000 })));
  items.push(liveItem('B2', m.ms <= LIVE_THRESH.renderPassMs ? 'PASS' : 'WARN', `일지 모델+렌더(감사 ${d.audit}행) ${m.ms}ms, HTML ${Math.round(m.r.length / 1024)}KB (기준 ≤${LIVE_THRESH.renderPassMs}ms)`, m.ms));
  return items;
}

function liveDump(src, dstSe) {                            // 메모리 저장소 → 실제 시트(일괄 쓰기)
  for (const [name, rows] of src.sheets) { if (name === 'Meta') continue; for (let i = 0; i < rows.length; i += 800) dstSe.sheets.append(name, rows.slice(i, i + 800)); }
}
// ── C 실제 Google Sheets 저장·읽기(두 구간으로 나눠 실행: 각각 Apps Script 실행 시간 한도 안에 끝나도록) ──
function liveSheetsIo(env) {
  const items = [], scr = env.newScratch('io'), A = { actor: 'live' }, times = [];
  for (let i = 0; i < 100; i++) { const t0 = env.now(); storeCreate(scr.se, 'cashflow', { cfId: `lv-${i}`, at: 1790000000000 + i, amount: '1' }, A); times.push(env.now() - t0); }
  const p50 = livePct(times, 0.5), p90 = livePct(times, 0.9);
  items.push(liveItem('C1', p50 <= LIVE_THRESH.writeP50Ms && p90 <= LIVE_THRESH.writeP90Ms ? 'PASS' : p90 <= LIVE_THRESH.writeP90Ms * 2 ? 'WARN' : 'FAIL', `저장 100회 건당 p50 ${p50}ms · p90 ${p90}ms · 최대 ${Math.max(...times)}ms (기준 p50 ≤${LIVE_THRESH.writeP50Ms}, p90 ≤${LIVE_THRESH.writeP90Ms})`, p50));
  const dup = storeCreate(scr.se, 'cashflow', { cfId: 'lv-0', at: 1790000000000, amount: '1' }, A), con = storeCreate(scr.se, 'cashflow', { cfId: 'lv-0', at: 1790000000000, amount: '2' }, A);
  items.push(liveItem('C4', dup.status === 'duplicate' && con.status === 'conflict' && storeList(scr.se, 'cashflow').length === 100 ? 'PASS' : 'FAIL', `같은 키 재저장 ${dup.status}, 다른 내용 ${con.status}, 기록 ${storeList(scr.se, 'cashflow').length}건`));
  return items;
}
function liveSheetsRead(env) {
  const items = [], A = { actor: 'live' }, reads = [], bigWrites = []; let integOk = true, integIssues = 0, coerceOk = true;
  for (const target of [500, 2000, 5000]) {
    const d = liveDataset(target), s2 = env.newScratch(`read${target}`); liveDump(d, s2.se);
    const t0 = env.now(); const inp = storeLoadLedgerInputs(s2.se); const led = ledgerBuildDaily({ ...inp, throughDay: d.lastDay }); const ms = env.now() - t0;
    reads.push({ audit: d.audit, ms, days: led.rows.length });
    if (target === 5000) { const ic = storeIntegrityCheck(s2.se); integOk = ic.ok; integIssues = ic.issues.length; coerceOk = ic.issues.every(i => i.type !== 'tampered-view'); for (let i = 0; i < 5; i++) { const w0 = env.now(); storeCreate(s2.se, 'cashflow', { cfId: `big-${i}`, at: 1790000000000 + i, amount: '1' }, A); bigWrites.push(env.now() - w0); } }
  }
  const r5 = reads[2];
  items.push(liveItem('C2', r5.ms <= LIVE_THRESH.read5kPassMs ? 'PASS' : r5.ms <= LIVE_THRESH.read5kWarnMs ? 'WARN' : 'FAIL', `전체 읽기+장부(감사 ${reads.map(r => r.audit).join('/')}행) ${reads.map(r => r.ms + 'ms').join(' / ')} (기준 5천행 ≤${LIVE_THRESH.read5kPassMs}ms${r5.ms > LIVE_THRESH.read5kPassMs ? ', 초과 시 R3 읽기 최적화 필요' : ''})`, r5.ms));
  const w50 = livePct(bigWrites, 0.5); items.push(liveItem('C5', w50 <= 5000 ? 'PASS' : w50 <= 15000 ? 'WARN' : 'FAIL', `감사 ${r5.audit}행에서 저장 1건 p50 ${w50}ms · 최대 ${Math.max(...bigWrites)}ms (쓸 때마다 시트를 읽는 R3 구조의 확장 한계 확인, 기준 ≤5000ms${w50 > 5000 ? ' — 초과 시 R3 최적화 필요' : ''})`, w50));
  items.push(liveItem('C3', integOk && coerceOk ? 'PASS' : 'FAIL', `텍스트 서식 보존·무결성(5천행 왕복) ${integOk ? 'OK' : `문제 ${integIssues}건`}`));
  return items;
}
const liveSheets = env => [...liveSheetsIo(env), ...liveSheetsRead(env)];

// ── G 백업·복원 리허설 ──
function liveBackup(env) {
  const items = [], A = { actor: 'live' }, DAY = 86400000;
  let g1;
  for (let k = 0; k < 4; k++) {                                // 폴링 등 다른 실행이 락을 잡고 있으면 잠시 뒤 다시 시도(최대 4회)
    try { const { r, ms } = liveMs(env, () => backupRun(env.realBackup(), { now: env.now() })); g1 = { r, ms }; break; } catch (e) { g1 = { err: String(e && e.code ? e.code : e && e.message ? e.message : e).slice(0, 60) }; if (!(e && e.code === 'LOCK')) break; if (typeof env.sleep === 'function') env.sleep(3000); }
  }
  items.push(g1.err ? liveItem('G1', 'FAIL', `테스트 시트 백업 실패: ${g1.err} (drive.file 권한 확인 필요)`) : liveItem('G1', ['ok', 'exists'].includes(g1.r.status) ? (g1.ms <= LIVE_THRESH.backupPassMs ? 'PASS' : 'WARN') : 'FAIL', `테스트 시트 백업 ${g1.r.status} ${g1.ms}ms${g1.r.verified ? ' · 사본 검증 통과' : ''}`, g1.ms));
  const scr = env.newScratch('backup'), d = liveDataset(200); liveDump(d, scr.se); deployMarkEnv(scr.se, 'test'); storeCreate(scr.se, 'setting', { name: 'backupKeep', value: '2' }, A);
  const benv = { sourceId: scr.id, storeEnv: () => scr.se, drive: env.scratchDrive() }, t1 = env.now(); let runs = [];
  try { for (let i = 0; i < 3; i++) runs.push(backupRun(benv, { now: t1 + i * 7 * DAY })); } catch (e) { runs.push({ status: `error:${String(e && e.code || e && e.message).slice(0, 40)}` }); }
  const list = benv.drive.list(benv.drive.ensureFolder()), trashed = runs.reduce((a, r) => a + (r.trashed ? r.trashed.length : 0), 0);
  items.push(liveItem('G2', runs.length === 3 && runs.every(r => r.status === 'ok') && list.length === 2 && trashed === 1 ? 'PASS' : 'FAIL', `연속 3회 백업 후 보관 ${list.length}개(기준 2), 휴지통 이동 ${trashed}건, 상태 ${runs.map(r => r.status).join('/')}`));
  items.push(liveItem('G3', runs.length === 3 && runs.every(r => r.status === 'ok') ? 'PASS' : 'FAIL', `사본 생성·휴지통 이동 권한 ${runs.every(r => r.status === 'ok') ? '정상' : '실패(권한 범위 조정 필요)'}`));
  const live0 = JSON.stringify(backupFingerprint(scr.se)); let rest = null, g4;
  try { const latest = list.sort((a, b) => (a.name < b.name ? 1 : -1))[0]; rest = backupRestore(benv, latest.id, { now: t1 + 30 * DAY }); g4 = JSON.stringify(backupFingerprint(scr.se)) === live0 && storeIntegrityCheck(benv.drive.openStore(rest.id)).ok; } catch (e) { g4 = false; }
  items.push(liveItem('G4', g4 ? 'PASS' : 'FAIL', `복원은 새 사본으로 생성·검증, 원본 불변 ${g4 ? '확인' : '실패'}`));
  let g5 = false, g6 = false;
  if (rest) { env.tamper(rest.id); const ic = storeIntegrityCheck(benv.drive.openStore(rest.id)), sw = backupSwitchChecks(benv, rest.id, { expectEnv: 'test' }); g5 = !ic.ok && !sw.ok; g6 = backupSwitchChecks(benv, nullishOr(nullishOr(list.find(x => x.id !== rest.id), {}).id, rest.id), { expectEnv: 'prod' }).issues.includes('env-mismatch'); }
  items.push(liveItem('G5', g5 ? 'PASS' : 'FAIL', `임시 복원본 변조(셀 1개) ${g5 ? '무결성 실패로 탐지·전환 거부' : '탐지 실패'}`));
  items.push(liveItem('G6', g6 ? 'PASS' : 'FAIL', `환경 표식 불일치(test 시트를 prod 기대로 점검) ${g6 ? '거부' : '통과됨(위험)'}`));
  storeCreate(scr.se, 'setting', { name: 'backupTelegramCsv', value: 'on' }, A); const h0 = env.httpCount(); let g7;
  try { const r = backupRun(benv, { now: t1 + 40 * DAY }); g7 = r.warnings.includes('telegram-csv-unsupported') && env.httpCount() === h0; } catch (e_) { g7 = false; }
  items.push(liveItem('G7', g7 ? 'PASS' : 'FAIL', `Telegram CSV 설정을 켜도 전송 0건(경고만) ${g7 ? '확인' : '실패'}`));
  return items;
}
// 구간: 빠른 것(A·B)은 시작 즉시, 느린 것(C·G)은 백그라운드로 나눠 돌린다. 한 구간은 Apps Script 실행 한도(6분) 안에 끝나는 크기.
const LIVE_SECTIONS = Object.freeze([['A', liveCompat], ['B', liveEngine], ['C-io', liveSheetsIo], ['C-read', liveSheetsRead], ['G', liveBackup]]);
const LIVE_FAST_SECTIONS = Object.freeze(['A', 'B']);
const LIVE_SLOW_SECTIONS = Object.freeze(['C-io', 'C-read', 'G']);
function liveRunSection(name, env) { const f = LIVE_SECTIONS.find(([n]) => n === name); if (!f) throw new Error(`알 수 없는 구간: ${name}`); return f[1](env); }
function liveAutoAll(env) { return LIVE_SECTIONS.flatMap(([, f]) => f(env)); }

// ── exports ──
var RICH300_ENGINE = { nullishOr, DEC_DIGITS, decRoundDiv, dec, decAdd, decSub, decNeg, decAbs, decMul, decDiv, decCmp, decSign, decIsZero, decToMicro, microToDec, decFormat, microFormat, microToNumber, microFromNumber, isDayString, dayToIndex, indexToDay, kstDayOf, dayStartMs, dayEndMs, addDays, daysBetween, dayRange, rateFraction, compoundNextTarget, compoundRateOn, compoundIdealSeries, dedupeCanonical, dedupeSame, dedupeAppend, dedupePossibleFills, dedupeRevise, dedupeVoid, dedupeLatest, PNL_ENTRY_KINDS, PNL_EXIT_KINDS, pnlNormalizeFill, pnlComputeTrade, pnlComputeAll, pnlDailyFlows, pnlMicroToString, riskTrade, riskMicroLabel, SPLAN_NOTE, SPLAN, splanSign, splanDecimals, splanFloor, splanFloorTol, splanRound, splanMean, SPLAN_SPECS, splanSpec, splanWeights, splanStagePrices, splanExec, splanStopExec, splanWorstLoss, splanBuild, splanTry, splanTpLegs, splanStatus, splanCheckAdd, SPLAN_REASON_TEXT, splanReasonText, splanFmtNum, splanQty, splanLines, splanStatusLines, LEDGER_REVIEW_ABS_MICRO, LEDGER_REVIEW_PPM, ledgerBuildDaily, ledgerSummarize, ledgerMicroLabel, dashUsd, dashPct, DASH_DAILY_LIMIT, dashBuildModel, dashBuildFromStore, dashSampleInputs, dashSampleModel, dashEsc, DASH_PAGES, DASH_CSS, dashHead, dashNav, dashFooter, dashRenderError, dashRenderHtml, shellErrorCode, shellRenderError, shellRenderDenied, shellRenderHealth, shellRenderWatch, shellRenderTgDiag, SCHEMA_VERSION, StoreError, PLAN_CHOICES, MIND_CHOICES, RESPONSE_CHOICES, SETTING_DEFAULTS, schemaDecString, ENTITIES, ENTITY_NAMES, AUDIT_SHEET, VIEW_HEADERS, AUDIT_HEADERS, META_HEADERS, storeInit, storeReadAudit, storeReadAuditTail, storeReadView, storeGet, storeList, storeHistory, storeWithLock, storeCreate, storeRevise, storeVoid, storeClaimUpdate, storeSaveReview, storeSetupChallenge, storeGetSettings, storeIntegrityCheck, storeRepair, storeLoadLedgerInputs, storeBuildLedger, BACKUP_RE, BACKUP_MIN_KEEP, backupName, backupRestoredName, backupKeepFrom, backupRetention, backupFingerprint, backupRun, backupRestore, backupSwitchChecks, DEPLOY_ENVS, deployGate, deployMarkEnv, deployReadEnv, deployCheckEnv, deploySelfTest, AUTH_VERSION, AUTH_WINDOW_MS, AUTH_NONCE_TTL_SEC, AUTH_MAX_BYTES, AUTH_MIN_KEY_LEN, authTimingSafeEqual, authCanonicalBody, authSignedString, authBuildRequest, authVerify, INGEST_UNAUTHORIZED, ingestHandle, R9_LINE_RE, r9ParseSignal, r9StripLine, TG_MAX_ATTEMPTS, TG_MAX_WAIT_MS, TG_DRAFT_TTL_SEC, TG_PAIR_TTL_SEC, TG_PAIR_MAX_FAILS, TG_DUP_WINDOW_MS, TG_POISON_AFTER, TG_SID_RE, tgClassify, TG_BENIGN, tgCall, tgSendMessage, tgSendNotice, tgParseUpdate, tgParseCommand, TG_FUTURE_SLACK_MS, tgParseAt, tgPairCreate, tgPairedUser, tgPairPoll, tgResponseKeyboard, tgSignalText, tgFillLink, tgSendSignalPrompt, tgReviewKeyboard, tgReviewText, tgEquityNow, tgPlanOf, tgBuildEntry, tgBuildExit, tgSubmitFillForm, tgConfirmDraft, tgHandleUpdate, tgPoll, tgGc, WATCH, watchEma, watchTrend, watchVolRatio, watchOpenPositions, watchOkxInst, watchParseOkxBars, watchParseOkxTicker, watchParseBybitBars, watchParseBybitTicker, WATCH_BAR_MS, watchMarketUrls, watchParseSource, watchAssessMarket, watchEvaluate, watchMessage, watchTick, CLOSE_MAX_CATCHUP, CLOSE_MAX_ATTEMPTS, CLOSE_PENDING_STALE_MS, CLOSE_WARNING_TEXT, closeUsd, closeDiagnose, closeMessage, closeRetryNotices, closePlan, closeCommit, closeRun, closeTick, closeCheckEquityDay, closeSubmitEquity, closeStatus, AN_MIN_SAMPLE, AN_INSIGHT_MIN, anUsd, anRatio, anPct, anStats, AN_STRATEGY_NAME, anTradesFrom, anReviews, anBuild, JOURNAL_FILL_EDITABLE, JOURNAL_LIMIT, journalDiff, journalHistory, JOURNAL_SEARCH_LIMIT, journalBuild, journalReviseFill, journalVoidFill, journalAddCashflow, journalVoidCashflow, jvEsc, journalRenderError, JV_TABS, journalRenderHtml, SIGLOG_LIMIT, SIGLOG_FILTERS, siglogBuild, siglogRenderHtml, siglogRenderError, CHECK_STATUS_LABEL, checkSummary, checkFromSelfTest, checkPollItems, checkReportText, checkRenderHtml, checkRenderError, checkBotItems, LIVE_DEC_VECTORS, LIVE_IDEAL_VECTORS, LIVE_PNL_VECTORS, LIVE_HMAC_VECTORS, LIVE_THRESH, LIVE_SHA_VECTORS, liveSha256, liveMemStore, liveDataset, liveCompat, liveEngine, liveSheetsIo, liveSheetsRead, liveSheets, liveBackup, LIVE_SECTIONS, LIVE_FAST_SECTIONS, LIVE_SLOW_SECTIONS, liveRunSection, liveAutoAll };

// ── gas/Adapters.gs ──
/**
 * RICH 300 — Apps Script 어댑터: store.mjs 가 요구하는 env 포트(now/sha256/lock/sheets)를 SpreadsheetApp·LockService·Utilities 로 구현한다.
 * 엔진 번들(rich300/build.mjs 산출물)과 같은 프로젝트에 붙여 넣어 쓴다. 이 파일에는 비밀값이 없다(스프레드시트 ID는 호출자가 Script Properties 등에서 읽어 넘긴다).
 *  · 모든 시트 열은 *텍스트 서식('@')*으로 만든다: 그렇지 않으면 Sheets가 "2026-10-24"를 날짜로, "123"을 숫자로 바꿔 키·값이 손상된다.
 *  · 쓰기는 getRange().setValues() 일괄 쓰기 — 호출 하나가 한 번의 쓰기 단위다(store의 선기록 순서를 지키기 위함). flush 는 락을 풀기 직전에 한 번만 한다.
 */
function rich300Hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }

function rich300GasEnv_(spreadsheetId, opts) {
  var ss = SpreadsheetApp.openById(spreadsheetId), lock = LockService.getScriptLock();
  /*
   * 요청 안에서만 쓰는 읽기 캐시(다음 요청으로 넘어가지 않는다 — 실제 잔고·포지션·체결 상태에 오래된 값을 쓰지 않기 위함).
   *  · 같은 시트를 한 요청에서 여러 번 읽어도 Sheets 호출은 1번(rows). 같은 요청의 append 는 캐시에 바로 반영한다.
   *  · 스크립트 락을 새로 잡는 순간 모두 버린다: 락을 기다리는 사이 다른 실행이 쓴 행을 놓치면 안 된다.
   *  · ver[name] 은 시트가 바뀔 때마다 커진다(엔진이 파싱 결과 캐시를 무효화하는 기준).
   */
  var handles = {}, rowsMemo = {}, tailMemo = {}, lastRowMemo = {}, widthMemo = {}, ver = {}, bump = function (n) { ver[n] = (ver[n] || 0) + 1; };
  function sheet(name) { if (ver[name] === undefined) ver[name] = 0; if (!handles[name]) handles[name] = ss.getSheetByName(name); if (!handles[name]) throw new Error('시트 없음: ' + name); return handles[name]; }
  function lastRow(name) { if (lastRowMemo[name] === undefined) lastRowMemo[name] = sheet(name).getLastRow(); return lastRowMemo[name]; }
  function width(name) { if (!widthMemo[name]) widthMemo[name] = sheet(name).getLastColumn(); return widthMemo[name]; }
  function dropMemo() { rowsMemo = {}; tailMemo = {}; lastRowMemo = {}; Object.keys(ver).forEach(bump); }
  // 락을 잡은 직후: 모든 쓰기는 Audit 에 먼저 추가되므로 Audit 의 마지막 행 번호가 그대로면 아무도 쓰지 않은 것 → 읽어 둔 시트를 계속 쓴다. 달라졌거나 모르면 전부 버리고 다시 읽는다.
  function refreshAfterLock() {
    var known = lastRowMemo['Audit'];
    if (known !== undefined) { delete lastRowMemo['Audit']; if (lastRow('Audit') === known) return; }
    dropMemo();
  }
  var initCache = null;
  try { var sc = CacheService.getScriptCache(); initCache = { get: function (k) { return sc.get('i:' + spreadsheetId + ':' + k); }, put: function (k, v, ttl) { sc.put('i:' + spreadsheetId + ':' + k, v, ttl); }, remove: function (k) { sc.remove('i:' + spreadsheetId + ':' + k); } }; } catch (err) { initCache = null; }
  return {
    now: function () { return Date.now(); },
    lockTimeoutMs: (opts && opts.lockTimeoutMs) || 10000,
    sha256: function (s) { return rich300Hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); },
    lock: { tryLock: function (ms) { var ok = lock.tryLock(ms); if (ok) refreshAfterLock(); return ok; }, release: function () { try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); } } },   // 다음 실행이 방금 쓴 행을 보도록 락을 풀기 전 한 번만 반영(append 마다 flush 하지 않는다)
    initCache: initCache,
    sheets: {
      version: function (name) { return ver[name] || 0; },
      flush: function () { SpreadsheetApp.flush(); },
      ensure: function (name, headers) {
        var sh = ss.getSheetByName(name);
        if (!sh) {
          sh = ss.insertSheet(name);
          sh.getRange(1, 1, 1, headers.length).setNumberFormat('@').setValues([headers]);
          sh.setFrozenRows(1);
          handles[name] = sh; delete rowsMemo[name]; delete lastRowMemo[name]; bump(name);
          return;
        }
        handles[name] = sh;
        var cur = sh.getLastRow() >= 1 ? sh.getRange(1, 1, 1, headers.length).getValues()[0].map(String) : [];
        if (JSON.stringify(cur) !== JSON.stringify(headers)) throw new Error('헤더 불일치: ' + name);
      },
      rows: function (name) {
        if (!rowsMemo[name]) {      // getDataRange 한 번으로 머리글 포함 전체를 읽는다(행·열 수를 따로 묻는 호출을 줄임)
          var all = sheet(name).getDataRange().getValues();
          rowsMemo[name] = all.slice(1); lastRowMemo[name] = all.length; delete tailMemo[name];
        }
        return rowsMemo[name].slice();
      },
      tail: function (name, count) {        // 마지막 count 행만 읽는다(전체를 읽지 않음). 이미 읽어 둔 내용이 있으면 호출 없이 잘라 준다
        if (rowsMemo[name]) return rowsMemo[name].slice(-count);
        var m = tailMemo[name]; if (m && (m.count >= count || m.complete)) return m.rows.slice(-count);
        var n = lastRow(name), k = Math.min(Math.max(count, 5), Math.max(n - 1, 0)), got = n <= 1 ? [] : sheet(name).getRange(n - k + 1, 1, k, width(name)).getValues();
        tailMemo[name] = { count: Math.max(count, 5), rows: got, complete: k >= n - 1 }; return got.slice(-count);
      },
      append: function (name, rows) {
        if (!rows.length) return;
        var sh = sheet(name), start = lastRow(name) + 1, w = rows[0].length;
        if (start + rows.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), Math.max(rows.length, 100));
        sh.getRange(start, 1, rows.length, w).setNumberFormat('@').setValues(rows);
        lastRowMemo[name] = start + rows.length - 1;
        if (rowsMemo[name]) rows.forEach(function (r) { rowsMemo[name].push(r.map(String)); });
        if (tailMemo[name]) rows.forEach(function (r) { tailMemo[name].rows.push(r.map(String)); });
        bump(name);
      }
    }
  };
}

// ── gas/Api.gs ──
/**
 * RICH 300 — API 배포 진입점(R5, "나로 실행 / 누구나" 배포 전용). 엔진 번들(Engine) + Adapters.gs 와 같은 프로젝트에 둔다. 운영 배포는 S0 실측·승인 이후.
 *  · 인증: 본문 HMAC(rich300/lib/auth.mjs). 키는 Script Properties(RICH300_INGEST_KEY, 선택 RICH300_INGEST_KEY_PREV)에서만 읽는다. 코드·로그·응답에 키를 쓰지 않는다.
 *  · 스프레드시트 ID(RICH300_SHEET_ID)도 Script Properties. 시트는 인증이 통과한 뒤에만 연다.
 *  · nonce: CacheService(최선 노력, 만료·퇴출될 수 있음 — 재전송 신호는 sid 유일키로 어차피 중복 기록되지 않는다).
 *  · 이 파일은 로그를 출력하지 않는다(Logger/console 없음). GET 요청에는 접근 안내만.
 */
/**
 * GET 라우터: 소유자가 아니면 *접근 안내만*(데이터 없음. 예전의 빈 응답은 모바일에서 '계속 로딩'처럼 보였다 — 익명 GET에 정보를 주지 않는 원칙은 유지).
 *  ?p=fill (R4 모바일 입력 화면), ?p=dash (R6 대시보드)는 해당 PR이 페이지 함수를 정의했을 때만 동작하고, *소유자 이메일 확인이 통과해야* 한다.
 *  소유자 확인은 fail-closed: RICH300_OWNER_EMAIL 미설정이거나 방문자 이메일을 알 수 없으면(익명·"나로 실행" 배포의 타인) 거부한다.
 */
var RICH300_BUILD = '94ba6f14e5c1';                 // 번들 생성 때 내용 해시로 바뀐다(?p=health 에 표시 — 배포된 버전이 올린 버전인지 확인)
var RICH300_PAGES_ = { fill: 'rich300PageFill_', dash: 'rich300PageDash_', journal: 'rich300PageJournalTab_', stats: 'rich300PageStats_', assets: 'rich300PageAssets_', signals: 'rich300PageSignals_', check: 'rich300PageCheck_', health: 'rich300PageHealth_', watch: 'rich300PageWatch_', tg: 'rich300PageTg_' };
function rich300UiWho_() {                              // 'owner' | 'other'(이메일은 보이나 소유자 아님) | 'anon'(이메일 불명)
  try {
    var owner = String(PropertiesService.getScriptProperties().getProperty('RICH300_OWNER_EMAIL') || '').trim().toLowerCase();
    var me = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    if (!me) return 'anon';
    return owner.length > 3 && me === owner ? 'owner' : 'other';
  } catch (err) { return 'anon'; }
}
function rich300AppUrl_() { try { var u = ScriptApp.getService().getUrl(); return /^https:\/\/\S+\/exec$/.test(u) ? u : ''; } catch (err) { return ''; } }
function rich300IsOwner_() { return rich300UiWho_() === 'owner'; }
function rich300Ping_() {                              // 배포·본인 인증 진단: 값 없이 상태 단어만(이메일·ID 없음). 접근 제한(나만)이 걸려 있으면 소유자만 여기에 닿는다.
  var owner = String(PropertiesService.getScriptProperties().getProperty('RICH300_OWNER_EMAIL') || '').trim(), who = rich300UiWho_();
  var lines = ['RICH300 ping', 'reachable: yes', 'visitor-email: ' + (who === 'anon' ? 'hidden' : 'visible'), 'owner-setting: ' + (owner.length > 3 ? 'set' : 'unset'), 'owner-match: ' + (who === 'owner' ? 'yes' : who === 'other' ? 'no' : 'unknown'), 'verdict: ' + (who === 'owner' ? 'OK(소유자 확인됨)' : who === 'other' ? 'DENY(다른 계정)' : 'BLOCKED(이메일을 읽지 못함: 실행 계정·배포 설정 확인)')];
  return ContentService.createTextOutput(lines.join('\n')).setMimeType(ContentService.MimeType.TEXT);
}
function rich300Html_(html, title) { return HtmlService.createHtmlOutput(html).setTitle(title).addMetaTag('viewport', 'width=device-width, initial-scale=1'); }
/**
 * 무한 로딩·빈 화면 방지: 어떤 경우에도 *화면*을 돌려준다.
 *  · 소유자가 아니거나 이메일을 알 수 없으면 빈 응답 대신 접근 안내(데이터 없음). 소유자가 p 없이/모르는 p 로 열면 메인(dash).
 *  · 페이지 함수가 예외를 던지면 오류 코드와 '다시 시도' 버튼이 있는 화면. 처리 시간은 최근 기록(?p=health)에 남긴다.
 */
function doGet(e) {
  var t0 = Date.now(), name = e && e.parameter && e.parameter.p, page = 'dash', out;
  if (name === 'ping') return rich300Ping_();
  try {
    if (rich300UiWho_() !== 'owner') return rich300Html_(RICH300_ENGINE.shellRenderDenied({ appUrl: rich300AppUrl_() }), '접근 제한');
    page = name && Object.prototype.hasOwnProperty.call(RICH300_PAGES_, name) ? name : 'dash';
    var fn = globalThis[RICH300_PAGES_[page]];
    if (typeof fn !== 'function') throw new Error('page-missing');
    out = fn(e);
  } catch (err) {
    out = rich300Html_(RICH300_ENGINE.shellRenderError({ title: '화면', code: RICH300_ENGINE.shellErrorCode(err), appUrl: rich300AppUrl_(), page: page }), 'RICH300');
  }
  if (typeof rich300PerfRecord_ === 'function') rich300PerfRecord_(page, Date.now() - t0);
  return out;
}

function doPost(e) {
  var out;
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    out = RICH300_ENGINE.ingestHandle(rich300ApiEnv_(), raw);
  } catch (err) { out = { ok: false, error: 'server' }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function rich300ApiEnv_() {
  var props = PropertiesService.getScriptProperties(), cache = CacheService.getScriptCache(), store = null;
  return {
    now: function () { return Date.now(); },
    hmacSha256: function (key, message) { return rich300Hex_(Utilities.computeHmacSha256Signature(message, key)); },
    getKeys: function () { return [props.getProperty('RICH300_INGEST_KEY'), props.getProperty('RICH300_INGEST_KEY_PREV')].filter(function (k) { return k; }); },
    nonces: { has: function (n) { return cache.get('n:' + n) !== null; }, put: function (n, ttlSec) { cache.put('n:' + n, '1', ttlSec); } },
    counter: function (name) { var k = 'c:' + name, v = Number(cache.get(k) || 0) + 1; cache.put(k, String(v), 21600); },
    storeEnv: function () { if (!store) { store = rich300GasEnv_(props.getProperty('RICH300_SHEET_ID')); RICH300_ENGINE.storeInit(store); } return store; }
  };
}

// ── gas/Telegram.gs ──
/**
 * RICH 300 — Telegram 어댑터(R4). 엔진 번들 + Adapters.gs 와 같은 프로젝트에 둔다. 운영 배포·실제 Telegram 연결은 승인 이후.
 *  · 봇 토큰: Script Properties(RICH300_TG_TOKEN)에서만 읽고, 요청 URL을 만드는 http.call 안에서만 쓴다. 엔진(tg.mjs)은 토큰을 보지 못한다. 오류 메시지(URL 포함 가능)는 버리고 상태 코드만 돌려준다.
 *  · 폴링: 1분 시간 트리거로 rich300TgPoll 을 설치한다(rich300TgInstallPollTrigger). 웹훅은 쓰지 않는다(S0: POST 302·헤더 불가).
 *  · 상태 저장소(kv): Script Properties 의 'tg:' 접두 키(페어링된 사용자, 폴링 오프셋, 10분 체결 초안, 복기 프롬프트 표시).
 *  · 로그: 개수·코드만 남긴다(금액·ID·본문·토큰 없음).
 */
function rich300TgEnv_() {
  var props = PropertiesService.getScriptProperties(), store = null, P = 'tg:', envName = props.getProperty('RICH300_ENV');
  return {
    msgPrefix: envName === 'test' ? '[TEST] ' : '',                                           // 테스트 환경의 모든 메시지 앞에 [TEST]
    now: function () { return Date.now(); },
    sha256: function (s) { return rich300Hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); },
    randomId: function (n) { return Utilities.getUuid().replace(/-/g, '').slice(0, n); },
    randomInt: function (n) { return parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 8), 16) % n; },
    sleep: function (ms) { Utilities.sleep(Math.min(ms, 10000)); },
    uiUrl: props.getProperty('RICH300_UI_URL') || undefined,
    storeEnv: function () { if (!store) { store = rich300GasEnv_(props.getProperty('RICH300_SHEET_ID')); RICH300_ENGINE.storeInit(store); } return store; },
    kv: {
      get: function (k) { return props.getProperty(P + k); },
      put: function (k, v) { props.setProperty(P + k, v); },
      del: function (k) { props.deleteProperty(P + k); },
      keys: function () { return props.getKeys().filter(function (k) { return k.indexOf(P) === 0; }).map(function (k) { return k.slice(P.length); }); }
    },
    http: {
      call: function (method, payload) {
        // 환경 가드(Deploy.gs): 운영 승인 전·테스트 허용 전에는 어떤 Telegram 호출도 나가지 않는다. 가드가 없으면 차단(fail-closed).
        var gate = typeof rich300TgGate_ === 'function' ? rich300TgGate_(method) : 'guard-missing';
        if (gate) return { status: 403, body: { ok: false, description: 'blocked: ' + gate } };
        var token = props.getProperty('RICH300_TG_TOKEN'); if (!token) throw new Error('token missing');
        if (method !== 'getUpdates') { try { var cc = CacheService.getScriptCache(); cc.put('verify:http', String(Number(cc.get('verify:http') || 0) + 1), 21600); } catch (e) { /* 계수 실패는 무시 */ } }       // 검증(G7)용: 전송 호출 수만 센다(내용 없음)
        var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
        var body = null; try { body = JSON.parse(res.getContentText()); } catch (e) { body = null; }
        return { status: res.getResponseCode(), body: body };
      }
    }
  };
}
/**
 * 시간 트리거 진입점(1분). 겹쳐 실행되지 않도록 *사용자 락*을 잡는다(저장소가 쓰는 스크립트 락과 별개라 교착이 없다).
 * 결과는 개수만, 실행 시간은 누적 통계(tg:stats: 실행 수·총/최대 ms·느린 실행 수)로 남긴다 — 트리거 일일 실행 시간 한도 점검용(값 없음).
 */
function rich300TgPoll() {
  var props = PropertiesService.getScriptProperties(), t0 = Date.now(), out, lk = typeof LockService.getUserLock === 'function' ? LockService.getUserLock() : null;
  if (lk && !lk.tryLock(500)) return { status: 'busy', reason: 'user-lock' };
  try { var env = rich300TgEnv_(); out = RICH300_ENGINE.tgPoll(env); RICH300_ENGINE.tgGc(env); }
  catch (err) { out = { status: 'exception', quota: /too many times|quota|exceeded|limit/i.test(String(err && err.message || '')) }; }       // 메시지 자체는 저장하지 않고 분류만
  finally { if (lk) lk.releaseLock(); }
  var ms = Date.now() - t0, st = {}; try { st = JSON.parse(props.getProperty('tg:stats') || '{}'); } catch (err) { st = {}; }
  var gap = st.lastAt ? t0 - st.lastAt : 0;
  props.setProperty('tg:last', JSON.stringify({ at: t0, ms: ms, r: { status: out.status, handled: out.handled, retry: out.retry, code: out.code } }));
  props.setProperty('tg:stats', JSON.stringify({ since: st.since || t0, lastAt: t0, runs: (st.runs || 0) + 1, totalMs: (st.totalMs || 0) + ms, maxMs: Math.max(st.maxMs || 0, ms), slow: (st.slow || 0) + (ms > 30000 ? 1 : 0), busy: (st.busy || 0) + (out && out.status === 'busy' ? 1 : 0), gaps90: (st.gaps90 || 0) + (gap > 90000 && gap < 21600000 ? 1 : 0), maxGap: Math.max(st.maxGap || 0, gap < 21600000 ? gap : 0), retry: (st.retry || 0) + (out && out.retry || 0) }));
  return out;
}
function rich300TgInstallPollTrigger(minutes) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'rich300TgPoll') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('rich300TgPoll').timeBased().everyMinutes([1, 5, 10, 15, 30].indexOf(minutes) >= 0 ? minutes : 1).create();
}
function rich300TgRemovePollTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'rich300TgPoll') ScriptApp.deleteTrigger(t); });
}
/** 소유자 UI(페어링 코드 표시)에서 호출: 10분·1회용 코드를 만든다. 소유자 이메일 확인 통과 시에만. */
function rich300TgPairCode() {
  if (!rich300IsOwner_()) return { ok: false, error: 'forbidden' };
  var r = RICH300_ENGINE.tgPairCreate(rich300TgEnv_()); return { ok: true, code: r.code, expiresAt: r.expiresAt };
}

/** 모바일 입력 화면(?p=fill). 소유자만(라우터가 확인). 값은 서버가 JSON으로 주입한다. */
function rich300PageFill_(e) {
  var t = HtmlService.createTemplateFromFile('Fill'), p = (e && e.parameter) || {};
  var pre = { sid: String(p.sid || ''), dir: p.dir === 'SHORT' ? 'SHORT' : p.dir === 'LONG' ? 'LONG' : '', entry: String(p.entry || ''), stop: String(p.stop || '') };
  t.preset = JSON.stringify(pre).replace(/</g, '\\u003c');
  return t.evaluate().setTitle('RICH300 입력').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
/** google.script.run 대상: 폼 제출이 곧 확인. 소유자 확인 실패·예외는 일반 오류로만 응답. */
function rich300FillSubmit(form) {
  if (!rich300IsOwner_()) return { ok: false, error: 'forbidden' };
  var r = RICH300_ENGINE.tgSubmitFillForm(rich300TgEnv_(), form, { actor: 'ui:form' });
  return r;
}

// ── gas/Dashboard.gs ──
/**
 * RICH 300 — 대시보드 페이지(R6). 엔진 번들 + Adapters.gs + Api.gs(라우터) 와 같은 프로젝트에 둔다. 운영 배포는 승인 이후.
 *  · ?p=dash 는 Api.gs 라우터가 *소유자 이메일 확인(fail-closed)* 을 통과시킨 경우에만 이 함수를 호출한다.
 *  · 서버에서 완성된 HTML을 만든다(값은 모두 이스케이프됨). 읽기 전용: 이 페이지는 아무것도 쓰지 않는다(시트 초기화 확인 제외).
 *  · 숫자 중심 메인 화면(그래프 없음). 챌린지 설정이 없으면 '설정 전' 안내만 보이고(샘플·가짜 잔액 없음), 오류는 일반 오류 화면만 보인다(내부 정보 비노출).
 */
function rich300PageDash_(e) {
  var html;
  try {
    var se = rich300GasEnv_(PropertiesService.getScriptProperties().getProperty('RICH300_SHEET_ID'));
    RICH300_ENGINE.storeInit(se);
    html = RICH300_ENGINE.dashRenderHtml(RICH300_ENGINE.dashBuildFromStore(se, { now: Date.now() }), { appUrl: rich300AppUrl_() });
  } catch (err) { html = RICH300_ENGINE.shellRenderError({ title: '홈', code: RICH300_ENGINE.shellErrorCode(err), appUrl: rich300AppUrl_(), page: 'dash' }); }
  return HtmlService.createHtmlOutput(html).setTitle('RICH300').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ── gas/Journal.gs ──
/**
 * RICH 300 — 일지·일 마감(R7). 엔진 번들 + Adapters.gs + Api.gs(라우터) + Telegram.gs 와 같은 프로젝트에 둔다. 운영 배포·실제 알림은 승인 이후.
 *  · ?p=journal 은 라우터가 소유자 이메일 확인(fail-closed)을 통과시킨 경우에만 이 파일의 페이지 함수를 호출한다.
 *  · google.script.run 으로 호출되는 함수(rich300EquitySubmit 등)는 *각각* 소유자 확인을 다시 한다(클라이언트 호출은 라우터를 거치지 않음).
 *  · 일 마감 트리거: 매일 00:00(KST, 프로젝트 시간대) + 매시간 재확인. 같은 날짜는 한 번만 마감되므로 중복 실행은 안전하다(락·유일키).
 *  · 마감 알림(평가액 미입력)은 기본 OFF: 설정 closeNotify=on 이고 Script Property RICH300_CLOSE_SEND_APPROVED=yes 일 때만 실제로 보낸다.
 *  · 로그에는 개수·코드만 남긴다(금액·ID·본문·토큰 없음).
 */
function rich300JournalEnv_() {
  var props = PropertiesService.getScriptProperties(), store = null, tg = null;
  function tgEnv() { if (!tg) tg = rich300TgEnv_(); return tg; }
  return {
    now: function () { return Date.now(); },
    uiUrl: props.getProperty('RICH300_UI_URL') || undefined,
    storeEnv: function () { if (!store) { store = rich300GasEnv_(props.getProperty('RICH300_SHEET_ID')); RICH300_ENGINE.storeInit(store); } return store; },
    sendEnabled: function () { return props.getProperty('RICH300_CLOSE_SEND_APPROVED') === 'yes'; },
    notify: function (msg) {
      var e = tgEnv(), p = RICH300_ENGINE.tgPairedUser(e);
      if (!p) return { ok: false, code: 'not-paired' };
      return RICH300_ENGINE.tgSendNotice(e, p.chatId, msg.text, msg.url);
    }
  };
}
function rich300UiError_(err) {
  var C = RICH300_ENGINE.StoreError;
  if (err instanceof C) {
    if (err.code === 'LOCK') return { ok: false, error: 'busy', retry: true };
    if (err.code === 'VALIDATION' || err.code === 'NOT_FOUND') return { ok: false, error: 'invalid', message: String(err.message).slice(0, 160) };
  }
  return { ok: false, error: 'server' };
}
function rich300Guarded_(fn) {
  if (!rich300IsOwner_()) return { ok: false, error: 'forbidden' };
  try { return fn(rich300JournalEnv_()); } catch (err) { return rich300UiError_(err); }
}

/** 페이지(?p=journal): 서버에서 완성된 HTML. 오류는 일반 화면만(내부 정보 없음). */
function rich300PageJournal_(e, tab) {
  var html, appUrl = rich300AppUrl_();
  try {
    var env = rich300JournalEnv_(), prm = (e && e.parameter) || {}, day = /^\d{4}-\d{2}-\d{2}$/.test(String(prm.day || '')) ? String(prm.day) : null, q = prm.q ? String(prm.q).slice(0, 20) : null;
    var nParam = parseInt(prm.n, 10), limit = tab === 'stats' || tab === 'assets' ? 0 : (nParam > 0 ? Math.min(Math.max(nParam, 40), 200) : 40);      // 기록 목록은 최근 40건부터, '더 보기'로 40건씩(최대 200). 통계·자산 화면은 목록이 필요 없다
    var model = RICH300_ENGINE.journalBuild(env, { now: Date.now(), limit: limit, day: tab === 'journal' || !tab ? day : null, q: tab === 'journal' || !tab ? q : null });
    if (day && tab !== 'journal' && tab) model.presetDay = day;
    html = RICH300_ENGINE.journalRenderHtml(model, { appUrl: appUrl, tab: tab || 'all', query: { day: day, q: q } });
  } catch (err) { html = RICH300_ENGINE.shellRenderError({ title: '일지', code: RICH300_ENGINE.shellErrorCode(err), appUrl: appUrl, page: tab === 'stats' ? 'stats' : tab === 'assets' ? 'assets' : 'journal' }); }
  return HtmlService.createHtmlOutput(html).setTitle('RICH300 일지').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function rich300PageJournalTab_(e) { return rich300PageJournal_(e, 'journal'); }
function rich300PageStats_(e) { return rich300PageJournal_(e, 'stats'); }
function rich300PageAssets_(e) { return rich300PageJournal_(e, 'assets'); }
function rich300PageSignals_(e) {
  var html, appUrl = rich300AppUrl_();
  try {
    var env = rich300JournalEnv_(), r = e && e.parameter && e.parameter.r;
    html = RICH300_ENGINE.siglogRenderHtml(RICH300_ENGINE.siglogBuild(env, { now: Date.now(), filter: r }), { appUrl: appUrl });
  } catch (err) { html = RICH300_ENGINE.shellRenderError({ title: '추천 기록', code: RICH300_ENGINE.shellErrorCode(err), appUrl: appUrl, page: 'signals' }); }
  return HtmlService.createHtmlOutput(html).setTitle('RICH300 추천 기록').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** google.script.run 대상(소유자 전용) */
function rich300EquitySubmit(form) {
  return rich300Guarded_(function (env) {
    var f = form || {}, r = RICH300_ENGINE.closeSubmitEquity(env, { day: String(f.day || ''), equity: String(f.equity || ''), unrealized: f.unrealized ? String(f.unrealized) : undefined, reason: f.reason ? String(f.reason) : undefined }, { actor: 'ui:journal' });
    var detail = r.diffLabel === null ? '' : '장부 기준 ' + r.expectedLabel + ' · 차이 ' + (r.diffMicro && Number(r.diffMicro) > 0 ? '+' : '') + r.diffLabel + (r.needsReview ? ' (확인 필요)' : '');
    return { ok: true, status: r.status, message: r.status === 'unchanged' ? '이미 같은 값이 저장돼 있습니다' : '저장됨', detail: detail, flags: r.flags };
  });
}
function rich300JournalReviseFill(fillId, patch, reason) {
  return rich300Guarded_(function (env) { var r = RICH300_ENGINE.journalReviseFill(env, String(fillId || ''), patch, { actor: 'ui:journal', reason: String(reason || '') }); return { ok: true, status: r.status, message: r.status === 'unchanged' ? '바뀐 값이 없습니다' : '수정 저장됨(새로고침하면 이력이 보입니다)' }; });
}
function rich300JournalVoidFill(fillId, reason) {
  return rich300Guarded_(function (env) { var r = RICH300_ENGINE.journalVoidFill(env, String(fillId || ''), { actor: 'ui:journal', reason: String(reason || '') }); return { ok: true, status: r.status, message: '체결을 취소했습니다(이력은 남습니다)' }; });
}
function rich300CashflowSubmit(form) {
  return rich300Guarded_(function (env) { var f = form || {}, r = RICH300_ENGINE.journalAddCashflow(env, { cfId: String(f.formId || ''), amount: String(f.amount || ''), note: f.note ? String(f.note) : undefined }, { actor: 'ui:journal' }); return { ok: true, status: r.status, message: r.status === 'duplicate' ? '이미 저장됨' : '저장됨' }; });
}
function rich300CashflowVoid(cfId, reason) {
  return rich300Guarded_(function (env) { var r = RICH300_ENGINE.journalVoidCashflow(env, String(cfId || ''), { actor: 'ui:journal', reason: String(reason || '') }); return { ok: true, status: r.status, message: '입출금을 취소했습니다' }; });
}

/** 시간 트리거 진입점: 일 마감 + 실패 알림 재시도. 결과는 개수만 속성에 남긴다. */
function rich300CloseTick() {
  var out;
  try { out = RICH300_ENGINE.closeTick(rich300JournalEnv_(), { now: Date.now() }); } catch (err) { out = { status: 'exception', code: String(err && err.code || 'error') }; }
  PropertiesService.getScriptProperties().setProperty('close:last', JSON.stringify({ at: Date.now(), status: out.status, closed: (out.closed || []).length, skipped: (out.skipped || []).length, notices: out.notices || null, retry: out.retry || null, code: out.code || null }));
  return out;
}
function rich300InstallCloseTriggers() {
  rich300RemoveCloseTriggers();
  ScriptApp.newTrigger('rich300CloseTick').timeBased().atHour(0).everyDays(1).create();    // 프로젝트 시간대(Asia/Seoul) 00:00~01:00 사이 실행(Apps Script 특성)
  ScriptApp.newTrigger('rich300CloseTick').timeBased().everyHours(1).create();             // 놓친 날·실패 알림 재확인
}
function rich300RemoveCloseTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'rich300CloseTick') ScriptApp.deleteTrigger(t); });
}

// ── gas/Backup.gs ──
/**
 * RICH 300 — 백업·복원 어댑터(R8). DriveApp 으로 스프레드시트 사본을 만들고 검증·보관(최근 N개)한다. 로직은 엔진(backup.mjs)에 있다.
 *  · 주 1회 트리거(일요일 03시 KST) + 수동 실행. 운영 배포·트리거 설치는 승인 이후.
 *  · 백업 폴더(Drive "RICH300-backups")는 처음 실행 때 만든다. 보관 삭제는 휴지통 이동이며 이름 패턴이 맞는 백업만 대상이다.
 *  · Telegram CSV 전송은 구현하지 않는다(이 파일에는 외부 네트워크 호출이 없다).
 *  · 복원은 새 사본 생성·검증까지. 운영 시트 전환은 Script Property 두 개(RICH300_SWITCH_TO, RICH300_SWITCH_CONFIRM=yes)를 사용자가 직접 설정한 뒤 rich300BackupSwitchFromProps 를 실행할 때만(전환 전 자동 백업).
 *  · 필요한 권한: Drive 사본 생성·휴지통 이동(DriveApp). 최소 범위는 drive.file 로 시도하고, 원본 시트를 스크립트가 만들지 않은 경우 drive 범위가 필요할 수 있다(테스트 프로젝트에서 확인).
 */
var RICH300_BACKUP_FOLDER = 'RICH300-backups';

function rich300BackupDrive_(folderName) {
  var folderId = null;
  return {
    ensureFolder: function () {
      if (folderId) return folderId;
      var it = DriveApp.getFoldersByName(folderName);
      folderId = it.hasNext() ? it.next().getId() : DriveApp.createFolder(folderName).getId();
      return folderId;
    },
    list: function (fid) {
      var out = [], it = DriveApp.getFolderById(fid).getFiles();
      while (it.hasNext()) { var f = it.next(); out.push({ id: f.getId(), name: f.getName(), createdAt: f.getDateCreated().getTime() }); }
      return out;
    },
    copy: function (sourceId, name, fid) { var f = DriveApp.getFileById(sourceId).makeCopy(name, DriveApp.getFolderById(fid)); return { id: f.getId() }; },
    openStore: function (id) { return rich300GasEnv_(id); },
    trash: function (id) { DriveApp.getFileById(id).setTrashed(true); }
  };
}
function rich300BackupEnv_() {
  var props = PropertiesService.getScriptProperties(), sid = props.getProperty('RICH300_SHEET_ID'), store = null;
  return { sourceId: sid, storeEnv: function () { if (!store) { store = rich300GasEnv_(sid); RICH300_ENGINE.storeInit(store); } return store; }, drive: rich300BackupDrive_(RICH300_BACKUP_FOLDER) };
}
/** 트리거·수동 진입점. 결과는 개수·이름만 속성에 남긴다(ID·내용 없음). */
function rich300BackupRun() {
  var out;
  try { out = RICH300_ENGINE.backupRun(rich300BackupEnv_(), { now: Date.now() }); } catch (err) { out = { status: 'exception', code: String(err && err.code || 'error') }; }
  PropertiesService.getScriptProperties().setProperty('backup:last', JSON.stringify({ at: Date.now(), status: out.status, name: out.name || null, trashed: (out.trashed || []).length, rotated: out.rotated !== false, reasons: out.reasons || null, warnings: out.warnings || null }));
  return { status: out.status, name: out.name, trashed: out.trashed, warnings: out.warnings };
}
function rich300BackupList() {
  var env = rich300BackupEnv_(), list = env.drive.list(env.drive.ensureFolder()).filter(function (x) { return /^RICH300-(backup|restored)-/.test(x.name); });
  list.sort(function (a, b) { return a.name < b.name ? 1 : -1; });
  return list.map(function (x) { return { name: x.name, createdAt: new Date(x.createdAt).toISOString() }; });          // ID는 반환하지 않는다
}
function rich300BackupInstallTrigger() {
  rich300BackupRemoveTrigger();
  ScriptApp.newTrigger('rich300BackupRun').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
}
function rich300BackupRemoveTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'rich300BackupRun') ScriptApp.deleteTrigger(t); });
}
/** 복원 시험: 가장 최근 백업(또는 RICH300_RESTORE_FROM_NAME 속성에 적은 이름)을 새 사본으로 복원·검증. 운영 시트는 바뀌지 않는다. 새 사본 이름만 반환. */
function rich300BackupRestoreLatest() {
  var env = rich300BackupEnv_(), props = PropertiesService.getScriptProperties(), want = props.getProperty('RICH300_RESTORE_FROM_NAME'), list = env.drive.list(env.drive.ensureFolder()).filter(function (x) { return /^RICH300-backup-\d{8}-\d{4}$/.test(x.name); }).sort(function (a, b) { return a.name < b.name ? 1 : -1; });
  var pick = want ? list.filter(function (x) { return x.name === want; })[0] : list[0];
  if (!pick) return { ok: false, error: 'no-backup' };
  try { var r = RICH300_ENGINE.backupRestore(env, pick.id, { now: Date.now() }); props.setProperty('RICH300_LAST_RESTORED_ID', r.id); return { ok: true, name: r.name, from: r.from, repairable: r.repairable }; }
  catch (err) { return { ok: false, error: String(err && err.code || 'error') }; }
}
/** 운영 시트 전환(사용자가 RICH300_SWITCH_TO=새 시트 ID, RICH300_SWITCH_CONFIRM=yes 를 직접 설정한 경우에만). 전환 전 현재 시트를 자동 백업하고 대상을 점검한다. */
function rich300BackupSwitchFromProps() {
  var props = PropertiesService.getScriptProperties(), to = props.getProperty('RICH300_SWITCH_TO'), ok = props.getProperty('RICH300_SWITCH_CONFIRM');
  if (!to || ok !== 'yes') return { ok: false, error: 'not-confirmed' };
  var env = rich300BackupEnv_(), chk = RICH300_ENGINE.backupSwitchChecks(env, to, { expectEnv: props.getProperty('RICH300_ENV') });
  if (!chk.ok) return { ok: false, error: 'checks-failed', issues: chk.issues };
  var pre = RICH300_ENGINE.backupRun(env, { now: Date.now() });
  if (pre.status !== 'ok' && pre.status !== 'exists') return { ok: false, error: 'pre-backup-failed', status: pre.status };
  props.setProperty('RICH300_SHEET_ID_PREVIOUS', props.getProperty('RICH300_SHEET_ID')); props.setProperty('RICH300_SHEET_ID', to); props.deleteProperty('RICH300_SWITCH_TO'); props.deleteProperty('RICH300_SWITCH_CONFIRM');
  return { ok: true, preBackup: pre.name, note: '이전 시트 ID는 RICH300_SHEET_ID_PREVIOUS 에 보관됨(되돌리기용)' };
}

// ── gas/Deploy.gs ──
/**
 * RICH 300 — 배포 보조(R8): 환경 분리 가드, 초기 설정, 자가 점검, 트리거 일괄 설치. 엔진 번들과 같은 프로젝트에 둔다.
 *  · 테스트 프로젝트와 운영 프로젝트는 *서로 다른 Apps Script 프로젝트·스프레드시트·봇 토큰*을 쓴다. RICH300_ENV(test|prod)와 시트 Meta 의 환경 표식이 일치해야 한다.
 *  · Telegram 호출 가드(rich300TgGate_): 운영은 RICH300_PROD_APPROVED=yes, 테스트는 RICH300_TEST_TG_ALLOW=yes 일 때만 허용. 그 전에는 어떤 메시지도 나가지 않는다.
 *  · 점검·설정 함수의 출력에는 값이 아니라 상태(존재 여부)만 담는다. 토큰·키·이메일·시트 ID를 출력하지 않는다.
 */
var RICH300_GATE_PURPOSE_ = '';      // 화면의 명시적 동작(rich300TgTestSend·rich300TgPairCheck)이 실행하는 동안에만 설정된다(실행마다 초기화). 트리거·폴링·감시는 설정하지 않는다.
function rich300TgGate_(method) {
  var p = PropertiesService.getScriptProperties();
  return RICH300_ENGINE.deployGate({ env: p.getProperty('RICH300_ENV'), prodApproved: p.getProperty('RICH300_PROD_APPROVED'), readOnlyOk: p.getProperty('RICH300_TG_READONLY_OK'), testTgAllow: p.getProperty('RICH300_TEST_TG_ALLOW'), tgTestOk: p.getProperty('RICH300_TG_TEST_OK') }, method, RICH300_GATE_PURPOSE_);
}
/** 초기 설정(멱등): 환경 이름·소유자 이메일 기록, 시트가 없으면 새로 만들고 저장소 초기화·환경 표식. 트리거·승인 플래그는 건드리지 않는다. */
function rich300SetupTest() { return rich300Setup_('test'); }
function rich300SetupProd() { return rich300Setup_('prod'); }
function rich300Setup_(name) {
  var props = PropertiesService.getScriptProperties(), cur = props.getProperty('RICH300_ENV');
  if (cur && cur !== name) return { ok: false, error: 'env-conflict', note: '이 프로젝트는 이미 ' + cur + ' 환경입니다. 환경이 다르면 새 프로젝트를 만드세요.' };
  props.setProperty('RICH300_ENV', name);
  if (!props.getProperty('RICH300_OWNER_EMAIL')) { var me = Session.getEffectiveUser().getEmail(); if (me) props.setProperty('RICH300_OWNER_EMAIL', me); }
  var created = false, id = props.getProperty('RICH300_SHEET_ID');
  if (!id) { id = SpreadsheetApp.create('RICH300 ' + name).getId(); props.setProperty('RICH300_SHEET_ID', id); created = true; }
  var se = rich300GasEnv_(id); RICH300_ENGINE.storeInit(se);
  try { RICH300_ENGINE.deployMarkEnv(se, name); } catch (err) { return { ok: false, error: String(err && err.code || 'error') }; }
  return { ok: true, env: name, sheetCreated: created, next: ['rich300SelfTest 실행', '봇 토큰·수신 키·UI URL 등 비밀값은 프로젝트 설정의 스크립트 속성에서 직접 입력'] };
}
function rich300CallIf_(name) { if (typeof globalThis[name] === 'function') { globalThis[name](); return true; } return false; }
function rich300InstallAllTriggers() { var done = ['rich300TgInstallPollTrigger', 'rich300InstallCloseTriggers', 'rich300BackupInstallTrigger'].filter(rich300CallIf_); return { ok: true, installed: done.length }; }
function rich300RemoveAllTriggers() { var done = ['rich300TgRemovePollTrigger', 'rich300RemoveCloseTriggers', 'rich300BackupRemoveTrigger'].filter(rich300CallIf_); return { ok: true, removed: done.length }; }

/** 자가 점검: 상태만 반환(값 없음). 실행 로그에도 같은 요약을 남긴다. */
function rich300SelfTestRun_() {
  var p = PropertiesService.getScriptProperties(), has = function (k) { return !!p.getProperty(k); }, info, se = null, integ = null, marker = null, backups = 0;
  try { if (has('RICH300_SHEET_ID')) { se = rich300GasEnv_(p.getProperty('RICH300_SHEET_ID')); RICH300_ENGINE.storeInit(se); var c = RICH300_ENGINE.storeIntegrityCheck(se); integ = { ok: c.ok, issues: c.issues.map(function (i) { return i.type; }) }; marker = RICH300_ENGINE.deployCheckEnv(se, p.getProperty('RICH300_ENV')); } } catch (err) { integ = null; }
  try { backups = rich300BackupList().filter(function (x) { return /^RICH300-backup-/.test(x.name); }).length; } catch (err) { backups = 0; }
  var email = ''; try { email = Session.getActiveUser().getEmail() || ''; } catch (err) { email = ''; }
  var key = p.getProperty('RICH300_INGEST_KEY') || '';
  info = { env: p.getProperty('RICH300_ENV'), tz: Session.getScriptTimeZone(), v8: typeof BigInt === 'function',
    has: { sheetId: has('RICH300_SHEET_ID'), ownerEmail: has('RICH300_OWNER_EMAIL'), tgToken: has('RICH300_TG_TOKEN'), ingestKey: key.length > 0, uiUrl: /^https:\/\//.test(p.getProperty('RICH300_UI_URL') || '') }, ingestKeyLen: key.length,
    flags: { closeSendApproved: p.getProperty('RICH300_CLOSE_SEND_APPROVED') === 'yes', prodApproved: p.getProperty('RICH300_PROD_APPROVED') === 'yes', testTgAllow: p.getProperty('RICH300_TEST_TG_ALLOW') === 'yes' },
    owner: { activeEmailVisible: email.length > 3, matchesOwner: email.length > 3 && email.toLowerCase() === String(p.getProperty('RICH300_OWNER_EMAIL') || '').toLowerCase() },
    triggers: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }), expectTriggers: [['rich300TgInstallPollTrigger', 'rich300TgPoll'], ['rich300InstallCloseTriggers', 'rich300CloseTick'], ['rich300BackupInstallTrigger', 'rich300BackupRun']].filter(function (x) { return typeof globalThis[x[0]] === 'function'; }).map(function (x) { return x[1]; }), integrity: integ, envMarker: marker, backupCount: backups };
  return RICH300_ENGINE.deploySelfTest(info);
}
function rich300SelfTest() {
  var r = rich300SelfTestRun_();
  Logger.log('RICH300 자가 점검: 실패 ' + r.fail + ' · 경고 ' + r.warn + '\n' + r.items.filter(function (i) { return !i.ok; }).map(function (i) { return '[' + i.level + '] ' + i.text; }).join('\n'));
  return r;
}

// ── gas/Verify.gs ──
/**
 * RICH 300 — 설치 후 비파괴 자동 검증(호환성·계산 시간·시트 입출력·백업 복원 리허설). 엔진 번들 + 나머지 gas 파일과 같은 프로젝트에 둔다.
 *  · 운영 시트의 데이터는 읽기만 한다(쓰지 않음). 쓰기·복원·변조 시험은 *임시 시트*(RICH300-VERIFY-SCRATCH-…)에서만 한다. 어떤 시트·백업도 삭제하지 않는다.
 *  · 빠른 구간(A·B)은 즉시, 느린 구간(C·G)은 일회용 시간 트리거로 한 구간씩 나눠 돌린다(실행 한도 6분 안). 사용자가 할 일은 없다.
 *  · 결과(PASS/FAIL, 값 없음)는 Script Properties(verify:auto)에 모이고 ?p=check 화면(소유자 전용)에서 본다. Telegram 메시지는 보내지 않는다.
 */
function rich300VerifyProps_() { return PropertiesService.getScriptProperties(); }
function rich300VerifyJson_(k, d) { try { var v = rich300VerifyProps_().getProperty(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
var RICH300_VERIFY_IDS_ = { 'A': ['A1', 'A2', 'A3', 'A4'], 'B': ['B1', 'B2'], 'C-io': ['C1', 'C4'], 'C-read': ['C2', 'C3', 'C5'], 'G': ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'] };
function rich300VerifyPorts_() {
  var base = rich300TgEnv_(), stamp = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace(/[-:T]/g, ''), scratchDrive = rich300BackupDrive_('RICH300-VERIFY-SCRATCH');
  return {
    now: function () { return Date.now(); },
    hmacSha256: function (key, msg) { return rich300Hex_(Utilities.computeHmacSha256Signature(msg, key)); },
    sha256: base.sha256,
    tz: function () { return Session.getScriptTimeZone(); },
    formatKst: function (ms) { return Utilities.formatDate(new Date(ms), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'); },
    selfTest: function () { return rich300SelfTestRun_(); },
    newScratch: function (label) {
      var id = SpreadsheetApp.create('RICH300-VERIFY-SCRATCH-' + label + '-' + stamp).getId();
      try { DriveApp.getFolderById(scratchDrive.ensureFolder()).addFile(DriveApp.getFileById(id)); } catch (e) { /* 폴더 정리는 선택 */ }
      var se = rich300GasEnv_(id); RICH300_ENGINE.storeInit(se); RICH300_ENGINE.deployMarkEnv(se, 'test'); return { se: se, id: id };
    },
    scratchDrive: function () { return scratchDrive; },
    realBackup: function () { return rich300BackupEnv_(); },
    tamper: function (id) { var sh = SpreadsheetApp.openById(id).getSheetByName('Fills'); sh.getRange(2, 5).setNumberFormat('@').setValue('{"tampered":"yes"}'); },
    sleep: function (ms) { Utilities.sleep(ms); },
    httpCount: function () { try { return Number(CacheService.getScriptCache().get('verify:http') || 0); } catch (e) { return 0; } }
  };
}
function rich300VerifyFail_(name, err) { return { id: 'V-' + name, status: 'FAIL', text: '구간 ' + name + ' 실행 오류: ' + String(err && (err.code || err.message) || 'error').replace(/https?:\/\/\S+/g, '').slice(0, 80) }; }
/** 검증 시작(멱등 아님: 호출할 때마다 처음부터). 빠른 구간을 바로 돌리고 느린 구간은 백그라운드로 예약한다. */
function rich300VerifyStart() {
  var p = rich300VerifyProps_(), items = [], ports = rich300VerifyPorts_();
  RICH300_ENGINE.LIVE_FAST_SECTIONS.forEach(function (name) { try { items = items.concat(RICH300_ENGINE.liveRunSection(name, ports)); } catch (err) { items.push(rich300VerifyFail_(name, err)); } });
  p.setProperty('verify:auto', JSON.stringify(items)); p.setProperty('verify:bg', JSON.stringify({ todo: RICH300_ENGINE.LIVE_SLOW_SECTIONS.slice() })); p.setProperty('verify:startedAt', String(Date.now()));
  rich300VerifyScheduleBg_(30000);
  return { ok: true, fast: items.length, pending: RICH300_ENGINE.LIVE_SLOW_SECTIONS.length };
}
function rich300VerifyClearBg_() { ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'rich300VerifyBackground') ScriptApp.deleteTrigger(t); }); }
function rich300VerifyScheduleBg_(ms) { rich300VerifyClearBg_(); ScriptApp.newTrigger('rich300VerifyBackground').timeBased().after(ms).create(); }
function rich300VerifyBackground() {
  rich300VerifyClearBg_();
  var bg = rich300VerifyJson_('verify:bg', null), p = rich300VerifyProps_();
  if (!bg || !bg.todo || !bg.todo.length) return;
  var name = bg.todo[0], items = rich300VerifyJson_('verify:auto', []);
  try { items = items.concat(RICH300_ENGINE.liveRunSection(name, rich300VerifyPorts_())); } catch (err) { items.push(rich300VerifyFail_(name, err)); }
  bg.todo.shift(); p.setProperty('verify:auto', JSON.stringify(items)); p.setProperty('verify:bg', JSON.stringify(bg));
  if (bg.todo.length) rich300VerifyScheduleBg_(30000);
}
/** 화면용 항목: 끝난 구간은 결과, 남은 구간은 '진행 중'. 아직 시작하지 않았으면 빈 목록. */
function rich300VerifyItems_() {
  var items = rich300VerifyJson_('verify:auto', []), bg = rich300VerifyJson_('verify:bg', null);
  if (!items.length && !bg) return [{ id: 'V0', status: 'WAIT', text: '자동 검증이 아직 시작되지 않았습니다(rich300Install 실행 시 시작)' }];
  ((bg && bg.todo) || []).forEach(function (name) { (RICH300_VERIFY_IDS_[name] || [name]).forEach(function (id) { items.push({ id: id, status: 'WAIT', text: '구간 ' + name + ' 대기 중(자동 진행)' }); }); });
  return items;
}
/** ?p=check 화면(소유자 전용: Api.gs 라우터가 확인). 읽기 전용. */
function rich300PageCheck_(e) {
  var html, appUrl = rich300AppUrl_();
  try {
    var p = rich300VerifyProps_(), st = rich300VerifyJson_('tg:stats', null), self = RICH300_ENGINE.checkFromSelfTest(rich300SelfTestRun_());
    var sections = [{ title: '설치 점검', items: self }, { title: '실환경 자동 검증(호환성·계산·시트·백업)', items: rich300VerifyItems_() }, { title: '봇 사전 점검(읽기 전용)', items: RICH300_ENGINE.checkBotItems(rich300VerifyJson_('botcheck:last', null)) }, { title: 'Telegram 폴링 실측', items: RICH300_ENGINE.checkPollItems(st, { last: rich300VerifyJson_('tg:last', null) }) },
      { title: '트리거', items: [{ id: 'T1', status: 'PASS', text: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }).sort().join(', ') || '없음' }] }];
    var notes = []; if (p.getProperty('RICH300_PROD_APPROVED') !== 'yes') notes.push('운영 승인 전: Telegram 호출이 모두 차단되어 있습니다(정상). 승인 후 rich300Install 을 다시 실행하세요.');
    html = RICH300_ENGINE.checkRenderHtml({ sections: sections, generatedAt: Date.now(), notes: notes }, { appUrl: appUrl });
  } catch (err) { html = RICH300_ENGINE.shellRenderError({ title: '설치 점검', code: RICH300_ENGINE.shellErrorCode(err), appUrl: appUrl, page: 'check' }); }
  return HtmlService.createHtmlOutput(html).setTitle('RICH300 점검').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ── gas/Health.gs ──
/**
 * RICH 300 — 상태 점검(?p=health)과 응답시간 기록. 소유자만(라우터가 확인). 읽기 전용: 시트에는 아무것도 쓰지 않는다(없는 시트 확인만).
 *  · 무한 로딩·빈 화면의 원인을 한 화면에서 가른다: 속성/시트 설정 → 스프레드시트 열기 → 시트 구조 → 챌린지 → 최근 기록 → 트리거 → 웹앱 주소 → 첫 화면·일지 처리 시간(실측).
 *  · 각 단계는 독립적으로 try/catch 한다(한 단계가 실패해도 나머지를 계속 점검하고, 이 화면 자체는 항상 열린다). 오류는 짧은 코드만 보인다(값·ID·이메일 없음).
 *  · 응답시간: doGet 이 화면별 처리 시간을 CacheService 에 최근 12건 남긴다. '첫 실행' = 직전 기록이 없거나 10분 넘게 지난 뒤의 첫 요청(서버 시작·캐시 비어 있음 포함), '재실행' = 그 이후.
 */
function rich300PerfRecord_(page, ms) {
  try {      // 캐시 호출 2번(읽기+쓰기). '첫 실행' = 직전 기록이 없거나 10분 넘게 지난 뒤의 첫 요청
    var c = CacheService.getScriptCache(), now = Date.now(), log = [];
    try { log = JSON.parse(c.get('perf:log') || '[]'); } catch (e1) { log = []; }
    var last = log.length ? log[log.length - 1] : null;
    log.push({ p: page, ms: ms, cold: !last || now - last.at > 600000, at: now });
    c.put('perf:log', JSON.stringify(log.slice(-12)), 21600);
  } catch (err) { /* 기록 실패는 화면에 영향을 주지 않는다 */ }
}
function rich300PerfRecent_() {
  try { return JSON.parse(CacheService.getScriptCache().get('perf:log') || '[]').reverse(); } catch (err) { return []; }
}
function rich300PageHealth_(e) {
  var t0 = Date.now(), steps = [], props = PropertiesService.getScriptProperties(), E = RICH300_ENGINE, se = null;
  function step(id, label, fn) {
    var t = Date.now();
    try { var r = fn() || {}; steps.push({ id: id, status: r.status || 'PASS', text: r.text || id, ms: Date.now() - t }); }
    catch (err) { steps.push({ id: id, status: 'FAIL', text: label + ' 실패 (' + E.shellErrorCode(err) + ')', ms: Date.now() - t }); }
  }
  step('H1', '코드 빌드 확인', function () { return { text: '코드 빌드 ' + RICH300_BUILD + ' (배포된 웹앱이 이 빌드와 같아야 합니다)' }; });
  step('H2', '스크립트 속성 확인', function () {
    var sid = props.getProperty('RICH300_SHEET_ID'), owner = String(props.getProperty('RICH300_OWNER_EMAIL') || '').trim();
    if (!sid) return { status: 'FAIL', text: '스크립트 속성 RICH300_SHEET_ID 없음 → 편집기에서 rich300Install 실행' };
    return { status: owner.length > 3 ? 'PASS' : 'FAIL', text: '스크립트 속성: 시트 설정 있음 · 소유자 ' + (owner.length > 3 ? '설정됨' : '미설정 → rich300Install 실행') };
  });
  step('H3', '스프레드시트 열기', function () { se = rich300GasEnv_(props.getProperty('RICH300_SHEET_ID')); return { text: '스프레드시트 열기' }; });
  step('H4', '시트 구조·스키마 확인', function () { E.storeInit(se, { force: true }); return { text: '시트 구조·스키마 버전 확인(머리글 전체 재확인)' }; });
  step('H5', '챌린지 확인', function () { var ch = E.storeGet(se, 'challenge', 'challenge'); return ch && !ch.void ? { text: '챌린지 설정 있음' } : { status: 'WAIT', text: '챌린지 설정 없음 → rich300Install 실행(첫 화면은 "설정 전" 안내만 보임)' }; });
  step('H6', '최근 기록 확인', function () { var t = E.storeReadAuditTail(se, 1)[0]; return { text: '최근 기록: ' + (t ? '#' + t.seq : '없음') }; });
  step('H7', '트리거 확인', function () {
    var n = ScriptApp.getProjectTriggers().length; return n ? { text: '트리거 ' + n + '개 설치됨' } : { status: 'WAIT', text: '트리거 없음 → rich300Install 실행(일 마감·백업)' };
  });
  step('H8', '웹앱 주소 확인', function () { return rich300AppUrl_() ? { text: '웹앱 주소 확인됨(/exec). 주소는 배포를 새 버전으로 갱신해도 바뀌지 않습니다' } : { status: 'WAIT', text: '웹앱 주소를 알 수 없음 → 배포(웹 앱) 필요' }; });
  step('H9', '첫 화면(홈) 생성', function () {   // 첫 화면 실측: 실제 대시보드 모델 생성 + 렌더 (새 env — 요청 캐시 없이)
    var ms = Date.now(), env = rich300GasEnv_(props.getProperty('RICH300_SHEET_ID')); E.storeInit(env);
    E.dashRenderHtml(E.dashBuildFromStore(env, { now: Date.now() }), { appUrl: '' }); var t = Date.now() - ms;
    return { status: t < 3000 ? 'PASS' : 'WAIT', text: '첫 화면(홈) 생성 ' + t + 'ms — 목표 3000ms' + (t < 3000 ? '' : ' 초과: 기록이 많아졌거나 Google 응답이 느린 상태') };
  });
  step('H10', '기록 조회 생성', function () {
    var ms = Date.now(), jenv = rich300JournalEnv_(); E.journalBuild(jenv, { now: Date.now(), limit: 40 }); var t = Date.now() - ms;
    return { status: t < 2000 ? 'PASS' : 'WAIT', text: '기록 조회(최근 40건) 생성 ' + t + 'ms — 목표 2000ms' };
  });
  step('H11', '보유 포지션 감시 상태', function () {      // 속성·트리거·가드 상태만 읽는다(시세·시트·텔레그램 호출 없음)
    var st = rich300WatchState_(), age = st.last ? Math.round((Date.now() - st.last.at) / 60000) : null;
    var propText = { unset: '속성 없음', off: 'off', preview: 'preview', on: 'on', invalid: '인식 불가 값(길이 ' + st.invalidLen + ')' }[st.prop];
    var eff = { nothing: '실제 동작: 아무것도 하지 않음(꺼짐)', 'preview-only': '실제 동작: 계산만, 전송 없음', sends: '실제 동작: 전송 가능' }[st.effective];
    var base = '보유 포지션 감시 — 속성 ' + propText + ' · ' + eff + ' · 트리거 ' + (st.triggers ? st.triggers + '개' : '없음') + ' · 전송 가드 ' + (st.gateBlocked ? '막힘' : '통과') + '/연결 ' + (st.paired ? '됨' : '안 됨') + (st.last ? ' · 마지막 실행 ' + age + '분 전 ' + st.last.status : ' · 실행 기록 없음');
    return { status: st.effective === 'nothing' ? 'WAIT' : (st.triggers && st.last && age <= 15 && st.last.status !== 'exception' ? 'PASS' : 'WAIT'), text: base };
  });
  var html = E.shellRenderHealth({ steps: steps, build: RICH300_BUILD, appUrl: rich300AppUrl_(), totalMs: Date.now() - t0, perf: { recent: rich300PerfRecent_() } });
  return rich300Html_(html, 'RICH300 상태 점검');
}

// ── gas/Watch.gs ──
/**
 * RICH 300 — 보유 포지션 감시(시간 트리거). 웹앱 화면과 무관하게 *백그라운드*에서만 실행되어 홈 화면을 느리게 하지 않는다.
 *  · 기본 OFF: 스크립트 속성 RICH300_WATCH_ALERTS 가 'on' 일 때만 전송, 'preview' 면 계산만(전송·상태 저장 없음), 없으면 아무것도 하지 않는다(시세 호출 0).
 *  · 이 파일의 어떤 함수도 기존 트리거를 바꾸지 않는다. 감시 트리거는 rich300WatchInstallTrigger() 를 *직접 실행했을 때만* 설치된다(사용자 승인 후).
 *  · 시세: 거래소 공개 API(OKX 우선, 실패 시 Bybit) 읽기 전용 — 키·주문 없음. 사용자가 등록한 체결과 시세는 별도 출처로 표시된다.
 *  · 상태: Script Properties 'w:' 접두(포지션별 전송 기록·손절 단계 등). 텔레그램 입력 상태 'tg:'·COIN RADAR(GitHub Actions 캐시)와 분리.
 *  · 전송은 텔레그램 환경 가드(rich300TgGate_)를 그대로 따른다: 운영 승인 전에는 'on' 이어도 전송하지 않고 미리보기로만 동작한다.
 *  · 로그에는 개수·코드만 남긴다(금액·ID·본문·토큰 없음).
 */
function rich300WatchMode_() {
  var v = String(PropertiesService.getScriptProperties().getProperty('RICH300_WATCH_ALERTS') || '').trim().toLowerCase();
  return v === 'on' ? 'on' : v === 'preview' ? 'preview' : 'off';
}
function rich300WatchJson_(res) { try { return res.getResponseCode() === 200 ? JSON.parse(res.getContentText()) : null; } catch (err) { return null; } }
/** 공개 시세 수집: 15분·1시간·4시간 봉 + 현재가(주소·해석·판정은 엔진의 watchMarketUrls/watchParseSource 와 같다). 봉 캐시는 60·150·600초뿐이고 현재가는 캐시하지 않는다. opts.noCache 면 캐시 없이 새로 읽는다(연결 점검용).
 *  반환 attempts: 출처별 { src, ms(응답 시간), http:[상태 코드…], ticker:bool, n:{15m,1h,4h} } — 코드·시간·개수만(본문·값 없음). */
function rich300WatchMarket_(symbolId, opts) {
  var E = RICH300_ENGINE, cache = CacheService.getScriptCache(), now = Date.now(), noCache = !!(opts && opts.noCache), TTL = { '15m': 60, '1h': 150, '4h': 600 };
  var out = { ok: false, source: null, price: 0, priceAt: 0, why: '', attempts: [], bars15m: null, bars1h: null, bars4h: null };
  if (!E.watchMarketUrls('OKX', symbolId)) return out;
  function cached(k) { if (noCache) return null; try { var c = cache.get('wc:' + symbolId + ':' + k); return c ? JSON.parse(c) : null; } catch (err) { return null; } }
  function keep(k, v) { if (noCache) return; try { cache.put('wc:' + symbolId + ':' + k, JSON.stringify(v), TTL[k]); } catch (err) { /* 캐시 실패는 무시 */ } }
  ['15m', '1h', '4h'].forEach(function (k) { out['bars' + k] = cached(k); });
  var sources = ['OKX', 'Bybit'];
  for (var si = 0; si < sources.length && !out.ok; si++) {
    var src = sources[si], urls = E.watchMarketUrls(src, symbolId), keys = ['ticker'], reqs = [{ url: urls.ticker, method: 'get', muteHttpExceptions: true }];
    ['15m', '1h', '4h'].forEach(function (k) { if (!out['bars' + k]) { keys.push(k); reqs.push({ url: urls[k], method: 'get', muteHttpExceptions: true }); } });
    var t0 = Date.now(), res, att = { src: src, ms: 0, http: [], ticker: false, n: {} };
    try { res = UrlFetchApp.fetchAll(reqs); } catch (err) { att.ms = Date.now() - t0; att.http = ['exception']; out.attempts.push(att); out.why += src + '[fetch-exception] '; continue; }
    att.ms = Date.now() - t0;
    var jsons = {}; for (var i = 0; i < keys.length; i++) { att.http.push(res[i].getResponseCode()); jsons[keys[i]] = rich300WatchJson_(res[i]); }
    var parsed = E.watchParseSource(src, jsons, now), tk = parsed.ticker; att.ticker = !!tk;
    ['15m', '1h', '4h'].forEach(function (k) { var got = parsed.bars[k]; att.n[k] = got ? got.length : 0; if (got && got.length) { out['bars' + k] = got; keep(k, got); } });
    out.attempts.push(att);
    out.why += src + '[http ' + att.http.join('/') + ' ticker ' + (tk ? 'ok' : 'bad') + '] ';      // 상태 코드만(본문·값 없음)
    if (!tk) continue;
    if (out.bars15m && out.bars1h && out.bars4h) { out.ok = true; out.source = src; out.price = tk.price; out.priceAt = tk.priceAt; }
  }
  return out;
}
function rich300WatchEnv_(mode) {
  var props = PropertiesService.getScriptProperties(), P = 'w:', store = null, tg = null;
  function tgEnv() { if (!tg) tg = rich300TgEnv_(); return tg; }
  return {
    now: function () { return Date.now(); },
    mode: function () { return mode; },
    storeEnv: function () { if (!store) { store = rich300GasEnv_(props.getProperty('RICH300_SHEET_ID')); RICH300_ENGINE.storeInit(store); } return store; },
    kv: {
      get: function (k) { return props.getProperty(P + k); },
      put: function (k, v) { props.setProperty(P + k, v); },
      del: function (k) { props.deleteProperty(P + k); },
      keys: function () { return props.getKeys().filter(function (k) { return k.indexOf(P) === 0; }).map(function (k) { return k.slice(P.length); }); }
    },
    market: rich300WatchMarket_,
    send: function (text) {
      var e = tgEnv(), p = RICH300_ENGINE.tgPairedUser(e);
      if (!p) return { ok: false, code: 'not-paired' };
      return RICH300_ENGINE.tgSendNotice(e, p.chatId, text);
    }
  };
}
/** 전송이 실제로 가능한가: 환경 가드 통과 + 텔레그램 연결됨. 아니면 'on' 이어도 미리보기로만 동작한다. */
function rich300WatchCanSend_() {
  try {
    if (typeof rich300TgGate_ === 'function' && rich300TgGate_('sendMessage')) return false;
    return !!RICH300_ENGINE.tgPairedUser(rich300TgEnv_());
  } catch (err) { return false; }
}
/** 시간 트리거 진입점(5분). 겹쳐 실행되지 않도록 사용자 락을 잡는다. 결과는 개수만 속성에 남긴다. */
function rich300WatchTick() { return rich300WatchRun_(rich300WatchMode_()); }
/** 편집기에서 직접 실행하는 미리보기: 전송·상태 저장 없이 계산 결과 개수만 돌려준다(설정과 무관, 어떤 속성도 쓰지 않는다). */
function rich300WatchPreview() { return rich300WatchRun_('preview'); }
function rich300WatchRun_(want) {
  var props = PropertiesService.getScriptProperties(), t0 = Date.now(), out;
  if (want === 'off') return { status: 'off' };
  var lk = typeof LockService.getUserLock === 'function' ? LockService.getUserLock() : null;
  if (lk && !lk.tryLock(500)) return { status: 'busy' };
  try {
    var mode = want === 'on' && !rich300WatchCanSend_() ? 'preview' : want;
    out = RICH300_ENGINE.watchTick(rich300WatchEnv_(mode)); out.requested = want;
  } catch (err) { out = { status: 'exception', code: String(err && err.code || err && err.name || 'error').slice(0, 24) }; }
  finally { if (lk) lk.releaseLock(); }
  if (want !== 'preview') try { props.setProperty('watch:last', JSON.stringify({ at: t0, ms: Date.now() - t0, status: out.status, mode: out.mode || out.requested || want, requested: want, positions: out.positions || 0, events: out.events || 0, sent: out.sent || 0, failed: out.failed || 0, marketFail: out.marketFail || 0, code: out.code || null })); } catch (err) { /* 기록 실패는 무시 */ }
  return out;
}
/** 감시 트리거 설치/제거 — 같은 이름의 트리거만 교체한다. 다른 트리거(수신 폴링·일 마감·백업)는 건드리지 않는다. 승인 후 직접 실행. */
function rich300WatchInstallTrigger() {
  rich300WatchRemoveTrigger();
  ScriptApp.newTrigger('rich300WatchTick').timeBased().everyMinutes(5).create();
  return { ok: true, everyMinutes: 5 };
}
function rich300WatchRemoveTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'rich300WatchTick') ScriptApp.deleteTrigger(t); });
}

/**
 * 감시가 *지금 실제로* 꺼져 있는지 진단한다(읽기 전용: 속성 읽기·트리거 목록·가드 상태만, 시세·시트·텔레그램 호출 없음).
 *  prop: 'unset'(속성 없음) | 'off' | 'preview' | 'on' | 'invalid'(인식할 수 없는 값 — 길이만 표시, 동작은 꺼짐과 같음)
 *  effective: 실제 동작 — 'nothing'(아무것도 안 함) | 'preview-only' | 'sends'(전송 가능)
 */
function rich300WatchState_() {
  var props = PropertiesService.getScriptProperties(), raw = props.getProperty('RICH300_WATCH_ALERTS'), prop, v = raw === null || raw === undefined ? null : String(raw);
  if (v === null) prop = 'unset'; else { var t = v.trim().toLowerCase(); prop = t === 'on' ? 'on' : t === 'preview' ? 'preview' : t === 'off' ? 'off' : 'invalid'; }
  var triggers = ScriptApp.getProjectTriggers().filter(function (x) { return x.getHandlerFunction() === 'rich300WatchTick'; }).length;
  var gateBlocked = typeof rich300TgGate_ === 'function' ? !!rich300TgGate_('sendMessage') : true, paired = false;
  try { paired = !!RICH300_ENGINE.tgPairedUser(rich300TgEnv_()); } catch (err) { paired = false; }
  var canSend = !gateBlocked && paired, mode = rich300WatchMode_();
  var last = null; try { var raw2 = props.getProperty('watch:last'); last = raw2 ? JSON.parse(raw2) : null; } catch (err) { last = null; }
  return { prop: prop, invalidLen: prop === 'invalid' ? v.length : 0, mode: mode, gateBlocked: gateBlocked, paired: paired, triggers: triggers, last: last,
    effective: mode === 'off' ? 'nothing' : mode === 'preview' ? 'preview-only' : (canSend ? 'sends' : 'preview-only') };
}
/** ?p=watch — 소유자 전용. 기본 방문은 상태만 읽는다(시세 호출 없음). &run=1 은 미리보기, &net=1 은 시세 연결 점검(캐시 없이 새로 읽어 출처·응답 시간·신선도·오류 코드 표시). 둘 다 전송·트리거·속성 쓰기가 없다. */
/** 시세 연결 점검(읽기 전용): 보유 포지션 종목 + BTCUSDT 를 캐시 없이 새로 읽어 출처별 응답 시간·상태 코드·신선도를 돌려준다. 값(가격)은 돌려주지 않는다. */
function rich300WatchNetCheck_() {
  var E = RICH300_ENGINE, now = Date.now(), syms = ['BTCUSDT'];
  try { E.watchOpenPositions(rich300WatchEnv_('preview').storeEnv(), { now: now }).positions.forEach(function (p) { if (syms.indexOf(p.symbolId) < 0) syms.push(p.symbolId); }); } catch (err) { /* 시트 오류여도 BTCUSDT 점검은 한다 */ }
  return syms.slice(0, 6).map(function (sym) {
    var t0 = Date.now(), m = rich300WatchMarket_(sym, { noCache: true }), a = m.ok ? E.watchAssessMarket(m, now) : { ok: false, why: 'fetch-failed' }, last = function (b) { return b && b.length ? Math.round((now - b[b.length - 1].t) / 60000) : null; };
    return { symbol: sym, ok: !!(m.ok && a.ok), source: m.source, totalMs: Date.now() - t0, priceAgeSec: m.ok ? Math.round((now - m.priceAt) / 1000) : null, bar1hAgeMin: last(m.bars1h), bar4hAgeMin: last(m.bars4h), why: m.ok && a.ok ? null : (a.why || 'fetch-failed'), attempts: m.attempts };
  });
}
function rich300PageWatch_(e) {
  var t0 = Date.now(), p = (e && e.parameter) || {}, run = p.run === '1', net = p.net === '1', result = null, netRes = null, err = null;
  try { if (run) result = rich300WatchRun_('preview'); if (net) netRes = rich300WatchNetCheck_(); } catch (x) { err = RICH300_ENGINE.shellErrorCode(x); }
  var state = rich300WatchState_();
  var html = RICH300_ENGINE.shellRenderWatch({ state: state, result: result, net: netRes, ran: run || net, error: err, ms: Date.now() - t0, appUrl: rich300AppUrl_(), build: RICH300_BUILD });
  return rich300Html_(html, 'RICH300 감시 점검');
}

// ── gas/TgDiag.gs ──
/**
 * RICH 300 — Telegram 연결 진단과 *1회* 테스트 메시지(?p=tg). 소유자 전용. 토큰·채팅 ID·봇 이름은 화면·로그·반환값 어디에도 쓰지 않는다(존재 여부와 코드만).
 *  · 진단(기본 방문)은 속성·가드·트리거·마지막 폴링 기록만 읽는다 — 네트워크 호출 없음. &check=1 은 읽기 점검(getMe·getWebhookInfo, 메시지 없음)이며 기존 가드(읽기 승인 또는 운영 승인)를 따른다.
 *  · 테스트 메시지: 화면의 버튼 → 서버 함수 rich300TgTestSend(nonce). 중복 방지 장치: ① 화면을 열 때마다 만든 1회용 nonce(10분, 사용 즉시 폐기) ② 스크립트 락 ③ 보내기 *전에* 'pending' 기록 — 결과가 기록되지 않은 채 끝났다면 자동 재전송하지 않고 사용자 확인을 기다림 ④ 'sent'/'pending'/'acked' 상태에서는 거부.
 *    '못 받음'을 누르거나 API 실패일 때만 다시 시도할 수 있다(최대 3회). API 전송 성공('sent')과 사용자의 수신 확인('acked')은 따로 기록한다.
 *  · 전송은 기존 가드(rich300TgGate_)를 따른다. 운영 승인(RICH300_PROD_APPROVED)과 *별개*인 좁은 허용 RICH300_TG_TEST_OK=yes 는 getMe·getWebhookInfo, 이 파일의 '페어링 확인'(getUpdates 1회, 답장 없음)과 '테스트 메시지'(sendMessage 1건)만 통과시킨다 — 호출 목적은 화면의 명시적 동작 동안에만 설정된다(RICH300_GATE_PURPOSE_). 감시·폴링·추천 알림은 운영 승인 전까지 계속 차단된다.
 *  · 토큰 등록: 소유자 전용 입력창 → 서버로만 전달 → Script Properties 저장(화면·로그·반환값에 되돌려 주지 않음). 이미 토큰이 있으면 거부(교체는 편집기에서).
 */
var RICH300_TGTEST_KEY_ = 'tgdiag:test', RICH300_TGNONCE_KEY_ = 'tgdiag:nonce';
function rich300TgTestRead_() { try { var r = PropertiesService.getScriptProperties().getProperty(RICH300_TGTEST_KEY_); return r ? JSON.parse(r) : null; } catch (err) { return null; } }
function rich300TgTestWrite_(o) { PropertiesService.getScriptProperties().setProperty(RICH300_TGTEST_KEY_, JSON.stringify(o)); }
function rich300WithPurpose_(purpose, fn) { var prev = RICH300_GATE_PURPOSE_; RICH300_GATE_PURPOSE_ = purpose; try { return fn(); } finally { RICH300_GATE_PURPOSE_ = prev; } }
function rich300TgGateFor_(method, purpose) { return rich300WithPurpose_(purpose || '', function () { try { return typeof rich300TgGate_ === 'function' ? (rich300TgGate_(method) || null) : 'guard-missing'; } catch (err) { return 'error'; } }); }
function rich300TgDiagState_() {
  var props = PropertiesService.getScriptProperties(), paired = false, lastPoll = null, pairingActive = false;
  try { paired = !!RICH300_ENGINE.tgPairedUser(rich300TgEnv_()); } catch (err) { paired = false; }
  try { pairingActive = !paired && rich300TgEnv_().kv.get('pair') !== null; } catch (err) { pairingActive = false; }
  try { var l = JSON.parse(props.getProperty('tg:last') || 'null'); if (l) lastPoll = { ageMin: Math.round((Date.now() - l.at) / 60000), status: l.r && l.r.status }; } catch (err) { lastPoll = null; }
  var t = rich300TgTestRead_();
  return { env: props.getProperty('RICH300_ENV') || null, tokenSet: !!props.getProperty('RICH300_TG_TOKEN'), prodApproved: props.getProperty('RICH300_PROD_APPROVED') === 'yes', testAllow: props.getProperty('RICH300_TG_TEST_OK') === 'yes',
    gateSend: rich300TgGateFor_('sendMessage', ''), gateTestSend: rich300TgGateFor_('sendMessage', 'test-send'), gateRead: rich300TgGateFor_('getMe', ''), gatePair: rich300TgGateFor_('getUpdates', 'pair-poll'), paired: paired, pairingActive: pairingActive,
    pollTriggers: ScriptApp.getProjectTriggers().filter(function (x) { return x.getHandlerFunction() === 'rich300TgPoll'; }).length, lastPoll: lastPoll, test: t ? { state: t.state, code: t.code || null, at: t.at, tries: t.tries || 0 } : null };
}
function rich300PageTg_(e) {
  var p = (e && e.parameter) || {}, d = rich300TgDiagState_(), check = null, nonce = null;
  if (p.check === '1') {      // 읽기 점검: 가드가 허용할 때만, getMe·getWebhookInfo 두 호출(메시지 없음). 결과는 ok/코드/웹훅 유무만.
    var items = [];
    if (d.gateRead) items.push('막힘(' + d.gateRead + ') — 호출하지 않았습니다'); else if (!d.tokenSet) items.push('봇 토큰 속성이 없어 호출하지 않았습니다');
    else { var env = rich300TgEnv_(), me = RICH300_ENGINE.tgCall(env, 'getMe', {}), wh = RICH300_ENGINE.tgCall(env, 'getWebhookInfo', {}), r = wh.result || {};
      items.push('getMe: ' + (me.ok ? '성공' : '실패(' + me.code + ')')); items.push('getWebhookInfo: ' + (wh.ok ? '성공' : '실패(' + wh.code + ')')); if (wh.ok) { items.push('웹훅 설정: ' + (r.url ? '있음 — 폴링과 충돌합니다(설정을 바꾸지 않았습니다)' : '없음(정상)')); items.push('대기 중 업데이트: ' + Number(r.pending_update_count || 0) + '건'); } }
    check = { items: items };
  }
  if (!d.gateTestSend && d.paired && d.tokenSet && (!d.test || d.test.state === 'failed' || d.test.state === 'unacked')) { nonce = Utilities.getUuid().replace(/-/g, ''); PropertiesService.getScriptProperties().setProperty(RICH300_TGNONCE_KEY_, JSON.stringify({ n: nonce, at: Date.now() })); }
  return rich300Html_(RICH300_ENGINE.shellRenderTgDiag({ d: d, check: check, nonce: nonce, appUrl: rich300AppUrl_(), build: RICH300_BUILD }), 'RICH300 텔레그램 점검');
}
/** google.script.run 대상(소유자 전용). 반환: { ok, code } — 값 없음. 어떤 경우에도 자동 재전송하지 않는다. */
function rich300TgTestSend(nonce) {
  if (!rich300IsOwner_()) return { ok: false, code: 'forbidden' };
  var lock = LockService.getScriptLock(), props = PropertiesService.getScriptProperties();
  if (!lock.tryLock(5000)) return { ok: false, code: 'busy' };
  try {
    var n = null; try { n = JSON.parse(props.getProperty(RICH300_TGNONCE_KEY_) || 'null'); } catch (err) { n = null; }
    props.deleteProperty(RICH300_TGNONCE_KEY_);                                          // 1회용: 맞든 틀리든 즉시 폐기
    if (!n || !nonce || n.n !== String(nonce) || Date.now() - n.at > 600000) return { ok: false, code: 'bad-nonce' };
    var t = rich300TgTestRead_();
    if (t && (t.state === 'sent' || t.state === 'pending' || t.state === 'acked')) return { ok: false, code: 'already-' + t.state };
    if (t && (t.tries || 0) >= 3) return { ok: false, code: 'max-tries' };
    if (t && t.state === 'failed' && Date.now() - t.at < 60000) return { ok: false, code: 'cooldown' };
    var gate = rich300TgGateFor_('sendMessage', 'test-send'); if (gate) return { ok: false, code: 'blocked:' + gate };
    if (!props.getProperty('RICH300_TG_TOKEN')) return { ok: false, code: 'no-token' };
    var env = rich300TgEnv_(), paired = RICH300_ENGINE.tgPairedUser(env); if (!paired) return { ok: false, code: 'not-paired' };
    var tries = (t && t.tries || 0) + 1; rich300TgTestWrite_({ state: 'pending', at: Date.now(), tries: tries });          // 보내기 전에 기록
    var kst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
    var r = rich300WithPurpose_('test-send', function () { return RICH300_ENGINE.tgSendNotice(env, paired.chatId, '[RICH300 TEST]\n전송 점검 메시지 1건 · ' + kst + ' KST\nRICH300(Apps Script) 경로 확인용입니다. 추천·매매 알림이 아닙니다.\n이 메시지가 보이면 점검 화면에서 "받았음"을 눌러 주세요.'); });      // 목적(test-send)이 설정된 동안의 이 호출 하나만 테스트 허용 가드를 통과한다
    if (r && r.ok) { rich300TgTestWrite_({ state: 'sent', at: Date.now(), tries: tries }); return { ok: true, code: 'sent' }; }
    rich300TgTestWrite_({ state: 'failed', at: Date.now(), tries: tries, code: String(r && r.code || 'error').slice(0, 24) }); return { ok: false, code: String(r && r.code || 'error') };
  } catch (err) { return { ok: false, code: 'exception' }; }
  finally { lock.releaseLock(); }
}
function rich300TgTestAck(received) {
  if (!rich300IsOwner_()) return { ok: false, code: 'forbidden' };
  var t = rich300TgTestRead_(); if (!t || (t.state !== 'sent' && t.state !== 'pending')) return { ok: false, code: 'nothing-to-ack' };
  rich300TgTestWrite_({ state: received ? 'acked' : 'unacked', at: Date.now(), tries: t.tries || 1 }); return { ok: true, code: received ? 'acked' : 'unacked' };
}

/** 토큰 등록(소유자 전용, 토큰이 없을 때만). 값은 반환·로그·화면에 쓰지 않는다. 형식 확인 후 저장 → 가드가 허용하면 getMe 로 확인하고, 토큰이 거절되면 저장을 취소한다. */
function rich300TgSetToken(token) {
  if (!rich300IsOwner_()) return { ok: false, code: 'forbidden' };
  var props = PropertiesService.getScriptProperties(), lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) return { ok: false, code: 'busy' };
  try {
    var t = String(token === null || token === undefined ? '' : token).trim();
    if (props.getProperty('RICH300_TG_TOKEN')) return { ok: false, code: 'already-set' };
    if (!/^\d{6,12}:[A-Za-z0-9_-]{30,60}$/.test(t)) return { ok: false, code: 'bad-format' };
    props.setProperty('RICH300_TG_TOKEN', t); t = null;
    if (rich300TgGateFor_('getMe', '')) return { ok: true, code: 'saved-unverified' };       // 가드가 getMe 를 막고 있으면 저장만(허용 후 읽기 점검에서 확인)
    var me = RICH300_ENGINE.tgCall(rich300TgEnv_(), 'getMe', {});
    if (!me.ok && me.code === 'auth') { props.deleteProperty('RICH300_TG_TOKEN'); return { ok: false, code: 'token-rejected' }; }
    return { ok: true, code: me.ok ? 'saved-verified' : 'saved-unverified' };
  } catch (err) { return { ok: false, code: 'exception' }; }
  finally { lock.releaseLock(); }
}
/** 테스트 전송 허용 켜기/끄기(RICH300_TG_TEST_OK). 운영 승인(RICH300_PROD_APPROVED)은 이 화면에서 절대 바꾸지 않는다. 켤 때는 확인 문구가 필요하다. */
function rich300TgSetTestAllow(on, phrase) {
  if (!rich300IsOwner_()) return { ok: false, code: 'forbidden' };
  var props = PropertiesService.getScriptProperties();
  if (!on) { props.deleteProperty('RICH300_TG_TEST_OK'); return { ok: true, code: 'off' }; }
  if (!props.getProperty('RICH300_TG_TOKEN')) return { ok: false, code: 'no-token' };
  if (String(phrase || '').trim() !== '테스트 전송 허용') return { ok: false, code: 'bad-phrase' };
  props.setProperty('RICH300_TG_TEST_OK', 'yes'); return { ok: true, code: 'on' };
}
/** 페어링 코드 만들기(10분·1회용, 해시만 저장). 텔레그램 호출 없음. */
function rich300TgPairStart() {
  if (!rich300IsOwner_()) return { ok: false, code: 'forbidden' };
  var props = PropertiesService.getScriptProperties(); if (!props.getProperty('RICH300_TG_TOKEN')) return { ok: false, code: 'no-token' }; if (props.getProperty('RICH300_TG_TEST_OK') !== 'yes' && props.getProperty('RICH300_PROD_APPROVED') !== 'yes') return { ok: false, code: 'not-allowed' };
  var env = rich300TgEnv_(); if (RICH300_ENGINE.tgPairedUser(env)) return { ok: false, code: 'already-paired' };
  var r = RICH300_ENGINE.tgPairCreate(env); return { ok: true, code: 'created', pairCode: r.code, expiresAt: r.expiresAt };
}
/** 페어링 확인: getUpdates 를 *한 번* 읽어 `/start 코드` 를 찾는다(목적 pair-poll). 답장·다른 업데이트 처리 없음. */
function rich300TgPairCheck() {
  if (!rich300IsOwner_()) return { ok: false, code: 'forbidden' };
  var lk = typeof LockService.getUserLock === 'function' ? LockService.getUserLock() : null; if (lk && !lk.tryLock(3000)) return { ok: false, code: 'busy' };
  try {
    var gate = rich300TgGateFor_('getUpdates', 'pair-poll'); if (gate) return { ok: false, code: 'blocked:' + gate };
    var x = rich300WithPurpose_('pair-poll', function () { return RICH300_ENGINE.tgPairPoll(rich300TgEnv_()); });
    return x.status === 'error' ? { ok: false, code: String(x.code || 'error') } : { ok: true, code: x.status };
  } catch (err) { return { ok: false, code: 'exception' }; }
  finally { if (lk) lk.releaseLock(); }
}

// ── gas/Install.gs ──
/**
 * RICH 300 — 운영 설치 한 번에(rich300Install). 엔진 번들 + 나머지 gas 파일과 같은 프로젝트에 둔다. 여러 번 실행해도 안전하다(멱등).
 *  사용자가 직접 하는 일: ① 스크립트 속성에 RICH300_TG_TOKEN(기존 운영 봇 토큰) 입력 ② 웹 앱 배포 ③ 이 함수 실행(+권한 동의) ④ 운영 승인 속성(RICH300_PROD_APPROVED=yes) 입력 후 한 번 더 실행 ⑤ 휴대폰에서 페어링 링크 1회 탭.
 *  승인 전(RICH300_PROD_APPROVED 없음): 시트·챌린지(시작 300 USDT, 일 5% 목표)·마감/백업 트리거·자동 검증만 하고 *Telegram 호출은 하나도 하지 않는다*.
 *  승인 후: 봇 확인(getMe)·웹훅 점검·폴링 트리거·페어링 링크. 이미 설정된 웹훅이 있으면 지우지 않고 멈춘다. 기존 radar·GitHub 설정은 건드리지 않는다.
 *  출력은 상태(PASS/FAIL/WAIT)뿐이다. 토큰·키·이메일·시트 ID·금액은 출력하지 않는다. 데이터·시트·백업·트리거를 삭제하지 않는다(폴링 트리거는 같은 이름 것만 교체).
 */
function rich300Install() {
  var p = PropertiesService.getScriptProperties(), steps = [], add = function (id, status, text) { steps.push({ id: id, status: status, text: text }); };
  var setup = rich300Setup_('prod');
  if (!setup.ok) { add('I1', 'FAIL', '환경 설정 실패: ' + (setup.error || 'error') + (setup.note ? ' — ' + setup.note : '')); return rich300InstallFinish_(steps, null); }
  add('I1', 'PASS', '운영 환경·소유자·시트 설정' + (setup.sheetCreated ? '(시트 새로 생성)' : '(기존 시트 사용)'));
  var se = rich300GasEnv_(p.getProperty('RICH300_SHEET_ID')); RICH300_ENGINE.storeInit(se);
  try {
    var day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), ch = RICH300_ENGINE.storeSetupChallenge(se, { startEquity: '300', startDay: day, rate: '0.05' }, { actor: 'install' });
    add('I2', 'PASS', ch.status === 'conflict' ? '챌린지는 이미 설정되어 있어 그대로 둡니다(시작 자금·시작일 보존)' : '챌린지 설정: 시작 자금 300 USDT · 일 목표 5% · 시작일 ' + day + '(KST)');
  } catch (err) { add('I2', 'FAIL', '챌린지 설정 실패: ' + String(err && (err.code || err.message) || 'error').slice(0, 60)); }
  try { rich300InstallCloseTriggers(); rich300BackupInstallTrigger(); add('I3', 'PASS', '일 마감(KST 00:00)·백업 트리거 설치(마감 알림은 꺼짐, 승인 전 발송 없음)'); } catch (err) { add('I3', 'FAIL', '트리거 설치 실패(권한 동의 필요할 수 있음)'); }
  var url = rich300AppUrl_();
  if (url) { if (p.getProperty('RICH300_UI_URL') !== url) p.setProperty('RICH300_UI_URL', url); add('I4', 'PASS', '웹 앱 주소 확인(입력 화면 링크에 사용)'); }
  else add('I4', 'WAIT', '웹 앱이 아직 배포되지 않았습니다. 배포(실행: 접속한 사용자, 접근: 나만) 후 이 함수를 다시 실행하세요');
  if (!p.getProperty('verify:startedAt')) { try { rich300VerifyStart(); add('I5', 'PASS', '자동 검증 시작(몇 분 걸림, 결과는 점검 화면에서 확인)'); } catch (err) { add('I5', 'FAIL', '자동 검증을 시작하지 못했습니다(권한 동의 필요할 수 있음)'); } }
  else add('I5', 'PASS', '자동 검증은 이미 시작되어 있습니다');
  var link = null;
  if (!p.getProperty('RICH300_TG_TOKEN')) add('I6', 'WAIT', '스크립트 속성 RICH300_TG_TOKEN(기존 운영 봇 토큰)이 없습니다');
  else if (p.getProperty('RICH300_PROD_APPROVED') !== 'yes') {
    if (p.getProperty('RICH300_TG_READONLY_OK') === 'yes') { var bc = rich300BotCheck(); add('I6a', bc.ok ? 'PASS' : 'FAIL', bc.ok ? '봇 사전 점검(읽기 전용): 토큰 유효·웹훅 없음' : '봇 사전 점검(읽기 전용)에서 문제 발견 — 점검 화면(?p=check)의 봇 사전 점검 항목 참고'); }
    add('I6', 'WAIT', '운영 승인 대기: 스크립트 속성 RICH300_PROD_APPROVED=yes 를 넣고 이 함수를 다시 실행하면 봇 연결이 시작됩니다(그 전에는 쓰기 호출 0건)'); }
  else link = rich300InstallTelegram_(p, add);
  return rich300InstallFinish_(steps, link);
}
function rich300InstallTelegram_(p, add) {
  var env = rich300TgEnv_(), me = RICH300_ENGINE.tgCall(env, 'getMe', {});
  if (!me.ok) { add('I6', 'FAIL', '봇 토큰을 확인하지 못했습니다(' + (me.code === 'auth' ? '토큰 거절' : String(me.code || 'error')) + ')'); return null; }
  var wh = RICH300_ENGINE.tgCall(env, 'getWebhookInfo', {});
  if (!wh.ok) { add('I6', 'FAIL', '웹훅 상태를 확인하지 못했습니다'); return null; }
  if (wh.result && wh.result.url) { add('I6', 'FAIL', '이 봇에는 웹훅이 설정되어 있어 폴링을 쓸 수 없습니다. 설정을 지우지 않고 멈춥니다(승인 후 별도 조치)'); return null; }
  add('I6', 'PASS', '봇 확인 완료(웹훅 없음)');
  rich300TgInstallPollTrigger(1); add('I7', 'PASS', '폴링 트리거 설치(1분 간격)');
  if (RICH300_ENGINE.tgPairedUser(env)) { add('I8', 'PASS', 'Telegram 계정이 이미 연결되어 있습니다'); return null; }
  var code = RICH300_ENGINE.tgPairCreate(env).code, user = String(me.result && me.result.username || '').replace(/[^A-Za-z0-9_]/g, '');
  add('I8', 'WAIT', '휴대폰에서 아래 링크를 한 번 탭하세요(10분 안, 1회용). 본인만 연결됩니다');
  return user ? 'https://t.me/' + user + '?start=' + code : null;
}
function rich300InstallFinish_(steps, link) {
  var fail = steps.filter(function (s) { return s.status === 'FAIL'; }).length, wait = steps.filter(function (s) { return s.status === 'WAIT'; }).length;
  Logger.log('RICH300 설치: ' + (fail ? '실패 ' + fail : wait ? '진행 중(할 일 ' + wait + ')' : '완료') + '\n' + steps.map(function (s) { return '[' + s.status + '] ' + s.id + ' ' + s.text; }).join('\n') + (link ? '\n페어링 링크: ' + link : ''));
  return { ok: fail === 0, steps: steps, pairLink: link };
}

/** 봇 사전 점검(읽기 전용): getMe·getWebhookInfo 두 호출만. 메시지 전송·getUpdates·웹훅 변경·삭제 없음. 승인 전이면 RICH300_TG_READONLY_OK=yes(또는 운영 승인)가 필요하다. 결과는 점검 화면(?p=check)에도 나온다. */
function rich300BotCheck() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('RICH300_TG_TOKEN')) { Logger.log('RICH300 봇 점검: 스크립트 속성 RICH300_TG_TOKEN 이 없습니다'); return { ok: false, error: 'no-token' }; }
  if (p.getProperty('RICH300_TG_READONLY_OK') !== 'yes' && p.getProperty('RICH300_PROD_APPROVED') !== 'yes') { Logger.log('RICH300 봇 점검: 읽기 전용 점검 승인 전입니다. 스크립트 속성 RICH300_TG_READONLY_OK=yes 를 넣고 다시 실행하세요(getMe·getWebhookInfo 두 호출만 합니다)'); return { ok: false, error: 'not-approved' }; }
  var env = rich300TgEnv_(), me = RICH300_ENGINE.tgCall(env, 'getMe', {}), wh = RICH300_ENGINE.tgCall(env, 'getWebhookInfo', {}), r = wh.result || {};
  var info = { at: Date.now(), me: { ok: !!me.ok, code: me.ok ? null : String(me.code || 'error') }, wh: { ok: !!wh.ok, hasUrl: !!r.url, pending: Number(r.pending_update_count || 0), lastErrorAt: r.last_error_date ? 1 : 0, hasAllowed: !!(r.allowed_updates && r.allowed_updates.length) } };
  p.setProperty('botcheck:last', JSON.stringify(info));
  var items = RICH300_ENGINE.checkBotItems(info);
  Logger.log('RICH300 봇 점검(읽기 전용)\n' + items.map(function (i) { return '[' + i.status + '] ' + i.id + ' ' + i.text; }).join('\n'));
  return { ok: items.every(function (i) { return i.status !== 'FAIL'; }), items: items };
}
