// 기회 포착 레이더 Telegram 메시지 생성(순수 함수). HTML 서식은 <b>만 사용하고 외부 문자열은 모두 이스케이프한다.
// 표현 원칙: LONG/SHORT는 '관찰 방향'이지 주문 권고가 아니다. 점수는 조건 충족 개수(설명용)이며 승률·수익을 뜻하지 않는다.
import { bold, escHtml, fmtPrice, htmlToPlain } from '../format.mjs';
import { sortAlerts } from './priority.mjs';

export const MAX_MESSAGE_HTML = 3600;     // Telegram 한도(4000)보다 여유를 둔 분할 기준
export const DISCLAIMER = '※ 차트 조건을 점검한 관찰 알림입니다. 주문 권고가 아니며 이 조건의 수익성은 검증되지 않았습니다. 충족 n/7은 조건 개수 설명용입니다.';

const kst = t => `${new Date(t + 9 * 3600000).toISOString().slice(11, 16)} KST`;
const dirText = dir => (dir === 'LONG' ? 'LONG 관찰' : 'SHORT 관찰');
const icon = dir => (dir === 'LONG' ? '🟢' : '🔴');
export const baseName = symbol => String(symbol).replace(/USDT$/, '');
const trendText = (a) => `4H ${a.dir === 'LONG' ? '상승' : '하락'} 추세`;

// 한 코인의 관찰 블록(HTML)
export function watchBlock(sym, a, event) {
  const L = a.dir === 'LONG', zn = L ? '지지' : '저항', on = L ? '저항' : '지지', m = a.metrics;
  const title = event?.type === 'flip' ? `방향 전환: ${dirText(event.prevDir)} 해제 → ${dirText(a.dir)}`
    : event?.type === 'upgrade' ? `단계 상승: ${a.stageLabel}` : `새 관찰: ${a.stageLabel}`;
  const lines = [`${icon(a.dir)} ${bold(baseName(sym))} · ${bold(dirText(a.dir))} — ${escHtml(title)} (충족 ${a.met}/${a.total})`];
  lines.push(`참고 가격 ${fmtPrice(a.price)} (${kst(a.asOf)} 마감 1H 종가)`);
  if (a.zone) lines.push(`${zn} 구간 ${fmtPrice(a.zone.lo)}~${fmtPrice(a.zone.hi)} (${escHtml(a.zone.type)}) · 무효화 가격 ${fmtPrice(a.invalidation)} (1H 종가가 이 가격을 ${L ? '하향' : '상향'} 이탈하면 관찰 해제)`);
  lines.push(`반대편 ${on} ${a.opposing === null ? '가까운 구간 없음' : fmtPrice(a.opposing)}`);
  const vol = m.relVol === null ? '확인 불가' : `×${m.relVol.toFixed(1)}`;
  const btc = m.btcAlign === '확인 불가' ? 'BTC 4H 확인 불가' : m.btcDir ? `BTC 4H ${m.btcDir === 'UP' ? '상승' : '하락'}(${m.btcAlign})` : 'BTC 4H 중립';
  lines.push(`${trendText(a)} · ${escHtml(btc)} · 상대 거래량 ${vol} · 변동성 ${m.volLabel}(ATR 1H ${m.atr1Pct.toFixed(2)}% / 4H ${m.atr4Pct.toFixed(2)}%) · 추격 위험 ${escHtml(m.chase)}`);
  lines.push(`관찰 이유: ${a.reasons.map(escHtml).join(' / ') || '-'}`);
  lines.push(`미충족: ${a.unmet.length ? a.unmet.map(escHtml).join(' / ') : '없음'}`);
  return lines.join('\n');
}
// 해제 블록(HTML)
export function clearBlock(sym, event, price) {
  const head = event.type === 'invalidated' ? '무효화 이탈로 해제' : '조건 해제';
  return `⚪ ${bold(baseName(sym))} · ${bold(dirText(event.prevDir))} 해제 — ${head}\n사유: ${escHtml(event.reason)}${Number.isFinite(price) ? `\n참고 가격 ${fmtPrice(price)}` : ''}`;
}

// items: [{ symbol, event, analysis, price }] — 한 번에 여러 코인을 길이 제한 안에서 나눠 담는다. 반환: [{ text, plain, html: true }]
export function formatAlerts(items, { now, health = null } = {}) {
  if (!items.length) return [];
  const sorted = sortAlerts(items);                                // 조건 충족 → 무효화 해제 → 방향 전환 → 눌림 → 일반 해제 → 접근 순(호출자가 상한 적용 전에 같은 순서로 정렬)
  const blocks = sorted.map(it => ({ it, html: it.event.type === 'cleared' || it.event.type === 'invalidated' ? clearBlock(it.symbol, it.event, it.price) : watchBlock(it.symbol, it.analysis, it.event) }));
  const header = `🔎 ${bold('기회 포착 레이더')} · 관찰 알림 (${kst(now)})`;
  const extra = health?.excluded?.length ? `\n데이터 점검: ${health.excluded.length}종목 제외(데이터 부족·지연: ${escHtml(health.excluded.slice(0, 5).map(baseName).join(', '))}${health.excluded.length > 5 ? ' 외' : ''})` : '';
  const st = health?.states;
  const stateLine = st ? `\n현재 상태(이번 점검 ${st.analyzed}종목): LONG 관찰 ${st.long.length ? escHtml(st.long.slice(0, 8).map(baseName).join(', ') + (st.long.length > 8 ? ' 외' : '')) : '없음'} · SHORT 관찰 ${st.short.length ? escHtml(st.short.slice(0, 8).map(baseName).join(', ') + (st.short.length > 8 ? ' 외' : '')) : '없음'} · 대기 ${st.wait}종목` : '';
  const parts = []; let cur = [];
  const size = arr => arr.map(b => b.html).join('\n\n').length + header.length + DISCLAIMER.length + extra.length + stateLine.length + 8;
  for (const b of blocks) { if (cur.length && size([...cur, b]) > MAX_MESSAGE_HTML) { parts.push(cur); cur = []; } cur.push(b); }
  if (cur.length) parts.push(cur);
  return parts.map((p, i) => {
    const text = `${header}${parts.length > 1 ? ` [${i + 1}/${parts.length}]` : ''}\n\n${p.map(b => b.html).join('\n\n')}${i === parts.length - 1 ? extra + stateLine : ''}\n\n${escHtml(DISCLAIMER)}`;
    return { text, plain: htmlToPlain(text), html: true, items: p.map(b => b.it) };
  });
}
// 미리보기용 전체 요약(전송하지 않음): 모든 코인의 현재 판정을 한 줄씩
export function summaryLines(rows) {
  return rows.map(r => {
    const a = r.analysis;
    if (!a || a.status !== 'ok') return `${baseName(r.symbol)}: 분석 제외 — ${r.reason ?? a?.reason ?? '데이터 부족'}`;
    return `${baseName(r.symbol)}: ${a.stage >= 1 ? `${dirText(a.dir)} / ${a.stageLabel} (충족 ${a.met}/${a.total})` : `대기${a.trend ? ` (4H ${a.trend === 'UP' ? '상승' : '하락'} 추세, ${a.unmet[0] ?? ''})` : ` (${a.unmet[0] ?? '추세 불명확'})`}`}`;
  });
}

// 첫 실행 기준선 요약(1건): 기존 관찰 상태는 알림 없이 기록했고 이후 변화부터 알린다는 안내. states: [{ symbol, dir, stage, stageLabel }]
export function formatBaseline(states, { now, analyzed, wait, excluded = 0 }) {
  const list = dir => states.filter(s => s.dir === dir).sort((a, b) => b.stage - a.stage || (a.symbol < b.symbol ? -1 : 1)).slice(0, 12).map(s => `${baseName(s.symbol)}(${s.stageLabel})`).join(', ');
  const count = dir => states.filter(s => s.dir === dir).length;
  const text = [`🔎 ${bold('기회 포착 레이더')} · 활성화 기준선 (${kst(now)})`,
    '기능이 켜졌습니다. 현재 관찰 중인 상태는 알림 없이 기준선으로 기록했고, 이후 새 관찰·단계 상승·해제부터 알립니다.',
    `LONG 관찰 ${count('LONG')}종목${count('LONG') ? `: ${escHtml(list('LONG'))}` : ''}`,
    `SHORT 관찰 ${count('SHORT')}종목${count('SHORT') ? `: ${escHtml(list('SHORT'))}` : ''}`,
    `대기 ${wait}종목 · 점검 ${analyzed}종목${excluded ? ` · 분석 제외 ${excluded}종목` : ''}`,
    '', escHtml(DISCLAIMER)].join('\n');
  return { text, plain: htmlToPlain(text), html: true, items: [], baseline: true };
}
