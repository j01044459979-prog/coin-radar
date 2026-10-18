// 4.0 연구 보고서 생성(마크다운). 숫자만 만들고 해석·권고는 사람이 문서에 쓴다. 최종 테스트 구간은 --final 때만 포함.
import { breakdown, bucket, mdTable, summary, blockBootstrapDiff, concurrency } from './stats.mjs';
import { portfolioFair, leverageCheck, pickCases, quarterOf } from './stats4.mjs';
import { auditTrades } from './research.mjs';
import { CANDIDATES4, BASELINES4, NAMES4, PREREG4, ACCOUNT4, MAX_OPEN4, poolOf, judge4 } from './research4.mjs';

const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : x === Infinity ? '∞' : '-');
const iso = t => (Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '∞');
const isoT = t => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
const pct = x => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '-');
const cell = s => (s.n ? `${f(s.avg)}R / PF ${f(s.pf, 2)} / n=${s.n}${s.ci && s.ci[0] > 0 ? ' ✓' : ''}` : '-');

export function build4(res, { hash, final, pool }) {
  const L = [], T1 = res.trades[1], P = res.active;
  L.push(`# COIN RADAR 4.0 — 선별형 추세 + 눌림목 연구 결과`);
  L.push(`- 규칙 해시 \`${hash}\` · 최종 테스트 구간 ${final ? '**포함(이번 실행이 유일한 평가)**' : '미포함'} · 판정 풀: ${pool.map(p => res.periods[p].label.split('(')[0]).join(' + ')}`);
  L.push(`- 데이터: BTC ${res.prep.bars.toLocaleString()}봉 ${iso(res.prep.from)}~${iso(res.prep.to)} · 세그먼트 ${res.prep.symbols}개 · 데이터 간극 ${res.prep.gaps.length}곳 · 구간별 유동성 유니버스 상위 20(직전 30일 거래대금)`);
  L.push(`- 가정: 계정 ${ACCOUNT4.equity} USDT, 거래당 위험 ${ACCOUNT4.riskFrac * 100}%, 동시 포지션 최대 ${MAX_OPEN4}개(포트폴리오 단계), 수수료 0.05%/편도 + 슬리피지 0.05%/편도 + 펀딩 0.01%/8h, 신호 봉 마감 후 다음 봉 시가 체결, 손절 우선`);
  L.push(`| 구간 | 기간 | 유니버스 |\n|---|---|---|\n` + P.map(p => `| ${res.periods[p].label} | ${iso(res.periods[p].from)} ~ ${iso(res.periods[p].to)} | ${res.universe[p].length}종목 |`).join('\n'));

  // 1. 엔진 점검
  const all = NAMES4.flatMap(v => P.flatMap(p => T1[p]?.[v] ?? []));
  const bad = auditTrades(res.prepObj, all), amb = all.filter(t => t.ambiguous).length, qe = all.map(t => t.qtyRiskErr).filter(Number.isFinite);
  L.push(`\n## 1. 엔진 점검\n- 전체 거래 ${all.length}건 불변식 위반 ${bad.length}건 (체결=다음 봉 시가, 청산≥진입, 손절/목표 방향, 비용 부호, 봉 범위 내 체결) ${bad.length ? '\n  - ' + bad.slice(0, 5).map(b => `${b[0].symbol} ${isoT(b[0].t)} ${b[1]}`).join('\n  - ') : ''}\n- 같은 봉에서 손절·목표가 모두 닿아 손절로 처리한 모호 봉: ${amb}건 (${pct(amb / Math.max(1, all.length))})\n- 최소 주문 수량 미달·시가 갭으로 건너뛴 신호: ${JSON.stringify(res.skipped)}\n- 수량 반올림으로 생긴 위험 오차: 평균 ${pct(qe.reduce((a, b) => a + Math.abs(b), 0) / Math.max(1, qe.length))}, 최대 ${pct(Math.max(0, ...qe.map(Math.abs)))}`);

  // 2. 구간별 비교
  L.push(`\n## 2. 전략별 성과 비교 (비용 1배, 평균 R / PF / 거래 수, ✓ = 95% 하한 > 0)\n| 변형 | ` + P.map(p => res.periods[p].label.split('(')[0]).join(' | ') + ' | OOS 풀 |\n|---|' + P.map(() => '---|').join('') + '---|');
  for (const v of NAMES4) L.push(`| ${v} | ` + P.map(p => cell(summary(T1[p]?.[v] ?? []))).join(' | ') + ` | ${cell(summary(poolOf(res, 1, v, pool)))} |`);

  // 3. OOS 풀 상세 + 포트폴리오
  L.push(`\n## 3. OOS 풀 상세 (비용 스트레스 · 포트폴리오: 위험 ${ACCOUNT4.riskFrac * 100}%, 동시 ${MAX_OPEN4}개, 진입 시각·종목명 순 채택)\n| 변형 | 거래 | 승률 | 평균 R(총) | 평균 R(순) | 비용 1.5배 | 비용 2배 | PF | 95% 구간 | 포트 수익률 | 포트 최대낙폭 | 채택/건너뜀 | 평균 동시보유 |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const v of NAMES4) {
    const t = poolOf(res, 1, v, pool), s = summary(t); if (!s.n) { L.push(`| ${v} | 0 | - | - | - | - | - | - | - | - | - | - | - |`); continue; }
    const pf = portfolioFair(t, { riskFrac: ACCOUNT4.riskFrac, maxOpen: MAX_OPEN4 }), g = t.reduce((a, b) => a + b.rGross, 0) / t.length;
    const c15 = summary(poolOf(res, 1.5, v, pool)), c2 = summary(poolOf(res, 2, v, pool));
    L.push(`| ${v} | ${s.n} | ${pct(s.win)} | ${f(g)} | ${f(s.avg)} | ${f(c15.avg)} | ${f(c2.avg)} | ${f(s.pf, 2)} | ${s.ci ? `[${f(s.ci[0], 2)}, ${f(s.ci[1], 2)}]` : '산출 불가'} | ${f(pf.returnPct, 1)}% | ${f(pf.maxDrawdownPct, 1)}% | ${pf.taken}/${pf.skipped} | ${f(concurrency(t).avg, 2)} |`);
  }

  // 4. 판정
  L.push(`\n## 4. 사전 등록 기준 판정 (후보 A·B·C·D)\n기준: ${PREREG4.minTrades}건 이상 · 기대값>0 · 95% 하한>0 · PF≥${PREREG4.pfMin} · 비용 ${PREREG4.stress.join('·')}배 · 상위 3종목/최상위 분기 제외 · 구간 단독 양수 · 국면 집중 없음. **통과해도 실전 추천 금지.**`);
  const vs = [...CANDIDATES4, ...BASELINES4].map(v => judge4(res, v, pool));
  L.push(`| 변형 | 판정 | 실패한 기준 |\n|---|---|---|\n` + vs.map(j => `| ${j.variant} | ${j.pass ? '✅ 통과' : j.insufficient ? '⚠ 검증 불충분(표본 부족)' : '❌ 실패'} | ${j.checks.filter(c => !c.pass).map(c => c.name + ' (' + c.detail + ')').join('; ') || '-'} |`).join('\n'));
  L.push(`\n세부:\n` + vs.map(j => `- **${j.variant}** n=${j.n}: ` + j.checks.map(c => `${c.pass ? '✅' : '❌'} ${c.name}: ${c.detail}`).join(' / ')).join('\n'));

  // 5. 쌍체 비교(블록 부트스트랩)
  L.push(`\n## 5. 평균 R 차이 (OOS 풀, 주 블록 부트스트랩 95% 구간 — 구간이 0을 포함하면 차이를 확신할 수 없음)\n| 비교 | 평균 R 차이 | 95% 구간 |\n|---|---|---|`);
  for (const [a, b] of [['TP4_A', 'randomTrend'], ['TP4_A', 'random'], ['TP4_A', 'v3_AB'], ['TP4_A', 'v3_A'], ['TP4_B', 'TP4_A'], ['TP4_C', 'TP4_A'], ['TP4_D', 'TP4_A'], ['TP4_D', 'randomTrend']]) {
    const x = poolOf(res, 1, a, pool), y = poolOf(res, 1, b, pool), ci = blockBootstrapDiff(x, y), sx = summary(x), sy = summary(y);
    L.push(`| ${a} − ${b} | ${sx.n && sy.n ? f(sx.avg - sy.avg) : '-'} | ${ci ? `[${f(ci[0], 2)}, ${f(ci[1], 2)}]` : '산출 불가'} |`);
  }

  // 6. walk-forward(분기 접힘)
  const qs = [...new Set(NAMES4.flatMap(v => P.flatMap(p => (T1[p]?.[v] ?? []).map(t => quarterOf(t.tEntry)))))].sort();
  L.push(`\n## 6. 시간 안정성 — 달력 분기 접힘(규칙 고정, 재학습 없음). 평균 R (n)\n| 변형 | ` + qs.join(' | ') + ' | 양수 접힘 |\n|---|' + qs.map(() => '---|').join('') + '---|');
  for (const v of [...CANDIDATES4, 'randomTrend', 'v3_AB']) {
    const t = P.flatMap(p => T1[p]?.[v] ?? []); let pos = 0, cnt = 0;
    const cells = qs.map(q => { const s = summary(t.filter(x => quarterOf(x.tEntry) === q)); if (s.n >= 10) { cnt++; if (s.avg > 0) pos++; } return s.n ? `${f(s.avg, 2)} (${s.n})` : '-'; });
    L.push(`| ${v} | ${cells.join(' | ')} | ${pos}/${cnt} (n≥10인 분기) |`);
  }

  // 7. 손익 원인 분해(A는 가장 큰 표본, D는 가장 엄격한 변형)
  for (const v of ['TP4_A', 'TP4_D']) {
    const t = poolOf(res, 1, v, pool); if (t.length < 5) continue;
    L.push(`\n## 7-${v}. 수익·손실 원인 분해 — ${v} (OOS 풀 n=${t.length})`);
    L.push(mdTable(breakdown(t, [{ label: '롱', test: x => x.dir === 'LONG' }, { label: '숏', test: x => x.dir === 'SHORT' }]), '방향'));
    L.push('\n' + mdTable(breakdown(t, ['상승장', '하락장', '횡보장'].map(r => ({ label: r, test: x => x.regime === r }))), 'BTC 국면'));
    L.push('\n' + mdTable(breakdown(t, ['스윙', '돌파전환'].map(z => ({ label: z === '스윙' ? '구간: 스윙 지지·저항' : '구간: 돌파 후 전환', test: x => x.meta?.zoneType === z }))), '구간 종류'));
    const sb = x => bucket(x.meta.stopAtr, [1.5, 2, 2.5], ['1.0~1.5', '1.5~2.0', '2.0~2.5', '2.5~3.5']);
    L.push('\n' + mdTable(breakdown(t, ['1.0~1.5', '1.5~2.0', '2.0~2.5', '2.5~3.5'].map(b => ({ label: `손절 ${b} ATR`, test: x => sb(x) === b }))), '손절 폭'));
    L.push('\n' + mdTable(breakdown(t, [{ label: '거래량 확인 충족', test: x => x.meta.volOk }, { label: '거래량 확인 미충족', test: x => !x.meta.volOk }, { label: 'BTC 4H 일치', test: x => x.meta.btcOk }, { label: 'BTC 4H 불일치', test: x => !x.meta.btcOk }]), '필터 플래그'));
    L.push('\n' + mdTable(breakdown(t, ['tp', 'stop', 'time'].map(r => ({ label: r === 'tp' ? '목표(2R) 도달' : r === 'stop' ? '손절' : '시간 만료(48봉)', test: x => x.reason === r }))), '청산 사유'));
    const mf = k => t.filter(x => x.mfeR >= k).length / t.length;
    L.push(`\n- 최대 유리 이동(MFE) 도달률: 1R ${pct(mf(1))} · 2R ${pct(mf(2))} · 평균 MFE ${f(t.reduce((a, b) => a + b.mfeR, 0) / t.length, 2)}R / 평균 MAE ${f(t.reduce((a, b) => a + b.maeR, 0) / t.length, 2)}R · 평균 보유 ${f(t.reduce((a, b) => a + b.bars, 0) / t.length, 1)}봉`);
    const g = t.reduce((a, b) => a + b.rGross, 0) / t.length, n = t.reduce((a, b) => a + b.rNet, 0) / t.length;
    L.push(`- 비용 영향: 평균 총 ${f(g)}R → 순 ${f(n)}R (비용이 평균 ${f(g - n)}R 깎음, 평균 손절폭 ${pct(t.reduce((a, b) => a + b.riskPct, 0) / t.length)})`);
    L.push('\n참고 지표 일치 여부(진입 조건이 아니며 일치 여부만으로 신호를 만들지 않음 — 사후 분석):\n' + mdTable(breakdown(t, [{ label: 'Supertrend(1H) 방향 일치', test: x => x.meta.ref.stAgree }, { label: 'Supertrend 불일치', test: x => !x.meta.ref.stAgree }, { label: 'RSI(1H) 방향 일치(50 기준)', test: x => x.meta.ref.rsiAgree }, { label: 'RSI 불일치', test: x => !x.meta.ref.rsiAgree }, { label: 'MACD 히스토그램 방향 일치', test: x => x.meta.ref.macdAgree }, { label: 'MACD 불일치', test: x => !x.meta.ref.macdAgree }]), '참고 지표'));
    const bySym = new Map(); for (const x of t) { const e = bySym.get(x.symbol) || [0, 0]; e[0] += x.rNet; e[1]++; bySym.set(x.symbol, e); }
    const rk = [...bySym.entries()].sort((a, b) => b[1][0] - a[1][0]), tot = t.reduce((a, b) => a + b.rNet, 0);
    L.push(`\n- 종목별 합계 R 상위: ${rk.slice(0, 5).map(([s, e]) => `${s} ${f(e[0], 1)}R(${e[1]})`).join(', ')} / 하위: ${rk.slice(-5).map(([s, e]) => `${s} ${f(e[0], 1)}R(${e[1]})`).join(', ')} / 전체 ${f(tot, 1)}R`);
  }

  // 8. 레버리지
  L.push(`\n## 8. 레버리지·청산 위험 점검 (격리 마진, 유지증거금률 0.5% 단순화 가정)`);
  for (const v of ['TP4_A', 'TP4_D']) {
    const t = poolOf(res, 1, v, pool), lc = leverageCheck(t, { riskFrac: ACCOUNT4.riskFrac }); if (!lc.n) continue;
    L.push(`**${v}** (n=${lc.n}): 위험 ${ACCOUNT4.riskFrac * 100}% 사이징에 필요한 계정 대비 레버리지 중앙값 ${f(lc.needed.median, 2)}배 · 상위 10% ${f(lc.needed.p90, 2)}배 · 최대 ${f(lc.needed.max, 2)}배\n| 고정 레버리지 | 청산 거리 | 손절이 청산보다 먼 거래 | 손절 갭으로 청산 | 필요 레버리지가 이보다 큰 거래 |\n|---|---|---|---|---|\n` + lc.rows.map(r => `| ${r.L}배 | ${r.liqPct.toFixed(1)}% | ${r.stopBeyond} (${pct(r.stopBeyond / r.n)}) | ${r.gapLiq} | ${r.needMore} (${pct(r.needMore / r.n)}) |`).join('\n') + '\n');
  }

  // 9. 사례
  const cs = pickCases(poolOf(res, 1, 'TP4_A', pool), 3);
  const fmt = (t, k) => `${k}. **${t.symbol} ${t.dir === 'LONG' ? '롱' : '숏'}** 신호 ${isoT(t.t)} → 진입 ${isoT(t.tEntry)} @${t.entry.toPrecision(6)}, 손절 ${t.stop.toPrecision(6)} (${f(t.meta.stopAtr, 2)} ATR), 목표 ${t.tp.toPrecision(6)}, 청산 ${isoT(t.tExit)} @${t.exit.toPrecision(6)} (${t.reason}) → **${f(t.rNet, 2)}R** (MFE ${f(t.mfeR, 2)}R, MAE ${f(t.maeR, 2)}R); 구간 ${t.meta.zoneType} 레벨 ${t.meta.zoneLevel.toPrecision(6)}, 눌림 깊이 ${f(t.meta.depthAtr4, 2)} ATR(4H), 국면 ${t.regime}, 거래량확인 ${t.meta.volOk ? '충족' : '미충족'}, BTC ${t.meta.btcOk ? '일치' : '불일치'}`;
  L.push(`\n## 9. 실제 거래 사례 — TP4_A, OOS 풀에서 고정 시드 해시로 추출(결과를 보고 고르지 않음)\n**성공 사례**\n` + (cs.wins.map((t, k) => fmt(t, k + 1)).join('\n') || '(없음)') + `\n\n**실패 사례**\n` + (cs.losses.map((t, k) => fmt(t, k + 1)).join('\n') || '(없음)'));

  // 10. 시험 기록
  L.push(`\n## 10. 시험 기록\n- 사전 등록 후보: TP4_A·B·C·D (4개). 기준선: ${BASELINES4.join(', ')}. 비용 배율 ${Object.keys(res.trades).join('·')}배 × 구간 ${P.length}개. 엔진 실행 ${res.evaluated}회. 파라미터 탐색·튜닝 없음(규칙은 \`docs/TREND-PULLBACK-4-0-PREREG.md\`에 실행 전 고정).\n- 신뢰구간은 다중 비교(후보 4개) 보정을 하지 않았다.`);
  return { markdown: L.join('\n'), verdicts: vs };
}
