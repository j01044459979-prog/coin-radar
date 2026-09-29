// Crypto Intelligence 수집 엔진: 수집 → 분류 → 중복 제거/클러스터 → 시장 반응 연결 → D1 저장.
// 별도 Cron(*/2)에서 실행되며 기존 1분 Upbit 감시(monitor.js)와 독립적입니다. AI/LLM 은 사용하지 않습니다.
import { safeUrl, urlKey } from './text.js';
import { detectSymbols, buildDictionary } from './symbols.js';
import { detectCategory, baseImportance, clusterImportance, verificationOf, reactionBonus, TIER } from './classify.js';
import { findCluster } from './cluster.js';
import { reactionFromCandles } from './market.js';
import { enabledSources, fetchText } from './sources.js';
import * as store from './store.js';

const MAX_NEW_PER_SOURCE = 30; // 한 번에 저장할 새 항목 상한 (D1 쓰기 보호)
const MAX_SNAPSHOT_MARKETS = 4; // 실행당 Upbit 캔들 요청 상한
const MAX_SNAPSHOT_ROWS = 12; // 실행당 시세 스냅샷 D1 쓰기 상한
const SNAPSHOT_WINDOW_MS = 60 * 60000; // 이벤트 후 1시간 동안만 시세 반응을 갱신
const UPBIT_MARKETS = 'https://api.upbit.com/v1/market/all?is_details=false';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isDue(src, h, now) {
  if (!h || !h.last_attempt_at) return true;
  const backoff = Math.min(1 + (h.consecutive_failures || 0), 4); // 연속 실패하면 요청 간격을 늘림 (최대 4배)
  return now - h.last_attempt_at >= src.intervalMs * backoff - 15000;
}

// 파서가 돌려준 항목 → 저장용 항목 (분석: 심볼 · 카테고리 · 중요도 · 검증)
export function enrichItem(raw, src, now, dict) {
  const url = safeUrl(raw.url);
  if (!url || !raw.title) return null;
  if (raw.publishedAt && now - raw.publishedAt > src.maxAgeMs) return null;
  const symbols = detectSymbols(raw.title, dict);
  const category = detectCategory(raw.title, src.type, raw.hint || '');
  return {
    source: src.id, sourceType: src.type, tier: TIER[src.type], title: raw.title, url, urlKey: urlKey(url),
    publishedAt: raw.publishedAt || null, collectedAt: now, eventTime: raw.publishedAt || now, summary: raw.summary || '',
    symbols, category, importance: baseImportance({ sourceType: src.type, category, symbols }),
    verification: src.type === 'official' ? 'official' : src.type === 'news' ? 'news' : 'unverified',
  };
}

const better = (item, c) => item.tier < TIER[c.sourceType];

function refreshCluster(c, now) {
  c.sourceCount = c.sources.length;
  c.verification = verificationOf(c.sources);
  c.importance = clusterImportance(c.importanceBase, c.sourceCount, c.reactionBonus);
  c.updatedAt = now;
}

function joinCluster(c, item, now) {
  c.symbols = [...new Set([...c.symbols, ...item.symbols])].slice(0, 6);
  if (!c.sources.some((s) => s.source === item.source)) c.sources.push({ source: item.source, sourceType: item.sourceType });
  c.itemCount += 1;
  c.importanceBase = Math.max(c.importanceBase, item.importance);
  c.lastTime = Math.max(c.lastTime, item.eventTime);
  if (item.publishedAt) {
    c.eventTime = c.publishedKnown ? Math.min(c.eventTime, item.publishedAt) : item.publishedAt;
    c.publishedKnown = true;
  }
  if (better(item, c)) {
    c.title = item.title;
    c.url = item.url;
    c.source = item.source;
    c.sourceType = item.sourceType;
  }
  if (c.category === 'general' && item.category !== 'general') c.category = item.category;
  refreshCluster(c, now);
}

function newCluster(item, now) {
  const c = {
    id: null, title: item.title, url: item.url, category: item.category, symbols: item.symbols.slice(), importanceBase: item.importance, reactionBonus: 0, importance: 0,
    verification: 'unverified', source: item.source, sourceType: item.sourceType, sources: [{ source: item.source, sourceType: item.sourceType }], itemCount: 1, sourceCount: 1,
    publishedKnown: !!item.publishedAt, eventTime: item.eventTime, lastTime: item.eventTime, firstSeenAt: now, updatedAt: now,
  };
  refreshCluster(c, now);
  return c;
}

async function fetchJsonSafe(fetchImpl, url) {
  return JSON.parse(await fetchText(fetchImpl, url, 'application/json'));
}

// options: { fetchImpl, force, candleIntervalMs }
export async function runIntelligence(env, now, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const out = { ok: false, ran_at: now, sources: [], new_items: 0, duplicates: 0, clusters_touched: 0, snapshots: 0, errors: [] };
  const db = env && env.DB && typeof env.DB.prepare === 'function' ? env.DB : null;
  if (!db) {
    out.errors.push('D1 미설정: 정보 수집을 건너뜁니다');
    return out;
  }
  try {
    await store.ensureIntelSchema(db);
    const health = await store.loadHealth(db);
    const active = enabledSources(env);
    const due = active.filter((s) => options.force || isDue(s, health.get(s.id), now));

    // 거래소 마켓 목록: 심볼 사전(한글/영문 이름)과 Upbit KRW 시세 연결에 사용. 실패하면 기본 사전만 사용.
    let markets = [];
    try {
      const list = await fetchJsonSafe(fetchImpl, UPBIT_MARKETS);
      if (Array.isArray(list)) markets = list;
    } catch (err) {
      out.errors.push('마켓 목록 실패(기본 사전 사용): ' + String(err && err.message));
    }
    const dict = buildDictionary(markets);
    const krw = new Map(markets.filter((m) => typeof m.market === 'string' && m.market.startsWith('KRW-')).map((m) => [m.market.slice(4), m.market]));

    // 1) 출처별 독립 수집 (한 출처의 실패/시간 초과가 다른 출처에 영향 없음)
    const fetched = await Promise.all(
      due.map(async (src) => {
        try {
          const items = await src.fetchItems(fetchImpl, now);
          return { src, items };
        } catch (err) {
          return { src, error: String((err && err.message) || err).slice(0, 200) };
        }
      }),
    );

    // 2) 분석 + 저장 + 클러스터
    const clusters = await store.loadRecentClusters(db, now);
    const touched = new Set();
    for (const f of fetched) {
      if (f.error) {
        out.sources.push({ id: f.src.id, ok: false, error: f.error });
        await store.recordHealth(db, f.src, now, { ok: false, error: f.error });
        continue;
      }
      const enriched = f.items.map((r) => enrichItem(r, f.src, now, dict)).filter(Boolean);
      const known = await store.existingKeys(db, enriched.map((e) => e.urlKey));
      const fresh = enriched.filter((e) => !known.has(e.urlKey)).sort((a, b) => a.eventTime - b.eventTime).slice(-MAX_NEW_PER_SOURCE);
      out.duplicates += enriched.length - fresh.length;
      let added = 0;
      for (const item of fresh) {
        const id = await store.insertItem(db, item);
        if (!id) { out.duplicates += 1; continue; }
        added += 1;
        let c = findCluster(item, clusters);
        if (c) {
          joinCluster(c, item, now);
        } else {
          c = newCluster(item, now);
          c.id = await store.insertCluster(db, c);
          clusters.unshift(c);
        }
        touched.add(c);
        await store.setItemCluster(db, id, c.id);
      }
      out.new_items += added;
      out.sources.push({ id: f.src.id, ok: true, fetched: f.items.length, new: added });
      await store.recordHealth(db, f.src, now, { ok: true, count: f.items.length });
    }

    // 3) 시장 반응 연결: 최근 이벤트의 관련 코인 중 Upbit 원화 마켓이 있는 것만 (실제 1분봉으로 계산)
    const snapTargets = clusters
      .filter((c) => now - (c.publishedKnown ? c.eventTime : c.firstSeenAt) <= SNAPSHOT_WINDOW_MS && c.symbols.some((s) => krw.has(s)))
      .sort((a, b) => b.importance - a.importance);
    const marketList = [];
    for (const c of snapTargets) for (const s of c.symbols) if (krw.has(s) && !marketList.includes(krw.get(s)) && marketList.length < MAX_SNAPSHOT_MARKETS) marketList.push(krw.get(s));
    const candleCache = new Map();
    for (const m of marketList) {
      try {
        if (candleCache.size) await sleep(options.candleIntervalMs ?? 130);
        candleCache.set(m, await fetchJsonSafe(fetchImpl, `https://api.upbit.com/v1/candles/minutes/1?market=${m}&count=100`));
      } catch (err) {
        out.errors.push(`시세 ${m}: ${String(err && err.message).slice(0, 80)}`);
      }
    }
    for (const c of snapTargets) {
      if (out.snapshots >= MAX_SNAPSHOT_ROWS) break;
      const changes = [];
      for (const s of c.symbols) {
        const m = krw.get(s);
        const raw = m && candleCache.get(m);
        if (!raw) continue;
        const r = reactionFromCandles(raw, c.publishedKnown ? c.eventTime : null, now);
        if (!r) continue;
        await store.upsertSnapshot(db, { clusterId: c.id, symbol: s, market: m, takenAt: now, publishedAt: c.publishedKnown ? c.eventTime : null, ...r });
        out.snapshots += 1;
        changes.push(r.change_post15, r.change_15m);
      }
      const bonus = reactionBonus(changes);
      if (changes.length && bonus !== c.reactionBonus) {
        c.reactionBonus = bonus;
        refreshCluster(c, now);
        touched.add(c);
      }
    }

    for (const c of touched) await store.updateCluster(db, c);
    out.clusters_touched = touched.size;
    if (new Date(now).getUTCMinutes() === 0) await store.pruneIntel(db, now);
    out.ok = out.sources.some((s) => s.ok) || due.length === 0;
  } catch (err) {
    out.errors.push(String((err && err.message) || err));
  }
  return out;
}
