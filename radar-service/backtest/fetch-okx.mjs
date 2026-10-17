// OKX 공개 API(키 없음)에서 USDT 무기한 1시간봉 과거 데이터를 내려받는다. 읽기 전용. 결과는 gzip JSON 하나.
//  node radar-service/backtest/fetch-okx.mjs --days 365 --symbols 25 --out data.json.gz
import { gzipSync } from 'node:zlib';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { scanMarket } from '../universe.mjs';

const BASE = 'https://www.okx.com/api/v5', pause = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, fetchImpl, wait, tries = 5) {
  for (let k = 0; k < tries; k++) {
    let res; try { res = await fetchImpl(url); } catch { await wait(1000 * (k + 1)); continue; }
    if (res.status === 429 || res.status >= 500) { await wait(Math.max(Number(res.headers.get('retry-after')) * 1000 || 0, 1500 * (k + 1))); continue; }
    if ([403, 418, 451].includes(res.status)) throw Object.assign(new Error(`제한 응답 ${res.status}`), { status: res.status });
    const body = await res.json().catch(() => null);
    if (body?.code === '50011') { await wait(2000 * (k + 1)); continue; }
    if (!body || body.code !== '0' || !Array.isArray(body.data)) throw new Error(`응답 오류(code ${body?.code})`);
    return body.data;
  }
  throw new Error('재시도 한도 초과');
}

// 1시간봉 과거 캔들: history-candles 를 after(이 시각보다 과거)로 페이지네이션. 확정(confirm=1) 봉만, 오래된 순, 중복·누락 점검.
export async function fetchHistory(instId, bars, { fetchImpl = fetch, wait = pause, gapMs = 220 } = {}) {
  const out = new Map(); let after = '';
  while (out.size < bars) {
    const rows = await getJson(`${BASE}/market/history-candles?instId=${instId}&bar=1H&limit=100${after ? `&after=${after}` : ''}`, fetchImpl, wait);
    if (!rows.length) break;
    for (const r of rows) if (r[8] === '1') out.set(Number(r[0]), [Number(r[0]), Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4]), Number(r[7])]);
    const oldest = Math.min(...rows.map(r => Number(r[0])));
    if (String(oldest) === after) break;
    after = String(oldest);
    if (gapMs) await wait(gapMs);
  }
  const arr = [...out.values()].sort((a, b) => a[0] - b[0]).slice(-bars);
  return arr;
}

export async function main({ days = 365, symbols = 25, out = 'data.json.gz', idsFile = null, fetchImpl = fetch, wait = pause } = {}) {
  const instruments = await getJson(`${BASE}/public/instruments?instType=SWAP`, fetchImpl, wait);
  const tickers = await getJson(`${BASE}/market/tickers?instType=SWAP`, fetchImpl, wait);
  const market = scanMarket({ instruments, tickers });
  // 재현성: idsFile이 있으면 그 종목 목록을 그대로 쓴다(현재 거래대금 순위가 바뀌어도 같은 데이터셋). 없으면 현재 거래대금 상위로 선정하고 목록을 출력한다.
  const pinned = idsFile && existsSync(idsFile) ? JSON.parse(readFileSync(idsFile, 'utf8')).ids : null;
  const top = pinned ?? market.eligible.filter(e => e.turnover >= 5e6).sort((a, b) => b.turnover - a.turnover).slice(0, symbols).map(e => e.instId);
  const ids = [...new Set(['BTC-USDT-SWAP', ...top])];
  console.log(`IDS ${JSON.stringify({ ids, pinned: Boolean(pinned) })}`);
  const candles = {}, notes = [], specs = {};
  for (const id of ids) { const x = instruments.find(i => i.instId === id); if (x) specs[id] = { tickSz: Number(x.tickSz), lotSz: Number(x.lotSz), minSz: Number(x.minSz), ctVal: Number(x.ctVal), listTime: Number(x.listTime) || null }; }
  for (const id of ids) {
    try { const rows = await fetchHistory(id, days * 24, { fetchImpl, wait }); candles[id] = rows; console.log(`${id}: ${rows.length}봉 (${rows.length ? new Date(rows[0][0]).toISOString().slice(0, 10) : '-'} ~ ${rows.length ? new Date(rows.at(-1)[0]).toISOString().slice(0, 10) : '-'})`); }
    catch (error) { notes.push(`${id}: ${error.message}`); console.log(`${id}: 실패 ${error.message}`); if (error.status) break; }
  }
  const data = { meta: { fetchedAt: Date.now(), bar: '1H', source: 'OKX /market/history-candles', days, universe: 'fetch 시점 24h 거래대금 상위(생존 편향 있음)', notes }, specs, candles };
  if (out) writeFileSync(out, gzipSync(JSON.stringify(data)));
  return data;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  await main({ days: Number(arg('days', 365)), symbols: Number(arg('symbols', 25)), out: arg('out', 'data.json.gz'), idsFile: arg('ids-file', null) });
}
