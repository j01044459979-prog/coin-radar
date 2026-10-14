// 감시 종목 선정: OKX 공식 자산 분류(instCategory)로 암호화폐만 허용한다. 종목명 블랙리스트를 쓰지 않는다.
// 분류가 없거나 불명확한 상품은 기본 제외하고 이유를 기록한다.
export const CRYPTO_CATEGORY = '1';                        // OKX instruments.instCategory: 1 = Crypto (주식·원자재·외환 등은 다른 값)
export const PRIORITY = ['BTC', 'ETH', 'SOL', 'ZEC', 'RENDER']; // 기본 감시 + 사용자 관심 코인(실제 상장·거래 가능할 때만 포함)
export const MAX_SYMBOLS = 12;

const turnover = t => Number(t?.volCcy24h) * Number(t?.last); // USDT 근사 거래대금(기초자산 24h 수량 × 최근가)

// 부적격 사유 (null이면 적격)
export function ineligibleReason(x) {
  if (!/^[A-Z0-9]+-USDT-SWAP$/.test(x.instId || '')) return 'USDT 무기한 계약 형식 아님';
  if (x.state !== 'live') return `거래 불가(state=${x.state})`;
  if (x.ctType !== 'linear' || x.settleCcy !== 'USDT') return 'USDT 선형 계약 아님';
  if (x.instCategory === undefined || x.instCategory === null || x.instCategory === '') return '자산 분류 정보 없음(기본 제외)';
  if (String(x.instCategory) !== CRYPTO_CATEGORY) return `암호화폐 아님(instCategory=${x.instCategory})`;
  return null;
}

export function selectUniverse({ instruments, tickers, max = MAX_SYMBOLS, priority = PRIORITY }) {
  const byId = new Map(instruments.map(x => [x.instId, x]));
  const tick = new Map(tickers.map(t => [t.instId, t]));
  const categoryCounts = {};
  for (const x of instruments) categoryCounts[x.instCategory ?? '(없음)'] = (categoryCounts[x.instCategory ?? '(없음)'] || 0) + 1;
  const reasons = new Map(), eligible = [];
  for (const x of instruments) {
    let reason = ineligibleReason(x);
    if (!reason && !(turnover(tick.get(x.instId)) > 0)) reason = '시세/거래대금 없음';
    if (reason) reasons.set(x.instId, reason); else eligible.push(x.instId);
  }
  // 분류 가정 자가 점검: BTC가 암호화폐로 분류되지 않으면 필드 의미가 달라진 것이므로 추측하지 않고 중단
  const btc = byId.get('BTC-USDT-SWAP');
  if (!btc || ineligibleReason(btc) !== null) throw new Error(`종목 분류 점검 실패: BTC-USDT-SWAP이 암호화폐로 분류되지 않음 (분류 분포 ${JSON.stringify(categoryCounts)})`);
  const rank = [...eligible].sort((a, b) => turnover(tick.get(b)) - turnover(tick.get(a)));
  const prio = [], priorityStatus = {};
  for (const sym of priority) {
    const id = `${sym}-USDT-SWAP`;
    if (eligible.includes(id)) { prio.push(id); priorityStatus[sym] = '감시'; }
    else priorityStatus[sym] = byId.has(id) ? `제외: ${reasons.get(id)}` : 'OKX USDT 무기한 미상장';
  }
  const ids = [...new Set([...prio, ...rank])].slice(0, max);
  // 거래대금 상위인데 제외된 상품(사유 포함) — 로그용, 최대 15건
  const excluded = [...reasons.entries()].map(([id, reason]) => ({ id, reason, t: turnover(tick.get(id)) || 0 }))
    .sort((a, b) => b.t - a.t).slice(0, 15).map(({ id, reason }) => ({ id, reason }));
  const reasonCounts = {};
  for (const r of reasons.values()) reasonCounts[r.replace(/\(.*\)/, '')] = (reasonCounts[r.replace(/\(.*\)/, '')] || 0) + 1;
  return { ids, eligibleCount: eligible.length, excluded, reasonCounts, priorityStatus, categoryCounts, turnover: Object.fromEntries(rank.map(id => [id, turnover(tick.get(id))])) };
}

// ---- 2.4: 전체 시세 탐색 + 동적 정밀 분석 대상(최대 40) ----
export const TARGET_CONFIG = { max: 40, topTurnover: 10, movers: 10, rotation: 15, minTurnover: 1000000 };
// minTurnover: 24h 거래대금(USDT)이 이 값 미만이면 급등락·순환 대상에서 제외한다(우선 종목은 예외). 실데이터 분포로 검증한다.
const symOf = id => id.replace(/-USDT-SWAP$/, '');

// 적격 종목 전체의 시세 요약: 이름·최근가·24h 거래대금·24h 등락률·거래 상태·자산 분류. instruments+tickers 재사용(추가 호출 없음).
export function scanMarket({ instruments, tickers }) {
  const tick = new Map(tickers.map(t => [t.instId, t]));
  const categoryCounts = {}, reasons = new Map(), eligible = [];
  for (const x of instruments) {
    categoryCounts[x.instCategory ?? '(없음)'] = (categoryCounts[x.instCategory ?? '(없음)'] || 0) + 1;
    const t = tick.get(x.instId);
    let reason = ineligibleReason(x);
    if (!reason && !(turnover(t) > 0)) reason = '시세/거래대금 없음';
    if (reason) { reasons.set(x.instId, reason); continue; }
    const last = Number(t.last), open = Number(t.open24h);
    eligible.push({ instId: x.instId, name: symOf(x.instId), last, turnover: turnover(t), change24h: open > 0 && last > 0 ? (last - open) / open * 100 : null, state: x.state, category: String(x.instCategory) });
  }
  const byId = new Map(instruments.map(x => [x.instId, x]));
  const btc = byId.get('BTC-USDT-SWAP');
  if (!btc || ineligibleReason(btc) !== null) throw new Error(`종목 분류 점검 실패: BTC-USDT-SWAP이 암호화폐로 분류되지 않음 (분류 분포 ${JSON.stringify(categoryCounts)})`);
  return { eligible, reasons, categoryCounts, byId };
}

// 순환 상태 정규화: 없거나 손상되면 안전하게 초기화(reinit). 현재 적격 종목만 남기고 놓친 실행(간격)을 기록한다.
export function normalizeRotation(raw, eligibleIds, now) {
  const ok = Boolean(raw) && typeof raw === 'object' && raw.last && typeof raw.last === 'object' && !Array.isArray(raw.last);
  const last = {};
  if (ok) for (const id of eligibleIds) { const v = Number(raw.last[id]); if (Number.isFinite(v) && v > 0 && v <= now + 60000) last[id] = v; }
  const prevRun = ok && Number.isFinite(raw.lastRun) ? raw.lastRun : null;
  const gapMs = prevRun && now > prevRun ? now - prevRun : 0;
  const missed = gapMs > 900000 ? Math.floor(gapMs / 300000) - 1 : 0; // 5분 주기에서 15분 넘게 비면 놓친 실행으로 기록
  return { last, lastRun: prevRun, reinit: !ok, gapMs, missed, missedTotal: (ok ? Number(raw.missedTotal) || 0 : 0) + missed, maxGapMs: Math.max(ok ? Number(raw.maxGapMs) || 0 : 0, gapMs) };
}

export function selectTargets({ market, priority = PRIORITY, config = {}, rotation, now }) {
  const cfg = { ...TARGET_CONFIG, ...config };
  const { eligible } = market;
  const byId = new Map(eligible.map(e => [e.instId, e]));
  const rot = normalizeRotation(rotation, eligible.map(e => e.instId), now);
  const groups = { priority: [], turnover: [], movers: [], rotation: [] };
  const chosen = new Set();
  const take = (g, id) => { if (chosen.has(id) || chosen.size >= cfg.max) return false; chosen.add(id); groups[g].push(id); return true; };
  const priorityStatus = {};
  for (const sym of [...new Set(['BTC', ...priority])]) {
    const id = `${sym}-USDT-SWAP`;
    if (byId.has(id)) { take('priority', id); priorityStatus[sym] = '감시'; }
    else priorityStatus[sym] = market.byId.has(id) ? `제외: ${market.reasons.get(id)}` : 'OKX USDT 무기한 미상장';
  }
  const liquid = eligible.filter(e => e.turnover >= cfg.minTurnover);
  const byTurn = [...liquid].sort((a, b) => b.turnover - a.turnover);
  // 거래대금 상위: 우선 종목과 겹치면 다음 순위로 채운다(정확히 N개)
  for (const e of byTurn) { if (groups.turnover.length >= cfg.topTurnover) break; take('turnover', e.instId); }
  // 급등락: 상승·하락 균형(홀수면 상승 우선), 한쪽이 모자라면 절대 변동률 순으로 보충
  const withChange = liquid.filter(e => e.change24h !== null && !chosen.has(e.instId));
  const up = withChange.filter(e => e.change24h > 0).sort((a, b) => b.change24h - a.change24h);
  const down = withChange.filter(e => e.change24h < 0).sort((a, b) => a.change24h - b.change24h);
  const half = Math.ceil(cfg.movers / 2);
  const pickM = [...up.slice(0, half), ...down.slice(0, cfg.movers - half)];
  if (pickM.length < cfg.movers) pickM.push(...[...up.slice(half), ...down.slice(cfg.movers - half)].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h)).slice(0, cfg.movers - pickM.length));
  for (const e of pickM) take('movers', e.instId);
  // 순환: 가장 오래(또는 한 번도) 정밀 분석하지 않은 종목 순. 앞 그룹에서 못 채운 칸은 순환으로 채운다(전체 max 이내).
  const quota = Math.min(cfg.rotation + (cfg.topTurnover - groups.turnover.length) + (cfg.movers - groups.movers.length), cfg.max - chosen.size);
  const pool = liquid.filter(e => !chosen.has(e.instId)).sort((a, b) => (rot.last[a.instId] || 0) - (rot.last[b.instId] || 0) || (a.instId < b.instId ? -1 : 1));
  for (const e of pool.slice(0, Math.max(0, quota))) take('rotation', e.instId);
  const ids = [...groups.priority, ...groups.turnover, ...groups.movers, ...groups.rotation]; // 앞쪽일수록 중요: 시간이 모자라면 뒤에서부터 줄인다
  return { ids, groups, rotation: rot, priorityStatus, liquidityExcluded: eligible.length - liquid.length, cfg, eligibleCount: eligible.length, byId };
}

// 정밀 분석에 성공한 종목의 시각을 기록한다(실패·미분석 종목은 기록하지 않아 다음 실행에서 다시 우선된다).
export function recordRotation(rot, analyzedIds, eligibleIds, now) {
  const last = { ...rot.last };
  for (const id of analyzedIds) last[id] = now;
  const ages = eligibleIds.map(id => last[id]).filter(Boolean);
  return { last, lastRun: now, missedTotal: rot.missedTotal, maxGapMs: rot.maxGapMs, lastGapMs: rot.gapMs, lastMissed: rot.missed, reinit: rot.reinit,
    swept: ages.length, neverAnalyzed: eligibleIds.length - ages.length, oldestAt: ages.length === eligibleIds.length ? Math.min(...ages) : null };
}
