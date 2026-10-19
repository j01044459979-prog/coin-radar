// 실시간 매매 판단 지원 신호 판정(순수 함수): 4H 추세 + 1H 눌림목(기존 분석) + 15분봉 확정 트리거 + 거래량.
//
// 상태: WAIT(조건 미충족) · OBSERVE(관찰: 4H·1H 구조는 갖췄고 15분봉 트리거 대기) · CANDIDATE(진입 후보: 모든 조건 충족).
// 무효화·만료는 저장된 신호에 대해 transition.mjs가 판단한다.
// 모든 입력은 '확정(confirm=1)' 캔들이어야 한다. 15분봉은 마지막 봉의 마감 시각이 now 이하이고 신호가 너무 늦지 않은 경우에만 쓴다. 미완성 봉·미래 봉은 쓰지 않는다.
// 임계값은 제안값이며 이 기능을 위해 최적화하지 않았고 과거 데이터로 검증되지 않았다(미검증).
//
// 가격 계산 근거:
//  · 진입 관심가 = 트리거 15분봉의 확정 종가(주문 가격이 아니다)
//  · 손절 기준 = 기존 분석의 구조적 무효화 가격 = min(눌림 12봉 최저가, 구간 하단) − 0.5 ATR(1H) (SHORT는 대칭)
//  · 목표 1·2차 = 기존 분석이 찾은 반대편 확정 구간(4H 스윙·최근 72시간 고저점). 계산 근거가 없으면 만들지 않고 진입 후보로도 올리지 않는다
//  · 손익비 = 목표까지 거리 ÷ 손절까지 거리. 비용(수수료·슬리피지 왕복 COST_PCT%)을 R로 환산해 뺀 순손익비로 최소 기준을 판단한다
import { fmtPrice } from '../format.mjs';

export const M15 = 15 * 60000;
export const SIG = Object.freeze({
  trigBars: 8,            // 트리거: 직전 8개(2시간) 15분봉 고점(저점)을 확정 종가로 돌파(이탈)
  minBars15: 60, volBase: 20, volMult: 1.2,   // 트리거 봉 거래대금 ÷ 직전 20봉 평균 ≥ 1.2
  maxTrigRangeAtr1: 1.5,  // 트리거 봉 고저 폭 ≤ 1.5 ATR(1H) (급등락 봉 추격 방지)
  chaseAtr1: 1.0,         // 구간 경계에서 1.0 ATR(1H) 이내 (추격 아님)
  stopMinAtr1: 1.0, stopMaxAtr1: 3.5,   // 손절 거리 1.0~3.5 ATR(1H)
  firstTargetMinR: 1.0, t2ExtraR: 0.5, // 1차 목표 후보는 1R 이상 거리, 2차는 1차보다 0.5R 이상 먼 다음 구간
  lateMin: 20,            // 트리거 봉 마감 후 이 시간이 지나면 알리지 않음(실행 지연으로 늦은 신호 방지)
  costPct: 0.15,          // 왕복 비용 가정: 수수료 0.10%(시장가 양쪽) + 슬리피지 0.05%
  cooldownMs: 2 * 3600000, // 같은 구간·방향 신호가 끝난 뒤 재알림 금지 시간
});
const f2 = x => Number(x).toFixed(2);
const pctOf = (v, base) => (v - base) / base * 100;

// ignore: 백테스트 대조군 전용(예: ['trigger','volume']으로 '맥락만' 판정). 운영 경로는 쓰지 않는다. 막힘 이유마다 tags에 분류가 들어간다.
export function evaluateSignal({ a, c15, now }, { minRR = 1.5, validMin = 45, P = SIG, ignore = [] } = {}) {
  const wait = why => ({ status: 'WAIT', why, blockers: [why] });
  if (!a || a.status !== 'ok') return wait(`4H·1H 분석 불가(${a?.reason ?? '데이터 없음'})`);
  if (a.stage < 2 || !a.dir || !a.zone || !a.plan) return wait(a.stage === 1 ? '1H 눌림 구조 미충족(구간 접근 단계)' : '4H 추세·1H 눌림 조건 미충족');
  if (!Array.isArray(c15) || c15.length < P.minBars15) return wait(`15분봉 부족(${c15?.length ?? 0}/${P.minBars15})`);
  const last = c15.at(-1), closeT = last.t + M15;
  for (let k = 1; k < c15.length; k++) if (c15[k].t - c15[k - 1].t !== M15) return wait('15분봉 누락 구간 있음');
  if (closeT > now) return wait('마지막 15분봉이 아직 마감 전');                                    // 미완성 봉 사용 금지
  if (closeT < a.asOf) return wait('15분봉이 1H 신호 봉보다 오래됨');
  if (now - closeT > P.lateMin * 60000) return wait(`15분봉 신호가 ${P.lateMin}분 넘게 지남(지연)`);
  const L = a.dir === 'LONG', s = L ? 1 : -1, a1 = a.metrics.atr1, z = a.zone;
  if (!(a1 > 0)) return wait('ATR(1H) 계산 불가');
  const entry = last.c, stop = a.invalidation, risk = (entry - stop) * s;
  const blockers = [], tags = [], block = (tag, text) => { if (!ignore.includes(tag)) { blockers.push(text); tags.push(tag); } };
  if (!(risk > 0)) return { ...wait('가격이 이미 손절 기준을 이탈'), invalid: true };

  // 트리거: 직전 trigBars개 15분봉 극단을 확정 종가로 돌파 + 방향 봉
  const prior = c15.slice(-1 - P.trigBars, -1), level = L ? Math.max(...prior.map(x => x.h)) : Math.min(...prior.map(x => x.l));
  const broke = (entry - level) * s > 0, dirBar = L ? last.c > last.o : last.c < last.o;
  if (!broke || !dirBar) block('trigger', `15분봉 확정 트리거 대기(직전 ${P.trigBars}봉 ${L ? '고점' : '저점'} ${fmtPrice(level)} ${L ? '상향' : '하향'} 마감 필요)`);
  // 구조: 최근 4시간 15분봉 극단이 손절 기준 안쪽, 가격이 구간 경계 안쪽으로 돌아와 있을 것
  const recent = c15.slice(-16), extreme = L ? Math.min(...recent.map(x => x.l)) : Math.max(...recent.map(x => x.h));
  if ((extreme - stop) * s <= 0) block('structure', '최근 4시간 안에 손절 기준을 건드림');
  const zoneEdge = L ? z.lo : z.hi;
  if ((entry - zoneEdge) * s < 0) block('zone', `가격이 ${L ? '지지' : '저항'} 구간 ${L ? '하단' : '상단'}을 ${L ? '아래' : '위'}로 벗어남`);
  const ext = (entry - (L ? z.hi : z.lo)) * s;
  if (ext > P.chaseAtr1 * a1) block('chase', `구간에서 ${f2(ext / a1)} ATR(1H) 이격(추격 구간, 기준 ${P.chaseAtr1})`);
  const riskAtr = risk / a1;
  if (riskAtr < P.stopMinAtr1 || riskAtr > P.stopMaxAtr1) block('stop', `손절 거리 ${f2(riskAtr)} ATR(1H)가 ${riskAtr < P.stopMinAtr1 ? '너무 좁음' : '너무 넓음'}(허용 ${P.stopMinAtr1}~${P.stopMaxAtr1})`);
  if ((last.h - last.l) > P.maxTrigRangeAtr1 * a1) block('spike', `트리거 봉 폭 ${f2((last.h - last.l) / a1)} ATR(1H)로 급변(기준 ${P.maxTrigRangeAtr1})`);
  // 거래량 확인
  const vs = c15.slice(-1 - P.volBase, -1).map(x => x.q).filter(q => Number.isFinite(q) && q >= 0), base = vs.length >= P.volBase / 2 ? vs.reduce((x, y) => x + y, 0) / vs.length : null;
  const volRel = Number.isFinite(last.q) && base > 0 ? last.q / base : null;
  if (volRel === null) block('volume', '거래량 확인 불가'); else if (volRel < P.volMult) block('volume', `거래량 ×${f2(volRel)}로 부족(기준 ×${P.volMult})`);
  // 목표 1·2차(계산 근거가 있을 때만) + 비용 반영 손익비
  const cand = (a.obstacles ?? []).map(o => ({ ...o, dist: (o.price - entry) * s })).filter(o => o.dist > 0).map(o => ({ ...o, rr: o.dist / risk })).sort((p, q) => p.dist - q.dist);
  const t1 = cand.find(o => o.rr >= P.firstTargetMinR) ?? null, t2 = t1 ? cand.find(o => o.rr >= t1.rr + P.t2ExtraR) ?? null : null;
  const costR = entry * P.costPct / 100 / risk;
  const mk = o => (o ? { price: o.price, pct: pctOf(o.price, entry), rr: o.rr, net: o.rr - costR, source: o.source } : null);
  const T1 = mk(t1), T2 = mk(t2);
  if (!T1) block('target', '1차 목표 산정 불가(1R 이상 거리의 반대편 확정 구간 없음)'); else if (T1.net < minRR) block('target', `1차 목표 비용 반영 손익비 ${f2(T1.net)}R로 부족(기준 ${minRR}R)`);

  const base0 = { dir: a.dir, entry, stop, riskAbs: risk, riskPct: risk / entry * 100, riskAtr, costR, costPct: P.costPct, t1: T1, t2: T2, volRel, zone: z, level, triggerT: last.t, triggerCloseT: closeT, validUntil: closeT + validMin * 60000, zoneKey: `${a.dir}:${Number(z.level).toPrecision(8)}`, score: a.score?.total ?? null, btcAlign: a.metrics.btcAlign, stageLabel: a.stageLabel };
  if (blockers.length) return { status: 'OBSERVE', ...base0, blockers, tags };
  const L2 = L ? '상승' : '하락';
  return {
    status: 'CANDIDATE', ...base0, blockers: [], tags: [],
    evidence: [                                                         // 모바일 한 줄(폭 44 이하)에 들어가도록 짧게
      `4H ${L2} · 1H ${L ? '지지' : '저항'} ${fmtPrice(z.lo)}~${fmtPrice(z.hi)} 눌림`,
      `15분 ${L ? '돌파' : '이탈'} ${fmtPrice(level)} · 거래량 ×${volRel.toFixed(1)}`,
      `손절=${L ? '눌림 저점' : '눌림 고점'} · 1차=${T1.source ?? '확정 구간'}`,
    ],
  };
}

// 저장된 활성 신호의 무효화 판단. c15 마지막 확정 봉 종가가 손절 기준을 이탈했거나, 4H·1H 구조가 사라졌거나 방향이 바뀌면 무효.
export function invalidation(active, { a, c15 }) {
  const s = active.dir === 'LONG' ? 1 : -1, last = c15?.at(-1);
  if (last && (last.c - active.stop) * s < 0) return { reason: `15분 종가 ${fmtPrice(last.c)}가 손절 ${fmtPrice(active.stop)} ${s > 0 ? '하향' : '상향'} 이탈`, price: last.c };
  if (a?.status === 'ok' && (a.stage < 1 || a.dir !== active.dir)) return { reason: a.stage < 1 ? '4H 추세·1H 눌림 구조 소멸' : '4H 추세 방향 전환', price: last?.c ?? a.price };
  if (a?.status === 'ok' && a.invalidation !== null && (a.price - a.invalidation) * s < 0) return { reason: `1H 종가 ${fmtPrice(a.price)}가 무효화 ${fmtPrice(a.invalidation)} ${s > 0 ? '하향' : '상향'} 이탈`, price: a.price };
  return null;
}
