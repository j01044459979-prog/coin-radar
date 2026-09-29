// 이벤트 클러스터링 (deterministic). 같은 사건을 다룬 여러 글을 하나의 Event Cluster 로 묶습니다.
//
// 묶는 조건 (모두 만족):
//  - 시간: 클러스터의 마지막 시각과 24시간 이내
//  - 코인: 양쪽에 심볼이 있으면 하나 이상 겹쳐야 함 (서로 다른 코인이면 절대 묶지 않음)
//  - 제목: (A) 단어 집합 유사도(Jaccard) 0.6 이상, 또는
//          (B) 같은 카테고리(일반 제외) + 같은 코인 + 코인 이름을 뺀 핵심 단어 2개 이상 공통

const WINDOW_MS = 24 * 3600 * 1000;
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'for', 'on', 'in', 'at', 'is', 'are', 'as', 'by', 'with', 'from', 'will', 'new', 'its', 'has', 'have', 'after', 'that', 'this', 'says', 'said']);

export function titleTokens(title) {
  return new Set(
    String(title)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(' ')
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}
export const normTitle = (title) => [...titleTokens(title)].sort().join(' ');

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

// item: { title, eventTime, symbols, category } / cluster: { title, lastTime, symbols, category }
export function matches(item, cluster) {
  if (Math.abs(item.eventTime - cluster.lastTime) > WINDOW_MS) return false;
  const a = item.symbols || [];
  const b = cluster.symbols || [];
  const shared = a.filter((s) => b.includes(s));
  if (a.length && b.length && !shared.length) return false;
  const ta = titleTokens(item.title);
  const tb = titleTokens(cluster.title);
  if (jaccard(ta, tb) >= 0.6) return true;
  if (shared.length && item.category === cluster.category && item.category !== 'general') {
    const symTokens = new Set(shared.map((s) => s.toLowerCase()));
    let common = 0;
    for (const t of ta) if (tb.has(t) && !symTokens.has(t)) common += 1;
    return common >= 2;
  }
  return false;
}

// 가장 알맞은 클러스터 하나를 고릅니다 (유사도 높은 순, 같으면 최근 것). 없으면 null.
export function findCluster(item, clusters) {
  let best = null;
  let bestScore = -1;
  const ta = titleTokens(item.title);
  for (const c of clusters) {
    if (!matches(item, c)) continue;
    const s = jaccard(ta, titleTokens(c.title));
    if (s > bestScore || (s === bestScore && best && c.lastTime > best.lastTime)) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}
