import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createCollector, cycle, telegramPhotoSender, telegramSender } from './service.mjs';
import { chartCaption, chartPlan, renderChart } from './chart.mjs';
import { createOkxCollector } from './okx.mjs';
import { fullReportParts, reportParts } from './report.mjs';
import { visibleLength } from './format.mjs';
import { refreshNews } from './news.mjs';

// 모드: --preview(수집·출력만) | --once(1회 실행, GitHub Actions용) | --telegram-test(연결 확인 메시지 1건) | 기본(상시 루프)
const args = new Set(process.argv.slice(2));
const directory = process.env.RADAR_STATE_DIR || '/data';
await mkdir(directory, { recursive: true, mode: 0o700 });
let state = {};
try { state = JSON.parse(await readFile(`${directory}/state.json`, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('상태 파일 손상: 운영자 확인 필요'); }
const save = async data => {
  await writeFile(`${directory}/state.tmp`, JSON.stringify(data), { mode: 0o600 });
  await rename(`${directory}/state.tmp`, `${directory}/state.json`);
};
// 기본 출처는 OKX. Binance 선택은 접근 가능한 네트워크에서만 쓰며 다른 거래소 가격을 대신 쓰지 않는다.
const collect = process.env.RADAR_SOURCE === 'binance' ? createCollector() : createOkxCollector();
const news = (st, now) => refreshNews(st, now);
const tokenConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

if (args.has('--preview') || (args.has('--once') && !tokenConfigured)) {
  if (args.has('--once')) console.log('Telegram 비밀값 미설정: 수집·분석만 실행하고 전송/상태 저장은 하지 않습니다.');
  const now = Date.now();
  const { rows, failures, stats, charts } = await collect(now);
  const preview = {};
  try { await refreshNews(preview, now); } catch (error) { console.log(`뉴스 수집 실패(격리됨): ${error.message}`); }
  const u = stats?.universe;
  if (u) {
    console.log(`감시 종목(${u.selected.length}/${u.eligible} 적격): ${u.selected.join(', ')}`);
    console.log(`우선 감시 상태: ${JSON.stringify(u.priority)}`);
    console.log(`제외 사유 집계: ${JSON.stringify(u.reasons)} · 분류 분포: ${JSON.stringify(u.categories)}`);
    for (const e of u.excluded) console.log(`제외: ${e.id} — ${e.reason}`);
  }
  // 차트: 선택 규칙·시간봉 선택 이유를 로그로 남기고, 첫 차트는 확인용으로 base64를 출력한다(프리뷰 전용, 전송 없음).
  const items = [];
  for (const spec of chartPlan(rows, charts)) {
    if (spec.skipped) { console.log(`차트 생략: ${spec.symbol} — ${spec.skipped}`); items.push({ symbol: spec.symbol, png: null, error: spec.skipped }); continue; }
    const t0 = Date.now();
    try {
      const png = await renderChart(spec);
      console.log(`차트 생성: ${spec.symbol} ${spec.tf} (${spec.reason}) ${png.length}바이트 ${Date.now() - t0}ms\n캡션:\n${chartCaption(spec)}`);
      items.push({ symbol: spec.symbol, tf: spec.tf, kind: spec.kind, png, caption: chartCaption(spec) });
      if (items.filter(i => i.png).length === 1) console.log(`CHART_PNG_BASE64_BEGIN\n${png.toString('base64')}\nCHART_PNG_BASE64_END`);
    } catch (error) { console.log(`차트 실패(격리됨): ${spec.symbol} — ${error.message}`); items.push({ symbol: spec.symbol, png: null, error: error.message }); }
  }
  // 기본 정기 보고(실제 전송되는 형식): 압축 본문 1개 + 차트 1장. 보이는 글자 수와 HTML 원문을 함께 기록한다.
  const parts = reportParts(rows, failures, now, { news: preview.news, charts: items });
  parts.forEach((p, i) => console.log(p.type === 'text'
    ? `===== [기본 보고] 메시지 ${i + 1}/${parts.length} 텍스트 (보이는 글자 ${visibleLength(p.text)}자, HTML ${p.text.length}자) =====\n${p.plain}\n----- HTML 원문 -----\n${p.text}`
    : `===== [기본 보고] 메시지 ${i + 1}/${parts.length} 사진 ${p.symbol} ${p.tf ?? ''} ${p.png ? '(PNG)' : `(생략: ${p.error})`} =====\n캡션: ${p.caption ?? ''}`));
  // 전체 분석(2.1 형식)은 정기 보고에 자동 발송하지 않는다. 프리뷰에서만 확인용으로 출력한다.
  const full = fullReportParts(rows, failures, now, { news: preview.news, charts: [] });
  console.log(`===== [전체 분석 · 자동 발송 안 함] 텍스트 ${full.length}건, 합계 ${full.reduce((n, p) => n + p.text.length, 0)}자 =====`);
  full.forEach((p, i) => console.log(`----- 전체 분석 ${i + 1}/${full.length} (${p.text.length}자) -----\n${p.text}`));
  console.log(JSON.stringify({ analyzed: rows.length, failed: failures.length, failures, stats, news: preview.news ? { status: preview.news.status, items: preview.news.items?.length ?? 0, health: preview.news.health } : null }));
} else if (args.has('--telegram-test')) {
  const send = telegramSender(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID);
  await send(`리치 선물 레이더 · 연결 확인\n${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' })} KST\n이 메시지가 보이면 Telegram 전송이 정상입니다.`);
  console.log('Telegram 연결 확인 메시지 전송 확인(message_id 수신)');
} else {
  const send = telegramSender(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID);
  const sendPhoto = telegramPhotoSender(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID);
  const render = renderChart;
  if (args.has('--once')) {
    console.log(JSON.stringify(await cycle({ now: Date.now(), state, collect, send, save, news, render, sendPhoto })));
  } else {
    let stopped = false;
    let timer;
    let wake;
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopped = true; clearTimeout(timer); wake?.(); });
    while (!stopped) {
      try { console.log(JSON.stringify(await cycle({ now: Date.now(), state, collect, send, save, news, render, sendPhoto }))); }
      catch { console.error('분석/알림 처리 실패: 다음 주기에 재확인'); }
      // Start shortly after each 5-minute boundary, never overlap cycles.
      if (!stopped) await new Promise(resolve => { wake = resolve; timer = setTimeout(resolve, 300000 - Date.now() % 300000 + 5000); });
    }
  }
}
