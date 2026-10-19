// 조건 적합도(0~100) — 기회 포착 레이더용 설명 점수(순수 함수).
//
// 이것은 '확인된 조건이 얼마나 잘 갖춰졌는가'를 한 숫자로 요약한 것이며 승률·수익 확률이 아니다.
// 가중치와 구간 경계는 *제안값*이다. 이 기능을 위해 최적화하지 않았고, 과거 데이터에서 점수 구간별 결과가 어떻게 달라지는지만 검증한다
// (radar-service/opportunity/backtest.mjs, docs/OPPORTUNITY-RADAR.md '조건 적합도 검증').
// 단계(2·3단계)와 알림 여부는 이 점수와 무관하게 기존 7개 점검으로만 정해진다. 점수는 표시와 같은 단계 안의 정렬에만 쓴다.
// 기존 정기 보고의 점수(scoring.mjs, 5분봉 돌파 후보용)와는 입력·가중치가 다른 별개 체계이며 서로 참조하지 않는다.
//
// 원칙: 계산 근거가 없는 항목(거래량 결측, BTC 확인 불가 등)에는 점수를 주지 않는다. 단, 반대편 장애물이 '없다'는 것은 결측이 아니라 계산 결과이므로 절반만 준다.

export const SCORE_WEIGHTS = Object.freeze({ trend: 20, pullback: 20, volume: 15, reward: 20, risk: 15, btc: 10 });
export const SCORE_TOTAL = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);   // 100
export const GRADE = Object.freeze({ high: 75, mid: 55 });                            // 75 이상 높음 · 55 이상 보통 · 미만 낮음 (제안값)

// 거래량 상태(설명용): 마지막 확정 1H 봉 거래대금 ÷ 직전 20봉 평균(sig), 눌림 구간 평균 ÷ 그 이전 20봉 평균(pb).
//  sig ≥ 1.2 확대 · ≥ 0.8 보통 · 미만 위축 / pb < 0.9 이면 눌림 중 거래 위축(매도세 소진 정황) — 모두 제안값
export const VOLUME = Object.freeze({ expand: 1.2, normal: 0.8, dryPullback: 0.9 });
export function volumeState(sig, pb) {
  const level = !Number.isFinite(sig) ? '확인 불가' : sig >= VOLUME.expand ? '확대' : sig >= VOLUME.normal ? '보통' : '위축';
  const dry = Number.isFinite(pb) ? pb < VOLUME.dryPullback : null;
  return { level, sig: Number.isFinite(sig) ? sig : null, pb: Number.isFinite(pb) ? pb : null, dry, confirmed: level === '확대' };
}

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const r1 = x => Math.round(x * 10) / 10;

// a: analyzeCoin 결과(stage ≥ 1). 반환 { total, grade, parts: [{ key, label, score, max, note }] }
export function fitScore(a, W = SCORE_WEIGHTS) {
  const m = a.metrics, chk = Object.fromEntries(a.checks.map(c => [c.key, c.ok])), parts = [];
  const put = (key, label, score, note) => parts.push({ key, label, score: r1(clamp(score, 0, W[key])), max: W[key], note });

  // 1) 추세 20: EMA50-200 간격(ATR 4H 대비)이 3 이상이면 만점. 확정 스윙 구조(HH·HL)는 단계 판정에서 이미 통과했으므로 여기서는 강도만 본다.
  const gap = Number.isFinite(m.emaGapAtr4) ? m.emaGapAtr4 : 0;
  put('trend', '추세', W.trend * clamp(gap / 3), `EMA 간격 ${gap.toFixed(1)} ATR(4H)`);

  // 2) 눌림·재진입 20: 구간 접촉·유지 12, 재진입 확인 캔들 8. 접근만 한 1단계는 4.
  const touchHold = chk.touch && chk.hold ? 12 : a.stage === 1 ? 4 : 0;
  put('pullback', '눌림·재진입', touchHold + (chk.reentry ? 8 : 0), `${chk.touch && chk.hold ? '구간 접촉·유지' : '구간 접근'}${chk.reentry ? ' · 재진입 확인' : ' · 재진입 대기'}`);

  // 3) 거래량 15: 재진입 봉 거래대금 배율(1.5배 이상 만점) 9 + 눌림 중 위축 6. 결측이면 해당 부분 0.
  const v = m.volume ?? volumeState(m.relVol, null);
  const vSig = v.sig === null ? 0 : 9 * clamp(v.sig / 1.5), vDry = v.dry === true ? 6 : 0;
  put('volume', '거래량', vSig + vDry, v.sig === null ? '거래량 확인 불가' : `확인 봉 ×${v.sig.toFixed(1)}${v.dry === null ? '' : v.dry ? ' · 눌림 중 위축' : ' · 눌림 중 위축 아님'}`);

  // 4) 손익비 20: 반대편 장애물까지의 거리를 위험폭으로 나눈 값. 4R 이상 만점, 2R(= 점검 기준)에서 절반 이상. 장애물이 없으면 절반. 기준 구간이 없으면 0.
  const plan = a.plan;
  let reward = 0, rnote = '산정 불가';
  if (plan) {
    if (plan.target === null) { reward = W.reward / 2; rnote = '가까운 반대편 구간 없음(목표 산정 불가)'; }
    else { reward = W.reward * clamp(plan.rr / 4); rnote = `${plan.rr.toFixed(1)}R`; }
  }
  put('reward', '손익비', reward, rnote);

  // 5) 변동성·위험 15: 무효화 거리 적정 6 + 추격 아님 4 + 변동성 낮음/보통 5(높음 0)
  put('risk', '변동성·위험', (chk.width ? 6 : 0) + (chk.chase ? 4 : 0) + (m.volLabel === '높음' ? 0 : 5), `변동성 ${m.volLabel}${chk.width ? '' : ' · 무효화 거리 부적정'}${chk.chase ? '' : ' · 추격 위험'}`);

  // 6) BTC 맥락 10: 일치 10 · 중립 5 · 역방향/확인 불가 0
  put('btc', 'BTC 맥락', m.btcAlign === '일치' ? W.btc : m.btcAlign === '중립' ? W.btc / 2 : 0, `BTC ${m.btcAlign}`);

  const total = Math.round(parts.reduce((s, p) => s + p.score, 0));
  return { total, grade: total >= GRADE.high ? '높음' : total >= GRADE.mid ? '보통' : '낮음', parts };
}
