// 후보 차트: 확정 캔들 + 조건부 참고 시나리오를 SVG로 그려 PNG로 변환한다. 외부 서비스·유료 API 없음.
// 렌더링 실패는 호출자가 격리한다(텍스트 보고는 항상 나간다). 차트의 한글은 fonts/의 Noto Sans KR 부분집합(OFL)을 쓴다.
import { checkPhrases, pickNear } from './scoring.mjs';
import { fmtPrice, priceDecimals } from './format.mjs';

const W = 1200, H = 760;
const X0 = 28, X1 = 936, Y0 = 150, Y1 = 626;   // 플롯 영역 (오른쪽은 가격 태그 영역)
const FONT = 'Noto Sans KR';
const C = { bg: '#0e1621', panel: '#131d2a', grid: '#1e2b3a', text: '#e8edf3', muted: '#93a1b3', up: '#2dd4bf', down: '#fb7185',
  entry: '#fbbf24', stop: '#ef4444', tp: '#4ade80', now: '#60a5fa', zone: '#fbbf24', struct: '#a78bfa' };
const TF_NAME = { '5m': '5분', '15m': '15분', '1H': '1시간', '4H': '4시간' };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kstTime = n => new Date(n).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(5, 16);
const kstFull = n => new Date(n).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16);
const dirKo = d => (d === 'LONG' ? '롱' : d === 'SHORT' ? '숏' : '시장');

// ── 차트 선택 규칙 ───────────────────────────────────────────
// 1) 강한 후보 1위 → 없으면 근접 후보 1위. 2) 강한 후보가 있고 BTC 시장 필터가 중립·약할 때만 BTC 4시간 차트 추가.
// 3) 후보가 없으면 BTC 4시간 시장 차트 1장. 시간봉: 후보 1시간(없으면 15분 → 5분), BTC 4시간.
const pickCandles = (chartData, symbol, prefer) => {
  for (const tf of prefer) { const c = chartData?.[symbol]?.[tf]; if (Array.isArray(c) && c.length >= 20) return { tf, candles: c, fallback: tf !== prefer[0] }; }
  return null;
};
// 후보 1개용 사양: 1시간봉 우선(없으면 15분 → 5분). 선택 이유를 reason에 남긴다.
export function candidateSpec(row, chartData, label) {
  const p = pickCandles(chartData, row.symbol, ['1H', '15m', '5m']);
  return p ? makeSpec(row, p.tf, p.candles, 'candidate', `${label} · 1시간봉 우선`, p.fallback) : { symbol: row.symbol, skipped: '차트용 캔들 없음' };
}
export function chartPlan(rows, chartData) {
  const specs = [];
  const strong = rows.filter(r => r.strong && r.candidate).sort((a, b) => b.candidate.score - a.candidate.score)[0];
  const top = strong ?? pickNear(rows, 1)[0];
  const btc = rows.find(r => r.symbol === 'BTCUSDT');
  if (top) {
    specs.push(candidateSpec(top, chartData, strong ? '강한 후보 1위' : '근접 후보 1위'));
    if (strong && btc && top.symbol !== 'BTCUSDT' && (top.candidate.parts?.btc?.score ?? 0) <= 7) {
      const b = pickCandles(chartData, 'BTCUSDT', ['4H', '1H']);
      if (b) specs.push(makeSpec(btc, b.tf, b.candles, 'market', 'BTC 시장 필터가 중립·약함 · 4시간봉', b.fallback));
    }
  } else if (btc) {
    const b = pickCandles(chartData, 'BTCUSDT', ['4H', '1H']);
    if (b) specs.push(makeSpec(btc, b.tf, b.candles, 'market', '후보 없음 · BTC 4시간 시장 차트', b.fallback));
  }
  return specs;
}

export function makeSpec(row, tf, candles, kind, reason, fallback = false) {
  const c = row.candidate;
  const market = kind === 'market';
  return {
    symbol: row.symbol, kind, tf, reason: reason + (fallback ? ' (요청 시간봉 없음 → 대체)' : ''),
    dir: market ? null : c?.dir ?? null, strong: Boolean(row.strong), score: c?.score ?? null, grade: row.grade ?? null,
    price: row.price, priceAt: row.priceAt, atr: row.atr, plan: market ? null : c?.plan ?? null, level: market ? null : c?.dist?.level ?? null,
    structureAhead: market ? null : c?.plan?.structureAhead ?? null, risk: c?.risk?.level ?? null, conflict: Boolean(c?.mtfConflict),
    checks: market ? [] : checkPhrases(row, c?.dir), mtf: row.mtf ?? null, trend: row.trend, collectedAt: row.collectedAt,
    source: row.source ?? 'OKX', candles: candles.slice(-48), marketLevels: market ? { r: row.mtf?.[tf]?.resistance?.slice(-2) ?? [], s: row.mtf?.[tf]?.support?.slice(-2) ?? [] } : null,
  };
}

// 캡션은 1~2줄. 시나리오 숫자는 이미지와 본문에 이미 있으므로 반복하지 않는다.
export function chartCaption(spec) {
  const head = spec.kind === 'market' ? `${spec.symbol} · 시장 기준 · ${spec.tf}봉` : `${spec.symbol} · ${dirKo(spec.dir)} 관찰 · ${spec.tf}봉`;
  return `${head}\n${spec.kind === 'market' ? '시장 참고 차트 · 매매 지시 아님' : '조건부 참고 시나리오 · 매매 지시 아님'}`;
}

// 가격 태그 겹침 방지: y 순서대로 최소 간격을 확보한다.
function spreadTags(tags, gap = 34, lo = Y0 + 4, hi = Y1 - 4) {
  const t = [...tags].sort((a, b) => a.y - b.y);
  for (let i = 0; i < t.length; i++) t[i].ty = Math.max(t[i].y, i ? t[i - 1].ty + gap : lo);
  for (let i = t.length - 1; i >= 0; i--) { t[i].ty = Math.min(t[i].ty, i < t.length - 1 ? t[i + 1].ty - gap : hi); }
  return t;
}

// 글자 폭 추정(한글·전각은 1em, 그 외 0.58em): 태그 박스가 글자보다 좁아지지 않게 한다.
const textW = (str, size) => [...String(str)].reduce((w, ch) => w + (ch.codePointAt(0) > 0x2e80 ? size : size * 0.58), 0);

export function buildSvg(spec) {
  const dec = priceDecimals(spec.price), fmt = v => fmtPrice(v, dec); // 가격 표시 자릿수는 자산 가격대에 맞추고 계산값은 바꾸지 않는다
  const candles = spec.candles, n = candles.length;
  const p = spec.plan;
  const levels = [spec.price];
  if (p) levels.push(p.entry, p.stop, p.tp1, p.tp2);
  if (spec.level != null) levels.push(spec.level);
  let hi0 = Math.max(...candles.map(c => c.h), ...levels), lo0 = Math.min(...candles.map(c => c.l), ...levels);
  // 1시간 구조선은 화면 범위 근처일 때만 그린다(멀면 차트가 납작해지므로 생략)
  const structure = spec.structureAhead != null && spec.structureAhead <= hi0 + (hi0 - lo0) * 0.12 && spec.structureAhead >= lo0 - (hi0 - lo0) * 0.12 ? spec.structureAhead : null;
  if (structure != null) { hi0 = Math.max(hi0, structure); lo0 = Math.min(lo0, structure); }
  const pad = (hi0 - lo0) * 0.07 || hi0 * 0.01;
  const hi = hi0 + pad, lo = lo0 - pad;
  const y = v => Y1 - ((v - lo) / (hi - lo)) * (Y1 - Y0);
  const GUTTER = 72;                                          // 왼쪽 가격 눈금 여백(캔들과 겹침 방지)
  const candleW = (X1 - X0 - GUTTER) * 0.74 / n;              // 오른쪽 26%는 시나리오 화살표 공간
  const xi = i => X0 + GUTTER + candleW * (i + 0.5);
  const xLast = xi(n - 1);
  const body = [];
  const add = s => body.push(s);
  const tfName = TF_NAME[spec.tf] ?? spec.tf;
  const market = spec.kind === 'market';
  const status = market ? `BTC ${tfName} 추세 ${spec.mtf?.[spec.tf]?.label ?? '미확인'}` : spec.strong ? '강한 관찰 조건 포착' : '조건 미완성';

  // 배경·헤더
  add(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);
  add(`<text x="${X0}" y="52" font-size="34" font-weight="700" fill="${C.text}">${esc(spec.symbol)}</text>`);
  add(`<text x="${X0 + 16 + spec.symbol.length * 25}" y="52" font-size="26" font-weight="700" fill="${spec.dir === 'LONG' ? C.tp : spec.dir === 'SHORT' ? C.down : C.muted}">${esc(market ? '시장 기준' : dirKo(spec.dir) + ' 관찰')}</text>`);
  add(`<text x="${X0}" y="88" font-size="22" fill="${C.muted}">${esc(tfName)}봉 · ${esc(status)}${spec.score != null ? ` · 점수 ${esc(spec.score)}/100 (승률 아님)` : ''}${spec.grade ? ` · ${esc(spec.grade)}` : ''}</text>`);
  const m = spec.mtf;
  const a = tf => m?.[tf]?.arrow ?? '?';
  add(`<text x="${W - 28}" y="52" font-size="22" text-anchor="end" fill="${C.text}">15분 ${a('15m')} / 1시간 ${a('1H')} / 4시간 ${a('4H')}</text>`);
  let chipX = X0;
  const chips = [...spec.checks, ...(spec.conflict ? ['상위 시간대 역행 주의'] : []), ...(spec.risk ? [`위험 ${spec.risk}`] : [])];
  chips.forEach((t, i) => {
    const w = 28 + textW(t, 18);
    const warn = /역행|위험 높음|과열/.test(t);
    add(`<rect x="${chipX}" y="${102}" width="${w}" height="36" rx="18" fill="${warn ? '#3b1d22' : '#1b2a3b'}" stroke="${warn ? C.stop : '#3a4f66'}"/>`);
    add(`<text x="${chipX + w / 2}" y="127" font-size="18" text-anchor="middle" fill="${warn ? '#fecaca' : C.text}">${esc(t)}</text>`);
    chipX += w + 10;
  });

  // 플롯 배경·격자·가격 눈금
  add(`<rect x="${X0}" y="${Y0}" width="${X1 - X0}" height="${Y1 - Y0}" fill="${C.panel}"/>`);
  for (let i = 0; i <= 5; i++) {
    if (i === 0 || i === 5) continue; // 가장자리 눈금은 헤더·시간축과 겹치므로 생략
    const v = lo + ((hi - lo) * i) / 5, yy = y(v);
    add(`<line x1="${X0}" x2="${X1}" y1="${yy}" y2="${yy}" stroke="${C.grid}" stroke-width="1"/>`);
    add(`<text x="${X0 + 4}" y="${yy - 5}" font-size="15" fill="${C.muted}" fill-opacity="0.85">${esc(fmt(v))}</text>`);
  }
  // 시간축
  const step = Math.max(1, Math.round(n / 6));
  for (let i = Math.min(2, n - 1); i < n; i += step) add(`<text x="${Math.min(Math.max(xi(i), X0 + 50), X1 - 60)}" y="${Y1 + 26}" font-size="16" text-anchor="middle" fill="${C.muted}">${esc(kstTime(candles[i].t))}</text>`);

  // 핵심 구간(박스): 진입 참고가 ± 구간
  let zone = null;
  if (p) {
    const half = Math.max(0.3 * (spec.atr || 0), p.entry * 0.0015);
    zone = { top: y(p.entry + half), bottom: y(p.entry - half) };
    add(`<rect x="${X0}" y="${zone.top}" width="${X1 - X0}" height="${zone.bottom - zone.top}" fill="${C.zone}" fill-opacity="0.13" stroke="${C.zone}" stroke-opacity="0.45" stroke-dasharray="6 5"/>`);
    const zy = (zone.top + zone.bottom) / 2;
    add(`<rect x="${X0 + 1}" y="${zy - 11}" width="64" height="22" rx="3" fill="${C.bg}" fill-opacity="0.85"/>`);
    add(`<text x="${X0 + 5}" y="${zy + 5}" font-size="14" font-weight="700" fill="${C.zone}">핵심 구간</text>`);
  }
  if (spec.marketLevels) {
    for (const v of spec.marketLevels.r) add(`<line x1="${X0}" x2="${X1}" y1="${y(v)}" y2="${y(v)}" stroke="${C.struct}" stroke-dasharray="4 6" opacity="0.8"/>`);
    for (const v of spec.marketLevels.s) add(`<line x1="${X0}" x2="${X1}" y1="${y(v)}" y2="${y(v)}" stroke="${C.struct}" stroke-dasharray="4 6" opacity="0.8"/>`);
  }
  if (structure != null) {
    add(`<line x1="${X0}" x2="${X1}" y1="${y(structure)}" y2="${y(structure)}" stroke="${C.struct}" stroke-dasharray="3 6" opacity="0.85"/>`);
    add(`<text x="${X1 - 8}" y="${y(structure) - 6}" text-anchor="end" font-size="16" fill="${C.struct}">1시간 구조 ${esc(fmt(structure))}</text>`);
  }

  // 캔들
  candles.forEach((c, i) => {
    const up = c.c >= c.o, col = up ? C.up : C.down, x = xi(i), bw = Math.max(2, candleW * 0.62);
    const top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c));
    add(`<line x1="${x}" x2="${x}" y1="${y(c.h)}" y2="${y(c.l)}" stroke="${col}" stroke-width="1.6"/>`);
    add(`<rect x="${x - bw / 2}" y="${top}" width="${bw}" height="${Math.max(1.5, bot - top)}" fill="${col}"/>`);
  });

  // 수평선: 진입·손절·TP·현재가
  const tags = [];
  const hline = (v, color, dash, width, label, id) => {
    add(`<line x1="${X0}" x2="${X1}" y1="${y(v)}" y2="${y(v)}" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
    tags.push({ y: y(v), color, label, id });
  };
  if (p) {
    const sg = spec.dir === 'LONG' ? ['+', '-'] : ['-', '+']; // 가격 변동 방향: 목표(수익 쪽), 손절(손실 쪽)
    hline(p.tp2, C.tp, '10 6', 2, `TP2 ${fmt(p.tp2)} (${sg[0]}${p.tp2Pct.toFixed(2)}%)`);
    hline(p.tp1, C.tp, '10 6', 2, `TP1 ${fmt(p.tp1)} (${sg[0]}${p.tp1Pct.toFixed(2)}%)`);
    hline(p.entry, C.entry, '14 6', 2.4, `진입 ${fmt(p.entry)}`);
    hline(p.stop, C.stop, null, 2.6, `손절 ${fmt(p.stop)} (${sg[1]}${p.stopPct.toFixed(2)}%)`);
  } else if (spec.level != null) {
    hline(spec.level, C.entry, '14 6', 2.4, `기준선 ${fmt(spec.level)}`);
  }
  add(`<line x1="${X0}" x2="${X1}" y1="${y(spec.price)}" y2="${y(spec.price)}" stroke="${C.now}" stroke-width="1.4" stroke-dasharray="2 4"/>`);
  tags.push({ y: y(spec.price), color: C.now, label: `현재 ${fmt(spec.price)}`, id: 'now' });
  for (const t of spreadTags(tags)) {
    const w = Math.min(textW(t.label, 17) + 18, W - X1 - 14);
    add(`<line x1="${X1}" x2="${X1 + 8}" y1="${t.y}" y2="${t.ty}" stroke="${t.color}" stroke-width="1.4"/>`);
    add(`<rect x="${X1 + 8}" y="${t.ty - 15}" width="${w}" height="30" rx="5" fill="${t.color}" fill-opacity="0.2" stroke="${t.color}" stroke-width="1.4"/>`);
    add(`<text x="${X1 + 17}" y="${t.ty + 6}" font-size="17" font-weight="700" fill="${t.color === C.stop ? '#fecaca' : t.color}">${esc(t.label)}</text>`);
  }

  // 시나리오 화살표(참고): 현재가 → 진입 구간(돌파/리테스트 확인) → TP1
  if (p) {
    const long = spec.dir === 'LONG';
    const xr = xLast + (X1 - xLast) * 0.42, xe = X1 - 22;
    const pathD = `M ${xLast} ${y(spec.price)} Q ${xLast + (xr - xLast) * 0.7} ${y(p.entry) + (long ? 14 : -14)} ${xr} ${y(p.entry)} T ${xe} ${y(p.tp1)}`;
    add(`<path d="${pathD}" fill="none" stroke="${C.entry}" stroke-width="3" stroke-dasharray="9 6" stroke-linecap="round"/>`);
    const ang = Math.atan2(y(p.tp1) - y(p.entry), xe - xr);
    const ax = xe, ay = y(p.tp1), s = 13;
    add(`<polygon points="${ax},${ay} ${ax - s * Math.cos(ang - 0.45)},${ay - s * Math.sin(ang - 0.45)} ${ax - s * Math.cos(ang + 0.45)},${ay - s * Math.sin(ang + 0.45)}" fill="${C.entry}"/>`);
    const above = long ? spec.price >= p.entry : spec.price <= p.entry;
    const note = long ? (above ? '여기 지지 확인 필요' : '여기 돌파 확인 필요') : (above ? '여기 저항 확인 필요' : '여기 이탈 확인 필요');
    const ny = zone ? (long ? zone.bottom + 22 : zone.top - 28) : y(p.entry) + 22;
    add(`<text x="${xr}" y="${ny}" font-size="19" font-weight="700" text-anchor="middle" fill="${C.entry}">${esc(note)}</text>`);
  }

  // 푸터
  add(`<rect x="0" y="${H - 96}" width="${W}" height="96" fill="#0a111a"/>`);
  add(`<text x="${X0}" y="${H - 62}" font-size="20" font-weight="700" fill="${C.entry}">조건부 참고 시나리오 · 매매 지시 아님</text>`);
  add(`<text x="${X0}" y="${H - 36}" font-size="17" fill="${C.muted}">${p ? '1R/2R 참고값 · 수수료·슬리피지·펀딩비 미반영 · 강제청산가 확인 불가' : '시나리오를 계산할 수 없어 기준 수준만 표시합니다'}</text>`);
  add(`<text x="${X0}" y="${H - 12}" font-size="16" fill="${C.muted}">${esc(spec.source)} (Binance 아님) · 마지막 확정봉 ${esc(kstFull(candles[n - 1].t))} KST · 분석 ${esc(kstFull(spec.collectedAt ?? spec.priceAt))} KST</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">${body.join('')}</svg>`;
}

// SVG → PNG. 의존성(@resvg/resvg-js)이나 글꼴이 없으면 예외를 던지며, 호출자가 텍스트 전용으로 계속 진행한다.
export async function renderPng(svg) {
  const { Resvg } = await import('@resvg/resvg-js');
  const font = name => decodeURIComponent(new URL(`./fonts/${name}`, import.meta.url).pathname);
  const resvg = new Resvg(svg, {
    font: { fontFiles: [font('NotoSansKR-Regular.subset.ttf'), font('NotoSansKR-Bold.subset.ttf')], loadSystemFonts: false, defaultFontFamily: FONT },
    fitTo: { mode: 'width', value: W },
  });
  return resvg.render().asPng();
}

export async function renderChart(spec) { return renderPng(buildSvg(spec)); }
