import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeTg, FAKE_TOKEN, OWNER, STRANGER } from './helpers/faketg.mjs';
import { tgPoll, tgHandleUpdate, tgPairCreate, tgPairedUser, tgCall, tgClassify, tgResponseKeyboard, tgReviewKeyboard, tgSendSignalPrompt, tgSubmitFillForm, tgFillLink, tgParseCommand, TG_SID_RE } from '../lib/tg.mjs';
import { storeCreate, storeGet, storeList, storeIntegrityCheck, storeRepair, storeSetupChallenge, storeBuildLedger } from '../lib/store.mjs';
import { ingestHandle } from '../lib/ingest.mjs';
import { createHmac } from 'node:crypto';
import { authBuildRequest } from '../lib/auth.mjs';
import { nodeAuthEnv } from '../client/ingest-client.mjs';

const T = 1790000000000;
const SIG = { sid: 'A-BTC-1', strategy: 'A', symbolId: 'BTCUSDT', dir: 'LONG', signalAt: T, entry: '100', stop: '98', tp1: '103', tp2: '104' };
const SID = SIG.sid;
function setup(o) { const x = makeTg(o); storeCreate(x.mem.env, 'signal', SIG, { actor: 't' }); pair(x); return x; }
function pair(x) { const { code } = tgPairCreate(x.env); x.tele.say(OWNER, `/pair ${code}`); return tgPoll(x.env); }
const poll = x => tgPoll(x.env);
const btn = (msg, part) => { for (const row of msg.reply_markup.inline_keyboard) for (const b of row) if (b.text.includes(part)) return b.callback_data; throw new Error(`버튼 없음: ${part} in ${JSON.stringify(msg.reply_markup)}`); };
const rows = (x, e) => storeList(x.mem.env, e).map(r => r.data);
const lastSent = x => x.tele.sent[x.tele.sent.length - 1];
function say(x, text, from = OWNER) { x.tele.say(from, text); return poll(x); }
function click(x, msg, data, from = OWNER) { x.tele.click(from, msg, data); return poll(x); }
function prompt(x) { assert.equal(tgSendSignalPrompt(x.env, OWNER, SID).ok, true); return lastSent(x); }
function enter(x, extra = '') { say(x, `/fill ${SID} 30 10 100 98 ${extra}`); const m = lastSent(x); click(x, m, btn(m, '저장')); }

// ───────────── 페어링 ─────────────
test('페어링: 비페어링 발신자는 무응답·무기록, 코드 1회용·10분 만료·5회 실패 시 폐기, 그룹·봇은 불가', () => {
  const x = makeTg(); storeCreate(x.mem.env, 'signal', SIG, { actor: 't' });
  const audit0 = x.mem.sheets.get('Audit').length;
  x.tele.say(STRANGER, '/start'); x.tele.say(STRANGER, `/fill ${SID} 30 10 100 98`); x.tele.say(STRANGER, '/pair ABCD2345');
  assert.deepEqual(poll(x), { status: 'ok', handled: 0, ignored: 3, duplicate: 0, retry: 0, poison: 0, replyFailed: 0, actions: { unpaired: 2, 'pair-rejected': 1 } });
  assert.equal(x.tele.sent.length, 0); assert.equal(x.mem.sheets.get('Audit').length, audit0);             // 무응답·무기록(tgupdate도 없음)
  // 코드 없이는 /pair 불가, 틀린 코드 5회 후에는 올바른 코드도 폐기
  const { code } = tgPairCreate(x.env); for (let i = 0; i < 5; i++) x.tele.say(STRANGER, `/pair ZZZZZZZ${i}`);
  x.tele.say(STRANGER, `/pair ${code}`); poll(x); assert.equal(tgPairedUser(x.env), null); assert.equal(x.tele.sent.length, 0);
  // 만료
  const c2 = tgPairCreate(x.env).code; x.advance(10 * 60 * 1000 + 1); x.tele.say(OWNER, `/pair ${c2}`); poll(x); assert.equal(tgPairedUser(x.env), null);
  // 그룹 채팅·봇 계정 불가
  const c3 = tgPairCreate(x.env).code; x.tele.say(OWNER, `/pair ${c3}`, { chatId: -500, type: 'group' }); x.tele.say(OWNER, `/pair ${c3}`, { isBot: true }); poll(x); assert.equal(tgPairedUser(x.env), null);
  // 정상 + 소문자 허용 + 1회용
  x.tele.say(OWNER, `/pair ${c3.toLowerCase()}`); poll(x); assert.equal(tgPairedUser(x.env).userId, OWNER); assert.match(lastSent(x).text, /연결 완료/);
  const n = x.tele.sent.length; x.tele.say(STRANGER, `/pair ${c3}`); poll(x); assert.equal(tgPairedUser(x.env).userId, OWNER); assert.equal(x.tele.sent.length, n);
  x.tele.say(STRANGER, '/help'); poll(x); assert.equal(x.tele.sent.length, n);                              // 페어링 후에도 타인은 무응답
  assert.ok(!JSON.stringify([...x.kv.map.values()]).includes(c3));                                            // 코드 평문은 저장하지 않는다(해시만)
});

// ───────────── 신호 버튼 ─────────────
test('버튼: 3택 callback_data는 64바이트 이내, 진입/관망/놓침 1회 기록·재클릭·재전달·다른 선택은 중복 없이 처리', () => {
  const x = setup({ uiUrl: 'https://example.com/exec' }), m = prompt(x);
  assert.equal(m.text.split('\n').length, 3);
  const kb = m.reply_markup.inline_keyboard[0]; assert.deepEqual(kb.map(b => b.text), ['진입했어', '관망했어', '놓쳤어']);
  for (const b of kb) assert.ok(Buffer.byteLength(b.callback_data) <= 64);
  const u = x.tele.click(OWNER, m, btn(m, '진입했어')); let r = poll(x); assert.equal(r.handled, 1);
  assert.equal(rows(x, 'response').length, 1); assert.equal(rows(x, 'response')[0].choice, 'entered');
  assert.equal(x.tele.answers.at(-1).text, '기록: 진입했어'); assert.deepEqual(x.tele.edits.at(-1).reply_markup, { inline_keyboard: [] });           // 키보드 제거
  const g = lastSent(x); assert.match(g.text, /\/fill A-BTC-1 증거금 레버리지 100 98/); assert.match(g.reply_markup.inline_keyboard[0][0].url, /^https:\/\/example\.com\/exec\?p=fill&sid=A-BTC-1&dir=LONG&entry=100&stop=98$/);
  const auditN = x.mem.sheets.get('Audit').length, sentN = x.tele.sent.length;
  // 같은 update 재전달(오프셋 유실)·같은 버튼 다시 클릭(새 callback id)
  x.kv.del('offset'); r = poll(x); assert.equal(r.duplicate >= 1, true); assert.equal(x.mem.sheets.get('Audit').length, auditN); assert.equal(x.tele.sent.length, sentN);
  r = click(x, m, btn(m, '진입했어')); assert.equal(rows(x, 'response').length, 1); assert.equal(x.tele.sent.length, sentN);                                    // 안내 재발송 없음
  // 다른 선택은 기존 기록을 바꾸지 않음
  click(x, m, btn(m, '관망했어')); assert.equal(rows(x, 'response')[0].choice, 'entered'); assert.match(x.tele.answers.at(-1).text, /이미 '진입했어'로 기록됨/);
  assert.equal(rows(x, 'tgupdate').length >= 3, true);
});
test('버튼: 알 수 없는 신호·잘못된 버튼·긴 sid·형식 오류 처리, 관망/놓침은 후속 입력 없음', () => {
  const x = setup(); const m = { message_id: 1, chat_id: OWNER };
  click(x, m, 'r1:NOPE:e'); assert.equal(rows(x, 'response').length, 0); assert.equal(x.tele.answers.at(-1).text, '알 수 없는 신호입니다');
  click(x, m, 'zz:1:2'); assert.equal(x.tele.answers.at(-1).text, '처리할 수 없는 버튼입니다');
  click(x, m, 'r1:A-BTC-1:x'); assert.equal(rows(x, 'response').length, 0);
  assert.throws(() => tgResponseKeyboard('x'.repeat(55)), /54자/); assert.throws(() => tgResponseKeyboard('a b'), /54자/); assert.equal(TG_SID_RE.test('x'.repeat(54)), true);
  const n = x.tele.sent.length; click(x, m, 'r1:A-BTC-1:w'); assert.equal(rows(x, 'response')[0].choice, 'watched'); assert.equal(x.tele.sent.length, n);                       // 관망: 안내 메시지 없음
  const m2 = { message_id: 2, chat_id: OWNER }; click(x, m2, 'r1:A-BTC-1:m'); assert.equal(rows(x, 'response')[0].choice, 'watched');
  const long = { ...SIG, sid: 'L'.repeat(60) }; storeCreate(x.mem.env, 'signal', long, { actor: 't' }); assert.deepEqual(tgSendSignalPrompt(x.env, OWNER, long.sid), { ok: false, code: 'sid-too-long' });
  assert.deepEqual(tgSendSignalPrompt(x.env, OWNER, 'NOPE'), { ok: false, code: 'unknown-signal' });
});

// ───────────── /fill ─────────────
test('/fill: 확인 전에는 기록 없음, 저장 후 진입 1건(수량 계산 3), 진입했어 자동 기록, 재클릭·재전달은 1건, 취소·만료·타인', () => {
  const x = setup(); say(x, `/fill ${SID} 30 10 100 98`);
  const m = lastSent(x); assert.match(m.text, /진입 LONG · A-BTC-1/); assert.match(m.text, /수량 3\(계산\)/); assert.match(m.text, /손절 시 손실 6\.00 USDT/); assert.match(m.text, /수수료 미입력 · 펀딩 미입력/);
  assert.equal(rows(x, 'fill').length, 0); assert.equal(rows(x, 'response').length, 0);                       // 저장 전 기록 없음
  const yes = btn(m, '저장'); assert.ok(Buffer.byteLength(yes) <= 64);
  const u = x.tele.click(OWNER, m, yes); poll(x); const f = rows(x, 'fill'); assert.equal(f.length, 1);
  assert.deepEqual([f[0].kind, f[0].dir, f[0].price, f[0].qty, f[0].margin, f[0].leverage, f[0].plannedStop, f[0].qtySource, f[0].origin], ['entry', 'LONG', '100', '3', '30', '10', '98', 'derived', 'real']);
  assert.deepEqual(f[0].fee, { state: 'missing' }); assert.equal(rows(x, 'response')[0].choice, 'entered');
  assert.match(x.tele.edits.at(-1).text, /저장됨 ✓/);
  click(x, m, yes); x.tele.updates.push(u); x.kv.del('offset'); poll(x); assert.equal(rows(x, 'fill').length, 1);                // 재클릭·재전달
  assert.equal(x.tele.answers.at(-1).text, '이미 저장됨');
  // 취소
  say(x, `/fill ${SID} 10 10 100 98`); const m2 = lastSent(x); click(x, m2, btn(m2, '취소')); assert.equal(rows(x, 'fill').length, 1); assert.equal(x.tele.edits.at(-1).text, '취소됨'); click(x, m2, btn(m2, '저장')); assert.equal(rows(x, 'fill').length, 1);
  // 만료
  say(x, `/fill ${SID} 10 10 100 98`); const m3 = lastSent(x); x.advance(10 * 60 * 1000 + 1); click(x, m3, btn(m3, '저장')); assert.equal(rows(x, 'fill').length, 1); assert.match(x.tele.answers.at(-1).text, /만료/);
  // 타인이 같은 초안 버튼을 눌러도 무시
  say(x, `/fill ${SID} 10 10 100 98`); const m4 = lastSent(x); click(x, m4, btn(m4, '저장'), STRANGER); assert.equal(rows(x, 'fill').length, 1);
});
test('/fill: 추가진입(kind=add)·qty·추정 수수료·펀딩 옵션, 위험 경고, 이미 청산됨·관망 기록·미지의 신호·형식 오류는 초안 없이 안내', () => {
  const x = setup(); enter(x);
  say(x, `/fill ${SID} 20 10 101 99 qty=1.5 fee=~0.12 funding=-0.03`); const m = lastSent(x);
  assert.match(m.text, /추가진입 LONG/); assert.match(m.text, /수량 1\.5 /); assert.match(m.text, /수수료 0\.12 · 펀딩 -0\.03/); click(x, m, btn(m, '저장'));
  const f = rows(x, 'fill').find(r => r.kind === 'add'); assert.deepEqual([f.qtySource, f.fee, f.funding], ['entered', { state: 'estimated', amount: '0.12' }, { state: 'entered', amount: '-0.03' }]);
  // 경고: 방향 반대쪽 손절, 청산가가 손절보다 먼저(고레버리지)
  say(x, `/fill ${SID} 10 10 100 102`); assert.match(lastSent(x).text, /⚠ 손절가가 방향과 반대쪽/);
  say(x, `/fill ${SID} 10 50 100 90`); assert.match(lastSent(x).text, /청산가\(근사\)가 손절보다 먼저/);
  const drafts = [...x.kv.map.keys()].filter(k => k.startsWith('d:')).length;
  // 거절 사례 — 초안도 기록도 없다
  const before = rows(x, 'fill').length;
  for (const [line, re] of [[`/fill NOPE 30 10 100 98`, /알 수 없는 신호/], [`/fill ${SID} abc 10 100 98`, /증거금/], [`/fill ${SID} 30 0 100 98`, /레버리지/], [`/fill ${SID} 30 10`, /사용법/], [`/fill ${SID} 30 10 100 98 fee=x`, /수수료/], [`/fill ${SID} 30 10 100 98 qty=0`, /수량/]]) { say(x, line); assert.match(lastSent(x).text, re, line); }
  assert.equal([...x.kv.map.keys()].filter(k => k.startsWith('d:')).length, drafts); assert.equal(rows(x, 'fill').length, before);
  // 관망으로 기록된 신호
  storeCreate(x.mem.env, 'signal', { ...SIG, sid: 'B-ETH-1', symbolId: 'ETHUSDT', strategy: 'B' }, { actor: 't' }); storeCreate(x.mem.env, 'response', { sid: 'B-ETH-1', choice: 'watched', at: T }, { actor: 't' });
  say(x, '/fill B-ETH-1 30 10 100 98'); assert.match(lastSent(x).text, /'관망했어'로 기록돼 있어/);
  // 청산 후 재진입 불가
  say(x, `/exit ${SID} 101`); const e = lastSent(x); click(x, e, btn(e, '저장')); say(x, `/fill ${SID} 30 10 100 98`); assert.match(lastSent(x).text, /이미 청산된 신호/);
});

// ───────────── /exit (청산·부분청산) ─────────────
test('/exit: 부분청산 → 전량청산, 수량 초과·무진입·청산 후 재청산 거절, 청산 확정 시 복기 프롬프트 1회', () => {
  const x = setup(); enter(x);
  say(x, `/exit ${SID} 103 1`); let m = lastSent(x); assert.match(m.text, /부분 청산 LONG/); assert.match(m.text, /이번 총손익 3\.00 USDT/); click(x, m, btn(m, '저장'));
  let f = rows(x, 'fill').filter(r => r.kind === 'reduce'); assert.equal(f.length, 1); assert.equal(f[0].qty, '1'); assert.equal(x.tele.texts().filter(t => t.startsWith('복기')).length, 0);
  say(x, `/exit ${SID} 103 5`); assert.match(lastSent(x).text, /보유 수량\(2\)보다 큽니다/);
  say(x, `/exit ${SID} 101 all fee=0.2 funding=0.05`); m = lastSent(x); assert.match(m.text, /전량 청산 LONG/); assert.match(m.text, /포지션 순손익\(입력된 수수료·펀딩만\) 4\.85 USDT/); click(x, m, btn(m, '저장'));
  f = rows(x, 'fill').filter(r => r.kind === 'close'); assert.equal(f.length, 1); assert.equal(f[0].qty, '2');
  const prompts = x.tele.texts().filter(t => t.startsWith('복기 · A-BTC-1')); assert.equal(prompts.length, 1);
  click(x, m, btn(m, '저장')); assert.equal(x.tele.texts().filter(t => t.startsWith('복기')).length, 1);                // 재클릭: 프롬프트 재발송 없음
  say(x, `/exit ${SID} 101`); assert.match(lastSent(x).text, /이미 전량 청산/);
  say(x, '/exit NOPE 101'); assert.match(lastSent(x).text, /진입 기록이 없습니다/);
  say(x, '/exit'); assert.match(lastSent(x).text, /사용법/);
  say(x, '/status'); assert.equal(lastSent(x).text, '열린 포지션 없음');
});
test('/exit: SHORT 방향은 신호 방향을 따르고 /status는 열린 포지션을 표시', () => {
  const x = setup(); storeCreate(x.mem.env, 'signal', { ...SIG, sid: 'S-1', dir: 'SHORT', entry: '100', stop: '102', tp1: '97' }, { actor: 't' });
  say(x, '/fill S-1 30 10 100 102'); let m = lastSent(x); click(x, m, btn(m, '저장'));
  say(x, '/status'); assert.match(lastSent(x).text, /S-1 SHORT 3 @ 100/);
  say(x, '/exit S-1 97'); m = lastSent(x); assert.match(m.text, /이번 총손익 9\.00 USDT/);
});

// ───────────── 10초 복기 ─────────────
test('복기: 저장 전에는 기록 없음(기본값 표시만), 선택 변경은 화면만 바꿈, 저장 버튼으로 기록·같은 내용 재저장은 unchanged·수정은 리비전', () => {
  const x = setup(); enter(x); say(x, `/exit ${SID} 101`); const e = lastSent(x); click(x, e, btn(e, '저장'));
  const p = lastSent(x); assert.match(p.text, /복기 · A-BTC-1/); assert.match(p.text, /계획: 계획대로 · 심리: 침착/); assert.match(p.text, /저장 버튼을 눌러야 기록/);
  assert.equal(rows(x, 'review').length, 0);
  for (const row of p.reply_markup.inline_keyboard) for (const b of row) assert.ok(Buffer.byteLength(b.callback_data) <= 64, b.callback_data);
  assert.match(btn(p, '계획대로'), /^v1:A-BTC-1:okca$/); assert.ok(p.reply_markup.inline_keyboard[0][0].text.startsWith('✅'));
  click(x, p, btn(p, '조기청산')); assert.equal(rows(x, 'review').length, 0); const ed = x.tele.edits.at(-1); assert.match(ed.text, /계획: 조기청산 · 심리: 침착/);
  const kb2 = { reply_markup: ed.reply_markup }; click(x, p, btn(kb2, '욕심')); const ed2 = x.tele.edits.at(-1); assert.match(ed2.text, /계획: 조기청산 · 심리: 욕심/); assert.equal(rows(x, 'review').length, 0);
  const save = btn({ reply_markup: ed2.reply_markup }, '저장'); assert.equal(save, 'v1:A-BTC-1:eegr:s'); click(x, p, save);
  assert.deepEqual([rows(x, 'review')[0].plan, rows(x, 'review')[0].mind], ['early_exit', 'greedy']); assert.match(x.tele.edits.at(-1).text, /복기 저장됨/);
  click(x, p, save); assert.equal(x.tele.answers.at(-1).text, '이미 같은 내용으로 저장됨'); assert.equal(storeGet(x.mem.env, 'review', SID).rev, 1);
  click(x, p, 'v1:A-BTC-1:okca:s'); assert.deepEqual([rows(x, 'review')[0].plan, rows(x, 'review')[0].mind], ['plan_ok', 'calm']); assert.equal(storeGet(x.mem.env, 'review', SID).rev, 2);
});
test('복기: 기본값 그대로 저장 버튼 한 번(10초 복기), 체결 없는 sid·잘못된 코드 거절, /review 수동 호출', () => {
  const x = setup(); click(x, { message_id: 9, chat_id: OWNER }, 'v1:A-BTC-1:okca:s'); assert.equal(rows(x, 'review').length, 0); assert.match(x.tele.answers.at(-1).text, /체결 기록이 없어/);
  say(x, `/review ${SID}`); assert.match(lastSent(x).text, /체결 기록이 없습니다/);
  enter(x); say(x, `/review ${SID}`); const p = lastSent(x); assert.match(p.text, /^복기 · /);
  click(x, p, btn(p, '저장')); assert.deepEqual([rows(x, 'review')[0].plan, rows(x, 'review')[0].mind], ['plan_ok', 'calm']);
  click(x, p, 'v1:A-BTC-1:zzzz:s'); click(x, p, 'v1:A-BTC-1:ok'); assert.equal(x.tele.answers.at(-1).text, '처리할 수 없는 버튼입니다');
  assert.equal(tgReviewKeyboard('S', 'ee', 'rv').inline_keyboard[2][0].callback_data, 'v1:S:eerv:s');
});

// ───────────── Telegram 오류·재시도 ─────────────
test('tgCall: 429(retry_after) 대기 후 재시도, 긴 대기는 재시도 가능 오류로 반환, 5xx·네트워크 재시도(최대 3회), 4xx는 재시도 없음, 오류 값에 본문 없음', () => {
  const x = makeTg(), call = () => tgCall(x.env, 'sendMessage', { chat_id: 1, text: 'secret-body' });
  x.tele.fail('sendMessage', [{ status: 429, body: { ok: false, description: 'Too Many Requests: retry after 2', parameters: { retry_after: 2 } } }]); let r = call();
  assert.equal(r.ok, true); assert.equal(r.attempts, 2); assert.deepEqual(x.tele.sleeps, [2000]);
  x.tele.sleeps.length = 0; x.tele.fail('sendMessage', [{ status: 429, body: { ok: false, parameters: { retry_after: 30 } } }]); r = call();
  assert.deepEqual([r.ok, r.code, r.retryable, r.retryAfterSec, r.attempts, x.tele.sleeps.length], [false, 'rate-limit', true, 30, 1, 0]);
  x.tele.fail('sendMessage', [{ status: 500, body: null }, 'throw']); r = call(); assert.deepEqual([r.ok, r.attempts], [true, 3]); assert.deepEqual(x.tele.sleeps, [500, 1000]);
  x.tele.fail('sendMessage', [{ status: 502, body: null }, { status: 502, body: null }, { status: 502, body: null }]); r = call(); assert.deepEqual([r.ok, r.code, r.retryable, r.attempts], [false, 'server', true, 3]);
  for (const [st, desc, code] of [[403, 'Forbidden: bot was blocked by the user', 'forbidden'], [401, 'Unauthorized', 'auth'], [404, 'Not Found', 'auth'], [400, 'Bad Request: chat not found', 'chat'], [400, 'Bad Request: message is not modified', 'not-modified'], [400, 'Bad Request: query is too old', 'stale-callback'], [400, 'Bad Request: message to edit not found', 'gone'], [400, 'Bad Request: x', 'bad-request'], [409, 'Conflict', 'conflict']]) {
    x.tele.fail('sendMessage', [{ status: st, body: { ok: false, description: desc } }]); r = call(); assert.equal(r.code, code); assert.equal(r.attempts, 1); assert.equal(r.retryable, false); assert.ok(!JSON.stringify(r).includes('secret-body') && !JSON.stringify(r).includes(desc));
  }
  assert.equal(tgClassify(0), 'network'); assert.equal(tgClassify(200, ''), 'other');
});
test('폴링: 처리 실패(LOCK)는 오프셋을 올리지 않고 다음 틱에 재처리, 3회 연속 실패는 건너뜀, 락 선점 중 중복 실행 방지', () => {
  const x = setup(); const m = prompt(x); x.tele.click(OWNER, m, btn(m, '관망했어'));
  x.mem.setLockBusy(true); let r = poll(x); assert.equal(r.retry, 1); assert.equal(rows(x, 'response').length, 0);
  r = poll(x); assert.equal(r.retry, 1); x.mem.setLockBusy(false); r = poll(x); assert.equal(r.handled, 1); assert.equal(rows(x, 'response')[0].choice, 'watched');
  // 포이즌: 같은 update가 계속 실패하면 3번째에 건너뛰고 다음 update를 처리
  const m2 = lastSent(x); storeCreate(x.mem.env, 'signal', { ...SIG, sid: 'P-1' }, { actor: 't' }); x.tele.click(OWNER, m2, 'r1:P-1:w'); x.tele.say(OWNER, '/help');
  x.mem.setLockBusy(true); assert.equal(poll(x).retry, 1); assert.equal(poll(x).retry, 1); r = poll(x); assert.equal(r.poison, 1); x.mem.setLockBusy(false);
  assert.equal(rows(x, 'response').some(d => d.sid === 'P-1'), false); const n = x.tele.sent.length; r = poll(x); assert.equal(r.handled, 1); assert.equal(x.tele.sent.length, n + 1);   // /help 이 처리됨
  // 리스: 진행 중이면 busy, 만료되면 재개
  x.kv.put('poll', JSON.stringify({ v: { until: x.clock.t + 50000 }, exp: 0 })); assert.deepEqual(poll(x), { status: 'busy' }); x.advance(60000); assert.equal(poll(x).status, 'ok');
});
test('폴링: getUpdates 오류(웹훅 충돌 409·토큰 오류)는 상태로 반환하고 오프셋 불변, 성공 시 오프셋 영속·재시작 후 이어서', () => {
  const x = setup(); x.tele.say(OWNER, '/help'); const off0 = x.kv.get('offset');
  x.tele.webhookActive = true; let r = poll(x); assert.deepEqual([r.status, r.code, r.retryable], ['error', 'conflict', false]); x.tele.webhookActive = false;
  x.tele.fail('getUpdates', [{ status: 401, body: { ok: false } }]); r = poll(x); assert.deepEqual([r.status, r.code], ['error', 'auth']); assert.equal(x.kv.get('offset'), off0);
  x.tele.fail('getUpdates', ['throw', 'throw', 'throw']); r = poll(x); assert.deepEqual([r.status, r.code, r.retryable], ['error', 'network', true]);
  r = poll(x); assert.equal(r.handled, 1); const off = JSON.parse(x.kv.get('offset')).v; assert.equal(off, x.tele.updates.at(-1).update_id + 1);
  const n = x.tele.sent.length; assert.equal(poll(x).handled, 0); assert.equal(x.tele.sent.length, n);                                             // 같은 update 재처리 없음
  assert.equal(x.tele.calls.filter(c => c.method === 'getUpdates').at(-1).payload.offset, off);
});
test('응답 전송 실패는 저장된 기록을 되돌리지 않고(replyFailed 집계) 재처리로 중복 기록되지 않는다', () => {
  const x = setup(); const m = prompt(x); x.tele.click(OWNER, m, btn(m, '진입했어'));
  x.tele.fail('editMessageText', Array(3).fill({ status: 500, body: null })); x.tele.fail('answerCallbackQuery', Array(3).fill({ status: 500, body: null }));
  const r = poll(x); assert.equal(r.handled, 1); assert.equal(r.replyFailed, 1); assert.equal(rows(x, 'response').length, 1); assert.equal(poll(x).handled, 0);
  // 만료된 버튼(stale callback)·사라진 메시지는 무해(benign)
  x.tele.click(OWNER, m, 'r1:A-BTC-1:w'); x.tele.fail('answerCallbackQuery', [{ status: 400, body: { ok: false, description: 'Bad Request: query is too old and response timeout expired' } }]);
  x.tele.fail('editMessageText', [{ status: 400, body: { ok: false, description: 'Bad Request: message is not modified' } }]); assert.equal(poll(x).replyFailed, 0);
});
test('저장 성공 직후 update 기록(claim)이 실패해도 폴링이 죽지 않고 다음 틱에 같은 결과로 수렴(중복 1건)', () => {
  const x = setup(); enter(x); const before = rows(x, 'fill').length;
  say(x, `/exit ${SID} 101`); const e = lastSent(x); x.tele.click(OWNER, e, btn(e, '저장'));
  x.mem.setFail(x.mem.appends + 5);                                         // 체결 저장(2쓰기) 뒤 claim 쓰기에서 실패(저장 후)
  const r = poll(x); assert.equal(r.retry >= 0, true); x.mem.setFail(null); poll(x); poll(x);
  assert.equal(rows(x, 'fill').length, before + 1); assert.equal(storeIntegrityCheck(x.mem.env).ok, true);
  assert.equal(x.tele.texts().filter(t => t.startsWith('복기 · A-BTC-1')).length <= 2, true);
});

// ───────────── 모바일 입력 화면 연계 ─────────────
test('입력 화면 제출: /fill과 같은 체결을 만들고 formId 중복 제출은 1건, 오류는 안내, 잠금 중에는 busy', () => {
  const x = setup({ uiUrl: 'https://example.com/exec' });
  let r = tgSubmitFillForm(x.env, { sid: SID, margin: '30', leverage: '10', entry: '100', stop: '98', formId: 'form-1' }); assert.deepEqual([r.ok, r.status, r.kind], [true, 'added', 'entry']);
  r = tgSubmitFillForm(x.env, { sid: SID, margin: '30', leverage: '10', entry: '100', stop: '98', formId: 'form-1' }); assert.deepEqual([r.ok, r.status], [true, 'duplicate']); assert.equal(rows(x, 'fill').length, 1);
  assert.equal(rows(x, 'fill')[0].fillId, `${SID}:form-1`); assert.equal(rows(x, 'response')[0].choice, 'entered');
  r = tgSubmitFillForm(x.env, { kind: 'exit', sid: SID, price: '103', qty: '1', formId: 'form-2' }); assert.deepEqual([r.ok, r.kind], [true, 'reduce']);
  r = tgSubmitFillForm(x.env, { kind: 'exit', sid: SID, price: '101', formId: 'form-3' }); assert.deepEqual([r.ok, r.kind], [true, 'close']); assert.equal(r.reviewPrompt.ok, true);
  assert.equal(x.tele.texts().filter(t => t.startsWith('복기 · A-BTC-1')).length, 1);
  for (const bad of [null, 'x', { sid: 'NOPE', margin: '1', leverage: '1', entry: '1', stop: '1' }, { sid: SID, margin: 'x', leverage: '10', entry: '100', stop: '98' }]) { const o = tgSubmitFillForm(x.env, bad); assert.equal(o.ok, false); assert.equal(o.error, 'invalid'); }
  const y = setup(); y.mem.setLockBusy(true); assert.deepEqual(tgSubmitFillForm(y.env, { sid: SID, margin: '30', leverage: '10', entry: '100', stop: '98' }), { ok: false, error: 'busy', retry: true });
  assert.equal(tgFillLink('http://x.com', SIG), null); assert.equal(tgFillLink(undefined, SIG), null); assert.match(tgFillLink('https://e.com/exec?a=1', SIG), /exec\?a=1&p=fill&sid=A-BTC-1/);
});

// ───────────── R2/R3/R5와 연동, 장애 복구 ─────────────
const KEY = 'K'.repeat(8) + 'secretkey'.repeat(4);
function ingestSignal(x, sig) {
  const env = { now: () => x.clock.t, hmacSha256: (k, m) => createHmac('sha256', k).update(m, 'utf8').digest('hex'), getKeys: () => [KEY], nonces: { has: n => x.kv.map.has(`n:${n}`), put: n => x.kv.map.set(`n:${n}`, '1') }, storeEnv: () => x.mem.env };
  return ingestHandle(env, authBuildRequest(nodeAuthEnv({ now: () => x.clock.t }), KEY, { type: 'signal', signal: sig }));
}
test('연동(R5→R4→R3→R2): 수신한 신호에 버튼 응답·진입·부분청산·청산·복기, 장부 손익이 직접 계산과 같고 무결성 통과', () => {
  const x = makeTg(); pair(x); storeSetupChallenge(x.mem.env, { startEquity: '300', startDay: '2026-09-21', rate: '0.05' }, { actor: 't' });
  assert.deepEqual(ingestSignal(x, SIG), { ok: true, status: 'added', rev: 1 });
  const m = prompt(x); click(x, m, btn(m, '진입했어')); enter(x);
  say(x, `/exit ${SID} 103 1 fee=0.1`); let e = lastSent(x); click(x, e, btn(e, '저장'));
  say(x, `/exit ${SID} 101 all fee=0.1 funding=-0.02`); e = lastSent(x); click(x, e, btn(e, '저장')); const p = lastSent(x); click(x, p, btn(p, '저장'));
  const led = storeBuildLedger(x.mem.env, { throughDay: '2026-09-21' }), row = led.rows[0];
  assert.equal(row.realizedGrossMicro, 5000000n); assert.equal(row.feesEnteredMicro, 200000n); assert.equal(row.fundingEnteredMicro, -20000n); assert.equal(row.ledgerWalletMicro, 300000000n + 5000000n - 200000n - 20000n);
  assert.equal(rows(x, 'review')[0].plan, 'plan_ok'); assert.deepEqual(storeIntegrityCheck(x.mem.env), { ok: true, issues: [], auditCount: x.mem.sheets.get('Audit').length, repairable: 0 });
  // 위험 %: 챌린지 설정이 있으면 손절 손실의 시작 평가액 대비 비율을 경고 기준으로 쓴다
  say(x, `/fill ${SID} 30 10 100 98`); assert.match(lastSent(x).text, /이미 청산된 신호/);
});
const draftMsg = x => [...x.tele.sent].reverse().find(m => m.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data?.startsWith('f1:'));
const reviewMsg = x => [...x.tele.sent].reverse().find(m => m.text.startsWith('복기 · '));
function scenario(x) {                      // 진입 → 부분청산 → 전량청산 → 복기 저장(각 단계는 확인 버튼까지)
  say(x, `/fill ${SID} 30 10 100 98`); let d = draftMsg(x); click(x, d, btn(d, '저장'));
  say(x, `/exit ${SID} 103 1`); d = draftMsg(x); click(x, d, btn(d, '저장'));
  say(x, `/exit ${SID} 101`); d = draftMsg(x); click(x, d, btn(d, '저장'));
  const p = reviewMsg(x); if (p) click(x, p, btn(p, '저장'));
}
test('장애 복구: 저장 중 시트 쓰기가 어느 지점에서 끊겨도(쓰기 지점 전수) 이후 정상화되면 최종 상태가 정상 실행과 같고 중복·누락이 없다', () => {
  const snap = x => JSON.stringify({ fills: rows(x, 'fill').map(r => [r.kind, r.price, r.qty]).sort(), resp: rows(x, 'response').map(r => r.choice), rv: rows(x, 'review').map(r => [r.plan, r.mind]) });
  const clean = setup(), base = clean.mem.appends; scenario(clean); poll(clean); const ref = snap(clean), total = clean.mem.appends - base;
  assert.equal(rows(clean, 'fill').length, 3); assert.equal(rows(clean, 'review').length, 1); assert.ok(total >= 30);
  for (let n = 1; n <= total + 2; n++) {
    const x = setup(); x.mem.setFail(x.mem.appends + n);
    scenario(x); x.mem.setFail(null); for (let i = 0; i < 4; i++) poll(x);
    const p = reviewMsg(x); if (p && !rows(x, 'review').length) click(x, p, btn(p, '저장'));         // 중단 때문에 프롬프트가 늦게 도착했다면 사람이 나중에 누른 것과 같다
    assert.equal(snap(x), ref, `쓰기 #${n}에서 실패 후 수렴하지 않음`);
    let integ = storeIntegrityCheck(x.mem.env);                                       // 마지막 쓰기에서 끊겼다면 '엔티티 행 누락(선기록만 있음)'이 남을 수 있다 → 복구 대상일 뿐 손상은 아님
    if (!integ.ok) { assert.ok(integ.issues.every(i => i.type === 'missing-view'), `n=${n}: ${JSON.stringify(integ.issues)}`); integ = storeRepair(x.mem.env).after; }
    assert.equal(integ.ok, true, `n=${n}: ${JSON.stringify(integ.issues)}`);
    assert.equal(x.tele.texts().filter(t => t.startsWith('복기 · A-BTC-1')).length, 1, `n=${n}: 복기 프롬프트 중복`);
  }
});

// ───────────── 비밀·로그 ─────────────
test('토큰·본문 비노출: lib은 토큰을 볼 수 없고 요청 payload·kv·감사 로그·소스에 토큰/콘솔 출력이 없다', () => {
  const x = setup(); enter(x); say(x, `/exit ${SID} 101`);
  const dump = JSON.stringify([x.tele.calls, [...x.kv.map.entries()], x.mem.sheets.get('Audit')]); assert.ok(!dump.includes(FAKE_TOKEN) && !dump.includes('AAFake'));
  const src = readFileSync(new URL('../lib/tg.mjs', import.meta.url), 'utf8'); assert.ok(!/console\.|Logger\.log|process\./.test(src)); assert.ok(!/\b\d{6,}:[A-Za-z0-9_-]{30,}/.test(src));
  assert.ok(!/자동\s*주문|placeOrder|createOrder|api\.okx|private\/|\/trade\/order/i.test(src.replace(/\/\/.*$/gm, '')));       // 주문 기능 없음
  assert.deepEqual(tgParseCommand('/Fill@MyBot a b c=1'), { cmd: 'fill', pos: ['a', 'b'], opt: { c: '1' } }); assert.equal(tgParseCommand('hello'), null);
  assert.deepEqual(tgHandleUpdate(x.env, { update_id: 'x' }), { status: 'ignored', action: 'unparsable' }); assert.deepEqual(tgHandleUpdate(x.env, null), { status: 'ignored', action: 'unparsable' });
});

// ───────────── 중복 입력·오래된 초안 방지(퍼징으로 발견한 위험의 회귀 시험) ─────────────
test('중복 입력 방지: 같은 체결을 두 번 확인하면 두 번째는 막고(force=1 이면 허용), 오래된 초안은 상태가 바뀌었으면 저장하지 않는다', () => {
  const x = setup(); say(x, `/fill ${SID} 30 10 100 98`); const d1 = lastSent(x); say(x, `/fill ${SID} 30 10 100 98`); const d2 = lastSent(x);          // 응답이 늦어 같은 명령을 두 번 입력
  click(x, d1, btn(d1, '저장')); assert.equal(rows(x, 'fill').length, 1);
  click(x, d2, btn(d2, '저장')); assert.equal(rows(x, 'fill').length, 1); assert.match(x.tele.edits.at(-1).text, /그 사이 포지션 상태가 바뀌어/);          // 두 번째 초안은 이제 '추가진입'이 되어야 하므로 거절
  say(x, `/exit ${SID} 101`); const all = lastSent(x); say(x, `/exit ${SID} 103 1`); const part = lastSent(x); click(x, part, btn(part, '저장')); click(x, all, btn(all, '저장'));
  assert.deepEqual(rows(x, 'fill').map(f => f.kind).sort(), ['entry', 'reduce']); assert.match(x.tele.edits.at(-1).text, /다시 입력해 주세요/);                              // '전량(3)' 초안은 잔량(2)과 달라 거절
  say(x, `/exit ${SID} 103 1`); const same = lastSent(x); click(x, same, btn(same, '저장')); assert.equal(rows(x, 'fill').filter(f => f.kind === 'reduce').length, 1); assert.match(x.tele.edits.at(-1).text, /중복 저장 방지/);
  say(x, `/exit ${SID} 103 1 force=1`); const forced = lastSent(x); click(x, forced, btn(forced, '저장')); assert.equal(rows(x, 'fill').filter(f => f.kind === 'reduce').length, 2);
  assert.equal(storeIntegrityCheck(x.mem.env).ok, true);
  const y = setup(); enter(y); assert.deepEqual([tgSubmitFillForm(y.env, { kind: 'exit', sid: SID, price: '103', qty: '1', formId: 'again-1' }).ok, tgSubmitFillForm(y.env, { kind: 'exit', sid: SID, price: '103', qty: '1', formId: 'again-2' }).ok], [true, false]);
  const f = tgSubmitFillForm(y.env, { kind: 'exit', sid: SID, price: '103', qty: '1', formId: 'again-3' }); assert.deepEqual([f.ok, f.error], [false, 'invalid']); assert.match(f.message, /중복 저장 방지/); assert.equal(tgSubmitFillForm(y.env, { kind: 'exit', sid: SID, price: '103', qty: '1', formId: 'again-3', force: true }).kind, 'reduce');          // 계열이 같으면(부분 청산 반복 포함) 막고, force로 허용
  say(y, `/fill ${SID} 30 10 100 98`); assert.match(lastSent(y).text, /^추가진입 LONG/);
});
