// 신호 생성 단계별 탈락 분석(순수 함수, 읽기 전용). 운영과 같은 분석·판정 코드(analyzeCoin + evaluateSignal)를 15분봉 한 봉씩 흘려보내며 막힘 원인을 센다.
// 단위는 '종목-15분봉'이다(같은 상태가 여러 봉 이어지므로 이벤트 수가 아니다). 단일 막힘(sole)은 그 조건 하나만 풀면 후보가 되었을 봉 수 — 어느 조건이 가장 빡빡한지 보는 지표이며, 기준을 낮추라는 뜻이 아니다.
import { analyzeCoin } from '../opportunity/analysis.mjs';
import { H1, H4 } from '../opportunity/indicators.mjs';
import { buildFrames, SBT } from './backtest.mjs';
import { evaluateSignal, M15, SIG } from './evaluate.mjs';

const TAGS = ['trigger', 'structure', 'zone', 'chase', 'stop', 'spike', 'volume', 'target'];
export const blankFunnel = () => ({ bars: 0, data: 0, stage0: 0, stage1: 0, ctx: 0, wait: {}, observe: 0, candidate: 0, tag: Object.fromEntries(TAGS.map(t => [t, 0])), sole: Object.fromEntries(TAGS.map(t => [t, 0])), trigOk: 0 });
export const mergeFunnel = (x, y) => { const o = blankFunnel(); for (const k of ['bars', 'data', 'stage0', 'stage1', 'ctx', 'observe', 'candidate', 'trigOk']) o[k] = x[k] + y[k]; for (const t of TAGS) { o.tag[t] = x.tag[t] + y.tag[t]; o.sole[t] = x.sole[t] + y.sole[t]; } for (const k of new Set([...Object.keys(x.wait), ...Object.keys(y.wait)])) o.wait[k] = (x.wait[k] || 0) + (y.wait[k] || 0); return o; };
const waitKey = why => (/15분봉 부족|누락/.test(why) ? '15분봉 데이터' : /지연/.test(why) ? '지연(20분 초과)' : /마감 전|오래됨/.test(why) ? '15분봉 시점' : /손절 기준을 이탈/.test(why) ? '이미 손절 이탈' : why.slice(0, 20));

export function funnelCoin(c15, btc15 = null, { from = SBT.warm15, minRR = SBT.minRR, validMin = SBT.validMin } = {}) {
  const { c1h, c4h } = buildFrames(c15), btc4 = btc15 ? buildFrames(btc15).c4h : null, f = blankFunnel();
  let p1 = 0, p4 = 0, pb = 0, cacheKey = -1, a = null;
  for (let i = from; i < c15.length - 1; i++) {
    const closeT = c15[i].t + M15, now = closeT + 60000;
    while (p1 < c1h.length && c1h[p1].t + H1 <= closeT) p1++;
    while (p4 < c4h.length && c4h[p4].t + H4 <= closeT) p4++;
    while (btc4 && pb < btc4.length && btc4[pb].t + H4 <= closeT) pb++;
    if (p1 < 100 || p4 < 210) continue;
    if (p1 !== cacheKey) { a = analyzeCoin(c1h.slice(Math.max(0, p1 - SBT.win1h), p1), c4h.slice(Math.max(0, p4 - SBT.win4h), p4), btc4 ? btc4.slice(Math.max(0, pb - SBT.win4h), pb) : null); cacheKey = p1; }
    f.bars++;
    if (a.status !== 'ok') { f.data++; continue; }
    if (a.stage < 2) { a.stage === 1 ? f.stage1++ : f.stage0++; continue; }
    f.ctx++;
    const win = c15.slice(Math.max(0, i - SBT.win15 + 1), i + 1), ev = evaluateSignal({ a, c15: win, now }, { minRR, validMin });
    if (ev.status === 'CANDIDATE') { f.candidate++; f.trigOk++; continue; }
    if (ev.status === 'WAIT') { const k = waitKey(ev.why); f.wait[k] = (f.wait[k] || 0) + 1; continue; }
    f.observe++; if (!ev.tags.includes('trigger')) f.trigOk++;
    for (const t of new Set(ev.tags)) f.tag[t]++;
    if (new Set(ev.tags).size === 1) f.sole[ev.tags[0]]++;
  }
  return f;
}

// 실행 간격이 불규칙할 때 '진입 후보'를 알릴 수 있는 비율. 트리거 봉이 마감된 뒤 lateMin(20분) 안에 실행이 한 번이라도 있어야 알린다 → 실행 간격 g분이면 min(1, 20/g).
// gaps: 실제 실행 간격(분) 목록이면 시간 가중 평균(긴 공백에 떨어질 확률이 더 크다) sum(min(g,20))/sum(g).
export const captureRate = (gapMin, lateMin = SIG.lateMin) => Math.min(1, lateMin / gapMin);
export const captureFromGaps = (gaps, lateMin = SIG.lateMin) => { const tot = gaps.reduce((x, y) => x + y, 0); return tot > 0 ? gaps.reduce((x, y) => x + Math.min(y, lateMin), 0) / tot : null; };
