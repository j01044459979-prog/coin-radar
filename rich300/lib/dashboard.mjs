// 메인 화면 뷰 모델(순수 함수, R6 수정판: 숫자 중심·그래프 없음). R2 장부 계산 결과를 화면용 JSON-안전 값으로 정리한다.
//  · 금액 계산은 전부 R2(마이크로 USDT BigInt)가 하고, 이 모듈은 *표시용 변환*(문자열·차트용 숫자)만 한다. 새 손익 계산식을 만들지 않는다.
//  · 실제 기록(origin=real)만 사용한다. 모의 거래는 어떤 경로로도 들어오지 않는다(저장소가 거부).
//  · 챌린지 설정이 없으면 샘플로 대체하지 않고 '설정 전' 상태를 돌려 준다(없는 잔액을 만들어 보여 주지 않음). 샘플은 화면 검증용(dashSampleModel)으로만 쓴다.
//  · 현재 총자산은 *사용자가 입력한 평가액*만 쓴다. 입력이 하나도 없으면 null(화면은 '미입력'). 장부 근사값을 현재 자산처럼 보여 주지 않는다.
//  · 목표 미달분을 다음 날에 더하지 않는다는 R2 규칙을 그대로 따른다(여기서 목표를 다시 계산하지 않음).
import { dec, decMul, decFormat, decRoundDiv, decToMicro } from './decimal.mjs';
import { ledgerBuildDaily } from './ledger.mjs';
import { kstDayOf, dayStartMs, addDays } from './time.mjs';
import { StoreError } from './schema.mjs';
import { storeLoadLedgerInputs, storeList } from './store.mjs';


const dashGroup = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export function dashUsd(micro, { sign = false, dp = 2 } = {}) {      // 마이크로 → "1,234.56" (sign=true면 +/− 부호)
  const neg = micro < BigInt(0), a = neg ? -micro : micro, s = decFormat(a * BigInt(1000000), dp), [i, f] = s.split('.');
  const body = f === undefined ? dashGroup(i) : `${dashGroup(i)}.${f}`, zero = /^[0.,]*$/.test(body);
  return `${neg && !zero ? '−' : sign && !zero ? '+' : ''}${body}`;
}
export function dashPct(ppm, { sign = false, dp = 2 } = {}) {        // ppm(1e6=100%) → "12.34%"
  if (ppm === null || ppm === undefined) return '—';
  const neg = ppm < BigInt(0), a = neg ? -ppm : ppm, s = decFormat(a * BigInt(100000000), dp), zero = /^[0.]*$/.test(s);   // ppm/1e4 = %, 십진 1e-12 단위로 변환
  return `${neg && !zero ? '−' : sign && !zero ? '+' : ''}${s}%`;
}
const dashTrim = v => { const t = String(v); return t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t; };
const dashRatePct = rate => `${dashTrim(decFormat(decMul(dec(rate), dec(100)), 2))}%`;

export const DASH_DAILY_LIMIT = 30;
const dashZeroFloor = v => (v < BigInt(0) ? BigInt(0) : v);

// inputs: storeLoadLedgerInputs 형태
export function dashBuildModel({ inputs, throughDay, now, sample = false }) {
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
  // 오늘 입력이 없으면 과거 평가액으로 오늘 목표 달성률·남은 금액을 계산하지 않는다.
  const rem = todayInput ? dashZeroFloor(t.targetProfitMicro - t.pnlMicro) : null, met = todayInput ? t.pnlMicro >= t.targetProfitMicro : null;
  const progressPpm = todayInput && t.targetProfitMicro > BigInt(0) ? decRoundDiv(t.pnlMicro * BigInt(1000000), t.targetProfitMicro) : null;
  const progress = progressPpm === null ? null : Math.max(0, Math.min(100, Number(progressPpm) / 10000));
  const real = t.realizedNetMicro;
  const previous = rows.length > 1 ? rows[rows.length - 2] : null, startConfirmed = previous === null || previous.closeSource === 'input';
  model.today = { day: t.day, n: t.n, rate: dashRatePct(t.rate), startLabel: dashUsd(t.startMicro), targetLabel: dashUsd(t.targetCloseMicro), targetProfitLabel: dashUsd(t.targetProfitMicro, { sign: true }), startRemainingLabel: dashUsd(t.targetProfitMicro), startConfirmed,
    realizedLabel: dashUsd(real, { sign: true }), realizedPositive: real > BigInt(0), realizedNegative: real < BigInt(0), remainingLabel: rem === null ? null : dashUsd(rem), achieved: met === true && todayInput, achievedStale: met === true && !todayInput,
    needsReview: t.needsReview, diffLabel: t.diffMicro === null ? null : dashUsd(t.diffMicro, { sign: true }), ledgerLabel: dashUsd(t.ledgerWalletMicro), openPositions: t.openPositions, progress, progressLabel: progressPpm === null ? null : dashPct(progressPpm) };
  // ── 8. 날짜별 마감 자산·일간 손익(표). 평가액이 없는 날은 마감 자산을 '미입력'으로 두고 장부상 실현손익만 보여 준다 ──
  let cashRunning = BigInt(0);
  const plottingRows = rows.map(r => { cashRunning += r.cashflowMicro; return { r, adjusted: r.closeMicro - cashRunning }; });
  model.daily = plottingRows.slice(-DASH_DAILY_LIMIT).reverse().map(({ r, adjusted }) => {
    const input = r.closeSource === 'input', isToday = r.day === throughDay, p = input ? r.pnlMicro : r.realizedNetMicro;
    return { day: r.day, n: r.n, today: isToday, input, closeLabel: input ? dashUsd(r.closeMicro) : null, pnlLabel: dashUsd(p, { sign: true }), pnlPositive: p > BigInt(0), pnlNegative: p < BigInt(0), pnlBasis: input ? 'equity' : 'realized',
      targetLabel: dashUsd(r.targetCloseMicro), idealMicro: String(r.idealMicro), actualMicro: input ? String(adjusted) : null, met: input && r.closeMicro >= r.targetCloseMicro, review: r.needsReview };
  });
  model.dailyTotal = rows.length;
  model.idealTodayLabel = dashUsd(t.idealMicro);
  model.idealGapLabel = todayInput ? dashUsd(dashZeroFloor(t.idealMicro - (t.closeMicro - cashRunning))) : null;
  // 장부의 실제 체결만 최근 3건으로 요약. 신호 버튼/가상 전략은 여기에 넣지 않는다.
  model.recentTrades = [...led.trades.values()].sort((a, b) => {
    const at = t => t.events.length ? t.events[t.events.length - 1].at : 0;
    return at(b) - at(a);
  }).slice(0, 3).map(tr => ({
    sid: tr.sid, symbol: null, dir: tr.dir, status: tr.status,
    at: tr.events.length ? tr.events[tr.events.length - 1].at : null,
    netLabel: dashUsd(tr.totals.netEnteredMicro, { sign: true }),
    pnlPositive: tr.totals.netEnteredMicro > BigInt(0), pnlNegative: tr.totals.netEnteredMicro < BigInt(0),
    reviewed: false
  }));
  // ── 데이터 품질 경고(숨기지 않음) ──
  const w = [], cnt = f => rows.filter(r => r.flags.includes(f)).length;
  if (cnt('ledger-mismatch')) w.push({ type: 'ledger-mismatch', text: `장부와 입력 평가액의 차이가 큰 날 ${cnt('ledger-mismatch')}일(확인 필요, 자동으로 손익에 반영하지 않음)` });
  if (cnt('close-from-ledger')) w.push({ type: 'close-from-ledger', text: `평가액을 입력하지 않은 날 ${cnt('close-from-ledger')}일(마감 자산 미입력, 장부상 실현손익만 표시)` });
  for (const f of led.flags) w.push({ type: f.type, text: `범위 밖 입력 ${f.count}건(${f.type})` });
  model.warnings = w;
  return model;
}

// 저장소에서 읽어 만든다. 챌린지 설정이 없으면 샘플로 대체하지 않고 설정 전 상태를 돌려 준다(설정이 있는데 오류가 나면 던진다).
export function dashBuildFromStore(env, { now }) {
  let inputs;
  try { inputs = storeLoadLedgerInputs(env); } catch (e) { if (e instanceof StoreError && e.code === 'NOT_FOUND') return { sample: false, empty: true, noChallenge: true, generatedAt: now, daily: [], warnings: [] }; throw e; }
  const model = dashBuildModel({ inputs, throughDay: kstDayOf(now), now });
  {
    const signals = new Map(storeList(env, 'signal').map(r => [r.data.sid, r.data]));
    const reviews = new Set(storeList(env, 'review').map(r => r.data.sid));
    for (const tr of model.recentTrades) {
      const sig = signals.get(tr.sid);
      tr.symbol = sig && typeof sig.symbolId === 'string' ? sig.symbolId.replace(/USDT$/, '') : null;
      tr.reviewed = reviews.has(tr.sid);
    }
    const filled = new Set(storeList(env, 'fill').map(r => r.data.sid));
    const responses = storeList(env, 'response').map(r => r.data).filter(r => r.choice === 'entered' && !filled.has(r.sid));
    const pending = responses.map(r => {
      const sig = signals.get(r.sid);
      return { sid: r.sid, symbol: sig && sig.symbolId ? sig.symbolId.replace(/USDT$/, '') : r.sid,
        dir: sig ? sig.dir : null, status: 'unconfirmed', at: r.at, reviewed: false,
        netLabel: null, pnlPositive: false, pnlNegative: false };
    });
    model.recentTrades = [...model.recentTrades, ...pending].sort((a,b) => b.at - a.at).slice(0, 3);
  }
  return model;
}

// ── 샘플 데이터(화면 검증용, 결정적) ──
export function dashSampleInputs() {
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
export function dashSampleModel(now) { const s = dashSampleInputs(); return dashBuildModel({ inputs: s.inputs, throughDay: s.throughDay, now, sample: true }); }
