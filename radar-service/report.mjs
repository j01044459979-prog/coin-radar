// Telegram 한국어 보고서. 순수 문자열 조립 — 전송/상태는 service.mjs가 담당한다.
import { relevantNews } from './news.mjs';
import { marketState } from './enrich.mjs';
import { checkPhrases, pickNear } from './scoring.mjs';
import { compactReport } from './compact.mjs';

export const LIMIT = 3800; // Telegram 4096자 한도보다 여유
const f = n => Number(Number(n).toPrecision(7)).toString();
const kst = n => new Date(n).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';
const kstMin = n => new Date(n).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) + ' KST';
const kstShort = n => new Date(n).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(5, 16) + ' KST';
const dirKo = d => (d === 'LONG' ? '롱' : d === 'SHORT' ? '숏' : '대기');
const GRADE_NOTE = '보수형=상대적으로 보수적인 조건일 뿐 저위험·수익 보장이 아닙니다';
const PART_LABEL = { mtf: '다중 시간대 정합성', structure: '돌파·가격 구조', volume: '거래대금', oi: 'OI 변화', funding: '펀딩', btc: 'BTC 시장 필터', volatility: '변동성·이격' };

export const mtfLine = row => {
  const m = row.mtf;
  const a = tf => m?.[tf]?.arrow ?? '?';
  return `15분 ${a('15m')} / 1시간 ${a('1H')} / 4시간 ${a('4H')}`;
};

function planLines(plan) {
  if (!plan) return ['진입·손절·목표: 계산 불가 (검증 가능한 기준선/ATR/스윙 데이터 부족)'];
  const l = [
    '※ 진입·손절·목표는 조건부 참고값이며 매매 지시가 아닙니다',
    `현재 마크가격 ${f(plan.mark)} · ${plan.entryNote} ${f(plan.entry)}`,
    `손절(무효화) 참고선 ${f(plan.stop)} (진입 대비 ${plan.stopPct.toFixed(2)}%)`,
    `TP1 ${f(plan.tp1)} (+${plan.tp1Pct.toFixed(2)}%, 1R) · TP2 ${f(plan.tp2)} (+${plan.tp2Pct.toFixed(2)}%, 2R)`,
    `손익비 1:${plan.rr1} / 1:${plan.rr2} · 수수료·슬리피지·펀딩비 미반영`,
    `목표는 1R/2R 기준 참고값이며 저항·지지 확정가가 아님${plan.structureAhead ? ` · 가까운 1H 구조 ${f(plan.structureAhead)}${plan.tp1BeyondStructure ? ' (TP1보다 가까움)' : ''}` : ''}`,
    '강제청산가: 확인 불가 (포지션·증거금 데이터 없음)',
  ];
  return l;
}

// 강한 신규 신호용 간결 메시지 (기존 형식 + 점수·시나리오·위험). compact=true는 정기 보고 내 요약용(시나리오·위험은 상세 분석에 표시)
export function signalText(row, { compact = false } = {}) {
  const c = row.candidate;
  const lines = [
    `${row.symbol} · ${dirKo(row.direction)} 관찰${row.grade ? ` · ${row.grade} 후보` : ''}`,
    `현재 검증 마크가격: ${f(row.price)} USDT (${kst(row.priceAt)})`,
    `추세 ${row.trend} · 15분 가격 ${row.change15.toFixed(2)}% · OI ${row.oi15.toFixed(2)}%`,
    `거래대금 직전 20봉 평균의 ${row.volume.toFixed(2)}배 · 펀딩 ${row.funding.toFixed(4)}% · 변동성(ATR) ${row.atrPct.toFixed(2)}%`,
  ];
  if (row.level === null) lines.push('돌파 조건 미충족');
  else {
    lines.push(`핵심 가격대(돌파 기준선) ${f(row.level)} · 5분봉 재지지/재저항 확인 필요`);
    if (!(c?.plan && !compact)) lines.push(`무효화 참고선 ${f(row.stop)}${c?.plan ? '' : ' (기준선 ± 14봉 ATR)'}`);
  }
  if (c) {
    lines.push(`${mtfLine(row)}${c.mtfConflict ? ' · 상위 시간대 역행 주의' : ''}`, `조건 충족 점수 ${c.score}/100 (수익 확률 아님) · 위험 수준 ${c.risk.level}(상대 평가, 선물거래 자체의 저위험을 뜻하지 않음)`);
    if (!compact) {
      if (c.plan) lines.push(...planLines(c.plan).slice(0, 5));
      lines.push(...c.risk.factors.slice(0, 2).map(x => `- ${x}`));
    }
  }
  if (!compact) lines.push(`출처: ${row.source ?? '거래소'} · ${row.sourceUrl ?? ''}`);
  return lines.join('\n');
}

function nearBlock(rows) {
  const near = pickNearRows(rows);
  if (!near.length) return '[진입 근접 TOP 3]\n현재 근접 후보 없음 (조건을 충족하지 않은 종목은 억지로 채우지 않습니다)';
  return '[진입 근접 TOP 3]\n※ 강한 신호가 아니며 조건이 아직 부족한 관찰 후보입니다.\n' + near.map((r, i) => {
    const c = r.candidate;
    return `${i + 1}) ${r.symbol} · ${dirKo(c.dir)} 관찰 · 점수 ${c.score}/100\n` +
      `   현재 ${f(r.price)} · 핵심 수준 ${f(c.dist.level)} (${c.dist.broken ? '이미 넘음' : `${c.dist.pct.toFixed(2)}% 남음`})\n` +
      `   ${mtfLine(r)}${c.mtfConflict ? ' · 상위 시간대 역행 주의' : ''}\n` +
      `   충족: ${c.met.slice(0, 3).join(', ') || '없음'}\n   부족: ${c.unmet.slice(0, 3).join(', ') || '없음'}\n   데이터 ${kstShort(r.priceAt)}`;
  }).join('\n');
}
const pickNearRows = rows => pickNear(rows, 3);

function detailBlock(row) {
  const c = row.candidate;
  const top = Object.entries(c.parts).filter(([, p]) => p.score > 0).sort((a, b) => b[1].score / b[1].max - a[1].score / a[1].max).slice(0, 3);
  const skip = x => x.startsWith('레버리지') || x.startsWith('특별한') || x.startsWith('위험 수준은');
  const warn = c.risk.factors.filter(x => !skip(x));
  const higher = ['1H', '4H'].map(tf => row.mtf?.[tf]).filter(t => t && t.dir !== 'UNKNOWN' && c.mtfConflict && ((c.dir === 'LONG' && t.dir === 'DOWN') || (c.dir === 'SHORT' && t.dir === 'UP')));
  return [
    // 1) 후보명·방향·점수
    `■ ${row.symbol} · ${dirKo(c.dir)} 관찰 · ${row.strong ? `강한 조건 충족${row.grade ? ` (${row.grade})` : ''}` : '조건 미완성(근접 관찰)'} · 점수 ${c.score}/100`,
    // 2) 다중 시간대
    `다중 시간대: ${mtfLine(row)}${c.mtfConflict ? ' · 상위 시간대 역행 주의' : ''}`,
    ...higher.map(t => `  ${t.tf === '1H' ? '1시간' : '4시간'} ${t.arrow} ${t.label} · ${t.basis}`),
    // 3) 진입·손절·TP
    ...planLines(c.plan),
    // 4) 위험
    `위험 수준: ${c.risk.level} (상대 평가이며 선물거래 자체의 저위험을 뜻하지 않음)`, ...warn.map(x => `- ${x}`),
    // 5) 부족한 조건
    `미충족 조건: ${c.unmet.join(' / ') || '없음'}`,
    `추천 근거: ${top.map(([k, p]) => `${PART_LABEL[k]} ${p.score.toFixed(1)}/${p.max}`).join(' · ') || '없음'}`,
    c.missing.length ? `데이터 누락(점수 미부여): ${c.missing.join(', ')}` : null,
    `※ 점수는 조건 충족도이며 승률이 아님. 가격 ${kstMin(row.priceAt)} 기준`,
  ].filter(Boolean).join('\n');
}

function newsBlock(rows, news, now) {
  if (!news || news.status === 'unavailable') return '[주요 이슈]\n뉴스 데이터 미확보 (가격 분석에는 영향 없음)';
  const shown = [...new Set(rows.filter(r => r.strong || (r.candidate && pickNearRows(rows).includes(r))).map(r => r.symbol.replace(/USDT$/, '')).concat('BTC'))];
  const rel = relevantNews(news, shown, now);
  const line = i => `- [${i.kind}] ${i.title}\n  ${i.label} · 게시 ${kstShort(i.publishedAt)}\n  ${i.url}`;
  const out = [];
  for (const b of shown) if (rel.bySymbol[b]?.length) out.push(`${b} 관련 가능 이슈\n${rel.bySymbol[b].map(line).join('\n')}`);
  if (rel.market.length) out.push(`시장 전반 이슈\n${rel.market.map(line).join('\n')}`);
  const stale = news.status === 'stale' ? ' · 최신 갱신 실패, 이전 수집분' : '';
  return '[주요 이슈]\n' + (out.length ? out.join('\n') + '\n※ 가격 변동의 원인으로 단정할 수 없는 참고 정보입니다.' : '최근 확인된 주요 이슈 없음') +
    `\n뉴스 확인 ${news.checkedAt ? kstShort(news.checkedAt) : '-'}${stale}`;
}

// 반환: Telegram 한 건당 LIMIT 이하인 메시지 배열(순서 있음)
export function pack(blocks, limit = LIMIT) {
  const out = []; let cur = '';
  const clip = b => (b.length <= limit ? b : b.slice(0, limit - 20).replace(/\n[^\n]*$/, '') + '\n…(일부 생략)');
  for (const raw of blocks.filter(Boolean)) {
    const b = clip(raw);
    if (cur && (cur + '\n\n' + b).length > limit) { out.push(cur); cur = b; } else cur = cur ? cur + '\n\n' + b : b;
  }
  if (cur) out.push(cur);
  return out.map((m, i) => (out.length > 1 ? `(${i + 1}/${out.length}) ` : '') + m);
}

const strongRows = rows => rows.filter(r => r.strong).sort((a, b) => (b.candidate?.score ?? 0) - (a.candidate?.score ?? 0) || b.volume - a.volume);

// 첫 메시지: 모바일에서 한눈에 읽히는 핵심 요약(비어 있지 않은 줄 15줄 이내)
export function summaryText(rows, failures, now) {
  const source = rows.find(r => r.source)?.source ?? '데이터 출처 미확인';
  const btc = rows.find(r => r.symbol === 'BTCUSDT');
  const strong = strongRows(rows), near = pickNear(rows, 3);
  const top = strong[0] ?? near[0];
  const count = d => rows.filter(r => (r.candidate?.dir ?? r.direction) === d).length;
  const lines = ['📡 RICH FUTURES RADAR', `데이터: ${source} (Binance 아님)`, `분석시각: ${kstMin(now)} · 시장 상태: ${marketState(btc?.mtf)}`, '', '[핵심 요약]'];
  if (top) {
    // 점수·시나리오가 없는 행(구버전 호환)도 깨지지 않게 기본값을 둔다.
    const c = top.candidate ?? { dir: top.direction, score: '-', plan: null, risk: { level: '확인 불가' }, mtfConflict: false, unmet: [] }, p = c.plan, sg = c.dir === 'LONG' ? ['-', '+'] : ['+', '-'];
    lines.push(`- 1순위 후보: ${top.symbol} ${dirKo(c.dir)} 관찰 (${top.strong ? '강한 관찰 조건 포착' : '조건 미완성'} · 점수 ${c.score})`);
    if (p) lines.push(`- 핵심 가격: ${f(p.entry)} (${p.conditional ? '조건부 진입 참고' : '진입 참고·현재가 기준'})`, `- 손절 참고: ${f(p.stop)} (${sg[0]}${p.stopPct.toFixed(2)}%)`, `- 목표: ${f(p.tp1)} / ${f(p.tp2)}`);
    else lines.push('- 진입·손절·목표: 계산 불가');
    lines.push(`- 체크 포인트: ${checkPhrases(top, c.dir).join(' · ') || '없음'}`, `- 위험: ${c.risk.level}${c.mtfConflict ? ' · 상위 시간대 역행' : ''}`);
  } else lines.push('- 1순위 후보: 없음 (대기)');
  lines.push('', '[시장]', btc ? `- BTC ${f(btc.price)} · 5분 ${btc.trend} · ${mtfLine(btc)}` : '- BTC 데이터 미확인 · 강한 조건 판단 대기',
    `- 강한 조건 ${strong.length} · 근접 후보 ${near.length} · 롱 ${count('LONG')} / 숏 ${count('SHORT')} (${rows.length}종목${failures.length ? ` · 수집 실패 ${failures.length}` : ''})`,
    '', `[요약 판단] ${strong.length ? '강한 관찰 조건 포착' : near.length ? '조건부 관찰' : '대기'}`,
    '※ 진입·손절·목표는 조건부 참고값 · 매매 지시 아님');
  return lines.join('\n');
}

// 반환: Telegram 한 건당 LIMIT 이하인 메시지 배열. [0]=핵심 요약, 이후=상세(필요 시 여러 건)
export function reportMessages(rows, failures, now, ctx = {}) {
  const btc = rows.find(r => r.symbol === 'BTCUSDT');
  const strong = strongRows(rows).slice(0, 2);
  const near = pickNearRows(rows);
  const strongBlock = '[강한 조건 후보]\n' + (strong.length ? strong.map(r => signalText(r, { compact: true })).join('\n\n') : '현재 확정 조건 없음 · 검증된 강한 조건 없음');
  const detailRows = [...strong, ...near].filter(r => r.candidate).slice(0, 2);
  const detail = detailRows.length ? '[상세 분석]\n' + detailRows.map(detailBlock).join('\n\n') : null;
  const top = detailRows[0];
  const footer = '[참고]\n' + (top && !top.strong ? `다음 확인 조건: ${top.candidate.unmet.slice(0, 2).join(' / ') || '없음'}\n` : '') +
    (failures.length ? `데이터 누락: ${failures.length}종목 수집 실패\n` : '') +
    `${GRADE_NOTE}. 규칙 기반 관찰이며 수익 확률을 뜻하지 않습니다. 자동 주문 없음.${btc ? '' : ' (BTC 데이터 미확인)'}`;
  const rest = pack([strongBlock, nearBlock(rows), detail, newsBlock(rows, ctx.news, now), footer]);
  return [summaryText(rows, failures, now), ...rest.map((m, i) => (rest.length > 1 ? `(상세 ${i + 1}/${rest.length}) ` : '') + m.replace(/^\(\d+\/\d+\) /, ''))];
}

// 2.3 기본 정기 보고: 추천 관찰 TOP 2 압축 본문 1개(HTML + 일반 텍스트 대체본) + 차트 최대 2장(순위순). 상세 분석은 자동 발송하지 않는다.
export function reportParts(rows, failures, now, ctx = {}) {
  const c = compactReport(rows, failures, now, ctx);
  return [{ type: 'text', text: c.text, plain: c.plain, html: true }, ...(ctx.charts ?? []).slice(0, 2).map(ch => ({ type: 'photo', ...ch }))];
}

// 전체 분석(2.1 형식): 핵심 요약 → 차트 → 상세. 프리뷰/점검용이며 정기 보고에는 자동 발송하지 않는다.
export function fullReportParts(rows, failures, now, ctx = {}) {
  const texts = reportMessages(rows, failures, now, ctx);
  return [{ type: 'text', text: texts[0] }, ...(ctx.charts ?? []).map(c => ({ type: 'photo', ...c })), ...texts.slice(1).map(text => ({ type: 'text', text }))];
}

export const reportText = (rows, failures, now, ctx) => reportMessages(rows, failures, now, ctx).join('\n\n');
