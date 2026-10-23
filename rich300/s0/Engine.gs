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

// ── exports ──
var RICH300_ENGINE = { DEC_DIGITS, decRoundDiv, dec, decAdd, decSub, decNeg, decAbs, decMul, decDiv, decCmp, decSign, decIsZero, decToMicro, microToDec, decFormat, microFormat, microToNumber, microFromNumber, isDayString, dayToIndex, indexToDay, kstDayOf, dayStartMs, dayEndMs, addDays, daysBetween, dayRange, rateFraction, compoundNextTarget, compoundRateOn, compoundIdealSeries, dedupeCanonical, dedupeSame, dedupeAppend, dedupePossibleFills, dedupeRevise, dedupeVoid, dedupeLatest, PNL_ENTRY_KINDS, PNL_EXIT_KINDS, pnlNormalizeFill, pnlComputeTrade, pnlComputeAll, pnlDailyFlows, pnlMicroToString, riskTrade, riskMicroLabel, LEDGER_REVIEW_ABS_MICRO, LEDGER_REVIEW_PPM, ledgerBuildDaily, ledgerSummarize, ledgerMicroLabel, SCHEMA_VERSION, StoreError, PLAN_CHOICES, MIND_CHOICES, RESPONSE_CHOICES, SETTING_DEFAULTS, schemaDecString, ENTITIES, ENTITY_NAMES, AUDIT_SHEET, VIEW_HEADERS, AUDIT_HEADERS, META_HEADERS, storeInit, storeReadAudit, storeReadView, storeGet, storeList, storeHistory, storeWithLock, storeCreate, storeRevise, storeVoid, storeClaimUpdate, storeSaveReview, storeSetupChallenge, storeGetSettings, storeIntegrityCheck, storeRepair, storeLoadLedgerInputs, storeBuildLedger };
