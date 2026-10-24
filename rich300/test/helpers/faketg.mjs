// R4 오프라인 테스트용 가짜 Telegram Bot API + env 조립기. 실제 토큰·네트워크 없음.
//  · 토큰은 *어댑터 바깥*에 둔 센티넬(FAKE_TOKEN)이며 lib은 볼 수 없다 → 요청 payload·응답에 새어 나오는지 테스트가 검사한다.
//  · 고장 주입: tele.fail(method, [{status, body}|'throw', …]) — 해당 메서드의 다음 호출들이 차례로 실패한다.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { memEnv } from './memenv.mjs';
import { storeInit } from '../../lib/store.mjs';

export const FAKE_TOKEN = '123456789:AAFakeTokenForOfflineTestsOnly_0123456789abc';
export const OWNER = 1001, STRANGER = 2002, CHAT_OWNER = 1001;

export function fakeTelegram() {
  const t = { sent: [], edits: [], answers: [], calls: [], updates: [], fails: new Map(), nextUpdate: 100, nextMsg: 500, sleeps: [], webhookActive: false, botUsername: 'rich300_test_bot', webhookUrl: '' };
  const queue = (m) => t.fails.get(m) ?? [];
  t.fail = (m, list) => t.fails.set(m, [...list]);
  t.http = { call(method, payload) {
    t.calls.push({ method, payload: JSON.parse(JSON.stringify(payload)) });
    const q = queue(method); if (q.length) { const f = q.shift(); if (f === 'throw') throw new Error('network down'); return f; }
    if (method === 'getUpdates') { if (t.webhookActive) return { status: 409, body: { ok: false, description: 'Conflict: can\'t use getUpdates method while webhook is active' } }; const off = payload.offset ?? 0; return { status: 200, body: { ok: true, result: t.updates.filter(u => u.update_id >= off).slice(0, payload.limit ?? 100) } }; }
    if (method === 'getMe') return { status: 200, body: { ok: true, result: { id: 777, is_bot: true, username: t.botUsername } } };
    if (method === 'getWebhookInfo') return { status: 200, body: { ok: true, result: { url: t.webhookUrl } } };
    if (method === 'deleteWebhook') { t.webhookUrl = ''; t.webhookActive = false; return { status: 200, body: { ok: true, result: true } }; }
    if (method === 'sendMessage') { const m = { message_id: ++t.nextMsg, chat_id: payload.chat_id, text: payload.text, reply_markup: payload.reply_markup }; t.sent.push(m); return { status: 200, body: { ok: true, result: { message_id: m.message_id } } }; }
    if (method === 'editMessageText') { t.edits.push(payload); return { status: 200, body: { ok: true, result: true } }; }
    if (method === 'answerCallbackQuery') { t.answers.push(payload); return { status: 200, body: { ok: true, result: true } }; }
    return { status: 404, body: { ok: false, description: 'Not Found' } };
  } };
  t.say = (from, text, { chatId = from, type = 'private', isBot = false, date } = {}) => { const u = { update_id: ++t.nextUpdate, message: { message_id: ++t.nextMsg, from: { id: from, is_bot: isBot }, chat: { id: chatId, type }, text, ...(date === undefined ? {} : { date }) } }; t.updates.push(u); return u; };
  t.click = (from, msg, data, { cbId } = {}) => { const u = { update_id: ++t.nextUpdate, callback_query: { id: cbId ?? `cb${t.nextUpdate}`, from: { id: from, is_bot: false }, message: { message_id: msg.message_id, chat: { id: msg.chat_id, type: 'private' } }, data } }; t.updates.push(u); return u; };
  t.last = () => t.sent[t.sent.length - 1];
  t.texts = () => t.sent.map(m => m.text);
  return t;
}

// 영속 kv(Script Properties 흉내): 문자열만 저장
export function fakeKv() { const m = new Map(); return { map: m, get: k => (m.has(k) ? m.get(k) : null), put: (k, v) => { if (typeof v !== 'string') throw new Error('kv는 문자열만'); m.set(k, v); }, del: k => { m.delete(k); } }; }

export function makeTg({ failAfter = null, uiUrl, coerce = false } = {}) {   // failAfter=n: 초기화 이후 n번째 시트 쓰기를 실패시킨다
  const mem = memEnv({ coerce }), tele = fakeTelegram(), kv = fakeKv(), clock = { t: 1790000000000 };
  storeInit(mem.env); if (failAfter !== null) mem.setFail(mem.appends + failAfter);
  let rid = 0;
  const env = {
    now: () => clock.t, sha256: s => createHash('sha256').update(s).digest('hex'), randomId: n => 'r' + (++rid).toString(36).padStart(n - 1, '0'), randomInt: n => randomInt(n),
    sleep: ms => { tele.sleeps.push(ms); clock.t += ms; }, storeEnv: () => mem.env, kv, http: tele.http, ...(uiUrl ? { uiUrl } : {}),
  };
  return { env, mem, tele, kv, clock, advance: ms => { clock.t += ms; }, randomBytes };
}
