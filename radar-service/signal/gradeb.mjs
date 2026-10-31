// B급 공격형 신호 판정(순수 함수): 4H 추세 + 1H 지지·저항 구간(기존 분석) + 15분봉 *구조 회복·반락 확인*으로 A급(확정형, evaluateSignal)보다 빠르게 진입 후보를 찾는다.
//
// A급과의 차이: A급은 '직전 8개 15분봉 극단의 확정 돌파'를 기다린다. B급은 구간을 시험한 뒤의 *더 작은 구조 전환*을 쓴다 —
//   LONG: ① 최근 4시간 안에 15분봉 저가가 1H 지지 구간 근처까지 내려와 눌림 저점을 만들었고 ② 그 뒤 2봉 이상 지나서 ③ 확정 종가가 *눌림 저점 이후의 단기 고점*을 상향 돌파(구조 회복)하고
//         ④ 최근 3개 봉의 저가가 눌림 저점 위에 있으며(저점 유지) ⑤ 확인 봉이 양봉이고 종가가 봉 범위 위쪽 절반이며 ⑥ 거래량이 직전 20봉 평균 이상. SHORT 는 대칭(반락).
// 구조 무효화: 손절 = 눌림 저점(고점) − 0.25 ATR(1H). 이 값이 A급의 1H 무효화 가격보다 더 멀면(느슨하면) 후보로 올리지 않는다 — 손절을 멀리 두어 위험 예산을 키우지 않는다.
// 비용 반영 1차 목표 손익비 ≥ 2R(minRR2) 이어야 하고, 목표는 A급과 같은 기존 분석의 반대편 확정 구간만 쓴다(근거 없는 목표는 만들지 않는다).
// 임계값은 제안값이며 이 기능을 위해 최적화하지 않았고 과거 데이터로 우위가 입증되지 않았다(미검증). 입력은 모두 확정(confirm=1) 캔들이다.
import { fmtPrice } from '../format.mjs';
import { M15, SIG } from './evaluate.mjs';

export const SIGB = Object.freeze({
  testBars: 16,              // 구간 시험(눌림 저점)을 찾는 최근 15분봉 수(4시간)
  minRecBars: 2, maxRecBars: 12,   // 눌림 저점 뒤 회복 확인까지 걸린 봉 수(최소 2, 최대 12)
  touchAtr1: 0.25,           // 저가가 구간 상단(LONG)에서 이 값(ATR 1H) 이내까지 접근해야 '시험'
  maxDepthAtr1: 0.75,        // 구간 하단 아래로 이 값 넘게 내려간 눌림은 구조 실패
  holdBars: 3,               // 저점 유지 확인 봉 수
  closeUpperHalf: 0.5,       // 확인 봉 종가가 봉 범위의 이 비율 이상 위(LONG)
  volMult: 1.0, volBase: 20, // 확인 봉 거래대금 ÷ 직전 20봉 평균
  stopBufAtr1: 0.25,         // 손절 = 눌림 저점 − 0.25 ATR(1H)
  stopMinAtr1: 0.5, stopMaxAtr1: 2.5,
  chaseAtr1: 1.0, maxTrigRangeAtr1: 1.5, lateMin: 20, minBars15: 60,
  minRR2: 2.0,               // 비용 반영 1차 목표 손익비 최소(A급 1.5R)
  riskUsdt: 1.5, dayLossUsdt: 9, maxLev: 3,   // 거래당 손실 한도 · 하루 누적 손실 한도 · 격리 최대 배율(RICH300 전략 생성에서 적용)
});
const f2 = x => Number(x).toFixed(2);
const pctOf = (v, base) => (v - base) / base * 100;

// ignore: 백테스트 대조군 전용(예: ['recovery','hold','confirm','volume'] 로 '구간 시험만' 판정). 운영 경로는 쓰지 않는다.
export function evaluateB({ a, c15, now }, { minRR2 = SIGB.minRR2, validMin = 45, P = SIGB, ignore = [], costPct = SIG.costPct } = {}) {
  const wait = why => ({ status: 'WAIT', why, blockers: [why], grade: 'B' });
  if (!a || a.status !== 'ok') return wait(`4H·1H 분석 불가(${a?.reason ?? '데이터 없음'})`);
  if (a.stage < 2 || !a.dir || !a.zone || !a.plan) return wait(a.stage === 1 ? '1H 눌림 구조 미충족(구간 접근 단계)' : '4H 추세·1H 눌림 조건 미충족');
  if (!Array.isArray(c15) || c15.length < P.minBars15) return wait(`15분봉 부족(${c15?.length ?? 0}/${P.minBars15})`);
  const last = c15.at(-1), closeT = last.t + M15;
  for (let k = 1; k < c15.length; k++) if (c15[k].t - c15[k - 1].t !== M15) return wait('15분봉 누락 구간 있음');
  if (closeT > now) return wait('마지막 15분봉이 아직 마감 전');
  if (closeT < a.asOf) return wait('15분봉이 1H 신호 봉보다 오래됨');
  if (now - closeT > P.lateMin * 60000) return wait(`15분봉 신호가 ${P.lateMin}분 넘게 지남(지연)`);
  const L = a.dir === 'LONG', s = L ? 1 : -1, a1 = a.metrics.atr1, z = a.zone;
  if (!(a1 > 0)) return wait('ATR(1H) 계산 불가');
  const blockers = [], tags = [], block = (tag, text) => { if (!ignore.includes(tag)) { blockers.push(text); tags.push(tag); } };
  const n = c15.length, win = c15.slice(n - P.testBars), ext = x => (L ? x.l : x.h);
  // ① 구간 시험: 최근 testBars 안의 눌림 저점(고점)
  let ip = 0; for (let k = 1; k < win.length; k++) if (L ? win[k].l < win[ip].l : win[k].h > win[ip].h) ip = k;
  const pv = ext(win[ip]), recBars = win.length - 1 - ip;
  const zoneNear = L ? z.hi : z.lo, zoneFar = L ? z.lo : z.hi;
  if ((pv - zoneNear) * s > P.touchAtr1 * a1) block('touch', `최근 4시간 안에 ${L ? '지지' : '저항'} 구간 ${fmtPrice(zoneNear)}까지 접근하지 않음`);
  if ((pv - zoneFar) * s < -P.maxDepthAtr1 * a1) block('depth', `눌림이 구간 ${L ? '하단' : '상단'}을 ${f2(Math.abs(pv - zoneFar) / a1)} ATR(1H) 넘게 벗어남(구조 실패)`);
  // ② 회복까지 걸린 봉 수
  if (recBars < P.minRecBars) block('recovery', `눌림 ${L ? '저점' : '고점'} 직후(${recBars}봉)라 회복 확인 전`); else if (recBars > P.maxRecBars) block('recovery', `눌림 이후 ${recBars}봉이 지나 시험이 오래됨`);
  // ③ 구조 회복: 눌림 저점 뒤 단기 고점(저점)을 확정 종가로 돌파
  const after = win.slice(ip + 1, -1), minor = after.length ? (L ? Math.max(...after.map(x => x.h)) : Math.min(...after.map(x => x.l))) : null, entry = last.c;
  if (minor === null || (entry - minor) * s <= 0) block('recovery', `15분 구조 ${L ? '회복' : '반락'} 대기(눌림 이후 단기 ${L ? '고점' : '저점'} ${minor === null ? '-' : fmtPrice(minor)} ${L ? '상향' : '하향'} 마감 필요)`);
  // ④ 저점 유지
  const hold = win.slice(-P.holdBars);
  if (!hold.every(x => (ext(x) - pv) * s >= 0 && (ext(x) !== pv || x === win[ip]))) block('hold', `최근 ${P.holdBars}봉이 눌림 ${L ? '저점' : '고점'}을 ${L ? '아래로' : '위로'} 갱신`);
  // ⑤ 확인 봉
  const range = last.h - last.l, pos = range > 0 ? (L ? (last.c - last.l) / range : (last.h - last.c) / range) : 0, dirBar = L ? last.c > last.o : last.c < last.o;
  if (!dirBar || pos < P.closeUpperHalf) block('confirm', `확인 봉이 ${L ? '양봉·상단 마감' : '음봉·하단 마감'}이 아님`);
  // ⑥ 거래량
  const vs = c15.slice(-1 - P.volBase, -1).map(x => x.q).filter(q => Number.isFinite(q) && q >= 0), base = vs.length >= P.volBase / 2 ? vs.reduce((x, y) => x + y, 0) / vs.length : null, volRel = Number.isFinite(last.q) && base > 0 ? last.q / base : null;
  if (volRel === null) block('volume', '거래량 확인 불가'); else if (volRel < P.volMult) block('volume', `거래량 ×${f2(volRel)}로 부족(기준 ×${P.volMult})`);
  // 손절·위험: 눌림 저점(고점) 바깥 + 버퍼. A급 1H 무효화보다 느슨하면 제외.
  const stop = pv - s * P.stopBufAtr1 * a1, risk = (entry - stop) * s;
  if (!(risk > 0)) return { ...wait('가격이 이미 손절 기준을 이탈'), invalid: true };
  if ((stop - a.invalidation) * s < 0) block('depth', `손절 기준이 1H 무효화 ${fmtPrice(a.invalidation)}보다 멀어 제외(위험 예산을 키우지 않음)`);
  const riskAtr = risk / a1; if (riskAtr < P.stopMinAtr1 || riskAtr > P.stopMaxAtr1) block('stop', `손절 거리 ${f2(riskAtr)} ATR(1H)가 ${riskAtr < P.stopMinAtr1 ? '너무 좁음' : '너무 넓음'}(허용 ${P.stopMinAtr1}~${P.stopMaxAtr1})`);
  const chase = (entry - (L ? z.hi : z.lo)) * s; if (chase > P.chaseAtr1 * a1) block('chase', `구간에서 ${f2(chase / a1)} ATR(1H) 이격(추격 구간, 기준 ${P.chaseAtr1})`);
  if (range > P.maxTrigRangeAtr1 * a1) block('spike', `확인 봉 폭 ${f2(range / a1)} ATR(1H)로 급변(기준 ${P.maxTrigRangeAtr1})`);
  // 목표(기존 분석의 반대편 확정 구간만) + 비용 반영 손익비 ≥ 2R
  const cand = (a.obstacles ?? []).map(o => ({ ...o, dist: (o.price - entry) * s })).filter(o => o.dist > 0).map(o => ({ ...o, rr: o.dist / risk })).sort((p, q) => p.dist - q.dist);
  const t1 = cand.find(o => o.rr >= SIG.firstTargetMinR) ?? null, t2 = t1 ? cand.find(o => o.rr >= t1.rr + SIG.t2ExtraR) ?? null : null, costR = entry * costPct / 100 / risk;
  const mk = o => (o ? { price: o.price, pct: pctOf(o.price, entry), rr: o.rr, net: o.rr - costR, source: o.source } : null), T1 = mk(t1), T2 = mk(t2);
  if (!T1) block('target', '1차 목표 산정 불가(1R 이상 거리의 반대편 확정 구간 없음)'); else if (T1.net < minRR2) block('target', `1차 목표 비용 반영 손익비 ${f2(T1.net)}R로 부족(B급 기준 ${minRR2}R)`);
  const base0 = { grade: 'B', dir: a.dir, entry, stop, riskAbs: risk, riskPct: risk / entry * 100, riskAtr, costR, costPct, t1: T1, t2: T2, volRel, zone: z, level: minor, swing: pv, triggerT: last.t, triggerCloseT: closeT, validUntil: closeT + validMin * 60000, zoneKey: `${a.dir}:${Number(z.level).toPrecision(8)}`, score: a.score?.total ?? null, btcAlign: a.metrics.btcAlign, stageLabel: a.stageLabel };
  if (blockers.length) return { status: 'OBSERVE', ...base0, blockers, tags };
  return { status: 'CANDIDATE', ...base0, blockers: [], tags: [], evidence: [
    `4H ${L ? '상승' : '하락'} · 1H ${L ? '지지' : '저항'} ${fmtPrice(z.lo)}~${fmtPrice(z.hi)} 시험`,
    `15분 ${L ? '눌림 저점' : '반등 고점'} ${fmtPrice(pv)} ${L ? '유지' : '유지'} · 단기 ${L ? '고점' : '저점'} ${fmtPrice(minor)} ${L ? '회복' : '반락'} 마감`,
    `손절=${L ? '눌림 저점' : '반등 고점'} 바깥 · 거래량 ×${volRel.toFixed(1)} · 1차=${T1.source ?? '확정 구간'}`] };
}
