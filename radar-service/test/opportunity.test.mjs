import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { aggregate, H1, H4 } from '../opportunity/indicators.mjs';
import { analyzeCoin, doneIndex, trendSeries, trendInfo, CHECK_TOTAL, OPP } from '../opportunity/analysis.mjs';
import { transition, blank, CLEAR_N, COOLDOWN_MS } from '../opportunity/transition.mjs';
import { formatAlerts, watchBlock, summaryLines, DISCLAIMER } from '../opportunity/message.mjs';
import { parseCandles, freshness, collectOpportunity } from '../opportunity/collect.mjs';
import { opportunityStep, runOpportunitySafe, modeOf, normalize, MAX_ALERT_COINS } from '../opportunity/step.mjs';

// ── 합성 데이터 ──
const T0 = Date.UTC(2024, 0, 1);
const lcg = seed => { let x = seed >>> 0; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296; };
function wave(n, seed, { amp = 0.06, per = 240, drift = 0.0004 } = {}) {
  const r = lcg(seed); let p = 100; const rows = [];
  for (let i = 0; i < n; i++) {
    const tgt = 100 * Math.exp(drift * i + amp * Math.sin(2 * Math.PI * i / per)), o = p, c = tgt * (1 + (r() - 0.5) * 0.004);
    rows.push({ t: T0 + i * H1, o, h: Math.max(o, c) * (1 + r() * 0.002), l: Math.min(o, c) * (1 - r() * 0.002), c, q: 1e6 * (0.6 + r() * 1.5) }); p = c;
  }
  return rows;
}
const mirror = (c, K = 1000) => c.map(x => ({ t: x.t, o: K - x.o, h: K - x.l, l: K - x.h, c: K - x.c, q: x.q }));
const at = (c, i) => { const s = c.slice(0, i + 1); return analyzeCoin(s, aggregate(s), aggregate(s)); };
const N = 2600;
const ETH = wave(N, 5), SOL = mirror(ETH), BTC = wave(N, 9, { amp: 0.04, per: 300 });
// stage별 대표 인덱스(합성 데이터에서 탐색)
function find(c, pred, from = 1100) { const out = []; for (let i = from; i < c.length; i++) { const a = at(c, i); if (a.status === 'ok' && pred(a)) out.push(i); } return out; }
const ethStage = {}; for (const st of [1, 2, 3]) ethStage[st] = find(ETH, a => a.stage === st);

// ── 분석 ──
test('합성 데이터에서 접근(1)·눌림(2)·조건 충족(3) 단계가 모두 탐지된다', () => {
  for (const st of [1, 2, 3]) assert.ok(ethStage[st].length > 0, `stage ${st} 없음`);
  const a = at(ETH, ethStage[3][0]);
  assert.equal(a.state, 'LONG'); assert.equal(a.dir, 'LONG'); assert.equal(a.met, CHECK_TOTAL); assert.equal(a.unmet.length, 0);
  assert.ok(a.zone.lo < a.zone.hi && a.invalidation < a.zone.lo && a.price > a.zone.hi - 1e-9);
  assert.ok(a.checks.every(c => c.ok) && a.reasons.length === CHECK_TOTAL);
  const b = at(ETH, ethStage[2][0]); assert.ok(b.stage === 2 && b.unmet.length > 0 && b.met < CHECK_TOTAL);
  const c = at(ETH, ethStage[1][0]); assert.ok(c.stage === 1 && c.zone && c.met < CHECK_TOTAL);
});
test('LONG/SHORT 대칭: 가격을 뒤집으면 같은 봉에서 같은 단계·충족 개수, 방향·구간·무효화 가격만 거울', () => {
  let n = 0;
  for (let i = 1100; i < N; i += 1) {
    const a = at(ETH, i), b = at(SOL, i);
    assert.equal(a.status, b.status);
    if (a.status !== 'ok') continue;
    assert.equal(a.stage, b.stage, `stage @${i}`); assert.equal(a.met, b.met, `met @${i}`);
    if (a.stage >= 1) {
      n++; assert.equal(a.dir, 'LONG'); assert.equal(b.dir, 'SHORT');
      assert.ok(Math.abs((1000 - a.zone.hi) - b.zone.lo) < 1e-6 && Math.abs((1000 - a.zone.lo) - b.zone.hi) < 1e-6);
      assert.ok(Math.abs((1000 - a.invalidation) - b.invalidation) < 1e-6);
    }
  }
  assert.ok(n > 20, `비교한 관찰 구간 ${n}`);
  const s = find(SOL, a => a.stage === 3); assert.ok(s.length > 0); assert.match(at(SOL, s[0]).reasons.join(' '), /저항 구간/);
});
test('확정봉만: 신호 봉 마감 이후의 4H 봉이나 미래 캔들은 결과에 영향을 주지 않는다', () => {
  const i = ethStage[3][0], s = ETH.slice(0, i + 1), c4 = aggregate(s), base = analyzeCoin(s, c4, c4);
  const future = { t: c4.at(-1).t + H4, o: 1, h: 9999, l: 0.5, c: 5000, q: 1, n: 4 };       // 아직 마감되지 않았어야 할 4H 봉이 섞여 들어온 경우
  const mixed = analyzeCoin(s, [...c4, future], c4);
  assert.deepEqual(mixed, base);
  assert.equal(doneIndex([...c4, future], s.at(-1).t + H1), c4.length - 1);
  // 4H 봉이 신호 봉 마감 시각에 막 마감된 경우와 아직 진행 중인 경우의 경계
  const c4b = c4.filter(x => x.t + H4 <= s.at(-1).t + H1);
  assert.equal(c4b.length, c4.length);
});
test('데이터 부족은 대기가 아니라 분석 제외, 추세 혼조는 대기와 이유', () => {
  assert.equal(analyzeCoin(ETH.slice(0, 50), aggregate(ETH.slice(0, 50))).status, 'insufficient');
  const s = ETH.slice(0, 1000); assert.equal(analyzeCoin(s, aggregate(s).slice(-100)).status, 'insufficient');
  const flat = wave(2600, 3, { amp: 0.02, per: 50, drift: 0 }), seen = find(flat, a => a.trend === null, 1100);
  assert.ok(seen.length > 0); const a = at(flat, seen[0]); assert.equal(a.state, 'WAIT'); assert.equal(a.stage, 0); assert.match(a.unmet[0], /4H 추세 혼조|확정 피벗/);
});
test('참고 지표: BTC 맥락·상대 거래량·ATR 변동성·추격 위험이 계산된다', () => {
  const i = ethStage[3][0], s = ETH.slice(0, i + 1), a = analyzeCoin(s, aggregate(s), aggregate(BTC.slice(0, i + 1)));
  assert.ok(['일치', '역방향', '중립'].includes(a.metrics.btcAlign));
  assert.ok(a.metrics.relVol > 0 && a.metrics.atr1Pct > 0 && a.metrics.atr4Pct > 0);
  assert.ok(['낮음', '보통', '높음'].includes(a.metrics.volLabel) && ['낮음', '보통', '높음'].includes(a.metrics.chase));
  assert.equal(analyzeCoin(s, aggregate(s), null).metrics.btcAlign, '확인 불가');
  const noVol = s.map((x, k) => (k > s.length - 5 ? { ...x, q: null } : x)); assert.equal(analyzeCoin(noVol, aggregate(s), null).metrics.relVol, null);
});

// ── 상태 전이 ──
const cur = (stage, o = {}) => ({ status: 'ok', barT: 0, price: 100, stage, dir: stage ? (o.dir ?? 'LONG') : null, invalidation: stage ? 90 : null, zone: stage ? { lo: 95, hi: 98, level: 96.5, type: '4H 스윙' } : null, unmet: ['사유'], ...o });
function run(seq, start = null, t0 = 0) {   // seq: [[stage, opts]] — 한 봉씩, 알림이 나가면 committed 저장(전송 성공 가정)
  let st = start, now = t0, events = [];
  seq.forEach(([stage, o], k) => {
    now += H1; const c = cur(stage, { barT: now - H1, ...o }); const t = transition(st, c, now);
    if (t.event) events.push({ k, type: t.event.type, stage: t.event.to.stage, dir: t.event.to.dir });
    st = t.committed;
  });
  return { st, events, now };
}
test('신호 발생 → 단계 상승만 알림, 같은 단계 유지·하락 후 재상승은 중복 알림 없음', () => {
  const { events } = run([[0], [1], [1], [1], [2], [2], [1], [2], [3], [3], [2], [3]]);
  assert.deepEqual(events.map(e => [e.type, e.stage]), [['new', 1], ['upgrade', 2], ['upgrade', 3]]);
});
test('깜빡임 방지: 대기 복귀 1회는 해제 아님, 연속 CLEAR_N회여야 해제 알림 + 재발생은 새 관찰', () => {
  assert.equal(CLEAR_N, 2);
  const a = run([[0], [2], [0], [2], [2]], null);                                       // 한 번 끊겼다가 복귀 → 해제 없음
  assert.deepEqual(a.events.map(e => e.type), ['new']);
  const b = run([[0], [2], [0], [0]]);                                                   // 연속 2회 → 해제
  assert.deepEqual(b.events.map(e => e.type), ['new', 'cleared']); assert.equal(b.st.stage, 0); assert.equal(b.st.alertedStage, 0);
  const c = run([[0], [2], [0], [0], [0], [0], [3]], null, 0);                           // 해제 후 3시간 뒤 다시 조건 충족 → 새 알림(재발생)
  assert.deepEqual(c.events.map(e => e.type), ['new', 'cleared', 'new']);
});
test('알린 적 없는 관찰은 조용히 종료되고, 해제 직후 단계 1 재발생은 쿨다운 동안 알리지 않는다(조건 충족은 예외)', () => {
  const quiet = run([[0], [1], [0], [0]]); assert.deepEqual(quiet.events.map(e => e.type), ['new', 'cleared']);   // 단계 1도 알린 관찰이므로 해제 알림
  assert.equal(COOLDOWN_MS, 7200000);
  const flap = run([[0], [1], [0], [0], [1], [1], [1], [1], [1]]);                       // 해제(k=3) 직후 재발생(k=4) → 쿨다운(2h) 동안 억제, 이후 알림
  const types = flap.events.map(e => [e.k, e.type]);
  assert.deepEqual(types.slice(0, 2), [[1, 'new'], [3, 'cleared']]);
  assert.ok(!types.some(([k]) => k === 4), `쿨다운 중 알림: ${JSON.stringify(types)}`);               // 해제 알림 1시간 뒤(k=4)는 억제
  assert.deepEqual(types.at(-1), [5, 'new']);                                                        // 2시간이 지난 k=5에서 새 관찰 알림
  const ready = run([[0], [1], [0], [0], [3]]); assert.deepEqual(ready.events.map(e => e.type), ['new', 'cleared', 'new']);   // 조건 충족은 쿨다운 예외
  const unalerted = transition(null, cur(0), H1); assert.equal(unalerted.event, null);
});
test('무효화 가격을 1H 종가로 이탈하면 즉시 해제(디바운스 없음), 알린 적 없으면 조용히 종료', () => {
  const alerted = run([[0], [2]]), br = transition(alerted.st, cur(0, { price: 89, barT: 99 }), alerted.now + H1);
  assert.equal(br.event.type, 'invalidated'); assert.match(br.event.reason, /무효화/); assert.equal(br.committed.stage, 0);
  const silent = transition({ ...blank(), dir: 'LONG', stage: 1, invalidation: 90 }, cur(0, { price: 89, barT: 99 }), 5 * H1); assert.equal(silent.event, null);
  const short = transition({ ...blank(), dir: 'SHORT', stage: 2, alertedStage: 2, invalidation: 110 }, cur(0, { price: 111, barT: 7 }), 9 * H1); assert.equal(short.event.type, 'invalidated');   // SHORT는 상향 이탈
});
test('방향 전환은 쿨다운과 무관하게 알린다', () => {
  const r = run([[0], [2, { dir: 'LONG' }], [2, { dir: 'SHORT' }]]);
  assert.deepEqual(r.events.map(e => [e.type, e.dir]), [['new', 'LONG'], ['flip', 'SHORT']]);
});
test('같은 봉은 다시 평가되지 않아도 안전: 이미 알린 단계에서는 이벤트가 없다', () => {
  const r = run([[0], [3]]); const again = transition(r.st, cur(3, { barT: r.now }), r.now + H1); assert.equal(again.event, null);
});

// ── 메시지 ──
const alertItem = (sym, series, i, type = 'new') => { const s = series.slice(0, i + 1), a = analyzeCoin(s, aggregate(s), aggregate(BTC.slice(0, i + 1))); return { symbol: sym, event: { type, to: { dir: a.dir, stage: a.stage }, prevDir: type === 'flip' ? 'LONG' : null }, analysis: a, price: a.price }; };
const FORBIDDEN = /승률|확률|레버리지|매수|매도|진입 추천|주문|수익 보장|목표가|손절/;
test('Telegram 메시지 예시: LONG·SHORT 관찰, 필수 항목 표시, 금지 표현 없음, 한도 이내', () => {
  const longItem = alertItem('ETHUSDT', ETH, ethStage[3][0]), short3 = find(SOL, a => a.stage === 3)[0], shortItem = alertItem('SOLUSDT', SOL, short3);
  const clear = { symbol: 'XRPUSDT', event: { type: 'invalidated', reason: '1H 종가 88.0가 무효화 가격 90.0을 하향 이탈', prevDir: 'LONG' }, price: 88 };
  const parts = formatAlerts([longItem, shortItem, clear], { now: Date.UTC(2024, 5, 1, 3, 0, 20), health: { excluded: ['DOGEUSDT'], states: { analyzed: 20, long: ['ETHUSDT'], short: ['SOLUSDT'], wait: 18 } } });
  assert.equal(parts.length, 1); const t = parts[0].plain;
  for (const need of ['기회 포착 레이더', 'ETH', 'LONG 관찰', 'SHORT 관찰', '참고 가격', '지지 구간', '저항 구간', '무효화 가격', '관찰 이유', '미충족', 'BTC 4H', '상대 거래량', '변동성', '추격 위험', '충족 7/7', '해제', '데이터 점검', '현재 상태(이번 점검 20종목): LONG 관찰 ETH · SHORT 관찰 SOL · 대기 18종목', '주문 권고가 아니며']) assert.ok(t.includes(need), `${need} 없음`);
  assert.ok(!FORBIDDEN.test(t.replace(DISCLAIMER, '')), t.match(FORBIDDEN)?.[0]);
  assert.ok(parts[0].text.length < 4000 && parts[0].html && parts[0].text.includes('<b>'));
  assert.ok(!/<(?!\/?b>)/.test(parts[0].text.replace(/&lt;|&gt;/g, '')), '허용되지 않은 HTML 태그');
  assert.match(DISCLAIMER, /수익성은 검증되지 않았습니다/);
  console.log('\n----- 메시지 예시 -----\n' + t + '\n-----');
});
test('관찰 단계별 문구와 요약(미리보기) 줄', () => {
  const rows = [1, 2, 3].map(st => ({ symbol: `C${st}USDT`, analysis: at(ETH, ethStage[st][0]) }));
  rows.push({ symbol: 'BADUSDT', reason: '1H 데이터가 오래됨' }, { symbol: 'WAITUSDT', analysis: { status: 'ok', stage: 0, trend: null, unmet: ['4H 추세 혼조'] } });
  const lines = summaryLines(rows); assert.match(lines[0], /구간 접근 중/); assert.match(lines[1], /눌림 진행 중/); assert.match(lines[2], /조건 충족/); assert.match(lines[3], /분석 제외/); assert.match(lines[4], /대기/);
  assert.match(watchBlock('ETHUSDT', rows[0].analysis, { type: 'new' }), /LONG 관찰/);
});
test('코인이 많으면 메시지를 길이 한도 안에서 나눈다', () => {
  const it = alertItem('ETHUSDT', ETH, ethStage[3][0]), many = Array.from({ length: 30 }, (_, k) => ({ ...it, symbol: `C${k}USDT` }));
  const parts = formatAlerts(many, { now: T0 }); assert.ok(parts.length > 1);
  assert.ok(parts.every(p => p.text.length <= 4000)); assert.equal(parts.flatMap(p => p.items).length, 30); assert.deepEqual(formatAlerts([], { now: T0 }), []);
});

// ── 수집 검증 ──
const row = (t, o, h, l, c, confirm = '1', q = 1000) => [String(t), String(o), String(h), String(l), String(c), '1', String(q / ((h + l) / 2)), String(q), confirm];
test('parseCandles: 미확정 제외, 최신→오래된 순 정렬, 비정상 봉·누락 봉이 있으면 최근 연속 구간만', () => {
  const rows = [row(T0 + 5 * H1, 1, 9, 1, 5, '0'), ...[4, 3, 2, 1, 0].map(k => row(T0 + k * H1, 10, 11, 9, 10))];
  const ok = parseCandles(rows, H1); assert.deepEqual(ok.candles.map(c => c.t), [0, 1, 2, 3, 4].map(k => T0 + k * H1)); assert.equal(ok.notes.length, 0);
  const gap = parseCandles([...[5, 4, 3].map(k => row(T0 + k * H1, 10, 11, 9, 10)), ...[1, 0].map(k => row(T0 + k * H1, 10, 11, 9, 10))], H1);
  assert.deepEqual(gap.candles.map(c => c.t), [3, 4, 5].map(k => T0 + k * H1)); assert.ok(gap.notes.includes('누락 봉'));
  const bad = parseCandles([row(T0 + 3 * H1, 10, 11, 9, 10), row(T0 + 2 * H1, 10, 8, 9, 10), row(T0 + H1, 10, 11, 9, 10)], H1);   // 고가 < 저가
  assert.deepEqual(bad.candles.map(c => c.t), [T0 + 3 * H1]); assert.ok(bad.notes.includes('비정상 캔들'));
  assert.equal(parseCandles([row(T0 + 1000, 10, 11, 9, 10)], H1).candles.length, 0);          // 정시가 아닌 시각
  assert.equal(parseCandles([row(T0 + H1, 10, 11, 9, 10), row(T0 + H1, 10, 11, 9, 10)], H1).candles.length, 1);   // 중복 시각
});
test('freshness: 직전에 마감한 봉이면 fresh, 방금 마감해 미확정이면 pending, 오래되면 stale', () => {
  const now = T0 + 100 * H1 + 30000, mk = (t, step) => [{ t, o: 1, h: 1, l: 1, c: 1, q: 1 }];
  const last1 = T0 + 99 * H1, need4 = Math.floor((last1 + H1) / H4) * H4 - H4;
  assert.equal(freshness(mk(last1), mk(need4), now).status, 'fresh');
  assert.equal(freshness(mk(last1 - H1), mk(need4), now).status, 'pending');
  assert.equal(freshness(mk(last1 - H1), mk(need4), now + 31 * 60000).status, 'stale');
  assert.equal(freshness(mk(last1 - 5 * H1), mk(need4), now).status, 'stale');
  assert.equal(freshness(mk(last1), mk(need4 - 2 * H4), now).status, 'stale');
  assert.equal(freshness([], [], now).status, 'stale');
});

// ── OKX 모의 서버 ──
const SERIES = { 'BTC-USDT-SWAP': BTC, 'ETH-USDT-SWAP': ETH, 'SOL-USDT-SWAP': SOL };
function okxFake({ cursor, calls = [], fail = {}, limit4 = 300, series = SERIES } = {}) {
  const ok = d => new Response(JSON.stringify({ code: '0', msg: '', data: d }), { status: 200 });
  return async url => {
    calls.push(url); const u = new URL(url), path = u.pathname.replace('/api/v5', ''), id = u.searchParams.get('instId');
    for (const [k, v] of Object.entries(fail)) if (url.includes(k)) return typeof v === 'function' ? v(url) : v;
    if (path === '/public/instruments') return ok(Object.keys(series).map(instId => ({ instId, state: 'live', ctType: 'linear', settleCcy: 'USDT', instCategory: '1' })));
    if (path === '/market/tickers') return ok(Object.keys(series).map(instId => ({ instId, last: '100', open24h: '99', volCcy24h: '100000' })));
    if (path !== '/market/candles') return new Response('', { status: 404 });
    const c = series[id], i = cursor(id); if (!c) return new Response('', { status: 404 });
    const s = c.slice(0, i + 1);
    if (u.searchParams.get('bar') === '1H') {
      const rows = s.map(x => row(x.t, x.o, x.h, x.l, x.c, '1', x.q)).reverse(); rows.unshift(row(s.at(-1).t + H1, 1, 9999, 0.5, 5000, '0'));   // 진행 중 봉(튀는 값)
      return ok(rows.slice(0, Number(u.searchParams.get('limit'))));
    }
    const c4 = aggregate(s), rows = c4.map(x => row(x.t, x.o, x.h, x.l, x.c, '1', x.q)).reverse(); rows.unshift(row(Math.floor((s.at(-1).t + H1) / H4) * H4 === c4.at(-1).t + H4 ? c4.at(-1).t + H4 : c4.at(-1).t + H4, 1, 9999, 0.5, 5000, '0'));
    return ok(rows.slice(0, Math.min(limit4, Number(u.searchParams.get('limit')))));
  };
}
const IDX = ethStage[3][0], NOW = i => ETH[i].t + H1 + 30000;      // 신호 봉 i가 막 마감된 시각(+30초)
const mkSend = (sent, failAt = []) => async (text, opt) => { if (failAt.includes(sent.length + 1)) { sent.push('FAIL'); sent.pop(); throw Object.assign(new Error('전송 실패'), { status: 500 }); } sent.push({ text, opt }); };
const env = (v) => ({ RADAR_OPPORTUNITY: v });

test('기능 플래그: 미설정·알 수 없는 값·off는 모두 꺼짐, 꺼져 있으면 네트워크 호출이 없다', async () => {
  for (const v of [undefined, '', 'off', 'OFF', 'true', '1', 'yes', 'enable']) assert.equal(modeOf({ RADAR_OPPORTUNITY: v }), 'off');
  assert.equal(modeOf({ RADAR_OPPORTUNITY: 'on' }), 'on'); assert.equal(modeOf({ RADAR_OPPORTUNITY: ' Preview ' }), 'preview'); assert.equal(modeOf({}), 'off');
  const calls = []; const state = {};
  const r = await opportunityStep({ now: NOW(IDX), state, env: {}, fetcher: okxFake({ cursor: () => IDX, calls }), send: async () => { throw new Error('전송되면 안 됨'); } });
  assert.equal(r.skipped, 'off'); assert.equal(calls.length, 0); assert.deepEqual(state, {});
  assert.equal((await opportunityStep({ now: NOW(IDX), state, env: env('on'), fetcher: okxFake({ cursor: () => IDX, calls }) })).skipped, 'no-sender');
});
test('운영 워크플로: 환경 변수는 기본 off이고 스케줄·트리거 설정은 그대로', () => {
  const yml = readFileSync(new URL('../../.github/workflows/radar.yml', import.meta.url), 'utf8');
  assert.match(yml, /RADAR_OPPORTUNITY: \$\{\{ vars\.RADAR_OPPORTUNITY \|\| 'off' \}\}/);
  assert.match(yml, /cron: '\*\/5 \* \* \* \*'/); assert.match(yml, /group: radar/);
});
test('전송 흐름: 정시 후 1회 수집·알림, 같은 시간대 재실행은 호출 없음, 다음 봉에서 같은 단계는 중복 알림 없음', async () => {
  const calls = [], sent = [], state = {}, saves = [];
  const common = { env: env('on'), send: mkSend(sent), save: async s => saves.push(JSON.stringify(s.opportunity)), gapMs: 0 };
  const r1 = await opportunityStep({ ...common, now: NOW(IDX), state, fetcher: okxFake({ cursor: () => IDX, calls }) });
  assert.ok(r1.sentMessages >= 1 && r1.events >= 2, JSON.stringify(r1));        // ETH(LONG 조건 충족) + SOL(SHORT 조건 충족)
  const text = sent.map(s => s.text).join('\n'); assert.match(text, /ETH/); assert.match(text, /SOL/); assert.match(text, /LONG 관찰/); assert.match(text, /SHORT 관찰/);
  assert.ok(sent.every(s => s.opt?.html === true)); assert.equal(state.opportunity.scanHour, Math.floor(NOW(IDX) / H1));
  assert.ok(calls.every(u => u.startsWith('https://www.okx.com/api/v5/') && /\/(public\/instruments|market\/tickers|market\/candles)/.test(u)), '공개 시세 조회 외 호출');
  const n0 = calls.length, s0 = sent.length;
  const r2 = await opportunityStep({ ...common, now: NOW(IDX) + 300000, state, fetcher: okxFake({ cursor: () => IDX, calls }) });
  assert.equal(r2.skipped, 'not-due'); assert.equal(calls.length, n0); assert.equal(sent.length, s0);
  const r3 = await opportunityStep({ ...common, now: NOW(IDX + 1), state, fetcher: okxFake({ cursor: () => IDX + 1, calls }) });
  const st = state.opportunity.coins; assert.ok(st.ETHUSDT.lastBarT === ETH[IDX + 1].t);
  const dup = sent.slice(s0).map(s => s.text).join('\n'); assert.ok(!/새 관찰: 조건 충족/.test(dup), '같은 단계가 중복 알림됨');
  assert.ok(r3.sentMessages >= 0);
});
test('연속 시간 시뮬레이션: 같은 (코인, 방향, 단계)가 해제 없이 두 번 알림되지 않는다', async () => {
  const sent = [], state = {}; let i = IDX - 30;
  for (; i < IDX + 40; i++) await opportunityStep({ env: env('on'), send: mkSend(sent), save: async () => {}, gapMs: 0, now: NOW(i), state, fetcher: okxFake({ cursor: () => i }) });
  const seen = new Map(); let bad = 0;
  for (const m of sent) for (const blk of m.text.split('\n\n')) {
    const head = blk.match(/<b>(\w+)<\/b> · <b>(LONG|SHORT) 관찰<\/b> — (새 관찰|단계 상승|방향 전환)[^:]*: ([^(]+) \(/); const clr = blk.match(/<b>(\w+)<\/b> · <b>(LONG|SHORT) 관찰<\/b> 해제/);
    if (clr) { seen.delete(clr[1]); continue; } if (!head) continue;
    const key = `${head[1]}|${head[2]}|${head[4].trim()}`; if (seen.get(head[1]) === key) bad++; seen.set(head[1], key);
  }
  assert.equal(bad, 0); assert.ok(sent.length >= 1 && sent.length <= 30, `전송 ${sent.length}건`);
});
test('API 실패: 목록 조회 실패는 분석·알림 없이 백오프, 제한 응답(429)은 즉시 중단하고 다음 시도를 늦춘다', async () => {
  const sent = [], state = {}, common = { env: env('on'), send: mkSend(sent), save: async () => {}, gapMs: 0, now: NOW(IDX), state };
  const f1 = await opportunityStep({ ...common, fetcher: okxFake({ cursor: () => IDX, fail: { 'market/tickers': new Response('', { status: 500 }) } }) });
  assert.ok(f1.failed && sent.length === 0); assert.ok(state.opportunity.retryAt > NOW(IDX)); assert.equal(state.opportunity.failures, 1); assert.deepEqual(state.opportunity.coins, {});
  assert.equal((await opportunityStep({ ...common, now: NOW(IDX) + 60000, fetcher: okxFake({ cursor: () => IDX }) })).skipped, 'backoff');
  const st2 = {}, calls = [];
  const f2 = await opportunityStep({ ...common, state: st2, fetcher: okxFake({ cursor: () => IDX, calls, fail: { 'instId=ETH-USDT-SWAP&bar=4H': new Response('', { status: 429, headers: { 'retry-after': '7' } }) } }) });
  assert.ok(f2.stopped && f2.stopped.status === 429 && sent.length === 0); assert.ok(st2.opportunity.retryAt >= NOW(IDX) + 300000); assert.ok(st2.opportunity.pending.length > 0);
  assert.equal(calls.filter(u => u.includes('SOL-USDT-SWAP')).length, 0, '제한 응답 뒤에도 호출을 계속함');
});
test('일부 종목 실패·데이터 부족·오래된 데이터는 분석 제외되고 나머지는 정상 처리(오탐 없음)', async () => {
  const sent = [], state = {}, short = { ...SERIES, 'SOL-USDT-SWAP': SOL.slice(0, 300) };         // SOL: 캔들 부족
  const r = await opportunityStep({ env: env('on'), send: mkSend(sent), save: async () => {}, gapMs: 0, now: NOW(IDX), state, fetcher: okxFake({ cursor: id => id === 'SOL-USDT-SWAP' ? 299 : IDX, series: short }) });
  assert.ok(r.excluded >= 1); assert.ok(!/<b>SOL<\/b>/.test(sent.map(s => s.text).join('')), '데이터 부족 종목이 관찰 알림으로 나옴');
  assert.equal(state.opportunity.coins.SOLUSDT, undefined); assert.match(sent.map(s => s.text).join(''), /데이터 점검/);
  const st2 = {}, r2 = await opportunityStep({ env: env('on'), send: mkSend([]), save: async () => {}, gapMs: 0, now: NOW(IDX), state: st2, fetcher: okxFake({ cursor: id => id === 'ETH-USDT-SWAP' ? IDX - 6 : IDX }) });   // ETH 데이터가 6시간 오래됨
  assert.equal(st2.opportunity.coins.ETHUSDT, undefined); assert.ok(r2.excluded >= 1);
  const gapFetch = async url => { const res = await okxFake({ cursor: () => IDX })(url); if (url.includes('ETH-USDT-SWAP&bar=1H')) { const body = await res.json(); body.data.splice(20, 3); return new Response(JSON.stringify(body)); } return res; };   // 중간 3봉 누락
  const st3 = {}; await opportunityStep({ env: env('on'), send: mkSend([]), save: async () => {}, gapMs: 0, now: NOW(IDX), state: st3, fetcher: gapFetch });
  assert.equal(st3.opportunity.coins.ETHUSDT, undefined, '누락 구간으로 분석함');
});
test('봉 확정 지연: 방금 마감한 봉이 아직 확정 전이면 알림 없이 대기 후 재시도, 확정되면 처리', async () => {
  const sent = [], state = {}, common = { env: env('on'), send: mkSend(sent), save: async () => {}, gapMs: 0, state };
  const r1 = await opportunityStep({ ...common, now: NOW(IDX), fetcher: okxFake({ cursor: () => IDX - 1 }) });        // 거래소가 아직 직전 봉을 확정하지 않음
  assert.equal(sent.length, 0); assert.ok(r1.pending >= 1); assert.notEqual(state.opportunity.scanHour, Math.floor(NOW(IDX) / H1));
  assert.equal((await opportunityStep({ ...common, now: NOW(IDX) + 60000, fetcher: okxFake({ cursor: () => IDX }) })).skipped, 'not-due');   // 재시도 간격 전
  const r2 = await opportunityStep({ ...common, now: NOW(IDX) + 300000, fetcher: okxFake({ cursor: () => IDX }) });
  assert.ok(r2.sentMessages >= 1); assert.equal(state.opportunity.scanHour, Math.floor(NOW(IDX) / H1)); assert.deepEqual(state.opportunity.pending, []);
});
test('Telegram 전송 실패: 상태를 확정하지 않아 다음 시도에서 한 번만 다시 알린다(누락·중복 모두 방지)', async () => {
  const sent = [], state = {};
  const r1 = await opportunityStep({ env: env('on'), send: mkSend(sent, [1]), save: async () => {}, gapMs: 0, now: NOW(IDX), state, fetcher: okxFake({ cursor: () => IDX }) });
  assert.ok(r1.sendError && sent.length === 0); assert.equal(state.opportunity.coins.ETHUSDT, undefined); assert.notEqual(state.opportunity.scanHour, Math.floor(NOW(IDX) / H1));
  const later = NOW(IDX) + 2 * 3600000 * 0 + 1200000;   // 백오프 이후(같은 시간대)
  const r2 = await opportunityStep({ env: env('on'), send: mkSend(sent), save: async () => {}, gapMs: 0, now: later, state, fetcher: okxFake({ cursor: () => IDX }) });
  assert.ok(r2.sentMessages >= 1 && sent.length >= 1); assert.equal(state.opportunity.coins.ETHUSDT.alertedStage, 3);
  const n = sent.length; await opportunityStep({ env: env('on'), send: mkSend(sent), save: async () => {}, gapMs: 0, now: later + 600000, state, fetcher: okxFake({ cursor: () => IDX }) });
  assert.equal(sent.length, n);
});
test('알림 코인 수 상한: 초과분은 보류했다가 다음 실행에서 보낸다', async () => {
  const many = {}; for (let k = 0; k < 20; k++) many[`C${k}-USDT-SWAP`] = ETH; many['BTC-USDT-SWAP'] = BTC;
  const sent = [], state = {}, common = { env: { ...env('on'), RADAR_OPPORTUNITY_TOP: '30' }, send: mkSend(sent), save: async () => {}, gapMs: 0, state };
  const r1 = await opportunityStep({ ...common, now: NOW(IDX), fetcher: okxFake({ cursor: () => IDX, series: many }) });
  assert.equal(r1.events, 20); assert.equal(r1.held, 20 - MAX_ALERT_COINS); assert.notEqual(state.opportunity.scanHour, Math.floor(NOW(IDX) / H1));
  const total1 = sent.flatMap(s => s.text.match(/<b>C\d+<\/b> · <b>LONG/g) ?? []).length; assert.equal(total1, MAX_ALERT_COINS);
  const r2 = await opportunityStep({ ...common, now: NOW(IDX) + 1200000, fetcher: okxFake({ cursor: () => IDX, series: many }) });
  assert.equal(r2.events, 20 - MAX_ALERT_COINS); assert.equal(state.opportunity.scanHour, Math.floor(NOW(IDX) / H1));
  const all = sent.flatMap(s => s.text.match(/<b>(C\d+)<\/b> · <b>LONG/g) ?? []); assert.equal(new Set(all).size, 20); assert.equal(all.length, 20);
});
test('미리보기: 전송·알림 상태 저장 없이 메시지와 요약만 만들고 같은 시간대에는 한 번만 실행', async () => {
  const sent = [], state = {}, calls = [];
  const r = await opportunityStep({ env: env('preview'), send: mkSend(sent), save: async () => {}, gapMs: 0, now: NOW(IDX), state, fetcher: okxFake({ cursor: () => IDX, calls }) });
  assert.equal(sent.length, 0); assert.ok(r.preview.messages.length >= 1 && r.preview.lines.length === 3); assert.deepEqual(state.opportunity.coins, {});
  const n = calls.length; assert.equal((await opportunityStep({ env: env('preview'), send: null, save: async () => {}, gapMs: 0, now: NOW(IDX) + 300000, state, fetcher: okxFake({ cursor: () => IDX, calls }) })).skipped, 'preview-done'); assert.equal(calls.length, n);
  const forced = await opportunityStep({ env: env('preview'), send: null, save: async () => {}, gapMs: 0, now: NOW(IDX) + 300000, state: {}, force: true, fetcher: okxFake({ cursor: () => IDX, calls }) }); assert.ok(forced.preview);
});
test('기존 운영과의 분리: 조용한 시간대·기존 레이더 백오프에서는 실행하지 않고, 손상된 상태는 안전하게 초기화되며, 예외는 밖으로 나가지 않는다', async () => {
  const f = okxFake({ cursor: () => IDX }), base = { env: env('on'), send: mkSend([]), save: async () => {}, gapMs: 0, now: NOW(IDX), fetcher: f };
  assert.equal((await opportunityStep({ ...base, state: { quiet: { hour: Math.floor(NOW(IDX) / H1), reason: 'x' } } })).skipped, 'quiet');
  assert.equal((await opportunityStep({ ...base, state: { retryAt: NOW(IDX) + 1000 } })).skipped, 'shared-backoff');
  for (const bad of [null, 'x', [], { v: 2 }, { v: 1, coins: [] }]) assert.deepEqual(normalize(bad).coins, {});
  assert.deepEqual(Object.keys(normalize({ v: 1, coins: { ETHUSDT: { stage: 9, dir: 'LONG', lastBarT: 1 }, 'bad<': { stage: 1 }, BTCUSDT: { stage: 1, dir: 'LONG', lastBarT: 5 } } }).coins), ['BTCUSDT']);
  const state = { opportunity: 'corrupt', rows: [1], sent: { a: 1 } }; await opportunityStep({ ...base, state });
  assert.equal(state.opportunity.v, 1); assert.deepEqual(state.rows, [1]); assert.deepEqual(state.sent, { a: 1 });       // 기존 상태 키는 건드리지 않는다
  const out = await runOpportunitySafe({ ...base, state: {}, collect: async () => { throw new Error('boom'); } }); assert.match(out.failed, /boom/);
  const slow = await runOpportunitySafe({ ...base, state: {}, timeoutMs: 20, collect: () => new Promise(() => {}) }); assert.match(slow.failed, /timeout/);
});
test('주문·레버리지 기능 없음: 소스에 거래/주문 API 호출이 없고 요청은 GET 공개 시세뿐이다', async () => {
  const dir = new URL('../opportunity/', import.meta.url), files = readdirSync(dir).filter(f => f.endsWith('.mjs'));
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    assert.ok(!/\/trade\/|\/account\/|set-leverage|placeOrder|order-algo|OK-ACCESS|api[-_ ]?secret|privateKey/i.test(src), `${f}: 거래/계정 API 흔적`);
    assert.ok(!/method\s*:\s*['"](POST|PUT|DELETE)/i.test(src), `${f}: 비 GET 요청`);
  }
  const calls = []; await collectOpportunity({ fetcher: okxFake({ cursor: () => IDX, calls }), now: NOW(IDX), gapMs: 0 });
  assert.ok(calls.length > 0 && calls.every(u => /^https:\/\/www\.okx\.com\/api\/v5\/(public\/instruments|market\/(tickers|candles))/.test(u)));
});
