// 연구 보고서 생성: 손실 원인 분해(A/B/A+B) · 엔진 검증 · 가설 H1/H2/H3 독립 비교 · 사전 등록 기준 판정 · 비용 스트레스.
import { blockBootstrap, blockBootstrapDiff, breakdown, bucket, mdTable, nonOverlapping, portfolio, concurrency, summary } from './stats.mjs';
import { auditTrades } from './research.mjs';
import { DUAL_RULES } from '../dual/combine.mjs';

const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : x === Infinity ? '∞' : '-');
const iso = t => (Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '∞');
const key = t => `${t.seg}|${t.t}|${t.dir}`;
const mddR = trades => { let e = 0, pk = 0, dd = 0; for (const t of [...trades].sort((a, b) => a.tExit - b.tExit)) { e += t.rNet; pk = Math.max(pk, e); dd = Math.max(dd, pk - e); } return dd; };
export const REGIMES = ['상승장', '하락장', '횡보장'];

// ── 진단용 결합 통계 수집 훅 (runResearch의 onSegment) ──
export function jointCollector() {
  const J = { bars: 0, aFire: 0, bFire: 0, both: 0, bothSame: 0, conflict: 0, corr: { n: 0, sa: 0, sb: 0, saa: 0, sbb: 0, sab: 0 }, pair: { stEma: [0, 0], stMacd: [0, 0], stRsi: [0, 0], emaMacd: [0, 0], emaRsi: [0, 0], macdRsi: [0, 0] }, ageShare: { total: 0, late: 0 } };
  return {
    J,
    hook: (seg, base, { uni, PER, active, result }) => {
      // 동일 시점 비교용 라벨: 각 A(B) 거래의 신호 봉에서 다른 전략도 같은 방향으로 75점 이상이었는가
      for (const p of active) for (const v of ['A', 'B']) for (const t of result.trades[1]?.[p]?.[v] ?? []) {
        if (t.seg !== seg.name || t.otherAlso !== undefined) continue;
        const r = base.rawAt(t.i), o = v === 'A' ? r.b : r.a;
        t.otherAlso = Boolean(o.dir === t.dir && o.score >= DUAL_RULES.priorityMin && !(o.blockers?.length));
      }
      for (const p of active) {
        if (p === 'final') continue;                         // 최종 테스트 구간은 진단에 쓰지 않는다
        if (!uni[p].has(seg.base)) continue;
        for (let i = 260; i < seg.c.length; i++) {
          const t = seg.c[i].t; if (t < PER[p].from || t >= PER[p].to) continue;
          const r = base.rawAt(i), a = r.a, b = r.b;
          J.bars++;
          const aF = a.dir && a.score >= DUAL_RULES.priorityMin && !a.blockers?.length, bF = b.dir && b.score >= DUAL_RULES.priorityMin && !b.blockers.length;
          if (aF) J.aFire++; if (bF) J.bFire++;
          if (aF && bF) { J.both++; if (a.dir === b.dir) J.bothSame++; else J.conflict++; }
          const sa = a.score || 0, sb = b.score || 0, c = J.corr; c.n++; c.sa += sa; c.sb += sb; c.saa += sa * sa; c.sbb += sb * sb; c.sab += sa * sb;
          if (a.dir && a.features) {
            const fe = a.features, cond = { st: true, ema: fe.e200DistPct > 0, macd: fe.histAligned, rsi: fe.rsiDir >= 50 };
            const pr = (k, x, y) => { J.pair[k][1]++; if (x === y) J.pair[k][0]++; };
            pr('stEma', cond.st, cond.ema); pr('stMacd', cond.st, cond.macd); pr('stRsi', cond.st, cond.rsi); pr('emaMacd', cond.ema, cond.macd); pr('emaRsi', cond.ema, cond.rsi); pr('macdRsi', cond.macd, cond.rsi);
            if (aF) { J.ageShare.total++; if (fe.age > 36) J.ageShare.late++; }
          }
        }
      }
    },
  };
}

function falseBreakRate(prep, trades) {
  const segs = new Map(prep.segs.map(s => [s.name, s]));
  let n = 0, bad = 0;
  for (const t of trades) {
    const seg = segs.get(t.seg), lvl = t.meta?.fb?.level; if (!seg || !Number.isFinite(lvl)) continue;
    const d = t.dir === 'LONG' ? 1 : -1; let fail = false;
    for (let k = t.i + 1; k <= Math.min(seg.c.length - 1, t.i + 6); k++) if ((seg.c[k].c - lvl) * d < 0) { fail = true; break; }   // 신호 후 6봉 안에 종가가 레벨 안쪽으로 되돌아옴
    n++; if (fail) bad++;
  }
  return { n, bad, rate: n ? bad / n : null };
}

const grp = (label, test) => ({ label, test });
function pooled(res, variant, mult = 1, periods = ['dev', 'val', 'seen']) { return periods.flatMap(p => res.trades[mult]?.[p]?.[variant] ?? []); }

export function diagnostics(res, J) {
  const L = [], prep = res.prepObj, A = pooled(res, 'A'), B = pooled(res, 'B'), AB = pooled(res, 'AB');
  const section = (t, rows, title) => L.push(`**${t}**\n${mdTable(rows, title)}\n`);
  L.push(`분석 표본 = 개발+검증+이미 본 구간 합산(최종 테스트 구간 제외), 비용 반영 순 R. 신뢰구간은 진입 주(週) 단위 블록 부트스트랩. 원인으로 확정되지 않은 해석은 **가설**로 표시.`);
  L.push(`### 2-1) 전략 A (n=${A.length})`);
  section('Supertrend 전환 후 경과 봉 수', breakdown(A, [grp('0~3봉(갓 전환)', t => t.meta.fa.age <= 3), grp('4~12봉', t => t.meta.fa.age >= 4 && t.meta.fa.age <= 12), grp('13~36봉', t => t.meta.fa.age >= 13 && t.meta.fa.age <= 36), grp('37봉 이상(오래된 추세)', t => t.meta.fa.age > 36)]), '경과');
  section('EMA200 방향 이격(%, 추세 쪽이 +)', breakdown(A, [grp('반대편(<0)', t => t.meta.fa.e200DistPct < 0), grp('0~1%', t => t.meta.fa.e200DistPct >= 0 && t.meta.fa.e200DistPct < 1), grp('1~3%', t => t.meta.fa.e200DistPct >= 1 && t.meta.fa.e200DistPct < 3), grp('3~6%', t => t.meta.fa.e200DistPct >= 3 && t.meta.fa.e200DistPct < 6), grp('6% 이상(늘어난 추세)', t => t.meta.fa.e200DistPct >= 6)]), '이격');
  section('RSI(추세 방향 기준)', breakdown(A, [grp('<40 약세', t => t.meta.fa.rsiDir < 40), grp('40~50', t => t.meta.fa.rsiDir >= 40 && t.meta.fa.rsiDir < 50), grp('50~68 건강', t => t.meta.fa.rsiDir >= 50 && t.meta.fa.rsiDir < 68), grp('68~75 다소 과열', t => t.meta.fa.rsiDir >= 68 && t.meta.fa.rsiDir < 75), grp('75 이상 과열', t => t.meta.fa.rsiDir >= 75)]), 'RSI');
  section('MACD 히스토그램', breakdown(A, [grp('정렬 + 확대', t => t.meta.fa.histAligned && t.meta.fa.histExpanding), grp('정렬 + 축소(모멘텀 둔화)', t => t.meta.fa.histAligned && !t.meta.fa.histExpanding), grp('불일치', t => !t.meta.fa.histAligned)]), 'MACD');
  section('시장 국면(진입 시점 직전 30일 BTC)', breakdown(A, REGIMES.map(r => grp(r, t => t.regime === r))), '국면');
  const pr = J.pair, phi = k => { const [agree, n] = pr[k]; return n ? `${(agree / n * 100).toFixed(1)}%` : '-'; };
  L.push(`**지표 간 중복성(A 방향이 있는 모든 봉에서 두 조건이 같은 값인 비율)**: Supertrend↔EMA200 ${phi('stEma')} · Supertrend↔MACD ${phi('stMacd')} · Supertrend↔RSI ${phi('stRsi')} · EMA200↔MACD ${phi('emaMacd')} · EMA200↔RSI ${phi('emaRsi')} · MACD↔RSI ${phi('macdRsi')}. 비율이 높을수록 같은 정보를 반복해서 점수에 더하고 있다는 뜻(**가설**: 네 지표는 모두 가격의 이동평균형 필터라 중복이 크고, 합산 점수가 독립 증거처럼 오해된다).`);
  L.push(`**늦은 진입 문제**: A≥75 신호 중 Supertrend 전환 후 37봉을 넘긴 비율 ${J.ageShare.total ? (J.ageShare.late / J.ageShare.total * 100).toFixed(1) : '-'}% (신호 발생 봉 기준, 비중첩 거래가 아니라 전체 봉).\n`);
  L.push(`### 2-2) 전략 B (n=${B.length})`);
  section('구조 단계', breakdown(B, [grp('재테스트 완료', t => t.meta.fb.structureType === 'retest'), grp('돌파 직후(재테스트 전)', t => t.meta.fb.structureType === 'fresh'), grp('돌파 후 경과·재테스트 미확인', t => t.meta.fb.structureType === 'extended')]), '구조');
  const fb = falseBreakRate(prep, B), fbr = falseBreakRate(prep, B.filter(t => t.meta.fb.structureType === 'retest')), fbf = falseBreakRate(prep, B.filter(t => t.meta.fb.structureType === 'fresh'));
  L.push(`**가짜 돌파 비율**(신호 후 6봉 안에 종가가 돌파 레벨 안쪽으로 되돌아온 비율): 전체 ${f(fb.rate * 100, 1)}% (n=${fb.n}) · 재테스트 완료 ${f(fbr.rate * 100, 1)}% (n=${fbr.n}) · 돌파 직후 ${f(fbf.rate * 100, 1)}% (n=${fbf.n}).\n`);
  section('돌파 봉 상대 거래량', breakdown(B, [grp('<1.2배', t => t.meta.fb.rv < 1.2), grp('1.2~1.5배', t => t.meta.fb.rv >= 1.2 && t.meta.fb.rv < 1.5), grp('1.5~2배', t => t.meta.fb.rv >= 1.5 && t.meta.fb.rv < 2), grp('2배 이상', t => t.meta.fb.rv >= 2)]), '거래량');
  section('BTC 정합', breakdown(B, [grp('BTC 같은 방향', t => t.meta.fb.btcAlign === 'same'), grp('BTC 혼조', t => t.meta.fb.btcAlign === 'flat')]), 'BTC');
  section('손절 거리(ATR)', breakdown(B, [grp('<1.0', t => t.meta.fb.stopAtr < 1), grp('1.0~1.5', t => t.meta.fb.stopAtr >= 1 && t.meta.fb.stopAtr < 1.5), grp('1.5~2.0', t => t.meta.fb.stopAtr >= 1.5 && t.meta.fb.stopAtr < 2), grp('2.0 이상', t => t.meta.fb.stopAtr >= 2)]), '손절');
  section('시장 국면', breakdown(B, REGIMES.map(r => grp(r, t => t.regime === r))), '국면');
  const mf = (ts) => ts.length ? { n: ts.length, tp: ts.filter(t => t.reason === 'tp').length / ts.length, stop: ts.filter(t => t.reason === 'stop').length / ts.length, time: ts.filter(t => t.reason === 'time').length / ts.length, mfe: ts.reduce((s, t) => s + t.mfeR, 0) / ts.length, mae: ts.reduce((s, t) => s + t.maeR, 0) / ts.length, m1: ts.filter(t => t.mfeR >= 1).length / ts.length, m1stop: ts.filter(t => t.mfeR >= 1 && t.reason === 'stop').length / ts.length } : null;
  const row = (l, ts) => { const m = mf(ts); return m ? `| ${l} | ${m.n} | ${(m.tp * 100).toFixed(1)}% | ${(m.stop * 100).toFixed(1)}% | ${(m.time * 100).toFixed(1)}% | ${f(m.mfe, 2)}R | ${f(m.mae, 2)}R | ${(m.m1 * 100).toFixed(1)}% | ${(m.m1stop * 100).toFixed(1)}% |` : `| ${l} | 0 | | | | | | | |`; };
  L.push(`**목표 2R 도달률과 MFE/MAE**\n| 구분 | 거래 | 2R 목표 도달 | 손절 | 시간 청산 | 평균 MFE | 평균 MAE | MFE≥1R 비율 | MFE≥1R 후 손절 |\n|---|---|---|---|---|---|---|---|---|\n${row('전략 B 전체', B)}\n${row('B · 횡보장', B.filter(t => t.regime === '횡보장'))}\n${row('B · 상승장', B.filter(t => t.regime === '상승장'))}\n${row('B · 하락장', B.filter(t => t.regime === '하락장'))}\n${row('전략 A 전체', A)}\n${row('A+B', AB)}\n${row('무작위(비교)', pooled(res, 'random'))}\n`);
  const bf = fb.n && B.filter(t => t.regime === '횡보장').length ? falseBreakRate(prep, B.filter(t => t.regime === '횡보장')) : { rate: null, n: 0 }, bn = falseBreakRate(prep, B.filter(t => t.regime !== '횡보장'));
  L.push(`**횡보장에서 B 손실이 큰 이유(가설 검토)**: 가짜 돌파 비율 횡보장 ${f(bf.rate * 100, 1)}% (n=${bf.n}) vs 그 외 ${f(bn.rate * 100, 1)}% (n=${bn.n}). 횡보장에서는 돌파 후 평균회귀가 잦아 2R 목표 도달률이 낮고(위 표) 손절이 대부분이다 — 이는 관찰이며 인과 확증은 아니다(**가설**: 20봉 돌파는 박스권의 가장자리를 '돌파'로 오인).\n`);
  const bRaw = pooled(res, 'Braw'), clean = bRaw.filter(t => !t.meta.blockers.length), blocked = bRaw.filter(t => t.meta.blockers.length);
  section('B 차단 규칙의 가치(원시 후보 ≥50점 기준)', breakdown(bRaw, [grp('차단 사유 없음', t => !t.meta.blockers.length), grp('차단 사유 있음(전체)', t => t.meta.blockers.length > 0), grp('└ BTC 역추세', t => t.meta.blockers.some(x => /BTC 추세와 반대/.test(x))), grp('└ 추격 제한', t => t.meta.blockers.some(x => /추격/.test(x))), grp('└ 과도한 변동성', t => t.meta.blockers.some(x => /변동성/.test(x))), grp('└ 손익비 확보 어려움', t => t.meta.blockers.some(x => /손익비/.test(x))), grp('└ 손절 거리 부적절', t => t.meta.blockers.some(x => /손절 거리/.test(x))), grp('└ 유동성 부족', t => t.meta.blockers.some(x => /유동성/.test(x)))]), '차단');
  L.push(`### 2-3) A+B`);
  const both = J.both, den = Math.max(1, J.aFire);
  L.push(`**신호 중복(전 종목·전 봉, 봉 단위)**: 검토한 ${J.bars.toLocaleString()}봉 중 A≥75 ${J.aFire.toLocaleString()}회(${(J.aFire / J.bars * 100).toFixed(1)}%), B≥75(차단 없음) ${J.bFire.toLocaleString()}회(${(J.bFire / J.bars * 100).toFixed(2)}%), 동시 ${both.toLocaleString()}회(같은 방향 ${J.bothSame.toLocaleString()} · 충돌 ${J.conflict.toLocaleString()}). A가 켜졌을 때 B도 켜질 확률 ${(both / den * 100).toFixed(1)}% vs B의 무조건 확률 ${(J.bFire / J.bars * 100).toFixed(2)}% → 리프트 ${f((both / den) / Math.max(1e-9, J.bFire / J.bars), 2)}배(1배면 독립).`);
  const c = J.corr, cov = c.sab / c.n - (c.sa / c.n) * (c.sb / c.n), sdA = Math.sqrt(c.saa / c.n - (c.sa / c.n) ** 2), sdB = Math.sqrt(c.sbb / c.n - (c.sb / c.n) ** 2);
  L.push(`A·B 점수의 피어슨 상관(전 봉): ${f(cov / (sdA * sdB), 3)} (점수 0은 방향 없음 포함).\n`);
  section('동일 시점 비교: A 거래를 B도 같은 방향 75점+였는가로 분할', breakdown(A, [grp('A 단독(B 기준 미달)', t => t.otherAlso === false), grp('A와 B 동시(A의 손절·목표 사용)', t => t.otherAlso === true)]), 'A');
  section('동일 시점 비교: B 거래를 A도 같은 방향 75점+였는가로 분할', breakdown(B, [grp('B 단독(A 기준 미달)', t => t.otherAlso === false), grp('B와 A 동시', t => t.otherAlso === true)]), 'B');
  section('A+B 우선후보(B의 손절·목표 사용)', breakdown(AB, [grp('A+B 전체', () => true)]), 'A+B');
  const byScore = (rows, name, fieldFn) => breakdown(rows, [grp('50~60', t => fieldFn(t) >= 50 && fieldFn(t) < 60), grp('60~70', t => fieldFn(t) >= 60 && fieldFn(t) < 70), grp('70~75', t => fieldFn(t) >= 70 && fieldFn(t) < 75), grp('75~80', t => fieldFn(t) >= 75 && fieldFn(t) < 80), grp('80~90', t => fieldFn(t) >= 80 && fieldFn(t) < 90), grp('90 이상', t => fieldFn(t) >= 90)]);
  section('A 점수 구간별 품질(원시 신호)', byScore(pooled(res, 'Araw'), 'A', t => t.meta.sa), 'A 점수');
  section('B 점수 구간별 품질(원시 신호, 차단 사유 포함)', byScore(bRaw, 'B', t => t.meta.sb), 'B 점수');
  section('B 점수 구간별 품질(차단 사유 없는 후보만)', byScore(clean, 'B', t => t.meta.sb), 'B 점수');
  const grossNet = ['A', 'B', 'AB', 'random'].map(v => { const ts = pooled(res, v); const n = ts.length; return n ? `| ${v} | ${n} | ${f(ts.reduce((s, t) => s + t.rGross, 0) / n)} | ${f(ts.reduce((s, t) => s + t.rNet, 0) / n)} | ${f(ts.reduce((s, t) => s + (t.rGross - t.rNet), 0) / n)} |` : ''; }).join('\n');
  L.push(`**비용 전후**\n| 변형 | 거래 | 총손익 평균 R | 순손익 평균 R | 거래당 비용 R |\n|---|---|---|---|---|\n${grossNet}\n`);
  // 손실 집중
  const conc = (ts, name) => {
    const bySym = new Map(); for (const t of ts) bySym.set(t.symbol, (bySym.get(t.symbol) || 0) + t.rNet);
    const neg = [...bySym.entries()].filter(e => e[1] < 0).sort((a, b) => a[1] - b[1]), totalNeg = neg.reduce((s, e) => s + e[1], 0), top = neg.slice(0, 5);
    return `- ${name}: 순손실 종목 ${neg.length}/${bySym.size}개, 손실 상위 5종목 ${top.map(e => `${e[0]} ${f(e[1], 1)}R`).join(' · ')} (순손실 합 ${f(totalNeg, 1)}R 중 ${f(top.reduce((s, e) => s + e[1], 0) / (totalNeg || 1) * 100, 0)}%)`;
  };
  L.push(`**손실 집중 종목**\n${conc(A, 'A')}\n${conc(B, 'B')}\n${conc(AB, 'A+B')}\n`);
  const hour = t => Math.floor(((t.tEntry % 86400000) / 3600000) / 4), dow = t => new Date(t.tEntry).getUTCDay();
  const hn = ['00~04', '04~08', '08~12', '12~16', '16~20', '20~24'], dn = ['일', '월', '화', '수', '목', '금', '토'];
  section('A+B 진입 시간대(UTC 4시간)', breakdown(AB, hn.map((l, i) => grp(l, t => hour(t) === i))), '시간대');
  section('A+B 진입 요일(UTC)', breakdown(AB, dn.map((l, i) => grp(l, t => dow(t) === i))), '요일');
  return L.join('\n');
}

// ── 엔진 검증 보고 ──
export function engineAudit(res) {
  const prep = res.prepObj, all = [];
  for (const p of res.active) for (const v of ['A', 'B', 'AB', 'legacy1', 'legacy2']) all.push(...(res.trades[1]?.[p]?.[v] ?? []));
  const bad = auditTrades(prep, all);
  const errs = all.map(t => t.qtyRiskErr).filter(Number.isFinite), absMean = errs.length ? errs.reduce((s, x) => s + Math.abs(x), 0) / errs.length : null, maxErr = errs.length ? Math.max(...errs.map(Math.abs)) : null;
  const cc = concurrency(pooled(res, 'AB', 1, res.active)), no = nonOverlapping(pooled(res, 'AB', 1, res.active));
  const L = [];
  L.push(`- 데이터: BTC ${res.prep.bars.toLocaleString()}봉 ${iso(res.prep.from)}~${iso(res.prep.to)}, 세그먼트 ${res.prep.symbols}개, **시간 간극 ${res.prep.gaps.length}곳**${res.prep.gaps.length ? ` (${res.prep.gaps.slice(0, 5).map(g => `${g.id} ${iso(g.at)} ${g.missingBars}봉`).join(', ')})` : ''} → 간극에서 세그먼트를 분할해 워밍업을 다시 거침.`);
  const amb = all.filter(t => t.ambiguous), ambShare = all.length ? amb.length / all.length : 0;
  const avgNet = all.length ? all.reduce((a, t) => a + t.rNet, 0) / all.length : 0, avgOpt = all.length ? all.reduce((a, t) => a + (t.rNetOpt ?? t.rNet), 0) / all.length : 0;
  L.push(`- 봉 내부 손절·목표 동시 터치(순서 불명): 전체 거래의 ${(ambShare * 100).toFixed(2)}%(${amb.length}건). 모두 손절로 처리(보수적)했으며, 이 거래를 전부 목표 도달로 바꾼 낙관적 상한에서도 평균 R은 ${f(avgNet)} → ${f(avgOpt)}로 변하는 정도 — 1시간봉 내부 순서 가정이 결론을 바꾸는지 가늠하는 값(분봉 데이터로 확인한 것은 아님).`);
  L.push(`- 거래 불변식 점검(진입=다음 봉·시가+슬리피지, 청산≥진입, 손절/목표 방향, 순손익≤총손익, 체결가가 봉 범위 안, MFE≥목표 거리): 검사 ${all.length.toLocaleString()}건 중 **위반 ${bad.length}건**${bad.length ? ' — ' + bad.slice(0, 3).map(b => b[1]).join(' / ') : ''}.`);
  L.push(`- 거래 제외(진입 불가) 집계: ${JSON.stringify(res.audit.skipped)} (갭으로 시가가 손절·목표 바깥이거나 최소 주문 수량 미달).`);
  L.push(`- 최소 주문 단위: 자본 $10,000·위험 1% 가정 수량 반올림에 따른 위험 오차 평균 ${errs.length ? (absMean * 100).toFixed(2) : '-'}% · 최대 ${errs.length ? (maxErr * 100).toFixed(1) : '-'}% (수량 관련 규격은 OKX 계약 사양 사용, 호가 단위는 불리한 방향으로 반올림).`);
  L.push(`- 동시 보유(종목 간 겹침): A+B 진입 시점 평균 ${f(cc.avg, 2)}개 · 최대 ${cc.max}개. 보유기간이 겹치지 않는 거래열로 줄이면 ${no.length}/${cc.n}건 — 통계 표본의 독립성 확보용(아래 포트폴리오 표 참고).`);
  const pf = (label, ts) => { const p = portfolio(ts, { riskFrac: 0.01, maxOpen: 5 }); const s = summary(ts); return `| ${label} | ${ts.length} | ${p.taken} | ${p.skipped} | ${f(p.returnPct, 1)}% | ${f(p.maxDrawdownPct, 1)}% | ${f(mddR(ts), 1)}R | ${p.maxConcurrent} |`; };
  L.push(`**포트폴리오 낙폭(거래당 위험 1%, 동시 포지션 5개 상한, 복리, 전 기간 합산 — 개발+검증+이미 본 구간)**\n| 변형 | 신호 거래 | 실행 | 상한으로 건너뜀 | 수익률 | 최대 낙폭 | (참고) 단순 R 합산 MDD | 최대 동시 |\n|---|---|---|---|---|---|---|---|\n${['legacy2', 'A', 'B', 'AB', 'random'].map(v => pf(v, pooled(res, v, 1, res.active.filter(x => x !== 'final')))).join('\n')}`);
  return { text: L.join('\n'), violations: bad.length };
}

// ── 가설 비교 ──
export function hypothesisTables(res, mult = 1) {
  const L = [], T = res.trades[mult];
  const stat = (ts, base) => { const s = summary(ts); return { ...s, mdd: mddR(ts), total: ts.reduce((a, t) => a + t.rNet, 0) }; };
  const row = (label, ts) => { const s = stat(ts); return !s.n ? `| ${label} | 0 | | | | | | |` : `| ${label} | ${s.n} | ${(s.win * 100).toFixed(1)}% | ${f(s.avg)} | ${f(s.pf, 2)} | ${s.ci ? `[${f(s.ci[0], 2)}, ${f(s.ci[1], 2)}]` : '-'} | ${f(s.total, 1)} | ${f(s.mdd, 1)} |`; };
  const H = '| 변형 | 거래 | 승률 | 평균 R | PF | 평균 R 95%(주 블록) | 총 R | MDD(R) |\n|---|---|---|---|---|---|---|---|';
  const pair = (p, baseV, varV) => {
    const b = T[p]?.[baseV] ?? [], v = T[p]?.[varV] ?? [];
    const kb = new Set(b.map(key)), kv = new Set(v.map(key));
    const kept = v.filter(t => kb.has(key(t))), removed = b.filter(t => !kv.has(key(t))), added = v.filter(t => !kb.has(key(t)));
    const diff = blockBootstrapDiff(kept, removed);
    return { kept, removed, added, diff };
  };
  const per = p => res.periods[p].label + ` (${iso(res.periods[p].from)}~${iso(res.periods[p].to)})`;
  const emit = (title, baseV, varV, extra = '') => {
    L.push(`#### ${title}`);
    for (const p of res.active) {
      if (!T[p]) continue;
      const r = pair(p, baseV, varV);
      L.push(`**${per(p)}**${p === 'final' ? ' ⚠️ 최종 테스트(1회)' : ''}${p === 'dev' && title.includes('H3') ? ' ⚠️ 표본 내(허용 국면을 이 구간에서 도출)' : ''}\n${H}\n${row('원본 ' + baseV, T[p][baseV] ?? [])}\n${row('변형 ' + varV, T[p][varV] ?? [])}\n${row('└ 유지된 신호(원본과 동일)', r.kept)}\n${row('└ 제거된 신호(원본에만 있음)', r.removed)}\n${row('└ 새로 생긴 신호(제거로 포지션이 풀려 발생)', r.added)}\n` +
        `제거된 신호 대비 유지된 신호의 평균 R 차이: ${r.diff && r.kept.length && r.removed.length ? `${f(summary(r.kept).avg - summary(r.removed).avg)} (95% 블록 구간 [${f(r.diff[0], 2)}, ${f(r.diff[1], 2)}])` : '산출 불가'} — 구간이 0을 포함하면 필터가 좋은 신호와 나쁜 신호를 구분한다는 증거가 없다. 거래 수 감소 자체는 개선으로 보지 않는다.\n`);
    }
    if (extra) L.push(extra);
  };
  L.push('### 3-1) H1 — 전략 B에서 재테스트 완료를 필수 조건으로 (원본 대비 변경점 1개)');
  emit('H1 · B', 'B', 'B_H1'); emit('H1 · A+B (B만 변경)', 'AB', 'AB_H1');
  L.push('### 3-2) H2 — 전략 A에서 Supertrend 전환 후 36봉(사전 등록값) 초과 진입 금지 (변경점 1개)');
  emit('H2 · A', 'A', 'A_H2'); emit('H2 · A+B (A만 변경)', 'AB', 'AB_H2');
  L.push('탐색용 민감도(가설 검정 아님·조합 수에 포함): 12봉 제한은 `A_H2x12`, `AB_H2x12` 변형으로 시험했고 아래 요약표에 있다.');
  L.push('### 3-3) H3 — 시장 국면별 실행 제한 (허용 국면은 개발 구간에서 사전 규칙으로 도출)');
  if (res.allow) {
    L.push(`허용 국면 도출 규칙(사전 정의): 개발 구간 비용 반영 평균 R > 0 이고 거래 ≥ 30인 국면만 허용. 결과 — ` + ['A', 'B', 'AB'].map(k => `${k}: 허용 {${[...res.allow[k].allowed].join(', ') || '없음 → 전략 비활성'}} (개발 구간 국면별 ${REGIMES.map(r => `${r} n=${res.allow[k].table[r].n}/평균 ${f(res.allow[k].table[r].avg, 3)}`).join(', ')})`).join('; '));
    for (const k of ['A', 'B', 'AB']) {
      emit(`H3 · ${k}`, k, `${k}_H3`);
      for (const p of res.active) {
        if (!T[p]) continue;
        L.push(`${per(p)} — 같은 국면 제한을 건 무작위 기준선 vs ${k}_H3: ${row(`random_H3_${k}`, T[p][`random_H3_${k}`] ?? [])}\n`);
      }
    }
  }
  return L.join('\n');
}

// ── 사전 등록 기준 판정 ──
export const PREREG = { minTrades: 100, pfMin: 1.15, stress: [1.5, 2], minRegimeN: 20, topSymbolsRemoved: 3 };
export function judge(res, variant, period) {
  const T1 = res.trades[1]?.[period]?.[variant] ?? [], s = summary(T1), out = { variant, period, n: T1.length, checks: [] };
  const chk = (name, pass, detail) => out.checks.push({ name, pass: Boolean(pass), detail });
  chk('청산 거래 ≥ 100', s.n >= PREREG.minTrades, `n=${s.n}`);
  chk('비용 반영 기대값 > 0', s.n && s.avg > 0, `평균 ${f(s.avg)}R`);
  chk('95% 신뢰구간(주 블록) 하한 > 0', s.ci && s.ci[0] > 0, s.ci ? `[${f(s.ci[0], 3)}, ${f(s.ci[1], 3)}]` : '산출 불가');
  chk('Profit Factor ≥ 1.15', s.n && s.pf >= PREREG.pfMin, `PF ${f(s.pf, 2)}`);
  const regs = REGIMES.map(r => ({ r, ...summary(T1.filter(t => t.regime === r)) })).filter(x => x.n >= PREREG.minRegimeN);
  chk('성과가 특정 국면에만 집중되지 않음(n≥20인 국면 중 ≥2곳이 양수)', regs.length >= 2 && regs.filter(x => x.avg > 0).length >= 2, regs.map(x => `${x.r} n=${x.n} 평균 ${f(x.avg, 3)}`).join(', ') || '국면별 표본 부족');
  const bySym = new Map(); for (const t of T1) bySym.set(t.symbol, (bySym.get(t.symbol) || 0) + t.rNet);
  const top = [...bySym.entries()].sort((a, b) => b[1] - a[1]).slice(0, PREREG.topSymbolsRemoved).map(e => e[0]), rest = T1.filter(t => !top.includes(t.symbol)), sr = summary(rest);
  chk('상위 3종목 제외 후에도 기대값 > 0', sr.n && sr.avg > 0, `제외 ${top.join(',')} → 평균 ${f(sr.avg)}R (n=${sr.n})`);
  for (const m of PREREG.stress) { const ts = res.trades[m]?.[period]?.[variant]; if (ts) { const ss = summary(ts); chk(`비용 ${m}배 스트레스에서 기대값 > 0`, ss.n && ss.avg > 0, `평균 ${f(ss.avg)}R PF ${f(ss.pf, 2)}`); } }
  out.pass = out.checks.every(c => c.pass);
  return out;
}
