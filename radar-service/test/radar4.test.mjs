import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createOkxCollector } from '../okx.mjs';
import { fakeOkx, now } from './fake-okx.mjs';
import { buildSvg, candidateSpec, chartCaption, chartPlan, makeSpec, renderPng } from '../chart.mjs';
import { fullReportParts, reportMessages, reportParts, summaryText } from '../report.mjs';
import { cycle, telegramPhotoSender } from '../service.mjs';
import { planOf, riskOf } from '../plan.mjs';

const collect = (opts = {}) => createOkxCollector(fakeOkx(opts), { gapMs: 0 })(now);
const resvg = await import('@resvg/resvg-js').catch(() => null);          // 설치되지 않은 환경에서는 PNG 테스트만 건너뜀(텍스트 폴백은 별도 검증)
const png = (t, name, fn) => (resvg ? test(name, fn) : test(name, { skip: '@resvg/resvg-js 미설치' }, () => {}));
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

// 현실적인 1시간봉(모의): 가격이 기준선 아래/위에서 움직이는 사양을 직접 만든다.
const H1 = 3600000;
function candles(start, drift, n = 60, vol = 0.4) {
  let p = start, seed = 7; const out = [];
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296) - 0.5;
  for (let i = 0; i < n; i++) { const o = p, c = p + drift + rnd() * vol; const h = Math.max(o, c) + Math.abs(rnd()) * vol * .6, l = Math.min(o, c) - Math.abs(rnd()) * vol * .6; const t = Math.floor(now / H1) * H1 - (n - i) * H1; out.push({ t, o, h, l, c, end: t + H1 - 1 }); p = c; }
  return out;
}
function rowFor(dir, strong, over = {}) {
  const long = dir === 'LONG';
  const r = { symbol: long ? 'DOGEUSDT' : 'SOLUSDT', direction: strong ? dir : 'WAIT', strong, trend: long ? '상승' : '하락', high: 101, low: 99, swingHigh: 100.6, swingLow: 99.4,
    price: long ? 100.8 : 99.2, priceAt: now - 1000, collectedAt: now, atr: 0.5, atrPct: 0.5, volume: 1.2, oi15: 0.4, funding: 0.01, change15: 0.2, source: 'OKX USDT 무기한(SWAP)', ...over };
  const mtf = { '15m': { dir: 'FLAT', arrow: '→', label: '횡보' }, '1H': { dir: long ? 'DOWN' : 'UP', arrow: long ? '↓' : '↑', label: long ? '하락' : '상승' }, '4H': { dir: 'FLAT', arrow: '→', label: '횡보' } };
  const plan = planOf(r, dir, null);
  return { ...r, mtf, grade: strong ? '공격형' : null, candidate: { dir, score: strong ? 88 : 61.5, plan, dist: { level: long ? 101 : 99, pct: .2, atrUnits: .4, broken: strong },
    unmet: strong ? [] : ['거래대금 1.20배 → 2배 필요', '15분 OI 0.40% → +1% 필요'], met: [], missing: [], blockers: [], mtfConflict: !strong, parts: { btc: { score: 7, max: 10 } }, risk: riskOf(r, dir, mtf, plan, { change15: 0.2 }) } };
}
const longRow = rowFor('LONG', false), shortRow = rowFor('SHORT', true);
const data = { DOGEUSDT: { '1H': candles(100.2, 0.02) }, SOLUSDT: { '1H': candles(99.8, -0.02) } };
const btcBase = rowFor('LONG', false, { symbol: 'BTCUSDT', price: 83300 });
const btcRow = { ...btcBase, candidate: { ...btcBase.candidate, score: 45 }, mtf: { '4H': { dir: 'UP', arrow: '↑', label: '상승', resistance: [84500], support: [82000] } } };

// ── 텍스트 가독성 ──
test('핵심 요약은 비어 있지 않은 15줄·900자 이내이며 핵심 후보 정보를 담는다', () => {
  const t = summaryText([btcRow, longRow], [], now);
  const lines = t.split('\n').filter(Boolean);
  assert.ok(lines.length <= 16, `줄 수 ${lines.length}`); assert.ok(t.length <= 900, `길이 ${t.length}`);
  assert.match(t, /^📡 RICH FUTURES RADAR\n데이터: OKX USDT 무기한\(SWAP\) \(Binance 아님\)/);
  for (const w of ['[핵심 요약]', '1순위 후보: DOGEUSDT 롱 관찰 (조건 미완성', '핵심 가격:', '손절 참고:', '목표:', '체크 포인트: 거래대금 증가 필요 · 15분 OI 증가 필요', '위험:', '[시장]', '[요약 판단] 조건부 관찰', '매매 지시 아님']) assert.ok(t.includes(w), w);
});
test('strong / near / 후보 없음 상황별 요약이 자연스럽다', () => {
  const strong = summaryText([btcRow, shortRow], [], now);
  assert.match(strong, /1순위 후보: SOLUSDT 숏 관찰 \(강한 관찰 조건 포착/); assert.match(strong, /\[요약 판단\] 강한 관찰 조건 포착/); assert.match(strong, /체크 포인트: 재저항 확인 필요/);
  const none = summaryText([{ ...btcRow, candidate: null }], [{ symbol: 'X' }], now);
  assert.match(none, /1순위 후보: 없음 \(대기\)/); assert.match(none, /\[요약 판단\] 대기/); assert.match(none, /수집 실패 1/); assert.doesNotMatch(none, /undefined|NaN/);
  assert.equal(summaryText([], [], now).includes('BTC 데이터 미확인'), true);
});
test('전체 분석(2.1 형식) 순서: 핵심 요약 → 차트 → 상세, 상세 메시지는 모두 4000자 이하 — 정기 보고에는 쓰이지 않음', () => {
  const items = [{ symbol: 'DOGEUSDT', tf: '1H', png: Buffer.from('x'), caption: 'c' }];
  const parts = fullReportParts([btcRow, longRow], [], now, { charts: items });
  assert.deepEqual(parts.map(p => p.type), ['text', 'photo', 'text']);
  assert.match(parts[0].text, /^📡 RICH FUTURES RADAR/); assert.match(parts[2].text, /\[진입 근접 TOP 3\]|\[상세 분석\]/);
  assert.ok(reportMessages([btcRow, longRow], [], now).every(m => m.length <= 4000));
  const basic = reportParts([btcRow, longRow], [], now, { charts: items });
  assert.deepEqual(basic.map(p => p.type), ['text', 'photo']); assert.equal(basic[0].html, true);   // 기본 보고: 압축 본문 + 사진 1장
});
test('상세 메시지는 후보→시간대→시나리오→위험→부족 조건→이슈→경고 순서', () => {
  const m = reportMessages([btcRow, longRow], [], now, { news: { status: 'ok', checkedAt: now, items: [] } }).slice(1).join('\n');
  const idx = ['■ DOGEUSDT', '다중 시간대:', '조건부 참고값', '위험 수준:', '미충족 조건:', '[주요 이슈]', '[참고]'].map(w => m.indexOf(w));
  assert.ok(idx.every(i => i >= 0), JSON.stringify(idx)); assert.deepEqual([...idx].sort((a, b) => a - b), idx);
});
// ── 차트 선택 규칙 ──
test('차트 선택: 강한 후보 우선 · 근접 후보 · 후보 없으면 BTC 4시간 · BTC는 필터가 약할 때만 추가', () => {
  const btcData = { BTCUSDT: { '4H': candles(83000, 8, 60, 120) } };
  const d = { ...data, ...btcData };
  const a = chartPlan([btcRow, longRow, shortRow], d);
  assert.deepEqual(a.map(s => [s.symbol, s.tf, s.kind]), [['SOLUSDT', '1H', 'candidate'], ['BTCUSDT', '4H', 'market']]); // strong 우선, BTC 필터 7점 이하 → BTC 추가
  assert.match(a[0].reason, /강한 후보 1위 · 1시간봉 우선/);
  const strongBtcOk = { ...shortRow, candidate: { ...shortRow.candidate, parts: { btc: { score: 10, max: 10 } } } };
  assert.equal(chartPlan([btcRow, strongBtcOk], d).length, 1);
  const b = chartPlan([btcRow, longRow], d);
  assert.deepEqual(b.map(s => s.symbol), ['DOGEUSDT']); assert.match(b[0].reason, /근접 후보 1위/);
  const c = chartPlan([{ ...btcRow, candidate: null }], d);
  assert.deepEqual(c.map(s => [s.symbol, s.tf, s.kind]), [['BTCUSDT', '4H', 'market']]); assert.match(c[0].reason, /후보 없음/);
  assert.deepEqual(chartPlan([{ ...btcRow, candidate: null }], {}), []);
});
test('시간봉 대체: 1시간봉이 없으면 15분 → 5분으로 대체하고 이유에 남긴다', () => {
  const s = candidateSpec(longRow, { DOGEUSDT: { '5m': candles(100, 0, 60).map(c => ({ ...c })) } }, '근접 후보 1위');
  assert.equal(s.tf, '5m'); assert.match(s.reason, /대체/);
  assert.equal(candidateSpec(longRow, {}, 'x').skipped, '차트용 캔들 없음');
});
test('실제 수집 결과에서 차트용 캔들이 검증을 통과한 시간대만 포함된다', async () => {
  const { charts } = await collect({ mtf: { '1H': 'stale', '4H': 'up' } });
  assert.ok(charts.BTCUSDT['5m'].length > 20); assert.equal(charts.BTCUSDT['1H'], undefined); assert.ok(charts.BTCUSDT['4H'].length >= 30); // 지연된 1시간봉은 차트에 쓰지 않음
});
// ── 차트 도형 ──
const lineY = (svg, color, dash) => [...svg.matchAll(new RegExp(`<line x1="28" x2="936" y1="([\\d.]+)" y2="[\\d.]+" stroke="${color}" stroke-width="[\\d.]+"${dash ? ' stroke-dasharray' : ''}`, 'g'))].map(m => Number(m[1]));
test('롱 차트: 손절은 진입 아래(y 큼), TP1<TP2는 진입 위, 필수 요소 문구 포함', () => {
  const spec = makeSpec(longRow, '1H', data.DOGEUSDT['1H'], 'candidate', '근접 후보 1위');
  const svg = buildSvg(spec);
  const stopY = lineY(svg, '#ef4444')[0], [tp2Y, tp1Y] = lineY(svg, '#4ade80', true), entryY = lineY(svg, '#fbbf24', true)[0];
  assert.ok(stopY > entryY && entryY > tp1Y && tp1Y > tp2Y, JSON.stringify({ stopY, entryY, tp1Y, tp2Y })); // SVG y는 아래가 큼
  for (const w of ['DOGEUSDT', '롱 관찰', '1시간봉', '조건 미완성', '진입 ', '손절 ', 'TP1 ', 'TP2 ', '현재 100.8', '핵심 구간', '여기 돌파 확인 필요', '조건부 참고 시나리오 · 매매 지시 아님', '거래대금 증가 필요', '상위 시간대 역행 주의', '강제청산가 확인 불가', '(Binance 아님)', '15분 → / 1시간 ↓ / 4시간 →']) assert.ok(svg.includes(w), w);
  assert.match(svg, /손절 [\d.]+ \(-[\d.]+%\)/); assert.match(svg, /TP1 [\d.]+ \(\+[\d.]+%\)/); // 롱: 손절은 하락, 목표는 상승
});
test('숏 차트: 손절은 진입 위(y 작음), TP는 아래, 강한 조건 문구와 재저항 라벨', () => {
  const spec = makeSpec(shortRow, '1H', data.SOLUSDT['1H'], 'candidate', '강한 후보 1위');
  const svg = buildSvg(spec);
  const stopY = lineY(svg, '#ef4444')[0], [tp2Y, tp1Y] = lineY(svg, '#4ade80', true), entryY = lineY(svg, '#fbbf24', true)[0];
  assert.ok(stopY < entryY && entryY < tp1Y && tp1Y < tp2Y, JSON.stringify({ stopY, entryY, tp1Y, tp2Y }));
  for (const w of ['SOLUSDT', '숏 관찰', '강한 관찰 조건 포착', '재저항 확인 필요', '여기 이탈 확인 필요', '매매 지시 아님']) assert.ok(svg.includes(w), w);
  assert.match(svg, /손절 [\d.]+ \(\+[\d.]+%\)/); assert.match(svg, /TP1 [\d.]+ \(-[\d.]+%\)/);
});
test('진입 참고 구간 박스와 화살표, 현재가 라벨이 있고 계좌별 청산가·확정 표현은 없다', () => {
  const svg = buildSvg(makeSpec(longRow, '1H', data.DOGEUSDT['1H'], 'candidate', 'x'));
  assert.match(svg, /<rect x="28" y="[\d.]+" width="908" height="[\d.]+" fill="#fbbf24" fill-opacity="0.13"/); // 핵심 구간 박스
  assert.match(svg, /<path d="M [\d.]+ [\d.]+ Q [^"]+" fill="none" stroke="#fbbf24"/); assert.match(svg, /<polygon /);
  assert.ok(svg.includes('현재 100.8'));
  assert.doesNotMatch(svg, /청산가 \d|반드시|확정 수익|수익 보장|지금 진입|매수하세요|매도하세요/);
});
test('시나리오가 없으면 기준선만 표시하고 계산 불가를 밝힌다', () => {
  const r = { ...longRow, candidate: { ...longRow.candidate, plan: null } };
  const svg = buildSvg(makeSpec(r, '1H', data.DOGEUSDT['1H'], 'candidate', 'x'));
  assert.ok(svg.includes('기준선 101')); assert.ok(svg.includes('시나리오를 계산할 수 없어')); assert.ok(!svg.includes('손절 '));
});
test('BTC 시장 차트는 진입·손절 없이 추세와 구조선만 표시', () => {
  const svg = buildSvg(makeSpec(btcRow, '4H', candidatesBtc(), 'market', 'x'));
  assert.ok(svg.includes('BTCUSDT') && svg.includes('시장 기준') && svg.includes('BTC 4시간 추세 상승')); assert.ok(!svg.includes('손절 ') && !svg.includes('TP1'));
});
function candidatesBtc() { return candles(83000, 8, 60, 120).map(c => ({ ...c })); }
test('캡션은 1~2줄: 종목·방향·시간봉과 면책 문구만', () => {
  const cap = chartCaption(makeSpec(longRow, '1H', data.DOGEUSDT['1H'], 'candidate', 'x'));
  assert.equal(cap, 'DOGEUSDT · 롱 관찰 · 1H봉\n조건부 참고 시나리오 · 매매 지시 아님');
  assert.equal(chartCaption(makeSpec(btcRow, '4H', candidatesBtc(), 'market', 'x')), 'BTCUSDT · 시장 기준 · 4H봉\n시장 참고 차트 · 매매 지시 아님');
});
// ── PNG 렌더링 ──
png(true, '실제 PNG 렌더링: 롱·숏 모두 PNG 시그니처와 1200 폭, 용량 합리적', async () => {
  for (const [row, d] of [[longRow, data.DOGEUSDT], [shortRow, data.SOLUSDT]]) {
    const out = await renderPng(buildSvg(makeSpec(row, '1H', d['1H'], 'candidate', 'x')));
    assert.deepEqual([...out.subarray(0, 4)], PNG_MAGIC); assert.equal(out.readUInt32BE(16), 1200); assert.ok(out.length > 20000 && out.length < 400000, `크기 ${out.length}`);
  }
});
test('글꼴 부분집합이 모든 소스 한글·기호를 포함한다(차트 글자 깨짐 방지)', () => {
  const charset = new Set(readFileSync(new URL('../fonts/charset.txt', import.meta.url), 'utf8').trim());
  const files = readdirSync(new URL('..', import.meta.url)).filter(f => f.endsWith('.mjs') && f !== 'probe-exchanges.mjs');
  for (const f of files) for (const ch of readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')) if (ch.codePointAt(0) > 127 && !(ch.codePointAt(0) >= 0x1f000)) assert.ok(charset.has(ch), `${f}: ${ch} 가 글꼴 목록에 없음`);
});
// ── Telegram 전송 ──
const okJson = id => new Response(JSON.stringify({ ok: true, result: { message_id: id } }), { status: 200 });
test('sendPhoto: multipart 요청 구성, 캡션 제한, 전송 확인 필요, 토큰 비노출', async () => {
  let seen;
  const send = telegramPhotoSender('secret-token', '123', async (url, opt) => { seen = { url, opt }; return okJson(9); });
  await send(Buffer.from([1, 2, 3]), '캡션');
  assert.match(seen.url, /\/botsecret-token\/sendPhoto$/); assert.ok(seen.opt.body instanceof FormData);
  assert.equal(seen.opt.body.get('chat_id'), '123'); assert.equal(seen.opt.body.get('caption'), '캡션'); assert.equal(seen.opt.body.get('photo').type, 'image/png');
  await assert.rejects(send(Buffer.from([1]), 'x'.repeat(1025)), /캡션 길이 초과/);
  await assert.rejects(send(Buffer.alloc(0), 'x'), /이미지 없음/);
  await assert.rejects(telegramPhotoSender('t', '123', async () => new Response(JSON.stringify({ ok: false }), { status: 200 }))(Buffer.from([1]), ''), /사진 전송 미확인/);
  await assert.rejects(telegramPhotoSender('secret-token', '123', async url => { throw Error(url); })(Buffer.from([1]), ''), e => !e.message.includes('secret-token'));
  assert.throws(() => telegramPhotoSender('t', '-100123'));
});
async function runHourly({ render, sendPhoto, rows = [btcRow, longRow], chartData = data, state = {}, failSendAt, chartTimeoutMs } = {}) {
  const log = []; let n = 0;
  const opts = { now, state, chartTimeoutMs, collect: async () => ({ rows, failures: [], charts: chartData }), save: async () => {}, render, sendPhoto,
    send: async t => { if (failSendAt !== undefined && n++ === failSendAt) throw new Error('tg'); log.push(['text', t]); } };
  const wrapped = sendPhoto && { ...opts, sendPhoto: async (p, c) => { await sendPhoto(p, c); log.push(['photo', c]); } };
  try { await cycle(wrapped ?? opts); } catch { /* 일부 테스트는 실패를 기대 */ }
  return { log, state };
}
const fakeRender = async spec => Buffer.from(`png:${spec.symbol}`);
test('정기 보고 전송: 압축 본문 → 사진 1장(2개 메시지)', async () => {
  const { log, state } = await runHourly({ render: fakeRender, sendPhoto: async () => {} });
  assert.deepEqual(log.map(x => x[0]), ['text', 'photo']); assert.match(log[0][1], /^<b>📡 RICH FUTURES RADAR<\/b>/); assert.match(log[1][1], /^DOGEUSDT · 롱 관찰 · 1H봉/);
  assert.equal(state.chart.items.length, 1); assert.equal(state.chart.items[0].ok, true); assert.equal(state.reportHour, Math.floor(now / 3600000));
});
test('차트 렌더링 실패 시에도 텍스트 보고는 정상 전송된다', async () => {
  const { log, state } = await runHourly({ render: async () => { throw new Error('boom'); }, sendPhoto: async () => { throw new Error('no photo expected'); } });
  assert.deepEqual(log.map(x => x[0]), ['text']); assert.equal(state.chart.items[0].ok, false); assert.equal(state.chart.items[0].error, 'boom'); assert.ok(state.reportHour !== undefined);
  // 렌더러가 멈춰도(시간 초과) 텍스트 보고는 전송된다
  const hung = await runHourly({ render: () => new Promise(() => {}), sendPhoto: async () => {}, chartTimeoutMs: 50 });
  assert.deepEqual(hung.log.map(x => x[0]), ['text']); assert.match(hung.state.chart.items[0].error, /시간 초과/);
});
test('사진 업로드가 실패해도 텍스트는 전송되고 재시도는 1회만, 보고는 완료로 기록', async () => {
  let attempts = 0;
  const { log, state } = await runHourly({ render: fakeRender, sendPhoto: async () => { attempts++; throw Object.assign(new Error('upstream'), { status: 502 }); } });
  assert.equal(attempts, 2); assert.deepEqual(log.map(x => x[0]), ['text']); assert.equal(state.chart.items[0].ok, false); assert.ok(state.reportHour !== undefined);
  let a429 = 0;
  await runHourly({ render: fakeRender, sendPhoto: async () => { a429++; throw Object.assign(new Error('rate'), { status: 429 }); } });
  assert.equal(a429, 1); // 429/4xx는 재시도하지 않음
});
test('render/sendPhoto가 없으면(구버전 호환) 텍스트만 전송', async () => {
  const { log } = await runHourly({});
  assert.equal(log.length, 1); assert.equal(log[0][0], 'text');
});
test('같은 보고에서 이미지 중복 방지: 사진 직후 중단되어도 재실행은 사진을 다시 보내지 않고 같은 시간대 재보고도 없다', async () => {
  const state = {}; const photos = [];
  const sendPhoto = async (p, c) => photos.push(c);
  let saves = 0;
  // 사진 전송 직후 저장 단계에서 프로세스가 죽는 상황을 흉내: partial.sent=1(텍스트만 확인)에서 재시작
  state.partial = { hour: Math.floor(now / 3600000), sent: 1, v: 2 };
  const second = await runHourly({ render: fakeRender, sendPhoto, state });
  assert.deepEqual(second.log.map(x => x[0]), ['photo']); assert.equal(photos.length, 1);   // 텍스트는 이미 보냈으므로 사진만
  assert.equal(state.reportHour, Math.floor(now / 3600000)); assert.equal(state.partial, undefined);
  const third = await runHourly({ render: fakeRender, sendPhoto, state });
  assert.equal(third.log.length, 0); assert.equal(photos.length, 1);
});
test('텍스트 전송 실패 시 보고는 미완료로 남고 재실행에서 한 번만 전송', async () => {
  const state = {}; const photos = [];
  const first = await runHourly({ render: fakeRender, sendPhoto: async (p, c) => photos.push(c), state, failSendAt: 0 });
  assert.equal(first.log.length, 0); assert.equal(photos.length, 0); assert.equal(state.reportHour, undefined);
  const second = await runHourly({ render: fakeRender, sendPhoto: async (p, c) => photos.push(c), state });
  assert.deepEqual(second.log.map(x => x[0]), ['text', 'photo']); assert.equal(photos.length, 1);
});
test('렌더링 실패 후 재실행에서 렌더링이 성공해도 이미 처리된 자리를 다시 보내지 않는다', async () => {
  const state = { partial: { hour: Math.floor(now / 3600000), sent: 2, v: 2 } }; const photos = [];
  const r = await runHourly({ render: fakeRender, sendPhoto: async (p, c) => photos.push(c), state });
  assert.equal(r.log.length, 0); assert.equal(photos.length, 0); assert.equal(state.reportHour, Math.floor(now / 3600000));
});
test('강한 신규 신호: 짧은 HTML 알림 뒤 해당 종목 차트 1장, 쿨다운 중에는 재전송 없음', async () => {
  const state = { reportHour: Math.floor(now / 3600000) }, log = [];
  const o = { state, collect: async () => ({ rows: [btcRow, shortRow], failures: [], charts: data }), save: async () => {}, render: fakeRender, send: async t => log.push(['text', t]), sendPhoto: async (p, c) => log.push(['photo', c]) };
  await cycle({ ...o, now });
  assert.deepEqual(log.map(x => x[0]), ['text', 'photo']); assert.match(log[0][1], /^<b>🚨 신규 조건 포착<\/b>/); assert.match(log[1][1], /^SOLUSDT · 숏 관찰 · 1H봉/); assert.ok(log[0][1].length < 500);
  await cycle({ ...o, now: now + 300000 });
  assert.equal(log.length, 2);
  const failing = { ...o, state: { reportHour: Math.floor(now / 3600000) }, render: async () => { throw new Error('boom'); } }; const log2 = []; failing.send = async t => log2.push(t);
  await cycle({ ...failing, now }); assert.equal(log2.length, 1); assert.equal(failing.state.chart.items[0].ok, false);
});
test('근접 후보만 있는 5분 감시에는 알림과 사진이 없다', async () => {
  const log = [];
  await cycle({ now, state: { reportHour: Math.floor(now / 3600000) }, collect: async () => ({ rows: [btcRow, longRow], failures: [], charts: data }), save: async () => {}, render: fakeRender, send: async t => log.push(t), sendPhoto: async c => log.push(c) });
  assert.equal(log.length, 0);
});
png(true, '실데이터 형태 수집 결과 → 실제 PNG까지 전체 경로', async () => {
  const { rows, charts } = await collect({ breakout: false });
  const specs = chartPlan(rows, charts);
  assert.ok(specs.length >= 1 && !specs[0].skipped);
  const out = await renderPng(buildSvg(specs[0]));
  assert.deepEqual([...out.subarray(0, 4)], PNG_MAGIC);
});
