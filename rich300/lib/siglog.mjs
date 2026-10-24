// 추천 기록 화면(COIN RADAR 추천 신호 + 내 응답 + 실제 매매 여부). 뷰 모델·HTML 렌더(서버 측, 순수 함수). 읽기 전용.
//  · 응답 = 진입 / 관망 / 놓침 / 미응답. 관망·놓침·미응답은 매매 손익에 들어가지 않는다(체결이 없으면 손익도 없다).
//  · 실제 매매 여부 = 그 신호에 연결된 체결(fill)이 있는지. 체결가는 추천가와 따로 표시한다.
import { dashEsc, dashHead, dashNav, dashFooter } from './dashview.mjs';
import { anUsd, AN_STRATEGY_NAME } from './analytics.mjs';
import { pnlComputeAll } from './pnl.mjs';
import { dec, decMul, decDiv, decFormat } from './decimal.mjs';
import { RESPONSE_CHOICES } from './schema.mjs';
import { storeList } from './store.mjs';

export const SIGLOG_LIMIT = 80;
export const SIGLOG_FILTERS = Object.freeze({ all: '전체', entered: '진입', watched: '관망', missed: '놓침', none: '미응답' });
const sgKst = ms => new Date(ms + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' ');
const sgTrim = v => (v === undefined || v === null ? null : String(v));
const sgAvg = fs => { let q = 0n, c = 0n; for (const f of fs) if (f.kind === 'entry' || f.kind === 'add') { q += dec(f.qty); c += decMul(dec(f.price), dec(f.qty)); } if (q === 0n) return null; const t = decFormat(decDiv(c, q), 8); return t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t; };      // 실제 평균 진입가(체결 기준)

export function siglogBuild(env, { now = env.now(), filter = 'all' } = {}) {
  const se = env.storeEnv(), data = n => storeList(se, n).map(r => r.data), signals = data('signal'), responses = new Map(data('response').map(r => [r.sid, r])), fills = data('fill');
  const trades = pnlComputeAll(fills, {}), fillsBy = new Map();
  for (const f of fills) { if (!fillsBy.has(f.sid)) fillsBy.set(f.sid, []); fillsBy.get(f.sid).push(f); }
  const f = Object.prototype.hasOwnProperty.call(SIGLOG_FILTERS, filter) ? filter : 'all';
  const rows = signals.sort((a, b) => b.signalAt - a.signalAt || (a.sid < b.sid ? 1 : -1)).map(s => {
    const r = responses.get(s.sid), t = trades.get(s.sid), choice = r ? r.choice : 'none', closed = t && t.status === 'closed', net = closed ? t.totals.netEnteredMicro : null;
    return { sid: s.sid, atLabel: sgKst(s.signalAt), symbol: s.symbolId.replace(/USDT$/, ''), dir: s.dir, strategy: s.strategy, strategyName: AN_STRATEGY_NAME[s.strategy] ?? s.strategy, score: s.score ?? null,
      entry: s.entry, stop: s.stop, tp1: s.tp1, tp2: sgTrim(s.tp2), choice, choiceLabel: r ? RESPONSE_CHOICES[r.choice] : '미응답', traded: (fillsBy.get(s.sid) ?? []).length > 0, status: t ? t.status : null,
      netLabel: net === null ? null : anUsd(net, { sign: true }), win: net !== null && net > 0n, loss: net !== null && net < 0n, avgEntry: sgAvg(fillsBy.get(s.sid) ?? []) };
  });
  const count = k => rows.filter(x => x.choice === k).length, shown = rows.filter(x => f === 'all' || x.choice === f);
  return { generatedAt: now, filter: f, total: rows.length, counts: { entered: count('entered'), watched: count('watched'), missed: count('missed'), none: count('none') }, tradedCount: rows.filter(x => x.traded).length,
    enteredNoFill: rows.filter(x => x.choice === 'entered' && !x.traded).length, rows: shown.slice(0, SIGLOG_LIMIT), shownTotal: shown.length };
}

const sgUrl = (appUrl, q) => (typeof appUrl === 'string' && /^https:\/\/\S+$/.test(appUrl) ? `${appUrl}${appUrl.includes('?') ? '&' : '?'}${q}` : null);
export function siglogRenderHtml(m, { appUrl } = {}) {
  const chips = Object.entries(SIGLOG_FILTERS).map(([k, label]) => { const u = sgUrl(appUrl, `p=signals${k === 'all' ? '' : `&r=${k}`}`), n = k === 'all' ? m.total : m.counts[k]; return `<a class="chip"${u ? ` target="_top" href="${dashEsc(u)}"` : ''}${m.filter === k ? ' aria-current="true"' : ''}>${label} ${n}</a>`; }).join('');
  const item = x => `<article class="sg"><div class="top"><div><span class="pill">${dashEsc(x.dir)}</span><strong>${dashEsc(x.symbol)}</strong> <span class="badge">${dashEsc(x.strategy)}${x.score !== null ? ` · ${x.score}점` : ''}</span></div>`
    + `<div class="ch ${x.choice}">${dashEsc(x.choiceLabel)}</div></div><div class="sub">${dashEsc(x.atLabel)} KST · ${dashEsc(x.strategyName)}</div>`
    + `<div class="px">추천 진입 ${dashEsc(x.entry)} · 손절 ${dashEsc(x.stop)} · 1차 ${dashEsc(x.tp1)}${x.tp2 ? ` · 2차 ${dashEsc(x.tp2)}` : ''}</div>`
    + `<div class="sub">${x.traded ? `실제 매매 있음${x.avgEntry ? ` · 실제 진입가 ${dashEsc(x.avgEntry)}` : ''} · ${x.status === 'open' ? '보유 중' : x.netLabel ? `결과 <span class="${x.win ? 'pos' : x.loss ? 'neg' : 'zero'}">${x.win ? '▲' : x.loss ? '▼' : '■'} ${dashEsc(x.netLabel)} USDT</span>` : ''}` : x.choice === 'entered' ? '진입했다고 눌렀지만 체결 기록이 아직 없습니다' : '실제 매매 없음(손익에 포함되지 않음)'}</div></article>`;
  return `${dashHead('RICH300 추천 기록')}<body><main><header><h1>RICH 300 · 추천 기록</h1></header>${dashNav('signals', appUrl)}
<style>.chips{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px}.chip{font-size:13px;padding:8px 12px;min-height:38px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--ink2);text-decoration:none}.chip[aria-current="true"]{border-color:var(--accent);color:var(--ink);font-weight:650}.sg{border-top:1px solid var(--line);padding:10px 0}.sg:first-child{border-top:0}.top{display:flex;justify-content:space-between;gap:8px;align-items:center}.px{font-size:13px;margin-top:2px}.pill{display:inline-block;font-size:11px;font-weight:650;border:1px solid currentColor;border-radius:6px;padding:0 6px;margin-right:6px;color:var(--ink2)}.ch{font-size:13px;font-weight:650;white-space:nowrap}.ch.entered{color:var(--good)}.ch.none{color:var(--mute)}</style>
<section aria-label="요약"><div class="card"><div class="grid2"><div><div class="k">추천 신호</div><div class="v">${m.total}<small>건</small></div></div><div><div class="k">실제 진입(체결 있음)</div><div class="v">${m.tradedCount}<small>건</small></div></div></div>
<div class="sub" style="margin-top:8px">진입 ${m.counts.entered} · 관망 ${m.counts.watched} · 놓침 ${m.counts.missed} · 미응답 ${m.counts.none}${m.enteredNoFill ? ` · 진입 눌렀지만 체결 기록 없음 ${m.enteredNoFill}` : ''}</div></div></section>
<section aria-label="목록"><div class="chips" role="group" aria-label="응답별 보기">${chips}</div><div class="card">${m.rows.length ? m.rows.map(item).join('') : '<p class="sub">표시할 추천이 없습니다.</p>'}${m.shownTotal > m.rows.length ? `<div class="sub">최근 ${m.rows.length}건만 표시</div>` : ''}</div></section>
<div class="sub">관망·놓침은 추천 기록에만 남고 실제 매매 손익에 포함되지 않습니다. 추천가는 참고 가격이며 실제 체결가와 따로 기록됩니다.</div>
${dashFooter(m)}</main></body></html>`;
}
export const siglogRenderError = appUrl => `${dashHead('RICH300 추천 기록')}<body><main><header><h1>RICH 300 · 추천 기록</h1></header>${dashNav('signals', appUrl)}<section class="card"><p>추천 기록을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.</p></section></main></body></html>`;
