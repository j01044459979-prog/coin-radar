// Crypto Intelligence 수집 엔진: 수집 → 분류 → 중복 제거/클러스터 → 시장 반응 연결 → D1 저장.
// 별도 Cron(*/2)에서 실행되며 기존 1분 Upbit 감시(monitor.js)와 독립적입니다. AI/LLM 은 사용하지 않습니다.
import { safeUrl, urlKey } from './text.js';
import { detectSymbols, buildDictionary } from './symbols.js';
import { detectCategory, baseImportance, clusterImportance, verificationOf, reactionBonus, TIER } from './classify.js';
import { findCluster } from './cluster.js';
import { reactionFromCandles } from './market.js';
import { enabledSources, fetchText } from './sources.js';
import { ingestSocial, reconcileSocial, MAX_NEW_PER_RUN as SOCIAL_MAX_NEW } from './social.js';
import * as sstore from './social-store.js';
import * as store from './store.js';

// ── CPU 예산 (무료 플랜: 실행당 CPU 약 10ms, Cloudflare 가 초과 실행을 흔적 없이 중단) ──────────────────
// 출처마다 cost = '새 항목이 없는 평상시' 비용 단위, 새 항목/지연 로딩 자원은 아래 상수만큼 추가로 셉니다.
// 실행은 ① 목표 주기를 가장 많이 넘긴 출처부터 base cost 합계가 DEFAULT_BUDGET 이하가 되게 고르고,
// ② 실행 도중 누적 비용이 HARD_LIMIT_FACTOR × 예산을 넘으면 남은 출처는 건드리지 않고 다음 실행으로 넘깁니다.
// 유료 플랜이면 env.INTEL_BUDGET 으로 올릴 수 있음.
export const DEFAULT_BUDGET = 4;
export const HARD_LIMIT_FACTOR = 1.5;
const ITEM_COST = 0.3; // 새 항목 1개(분석 + 저장 + 클러스터)
const DICT_COST = 1.5; // 마켓 목록 + 심볼 사전 (새 항목이 있을 때만 구성)
const CLUSTER_COST = 0.7; // 최근 클러스터 로드 (새 항목이 있을 때만)
const SNAPSHOT_COST = 1.5; // 시세 반응 갱신
export const MAX_NEW_PER_SOURCE = 8; // 한 출처가 한 실행에서 새로 처리할 항목 상한 (나머지는 다음 실행에서 이어서)
export const recoveryCap = (failures) => Math.max(2, MAX_NEW_PER_SOURCE >> Math.min(failures || 0, 2)); // 이전 실행이 미완료였던 출처: 8 → 4 → 2

const MAX_SNAPSHOT_MARKETS = 4; // 실행당 Upbit 캔들 요청 상한
const MAX_SNAPSHOT_ROWS = 12; // 실행당 시세 스냅샷 D1 쓰기 상한
const SNAPSHOT_WINDOW_MS = 60 * 60000; // 이벤트 후 1시간 동안만 시세 반응을 갱신
const SNAPSHOT_TICK_MIN = 6; // 새 이벤트가 없어도 6분마다 한 번 갱신
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
  countSource(c, item);
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

// 소스 종류별 집계와 관측 시각 (공식/뉴스). Telegram/커뮤니티는 social.js 의 attachToCluster
function countSource(c, item) {
  if (item.sourceType === 'official') {
    c.officialCount = (c.officialCount || 0) + 1;
    c.officialSeenAt = item.publishedAt ? Math.min(c.officialSeenAt || item.publishedAt, item.publishedAt) : c.officialSeenAt ?? null;
  } else if (item.sourceType === 'news') {
    c.newsCount = (c.newsCount || 0) + 1;
  }
}

function newCluster(item, now) {
  const c = {
    id: null, title: item.title, url: item.url, category: item.category, symbols: item.symbols.slice(), importanceBase: item.importance, reactionBonus: 0, importance: 0,
    verification: 'unverified', source: item.source, sourceType: item.sourceType, sources: [{ source: item.source, sourceType: item.sourceType }], itemCount: 1, sourceCount: 1,
    publishedKnown: !!item.publishedAt, eventTime: item.eventTime, lastTime: item.eventTime, firstSeenAt: now, updatedAt: now,
    officialCount: 0, newsCount: 0, telegramCount: 0, communityCount: 0, officialSeenAt: null, socialSeenAt: null, communitySeenAt: null,
  };
  countSource(c, item);
  refreshCluster(c, now);
  return c;
}

async function fetchJsonSafe(fetchImpl, url) {
  return JSON.parse(await fetchText(fetchImpl, url, 'application/json'));
}

// 목표 주기를 얼마나 넘겼는지 (1 = 딱 때가 됨, 클수록 더 늦음). 한 번도 시도 안 했으면 Infinity.
export function overdue(src, h, now) {
  if (!h || !h.last_attempt_at) return Infinity;
  const backoff = Math.min(1 + (h.consecutive_failures || 0), 4);
  return (now - h.last_attempt_at) / (src.intervalMs * backoff);
}

// 이번 실행에서 다룰 출처 (base cost 합계 ≤ budget). 가장 늦은 출처부터 → 공식이든 Telegram 이든 굶지 않음.
export function selectSources(due, health, budget = DEFAULT_BUDGET, now = Date.now()) {
  const cost = (s) => s.cost ?? 2;
  const byLateness = (list) => list.map((s, i) => ({ s, i, r: overdue(s, health.get(s.id), now) })).sort((a, b) => (a.r === b.r ? a.i - b.i : b.r - a.r)).map((x) => x.s);
  const picked = [];
  let left = budget;
  // 공식 공지를 먼저 예약: 가장 시간에 민감하고 평상시 비용이 작음. Telegram/뉴스가 한꺼번에 때가 돼도 공식 수집이 밀리지 않게 함
  // (나머지는 남은 예산 안에서 목표 주기를 가장 많이 넘긴 순서 → 소셜/뉴스도 굶지 않음).
  for (const s of [...byLateness(due.filter((x) => x.type === 'official')), ...byLateness(due.filter((x) => x.type !== 'official'))]) {
    if (cost(s) <= left) {
      picked.push(s);
      left -= cost(s);
    }
  }
  if (!picked.length && due.length) picked.push(byLateness(due)[0]); // 예산보다 큰 출처뿐이어도 가장 늦은 1개는 실행
  return picked; // 공식이 항상 앞 → 처리 순서도 공식 먼저 (Telegram 폭주로 실행 도중 예산을 다 써도 이월되는 쪽은 뒤의 소셜/뉴스)
}

// 실행 계획. 이전 실행이 '미완료'(시작만 하고 끝나지 않음)로 남긴 출처가 있으면 그 출처 하나만 축소 모드로 단독 실행해
// 같은 무거운 실행이 반복돼 죽는 것을 끊고(복구), 다른 출처는 backoff 로 굶지 않게 번갈아 처리됩니다.
export function planRun(due, health, budget, now) {
  const stuck = due.filter((s) => health.get(s.id) && health.get(s.id).last_error === store.INCOMPLETE).sort((a, b) => (health.get(a.id).last_attempt_at || 0) - (health.get(b.id).last_attempt_at || 0));
  if (stuck.length) return { run: [stuck[0]], recovery: true };
  return { run: selectSources(due, health, budget, now), recovery: false };
}

const errText = (err) => String((err && err.message) || err).slice(0, 200);

// 진단 기록은 실패해도 수집을 막지 않습니다
async function meta(db, key, value, now) {
  try {
    await store.setMeta(db, key, value, now);
  } catch { /* 진단 기록 실패는 무시 */ }
}

// 공식 공지 / 뉴스: 키만 훑기 → 이미 저장된 항목 제외 → 새 항목만 분석·저장·클러스터. 새 항목이 없으면 사전/클러스터 로딩 자체를 하지 않음.
async function processItemSource(f, ctx, cap) {
  const { db, now, touched, out, itemTouched } = ctx;
  const scan = f.src.scan(f.raw, now, { maxAgeMs: f.src.maxAgeMs });
  const known = scan.keys.length ? await store.existingKeys(db, scan.keys) : new Set();
  const unknown = scan.keys.filter((k) => !known.has(k)).length;
  out.duplicates += scan.keys.length - unknown;
  const raw = unknown ? scan.build(known, cap) : [];
  if (!raw.length) return { id: f.src.id, ok: true, fetched: scan.keys.length, new: 0 };
  const dict = await ctx.getDict();
  const clusters = await ctx.getClusters();
  const fresh = raw.map((r) => enrichItem(r, f.src, now, dict)).filter(Boolean).sort((a, b) => a.eventTime - b.eventTime);
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
    itemTouched.add(c);
    await store.setItemCluster(db, id, c.id);
  }
  out.new_items += added;
  return { id: f.src.id, ok: true, fetched: scan.keys.length, new: added, backlog: Math.max(0, unknown - raw.length) };
}

// Telegram / 커뮤니티: 이미 저장된 메시지는 파싱·분석하지 않고, 새 글만 저장 + 이벤트 클러스터에 집계로 연결 (social.js)
async function processSocialSource(f, ctx, cap) {
  const { db, now, touched, out } = ctx;
  const known = f.src.peekIds ? await sstore.existingMessageIds(db, f.src.id, f.src.peekIds(f.raw)) : null;
  let items = f.src.parse(f.raw, now, { skip: known, limit: Math.min(cap, SOCIAL_MAX_NEW) });
  if (!f.src.peekIds && items.length) { // 번호를 미리 훑을 수 없는 출처(커뮤니티): 저장된 글을 먼저 걸러 사전/클러스터 로딩을 피함
    const have = await sstore.existingMessageIds(db, f.src.id, items.map((i) => String(i.messageId)));
    items = items.filter((i) => !have.has(String(i.messageId)));
  }
  if (!items.length) return { id: f.src.id, ok: true, fetched: 0, new: 0 };
  const dict = await ctx.getDict();
  const clusters = await ctx.getClusters();
  const r = await ingestSocial(db, f.src, items, { now, dict, clusters, touched });
  out.new_items += r.new;
  return { id: f.src.id, ok: true, fetched: items.length, new: r.new, linked: r.linked };
}

// options: { fetchImpl, force, budget, hardLimit, candleIntervalMs }
// 각 단계는 서로 독립입니다: 한 단계/한 출처의 실패가 다른 출처의 수집·기록을 막지 않습니다.
export async function runIntelligence(env, now, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const out = { ok: false, ran_at: now, sources: [], deferred: [], recovery: false, spent: 0, new_items: 0, duplicates: 0, clusters_touched: 0, snapshots: 0, errors: [] };
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
    const envBudget = Number(env && env.INTEL_BUDGET);
    const budget = options.budget ?? (Number.isFinite(envBudget) && envBudget >= 1 ? Math.min(envBudget, 20) : DEFAULT_BUDGET);
    const hardLimit = options.hardLimit ?? budget * HARD_LIMIT_FACTOR;
    const plan = planRun(due, health, budget, now);
    const run = plan.run;
    out.recovery = plan.recovery;

    // 1) 네트워크(CPU 거의 없음): 이번에 다룰 출처만 병렬로 받음. 한 출처의 실패가 다른 출처에 전파되지 않음.
    const rawsP = run.map((src) => Promise.resolve().then(() => src.fetchRaw(fetchImpl, env)).then((raw) => ({ src, raw }), (err) => ({ src, error: errText(err) })));

    // 새 항목이 있을 때만 쓰는 자원은 지연 로딩 (평상시 실행은 마켓 목록 fetch·사전 구성·클러스터 로드를 하지 않음)
    let spent = 0;
    const lazy = { dict: null, krw: new Map(), clusters: null };
    const ctx = {
      db, now, out, touched: new Set(), itemTouched: new Set(), // itemTouched: 공식/뉴스로 새로 생기거나 바뀐 클러스터 (소셜 글 재연결 대상)
      async getDict() {
        if (!lazy.dict) {
          let markets = [];
          try {
            const l = await fetchJsonSafe(fetchImpl, UPBIT_MARKETS);
            if (Array.isArray(l)) markets = l;
          } catch (err) {
            out.errors.push('마켓 목록 실패(기본 사전 사용): ' + errText(err));
          }
          lazy.dict = buildDictionary(markets);
          lazy.krw = new Map(markets.filter((m) => typeof m.market === 'string' && m.market.startsWith('KRW-')).map((m) => [m.market.slice(4), m.market]));
          spent += DICT_COST;
        }
        return lazy.dict;
      },
      async getClusters() {
        if (!lazy.clusters) {
          try {
            lazy.clusters = await store.loadRecentClusters(db, now);
          } catch (err) {
            lazy.clusters = [];
            out.errors.push('최근 클러스터 조회 실패: ' + errText(err));
          }
          spent += CLUSTER_COST;
        }
        return lazy.clusters;
      },
    };

    // 2) 출처마다 순서대로: (처리 직전 시도 기록) → 훑기 → 새 항목만 분석·저장 → 상태 기록.
    //    누적 비용이 한계를 넘으면 남은 출처는 손대지 않고(시도 기록도 안 남김) 다음 실행으로 넘김.
    let processed = 0;
    for (const p of rawsP) {
      const f = await p;
      if (processed > 0 && spent >= hardLimit) {
        out.deferred.push(f.src.id);
        continue;
      }
      processed += 1;
      try {
        await store.markAttempts(db, [f.src], now);
      } catch (err) {
        out.errors.push(`${f.src.id} 시도 기록 실패: ${errText(err)}`);
      }
      let result;
      try {
        if (f.error) throw new Error(f.error);
        const failures = (health.get(f.src.id) && health.get(f.src.id).consecutive_failures) || 0;
        const cap = plan.recovery ? recoveryCap(failures) : MAX_NEW_PER_SOURCE;
        result = f.src.pipeline === 'social' ? await processSocialSource(f, ctx, cap) : await processItemSource(f, ctx, cap);
        spent += (f.src.cost ?? 2) + (result.new || 0) * ITEM_COST;
      } catch (err) {
        result = { id: f.src.id, ok: false, error: errText(err) };
        spent += 0.3;
      }
      out.sources.push(result);
      try {
        await store.recordHealth(db, f.src, now, result.ok ? { ok: true, count: result.fetched } : { ok: false, error: result.error });
      } catch (err) {
        out.errors.push(`${f.src.id} 상태 기록 실패: ${errText(err)}`);
      }
    }

    // 2-b) 공식/뉴스가 새로 생긴 경우: 이미 저장된 소셜 글 중 같은 사건을 연결하고 검증 상태를 맞춤 (Telegram 이 먼저 올라온 경우 포함)
    if (ctx.itemTouched.size) {
      try {
        await reconcileSocial(db, [...ctx.itemTouched], { now, touched: ctx.touched });
      } catch (err) {
        out.errors.push('소셜 재연결 실패: ' + errText(err));
      }
    }

    // 3) 시장 반응 연결: 새 이벤트가 있거나 6분마다, 그리고 예산이 남았을 때만. 실패해도 수집 결과에는 영향 없음
    const tick = Math.floor(now / 60000) % SNAPSHOT_TICK_MIN === 0;
    if ((ctx.touched.size || tick || options.force) && (options.force || spent + SNAPSHOT_COST <= hardLimit)) {
      try {
        spent += SNAPSHOT_COST;
        await attachMarketReaction(ctx, lazy, fetchImpl, options);
      } catch (err) {
        out.errors.push('시장 반응 연결 실패: ' + errText(err));
      }
    }
    for (const c of ctx.touched) {
      try {
        await store.updateCluster(db, c);
      } catch (err) {
        out.errors.push('클러스터 저장 실패: ' + errText(err));
      }
    }
    out.clusters_touched = ctx.touched.size;
    out.spent = Math.round(spent * 10) / 10;
    if (new Date(now).getUTCMinutes() === 0) {
      try {
        await store.pruneIntel(db, now);
        await sstore.pruneSocial(db, now);
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

// 최근 1시간 이벤트의 관련 코인 중 Upbit 원화 마켓이 있는 것만 실제 1분봉으로 시세 반응을 계산 (젊은 클러스터만 작은 쿼리로 조회)
async function attachMarketReaction(ctx, lazy, fetchImpl, options) {
  const { db, now, touched, out } = ctx;
  const byId = new Map();
  for (const c of await store.loadYoungClusters(db, now)) byId.set(c.id, c);
  for (const c of touched) if (c.id) byId.set(c.id, c); // 이번 실행에서 바뀐 것은 메모리 값이 최신
  const candidates = [...byId.values()].filter((c) => now - (c.publishedKnown ? c.eventTime : c.firstSeenAt) <= SNAPSHOT_WINDOW_MS && c.symbols.length);
  if (!candidates.length) return;
  await ctx.getDict(); // 마켓 목록 (지연 로딩)
  const krw = lazy.krw;
  const snapTargets = candidates.filter((c) => c.symbols.some((s) => krw.has(s))).sort((a, b) => b.importance - a.importance);
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
