import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { aggregate, H1, H4 } from '../opportunity/indicators.mjs';
import { analyzeCoin, doneIndex, trendSeries, trendInfo, CHECK_TOTAL, OPP } from '../opportunity/analysis.mjs';
import { transition, blank, seedEntry, CLEAR_N, COOLDOWN_MS } from '../opportunity/transition.mjs';
import { sortAlerts, alertRank } from '../opportunity/priority.mjs';
import { settings, DEFAULTS } from '../opportunity/config.mjs';
import { runAfterCycle } from '../opportunity/integrate.mjs';
import { cycle } from '../service.mjs';
import { T0, lcg, wave, mirror, at, N, ETH, SOL, BTC, find, ethStage, row, SERIES, okxFake, IDX, NOW, mkSend, env, rebase, aligned, mixed, fx, names, dayOf, thisHour, preState } from './opportunity-fixture.mjs';
import { formatAlerts, watchBlock, summaryLines, DISCLAIMER } from '../opportunity/message.mjs';
import { parseCandles, freshness, collectOpportunity } from '../opportunity/collect.mjs';
import { opportunityStep, runOpportunitySafe, modeOf, normalize } from '../opportunity/step.mjs';

globalThis.fetch = async url => { throw new Error(`테스트에서 실제 네트워크 호출 금지: ${url}`); };   // 주입하지 않은 호출이 있으면 즉시 실패

// ── 합성 데이터 ──

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
  for (let i = 1100; i < N; i += 2) {
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
function run(seq, start = null, t0 = 0, opts = { minStage: 1 }) {   // seq: [[stage, opts]] — 한 봉씩, 알림이 나가면 committed 저장(전송 성공 가정)
  let st = start, now = t0, events = [];
  seq.forEach(([stage, o], k) => {
    now += H1; const c = cur(stage, { barT: now - H1, ...o }); const t = transition(st, c, now, opts);
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
  const sent = [], state = {}; let i = IDX - 20;
  for (; i < IDX + 20; i++) await opportunityStep({ env: env('on'), send: mkSend(sent), save: async () => {}, gapMs: 0, now: NOW(i), state, fetcher: okxFake({ cursor: () => i }) });
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

// ════════ PR #27 안전성 보완: 최소 알림 단계 · 우선순위 · 상한 · 첫 실행 정책 · 실패·시간 초과 · 기존 운영 회귀 ════════

test('정렬 가능한 합성 시나리오가 있다(접근·눌림·충족이 4시간 정렬로 재배치 가능)', () => { for (const st of [1, 2, 3]) assert.ok(aligned(st) !== undefined, `stage ${st}`); });
test('설정: 잘못된 값은 안전한 기본값, 범위를 벗어나면 기본값', () => {
  assert.deepEqual(settings({}), { mode: 'off', topN: 20, minStage: 2, maxPerHour: 12, maxPerDay: 80, firstRun: 'summary' }); assert.equal(DEFAULTS.minStage, 2);
  assert.deepEqual(settings({ RADAR_OPPORTUNITY: 'on', RADAR_OPPORTUNITY_TOP: '30', RADAR_OPPORTUNITY_MIN_STAGE: '3', RADAR_OPPORTUNITY_MAX_PER_HOUR: '5', RADAR_OPPORTUNITY_MAX_PER_DAY: '40', RADAR_OPPORTUNITY_FIRST_RUN: 'SILENT' }), { mode: 'on', topN: 30, minStage: 3, maxPerHour: 5, maxPerDay: 40, firstRun: 'silent' });
  for (const bad of ['0', '4', 'x', '2.5', '-1', '', ' ']) assert.equal(settings({ RADAR_OPPORTUNITY_MIN_STAGE: bad }).minStage, 2, `MIN_STAGE=${JSON.stringify(bad)}`);
  assert.equal(settings({ RADAR_OPPORTUNITY_MAX_PER_HOUR: '31' }).maxPerHour, 12); assert.equal(settings({ RADAR_OPPORTUNITY_MAX_PER_DAY: '201' }).maxPerDay, 80); assert.equal(settings({ RADAR_OPPORTUNITY_FIRST_RUN: 'everything' }).firstRun, 'summary'); assert.equal(settings({ RADAR_OPPORTUNITY_TOP: '99' }).topN, 20);
});

test('1단계(구간 접근)는 기록만 하고 기본적으로 알리지 않는다 — 2단계부터 알림', () => {
  const t1 = transition(null, cur(1, { barT: 0 }), H1);                                  // 기본 minStage 2
  assert.equal(t1.event, null); assert.equal(t1.next.stage, 1); assert.equal(t1.next.alertedStage, 0);
  const r = run([[0], [1], [1], [2], [2], [3]], null, 0, { minStage: 2 });
  assert.deepEqual(r.events.map(e => [e.k, e.type, e.stage]), [[3, 'new', 2], [5, 'upgrade', 3]]);
  assert.deepEqual(run([[0], [1], [1], [0], [0]], null, 0, { minStage: 2 }).events, []);   // 1단계만 있다 끝난 관찰은 해제 알림도 없다
  assert.deepEqual(run([[0], [1], [1]], null, 0, { minStage: 1 }).events.map(e => e.type), ['new']);   // MIN_STAGE=1이면 접근 단계도 알림
  assert.equal(run([[0], [1], [2], [3]], null, 0, { minStage: 3 }).events.length, 1);
});
test('방향 전환 시 새 방향이 알림 단계 미만이면 이전 방향 관찰만 해제로 알린다(알림이 남지 않게)', () => {
  const r = run([[0], [3, { dir: 'LONG' }], [1, { dir: 'SHORT' }]], null, 0, { minStage: 2 });
  assert.deepEqual(r.events.map(e => e.type), ['new', 'cleared']); assert.equal(r.st.dir, 'SHORT'); assert.equal(r.st.alertedStage, 0);
});
test('첫 실행 기준선 항목: 알림 없이 현재 상태를 기록하고 이후 상승부터 알림, silent는 해제도 조용히', () => {
  const s = seedEntry(cur(2, { barT: 5 }), 100); assert.equal(s.alertedStage, 2); assert.equal(s.silentSeed, false);
  assert.equal(transition(s, cur(2, { barT: 6 }), 200 + H1).event, null);
  assert.equal(transition(s, cur(3, { barT: 6 }), 200 + H1).event.type, 'upgrade');
  const q = seedEntry(cur(2, { barT: 5 }), 100, { silent: true }); assert.equal(q.silentSeed, true);
  let st = q; for (let k = 0; k < CLEAR_N; k++) { const t = transition(st, cur(0, { barT: 6 + k }), 200 + k * H1); st = t.committed; assert.equal(t.event, null); }
  assert.equal(st.stage, 0);
  assert.equal(transition(q, cur(3, { barT: 6 }), 200 + H1).event.type, 'upgrade');
  assert.equal(seedEntry(cur(0, { barT: 5 }), 1).stage, 0);
});

test('알림 우선순위: 조건 충족 > 무효화 해제 > 방향 전환 > 눌림 > 일반 해제 > 접근, 같은 순위는 충족 개수·BTC 일치·종목명', () => {
  const mk = (symbol, type, stage, o = {}) => ({ symbol, event: { type, to: { stage } }, analysis: { stage, met: o.met ?? stage * 2, metrics: { btcAlign: o.btc ?? '중립' } } });
  const items = [mk('A1', 'new', 1), mk('B1', 'cleared', 0), mk('C1', 'new', 2), mk('D1', 'flip', 2), mk('E1', 'invalidated', 0), mk('F1', 'upgrade', 3, { met: 7 }), mk('F0', 'new', 3, { met: 7 }), mk('G1', 'new', 3, { met: 7, btc: '일치' }), mk('H1', 'new', 3, { met: 6 }), mk('I1', 'flip', 3)];
  assert.deepEqual(sortAlerts(items).map(i => i.symbol), ['G1', 'F0', 'F1', 'H1', 'I1', 'E1', 'D1', 'C1', 'B1', 'A1']);
  assert.deepEqual(sortAlerts(items).map(alertRank), [0, 0, 0, 0, 0, 1, 2, 3, 4, 5]);
  assert.deepEqual(sortAlerts([...items].reverse()).map(i => i.symbol), sortAlerts(items).map(i => i.symbol));   // 입력 순서와 무관(결정적)
});
test('상한 적용 전에 정렬: 조건 충족 3종목은 눌림 14종목에 밀리지 않고, 시간당 상한 12 안에서 눌림은 9칸까지(3칸 예비)', async () => {
  const sent = [], state = {}, series = mixed({ r: 3, w: 14 });
  const r = await opportunityStep({ env: env('on', { RADAR_OPPORTUNITY_TOP: '30' }), send: mkSend(sent), save: async () => {}, gapMs: 0, now: NOW(IDX), state, fetcher: fx(series) });
  const got = names(sent); assert.equal(got.length, 12); assert.deepEqual(got.slice(0, 3), ['R00', 'R01', 'R02']);
  assert.equal(got.filter(n => n.startsWith('R')).length, 3); assert.equal(got.filter(n => n.startsWith('W')).length, 9); assert.equal(r.held, 5);
  const o = state.opportunity; assert.deepEqual([o.sent.coins, o.sent.ready, o.sent.hour], [12, 3, thisHour]); const d = o.daily[dayOf(NOW(IDX))];
  assert.equal(d.coins, 12); assert.equal(d.ready, 3); assert.equal(d.held, 5); assert.equal(d.messages, sent.length); assert.ok(sent.length >= 2);
  assert.equal((await opportunityStep({ env: env('on', { RADAR_OPPORTUNITY_TOP: '30' }), send: mkSend(sent), save: async () => {}, gapMs: 0, now: NOW(IDX) + 600000, state, fetcher: fx(series) })).skipped, 'not-due');   // 같은 시간대 재실행 없음 → 보류분은 다음 시간대에
  assert.equal(names(sent).length, 12);
});
test('시간당 상한: 이미 보낸 수를 반영하고 조건 충족 예비 칸만 남으며, 시간이 바뀌면 초기화', async () => {
  const series = mixed({ r: 2, w: 5 }), common = { env: env('on', { RADAR_OPPORTUNITY_TOP: '30' }), save: async () => {}, gapMs: 0, now: NOW(IDX), fetcher: fx(series) };
  const s1 = [], st1 = preState({ sent: { hour: thisHour, coins: 9, ready: 0, messages: 3 } });          // 일반 알림 9칸을 이미 씀 → 눌림 알림은 막히고 조건 충족 예비 3칸만
  const r1 = await opportunityStep({ ...common, send: mkSend(s1), state: st1 });
  assert.deepEqual(names(s1), ['R00', 'R01']); assert.equal(r1.held, 5); assert.equal(st1.opportunity.sent.coins, 11);
  const s2 = [], st2 = preState({ sent: { hour: thisHour, coins: 12, ready: 3, messages: 4 } });         // 상한 소진 → 모두 보류
  const r2 = await opportunityStep({ ...common, send: mkSend(s2), state: st2 }); assert.equal(s2.length, 0); assert.equal(r2.held, 7); assert.equal(st2.opportunity.scanHour, thisHour);
  const s3 = [], st3 = preState({ sent: { hour: thisHour - 1, coins: 12, ready: 3, messages: 4 } });     // 지난 시간대 기록 → 초기화
  await opportunityStep({ ...common, send: mkSend(s3), state: st3 }); assert.equal(names(s3).length, 7); assert.equal(st3.opportunity.sent.hour, thisHour);
  const s4 = [], st4 = {}; await opportunityStep({ ...common, env: env('on', { RADAR_OPPORTUNITY_TOP: '30', RADAR_OPPORTUNITY_MAX_PER_HOUR: '3' }), send: mkSend(s4), state: st4 });
  assert.equal(names(s4).length, 3); assert.deepEqual(names(s4).slice(0, 2), ['R00', 'R01']);               // 상한이 작으면 예비 칸도 1/4(0칸)로 줄어도 조건 충족이 우선
});
test('일일 상한·발송량 기록: 일일 상한 소진 시 모두 보류, 기록은 14일만 보관', async () => {
  const series = mixed({ r: 3, w: 3 }), key = dayOf(NOW(IDX)), common = { env: env('on', { RADAR_OPPORTUNITY_TOP: '30', RADAR_OPPORTUNITY_MAX_PER_DAY: '5' }), save: async () => {}, gapMs: 0, now: NOW(IDX), fetcher: fx(series) };
  const s1 = [], st1 = preState({ daily: { [key]: { coins: 5, messages: 2, ready: 1, held: 0, baseline: 0, failures: 0 } } });
  const r1 = await opportunityStep({ ...common, send: mkSend(s1), state: st1 }); assert.equal(s1.length, 0); assert.equal(r1.held, 6); assert.equal(st1.opportunity.daily[key].held, 6);
  const s2 = [], st2 = preState({ daily: { [key]: { coins: 3, messages: 1, ready: 0, held: 0, baseline: 0, failures: 0 } } });
  await opportunityStep({ ...common, send: mkSend(s2), state: st2 }); assert.deepEqual(names(s2), ['R00', 'R01']); assert.equal(st2.opportunity.daily[key].coins, 5);   // 남은 2칸은 조건 충족이 사용
  const old = Object.fromEntries(Array.from({ length: 30 }, (_, k) => [dayOf(NOW(IDX) - (k + 1) * 86400000), { coins: 1, messages: 1, ready: 0, held: 0, baseline: 0, failures: 0 }]));
  const st3 = preState({ daily: old }); await opportunityStep({ ...common, env: env('on', { RADAR_OPPORTUNITY_TOP: '30' }), send: mkSend([]), state: st3 }); assert.ok(Object.keys(st3.opportunity.daily).length <= 14);
});
test('1단계는 단계 판정(watching)에는 포함되지만 기본 설정에서는 전송되지 않고 상태에 기록되며, MIN_STAGE=1이면 전송', async () => {
  const series = mixed({ a: 2 }), sent = [], state = {};
  const r = await opportunityStep({ env: env('on', { RADAR_OPPORTUNITY_TOP: '30' }), send: mkSend(sent), save: async () => {}, gapMs: 0, now: NOW(IDX), state, fetcher: fx(series) });
  assert.equal(sent.length, 0); assert.equal(r.events, 0); assert.ok(r.watching >= 2); assert.equal(state.opportunity.coins.A00USDT.stage, 1); assert.equal(state.opportunity.coins.A00USDT.alertedStage, 0);
  const s2 = [], st2 = {}; await opportunityStep({ env: env('on', { RADAR_OPPORTUNITY_TOP: '30', RADAR_OPPORTUNITY_MIN_STAGE: '1' }), send: mkSend(s2), save: async () => {}, gapMs: 0, now: NOW(IDX), state: st2, fetcher: fx(series) });
  assert.equal(names(s2).length, 2); assert.match(s2.map(m => m.text).join(''), /구간 접근 중/);
});

// ── 첫 실행 정책 ──
const bothDir = () => SERIES;
test('첫 실행(기본 summary): 기존 관찰은 알림 없이 기준선으로 기록하고 요약 1건만 보낸다 — 이후 같은 단계는 알리지 않는다', async () => {
  const sent = [], state = {}, common = { env: env('on', { RADAR_OPPORTUNITY_FIRST_RUN: 'summary' }), send: mkSend(sent), save: async () => {}, gapMs: 0, state };
  const r = await opportunityStep({ ...common, now: NOW(IDX), fetcher: okxFake({ cursor: () => IDX }) });
  assert.equal(r.baseline, true); assert.equal(sent.length, 1); assert.equal(r.sentMessages, 1); const t = sent[0].text;
  assert.match(t, /활성화 기준선/); assert.match(t, /LONG 관찰 1종목: ETH\(조건 충족\)/); assert.match(t, /SHORT 관찰 1종목: SOL\(조건 충족\)/); assert.ok(!/새 관찰:|단계 상승:|방향 전환:/.test(t));
  const o = state.opportunity; assert.equal(o.baselineDone, true); assert.equal(o.scanHour, thisHour); assert.equal(o.coins.ETHUSDT.alertedStage, 3); assert.equal(o.coins.ETHUSDT.silentSeed, false); assert.equal(o.daily[dayOf(NOW(IDX))].baseline, 2); assert.equal(o.daily[dayOf(NOW(IDX))].coins, 0);
  const r2 = await opportunityStep({ ...common, now: NOW(IDX + 1), fetcher: okxFake({ cursor: () => IDX + 1 }) });     // 다음 봉: 같은 단계는 알리지 않는다
  const later = sent.slice(1).map(m => m.text).join(''); assert.ok(!/새 관찰:|단계 상승:|방향 전환:/.test(later), later.slice(0, 300)); assert.equal(r2.baseline, false);
});
test('첫 실행 silent: 요약도 보내지 않고, alert: 일반 규칙(우선순위·시간당 상한)으로 알림', async () => {
  const s1 = [], st1 = {}; const r1 = await opportunityStep({ env: env('on', { RADAR_OPPORTUNITY_FIRST_RUN: 'silent' }), send: mkSend(s1), save: async () => {}, gapMs: 0, now: NOW(IDX), state: st1, fetcher: okxFake({ cursor: () => IDX }) });
  assert.equal(s1.length, 0); assert.equal(r1.baseline, true); assert.equal(st1.opportunity.baselineDone, true); assert.equal(st1.opportunity.coins.ETHUSDT.silentSeed, true);
  const series = mixed({ r: 3, w: 14 }), s2 = [], st2 = {}; const r2 = await opportunityStep({ env: env('on', { RADAR_OPPORTUNITY_TOP: '30', RADAR_OPPORTUNITY_FIRST_RUN: 'alert' }), send: mkSend(s2), save: async () => {}, gapMs: 0, now: NOW(IDX), state: st2, fetcher: fx(series) });
  assert.equal(r2.baseline, false); assert.equal(names(s2).length, 12); assert.deepEqual(names(s2).slice(0, 3), ['R00', 'R01', 'R02']); assert.equal(st2.opportunity.baselineDone, true);
});
test('preview → on 전환: 미리보기는 기준선 동작을 보여 주기만 하고, 처음 on 실행은 대량 발송 없이 요약 1건', async () => {
  const state = {}, sent = [], series = mixed({ r: 3, w: 14 });
  const p = await opportunityStep({ env: env('preview', { RADAR_OPPORTUNITY_TOP: '30', RADAR_OPPORTUNITY_FIRST_RUN: 'summary' }), send: null, save: async () => {}, gapMs: 0, now: NOW(IDX), state, fetcher: fx(series) });
  assert.equal(p.baseline, true); assert.match(p.preview.note, /기준선으로 기록/); assert.match(p.preview.messages[0], /활성화 기준선/); assert.ok(p.preview.messages.length >= 2 && /LONG 관찰/.test(p.preview.messages[1]) && !/활성화 기준선/.test(p.preview.messages[1])); assert.deepEqual(state.opportunity.coins, {}); assert.equal(state.opportunity.baselineDone, false);
  const r = await opportunityStep({ env: env('on', { RADAR_OPPORTUNITY_TOP: '30', RADAR_OPPORTUNITY_FIRST_RUN: 'summary' }), send: mkSend(sent), save: async () => {}, gapMs: 0, now: NOW(IDX), state, fetcher: fx(series) });
  assert.equal(sent.length, 1); assert.equal(r.baseline, true); assert.equal(names(sent).length, 0); assert.match(sent[0].text, /LONG 관찰 17종목/);
});
test('캐시 유실·상태 손상 뒤에도 대량 재발송 없음(기준선 재적용), 기준선 요약 전송 실패는 기준선만 확정하고 요약만 재시도', async () => {
  const state = {}, sent = [], common = { env: env('on', { RADAR_OPPORTUNITY_FIRST_RUN: 'summary' }), save: async () => {}, gapMs: 0, state };
  await opportunityStep({ ...common, send: mkSend(sent), now: NOW(IDX), fetcher: okxFake({ cursor: () => IDX }) }); assert.equal(sent.length, 1);
  state.opportunity = { v: 1, coins: 'garbage' };                                                    // 캐시 손상
  const later = NOW(IDX) + 1200000; await opportunityStep({ ...common, send: mkSend(sent), now: later, fetcher: okxFake({ cursor: () => IDX }), force: true });
  assert.equal(sent.length, 2); assert.match(sent[1].text, /활성화 기준선/); assert.equal(names(sent).length, 0);
  const st2 = {}, s2 = []; const f = await opportunityStep({ ...common, state: st2, send: mkSend(s2, [1]), now: NOW(IDX), fetcher: okxFake({ cursor: () => IDX }) });
  assert.ok(f.sendError); assert.equal(st2.opportunity.baselineDone, true); assert.equal(st2.opportunity.baselineNotice, 'pending'); assert.ok(st2.opportunity.coins.ETHUSDT.alertedStage === 3);   // 기준선은 요약보다 먼저 저장됨
  assert.equal(st2.opportunity.inflight, null); assert.equal(st2.opportunity.rescanHour, thisHour);
  await opportunityStep({ ...common, state: st2, send: mkSend(s2), now: NOW(IDX) + 1200000, fetcher: okxFake({ cursor: () => IDX }) }); assert.equal(s2.length, 1); assert.equal(st2.opportunity.baselineNotice, 'sent'); assert.equal(names(s2).length, 0);
  const st3 = {}, s3 = []; const stale = await opportunityStep({ ...common, state: st3, send: mkSend(s3), now: NOW(IDX), fetcher: okxFake({ cursor: () => IDX - 8 }) });   // 모두 오래된 데이터 → 기준선 보류
  assert.equal(s3.length, 0); assert.equal(st3.opportunity?.baselineDone ?? false, false); assert.equal(stale.baseline, false);
});

// ── 실패·시간 초과 ──
test('상태 저장 실패: 장부를 저장할 수 없으면 보내지 않고, 전송 뒤 기록 저장이 실패하면 더 보내지 않으며(중복 확대 방지) 예외 없이 기록, 복구되면 나머지만 한 번씩', async () => {
  const series = mixed({ r: 10 }), sent = [], state = {}, opts = { env: env('on', { RADAR_OPPORTUNITY_TOP: '30', RADAR_OPPORTUNITY_MAX_PER_HOUR: '30' }), gapMs: 0, state, fetcher: fx(series) };
  const r0 = await runOpportunitySafe({ ...opts, now: NOW(IDX), send: mkSend(sent), save: async () => { throw new Error('disk full'); } });   // 저장 전부 실패 → 전송 없음
  assert.equal(r0.sentMessages, 0); assert.match(r0.saveError, /disk full/); assert.equal(sent.length, 0);
  let n = 0;                                                                                          // 첫 저장(장부)은 성공, 전송 뒤 저장은 실패
  const r1 = await runOpportunitySafe({ ...opts, now: NOW(IDX) + 300000, send: mkSend(sent), save: async () => { if (++n >= 2) throw new Error('disk full'); } });
  assert.equal(sent.length, 1); assert.match(r1.saveError, /disk full/); assert.ok(state.opportunity.rescanHour === thisHour && state.opportunity.scanHour !== thisHour);
  const first = names(sent); assert.ok(first.length >= 1 && first.length < 10);
  const r2 = await runOpportunitySafe({ ...opts, now: NOW(IDX) + 600000, send: mkSend(sent), save: async () => {} });
  assert.equal(r2.saveError, null); const all = names(sent); assert.equal(all.length, 10); assert.equal(new Set(all).size, 10);
  assert.equal(state.opportunity.scanHour, thisHour); assert.equal(state.opportunity.inflight, null);
});
test('Telegram 부분 실패: 성공한 메시지의 코인만 확정, 실패분은 다음 시도에서 한 번만; 429는 Retry-After 반영', async () => {
  const series = mixed({ r: 10 }), sent = [], state = {}, opts = { env: env('on', { RADAR_OPPORTUNITY_TOP: '30', RADAR_OPPORTUNITY_MAX_PER_HOUR: '30' }), gapMs: 0, state, fetcher: fx(series), save: async () => {} };
  const r1 = await opportunityStep({ ...opts, now: NOW(IDX), send: mkSend(sent, [2]) });
  assert.equal(r1.sentMessages, 1); assert.ok(r1.sendError); const done = names(sent); assert.ok(done.length >= 1 && done.length < 10);
  for (const n of done) assert.equal(state.opportunity.coins[`${n}USDT`].alertedStage, 3);
  assert.equal(Object.values(state.opportunity.coins).filter(c => c.alertedStage === 3).length, done.length);
  assert.equal((await opportunityStep({ ...opts, now: NOW(IDX) + 300000, send: mkSend(sent) })).skipped, 'backoff');
  await opportunityStep({ ...opts, now: NOW(IDX) + 1300000, send: mkSend(sent) }); const all = names(sent); assert.equal(all.length, 10); assert.equal(new Set(all).size, 10);
  const st2 = {}, rate = Object.assign(new ApiErrorLike(429, 900)); const r2 = await opportunityStep({ ...opts, state: st2, now: NOW(IDX), send: async () => { throw rate; } });
  assert.ok(r2.sendError); assert.ok(st2.opportunity.retryAt >= NOW(IDX) + 900000); assert.equal(st2.opportunity.lastSendStatus, 429);
});
function ApiErrorLike(status, retryAfter) { const e = new Error(`api.telegram.org HTTP ${status}`); e.status = status; e.retryAfter = retryAfter; return e; }
test('시간 초과: 전송이 끝나지 않으면 래퍼가 제한 시간에 실패로 돌려준다 (세부 경계는 opportunity-stability.test.mjs)', async () => {
  const state = {}, hang = await runOpportunitySafe({ env: env('on'), now: NOW(IDX), state, send: () => new Promise(() => {}), save: async () => {}, gapMs: 0, fetcher: okxFake({ cursor: () => IDX }), timeoutMs: 150 });
  assert.match(hang.failed, /timeout/);
});

// ── 기존 운영 회귀 ──
const MAIN_NOW = 1800000000000;
const rawMain = () => ({
  klines: Array.from({ length: 60 }, (_, i) => { const t = MAIN_NOW - (60 - i) * 300000, c = i === 59 ? 102 : 100 + i / 100; return [t, c - .2, c + .3, c - .3, c, 1, t + 299999, i === 59 ? 300 : 100]; }),
  premium: { symbol: 'BTCUSDT', markPrice: '101.2', lastFundingRate: '0.0001', time: MAIN_NOW }, oi: { symbol: 'BTCUSDT', openInterest: '103', time: MAIN_NOW },
  history: [{ timestamp: MAIN_NOW - 900000, sumOpenInterest: '100', sumOpenInterestValue: '10000' }],
});
async function mainScenario(oppEnv, oppOpts = {}) {
  const { analyze } = await import('../analysis.mjs'), msgs = [], opp = [], state = {}, row = { ...analyze('BTCUSDT', rawMain(), MAIN_NOW), strong: true };
  const save = async () => {}, options = { collect: async () => ({ rows: [row], failures: [] }), send: async t => msgs.push(t), save };
  for (const dt of [0, 300000, 3600000, 3900000]) {
    await cycle({ ...options, now: MAIN_NOW + dt, state });
    if (oppEnv) await runAfterCycle({ state, save, send: async t => opp.push(t), env: oppEnv, out: () => {}, now: NOW(IDX) + dt, gapMs: 0, ...oppOpts });
  }
  const { opportunity, ...rest } = state; return { msgs, opp, rest, opportunity };
}
test('기존 레이더 회귀: 플래그 off면 정기 보고·상태가 완전히 같고 opportunity 키도 생기지 않는다', async () => {
  const base = await mainScenario(null), off = await mainScenario({}), explicit = await mainScenario({ RADAR_OPPORTUNITY: 'off' });
  assert.ok(base.msgs.length >= 2); assert.deepEqual(off.msgs, base.msgs); assert.deepEqual(off.rest, base.rest); assert.equal(off.opportunity, undefined); assert.deepEqual(explicit.msgs, base.msgs); assert.equal(explicit.opportunity, undefined);
});
test('기존 레이더 회귀: 기회 레이더가 켜져 있어도(실패·시간 초과·정상 모두) 정기 보고 메시지와 기존 상태는 그대로이고 전송은 분리된다', async () => {
  const base = await mainScenario(null);
  const failing = await mainScenario(env('on'), { fetcher: async () => { throw new Error('network down'); } });          // OKX 전부 실패
  const throwing = await mainScenario(env('on'), { collect: async () => { throw new Error('boom'); }, fetcher: okxFake({ cursor: () => IDX }) });   // 단계 내부 예외
  const working = await mainScenario(env('on'), { fetcher: okxFake({ cursor: () => IDX }) });                                // 정상 동작
  for (const r of [failing, throwing, working]) { assert.deepEqual(r.msgs, base.msgs); assert.deepEqual(r.rest, base.rest); }
  assert.equal(failing.opp.length, 0); assert.equal(throwing.opp.length, 0); assert.ok(working.opp.length >= 1);
  assert.ok(base.msgs.every(m => !String(m).includes('기회 포착 레이더')), '정기 보고에 기회 레이더 문구가 섞임');
  assert.ok(working.opp.length >= 1 && working.opportunity.baselineDone === true);
});
test('운영 연결 정적 점검: 게이트·연결 확인·스케줄 경로에서는 호출하지 않고, 워크플로 핵심 설정과 환경 변수 이름이 일치한다', () => {
  const run = readFileSync(new URL('../run.mjs', import.meta.url), 'utf8'), gate = run.slice(run.indexOf("if (args.has('--gate'))"), run.indexOf("} else if (args.has('--preview')")), tg = run.slice(run.indexOf("} else if (args.has('--telegram-test'))"), run.indexOf('} else {', run.indexOf("--telegram-test")));
  assert.ok(!/opportunity/i.test(gate) && !/opportunity/i.test(tg));
  assert.ok(run.indexOf('await opportunity({ send })') > run.indexOf('await cycle('));
  const yml = readFileSync(new URL('../../.github/workflows/radar.yml', import.meta.url), 'utf8');
  for (const need of ["cron: '*/5 * * * *'", 'timeout-minutes: 8', 'group: radar', 'cancel-in-progress: false', 'run: node radar-service/run.mjs --"$MODE"', 'node --test radar-service/test/*.test.mjs scheduler/test/*.test.mjs', "if: github.repository == 'j01044459979-prog/coin-radar'", 'RADAR_SCHEDULER: ${{ vars.RADAR_SCHEDULER || \'github\' }}']) assert.ok(yml.includes(need), need);
  const cfg = readFileSync(new URL('../opportunity/config.mjs', import.meta.url), 'utf8'), used = new Set([...cfg.matchAll(/env\??\.(RADAR_OPPORTUNITY\w*)/g)].map(m => m[1]));
  assert.ok(used.size >= 6); for (const v of used) assert.match(yml, new RegExp(`${v}: \\$\\{\\{ vars\\.${v} \\|\\| '[^']+' \\}\\}`), v);
  assert.match(yml, /RADAR_OPPORTUNITY: \$\{\{ vars\.RADAR_OPPORTUNITY \|\| 'off' \}\}/); assert.match(yml, /RADAR_OPPORTUNITY_MIN_STAGE: \$\{\{ vars\.RADAR_OPPORTUNITY_MIN_STAGE \|\| '2' \}\}/);
  assert.match(yml, /RADAR_OPPORTUNITY_FIRST_RUN: \$\{\{ vars\.RADAR_OPPORTUNITY_FIRST_RUN \|\| 'summary' \}\}/);
  assert.equal(yml.match(/schedule:/g).length, 1);
});
