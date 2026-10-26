// 성능·정확성 회귀 시험(오프라인): Sheets 호출 수·읽은 셀 수 예산, 요청 캐시가 오래된 값을 쓰지 않는 것, 중복 저장 방지, 무한 로딩 방지 화면.
//  시간(ms)은 perf/bench.mjs 의 비용 모델(가정) 추정치다. 호출 수·셀 수는 측정값이므로 예산은 그 값에 여유를 둔 것이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadProd } from './helpers/gasprod.mjs';
import { instrument, seed } from '../perf/bench.mjs';

const DAYS = 60;
function world() { const g = loadProd(); const info = seed(g, DAYS); g.ctx.rich300Install(); g.cache.evictAll(); return { g, info }; }
const sig = sid => ({ sid, strategy: 'A', symbolId: 'ETHUSDT', dir: 'LONG', signalAt: 1789999000000, entry: '100.00', stop: '98.50', tp1: '102.20' });
const measure = (g, fn) => { const m = instrument(g); const r = fn(); const s = m.snapshot(); return { r, calls: Object.values(s.calls).reduce((a, b) => a + b, 0), cells: s.cells, ms: s.ms, by: s.calls }; };
const entry = (sid, formId, over = {}) => ({ kind: 'entry', formId, sid, margin: '30', leverage: '10', entry: '100', qty: '1', stop: '98.5', at: '', ...over });

test('예산: 첫 화면·기록 조회·저장이 이력 길이와 무관하게 적은 Sheets 호출로 끝난다(전: 첫 화면 132회·저장 675회)', () => {
  const { g } = world(); g.ctx.RICH300_ENGINE.storeCreate(g.ctx.rich300GasEnv_('sheet'), 'signal', sig('S99999'), { actor: 't' });
  const dash = measure(g, () => g.ctx.doGet({ parameter: { p: 'dash' } })), dash2 = measure(g, () => g.ctx.doGet({ parameter: { p: 'dash' } })), jr = measure(g, () => g.ctx.doGet({ parameter: { p: 'journal' } }));
  const save = measure(g, () => g.ctx.rich300FillSubmit(entry('S99999', 'p1'))), dup = measure(g, () => g.ctx.rich300FillSubmit(entry('S99999', 'p1'))), exit = measure(g, () => g.ctx.rich300FillSubmit({ kind: 'exit', formId: 'p2', sid: 'S99999', price: '102', qty: '', fee: '0.04', funding: '0', at: '' }));
  assert.ok(dash.calls <= 110 && dash.ms <= 3000, `첫 화면(초기) ${dash.calls}회 ${dash.ms}ms`);
  assert.ok(dash2.calls <= 60 && dash2.ms <= 1500, `첫 화면(재실행) ${dash2.calls}회 ${dash2.ms}ms`);              // 초기화 확인 표시(캐시)로 14개 시트 머리글 재확인을 건너뜀
  assert.ok(dash2.calls < dash.calls, '재실행이 초기 실행보다 가벼워야 한다');
  assert.ok(jr.calls <= 60 && jr.ms <= 2000, `기록 조회 ${jr.calls}회 ${jr.ms}ms`);
  assert.equal(save.r.status, 'added'); assert.ok(save.calls <= 70 && save.ms <= 2600, `진입 저장 ${save.calls}회 ${save.ms}ms`);
  assert.equal(dup.r.status, 'duplicate'); assert.ok(dup.calls <= 12, `중복 재전송 ${dup.calls}회`);
  assert.equal(exit.r.status, 'added'); assert.ok(exit.calls <= 30 && exit.ms <= 1300, `청산 저장 ${exit.calls}회 ${exit.ms}ms`);
  assert.ok(save.by.lock <= 2 && save.by.flush <= 1, `저장은 락·flush 한 번 (락 ${save.by.lock}, flush ${save.by.flush})`);       // 응답·체결·계획을 한 락 안에서
});
test('전체 조회 금지: 기록 조회는 최근 40건만 만들고 감사 로그(Audit) 전체를 읽지 않는다 + 더 보기 링크', () => {
  const { g } = world(); const m = measure(g, () => g.ctx.doGet({ parameter: { p: 'journal' } })), html = m.r.html;
  assert.equal((html.match(/class="fill"/g) || []).length > 0, true); assert.match(html, /최근 40건만 표시 \(전체 180건\)/); assert.match(html, /p=journal&amp;n=80/);
  const more = g.ctx.doGet({ parameter: { p: 'journal', n: '80' } }).html; assert.match(more, /최근 80건만 표시/); assert.match(more, /n=120/);
  const all = g.ctx.doGet({ parameter: { p: 'journal', n: '999999' } }).html; assert.match(all, /180건/); assert.ok(!/건만 표시/.test(all));          // 상한 200 — 180건이면 전부 보인다
  assert.ok(m.cells < 30000, `읽은 셀 ${m.cells}`);                                                                       // 전: 약 30만 셀(90일)
});
test('정확성: 요청 캐시는 요청 안에서만 — 다음 요청은 다른 요청이 쓴 행을 바로 본다(잔고·체결 상태에 오래된 값 없음)', () => {
  const { g } = world(); const E = g.ctx.RICH300_ENGINE, a = g.ctx.rich300GasEnv_('sheet'), before = E.storeList(a, 'fill').length;
  assert.equal(E.storeList(a, 'signal').filter(r => r.key === 'S88888').length, 0);                        // a 가 신호 시트를 읽어 둔다
  const b = g.ctx.rich300GasEnv_('sheet'); E.storeCreate(b, 'signal', sig('S88888'), { actor: 't' });
  assert.equal(E.storeList(g.ctx.rich300GasEnv_('sheet'), 'signal').filter(r => r.key === 'S88888').length, 1);          // 새 요청은 즉시 보인다
  const stale = E.storeList(a, 'signal').filter(r => r.key === 'S88888').length; assert.equal(stale, 0, '같은 env(=같은 요청) 안에서는 읽어 둔 값을 쓴다'); void before;
});
test('정확성: 락을 기다리는 사이 다른 요청이 쓴 행은 락을 잡은 직후 읽는다(캐시 버림) — 같은 폼의 동시 제출은 한 건만 기록', () => {
  const { g } = world(); const E = g.ctx.RICH300_ENGINE; E.storeCreate(g.ctx.rich300GasEnv_('sheet'), 'signal', sig('S77777'), { actor: 't' });
  const A = g.ctx.rich300GasEnv_('sheet'); E.storeList(A, 'fill');                                    // A 가 체결 시트를 읽어 둔다(캐시)
  const r1 = g.ctx.rich300FillSubmit(entry('S77777', 'same'));                                          // 그 사이 다른 요청 B 가 같은 폼을 저장
  assert.equal(r1.status, 'added');
  const fillRow = { origin: 'real', fillId: 'S77777:same', sid: 'S77777', kind: 'entry', dir: 'LONG', at: 1790000000000, price: '100', qty: '1', margin: '30', leverage: '10', fee: { state: 'missing' }, funding: { state: 'missing' } };
  assert.notEqual(E.storeCreate(A, 'fill', fillRow, { actor: 't' }).status, 'added');                   // A 는 락 직후 B 의 행을 보고(duplicate/conflict) 두 번째 기록을 만들지 않는다
  assert.equal(E.storeList(g.ctx.rich300GasEnv_('sheet'), 'fill').filter(r => r.data.sid === 'S77777').length, 1);
});
test('중복 방지: 같은 요청 재전송·더블탭은 1건, 같은 계열·가격·수량이 방금 저장돼 있으면 다른 폼 id 라도 거부(force 로만 허용)', () => {
  const { g } = world(); g.ctx.RICH300_ENGINE.storeCreate(g.ctx.rich300GasEnv_('sheet'), 'signal', sig('S66666'), { actor: 't' });
  assert.equal(g.ctx.rich300FillSubmit(entry('S66666', 'a')).status, 'added'); assert.equal(g.ctx.rich300FillSubmit(entry('S66666', 'a')).status, 'duplicate');
  const second = g.ctx.rich300FillSubmit(entry('S66666', 'b')); assert.equal(second.ok, false); assert.match(second.message, /계획 밖 추가 진입|중복 저장 방지/);          // 분할 진입 계획(#43) 또는 중복 방지가 막는다
  assert.equal(g.ctx.rich300FillSubmit(entry('S66666', 'b', { force: true })).status, 'added');
  assert.equal(g.rows('fill').filter(f => f.sid === 'S66666').length, 2);
});
test('무한 로딩 방지: 어떤 경우에도 화면을 돌려준다 — 주소만 열면 메인, 모르는 p 도 메인, 타인은 접근 안내, 오류는 코드+다시 시도', () => {
  const { g } = world(); const home = g.ctx.doGet({}), unknown = g.ctx.doGet({ parameter: { p: 'zzz' } });
  assert.match(home.html, /RICH 300/); assert.match(unknown.html, /RICH 300/); assert.equal(home.text, undefined);
  const other = loadProd({ email: 'other@example.com' }); assert.match(other.ctx.doGet({}).html, /접근 제한/); assert.match(loadProd({ email: '' }).ctx.doGet({}).html, /접근 제한/);
  const broken = loadProd(); broken.ctx.rich300PageDash_ = () => { throw new Error('시트 값: SECRET-123'); }; const e1 = broken.ctx.doGet({ parameter: { p: 'dash' } }); assert.match(e1.html, /오류 코드/); assert.match(e1.html, /id="retry"/); assert.match(e1.html, /상태 점검/);   // 시트 설정이 없는 상태
  assert.ok(!/at Object|stack|TypeError: |SECRET-123/.test(e1.html));          // 오류 메시지 본문은 화면에 내지 않는다(코드만)
});
test('상태 점검(?p=health): 시트가 없거나 망가져도 열리고, 정상이면 모든 단계가 PASS 이며 첫 화면·기록 조회 실측 시간을 보여 준다', () => {
  const ok = world().g.ctx.doGet({ parameter: { p: 'health' } }).html; assert.match(ok, /코드 빌드/); assert.match(ok, /첫 화면\(홈\) 생성 \d+ms/); assert.match(ok, /기록 조회\(최근 40건\) 생성 \d+ms/); assert.ok(!/>FAIL</.test(ok), 'FAIL 없음');
  const none = loadProd({ props: { RICH300_SHEET_ID: '' } }).ctx.doGet({ parameter: { p: 'health' } }).html; assert.match(none, /RICH300_SHEET_ID 없음/); assert.match(none, />FAIL</);
  const b = loadProd(); b.ctx.SpreadsheetApp.openById = () => { throw new Error('접근 불가 SECRET-9'); }; const bad = b.ctx.doGet({ parameter: { p: 'health' } }).html; assert.match(bad, />FAIL</); assert.match(bad, /스프레드시트 열기 실패/); assert.ok(!/SECRET-9/.test(bad));
});
test('응답시간 기록: 첫 실행/재실행을 구분해 최근 기록에 남긴다', () => {
  const { g } = world(); g.ctx.doGet({ parameter: { p: 'dash' } }); g.ctx.doGet({ parameter: { p: 'dash' } });
  const html = g.ctx.doGet({ parameter: { p: 'health' } }).html; assert.match(html, /첫 실행/); assert.match(html, /재실행/);
});
test('입력 화면: 저장 중 즉시 상태·경과 초·중복 클릭 차단·무응답 20초 뒤 재시도 안내(같은 formId 로 재전송)', () => {
  const html = readFileSync(new URL('../gas/Fill.html', import.meta.url), 'utf8');
  for (const re of [/저장 중… 0초/, /if \(inflight\) return;/, /SLOW_MS = 20000/, /응답이 늦습니다/, /중복 저장되지 않습니다/, /aria-busy/, /formId: formId/]) assert.match(html, re, String(re));
});
