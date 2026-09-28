// COIN RADAR 백엔드 (Cloudflare Worker: coin-radar-engine)
// Phase 0: /api/health, /debug/reachability
// Phase 4: Cron(1분마다) Upbit KRW 24시간 감시 + 중요 이벤트 Telegram 알림 (docs/MONITOR.md)
// 이 파일에는 비밀키/토큰을 절대 넣지 않습니다. Cloudflare Secret(env)으로만 읽습니다.

import { checkAllExchanges } from './reachability.js';
import { json } from './response.js';
import { runMonitor, monitorStatus } from './monitor.js';
import { sendTelegram, telegramConfigured } from './telegram.js';

// 주의: 이 파일(진입점)에서는 default 외의 값을 export 하지 않습니다.
//       Cloudflare 런타임이 export 된 값을 모두 요청 처리기로 해석해서 시작에 실패합니다.
const SERVICE_NAME = 'coin-radar-engine';
const PHASE = 4;
const VERSION = '0.4.0';

const ENDPOINTS = {
  'GET /': '사용 가능한 주소 목록 (지금 보고 있는 화면)',
  'GET /api/health': '서버가 정상 작동 중인지 확인',
  'GET /debug/reachability': 'Binance Spot / Binance Futures / Upbit 접속 가능 여부를 실제 요청으로 확인',
  'GET /api/monitor/status': 'Upbit 24시간 감시 상태 (최근 수집 시각, 감시 종목 수, 최근 이벤트, Telegram 설정 여부, Cron 정상 여부)',
  'GET /api/monitor/preview': 'Upbit 감시 계산을 지금 한 번 실행해 결과 미리보기 (저장·알림 없음, 1분에 1회)',
};

// /api/monitor/preview 는 Upbit 요청을 많이 보내므로 같은 인스턴스에서 1분에 한 번만 실제 실행
const previewCache = { at: 0, body: null };
async function handlePreview(env) {
  const now = Date.now();
  if (previewCache.body && now - previewCache.at < 60000) return json({ ...previewCache.body, cached: true });
  const run = await runMonitor(env, now, { notify: false, persist: false });
  const body = {
    note: '저장·알림 없이 계산만 실행한 결과입니다. 상태는 데이터 상태 표시이며 투자 권유가 아닙니다.',
    ran_at: now,
    ok: run.ok,
    markets_watched: run.markets,
    analyzed: run.analyzed,
    events: run.events,
    ranking: run.summary,
    errors: run.errors.slice(0, 5),
  };
  previewCache.at = now;
  previewCache.body = body;
  return json(body);
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// POST /api/admin/telegram-test : Telegram 설정 확인용 테스트 메시지 (ADMIN_TOKEN Secret 필요)
async function handleTelegramTest(request, env) {
  if (!env.ADMIN_TOKEN) return json({ status: 'not_found', message: '주소가 없습니다.' }, 404);
  const auth = request.headers.get('authorization') || '';
  if (!safeEqual(auth, `Bearer ${env.ADMIN_TOKEN}`)) return json({ status: 'error', message: '인증 실패' }, 401);
  if (!telegramConfigured(env)) return json({ ok: false, message: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID Secret 이 없습니다.' });
  const res = await sendTelegram(env, '✅ COIN RADAR 테스트 메시지\nTelegram 알림 설정이 정상입니다.\n※ 데이터 상태 알림이며 투자 권유가 아닙니다.');
  return json({ ok: res.ok, message: res.ok ? '테스트 메시지를 보냈습니다.' : res.reason });
}

function kstString(date) {
  // 한국 시간(UTC+9)을 "2026-09-28 21:44:20" 형태로 표시
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

function whereAmI(request) {
  // Cloudflare가 요청을 처리한 데이터센터 정보 (로컬 테스트에서는 없을 수 있음)
  const cf = request.cf || {};
  return {
    cloudflare_datacenter: cf.colo || '알 수 없음 (로컬 실행)',
    visitor_country: cf.country || '알 수 없음',
  };
}

function handleIndex() {
  return json({
    service: SERVICE_NAME,
    phase: PHASE,
    message: 'COIN RADAR 백엔드입니다. 아래 주소를 브라우저에 붙여 넣어 확인하세요.',
    endpoints: ENDPOINTS,
  });
}

function handleHealth(request) {
  const now = new Date();
  return json({
    status: 'ok',
    message: '✅ 서버가 정상 작동 중입니다.',
    service: SERVICE_NAME,
    phase: PHASE,
    version: VERSION,
    time_utc: now.toISOString(),
    time_kst: kstString(now),
    ...whereAmI(request),
  });
}

async function handleReachability(request) {
  const startedAt = new Date();
  const results = await checkAllExchanges();
  const okCount = results.filter((r) => r.reachable).length;

  let summary;
  if (okCount === results.length) {
    summary = '✅ 모든 거래소에 정상 접속됩니다. Phase 1로 진행해도 됩니다.';
  } else if (okCount === 0) {
    summary = '❌ 모든 거래소 접속에 실패했습니다. 각 항목의 "message"를 확인하세요.';
  } else {
    summary = `⚠️ ${results.length}개 중 ${okCount}개만 접속됩니다. 실패한 항목의 "message"를 확인하세요.`;
  }

  return json({
    summary,
    checked_at_utc: startedAt.toISOString(),
    checked_at_kst: kstString(startedAt),
    ...whereAmI(request),
    note: 'Cloudflare 데이터센터 위치에 따라 결과가 달라질 수 있습니다. 여러 번 새로고침해 보세요.',
    results,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/api/admin/telegram-test' && request.method === 'POST') {
      return handleTelegramTest(request, env || {});
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ status: 'error', message: '이 서버는 GET 요청만 받습니다.' }, 405, { Allow: 'GET, HEAD' });
    }

    try {
      if (path === '/') return handleIndex();
      if (path === '/api/health') return handleHealth(request);
      if (path === '/debug/reachability') return await handleReachability(request);
      if (path === '/api/monitor/status') return json(await monitorStatus(env || {}, Date.now()));
      if (path === '/api/monitor/preview') return await handlePreview(env || {});
    } catch (err) {
      return json({ status: 'error', message: '서버 내부 오류가 발생했습니다.', detail: String(err && err.message) }, 500);
    }

    return json(
      { status: 'not_found', message: `"${path}" 주소는 없습니다.`, endpoints: ENDPOINTS },
      404,
    );
  },

  // Cron Trigger (wrangler.toml [triggers] crons = ["* * * * *"])
  async scheduled(controller, env, ctx) {
    const now = controller && controller.scheduledTime ? controller.scheduledTime : Date.now();
    ctx.waitUntil(runMonitor(env, now));
  },
};
