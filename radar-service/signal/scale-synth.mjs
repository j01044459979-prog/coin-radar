// 합성 가격 경로(결정적). 실제 시장이 아니라 분할 계획의 *메커니즘*(한도·체결 순서·비용)을 검증하기 위한 것이다.
// 전략 모양만 흉내: A형(추세 돌파) = 곧바로 진행하거나 실패, B형(눌림·재시험) = 먼저 되돌림(0.2~0.9R)을 주고 진행하거나 실패.
// 성공률은 인자로 받으며(기본 45%), 결과(R 합계)는 이 가정에 전적으로 좌우되므로 *성과의 증거로 쓰지 않는다*.
export const synthRng = seed => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
export function synthPath(kind, seed, { n = 260, base = 3000, vol = 0.0035, pWin = 0.45, stopDist = 0.012, signalAt = 4 } = {}) {
  const r = synthRng(seed), bars = [], win = r() < pWin, dip = kind === 'B' ? (0.2 + 0.7 * r()) * stopDist : 0, runLen = 14 + Math.floor(r() * 20);
  let px = base;
  for (let k = 0; k < n; k++) {
    const t = k - (signalAt + 1);                                                    // 신호 다음 봉(=진입 봉)이 t=0
    let drift = 0.0001;
    if (t >= 0) {
      const dipBars = kind === 'B' ? 4 : 0;
      if (t < dipBars) drift = -dip / dipBars;                                      // B형: 먼저 되돌림
      else if (t < dipBars + runLen) drift = win ? 0.0016 : -0.0014;                // 성공: 진행 / 실패: 반전
      else drift = (r() - 0.5) * 0.0008;
    }
    const o = px, c = o * (1 + drift + (r() - 0.5) * 2 * vol), h = Math.max(o, c) * (1 + r() * vol * 0.5), l = Math.min(o, c) * (1 - r() * vol * 0.5);
    bars.push({ t: k, o, h, l, c }); px = c;
  }
  return bars;
}
export function synthEvents({ count = 300, dirs = ['LONG', 'SHORT'], pWin = { A: 0.4, B: 0.5 }, stopDist = 0.012, seed0 = 1 } = {}) {
  const events = [];
  for (const strategy of ['A', 'B']) for (let s = 0; s < count; s++) {
    const dir = dirs[s % dirs.length], b = synthPath(strategy, seed0 + s * 13 + (strategy === 'B' ? 7 : 0), { pWin: pWin[strategy], stopDist });
    const bars = dir === 'LONG' ? b : b.map(x => ({ ...x, o: 6000 - x.o, c: 6000 - x.c, h: 6000 - x.l, l: 6000 - x.h }));                              // SHORT 는 가격 반전
    const entry = bars[5].o;
    events.push({ symbol: 'ETHUSDT', strategy, dir, bars, i: 4, stop: dir === 'LONG' ? entry * (1 - stopDist) : entry * (1 + stopDist) });
  }
  return events;
}
