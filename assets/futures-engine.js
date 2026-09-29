// COIN RADAR 선물 레이더 계산 엔진 (순수 함수, DOM/네트워크 없음 → Node 테스트 가능)
//
// 데이터: Binance USDⓈ-M Futures 공식 공개 REST API (API Key 불필요, 브라우저에서 직접 호출)
//  - GET /fapi/v1/premiumIndex            Mark Price, 최근 Funding Rate, 다음 Funding 시각
//  - GET /fapi/v1/openInterest            현재 미결제약정(계약 수량)
//  - GET /futures/data/openInterestHist   5분 단위 OI 이력 (처음 열었을 때 5분/15분/1시간 변화 계산용)
// 이 파일은 어떤 숫자도 추정하거나 만들어내지 않습니다. 데이터가 없으면 null 을 돌려줍니다.
// 이 값들은 시장 데이터 관측 결과이며 매수/매도 등 투자 판단을 제시하지 않습니다.
// 설명: docs/FUTURES-RADAR.md
(function (root) {
  'use strict';

  const VERSION = '1.3.0'; // radar-core.js / radar-engine.js VERSION 과 같게 유지
  const MIN = 60 * 1000;

  // ── 규칙 (여기 숫자만 바꾸면 기준이 바뀝니다) ─────────────────
  const FUT_RULES = {
    base: 'https://fapi.binance.com',
    maxSymbols: { desktop: 15, mobile: 10 }, // 선물 감시 종목 수 (요청량 제한)
    pollMs: 60 * 1000, // 정상 수집 주기 1분
    availabilityRefreshMs: 60 * 60 * 1000, // 선물 계약 목록 1시간마다 갱신
    requestTimeoutMs: 8000,
    oiWindows: [5, 15, 60], // 분
    // OI 변화율 기준 (계약 수량 기준, 절댓값 %). 증가/감소 이상 → '증가·감소', 급증 이상 → '급증·급감'
    oiThresholds: { 5: { move: 0.5, surge: 1.5 }, 15: { move: 1.0, surge: 3.0 }, 60: { move: 2.0, surge: 5.0 } },
    fundingNeutralPct: 0.005, // |Funding| < 0.005% 이면 '중립'
    priceFlatPct: 0.1, // 가격↑/↓ 판단 최소 변화 (절댓값 %)
    oiFlatPct: 0.1, // OI↑/↓ 판단 최소 변화 (절댓값 %)
    staleMs: 3 * 60 * 1000, // 3분 넘게 갱신이 없으면 '데이터 지연'
    matchToleranceMs: 150 * 1000, // n분 전 OI 를 찾을 때 허용 오차 ±2.5분 (이력은 5분 간격)
    retentionMinutes: 180, // OI 기록 보관 3시간
    maxPoints: 240, // 종목당 최대 저장 개수
    // 선물시장 활동도 (0~100) = OI 40 + 가격 20 + 거래 활동 20 + Funding 20
    score: { oiFullPct: 3.0, priceFullPct: 2.0, ratioFull: 5, fundingFullPct: 0.05, weights: { oi: 40, price: 20, volume: 20, funding: 20 } },
  };

  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // ── API 응답 변환 ─────────────────────────────────────────────
  // GET /fapi/v1/premiumIndex (symbol 지정 시 객체, 미지정 시 배열의 한 항목)
  function parsePremiumIndex(x) {
    if (!x || typeof x.symbol !== 'string') return null;
    const markPrice = num(x.markPrice);
    const rate = num(x.lastFundingRate); // 소수 (0.0001 = 0.01%)
    if (markPrice === null || markPrice <= 0) return null;
    return {
      symbol: x.symbol,
      markPrice,
      fundingRate: rate,
      fundingPct: rate === null ? null : rate * 100,
      nextFundingTime: num(x.nextFundingTime) || null,
      time: num(x.time) || null,
    };
  }

  // 전체 premiumIndex → 실제 거래 중인 USDT 무기한 계약 목록 (분기물 BTCUSDT_251226 등 제외)
  function availableSymbols(list) {
    const out = new Set();
    if (!Array.isArray(list)) return out;
    for (const x of list) {
      const p = parsePremiumIndex(x);
      if (p && p.symbol.endsWith('USDT') && !p.symbol.includes('_')) out.add(p.symbol);
    }
    return out;
  }

  // GET /fapi/v1/openInterest
  function parseOpenInterest(x) {
    if (!x || typeof x.symbol !== 'string') return null;
    const oi = num(x.openInterest);
    const t = num(x.time);
    if (oi === null || oi < 0 || t === null) return null;
    return { symbol: x.symbol, oi, t };
  }

  // GET /futures/data/openInterestHist → [{ t, oi(계약 수량), notional(USDT) }]
  function parseOiHist(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map((x) => ({ t: num(x && x.timestamp), oi: num(x && x.sumOpenInterest), notional: num(x && x.sumOpenInterestValue) }))
      .filter((p) => p.t !== null && p.oi !== null && p.oi >= 0)
      .sort((a, b) => a.t - b.t);
  }

  // 감시 종목 중 선물 계약이 있는 종목 선택 (기본 6종목 먼저, 그다음 현물 레이더 감시 순서)
  function pickFuturesSymbols(universe, available, max, watch = []) {
    const order = [...new Set([...watch, ...universe])];
    const symbols = [];
    const missing = [];
    for (const s of order) {
      if (available.has(s)) {
        if (symbols.length < max) symbols.push(s);
      } else if (missing.length < max) {
        missing.push(s);
      }
    }
    return { symbols, missing };
  }

  // ── OI 시계열 ───────────────────────────────────────────────
  // series: [{ t, oi, notional }] 시간순
  function addPoint(series, p, now, rules = FUT_RULES) {
    const out = (series || []).filter((x) => x.t !== p.t);
    out.push({ t: p.t, oi: p.oi, notional: p.notional === undefined ? null : p.notional });
    out.sort((a, b) => a.t - b.t);
    const cutoff = now - rules.retentionMinutes * MIN;
    const kept = out.filter((x) => x.t >= cutoff);
    return kept.slice(-rules.maxPoints);
  }

  function nearest(series, target, tol) {
    let best = null;
    for (const p of series) {
      const d = Math.abs(p.t - target);
      if (d <= tol && (best === null || d < Math.abs(best.t - target))) best = p;
    }
    return best;
  }

  // W분 OI 변화율 (계약 수량 기준 → 가격 변동 영향 제외). 비교할 과거 값이 없으면 null
  function oiChange(series, W, rules = FUT_RULES) {
    if (!series || !series.length) return null;
    const last = series[series.length - 1];
    const base = nearest(series, last.t - W * MIN, rules.matchToleranceMs);
    if (!base || base === last || base.oi <= 0) return null;
    return ((last.oi - base.oi) / base.oi) * 100;
  }

  // ── 상태 판정 (관측된 현상만 설명) ─────────────────────────────
  function classifyOi(pct, W, rules = FUT_RULES) {
    if (pct === null || pct === undefined) return { label: 'OI 수집 중', level: 'none', dir: null };
    const th = rules.oiThresholds[W];
    const a = Math.abs(pct);
    if (a >= th.surge) return pct > 0 ? { label: 'OI 급증', level: 'surge', dir: 'up' } : { label: 'OI 급감', level: 'plunge', dir: 'down' };
    if (a >= th.move) return pct > 0 ? { label: 'OI 증가', level: 'up', dir: 'up' } : { label: 'OI 감소', level: 'down', dir: 'down' };
    return { label: 'OI 변화 작음', level: 'flat', dir: 'flat' };
  }

  function fundingState(pct, rules = FUT_RULES) {
    if (pct === null || pct === undefined) return { label: 'Funding 없음', dir: null };
    if (Math.abs(pct) < rules.fundingNeutralPct) return { label: '중립', dir: 'flat' };
    return pct > 0 ? { label: '양수 펀딩', dir: 'up' } : { label: '음수 펀딩', dir: 'down' };
  }

  const arrow = (v, flat) => (v > flat ? '↑' : v < -flat ? '↓' : '→');
  // 가격 + OI 조합 (예: "가격↑ · OI↑"). 방향 관찰용이며 매매 방향을 뜻하지 않음
  function priceOiCombo(pricePct, oiPct, rules = FUT_RULES) {
    if (pricePct === null || pricePct === undefined || oiPct === null || oiPct === undefined) return null;
    return `가격${arrow(pricePct, rules.priceFlatPct)} · OI${arrow(oiPct, rules.oiFlatPct)}`;
  }

  // ── 선물시장 활동도 (0~100) ────────────────────────────────────
  // OI 점수(40)      = min(|15분 OI 변화| ÷ 3%, 1) × 40
  // 가격 점수(20)    = min(|15분 가격 변화| ÷ 2%, 1) × 20
  // 거래 점수(20)    = min(max(15분 거래 활동 배수 − 1, 0) ÷ 4, 1) × 20
  // Funding 점수(20) = min(|Funding| ÷ 0.05%, 1) × 20
  // 15분 OI 변화가 없으면 계산하지 않음(null). 나머지 항목이 없으면 그 항목은 0점이며 incomplete 로 표시.
  function activityScore({ oi15, price15, ratio15, fundingPct }, rules = FUT_RULES) {
    if (oi15 === null || oi15 === undefined) return null;
    const s = rules.score;
    const w = s.weights;
    const clamp = (x) => Math.max(0, Math.min(1, x));
    const parts = {
      oi: clamp(Math.abs(oi15) / s.oiFullPct) * w.oi,
      price: price15 === null || price15 === undefined ? 0 : clamp(Math.abs(price15) / s.priceFullPct) * w.price,
      volume: ratio15 === null || ratio15 === undefined ? 0 : clamp((ratio15 - 1) / (s.ratioFull - 1)) * w.volume,
      funding: fundingPct === null || fundingPct === undefined ? 0 : clamp(Math.abs(fundingPct) / s.fundingFullPct) * w.funding,
    };
    const incomplete = [price15, ratio15, fundingPct].some((v) => v === null || v === undefined);
    const r = (x) => Math.round(x);
    return { score: r(parts.oi + parts.price + parts.volume + parts.funding), parts: { oi: r(parts.oi), price: r(parts.price), volume: r(parts.volume), funding: r(parts.funding) }, incomplete };
  }

  function isStale(updatedAt, now, rules = FUT_RULES) {
    return !updatedAt || now - updatedAt > rules.staleMs;
  }

  // 한 종목 카드 데이터 (spot: 현물 레이더 15분 결과 { changePct, ratio } 또는 null)
  function evaluate(symbol, { series, premium, updatedAt, spot }, now, rules = FUT_RULES) {
    const s = series || [];
    const last = s.length ? s[s.length - 1] : null;
    const oi5 = oiChange(s, 5, rules);
    const oi15 = oiChange(s, 15, rules);
    const oi60 = oiChange(s, 60, rules);
    const markPrice = premium ? premium.markPrice : null;
    // 현재 OI 금액(USDT) = 현재 OI(계약 수량) × Mark Price. 가격이 없으면 이력의 Binance 제공 금액 사용
    const notional = last && markPrice ? last.oi * markPrice : last ? last.notional : null;
    const price15 = spot && spot.changePct !== undefined ? spot.changePct : null;
    const ratio15 = spot && spot.ratio !== undefined ? spot.ratio : null;
    const fundingPct = premium ? premium.fundingPct : null;
    const score = activityScore({ oi15, price15, ratio15, fundingPct }, rules);
    return {
      symbol,
      markPrice,
      oi: last ? last.oi : null,
      notional,
      oi5,
      oi15,
      oi60,
      oiState: classifyOi(oi15 !== null ? oi15 : oi5, oi15 !== null ? 15 : 5, rules),
      fundingPct,
      funding: fundingState(fundingPct, rules),
      nextFundingTime: premium ? premium.nextFundingTime : null,
      price15,
      ratio15,
      combo: priceOiCombo(price15, oi15, rules),
      score,
      updatedAt: updatedAt || null,
      stale: isStale(updatedAt, now, rules),
    };
  }

  // 활동도 높은 순. 점수가 없으면 기본 순서(fallback) 유지. 지연된 데이터는 뒤로.
  function rankCards(cards, fallbackOrder) {
    const idx = (s) => {
      const i = fallbackOrder.indexOf(s);
      return i === -1 ? 1e9 : i;
    };
    return [...cards].sort((a, b) => {
      const as = !a.stale && a.score ? a.score.score : -1;
      const bs = !b.stale && b.score ? b.score.score : -1;
      return bs - as || idx(a.symbol) - idx(b.symbol);
    });
  }

  // ── 재시도 간격 ─────────────────────────────────────────────
  // 성공: 1분. 실패 n번째: 5초 × 2^(n-1), 최대 5분. 서버가 Retry-After(초)를 주면 그보다 짧게 하지 않음.
  function nextDelay(failures, retryAfterSec, rules = FUT_RULES, rand = Math.random) {
    if (!failures) return rules.pollMs;
    const backoff = Math.min(5 * MIN, 5000 * 2 ** (failures - 1)) + Math.floor(rand() * 1000);
    const ra = num(retryAfterSec);
    return ra !== null && ra > 0 ? Math.max(backoff, ra * 1000) : backoff;
  }

  // 요청 제한 응답의 최소 대기(초). 브라우저는 다른 사이트 응답의 Retry-After 헤더를 못 읽는 경우가 많아 기본값을 둡니다.
  // 429 = 요청 과다 → 최소 2분, 418 = IP 일시 차단 → 최소 5분
  function retryAfterFor(status, header) {
    const h = num(header);
    const floor = status === 418 ? 300 : status === 429 ? 120 : 0;
    const v = Math.max(floor, h !== null && h > 0 ? h : 0);
    return v > 0 ? v : null;
  }

  function futuresStatusView(s, now) {
    const sec = (t) => Math.max(0, Math.ceil((t - now) / 1000));
    if (s.state === 'live') {
      if (isStale(s.lastOk, now)) return { text: '선물 데이터 지연', level: 'warn' };
      return { text: '선물 정상', level: 'ok' };
    }
    if (s.state === 'retrying') return { text: `선물 재연결 중${s.retryAt ? ` (${sec(s.retryAt)}초 후)` : ''}`, level: s.lastOk && !isStale(s.lastOk, now) ? 'warn' : 'err' };
    if (s.state === 'paused') return { text: '선물 일시정지 (화면 숨김)', level: 'warn' };
    return { text: '선물 연결 중', level: 'warn' };
  }

  // ── 저장/복원 (localStorage, 레이더 1분봉과 다른 키 사용) ──────
  const STORAGE_KEY = 'coinradar.futures.v1';
  function serialize(store, now, rules = FUT_RULES) {
    const cutoff = now - rules.retentionMinutes * MIN;
    const s = {};
    for (const [sym, series] of store) {
      const arr = series.filter((p) => p.t >= cutoff).slice(-rules.maxPoints).map((p) => [p.t, p.oi, p.notional]);
      if (arr.length) s[sym] = arr;
    }
    return { v: 1, savedAt: now, s };
  }

  function deserialize(obj, now, rules = FUT_RULES) {
    const store = new Map();
    if (!obj || typeof obj !== 'object' || obj.v !== 1 || !obj.s || typeof obj.s !== 'object') return store;
    for (const [sym, arr] of Object.entries(obj.s)) {
      if (typeof sym !== 'string' || !/^[A-Z0-9]+USDT$/.test(sym) || !Array.isArray(arr)) continue;
      let series = [];
      for (const a of arr) {
        if (!Array.isArray(a) || a.length !== 3) continue;
        const t = num(a[0]);
        const oi = num(a[1]);
        const notional = a[2] === null ? null : num(a[2]);
        if (t === null || oi === null || oi < 0 || t > now + MIN) continue;
        series = addPoint(series, { t, oi, notional }, now, rules);
      }
      if (series.length) store.set(sym, series);
    }
    return store;
  }

  // 1시간 변화 계산에 필요한 이력이 없으면 openInterestHist 로 채움
  function needsHistory(series, now, rules = FUT_RULES) {
    if (!series || !series.length) return true;
    return series[0].t > now - 60 * MIN + rules.matchToleranceMs;
  }

  const api = {
    VERSION,
    MIN,
    FUT_RULES,
    STORAGE_KEY,
    parsePremiumIndex,
    availableSymbols,
    parseOpenInterest,
    parseOiHist,
    pickFuturesSymbols,
    addPoint,
    oiChange,
    classifyOi,
    fundingState,
    priceOiCombo,
    activityScore,
    isStale,
    evaluate,
    rankCards,
    nextDelay,
    retryAfterFor,
    futuresStatusView,
    serialize,
    deserialize,
    needsHistory,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FuturesEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
