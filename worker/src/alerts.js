// 이상 이벤트 탐지 (순수 함수). 외부 메신저 전송은 하지 않습니다 (Phase 5에서 제거).
// 결과는 D1 events 표와 /api/monitor/status 에서 확인하며, 향후 웹사이트 내부 알림에 재사용할 수 있습니다.
import { IMPORTANT } from './config.js';
import { LEVEL_RANK } from './monitor-engine.js';

// 저장할 '이벤트' 기준: 레이더 점수 50 이상 또는 거래량 이상/가격 급변/과열
export function isEvent(row) {
  return row.metrics.status === 'ok' && (row.score.score >= 50 || LEVEL_RANK[row.cls.level] >= LEVEL_RANK.alert);
}

// '중요 이벤트' 인지 판단 (상태 화면 표시용). 반환 { important, reason }
export function importance(row, cfg = IMPORTANT) {
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
