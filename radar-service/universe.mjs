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
