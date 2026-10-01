// COIN RADAR 정보(뉴스/공지) 화면용 순수 함수 모음 (DOM/네트워크 없음 → Node 테스트 가능)
// 표시하는 제목·링크·시간·중요도는 모두 Worker API(/api/intelligence/*)가 D1 에서 돌려준 값입니다.
// 이 파일은 값을 만들어내지 않고, 없는 값은 숨기거나 '수집 중'으로 표시합니다. 외부 문자열은 항상 esc() 를 거칩니다.
(function (root) {
  'use strict';

  const VERSION = '1.5.0'; // radar-core.js 등 다른 assets 의 VERSION 과 같게 유지
  const API_BASE = 'https://coin-radar-engine.j01044459979.workers.dev';

  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // http/https 만 허용. javascript:, data: 등은 null → 링크를 아예 그리지 않음
  function safeUrl(u) {
    if (typeof u !== 'string' || !u || u.length > 2048 || /[\u0000-\u001f\s]/.test(u)) return null;
    try {
      const x = new URL(u);
      if ((x.protocol !== 'https:' && x.protocol !== 'http:') || x.username || x.password) return null;
      return x.href;
    } catch (e) {
      return null;
    }
  }

  const CATEGORY_LABEL = {
    listing: '상장', delisting: '상장폐지·거래지원 종료', warning: '투자유의', trading: '거래지원', deposit: '입출금', network: '네트워크',
    maintenance: '점검', airdrop: '에어드롭', promotion: '프로모션', security: '보안사고', regulation: '규제·정책', general: '일반',
  };
  const VERIFY_LABEL = { official: '공식 확인', multi: '복수 출처 확인', news: '뉴스 보도', unverified: '미확인' };
  const KIND_LABEL = { official: '공식', news: '뉴스', social: '소셜', community: '커뮤니티' };
  const SOURCE_NAME = { binance: 'Binance', upbit: 'Upbit', blockmedia: 'BlockMedia', coindesk: 'CoinDesk', cointelegraph: 'Cointelegraph' };
  const sourceName = (id) => SOURCE_NAME[id] || String(id || '');

  // ── 시간 ──
  function relTime(t, now) {
    if (typeof t !== 'number' || !Number.isFinite(t)) return '';
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return '방금 전';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}시간 전`;
    return `${Math.floor(h / 24)}일 전`;
  }
  // 브라우저 시간대와 무관하게 한국 시간(KST, UTC+9) "09-29 12:10"
  function kstTime(t) {
    if (typeof t !== 'number' || !Number.isFinite(t)) return '';
    const d = new Date(t + 9 * 3600000);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  }
  // 게시 시간이 있으면 게시 기준, 없으면 '게시 시간 미확인 · 수집 N분 전' (수집 시각과 혼동하지 않음)
  function timeText(ev, now) {
    if (typeof ev.published_at === 'number') return `${relTime(ev.published_at, now)} · ${kstTime(ev.published_at)} KST`;
    return `게시 시간 미확인 · 수집 ${relTime(ev.first_seen_at, now)}`;
  }
  const evTime = (ev) => (typeof ev.published_at === 'number' ? ev.published_at : ev.first_seen_at);

  // ── 필터: 종류(전체/공식/뉴스) + 코인(전체/BTC/ETH/SOL/XRP/기타) ──
  const COINS = ['BTC', 'ETH', 'SOL', 'XRP'];
  function filterEvents(events, kind, coin) {
    return events.filter((e) => {
      if (kind === 'official' && e.source_type !== 'official') return false;
      if (kind === 'news' && e.source_type === 'official') return false;
      const syms = e.symbols || [];
      if (COINS.includes(coin)) return syms.includes(coin);
      if (coin === 'OTHER') return !syms.some((s) => COINS.includes(s));
      return true;
    });
  }

  // 전체 레이더의 '최근 중요 정보': 정보 중요도 - 경과 시간 감점(시간당 1.5점, 최대 40점). 48시간 넘은 것은 제외.
  function rankTop(events, now, n) {
    const scored = events
      .map((e) => {
        const ageH = Math.max(0, (now - evTime(e)) / 3600000);
        return { e, ageH, score: e.importance - Math.min(40, ageH * 1.5) };
      })
      .filter((x) => x.ageH <= 48);
    scored.sort((a, b) => b.score - a.score || evTime(b.e) - evTime(a.e));
    return scored.slice(0, n).map((x) => x.e);
  }

  // ── 시장 반응 ──
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const pct = (v, d) => (v > 0 ? '+' : '') + v.toFixed(d) + '%';
  const pctCls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const cell = (v, d = 2) => (isNum(v) ? { text: pct(v, d), cls: pctCls(v) } : { text: '수집 중', cls: 'wait' });

  // input: { price5, price15, ratio, oi5, oi15, fundingPct, upbit:{ change_pre5, change_post5, change_post15 } }
  // 값이 하나도 없는 줄은 만들지 않습니다. 반환: [{ label, parts:[{text, cls}] }]
  function reactionRows(input) {
    const r = input || {};
    const rows = [];
    const pair = (label, a, b) => {
      if (isNum(a) || isNum(b)) rows.push({ label, parts: [cell(a), cell(b)], sep: ' / ' });
    };
    pair('가격 5분 / 15분', r.price5, r.price15);
    if (isNum(r.ratio)) rows.push({ label: '거래 활동', parts: [{ text: r.ratio.toFixed(1) + '배', cls: '' }] });
    pair('OI 5분 / 15분', r.oi5, r.oi15);
    if (isNum(r.fundingPct)) rows.push({ label: 'Funding', parts: [{ text: pct(r.fundingPct, 4), cls: pctCls(r.fundingPct) }] });
    const u = r.upbit;
    if (u && (isNum(u.change_post5) || isNum(u.change_post15))) rows.push({ label: 'Upbit 게시 후 5분 / 15분', parts: [cell(u.change_post5), cell(u.change_post15)], sep: ' / ' });
    if (u && isNum(u.change_pre5)) rows.push({ label: 'Upbit 게시 전 5분', parts: [cell(u.change_pre5)] });
    return rows;
  }

  function reactionHtml(rows, note, symbol) {
    if (!rows.length) return note ? `<div class="ireact"><span class="src">시장 반응 · ${esc(note)}</span></div>` : '';
    return `<div class="ireact"><div class="src">시장 반응${symbol ? ' · ' + esc(symbol) + ' 기준' : ''}</div><div class="fgrid">`
      + rows.map((r) => `<div><span>${esc(r.label)}</span><b>${r.parts.map((p) => `<i class="${esc(p.cls)}">${esc(p.text)}</i>`).join(esc(r.sep || ''))}</b></div>`).join('')
      + '</div></div>';
  }

  // ── 카드 ──
  // 소스 종류별 집계 chip: "공식 1 · 뉴스 2 · Telegram 3 · 커뮤니티 1" (0 은 생략)
  function countsText(ev) {
    const c = ev.counts || {};
    return [['공식', c.official], ['뉴스', c.news], ['Telegram', c.telegram], ['커뮤니티', c.community]].filter((x) => x[1] > 0).map((x) => `${x[0]} ${x[1]}`).join(' · ');
  }
  // 관측 순서 (게시 시각이 알려진 것만, 시간순). 인과관계가 아니라 '먼저 관측된 순서'일 뿐입니다. 2개 미만이면 빈 문자열.
  function observeOrder(ev) {
    const t = ev.timeline || {};
    const list = [['공식', t.official_seen_at], ['Telegram', t.social_seen_at], ['커뮤니티', t.community_seen_at]].filter((x) => typeof x[1] === 'number');
    if (list.length < 2) return '';
    list.sort((a, b) => a[1] - b[1]);
    return list.map((x) => `${x[0]} ${kstTime(x[1]).slice(6)}`).join(' → ');
  }

  // reaction: { rows, note, symbol } (호출자가 실제 데이터로 계산). 외부 문자열은 모두 esc, 링크는 safeUrl 통과 시에만.
  function cardHtml(ev, reaction, now) {
    const syms = (ev.symbols || []).slice(0, 3);
    const head = syms.length ? syms.map(esc).join(' · ') : esc(CATEGORY_LABEL[ev.category] || '일반');
    const others = (ev.sources || []).filter((s) => s !== ev.source);
    const srcText = sourceName(ev.source) + (others.length ? ` 외 ${others.length}곳` : '');
    const url = safeUrl(ev.url);
    const verify = VERIFY_LABEL[ev.verification] || VERIFY_LABEL.unverified;
    const hot = ev.importance >= 70 ? '🚨 ' : '';
    const link = url ? `<a class="ilink" href="${esc(url)}" target="_blank" rel="noopener noreferrer">원문 보기</a>` : '<span class="src">원문 링크 없음</span>';
    return `<article class="icard v-${esc(ev.verification)}" data-event="${esc(ev.id)}" data-source-type="${esc(ev.source_type)}" data-symbols="${esc((ev.symbols || []).join(','))}">`
      + `<div class="ihead"><b class="isym">${hot}${head}</b><span class="ibadge v-${esc(ev.verification)}">${esc(verify)}</span><span class="ikind">${esc(KIND_LABEL[ev.source_type] || '')}</span></div>`
      + `<div class="src itime">${esc(srcText)} · ${esc(timeText(ev, now))}</div>`
      + `<div class="ititle">${esc(ev.title)}</div>`
      + `<div class="imeta"><span class="ichip">${esc(CATEGORY_LABEL[ev.category] || '일반')}</span>${countsText(ev) ? ` <span class="ichip icounts">${esc(countsText(ev))}</span>` : ''}</div>`
      + (observeOrder(ev) ? `<div class="src iorder" title="먼저 관측된 순서일 뿐 인과관계가 아닙니다">관측 순서 ${esc(observeOrder(ev))}</div>` : '')
      + reactionHtml((reaction && reaction.rows) || [], reaction && reaction.note, reaction && reaction.symbol)
      + `<div class="ifoot"><span class="src">정보 중요도 <b class="iscore">${esc(ev.importance)}</b></span>${link}</div></article>`;
  }

  // 전체 레이더용 한 줄 요약
  function miniHtml(ev, now) {
    const syms = (ev.symbols || []).slice(0, 2).join(' · ') || CATEGORY_LABEL[ev.category] || '일반';
    const url = safeUrl(ev.url);
    const title = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(ev.title)}</a>` : esc(ev.title);
    return `<div class="feeditem imini" data-event="${esc(ev.id)}"><b>${esc(syms)} <span class="ibadge v-${esc(ev.verification)}">${esc(VERIFY_LABEL[ev.verification] || VERIFY_LABEL.unverified)}</span></b>${title}`
      + `<div class="src">${esc(sourceName(ev.source))} · ${esc(relTime(evTime(ev), now))}${typeof ev.published_at === 'number' ? '' : ' (수집 시각)'} · 정보 중요도 ${esc(ev.importance)}</div></div>`;
  }

  // ── Telegram / 커뮤니티 (Phase 6B) ──
  const KIND_NAME = { telegram: 'Telegram', community: '국내 커뮤니티' };
  const KIND_SHORT = { telegram: 'Telegram', community: '커뮤니티' };

  // 창 하나의 표시: "12건 · 평균 대비 3.4배" / "12건 · 데이터 축적 중" / "12건 · 새로 등장"
  function windowText(st) {
    if (!st) return '';
    const n = `${st.count}건`;
    if (st.state === 'ok' && typeof st.ratio === 'number') return `${n} · 평균 대비 ${st.ratio.toFixed(1)}배`;
    if (st.state === 'insufficient') return `${n} · 데이터 축적 중`;
    if (st.state === 'new') return `${n} · 새로 등장`;
    return n;
  }
  // 가장 큰 배수 (없으면 null)
  function bestRatio(att) {
    const r = ['15m', '1h', '6h'].map((k) => att.stats && att.stats[k] && att.stats[k].ratio).filter((x) => typeof x === 'number');
    return r.length ? Math.max(...r) : null;
  }

  // 소셜 신호 판정 (노이즈 감소: 아래 이유 중 하나 이상일 때만). marketSymbols: 시장 이상(거래량·가격)이 동시에 감지된 코인 집합
  //  linked_official 공식 공지와 연결 / multi_channel 여러 Telegram 채널 동시 언급 / surge 언급량·게시글이 평소 대비 급증 / market 시장 이상과 동시
  function socialSignals(attList, now, marketSymbols) {
    const mk = marketSymbols || new Set();
    const out = [];
    for (const a of attList) {
      const reasons = [];
      const r = bestRatio(a);
      const isNew = ['15m', '1h', '6h'].some((k) => a.stats && a.stats[k] && a.stats[k].state === 'new');
      if (a.verification === 'official') reasons.push('linked_official');
      if (a.kind === 'telegram' && a.channels_1h >= 2) reasons.push('multi_channel');
      if ((r !== null && r >= 3) || isNew) reasons.push('surge');
      if (reasons.length && mk.has(a.symbol)) reasons.push('market');
      if (!reasons.length) continue;
      const label = KIND_SHORT[a.kind] || a.kind;
      const text = reasons.includes('surge') && r !== null ? `${a.symbol} · ${label} ${r.toFixed(1)}x`
        : reasons.includes('surge') ? `${a.symbol} · ${label} 새로 등장`
        : reasons.includes('multi_channel') ? `${a.symbol} · Telegram ${a.channels_1h}개 채널 동시 언급`
        : `${a.symbol} · ${label} 공식 공지와 연결`;
      out.push({ symbol: a.symbol, kind: a.kind, score: a.score, verification: a.verification, reasons, text, last_at: a.last_at });
    }
    out.sort((x, y) => y.reasons.length - x.reasons.length || y.score - x.score || (y.last_at || 0) - (x.last_at || 0));
    return out;
  }
  const REASON_LABEL = { linked_official: '공식 공지 연결', multi_channel: '여러 채널 동시', surge: '언급 급증', market: '시장 이상과 동시' };

  // 심볼별 소셜 관심도 카드. 소셜 관심도(화제성)는 정보 중요도·사실 확인과 별개입니다.
  function socialCardHtml(att, reaction, now) {
    const verify = VERIFY_LABEL[att.verification] || VERIFY_LABEL.unverified;
    const st = att.stats || {};
    const lines = ['15m', '1h', '24h'].map((k) => `<div><span>${k === '15m' ? '15분' : k === '1h' ? '1시간' : '24시간'}</span><b>${esc(windowText(st[k]))}</b></div>`).join('');
    const linked = (att.clusters || []).slice(0, 2).map((c) => {
      const u = safeUrl(c.url);
      const t = esc(c.title);
      return `<div class="src ilinked">연결 이벤트 · ${u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${t}</a>` : t}</div>`;
    }).join('');
    const ch = att.kind === 'telegram' ? `<span class="ichip">${esc(att.channels_1h)}개 채널(1시간)</span>` : '';
    return `<article class="icard iscard v-${esc(att.verification)}" data-symbol="${esc(att.symbol)}" data-kind="${esc(att.kind)}">`
      + `<div class="ihead"><b class="isym">${esc(att.symbol)}</b><span class="ibadge v-${esc(att.verification)}">${esc(verify)}</span><span class="ikind">${esc(KIND_NAME[att.kind] || '')}</span></div>`
      + `<div class="src itime">${att.last_at ? '마지막 언급 ' + esc(relTime(att.last_at, now)) : ''}${att.partial ? ' · 일부 요소 수집 중' : ''}</div>`
      + `<div class="fgrid">${lines}</div>`
      + `<div class="imeta">${ch}</div>${linked}`
      + reactionHtml((reaction && reaction.rows) || [], reaction && reaction.note, reaction && reaction.symbol)
      + `<div class="ifoot"><span class="src">소셜 관심도 <b class="iatt">${esc(att.score)}</b>/100</span><span class="src">화제성 · 사실 확인 아님</span></div></article>`;
  }

  // 최근 글(Telegram 메시지 / 커뮤니티 게시글) 한 줄. 외부 텍스트는 excerpt 만, 전부 이스케이프.
  function socialMessageHtml(it, now) {
    const syms = (it.symbols || []).slice(0, 3).join(' · ');
    const url = safeUrl(it.url);
    const verify = VERIFY_LABEL[it.verification] || VERIFY_LABEL.unverified;
    const when = typeof it.published_at === 'number' ? relTime(it.published_at, now) : `게시 시간 미확인 · 수집 ${relTime(it.collected_at, now)}`;
    const text = (it.kind === 'community' ? it.title || it.excerpt : it.excerpt) || '';
    return `<div class="feeditem imsg" data-item="${esc(it.id)}" data-kind="${esc(it.kind)}"><b>${esc(it.channel)}${syms ? ' · ' + esc(syms) : ''} <span class="ibadge v-${esc(it.verification)}">${esc(verify)}</span></b>`
      + `<div class="imsgtext">${esc(text.length > 140 ? text.slice(0, 139) + '…' : text)}</div>`
      + `<div class="src">${esc(when)}${url ? ` · <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">원문 보기</a>` : ''}</div></div>`;
  }

  // 출처 상태 한 줄: "Binance 공지 정상 · 2분 전"
  // pending: 아직 한 번도 시도 안 함(첫 수집 준비 중) · error: 그 출처만 수집 오류 · delayed: 성공 기록이 오래됨
  const HEALTH_LABEL = { ok: '정상', delayed: '지연', pending: '수집 준비 중', error: '수집 오류' };
  function healthText(s, now) {
    const st = HEALTH_LABEL[s.status] || HEALTH_LABEL.pending;
    if (s.status === 'pending') return `${s.label} ${st}`;
    if (s.status === 'error') return `${s.label} ${st}${s.last_success_at ? ` · 마지막 성공 ${relTime(s.last_success_at, now)}` : ' · 아직 성공 기록 없음'}`;
    return `${s.label} ${st}${s.last_success_at ? ` · ${relTime(s.last_success_at, now)}` : ''}`;
  }

  // 정보 영역 전체 상태 (Worker API 자체 실패와 출처별 상태를 구분)
  //  apiFailed: events API 호출 실패 → '정보 서버 연결 실패' (이때만)
  //  sources 가 모두 pending → '수집 준비 중', 일부 error/delayed → 그 출처만 표시
  function overallStatus(o) {
    if (o.apiFailed && !o.hasData) return { level: 'err', text: '정보 서버 연결 실패' };
    if (o.apiFailed) return { level: 'warn', text: '정보 갱신 지연' };
    if (!o.loaded) return { level: 'warn', text: '정보 연결 중' };
    if (o.degraded) return { level: 'warn', text: '정보 저장소(D1) 미연결' };
    const src = o.sources || [];
    if (src.length && src.every((s) => s.status === 'pending')) return { level: 'warn', text: '수집 준비 중' };
    const bad = src.filter((s) => s.status === 'error' || s.status === 'delayed');
    if (bad.length && src.every((s) => s.status === 'error' || s.status === 'delayed' || s.status === 'pending') && !src.some((s) => s.status === 'ok')) return { level: 'err', text: '모든 출처 수집 오류' };
    if (bad.length) return { level: 'warn', text: `일부 출처 수집 오류 (${bad.length}개)` };
    return { level: 'ok', text: '정보 정상' };
  }

  // 목록이 비었을 때의 안내
  function emptyText(o) {
    if (o.hasEvents) return { title: '선택한 조건에 맞는 정보가 없습니다', sub: '필터를 바꿔 보세요.' };
    const src = o.sources || [];
    if (src.length && src.every((s) => s.status === 'pending')) return { title: '수집 준비 중', sub: 'Worker 의 첫 수집을 기다리고 있습니다 (보통 몇 분 안에 시작됩니다).' };
    if (src.some((s) => s.status === 'error')) return { title: '아직 수집된 정보가 없습니다', sub: '일부 출처에서 수집 오류가 있습니다. 아래 출처 상태를 확인하세요.' };
    return { title: '아직 수집된 정보가 없습니다', sub: 'Worker 가 공식 공지·뉴스를 수집하면 여기에 표시됩니다.' };
  }

  const api = { VERSION, API_BASE, esc, safeUrl, CATEGORY_LABEL, VERIFY_LABEL, KIND_LABEL, sourceName, relTime, kstTime, timeText, evTime, COINS, filterEvents, rankTop, reactionRows, reactionHtml, cardHtml, miniHtml, healthText, overallStatus, emptyText, countsText, observeOrder, windowText, bestRatio, socialSignals, REASON_LABEL, socialCardHtml, socialMessageHtml };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IntelCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
