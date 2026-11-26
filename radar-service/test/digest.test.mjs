// 관찰 알림 1시간 통합 테스트(합성 입력·모의 전송).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDigest, digestClassify, digestEnabled, kstHourOf, DIGEST_MAX_ITEMS } from '../signal/digest.mjs';

const H = 3600000, T0 = Date.UTC(2026, 10, 26, 3, 5);            // 12:05 KST
const watch = (sym, dir, extra = '') => `<b>🟡 관심종목 관찰</b> | <b>${sym}</b> <b>${dir}</b>\n상태 관찰 · 조건 ${extra}\n진입 신호 아님`;
const rec = () => { const sent = []; return { sent, send: async (t, o) => { sent.push({ t, o }); }, photo: async (png, c, o) => { sent.push({ png, c, o }); } }; };

test('분류: 관찰만 통합 대상, 진입 검토·포지션 관리·정기 보고 제목은 대상 아님', () => {
  assert.equal(digestClassify(watch('ETH', 'LONG')).key, 'ETH:LONG');
  assert.equal(digestClassify('🟡 관심종목 관찰 | SOL SHORT\n본문').key, 'SOL:SHORT');
  for (const t of ['<b>🟢 진입 검토 LONG</b> | <b>ETH</b>', '🔴 진입 검토 SHORT | ETH', '🚨 포지션 관리 · 2시간 점검', '🚨 <b>포지션 관리</b> | ETH', '🟡 RICH · 기타']) assert.equal(digestClassify(t), null);
});
test('플래그: 기본 on, off 이면 전송기를 그대로 돌려준다', () => {
  assert.equal(digestEnabled({}), true); assert.equal(digestEnabled({ RADAR_WATCH_DIGEST: 'off' }), false);
  const r = rec(), d = createDigest({}, { RADAR_WATCH_DIGEST: 'off' }); assert.equal(d.wrapSend(r.send), r.send); assert.equal(d.wrapPhoto(r.photo), r.photo);
});
test('관찰은 즉시 보내지 않고 큐에 쌓고, 진입 검토(버튼)·포지션 관리는 즉시 전송', async () => {
  const r = rec(), st = {}, d = createDigest(st), send = d.wrapSend(r.send, () => T0);
  const q = await send(watch('ETH', 'LONG', 'a')); assert.equal(q.queued, true); assert.equal(r.sent.length, 0);
  await send('🟢 진입 검토 LONG | ETH\n본문', { html: true, markup: { inline_keyboard: [[{ text: '진입했어', callback_data: 'x' }]] } });
  await send('🚨 포지션 관리 | ETH\n본문'); assert.equal(r.sent.length, 2); assert.ok(r.sent[0].o.markup);
  assert.equal(Object.keys(st.digest.items).length, 1);
});
test('사진 설명도 관찰이면 큐로(사진은 보내지 않음), 진입 검토 사진은 그대로', async () => {
  const r = rec(), d = createDigest({}), ph = d.wrapPhoto(r.photo, () => T0);
  await ph(Buffer.from([1]), '🟡 관심종목 관찰 | BTC LONG\n설명'); assert.equal(r.sent.length, 0);
  await ph(Buffer.from([1]), '🟢 진입 검토 LONG | BTC\n설명', { markup: {} }); assert.equal(r.sent.length, 1);
});
test('같은 종목·방향은 한 시간 안에서 1건으로 합치고(횟수 표시), 시간이 바뀐 첫 실행에서 1회 통합 전송', async () => {
  const r = rec(), st = {}, d = createDigest(st), send = d.wrapSend(r.send, () => T0);
  for (let i = 0; i < 3; i++) await send(watch('ETH', 'LONG', String(i))); await send(watch('SOL', 'SHORT', 'x')); await send(watch('ETH', 'SHORT', 'y'));
  assert.equal((await d.flush(r.send, T0 + 20 * 60000)).reason, 'same-hour'); assert.equal(r.sent.length, 0);
  const out = await d.flush(r.send, T0 + H); assert.equal(out.sent, true); assert.equal(out.items, 3); assert.equal(r.sent.length, 1);
  const t = r.sent[0].t; assert.match(t, /1시간 통합/); assert.match(t, /이번 시간 3회/); assert.match(t, /새 관찰 3건/); assert.ok(t.length < 3900); assert.equal(r.sent[0].o.html, true); assert.ok(!r.sent[0].o.markup);
  assert.equal((await d.flush(r.send, T0 + 2 * H)).reason, 'empty'); assert.equal(r.sent.length, 1);
});
test('직전 통합과 같은 내용은 4시간 동안 다시 보내지 않고, 내용이 바뀌면 보낸다', async () => {
  const r = rec(), st = {}, d = createDigest(st), send = d.wrapSend(r.send, () => T0);
  await send(watch('ETH', 'LONG', 'same')); await d.flush(r.send, T0 + H); assert.equal(r.sent.length, 1);
  const s2 = d.wrapSend(r.send, () => T0 + 1.2 * H); await s2(watch('ETH', 'LONG', 'same')); assert.equal((await d.flush(r.send, T0 + 2 * H)).reason, 'all-duplicate'); assert.equal(r.sent.length, 1);
  const s3 = d.wrapSend(r.send, () => T0 + 2.2 * H); await s3(watch('ETH', 'LONG', 'changed')); assert.equal((await d.flush(r.send, T0 + 3 * H)).sent, true); assert.equal(r.sent.length, 2);
  const s4 = d.wrapSend(r.send, () => T0 + 5 * H); await s4(watch('ETH', 'LONG', 'changed')); assert.equal((await d.flush(r.send, T0 + 7.5 * H)).sent, true);        // 4시간 경과 후엔 다시
});
test('전송 실패 시 큐를 비우지 않고 다음 실행에서 재시도, 한도 초과분은 다음 통합으로', async () => {
  const st = {}, d = createDigest(st), send = d.wrapSend(async () => {}, () => T0);
  await send(watch('ETH', 'LONG', 'a')); const bad = await d.flush(async () => { throw new Error('boom'); }, T0 + H); assert.equal(bad.sent, false); assert.match(bad.error, /boom/); assert.equal(Object.keys(st.digest.items).length, 1);
  const r = rec(); assert.equal((await d.flush(r.send, T0 + H + 60000)).sent, true);
  for (let i = 0; i < DIGEST_MAX_ITEMS + 3; i++) await send(watch('C' + i, 'LONG', 'z'));
  const out = await d.flush(r.send, T0 + 3 * H); assert.equal(out.items, DIGEST_MAX_ITEMS); assert.equal(out.more, 3); assert.match(r.sent.at(-1).t, /외 3건/); assert.equal(Object.keys(st.digest.items).length, 3);
});
test('상태는 JSON 으로 저장·복원되어도 동작(캐시 복원 시나리오)', async () => {
  const r = rec(), st = {}, d = createDigest(st), send = d.wrapSend(r.send, () => T0); await send(watch('ETH', 'LONG', 'a'));
  const restored = JSON.parse(JSON.stringify(st)), d2 = createDigest(restored); assert.equal((await d2.flush(r.send, T0 + H)).sent, true); assert.equal(kstHourOf(T0 + H), kstHourOf(T0) + 1);
});

// ── 진입 검토 알림 필수 항목·즉시 발송·분리 ──
import { evaluateSignal } from '../signal/evaluate.mjs';
import { candidateMessage } from '../signal/message.mjs';
import { r9Decorate } from '../signal/rich300.mjs';
import { NOW, mkA, mirrorA, mk15, mirror15 } from './signal-fixture.mjs';
test('진입 검토 알림: 전략명·진입가·손절가·익절가·순손익비·BTC 비교·유효시간과 기록 버튼, 관찰 알림과 헤더 분리', () => {
  for (const [a, c15, dir, icon] of [[mkA(), mk15(), 'LONG', '🟢'], [mirrorA(mkA()), mirror15(mk15()), 'SHORT', '🔴']]) {
    const ev = evaluateSignal({ a, c15, now: NOW }, { minRR: 1.5, validMin: 45 }), m = candidateMessage('ETHUSDT', ev, { now: NOW }), t = m.plain;
    assert.ok(t.startsWith(`${icon} 진입 검토 ${dir} | ETH`)); assert.ok(digestClassify(m.text) === null, '진입 검토는 통합 대상이 아님(즉시 발송)');
    for (const re of [/전략: /, /진입 관심가 /, /손절 기준 /, /1차 [0-9.]+ /, /비용 반영 1차 /, /BTC/, /유효 .*KST/]) assert.match(t, re);
    const d = r9Decorate(m, 'ETHUSDT', ev, { RADAR_RICH300_BUTTONS: 'on' }); assert.deepEqual(d.markup.inline_keyboard[0].map(b => b.text), ['진입했어', '안 했어']);
    assert.ok(!/기록 버튼 없음/.test(t));
  }
});
