// RICH300 수동 포지션 등록: 사용자가 Binance 선물에서 *직접 연* 포지션을 종목·방향·실제 진입가·수량·레버리지·증거금·손절가·익절가로 기록한다.
//  · 추천(COIN RADAR 신호)과 무관하다. 어떤 USDT 선물 종목이든 등록할 수 있고(시세 출처 OKX/Bybit 에서 확인), 주문·계정 API 는 쓰지 않는다 — 기록만 한다.
//  · 저장은 체결(fill, origin=real) + 수동 등록 정보(manualpos: 종목·손절·익절)의 두 기록이며, 같은 sid 로 묶인다. 감시는 이 sid 의 *미청산 체결*이 있을 때만 대상으로 삼는다.
//  · 같은 폼(formId)의 재제출은 한 번만 기록된다. 손절가는 포지션에 불리한 방향으로 넓힐 수 없다(좁히거나 유지만).
//  · 규칙 위반(레버리지 3배 초과·위험 1.5% 초과 등)은 *차단하지 않고 경고*로 알린다 — 이미 체결된 실제 포지션을 기록하는 기능이기 때문이다.
import { dec, decMul, decDiv, decFormat, decSign } from './decimal.mjs';
import { riskTrade } from './risk.mjs';
import { StoreError, schemaDecString } from './schema.mjs';
import { storeCreate, storeGet, storeList, storeRevise, storeWithLock } from './store.mjs';
import { pnlComputeTrade } from './pnl.mjs';
import { tgAmount, tgParseAt, tgEquityNow } from './tg.mjs';

export const MANUAL = Object.freeze({ maxOpen: 10, maxLeverage: 125, warnLeverage: 3, warnRiskPpm: 15000, warnMarginPct: 30 });
const mErr = msg => new StoreError('USER', msg);
const mTrim = v => decFormat(v, 12).replace(/0+$/, '').replace(/\.$/, '');

// 입력 종목 → BTCUSDT 형식. 'btc', 'BTC/USDT', 'BTC-USDT-SWAP', 'BTCUSDT.P', 'BTCUSDT Perp' 모두 받는다. 형식이 맞지 않으면 사용자 오류.
export function manualSymbol(raw) {
  let t = String((raw != null ? raw : '')).toUpperCase().trim().replace(/-SWAP$/, '').replace(/\s*(PERP|PERPETUAL)$/, '').replace(/\.P$/, '').replace(/[^A-Z0-9]/g, '');
  if (!t) throw mErr('종목을 입력하세요(예: BTC, ETHUSDT)');
  if (!t.endsWith('USDT')) t += 'USDT';
  if (!/^[A-Z0-9]{2,20}USDT$/.test(t)) throw mErr('지원하지 않는 종목 형식입니다(USDT 무기한 선물만, 예: BTC, SOLUSDT)');
  return t;
}
const mSide = dir => (dir === 'LONG' ? 1 : -1);
function mCheckLevels(dir, entry, stop, tp1, tp2, { stopSide = true } = {}) {
  const s = mSide(dir), e = Number(entry), w = dir === 'LONG' ? '아래' : '위', pf = dir === 'LONG' ? '위' : '아래';
  if (stopSide && !((e - Number(stop)) * s > 0)) throw mErr(`${dir} 손절가는 진입가보다 ${w}여야 합니다`);
  for (const [n, v] of [['1차 익절', tp1], ['2차 익절', tp2]]) if (v !== undefined && !((Number(v) - e) * s > 0)) throw mErr(`${dir} ${n}가는 진입가보다 ${pf}여야 합니다`);
  if (tp1 !== undefined && tp2 !== undefined && !((Number(tp2) - Number(tp1)) * s > 0)) throw mErr('2차 익절가는 1차보다 더 멀어야 합니다');
}
const mOpt = (x, name) => (x === undefined || x === null || String(x).trim() === '' ? undefined : schemaDecString(String(x).trim(), name, { positive: true }));

// 등록. form: { formId, symbol, dir, entry, qty?, leverage, margin?, stop, tp1?, tp2?, at?, fee?, funding?, note?, force? } (문자열)
// env: { now(), storeEnv(), symbolCheck?(symbolId):'ok'|'unknown'|'unverified' }
export function manualRegister(env, form, { actor = 'ui:pos' } = {}) {
  const f = form || {}, se = env.storeEnv(), now = env.now();
  const symbolId = manualSymbol(f.symbol), dir = f.dir === 'LONG' || f.dir === 'SHORT' ? f.dir : (() => { throw mErr('LONG 또는 SHORT 를 선택하세요'); })();
  const formId = String((f.formId != null ? f.formId : '')).replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || env.randomId(8);
  const sid = `M-${symbolId.replace(/USDT$/, '').slice(0, 16)}-${dir === 'LONG' ? 'L' : 'S'}-${formId}`;
  const entry = schemaDecString(f.entry, '실제 진입가', { positive: true }), leverage = schemaDecString(f.leverage, '레버리지', { positive: true });
  if (Number(leverage) > MANUAL.maxLeverage) throw mErr(`레버리지는 ${MANUAL.maxLeverage}배 이하`);
  if (f.stop === undefined || String(f.stop).trim() === '') throw mErr('손절가를 입력하세요(감시에 필요합니다)');
  const stop = schemaDecString(String(f.stop).trim(), '손절가', { positive: true }), tp1 = mOpt(f.tp1, '1차 익절가'), tp2 = mOpt(f.tp2, '2차 익절가');
  if (tp2 !== undefined && tp1 === undefined) throw mErr('2차 익절가만 입력할 수 없습니다(1차부터)');
  mCheckLevels(dir, entry, stop, tp1, tp2);
  let qty = mOpt(f.qty, '수량'), margin = mOpt(f.margin, '증거금'), qtySource = 'entered';
  if (qty === undefined && margin === undefined) throw mErr('수량 또는 증거금 중 하나는 입력하세요');
  if (qty === undefined) { qty = schemaDecString(mTrim(decDiv(decMul(dec(margin), dec(leverage)), dec(entry))), '수량(계산)', { positive: true }); qtySource = 'derived'; }
  if (margin === undefined) margin = schemaDecString(decFormat(decDiv(decMul(dec(entry), dec(qty)), dec(leverage)), 4), '증거금(계산)', { positive: true });
  const prev = storeGet(se, 'manualpos', sid), prevFill = prev && !prev.void ? storeGet(se, 'fill', `${sid}:in`) : null;      // 같은 폼 재제출: 비싼 계산(평가액·종목 확인) 없이 빠르게 끝낸다
  if (prev && !prev.void && prevFill && !prevFill.void) {
    const a = prev.data, b = prevFill.data;
    if (a.stop !== stop || a.tp1 !== tp1 || a.tp2 !== tp2 || b.price !== entry || b.qty !== qty || b.leverage !== leverage) throw mErr('같은 입력 id 에 다른 내용이 이미 있습니다. 화면을 새로 열어 다시 입력하세요');
    return { ok: true, status: 'duplicate', sid, symbolId, dir, entry, qty, qtySource: b.qtySource, leverage, margin: b.margin, stop, tp1: tp1 === undefined ? null : tp1, tp2: tp2 === undefined ? null : tp2, warnings: [], flags: [], riskPpm: null, liquidationApprox: null };
  }
  const atMs = tgParseAt(f.at, now), fee = tgAmount(f.fee ? String(f.fee).trim() : undefined, '수수료'), funding = tgAmount(f.funding ? String(f.funding).trim() : undefined, '펀딩');
  const note = f.note ? String(f.note).replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  const eqMicro = (() => { try { const e = tgEquityNow(env); return e === null ? null : BigInt(Math.round(Number(e) * 1e6)); } catch (e_) { return null; } })();
  const risk = riskTrade({ dir, entry, stop, qty, margin, leverage, equityMicro: eqMicro });
  const warnings = [];
  if (Number(leverage) > MANUAL.warnLeverage) warnings.push(`레버리지 ${leverage}배 — 운영 원칙(최대 ${MANUAL.warnLeverage}배)을 넘습니다`);
  if (risk.riskPpmOfEquity !== null && Number(risk.riskPpmOfEquity) > MANUAL.warnRiskPpm) warnings.push(`손절 시 손실이 평가액의 ${(Number(risk.riskPpmOfEquity) / 10000).toFixed(2)}% — 1.5% 한도를 넘습니다`);
  if (eqMicro !== null && eqMicro > BigInt(0) && Number(margin) * 1e6 * 100 > Number(eqMicro) * MANUAL.warnMarginPct) warnings.push(`증거금이 평가액의 ${MANUAL.warnMarginPct}%를 넘습니다`);
  if (risk.flags.includes('liquidation-before-stop')) warnings.push('청산가(근사)가 손절가보다 먼저 옵니다');
  if (risk.flags.includes('leverage-mismatch')) warnings.push('수량·증거금으로 계산한 레버리지가 입력과 다릅니다');
  if (eqMicro === null) warnings.push('평가액 기준이 없어 손실 비율은 계산하지 못했습니다');
  const verdict = typeof env.symbolCheck === 'function' ? env.symbolCheck(symbolId) : 'unverified';
  if (verdict === 'unknown') throw mErr(`${symbolId} 는 OKX·Bybit 어디에서도 찾지 못했습니다. 종목 이름을 확인하세요`);
  if (verdict !== 'ok') warnings.push('종목을 시세 출처에서 확인하지 못했습니다 — 감시 시세를 가져오지 못할 수 있습니다(감시 점검 화면에서 확인)');
  return storeWithLock(se, () => {
    const have = storeGet(se, 'manualpos', sid);
    if (!have) {
      const open = manualOpenList(se);
      if (open.some(p => p.symbolId === symbolId) && f.force !== true) throw mErr(`${symbolId} 는 이미 보유 중으로 등록돼 있습니다. 먼저 청산 기록을 하거나 손절·익절을 수정하세요(같은 종목 이중 등록 방지)`);
      if (open.length >= MANUAL.maxOpen) throw mErr(`동시에 등록할 수 있는 포지션은 ${MANUAL.maxOpen}개까지입니다`);
    }
    const registeredAt = have && !have.void ? have.data.registeredAt : (atMs != null ? atMs : now);
    const mp = storeCreate(se, 'manualpos', { sid, symbolId, dir, stop, ...(tp1 === undefined ? {} : { tp1 }), ...(tp2 === undefined ? {} : { tp2 }), registeredAt, symbolCheck: verdict === 'ok' ? 'ok' : 'unverified' }, { actor });
    if (mp.status === 'conflict') throw mErr('같은 입력 id 에 다른 내용이 이미 있습니다. 화면을 새로 열어 다시 입력하세요');
    const fill = { origin: 'real', fillId: `${sid}:in`, sid, kind: 'entry', dir, at: registeredAt, price: entry, qty, margin, leverage, plannedStop: stop, qtySource, fee, funding, ...(note ? { note } : {}) };
    const fr = storeCreate(se, 'fill', fill, { actor });
    if (fr.status === 'conflict') throw mErr('같은 입력 id 에 다른 체결이 이미 있습니다. 화면을 새로 열어 다시 입력하세요');
    const added = mp.status === 'added' || fr.status === 'added';
    return { ok: true, status: added ? 'added' : 'duplicate', sid, symbolId, dir, entry, qty, qtySource, leverage, margin, stop, tp1: tp1 === undefined ? null : tp1, tp2: tp2 === undefined ? null : tp2, warnings, flags: risk.flags,
      riskPpm: risk.riskPpmOfEquity === null ? null : String(risk.riskPpmOfEquity), liquidationApprox: risk.liquidationApprox };
  });
}
// 미청산 수동 포지션 목록(등록 순). 체결이 없거나 이미 청산됐으면 제외.
export function manualOpenList(se) {
  const mps = storeList(se, 'manualpos'); if (!mps.length) return [];
  const by = new Map(); for (const r of storeList(se, 'fill')) { const f = r.data; if (!by.has(f.sid)) by.set(f.sid, []); by.get(f.sid).push(f); }
  const out = [];
  for (const r of mps) {
    const list = by.get(r.key); if (!list) continue;
    let t; try { t = pnlComputeTrade(list); } catch (e_) { continue; }
    if (!t || t.status !== 'open') continue;
    out.push({ ...r.data, avgEntry: Number(t.avgEntry), openQty: Number(t.openQty), reduces: list.filter(x => x.kind === 'reduce').length });
  }
  return out.sort((a, b) => a.registeredAt - b.registeredAt);
}
// 손절·익절 수정. 손절은 불리한 방향(넓힘)으로 못 바꾼다. patch: { stop?, tp1?, tp2? } — tp 를 비우면('') 해당 익절 삭제.
export function manualUpdate(env, sid, patch, { actor = 'ui:pos' } = {}) {
  const se = env.storeEnv(), cur = storeGet(se, 'manualpos', String(sid));
  if (!cur || cur.void) throw mErr('수동 등록 포지션이 아닙니다');
  const pos = manualOpenList(se).find(p => p.sid === cur.key); if (!pos) throw mErr('이미 청산된 포지션입니다');
  const p = patch || {}, next = {};
  if (p.stop !== undefined && String(p.stop).trim() !== '') {
    const s = schemaDecString(String(p.stop).trim(), '손절가', { positive: true });
    if ((Number(s) - Number(cur.data.stop)) * mSide(cur.data.dir) < 0) throw mErr('손절가를 더 불리한 쪽으로 넓힐 수 없습니다(좁히거나 그대로만)');
    next.stop = s;
  }
  for (const k of ['tp1', 'tp2']) if (p[k] !== undefined) next[k] = String(p[k]).trim() === '' ? null : schemaDecString(String(p[k]).trim(), k === 'tp1' ? '1차 익절가' : '2차 익절가', { positive: true });
  if (!Object.keys(next).length) throw mErr('바꿀 값이 없습니다');
  const merged = { ...cur.data, ...next }; for (const k of ['tp1', 'tp2']) if (merged[k] === null) delete merged[k];
  if (merged.tp2 !== undefined && merged.tp1 === undefined) throw mErr('1차 익절가 없이 2차 익절가만 둘 수 없습니다');
  mCheckLevels(cur.data.dir, String(pos.avgEntry), merged.stop, merged.tp1, merged.tp2, { stopSide: false });      // 수익 구간으로 옮긴 손절(본전·추적)은 진입가 반대편이어도 정상
  const r = storeRevise(se, 'manualpos', cur.key, next, { actor, reason: '손절·익절 수정' });
  return { ok: true, status: r.status, sid: cur.key, stop: merged.stop, tp1: merged.tp1 === undefined ? null : merged.tp1, tp2: merged.tp2 === undefined ? null : merged.tp2 };
}
// 화면용 모델: 보유 중인 *모든* 포지션(수동+추천 연동)과 입력 보조 종목 목록.
export const MANUAL_QUICK = Object.freeze(['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'AVAX', 'LINK', 'SUI']);
