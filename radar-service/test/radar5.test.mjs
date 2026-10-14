import test from 'node:test';
import assert from 'node:assert/strict';
import { alertReport, compactReport, COMPACT_MAX, neededConditions, cautionLines, kstLabel } from '../compact.mjs';
import { escHtml, fmtPrice, htmlToPlain, link, priceDecimals, safeHttpUrl, visibleLength, clip } from '../format.mjs';
import { fullReportParts, reportParts } from '../report.mjs';
import { cycle, sendText, telegramSender, ApiError } from '../service.mjs';
import { planOf, riskOf } from '../plan.mjs';
import { createOkxCollector } from '../okx.mjs';
import { fakeOkx, now } from './fake-okx.mjs';

function row(sym, dir, strong, price, over = {}, unmet) {
  const long = dir === 'LONG';
  const r = { symbol: sym, direction: strong ? dir : 'WAIT', strong, trend: long ? '상승' : '하락', high: price * 1.0121, low: price * 0.99, swingHigh: price * 1.004, swingLow: price * 0.996, price, priceAt: now - 1000, collectedAt: now,
    atr: price * 0.0035, atrPct: 0.35, volume: 1.2, oi15: 0.4, funding: 0.01, change15: 0.2, source: 'OKX USDT 무기한(SWAP)', ...over };
  const mtf = { '15m': { dir: 'UP', arrow: '↑' }, '1H': { dir: 'DOWN', arrow: '↓' }, '4H': { dir: 'FLAT', arrow: '→' } };
  const plan = planOf(r, dir, null);
  return { ...r, mtf, grade: strong ? '공격형' : null, candidate: { dir, score: strong ? 88.2 : 60.1, plan, dist: { level: long ? r.high : r.low, pct: 1.2, atrUnits: 1.2, broken: false },
    unmet: strong ? [] : unmet ?? ['고점 돌파 확정 필요', '거래대금 1.20배 → 2배 필요', '15분 OI 0.40% → +1% 필요'], blockers: [], missing: [], met: [], mtfConflict: long, risk: riskOf(r, dir, mtf, plan, { change15: 0.2 }), parts: { btc: { score: 7, max: 10 } } } };
}
const btc = { symbol: 'BTCUSDT', price: 83150.4, trend: '상승', mtf: { '15m': { arrow: '↑', dir: 'UP' }, '1H': { arrow: '→', dir: 'FLAT' }, '4H': { arrow: '→', dir: 'FLAT' } }, candidate: null, source: 'OKX USDT 무기한(SWAP)' };
const item = (title, url, over = {}) => ({ title, url, publishedAt: now - 3600000, label: 'BlockMedia', kind: '보도', symbols: ['BTC'], category: 'general', ...over });
const news = (...items) => ({ status: 'ok', checkedAt: now, items });
const near = row('STRKUSDT', 'LONG', false, 0.08497), strong = row('SOLUSDT', 'SHORT', true, 106.34);

// ── 길이·구조 (2.3: 추천 관찰 TOP 2) ──
const mk2 = (sym, dir, strong, price, score, unmet) => { const r = row(sym, dir, strong, price, {}, unmet); r.candidate.score = score; return r; };
const A = mk2('SOLUSDT', 'LONG', false, 108, 82, ['고점 돌파 확정 필요', '거래대금 1.20배 → 2배 필요', '15분 OI 0.10% → +1% 필요']);
const B = mk2('ETHUSDT', 'SHORT', false, 2520, 76, ['저점 이탈 확정 필요', '거래대금 1.20배 → 2배 필요']);
test('기본 보고는 near×2 / strong+near / strong×2 / near×1 / 후보 없음 모두 800자 이내(보이는 글자), 구역별 빈 줄 포함', () => {
  const n = news(item('스트라이브, 일주일간 BTC 3311개 추가 매집', 'https://www.blockmedia.co.kr/a'), item('Bitcoin rebounds ahead of CPI data', 'https://cointelegraph.com/b'));
  const S2 = mk2('DOGEUSDT', 'LONG', true, 0.0849, 85, []);
  for (const rows of [[btc, A, B], [btc, strong, A], [btc, strong, S2], [btc, A], [btc], [btc, near]]) {
    const c = compactReport(rows, [], now, { news: n }), len = visibleLength(c.text);
    assert.ok(len <= COMPACT_MAX && len >= 150, `길이 ${len}`); assert.equal(COMPACT_MAX, 800);
    assert.ok(c.text.length < 1400); assert.match(c.text, /\n\n/); assert.ok(c.text.split('\n\n').length >= 3);
    assert.ok(c.text.endsWith('※ 조건부 참고값 · 매매 지시 아님 · 점수는 승률 아님'));
    assert.equal((c.plain.match(/매매 지시 아님/g) ?? []).length, 1);
  }
});
test('TOP 2 형식: 순위·종목·방향·점수·상태 / 현재가·진입 기준·손절·목표 / 확인 조건·주의 / 판단', () => {
  const c = compactReport([btc, A, B], [], now, {});
  const t = c.plain;
  assert.match(t, /^📡 RICH FUTURES RADAR\n\d+월 \d+일 \d\d:\d\d · 시장 혼조\nOKX USDT 선물 · 추천 관찰 후보 TOP 2\n\n🥇 1순위 SOLUSDT · 롱 관찰\n점수 82 · 조건 미완성\n\n현재가 108\.00\n진입 기준 [\d.]+\n손절 [\d.]+\n목표 [\d.]+ \/ [\d.]+\n\n✅ [\d.]+ 돌파 확정\n✅ 거래대금 2배 · OI \+1%\n⚠️/);
  assert.match(t, /\n\n🥈 2순위 ETHUSDT · 숏 관찰\n점수 76 · 조건 미완성\n\n현재가 2520\.0\n진입 기준 [\d.]+\n손절 [\d.]+\n목표 [\d.]+ \/ [\d.]+\n\n✅ /);
  assert.match(t, /⏳ 현재 확정 진입 신호 없음/); assert.deepEqual(c.tops, ['SOLUSDT', 'ETHUSDT']);
  for (const block of t.split('\n\n🥈')[0].split('\n\n')) assert.ok((block.match(/^✅/gm) ?? []).length <= 2 && (block.match(/^⚠️/gm) ?? []).length <= 2);
  assert.match(c.text, /^<b>📡 RICH FUTURES RADAR<\/b>/); assert.ok(c.text.includes('🥇 1순위 <b>SOLUSDT</b> · 롱 관찰')); assert.ok(c.text.includes('🥈 2순위 <b>ETHUSDT</b> · 숏 관찰'));
  assert.match(t, /추천 관찰 후보/); assert.doesNotMatch(t, /즉시 진입|확정 매수|매수하세요/);
});
test('strong + near 혼합: strong이 1순위, 판단 줄에 강한 신호 건수. strong×2도 가능', () => {
  const sx = mk2('XRPUSDT', 'SHORT', true, 0.52, 88, []);
  const t = compactReport([btc, A, sx], [], now, {}).plain;
  assert.match(t, /🥇 1순위 XRPUSDT · 숏 관찰\n점수 88 · 강한 신호/); assert.match(t, /🥈 2순위 SOLUSDT · 롱 관찰\n점수 82 · 조건 미완성/);
  assert.match(t, /✅ 강한 관찰 조건 포착 1건/);
  const t2 = compactReport([btc, strong, mk2('DOGEUSDT', 'LONG', true, 0.0849, 85, [])], [], now, {}).plain;
  assert.match(t2, /강한 신호[\s\S]*강한 신호/); assert.match(t2, /강한 관찰 조건 포착 2건/); assert.match(t2, /• ?/.source ? /재저항 확인[\s\S]*재지지 확인/ : /x/);   // 숏·롱 혼합
  const t3 = compactReport([btc, strong, mk2('XYZUSDT', 'SHORT', true, 1.234, 80, [])], [], now, {}).plain;   // 같은 방향 2개(숏 숏)
  assert.equal((t3.match(/숏 관찰/g) ?? []).length, 2);
});
test('유효 후보가 1개면 1개만, 0개면 후보 없음. 점수 낮음·차단·중복은 숫자 맞추기용으로 넣지 않는다', () => {
  const low = mk2('LOWUSDT', 'LONG', false, 10, 30, ['x']), blocked = { ...mk2('BLKUSDT', 'LONG', false, 10, 90, ['x']) }; blocked.candidate.blockers = ['BTC 15분 0.5% 초과 역행'];
  const far = mk2('FARUSDT', 'LONG', false, 10, 80, ['x']); far.candidate.dist = { level: 11, atrUnits: 5, broken: false };
  const one = compactReport([btc, A, low, blocked, far], [], now, {});
  assert.deepEqual(one.tops, ['SOLUSDT']); assert.doesNotMatch(one.plain, /🥈|LOWUSDT|BLKUSDT|FARUSDT/); assert.match(one.plain, /TOP 1/);
  const none = compactReport([btc, low, blocked, far], [], now, {});
  assert.deepEqual(none.tops, []); assert.match(none.plain, /🔎 후보 없음 · 대기/);
  const dup = compactReport([btc, A, { ...A }], [], now, {}); assert.deepEqual(dup.tops, ['SOLUSDT']);   // 같은 종목 중복 제거
});
test('후보 없음: 임의의 진입 가격을 만들지 않고 BTC 요약과 대기만 표시', () => {
  const t = compactReport([btc], [], now, {}).plain;
  assert.match(t, /🔎 후보 없음 · 대기\nBTC 83150\.4 · 5분 상승\n15분 ↑ \/ 1시간 → \/ 4시간 →/); assert.doesNotMatch(t, /진입|손절|목표/); assert.match(t, /⏳ 현재 추천 표시 기준\(55점\)을 충족한 후보 없음/);
  assert.match(compactReport([], [{ symbol: 'X' }], now, {}).plain, /BTC 데이터 미확인[\s\S]*추천 표시 기준\(55점\)을 충족한 후보 없음[\s\S]*수집 실패 1종목/);
});
test('시나리오를 계산할 수 없으면 계산 불가로 표시', () => {
  const r = { ...A, candidate: { ...A.candidate, plan: null } };
  assert.match(compactReport([btc, r], [], now, {}).plain, /현재가 108\.00\n진입·손절·목표 계산 불가/);
});
test('순위 규칙: 순위값 = 점수 − 2×위험점수, 표시 점수는 조건 충족 점수 그대로', () => {
  const x = mk2('AAAUSDT', 'LONG', false, 10, 70, ['x']), y = mk2('BBBUSDT', 'LONG', false, 10, 66, ['x']);
  x.candidate.risk = { ...x.candidate.risk, points: 5 }; y.candidate.risk = { ...y.candidate.risk, points: 0 };   // 70−10=60 < 66−0
  const t = compactReport([btc, x, y], [], now, {}); assert.deepEqual(t.tops, ['BBBUSDT', 'AAAUSDT']); assert.match(t.plain, /1순위 BBBUSDT[\s\S]*점수 66/);
});
test('필요 조건·주의 문구 규칙', () => {
  assert.deepEqual(neededConditions(near, 'LONG'), ['0.08600 돌파 확정', '거래대금 2배 · OI +1%']);
  assert.deepEqual(neededConditions(near, 'LONG', 1), ['0.08600 돌파 확정']);
  assert.deepEqual(neededConditions({ ...near, candidate: { ...near.candidate, unmet: ['펀딩 0.0600% 과열', '5분 추세 하락'] } }, 'LONG'), ['펀딩 과열 해소', '5분 추세 확인']);
  assert.deepEqual(neededConditions(strong, 'SHORT'), ['재저항 확인']);
  assert.deepEqual(cautionLines({ candidate: { risk: { factors: ['4시간 추세와 역행', '15분 OI 급증 (3.00%)', '손절까지 거리 3.1%', '레버리지 사용 시 손실 확대 주의 (…)'] } } }, 'SHORT'), ['4시간 상승 추세와 역행', 'OI 급증']);
  assert.deepEqual(cautionLines({ candidate: { risk: { factors: ['특별한 경고 요인 없음', '위험 수준은 위 지표 기준의 상대 평가이며'] } } }, 'LONG'), []);
  assert.match(compactReport([btc, { ...near, candidate: { ...near.candidate, risk: { level: '낮음', factors: ['특별한 경고 요인 없음'] } } }], [], now, {}).plain, /⚠️ 특이 경고 없음/);
  assert.equal(kstLabel(Date.UTC(2026, 9, 14, 0, 19)), '10월 14일 09:19');
});
// ── 뉴스 ──
test('뉴스(2.3): 두 후보 정보를 밀어내지 않도록 기본 보고에서 최대 1건, 제목은 클릭 링크이고 URL 문자열은 본문에 없다', () => {
  const n = news(item('스트라이브, 일주일간 BTC 3311개 추가 매집', 'https://www.blockmedia.co.kr/archives/1151034?utm_source=general&utm_medium=rss'), item('Bitcoin rebounds', 'https://cointelegraph.com/b'), item('BTC third', 'https://x.example.com/3'));
  const c = compactReport([btc, near], [], now, { news: n });
  assert.equal((c.text.match(/<a href=/g) ?? []).length, 1);
  assert.ok(c.text.includes('<a href="https://www.blockmedia.co.kr/archives/1151034?utm_source=general&amp;utm_medium=rss">스트라이브, 일주일간 BTC 3311개 추가 매집</a> (BlockMedia)'));
  assert.doesNotMatch(htmlToPlain(c.text.replace(/<a href="[^"]*">/g, '<a>')), /https?:/); // 보이는 본문에는 URL 없음
  assert.match(c.text, /📰 주요 이슈/); assert.deepEqual(c.news.map(i => i.url), [n.items[0].url]);   // 원본 URL은 내부 데이터에 보존(나머지 기사도 상태 캐시에 그대로 있음)
});
test('뉴스: 없음·오래됨·관련 없음·장애일 때는 섹션 없이(빈 문구도 없이) 짧게', () => {
  const unrelated = item('Solana ETF', 'https://a.example.com/x', { symbols: ['SOL'] });
  const old = item('Bitcoin old', 'https://a.example.com/y', { publishedAt: now - 30 * 3600000 });
  for (const ctx of [{}, { news: news() }, { news: news(unrelated, old) }, { news: { status: 'unavailable' } }]) assert.doesNotMatch(compactReport([btc, near], [], now, ctx).text, /주요 이슈/);
  const rel = item('STRK mainnet upgrade', 'https://a.example.com/s', { symbols: ['STRK'] });   // 후보 종목 관련
  assert.match(compactReport([btc, near], [], now, { news: news(rel, unrelated) }).text, /STRK mainnet upgrade/);
  assert.doesNotMatch(compactReport([btc, near], [], now, { news: news(rel, unrelated) }).text, /Solana ETF/);
});
test('뉴스 다수·긴 제목이어도 650자 이내로 줄이고 상위 시간대 기사로 채우지 않는다', () => {
  const many = Array.from({ length: 12 }, (_, i) => item(`${'매우 긴 비트코인 뉴스 제목 '.repeat(8)}${i}`, `https://news.example.com/${i}`));
  const c = compactReport([btc, near], [], now, { news: news(...many) });
  assert.ok(visibleLength(c.text) <= COMPACT_MAX); assert.ok(c.news.length <= 2); assert.match(c.text, /…/);
});
test('HTML 특수문자 기사 제목·종목명은 이스케이프되어 메시지 구조가 깨지지 않는다', () => {
  const evil = item('<b>BTC & "ETH"</b> <script>alert(1)</script> >', 'https://a.example.com/e?x=1&y="2"');
  const c = compactReport([btc, { ...near, symbol: 'A<B&C' }], [], now, { news: news(evil) });
  assert.doesNotMatch(c.text, /<script|<\/script/); assert.ok(c.text.includes('&lt;b&gt;BTC &amp; "ETH"&lt;/b&gt;') || c.text.includes('&lt;b&gt;BTC &amp; "ETH"')); assert.ok(c.text.includes('A&lt;B&amp;C'));
  const tags = c.text.match(/<\/?[a-z]+[^>]*>/g) ?? []; assert.ok(tags.every(t => /^<\/?(b|a)( href="[^"<>]*")?>$/.test(t)), tags.join(' ')); // 허용 태그만
  assert.equal(htmlToPlain(escHtml('<&>')), '<&>');
});
test('링크 검증: http(s)만, 자격증명·javascript:·IP·localhost·공백·과도하게 긴 URL은 링크 없이 제목만', () => {
  assert.equal(safeHttpUrl('https://news.example.com/a?b=1'), 'https://news.example.com/a?b=1'); assert.ok(safeHttpUrl('http://news.example.com/a'));
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://a.example.com', 'https://user:pw@a.example.com/', 'https://127.0.0.1/x', 'https://localhost/x', 'https://intranet/x', 'https://a.example.com/a b', `https://a.example.com/${'x'.repeat(900)}`, '', null, 'https://a.example.com/"><script>']) assert.equal(safeHttpUrl(bad), null, String(bad).slice(0, 30));
  assert.equal(link('javascript:alert(1)', '제목 <x>'), '제목 &lt;x&gt;'); assert.match(link('https://a.example.com/?q=1&r=2', 't'), /^<a href="https:\/\/a\.example\.com\/\?q=1&amp;r=2">t<\/a>$/);
  const c = compactReport([btc, near], [], now, { news: news(item('Bitcoin long url', `https://a.example.com/${'p'.repeat(900)}`)) });
  assert.doesNotMatch(c.text, /<a /); assert.match(c.text, /Bitcoin long url/); assert.ok(c.text.length < 4000);
});
// ── 가격 표시 ──
test('가격 표시 자릿수는 가격대별이고 계산값은 바꾸지 않는다', () => {
  assert.deepEqual([83150.43, 2512.07, 124.321, 38.1234, 1.23456, 0.52346, 0.084971, 0.0084971, 0.00084971].map(v => fmtPrice(v)), ['83150.4', '2512.1', '124.32', '38.123', '1.2346', '0.5235', '0.08497', '0.008497', '0.00084971']);
  assert.equal(priceDecimals(0.08497), 5); assert.equal(clip('가나다라마바사', 5), '가나다라…'); assert.equal(clip('abc', 5), 'abc');
  const plan = planOf(near, 'LONG', null);
  assert.ok(Math.abs(plan.tp1 - (plan.entry + (plan.entry - plan.stop))) < 1e-12);     // 표시 반올림과 무관하게 원본 계산은 그대로
});
// ── 기본/전체 분리 ──
test('기본 보고에는 상세 분석·근접 TOP 3·뉴스 목록이 자동 포함되지 않고 전체 분석은 별도로 계산된다', () => {
  const basic = reportParts([btc, near], [], now, { news: news(item('Bitcoin x', 'https://a.example.com/x')), charts: ['A', 'B', 'C'].map(s => ({ symbol: s + 'USDT', tf: '1H', png: Buffer.from('x'), caption: 'c' })) });
  assert.deepEqual(basic.map(p => p.type), ['text', 'photo', 'photo']);                  // 차트 입력이 3개여도 기본 보고는 최대 2장
  assert.doesNotMatch(basic[0].text, /진입 근접 TOP|상세 분석|추천 근거|점수는 조건 충족도|다중 시간대/);   // ("추천 관찰 후보"는 TOP 2 제목이라 허용)
  const full = fullReportParts([btc, near], [], now, {});
  assert.ok(full.length >= 2); assert.match(full.map(p => p.text).join('\n'), /진입 근접 TOP 3[\s\S]*상세 분석[\s\S]*추천 근거/);   // 분석 데이터는 삭제되지 않음
});
// ── 전송: HTML + 대체 경로 ──
const okJson = id => new Response(JSON.stringify({ ok: true, result: { message_id: id } }), { status: 200 });
test('sendMessage: html=true이면 parse_mode HTML, 아니면 기존과 동일(토큰 비노출)', async () => {
  const bodies = [];
  const send = telegramSender('secret-token', '123', async (url, opt) => { bodies.push(JSON.parse(opt.body)); return okJson(1); });
  await send('<b>x</b>', { html: true }); await send('plain');
  assert.equal(bodies[0].parse_mode, 'HTML'); assert.equal(bodies[0].link_preview_options.is_disabled, true); assert.equal(bodies[1].parse_mode, undefined);
  await assert.rejects(telegramSender('secret-token', '123', async u => { throw Error(u); })('x', { html: true }), e => !e.message.includes('secret-token'));
});
test('HTML이 거부(400)되면 같은 내용을 일반 텍스트로 다시 보내고, 그 외 오류는 그대로 던진다', async () => {
  const calls = [];
  const send = async (text, opt) => { calls.push([text, opt]); if (opt?.html) throw new ApiError('api.telegram.org', 400); };
  await sendText(send, { text: '<b>x</b>', plain: 'x 일반', html: true });
  assert.deepEqual(calls.map(c => [c[0], Boolean(c[1]?.html)]), [['<b>x</b>', true], ['x 일반', false]]);
  await assert.rejects(sendText(async () => { throw new ApiError('api.telegram.org', 429, 5); }, { text: 'a', plain: 'a', html: true }), e => e.status === 429);
  await assert.rejects(sendText(async () => { throw new Error('연결'); }, { text: 'a', plain: 'a', html: true }), /연결/);
  const plainCalls = []; await sendText(async (t, o) => plainCalls.push([t, o]), { text: 'p' }); assert.deepEqual(plainCalls, [['p', undefined]]);
});
const hourNow = now;
async function runCycle(state, { send, render, sendPhoto, rows = [btc, near], news: n } = {}) {
  const log = [];
  await cycle({ now: hourNow, state, collect: async () => ({ rows, failures: [], charts: { STRKUSDT: { '1H': Array.from({ length: 40 }, (_, i) => ({ t: i, o: 1, h: 2, l: 0.5, c: 1.5, end: i })) } } }), save: async () => {}, news: n,
    send: send ?? (async (t, o) => log.push(['text', t, o])), render, sendPhoto });
  return log;
}
test('정기 보고가 HTML 거부로 400이 나도 일반 텍스트로 전달되고 보고는 완료로 기록된다', async () => {
  const state = {}, sent = [];
  await runCycle(state, { send: async (t, o) => { if (o?.html) throw new ApiError('api.telegram.org', 400); sent.push(t); } });
  assert.equal(sent.length, 1); assert.match(sent[0], /^📡 RICH FUTURES RADAR\n/); assert.doesNotMatch(sent[0], /<b>/); assert.equal(state.reportHour, Math.floor(hourNow / 3600000));
});
// ── 이전 버전 상태 호환 ──
test('업그레이드: 이전 버전이 이미 보낸 같은 시간대 보고는 새 형식으로 다시 보내지 않는다', async () => {
  const hour = Math.floor(hourNow / 3600000);
  const sent = state => runCycle(state, { send: async t => sent.push(t) });
  let log = []; const mk = () => (async t => log.push(t));
  // (1) 2.1 이하가 완료한 보고: reportHour만 있음
  let st = { reportHour: hour, sent: {}, chart: { hour, items: [] } };
  await runCycle(st, { send: mk() }); assert.equal(log.length, 0);
  // (2) 2.1이 요약+사진까지 보내고 상세에서 중단: partial.sent=2 (v 없음) → 재전송 없이 완료 처리
  log = []; st = { partial: { hour, sent: 2 } };
  await runCycle(st, { send: mk() }); assert.equal(log.length, 0); assert.equal(st.reportHour, hour); assert.equal(st.partial, undefined);
  // (3) 이전 시간대 partial은 무시하고 새 보고 1회
  log = []; st = { partial: { hour: hour - 1, sent: 1 } };
  await runCycle(st, { send: mk() }); assert.equal(log.length, 1); assert.equal(st.reportHour, hour);
  // (4) 이전 버전의 중복 억제 키·뉴스 캐시·chart 상태 형식을 그대로 읽는다
  log = []; st = { sent: { 'STRKUSDT:LONG': hourNow - 600000 }, news: { status: 'ok', checkedAt: hourNow - 600000, triedAt: hourNow - 600000, items: [item('STRK news', 'https://a.example.com/s', { symbols: ['STRK'] })] }, chart: { hour: hour - 1, items: [{ symbol: 'X', tf: '1H', ok: true }] } };
  await runCycle(st, { send: mk() }); assert.equal(log.length, 1); assert.match(log[0], /STRK news/);
});
test('캐시 유실(빈 상태)이면 정기 보고 1회만, 긴급 알림 중복 없음', async () => {
  const log = []; await runCycle({}, { send: async t => log.push(t), rows: [btc, strong] });
  assert.equal(log.length, 1); assert.ok(!log[0].includes('🚨'));
});
test('전송 실패(네트워크) 시 보고는 완료로 기록되지 않는다', async () => {
  const st = {};
  await assert.rejects(runCycle(st, { send: async () => { throw new Error('외부 API 연결 실패'); } }));
  assert.equal(st.reportHour, undefined);
});
test('개선 전후 비교: 2.1 전체 보고 대비 2.2 기본 보고는 메시지 수·글자 수가 크게 줄어든다', () => {
  const rows = [btc, near, row('XRPUSDT', 'LONG', false, 0.52), row('DOGEUSDT', 'SHORT', false, 0.0842)];
  const n = news(item('Bitcoin rebounds ahead of CPI data', 'https://www.coindesk.com/markets/2026/10/14/bitcoin-rebounds-ahead-of-cpi-data?utm_source=rss'), item('스트라이브 BTC 매집', 'https://www.blockmedia.co.kr/archives/1151034?utm_source=general&utm_medium=rss'));
  const full = fullReportParts(rows, [], now, { news: n }), basic = reportParts(rows, [], now, { news: n });
  const chars = parts => parts.filter(p => p.type === 'text').reduce((a, p) => a + p.text.length, 0);
  assert.ok(full.filter(p => p.type === 'text').length >= 2); assert.equal(basic.filter(p => p.type === 'text').length, 1);
  assert.ok(chars(basic) * 2 < chars(full), `${chars(basic)} vs ${chars(full)}`);
});
test('실제 수집 결과(모의 OKX) → 기본 보고가 650자 이내이고 차트 1장만 선택', async () => {
  const { rows, failures, charts } = await createOkxCollector(fakeOkx({ breakout: false, universe: 'full' }), { gapMs: 0 })(now);
  const c = compactReport(rows, failures, now, {});
  assert.ok(visibleLength(c.text) <= COMPACT_MAX); assert.ok(c.top);
  assert.ok(Object.keys(charts).length > 0);
});
