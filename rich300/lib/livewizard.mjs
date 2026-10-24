// 휴대폰 안내형 시험 마법사(테스트 환경 전용): 사용자는 [TEST] 메시지의 버튼만 따라 누르면 되고, 판정은 시트 기록과 처리 동작 카운터로 자동으로 한다.
//  · 모든 메시지는 tg 어댑터가 '[TEST] ' 접두사를 붙인다. 시험 신호는 sid 'LT-…'(가짜 신호, 실제 시장과 무관), 시험 값은 고정(증거금 30·레버리지 10·진입 100·손절 98).
//  · 상태는 env.kv 의 'live' 한 키(JSON). 폴링 한 번이 끝날 때마다 liveWizardTick 이 호출되며, 처리된 update 가 있을 때만(또는 10분마다) 시트를 읽어 단계 완료를 판정한다.
//  · 마법사 버튼(lv:…)은 실제 명령(/fill·/exit·/equity)과 *같은 빌더·같은 저장 확인 경로*를 쓴다. 타자 입력 파싱은 오프라인 시험으로 검증되어 있다.
import { StoreError } from './schema.mjs';
import { storeCreate, storeGet, storeList, storeLoadLedgerInputs, storeSetupChallenge } from './store.mjs';
import { closeStatus, closeCheckEquityDay, closeRun } from './close.mjs';
import { addDays, kstDayOf } from './time.mjs';
import { tgPairedUser, tgBuildEntry, tgBuildExit, tgConfirmDraft, tgSendMessage, tgSendSignalPrompt } from './tg.mjs';

export const LIVE_STEPS = Object.freeze(['signal', 'fill', 'fill-again', 'exit1', 'exit-web', 'review', 'equity', 'journal-edit', 'cashflow', 'expiry']);
const LIVE_REMIND_MS = 30 * 60000, LIVE_RECHECK_MS = 10 * 60000, LIVE_WEB_RECHECK_MS = 2 * 60000, LIVE_EXPIRY_WAIT_MS = 11 * 60000;
const LIVE_WEB_STEPS = ['exit-web', 'journal-edit', 'cashflow'];            // 웹 화면 조작은 폴링이 처리하는 update 가 없으므로 더 자주 확인
export const liveGet = env => { const r = env.kv.get('live'); if (r === null || r === undefined) return null; try { return JSON.parse(r); } catch { return null; } };
export const liveSet = (env, st) => env.kv.put('live', JSON.stringify(st));
const LIVE_A = { actor: 'live' };

export function liveInit(env, { bot, intervalMin, now = env.now() }) {
  const st = { v: 1, phase: 'unpaired', step: -1, startedAt: now, bot, intervalMin, sid: `LT-${now.toString(36)}`, sid2: `LT-${(now + 1).toString(36)}x`, act: {}, base: {}, done: {}, lags: [], remind: 0, msgAt: 0, stepAt: 0, notify: false };
  liveSet(env, st); liveEnsureChallenge(env, now); return st;
}
// 테스트 시트에 시험용 챌린지(시작 300 USDT·일일 5%)를 만들고 지난 이틀을 마감해 둔다(알림은 꺼진 상태 → 'off' 기록, 소급 발송 없음).
function liveEnsureChallenge(env, now) {
  const se = env.storeEnv(); try { storeLoadLedgerInputs(se); return; } catch (e) { if (!(e instanceof StoreError && e.code === 'NOT_FOUND')) throw e; }
  storeSetupChallenge(se, { startEquity: '300', startDay: addDays(kstDayOf(now), -2), rate: '0.05' }, LIVE_A); closeRun({ now: () => now, storeEnv: () => se }, { now });
}
const liveKst = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
function seedSignals(env, st) {
  const se = env.storeEnv(), now = env.now();
  for (const [sid, sym] of [[st.sid, 'BTCUSDT'], [st.sid2, 'ETHUSDT']]) storeCreate(se, 'signal', { sid, strategy: 'A', symbolId: sym, dir: 'LONG', signalAt: now, entry: '100', stop: '98', tp1: '103' }, LIVE_A);
}
const liveFillsOf = (env, sid) => storeList(env.storeEnv(), 'fill').map(r => r.data).filter(f => f.sid === sid);
const liveDelta = (st, name) => (st.act[name] ?? 0) - (st.base[name] ?? 0);
const liveWeb = (env, path) => (typeof env.uiUrl === 'string' && /^https:\/\/\S+$/.test(env.uiUrl) ? `${env.uiUrl}${env.uiUrl.includes('?') ? '&' : '?'}${path}` : null);
const liveKb = (...rows) => ({ inline_keyboard: rows });
const liveSend = (env, st, text, markup) => { const r = tgSendMessage(env, tgPairedUser(env).chatId, text, markup); st.msgAt = env.now(); return r; };

// 단계별 정의: liveSend(안내 발송), done(완료 판정)
const LIVE_DEF = {
  'signal': { send: (env, st) => { const r = tgSendSignalPrompt(env, tgPairedUser(env).chatId, st.sid); st.msgAt = env.now(); liveSend(env, st, '1/10 위 신호 알림의 [진입했어]를 두 번 연속 눌러 보세요(중복 기록이 생기지 않아야 합니다).'); return r; },
    done: (env, st) => { const r = storeGet(env.storeEnv(), 'response', st.sid); return !!r && !r.void && r.data.choice === 'entered'; } },
  'fill': { send: (env, st) => liveSend(env, st, '2/10 [진입 기록 만들기]를 누르고, 나오는 확인 메시지에서 [저장]을 누르세요.', liveKb([{ text: '진입 기록 만들기', callback_data: `lv:fill:${st.sid}` }])), done: (env, st) => liveFillsOf(env, st.sid).some(f => f.kind === 'entry') },
  'fill-again': { send: (env, st) => liveSend(env, st, '3/10 같은 입력을 한 번 더 만듭니다. [같은 입력 다시 만들기] → [저장]을 눌러 보세요. "저장하지 못했습니다"가 나오면 정상입니다.', liveKb([{ text: '같은 입력 다시 만들기', callback_data: `lv:fill2:${st.sid}` }])),
    done: (env, st) => liveDelta(st, 'fill-rejected') >= 1 && liveFillsOf(env, st.sid).filter(f => f.kind === 'entry' || f.kind === 'add').length === 1 },
  'exit1': { send: (env, st) => liveSend(env, st, '4/10 [부분 청산 만들기] → [저장].', liveKb([{ text: '부분 청산 만들기', callback_data: `lv:exit1:${st.sid}` }])), done: (env, st) => liveFillsOf(env, st.sid).some(f => f.kind === 'reduce') },
  'exit-web': { send: (env, st) => { const u = liveWeb(env, `p=fill&sid=${encodeURIComponent(st.sid)}`); return liveSend(env, st, `5/10 ${u ? '웹 입력 화면에서 [청산] 탭 → 청산가 101 → 저장(저장 버튼을 두 번 눌러 보세요). 웹이 열리지 않으면 아래 [전량 청산 만들기]를 쓰세요.' : '웹 화면 주소가 없어 [전량 청산 만들기]로 진행합니다(웹 시험은 미검증으로 기록).'}`, liveKb(...(u ? [[{ text: '웹 입력 화면 열기', url: u }]] : []), [{ text: '전량 청산 만들기', callback_data: `lv:exit2:${st.sid}` }])); },
    done: (env, st) => liveFillsOf(env, st.sid).some(f => f.kind === 'close') },
  'review': { send: (env, st) => liveSend(env, st, '6/10 전량 청산 직후 온 [복기] 메시지에서 [저장]을 눌러 주세요(기본값 그대로 저장하면 됩니다).'), done: (env, st) => { const r = storeGet(env.storeEnv(), 'review', st.sid); return !!r && !r.void; } },
  'equity': { send: (env, st) => liveSend(env, st, '7/10 [평가액 입력 만들기] → [저장].', liveKb([{ text: '평가액 입력 만들기', callback_data: `lv:equity:${st.sid}` }])), done: (env, st) => storeList(env.storeEnv(), 'equity').length >= 1,
    after: (env, st) => { if (typeof env.enableTestNotify === 'function') { env.enableTestNotify(); st.notify = true; } } },
  'journal-edit': { send: (env, st) => { const u = liveWeb(env, 'p=journal'); return liveSend(env, st, u ? '8/10 웹 일지에서 이 시험 거래를 펼쳐 체결 하나의 [수정 / 취소]에서 가격을 바꾸고 사유 "시험"을 입력해 [수정 저장]을 누르세요.' : '8/10 웹 화면 주소가 없어 이 단계는 미검증으로 건너뜁니다.', u ? liveKb([{ text: '웹 일지 열기', url: u }]) : undefined); },
    done: (env, st) => (liveWeb(env, 'x') === null ? true : liveFillsOf(env, st.sid).some(f => (storeGet(env.storeEnv(), 'fill', f.fillId)?.rev ?? 1) >= 2)), skip: env => liveWeb(env, 'x') === null },
  'cashflow': { send: (env, st) => { const u = liveWeb(env, 'p=journal'); return liveSend(env, st, u ? '9/10 웹 일지의 [입출금 기록]에 금액 1, 메모 "시험"을 저장하세요.' : '9/10 웹 화면 주소가 없어 이 단계는 미검증으로 건너뜁니다.', u ? liveKb([{ text: '웹 일지 열기', url: u }]) : undefined); },
    done: (env, st) => (liveWeb(env, 'x') === null ? true : storeList(env.storeEnv(), 'cashflow').some(r => r.data.cfId.startsWith('cf-'))), skip: env => liveWeb(env, 'x') === null },
  'expiry': { send: (env, st) => { liveSend(env, st, '10/10 바로 아래 확인 메시지는 **지금 누르지 말고 11분 뒤에** [저장]을 눌러 보세요("만료됐거나 이미 처리됐습니다"가 나오면 정상).'); try { const ch = tgPairedUser(env); tgConfirmDraft(env, { chatId: ch.chatId, fromId: ch.userId }, tgBuildEntry(env, { sid: st.sid2, margin: '10', leverage: '10', entry: '100', stop: '98' })); } catch (e) { liveSend(env, st, `(만료 시험 초안을 만들지 못했습니다: ${String(e.message).slice(0, 60)})`); } st.expirySentAt = env.now(); },
    done: (env, st) => liveDelta(st, 'draft-gone') >= 1 },
};

// 마법사 버튼(lv:액션:sid): 실제 명령과 같은 빌더 + 같은 확인(저장) 경로
export function liveOnCallback(env, ev, parts, cb, answer) {
  const st = liveGet(env), act = parts[1], user = { chatId: ev.chatId, fromId: ev.fromId };
  if (!st || st.phase === 'halted') { answer('시험이 종료되었습니다'); return { status: 'handled', action: 'live-closed' }; }
  try {
    if (act === 'fill' || act === 'fill2') tgConfirmDraft(env, user, tgBuildEntry(env, { sid: st.sid, margin: '30', leverage: '10', entry: '100', stop: '98' }));
    else if (act === 'exit1') tgConfirmDraft(env, user, tgBuildExit(env, { sid: st.sid, price: '103', qty: '1' }));
    else if (act === 'exit2') tgConfirmDraft(env, user, tgBuildExit(env, { sid: st.sid, price: '101' }));
    else if (act === 'equity') {
      const m = closeStatus(env, { now: env.now(), days: 14 }).find(d => d.closed && d.equity === null), day = m ? m.day : new Date(env.now() + 9 * 3600000).toISOString().slice(0, 10);
      closeCheckEquityDay(env, day, env.now()); tgConfirmDraft(env, user, { type: 'equity', equity: { day, equity: '305' }, summary: `평가액 입력 · ${day}\n실제 계좌 평가액 305 USDT\n(시험용 값입니다)` });
    } else { answer('알 수 없는 시험 버튼입니다'); return { status: 'handled', action: 'live-unknown' }; }
  } catch (e) { if (e instanceof StoreError) { answer(String(e.message).slice(0, 150)); return { status: 'handled', action: `live-${act}-refused` }; } throw e; }
  answer('확인 메시지를 보냈습니다'); return { status: 'handled', action: `live-${act}-draft` };
}

// 폴링 한 번이 끝날 때마다 호출: 카운터 누적, 페어링 감지, 단계 판정·안내
export function liveWizardTick(env, pollOut = {}) {
  const st = liveGet(env); if (!st || st.phase === 'halted' || st.phase === 'done') return st;
  for (const [k, n] of Object.entries(pollOut.actions ?? {})) st.act[k] = (st.act[k] ?? 0) + n;
  for (const g of pollOut.lags ?? []) { st.lags.push(g); if (st.lags.length > 50) st.lags.shift(); }
  const now = env.now(), paired = tgPairedUser(env); let changed = Object.keys(pollOut.actions ?? {}).length > 0 || (pollOut.lags ?? []).length > 0;
  if (st.phase === 'unpaired') {
    if (paired) { seedSignals(env, st); st.phase = 'wizard'; st.step = 0; st.pairedAt = now; st.base = { ...st.act }; st.stepAt = now; liveSend(env, st, '시험을 시작합니다. 아래 안내를 순서대로 따라 주세요(약 15분). 모든 메시지는 시험용입니다.'); LIVE_DEF[LIVE_STEPS[0]].send(env, st); changed = true; }
  } else if (st.phase === 'wizard') {
    const id = LIVE_STEPS[st.step], def = LIVE_DEF[id], due = (pollOut.handled ?? 0) > 0 || now - (st.checkedAt ?? 0) >= (LIVE_WEB_STEPS.includes(id) ? LIVE_WEB_RECHECK_MS : LIVE_RECHECK_MS);
    if (due) {
      st.checkedAt = now; let ok = false; try { ok = def.done(env, st); } catch { ok = false; }
      if (ok) {
        st.done[id] = now; if (def.skip && def.skip(env)) st.done[id] = -now; if (def.after) def.after(env, st);
        if (st.step + 1 < LIVE_STEPS.length) { st.step++; st.base = { ...st.act }; st.stepAt = now; st.remind = 0; LIVE_DEF[LIVE_STEPS[st.step]].send(env, st); } else { st.phase = 'done'; st.finishedAt = now; liveSend(env, st, '모든 시나리오를 마쳤습니다. 24시간 관찰이 끝나면 최종 결과 요약이 자동으로 도착합니다(자정 마감 알림 1회가 올 수 있습니다).'); }
        changed = true;
      } else if (now - st.msgAt >= LIVE_REMIND_MS && st.remind < 3) { st.remind++; liveSend(env, st, `(알림 ${st.remind}/3) ${st.step + 1}/10 단계가 아직 끝나지 않았습니다. 위 안내의 버튼을 눌러 주세요.${id === 'expiry' && st.expirySentAt && now - st.expirySentAt < LIVE_EXPIRY_WAIT_MS ? ' (만료 시험은 11분 뒤에)' : ''}`); changed = true; }
    }
  }
  if (changed) liveSet(env, st); return st;
}
