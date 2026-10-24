// RICH 300 engine bundle — 자동 생성 파일(rich300/build.mjs). 직접 수정하지 마세요.

// ── decimal.mjs ──
// 고정소수점 십진수(BigInt, 단위 10^-12). 부동소수 오차 없이 가격·수량·금액을 계산한다.
//  · 내부 값 = 십진수 × 10^12 인 BigInt. 입력은 십진 문자열(권장), 숫자(소수 12자리로 반올림), 정수 BigInt(정수 단위).
//  · 문자열 입력은 소수 12자리를 넘으면 오류(조용히 반올림하지 않는다).
//  · 금액(USDT)은 장부 경계에서 마이크로 USDT(10^-6) 정수 BigInt로 반올림한다. 동률은 0에서 먼 쪽(half away from zero).
// 이 파일은 GAS 번들(build.mjs)로도 쓰이므로 최상위 이름이 다른 모듈과 겹치지 않아야 한다.
const DEC_SCALE = 10n ** 12n;
const DEC_MICRO_DIV = 10n ** 6n;
const DEC_DIGITS = 12;

function decRoundDiv(n, d) {                       // n/d 를 반올림(동률은 0에서 먼 쪽)
  if (d === 0n) throw new Error('0으로 나눌 수 없음');
  let q = n / d; const r = n % d;
  const twice = (r < 0n ? -r : r) * 2n, ad = d < 0n ? -d : d;
  if (twice >= ad) q += (n < 0n) === (d < 0n) ? 1n : -1n;
  return q;
}
function dec(x) {
  if (typeof x === 'bigint') return x * DEC_SCALE;
  if (typeof x === 'number') { if (!Number.isFinite(x) || Math.abs(x) >= 1e15) throw new Error(`숫자 범위 오류: ${x}`); x = x.toFixed(DEC_DIGITS); }
  if (typeof x !== 'string') throw new Error('숫자 형식 오류');
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(x.trim());
  if (!m) throw new Error(`숫자 형식 오류: ${String(x).slice(0, 24)}`);
  const frac = m[3] ?? '';
  if (frac.length > DEC_DIGITS) throw new Error(`소수 ${DEC_DIGITS}자리 초과: ${String(x).slice(0, 24)}`);
  const v = BigInt(m[2]) * DEC_SCALE + BigInt(frac.padEnd(DEC_DIGITS, '0'));
  return m[1] === '-' ? -v : v;
}
const decAdd = (a, b) => a + b;
const decSub = (a, b) => a - b;
const decNeg = a => -a;
const decAbs = a => (a < 0n ? -a : a);
const decMul = (a, b) => decRoundDiv(a * b, DEC_SCALE);
const decDiv = (a, b) => decRoundDiv(a * DEC_SCALE, b);
const decCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const decSign = a => (a < 0n ? -1 : a > 0n ? 1 : 0);
const decIsZero = a => a === 0n;
const decToMicro = a => decRoundDiv(a, DEC_MICRO_DIV);        // 십진수 → 마이크로 정수(반올림)
const microToDec = m => m * DEC_MICRO_DIV;
function decFormat(a, dp = 6) {                                // 문자열 표시(반올림)
  if (dp < 0 || dp > DEC_DIGITS) throw new Error('자릿수 범위 오류');
  const neg = a < 0n, unit = 10n ** BigInt(DEC_DIGITS - dp), v = decRoundDiv(neg ? -a : a, unit), p = 10n ** BigInt(dp);
  const s = `${v / p}${dp ? '.' + String(v % p).padStart(dp, '0') : ''}`;
  return neg && v !== 0n ? `-${s}` : s;
}
const microFormat = (m, dp = 6) => decFormat(microToDec(m), dp);
function microToNumber(m) {                                    // Sheets 등 배정밀도 저장용(안전 범위만)
  if (m > 9007199254740991n || m < -9007199254740991n) throw new Error('안전 정수 범위 초과');
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
  const frac = m[2] ?? '', den = 10n ** BigInt(frac.length), num = BigInt(m[1] + frac);
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
  let numer = startMicro, denom = 1n;
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
  const key = rec?.[keyField];
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
  return [...log, { ...prev, ...patch, key, rev: prev.rev + 1, prevRev: prev.rev, at: meta.at ?? null, reason: meta.reason ?? null }];
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
const PNL_E24_TO_MICRO = 10n ** 18n;                    // 10^-24 단위 → 마이크로(10^-6) 변환 나눗수

function pnlNormalizeAmount(a, name, nonNegative) {
  const state = a?.state ?? 'missing';
  if (!PNL_STATES.includes(state)) throw new Error(`${name} 상태 오류: ${state}`);
  if (state === 'missing') return { state, micro: 0n };
  if (a.amount === undefined || a.amount === null || a.amount === '') throw new Error(`${name} 금액 필요(상태 ${state})`);
  const micro = decToMicro(dec(a.amount));
  if (nonNegative && micro < 0n) throw new Error(`${name}은 0 이상이어야 함`);
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
  const sid = fills[0].sid, dir = fills[0].dir, sign = dir === 'LONG' ? 1n : -1n;
  let qty = 0n, cost = 0n, marginMicro = 0n, marginAll = true, first = true;
  const events = [], flags = new Set(), seen = new Set();
  for (const f of fills) {
    if (f.sid !== sid) throw new Error('한 번에 하나의 sid만 계산');
    if (f.dir !== dir) throw new Error(`방향이 일치하지 않음: ${f.fillId}`);
    if (seen.has(f.fillId)) throw new Error(`중복 fillId: ${f.fillId}`); seen.add(f.fillId);
    if (first && !['entry', 'opening'].includes(f.kind)) throw new Error('첫 체결은 entry 또는 opening이어야 함');
    if (!first && f.kind === 'entry') throw new Error('추가 진입은 kind=add');
    if (!first && f.kind === 'opening') throw new Error('opening은 첫 체결만');
    first = false;
    let grossMicro = 0n;
    if (PNL_ENTRY_KINDS.includes(f.kind)) {
      qty = decAdd(qty, f.qty); cost += f.price * f.qty;                                     // 원가: 반올림 없는 10^-24 단위
      if (f.kind !== 'opening') { if (f.margin === null) marginAll = false; else marginMicro += decToMicro(f.margin); }
    } else {
      if (f.qty > qty) throw new Error(`청산 수량(${decFormat(f.qty, 8)})이 보유 수량(${decFormat(qty, 8)})보다 큼: ${f.fillId}`);
      if (f.kind === 'close' && f.qty !== qty) throw new Error(`close는 잔량 전체여야 함: ${f.fillId}`);
      const removed = f.qty === qty ? cost : decRoundDiv(cost * f.qty, qty), proceeds = f.price * f.qty;   // 비례 원가(10^-24 단위, 오차 < 1e-24)
      grossMicro = decRoundDiv(sign === 1n ? proceeds - removed : removed - proceeds, PNL_E24_TO_MICRO);
      qty = decSub(qty, f.qty); cost = decSub(cost, removed);
    }
    events.push({ fillId: f.fillId, at: f.at, day: kstDayOf(f.at), kind: f.kind, grossMicro, feeMicro: f.fee.micro, feeState: f.fee.state, fundingMicro: f.funding.micro, fundingState: f.funding.state, qtyAfter: qty });
  }
  const t = { grossMicro: 0n, feeEnteredMicro: 0n, feeEstimatedMicro: 0n, feeMissingCount: 0, fundingEnteredMicro: 0n, fundingEstimatedMicro: 0n, fundingMissingCount: 0 };
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
  const status = qty === 0n ? 'closed' : 'open';
  const margin = marginAll && marginMicro > 0n ? marginMicro : null;
  return { sid, dir, status, openQty: decFormat(qty, 12), openQtyDec: qty, avgEntry: qty > 0n ? decFormat(decRoundDiv(cost, qty), 10) : null, costE24: cost, marginMicro: margin,
    roePpm: margin && status === 'closed' ? decRoundDiv(t.netEnteredMicro * 1000000n, margin) : null, totals: t, events, flags: [...flags] };
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
    const d = days.get(e.day) ?? { grossMicro: 0n, feeEnteredMicro: 0n, feeEstimatedMicro: 0n, fundingEnteredMicro: 0n, fundingEstimatedMicro: 0n, netEnteredMicro: 0n };
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
  if (impliedLev !== null && decAbs(decSub(impliedLev, lev)) * 20n > lev) flags.push('leverage-mismatch');           // 증거금·수량으로 계산한 레버리지가 입력과 5% 넘게 다름
  const liq = dir === 'LONG' ? decMul(e, decAdd(decSub(one, decDiv(one, lev)), r)) : decMul(e, decSub(decAdd(one, decDiv(one, lev)), r));   // 격리 마진 근사
  const liqBeforeStop = dir === 'LONG' ? liq >= s : liq <= s;
  if (liqBeforeStop && decSign(dist) > 0) flags.push('liquidation-before-stop');
  let riskPpm = null;
  if (equityMicro !== undefined && equityMicro !== null && equityMicro > 0n) { riskPpm = decRoundDiv(lossMicro * 1000000n, equityMicro); if (riskPpm > 20000n) flags.push('risk-over-2pct'); }
  return { notionalMicro: decToMicro(notional), impliedLeverage: impliedLev === null ? null : decFormat(impliedLev, 4), stopLossMicro: lossMicro, riskPpmOfEquity: riskPpm,
    liquidationApprox: decFormat(liq, 8), liquidationIsApproximate: true, liquidationBeforeStop: liqBeforeStop && decSign(dist) > 0, flags };
}
const riskMicroLabel = m => decFormat(microToDec(m), 2);

// ── ledger.mjs ──
// 일별 계좌 성장·목표·정합성 계산(순수 함수).
//  · 입출금은 매매 손익과 분리: 일 손익 = 마감 평가액 − 시작 평가액 − 당일 순입출금.
//  · 당일 목표 = 전일 *실제* 마감 잔고 × (1+목표율). 미달분을 다음 날에 더하지 않는다(compound.mjs).
//  · 실제 마감 = 사용자가 입력한 평가액. 없으면 장부 근사값(closeSource='ledger')으로 표시한다(숨기지 않음).
//  · 장부 잔고 = 시작 평가액 + 실현 순손익(입력된 수수료·펀딩만) + 입출금 + 명시 조정. 입력 평가액과의 차이는 항상 표시하고 자동으로 손익에 흡수하지 않는다.
//  · 시작 시 미결제 포지션은 시작 시점 마크가격을 새 기준가로 삼아(opening) 시작 이후 변동분만 반영한다.

const LEDGER_REVIEW_ABS_MICRO = 1000000n;        // 1 USDT
const LEDGER_REVIEW_PPM = 5000n;                  // 0.5%

const ledgerMicro = v => decToMicro(dec(v));
function ledgerUnique(list, keyField, label) {
  let out = [];
  for (const r of list ?? []) { const x = dedupeAppend(out, r, keyField); if (x.status === 'conflict') throw new Error(`${label} 충돌(같은 ${keyField}, 다른 내용): ${r[keyField]}`); out = x.list; }
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
  for (const c of uCash) { const k = kstDayOf(c.at); cashByDay.set(k, (cashByDay.get(k) ?? 0n) + ledgerMicro(c.amount)); }
  for (const a of uAdj) { const k = kstDayOf(a.at); adjByDay.set(k, (adjByDay.get(k) ?? 0n) + ledgerMicro(a.amount)); }
  for (const t of trades.values()) for (const e of t.events) {
    evs.push({ at: e.at, sid: t.sid, dir: t.dir, qtyAfter: e.qtyAfter });
    if (e.feeState === 'missing' || e.fundingState === 'missing') { const m = missingByDay.get(e.day) ?? new Set(); if (e.feeState === 'missing') m.add('fee-missing'); if (e.fundingState === 'missing') m.add('funding-missing'); missingByDay.set(e.day, m); }
  }
  evs.sort((a, b) => a.at - b.at); let evPtr = 0; const openQty = new Map();
  for (let i = 0; i < days.length; i++) {
    const day = days[i], endMs = dayEndMs(day), rate = compoundRateOn(day, schedule);
    const fl = flows.get(day) ?? { netEnteredMicro: 0n, grossMicro: 0n, feeEnteredMicro: 0n, feeEstimatedMicro: 0n, fundingEnteredMicro: 0n, fundingEstimatedMicro: 0n };
    const cash = cashByDay.get(day) ?? 0n, adj = adjByDay.get(day) ?? 0n;
    ledgerWallet += fl.netEnteredMicro + cash + adj;
    const target = compoundNextTarget(prevClose, rate);
    const eq = eqByDay.get(day) ?? null, equityIn = eq ? ledgerMicro(eq.equity) : null;
    // 그날 끝 미결제 포지션과 opening 기준 미실현 보정
    while (evPtr < evs.length && evs[evPtr].at < endMs) { const e = evs[evPtr++]; if (e.qtyAfter > 0n) openQty.set(e.sid, { dir: e.dir, qty: e.qtyAfter }); else openQty.delete(e.sid); }
    const openNow = [...openQty.entries()].map(([sid, v]) => ({ sid, dir: v.dir, openQtyDec: v.qty }));
    let openingU = 0n, openingUnknown = false;
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
      else if (openingUnknown) { uncertain = true; rowFlags.push('opening-basis-unknown'); expected = ledgerWallet + (unrl ?? 0n); }
      else expected = ledgerWallet + (unrl ?? 0n) - openingU;
      diffMicro = equityIn - expected;
      const rel = decRoundDiv((equityIn < 0n ? -equityIn : equityIn) * LEDGER_REVIEW_PPM, 1000000n), tol = rel > LEDGER_REVIEW_ABS_MICRO ? rel : LEDGER_REVIEW_ABS_MICRO;
      needsReview = (diffMicro < 0n ? -diffMicro : diffMicro) > tol;
      if (needsReview) rowFlags.push('ledger-mismatch');
      if (eq.late) rowFlags.push('late-entry');
    }
    // 실제 마감: 입력 평가액 우선, 없으면 장부 근사(미실현 미반영)
    const close = equityIn !== null ? equityIn : prevClose + cash + fl.netEnteredMicro + adj;
    const closeSource = equityIn !== null ? 'input' : 'ledger';
    if (closeSource === 'ledger') rowFlags.push('close-from-ledger');
    if (fl.feeEstimatedMicro || fl.fundingEstimatedMicro) rowFlags.push('has-estimates');
    for (const f of missingByDay.get(day) ?? []) if (!rowFlags.includes(f)) rowFlags.push(f);
    const pnl = close - prevClose - cash;
    rows.push({ day, n: i + 1, rate, startMicro: prevClose, targetCloseMicro: target.targetCloseMicro, targetProfitMicro: target.targetProfitMicro,
      idealMicro: ideal[i + 1].idealMicro, closeMicro: close, closeSource, cashflowMicro: cash, adjustmentMicro: adj, pnlMicro: pnl,
      achievementPpm: target.targetProfitMicro > 0n ? decRoundDiv(pnl * 1000000n, target.targetProfitMicro) : null,
      ledgerWalletMicro: ledgerWallet, expectedEquityMicro: expected, diffMicro, needsReview, uncertain,
      realizedGrossMicro: fl.grossMicro, feesEnteredMicro: fl.feeEnteredMicro, fundingEnteredMicro: fl.fundingEnteredMicro, openPositions: openNow.length, flags: rowFlags });
    prevClose = close;
  }
  return { rows, summary: ledgerSummarize(rows, startMicro), flags: inputFlags, trades };
}

// 요약: 누적 수익률(시작 자금 대비 단순), 최고 평가액, 최대 낙폭(입출금을 제거한 곡선 기준)
function ledgerSummarize(rows, startMicro) {
  if (!rows.length) return null;
  let cum = 0n, peak = startMicro, maxDd = 0n, maxDdPpm = 0n, highest = startMicro, met = 0, inputDays = 0, ledgerDays = 0, review = 0, curve = startMicro;
  for (const r of rows) {
    cum += r.cashflowMicro; curve = r.closeMicro - cum;
    if (curve > peak) peak = curve;
    const dd = peak - curve; if (dd > maxDd) { maxDd = dd; maxDdPpm = peak > 0n ? decRoundDiv(dd * 1000000n, peak) : 0n; }
    if (r.closeMicro > highest) highest = r.closeMicro;
    if (r.targetProfitMicro > 0n && r.pnlMicro >= r.targetProfitMicro) met++;
    if (r.closeSource === 'input') inputDays++; else ledgerDays++;
    if (r.needsReview) review++;
  }
  const last = rows[rows.length - 1], pnlTotal = last.closeMicro - startMicro - cum, curDd = peak - curve;
  return { startMicro, latestCloseMicro: last.closeMicro, netCashflowMicro: cum, pnlTotalMicro: pnlTotal, returnOnStartPpm: startMicro > 0n ? decRoundDiv(pnlTotal * 1000000n, startMicro) : null,
    highestEquityMicro: highest, maxDrawdownMicro: maxDd, maxDrawdownPpm: maxDdPpm, currentDrawdownMicro: curDd, currentDrawdownPpm: peak > 0n ? decRoundDiv(curDd * 1000000n, peak) : 0n,
    daysTargetMet: met, days: rows.length, daysWithInput: inputDays, daysLedgerOnly: ledgerDays, daysNeedingReview: review, idealLatestMicro: last.idealMicro, gapToIdealMicro: last.closeMicro - last.idealMicro };
}
const ledgerMicroLabel = (m, dp = 2) => decFormat(microToDec(m), dp);

// ── schema.mjs ──
// RICH 300 저장소 스키마: 엔티티 정의·검증·정규화. 순수 함수(저장소·시간 의존 없음).
//  · 모든 금액·가격·수량은 *정규 십진 문자열*로 저장한다("100.0"·100·"100" → "100"), 부동소수·BigInt 미사용 → 같은 값은 항상 같은 기록(중복 판정 일관).
//  · 기본값으로 기록을 만들지 않는다: 복기는 계획 준수·심리를 *명시적으로* 모두 받아야 저장된다.

const SCHEMA_VERSION = 1;
class StoreError extends Error { constructor(code, message, detail) { super(message); this.code = code; this.detail = detail ?? null; } }
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
    normalize: d => strip({ sid: needStr(d.sid, 'sid', 80), strategy: needEnum(d.strategy, ['A', 'B'], 'strategy'), symbolId: /^[A-Z0-9]{2,20}USDT$/.test(d.symbolId ?? '') ? d.symbolId : bad('symbolId 형식 오류'), dir: needEnum(d.dir, ['LONG', 'SHORT'], 'dir'),
      signalAt: needMs(d.signalAt, 'signalAt'), entry: schemaDecString(d.entry, 'entry', { positive: true }), stop: schemaDecString(d.stop, 'stop', { positive: true }), tp1: schemaDecString(d.tp1, 'tp1', { positive: true }), tp2: optDec(d.tp2, 'tp2', { positive: true }), summary: d.summary === undefined ? undefined : needStr(d.summary, 'summary', 120) }),
    display: d => [d.sid, d.strategy, d.dir, d.symbolId, kst(d.signalAt)] },
  response: { sheet: 'Responses', keyOf: d => d.sid, headers: ['sid', 'choice', 'atKst'],
    normalize: d => ({ sid: needStr(d.sid, 'sid', 80), choice: needEnum(d.choice, RESPONSE_CHOICES, 'choice'), at: needMs(d.at, 'at') }), display: d => [d.sid, d.choice, kst(d.at)] },
  fill: { sheet: 'Fills', keyOf: d => d.fillId, headers: ['sid', 'kind', 'dir', 'atKst', 'price', 'qty'],
    normalize: d => {
      if (d.origin !== 'real') bad(`실제 체결만 저장(origin=real): ${d.origin}`);
      const price = schemaDecString(d.price, 'price', { positive: true }), qty = schemaDecString(d.qty, 'qty', { positive: true });
      const amt = (a, n, nn) => { const st = a?.state ?? 'missing'; if (!['entered', 'estimated', 'missing'].includes(st)) bad(`${n} 상태 오류`); return st === 'missing' ? { state: 'missing' } : { state: st, amount: schemaDecString(a.amount, `${n} 금액`, nn ? { nonNegative: true } : {}) }; };
      const out = strip({ origin: 'real', fillId: needStr(d.fillId, 'fillId', 80), sid: needStr(d.sid, 'sid', 80), kind: d.kind, dir: d.dir, at: needMs(d.at, 'at'), price, qty,
        margin: optDec(d.margin, 'margin', { positive: true }), leverage: optDec(d.leverage, 'leverage', { positive: true }), plannedStop: optDec(d.plannedStop, 'plannedStop', { positive: true }), qtySource: d.qtySource === undefined ? undefined : needEnum(d.qtySource, ['entered', 'derived'], 'qtySource'),
        fee: amt(d.fee, '수수료', true), funding: amt(d.funding, '펀딩', false), note: d.note === undefined ? undefined : needStr(d.note, 'note', 300) });
      try { pnlNormalizeFill(out); } catch (e) { bad(e.message); } return out;
    }, display: d => [d.sid, d.kind, d.dir, kst(d.at), d.price, d.qty] },
  cashflow: { sheet: 'Cashflows', keyOf: d => d.cfId, headers: ['atKst', 'amount'],
    normalize: d => strip({ cfId: needStr(d.cfId, 'cfId', 80), at: needMs(d.at, 'at'), amount: schemaDecString(d.amount, 'amount', { nonZero: true }), note: d.note === undefined ? undefined : needStr(d.note, 'note', 200) }), display: d => [kst(d.at), d.amount] },
  equity: { sheet: 'Equity', keyOf: d => d.day, headers: ['day', 'equity', 'unrealized', 'late'],
    normalize: d => strip({ day: needDay(d.day, 'day'), equity: schemaDecString(d.equity, 'equity', { nonNegative: true }), unrealized: optDec(d.unrealized, 'unrealized'), late: d.late === true ? true : undefined, enteredAt: d.enteredAt === undefined ? undefined : needMs(d.enteredAt, 'enteredAt') }), display: d => [d.day, d.equity, d.unrealized ?? '', d.late ? 'late' : ''] },
  opening: { sheet: 'OpeningPositions', keyOf: d => d.sid, headers: ['sid', 'dir', 'qty', 'startMark', 'origEntry'],
    normalize: d => strip({ sid: needStr(d.sid, 'sid', 80), dir: needEnum(d.dir, ['LONG', 'SHORT'], 'dir'), qty: schemaDecString(d.qty, 'qty', { positive: true }), startMark: schemaDecString(d.startMark, 'startMark', { positive: true }), origEntry: optDec(d.origEntry, 'origEntry', { positive: true }) }), display: d => [d.sid, d.dir, d.qty, d.startMark, d.origEntry ?? ''] },
  review: { sheet: 'Reviews', keyOf: d => d.sid, headers: ['sid', 'plan', 'mind', 'savedAtKst'],
    normalize: d => strip({ sid: needStr(d.sid, 'sid', 80), plan: needEnum(d.plan, PLAN_CHOICES, '계획 준수'), mind: needEnum(d.mind, MIND_CHOICES, '심리 상태'), memo: d.memo === undefined || d.memo === '' ? undefined : needStr(d.memo, 'memo', 500), savedAt: needMs(d.savedAt, 'savedAt') }), display: d => [d.sid, d.plan, d.mind, kst(d.savedAt)] },
  adjustment: { sheet: 'Adjustments', keyOf: d => d.adjId, headers: ['atKst', 'amount', 'reason'],
    normalize: d => ({ adjId: needStr(d.adjId, 'adjId', 80), at: needMs(d.at, 'at'), amount: schemaDecString(d.amount, 'amount', { nonZero: true }), reason: needStr(d.reason, '조정 사유', 200) }), display: d => [kst(d.at), d.amount, d.reason] },
  // R7 일 마감: 마감 시점의 스냅샷(불변, 같은 날짜는 한 번만) · 마감 알림 상태(리비전으로 pending→sent/failed)
  dayclose: { sheet: 'DayCloses', immutable: true, keyOf: d => d.day, headers: ['day', 'closedAtKst', 'source', 'diff'],
    normalize: d => strip({ day: needDay(d.day, 'day'), closedAt: needMs(d.closedAt, 'closedAt'), source: needEnum(d.source, ['input', 'ledger'], 'source'), startMicro: needIntStr(d.startMicro, 'startMicro'), targetMicro: needIntStr(d.targetMicro, 'targetMicro'),
      closeMicro: needIntStr(d.closeMicro, 'closeMicro'), pnlMicro: needIntStr(d.pnlMicro, 'pnlMicro'), walletMicro: needIntStr(d.walletMicro, 'walletMicro'), diffMicro: d.diffMicro === undefined || d.diffMicro === null ? undefined : needIntStr(d.diffMicro, 'diffMicro'), needsReview: d.needsReview === true, flags: needFlags(d.flags, 'flags') }),
    display: d => [d.day, kst(d.closedAt), d.source, d.diffMicro ?? ''] },
  closenotice: { sheet: 'CloseNotices', keyOf: d => d.day, headers: ['day', 'status', 'attempts'],
    normalize: d => { const n = d.attempts; if (!Number.isInteger(n) || n < 0 || n > 9) bad('attempts는 0~9 정수'); return strip({ day: needDay(d.day, 'day'), status: needEnum(d.status, ['pending', 'sent', 'failed', 'off', 'unknown'], 'status'), attempts: n, at: needMs(d.at, 'at'), error: d.error === undefined || d.error === null ? undefined : needStr(String(d.error), 'error', 40) }); },
    display: d => [d.day, d.status, String(d.attempts)] },
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
//  · 추가 전용: 엔티티 시트는 *모든 리비전*을 행으로 쌓는다(삭제·덮어쓰기 없음). 현재 값은 키별 최대 rev. 취소는 void 리비전.
//  · 선기록(WAL): 쓰기 = ① Audit 행 추가(해시 체인, 변경 후 전체 내용 포함) → ② 엔티티 시트 행 추가. ②에서 중단돼도 다음 쓰기·읽기가 Audit의 끝부분에서 복구한다. 먼저 ①이 실패하면 아무것도 바뀌지 않는다.
//  · 모든 쓰기는 스크립트 락 안에서 직렬화한다. 락을 못 얻으면 LOCK 오류(호출자가 재시도, 같은 키는 멱등).
//  · 데이터 JSON은 정규 십진 문자열 + 키 정렬 JSON → 같은 내용은 같은 문자열(중복·변조 판정이 결정적).

const STORE_ZERO_HASH = '0'.repeat(64), STORE_TAIL = 5;
const storeEntity = n => ENTITIES[n] ?? (() => { throw new StoreError('VALIDATION', `알 수 없는 엔티티: ${n}`); })();
const storeCell = v => { if (v instanceof Date) throw new StoreError('INTEGRITY', 'Date로 변환된 셀 — 시트 열을 텍스트 서식으로 지정해야 함'); return v === null || v === undefined ? '' : String(v); };
const storeParse = (s, where) => { try { return JSON.parse(s); } catch { throw new StoreError('INTEGRITY', `JSON 손상: ${where}`); } };
const storeInt = (v, where) => { const n = Number(storeCell(v)); if (!Number.isInteger(n)) throw new StoreError('INTEGRITY', `정수 아님: ${where}`); return n; };

function storeInit(env) {
  for (const n of ENTITY_NAMES) env.sheets.ensure(storeEntity(n).sheet, VIEW_HEADERS(n));
  env.sheets.ensure(AUDIT_SHEET, AUDIT_HEADERS); env.sheets.ensure(META_SHEET, META_HEADERS);
  const ver = env.sheets.rows(META_SHEET).filter(r => storeCell(r[0]) === 'schemaVersion').map(r => storeCell(r[1])).pop();
  if (ver === undefined) env.sheets.append(META_SHEET, [['schemaVersion', String(SCHEMA_VERSION), String(env.now())]]);
  else if (Number(ver) !== SCHEMA_VERSION) throw new StoreError('SCHEMA', `스키마 버전 불일치: ${ver} (기대 ${SCHEMA_VERSION})`);
}

// ── 읽기 ──
function storeReadAudit(env) {
  return env.sheets.rows(AUDIT_SHEET).map((r, i) => ({ seq: storeInt(r[0], `audit[${i}].seq`), recordedAt: storeInt(r[1], `audit[${i}].at`), entity: storeCell(r[2]), key: storeCell(r[3]), rev: storeInt(r[4], `audit[${i}].rev`), op: storeCell(r[5]),
    actor: storeCell(r[6]), reason: storeCell(r[7]), before: storeCell(r[8]), after: storeCell(r[9]), prevHash: storeCell(r[10]), hash: storeCell(r[11]) }));
}
function storeReadView(env, entityName) {
  return env.sheets.rows(storeEntity(entityName).sheet).map((r, i) => ({ key: storeCell(r[0]), rev: storeInt(r[1], `${entityName}[${i}].rev`), void: storeCell(r[2]) === '1', recordedAt: storeInt(r[3], `${entityName}[${i}].at`), raw: storeCell(r[4]), data: storeParse(storeCell(r[4]), `${entityName}[${i}]`) }));
}
function storeLatestMap(env, entityName, audit) {      // 엔티티 시트 + 아직 반영되지 않은 Audit 끝부분(복구 대기)을 합쳐 키별 최신 리비전
  const m = new Map(), put = r => { const p = m.get(r.key); if (!p || r.rev > p.rev) m.set(r.key, r); };
  const have = new Set();
  for (const r of storeReadView(env, entityName)) { put(r); have.add(`${r.key}|${r.rev}`); }
  for (const e of audit.slice(-STORE_TAIL)) if (e.entity === entityName && !have.has(`${e.key}|${e.rev}`)) put({ key: e.key, rev: e.rev, void: e.op === 'void', recordedAt: e.recordedAt, raw: e.after, data: storeParse(e.after, `audit#${e.seq}`), pending: true });
  return m;
}
const storeGet = (env, entityName, key) => storeLatestMap(env, entityName, storeReadAudit(env)).get(key) ?? null;
function storeList(env, entityName, { includeVoid = false } = {}) {
  const out = [...storeLatestMap(env, entityName, storeReadAudit(env)).values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return includeVoid ? out : out.filter(r => !r.void);
}
function storeHistory(env, entityName, key) {
  const audit = storeReadAudit(env), seen = new Map();
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
  for (const e of storeReadAudit(env).slice(-STORE_TAIL)) {
    const has = storeReadView(env, e.entity).some(r => r.key === e.key && r.rev === e.rev);
    if (!has) { storeApplyView(env, e); fixed.push(`${e.entity}|${e.key}|${e.rev}`); }
  }
  return fixed;
}
function storeWithLock(env, fn) {
  if (!env.lock.tryLock(env.lockTimeoutMs ?? 10000)) throw new StoreError('LOCK', '다른 작업이 저장 중입니다(잠시 후 재시도)');
  try { const recovered = storeRecoverTail(env); return fn(recovered); } finally { env.lock.release(); }
}
function storeCommit(env, { entity, key, rev, op, actor, reason, before, after }) {
  if (typeof actor !== 'string' || !actor) throw new StoreError('VALIDATION', 'actor 필요');
  const audit = storeReadAudit(env), last = audit[audit.length - 1];
  const e = { seq: last ? last.seq + 1 : 1, recordedAt: env.now(), entity, key, rev, op, actor, reason: reason ?? '', before: before ? dedupeCanonical(before) : '', after: dedupeCanonical(after), prevHash: last ? last.hash : STORE_ZERO_HASH };
  e.hash = storeHash(env, e);
  env.sheets.append(AUDIT_SHEET, [storeAuditRow(e)]);   // ① 선기록(여기서 실패하면 변경 없음)
  storeApplyView(env, e);                                // ② 엔티티 행(여기서 중단돼도 다음 쓰기/읽기가 복구)
  return e;
}
function storeCreate(env, entityName, raw, { actor }) {
  const E = storeEntity(entityName), data = E.normalize(raw), key = E.keyOf(data);
  return storeWithLock(env, () => {
    const cur = storeLatestMap(env, entityName, storeReadAudit(env)).get(key);
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
    const cur = storeLatestMap(env, entityName, storeReadAudit(env)).get(key);
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
    const cur = storeLatestMap(env, entityName, storeReadAudit(env)).get(key);
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
  if (cur.data.plan === plan && cur.data.mind === mind && (cur.data.memo ?? '') === (memo ?? '')) return { status: 'unchanged', key: sid, rev: cur.rev };
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
    const kk = `${e.entity}|${e.key}`, exp = (lastRev.get(kk) ?? 0) + 1;
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
  catch (e) { if (e instanceof StoreError && e.code === 'LOCK') throw e; if (copy) { try { env.drive.trash(copy.id); } catch { /* 정리 실패는 무시 */ } } return { status: 'copy-failed', name, warnings }; }
  let ci, cf;
  try { const cs = env.drive.openStore(copy.id); ci = storeIntegrityCheck(cs); cf = backupFingerprint(cs); } catch { ci = { ok: false, issues: [{ type: 'open-failed' }] }; cf = null; }
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
function deployGate(p, method) {                    // 허용이면 null, 차단이면 사유 문자열
  if (p.env !== 'test' && p.env !== 'prod') return 'env-unset';
  if (p.env === 'prod') return p.prodApproved === 'yes' ? null : 'prod-not-approved';
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
  add('timezone', info.tz === 'Asia/Seoul', 'fail', `프로젝트 시간대는 Asia/Seoul 이어야 합니다(현재: ${info.tz ?? '알 수 없음'})`);
  add('v8', info.v8 === true, 'fail', 'V8 런타임(BigInt 지원)이 필요합니다');
  add('sheet', info.has.sheetId, 'fail', '스프레드시트 ID(RICH300_SHEET_ID)가 설정되어야 합니다');
  add('owner', info.has.ownerEmail, 'fail', '소유자 이메일(RICH300_OWNER_EMAIL)이 없으면 화면 접근이 모두 차단됩니다');
  add('ingest-key', info.has.ingestKey ? info.ingestKeyLen >= 32 : false, info.has.ingestKey ? 'fail' : 'warn', info.has.ingestKey ? '수신 키는 32자 이상이어야 합니다' : '수신 키(RICH300_INGEST_KEY)가 없어 신호 수신이 꺼져 있습니다');
  add('telegram-token', info.has.tgToken, 'warn', 'Telegram 봇 토큰(RICH300_TG_TOKEN)이 없어 Telegram 기능이 꺼져 있습니다');
  add('ui-url', info.has.uiUrl, 'warn', '입력 화면 URL(RICH300_UI_URL, https)이 없어 알림·버튼에 링크가 들어가지 않습니다');
  if (info.env === 'test') {
    add('test-no-prod-flags', !(info.flags.closeSendApproved || info.flags.prodApproved), 'fail', '테스트 프로젝트에 운영 승인 플래그(RICH300_PROD_APPROVED·RICH300_CLOSE_SEND_APPROVED)가 있습니다 — 제거하세요');
  }
  if (info.env === 'prod') add('prod-gate', true, 'warn', info.flags.prodApproved ? '운영 승인 플래그가 켜져 있어 Telegram 호출이 허용됩니다' : '운영 승인 전: Telegram 호출이 차단되어 있습니다(정상)');
  add('integrity', info.integrity ? info.integrity.ok : false, 'fail', info.integrity ? `저장소 무결성 문제: ${info.integrity.issues.join(', ')}` : '저장소를 열 수 없습니다');
  add('env-marker', info.envMarker ? info.envMarker.ok : false, 'fail', info.envMarker ? `시트의 환경 표식(${info.envMarker.actual ?? '없음'})이 이 프로젝트(${info.env})와 다릅니다` : '시트 환경 표식을 확인할 수 없습니다');
  add('owner-visible', info.owner.activeEmailVisible === true, 'warn', '실행 중 사용자 이메일을 읽을 수 없습니다 — "접속한 사용자로 실행" 배포가 아니면 UI 소유자 확인이 항상 거부됩니다(S0 ④ 확인 필요)');
  const need = info.expectTriggers ?? ['rich300CloseTick', 'rich300TgPoll', 'rich300BackupRun'], have = new Set(info.triggers);
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
  const ts = env.now(), n = nonce ?? env.newNonce();
  if (!AUTH_NONCE_RE.test(n)) throw new Error('nonce 형식 오류');
  return JSON.stringify({ v: AUTH_VERSION, ts, nonce: n, body, sig: env.hmacSha256(key, authSignedString(AUTH_VERSION, ts, n, body)) });
}
const fail = (env, reason) => { try { env.counter?.(`auth-fail:${reason}`); } catch { /* 카운터 실패는 무시 */ } return { ok: false, reason }; };

function authVerify(env, raw) {
  if (typeof raw !== 'string') return fail(env, 'bad-format');
  if (raw.length > AUTH_MAX_BYTES) return fail(env, 'too-large');
  let msg; try { msg = JSON.parse(raw); } catch { return fail(env, 'bad-format'); }
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return fail(env, 'bad-format');
  const keys = Object.keys(msg).sort().join(',');
  if (keys !== 'body,nonce,sig,ts,v') return fail(env, 'bad-format');                         // 알 수 없는 필드·누락 거부(모호성 제거)
  if (msg.v !== AUTH_VERSION) return fail(env, 'bad-version');
  if (!Number.isSafeInteger(msg.ts)) return fail(env, 'bad-format');
  if (typeof msg.nonce !== 'string' || !AUTH_NONCE_RE.test(msg.nonce)) return fail(env, 'bad-format');
  if (typeof msg.sig !== 'string' || !AUTH_SIG_RE.test(msg.sig)) return fail(env, 'bad-format');
  if (Math.abs(env.now() - msg.ts) > AUTH_WINDOW_MS) return fail(env, 'stale');
  let signed; try { signed = authSignedString(msg.v, msg.ts, msg.nonce, msg.body); } catch { return fail(env, 'bad-body'); }
  let candidates; try { candidates = env.getKeys().filter(k => typeof k === 'string' && k.length > 0); } catch { return fail(env, 'misconfigured'); }
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
  try { auth = authVerify(env, raw); } catch { return { ...INGEST_UNAUTHORIZED }; }
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
const tgKvGet = (env, k) => { const raw = env.kv.get(k); if (raw === null || raw === undefined) return null; let o; try { o = JSON.parse(raw); } catch { return null; } if (o.exp && env.now() >= o.exp) { env.kv.del(k); return null; } return o.v; };
const tgKvPut = (env, k, v, ttlSec) => env.kv.put(k, JSON.stringify({ v, exp: ttlSec ? env.now() + ttlSec * 1000 : 0 }));

// ── Telegram 호출(재시도·오류 분류) ──
function tgClassify(status, description) {
  const d = String(description ?? '').toLowerCase();
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
    let res; try { res = env.http.call(method, payload); } catch { res = { status: 0, body: null }; }
    const status = Number(res?.status ?? 0), body = res?.body ?? null;
    if (status === 200 && body && body.ok === true) return { ok: true, result: body.result, attempts };
    const code = tgClassify(status, body?.description), retryAfterSec = Number(body?.parameters?.retry_after ?? 0);
    const retryable = code === 'network' || code === 'server' || code === 'rate-limit';
    let wait = code === 'rate-limit' ? Math.max(retryAfterSec, 1) * 1000 : attempts * 500;
    if (retryable && attempts < TG_MAX_ATTEMPTS && wait <= TG_MAX_WAIT_MS) { env.sleep(wait); continue; }
    return { ok: false, status, code, retryable, benign: TG_BENIGN.includes(code), retryAfterSec: code === 'rate-limit' ? retryAfterSec : undefined, attempts };
  }
}
const tgPrefix = env => (typeof env.msgPrefix === 'string' ? env.msgPrefix : '');            // 테스트 환경은 모든 메시지 앞에 '[TEST] '
const tgSend = (env, chatId, text, markup) => tgCall(env, 'sendMessage', { chat_id: chatId, text: tgPrefix(env) + text, disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) });
const tgEdit = (env, cb, text, markup) => tgCall(env, 'editMessageText', { chat_id: cb.chatId, message_id: cb.messageId, text: tgPrefix(env) + text, reply_markup: markup ?? { inline_keyboard: [] } });
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
    const cm = c.message; return { kind: 'callback', updateId: u.update_id, fromId: c.from.id, chatId: cm?.chat && Number.isSafeInteger(cm.chat.id) ? cm.chat.id : null, chatType: cm?.chat?.type, isBot: c.from.is_bot === true, cbId: c.id, data: typeof c.data === 'string' ? c.data.slice(0, 64) : '', messageId: Number.isSafeInteger(cm?.message_id) ? cm.message_id : null };
  }
  return null;
}
function tgParseCommand(text) {
  const t = String(text ?? '').trim(); if (!t.startsWith('/')) return null;
  const parts = t.split(/\s+/), cmd = parts[0].slice(1).split('@')[0].toLowerCase(), pos = [], opt = {};
  for (const p of parts.slice(1)) { const i = p.indexOf('='); if (i > 0) opt[p.slice(0, i).toLowerCase()] = p.slice(i + 1); else pos.push(p); }
  return { cmd, pos, opt };
}
function tgAmount(raw, name) {                         // "0.12" 입력, "~0.12" 추정, 비우면 미입력
  if (raw === undefined || raw === '') return { state: 'missing' };
  const est = raw.startsWith('~'), v = est ? raw.slice(1) : raw;
  return { state: est ? 'estimated' : 'entered', amount: schemaDecString(v, name) };
}
const tgUserErr = (msg) => new StoreError('USER', msg);

// ── 페어링 ──
function tgPairCreate(env) {                    // UI(소유자 로그인)에서 호출: 10분·1회용 코드. 해시만 저장한다.
  const code = Array.from({ length: 8 }, () => TG_PAIR_ALPHABET[env.randomInt(TG_PAIR_ALPHABET.length)]).join('');
  tgKvPut(env, 'pair', { hash: env.sha256(`rich300-pair|${code}`) }, TG_PAIR_TTL_SEC); tgKvPut(env, 'pairfail', { n: 0 }, TG_PAIR_TTL_SEC);
  return { code, expiresAt: env.now() + TG_PAIR_TTL_SEC * 1000 };
}
const tgPairedUser = env => tgKvGet(env, 'paired');
function tgPairAttempt(env, ev, code) {                // 실패는 무응답(봇 존재·코드 유무를 알려 주지 않음). 5회 실패 시 코드 폐기.
  const rec = tgKvGet(env, 'pair'), fails = tgKvGet(env, 'pairfail') ?? { n: 0 };
  if (!rec || fails.n >= TG_PAIR_MAX_FAILS || ev.chatType !== 'private' || ev.isBot) return { status: 'ignored', action: 'pair-rejected' };
  const ok = authTimingSafeEqual(rec.hash, env.sha256(`rich300-pair|${String(code ?? '').toUpperCase()}`));
  if (!ok) { fails.n++; tgKvPut(env, 'pairfail', fails, TG_PAIR_TTL_SEC); if (fails.n >= TG_PAIR_MAX_FAILS) env.kv.del('pair'); return { status: 'ignored', action: 'pair-rejected' }; }
  env.kv.del('pair'); env.kv.del('pairfail'); tgKvPut(env, 'paired', { userId: ev.fromId, chatId: ev.chatId, at: env.now() });
  const s = tgSend(env, ev.chatId, 'RICH300 연결 완료. 이 계정만 응답합니다. /help');
  return { status: 'handled', action: 'paired', replyFailed: !s.ok };
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
  try { const l = storeBuildLedger(env.storeEnv(), { throughDay: kstDayOf(env.now()) }); const r = l.rows[l.rows.length - 1]; return r ? r.startMicro : null; } catch { return null; }
}
function tgBuildEntry(env, p) {                 // p: { sid, margin, leverage, entry, stop, qty?, fee?, funding? } (문자열)
  const se = env.storeEnv(), sg = storeGet(se, 'signal', p.sid);
  if (!sg || sg.void) throw tgUserErr(`알 수 없는 신호: ${String(p.sid).slice(0, 40)}`);
  const resp = storeGet(se, 'response', p.sid);
  if (resp && !resp.void && resp.data.choice !== 'entered') throw tgUserErr(`이 신호는 '${RESPONSE_CHOICES[resp.data.choice]}'로 기록돼 있어 진입을 기록할 수 없습니다(수정은 앱에서)`);
  const fills = tgFillsOf(se, p.sid), trade = fills.length ? tgTradeOrUserError(fills) : null;
  if (trade && trade.status === 'closed') throw tgUserErr('이미 청산된 신호입니다');
  const kind = trade ? 'add' : 'entry';
  const margin = schemaDecString(p.margin, '증거금', { positive: true }), leverage = schemaDecString(p.leverage, '레버리지', { positive: true }), entry = schemaDecString(p.entry, '진입가', { positive: true }), stop = schemaDecString(p.stop, '손절가', { positive: true });
  let qty, qtySource = 'entered';
  if (p.qty !== undefined && p.qty !== '') qty = schemaDecString(p.qty, '수량', { positive: true });
  else { qty = decFormat(decDiv(decMul(dec(margin), dec(leverage)), dec(entry)), 8); qty = schemaDecString(qty, '수량(계산)', { positive: true }); qtySource = 'derived'; }
  const dir = sg.data.dir, risk = riskTrade({ dir, entry, stop, qty, margin, leverage, equityMicro: tgRiskEquityMicro(env) });
  const fill = { origin: 'real', sid: p.sid, kind, dir, price: entry, qty, margin, leverage, plannedStop: stop, qtySource, fee: tgAmount(p.fee, '수수료'), funding: tgAmount(p.funding, '펀딩') };
  return { type: 'fill', fill, risk, summary: tgEntrySummary(fill, risk), params: { ...p }, force: p.force === true };
}
function tgBuildExit(env, p) {                  // p: { sid, price, qty?('all'), fee?, funding? }
  const se = env.storeEnv(), fills = tgFillsOf(se, p.sid), trade = fills.length ? tgTradeOrUserError(fills) : null;
  if (!trade) throw tgUserErr('이 신호의 진입 기록이 없습니다');
  if (trade.status !== 'open') throw tgUserErr('이미 전량 청산된 포지션입니다');
  const price = schemaDecString(p.price, '청산가', { positive: true });
  const all = p.qty === undefined || p.qty === '' || String(p.qty).toLowerCase() === 'all';
  const qty = all ? decFormat(trade.openQtyDec, 12).replace(/0+$/, '').replace(/\.$/, '') : schemaDecString(p.qty, '수량', { positive: true });
  const qd = dec(qty); if (qd > trade.openQtyDec) throw tgUserErr(`보유 수량(${tgNum(decFormat(trade.openQtyDec, 8))})보다 큽니다`);
  const kind = qd === trade.openQtyDec ? 'close' : 'reduce';
  const fill = { origin: 'real', sid: p.sid, kind, dir: trade.dir, price, qty, fee: tgAmount(p.fee, '수수료'), funding: tgAmount(p.funding, '펀딩') };
  const probe = tgTradeOrUserError([...fills, { ...fill, fillId: 'preview', at: tgNextAt(env, fills) }]), ev = probe.events[probe.events.length - 1];
  return { type: 'exit', fill, summary: tgExitSummary(fill, ev, probe), params: { ...p }, force: p.force === true };
}
const tgM = m => decFormat(m * 1000000n, 2);
function tgEntrySummary(f, r) {
  const lines = [`${f.kind === 'add' ? '추가진입' : '진입'} ${f.dir} · ${f.sid}`, `진입 ${f.price} · 수량 ${f.qty}${f.qtySource === 'derived' ? '(계산)' : ''} · 손절 ${f.plannedStop}`, `증거금 ${f.margin} · ${f.leverage}x · 손절 시 손실 ${tgM(r.stopLossMicro)} USDT${r.riskPpmOfEquity !== null ? ` (${decFormat(BigInt(r.riskPpmOfEquity) * 100000000n, 2)}%)` : ''}`];
  const w = [r.flags.includes('stop-on-wrong-side') && '손절가가 방향과 반대쪽', r.flags.includes('liquidation-before-stop') && '청산가(근사)가 손절보다 먼저', r.flags.includes('risk-over-2pct') && '손실 2% 초과', r.flags.includes('leverage-mismatch') && '레버리지 불일치'].filter(Boolean);
  if (w.length) lines.push(`⚠ ${w.join(' · ')}`);
  lines.push(`수수료 ${f.fee.state === 'missing' ? '미입력' : f.fee.amount} · 펀딩 ${f.funding.state === 'missing' ? '미입력' : f.funding.amount}`);
  return lines.join('\n');
}
function tgExitSummary(f, ev, t) {
  const lines = [`${f.kind === 'close' ? '전량 청산' : '부분 청산'} ${f.dir} · ${f.sid}`, `청산 ${f.price} · 수량 ${f.qty} · 이번 총손익 ${tgM(ev.grossMicro)} USDT`, `수수료 ${f.fee.state === 'missing' ? '미입력' : f.fee.amount} · 펀딩 ${f.funding.state === 'missing' ? '미입력' : f.funding.amount}`];
  if (f.kind === 'close') lines.push(`포지션 순손익(입력된 수수료·펀딩만) ${tgM(t.totals.netEnteredMicro)} USDT`);
  return lines.join('\n');
}
const tgTradeOrUserError = fills => { try { return pnlComputeTrade(fills); } catch (e) { throw tgUserErr(`계산할 수 없는 체결입니다: ${String(e.message).slice(0, 80)}`); } };
const tgNextAt = (env, fills) => Math.max(env.now(), fills.reduce((m, f) => Math.max(m, f.at), 0) + 1);
const tgNum = v => { const t = String(v); return t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t; };
function tgRebuild(env, d) {                            // 확인 시점의 *현재 상태*로 다시 계산해 초안과 같은지 확인(그 사이 상태가 바뀐 초안이 잘못 저장되는 것을 막는다)
  const b = d.type === 'fill' ? tgBuildEntry(env, d.params) : tgBuildExit(env, d.params);
  if (b.fill.kind !== d.fill.kind || b.fill.qty !== d.fill.qty) throw tgUserErr('그 사이 포지션 상태가 바뀌어 이 초안은 맞지 않습니다. 다시 입력해 주세요');
}
function tgCommitFill(env, draft, actor) {             // 확인(저장) 이후에만 호출. fillId는 초안/폼 id로 고정 → 중복 확인·재처리에도 1건.
  const se = env.storeEnv(), have = storeGet(se, 'fill', draft.fillId);
  if (have && !have.void) return { status: 'duplicate', key: draft.fillId, rev: have.rev, kind: have.data.kind };
  if (draft.params) tgRebuild(env, draft);
  const same = tgFillsOf(se, draft.fill.sid), f = { ...draft.fill, at: tgNextAt(env, same), fillId: draft.fillId };
  if (draft.force !== true && same.some(x => TG_FAMILY[x.kind] === TG_FAMILY[f.kind] && x.price === f.price && x.qty === f.qty && Math.abs(x.at - env.now()) < TG_DUP_WINDOW_MS))
    throw tgUserErr('같은 계열(진입 또는 청산)·가격·수량의 체결이 방금 저장돼 있습니다(중복 저장 방지). 다른 체결이 맞으면 명령 끝에 force=1 을 붙여 다시 입력하세요');
  if (draft.type === 'fill') {
    const cur = storeGet(se, 'response', f.sid);
    if (!cur || cur.void) storeCreate(se, 'response', { sid: f.sid, choice: 'entered', at: f.at }, { actor });
  }
  const r = storeCreate(se, 'fill', f, { actor });
  if (r.status === 'conflict') throw tgUserErr('같은 체결 id에 다른 내용이 이미 있습니다');
  return { ...r, kind: f.kind };
}

// ── 입력 화면(모바일 폼) 제출: 폼의 제출 버튼이 곧 확인이다 ──
function tgSubmitFillForm(env, form, { actor = 'ui:form' } = {}) {
  try {
    if (!form || typeof form !== 'object') throw tgUserErr('입력 형식 오류');
    const sid = String(form.sid ?? ''), isExit = form.kind === 'exit', formId = String(form.formId ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || env.randomId(8), fillId = `${sid}:${formId}`;
    const dupe = storeGet(env.storeEnv(), 'fill', fillId);          // 같은 폼 재제출(네트워크 재시도·더블탭)은 상태가 바뀌었어도 duplicate로 수렴
    if (dupe && !dupe.void) return { ok: true, status: 'duplicate', kind: dupe.data.kind };
    const built = isExit ? tgBuildExit(env, { sid, price: String(form.price ?? ''), qty: form.qty === undefined || form.qty === '' ? undefined : String(form.qty), fee: form.fee ? String(form.fee) : undefined, funding: form.funding ? String(form.funding) : undefined, force: form.force === true })
      : tgBuildEntry(env, { sid, margin: String(form.margin ?? ''), leverage: String(form.leverage ?? ''), entry: String(form.entry ?? ''), stop: String(form.stop ?? ''), qty: form.qty ? String(form.qty) : undefined, fee: form.fee ? String(form.fee) : undefined, funding: form.funding ? String(form.funding) : undefined, force: form.force === true });
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
const TG_HELP = ['RICH300 명령', '/fill 신호ID 증거금 레버리지 진입가 손절가 [qty= fee= funding=]', '/exit 신호ID 청산가 [수량|all] [fee= funding=]  (수량이 잔량보다 적으면 부분청산)', '/equity 금액 [날짜] [unrealized=값]  (마감 평가액 입력, 날짜 생략 시 평가액 없는 최근 마감일)', '/review 신호ID · /status · /help', '수수료·펀딩은 fee=0.12 (추정은 fee=~0.12), 비우면 미입력', '같은 체결이 10분 안에 또 들어오면 중복으로 막습니다(맞으면 force=1)'].join('\n');
function tgConfirmDraft(env, ev, built) {
  const id = env.randomId(8); tgKvPut(env, `d:${id}`, { type: built.type, fill: built.fill, equity: built.equity, params: built.params, force: built.force === true, sid: built.fill ? built.fill.sid : undefined, chatId: ev.chatId, userId: ev.fromId }, TG_DRAFT_TTL_SEC);
  const s = tgSend(env, ev.chatId, `${built.summary}\n저장할까요?`, { inline_keyboard: [[{ text: '저장', callback_data: `f1:${id}:y` }, { text: '취소', callback_data: `f1:${id}:n` }]] });
  return { status: 'handled', action: built.type === 'fill' ? 'fill-draft' : built.type === 'equity' ? 'equity-draft' : 'exit-draft', replyFailed: !s.ok };
}
function tgDefaultEquityDay(env) {                      // 평가액이 없는 가장 최근 *마감된* 날, 없으면 오늘(KST)
  try { const m = closeStatus(env, { now: env.now(), days: 14 }).find(d => d.closed && d.equity === null); if (m) return m.day; } catch { /* 챌린지 없음 등 */ }
  return kstDayOf(env.now());
}
function tgOnMessage(env, ev) {
  const c = tgParseCommand(ev.text); if (!c) return { status: 'ignored', action: 'not-command' };
  const reply = (t, extra) => { const s = tgSend(env, ev.chatId, t, extra); return { replyFailed: !s.ok }; };
  try {
    if (c.cmd === 'start' || c.cmd === 'help') return { status: 'handled', action: 'help', ...reply(TG_HELP) };
    if (c.cmd === 'fill') {
      if (c.pos.length < 5) return { status: 'handled', action: 'usage', ...reply('사용법: /fill 신호ID 증거금 레버리지 진입가 손절가 [qty= fee= funding=]') };
      const [sid, margin, leverage, entry, stop] = c.pos; return tgConfirmDraft(env, ev, tgBuildEntry(env, { sid, margin, leverage, entry, stop, qty: c.opt.qty, fee: c.opt.fee, funding: c.opt.funding, force: c.opt.force === '1' }));
    }
    if (c.cmd === 'exit') {
      if (c.pos.length < 2) return { status: 'handled', action: 'usage', ...reply('사용법: /exit 신호ID 청산가 [수량|all] [fee= funding=]') };
      return tgConfirmDraft(env, ev, tgBuildExit(env, { sid: c.pos[0], price: c.pos[1], qty: c.pos[2] ?? c.opt.qty, fee: c.opt.fee, funding: c.opt.funding, force: c.opt.force === '1' }));
    }
    if (c.cmd === 'equity') {
      if (c.pos.length < 1) return { status: 'handled', action: 'usage', ...reply('사용법: /equity 금액 [날짜] [unrealized=값]') };
      const day = c.pos[1] ?? tgDefaultEquityDay(env); if (!isDayString(day)) return { status: 'handled', action: 'user-error', ...reply('⚠ 날짜 형식은 YYYY-MM-DD 입니다') };
      closeCheckEquityDay(env, day, env.now());
      const amount = schemaDecString(c.pos[0], '평가액', { nonNegative: true }), un = c.opt.unrealized === undefined ? undefined : schemaDecString(c.opt.unrealized, '미실현 손익');
      return tgConfirmDraft(env, ev, { type: 'equity', equity: { day, equity: amount, ...(un === undefined ? {} : { unrealized: un }) }, summary: `평가액 입력 · ${day}\n실제 계좌 평가액 ${amount} USDT${un === undefined ? '' : ` (미실현 ${un})`}\n(장부와 다르면 차이만 표시하고 손익에는 자동 반영하지 않습니다)` });
    }
    if (c.cmd === 'review') {
      const sid = c.pos[0]; if (!sid || !TG_SID_RE.test(sid)) return { status: 'handled', action: 'usage', ...reply('사용법: /review 신호ID') };
      if (!tgFillsOf(env.storeEnv(), sid).length) return { status: 'handled', action: 'review-none', ...reply('이 신호의 체결 기록이 없습니다') };
      const s = tgSendReviewPrompt(env, ev.chatId, sid); return { status: 'handled', action: 'review-prompt', replyFailed: !s.ok };
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
  const cb = { chatId: ev.chatId, messageId: ev.messageId };
  if (parts[0] === 'r1' && parts.length === 3 && TG_RESP[parts[2]]) return tgOnResponse(env, ev, parts[1], TG_RESP[parts[2]], cb, answer);
  if (parts[0] === 'v1' && (parts.length === 3 || (parts.length === 4 && parts[3] === 's'))) return tgOnReview(env, ev, parts, cb, answer);
  if (parts[0] === 'f1' && parts.length === 3 && (parts[2] === 'y' || parts[2] === 'n')) return tgOnDraft(env, ev, parts[1], parts[2], cb, answer);
  if (parts[0] === 'lv' && env.live && typeof env.live.onCallback === 'function') return env.live.onCallback(env, ev, parts, cb, answer);      // 검증 하니스(테스트 환경 전용) 확장점
  answer('처리할 수 없는 버튼입니다'); return { status: 'handled', action: 'unknown-button' };
}
function tgOnResponse(env, ev, sid, choice, cb, answer) {
  const se = env.storeEnv(), sg = storeGet(se, 'signal', sid);
  if (!sg || sg.void) { answer('알 수 없는 신호입니다'); return { status: 'handled', action: 'unknown-signal' }; }
  const r = storeCreate(se, 'response', { sid, choice, at: env.now() }, { actor: 'tg' });
  if (r.status === 'conflict') { const cur = storeGet(se, 'response', sid); answer(`이미 '${RESPONSE_CHOICES[cur.data.choice]}'로 기록됨(수정은 앱에서)`); tgEdit(env, cb, tgSignalText(sg.data) + `\n→ ${RESPONSE_CHOICES[cur.data.choice]}`); return { status: 'handled', action: 'response-conflict' }; }
  const a = answer(`기록: ${RESPONSE_CHOICES[choice]}`), e = tgEdit(env, cb, `${tgSignalText(sg.data)}\n→ ${RESPONSE_CHOICES[choice]}`);
  let replyFailed = !tgOkOrBenign(a) || !tgOkOrBenign(e);
  if (choice === 'entered' && r.status === 'added') {
    const link = tgFillLink(env.uiUrl, sg.data), s = tgSend(env, ev.chatId, `진입 기록: /fill ${sid} 증거금 레버리지 ${sg.data.entry} ${sg.data.stop}${link ? '\n(숫자 입력은 아래 화면이 더 편합니다)' : ''}`, link ? { inline_keyboard: [[{ text: '입력 화면 열기', url: link }]] } : undefined);
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
  if (r.diffLabel !== null) lines.push(`장부 기준 ${r.expectedLabel} · 차이 ${r.diffMicro && BigInt(r.diffMicro) > 0n ? '+' : ''}${r.diffLabel}`);
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
    const off = Number(tgKvGet(env, 'offset') ?? 0), r = tgCall(env, 'getUpdates', { ...(off ? { offset: off } : {}), limit, timeout: 0, allowed_updates: ['message', 'callback_query'] });
    if (!r.ok) return { ...stats, status: 'error', code: r.code, retryable: r.retryable };
    const list = (Array.isArray(r.result) ? r.result : []).filter(u => Number.isSafeInteger(u?.update_id)).sort((a, b) => a.update_id - b.update_id);
    for (const u of list) {
      const x = tgHandleUpdate(env, u);
      if (u.message && Number.isFinite(u.message.date)) (stats.lags ||= []).push(Math.max(0, env.now() - u.message.date * 1000));      // 메시지 도착→처리 지연(ms, 관측용)
      if (x.status === 'retry') {
        const key = `fail:${u.update_id}`, n = (tgKvGet(env, key) ?? 0) + 1;
        if (n < TG_POISON_AFTER) { tgKvPut(env, key, n, 3600); stats.retry++; break; }          // 순서 보존: 이 update에서 멈추고 다음 틱에 재시도
        stats.poison++; env.kv.del(key);                                                        // 계속 실패하는 update는 건너뛴다
      } else { stats[x.status === 'handled' ? 'handled' : x.status === 'duplicate' ? 'duplicate' : 'ignored']++; if (x.action) stats.actions[x.action] = (stats.actions[x.action] ?? 0) + 1; }
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
const closeUsd = micro => { const neg = micro < 0n, a = neg ? -micro : micro, s = decFormat(microToDec(a), 2); return `${neg && a >= 5000n ? '−' : ''}${s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`; };

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
  let res; try { res = env.notify(closeMessage(items, env.uiUrl)); } catch { res = { ok: false, code: 'exception' }; }
  const ok = !!(res && res.ok), at = env.now();
  for (const d of days) {
    storeRevise(se, 'closenotice', d, ok ? { status: 'sent', at } : { status: 'failed', at, error: String(res?.code ?? 'failed').slice(0, 40) }, { actor: 'close', reason: ok ? '발송 완료' : '발송 실패' });
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
  else if (cur.data.equity === eq && (cur.data.unrealized ?? undefined) === un) r = { status: 'unchanged', key: day, rev: cur.rev };
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
    out.push({ day, today: i === 0, closed: !!c, source: c ? c.data.source : null, equity: e ? e.data.equity : null, late: e ? !!e.data.late : false, equityRev: e ? e.rev : 0, notice: n ? n.status : null, flags: c ? c.data.flags ?? [] : [], needsReview: c ? c.data.needsReview : false, diffMicro: c ? c.data.diffMicro ?? null : null, diffLabel: c && c.data.diffMicro !== undefined ? `${BigInt(c.data.diffMicro) > 0n ? '+' : ''}${closeUsd(BigInt(c.data.diffMicro))}` : null, walletMicro: c ? c.data.walletMicro : null });
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
  const neg = micro < 0n, a = neg ? -micro : micro, s = decFormat(microToDec(a), 2).replace(/\B(?=(\d{3})+(?!\d))/g, ','), zero = a < 5000n;
  return `${neg && !zero ? '−' : sign && !zero ? '+' : ''}${s}`;
}
const anRatio = ppm => (ppm === null ? '—' : decFormat(ppm * 1000000n, 2));          // 1e6 = 1.00
function anPct(ppm, dp = 0) { if (ppm === null) return '—'; const neg = ppm < 0n, a = neg ? -ppm : ppm, s = decFormat(a * 100000000n, dp); return `${neg && !/^[0.]*$/.test(s) ? '−' : ''}${s}%`; }

function anWilson(w, n) {                                    // 표시용 부동소수(결정 로직에 쓰지 않음)
  if (n === 0) return null; const z = 1.96, p = w / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
// trades: [{ sid, netMicro: bigint, closedAt: ms, riskMicro?: bigint|null }]
function anStats(trades, { startMicro = null } = {}) {
  const t = [...trades].sort((a, b) => a.closedAt - b.closedAt || (a.sid < b.sid ? -1 : 1)), n = t.length;
  let winN = 0, lossN = 0, flatN = 0, sumW = 0n, sumL = 0n, net = 0n, cum = 0n, peak = 0n, maxDd = 0n, rSum = 0n, rN = 0, best = null, worst = null;
  for (const x of t) {
    const v = x.netMicro; net += v; cum += v; if (cum > peak) peak = cum; if (peak - cum > maxDd) maxDd = peak - cum;
    if (v > 0n) { winN++; sumW += v; } else if (v < 0n) { lossN++; sumL += v; } else flatN++;
    if (x.riskMicro && x.riskMicro > 0n) { rSum += decRoundDiv(v * 1000000n, x.riskMicro); rN++; }
    if (best === null || v > best) best = v; if (worst === null || v < worst) worst = v;
  }
  const ci = anWilson(winN, n), avgWin = winN ? decRoundDiv(sumW, BigInt(winN)) : null, avgLoss = lossN ? decRoundDiv(sumL, BigInt(lossN)) : null;
  const payoffPpm = avgWin !== null && avgLoss !== null ? decRoundDiv(avgWin * 1000000n, -avgLoss) : null, pfPpm = sumL < 0n && sumW > 0n ? decRoundDiv(sumW * 1000000n, -sumL) : null;
  return { n, wins: winN, losses: lossN, flat: flatN, winRatePpm: n ? decRoundDiv(BigInt(winN) * 1000000n, BigInt(n)) : null, winRate: n ? anPct(decRoundDiv(BigInt(winN) * 1000000n, BigInt(n))) : '—',
    winRateRange: ci ? `${Math.round(ci[0] * 100)}–${Math.round(ci[1] * 100)}%` : '—', avgWinMicro: avgWin === null ? null : String(avgWin), avgLossMicro: avgLoss === null ? null : String(avgLoss), avgWin: avgWin === null ? '—' : anUsd(avgWin, { sign: true }), avgLoss: avgLoss === null ? '—' : anUsd(avgLoss, { sign: true }),
    payoff: anRatio(payoffPpm), profitFactor: anRatio(pfPpm), netMicro: String(net), net: anUsd(net, { sign: true }), netPositive: net > 0n, netNegative: net < 0n,
    expectancyMicro: n ? String(decRoundDiv(net, BigInt(n))) : null, expectancy: n ? anUsd(decRoundDiv(net, BigInt(n)), { sign: true }) : '—', expectancyPositive: n > 0 && net > 0n, expectancyNegative: n > 0 && net < 0n,
    expectancyR: rN ? `${decFormat(decRoundDiv(rSum, BigInt(rN)) * 1000000n, 2).replace('-', '−')}R` : '—', rCoverage: rN, maxDdMicro: String(maxDd), maxDd: anUsd(maxDd), maxDdOfStart: startMicro && startMicro > 0n ? anPct(decRoundDiv(maxDd * 1000000n, startMicro), 1) : '—',
    best: best === null ? '—' : anUsd(best, { sign: true }), worst: worst === null ? '—' : anUsd(worst, { sign: true }), lowSample: n < AN_MIN_SAMPLE };
}
const anGroup = (trades, keyFn, keys, opts) => keys.map(k => ({ key: k, ...anStats(trades.filter(t => keyFn(t) === k), opts) }));

// ledgerTrades: R2 ledger.trades(Map sid→trade), fills: 저장소 체결 data, signals/reviews: data 배열
function anTradesFrom({ ledgerTrades, fills = [], signals = [], reviews = [] }) {
  const sig = new Map(signals.map(s => [s.sid, s])), rev = new Map(reviews.map(r => [r.sid, r])), firstEntry = new Map();
  for (const f of [...fills].sort((a, b) => a.at - b.at)) if ((f.kind === 'entry') && !firstEntry.has(f.sid)) firstEntry.set(f.sid, f);
  const out = [];
  for (const t of ledgerTrades.values()) {
    if (t.status !== 'closed') continue;
    const fe = firstEntry.get(t.sid); let risk = null;
    if (fe && fe.plannedStop) { const d = decAbs(decSub(dec(fe.price), dec(fe.plannedStop))); risk = decToMicro(decMul(d, dec(fe.qty))); if (risk <= 0n) risk = null; }
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
  const total = trades.length, rate = total ? decRoundDiv(BigInt(reviewed.length) * 1000000n, BigInt(total)) : null, insights = [];
  const cmp = (label, a, b, nameA, nameB) => {
    if (a.n < AN_INSIGHT_MIN || b.n < AN_INSIGHT_MIN) return;
    const ea = BigInt(a.expectancyMicro), eb = BigInt(b.expectancyMicro); if (ea >= eb) return;
    insights.push({ type: label, n: a.n + b.n, text: `${nameA}(${a.n}건)의 건당 기대값 ${anUsd(ea, { sign: true })} USDT는 ${nameB}(${b.n}건)의 ${anUsd(eb, { sign: true })} USDT보다 ${anUsd(eb - ea)} USDT 낮습니다${a.n + b.n < AN_MIN_SAMPLE ? ' — 표본이 적어 참고용입니다' : ''}` });
  };
  const ok = reviewed.filter(t => t.review.plan === 'plan_ok'), bad = reviewed.filter(t => t.review.plan !== 'plan_ok'), calm = reviewed.filter(t => t.review.mind === 'calm'), tense = reviewed.filter(t => t.review.mind !== 'calm');
  cmp('plan-violation', anStats(bad, opts), anStats(ok, opts), '계획과 다르게 한 거래', '계획대로 한 거래');
  cmp('mind-unsettled', anStats(tense, opts), anStats(calm, opts), '침착하지 않았던 거래', '침착했던 거래');
  if (total >= AN_INSIGHT_MIN && rate !== null && rate < 700000n) insights.push({ type: 'review-rate', n: total, text: `청산 ${total}건 중 복기한 거래는 ${reviewed.length}건(${anPct(rate)})입니다 — 복기가 적으면 위 분석이 한쪽으로 치우칠 수 있습니다` });
  return { total, reviewed: reviewed.length, reviewRate: anPct(rate), byPlan, byMind, insights };
}
function anBuild({ ledgerTrades, fills, signals, reviews, startMicro }) {
  const trades = anTradesFrom({ ledgerTrades, fills, signals, reviews }), opts = { startMicro };
  return { overall: anStats(trades, opts), strategies: anGroup(trades, t => t.strategy, ['A', 'B'], opts).map(g => ({ ...g, name: g.key === 'A' ? 'A전략 · 추세돌파형' : 'B전략 · 눌림목 재진입형' })), dirs: anGroup(trades, t => t.dir, ['LONG', 'SHORT'], opts),
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
const jvParse = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const jvFail = m => { throw new StoreError('VALIDATION', m); };

function journalDiff(before, after) {          // 최상위 필드 단위 변경 목록(표시용)
  const b = before ?? {}, a = after ?? {}, keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort(), out = [];
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
function journalHistory(env, entity, key) { return journalHistories(env.storeEnv()).get(`${entity}|${key}`) ?? []; }

function journalBuild(env, { now = env.now(), limit = JOURNAL_LIMIT } = {}) {
  const se = env.storeEnv(); let inputs;
  try { inputs = storeLoadLedgerInputs(se); } catch (e) { if (e instanceof StoreError && e.code === 'NOT_FOUND') return { empty: true, reason: 'no-challenge', generatedAt: now }; throw e; }
  const throughDay = kstDayOf(now), led = ledgerBuildDaily({ ...inputs, throughDay }), hist = journalHistories(se);
  const data = n => storeList(se, n).map(r => r.data), signals = data('signal'), responses = data('response'), reviews = data('review');
  const sig = new Map(signals.map(s => [s.sid, s])), rsp = new Map(responses.map(r => [r.sid, r])), rev = new Map(reviews.map(r => [r.sid, r]));
  const allFills = storeList(se, 'fill', { includeVoid: true }), voided = allFills.filter(r => r.void).map(r => r.key);
  const bySid = new Map();
  for (const r of allFills) { const sid = r.data.sid; if (!bySid.has(sid)) bySid.set(sid, []); bySid.get(sid).push(r); }
  const edits = (entity, key) => (hist.get(`${entity}|${key}`) ?? []).filter(h => h.rev > 1 || h.op !== 'create');
  const trades = [...led.trades.values()].map(t => {
    const s = sig.get(t.sid), ev = t.events, last = ev[ev.length - 1], net = t.totals.netEnteredMicro, rows = (bySid.get(t.sid) ?? []).sort((a, b) => a.data.at - b.data.at);
    const rv = rev.get(t.sid), rs = rsp.get(t.sid);
    return { sid: t.sid, dir: t.dir, status: t.status, strategy: s ? s.strategy : null, symbol: s ? s.symbolId.replace(/USDT$/, '') : null, lastAt: last.at, openedLabel: jvKst(ev[0].at), closedLabel: t.status === 'closed' ? jvKst(last.at) : null,
      netLabel: anUsd(net, { sign: true }), netMicro: String(net), win: t.status === 'closed' && net > 0n, loss: t.status === 'closed' && net < 0n, flags: t.flags, openQty: t.status === 'open' ? t.openQty : null,
      response: rs ? { choice: rs.choice, label: RESPONSE_CHOICES[rs.choice] } : null,
      fills: rows.filter(r => !r.void).map(r => ({ fillId: r.key, kind: r.data.kind, kindLabel: JV_KIND[r.data.kind] ?? r.data.kind, atLabel: jvKst(r.data.at), price: r.data.price, qty: r.data.qty, fee: jvText(r.data.fee), funding: jvText(r.data.funding), feeEdit: jvEditAmt(r.data.fee), fundingEdit: jvEditAmt(r.data.funding), rev: r.rev, margin: r.data.margin ?? null, leverage: r.data.leverage ?? null, plannedStop: r.data.plannedStop ?? null, edits: edits('fill', r.key) })),
      voidedFills: rows.filter(r => r.void).map(r => ({ fillId: r.key, kindLabel: JV_KIND[r.data.kind] ?? r.data.kind, atLabel: jvKst(r.data.at), price: r.data.price, qty: r.data.qty, edits: edits('fill', r.key) })),
      review: rv ? { plan: PLAN_CHOICES[rv.plan], mind: MIND_CHOICES[rv.mind], memo: rv.memo ?? null, savedLabel: jvKst(rv.savedAt), edits: edits('review', t.sid) } : null };
  }).sort((a, b) => b.lastAt - a.lastAt);
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
  const closes = closeStatus(env, { now, days: 14 }), cash = storeList(se, 'cashflow').map(r => r.data).sort((a, b) => b.at - a.at).slice(0, 10).map(c => ({ cfId: c.cfId, atLabel: jvKst(c.at), amount: c.amount, note: c.note ?? '', edits: edits('cashflow', c.cfId) }));
  return { empty: false, generatedAt: now, today: throughDay, startDay: inputs.challenge.startDay, startEquity: inputs.challenge.startEquity, trades: trades.slice(0, limit), tradesTotal: trades.length, tradesOpen: trades.filter(t => t.status === 'open').length, voidedCount: voided.length,
    closes, presetDay: (closes.find(c => c.closed && c.equity === null) ?? closes[0] ?? { day: throughDay }).day, cashflows: cash, analytics: anBuild({ ledgerTrades: led.trades, fills: inputs.fills, signals, reviews, startMicro: decToMicro(dec(inputs.challenge.startEquity)) }), warnings, warningText: CLOSE_WARNING_TEXT };
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
const jvEsc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
const jvHead = t => `<!DOCTYPE html><html lang="ko"><jvHead><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${jvE(t)}</title><style>${JV_CSS}</style></jvHead>`;
const journalRenderError = () => `${jvHead('RICH300 일지')}<body><main><header><h1>RICH 300 일지</h1></header><section class="card"><p>일지를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.</p></section></main></body></html>`;

const jvStat = (name, s) => `<div class="card stat"><h3>${jvE(name)} ${s.lowSample ? '<span class="badge warn">표본 부족</span>' : ''}</h3><dl><dt>청산 거래</dt><dd>${s.n}건 (승 ${s.wins} · 패 ${s.losses}${s.flat ? ` · 무 ${s.flat}` : ''})</dd><dt>승률</dt><dd>${jvE(s.winRate)} <span class="sub">(95% 구간 ${jvE(s.winRateRange)})</span></dd><dt>평균 이익 / 손실</dt><dd>${jvE(s.avgWin)} / ${jvE(s.avgLoss)}</dd><dt>손익비</dt><dd>${jvE(s.payoff)}</dd><dt>Profit factor</dt><dd>${jvE(s.profitFactor)}</dd><dt>기대값(건당)</dt><dd class="${JV_TONE(s.expectancyPositive, s.expectancyNegative)}">${JV_ARROW(s.expectancyPositive, s.expectancyNegative)} ${jvE(s.expectancy)} USDT${s.rCoverage ? ` <span class="sub">(${jvE(s.expectancyR)}, ${s.rCoverage}건 기준)</span>` : ''}</dd><dt>최대 낙폭(거래 기준)</dt><dd>${jvE(s.maxDd)} USDT <span class="sub">(${jvE(s.maxDdOfStart)})</span></dd><dt>순손익</dt><dd class="${JV_TONE(s.netPositive, s.netNegative)}">${JV_ARROW(s.netPositive, s.netNegative)} ${jvE(s.net)} USDT</dd></dl></div>`;
const jvGrp = g => `<div class="card mini"><div class="row"><strong>${jvE(g.label)}</strong><span class="sub">${g.n}건${g.lowSample ? ' · 표본 부족' : ''}</span></div><dl><dt>승률</dt><dd>${jvE(g.winRate)}</dd><dt>기대값</dt><dd class="${JV_TONE(g.expectancyPositive, g.expectancyNegative)}">${jvE(g.expectancy)}</dd><dt>순손익</dt><dd>${jvE(g.net)}</dd></dl></div>`;

function jvCloseHtml(m) {
  const rows = m.closes.map(c => `<div class="day"><div class="row"><strong>${jvE(c.day)}${c.today ? ' <span class="sub">오늘</span>' : ''}</strong><span>${c.closed ? '<span class="badge">마감됨</span>' : '<span class="badge">마감 전</span>'} ${c.equity !== null ? `<span class="badge">평가액 ${jvE(c.equity)}${c.late ? ' · 마감 후 입력' : ''}</span>` : c.closed ? '<span class="badge warn">평가액 미입력</span>' : ''}</span></div>`
    + `${c.diffMicro !== null && c.needsReview ? `<div class="sub">⚠ 장부와 차이(마감 시점 ${jvE(c.diffLabel)} USDT)</div>` : ''}${c.flags.filter(f => m.warningText[f]).map(f => `<div class="sub">· ${jvE(m.warningText[f])}</div>`).join('')}${c.notice ? `<div class="sub">${jvE(JV_NOTICE[c.notice] ?? c.notice)}</div>` : ''}</div>`).join('');
  const opts = m.closes.map(c => `<option value="${jvE(c.day)}"${c.day === m.presetDay ? ' selected' : ''}>${jvE(c.day)}${c.closed && c.equity === null ? ' (미입력)' : ''}</option>`).join('');
  return `<section id="close" aria-labelledby="h-close"><h2 id="h-close">일 마감 (매일 00:00 KST)</h2><div class="card">${rows || '<div class="sub">아직 마감할 날이 없습니다.</div>'}</div>
<div class="card"><form id="eqForm"><strong>실제 계좌 평가액 입력</strong><div class="sub">거래소 화면의 평가액(미실현 포함)을 직접 입력합니다. 장부와 다르면 차이만 표시하며 손익에는 자동 반영하지 않습니다.</div>
<label for="eqDay">날짜</label><select id="eqDay">${opts}</select><label for="eqVal">평가액 (USDT)</label><input id="eqVal" inputmode="decimal" autocomplete="off"><label for="eqUn">미실현 손익 (선택, 보유 포지션이 있을 때)</label><input id="eqUn" inputmode="decimal" autocomplete="off"><label for="eqWhy">수정 사유 (이미 입력한 날짜를 고칠 때)</label><input id="eqWhy" autocomplete="off">
<button class="act" type="submit">저장</button><div class="out" id="eqOut" role="status"></div></form></div></section>`;
}
function jvTradeHtml(t) {
  const edits = es => (es.length ? `<ul class="edits">${es.map(h => `<li>${jvE(h.atLabel)} · rev ${h.rev} · ${h.op === 'void' ? '취소' : '수정'}${h.reason ? ` — ${jvE(h.reason)}` : ''}${h.changes.map(c => `<div class="chg">${jvE(c.field)}: ${jvE(c.from)} → ${jvE(c.to)}</div>`).join('')}</li>`).join('')}</ul>` : '');
  const fill = f => `<div class="fill"><div class="row"><strong>${jvE(f.kindLabel)}</strong><span>${jvE(f.atLabel)}</span></div><div>${jvE(f.price)} × ${jvE(f.qty)} · 수수료 ${jvE(f.fee)} · 펀딩 ${jvE(f.funding)}${f.edits.length ? ` <span class="badge">수정 ${f.edits.length}회</span>` : ''}</div>${edits(f.edits)}
<details class="edit"><summary>수정 / 취소</summary><form class="fillForm" data-fill="${jvE(f.fillId)}"><div class="grid2"><div><label>가격</label><input name="price" inputmode="decimal" value="${jvE(f.price)}" data-orig="${jvE(f.price)}"></div><div><label>수량</label><input name="qty" inputmode="decimal" value="${jvE(f.qty)}" data-orig="${jvE(f.qty)}"></div><div><label>수수료 (비움=미입력, ~=추정)</label><input name="fee" value="${jvE(f.feeEdit)}" data-orig="${jvE(f.feeEdit)}"></div><div><label>펀딩 (비움=미입력, ~=추정)</label><input name="funding" value="${jvE(f.fundingEdit)}" data-orig="${jvE(f.fundingEdit)}"></div></div>
<label>사유 (필수)</label><input name="reason" autocomplete="off"><div class="row"><button class="act" type="submit" data-act="revise">수정 저장</button><button class="act alt" type="submit" data-act="void">이 체결 취소</button></div><div class="out" role="status"></div></form></details></div>`;
  const dirTone = t.status === 'open' ? 'zero' : JV_TONE(t.win, t.loss);
  return `<details class="trade" data-dir="${jvE(t.dir)}"><summary><span><span class="pill">${jvE(t.dir)}</span><strong>${jvE(t.symbol ?? t.sid)}</strong>${t.strategy ? ` <span class="badge">${jvE(t.strategy)}전략</span>` : ''}<div class="sub">${jvE(t.openedLabel)}${t.closedLabel ? ` → ${jvE(t.closedLabel)}` : ' · 보유 중'}</div></span><span class="${dirTone}"><strong>${t.status === 'open' ? '진행' : `${JV_ARROW(t.win, t.loss)} ${jvE(t.netLabel)}`}</strong></span></summary>
<div class="sub">${t.response ? `응답: ${jvE(t.response.label)}` : '응답 기록 없음'} · 신호 ${jvE(t.sid)}</div>
${t.review ? `<div class="sub">복기: ${jvE(t.review.plan)} · ${jvE(t.review.mind)}${t.review.memo ? ` · ${jvE(t.review.memo)}` : ''} (${jvE(t.review.savedLabel)})</div>${edits(t.review.edits)}` : '<div class="sub">복기 안 함</div>'}
${t.fills.map(fill).join('')}${t.voidedFills.length ? `<div class="sub" style="margin-top:6px">취소된 체결(손익에서 제외됨)</div>${t.voidedFills.map(v => `<div class="fill"><div>${jvE(v.kindLabel)} · ${jvE(v.atLabel)} · ${jvE(v.price)} × ${jvE(v.qty)}</div>${edits(v.edits)}</div>`).join('')}` : ''}</details>`;
}
function journalRenderHtml(m, { appUrl } = {}) {
  if (m.empty) return `${jvHead('RICH300 일지')}<body><main><header><h1>RICH 300 일지</h1></header><section class="card"><p>챌린지 설정이 없습니다. 먼저 시작 자금과 시작일을 저장해 주세요.</p></section></main></body></html>`;
  const a = m.analytics, link = typeof appUrl === 'string' && /^https:\/\/\S+$/.test(appUrl) ? `<a target="_top" href="${jvE(appUrl)}${appUrl.includes('?') ? '&' : '?'}p=journal">새로고침</a>` : '';
  const rv = a.reviews;
  return `${jvHead('RICH300 일지')}<body><main>
<header><h1>RICH 300 일지</h1><span class="sub">${jvE(m.startDay)} 시작 · 시작 자금 ${jvE(m.startEquity)} USDT · ${link}</span></header>
${jvCloseHtml(m)}
<section aria-labelledby="h-stat"><h2 id="h-stat">통계 <span class="sub">실제 청산 거래만 · 모의 제외</span></h2>${jvStat('전체', a.overall)}<div class="sub" style="margin:-4px 0 8px">승률 구간은 표본이 작을수록 넓어집니다. 30건 미만은 참고용입니다.</div>${a.strategies.map(s => jvStat(s.name, s)).join('')}${a.unlinked ? `<div class="sub">전략을 알 수 없는 거래 ${a.unlinked}건은 전체에만 포함됩니다.</div>` : ''}${a.dirs.map(d => jvStat(d.key, d)).join('')}</section>
<section aria-labelledby="h-rv"><h2 id="h-rv">10초 복기 분석 <span class="sub">복기율 ${jvE(rv.reviewRate)} (${rv.reviewed}/${rv.total})</span></h2>${rv.byPlan.length ? `<div class="sub">계획 준수</div>${rv.byPlan.map(jvGrp).join('')}` : '<div class="card sub">저장된 복기가 없습니다.</div>'}${rv.byMind.length ? `<div class="sub">심리 상태</div>${rv.byMind.map(jvGrp).join('')}` : ''}${rv.insights.length ? `<div class="card"><strong>참고</strong><ul class="plain">${rv.insights.map(i => `<li>${jvE(i.text)}</li>`).join('')}</ul></div>` : ''}</section>
<section aria-labelledby="h-cf"><h2 id="h-cf">입출금 기록</h2><div class="card"><form id="cfForm"><div class="sub">거래소와 지갑 사이 입금(+)·출금(−)을 기록합니다. 손익과 분리되어 목표 계산에 영향을 주지 않습니다.</div><label for="cfAmt">금액 (USDT, 입금 +, 출금 −)</label><input id="cfAmt" inputmode="decimal" autocomplete="off"><label for="cfNote">메모 (선택)</label><input id="cfNote" autocomplete="off"><button class="act" type="submit">저장</button><div class="out" id="cfOut" role="status"></div></form></div>
${m.cashflows.length ? `<div class="card">${m.cashflows.map(c => `<div class="day"><div class="row"><span>${jvE(c.atLabel)} · <strong>${jvE(c.amount)}</strong> ${jvE(c.note)}</span></div><form class="cfVoid" data-cf="${jvE(c.cfId)}"><div class="row" style="gap:6px"><input name="reason" placeholder="취소 사유" autocomplete="off" aria-label="취소 사유"><button class="act alt" type="submit" style="margin:0;white-space:nowrap">취소</button></div><div class="out" role="status"></div></form></div>`).join('')}</div>` : ''}</section>
<section aria-labelledby="h-j"><h2 id="h-j">매매일지 <span class="sub">${m.tradesTotal}건${m.tradesOpen ? ` · 보유 ${m.tradesOpen}` : ''}${m.voidedCount ? ` · 취소된 체결 ${m.voidedCount}` : ''}</span></h2><div class="card">${m.trades.length ? m.trades.map(jvTradeHtml).join('') : '<div class="sub">아직 기록이 없습니다.</div>'}</div>${m.tradesTotal > m.trades.length ? `<div class="sub">최근 ${m.trades.length}건만 표시</div>` : ''}</section>
${m.warnings.length ? `<section aria-labelledby="h-w"><h2 id="h-w">데이터 확인</h2><div class="card"><ul class="plain">${m.warnings.map(w => `<li>${jvE(w.text)}</li>`).join('')}</ul></div></section>` : ''}
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
  const ok = [2n ** 200n % 1000003n === 973692n, -7n / 2n === -3n, -7n % 2n === -1n, (1n << 64n) - 1n === 18446744073709551615n, BigInt('123456789012345678901234567890') * 10n === 1234567890123456789012345678900n, typeof BigInt === 'function'];
  return ok.every(Boolean);
}

// ── A 호환성 ──
function liveCompat(env) {
  const items = [];
  const t0 = env.now(); let bad = 0, total = 0;
  for (const v of LIVE_DEC_VECTORS) { total += 3; const a = dec(v.a), b = dec(v.b); if (String(decMul(a, b)) !== v.mul) bad++; if (String(decDiv(a, b)) !== v.div) bad++; if (String(decToMicro(a)) !== v.micro) bad++; }
  const ideal = compoundIdealSeries({ startMicro: 300000000n, startDay: '2026-01-01', schedule: [{ from: '2026-01-01', rate: '0.05' }], throughDay: addDays('2026-01-01', 364) });
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
  if (rest) { env.tamper(rest.id); const ic = storeIntegrityCheck(benv.drive.openStore(rest.id)), sw = backupSwitchChecks(benv, rest.id, { expectEnv: 'test' }); g5 = !ic.ok && !sw.ok; g6 = backupSwitchChecks(benv, list.find(x => x.id !== rest.id)?.id ?? rest.id, { expectEnv: 'prod' }).issues.includes('env-mismatch'); }
  items.push(liveItem('G5', g5 ? 'PASS' : 'FAIL', `임시 복원본 변조(셀 1개) ${g5 ? '무결성 실패로 탐지·전환 거부' : '탐지 실패'}`));
  items.push(liveItem('G6', g6 ? 'PASS' : 'FAIL', `환경 표식 불일치(test 시트를 prod 기대로 점검) ${g6 ? '거부' : '통과됨(위험)'}`));
  storeCreate(scr.se, 'setting', { name: 'backupTelegramCsv', value: 'on' }, A); const h0 = env.httpCount(); let g7;
  try { const r = backupRun(benv, { now: t1 + 40 * DAY }); g7 = r.warnings.includes('telegram-csv-unsupported') && env.httpCount() === h0; } catch { g7 = false; }
  items.push(liveItem('G7', g7 ? 'PASS' : 'FAIL', `Telegram CSV 설정을 켜도 전송 0건(경고만) ${g7 ? '확인' : '실패'}`));
  return items;
}
// 구간: 빠른 것(A·B)은 시작 즉시, 느린 것(C·G)은 백그라운드로 나눠 돌린다. 한 구간은 Apps Script 실행 한도(6분) 안에 끝나는 크기.
const LIVE_SECTIONS = Object.freeze([['A', liveCompat], ['B', liveEngine], ['C-io', liveSheetsIo], ['C-read', liveSheetsRead], ['G', liveBackup]]);
const LIVE_FAST_SECTIONS = Object.freeze(['A', 'B']);
const LIVE_SLOW_SECTIONS = Object.freeze(['C-io', 'C-read', 'G']);
function liveRunSection(name, env) { const f = LIVE_SECTIONS.find(([n]) => n === name); if (!f) throw new Error(`알 수 없는 구간: ${name}`); return f[1](env); }
function liveAutoAll(env) { return LIVE_SECTIONS.flatMap(([, f]) => f(env)); }

// ── livesafe.mjs ──
// 24시간 폴링 시험의 안전 장치(순수 함수): 실행 시간 예산 추정, 폴링 간격 선택, 자동 중단 조건.
//  · Apps Script 한도(문서상 일일 트리거 총 실행 90분·실행당 6분·UrlFetch 2만 회/일)는 *미검증 가정*이라, 그보다 넉넉한 내부 한도(일일 60분 추정)를 먼저 넘으면 스스로 멈춘다.
//  · 중단은 트리거 제거 + 사유 기록 + (가능하면) [TEST] 알림뿐이다. 프로젝트·시트·백업·봇은 삭제하거나 바꾸지 않는다.
const LIVE_LIMITS = Object.freeze({ dailyBudgetMin: 60, assumedQuotaMin: 90, maxRunMs: 120000, slowMax: 3, errStreakMax: 15, windowMs: 36 * 3600000, sentPerDayMax: 300, extraDailyMin: 6, minRunsForBudget: 30 });
const liveProjectDailyMin = (avgMs, intervalMin) => Math.round(((avgMs * (1440 / intervalMin)) / 60000 + LIVE_LIMITS.extraDailyMin) * 10) / 10;
// 평균 유휴 폴링 시간으로 간격 선택: 1분이 예산 안이면 1분, 아니면 5분, 5분도 넘으면 설치하지 않는다(minutes=null).
function liveChooseInterval(avgMs) {
  for (const m of [1, 5]) { const p = liveProjectDailyMin(avgMs, m); if (p <= LIVE_LIMITS.dailyBudgetMin) return { minutes: m, projectedMin: p }; }
  return { minutes: null, projectedMin: liveProjectDailyMin(avgMs, 5) };
}
// i: { env, prodApproved, stats:{runs,totalMs,maxMs,slow}, intervalMin, now, startedAt, errStreak, authError, quotaHit, sentToday, integrityBad }
function liveSafety(i) {
  const L = LIVE_LIMITS, halt = (reason, text, graceful = false) => ({ halt: true, reason, text, graceful });
  if (i.env !== 'test' || i.prodApproved) return halt('env-guard', '테스트 환경이 아니거나 운영 승인 플래그가 있습니다');
  if (i.authError) return halt('bot-token-invalid', '봇 토큰이 거부되었습니다(폐기·오입력)');
  if (i.quotaHit) return halt('quota-exceeded', 'Apps Script 할당량/호출 한도 오류가 감지되었습니다');
  if (i.integrityBad) return halt('integrity', '저장소 무결성 문제가 감지되었습니다');
  if (i.errStreak >= L.errStreakMax) return halt('poll-errors', `폴링이 ${i.errStreak}회 연속 실패했습니다`);
  const st = i.stats ?? {};
  if ((st.maxMs ?? 0) > L.maxRunMs) return halt('run-too-long', `폴링 1회가 ${Math.round(st.maxMs / 1000)}초 걸렸습니다(한도 ${L.maxRunMs / 1000}초)`);
  if ((st.slow ?? 0) >= L.slowMax) return halt('slow-runs', `30초가 넘는 폴링이 ${st.slow}회 발생했습니다`);
  if ((st.runs ?? 0) >= L.minRunsForBudget) { const p = liveProjectDailyMin(st.totalMs / st.runs, i.intervalMin ?? 1); if (p > L.dailyBudgetMin) return halt('runtime-budget', `하루 예상 실행 시간 ${p}분이 내부 한도 ${L.dailyBudgetMin}분을 넘습니다`); }
  if ((i.sentToday ?? 0) > L.sentPerDayMax) return halt('message-flood', `하루 발송 ${i.sentToday}건이 한도 ${L.sentPerDayMax}건을 넘었습니다`);
  if (i.now - i.startedAt >= L.windowMs) return halt('window-ended', '시험 시간(36시간)이 끝났습니다', true);
  return { halt: false };
}

// ── livewizard.mjs ──
// 휴대폰 안내형 시험 마법사(테스트 환경 전용): 사용자는 [TEST] 메시지의 버튼만 따라 누르면 되고, 판정은 시트 기록과 처리 동작 카운터로 자동으로 한다.
//  · 모든 메시지는 tg 어댑터가 '[TEST] ' 접두사를 붙인다. 시험 신호는 sid 'LT-…'(가짜 신호, 실제 시장과 무관), 시험 값은 고정(증거금 30·레버리지 10·진입 100·손절 98).
//  · 상태는 env.kv 의 'live' 한 키(JSON). 폴링 한 번이 끝날 때마다 liveWizardTick 이 호출되며, 처리된 update 가 있을 때만(또는 10분마다) 시트를 읽어 단계 완료를 판정한다.
//  · 마법사 버튼(lv:…)은 실제 명령(/fill·/exit·/equity)과 *같은 빌더·같은 저장 확인 경로*를 쓴다. 타자 입력 파싱은 오프라인 시험으로 검증되어 있다.

const LIVE_STEPS = Object.freeze(['signal', 'fill', 'fill-again', 'exit1', 'exit-web', 'review', 'equity', 'journal-edit', 'cashflow', 'expiry']);
const LIVE_REMIND_MS = 30 * 60000, LIVE_RECHECK_MS = 10 * 60000, LIVE_WEB_RECHECK_MS = 2 * 60000, LIVE_EXPIRY_WAIT_MS = 11 * 60000;
const LIVE_WEB_STEPS = ['exit-web', 'journal-edit', 'cashflow'];            // 웹 화면 조작은 폴링이 처리하는 update 가 없으므로 더 자주 확인
const liveGet = env => { const r = env.kv.get('live'); if (r === null || r === undefined) return null; try { return JSON.parse(r); } catch { return null; } };
const liveSet = (env, st) => env.kv.put('live', JSON.stringify(st));
const LIVE_A = { actor: 'live' };

function liveInit(env, { bot, intervalMin, now = env.now() }) {
  const st = { v: 1, phase: 'unpaired', step: -1, startedAt: now, bot, intervalMin, sid: `LT-${now.toString(36)}`, sid2: `LT-${(now + 1).toString(36)}x`, act: {}, base: {}, done: {}, lags: [], remind: 0, msgAt: 0, stepAt: 0, notify: false };
  liveSet(env, st); liveEnsureChallenge(env, now); return st;
}
// 테스트 시트에 시험용 챌린지(시작 300 USDT·일일 5%)를 만들고 지난 이틀을 마감해 둔다(알림은 꺼진 상태 → 'off' 기록, 소급 발송 없음).
function liveEnsureChallenge(env, now) {
  const se = env.storeEnv(); try { storeLoadLedgerInputs(se); return; } catch (e) { if (!(e instanceof StoreError && e.code === 'NOT_FOUND')) throw e; }
  storeSetupChallenge(se, { startEquity: '300', startDay: addDays(kstDayOf(now), -2), rate: '0.05' }, LIVE_A); closeRun({ now: () => now, storeEnv: () => se }, { now });
}
const liveKst = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
function seedSignals(env, st) {
  const se = env.storeEnv(), now = env.now();
  for (const [sid, sym] of [[st.sid, 'BTCUSDT'], [st.sid2, 'ETHUSDT']]) storeCreate(se, 'signal', { sid, strategy: 'A', symbolId: sym, dir: 'LONG', signalAt: now, entry: '100', stop: '98', tp1: '103' }, LIVE_A);
}
const liveFillsOf = (env, sid) => storeList(env.storeEnv(), 'fill').map(r => r.data).filter(f => f.sid === sid);
const liveDelta = (st, name) => (st.act[name] ?? 0) - (st.base[name] ?? 0);
const liveWeb = (env, path) => (typeof env.uiUrl === 'string' && /^https:\/\/\S+$/.test(env.uiUrl) ? `${env.uiUrl}${env.uiUrl.includes('?') ? '&' : '?'}${path}` : null);
const liveKb = (...rows) => ({ inline_keyboard: rows });
const liveSend = (env, st, text, markup) => { const r = tgSendMessage(env, tgPairedUser(env).chatId, text, markup); st.msgAt = env.now(); return r; };

// 단계별 정의: liveSend(안내 발송), done(완료 판정)
const LIVE_DEF = {
  'signal': { send: (env, st) => { const r = tgSendSignalPrompt(env, tgPairedUser(env).chatId, st.sid); st.msgAt = env.now(); liveSend(env, st, '1/10 위 신호 알림의 [진입했어]를 두 번 연속 눌러 보세요(중복 기록이 생기지 않아야 합니다).'); return r; },
    done: (env, st) => { const r = storeGet(env.storeEnv(), 'response', st.sid); return !!r && !r.void && r.data.choice === 'entered'; } },
  'fill': { send: (env, st) => liveSend(env, st, '2/10 [진입 기록 만들기]를 누르고, 나오는 확인 메시지에서 [저장]을 누르세요.', liveKb([{ text: '진입 기록 만들기', callback_data: `lv:fill:${st.sid}` }])), done: (env, st) => liveFillsOf(env, st.sid).some(f => f.kind === 'entry') },
  'fill-again': { send: (env, st) => liveSend(env, st, '3/10 같은 입력을 한 번 더 만듭니다. [같은 입력 다시 만들기] → [저장]을 눌러 보세요. "저장하지 못했습니다"가 나오면 정상입니다.', liveKb([{ text: '같은 입력 다시 만들기', callback_data: `lv:fill2:${st.sid}` }])),
    done: (env, st) => liveDelta(st, 'fill-rejected') >= 1 && liveFillsOf(env, st.sid).filter(f => f.kind === 'entry' || f.kind === 'add').length === 1 },
  'exit1': { send: (env, st) => liveSend(env, st, '4/10 [부분 청산 만들기] → [저장].', liveKb([{ text: '부분 청산 만들기', callback_data: `lv:exit1:${st.sid}` }])), done: (env, st) => liveFillsOf(env, st.sid).some(f => f.kind === 'reduce') },
  'exit-web': { send: (env, st) => { const u = liveWeb(env, `p=fill&sid=${encodeURIComponent(st.sid)}`); return liveSend(env, st, `5/10 ${u ? '웹 입력 화면에서 [청산] 탭 → 청산가 101 → 저장(저장 버튼을 두 번 눌러 보세요). 웹이 열리지 않으면 아래 [전량 청산 만들기]를 쓰세요.' : '웹 화면 주소가 없어 [전량 청산 만들기]로 진행합니다(웹 시험은 미검증으로 기록).'}`, liveKb(...(u ? [[{ text: '웹 입력 화면 열기', url: u }]] : []), [{ text: '전량 청산 만들기', callback_data: `lv:exit2:${st.sid}` }])); },
    done: (env, st) => liveFillsOf(env, st.sid).some(f => f.kind === 'close') },
  'review': { send: (env, st) => liveSend(env, st, '6/10 전량 청산 직후 온 [복기] 메시지에서 [저장]을 눌러 주세요(기본값 그대로 저장하면 됩니다).'), done: (env, st) => { const r = storeGet(env.storeEnv(), 'review', st.sid); return !!r && !r.void; } },
  'equity': { send: (env, st) => liveSend(env, st, '7/10 [평가액 입력 만들기] → [저장].', liveKb([{ text: '평가액 입력 만들기', callback_data: `lv:equity:${st.sid}` }])), done: (env, st) => storeList(env.storeEnv(), 'equity').length >= 1,
    after: (env, st) => { if (typeof env.enableTestNotify === 'function') { env.enableTestNotify(); st.notify = true; } } },
  'journal-edit': { send: (env, st) => { const u = liveWeb(env, 'p=journal'); return liveSend(env, st, u ? '8/10 웹 일지에서 이 시험 거래를 펼쳐 체결 하나의 [수정 / 취소]에서 가격을 바꾸고 사유 "시험"을 입력해 [수정 저장]을 누르세요.' : '8/10 웹 화면 주소가 없어 이 단계는 미검증으로 건너뜁니다.', u ? liveKb([{ text: '웹 일지 열기', url: u }]) : undefined); },
    done: (env, st) => (liveWeb(env, 'x') === null ? true : liveFillsOf(env, st.sid).some(f => (storeGet(env.storeEnv(), 'fill', f.fillId)?.rev ?? 1) >= 2)), skip: env => liveWeb(env, 'x') === null },
  'cashflow': { send: (env, st) => { const u = liveWeb(env, 'p=journal'); return liveSend(env, st, u ? '9/10 웹 일지의 [입출금 기록]에 금액 1, 메모 "시험"을 저장하세요.' : '9/10 웹 화면 주소가 없어 이 단계는 미검증으로 건너뜁니다.', u ? liveKb([{ text: '웹 일지 열기', url: u }]) : undefined); },
    done: (env, st) => (liveWeb(env, 'x') === null ? true : storeList(env.storeEnv(), 'cashflow').some(r => r.data.cfId.startsWith('cf-'))), skip: env => liveWeb(env, 'x') === null },
  'expiry': { send: (env, st) => { liveSend(env, st, '10/10 바로 아래 확인 메시지는 **지금 누르지 말고 11분 뒤에** [저장]을 눌러 보세요("만료됐거나 이미 처리됐습니다"가 나오면 정상).'); try { const ch = tgPairedUser(env); tgConfirmDraft(env, { chatId: ch.chatId, fromId: ch.userId }, tgBuildEntry(env, { sid: st.sid2, margin: '10', leverage: '10', entry: '100', stop: '98' })); } catch (e) { liveSend(env, st, `(만료 시험 초안을 만들지 못했습니다: ${String(e.message).slice(0, 60)})`); } st.expirySentAt = env.now(); },
    done: (env, st) => liveDelta(st, 'draft-gone') >= 1 },
};

// 마법사 버튼(lv:액션:sid): 실제 명령과 같은 빌더 + 같은 확인(저장) 경로
function liveOnCallback(env, ev, parts, cb, answer) {
  const st = liveGet(env), act = parts[1], user = { chatId: ev.chatId, fromId: ev.fromId };
  if (!st || st.phase === 'halted') { answer('시험이 종료되었습니다'); return { status: 'handled', action: 'live-closed' }; }
  try {
    if (act === 'fill' || act === 'fill2') tgConfirmDraft(env, user, tgBuildEntry(env, { sid: st.sid, margin: '30', leverage: '10', entry: '100', stop: '98' }));
    else if (act === 'exit1') tgConfirmDraft(env, user, tgBuildExit(env, { sid: st.sid, price: '103', qty: '1' }));
    else if (act === 'exit2') tgConfirmDraft(env, user, tgBuildExit(env, { sid: st.sid, price: '101' }));
    else if (act === 'equity') {
      const m = closeStatus(env, { now: env.now(), days: 14 }).find(d => d.closed && d.equity === null), day = m ? m.day : new Date(env.now() + 9 * 3600000).toISOString().slice(0, 10);
      closeCheckEquityDay(env, day, env.now()); tgConfirmDraft(env, user, { type: 'equity', equity: { day, equity: '305' }, summary: `평가액 입력 · ${day}\n실제 계좌 평가액 305 USDT\n(시험용 값입니다)` });
    } else { answer('알 수 없는 시험 버튼입니다'); return { status: 'handled', action: 'live-unknown' }; }
  } catch (e) { if (e instanceof StoreError) { answer(String(e.message).slice(0, 150)); return { status: 'handled', action: `live-${act}-refused` }; } throw e; }
  answer('확인 메시지를 보냈습니다'); return { status: 'handled', action: `live-${act}-draft` };
}

// 폴링 한 번이 끝날 때마다 호출: 카운터 누적, 페어링 감지, 단계 판정·안내
function liveWizardTick(env, pollOut = {}) {
  const st = liveGet(env); if (!st || st.phase === 'halted' || st.phase === 'done') return st;
  for (const [k, n] of Object.entries(pollOut.actions ?? {})) st.act[k] = (st.act[k] ?? 0) + n;
  for (const g of pollOut.lags ?? []) { st.lags.push(g); if (st.lags.length > 50) st.lags.shift(); }
  const now = env.now(), paired = tgPairedUser(env); let changed = Object.keys(pollOut.actions ?? {}).length > 0 || (pollOut.lags ?? []).length > 0;
  if (st.phase === 'unpaired') {
    if (paired) { seedSignals(env, st); st.phase = 'wizard'; st.step = 0; st.pairedAt = now; st.base = { ...st.act }; st.stepAt = now; liveSend(env, st, '시험을 시작합니다. 아래 안내를 순서대로 따라 주세요(약 15분). 모든 메시지는 시험용입니다.'); LIVE_DEF[LIVE_STEPS[0]].send(env, st); changed = true; }
  } else if (st.phase === 'wizard') {
    const id = LIVE_STEPS[st.step], def = LIVE_DEF[id], due = (pollOut.handled ?? 0) > 0 || now - (st.checkedAt ?? 0) >= (LIVE_WEB_STEPS.includes(id) ? LIVE_WEB_RECHECK_MS : LIVE_RECHECK_MS);
    if (due) {
      st.checkedAt = now; let ok = false; try { ok = def.done(env, st); } catch { ok = false; }
      if (ok) {
        st.done[id] = now; if (def.skip && def.skip(env)) st.done[id] = -now; if (def.after) def.after(env, st);
        if (st.step + 1 < LIVE_STEPS.length) { st.step++; st.base = { ...st.act }; st.stepAt = now; st.remind = 0; LIVE_DEF[LIVE_STEPS[st.step]].send(env, st); } else { st.phase = 'done'; st.finishedAt = now; liveSend(env, st, '모든 시나리오를 마쳤습니다. 24시간 관찰이 끝나면 최종 결과 요약이 자동으로 도착합니다(자정 마감 알림 1회가 올 수 있습니다).'); }
        changed = true;
      } else if (now - st.msgAt >= LIVE_REMIND_MS && st.remind < 3) { st.remind++; liveSend(env, st, `(알림 ${st.remind}/3) ${st.step + 1}/10 단계가 아직 끝나지 않았습니다. 위 안내의 버튼을 눌러 주세요.${id === 'expiry' && st.expirySentAt && now - st.expirySentAt < LIVE_EXPIRY_WAIT_MS ? ' (만료 시험은 11분 뒤에)' : ''}`); changed = true; }
    }
  }
  if (changed) liveSet(env, st); return st;
}

// ── livereport.mjs ──
// 시험 결과 자동 요약(PASS/FAIL/WAIT/WARN/SKIP). 입력은 자동 시험 결과·폴링 통계·마법사 상태·시트 집계뿐이며, 출력에는 금액·ID·토큰·이메일이 없다.
//  판정 규칙은 LIVE-TEST.md 의 통과 기준과 같다. 관찰 중인 항목(24시간·자정)은 기준을 지금까지 만족하면 WAIT(잠정 통과), 어기면 FAIL.

const LIVE_AUTO_IDS = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'C1', 'C2', 'C3', 'C4', 'C5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'];
const liveIt = (id, status, text) => ({ id, status, text });
const liveMedian = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

// ctx: { env(storeEnv 포함), now, auto:[...], stats:{since,runs,totalMs,maxMs,slow,busy,gaps90,maxGap,retry,errStreak}, counters:{...}, halt:{reason,text}|null, intervalMin }
function liveBuildReport(env, ctx) {
  const st = liveGet(env), se = env.storeEnv(), items = [...(ctx.auto ?? [])], stats = ctx.stats ?? {}, c = ctx.counters ?? {}, now = ctx.now;
  const elapsedH = stats.since ? (now - stats.since) / 3600000 : 0, observing = elapsedH < 24, act = st ? st.act : {}, done = st ? st.done : {};
  const wait = (ok, text, extra = '') => liveIt(null, ok ? (observing ? 'WAIT' : 'PASS') : 'FAIL', `${text}${observing && ok ? ` (관찰 ${elapsedH.toFixed(1)}/24시간, 잠정 통과)` : ''}${extra}`);
  for (const id of LIVE_AUTO_IDS) if (!items.some(i => i.id === id)) items.push(liveIt(id, 'WAIT', '아직 실행 전(백그라운드에서 진행 중)'));
  const iv = ctx.intervalMin ?? 1, expected = Math.max(1, Math.floor((now - (stats.since ?? now)) / (iv * 60000))), ratio = stats.runs ? stats.runs / expected : 0;
  if (!stats.runs) { items.push(liveIt('D1', 'WAIT', '폴링 관찰 시작 전(트리거 실행 없음)')); }
  else {
    const avg = stats.totalMs / stats.runs, proj = liveProjectDailyMin(avg, iv);
    items.push({ ...wait(ratio >= 0.9 || elapsedH < 0.5, `폴링 실행 ${stats.runs}회 / 이론 ${expected}회(${Math.round(ratio * 100)}%, 간격 ${iv}분) — 카운터 기준이며 편집기 Executions 건수와는 별도`), id: 'D1' });
    items.push({ ...wait(avg <= 3000 && stats.maxMs <= 15000 && (stats.slow ?? 0) === 0, `실행 시간 평균 ${Math.round(avg)}ms · 최대 ${stats.maxMs}ms · 30초 초과 ${stats.slow ?? 0}회`), id: 'D2' });
    items.push({ ...wait(proj <= LIVE_LIMITS.dailyBudgetMin, `하루 총 실행 시간 추정 ${proj}분(내부 한도 ${LIVE_LIMITS.dailyBudgetMin}분, 문서상 한도 ${LIVE_LIMITS.assumedQuotaMin}분은 미검증 가정)`), id: 'D3' });
    const gp = stats.runs ? (stats.gaps90 ?? 0) / stats.runs : 0; items.push({ ...wait(gp <= 0.03, `90초 초과 간격 ${stats.gaps90 ?? 0}회(${(gp * 100).toFixed(1)}%), 최대 간격 ${Math.round((stats.maxGap ?? 0) / 1000)}초`), id: 'D4' });
    const bp = (stats.busy ?? 0) / stats.runs; items.push({ ...wait(bp <= 0.02, `겹침(busy) ${stats.busy ?? 0}회(${(bp * 100).toFixed(1)}%), 중복 기록은 유일키로 0`), id: 'D5' });
  }
  const lags = st ? st.lags : [];
  items.push(lags.length >= 3 ? liveIt('D6', liveMedian(lags) <= 70000 && Math.max(...lags) <= 150000 ? 'PASS' : 'FAIL', `메시지 처리 지연 중앙값 ${Math.round(liveMedian(lags) / 1000)}초 · 최대 ${Math.round(Math.max(...lags) / 1000)}초 (n=${lags.length})`) : liveIt('D6', 'SKIP', `메시지 처리 지연 표본 부족(n=${lags.length}) — 버튼은 도착 시각이 없어 측정할 수 없고 입력한 메시지만 측정됩니다`));
  // E 기능 시나리오
  const rs = storeList(se, 'response').map(r => r.data).filter(r => st && r.sid === st.sid), fl = storeList(se, 'fill').map(r => r.data).filter(f => st && f.sid === st.sid), kind = k => fl.filter(f => f.kind === k).length;
  const started = !!(st && st.phase !== 'unpaired'), skipped = id => done[id] !== undefined && done[id] < 0, pending = id => !(id in done);
  const wiz = (id, step, label, cond, okText, extra = '') => items.push(!started ? liveIt(id, 'WAIT', `${label}: 페어링 전`) : skipped(step) ? liveIt(id, 'SKIP', `${label}: 웹 주소 없음 — 미검증`) : cond ? liveIt(id, 'PASS', `${label}: ${okText}${extra}`) : pending(step) || st.phase !== 'done' ? liveIt(id, 'WAIT', `${label}: 진행 중`) : liveIt(id, 'FAIL', `${label}: 판정 기준 미충족`));
  items.push(act.unpaired > 0 ? liveIt('E1', 'PASS', `낯선 계정 메시지 ${act.unpaired}건이 무응답·무기록으로 무시됨`) : liveIt('E1', 'SKIP', '낯선 계정 메시지를 보내지 않아 미검증'));
  items.push(started && st.pairedAt ? liveIt('E2', 'PASS', '신호 알림 메시지 발송·버튼 표시(발송 성공)') : liveIt('E2', 'WAIT', '페어링 전'));
  wiz('E3', 'signal', '진입했어 버튼', rs.length === 1 && rs[0].choice === 'entered', `응답 ${rs.length}건`, `, 연타 관측 ${(act['response-duplicate'] ?? 0) + (act['response-conflict'] ?? 0)}회`);
  wiz('E4', 'fill-again', '같은 입력 재시도', (act['fill-rejected'] ?? 0) >= 1 && kind('entry') + kind('add') === 1, `재입력 차단 ${act['fill-rejected'] ?? 0}회, 진입 ${kind('entry') + kind('add')}건`);
  const webUsed = (act['live-exit2-draft'] ?? 0) === 0; wiz('E5', 'exit-web', '웹 입력 화면', kind('close') === 1 && webUsed, `웹 입력 화면 전량 청산 ${kind('close')}건`);
  if (started && kind('close') === 1 && !webUsed) items[items.length - 1] = liveIt('E5', 'SKIP', '웹 입력 화면 대신 대체 버튼을 써서 웹 폼은 미검증');
  items.push(!started ? liveIt('E6', 'WAIT', '페어링 전') : kind('reduce') === 1 && kind('close') === 1 ? liveIt('E6', 'PASS', '부분 청산 1건 + 전량 청산 1건') : liveIt('E6', st.phase === 'done' ? 'FAIL' : 'WAIT', `부분 ${kind('reduce')}건 · 전량 ${kind('close')}건`));
  const rv = storeList(se, 'review').filter(r => st && r.key === st.sid).length; wiz('E7', 'review', '10초 복기', rv === 1, `복기 ${rv}건(저장 전 0건은 오프라인 시험으로 검증)`);
  const eqN = storeList(se, 'equity').length; wiz('E8', 'equity', '평가액 입력', eqN >= 1, `평가액 ${eqN}건, 차이는 표시만(손익 자동 반영 없음)`);
  wiz('E9', 'journal-edit', '일지 수정 이력', true, '체결 수정 이력(rev ≥ 2) 확인');
  wiz('E10', 'cashflow', '입출금 기록', true, '입출금 기록 확인');
  const ownerOk = c['ui-owner-ok'] ?? 0, denOther = c['ui-denied-other'] ?? 0, denAnon = c['ui-denied-anon'] ?? 0;
  items.push(ownerOk >= 1 && denOther >= 1 ? liveIt('E11', 'PASS', `UI: 소유자 접속 ${ownerOk}회 표시, 다른 Google 계정 접속 ${denOther}회 차단, 익명 ${denAnon}회 차단`)
    : ownerOk >= 1 && denAnon >= 1 ? liveIt('E11', 'WARN', `UI: 소유자 표시 ${ownerOk}회, 익명 차단 ${denAnon}회 확인 — 두 번째 Google 계정 차단은 미검증`)
    : ownerOk >= 1 ? liveIt('E11', 'WAIT', `UI: 소유자 표시 ${ownerOk}회 확인 — 차단 시험(시크릿 창/다른 계정) 대기`)
    : (denAnon + denOther) >= 1 ? liveIt('E11', observing ? 'WARN' : 'FAIL', `UI: 소유자 접속 표시는 없고 차단 기록만 ${denAnon + denOther}회 — 본인 계정이 막혔을 수 있음("접속한 사용자로 실행" 배포 설정 확인 또는 UI 인증 방식 재설계 필요)${observing ? ' [관찰 중]' : ''}`) : liveIt('E11', 'WAIT', 'UI 접속 대기'));
  const notices = storeList(se, 'closenotice').map(r => r.data), sent = notices.filter(n => n.status === 'sent');
  items.push(sent.length >= 1 ? liveIt('E12', sent.length === new Set(sent.map(n => n.day)).size ? 'PASS' : 'FAIL', `일 마감 알림 발송 ${sent.length}건(날짜당 1회, 중복 ${sent.length - new Set(sent.map(n => n.day)).size})`) : liveIt('E12', 'WAIT', st && st.notify ? '자정 마감 알림 대기(00:00~01:00)' : '알림 시험 활성화 전(평가액 입력 단계 이후)'));
  // F 중복·장애
  items.push((act['draft-gone'] ?? 0) >= 1 ? liveIt('F3', 'PASS', `만료된 초안 저장 시도 ${act['draft-gone']}회 → 기록 0건, 안내 표시`) : liveIt('F3', started ? 'WAIT' : 'WAIT', '만료 초안 시험 대기'));
  const fd = c['form-duplicate'] ?? 0; items.push(fd >= 1 ? liveIt('F4', 'PASS', `웹 폼 중복 제출 ${fd}회 → 1건으로 수렴`) : liveIt('F4', 'SKIP', '웹 폼 중복 제출이 관측되지 않아 미검증(오프라인 시험으로는 검증됨)'));
  items.push(liveIt('F5', 'SKIP', `락 경합 직접 시험은 수동 항목(선택). 관측: LOCK 재시도 ${stats.retry ?? 0}회`));
  let ic; try { ic = storeIntegrityCheck(se); } catch { ic = { ok: false, issues: [{ type: 'read-failed' }] }; }
  const onlyMissing = !ic.ok && ic.issues.every(i => i.type === 'missing-view');
  items.push(ic.ok ? liveIt('F6', 'PASS', `무결성 OK(감사 ${ic.auditCount}행)`) : onlyMissing ? liveIt('F6', 'WARN', `무결성: 마지막 쓰기 중단 흔적(엔티티 행 누락 ${ic.issues.length}건, storeRepair로 복구 가능)`) : liveIt('F6', 'FAIL', `무결성 문제: ${[...new Set(ic.issues.map(i => i.type))].join(', ')}`));
  // H 마감 트리거
  const closes = storeList(se, 'dayclose').map(r => r.data).filter(d => st && d.closedAt > st.startedAt), mid = closes.filter(d => { const h = new Date(d.closedAt + 9 * 3600000).getUTCHours(); return h < 2 && kstDayOf(d.closedAt) !== d.day; });
  items.push(mid.length >= 1 ? liveIt('H1', 'PASS', `자정 트리거 마감 ${mid.length}건, 지연 ${mid.map(d => Math.round(((d.closedAt + 9 * 3600000) % 86400000) / 60000)).join('·')}분(00:00 기준)`) : liveIt('H1', 'WAIT', '자정(00:00~01:00 KST) 마감 관찰 대기'));
  items.push(liveIt('H2', 'SKIP', '매시간 재확인의 놓친 날 보충은 수동 항목(선택): 00시 트리거를 하루 꺼 두면 확인 가능'));
  // S 안전
  items.push(ctx.halt ? (ctx.halt.reason === 'window-ended' ? liveIt('S1', 'PASS', '시험 시간(36시간) 종료로 정상 중단') : liveIt('S1', 'FAIL', `자동 중단: ${ctx.halt.text}`)) : liveIt('S1', 'PASS', '자동 중단 조건 미해당(운영 환경 접근·토큰 오류·할당량 오류·무결성 문제 없음)'));
  items.push(liveIt('S2', 'PASS', '이 시험은 test 환경·테스트 봇에서만 실행(운영 승인 플래그 없음, 모든 메시지 [TEST])'));
  return items;
}
function liveSummary(items) {
  const n = s => items.filter(i => i.status === s).length, fail = n('FAIL'), wait = n('WAIT');
  return { pass: n('PASS'), fail, wait, warn: n('WARN'), skip: n('SKIP'), verdict: fail ? 'FAIL' : wait ? 'WAIT' : 'PASS' };
}
// 텔레그램/로그용 텍스트(4096자 한도 안에서 나눔). 값 없는 PASS/FAIL 줄만.
function liveReportTexts(items, { title = 'LIVE 결과' } = {}) {
  const s = liveSummary(items), head = `${title}: ${s.verdict} — PASS ${s.pass} · FAIL ${s.fail} · WAIT ${s.wait} · WARN ${s.warn} · SKIP ${s.skip}`, lines = items.map(i => `${i.status} ${i.id} ${i.text}`);
  const out = []; let cur = head; for (const l of lines) { if (cur.length + l.length + 1 > 3600) { out.push(cur); cur = `${title}(계속)`; } cur += `\n${l}`; } out.push(cur); return out;
}
void LIVE_STEPS;

// ── livehook.mjs ──
// 폴링이 끝날 때마다 호출되는 시험 하니스 진입점(테스트 환경 전용): 안전 점검 → 마법사 진행 → 중간/최종 결과 발송.
//  io = { stats(), counters(), envName(), prodApproved(), removeTriggers(), saveHalt(obj), auto():[...], halt():obj|null }  (Apps Script가 속성으로 구현)
//  중단(halt)은 트리거 제거 + 사유 기록 + [TEST] 알림뿐이며 프로젝트·시트·백업·봇은 삭제하거나 바꾸지 않는다.

const liveDayKey = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
function liveSendTexts(env, texts) { const p = tgPairedUser(env); if (!p) return false; let ok = true; for (const t of texts) ok = tgSendMessage(env, p.chatId, t).ok && ok; return ok; }
function liveReportNow(env, io, st) {
  const stats = io.stats(), items = liveBuildReport(env, { now: env.now(), auto: io.auto(), stats: { ...stats, retry: st ? st.retryTotal ?? stats.retry : stats.retry }, counters: io.counters(), halt: io.halt(), intervalMin: st ? st.intervalMin : 1 });
  return items;
}
function liveHalt(env, io, st, v) {
  const now = env.now(); st.phase = 'halted'; st.halt = { reason: v.reason, text: v.text, at: now }; liveSet(env, st); io.saveHalt(st.halt);
  try { io.removeTriggers(); } catch { /* 이미 없음 */ }
  if (v.graceful) { try { liveSendTexts(env, [...liveReportTexts(liveReportNow(env, io, st), { title: 'LIVE 최종 결과' }), '시험 시간이 끝나 폴링을 멈췄습니다(트리거 제거). 데이터·시트·백업은 그대로 있습니다.']); } catch { /* 발송 실패는 무시 */ } }
  else { try { liveSendTexts(env, [`자동 중단: ${v.text}. 트리거를 제거했습니다(데이터·시트·백업은 그대로입니다).`]); } catch { /* 발송이 막혔을 수 있음 */ } }
  return { halted: true, reason: v.reason };
}
function liveHookRun(env, out, io) {
  let st = liveGet(env); if (!st || st.phase === 'halted') return { skipped: true };
  const now = env.now(), stats = io.stats(), ct = io.counters();
  st.errStreak = out.status === 'ok' || out.status === 'busy' ? 0 : (st.errStreak ?? 0) + 1;
  if (out.status === 'error' && out.code === 'auth') st.authError = true;
  if (out.status === 'exception' && out.quota) st.quotaHit = true;
  st.retryTotal = (st.retryTotal ?? 0) + (out.retry ?? 0);
  if (now - (st.integAt ?? 0) >= 1800000) { st.integAt = now; try { const ic = storeIntegrityCheck(env.storeEnv()); st.integrityBad = !ic.ok && !ic.issues.every(i => i.type === 'missing-view'); } catch { st.integrityBad = true; } }
  liveSet(env, st);
  const v = liveSafety({ env: io.envName(), prodApproved: io.prodApproved(), stats, intervalMin: st.intervalMin, now, startedAt: st.startedAt, errStreak: st.errStreak, authError: !!st.authError, quotaHit: !!st.quotaHit, sentToday: ct[`sent:${liveDayKey(now)}`] ?? 0, integrityBad: !!st.integrityBad });
  if (v.halt) return liveHalt(env, io, st, v);
  st = liveWizardTick(env, out) ?? st;
  if (st.phase === 'done' && !st.interimSent) { st.interimSent = true; liveSet(env, st); try { liveSendTexts(env, liveReportTexts(liveReportNow(env, io, st), { title: 'LIVE 중간 결과(24시간 항목은 WAIT)' })); } catch { /* 다음 틱에 재시도하지 않음(중복 방지) */ } }
  if (st.phase === 'done' && !st.finalSent && now - st.startedAt >= 24 * 3600000) { st.finalSent = true; liveSet(env, st); try { liveSendTexts(env, liveReportTexts(liveReportNow(env, io, st), { title: 'LIVE 최종 결과' })); } catch { /* ignore */ } }
  return { ok: true, phase: st.phase };
}
// 봇 확인: 테스트 봇이 맞는지(이름에 test), 웹훅이 없는지. 운영 봇 토큰을 실수로 넣었을 때 시작을 거부한다. 사용자명은 결과에 남기되 토큰은 다루지 않는다.
function liveBotCheck(env) {
  const me = tgCall(env, 'getMe', {});
  if (!me.ok) return { ok: false, reason: me.code === 'auth' ? 'token-rejected' : `getMe-failed:${me.code}` };
  const username = String(me.result && me.result.username ? me.result.username : '');
  if (!/test/i.test(username)) return { ok: false, reason: 'not-test-bot' };
  const wh = tgCall(env, 'getWebhookInfo', {}); let removed = false;
  if (wh.ok && wh.result && wh.result.url) { const d = tgCall(env, 'deleteWebhook', { drop_pending_updates: false }); if (!d.ok) return { ok: false, reason: 'webhook-not-removed' }; removed = true; }
  return { ok: true, username, webhookRemoved: removed };
}

// ── exports ──
var RICH300_ENGINE = { DEC_DIGITS, decRoundDiv, dec, decAdd, decSub, decNeg, decAbs, decMul, decDiv, decCmp, decSign, decIsZero, decToMicro, microToDec, decFormat, microFormat, microToNumber, microFromNumber, isDayString, dayToIndex, indexToDay, kstDayOf, dayStartMs, dayEndMs, addDays, daysBetween, dayRange, rateFraction, compoundNextTarget, compoundRateOn, compoundIdealSeries, dedupeCanonical, dedupeSame, dedupeAppend, dedupePossibleFills, dedupeRevise, dedupeVoid, dedupeLatest, PNL_ENTRY_KINDS, PNL_EXIT_KINDS, pnlNormalizeFill, pnlComputeTrade, pnlComputeAll, pnlDailyFlows, pnlMicroToString, riskTrade, riskMicroLabel, LEDGER_REVIEW_ABS_MICRO, LEDGER_REVIEW_PPM, ledgerBuildDaily, ledgerSummarize, ledgerMicroLabel, SCHEMA_VERSION, StoreError, PLAN_CHOICES, MIND_CHOICES, RESPONSE_CHOICES, SETTING_DEFAULTS, schemaDecString, ENTITIES, ENTITY_NAMES, AUDIT_SHEET, VIEW_HEADERS, AUDIT_HEADERS, META_HEADERS, storeInit, storeReadAudit, storeReadView, storeGet, storeList, storeHistory, storeWithLock, storeCreate, storeRevise, storeVoid, storeClaimUpdate, storeSaveReview, storeSetupChallenge, storeGetSettings, storeIntegrityCheck, storeRepair, storeLoadLedgerInputs, storeBuildLedger, BACKUP_RE, BACKUP_MIN_KEEP, backupName, backupRestoredName, backupKeepFrom, backupRetention, backupFingerprint, backupRun, backupRestore, backupSwitchChecks, DEPLOY_ENVS, deployGate, deployMarkEnv, deployReadEnv, deployCheckEnv, deploySelfTest, AUTH_VERSION, AUTH_WINDOW_MS, AUTH_NONCE_TTL_SEC, AUTH_MAX_BYTES, AUTH_MIN_KEY_LEN, authTimingSafeEqual, authCanonicalBody, authSignedString, authBuildRequest, authVerify, INGEST_UNAUTHORIZED, ingestHandle, TG_MAX_ATTEMPTS, TG_MAX_WAIT_MS, TG_DRAFT_TTL_SEC, TG_PAIR_TTL_SEC, TG_PAIR_MAX_FAILS, TG_DUP_WINDOW_MS, TG_POISON_AFTER, TG_SID_RE, tgClassify, TG_BENIGN, tgCall, tgSendMessage, tgSendNotice, tgParseUpdate, tgParseCommand, tgPairCreate, tgPairedUser, tgResponseKeyboard, tgSignalText, tgFillLink, tgSendSignalPrompt, tgReviewKeyboard, tgReviewText, tgBuildEntry, tgBuildExit, tgSubmitFillForm, tgConfirmDraft, tgHandleUpdate, tgPoll, tgGc, CLOSE_MAX_CATCHUP, CLOSE_MAX_ATTEMPTS, CLOSE_PENDING_STALE_MS, CLOSE_WARNING_TEXT, closeUsd, closeDiagnose, closeMessage, closeRetryNotices, closePlan, closeCommit, closeRun, closeTick, closeCheckEquityDay, closeSubmitEquity, closeStatus, AN_MIN_SAMPLE, AN_INSIGHT_MIN, anUsd, anRatio, anPct, anStats, anTradesFrom, anReviews, anBuild, JOURNAL_FILL_EDITABLE, JOURNAL_LIMIT, journalDiff, journalHistory, journalBuild, journalReviseFill, journalVoidFill, journalAddCashflow, journalVoidCashflow, jvEsc, journalRenderError, journalRenderHtml, LIVE_DEC_VECTORS, LIVE_IDEAL_VECTORS, LIVE_PNL_VECTORS, LIVE_HMAC_VECTORS, LIVE_THRESH, LIVE_SHA_VECTORS, liveSha256, liveMemStore, liveDataset, liveCompat, liveEngine, liveSheetsIo, liveSheetsRead, liveSheets, liveBackup, LIVE_SECTIONS, LIVE_FAST_SECTIONS, LIVE_SLOW_SECTIONS, liveRunSection, liveAutoAll, LIVE_LIMITS, liveProjectDailyMin, liveChooseInterval, liveSafety, LIVE_STEPS, liveGet, liveSet, liveInit, liveOnCallback, liveWizardTick, liveBuildReport, liveSummary, liveReportTexts, liveReportNow, liveHookRun, liveBotCheck };

// ── gas/Adapters.gs ──
/**
 * RICH 300 — Apps Script 어댑터: store.mjs 가 요구하는 env 포트(now/sha256/lock/sheets)를 SpreadsheetApp·LockService·Utilities 로 구현한다.
 * 엔진 번들(rich300/build.mjs 산출물)과 같은 프로젝트에 붙여 넣어 쓴다. 이 파일에는 비밀값이 없다(스프레드시트 ID는 호출자가 Script Properties 등에서 읽어 넘긴다).
 *  · 모든 시트 열은 *텍스트 서식('@')*으로 만든다: 그렇지 않으면 Sheets가 "2026-10-24"를 날짜로, "123"을 숫자로 바꿔 키·값이 손상된다.
 *  · 쓰기는 getRange().setValues() 일괄 쓰기 후 flush() — 호출 하나가 한 번의 쓰기 단위다(store의 선기록 순서를 지키기 위함).
 */
function rich300Hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }

function rich300GasEnv_(spreadsheetId, opts) {
  var ss = SpreadsheetApp.openById(spreadsheetId), lock = LockService.getScriptLock();
  return {
    now: function () { return Date.now(); },
    lockTimeoutMs: (opts && opts.lockTimeoutMs) || 10000,
    sha256: function (s) { return rich300Hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); },
    lock: { tryLock: function (ms) { return lock.tryLock(ms); }, release: function () { lock.releaseLock(); } },
    sheets: {
      ensure: function (name, headers) {
        var sh = ss.getSheetByName(name);
        if (!sh) {
          sh = ss.insertSheet(name);
          sh.getRange(1, 1, 1, headers.length).setNumberFormat('@').setValues([headers]);
          sh.setFrozenRows(1);
          return;
        }
        var cur = sh.getLastRow() >= 1 ? sh.getRange(1, 1, 1, headers.length).getValues()[0].map(String) : [];
        if (JSON.stringify(cur) !== JSON.stringify(headers)) throw new Error('헤더 불일치: ' + name);
      },
      rows: function (name) {
        var sh = ss.getSheetByName(name), n = sh.getLastRow();
        if (n <= 1) return [];
        return sh.getRange(2, 1, n - 1, sh.getLastColumn()).getValues();
      },
      append: function (name, rows) {
        if (!rows.length) return;
        var sh = ss.getSheetByName(name), start = sh.getLastRow() + 1, width = rows[0].length;
        if (start + rows.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), Math.max(rows.length, 100));
        sh.getRange(start, 1, rows.length, width).setNumberFormat('@').setValues(rows);
        SpreadsheetApp.flush();
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
 *  · 이 파일은 로그를 출력하지 않는다(Logger/console 없음). GET 요청에는 빈 응답.
 */
/**
 * GET 라우터: 기본은 빈 응답(익명 GET에 아무 정보도 주지 않는다 — S0 실측: 익명 GET도 도달 가능).
 *  ?p=fill (R4 모바일 입력 화면), ?p=dash (R6 대시보드)는 해당 PR이 페이지 함수를 정의했을 때만 동작하고, *소유자 이메일 확인이 통과해야* 한다.
 *  소유자 확인은 fail-closed: RICH300_OWNER_EMAIL 미설정이거나 방문자 이메일을 알 수 없으면(익명·"나로 실행" 배포의 타인) 거부한다.
 */
var RICH300_PAGES_ = { fill: 'rich300PageFill_', dash: 'rich300PageDash_', journal: 'rich300PageJournal_' };
function rich300UiWho_() {                              // 'owner' | 'other'(이메일은 보이나 소유자 아님) | 'anon'(이메일 불명)
  try {
    var owner = String(PropertiesService.getScriptProperties().getProperty('RICH300_OWNER_EMAIL') || '').trim().toLowerCase();
    var me = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    if (!me) return 'anon';
    return owner.length > 3 && me === owner ? 'owner' : 'other';
  } catch (err) { return 'anon'; }
}
function rich300IsOwner_() { return rich300UiWho_() === 'owner'; }
function doGet(e) {
  var name = e && e.parameter && e.parameter.p, fn = name && Object.prototype.hasOwnProperty.call(RICH300_PAGES_, name) ? RICH300_PAGES_[name] : null;
  if (fn && typeof globalThis[fn] === 'function') {
    var who = rich300UiWho_();
    if (typeof rich300LiveCount_ === 'function') rich300LiveCount_('ui-' + (who === 'owner' ? 'owner-ok' : who === 'other' ? 'denied-other' : 'denied-anon'));     // 시험 환경 전용 카운터(값 없음)
    if (who === 'owner') return globalThis[fn](e);
  }
  return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
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
    live: envName === 'test' && typeof rich300LiveEnabled_ === 'function' ? { onCallback: function (env, ev, parts, cb, answer) { return RICH300_ENGINE.liveOnCallback(env, ev, parts, cb, answer); } } : undefined,
    enableTestNotify: function () { if (typeof rich300LiveEnableNotify_ === 'function') rich300LiveEnableNotify_(); },
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
        if (method !== 'getUpdates' && typeof rich300LiveCount_ === 'function') { rich300LiveCount_('http'); if (method === 'sendMessage') rich300LiveCount_('sent:' + new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)); }       // 시험 환경 전용 카운터
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
  if (typeof rich300LiveHook_ === 'function') { try { rich300LiveHook_(out); } catch (err) { /* 검증 하니스 오류가 폴링을 막지 않는다 */ } }
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
  if (typeof rich300LiveCount_ === 'function' && r && r.status === 'duplicate') rich300LiveCount_('form-duplicate');
  return r;
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
    sendEnabled: function () { return props.getProperty('RICH300_CLOSE_SEND_APPROVED') === 'yes' || (props.getProperty('RICH300_ENV') === 'test' && props.getProperty('RICH300_TEST_CLOSE_SEND') === 'yes'); },       // 테스트 전용 플래그는 test 환경에서만 인정
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
function rich300PageJournal_(e) {
  var html;
  try {
    var env = rich300JournalEnv_(), model = RICH300_ENGINE.journalBuild(env, { now: Date.now() }), day = e && e.parameter && e.parameter.day;
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) model.presetDay = day;
    html = RICH300_ENGINE.journalRenderHtml(model, { appUrl: ScriptApp.getService().getUrl() });
  } catch (err) { html = RICH300_ENGINE.journalRenderError(); }
  return HtmlService.createHtmlOutput(html).setTitle('RICH300 일지').addMetaTag('viewport', 'width=device-width, initial-scale=1');
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
function rich300TgGate_(method) {
  var p = PropertiesService.getScriptProperties();
  return RICH300_ENGINE.deployGate({ env: p.getProperty('RICH300_ENV'), prodApproved: p.getProperty('RICH300_PROD_APPROVED'), testTgAllow: p.getProperty('RICH300_TEST_TG_ALLOW') }, method);
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
function rich300RemoveAllTriggers() { var done = ['rich300TgRemovePollTrigger', 'rich300RemoveCloseTriggers', 'rich300BackupRemoveTrigger', 'rich300LiveClearBg_'].filter(rich300CallIf_); return { ok: true, removed: done.length }; }

/** 자가 점검: 상태만 반환(값 없음). 실행 로그에도 같은 요약을 남긴다. */
function rich300SelfTestRun_() {
  var p = PropertiesService.getScriptProperties(), has = function (k) { return !!p.getProperty(k); }, info, se = null, integ = null, marker = null, backups = 0;
  try { if (has('RICH300_SHEET_ID')) { se = rich300GasEnv_(p.getProperty('RICH300_SHEET_ID')); RICH300_ENGINE.storeInit(se); var c = RICH300_ENGINE.storeIntegrityCheck(se); integ = { ok: c.ok, issues: c.issues.map(function (i) { return i.type; }) }; marker = RICH300_ENGINE.deployCheckEnv(se, p.getProperty('RICH300_ENV')); } } catch (err) { integ = null; }
  try { backups = rich300BackupList().filter(function (x) { return /^RICH300-backup-/.test(x.name); }).length; } catch (err) { backups = 0; }
  var email = ''; try { email = Session.getActiveUser().getEmail() || ''; } catch (err) { email = ''; }
  var key = p.getProperty('RICH300_INGEST_KEY') || '';
  info = { env: p.getProperty('RICH300_ENV'), tz: Session.getScriptTimeZone(), v8: typeof BigInt === 'function',
    has: { sheetId: has('RICH300_SHEET_ID'), ownerEmail: has('RICH300_OWNER_EMAIL'), tgToken: has('RICH300_TG_TOKEN'), ingestKey: key.length > 0, uiUrl: /^https:\/\//.test(p.getProperty('RICH300_UI_URL') || '') }, ingestKeyLen: key.length,
    flags: { closeSendApproved: p.getProperty('RICH300_CLOSE_SEND_APPROVED') === 'yes', prodApproved: p.getProperty('RICH300_PROD_APPROVED') === 'yes', testTgAllow: p.getProperty('RICH300_TEST_TG_ALLOW') === 'yes', testCloseSend: p.getProperty('RICH300_TEST_CLOSE_SEND') === 'yes' },
    owner: { activeEmailVisible: email.length > 3, matchesOwner: email.length > 3 && email.toLowerCase() === String(p.getProperty('RICH300_OWNER_EMAIL') || '').toLowerCase() },
    triggers: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }), expectTriggers: [['rich300TgInstallPollTrigger', 'rich300TgPoll'], ['rich300InstallCloseTriggers', 'rich300CloseTick'], ['rich300BackupInstallTrigger', 'rich300BackupRun']].filter(function (x) { return typeof globalThis[x[0]] === 'function'; }).map(function (x) { return x[1]; }), integrity: integ, envMarker: marker, backupCount: backups };
  return RICH300_ENGINE.deploySelfTest(info);
}
function rich300SelfTest() {
  var r = rich300SelfTestRun_();
  Logger.log('RICH300 자가 점검: 실패 ' + r.fail + ' · 경고 ' + r.warn + '\n' + r.items.filter(function (i) { return !i.ok; }).map(function (i) { return '[' + i.level + '] ' + i.text; }).join('\n'));
  return r;
}

// ── gas/LiveVerify.gs ──
/**
 * RICH 300 — 실제 환경 검증 하니스(테스트 프로젝트 전용). 엔진 번들 + 나머지 gas 파일과 같은 프로젝트에 둔다.
 *  사용자는 rich300LiveStart() 를 *한 번* 실행하고(권한 동의), 봇 토큰만 스크립트 속성에 입력하면 된다. 나머지(설치·자동 검증·트리거·페어링 링크·휴대폰 안내·결과 요약)는 자동이다.
 *  · 테스트 환경(RICH300_ENV=test)에서만 동작한다. 운영 환경이거나 운영 승인 플래그가 있으면 거부한다.
 *  · 봇 사용자명에 'test' 가 없으면(운영 봇 토큰을 실수로 넣은 경우) 시작을 거부한다.
 *  · 결과는 PASS/FAIL/WAIT/WARN/SKIP 요약(값 없음)으로 텔레그램 [TEST] 메시지와 실행 로그에 나온다. 토큰·시트 ID·이메일·금액은 출력하지 않는다.
 *  · 어떤 프로젝트·시트·백업·봇도 삭제하지 않는다(임시 시트와 백업은 결과 확인 뒤 정리 여부를 사용자에게 묻는다).
 */
function rich300LiveEnabled_() { return true; }
function rich300LiveProps_() { return PropertiesService.getScriptProperties(); }
function rich300LiveJson_(k, d) { try { var v = rich300LiveProps_().getProperty(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function rich300LiveIsTest_() { var p = rich300LiveProps_(); return p.getProperty('RICH300_ENV') === 'test' && p.getProperty('RICH300_PROD_APPROVED') !== 'yes'; }

/** 시험 환경 전용 카운터(이름별 횟수). 값·ID 없음. */
function rich300LiveCount_(name) {
  try { if (!rich300LiveIsTest_()) return; var p = rich300LiveProps_(), o = rich300LiveJson_('live:ct', {}); o[name] = (o[name] || 0) + 1; p.setProperty('live:ct', JSON.stringify(o)); } catch (e) { /* 카운터 실패는 무시 */ }
}
function rich300LiveEnableNotify_() {
  var p = rich300LiveProps_(); if (!rich300LiveIsTest_()) return;
  p.setProperty('RICH300_TEST_CLOSE_SEND', 'yes');
  var se = rich300GasEnv_(p.getProperty('RICH300_SHEET_ID')), E = RICH300_ENGINE, r = E.storeCreate(se, 'setting', { name: 'closeNotify', value: 'on' }, { actor: 'live' });
  if (r.status === 'conflict') E.storeRevise(se, 'setting', 'setting:closeNotify', { value: 'on' }, { actor: 'live', reason: '시험: 마감 알림 확인' });
}
function rich300LiveIo_() {
  var p = rich300LiveProps_();
  return { stats: function () { return rich300LiveJson_('tg:stats', {}); }, counters: function () { return rich300LiveJson_('live:ct', {}); }, envName: function () { return p.getProperty('RICH300_ENV'); },
    prodApproved: function () { return p.getProperty('RICH300_PROD_APPROVED') === 'yes'; }, removeTriggers: function () { rich300RemoveAllTriggers(); },
    saveHalt: function (o) { p.setProperty('live:halt', JSON.stringify(o)); }, auto: function () { return rich300LiveJson_('live:auto', []); }, halt: function () { return rich300LiveJson_('live:halt', null); } };
}
/** 폴링 한 번이 끝날 때 Telegram.gs 가 부른다(시험이 시작된 경우에만 일을 한다). */
function rich300LiveHook_(out) {
  if (!rich300LiveIsTest_() || !rich300LiveJson_('tg:live', null)) return;                 // tg:live = 시험 상태(시작 전에는 없음)
  RICH300_ENGINE.liveHookRun(rich300TgEnv_(), out, rich300LiveIo_());
}

function rich300LivePorts_() {
  var p = rich300LiveProps_(), base = rich300TgEnv_(), stamp = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace(/[-:T]/g, '');
  var scratchDrive = rich300BackupDrive_('RICH300-LIVE-SCRATCH');
  return {
    now: function () { return Date.now(); },
    hmacSha256: function (key, msg) { return rich300Hex_(Utilities.computeHmacSha256Signature(msg, key)); },
    sha256: base.sha256,
    tz: function () { return Session.getScriptTimeZone(); },
    formatKst: function (ms) { return Utilities.formatDate(new Date(ms), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'); },
    selfTest: function () { return rich300SelfTestRun_(); },
    newScratch: function (label) {
      var id = SpreadsheetApp.create('RICH300-LIVE-SCRATCH-' + label + '-' + stamp).getId();
      try { DriveApp.getFolderById(scratchDrive.ensureFolder()).addFile(DriveApp.getFileById(id)); } catch (e) { /* 폴더 정리는 선택 */ }
      var se = rich300GasEnv_(id); RICH300_ENGINE.storeInit(se); RICH300_ENGINE.deployMarkEnv(se, 'test'); return { se: se, id: id };
    },
    scratchDrive: function () { return scratchDrive; },
    realBackup: function () { return rich300BackupEnv_(); },
    tamper: function (id) { var sh = SpreadsheetApp.openById(id).getSheetByName('Fills'); sh.getRange(2, 5).setNumberFormat('@').setValue('{"tampered":"yes"}'); },
    sleep: function (ms) { Utilities.sleep(ms); },
    httpCount: function () { return (rich300LiveJson_('live:ct', {}).http || 0); }
  };
}
function rich300LiveMeasureIdle_(n) {
  var times = [];
  for (var i = 0; i < n; i++) { var t0 = Date.now(); rich300TgPoll(); times.push(Date.now() - t0); }
  times.sort(function (a, b) { return a - b; });
  var p = rich300LiveProps_(); p.deleteProperty('tg:stats'); p.deleteProperty('tg:last');
  return { median: times[Math.floor(times.length / 2)], max: times[times.length - 1] };
}
function rich300LiveFail_(msg, extra) { Logger.log('RICH300 LIVE: 시작하지 못했습니다 — ' + msg); var o = { ok: false, error: msg }; for (var k in (extra || {})) o[k] = extra[k]; return o; }

/**
 * 설치 + 자동 검증 + 시험 시작을 한 번에. 여러 번 실행해도 안전하다(이미 시작했으면 상태와 페어링 링크만 다시 보여 준다).
 * 사용자 입력: 스크립트 속성 RICH300_TG_TOKEN(테스트 봇 토큰) 한 가지뿐.
 */
function rich300LiveStart() {
  var p = rich300LiveProps_(), E = RICH300_ENGINE;
  if (p.getProperty('RICH300_ENV') && p.getProperty('RICH300_ENV') !== 'test') return rich300LiveFail_('이 프로젝트는 test 환경이 아닙니다(운영 프로젝트에서는 실행하지 않습니다)');
  if (p.getProperty('RICH300_PROD_APPROVED') === 'yes') return rich300LiveFail_('운영 승인 플래그가 있는 프로젝트입니다');
  var setup = rich300Setup_('test'); if (!setup.ok) return rich300LiveFail_('초기 설정 실패: ' + setup.error);
  if (!p.getProperty('RICH300_TG_TOKEN')) { Logger.log('RICH300 LIVE: 스크립트 속성 RICH300_TG_TOKEN 에 테스트 봇 토큰을 입력한 뒤 rich300LiveStart 를 다시 실행하세요.'); return { ok: false, need: ['RICH300_TG_TOKEN'] }; }
  p.setProperty('RICH300_TEST_TG_ALLOW', 'yes');
  if (!p.getProperty('RICH300_UI_URL')) { try { var u = ScriptApp.getService().getUrl(); if (u && /\/exec$/.test(u)) p.setProperty('RICH300_UI_URL', u); } catch (e) { /* 배포 전 */ } }
  var tg = rich300TgEnv_(), prev = E.liveGet(tg);
  if (prev && prev.phase !== 'halted') return rich300LiveStatus_(prev, tg);                            // 이미 시작됨
  var bot = E.liveBotCheck(tg); if (!bot.ok) return rich300LiveFail_('봇 확인 실패(' + bot.reason + ') — 운영 봇이 아닌 "test"가 들어간 테스트 봇의 토큰인지 확인하세요');
  var ports = rich300LivePorts_(), items = [];
  E.LIVE_FAST_SECTIONS.forEach(function (n) { items = items.concat(E.liveRunSection(n, ports)); });                       // A 호환성 · B 엔진 시간(빠름)
  var blockers = items.filter(function (i) { return /^A/.test(i.id) && i.status === 'FAIL'; });
  if (blockers.length) { p.setProperty('live:auto', JSON.stringify(items)); return rich300LiveFail_('호환성 검사 실패(' + blockers.map(function (b) { return b.id; }).join(',') + ') — 트리거를 설치하지 않았습니다', { items: items }); }
  var idle = rich300LiveMeasureIdle_(5), ch = E.liveChooseInterval(idle.median);
  items.push({ id: 'S0', status: ch.minutes ? 'PASS' : 'FAIL', text: '유휴 폴링 ' + idle.median + 'ms(최대 ' + idle.max + 'ms) → 하루 예상 ' + ch.projectedMin + '분(내부 한도 ' + E.LIVE_LIMITS.dailyBudgetMin + '분, 문서상 한도 ' + E.LIVE_LIMITS.assumedQuotaMin + '분은 미검증 가정) → 폴링 간격 ' + (ch.minutes ? ch.minutes + '분' : '설치 안 함') });
  p.setProperty('live:auto', JSON.stringify(items));
  if (!ch.minutes) return rich300LiveFail_('실행 시간 예산 초과 예상 — 트리거를 설치하지 않았습니다', { items: items });
  p.deleteProperty('live:ct'); p.deleteProperty('live:halt'); p.setProperty('live:bg', JSON.stringify({ todo: E.LIVE_SLOW_SECTIONS.slice(), startedAt: Date.now() }));
  rich300TgInstallPollTrigger(ch.minutes); rich300InstallCloseTriggers(); rich300BackupInstallTrigger();
  E.liveInit(tg, { bot: bot.username, intervalMin: ch.minutes, now: Date.now() }); rich300LiveScheduleBg_(30000);                // 느린 시험(C·G)은 30초 뒤 백그라운드에서 이어서 실행
  var pair = E.tgPairCreate(tg), link = 'https://t.me/' + bot.username + '?start=' + pair.code;
  var s = E.liveSummary(items), lines = items.filter(function (i) { return i.status !== 'PASS'; }).map(function (i) { return i.status + ' ' + i.id + ' ' + i.text; });
  Logger.log('RICH300 LIVE 설치·빠른 자동 검증 완료(느린 시험 C·G는 백그라운드에서 이어집니다): PASS ' + s.pass + ' · FAIL ' + s.fail + ' · WARN ' + s.warn + '\n' + (lines.length ? lines.join('\n') + '\n' : '') + '\n다음 한 가지: 휴대폰에서 이 링크를 열고 [시작/START]를 누르세요(10분 안에):\n' + link);
  return { ok: true, pairLink: link, interval: ch.minutes, summary: s, notPassed: lines };
}
/** 느린 자동 시험(C 시트 저장·읽기, G 백업·복원)을 구간별로 백그라운드(일회성 트리거)에서 실행한다. 한 번에 한 구간, 끝나면 다음 구간을 30초 뒤로 예약. */
function rich300LiveClearBg_() { ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'rich300LiveBackground') ScriptApp.deleteTrigger(t); }); }
function rich300LiveScheduleBg_(ms) { rich300LiveClearBg_(); ScriptApp.newTrigger('rich300LiveBackground').timeBased().after(ms).create(); }
function rich300LiveBackground() {
  if (!rich300LiveIsTest_()) return;
  rich300LiveClearBg_();
  var bg = rich300LiveJson_('live:bg', null), st = RICH300_ENGINE.liveGet(rich300TgEnv_());
  if (!bg || !bg.todo || !bg.todo.length || !st || st.phase === 'halted') return;
  var name = bg.todo[0], items = rich300LiveJson_('live:auto', []), p = rich300LiveProps_();
  try { items = items.concat(RICH300_ENGINE.liveRunSection(name, rich300LivePorts_())); }
  catch (err) { items.push({ id: 'BG-' + name, status: 'FAIL', text: '구간 ' + name + ' 실행 오류: ' + String(err && (err.code || err.message) || 'error').replace(/https?:\/\/\S+/g, '').slice(0, 80) }); }
  bg.todo.shift(); p.setProperty('live:auto', JSON.stringify(items)); p.setProperty('live:bg', JSON.stringify(bg));
  if (bg.todo.length) rich300LiveScheduleBg_(30000);
}
function rich300LiveStatus_(st, tg) {
  var out = { ok: true, phase: st.phase, step: st.step, interval: st.intervalMin };
  if (st.phase === 'unpaired') { var pair = RICH300_ENGINE.tgPairCreate(tg); out.pairLink = 'https://t.me/' + st.bot + '?start=' + pair.code; Logger.log('RICH300 LIVE: 아직 페어링 전입니다. 휴대폰에서 링크를 여세요(10분 안에):\n' + out.pairLink); }
  else Logger.log('RICH300 LIVE: 진행 중 — 단계 ' + (st.step + 1) + '/10, 상태 ' + st.phase + '. 휴대폰 [TEST] 메시지를 따라가세요.');
  return out;
}
/** 지금까지의 결과를 PASS/FAIL 요약으로 보여 준다(실행 로그). 텔레그램 발송은 하지 않는다. */
function rich300LiveReport() {
  var tg = rich300TgEnv_(), st = RICH300_ENGINE.liveGet(tg), items = RICH300_ENGINE.liveReportNow(tg, rich300LiveIo_(), st), texts = RICH300_ENGINE.liveReportTexts(items, { title: 'LIVE 결과' });
  texts.forEach(function (t) { Logger.log(t); });
  return RICH300_ENGINE.liveSummary(items);
}
/** 같은 요약을 테스트 봇 대화방(페어링된 계정)으로 보낸다. */
function rich300LiveSendReport() {
  var tg = rich300TgEnv_(), st = RICH300_ENGINE.liveGet(tg), items = RICH300_ENGINE.liveReportNow(tg, rich300LiveIo_(), st), p = RICH300_ENGINE.tgPairedUser(tg);
  if (!p) return { ok: false, error: 'not-paired' };
  RICH300_ENGINE.liveReportTexts(items, { title: 'LIVE 결과' }).forEach(function (t) { RICH300_ENGINE.tgSendMessage(tg, p.chatId, t); });
  return RICH300_ENGINE.liveSummary(items);
}
/** 안전 중단(수동): 트리거 제거 + 상태 기록. 프로젝트·시트·백업·봇은 그대로 둔다. */
function rich300LiveStop() {
  rich300RemoveAllTriggers();
  var tg = rich300TgEnv_(), st = RICH300_ENGINE.liveGet(tg);
  if (st && st.phase !== 'halted') { st.phase = 'halted'; st.halt = { reason: 'manual', text: '수동 중단', at: Date.now() }; RICH300_ENGINE.liveSet(tg, st); rich300LiveProps_().setProperty('live:halt', JSON.stringify(st.halt)); }
  return { ok: true, note: '트리거를 제거했습니다. 데이터는 그대로입니다.' };
}
