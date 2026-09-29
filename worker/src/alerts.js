// 알림 판정 (순수 함수): 중요 이벤트 선별, cooldown, 중복 방지, 카카오톡 메시지 생성
import { ALERT, MIN } from './config.js';
import { LEVEL_RANK } from './monitor-engine.js';

// 저장할 '이벤트' 기준: 레이더 점수 50 이상 또는 거래량 이상/가격 급변/과열
export function isEvent(row) {
  return row.metrics.status === 'ok' && (row.score.score >= 50 || LEVEL_RANK[row.cls.level] >= LEVEL_RANK.alert);
}

// 카카오톡으로 보낼 '중요 이벤트' 인지 판단. 반환 { important, reason }
export function importance(row, cfg = ALERT) {
  const m = row.metrics;
  if (m.status !== 'ok') return { important: false, reason: '데이터 부족' };
  if (m.quoteVol < cfg.minWindowKrw[m.window]) return { important: false, reason: '구간 거래대금 기준 미달' };
  const c = row.cls;
  if (c.overheat) return { important: true, reason: '과열' };
  if (row.score.score < cfg.minScore) return { important: false, reason: `레이더 점수 ${cfg.minScore} 미만` };
  if (c.priceMove && c.activity) return { important: true, reason: '가격 급변 + 거래 활동 증가 동시 발생' };
  if (m.ratio !== null && m.ratio >= cfg.surgeRatio) return { important: true, reason: `거래 활동 ${cfg.surgeRatio}배 이상 급증` };
  return { important: false, reason: '중요 조건 없음' };
}

export const dedupKey = (row) => `${row.market}|${row.window}|${row.metrics.windowEnd}`;

// 후보(종목별 최고 구간) 중 실제로 보낼 알림 결정
// history = { sent: [{ market, level, sent_at }] (최근 cooldown 이내 전송 기록), hourCount, keys: Set(dedup_key) }
export function decideAlerts(candidates, history, now, cfg = ALERT) {
  const out = [];
  let sentThisRun = 0;
  let hourCount = history.hourCount || 0;
  const since = now - cfg.cooldownMinutes * MIN;
  for (const row of candidates) {
    const imp = importance(row, cfg);
    if (!imp.important) continue;
    const key = dedupKey(row);
    const base = { row, key, reason: imp.reason };
    if (history.keys && history.keys.has(key)) {
      out.push({ ...base, action: 'skip', why: '이미 처리한 같은 이벤트' });
      continue;
    }
    const recent = (history.sent || []).filter((s) => s.market === row.market && s.sent_at >= since);
    if (recent.length) {
      const maxRank = Math.max(...recent.map((s) => LEVEL_RANK[s.level] || 0));
      if (LEVEL_RANK[row.cls.level] <= maxRank) {
        out.push({ ...base, action: 'skip', why: `cooldown ${cfg.cooldownMinutes}분 (같은 종목 최근 알림)` });
        continue;
      }
    }
    if (sentThisRun >= cfg.maxPerRun) {
      out.push({ ...base, action: 'skip', why: `한 번에 최대 ${cfg.maxPerRun}건` });
      continue;
    }
    if (hourCount >= cfg.maxPerHour) {
      out.push({ ...base, action: 'skip', why: `1시간 최대 ${cfg.maxPerHour}건` });
      continue;
    }
    out.push({ ...base, action: 'send', escalation: recent.length > 0 });
    sentThisRun += 1;
    hourCount += 1;
  }
  return out;
}

// ── 메시지 ─────────────────────────────────────────
export function kst(ms, withSeconds = true) {
  const s = new Date(ms + 9 * 60 * MIN).toISOString().replace('T', ' ');
  return withSeconds ? s.slice(0, 19) : s.slice(0, 16);
}
const hmKst = (ms) => kst(ms, false).slice(11);

export function fmtKrw(x) {
  if (x >= 1e12) return '₩' + (x / 1e12).toFixed(2) + '조';
  if (x >= 1e8) return '₩' + (x / 1e8).toFixed(1) + '억';
  if (x >= 1e4) return '₩' + (x / 1e4).toFixed(0) + '만';
  return '₩' + Math.round(x);
}
const pct = (x) => (x > 0 ? '+' : '') + x.toFixed(2) + '%';

const STATE_ICON = { 과열: '🔥', '가격 급변': '⚡', '거래량 이상': '⚠️', '활동 증가': '📈', 관찰: '👀' };

// 카카오톡 "나에게 보내기" 텍스트 메시지 (카카오 텍스트 템플릿 최대 200자 이내로 구성)
export function formatAlertMessage(row, now, extra = {}) {
  const m = row.metrics;
  const coin = row.market.replace(/^KRW-/, '');
  const labels = row.cls.labels;
  const headline = labels.includes('과열') ? '과열' : labels.join(' + ');
  const lines = [
    `🚨 COIN RADAR${extra.escalation ? ' (상태 상향)' : ''}`,
    `${coin} ${headline} 감지`,
    '',
    `⏱ ${m.window}분 (${hmKst(m.windowStart)}~${hmKst(m.windowEnd)})`,
    `💰 가격변동 ${pct(m.changePct)}`,
    `📊 거래활동 ${m.ratio === null ? '평소 거래 없음' : m.ratio.toFixed(1) + '배'}`,
    `🎯 Radar Score ${row.score.score}`,
    '',
    '상태',
    ...labels.map((l) => `${STATE_ICON[l] || '•'} ${l}`),
    '',
    `🕒 ${kst(now, false).slice(5)} KST · Upbit`,
    '※ 투자 권유 아님',
  ];
  return lines.join('\n');
}
