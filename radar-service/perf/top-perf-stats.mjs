// TOP N 성능 측정 통계 보조(순수 함수): 백분위, 요약, 호출 계측 fetcher. 네트워크·Telegram·상태 저장 없음.
export const percentile = (arr, p) => { if (!arr.length) return null; const b = [...arr].sort((x, y) => x - y), k = Math.min(b.length - 1, Math.max(0, Math.ceil(p / 100 * b.length) - 1)); return b[k]; };
export const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
export const summarize = a => ({ n: a.length, mean: mean(a), p50: percentile(a, 50), p95: percentile(a, 95), max: a.length ? Math.max(...a) : null, min: a.length ? Math.min(...a) : null });

// 호출 계측 fetcher: 요청 수, HTTP 상태별 횟수, 본문 code(OKX 50011 등), 지연(ms). 본문은 복제해서 읽어 원래 흐름에 영향을 주지 않는다.
export function instrument(inner = fetch) {
  const st = { calls: 0, http: {}, okxCode: {}, net: 0, lat: [] };
  const f = async (url, init) => {
    const t = Date.now(); st.calls++;
    try {
      const res = await inner(url, init); st.lat.push(Date.now() - t); st.http[res.status] = (st.http[res.status] || 0) + 1;
      try { const b = await res.clone().json(); const c = String(b?.code ?? 'none'); if (c !== '0') st.okxCode[c] = (st.okxCode[c] || 0) + 1; } catch { /* 본문 없음 */ }
      return res;
    } catch (e) { st.net++; throw e; }
  };
  f.stats = st; return f;
}
export const rateLimited = st => (st.http[429] || 0) + (st.okxCode['50011'] || 0) + (st.http[403] || 0);
