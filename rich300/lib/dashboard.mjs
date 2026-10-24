// R6 대시보드 뷰 모델(순수 함수). R2 장부 계산 결과 + 신호·응답·복기를 화면용 JSON-안전 값으로 정리한다.
//  · 금액 계산은 전부 R2(마이크로 USDT BigInt)가 하고, 이 모듈은 *표시용 변환*(문자열·차트용 숫자)만 한다. 새 손익 계산식을 만들지 않는다.
//  · 실제 기록(origin=real)만 사용한다. 모의 거래는 어떤 경로로도 들어오지 않는다(저장소가 거부).
//  · 실제 챌린지 설정이 없으면 *샘플 데이터*로 화면을 만들고 model.sample=true 로 표시한다(실제 데이터와 섞지 않음, 저장하지 않음).
//  · 목표 미달분을 다음 날에 더하지 않는다는 R2 규칙을 그대로 따른다(여기서 목표를 다시 계산하지 않음).
import { dec, decMul, decDiv, decFormat, decRoundDiv, decToMicro } from './decimal.mjs';
import { ledgerBuildDaily } from './ledger.mjs';
import { kstDayOf, dayStartMs, addDays } from './time.mjs';
import { StoreError } from './schema.mjs';
import { storeLoadLedgerInputs, storeList } from './store.mjs';

export const DASH_JOURNAL_LIMIT = 60;
export const DASH_MIN_SAMPLE = 30;                    // 전략 비교는 청산 거래가 이 수보다 적으면 "표본 부족"으로 표시

const dashGroup = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export function dashUsd(micro, { sign = false, dp = 2 } = {}) {      // 마이크로 → "1,234.56" (sign=true면 +/− 부호)
  const neg = micro < 0n, a = neg ? -micro : micro, s = decFormat(a * 1000000n, dp), [i, f] = s.split('.');
  const body = f === undefined ? dashGroup(i) : `${dashGroup(i)}.${f}`, zero = /^[0.,]*$/.test(body);
  return `${neg && !zero ? '−' : sign && !zero ? '+' : ''}${body}`;
}
export function dashPct(ppm, { sign = false, dp = 2 } = {}) {        // ppm(1e6=100%) → "12.34%"
  if (ppm === null || ppm === undefined) return '—';
  const neg = ppm < 0n, a = neg ? -ppm : ppm, s = decFormat(a * 100000000n, dp), zero = /^[0.]*$/.test(s);   // ppm/1e4 = %, 십진 1e-12 단위로 변환
  return `${neg && !zero ? '−' : sign && !zero ? '+' : ''}${s}%`;
}
const dashNum = micro => Number(micro) / 1e6;                         // 차트용(표시 전용, 계산에 쓰지 않음)
const dashTrim = v => { const t = String(v); return t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t; };
const dashKst = ms => new Date(ms + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' ');
function dashAvg(fills, kinds) {                                      // 가중평균 가격(표시용, 12자리)
  let q = 0n, c = 0n; for (const f of fills) if (kinds.includes(f.kind)) { q += dec(f.qty); c += decMul(dec(f.price), dec(f.qty)); }
  return q === 0n ? null : dashTrim(decFormat(decDiv(c, q), 8));
}
const dashRatePct = rate => `${dashTrim(decFormat(decMul(dec(rate), dec(100)), 2))}%`;

// inputs: storeLoadLedgerInputs 형태, signals/responses/reviews: 엔티티 data 배열
export function dashBuildModel({ inputs, signals = [], responses = [], reviews = [], throughDay, now, sample = false }) {
  const startDay = inputs.challenge.startDay, led = ledgerBuildDaily({ ...inputs, throughDay });
  const startMicro = decToMicro(dec(inputs.challenge.startEquity)), model = { sample, generatedAt: now, today: throughDay, startDay, startEquity: dashUsd(startMicro), empty: !led.rows.length };
  if (!led.rows.length) return { ...model, series: [], trades: [], strategies: [], dirs: [], warnings: [{ type: 'not-started', text: '챌린지 시작일 전입니다' }] };
  const rows = led.rows, t = rows[rows.length - 1], sum = led.summary;
  // ── 오늘 카드 ──
  const pnl = t.closeMicro - t.startMicro - t.cashflowMicro, prog = t.targetProfitMicro > 0n ? decRoundDiv(pnl * 1000000n, t.targetProfitMicro) : null;
  model.card = { day: t.day, n: t.n, rate: dashRatePct(t.rate), startMicro: String(t.startMicro), startLabel: dashUsd(t.startMicro), targetMicro: String(t.targetCloseMicro), targetLabel: dashUsd(t.targetCloseMicro), targetProfitLabel: dashUsd(t.targetProfitMicro, { sign: true }),
    actualMicro: String(t.closeMicro), actualLabel: dashUsd(t.closeMicro), source: t.closeSource, pnlLabel: dashUsd(pnl, { sign: true }), pnlPositive: pnl > 0n, pnlNegative: pnl < 0n, progressPpm: prog === null ? null : String(prog),
    progressLabel: prog === null ? '—' : dashPct(prog, { dp: 1 }), progressBar: prog === null ? 0 : Number(prog < 0n ? 0n : prog > 1500000n ? 1500000n : prog) / 1e6, remainingLabel: dashUsd(t.targetCloseMicro - t.closeMicro, { sign: true }), cashflowLabel: t.cashflowMicro === 0n ? null : dashUsd(t.cashflowMicro, { sign: true }),
    needsReview: t.needsReview, diffLabel: t.diffMicro === null ? null : dashUsd(t.diffMicro, { sign: true }), flags: t.flags };
  // ── 누적 ──
  model.summary = { returnLabel: dashPct(sum.returnOnStartPpm, { sign: true }), returnPositive: sum.returnOnStartPpm > 0n, returnNegative: sum.returnOnStartPpm < 0n, pnlTotalLabel: dashUsd(sum.pnlTotalMicro, { sign: true }), netCashflowLabel: sum.netCashflowMicro === 0n ? null : dashUsd(sum.netCashflowMicro, { sign: true }),
    maxDdLabel: dashUsd(sum.maxDrawdownMicro), maxDdPct: dashPct(sum.maxDrawdownPpm), curDdLabel: dashUsd(sum.currentDrawdownMicro), curDdPct: dashPct(sum.currentDrawdownPpm), highestLabel: dashUsd(sum.highestEquityMicro),
    daysTargetMet: sum.daysTargetMet, days: sum.days, daysWithInput: sum.daysWithInput, daysLedgerOnly: sum.daysLedgerOnly, idealLabel: dashUsd(sum.idealLatestMicro), gapLabel: dashUsd(sum.gapToIdealMicro, { sign: true }), gapNegative: sum.gapToIdealMicro < 0n, gapPositive: sum.gapToIdealMicro > 0n, latestLabel: dashUsd(sum.latestCloseMicro) };
  // ── 성장선(실제 vs 이상 복리선) ──
  model.series = [{ day: addDays(startDay, -1), n: 0, actual: dashNum(startMicro), ideal: dashNum(startMicro), source: 'start' }, ...rows.map(r => ({ day: r.day, n: r.n, actual: dashNum(r.closeMicro), ideal: dashNum(r.idealMicro), source: r.closeSource, met: r.targetProfitMicro > 0n && r.pnlMicro >= r.targetProfitMicro }))];
  // ── 매매일지 ──
  const sigBy = new Map(signals.map(s => [s.sid, s])), revBy = new Map(reviews.map(r => [r.sid, r])), fillsBy = new Map();
  for (const f of inputs.fills) { if (!fillsBy.has(f.sid)) fillsBy.set(f.sid, []); fillsBy.get(f.sid).push(f); }
  const list = [];
  for (const tr of led.trades.values()) {
    const ev = tr.events, first = ev[0], last = ev[ev.length - 1], sg = sigBy.get(tr.sid), rv = revBy.get(tr.sid), fl = fillsBy.get(tr.sid) ?? [], net = tr.totals.netEnteredMicro;
    list.push({ sid: tr.sid, dir: tr.dir, status: tr.status, strategy: sg ? sg.strategy : null, symbol: sg ? sg.symbolId.replace(/USDT$/, '') : null, openedAt: first.at, closedAt: tr.status === 'closed' ? last.at : null, lastAt: last.at,
      openedLabel: dashKst(first.at), closedLabel: tr.status === 'closed' ? dashKst(last.at) : null, entryAvg: dashAvg(fl, ['entry', 'add']) ?? (tr.avgEntry ? dashTrim(tr.avgEntry) : null), exitAvg: dashAvg(fl, ['reduce', 'close']), openQty: tr.status === 'open' ? dashTrim(tr.openQty) : null,
      netMicro: String(net), netLabel: dashUsd(net, { sign: true }), win: tr.status === 'closed' && net > 0n, loss: tr.status === 'closed' && net < 0n, roeLabel: tr.roePpm === null ? null : dashPct(tr.roePpm, { sign: true, dp: 1 }), flags: tr.flags,
      review: rv ? { plan: rv.plan, mind: rv.mind } : null });
  }
  list.sort((a, b) => b.lastAt - a.lastAt);
  const closed = list.filter(x => x.status === 'closed');
  const agg = items => { const n = items.length, w = items.filter(x => x.win).length; let net = 0n; for (const x of items) net += BigInt(x.netMicro); return { closed: n, wins: w, winRate: n ? dashPct(decRoundDiv(BigInt(w) * 1000000n, BigInt(n)), { dp: 0 }) : '—', winRatePpm: n ? Number(decRoundDiv(BigInt(w) * 1000000n, BigInt(n))) / 1e6 : null, netLabel: dashUsd(net, { sign: true }), netPositive: net > 0n, netNegative: net < 0n, avgLabel: n ? dashUsd(decRoundDiv(net, BigInt(n)), { sign: true }) : '—' }; };
  model.dirs = ['LONG', 'SHORT'].map(d => ({ dir: d, ...agg(closed.filter(x => x.dir === d)), open: list.filter(x => x.dir === d && x.status === 'open').length }));
  model.trades = list.slice(0, DASH_JOURNAL_LIMIT); model.tradesTotal = list.length; model.tradesOpen = list.length - closed.length;
  // ── A/B 전략 비교(실제 기록만) ──
  model.strategies = ['A', 'B'].map(k => {
    const sigs = signals.filter(s => s.strategy === k), ids = new Set(sigs.map(s => s.sid)), rs = responses.filter(r => ids.has(r.sid)), c = (ch) => rs.filter(r => r.choice === ch).length, mine = closed.filter(x => x.strategy === k);
    return { key: k, name: k === 'A' ? 'A전략 · 추세돌파형' : 'B전략 · 눌림목 재진입형', signals: sigs.length, entered: c('entered'), watched: c('watched'), missed: c('missed'), unanswered: sigs.length - rs.length,
      enteredRate: sigs.length ? dashPct(decRoundDiv(BigInt(c('entered')) * 1000000n, BigInt(sigs.length)), { dp: 0 }) : '—', ...agg(mine), lowSample: mine.length < DASH_MIN_SAMPLE };
  });
  // ── 데이터 품질 경고(숨기지 않음) ──
  const w = [], cnt = f => rows.filter(r => r.flags.includes(f)).length;
  if (cnt('ledger-mismatch')) w.push({ type: 'ledger-mismatch', text: `장부와 입력 평가액의 차이가 큰 날 ${cnt('ledger-mismatch')}일(확인 필요, 자동으로 손익에 반영하지 않음)` });
  if (cnt('close-from-ledger')) w.push({ type: 'close-from-ledger', text: `평가액을 입력하지 않아 장부 근사값을 쓴 날 ${cnt('close-from-ledger')}일(미실현 손익 미반영)` });
  const feeMissing = list.filter(x => x.flags.includes('fee-missing')).length, fundMissing = list.filter(x => x.flags.includes('funding-missing')).length;
  if (feeMissing) w.push({ type: 'fee-missing', text: `수수료 미입력 거래 ${feeMissing}건(손익에서 제외됨)` }); if (fundMissing) w.push({ type: 'funding-missing', text: `펀딩 미입력 거래 ${fundMissing}건(손익에서 제외됨)` });
  if (cnt('has-estimates')) w.push({ type: 'has-estimates', text: `추정 수수료·펀딩이 있는 날 ${cnt('has-estimates')}일(기본 손익에는 미포함)` });
  for (const f of led.flags) w.push({ type: f.type, text: `범위 밖 입력 ${f.count}건(${f.type})` });
  if (model.strategies.some(s => s.lowSample)) w.push({ type: 'low-sample', text: `전략 비교는 청산 ${DASH_MIN_SAMPLE}건 미만이면 참고용입니다` });
  model.warnings = w;
  return model;
}

// 저장소에서 읽어 만든다. 챌린지 설정이 없을 때만 샘플로 대체한다(설정이 있는데 오류가 나면 샘플로 숨기지 않고 오류를 던진다).
export function dashBuildFromStore(env, { now }) {
  let inputs;
  try { inputs = storeLoadLedgerInputs(env); } catch (e) { if (e instanceof StoreError && e.code === 'NOT_FOUND') return dashSampleModel(now); throw e; }
  const d = n => storeList(env, n).map(r => r.data);
  return dashBuildModel({ inputs, signals: d('signal'), responses: d('response'), reviews: d('review'), throughDay: kstDayOf(now), now });
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
  inputs.equityInputs = led.rows.filter((r, i) => i !== 5 && i !== 14).map(r => ({ day: r.day, equity: decFormat(r.ledgerWalletMicro * 1000000n, 2) }));
  return { inputs, signals, responses, reviews, throughDay };
}
export function dashSampleModel(now) { const s = dashSampleInputs(); return dashBuildModel({ ...s, now, sample: true }); }
