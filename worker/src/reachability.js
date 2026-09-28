// 거래소 공개 API 접속 확인 (API Key 필요 없음, 시세 조회만 합니다)

const TIMEOUT_MS = 8000;

// 확인할 대상 목록. 각 대상은 가벼운 공개 시세 주소 1개만 호출합니다.
export const TARGETS = [
  {
    id: 'binance_spot',
    name: 'Binance Spot (현물)',
    url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
    sample: (d) => ({ symbol: d.symbol, price_usdt: d.price }),
  },
  {
    id: 'binance_spot_mirror',
    name: 'Binance Spot 공개 미러 (api.binance.com 이 막힐 때 대안)',
    url: 'https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT',
    sample: (d) => ({ symbol: d.symbol, price_usdt: d.price }),
  },
  {
    id: 'binance_futures',
    name: 'Binance Futures (선물)',
    url: 'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT',
    sample: (d) => ({ symbol: d.symbol, mark_price_usdt: d.markPrice, funding_rate: d.lastFundingRate }),
  },
  {
    id: 'upbit',
    name: 'Upbit (원화 시장)',
    url: 'https://api.upbit.com/v1/ticker?markets=KRW-BTC',
    sample: (d) => {
      const t = Array.isArray(d) ? d[0] : d;
      return { market: t.market, price_krw: t.trade_price };
    },
  },
];

// HTTP 상태 코드를 초보자용 설명으로 바꿉니다.
export function explain(status) {
  if (status >= 200 && status < 300) return '✅ 정상 접속';
  if (status === 451 || status === 403) {
    return '❌ 지역 차단으로 보입니다. Cloudflare 서버 위치(예: 미국)에서 이 거래소 접속이 막혀 있습니다. docs/SETUP.md 의 "접속이 막힐 때" 항목을 보세요.';
  }
  if (status === 429 || status === 418) return '⚠️ 요청이 너무 많아 거래소가 잠시 제한했습니다. 몇 분 뒤 다시 시도하세요.';
  if (status >= 500) return '⚠️ 거래소 서버 쪽 문제입니다. 잠시 후 다시 시도하세요.';
  return `⚠️ 예상하지 못한 응답입니다 (HTTP ${status}).`;
}

export async function checkTarget(target, fetchImpl = fetch) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const base = { id: target.id, name: target.name, url: target.url };

  try {
    const res = await fetchImpl(target.url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'coin-radar-engine/phase0' },
    });
    const latency = Date.now() - started;
    const reachable = res.ok;
    let sample = null;
    if (reachable) {
      try {
        sample = target.sample(await res.json());
      } catch {
        sample = '응답은 받았지만 데이터 형식을 읽지 못했습니다.';
      }
    }
    return { ...base, reachable, http_status: res.status, latency_ms: latency, message: explain(res.status), sample };
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    return {
      ...base,
      reachable: false,
      http_status: null,
      latency_ms: Date.now() - started,
      message: timedOut
        ? `❌ ${TIMEOUT_MS / 1000}초 안에 응답이 없습니다 (시간 초과).`
        : `❌ 네트워크 오류로 접속하지 못했습니다: ${err && err.message}`,
      sample: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function checkAllExchanges(fetchImpl = fetch) {
  return Promise.all(TARGETS.map((t) => checkTarget(t, fetchImpl)));
}
