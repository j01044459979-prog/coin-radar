// 추천 전략 화면(?p=strat): 신규 추천 · 진입 대기 · 자동 추적 중 · 종료 전략과 성과 · (선택) 실제 보유 포지션 링크. 모든 값은 서버가 만든 모델에서 와서 dashEsc 로 출력한다(시세 호출 없음).
//  · 추천 전략의 성과는 '전략 기준 가상 추적'이다. 사용자의 실제 Binance 체결·계좌 성과(일지·성적·자산)와 따로 표시한다.
import { dashEsc, dashHead, dashNav } from './dashview.mjs';
import { STRAT_LABEL, sgySummary, sgyIsActive } from './strategy.mjs';

const svUrl = (appUrl, q) => (typeof appUrl === 'string' && /^https:\/\/\S+$/.test(appUrl) ? `${appUrl}${appUrl.includes('?') ? '&' : '?'}${q}` : null);
const svKst = ms => (Number.isFinite(ms) ? new Date(ms + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' ') : '—');
const svDp = p => Math.max((String(p).split('.')[1] || '').length, 2);
const svNum = (v, p) => (v === undefined || v === null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(svDp(p)));
const svSign = (v, d = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
const SV_END = { STOP: '손절', DONE: '목표 완료', INVALIDATED: '무효화(진입 없음)', EXPIRED: '만료', CANCELLED: '추천 취소(제외)' };
const SV_REASON = { 'tp1-before-entry': 'TP1 선도달', '4h-trend-flip': '4시간 추세 반전', 'entry-window-passed': '진입 유효시간 경과', 'max-track-time': '최대 추적 시간', 'not-delivered': '추천 미전달', stop: '최초 손절', 'breakeven-stop': '본전 손절', 'trailing-stop': '추적 손절', 'all-targets': '전량 목표', 'day-loss-limit': '일일 손실 한도', 'margin-cap-total': '증거금 한도', 'too-many-active': '동시 전략 수 한도', 'expired-on-arrival': '전달 지연' };

function svCard(r, now) {
  const x = r.x, plan = x.plan, p = r.entry, F = v => svNum(v, p), tp = plan ? plan.tps : [];
  const filled = x.fills ? x.fills.length : 0, legs = x.legs ? x.legs.length : 0;
  const state = `<span class="badge${['TP1', 'TP2', 'TRAILING', 'DONE'].includes(r.state) ? ' ok' : ''}">${dashEsc(STRAT_LABEL[r.state] || r.state)}</span>`;
  const lines = [`추천 기준 ${F(r.entry)} · 손절 ${F(x.stopPrice !== undefined ? x.stopPrice : r.stop)}${x.stopKind && x.stopKind !== 'initial' ? `(${x.stopKind === 'breakeven' ? '본전' : '추적'})` : ''}${tp.length ? ` · TP1 ${F(tp[0].price)} · TP2 ${F(tp[1].price)}` : ''}`];
  if (r.state === 'CANDIDATE' || r.state === 'WAIT_ENTRY') lines.push(`진입 유효 ~${svKst(x.validUntil)} KST · 1차 지정가 ${plan ? F(plan.stages[0].price) : '—'}`);
  else if (sgyIsActive(r.state)) lines.push(`가상 진입 ${filled}단계 체결 · 가상 청산 ${legs}회${x.fills && x.fills.length ? ` · 시작 ${svKst(x.entryAt)} KST` : ''}`);
  if (plan && sgyIsActive(r.state)) lines.push(`위험 ${(plan.riskPct * 100).toFixed(1)}% · 격리 ${plan.lev}배 · 증거금 ${plan.totalMargin.toFixed(1)} USDT`);
  return `<div class="pc"><div class="row"><div><span class="pill">${dashEsc(r.dir)}</span>${r.x && r.x.grade === 'B' ? '<span class="pill">B급 공격형</span>' : ''}<strong>${dashEsc(r.symbolId.replace(/USDT$/, ''))}</strong> ${state}${r.score !== undefined ? `<span class="sub"> · 점수 ${r.score}</span>` : ''}</div><div class="sub">${dashEsc(svKst(r.createdAt))} KST</div></div>${lines.map(l => `<div class="sub">${dashEsc(l)}</div>`).join('')}<div class="sub">전략 기준 가상 추적 · 실제 체결 아님</div></div>`;
}
function svEnded(r) {
  const x = r.x, res = x.result, p = r.entry;
  const out = res ? `<span class="${res.usdt >= 0 ? 'pos' : 'neg'}">${res.usdt >= 0 ? '▲' : '▼'} ${svSign(res.usdt)} USDT (${svSign(res.r)}R)</span>` : '<span class="zero">■ 진입 없음</span>';
  return `<div class="pc"><div class="row"><div><span class="pill">${dashEsc(r.dir)}</span>${r.x && r.x.grade === 'B' ? '<span class="pill">B급 공격형</span>' : ''}<strong>${dashEsc(r.symbolId.replace(/USDT$/, ''))}</strong> <span class="badge">${dashEsc(SV_END[r.state] || r.state)}</span></div><div>${out}</div></div><div class="sub">${dashEsc(svKst(r.createdAt))} → ${dashEsc(svKst(r.endedAt))} KST · ${dashEsc(SV_REASON[x.reason] || x.reason || '')}${res ? ` · 평균 진입 ${dashEsc(svNum(res.avgEntry, p))}` : ''}${r.score !== undefined ? ` · 점수 ${r.score}` : ''}</div></div>`;
}
// m: { rows:[strategy…], now, feed?:{…}, mode:'off'|'preview'|'on', lastRun? }
export function stratRenderHtml({ m, appUrl = '', build = 'dev' } = {}) {
  const rows = m.rows || [], now = m.now, sm = sgySummary(rows, now), sec = (title, list, empty, fn) => `<section class="card"><div class="k">${dashEsc(title)} (${list.length})</div>${list.length ? list.map(fn).join('') : `<p class="sub">${dashEsc(empty)}</p>`}</section>`;
  const by = st => rows.filter(r => st.includes(r.state)).sort((a, b) => b.createdAt - a.createdAt), ended = rows.filter(r => !sgyIsActive(r.state)).sort((a, b) => b.endedAt - a.endedAt).slice(0, 30);
  const modeText = { off: '꺼짐(자동 추적 안 함)', preview: '미리보기(계산만 — 저장·전송 없음)', on: '켜짐(추천 → 자동 추적·알림)' }[m.mode] || m.mode, ops = svUrl(appUrl, 'p=ops'), pos = svUrl(appUrl, 'p=pos'), jr = svUrl(appUrl, 'p=journal');
  const perf = `<section class="card"><div class="k">추천 전략 가상 성적 (실제 계좌와 별개)</div><div class="grid2"><div><div class="k">진입한 전략</div><div class="v">${sm.entered}<small>건</small></div></div><div><div class="k">승률</div><div class="v">${sm.winRate === null ? '—' : Math.round(sm.winRate * 100) + '<small>%</small>'}</div></div><div><div class="k">가상 손익 합계</div><div class="v ${sm.usdt > 0 ? 'pos' : sm.usdt < 0 ? 'neg' : 'zero'}">${svSign(sm.usdt)}<small> USDT</small></div></div><div><div class="k">평균 R</div><div class="v">${sm.avgR === null ? '—' : svSign(sm.avgR)}<small> R</small></div></div></div>
<div class="sub">손절 ${sm.byState.STOP} · 목표 완료 ${sm.byState.DONE} · 진입 없이 종료 ${sm.notEntered}(무효 ${sm.byState.INVALIDATED} · 만료 ${sm.byState.EXPIRED} · 취소 ${sm.byState.CANCELLED}) · 오늘 ${svSign(sm.todayUsdt)} USDT · 기준 평가액 300 USDT</div></section>`;
  const body = `<header><h1>RICH 300 · 추천 전략</h1></header>${dashNav('strat', appUrl)}
<section class="card"><div class="k">자동 추적 상태</div><div class="sub">COIN RADAR 추천이 생기면 RICH300 이 전략(진입 구간·분할·손절·TP·트레일링)을 만들고 종료까지 자동 추적합니다. 수동 등록은 필요 없습니다. 상태: <strong>${dashEsc(modeText)}</strong>${m.lastRun ? ` · 마지막 실행 ${dashEsc(String(m.lastRun.ageMin))}분 전(${dashEsc(m.lastRun.status)})` : ''}${m.feedOk === false ? ' · 추천 피드 연결 확인 필요' : ''}${ops ? ` · <a href="${dashEsc(ops)}" target="_top">관리 화면</a>` : ''}</div></section>
${perf}
${sec('신규 추천 전략', by(['CANDIDATE']), '전달 중인 새 추천이 없습니다.', r => svCard(r, now))}
${sec('진입 대기 전략', by(['WAIT_ENTRY']), '진입 조건을 기다리는 전략이 없습니다.', r => svCard(r, now))}
${sec('자동 추적 중인 전략', by(['ENTRY_TRIGGERED', 'TRACKING', 'TP1', 'TP2', 'TRAILING']), '가상 진입 후 추적 중인 전략이 없습니다.', r => svCard(r, now))}
${sec('종료 전략 및 성과', ended, '아직 종료된 전략이 없습니다.', svEnded)}
<section class="card"><div class="k">실제 보유 포지션 (선택 기능)</div><div class="sub">Binance 에서 직접 체결한 포지션을 등록하면 손절·익절을 따로 감시합니다. 추천 전략과는 별도이며 성과도 따로 집계됩니다(일지·성적·자산 화면).</div>${pos ? `<a class="cta" target="_top" href="${dashEsc(pos)}">포지션 등록·관리</a>` : ''}${jr ? ` <a class="cta" target="_top" href="${dashEsc(jr)}">일지(실제 성적)</a>` : ''}</section>
<footer>전략 기준 가상 추적 · 자동 주문 없음 · 빌드 ${dashEsc(build)} · 갱신 ${dashEsc(svKst(now))} KST</footer>`;
  const css = `<style>.pc{padding:10px 0;border-bottom:1px solid var(--line)}.pc:last-child{border:0}.pill{display:inline-block;font-size:12px;border:1px solid var(--line);border-radius:999px;padding:1px 9px;margin-right:6px}.row{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}</style>`;
  return `${dashHead('RICH300 추천 전략')}<body><main>${css}${body}</main></body></html>`;
}
