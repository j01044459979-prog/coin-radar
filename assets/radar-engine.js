// COIN RADAR 단기 레이더 계산 엔진 (순수 함수, DOM/네트워크 없음 → Node 테스트 가능)
//
// 입력은 Binance 공식 1분봉(kline) 데이터뿐입니다. 이 파일은 어떤 숫자도 추정하거나 만들어내지 않습니다.
// 데이터가 부족하면 계산 결과 대신 status: 'collecting' 을 돌려줍니다.
// 계산 방식 설명: docs/RADAR.md
(function (root) {
  'use strict';

  const VERSION = '1.5.0'; // radar-core.js VERSION 과 같게 유지
  const MIN = 60 * 1000;

  // ── 규칙 (여기 숫자만 바꾸면 기준이 바뀝니다) ─────────────────
  const RULES = {
    windows: [1, 5, 15], // 분
    baselineWindows: 12, // 평소 = 직전 같은 길이 구간 12개의 평균
    minBaselineWindows: 6, // 최소 6개 구간이 있어야 계산 (없으면 '데이터 수집 중')
    retentionMinutes: 240, // 1분봉 보관 기간 (4시간)
    staleAfterMs: 2 * MIN, // 마지막 완료 1분봉이 2분 이상 지나면 '데이터 지연'
    priceMovePct: { 1: 0.5, 5: 1.2, 15: 2.0 }, // 구간별 '가격 급변' 기준 (절댓값 %)
    activityRatio: 1.8, // 거래 활동 배수 ≥ 1.8 → 활동 증가
    volumeAnomalyRatio: 3, // 거래 활동 배수 ≥ 3 → 거래량 이상
    overheat: { priceMult: 2, ratio: 5 }, // 변화율 ≥ 급변 기준×2 이고 배수 ≥ 5 → 과열
    score: { priceFullMult: 2, ratioFull: 5 }, // 점수 만점 기준 (docs/RADAR.md 참고)
  };

  // 전체 계산에 필요한 최대 1분봉 수 (15분 × (1 + 12) = 195)
  const HISTORY_NEEDED = Math.max(...RULES.windows) * (1 + RULES.baselineWindows);

  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // ── 1분봉 변환 ──────────────────────────────────────────────
  // WebSocket <symbol>@kline_1m 의 k 객체
  function klineFromWs(k) {
    if (!k || k.i !== '1m') return null;
    const c = { t: num(k.t), o: num(k.o), h: num(k.h), l: num(k.l), c: num(k.c), v: num(k.v), q: num(k.q), closed: k.x === true };
    return validCandle(c) ? c : null;
  }

  // REST /api/v3/klines 배열 [openTime, open, high, low, close, volume, closeTime, quoteVolume, ...]
  function klineFromRest(a, now) {
    if (!Array.isArray(a) || a.length < 8) return null;
    const c = { t: num(a[0]), o: num(a[1]), h: num(a[2]), l: num(a[3]), c: num(a[4]), v: num(a[5]), q: num(a[7]), closed: num(a[6]) !== null && num(a[6]) < now };
    return validCandle(c) ? c : null;
  }

  function validCandle(c) {
    return c.t !== null && c.t % MIN === 0 && [c.o, c.h, c.l, c.c, c.v, c.q].every((x) => x !== null && x >= 0) && c.o > 0;
  }

  // ── 1분봉 저장소 (symbol → Map(openTime → candle)) ──────────
  function upsertCandle(store, symbol, c) {
    if (!c) return false;
    let s = store.get(symbol);
    if (!s) store.set(symbol, (s = new Map()));
    const prev = s.get(c.t);
    if (prev && prev.closed && !c.closed) return false; // 완료된 봉을 진행 중 값으로 덮어쓰지 않음
    s.set(c.t, c);
    return c.closed && !(prev && prev.closed);
  }

  // 보관 기준: 진행 중인 1분봉 시작 시각에서 retentionMinutes 이전까지
  const retentionCutoff = (now, retentionMinutes) => Math.floor(now / MIN) * MIN - retentionMinutes * MIN;

  function pruneStore(store, now, retentionMinutes = RULES.retentionMinutes) {
    const cutoff = retentionCutoff(now, retentionMinutes);
    for (const [sym, s] of store) {
      for (const t of s.keys()) if (t < cutoff) s.delete(t);
      if (!s.size) store.delete(sym);
    }
  }

  function latestClosed(series) {
    let best = null;
    if (series) for (const c of series.values()) if (c.closed && (best === null || c.t > best)) best = c.t;
    return best;
  }

  // endT 부터 과거로 끊김 없이 이어진 완료 1분봉 수
  function contiguousClosed(series, endT, cap = HISTORY_NEEDED + 5) {
    let n = 0;
    for (let t = endT; n < cap; t -= MIN) {
      const c = series && series.get(t);
      if (!c || !c.closed) break;
      n += 1;
    }
    return n;
  }

  function sumWindow(series, startT, minutes) {
    let q = 0, v = 0;
    for (let i = 0; i < minutes; i += 1) {
      const c = series.get(startT + i * MIN);
      if (!c || !c.closed) return null;
      q += c.q;
      v += c.v;
    }
    return { q, v, open: series.get(startT).o, close: series.get(startT + (minutes - 1) * MIN).c };
  }

  // ── 구간 계산 ───────────────────────────────────────────────
  // 기준 시각: 가장 최근 '완료된' 1분봉. 현재 구간 = 그 봉까지의 최근 W개 1분봉.
  // 평소(baseline) = 그 직전 같은 길이 W분 구간 최대 12개의 평균 거래대금.
  function windowMetrics(series, W, now, rules = RULES) {
    const need = W * (1 + rules.minBaselineWindows);
    const last = latestClosed(series);
    if (last === null) return { status: 'collecting', window: W, remainingMin: need };
    if (now - (last + MIN) > rules.staleAfterMs) return { status: 'stale', window: W, lastClosed: last };

    const have = contiguousClosed(series, last, W * (1 + rules.baselineWindows));
    if (have < need) return { status: 'collecting', window: W, remainingMin: need - have };

    const curStart = last - (W - 1) * MIN;
    const cur = sumWindow(series, curStart, W);
    const base = [];
    for (let k = 1; k <= rules.baselineWindows; k += 1) {
      const w = sumWindow(series, curStart - k * W * MIN, W);
      if (!w) break;
      base.push(w.q);
    }
    if (!cur || base.length < rules.minBaselineWindows) return { status: 'collecting', window: W, remainingMin: 1 };

    const baselineAvg = base.reduce((a, b) => a + b, 0) / base.length;
    const changePct = ((cur.close - cur.open) / cur.open) * 100;
    return {
      status: 'ok',
      window: W,
      windowStart: curStart,
      windowEnd: last + MIN,
      open: cur.open,
      close: cur.close,
      changePct,
      quoteVol: cur.q,
      baseVol: cur.v,
      baselineAvg,
      baselineCount: base.length,
      ratio: baselineAvg > 0 ? cur.q / baselineAvg : null,
      direction: changePct > 0 ? 'up' : changePct < 0 ? 'down' : 'flat',
    };
  }

  // ── 상태 판정 (투자 추천이 아닌 데이터 상태) ────────────────
  const LEVELS = { overheat: 4, alert: 3, active: 2, observe: 1 };

  function classify(m, rules = RULES) {
    if (!m || m.status !== 'ok') return { labels: [], level: 'none', primary: null };
    const th = rules.priceMovePct[m.window];
    const abs = Math.abs(m.changePct);
    const r = m.ratio;
    const priceMove = abs >= th;
    const volAnomaly = r !== null && r >= rules.volumeAnomalyRatio;
    const activity = r !== null && r >= rules.activityRatio;
    const overheat = abs >= th * rules.overheat.priceMult && r !== null && r >= rules.overheat.ratio;

    const labels = [];
    if (overheat) labels.push('과열');
    if (priceMove) labels.push('가격 급변');
    if (volAnomaly) labels.push('거래량 이상');
    else if (activity) labels.push('활동 증가');
    if (!labels.length) labels.push('관찰');

    const level = overheat ? 'overheat' : priceMove || volAnomaly ? 'alert' : activity ? 'active' : 'observe';
    return { labels, level, primary: labels[0] };
  }

  // ── Radar score (0~100) ─────────────────────────────────────
  // 가격 점수(최대 50) = min(|변화율| ÷ 급변기준, 2) ÷ 2 × 50
  // 거래 점수(최대 50) = min(max(거래 활동 배수 − 1, 0), 4) ÷ 4 × 50   (평소와 같으면 0점, 5배 이상 만점)
  function radarScore(m, rules = RULES) {
    if (!m || m.status !== 'ok') return null;
    const th = rules.priceMovePct[m.window];
    const pf = rules.score.priceFullMult;
    const rf = rules.score.ratioFull;
    const pricePart = (Math.min(Math.abs(m.changePct) / th, pf) / pf) * 50;
    const volumePart = m.ratio === null ? 0 : (Math.min(Math.max(m.ratio - 1, 0), rf - 1) / (rf - 1)) * 50;
    return { score: Math.round(pricePart + volumePart), pricePart: Math.round(pricePart), volumePart: Math.round(volumePart) };
  }

  // 여러 종목을 한 구간 기준으로 계산하고 점수 순으로 정렬
  function analyze(store, symbols, W, now, rules = RULES) {
    const rows = symbols.map((symbol) => {
      const m = windowMetrics(store.get(symbol), W, now, rules);
      return { symbol, metrics: m, cls: classify(m, rules), score: radarScore(m, rules) };
    });
    const ranked = rows
      .filter((r) => r.metrics.status === 'ok')
      .sort((a, b) => b.score.score - a.score.score || b.metrics.quoteVol - a.metrics.quoteVol);
    const pending = rows.filter((r) => r.metrics.status !== 'ok');
    return { window: W, ranked, pending, rows };
  }

  // ── 설명 문구 ───────────────────────────────────────────────
  const fmtPctSigned = (x) => (x > 0 ? '+' : '') + x.toFixed(2) + '%';
  function fmtUsd(x) {
    if (x >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
    if (x >= 1e6) return '$' + (x / 1e6).toFixed(2) + 'M';
    if (x >= 1e3) return '$' + (x / 1e3).toFixed(1) + 'K';
    return '$' + x.toFixed(0);
  }
  const fmtRatio = (r) => (r === null ? '평소 거래 없음' : r.toFixed(1) + '배');

  function evidence(m, cls, rules = RULES) {
    if (!m || m.status !== 'ok') return '';
    const th = rules.priceMovePct[m.window];
    return `${m.window}분 ${fmtPctSigned(m.changePct)} (급변 기준 ±${th}%) · 거래대금 ${fmtRatio(m.ratio)} (현재 ${fmtUsd(m.quoteVol)} / 평소 ${fmtUsd(m.baselineAvg)}, 직전 ${m.baselineCount}구간 평균) → ${cls.labels.join(' + ')}`;
  }

  function pendingText(m) {
    if (!m) return '';
    if (m.status === 'stale') return `${m.window}분 데이터 지연 (최근 1분봉 수신 대기)`;
    if (m.status === 'collecting') return `${m.window}분 데이터 수집 중 (약 ${m.remainingMin}분 남음)`;
    return '';
  }

  // ── 감시 종목 선택 ──────────────────────────────────────────
  const STABLE_BASES = new Set(['USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'BUSD', 'EUR', 'AEUR', 'EURI', 'PYUSD', 'USD1', 'XUSD', 'RLUSD', 'USDE', 'BFUSD', 'USDS', 'GBP', 'TRY', 'BRL']);
  function isRadarCandidate(symbol) {
    if (typeof symbol !== 'string' || !symbol.endsWith('USDT') || symbol.includes('_')) return false;
    const base = symbol.slice(0, -4);
    if (!base || STABLE_BASES.has(base)) return false;
    return !/(UP|DOWN|BULL|BEAR)$/.test(base) || base.length <= 4; // 레버리지 토큰 제외 (JUP 같은 짧은 이름은 유지)
  }

  // 24H 거래대금 상위 size 개 + 항상 포함할 종목(always)
  function pickUniverse(rows, size, always = []) {
    const top = rows
      .filter((r) => isRadarCandidate(r.symbol) && r.quoteVol !== null)
      .sort((a, b) => b.quoteVol - a.quoteVol)
      .map((r) => r.symbol);
    const out = [...always];
    for (const s of top) {
      if (out.length >= Math.max(size, always.length)) break;
      if (!out.includes(s)) out.push(s);
    }
    return out;
  }

  // ── 과거 1분봉 보충(REST) 계획 ──────────────────────────────
  // 반환: null(필요 없음) 또는 { limit, startTime? }
  function backfillPlan(series, now) {
    const m0 = Math.floor(now / MIN) * MIN; // 진행 중인 1분봉 시작
    const lastNeeded = m0 - MIN;
    const last = latestClosed(series);
    if (last !== null && last >= lastNeeded && contiguousClosed(series, last) >= HISTORY_NEEDED) return null;
    if (last !== null && last < lastNeeded) {
      const gap = (lastNeeded - last) / MIN;
      if (gap <= 1000 && gap + contiguousClosed(series, last) >= HISTORY_NEEDED) return { startTime: last + MIN, limit: Math.min(1000, gap + 1) };
    }
    return { limit: HISTORY_NEEDED + 5 };
  }

  // ── 저장/복원 (localStorage 용 JSON) ─────────────────────────
  // 저장 항목: 1분봉 시작 시각(수집 시각), 시가·고가·저가·종가, 거래량, 거래대금. 완료된 봉만 저장.
  function serializeStore(store, now, retentionMinutes = RULES.retentionMinutes) {
    const cutoff = retentionCutoff(now, retentionMinutes);
    const s = {};
    for (const [sym, series] of store) {
      const arr = [];
      for (const c of series.values()) if (c.closed && c.t >= cutoff) arr.push([c.t, c.o, c.h, c.l, c.c, c.v, c.q]);
      if (arr.length) s[sym] = arr.sort((a, b) => a[0] - b[0]);
    }
    return { v: 1, savedAt: now, s };
  }

  function deserializeStore(obj, now, retentionMinutes = RULES.retentionMinutes) {
    const store = new Map();
    if (!obj || obj.v !== 1 || typeof obj.s !== 'object' || obj.s === null) return store;
    const cutoff = retentionCutoff(now, retentionMinutes);
    for (const [sym, arr] of Object.entries(obj.s)) {
      if (!Array.isArray(arr)) continue;
      for (const a of arr) {
        if (!Array.isArray(a) || a.length !== 7) continue;
        const c = { t: num(a[0]), o: num(a[1]), h: num(a[2]), l: num(a[3]), c: num(a[4]), v: num(a[5]), q: num(a[6]), closed: true };
        if (validCandle(c) && c.t >= cutoff && c.t + MIN <= now) upsertCandle(store, sym, c);
      }
    }
    return store;
  }

  const api = {
    VERSION,
    MIN,
    RULES,
    HISTORY_NEEDED,
    klineFromWs,
    klineFromRest,
    upsertCandle,
    pruneStore,
    latestClosed,
    contiguousClosed,
    windowMetrics,
    classify,
    radarScore,
    analyze,
    evidence,
    pendingText,
    isRadarCandidate,
    pickUniverse,
    backfillPlan,
    serializeStore,
    deserializeStore,
    LEVELS,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RadarEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
