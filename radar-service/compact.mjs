// 2.2 기본 Telegram 보고: 모바일에서 10초 안에 읽히는 짧은 메시지(HTML 서식 + 일반 텍스트 대체본).
// 상세 분석(근접 TOP 3·점수 근거·뉴스 목록 등)은 계산은 그대로 하되 여기서는 출력하지 않는다(--preview의 full 보고에서 확인).
import { bold, clip, escHtml, fmtPrice, htmlToPlain, link, safeHttpUrl, visibleLength } from './format.mjs';
import { marketState } from './enrich.mjs';
import { pickNear, pickTop2, RECOMMEND_MIN_SCORE } from './scoring.mjs';
import { relevantNews } from './news.mjs';

export const COMPACT_MAX = 800;   // 기본 보고 본문(보이는 글자) 상한. 2.3: 후보 2개 비교형이라 800자(후보 1개·0개는 훨씬 짧음)
const dirKo = d => (d === 'LONG' ? '롱' : d === 'SHORT' ? '숏' : '대기');
const FOOTER = '※ 조건부 참고값 · 매매 지시 아님 · 점수는 승률 아님';

export function kstLabel(n) {
  const [d, t] = new Date(n).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).split(' ');
  const [, mo, da] = d.split('-');
  return `${Number(mo)}월 ${Number(da)}일 ${t.slice(0, 5)}`;
}

// 필요한 조건(최대 2개): 돌파 → 거래대금·OI → 펀딩·추세 순. 강한 조건이면 재확인만.
export function neededConditions(row, dir, limit = 2) {
  const c = row.candidate;
  if (!c) return [];
  if (row.strong) return [`${dir === 'LONG' ? '재지지' : '재저항'} 확인`];
  const u = c.unmet || [], out = [];
  if (u.some(x => /돌파 확정/.test(x)) && c.dist) out.push(`${fmtPrice(c.dist.level)} ${dir === 'LONG' ? '돌파' : '이탈'} 확정`);
  const vo = [u.some(x => /거래대금/.test(x)) && '거래대금 2배', u.some(x => /OI/.test(x)) && 'OI +1%'].filter(Boolean);
  if (vo.length) out.push(vo.join(' · '));
  if (u.some(x => /펀딩/.test(x))) out.push('펀딩 과열 해소');
  if (u.some(x => /5분 추세/.test(x))) out.push('5분 추세 확인');
  if (!out.length && u.length) out.push('상위 시간대 방향 확인');
  return out.slice(0, limit);
}

// 주의 요인(최대 2개): plan.mjs의 위험 요인을 짧은 문구로 줄인다. 일반 면책 문구는 제외.
export function cautionLines(row, dir, limit = 2) {
  const c = row.candidate;
  if (!c) return [];
  const opp = dir === 'LONG' ? '하락' : '상승';
  const out = [];
  for (const f of c.risk?.factors ?? []) {
    let m;
    if (/4시간 추세와 역행/.test(f)) out.push(`4시간 ${opp} 추세와 역행`);
    else if (/1시간 추세와 역행/.test(f)) out.push(`1시간 ${opp} 추세와 역행`);
    else if (/BTC 단기 방향과 충돌/.test(f)) out.push('BTC 단기 방향과 충돌');
    else if (/OI 급증/.test(f)) out.push('OI 급증');
    else if (/OI 감소/.test(f)) out.push('OI 감소 · 참여 약함');
    else if (/펀딩 (과열|높음)/.test(f)) out.push('펀딩 과열');
    else if (/변동성/.test(f)) out.push('변동성 큼');
    else if ((m = f.match(/손절까지 거리 ([\d.]+)%/))) out.push(`손절 거리 ${m[1]}%`);
    else if (/구조 저항\/지지가 TP1/.test(f)) out.push('TP1 앞에 1시간 저항·지지');
    else if (/거래대금 부족/.test(f)) out.push('거래대금 부족');
    else if (/추세 미확인/.test(f)) out.push(f.split(' (')[0]);
    else if (/이격/.test(f)) out.push('기준선과 거리 있음');
    else if (/지연/.test(f)) out.push('가격 데이터 지연');
    else if (/계산 불가/.test(f)) out.push('손절·목표 계산 불가');
  }
  return [...new Set(out)].slice(0, limit);
}

// 뉴스: 1순위 후보 종목 또는 BTC와 실제로 관련된 최근(24시간) 항목만 최대 n건. 원문 URL·게시 시각은 내부 데이터에 그대로 있다.
export function relatedNews(top, news, now, n) {
  if (!n || !news || news.status === 'unavailable') return [];
  const bases = [...new Set([top && top.symbol.replace(/USDT$/, ''), 'BTC'].filter(Boolean))];
  const rel = relevantNews(news, bases, now, { perSymbol: 2, market: 0 });
  const seen = new Set();
  return bases.flatMap(b => rel.bySymbol[b] ?? []).filter(i => !seen.has(i.url) && seen.add(i.url)).slice(0, n);
}

const MEDAL = ['🥇', '🥈'];

// html/plain 두 가지 본문을 같은 구조에서 만든다. plain은 HTML 전송이 거부될 때의 대체본(링크는 URL을 줄로 표기).
function render(m) {
  const html = [], plain = [];
  const put = (h, p = htmlToPlain(h)) => { html.push(h); plain.push(p); };
  const gap = () => put('', '');
  put(bold('📡 RICH FUTURES RADAR'), '📡 RICH FUTURES RADAR');
  put(escHtml(`${m.time} · ${m.state}`));
  put(escHtml(m.tops.length ? `OKX USDT 선물 · 추천 관찰 후보 TOP ${m.tops.length}` : 'OKX USDT 선물'));
  gap();
  if (m.tops.length) {
    m.tops.forEach((t, i) => {
      put(`${t.medal} ${t.rank}순위 ${bold(t.symbol)} · ${escHtml(t.head)}`, `${t.medal} ${t.rank}순위 ${t.symbol} · ${t.head}`);
      put(escHtml(`점수 ${t.score} · ${t.status}`));
      gap();
      for (const l of t.price) put(escHtml(l));
      gap();
      t.need.forEach(l => put(escHtml(`✅ ${l}`)));
      (t.caution.length ? t.caution : ['특이 경고 없음']).forEach(l => put(escHtml(`⚠️ ${l}`)));
      gap();
    });
  } else {
    put(bold('🔎 후보 없음 · 대기'), '🔎 후보 없음 · 대기');
    for (const l of m.noTop) put(escHtml(l));
    gap();
  }
  put(escHtml(m.verdict));
  if (m.watching) put(escHtml(m.watching));
  if (m.missing) put(escHtml(m.missing));
  if (m.news.length) {
    gap();
    put(bold('📰 주요 이슈'), '📰 주요 이슈');
    for (const i of m.news) {
      const t = clip(i.title, m.titleMax);
      put(`• ${link(i.url, t)} (${escHtml(i.label)})`, `• ${t} (${i.label})${safeHttpUrl(i.url) ? `\n  ${safeHttpUrl(i.url)}` : ''}`);
    }
  }
  gap();
  put(escHtml(FOOTER));
  return { text: html.join('\n'), plain: plain.join('\n') };
}

function candidateModel({ row, rank }, opt) {
  const c = row.candidate, p = c.plan;
  const price = [`현재가 ${fmtPrice(row.price)}`];
  if (p) price.push(`진입 기준 ${fmtPrice(p.entry)}`, `손절 ${fmtPrice(p.stop)}`, `목표 ${fmtPrice(p.tp1)} / ${fmtPrice(p.tp2)}`);
  else price.push('진입·손절·목표 계산 불가');
  return { rank, medal: MEDAL[rank - 1] ?? '▪️', symbol: row.symbol, head: `${dirKo(c.dir)} 관찰`, score: Math.round(c.score), status: row.strong ? '강한 신호' : '조건 미완성', price,
    need: neededConditions(row, c.dir, opt.cond), caution: cautionLines(row, c.dir, opt.caution) };
}

function model(rows, failures, now, ctx, opt) {
  const btc = rows.find(r => r.symbol === 'BTCUSDT');
  const picks = pickTop2(rows);
  // 판단 줄의 강한 신호 건수는 이 보고에 실제로 표시되는 후보만 센다(55점 미만 강한 신호는 5분 긴급 알림 경로에서 별도로 처리됨).
  const strongCount = picks.filter(p => p.tier === 'strong').length;
  const m = { time: kstLabel(now), state: `시장 ${marketState(btc?.mtf)}`, tops: picks.map(p => candidateModel(p, opt)), noTop: [], news: [], titleMax: opt.titleMax,
    verdict: strongCount ? `✅ 강한 관찰 조건 포착 ${strongCount}건 · 재확인 후 판단` : picks.length ? '⏳ 현재 확정 진입 신호 없음' : '⏳ 대기',
    missing: failures.length ? `※ 수집 실패 ${failures.length}종목 (해당 종목 제외)` : null };
  if (!picks.length) {
    // 추천 표시 기준(55점) 미달과 내부 감시 후보 유무를 구분해 알린다(0건이 '아무것도 없음'으로 읽히지 않게).
    const watching = pickNear(rows, rows.length).length;
    m.watching = watching ? `내부 감시 중인 근접 후보 ${watching}건 (${RECOMMEND_MIN_SCORE}점 미만 · 표시 안 함)` : null;
    m.noTop = btc ? [`BTC ${fmtPrice(btc.price)} · 5분 ${btc.trend}`, `15분 ${btc.mtf?.['15m']?.arrow ?? '?'} / 1시간 ${btc.mtf?.['1H']?.arrow ?? '?'} / 4시간 ${btc.mtf?.['4H']?.arrow ?? '?'}`] : ['BTC 데이터 미확인'];
    m.verdict = `⏳ 현재 추천 표시 기준(${RECOMMEND_MIN_SCORE}점)을 충족한 후보 없음`;
  }
  m.news = relatedNews(picks[0]?.row ?? null, ctx.news, now, opt.news);
  return m;
}

// 800자(보이는 글자) 이내가 되도록 뉴스·주의·조건·제목 길이를 단계적으로 줄인다. 줄여도 넘으면 있는 그대로 반환한다(숨기지 않음).
export function compactReport(rows, failures, now, ctx = {}) {
  const steps = [{ news: 1, titleMax: 30, cond: 2, caution: 2 }, { news: 1, titleMax: 22, cond: 2, caution: 1 }, { news: 0, titleMax: 22, cond: 2, caution: 1 }, { news: 0, titleMax: 22, cond: 1, caution: 1 }];
  let out;
  for (const opt of steps) {
    const m = model(rows, failures, now, ctx, opt);
    out = { ...render(m), tops: m.tops.map(t => t.symbol), top: m.tops[0]?.symbol ?? null, news: m.news };
    if (visibleLength(out.text) <= COMPACT_MAX) break;
  }
  return out;
}

// 강한 신규 신호(5분 감시) 알림: 짧은 요약. 차트는 호출자가 1장 덧붙인다.
export function alertReport(row, now) {
  const c = row.candidate, p = c?.plan, dir = c?.dir ?? row.direction;
  const html = [], plain = [];
  const put = (h, pl = htmlToPlain(h)) => { html.push(h); plain.push(pl); };
  put(bold('🚨 신규 조건 포착'), '🚨 신규 조건 포착');
  put(`${bold(row.symbol)} · ${escHtml(`${dirKo(dir)} 관찰${c ? ` (${Math.round(c.score)}점)` : ''}`)}`, `${row.symbol} · ${dirKo(dir)} 관찰${c ? ` (${Math.round(c.score)}점)` : ''}`);
  put('', '');
  put(escHtml(`현재가 ${fmtPrice(row.price)}`));
  if (p) { put(escHtml(`진입 참고 ${fmtPrice(p.entry)}`)); put(escHtml(`손절 ${fmtPrice(p.stop)}`)); put(escHtml(`TP1 ${fmtPrice(p.tp1)} · TP2 ${fmtPrice(p.tp2)}`)); }
  else put(escHtml('손절·목표 계산 불가'));
  put('', '');
  const need = row.candidate ? neededConditions(row, dir) : [`${dir === 'LONG' ? '재지지' : '재저항'} 확인`];
  need.forEach(l => put(escHtml(`✅ ${l}`)));
  const cau = row.candidate ? cautionLines(row, dir) : [];
  cau.forEach(l => put(escHtml(`⚠️ ${l}`)));
  put('', '');
  put(escHtml(FOOTER));
  return { text: html.join('\n'), plain: plain.join('\n') };
}
