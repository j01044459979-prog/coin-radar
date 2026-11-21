import test from 'node:test';
import assert from 'node:assert/strict';
import { watchDecision } from '../watch-decision.mjs';
import { makeSpec, buildSvg, chartCaption } from '../chart.mjs';
import { compactReport, alertReport } from '../compact.mjs';

const NOW = Date.UTC(2026, 10, 21, 14, 2);
const wal = {
  symbol: 'WALUSDT', direction: 'WAIT', strong: false, trend: '상승',
  price: 0.02209, priceAt: NOW - 30000, collectedAt: NOW, atr: 0.0002,
  volume: 1.2, source: 'OKX USDT 무기한(SWAP)',
  mtf: { '15m': { dir: 'UP', arrow: '↑' },
    '1H': { dir: 'DOWN', arrow: '↓' }, '4H': { dir: 'FLAT', arrow: '→' } },
  candidate: {
    dir: 'LONG', score: 76.2, blockers: [],
    dist: { level: 0.0221, atrUnits: 0.05, pct: 0.05, broken: false },
    plan: { entry: 0.0221, stop: 0.0214, tp1: 0.0228, tp2: 0.0235,
      stopPct: 3.17, tp1Pct: 3.17, tp2Pct: 6.33, structureAhead: 0.02251 },
    unmet: ['고점 0.02210 돌파 확정 필요', '거래대금 1.20배 → 2배 필요'],
    risk: { level: '보통', points: 2, factors: ['1시간 추세와 역행'] },
    mtfConflict: true, missing: [],
  },
};
const candles = Array.from({length: 48}, (_,i) => {
  const p = 0.0233 - i * 0.000025;
  return { t: NOW - (48-i)*3600000, o:p+0.00005, c:p, h:p+0.00015,
    l:p-0.00015, q:50000, v:2000000 };
});
test('WAL 76.2점 롱 관찰: 1시간 역행이면 돌파 대기와 부족 조건만 보여준다', () => {
  const d = watchDecision(wal);
  assert.equal(d.action,'관망 · 추세 역행');
  assert.match(d.trigger,/5분봉 0\.02210 돌파 확정 확인/);
  assert.match(d.wait.join(' '),/1H 추세 역행 주의/);
  const spec = makeSpec(wal,'1H',candles,'candidate','근접 후보');
  assert.equal(spec.plan,null,'basic watch chart cannot expose simulated execution plan');
  const svg = buildSvg(spec);
  assert.match(svg,/돌파 확인선 0\.02210/);
  assert.match(svg,/1시간 구조 0\.02251/);
  assert.match(svg,/지금: 관망 · 추세 역행 · 진입 보류/);
  assert.match(svg,/진입·손절·익절 미산정/);
  assert.doesNotMatch(svg,/TP1|TP2|손절 0\.02140|진입 0\.02210|여기 돌파|<polygon /);
  const caption=chartCaption(spec);
  assert.match(caption,/지금: 관망 · 추세 역행/);
  assert.match(caption,/5분봉 0\.02210 돌파/);
  assert.doesNotMatch(caption,/0\.02140|0\.02280|0\.02350/);
  const report=compactReport([wal],[],NOW).plain;
  assert.match(report,/⛔ 지금: 관망 · 추세 역행 · 진입 보류/);
  assert.match(report,/거래대금 2배/);
  assert.doesNotMatch(report,/손절 0\.02140|목표 0\.02280|진입 기준 0\.02210/);
});
test('강한 관찰도 확정 진입 추천이 아니고 롱·숏 재확인 기준을 보여준다',()=>{
  for(const dir of ['LONG','SHORT']){
    const strong={...wal,strong:true,direction:dir,
      candidate:{...wal.candidate,dir,unmet:[],mtfConflict:false,dist:{...wal.candidate.dist,broken:true}}};
    const d=watchDecision(strong);
    assert.equal(d.action,dir==='LONG'?'재지지 대기':'재저항 대기');
    assert.match(d.trigger,dir==='LONG'?/재지지 확인/:/재저항 확인/);
    const msg=alertReport(strong,NOW).plain;
    assert.match(msg,/진입·손절·익절 미산정/);
    assert.doesNotMatch(msg,/TP1|TP2|손절 0\.02140/);
  }
});
test('필수 차단 발생 때는 진입 금지, 구조 기준 미확인이면 가격을 꾸미지 않는다',()=>{
  const blocked={...wal,candidate:{...wal.candidate,blockers:['BTC 15분 역행']}};
  assert.equal(watchDecision(blocked).action,'진입 금지');
  const missing={...wal,candidate:{...wal.candidate,dist:null}};
  assert.match(watchDecision(missing).trigger,/확인 불가/);
});
