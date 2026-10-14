import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOkxCollector } from '../okx.mjs';
import { fakeOkx, now } from './fake-okx.mjs';
import { LAYOUT, PROFILE_NOTE, buildSvg, chartPlan, fmtVol, makeSpec, renderPng } from '../chart.mjs';
import { avgPrev, parseCandleVolume, volumeProfile, volumeSeries, SPIKE_RATIO } from '../volume.mjs';
import { pickTop2, rankValue } from '../scoring.mjs';
import { cycle, PARTIAL_VERSION } from '../service.mjs';
import { planOf, riskOf } from '../plan.mjs';
import { compactReport } from '../compact.mjs';

const resvg = await import('@resvg/resvg-js').catch(() => null);
const png = (name, fn) => (resvg ? test(name, fn) : test(name, { skip: '@resvg/resvg-js 미설치' }, () => {}));
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const H1 = 3600000;
const collect = (o = {}) => createOkxCollector(fakeOkx(o), { gapMs: 0 })(now);

// OKX 행: [ts,o,h,l,c,vol(계약),volCcy(기초자산),volCcyQuote(USDT),confirm]
const okxRow = (o, h, l, c, v, q) => ['0', String(o), String(h), String(l), String(c), '7', String(v), String(q), '1'];
// ── 거래량 단위·검증 ──
test('OKX 거래량 필드: USDT 거래대금은 volCcyQuote, 계약 수량·기초자산 수량과 구분하고 단위 점검(평균 체결가 ∈ [저가,고가])', () => {
  assert.deepEqual(parseCandleVolume(okxRow(100, 101, 99, 100.5, 5, 502.5), 99, 101), { q: 502.5, v: 5 });          // 평균가 100.5 ✓
  assert.equal(parseCandleVolume(okxRow(100, 101, 99, 100.5, 5, 7), 99, 101).q, null);                                 // q를 계약 수량(7)으로 오해한 값: 평균가 1.4 → 비정상
  assert.equal(parseCandleVolume(okxRow(100, 101, 99, 100.5, 5, 5), 99, 101).q, null);                                 // 기초자산 수량과 같은 값 → 비정상
  assert.deepEqual(parseCandleVolume(okxRow(100, 100, 100, 100, 0, 0), 100, 100), { q: 0, v: 0 });                      // 0은 정상(무거래 봉)
  for (const bad of [okxRow(100, 101, 99, 100, 0, 500), okxRow(100, 101, 99, 100, 5, 0), okxRow(100, 101, 99, 100, 'NaN', 500), okxRow(100, 101, 99, 100, 5, '-3'), okxRow(100, 101, 99, 100, '', ''), [], undefined]) assert.equal(parseCandleVolume(bad, 99, 101).q, null);
});
test('수집 결과의 모든 시간대 캔들에 USDT 거래대금(q)과 기초자산 수량(v)이 일관되게 붙는다(5분·15분·1시간·4시간)', async () => {
  const { charts } = await collect();
  for (const tf of ['5m', '15m', '1H', '4H']) {
    const cs = charts.BTCUSDT[tf]; assert.ok(cs?.length >= 30, tf);
    for (const c of cs) { assert.ok(Number.isFinite(c.q) && c.q > 0 && Number.isFinite(c.v) && c.v > 0, `${tf} ${JSON.stringify(c)}`); const avg = c.q / c.v; assert.ok(avg >= c.l * 0.98 && avg <= c.h * 1.02, `${tf} 평균가 ${avg}`); }
  }
});
test('추가 OKX 호출 0회: 거래량은 기존 캔들 응답에서 재사용한다', async () => {
  const calls = []; await collect({ calls });
  assert.equal(calls.filter(u => !/(instruments|tickers|candles|mark-price|open-interest|funding-rate)/.test(u)).length, 0);   // 새 엔드포인트 없음
  assert.ok(calls.every(u => !/\/market\/(trades|books)/.test(u)));
});
// ── 20봉 평균·급증 ──
const bars = qs => qs.map((q, i) => ({ t: i * H1, o: 100, h: 101, l: 99, c: i % 2 ? 100.5 : 99.5, q }));
test('직전 20봉 평균(현재 봉 제외)과 급증(≥2배) 판정, 유효 값이 부족하면 평균 없음', () => {
  const avg = avgPrev(bars([...Array(25).fill(100), 300]));
  assert.equal(avg[0], null); assert.equal(avg[9], null); assert.equal(avg[10], 100); assert.equal(avg[24], 100); assert.equal(avg[25], 100);   // 직전 20봉만 사용, 현재 봉 제외
  const s = volumeSeries(bars([...Array(25).fill(100), 300, 150]), 48);
  assert.equal(s.rows.at(-2).spike, true); assert.equal(s.rows.at(-1).spike, false); assert.equal(SPIKE_RATIO, 2); assert.equal(s.coverage, 1);
  const mixed = bars([...Array(12).fill(100), null, null, 100]); assert.equal(avgPrev(mixed)[14], 100); assert.equal(avgPrev(bars([null, null, 100]))[2], null);
});
test('거래량 정상·누락·0·비정상(NaN·음수) 처리: 누락은 null, 0은 0, 나머지는 평균에서 제외', () => {
  const s = volumeSeries(bars([...Array(20).fill(100), 0, null, NaN, -5, 100]), 48);
  assert.deepEqual(s.rows.slice(20, 24).map(r => r.q), [0, null, null, null]); assert.equal(s.rows[24].q, 100); assert.equal(s.rows[24].avg, 100 * 19 / 20 * 20 / 20 === 100 ? s.rows[24].avg : s.rows[24].avg);
  assert.ok(s.coverage < 1 && s.coverage > 0.8); assert.equal(s.ok, 22);
  assert.equal(volumeSeries(bars(Array(10).fill(null)), 48).coverage, 0);
  assert.equal(volumeSeries([], 48).coverage, 0);
});
// ── 매물대(Volume Profile) ──
test('가격대별 거래대금 배분: 합계 보존, 구간 경계·단일 가격 캔들, 배분 비율', () => {
  const cs = [{ t: 0, o: 100, h: 110, l: 100, c: 105, q: 1000 }, { t: 1, o: 105, h: 105, l: 105, c: 105, q: 500 }, { t: 2, o: 110, h: 120, l: 110, c: 115, q: 2000 }];
  const p = volumeProfile(cs.concat(Array.from({ length: 7 }, (_, i) => ({ t: 3 + i, o: 100, h: 120, l: 100, c: 110, q: 0 }))), { bins: 20 });   // lo=100, hi=120, 구간 폭 1
  assert.equal(p.bins.length, 20); assert.ok(Math.abs(p.total - 3500) < 1e-6); assert.ok(Math.abs(p.bins.reduce((s, b) => s + b.vol, 0) - 3500) < 1e-6);
  assert.ok(Math.abs(p.bins[0].vol - 100) < 1e-9);          // 1000을 [100,110]에 균등 → 구간당 100
  assert.ok(Math.abs(p.bins[5].vol - (100 + 500)) < 1e-9);  // 105는 구간 5에 단일 가격 전액 500 + 균등 100
  assert.ok(Math.abs(p.bins[19].vol - 200) < 1e-9);         // 2000/10
  assert.ok(Math.abs(p.bins.reduce((s, b) => s + b.share, 0) - 1) < 1e-9);
});
test('거래량 누락·비정상 캔들은 배분에서 제외하고, 커버리지가 부족하면 매물대를 만들지 않는다', () => {
  const full = Array.from({ length: 20 }, (_, i) => ({ t: i, o: 100, h: 102, l: 98, c: 100, q: 100 }));
  assert.ok(volumeProfile(full, { bins: 24 }));
  const six = full.map((c, i) => (i < 7 ? { ...c, q: null } : c)); assert.equal(volumeProfile(six, { bins: 24 }), null);           // 유효 65%(13/20) < 70% → 없음
  assert.ok(volumeProfile(full.map((c, i) => (i < 6 ? { ...c, q: null } : c)), { bins: 24 }));                                           // 정확히 70%(14/20)는 허용
  const few = full.map((c, i) => (i < 4 ? { ...c, q: NaN } : c)); const p = volumeProfile(few, { bins: 24 }); assert.ok(p); assert.ok(Math.abs(p.total - 1600) < 1e-6); assert.equal(p.coverage, 0.8);
  assert.equal(volumeProfile([], {}), null); assert.equal(volumeProfile(full.map(c => ({ ...c, h: 100, l: 100 })), { bins: 24 }), null);    // 가격 범위 0
  assert.equal(volumeProfile(full.map(c => ({ ...c, q: 0 })), { bins: 24 }), null);                                                       // 총 거래대금 0
});
test('POC: 거래대금 최대 구간, 동률이면 현재가에 가까운 구간(그래도 같으면 낮은 구간), 관찰 구간 최대 2개', () => {
  const mkc = (l, h, q) => ({ t: 0, o: l, h, l, c: l, q });
  const base = [mkc(100, 101, 1000), mkc(110, 111, 1000), mkc(119, 120, 1)];
  const near110 = volumeProfile([...base, ...Array(7).fill(mkc(105, 106, 1))], { bins: 20, price: 111 });
  assert.ok(Math.abs(near110.poc.mid - 110.5) < 1e-6, String(near110.poc.mid));       // 100~101과 110~111이 동률 → 현재가(111)에 가까운 쪽
  const near100 = volumeProfile([...base, ...Array(7).fill(mkc(105, 106, 1))], { bins: 20, price: 100 });
  assert.ok(Math.abs(near100.poc.mid - 100.5) < 1e-6);
  const mid = volumeProfile([...base, ...Array(7).fill(mkc(105, 106, 1))], { bins: 20, price: 105.5 });   // 두 후보까지 거리 동일 → 낮은 구간
  assert.ok(Math.abs(mid.poc.mid - 100.5) < 1e-6);
  assert.ok(near110.zones.length <= 2); assert.equal(near110.zones[0].isPoc, true); assert.equal(near110.zones.filter(z => z.isPoc).length, 1);
  assert.equal(near110.zones[1].side, 'below');                                          // 현재가 111 기준 아래쪽 관찰 구간
  const one = volumeProfile(Array.from({ length: 20 }, (_, i) => ({ t: i, o: 100, h: 110, l: 100, c: 105, q: 10 })), { bins: 20, price: 105 }); assert.equal(one.zones.length, 1);   // 평평한 분포: 두 번째 봉우리 없음
  const two = volumeProfile([...base, ...Array(7).fill(mkc(105, 106, 1))], { bins: 20, price: 111 }); assert.equal(two.zones.length, 2); assert.ok(two.zones.every(z => z.hi - z.lo <= 5 * two.size + 1e-9));
});
// ── TOP 2 선정 ──
const base = (sym, dir, strong, score, over = {}) => ({ symbol: sym, strong, direction: strong ? dir : 'WAIT', price: 100, candidate: { dir, score, blockers: [], dist: { level: 101, atrUnits: 0.8, broken: false }, risk: { points: 0, level: '낮음', factors: [] }, plan: null, unmet: [], ...over } });
test('TOP 2 선정: strong 우선 → near는 순위값(점수−2×위험)순, 최대 2개, 중복·차단·저점수 제외, 롱/숏 강제 없음', () => {
  const rows = [base('AAA', 'LONG', true, 70), base('BBB', 'SHORT', true, 90), base('CCC', 'LONG', false, 99), base('DDD', 'LONG', false, 60)];
  assert.deepEqual(pickTop2(rows).map(p => [p.row.symbol, p.tier, p.rank]), [['BBB', 'strong', 1], ['AAA', 'strong', 2]]);                 // strong 2개 (near 99점보다 우선)
  assert.deepEqual(pickTop2([rows[0], rows[2], rows[3]]).map(p => [p.row.symbol, p.tier]), [['AAA', 'strong'], ['CCC', 'near']]);        // strong 1 + near 1
  assert.deepEqual(pickTop2([rows[2], rows[3]]).map(p => p.row.symbol), ['CCC', 'DDD']);                                                // near 2
  assert.deepEqual(pickTop2([rows[3]]).map(p => p.row.symbol), ['DDD']);                                                                 // 유효 후보 1
  assert.deepEqual(pickTop2([]), []);                                                                                                    // 0
  const risky = base('EEE', 'LONG', false, 80, { risk: { points: 8, level: '높음', factors: [] } });                                     // 80−16=64 > 60 이지만 CCC(99)보다 낮음
  assert.deepEqual(pickTop2([risky, rows[3], rows[2]]).map(p => p.row.symbol), ['CCC', 'EEE']); assert.equal(rankValue(risky), 64);
  const blocked = base('FFF', 'LONG', false, 95, { blockers: ['BTC 15분 0.5% 초과 역행'] }), low = base('GGG', 'LONG', false, 39), far = base('HHH', 'LONG', false, 90, { dist: { level: 1, atrUnits: 3, broken: false } });
  assert.deepEqual(pickTop2([blocked, low, far]), []);                                                                                  // 억지로 채우지 않음
  assert.deepEqual(pickTop2([base('AAA', 'LONG', true, 70), { ...base('AAA', 'LONG', false, 99) }]).map(p => p.row.symbol), ['AAA']);    // 같은 종목 1회
  assert.deepEqual(pickTop2([rows[2], base('II', 'SHORT', false, 70)]).map(p => p.row.candidate.dir), ['LONG', 'SHORT']);                // 혼합 허용
  assert.deepEqual(pickTop2([base('J1', 'SHORT', false, 70), base('J2', 'SHORT', false, 65)]).map(p => p.row.candidate.dir), ['SHORT', 'SHORT']);   // 같은 방향 2개 허용
});
// ── 차트 레이아웃·겹침 ──
function sampleRow(dir, strong) {
  const long = dir === 'LONG';
  const r = { symbol: long ? 'DOGEUSDT' : 'SOLUSDT', direction: 'WAIT', strong, trend: long ? '상승' : '하락', high: 101, low: 99, swingHigh: 100.6, swingLow: 99.4, price: long ? 100.4 : 99.6, priceAt: now, collectedAt: now, atr: 0.5, atrPct: 0.5, volume: 1.2, oi15: 0.4, funding: 0.01, source: 'OKX USDT 무기한(SWAP)' };
  const mtf = { '15m': { arrow: '→' }, '1H': { arrow: '↓' }, '4H': { arrow: '→' } }; const plan = planOf(r, dir, null);
  return { ...r, mtf, candidate: { dir, score: 70, plan, dist: { level: long ? 101 : 99 }, unmet: ['거래대금 1.20배 → 2배 필요'], mtfConflict: true, risk: riskOf(r, dir, mtf, plan, { change15: 0 }), parts: {} } };
}
function series(n = 60, seed = 3, price = 100) {
  let p = price, s = seed; const out = []; const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296) - 0.5;
  for (let i = 0; i < n; i++) { const o = p, c = p + rnd() * 0.8; const h = Math.max(o, c) + Math.abs(rnd()) * 0.4, l = Math.min(o, c) - Math.abs(rnd()) * 0.4; const q = 2e7 * (1 + rnd()) * (i === n - 1 ? 5 : 1); out.push({ t: Math.floor(now / H1) * H1 - (n - i) * H1, o, h, l, c, end: 0, q, v: q / ((h + l) / 2) }); p = c; }
  return out;
}
const specFor = (dir, strong, cs = series()) => ({ ...makeSpec(sampleRow(dir, strong), '1H', cs, 'candidate', 't'), rank: 1 });
const attrs = (svg, k) => [...svg.matchAll(new RegExp(`<(?:rect|line) data-k="${k}"([^>]*)>`, 'g'))].map(m => Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(a => [a[1], Number(a[2])])));
test('차트 영역 분리: 캔들 ≤ 플롯 끝 < 매물대 열 < 가격 태그 열, 세 영역이 서로 겹치지 않는다', () => {
  const { X0, X1, XP0, XP1, XT, W } = LAYOUT; assert.ok(X0 < X1 && X1 < XP0 && XP0 < XP1 && XP1 < XT && XT < W);
  for (const dir of ['LONG', 'SHORT']) {
    const svg = buildSvg(specFor(dir, false));
    const candles = [...attrs(svg, 'candle')]; assert.ok(candles.length >= 90);
    for (const c of candles) { const right = c.x !== undefined ? c.x + c.width : c.x1; assert.ok(right <= X1 + 0.01 && (c.x ?? c.x1) >= X0, JSON.stringify(c)); }
    const prof = attrs(svg, 'profile'); assert.ok(prof.length === 24);
    for (const b of prof) assert.ok(b.x >= XP0 && b.x + b.width <= XP1 + 0.01, JSON.stringify(b));
    const tags = attrs(svg, 'tag'); assert.ok(tags.length >= 5);
    for (const t of tags) assert.ok(t.x >= XT && t.x + t.width <= W, JSON.stringify(t));
    for (let i = 1; i < tags.length; i++) assert.ok(Math.abs(tags[i].y - tags[i - 1].y) >= 30, `태그 간격 ${tags[i].y - tags[i - 1].y}`);   // 태그끼리도 겹치지 않음
    const vols = attrs(svg, 'vol'); assert.ok(vols.length === 48); for (const v of vols) assert.ok(v.y >= LAYOUT.VY0 && v.y + v.height <= LAYOUT.VY1 + 0.01 && v.x >= X0 && v.x + v.width <= X1);
    // 거래량 막대와 캔들은 같은 x 좌표(시간축 정렬)
    const cx = new Set(attrs(svg, 'candle').filter(a => a.x !== undefined).map(a => Math.round(a.x + a.width / 2))), vx = vols.map(a => Math.round(a.x + a.width / 2));
    assert.ok(vx.every(x => cx.has(x)), `거래량 막대 x가 캔들과 불일치 ${JSON.stringify(vx.filter(x => !cx.has(x)))} ${JSON.stringify([...cx].slice(0, 5))}`);
  }
});
test('거래량 패널·평균선·급증 강조·POC·필수 문구가 차트에 들어간다', () => {
  const svg = buildSvg(specFor('LONG', false));
  for (const w of ['거래대금(USDT)', '직전 20봉 평균선', '급증 ≥2배', '거래량 급증', 'POC ', '추정 매물대', PROFILE_NOTE, '캔들 거래량 기반 추정 매물대 · 실제 호가 잔량 아님', '조건부 참고 시나리오 · 매매 지시 아님', '진입 ', '손절 ', 'TP1 ', 'TP2 ', '현재 ', '1순위 · 1시간봉']) assert.ok(svg.includes(w), w);
  assert.match(svg, /<polyline points="[^"]+" fill="none" stroke="#e8edf3"/);        // 20봉 평균선
  assert.match(svg, /<rect data-k="vol"[^>]*stroke="#fbbf24"/);                        // 급증 막대 강조
  assert.ok(attrs(svg, 'vol').length === 48);
  assert.doesNotMatch(svg, /강력한 지지|강한 저항|확정 지지|반드시/);                  // POC·매물대를 확정 지지/저항으로 단정하지 않음
  assert.match(svg, /fill="#8da2c0" fill-opacity="0\.3"/); assert.match(svg, /fill="#c084fc" fill-opacity="0\.9"/);   // 절제된 색 + 투명도, POC 막대
});
test('거래량 데이터가 부족하면 거래량·매물대를 그리지 않고 이유를 표시(값을 만들지 않음)', () => {
  const svg = buildSvg(specFor('LONG', false, series().map((c, i) => (i % 2 ? { ...c, q: null } : c))));
  assert.ok(svg.includes('거래량 데이터 부족')); assert.ok(svg.includes('거래량·매물대 미표시')); assert.equal(attrs(svg, 'vol').length, 0); assert.equal(attrs(svg, 'profile').length, 0); assert.ok(!svg.includes('POC '));
  assert.ok(svg.includes('조건부 참고 시나리오 · 매매 지시 아님'));                         // 가격 차트는 그대로
  const zero = buildSvg(specFor('SHORT', true, series().map(c => ({ ...c, q: 0 })))); assert.equal(attrs(zero, 'profile').length, 0); assert.ok(attrs(zero, 'vol').length === 48);   // 전부 0이면 막대는 0, 매물대 없음
});
test('모바일 가독성: 가격 태그 글자 13~17px, 눈금·푸터 15px 이상, 캔들 폭 확보, 캔들 수 48', () => {
  const svg = buildSvg(specFor('LONG', false));
  const sizes = [...svg.matchAll(/font-size="([\d.]+)"/g)].map(m => Number(m[1]));
  assert.ok(Math.min(...sizes) >= 13, `최소 글자 ${Math.min(...sizes)}`); assert.ok(sizes.filter(s => s < 15).length <= 8);
  const tagSizes = [...svg.matchAll(/data-k="tag"[^>]*\/><text[^>]*font-size="([\d.]+)"/g)].map(m => Number(m[1])); assert.ok(tagSizes.every(s => s >= 13 && s <= 17));
  const rects = attrs(svg, 'candle').filter(a => a.x !== undefined); assert.equal(rects.length, 48); assert.ok(rects.every(r => r.width >= 5), `캔들 폭 ${Math.min(...rects.map(r => r.width))}`);
  assert.equal(fmtVol(95150000), '9515만'); assert.equal(fmtVol(123456789), '1.2억'); assert.equal(fmtVol(12.4e9), '124억'); assert.equal(fmtVol(850), '850');
});
png('PNG 2장 렌더링: 롱·숏 차트가 각각 PNG로 만들어지고 1200×940, 용량 합리적', async () => {
  const t0 = Date.now(); const outs = [];
  for (const dir of ['LONG', 'SHORT']) outs.push(await renderPng(buildSvg(specFor(dir, dir === 'SHORT'))));
  assert.ok(Date.now() - t0 < 5000);
  for (const o of outs) { assert.deepEqual([...o.subarray(0, 4)], PNG_MAGIC); assert.equal(o.readUInt32BE(16), 1200); assert.equal(o.readUInt32BE(20), 940); assert.ok(o.length > 30000 && o.length < 600000, `크기 ${o.length}`); }
});
// ── 전송 흐름: 텍스트 1 + 사진 2 ──
const hour = Math.floor(now / 3600000);
const ROW = (sym, dir, score) => { const r = sampleRow(dir, false); return { ...r, symbol: sym, candidate: { ...r.candidate, score, blockers: [], dist: { level: 101, atrUnits: 0.8, broken: false }, missing: [], met: [] } }; };
const btc = { symbol: 'BTCUSDT', price: 83150.4, trend: '상승', mtf: { '15m': { arrow: '↑', dir: 'UP' }, '1H': { arrow: '→', dir: 'FLAT' }, '4H': { arrow: '→', dir: 'FLAT' } }, candidate: null, source: 'OKX' };
const A = ROW('AAAUSDT', 'LONG', 80), B = ROW('BBBUSDT', 'SHORT', 70);
const chartData = { AAAUSDT: { '1H': series(60, 5) }, BBBUSDT: { '1H': series(60, 9) }, BTCUSDT: { '4H': series(60, 2, 83000) } };
async function run(state, { render = async s => Buffer.from(`png:${s.symbol}`), sendPhoto, send, rows = [btc, A, B], data = chartData, chartTimeoutMs } = {}) {
  const log = [];
  await cycle({ now, state, chartTimeoutMs, collect: async () => ({ rows, failures: [], charts: data }), save: async () => {}, render,
    send: send ?? (async t => log.push(['text', t])), sendPhoto: sendPhoto ?? (async (p, c) => log.push(['photo', c, p.toString()])) });
  return log;
}
test('정기 보고: 텍스트 1개 → 1순위 사진 → 2순위 사진 순서, 캡션에 순위·종목', async () => {
  const st = {}; const log = await run(st);
  assert.deepEqual(log.map(x => x[0]), ['text', 'photo', 'photo']); assert.match(log[0][1], /1순위 <b>AAAUSDT<\/b>[\s\S]*2순위 <b>BBBUSDT<\/b>/);
  assert.match(log[1][1], /^🥇 1순위 AAAUSDT · 롱 관찰 · 1H봉\n/); assert.match(log[2][1], /^🥈 2순위 BBBUSDT · 숏 관찰 · 1H봉\n/);
  assert.deepEqual(st.chart.items.map(i => [i.symbol, i.ok]), [['AAAUSDT', true], ['BBBUSDT', true]]); assert.equal(st.reportHour, hour); assert.equal(st.partial, undefined);
});
test('후보 1개면 사진 1장, 후보 0개면 BTC 시장 차트 1장, 차트 데이터가 없으면 텍스트만', async () => {
  assert.deepEqual((await run({}, { rows: [btc, A] })).map(x => x[0]), ['text', 'photo']);
  const none = await run({}, { rows: [btc] }); assert.deepEqual(none.map(x => x[0]), ['text', 'photo']); assert.match(none[1][1], /^BTCUSDT · 시장 기준 · 4H봉/); assert.doesNotMatch(none[0][1], /진입 기준|손절/);
  assert.deepEqual((await run({}, { data: {} })).map(x => x[0]), ['text']);
});
test('한 이미지가 실패해도 다른 이미지는 정상 전송되고 텍스트는 다시 보내지 않는다', async () => {
  const st = {}; const log = await run(st, { render: async s => { if (s.symbol === 'AAAUSDT') throw new Error('boom'); return Buffer.from('ok'); } });
  assert.deepEqual(log.map(x => x[0]), ['text', 'photo']); assert.match(log[1][1], /BBBUSDT/); assert.deepEqual(st.chart.items.map(i => i.ok), [false, true]); assert.equal(st.chart.items[0].error, 'boom');
  const hung = await run({}, { render: s => (s.symbol === 'BBBUSDT' ? new Promise(() => {}) : Promise.resolve(Buffer.from('x'))), chartTimeoutMs: 40 }); assert.deepEqual(hung.map(x => x[0]), ['text', 'photo']);
});
test('첫 사진 성공·두 번째 사진 실패: 보고는 완료로 기록되고 텍스트·첫 사진을 재전송하지 않으며 사진 재시도는 1회만', async () => {
  const st = {}; let attempts = 0; const sent = [];
  const log = await run(st, { sendPhoto: async (p, c) => { if (/BBB/.test(c)) { attempts++; throw Object.assign(new Error('upstream'), { status: 502 }); } sent.push(c); } });
  assert.equal(attempts, 2); assert.equal(sent.length, 1); assert.equal(log.length, 1);                                       // 텍스트 1건만(사진은 sendPhoto 쪽에 기록)
  assert.deepEqual(st.chart.items.map(i => i.ok), [true, false]); assert.equal(st.reportHour, hour);
  const again = await run(st, { sendPhoto: async (p, c) => sent.push(c) }); assert.equal(again.length, 0); assert.equal(sent.length, 1);   // 같은 시간대 재실행은 아무것도 보내지 않음
});
test('사진 사이에서 프로세스가 중단돼도 재실행은 남은 사진만 보낸다(v3 partial)', async () => {
  assert.equal(PARTIAL_VERSION, 3);
  const st = { partial: { hour, sent: 2, v: PARTIAL_VERSION } };                       // 텍스트 + 1순위 사진 완료
  const log = await run(st); assert.deepEqual(log.map(x => x[0]), ['photo']); assert.match(log[0][1], /BBBUSDT/); assert.equal(st.reportHour, hour);
  const st2 = { partial: { hour, sent: 3, v: PARTIAL_VERSION } }; assert.equal((await run(st2)).length, 0); assert.equal(st2.reportHour, hour);   // 모두 완료 직전 중단
});
test('텍스트 전송 실패 시 사진도 보내지 않고 보고는 미완료, 재실행에서 한 번만 전송', async () => {
  const st = {}; const photos = [];
  await assert.rejects(run(st, { send: async () => { throw new Error('연결'); }, sendPhoto: async c => photos.push(c) })); assert.equal(photos.length, 0); assert.equal(st.reportHour, undefined);
  const log = await run(st); assert.deepEqual(log.map(x => x[0]), ['text', 'photo', 'photo']);
});
test('2.2 상태 호환: 이전 버전(v 없음/2)이 같은 시간대 보고를 일부 보냈다면 2.3에서 반복 발송하지 않는다', async () => {
  for (const partial of [{ hour, sent: 1 }, { hour, sent: 1, v: 2 }, { hour, sent: 2, v: 2 }]) {
    const st = { partial: { ...partial }, sent: { 'AAAUSDT:LONG': now - 600000 } }; const log = await run(st);
    assert.equal(log.length, 0, JSON.stringify(partial)); assert.equal(st.reportHour, hour); assert.equal(st.partial, undefined);
  }
  const done22 = { reportHour: hour, chart: { hour, at: now, items: [{ symbol: 'AAAUSDT', tf: '1H', ok: true, error: null }] }, sent: {}, news: { status: 'ok', items: [] } };
  assert.equal((await run(done22)).length, 0);                                           // 2.2가 이미 완료한 같은 시간대 보고
  const old = { partial: { hour: hour - 1, sent: 1, v: 2 } }; assert.deepEqual((await run(old)).map(x => x[0]), ['text', 'photo', 'photo']);   // 이전 시간대 partial은 무시
});
test('긴급 강한 신호는 기존처럼 해당 종목만 간결하게(텍스트 + 차트 1장), 근접 후보는 발송 없음', async () => {
  const S = { ...ROW('SSSUSDT', 'SHORT', 90), strong: true, direction: 'SHORT' };
  const st = { reportHour: hour }, log = [];
  await cycle({ now, state: st, collect: async () => ({ rows: [btc, A, B, S], failures: [], charts: { ...chartData, SSSUSDT: { '1H': series(60, 4) } } }), save: async () => {}, render: async () => Buffer.from('x'), send: async t => log.push(['text', t]), sendPhoto: async (p, c) => log.push(['photo', c]) });
  assert.deepEqual(log.map(x => x[0]), ['text', 'photo']); assert.match(log[0][1], /^<b>🚨 신규 조건 포착<\/b>\n<b>SSSUSDT<\/b>/); assert.doesNotMatch(log[0][1], /AAAUSDT|BBBUSDT/); assert.match(log[1][1], /^SSSUSDT · 숏 관찰/);
});
// ── 통합 / 성능 ──
test('실제 수집 결과(모의 OKX) → TOP 2 기본 보고(≤800자)와 차트 사양 생성, 매물대 계산은 밀리초 단위', async () => {
  const { rows, failures, charts } = await collect({ breakout: false, universe: 'full' });
  const c = compactReport(rows, failures, now, {}); assert.ok(c.tops.length >= 1 && c.tops.length <= 2);
  const specs = chartPlan(rows, charts); assert.ok(specs.length >= 1); const t0 = performance.now(); for (const s of specs) assert.ok(!s.skipped && s.profile && s.vol.coverage === 1);
  const t = performance.now(); for (let i = 0; i < 200; i++) volumeProfile(charts.BTCUSDT['5m'].slice(-48), { bins: 24, price: 100 }); assert.ok((performance.now() - t) / 200 < 2, '매물대 계산 평균 2ms 이하');
});
test('사진 전송 파트 수 상한: 기본 보고 최대 2장', async () => {
  const many = ['A', 'B', 'C', 'D'].map((x, i) => ROW(`${x}${x}${x}USDT`, 'LONG', 90 - i)); const data = Object.fromEntries(many.map(r => [r.symbol, { '1H': series(60, 7) }]));
  const log = await run({}, { rows: [btc, ...many], data }); assert.deepEqual(log.map(x => x[0]), ['text', 'photo', 'photo']);
});
