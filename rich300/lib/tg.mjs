// R4 Telegram 처리(수신 → 기록). 네트워크·시트·키 저장소는 전부 env 포트로 주입하므로 같은 코드를 Node 테스트(가짜 Telegram)와 Apps Script가 쓴다.
//  env = { now(): ms, sha256(s): hex, randomId(n): string, randomInt(n): 0..n-1 (암호학적 난수), sleep(ms),
//          storeEnv(): R3 저장소 env,
//          kv: { get(k): string|null, put(k, s), del(k) }        (페어링·폴링 오프셋·임시 입력 — 영속 저장소, 만료는 이 모듈이 처리),
//          http: { call(method, payload): { status, body } }      (봇 토큰은 이 어댑터 안에만 있다. 이 모듈은 토큰을 보지 못한다. 네트워크 오류는 throw),
//          uiUrl?: string }                                       (모바일 입력 화면 URL, 선택)
//  원칙
//   · 페어링된 사용자(from.id)만 처리한다. 그 밖의 발신자·그룹 채팅은 *무응답·무기록*(페어링 코드 시도 제외).
//   · 중복 방지: update_id·callback_query.id는 *처리 성공 후* 기록(tgupdate). 기록 전 재전송은 같은 결과(sid·fillId 유일키)로 수렴한다. 이미 기록된 것은 부수효과 없이 무시.
//   · 버튼 한 번 = 명시적 선택(진입/관망/놓침 기록). 체결·복기는 *확인(저장) 버튼*을 눌러야 기록된다. 어떤 기본값도 저장 전에는 기록되지 않는다.
//   · 상태는 최소화: 복기는 callback_data에 선택 상태를 담아 무상태, 체결 초안만 kv에 10분 보관(저장 후에도 만료까지 유지 — 재처리·재클릭은 같은 fillId라 duplicate로 수렴).
//   · Telegram 오류: 429(retry_after)·5xx·네트워크는 짧게 재시도(최대 3회), 400/401/403은 재시도하지 않고 분류만 반환. 오류 값에 본문·토큰을 넣지 않는다.
//   · 자동 주문 기능 없음: 이 모듈은 기록만 한다.
import { dec, decDiv, decMul, decFormat, decSign, decToMicro } from './decimal.mjs';
import { kstDayOf, dayStartMs, addDays } from './time.mjs';
import { pnlComputeTrade, pnlComputeAll } from './pnl.mjs';
import { riskTrade } from './risk.mjs';
import { authTimingSafeEqual } from './auth.mjs';
import { StoreError, PLAN_CHOICES, MIND_CHOICES, RESPONSE_CHOICES, schemaDecString } from './schema.mjs';
import { storeGet, storeList, storeCreate, storeClaimUpdate, storeSaveReview, storeBuildLedger } from './store.mjs';
import { closeSubmitEquity, closeCheckEquityDay, closeStatus, CLOSE_WARNING_TEXT } from './close.mjs';
import { isDayString } from './time.mjs';
import { r9ParseSignal, r9StripLine } from './r9.mjs';
import { splanBuild, splanCheckAdd, splanStatus, splanLines, splanStatusLines, splanReasonText, splanQty } from './scaleplan.mjs';

export const TG_MAX_ATTEMPTS = 3;
export const TG_MAX_WAIT_MS = 10000;                 // 이보다 긴 retry_after는 기다리지 않고 재시도 가능 오류로 반환(다음 트리거에서 재처리)
export const TG_DRAFT_TTL_SEC = 600;
export const TG_PAIR_TTL_SEC = 600;
export const TG_PAIR_MAX_FAILS = 5;
export const TG_DUP_WINDOW_MS = 10 * 60 * 1000;      // 같은 신호에서 같은 종류·가격·수량의 체결이 이 안에 또 들어오면 중복 입력으로 보고 막는다(force=1 로 해제)
export const TG_POISON_AFTER = 3;                    // 같은 update가 3번 처리 실패하면 건너뛴다(폴링이 영원히 막히지 않게)
export const TG_SID_RE = /^[A-Za-z0-9_.-]{1,54}$/;   // callback_data 64바이트 한도: 'v1:'+sid+':XXYY:s' 이 들어가도록 54자
const TG_PAIR_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TG_PLAN_CODES = { ok: 'plan_ok', ee: 'early_exit', ch: 'chase_or_average_down', ov: 'other_violation' };
const TG_MIND_CODES = { ca: 'calm', an: 'anxious_rushed', rv: 'revenge', gr: 'greedy' };
const TG_PLAN_SHORT = { ok: '계획대로', ee: '조기청산', ch: '추격·물타기', ov: '기타위반' };
const TG_MIND_SHORT = { ca: '침착', an: '불안·조급', rv: '손실복구', gr: '욕심' };
const TG_FAMILY = { opening: 'in', entry: 'in', add: 'in', reduce: 'out', close: 'out' };   // 중복 판정: 진입/추가진입, 부분/전량 청산은 같은 계열
const TG_RESP = { e: 'entered', w: 'watched', m: 'missed' };

// ── kv(만료는 여기서 처리) ──
const tgKvGet = (env, k) => { const raw = env.kv.get(k); if (raw === null || raw === undefined) return null; let o; try { o = JSON.parse(raw); } catch { return null; } if (o.exp && env.now() >= o.exp) { env.kv.del(k); return null; } return o.v; };
const tgKvPut = (env, k, v, ttlSec) => env.kv.put(k, JSON.stringify({ v, exp: ttlSec ? env.now() + ttlSec * 1000 : 0 }));

// ── Telegram 호출(재시도·오류 분류) ──
export function tgClassify(status, description) {
  const d = String(description ?? '').toLowerCase();
  if (status === 0) return 'network';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'server';
  if (status === 401 || status === 404) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (status === 400) {
    if (d.includes('message is not modified')) return 'not-modified';
    if (d.includes('message to edit not found') || d.includes("message can't be edited") || d.includes('message to delete not found')) return 'gone';
    if (d.includes('query is too old') || d.includes('query id is invalid')) return 'stale-callback';
    if (d.includes('chat not found')) return 'chat';
    return 'bad-request';
  }
  return 'other';
}
export const TG_BENIGN = Object.freeze(['not-modified', 'gone', 'stale-callback']);
export function tgCall(env, method, payload) {
  let attempts = 0;
  for (;;) {
    attempts++;
    let res; try { res = env.http.call(method, payload); } catch { res = { status: 0, body: null }; }
    const status = Number(res?.status ?? 0), body = res?.body ?? null;
    if (status === 200 && body && body.ok === true) return { ok: true, result: body.result, attempts };
    const code = tgClassify(status, body?.description), retryAfterSec = Number(body?.parameters?.retry_after ?? 0);
    const retryable = code === 'network' || code === 'server' || code === 'rate-limit';
    let wait = code === 'rate-limit' ? Math.max(retryAfterSec, 1) * 1000 : attempts * 500;
    if (retryable && attempts < TG_MAX_ATTEMPTS && wait <= TG_MAX_WAIT_MS) { env.sleep(wait); continue; }
    return { ok: false, status, code, retryable, benign: TG_BENIGN.includes(code), retryAfterSec: code === 'rate-limit' ? retryAfterSec : undefined, attempts };
  }
}
const tgPrefix = env => (typeof env.msgPrefix === 'string' ? env.msgPrefix : '');            // 테스트 환경은 모든 메시지 앞에 '[TEST] '
const tgSend = (env, chatId, text, markup) => tgCall(env, 'sendMessage', { chat_id: chatId, text: tgPrefix(env) + text, disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) });
const tgEdit = (env, cb, text, markup) => (cb.photo      // 사진 메시지는 본문이 아니라 설명(caption)을 고친다(1024자 한도)
  ? tgCall(env, 'editMessageCaption', { chat_id: cb.chatId, message_id: cb.messageId, caption: [...(tgPrefix(env) + text)].slice(0, 1024).join(''), reply_markup: markup ?? { inline_keyboard: [] } })
  : tgCall(env, 'editMessageText', { chat_id: cb.chatId, message_id: cb.messageId, text: tgPrefix(env) + text, reply_markup: markup ?? { inline_keyboard: [] } }));
const tgAnswer = (env, cbId, text) => tgCall(env, 'answerCallbackQuery', { callback_query_id: cbId, ...(text ? { text: String(text).slice(0, 190) } : {}) });
const tgOkOrBenign = r => r.ok || r.benign;
export const tgSendMessage = tgSend;                  // 검증 하니스(테스트 환경 전용)가 임의 메시지를 보낼 때 사용
// 일 마감 알림 발송(R7): 텍스트 + 선택적 URL 버튼. 결과 코드만 반환(본문·토큰 없음).
export function tgSendNotice(env, chatId, text, url) {
  const r = tgSend(env, chatId, text, url && /^https:\/\/\S+$/.test(url) ? { inline_keyboard: [[{ text: '입력하기', url }]] } : undefined);
  return r.ok ? { ok: true } : { ok: false, code: r.code };
}

// ── 입력 정규화 ──
export function tgParseUpdate(u) {
  if (!u || !Number.isSafeInteger(u.update_id)) return null;
  const m = u.message, c = u.callback_query;
  if (m && m.from && Number.isSafeInteger(m.from.id) && m.chat && Number.isSafeInteger(m.chat.id)) return { kind: 'message', updateId: u.update_id, fromId: m.from.id, chatId: m.chat.id, chatType: m.chat.type, isBot: m.from.is_bot === true, dateMs: Number.isFinite(m.date) ? m.date * 1000 : null, text: typeof m.text === 'string' ? m.text.slice(0, 500) : '' };
  if (c && typeof c.id === 'string' && c.from && Number.isSafeInteger(c.from.id)) {
    const cm = c.message; return { kind: 'callback', updateId: u.update_id, fromId: c.from.id, chatId: cm?.chat && Number.isSafeInteger(cm.chat.id) ? cm.chat.id : null, chatType: cm?.chat?.type, isBot: c.from.is_bot === true, cbId: c.id, data: typeof c.data === 'string' ? c.data.slice(0, 64) : '', messageId: Number.isSafeInteger(cm?.message_id) ? cm.message_id : null, msgText: typeof (cm?.text ?? cm?.caption) === 'string' ? (cm.text ?? cm.caption).slice(0, 4096) : '', isPhoto: Array.isArray(cm?.photo) };
  }
  return null;
}
export function tgParseCommand(text) {
  const t = String(text ?? '').trim(); if (!t.startsWith('/')) return null;
  const parts = t.split(/\s+/), cmd = parts[0].slice(1).split('@')[0].toLowerCase(), pos = [], opt = {};
  for (const p of parts.slice(1)) { const i = p.indexOf('='); if (i > 0) opt[p.slice(0, i).toLowerCase()] = p.slice(i + 1); else pos.push(p); }
  return { cmd, pos, opt };
}
// 체결 시각 입력(KST). 'HH:mm'(오늘, 미래면 어제) · 'MM-DD HH:mm' · 'YYYY-MM-DD HH:mm' (구분은 공백·T·_ 모두 허용). 비우면 undefined(=지금).
export const TG_FUTURE_SLACK_MS = 5 * 60 * 1000;
export function tgParseAt(raw, now) {
  const t = String(raw ?? '').trim().replace(/[T_]/g, ' ').replace(/\s+/g, ' ');
  if (!t) return undefined;
  let m, ms;
  const hm = (day, h, mi) => { if (+h > 23 || +mi > 59) throw tgUserErr('시각 형식이 맞지 않습니다(예: 14:30)'); return dayStartMs(day) + (+h * 60 + +mi) * 60000; };
  const today = kstDayOf(now);
  try {
    if ((m = /^(\d{1,2}):(\d{2})$/.exec(t))) { ms = hm(today, m[1], m[2]); if (ms > now + TG_FUTURE_SLACK_MS) ms = hm(addDays(today, -1), m[1], m[2]); }
    else if ((m = /^(\d{2})-(\d{2}) (\d{1,2}):(\d{2})$/.exec(t))) { const y = today.slice(0, 4); ms = hm(`${y}-${m[1]}-${m[2]}`, m[3], m[4]); if (ms > now + TG_FUTURE_SLACK_MS) ms = hm(`${+y - 1}-${m[1]}-${m[2]}`, m[3], m[4]); }
    else if ((m = /^(\d{4}-\d{2}-\d{2}) (\d{1,2}):(\d{2})$/.exec(t))) ms = hm(m[1], m[2], m[3]);
  } catch (e) { if (e instanceof StoreError) throw e; throw tgUserErr('시각 형식이 맞지 않습니다(예: 14:30 또는 10-24 14:30)'); }
  if (ms === undefined || !Number.isFinite(ms)) throw tgUserErr('시각 형식이 맞지 않습니다(예: 14:30 또는 10-24 14:30)');
  if (ms > now + TG_FUTURE_SLACK_MS) throw tgUserErr('미래 시각은 입력할 수 없습니다');
  return ms;
}
const tgAtMs = (env, p) => (p.atMs === undefined || p.atMs === null || p.atMs === '' ? undefined : (Number.isSafeInteger(+p.atMs) && +p.atMs > 0 ? +p.atMs : (() => { throw tgUserErr('시각 값이 올바르지 않습니다'); })()));
function tgNote(raw) { const t = String(raw ?? '').replace(/\s+/g, ' ').trim(); if (!t) return undefined; if (t.length > 300) throw tgUserErr('메모는 300자까지입니다'); return t; }
function tgAmount(raw, name) {                         // "0.12" 입력, "~0.12" 추정, 비우면 미입력
  if (raw === undefined || raw === '') return { state: 'missing' };
  const est = raw.startsWith('~'), v = est ? raw.slice(1) : raw;
  return { state: est ? 'estimated' : 'entered', amount: schemaDecString(v, name) };
}
const tgUserErr = (msg) => new StoreError('USER', msg);

// ── 페어링 ──
export function tgPairCreate(env) {                    // UI(소유자 로그인)에서 호출: 10분·1회용 코드. 해시만 저장한다.
  const code = Array.from({ length: 8 }, () => TG_PAIR_ALPHABET[env.randomInt(TG_PAIR_ALPHABET.length)]).join('');
  tgKvPut(env, 'pair', { hash: env.sha256(`rich300-pair|${code}`) }, TG_PAIR_TTL_SEC); tgKvPut(env, 'pairfail', { n: 0 }, TG_PAIR_TTL_SEC);
  return { code, expiresAt: env.now() + TG_PAIR_TTL_SEC * 1000 };
}
export const tgPairedUser = env => tgKvGet(env, 'paired');
function tgPairAttempt(env, ev, code) {                // 실패는 무응답(봇 존재·코드 유무를 알려 주지 않음). 5회 실패 시 코드 폐기.
  const rec = tgKvGet(env, 'pair'), fails = tgKvGet(env, 'pairfail') ?? { n: 0 };
  if (!rec || fails.n >= TG_PAIR_MAX_FAILS || ev.chatType !== 'private' || ev.isBot) return { status: 'ignored', action: 'pair-rejected' };
  const ok = authTimingSafeEqual(rec.hash, env.sha256(`rich300-pair|${String(code ?? '').toUpperCase()}`));
  if (!ok) { fails.n++; tgKvPut(env, 'pairfail', fails, TG_PAIR_TTL_SEC); if (fails.n >= TG_PAIR_MAX_FAILS) env.kv.del('pair'); return { status: 'ignored', action: 'pair-rejected' }; }
  env.kv.del('pair'); env.kv.del('pairfail'); tgKvPut(env, 'paired', { userId: ev.fromId, chatId: ev.chatId, at: env.now() });
  const s = tgSend(env, ev.chatId, 'RICH300 연결 완료. 이 계정만 응답합니다. /help');
  return { status: 'handled', action: 'paired', replyFailed: !s.ok };
}

// ── 메시지·버튼 만들기 ──
export function tgResponseKeyboard(sid) {
  if (!TG_SID_RE.test(sid)) throw new Error('sid는 영문·숫자·_.- 54자 이하(callback_data 한도)');
  return { inline_keyboard: [[{ text: '진입했어', callback_data: `r1:${sid}:e` }, { text: '관망했어', callback_data: `r1:${sid}:w` }, { text: '놓쳤어', callback_data: `r1:${sid}:m` }]] };
}
export function tgSignalText(s) {
  return [`🔔 ${s.strategy}전략 ${s.dir} ${s.symbolId}`, `진입 ${s.entry} · 손절 ${s.stop} · TP1 ${s.tp1}`, '내 판단은?'].join('\n');
}
export function tgFillLink(uiUrl, s) {
  if (typeof uiUrl !== 'string' || !/^https:\/\/[^\s]+$/.test(uiUrl)) return null;
  const q = `p=fill&sid=${encodeURIComponent(s.sid)}&dir=${s.dir}&entry=${encodeURIComponent(s.entry)}&stop=${encodeURIComponent(s.stop)}`;
  return `${uiUrl}${uiUrl.includes('?') ? '&' : '?'}${q}`;
}
export function tgSendSignalPrompt(env, chatId, sid) {  // 오프라인 테스트용 발송기(R9 연동 전에는 운영에서 호출하지 않는다)
  const sg = storeGet(env.storeEnv(), 'signal', sid); if (!sg || sg.void) return { ok: false, code: 'unknown-signal' };
  if (!TG_SID_RE.test(sid)) return { ok: false, code: 'sid-too-long' };
  return tgSend(env, chatId, tgSignalText(sg.data), tgResponseKeyboard(sid));
}
export function tgReviewKeyboard(sid, plan = 'ok', mind = 'ca') {
  const st = `${plan}${mind}`, row = (codes, short, mk) => Object.keys(codes).map(c => ({ text: `${(mk === 'p' ? plan : mind) === c ? '✅ ' : ''}${short[c]}`, callback_data: `v1:${sid}:${mk === 'p' ? c + mind : plan + c}` }));
  return { inline_keyboard: [row(TG_PLAN_CODES, TG_PLAN_SHORT, 'p'), row(TG_MIND_CODES, TG_MIND_SHORT, 'm'), [{ text: `💾 저장 (${TG_PLAN_SHORT[plan]} · ${TG_MIND_SHORT[mind]})`, callback_data: `v1:${sid}:${st}:s` }]] };
}
export const tgReviewText = (sid, plan = 'ok', mind = 'ca') => `복기 · ${sid}\n계획: ${TG_PLAN_SHORT[plan]} · 심리: ${TG_MIND_SHORT[mind]}\n(저장 버튼을 눌러야 기록됩니다)`;
function tgSendReviewPrompt(env, chatId, sid) {
  if (!TG_SID_RE.test(sid)) return { ok: false, code: 'sid-too-long' };
  return tgSend(env, chatId, tgReviewText(sid), tgReviewKeyboard(sid));
}

// ── 체결 초안(진입·추가·청산·부분청산) ──
const tgFillsOf = (se, sid) => storeList(se, 'fill').map(r => r.data).filter(f => f.sid === sid);
function tgRiskEquityMicro(env) {                      // 경고용: 오늘 시작 평가액(장부 계산 실패 시 null)
  try { const l = storeBuildLedger(env.storeEnv(), { throughDay: kstDayOf(env.now()) }); const r = l.rows[l.rows.length - 1]; return r ? r.startMicro : null; } catch { return null; }
}
// ── 분할 진입·익절 계획(계산·경고 전용, 주문 없음) ──
// 저장: 첫 진입 체결 때 입력(평가액·1차 진입가·손절·배율·단계 수)을 'plan'(불변)에 한 번 남긴다. 계획은 이 입력에서 결정적으로 다시 만든다.
// 규칙 위반(무계획 추가 진입 등)은 기본 차단, 명령 끝 force=1 이면 기록하되 요약에 경고를 남긴다.
const tgEquityNow = env => { const m = tgRiskEquityMicro(env); return m === null || m === undefined ? null : (Number(m) / 1e6).toFixed(2); };
function tgPlanBuild(se, sid, sg, inp) {
  return splanBuild({ symbol: sg.symbolId, dir: sg.dir, entry: Number(inp.entry), stop: Number(inp.stop), equity: Number(inp.equity), ...(inp.lev ? { lev: inp.lev } : {}), ...(inp.stages ? { params: { maxStages: inp.stages } } : {}) });
}
function tgPlanOf(se, sid) {
  const r = storeGet(se, 'plan', sid), sg = storeGet(se, 'signal', sid); if (!r || r.void || !sg || sg.void) return null;
  const plan = tgPlanBuild(se, sid, sg.data, r.data); return plan.status === 'ok' ? plan : null;
}
const tgPlanFills = fills => fills.map(f => ({ kind: f.kind, price: Number(f.price), qty: Number(f.qty), at: f.at }));
const tgPlanCtx = (env, sg) => ({ barsSinceSignal: Math.max(0, Math.floor((env.now() - sg.signalAt) / 900000)) });
function tgPlanPreview(env, sid, equityArg) {                // 진입 전: 신호 값과 평가액으로 보여 주기만 한다(저장 없음)
  const se = env.storeEnv(), sg = storeGet(se, 'signal', sid); if (!sg || sg.void) return null;
  const eq = equityArg ?? tgEquityNow(env); if (eq === null) return { plan: null, equity: null };
  return { plan: tgPlanBuild(se, sid, sg.data, { entry: sg.data.entry, stop: sg.data.stop, equity: eq }), equity: eq };
}
function tgPlanCheckAdd(env, p, fills, entry, qty) {          // 추가 진입 검사: 통과 못 하면 사유 목록
  const se = env.storeEnv(), sg = storeGet(se, 'signal', p.sid), plan = tgPlanOf(se, p.sid);
  if (!plan) return ['no-plan'];
  return splanCheckAdd(plan, tgPlanFills(fills), { price: Number(entry), qty: Number(qty) }, tgPlanCtx(env, sg.data)).reasons;
}
function tgPlanEntryWarnings(env, p, qty) {                   // 첫 진입 수량이 계획 1차보다 크거나 계획상 거래 제외인 경우 경고
  try {
    const pv = tgPlanPreview(env, p.sid); if (!pv || !pv.plan) return [];
    if (pv.plan.status !== 'ok') return [`계획상 거래 제외: ${splanReasonText(pv.plan.reason)}`];
    const q1 = pv.plan.stages[0].qty; return Number(qty) > q1 + pv.plan.spec.step / 2 ? [`1차 계획 수량 ${splanQty(q1, pv.plan.spec)} 보다 큽니다(1차는 전체의 ${Math.round(pv.plan.stages[0].weight * 100)}%, 나머지는 사전 가격에서만)`] : [];
  } catch { return []; }
}
export function tgBuildEntry(env, p) {                 // p: { sid, margin, leverage, entry, stop, qty?, fee?, funding? } (문자열)
  const se = env.storeEnv(), sg = storeGet(se, 'signal', p.sid);
  if (!sg || sg.void) throw tgUserErr(`알 수 없는 신호: ${String(p.sid).slice(0, 40)}`);
  const resp = storeGet(se, 'response', p.sid);
  if (resp && !resp.void && resp.data.choice !== 'entered') throw tgUserErr(`이 신호는 '${RESPONSE_CHOICES[resp.data.choice]}'로 기록돼 있어 진입을 기록할 수 없습니다(수정은 앱에서)`);
  const fills = tgFillsOf(se, p.sid), trade = fills.length ? tgTradeOrUserError(fills) : null;
  if (trade && trade.status === 'closed') throw tgUserErr('이미 청산된 신호입니다');
  const kind = trade ? 'add' : 'entry';
  const margin = schemaDecString(p.margin, '증거금', { positive: true }), leverage = schemaDecString(p.leverage, '레버리지', { positive: true }), entry = schemaDecString(p.entry, '진입가', { positive: true }), stop = p.stop === undefined || p.stop === '' ? undefined : schemaDecString(p.stop, '손절가', { positive: true });
  let qty, qtySource = 'entered';
  if (p.qty !== undefined && p.qty !== '') qty = schemaDecString(p.qty, '수량', { positive: true });
  else { qty = decFormat(decDiv(decMul(dec(margin), dec(leverage)), dec(entry)), 8); qty = schemaDecString(qty, '수량(계산)', { positive: true }); qtySource = 'derived'; }
  const dir = sg.data.dir, risk = riskTrade({ dir, entry, stop: stop ?? entry, qty, margin, leverage, equityMicro: stop === undefined ? null : tgRiskEquityMicro(env) });
  const atMs = tgAtMs(env, p), note = tgNote(p.note);
  const fill = { origin: 'real', sid: p.sid, kind, dir, price: entry, qty, margin, leverage, ...(stop === undefined ? {} : { plannedStop: stop }), qtySource, fee: tgAmount(p.fee, '수수료'), funding: tgAmount(p.funding, '펀딩'), ...(note ? { note } : {}) };
  const extra = [];
  if (kind === 'add') {
    const why = tgPlanCheckAdd(env, p, fills, entry, qty);
    if (why.length && p.force !== true) throw tgUserErr(`계획 밖 추가 진입은 기록하지 않습니다(손실 만회용 물타기 금지): ${why.map(splanReasonText).join(' / ').slice(0, 220)}. 그래도 실제로 체결했다면 명령 끝에 force=1 을 붙여 기록하세요`);
    if (why.length) extra.push(`⚠ 계획 밖 추가 진입(force): ${why.map(splanReasonText).join(' / ').slice(0, 200)}`);
  } else for (const w of tgPlanEntryWarnings(env, p, qty)) extra.push(`⚠ ${w}`);
  return { type: 'fill', fill, risk, summary: [tgEntrySummary(fill, stop === undefined ? { ...risk, noStop: true } : risk, atMs), ...extra].join('\n'), params: { ...p }, force: p.force === true };
}
export function tgBuildExit(env, p) {                  // p: { sid, price, qty?('all'), fee?, funding? }
  const se = env.storeEnv(), fills = tgFillsOf(se, p.sid), trade = fills.length ? tgTradeOrUserError(fills) : null;
  if (!trade) throw tgUserErr('이 신호의 진입 기록이 없습니다');
  if (trade.status !== 'open') throw tgUserErr('이미 전량 청산된 포지션입니다');
  const price = schemaDecString(p.price, '청산가', { positive: true });
  const rq = String(p.qty ?? '').trim(), pm = /^(\d+(?:\.\d+)?)%$/.exec(rq);
  if (pm && !(+pm[1] > 0 && +pm[1] <= 100)) throw tgUserErr('청산 비율은 0 초과 100 이하(%)');
  const all = rq === '' || rq.toLowerCase() === 'all' || (pm && +pm[1] === 100);
  const trim12 = v => decFormat(v, 12).replace(/0+$/, '').replace(/\.$/, '');
  const qty = all ? trim12(trade.openQtyDec) : pm ? trim12(decDiv(decMul(trade.openQtyDec, dec(pm[1])), dec(100))) : schemaDecString(rq, '수량', { positive: true });
  if (!all && pm && !(dec(qty) > 0n)) throw tgUserErr('계산된 청산 수량이 0입니다');
  const qd = dec(qty); if (qd > trade.openQtyDec) throw tgUserErr(`보유 수량(${tgNum(decFormat(trade.openQtyDec, 8))})보다 큽니다`);
  const kind = qd === trade.openQtyDec ? 'close' : 'reduce';
  const atMs = tgAtMs(env, p), note = tgNote(p.note), lastAt = fills.reduce((m, f) => Math.max(m, f.at), 0);
  if (atMs !== undefined && atMs <= lastAt) throw tgUserErr('청산 시각은 이전 체결보다 뒤여야 합니다');
  const fill = { origin: 'real', sid: p.sid, kind, dir: trade.dir, price, qty, fee: tgAmount(p.fee, '수수료'), funding: tgAmount(p.funding, '펀딩'), ...(note ? { note } : {}) };
  const probe = tgTradeOrUserError([...fills, { ...fill, fillId: 'preview', at: atMs ?? tgNextAt(env, fills) }]), ev = probe.events[probe.events.length - 1];
  return { type: 'exit', fill, summary: tgExitSummary(fill, ev, probe, atMs), params: { ...p }, force: p.force === true };
}
const tgM = m => decFormat(m * 1000000n, 2);
const tgKstLabel = ms => new Date(ms + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' ');
function tgEntrySummary(f, r, atMs) {
  const lines = [`${f.kind === 'add' ? '추가진입' : '진입'} ${f.dir} · ${f.sid}${atMs ? ` · ${tgKstLabel(atMs)} KST` : ''}`, `진입 ${f.price} · 수량 ${f.qty}${f.qtySource === 'derived' ? '(계산)' : ''} · 손절 ${f.plannedStop ?? '미입력'}`, r.noStop ? `증거금 ${f.margin} · ${f.leverage}x · 손절가 없음(위험 계산 생략)` : `증거금 ${f.margin} · ${f.leverage}x · 손절 시 손실 ${tgM(r.stopLossMicro)} USDT${r.riskPpmOfEquity !== null ? ` (${decFormat(BigInt(r.riskPpmOfEquity) * 100000000n, 2)}%)` : ''}`];
  const fl = r.noStop ? r.flags.filter(x => x === 'leverage-mismatch') : r.flags, w = [fl.includes('stop-on-wrong-side') && '손절가가 방향과 반대쪽', fl.includes('liquidation-before-stop') && '청산가(근사)가 손절보다 먼저', fl.includes('risk-over-2pct') && '손실 2% 초과', fl.includes('leverage-mismatch') && '레버리지 불일치'].filter(Boolean);
  if (w.length) lines.push(`⚠ ${w.join(' · ')}`);
  lines.push(`수수료 ${f.fee.state === 'missing' ? '미입력' : f.fee.amount} · 펀딩 ${f.funding.state === 'missing' ? '미입력' : f.funding.amount}`);
  return lines.join('\n');
}
function tgExitSummary(f, ev, t, atMs) {
  const lines = [`${f.kind === 'close' ? '전량 청산' : '부분 청산'} ${f.dir} · ${f.sid}${atMs ? ` · ${tgKstLabel(atMs)} KST` : ''}`, `청산 ${f.price} · 수량 ${f.qty} · 이번 총손익 ${tgM(ev.grossMicro)} USDT`, `수수료 ${f.fee.state === 'missing' ? '미입력' : f.fee.amount} · 펀딩 ${f.funding.state === 'missing' ? '미입력' : f.funding.amount}`];
  if (f.kind === 'close') lines.push(`포지션 순손익(입력된 수수료·펀딩만) ${tgM(t.totals.netEnteredMicro)} USDT`);
  if (f.note) lines.push(`메모: ${f.note.slice(0, 80)}`);
  return lines.join('\n');
}
const tgTradeOrUserError = fills => { try { return pnlComputeTrade(fills); } catch (e) { throw tgUserErr(`계산할 수 없는 체결입니다: ${String(e.message).slice(0, 80)}`); } };
const tgNextAt = (env, fills) => Math.max(env.now(), fills.reduce((m, f) => Math.max(m, f.at), 0) + 1);
const tgNum = v => { const t = String(v); return t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t; };
function tgRebuild(env, d) {                            // 확인 시점의 *현재 상태*로 다시 계산해 초안과 같은지 확인(그 사이 상태가 바뀐 초안이 잘못 저장되는 것을 막는다)
  let b;
  try { b = d.type === 'fill' ? tgBuildEntry(env, d.params) : tgBuildExit(env, d.params); }
  catch (e) { if (d.type === 'fill' && d.fill.kind === 'entry' && e instanceof StoreError && e.code === 'USER' && tgFillsOf(env.storeEnv(), d.fill.sid).length) throw tgUserErr('그 사이 포지션 상태가 바뀌어 이 초안은 맞지 않습니다. 다시 입력해 주세요'); throw e; }
  if (b.fill.kind !== d.fill.kind || b.fill.qty !== d.fill.qty) throw tgUserErr('그 사이 포지션 상태가 바뀌어 이 초안은 맞지 않습니다. 다시 입력해 주세요');
}
function tgStorePlan(env, f, actor) {                       // 계획은 참고용: 저장·계산에 실패해도 체결 기록은 영향받지 않는다
  try {
    const se = env.storeEnv(), sg = storeGet(se, 'signal', f.sid); if (!sg || sg.void || storeGet(se, 'plan', f.sid)) return;
    const eq = tgEquityNow(env); if (eq === null) return;
    const inp = { entry: f.price, stop: f.plannedStop ?? sg.data.stop, equity: eq }, plan = tgPlanBuild(se, f.sid, sg.data, inp); if (plan.status !== 'ok') return;
    storeCreate(se, 'plan', { sid: f.sid, ...inp, lev: plan.lev, stages: plan.stagesCount, at: f.at }, { actor });
  } catch { /* 계획 저장 실패는 무시 */ }
}
function tgCommitFill(env, draft, actor) {             // 확인(저장) 이후에만 호출. fillId는 초안/폼 id로 고정 → 중복 확인·재처리에도 1건.
  const se = env.storeEnv(), have = storeGet(se, 'fill', draft.fillId);
  if (have && !have.void) return { status: 'duplicate', key: draft.fillId, rev: have.rev, kind: have.data.kind };
  if (draft.params) tgRebuild(env, draft);
  const same = tgFillsOf(se, draft.fill.sid), customAt = draft.params ? tgAtMs(env, draft.params) : undefined;
  if (customAt !== undefined && same.some(x => x.at >= customAt)) throw tgUserErr('입력한 시각이 이전 체결보다 앞이거나 같습니다');
  const f = { ...draft.fill, at: customAt ?? tgNextAt(env, same), fillId: draft.fillId };
  if (draft.force !== true && same.some(x => TG_FAMILY[x.kind] === TG_FAMILY[f.kind] && x.price === f.price && x.qty === f.qty && Math.abs(x.at - env.now()) < TG_DUP_WINDOW_MS))
    throw tgUserErr('같은 계열(진입 또는 청산)·가격·수량의 체결이 방금 저장돼 있습니다(중복 저장 방지). 다른 체결이 맞으면 명령 끝에 force=1 을 붙여 다시 입력하세요');
  if (draft.type === 'fill') {
    const cur = storeGet(se, 'response', f.sid);
    if (!cur || cur.void) storeCreate(se, 'response', { sid: f.sid, choice: 'entered', at: f.at }, { actor });
  }
  const r = storeCreate(se, 'fill', f, { actor });
  if (r.status === 'conflict') throw tgUserErr('같은 체결 id에 다른 내용이 이미 있습니다');
  if (f.kind === 'entry') tgStorePlan(env, f, actor);
  return { ...r, kind: f.kind };
}

// ── 입력 화면(모바일 폼) 제출: 폼의 제출 버튼이 곧 확인이다 ──
export function tgSubmitFillForm(env, form, { actor = 'ui:form' } = {}) {
  try {
    if (!form || typeof form !== 'object') throw tgUserErr('입력 형식 오류');
    const sid = String(form.sid ?? ''), isExit = form.kind === 'exit', formId = String(form.formId ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || env.randomId(8), fillId = `${sid}:${formId}`;
    const dupe = storeGet(env.storeEnv(), 'fill', fillId);          // 같은 폼 재제출(네트워크 재시도·더블탭)은 상태가 바뀌었어도 duplicate로 수렴
    if (dupe && !dupe.void) return { ok: true, status: 'duplicate', kind: dupe.data.kind };
    const atMs = tgParseAt(form.at, env.now()), common = { fee: form.fee ? String(form.fee) : undefined, funding: form.funding ? String(form.funding) : undefined, force: form.force === true, ...(atMs === undefined ? {} : { atMs }), ...(form.note ? { note: String(form.note) } : {}) };
    const built = isExit ? tgBuildExit(env, { sid, price: String(form.price ?? ''), qty: form.qty === undefined || form.qty === '' ? undefined : String(form.qty), ...common })
      : tgBuildEntry(env, { sid, margin: String(form.margin ?? ''), leverage: String(form.leverage ?? ''), entry: String(form.entry ?? ''), stop: form.stop ? String(form.stop) : undefined, qty: form.qty ? String(form.qty) : undefined, ...common });
    const r = tgCommitFill(env, { ...built, fillId }, actor); const out = { ok: true, status: r.status, kind: built.fill.kind, summary: built.summary };
    if (built.fill.kind === 'close') { const p = tgPairedUser(env); if (p) out.reviewPrompt = tgSendReviewPromptIfNeeded(env, p.chatId, sid); }
    return out;
  } catch (e) { if (e instanceof StoreError && (e.code === 'USER' || e.code === 'VALIDATION')) return { ok: false, error: 'invalid', message: String(e.message).slice(0, 160) }; if (e instanceof StoreError && e.code === 'LOCK') return { ok: false, error: 'busy', retry: true }; return { ok: false, error: 'server' }; }
}
function tgSendReviewPromptIfNeeded(env, chatId, sid) {      // 프롬프트는 청산당 1회: 이미 복기했거나 이미 보냈으면 건너뜀. 보낸 뒤 표시(kv)를 남겨, 저장 후 재처리에서도 빠지지 않고 중복도 없다.
  const rv = storeGet(env.storeEnv(), 'review', sid); if (rv && !rv.void) return { ok: true, skipped: true };
  if (env.kv.get(`rp:${sid}`) !== null) return { ok: true, skipped: true };
  const r = tgSendReviewPrompt(env, chatId, sid); if (r.ok) env.kv.put(`rp:${sid}`, String(env.now()));
  return { ok: r.ok, code: r.code };
}

// ── 명령 ──
const TG_HELP = ['RICH300 명령', '/fill 신호ID 증거금 레버리지 진입가 [손절가|-] [qty= at=14:30 fee= funding=]', '/exit 신호ID 청산가 [수량|50%|all] [at=14:30 fee= funding= memo=복기_메모]  (수량이 잔량보다 적으면 부분청산)', '/equity 금액 [날짜] [unrealized=값]  (마감 평가액 입력, 날짜 생략 시 평가액 없는 최근 마감일)', '/plan 신호ID [평가액]  (분할 진입·익절 계획과 현재 상태 — 계산 참고용, 주문 아님)', '/review 신호ID · /status · /help', '수수료·펀딩은 fee=0.12 (추정은 fee=~0.12), 비우면 미입력', '같은 체결이 10분 안에 또 들어오면 중복으로 막습니다(맞으면 force=1)'].join('\n');
export function tgConfirmDraft(env, ev, built) {
  const id = env.randomId(8); tgKvPut(env, `d:${id}`, { type: built.type, fill: built.fill, equity: built.equity, params: built.params, force: built.force === true, sid: built.fill ? built.fill.sid : undefined, chatId: ev.chatId, userId: ev.fromId }, TG_DRAFT_TTL_SEC);
  const s = tgSend(env, ev.chatId, `${built.summary}\n저장할까요?`, { inline_keyboard: [[{ text: '저장', callback_data: `f1:${id}:y` }, { text: '취소', callback_data: `f1:${id}:n` }]] });
  return { status: 'handled', action: built.type === 'fill' ? 'fill-draft' : built.type === 'equity' ? 'equity-draft' : 'exit-draft', replyFailed: !s.ok };
}
function tgDefaultEquityDay(env) {                      // 평가액이 없는 가장 최근 *마감된* 날, 없으면 오늘(KST)
  try { const m = closeStatus(env, { now: env.now(), days: 14 }).find(d => d.closed && d.equity === null); if (m) return m.day; } catch { /* 챌린지 없음 등 */ }
  return kstDayOf(env.now());
}
function tgPlanText(env, sid, equityArg) {
  const se = env.storeEnv(), sg = storeGet(se, 'signal', sid); if (!sg || sg.void) throw tgUserErr(`알 수 없는 신호: ${String(sid).slice(0, 40)}`);
  const stored = equityArg === undefined ? tgPlanOf(se, sid) : null;
  if (stored) {
    const fills = tgFillsOf(se, sid), st = splanStatus(stored, tgPlanFills(fills), tgPlanCtx(env, sg.data));
    return [...splanLines(stored), '', ...splanStatusLines(stored, st), '15분봉 종가 기준 구조 유지·미체결 주문 취소 여부는 거래소 차트에서 직접 확인하세요'].join('\n');
  }
  const pv = tgPlanPreview(env, sid, equityArg);
  if (!pv.plan) return '계획을 만들 평가액이 없습니다. /plan 신호ID 평가액 으로 평가액을 직접 넣어 보세요';
  return [...splanLines(pv.plan, { assumed: equityArg !== undefined }), '', equityArg === undefined ? '※ 오늘 시작 평가액 기준 미리보기. 첫 진입을 기록하면 이 계획이 고정됩니다' : '※ 입력한 평가액 기준 미리보기(저장되지 않음)'].join('\n');
}
function tgPlanCard(env, sid) {                          // [진입했어] 직후 안내: 실패해도 기록·안내에는 영향 없음
  try { return `\n\n${tgPlanText(env, sid)}`; } catch { return ''; }
}
function tgOnMessage(env, ev) {
  const c = tgParseCommand(ev.text); if (!c) return { status: 'ignored', action: 'not-command' };
  const reply = (t, extra) => { const s = tgSend(env, ev.chatId, t, extra); return { replyFailed: !s.ok }; };
  try {
    if (c.cmd === 'start' || c.cmd === 'help') return { status: 'handled', action: 'help', ...reply(TG_HELP) };
    if (c.cmd === 'fill') {
      if (c.pos.length < 4) return { status: 'handled', action: 'usage', ...reply('사용법: /fill 신호ID 증거금 레버리지 진입가 [손절가|-] [qty= at=14:30 fee= funding=]') };
      const [sid, margin, leverage, entry, stop] = c.pos, atMs = tgParseAt(c.opt.at, env.now()); return tgConfirmDraft(env, ev, tgBuildEntry(env, { sid, margin, leverage, entry, stop: stop === '-' ? undefined : stop, qty: c.opt.qty, fee: c.opt.fee, funding: c.opt.funding, force: c.opt.force === '1', ...(atMs === undefined ? {} : { atMs }), ...(c.opt.memo ? { note: c.opt.memo } : {}) }));
    }
    if (c.cmd === 'exit') {
      if (c.pos.length < 2) return { status: 'handled', action: 'usage', ...reply('사용법: /exit 신호ID 청산가 [수량|50%|all] [at=14:30 fee= funding= memo=복기_메모]') };
      const atMs = tgParseAt(c.opt.at, env.now()); return tgConfirmDraft(env, ev, tgBuildExit(env, { sid: c.pos[0], price: c.pos[1], qty: c.pos[2] ?? c.opt.qty, fee: c.opt.fee, funding: c.opt.funding, force: c.opt.force === '1', ...(atMs === undefined ? {} : { atMs }), ...(c.opt.memo ? { note: c.opt.memo.replace(/_/g, ' ') } : {}) }));
    }
    if (c.cmd === 'equity') {
      if (c.pos.length < 1) return { status: 'handled', action: 'usage', ...reply('사용법: /equity 금액 [날짜] [unrealized=값]') };
      const day = c.pos[1] ?? tgDefaultEquityDay(env); if (!isDayString(day)) return { status: 'handled', action: 'user-error', ...reply('⚠ 날짜 형식은 YYYY-MM-DD 입니다') };
      closeCheckEquityDay(env, day, env.now());
      const amount = schemaDecString(c.pos[0], '평가액', { nonNegative: true }), un = c.opt.unrealized === undefined ? undefined : schemaDecString(c.opt.unrealized, '미실현 손익');
      return tgConfirmDraft(env, ev, { type: 'equity', equity: { day, equity: amount, ...(un === undefined ? {} : { unrealized: un }) }, summary: `평가액 입력 · ${day}\n실제 계좌 평가액 ${amount} USDT${un === undefined ? '' : ` (미실현 ${un})`}\n(장부와 다르면 차이만 표시하고 손익에는 자동 반영하지 않습니다)` });
    }
    if (c.cmd === 'review') {
      const sid = c.pos[0]; if (!sid || !TG_SID_RE.test(sid)) return { status: 'handled', action: 'usage', ...reply('사용법: /review 신호ID') };
      if (!tgFillsOf(env.storeEnv(), sid).length) return { status: 'handled', action: 'review-none', ...reply('이 신호의 체결 기록이 없습니다') };
      const s = tgSendReviewPrompt(env, ev.chatId, sid); return { status: 'handled', action: 'review-prompt', replyFailed: !s.ok };
    }
    if (c.cmd === 'plan') {
      const sid = c.pos[0]; if (!sid || !TG_SID_RE.test(sid)) return { status: 'handled', action: 'usage', ...reply('사용법: /plan 신호ID [평가액]') };
      const eqArg = c.pos[1] === undefined ? undefined : schemaDecString(c.pos[1], '평가액', { positive: true });
      return { status: 'handled', action: 'plan', ...reply(tgPlanText(env, sid, eqArg)) };
    }
    if (c.cmd === 'status') {
      const open = [...pnlComputeAll(storeList(env.storeEnv(), 'fill').map(r => r.data), {}).values()].filter(t => t.status === 'open');
      return { status: 'handled', action: 'status', ...reply(open.length ? ['열린 포지션', ...open.slice(0, 8).map(t => `${t.sid} ${t.dir} ${tgNum(t.openQty)} @ ${tgNum(t.avgEntry)}`)].join('\n') : '열린 포지션 없음') };
    }
    return { status: 'handled', action: 'unknown-command', ...reply('알 수 없는 명령입니다. /help') };
  } catch (e) {
    if (e instanceof StoreError && (e.code === 'USER' || e.code === 'VALIDATION' || e.code === 'NOT_FOUND')) return { status: 'handled', action: 'user-error', ...reply(`⚠ ${String(e.message).slice(0, 160)}`) };
    throw e;
  }
}

// ── 버튼(callback) ──
function tgOnCallback(env, ev) {
  const answer = t => tgAnswer(env, ev.cbId, t), parts = ev.data.split(':');
  const cb = { chatId: ev.chatId, messageId: ev.messageId, photo: ev.isPhoto === true };
  if (parts[0] === 'r1' && parts.length === 3 && TG_RESP[parts[2]]) return tgOnResponse(env, ev, parts[1], TG_RESP[parts[2]], cb, answer);
  if (parts[0] === 'v1' && (parts.length === 3 || (parts.length === 4 && parts[3] === 's'))) return tgOnReview(env, ev, parts, cb, answer);
  if (parts[0] === 'f1' && parts.length === 3 && (parts[2] === 'y' || parts[2] === 'n')) return tgOnDraft(env, ev, parts[1], parts[2], cb, answer);
  answer('처리할 수 없는 버튼입니다'); return { status: 'handled', action: 'unknown-button' };
}
function tgOnResponse(env, ev, sid, choice, cb, answer) {
  const se = env.storeEnv();
  let sg = storeGet(se, 'signal', sid);
  if (!sg || sg.void) {                                  // R9: COIN RADAR 메시지의 'R9 v1' 줄에서 신호를 만든다(같은 sid의 메시지만, 이미 있으면 건드리지 않음)
    const parsed = r9ParseSignal(ev.msgText);
    if (parsed && parsed.sid === sid) {
      try { storeCreate(se, 'signal', parsed, { actor: 'tg:r9' }); } catch (e) { if (!(e instanceof StoreError)) throw e; if (e.code === 'LOCK') throw e; }
      sg = storeGet(se, 'signal', sid);
    }
  }
  if (!sg || sg.void) { answer('알 수 없는 신호입니다'); return { status: 'handled', action: 'unknown-signal' }; }
  const shown = ev.msgText && r9ParseSignal(ev.msgText) ? r9StripLine(ev.msgText) : tgSignalText(sg.data);
  const r = storeCreate(se, 'response', { sid, choice, at: env.now() }, { actor: 'tg' });
  if (r.status === 'conflict') { const cur = storeGet(se, 'response', sid); answer(`이미 '${RESPONSE_CHOICES[cur.data.choice]}'로 기록됨(수정은 앱에서)`); tgEdit(env, cb, shown + `\n→ ${RESPONSE_CHOICES[cur.data.choice]}`); return { status: 'handled', action: 'response-conflict' }; }
  const a = answer(`기록: ${RESPONSE_CHOICES[choice]}`), e = tgEdit(env, cb, `${shown}\n→ ${RESPONSE_CHOICES[choice]}`);
  let replyFailed = !tgOkOrBenign(a) || !tgOkOrBenign(e);
  if (choice === 'entered' && r.status === 'added') {
    const link = tgFillLink(env.uiUrl, sg.data), s = tgSend(env, ev.chatId, `진입 기록: /fill ${sid} 증거금 레버리지 ${sg.data.entry} ${sg.data.stop}${link ? '\n(숫자 입력은 아래 화면이 더 편합니다)' : ''}${tgPlanCard(env, sid)}`, link ? { inline_keyboard: [[{ text: '입력 화면 열기', url: link }]] } : undefined);
    replyFailed = replyFailed || !s.ok;
  }
  return { status: 'handled', action: r.status === 'added' ? 'response-saved' : 'response-duplicate', replyFailed };
}
function tgOnReview(env, ev, parts, cb, answer) {
  const sid = parts[1], st = parts[2], plan = st.slice(0, 2), mind = st.slice(2);
  if (!TG_SID_RE.test(sid) || st.length !== 4 || !TG_PLAN_CODES[plan] || !TG_MIND_CODES[mind]) { answer('처리할 수 없는 버튼입니다'); return { status: 'handled', action: 'unknown-button' }; }
  if (parts.length === 3) {                                   // 선택 변경: 화면만 바꾸고 아무것도 저장하지 않는다
    const e = tgEdit(env, cb, tgReviewText(sid, plan, mind), tgReviewKeyboard(sid, plan, mind)); answer();
    return { status: 'handled', action: 'review-select', replyFailed: !tgOkOrBenign(e) };
  }
  const se = env.storeEnv();
  if (!tgFillsOf(se, sid).length) { answer('체결 기록이 없어 복기할 수 없습니다'); return { status: 'handled', action: 'review-none' }; }
  const r = storeSaveReview(se, { sid, plan: TG_PLAN_CODES[plan], mind: TG_MIND_CODES[mind] }, { actor: 'tg' });
  const e = tgEdit(env, cb, `복기 저장됨 · ${sid}\n${PLAN_CHOICES[TG_PLAN_CODES[plan]]} · ${MIND_CHOICES[TG_MIND_CODES[mind]]}`); answer(r.status === 'unchanged' ? '이미 같은 내용으로 저장됨' : '저장했습니다');
  return { status: 'handled', action: `review-${r.status}`, replyFailed: !tgOkOrBenign(e) };
}
function tgOnDraft(env, ev, id, yn, cb, answer) {
  const d = tgKvGet(env, `d:${id}`);
  if (!d) { answer('만료됐거나 이미 처리됐습니다. 다시 입력해 주세요'); tgEdit(env, cb, '(만료됨)'); return { status: 'handled', action: 'draft-gone' }; }
  if (d.userId !== ev.fromId) { return { status: 'ignored', action: 'draft-other-user' }; }
  if (yn === 'n') { env.kv.del(`d:${id}`); answer('취소했습니다'); tgEdit(env, cb, '취소됨'); return { status: 'handled', action: 'draft-cancelled' }; }
  if (d.type === 'equity') return tgCommitEquity(env, ev, d, cb, answer);
  let r;
  try { r = tgCommitFill(env, { type: d.type, fill: d.fill, params: d.params, force: d.force === true, fillId: `${d.sid}:${id}` }, 'tg'); }
  catch (e) { if (e instanceof StoreError && (e.code === 'USER' || e.code === 'VALIDATION')) { env.kv.del(`d:${id}`); answer('저장하지 못했습니다'); tgEdit(env, cb, `⚠ ${String(e.message).slice(0, 200)}`); return { status: 'handled', action: 'fill-rejected' }; } throw e; }
  const a = answer(r.status === 'duplicate' ? '이미 저장됨' : '저장했습니다'), e = tgEdit(env, cb, `저장됨 ✓\n${d.fill.kind === 'close' ? '전량 청산' : d.fill.kind === 'reduce' ? '부분 청산' : d.fill.kind === 'add' ? '추가진입' : '진입'} ${d.fill.dir} · ${d.sid} · ${d.fill.price} × ${d.fill.qty}`);
  let replyFailed = !tgOkOrBenign(a) || !tgOkOrBenign(e);
  if (d.fill.kind === 'close') { const s = tgSendReviewPromptIfNeeded(env, ev.chatId, d.sid); replyFailed = replyFailed || !s.ok; }
  return { status: 'handled', action: r.status === 'duplicate' ? 'fill-duplicate' : 'fill-saved', replyFailed };
}

function tgCommitEquity(env, ev, d, cb, answer) {        // 확인(저장) 이후에만. 같은 값 재저장은 unchanged, 다른 값은 수정 이력으로 남는다.
  let r;
  try { r = closeSubmitEquity(env, { ...d.equity, reason: 'Telegram 입력' }, { actor: 'tg', now: env.now() }); }
  catch (e) { if (e instanceof StoreError && (e.code === 'VALIDATION' || e.code === 'NOT_FOUND')) { answer('저장하지 못했습니다'); tgEdit(env, cb, `⚠ ${String(e.message).slice(0, 160)}`); return { status: 'handled', action: 'equity-invalid' }; } throw e; }
  const warn = r.flags.map(f => CLOSE_WARNING_TEXT[f]).filter(Boolean).slice(0, 3), lines = [`${r.status === 'unchanged' ? '이미 같은 값' : '저장됨 ✓'} · ${r.day} 평가액 ${d.equity.equity} USDT${r.late ? ' (마감 후 입력)' : ''}`];
  if (r.diffLabel !== null) lines.push(`장부 기준 ${r.expectedLabel} · 차이 ${r.diffMicro && BigInt(r.diffMicro) > 0n ? '+' : ''}${r.diffLabel}`);
  if (warn.length) lines.push(`⚠ ${warn.join(' · ')}`);
  const a = answer(r.status === 'unchanged' ? '이미 저장됨' : '저장했습니다'), e = tgEdit(env, cb, lines.join('\n'));
  return { status: 'handled', action: `equity-${r.status}`, replyFailed: !tgOkOrBenign(a) || !tgOkOrBenign(e) };
}

// ── 한 건 처리 ──
export function tgHandleUpdate(env, update) {
  const ev = tgParseUpdate(update); if (!ev) return { status: 'ignored', action: 'unparsable' };
  if (ev.kind === 'message') { const c = tgParseCommand(ev.text); if (c && (c.cmd === 'pair' || (c.cmd === 'start' && c.pos.length > 0))) return tgPairAttempt(env, ev, c.pos[0]); }      // /pair 코드, 또는 t.me/<봇>?start=코드 링크
  const paired = tgPairedUser(env);
  if (!paired || ev.isBot || ev.fromId !== paired.userId || ev.chatType !== 'private' || (ev.chatId !== null && ev.chatId !== paired.chatId)) return { status: 'ignored', action: 'unpaired' };   // 무응답·무기록
  const se = env.storeEnv();
  if (storeGet(se, 'tgupdate', `u:${ev.updateId}`) || (ev.cbId && storeGet(se, 'tgupdate', `cb:${ev.cbId}`))) return { status: 'duplicate', action: 'already-processed' };
  let out;
  try { out = ev.kind === 'callback' ? (ev.chatId === null || ev.messageId === null ? { status: 'ignored', action: 'no-message' } : tgOnCallback(env, ev)) : tgOnMessage(env, ev); }
  catch (e) { if (e instanceof StoreError && e.code === 'LOCK') return { status: 'retry', action: 'lock' }; return { status: 'retry', action: 'error', errorType: e instanceof StoreError ? e.code : 'exception' }; }
  if (out.status === 'ignored') return out;
  try { storeClaimUpdate(se, 'u', ev.updateId, 'tg'); if (ev.cbId) storeClaimUpdate(se, 'cb', ev.cbId, 'tg'); }
  catch (e) { return { status: 'retry', action: e instanceof StoreError && e.code === 'LOCK' ? 'lock' : 'error', errorType: e instanceof StoreError ? e.code : 'exception' }; }   // 기록은 이미 저장됨: 재처리는 sid·fillId 유일키로 같은 결과(중복 없음)
  return out;
}

// ── 폴링(1분 트리거에서 호출) ──
export function tgPoll(env, { limit = 50, leaseMs = 55000 } = {}) {
  const lease = tgKvGet(env, 'poll'); if (lease && lease.until > env.now()) return { status: 'busy' };
  tgKvPut(env, 'poll', { until: env.now() + leaseMs });
  const stats = { status: 'ok', handled: 0, ignored: 0, duplicate: 0, retry: 0, poison: 0, replyFailed: 0, actions: {} };
  try {
    const off = Number(tgKvGet(env, 'offset') ?? 0), r = tgCall(env, 'getUpdates', { ...(off ? { offset: off } : {}), limit, timeout: 0, allowed_updates: ['message', 'callback_query'] });
    if (!r.ok) return { ...stats, status: 'error', code: r.code, retryable: r.retryable };
    const list = (Array.isArray(r.result) ? r.result : []).filter(u => Number.isSafeInteger(u?.update_id)).sort((a, b) => a.update_id - b.update_id);
    for (const u of list) {
      const x = tgHandleUpdate(env, u);
      if (u.message && Number.isFinite(u.message.date)) (stats.lags ||= []).push(Math.max(0, env.now() - u.message.date * 1000));      // 메시지 도착→처리 지연(ms, 관측용)
      if (x.status === 'retry') {
        const key = `fail:${u.update_id}`, n = (tgKvGet(env, key) ?? 0) + 1;
        if (n < TG_POISON_AFTER) { tgKvPut(env, key, n, 3600); stats.retry++; break; }          // 순서 보존: 이 update에서 멈추고 다음 틱에 재시도
        stats.poison++; env.kv.del(key);                                                        // 계속 실패하는 update는 건너뛴다
      } else { stats[x.status === 'handled' ? 'handled' : x.status === 'duplicate' ? 'duplicate' : 'ignored']++; if (x.action) stats.actions[x.action] = (stats.actions[x.action] ?? 0) + 1; }
      if (x.replyFailed) stats.replyFailed++;
      tgKvPut(env, 'offset', u.update_id + 1);
    }
    return stats;
  } finally { env.kv.del('poll'); }
}
// 정리: 만료된 초안·실패 카운터와 오래된 복기 표시를 지운다(Script Properties 용량 보호). env.kv.keys()가 없으면 아무것도 하지 않는다. 최대 1시간에 한 번.
export function tgGc(env) {
  if (typeof env.kv.keys !== 'function' || tgKvGet(env, 'gc')) return { ran: false };
  tgKvPut(env, 'gc', 1, 3600); let removed = 0;
  for (const k of env.kv.keys()) {
    if (k.startsWith('d:') || k.startsWith('fail:')) { if (tgKvGet(env, k) === null) removed++; }
    else if (k.startsWith('rp:')) { const at = Number(env.kv.get(k)); if (!Number.isFinite(at) || env.now() - at > 30 * 86400000) { env.kv.del(k); removed++; } }
  }
  return { ran: true, removed };
}
