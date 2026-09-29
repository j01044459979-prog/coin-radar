// Upbit 공식 공개 시세 API (API Key 불필요)
import { UPBIT } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(fetchImpl, path) {
  const res = await fetchImpl(UPBIT.base + path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Upbit HTTP ${res.status} ${path.split('?')[0]}`);
  return res.json();
}

// KRW 마켓 전체 현재가 (종목 목록 1회 + 현재가 100개씩)
export async function fetchKrwTickers(fetchImpl = fetch) {
  const all = await getJson(fetchImpl, '/v1/market/all?is_details=false');
  const codes = all.map((x) => x.market).filter((m) => typeof m === 'string' && m.startsWith('KRW-'));
  const out = [];
  for (let i = 0; i < codes.length; i += 100) {
    out.push(...(await getJson(fetchImpl, '/v1/ticker?markets=' + codes.slice(i, i + 100).join(','))));
  }
  return out;
}

// 종목별 1분봉 + 15분봉. 캔들 요청은 초당 10회 제한보다 느리게 순서대로 보냅니다.
// 실패한 종목은 건너뛰고 errors 에 기록합니다 (추정값으로 채우지 않음).
export async function fetchCandles(markets, fetchImpl = fetch, intervalMs = UPBIT.candleIntervalMs) {
  const data = new Map();
  const errors = [];
  let first = true;
  for (const market of markets) {
    try {
      if (!first) await sleep(intervalMs);
      first = false;
      const m1 = await getJson(fetchImpl, `/v1/candles/minutes/1?market=${market}&count=${UPBIT.minuteCount}`);
      await sleep(intervalMs);
      const m15 = await getJson(fetchImpl, `/v1/candles/minutes/15?market=${market}&count=${UPBIT.fifteenCount}`);
      data.set(market, { m1: Array.isArray(m1) ? m1 : [], m15: Array.isArray(m15) ? m15 : [] });
    } catch (err) {
      errors.push({ market, error: String(err && err.message) });
    }
  }
  return { data, errors };
}
