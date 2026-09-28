// COIN RADAR 백엔드 (Cloudflare Worker: coin-radar-engine)
// Phase 0: 서버가 살아있는지 확인(/api/health)하고,
//          거래소 공개 API에 접속 가능한지 확인(/debug/reachability)하는 기능만 있습니다.
// 이 파일에는 비밀키/토큰을 절대 넣지 않습니다. 필요한 경우 Cloudflare Secret(env)으로만 읽습니다.

import { checkAllExchanges } from './reachability.js';
import { json } from './response.js';

export const SERVICE_NAME = 'coin-radar-engine';
export const PHASE = 0;
export const VERSION = '0.1.0';

const ENDPOINTS = {
  'GET /': '사용 가능한 주소 목록 (지금 보고 있는 화면)',
  'GET /api/health': '서버가 정상 작동 중인지 확인',
  'GET /debug/reachability': 'Binance Spot / Binance Futures / Upbit 접속 가능 여부를 실제 요청으로 확인',
};

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

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ status: 'error', message: '이 서버는 GET 요청만 받습니다.' }, 405, { Allow: 'GET, HEAD' });
    }

    try {
      if (path === '/') return handleIndex();
      if (path === '/api/health') return handleHealth(request);
      if (path === '/debug/reachability') return await handleReachability(request);
    } catch (err) {
      return json({ status: 'error', message: '서버 내부 오류가 발생했습니다.', detail: String(err && err.message) }, 500);
    }

    return json(
      { status: 'not_found', message: `"${path}" 주소는 없습니다.`, endpoints: ENDPOINTS },
      404,
    );
  },
};
