// Crypto Intelligence 수집 엔진: 수집 → 분류 → 중복 제거/클러스터 → 시장 반응 연결 → D1 저장.
// 별도 Cron(*/2)에서 실행되며 기존 1분 Upbit 감시(monitor.js)와 독립적입니다. AI/LLM 은 사용하지 않습니다.
import { safeUrl, urlKey } from './text.js';
import { detectSymbols, buildDictionary } from './symbols.js';
import { detectCategory, baseImportance, clusterImportance, verificationOf, reactionBonus, TIER } from './classify.js';
import { findCluster } from './cluster.js';
import { reactionFromCandles } from './market.js';
import { enabledSources, fetchText } from './sources.js';
import * as store from './store.js';

const MAX_NEWS_PER_RUN = 1; // 실행당 뉴스(RSS) 출처 수. 무료 플랜 CPU(10ms) 보호 — 2분마다 1개씩 돌아가며 수집

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

// 이번 실행에서 다룰 출처: 때가 된 공식 출처는 모두, 뉴스는 가장 오래 기다린 것부터 maxNews 개
export function selectSources(due, health, maxNews = MAX_NEWS_PER_RUN) {
  const waited = (s) => (health.get(s.id) && health.get(s.id).last_attempt_at) || 0;
  const official = due.filter((s) => s.type === 'official');
  const others = due.filter((s) => s.type !== 'official').sort((a, b) => waited(a) - waited(b));
  return [...official, ...others.slice(0, maxNews)];
}

const errText = (err) => String((err && err.message) || err).slice(0, 200);

// 진단 기록은 실패해도 수집을 막지 않습니다
async function meta(db, key, value, now) {
  try {
    await store.setMeta(db, key, value, now);
  } catch { /* 진단 기록 실패는 무시 */ }
}

// options: { fetchImpl, force, maxNews, candleIntervalMs }
// 각 단계는 서로 독립입니다: 한 단계/한 출처의 실패가 다른 출처의 수집·기록을 막지 않습니다.
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
  } catch (err) {
    out.errors.push('D1 스키마 준비 실패: ' + errText(err));
    return out;
  }

  // 0) 아무 작업도 하기 전에 "시작" 을 기록: 이후 종료(CPU/시간 제한)되면 시작만 있고 완료가 없는 흔적이 남음
  await meta(db, 'last_collector_started_at', now, now);
  try {
    let health = new Map();
    try {
      health = await store.loadHealth(db);
    } catch (err) {
      out.errors.push('source_health 조회 실패(전체를 대상으로 진행): ' + errText(err));
    }
    const active = enabledSources(env);
    const due = active.filter((s) => options.force || isDue(s, health.get(s.id), now));
    const run = selectSources(due, health, options.maxNews ?? MAX_NEWS_PER_RUN);
    try {
      await store.markAttempts(db, run, now);
    } catch (err) {
      out.errors.push('시도 기록 실패: ' + errText(err));
    }

    // 1) 네트워크: 마켓 목록과 각 출처를 병렬로 받되 서로 실패가 전파되지 않음 (allSettled)
    const marketsP = fetchJsonSafe(fetchImpl, UPBIT_MARKETS).then((l) => (Array.isArray(l) ? l : []));
    const rawsP = run.map((src) => Promise.resolve().then(() => src.fetchRaw(fetchImpl)).then((raw) => ({ src, raw }), (err) => ({ src, error: errText(err) })));
    let markets = [];
    try {
      markets = await marketsP;
    } catch (err) {
      out.errors.push('마켓 목록 실패(기본 사전 사용): ' + errText(err));
    }
    const fetched = await Promise.all(rawsP);
    const dict = buildDictionary(markets);
    const krw = new Map(markets.filter((m) => typeof m.market === 'string' && m.market.startsWith('KRW-')).map((m) => [m.market.slice(4), m.market]));

    // 2) 출처마다 순서대로: 파싱 → 분석 → 저장 → 상태 기록. 어느 단계가 실패해도 그 출처만 오류로 기록하고 다음 출처로 진행
    let clusters = [];
    try {
      clusters = await store.loadRecentClusters(db, now);
    } catch (err) {
      out.errors.push('최근 클러스터 조회 실패: ' + errText(err));
    }
    const touched = new Set();
    for (const f of fetched) {
      let result;
      try {
        if (f.error) throw new Error(f.error);
        const items = f.src.parse(f.raw, now);
        const enriched = items.map((r) => enrichItem(r, f.src, now, dict)).filter(Boolean);
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
        result = { id: f.src.id, ok: true, fetched: items.length, new: added };
      } catch (err) {
        result = { id: f.src.id, ok: false, error: errText(err) };
      }
      out.sources.push(result);
      try {
        await store.recordHealth(db, f.src, now, result.ok ? { ok: true, count: result.fetched } : { ok: false, error: result.error });
      } catch (err) {
        out.errors.push(`${f.src.id} 상태 기록 실패: ${errText(err)}`);
      }
    }

    // 3) 시장 반응 연결: 실패해도 수집 결과에는 영향 없음
    try {
      await attachMarketReaction(db, clusters, krw, touched, now, fetchImpl, options, out);
    } catch (err) {
      out.errors.push('시장 반응 연결 실패: ' + errText(err));
    }
    for (const c of touched) {
      try {
        await store.updateCluster(db, c);
      } catch (err) {
        out.errors.push('클러스터 저장 실패: ' + errText(err));
      }
    }
    out.clusters_touched = touched.size;
    if (new Date(now).getUTCMinutes() === 0) {
      try {
        await store.pruneIntel(db, now);
      } catch (err) {
        out.errors.push('정리 실패: ' + errText(err));
      }
    }
    out.ok = out.sources.some((s) => s.ok) || run.length === 0;
  } catch (err) {
    out.errors.push(errText(err));
  }
  // 마지막: 완료와 오류 요약 기록
  await meta(db, 'last_collector_error', out.errors.length ? out.errors.slice(0, 3).join(' | ') : '', now);
  await meta(db, 'last_collector_finished_at', Date.now() > now ? Date.now() : now, now);
  return out;
}

async function attachMarketReaction(db, clusters, krw, touched, now, fetchImpl, options, out) {
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
}
