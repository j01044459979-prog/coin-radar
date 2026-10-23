import { mkdir, readFile, writeFile, rename, appendFile } from 'node:fs/promises';
import { evaluate, slotOfTime } from './gate.mjs';
import { createCollector, cycle, telegramPhotoSender, telegramSender } from './service.mjs';
import { buildSvg, chartCaption, chartPlan, renderChart, renderPng } from './chart.mjs';
import { createOkxCollector } from './okx.mjs';
import { fullReportParts, reportParts } from './report.mjs';
import { visibleLength } from './format.mjs';
import { refreshNews } from './news.mjs';
import { modeOf } from './opportunity/config.mjs';           // opportunity radar (feature flag RADAR_OPPORTUNITY, default off)
import { runAfterCycle } from './opportunity/integrate.mjs';
import { runSignalAfterCycle } from './signal/integrate.mjs';   // 실시간 신호(feature flag RADAR_SIGNAL, default off)

// 모드: --preview(수집·출력만) | --once(1회 실행, GitHub Actions용) | --telegram-test(연결 확인 메시지 1건) | 기본(상시 루프)
const args = new Set(process.argv.slice(2));
const directory = process.env.RADAR_STATE_DIR || '/data';
await mkdir(directory, { recursive: true, mode: 0o700 });
let state = {}, recoveredNow = false;
try { state = JSON.parse(await readFile(`${directory}/state.json`, 'utf8')); if (!state || typeof state !== 'object' || Array.isArray(state)) throw new SyntaxError('state is not an object'); }
catch (error) {
  if (error.code !== 'ENOENT') {
    // 손상된 상태가 가장 최근 캐시로 남아 레이더 전체를 영구 정지시키지 않도록: 원본은 보존하고 새 상태로 시작한다(정기 보고 1회 중복 가능).
    const kept = `state.corrupt-${Date.now()}.json`;
    await rename(`${directory}/state.json`, `${directory}/${kept}`).catch(() => {});
    state = { recovery: { reason: 'corrupt-state', keptAs: kept, at: Date.now() } }; recoveredNow = true;
    console.log(`::warning title=레이더 상태 손상::상태 파일을 읽지 못해 새 상태로 시작합니다(원본 ${kept} 보존). 중복 전송을 막기 위해 이번 시간대 Telegram 전송은 생략하고 다음 시간대부터 재개합니다.`);
  }
}
const save = async data => {
  data.seq = (Number(data.seq) || 0) + 1; data.savedAt = Date.now(); // 저장 순서 추적(어느 캐시가 복원됐는지 로그로 확인)
  await writeFile(`${directory}/state.tmp`, JSON.stringify(data), { mode: 0o600 });
  await rename(`${directory}/state.tmp`, `${directory}/state.json`);
};
// 기본 출처는 OKX. Binance 선택은 접근 가능한 네트워크에서만 쓰며 다른 거래소 가격을 대신 쓰지 않는다.
const collect = process.env.RADAR_SOURCE === 'binance' ? createCollector() : createOkxCollector();
const news = (st, now) => refreshNews(st, now);
const tokenConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
// Opportunity radar runs after the regular cycle and never throws; it is a no-op unless RADAR_OPPORTUNITY=preview|on.
const opportunity = options => runAfterCycle({ state, save, env: process.env, ...options }).catch(() => null);
// Signal (15m trigger) runs after the opportunity radar and never throws; it is a no-op unless RADAR_SIGNAL=preview|on.
const signal = options => runSignalAfterCycle({ state, save, env: process.env, ...options }).catch(() => null);

if (args.has('--gate')) {
  // 실행 여부 판단만 한다(수집·전송 없음). 결과는 GITHUB_OUTPUT의 run=true|false, alert=true|false.
  const now = Date.now();
  const before = JSON.stringify([state.quiet, state.degraded]);
  const d = evaluate({ source: process.env.RADAR_SOURCE_EVENT, scheduler: process.env.RADAR_SCHEDULER, state, now, slot: process.env.RADAR_SLOT, cacheStatus: process.env.RADAR_CACHE_STATUS, recovered: recoveredNow });
  console.log(`GATE ${d.run ? '실행' : '건너뜀'} · 출처=${process.env.RADAR_SOURCE_EVENT} · 슬롯=${d.slot} · 스케줄러=${d.mode} · 직전 시도 ${d.ageMs === null ? '없음' : Math.round(d.ageMs / 1000) + '초 전'} · ${d.reason} · 복원된 상태 seq=${state.seq ?? '없음'} savedAt=${state.savedAt ? new Date(state.savedAt).toISOString() : '없음'} · 캐시 판정=${process.env.RADAR_CACHE_STATUS || '없음'}`);
  // 이상 상태(캐시 확인 불가·오래된 캐시·손상 복구)는 로그와 요약에서 바로 보이게 남긴다.
  if (d.kind) {
    console.log(`::warning title=레이더 상태 연속성 경고 (${d.kind})::${d.kind} 상태 ${d.degradedHours}시간째${d.quiet ? ` · 이번 시간대 Telegram 전송 억제(${d.quiet})` : ' · 전송은 정상 진행'}`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### ⚠️ 레이더 상태 연속성 경고\n- 종류: \`${d.kind}\` · 지속 ${d.degradedHours}시간\n- Telegram: ${d.quiet ? `이번 시간대 전송 억제(\`${d.quiet}\`)` : '정상 진행'}\n- 조치: 캐시 확인 API 장애면 GitHub 상태를 확인하세요. 3시간 넘게 이어지면 이 실행이 실패로 표시됩니다.\n`).catch(() => {});
  }
  if (d.quiet) console.log(`::warning title=Telegram 전송 억제::${d.quiet}: 이번 시간대(UTC 기준 ${state.quiet.hour}) 정기 보고·긴급 알림을 보내지 않고 상태만 복구합니다.`);
  if (d.alert) console.log(`::error title=레이더 이상 상태 장기화::${d.alert}`);
  if (JSON.stringify([state.quiet, state.degraded]) !== before) await save(state);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `run=${d.run}\nalert=${Boolean(d.alert)}\n`);
} else if (args.has('--preview') || (args.has('--once') && !tokenConfigured)) {
  if (args.has('--once')) console.log('Telegram 비밀값 미설정: 수집·분석만 실행하고 전송/상태 저장은 하지 않습니다.');
  const now = Date.now();
  const { rows, failures, stats, charts } = await collect(now);
  const preview = {};
  try { await refreshNews(preview, now); } catch (error) { console.log(`뉴스 수집 실패(격리됨): ${error.message}`); }
  const sc = stats?.scan;
  if (sc) {
    console.log(`SCAN 전체 적격 ${sc.eligible} / 정밀 대상 ${sc.targets} / 분석 성공 ${sc.analyzed} / 실패 ${sc.failed} / 시간부족 건너뜀 ${sc.skipped} / 제한응답 ${JSON.stringify(sc.stopped)}`);
    for (const [g, v] of Object.entries(sc.groups)) console.log(`SCAN 그룹 ${g}(${v.length}): ${v.join(', ')}`);
    console.log(`SCAN 유동성 기준 ${sc.minTurnover} USDT 미만 제외 ${sc.liquidityExcluded}종목 · 24h 거래대금 분포 ${JSON.stringify(sc.turnoverPct)}`);
    console.log(`SCAN 순환 ${JSON.stringify(sc.rotation)} · API 호출 ${stats.calls} · 수집 ${stats.ms}ms · 상위 시간대 ${stats.mtfSymbols.length}종목`);
  }
  const u = stats?.universe;
  if (u) {
    console.log(`감시 종목(${u.selected.length}/${u.eligible} 적격): ${u.selected.join(', ')}`);
    console.log(`우선 감시 상태: ${JSON.stringify(u.priority)}`);
    console.log(`제외 사유 집계: ${JSON.stringify(u.reasons)} · 분류 분포: ${JSON.stringify(u.categories)}`);
    for (const e of u.excluded) console.log(`제외: ${e.id} — ${e.reason}`);
  }
  // 차트: 선택 규칙·시간봉 선택 이유를 로그로 남기고, 첫 차트는 확인용으로 base64를 출력한다(프리뷰 전용, 전송 없음).
  const items = [];
  const timing = { collectMs: stats?.ms ?? null, svgMs: [], pngMs: [] };
  // 거래대금 단위 점검(실데이터): 마지막 캔들의 volCcyQuote/volCcy(평균 체결가)가 종가 근처인지 로그로 확인한다.
  for (const [sym, tf] of [['BTCUSDT', '1H'], ['BTCUSDT', '4H'], ['BTCUSDT', '5m']]) { const c = charts?.[sym]?.[tf]?.at(-1); if (c) console.log(`거래량 단위 점검 ${sym} ${tf}: q(USDT)=${c.q} v(기초자산)=${c.v} q/v=${c.q && c.v ? (c.q / c.v).toFixed(2) : '-'} 종가=${c.c} 고저=[${c.l}, ${c.h}]`); }
  for (const spec of chartPlan(rows, charts)) {
    if (spec.skipped) { console.log(`차트 생략: ${spec.symbol} — ${spec.skipped}`); items.push({ symbol: spec.symbol, png: null, error: spec.skipped }); continue; }
    const t0 = performance.now();
    try {
      const svg = buildSvg(spec), t1 = performance.now();
      const png = await renderPng(svg), t2 = performance.now();
      timing.svgMs.push(Math.round(t1 - t0)); timing.pngMs.push(Math.round(t2 - t1));
      const pf = spec.profile;
      console.log(`차트 생성: ${spec.rank ?? '-'}순위 ${spec.symbol} ${spec.tf} (${spec.reason}) PNG ${png.length}바이트 · SVG ${Math.round(t1 - t0)}ms + PNG ${Math.round(t2 - t1)}ms · 거래량 유효 ${spec.vol?.ok}/${spec.candles.length}봉 · POC ${pf ? pf.poc.mid.toPrecision(6) : '없음'} · 관찰 구간 ${pf ? pf.zones.length : 0}개\n캡션:\n${chartCaption(spec)}`);
      items.push({ symbol: spec.symbol, tf: spec.tf, kind: spec.kind, png, caption: chartCaption(spec) });
      console.log(`CHART_PNG_BASE64_BEGIN ${items.filter(i => i.png).length}\n${png.toString('base64')}\nCHART_PNG_BASE64_END`);
    } catch (error) { console.log(`차트 실패(격리됨): ${spec.symbol} — ${error.message}`); items.push({ symbol: spec.symbol, png: null, error: error.message }); }
  }
  // 기본 정기 보고(실제 전송되는 형식): 압축 본문 1개 + 차트 1장. 보이는 글자 수와 HTML 원문을 함께 기록한다.
  const parts = reportParts(rows, failures, now, { news: preview.news, scan: stats?.scan ?? null, charts: items });
  parts.forEach((p, i) => console.log(p.type === 'text'
    ? `===== [기본 보고] 메시지 ${i + 1}/${parts.length} 텍스트 (보이는 글자 ${visibleLength(p.text)}자, HTML ${p.text.length}자) =====\n${p.plain}\n----- HTML 원문 -----\n${p.text}`
    : `===== [기본 보고] 메시지 ${i + 1}/${parts.length} 사진 ${p.symbol} ${p.tf ?? ''} ${p.png ? '(PNG)' : `(생략: ${p.error})`} =====\n캡션: ${p.caption ?? ''}`));
  // 전체 분석(2.1 형식)은 정기 보고에 자동 발송하지 않는다. 프리뷰에서만 확인용으로 출력한다.
  const full = fullReportParts(rows, failures, now, { news: preview.news, charts: [] });
  console.log(`===== [전체 분석 · 자동 발송 안 함] 텍스트 ${full.length}건, 합계 ${full.reduce((n, p) => n + p.text.length, 0)}자 =====`);
  full.forEach((p, i) => console.log(`----- 전체 분석 ${i + 1}/${full.length} (${p.text.length}자) -----\n${p.text}`));
  console.log(JSON.stringify({ analyzed: rows.length, failed: failures.length, failures, stats, timing, news: preview.news ? { status: preview.news.status, items: preview.news.items?.length ?? 0, health: preview.news.health } : null }));
  if (modeOf(process.env) !== 'off') { const dry = {}; await opportunity({ state: dry, save: async () => {}, send: null, env: { ...process.env, RADAR_OPPORTUNITY: 'preview' }, force: true }); }
} else if (args.has('--telegram-test')) {
  const send = telegramSender(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID);
  await send(`리치 선물 레이더 · 연결 확인\n${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' })} KST\n이 메시지가 보이면 Telegram 전송이 정상입니다.`);
  console.log('Telegram 연결 확인 메시지 전송 확인(message_id 수신)');
} else {
  const send = telegramSender(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID);
  const sendPhoto = telegramPhotoSender(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID);
  const render = renderChart;
  if (args.has('--once')) {
    // 슬롯 멱등성: 이 슬롯을 처리했다고 먼저 기록한다(같은 슬롯의 중복 실행·늦게 도착한 이전 슬롯 실행은 게이트가 건너뜀).
    const slot = Number(process.env.RADAR_SLOT);
    state.lastSlot = Math.max(Number(state.lastSlot) || 0, Number.isFinite(slot) && process.env.RADAR_SLOT ? slot : slotOfTime(Date.now()));
    await save(state);
    console.log(JSON.stringify(await cycle({ now: Date.now(), state, collect, send, save, news, render, sendPhoto })));
    await opportunity({ send });
    await signal({ send, sendPhoto });
  } else {
    let stopped = false;
    let timer;
    let wake;
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopped = true; clearTimeout(timer); wake?.(); });
    while (!stopped) {
      try { console.log(JSON.stringify(await cycle({ now: Date.now(), state, collect, send, save, news, render, sendPhoto }))); await opportunity({ send }); await signal({ send, sendPhoto }); }
      catch { console.error('분석/알림 처리 실패: 다음 주기에 재확인'); }
      // Start shortly after each 5-minute boundary, never overlap cycles.
      if (!stopped) await new Promise(resolve => { wake = resolve; timer = setTimeout(resolve, 300000 - Date.now() % 300000 + 5000); });
    }
  }
}
