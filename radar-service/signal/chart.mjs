// 신호 알림 이미지: 모바일 세로형 PNG 1장(실제 확정 15분봉 + 거래량 + 진입 관심가·손절·목표 1·2차).
// 기존 차트 렌더러(chart.mjs의 SVG→PNG, Noto Sans KR 부분집합 폰트, 색상·글자폭 도구)를 재사용하고 레이아웃만 세로형으로 새로 구성한다.
// 가격·거래량은 입력(확정 15분봉과 evaluateSignal 결과)만 쓴다. 값이 없으면 그리지 않으며 임의 값을 만들지 않는다. 렌더링 실패는 호출자가 텍스트 알림으로 대체한다.
import { C, esc, renderPng, textW } from '../chart.mjs';
import { fmtPrice, priceDecimals } from '../format.mjs';
import { baseName, signalDeadline } from './message.mjs';

export const SIGNAL_CHART = Object.freeze({ W: 1080, H: 1560, BARS: 56 });
const { W, H, BARS } = SIGNAL_CHART;
export const DIR_COLOR = Object.freeze({ LONG: '#22c55e', SHORT: '#ef4444' });
const kst = t => new Date(t + 9 * 3600000).toISOString().slice(11, 16);
const kstDate = t => new Date(t + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' ');
const signPct = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`;
const fmtQ = q => (q >= 1e8 ? `${(q / 1e8).toFixed(1)}억` : q >= 1e4 ? `${Math.round(q / 1e4)}만` : `${Math.round(q)}`);

// ── 3분할 진입 계획 보기 데이터(순수 함수) ──────────────────────────────────────────────────────────────
// plan 은 scale.mjs splanBuild 결과(= 텍스트 알림이 쓰는 것과 같은 계산). 검증을 통과하지 못하면 null → 기존 차트 그대로(임의 수치 생성 금지).
//  · 비중: 단계 수량 비율(내림 반영 후 실제 값)을 정수 %로 표시하되 합계가 정확히 100이 되게 최대잔여법으로 맞춘다.
//  · 배정 금액: 단계별 증거금(USDT) — 평가액 전체가 아니라 이 거래에 실제 배정되는 금액이다.
//  · 예상 평균 진입가: Σ(계획가×수량)/Σ수량 (수수료·슬리피지 가정 제외한 계획가 기준). 체결 슬리피지 가정은 증거금 계산에만 쓰인다.
export function planView(plan, ev) {
  try {
    if (!plan || plan.status !== 'ok' || plan.dir !== ev.dir || !Array.isArray(plan.stages) || !plan.stages.length || plan.stages.length > 3) return null;
    const L = ev.dir === 'LONG', st = plan.stages;
    if (!(Math.abs(plan.entry - ev.entry) < 1e-9 * Math.max(1, ev.entry)) || !(Math.abs(plan.stop - ev.stop) < 1e-9 * Math.max(1, ev.stop))) return null;
    const prices = st.map(x => x.price), qtys = st.map(x => x.qty), margins = st.map(x => x.margin);
    if (![...prices, ...qtys, ...margins].every(v => Number.isFinite(v) && v > 0)) return null;
    if (Math.abs(prices[0] - ev.entry) > 1e-9 * Math.max(1, ev.entry)) return null;                    // 1차 = 진입 관심가
    const seq = [...prices, ev.stop];
    for (let i = 1; i < seq.length; i++) if (!(L ? seq[i] < seq[i - 1] : seq[i] > seq[i - 1])) return null;   // LONG: 1차>2차>3차>손절, SHORT: 반대
    const tot = qtys.reduce((a, b) => a + b, 0), raw = qtys.map(q => q / tot * 100), pct = raw.map(Math.floor);
    let rest = 100 - pct.reduce((a, b) => a + b, 0);
    raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => { if (rest > 0) { pct[i]++; rest--; } });
    if (pct.reduce((a, b) => a + b, 0) !== 100) return null;
    const avg = prices.reduce((a, p, i) => a + p * qtys[i], 0) / tot;
    return { n: st.length, prices, qtys, pct, margins, totalMargin: margins.reduce((a, b) => a + b, 0), avg, lev: plan.lev, equity: plan.equity, degraded: plan.degraded || null, stop: ev.stop };
  } catch { return null; }
}
const fmtUsdt = v => (v >= 100 ? v.toFixed(1) : v.toFixed(2));

// 이미지에 쓰는 설명 3줄(4H 추세 / 1H 눌림목 / 15분 진입). 모두 evaluateSignal 결과에서 가져온다.
export function reasonRows(ev) {
  const L = ev.dir === 'LONG', dec = priceDecimals(ev.entry), f = v => fmtPrice(v, dec);
  return [
    { k: '4H 추세', v: `${L ? '상승' : '하락'} 추세 유지` },
    { k: '1H 눌림목', v: `${L ? '지지' : '저항'} ${f(ev.zone.lo)}~${f(ev.zone.hi)} 구간 눌림` },
    { k: '15분 진입', v: `확정 종가 ${f(ev.level)} ${L ? '돌파' : '이탈'} · 거래량 ×${ev.volRel.toFixed(1)}` },
  ];
}

// 텔레그램 사진 아래에 붙는 짧은 설명(2~3줄). 주문 권고·확률 표현 없음.
export function signalCaption(symbol, ev, opts = {}) {
  const dec = priceDecimals(ev.entry), f = v => fmtPrice(v, dec);
  const timing = signalDeadline(ev, opts.now);
  const score = Number.isFinite(ev.score) ? ` · 점수 ${Math.round(ev.score)}` : '';
  return [
    ...(opts.test ? [`[${TEST_BANNER}]`] : []),
    `${ev.dir === 'LONG' ? '🟢' : '🔴'} ${baseName(symbol)} ${ev.dir} · A급 진입 후보`,
    ...(ev.fib?.ok && ev.fib.fib ? [
      `📐 FIB 0.5~0.618 · ${f(ev.fib.fib.lo)}~${f(ev.fib.fib.hi)}`,
      `RSI14 1H ${Number(ev.fib.rsi1).toFixed(0)} · 15m ${Number(ev.fib.rsi15).toFixed(0)}`,
    ] : []),
    `💰 진입 관심가 ${f(ev.entry)}`,
    `🛑 손절 기준 ${f(ev.stop)} · 손절폭 ${ev.riskPct.toFixed(2)}%`,
    `🎯 1차 ${f(ev.t1.price)}${ev.t2 ? ` · 2차 ${f(ev.t2.price)}` : ''}`,
    `⚖️ 1차 순손익비 ${ev.t1.net.toFixed(2)}R(비용 후)${score}`,
    timing.deadlineLine,
    ...(timing.remainingLine ? [timing.remainingLine] : []),
    '⚠️ 기준가는 확정봉 종가 · 현시세 아님',
    '※ 미검증 · 주문 권고 아님',
    `※ 왕복 비용 ${ev.costPct.toFixed(2)}% 가정`,
  ].join('\n');
}
export function validateInputs(symbol, ev, c15) {
  if (!symbol || !ev || ev.status !== 'CANDIDATE' || !ev.t1) throw new Error('신호 이미지 입력 없음');
  if (!Array.isArray(c15) || c15.length < 20) throw new Error('15분봉 부족');
  const bars = c15.slice(-BARS);
  if (!bars.every(c => [c.h, c.l, c.c].every(Number.isFinite))) throw new Error('15분봉 값 오류');
  if (bars.at(-1).t !== ev.triggerT) throw new Error('트리거 봉 불일치');
  for (const v of [ev.entry, ev.stop, ev.t1.price]) if (!Number.isFinite(v)) throw new Error('가격 값 오류');
  return bars;
}

// 오른쪽 "3분할 진입 계획" 패널. 숫자는 크게(모바일 확대 없이 읽기), 색은 노랑(진입)·빨강(손절)·초록(목표) 세 가지 + 기본 글자색.
function drawPlanPanel(add, pv, ev, f, { PX, PW, T, B }) {
  const R = PX + PW - 16;
  add(`<rect x="${PX}" y="${T}" width="${PW}" height="${B - T}" rx="16" fill="${C.panel}" stroke="${C.grid}"/>`);
  add(`<text x="${PX + 18}" y="${T + 46}" font-size="32" font-weight="700" fill="${C.text}">3분할 진입 계획</text>`);
  add(`<text x="${PX + 18}" y="${T + 78}" font-size="20" fill="${C.muted}">예상 계획 · 실제 체결 아님</text>`);
  add(`<text x="${PX + 18}" y="${T + 104}" font-size="20" fill="${C.muted}">평가액 ${esc(String(Math.round(pv.equity)))} USDT 가정 · 격리 ${pv.lev}배${pv.degraded ? ` · ${esc(pv.degraded.replace('→', '→'))}단계` : ''}</text>`);
  const RH = 104, y0 = T + 120;
  for (let i = 0; i < pv.n; i++) {
    const yy = y0 + i * RH;
    add(`<line x1="${PX + 12}" x2="${PX + PW - 12}" y1="${yy}" y2="${yy}" stroke="${C.grid}"/>`);
    add(`<rect x="${PX + 16}" y="${yy + 12}" width="64" height="34" rx="12" fill="${C.entry}"/>`);
    add(`<text x="${PX + 48}" y="${yy + 37}" font-size="22" font-weight="700" text-anchor="middle" fill="#0e1621">${i + 1}차</text>`);
    add(`<text x="${PX + 94}" y="${yy + 38}" font-size="26" font-weight="700" fill="${C.text}">${pv.pct[i]}%</text>`);
    add(`<text x="${R}" y="${yy + 38}" font-size="26" font-weight="700" text-anchor="end" fill="${C.text}">${esc(fmtUsdt(pv.margins[i]))} USDT</text>`);
    add(`<text x="${PX + 16}" y="${yy + 86}" font-size="38" font-weight="700" fill="${C.entry}">${esc(f(pv.prices[i]))}</text>`);
  }
  let yy = y0 + pv.n * RH;
  add(`<line x1="${PX + 12}" x2="${PX + PW - 12}" y1="${yy}" y2="${yy}" stroke="${C.grid}"/>`);
  const items = [['예상 평균 진입가', f(pv.avg), C.entry], ['손절 기준', f(ev.stop), C.stop], ['1차 목표', f(ev.t1.price), C.tp], ...(ev.t2 ? [['2차 목표', f(ev.t2.price), C.tp]] : [])];
  const IH = Math.min(80, Math.floor((B - yy - 8) / items.length));
  items.forEach(([k, v, col], i) => {
    const y1 = yy + i * IH;
    add(`<text x="${PX + 18}" y="${y1 + 28}" font-size="20" fill="${C.muted}">${esc(k)}</text>`);
    add(`<text x="${PX + 18}" y="${y1 + 64}" font-size="34" font-weight="700" fill="${col}">${esc(v)}</text>`);
  });
  add(`<text x="${R}" y="${B - 16}" font-size="18" text-anchor="end" fill="${C.muted}">총 증거금 ${esc(fmtUsdt(pv.totalMargin))} USDT</text>`);
}

export const TEST_BANNER = '테스트 · 가상 데이터 · 매매 금지';
// opts.test: 연결 확인용 가상 신호임을 이미지 상단 띠와 차트 워터마크로 표시한다(운영 신호에는 쓰지 않는다).
export function buildSignalSvg(symbol, ev, c15, opts = {}) {
  const bars = validateInputs(symbol, ev, c15), n = bars.length;
  const L = ev.dir === 'LONG', accent = DIR_COLOR[ev.dir], dec = priceDecimals(ev.entry), f = v => fmtPrice(v, dec);
  const pv = opts.plan ? planView(opts.plan, ev) : null;                                       // 분할 계획이 없거나 검증 실패 → 기존 차트
  const levels = [ev.entry, ev.stop, ev.t1.price, ...(ev.t2 ? [ev.t2.price] : []), ...(pv ? pv.prices : [])];
  const hi0 = Math.max(...bars.map(c => c.h), ...levels), lo0 = Math.min(...bars.map(c => c.l), ...levels), pad = (hi0 - lo0) * 0.06 || hi0 * 0.01;
  const hi = hi0 + pad, lo = lo0 - pad;
  const X0 = 24, X1 = pv ? 560 : 800, XT = pv ? 570 : 812, PY0 = 330, PY1 = 960, VY0 = 984, VY1 = 1090, TY = 1118, GUT = 64;
  const y = v => PY1 - (v - lo) / (hi - lo) * (PY1 - PY0);
  const cw = (X1 - X0 - GUT) / (n + 3), xi = i => X0 + GUT + cw * (i + 0.5), bw = Math.max(4, cw * 0.62);
  const out = [], add = s => out.push(s);

  add(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);
  // 헤더: 종목·방향 배지·상태·시각
  add(`<text x="${X0}" y="76" font-size="58" font-weight="700" fill="${C.text}">${esc(baseName(symbol))}</text>`);
  const bx = X0 + 40 + textW(baseName(symbol), 58) * 1.02;
  add(`<rect x="${bx}" y="30" width="170" height="64" rx="32" fill="${accent}"/>`);
  add(`<text x="${bx + 85}" y="76" font-size="38" font-weight="700" text-anchor="middle" fill="#ffffff">${ev.dir}</text>`);
  add(`<text x="${W - X0}" y="62" font-size="30" font-weight="700" text-anchor="end" fill="${accent}">진입 후보</text>`);
  add(`<text x="${W - X0}" y="98" font-size="22" text-anchor="end" fill="${C.muted}">15분봉 확정 · OKX 선물</text>`);
  add(`<text x="${X0}" y="140" font-size="26" fill="${C.text}">생성 ${esc(kstDate(ev.triggerCloseT))} KST   유효 ~${esc(kst(ev.validUntil))} KST (${Math.round((ev.validUntil - ev.triggerCloseT) / 60000)}분)</text>`);
  // 핵심 수치 카드 3개: 손익비·손절폭·거래량
  const cards = [['손익비 (비용 반영)', `${ev.t1.net.toFixed(2)}R`, accent], ['손절폭', `${ev.riskPct.toFixed(2)}%`, C.text], ['거래량', `×${ev.volRel.toFixed(1)}`, C.text]];
  cards.forEach(([k, v, col], i) => {
    const cx = X0 + i * 349, cwid = 333;
    add(`<rect x="${cx}" y="168" width="${cwid}" height="118" rx="16" fill="${C.panel}" stroke="${C.grid}"/>`);
    add(`<text x="${cx + 20}" y="204" font-size="22" fill="${C.muted}">${esc(k)}</text>`);
    add(`<text x="${cx + 20}" y="262" font-size="52" font-weight="700" fill="${col}">${esc(v)}</text>`);
  });

  // 가격 패널
  add(`<rect x="${X0}" y="${PY0}" width="${X1 - X0}" height="${PY1 - PY0}" fill="${C.panel}"/>`);
  for (let i = 1; i <= 5; i++) { const v = lo + (hi - lo) * i / 6, yy = y(v); add(`<line x1="${X0}" x2="${X1}" y1="${yy}" y2="${yy}" stroke="${C.grid}"/>`); add(`<text x="${X0 + 4}" y="${yy - 5}" font-size="16" fill="${C.muted}" fill-opacity="0.85">${esc(f(v))}</text>`); }
  // 손실·이익 구간 음영(진입~손절, 진입~목표) — 트리거 봉 이후 영역
  const xT = xi(n - 1) - cw / 2, tpEnd = ev.t2 ? ev.t2.price : ev.t1.price;
  const box = (a, b, col) => { const y1 = Math.min(y(a), y(b)), y2 = Math.max(y(a), y(b)); add(`<rect x="${xT}" y="${y1}" width="${X1 - xT}" height="${y2 - y1}" fill="${col}" fill-opacity="0.13"/>`); };
  box(ev.entry, ev.stop, C.stop); box(ev.entry, tpEnd, C.tp);
  // 캔들
  for (let i = 0; i < n; i++) {
    const c = bars[i], o = Number.isFinite(c.o) ? c.o : c.c, up = c.c >= o, col = up ? C.up : C.down, x = xi(i), yt = y(Math.max(o, c.c)), yb = y(Math.min(o, c.c));
    add(`<line x1="${x}" x2="${x}" y1="${y(c.h)}" y2="${y(c.l)}" stroke="${col}" stroke-width="2"/>`);
    add(`<rect x="${x - bw / 2}" y="${yt}" width="${bw}" height="${Math.max(2, yb - yt)}" fill="${col}"/>`);
  }
  const xl = xi(n - 1);
  add(`<rect x="${xl - cw * 0.5}" y="${PY0}" width="${cw}" height="${PY1 - PY0}" fill="${accent}" fill-opacity="0.12"/>`);
  // 가격선(오른쪽까지 연장) + 오른쪽 태그(겹치면 간격 확보)
  const stageCol = C.entry;                                                                              // 진입선은 모두 같은 계열(노랑)
  const lines = pv
    ? [...(ev.t2 ? [{ key: '목표2', v: ev.t2.price, col: C.tp, dash: '10 6' }] : []), { key: '목표1', v: ev.t1.price, col: C.tp, dash: '10 6' },
      ...pv.prices.map((p, i) => ({ key: `${i + 1}차`, v: p, col: stageCol, dash: i ? '8 5' : '0' })), { key: '손절', v: ev.stop, col: C.stop, dash: '10 6' }].map(l => ({ ...l, y: y(l.v) }))
    : [...(ev.t2 ? [{ key: '2차 목표', v: ev.t2.price, col: C.tp, sub: `${signPct(ev.t2.pct)} · ${ev.t2.net.toFixed(2)}R`, dash: '10 6' }] : []),
      { key: '1차 목표', v: ev.t1.price, col: C.tp, sub: `${signPct(ev.t1.pct)} · ${ev.t1.net.toFixed(2)}R`, dash: '10 6' },
      { key: '진입 관심가', v: ev.entry, col: C.entry, sub: '확정 종가', dash: '0' },
      { key: '손절 기준', v: ev.stop, col: C.stop, sub: signPct((ev.stop - ev.entry) / ev.entry * 100), dash: '10 6' }].map(l => ({ ...l, y: y(l.v) }));
  lines.sort((a, b) => a.y - b.y);
  const GAP = pv ? 42 : 76;                                                                               // 가격이 가까워 겹치면 라벨을 위아래로 자동 분산
  for (let i = 0; i < lines.length; i++) lines[i].ty = Math.max(lines[i].y, i ? lines[i - 1].ty + GAP : PY0 + GAP / 2 + 4);
  for (let i = lines.length - 1; i >= 0; i--) lines[i].ty = Math.min(lines[i].ty, i < lines.length - 1 ? lines[i + 1].ty - GAP : PY1 - GAP / 2 - 4);
  for (const l of lines) {
    add(`<line x1="${X0}" x2="${X1}" y1="${l.y}" y2="${l.y}" stroke="${l.col}" stroke-width="2.5" stroke-dasharray="${l.dash}"/>`);
    add(`<line x1="${X1}" x2="${XT}" y1="${l.y}" y2="${l.ty}" stroke="${l.col}" stroke-width="1.5"/>`);
    if (pv) {                                                                                             // 짧은 라벨(숫자는 오른쪽 계획 패널에 크게)
      add(`<rect x="${XT}" y="${l.ty - 18}" width="76" height="36" rx="10" fill="${l.col}"/>`);
      add(`<text x="${XT + 38}" y="${l.ty + 8}" font-size="22" font-weight="700" text-anchor="middle" fill="#0e1621">${esc(l.key)}</text>`);
    } else {
      add(`<rect x="${XT}" y="${l.ty - 33}" width="${W - XT - 14}" height="66" rx="10" fill="${C.bg}" stroke="${l.col}" stroke-width="2"/>`);
      add(`<text x="${XT + 12}" y="${l.ty - 6}" font-size="20" fill="${l.col}">${esc(l.key)}</text>`);
      add(`<text x="${XT + 12}" y="${l.ty + 22}" font-size="24" font-weight="700" fill="${C.text}">${esc(f(l.v))}</text>`);
      add(`<text x="${W - 26}" y="${l.ty + 22}" font-size="17" text-anchor="end" fill="${C.muted}">${esc(l.sub)}</text>`);
    }
  }
  if (pv) drawPlanPanel(add, pv, ev, f, { PX: 654, PW: W - 654 - 24, T: PY0, B: TY - 14 });
  // 거래량 패널(확정 봉 거래대금 q가 모두 있을 때만)
  add(`<rect x="${X0}" y="${VY0}" width="${X1 - X0}" height="${VY1 - VY0}" fill="${C.panel}"/>`);
  if (bars.every(c => Number.isFinite(c.q) && c.q >= 0)) {
    const mq = Math.max(...bars.map(c => c.q)) || 1;
    for (let i = 0; i < n; i++) { const c = bars[i], o = Number.isFinite(c.o) ? c.o : c.c, h = (c.q / mq) * (VY1 - VY0 - 24); add(`<rect x="${xi(i) - bw / 2}" y="${VY1 - h}" width="${bw}" height="${h}" fill="${c.c >= o ? C.up : C.down}" fill-opacity="${i === n - 1 ? 1 : 0.55}"/>`); }
    add(`<text x="${X0 + 8}" y="${VY0 + 24}" font-size="18" fill="${C.muted}">거래대금(USDT) · 최대 ${esc(fmtQ(mq))} · 트리거 봉 ${esc(fmtQ(bars.at(-1).q))}</text>`);
  } else add(`<text x="${X0 + 8}" y="${VY0 + 30}" font-size="18" fill="${C.muted}">거래량 데이터 없음</text>`);
  const step = Math.round(n / 5);
  for (let i = 2; i < n; i += step) add(`<text x="${Math.min(Math.max(xi(i), X0 + 40), X1 - 40)}" y="${TY}" font-size="18" text-anchor="middle" fill="${C.muted}">${esc(kst(bars[i].t))}</text>`);
  add(`<text x="${XT}" y="${TY}" font-size="18" fill="${C.muted}">${pv ? 'KST' : `KST · 15분봉 ${n}개`}</text>`);

  // 진입 근거 3줄
  add(`<text x="${X0}" y="1176" font-size="30" font-weight="700" fill="${C.text}">진입 근거</text>`);
  reasonRows(ev).forEach((r, i) => {
    const yy = 1190 + i * 82;
    add(`<rect x="${X0}" y="${yy}" width="${W - 2 * X0}" height="68" rx="14" fill="${C.panel}" stroke="${C.grid}"/>`);
    add(`<rect x="${X0}" y="${yy}" width="8" height="68" rx="4" fill="${accent}"/>`);
    add(`<text x="${X0 + 28}" y="${yy + 43}" font-size="26" font-weight="700" fill="${accent}">${esc(r.k)}</text>`);
    add(`<text x="${X0 + 220}" y="${yy + 43}" font-size="26" fill="${C.text}">${esc(r.v)}</text>`);
  });
  // 위험·무효화·면책
  add(`<text x="${X0}" y="1472" font-size="24" fill="${C.text}">무효화: 15분 종가 ${esc(f(ev.stop))} ${L ? '하향' : '상향'} 이탈 또는 유효시간 경과</text>`);
  add(`<text x="${X0}" y="1512" font-size="21" fill="${C.muted}">판단 보조용 · 주문 권고 아님 · 백테스트로 우위 미검증 · 왕복 비용 ${ev.costPct.toFixed(2)}% 가정</text>`);
  if (pv) add(`<text x="${X0}" y="1546" font-size="19" fill="${C.muted}">3분할은 예상 계획(실제 체결 아님) · 계획가 기준, 수수료·슬리피지 제외</text>`);
  if (opts.test) {
    add(`<rect x="0" y="0" width="${W}" height="28" fill="#b91c1c"/><text x="${W / 2}" y="22" font-size="21" font-weight="700" text-anchor="middle" fill="#ffffff">${esc(TEST_BANNER)}</text>`);
    add(`<text x="${(X0 + X1) / 2}" y="${(PY0 + PY1) / 2}" font-size="60" font-weight="700" text-anchor="middle" fill="#ffffff" fill-opacity="0.14" transform="rotate(-24 ${(X0 + X1) / 2} ${(PY0 + PY1) / 2})">${esc(TEST_BANNER)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`;
}

export async function renderSignalChart(symbol, ev, c15, opts = {}) { return renderPng(buildSignalSvg(symbol, ev, c15, opts), W); }
