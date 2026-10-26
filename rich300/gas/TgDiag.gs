/**
 * RICH 300 — Telegram 연결 진단과 *1회* 테스트 메시지(?p=tg). 소유자 전용. 토큰·채팅 ID·봇 이름은 화면·로그·반환값 어디에도 쓰지 않는다(존재 여부와 코드만).
 *  · 진단(기본 방문)은 속성·가드·트리거·마지막 폴링 기록만 읽는다 — 네트워크 호출 없음. &check=1 은 읽기 점검(getMe·getWebhookInfo, 메시지 없음)이며 기존 가드(읽기 승인 또는 운영 승인)를 따른다.
 *  · 테스트 메시지: 화면의 버튼 → 서버 함수 rich300TgTestSend(nonce). 중복 방지 장치: ① 화면을 열 때마다 만든 1회용 nonce(10분, 사용 즉시 폐기) ② 스크립트 락 ③ 보내기 *전에* 'pending' 기록 — 결과가 기록되지 않은 채 끝났다면 자동 재전송하지 않고 사용자 확인을 기다림 ④ 'sent'/'pending'/'acked' 상태에서는 거부.
 *    '못 받음'을 누르거나 API 실패일 때만 다시 시도할 수 있다(최대 3회). API 전송 성공('sent')과 사용자의 수신 확인('acked')은 따로 기록한다.
 *  · 전송은 기존 가드(rich300TgGate_)를 그대로 따른다: 운영 승인 전에는 어떤 메시지도 나가지 않는다.
 */
var RICH300_TGTEST_KEY_ = 'tgdiag:test', RICH300_TGNONCE_KEY_ = 'tgdiag:nonce';
function rich300TgTestRead_() { try { var r = PropertiesService.getScriptProperties().getProperty(RICH300_TGTEST_KEY_); return r ? JSON.parse(r) : null; } catch (err) { return null; } }
function rich300TgTestWrite_(o) { PropertiesService.getScriptProperties().setProperty(RICH300_TGTEST_KEY_, JSON.stringify(o)); }
function rich300TgDiagState_() {
  var props = PropertiesService.getScriptProperties(), gate = function (m) { try { return typeof rich300TgGate_ === 'function' ? (rich300TgGate_(m) || null) : 'guard-missing'; } catch (err) { return 'error'; } }, paired = false, lastPoll = null;
  try { paired = !!RICH300_ENGINE.tgPairedUser(rich300TgEnv_()); } catch (err) { paired = false; }
  try { var l = JSON.parse(props.getProperty('tg:last') || 'null'); if (l) lastPoll = { ageMin: Math.round((Date.now() - l.at) / 60000), status: l.r && l.r.status }; } catch (err) { lastPoll = null; }
  var t = rich300TgTestRead_();
  return { env: props.getProperty('RICH300_ENV') || null, tokenSet: !!props.getProperty('RICH300_TG_TOKEN'), gateSend: gate('sendMessage'), gateRead: gate('getMe'), paired: paired,
    pollTriggers: ScriptApp.getProjectTriggers().filter(function (x) { return x.getHandlerFunction() === 'rich300TgPoll'; }).length, lastPoll: lastPoll, test: t ? { state: t.state, code: t.code || null, at: t.at, tries: t.tries || 0 } : null };
}
function rich300PageTg_(e) {
  var p = (e && e.parameter) || {}, d = rich300TgDiagState_(), check = null, nonce = null;
  if (p.check === '1') {      // 읽기 점검: 가드가 허용할 때만, getMe·getWebhookInfo 두 호출(메시지 없음). 결과는 ok/코드/웹훅 유무만.
    var items = [];
    if (d.gateRead) items.push('막힘(' + d.gateRead + ') — 호출하지 않았습니다'); else if (!d.tokenSet) items.push('봇 토큰 속성이 없어 호출하지 않았습니다');
    else { var env = rich300TgEnv_(), me = RICH300_ENGINE.tgCall(env, 'getMe', {}), wh = RICH300_ENGINE.tgCall(env, 'getWebhookInfo', {}), r = wh.result || {};
      items.push('getMe: ' + (me.ok ? '성공' : '실패(' + me.code + ')')); items.push('getWebhookInfo: ' + (wh.ok ? '성공' : '실패(' + wh.code + ')')); if (wh.ok) { items.push('웹훅 설정: ' + (r.url ? '있음 — 폴링과 충돌합니다(설정을 바꾸지 않았습니다)' : '없음(정상)')); items.push('대기 중 업데이트: ' + Number(r.pending_update_count || 0) + '건'); } }
    check = { items: items };
  }
  if (!d.gateSend && d.paired && (!d.test || d.test.state === 'failed' || d.test.state === 'unacked')) { nonce = Utilities.getUuid().replace(/-/g, ''); PropertiesService.getScriptProperties().setProperty(RICH300_TGNONCE_KEY_, JSON.stringify({ n: nonce, at: Date.now() })); }
  return rich300Html_(RICH300_ENGINE.shellRenderTgDiag({ d: d, check: check, nonce: nonce, appUrl: rich300AppUrl_(), build: RICH300_BUILD }), 'RICH300 텔레그램 점검');
}
/** google.script.run 대상(소유자 전용). 반환: { ok, code } — 값 없음. 어떤 경우에도 자동 재전송하지 않는다. */
function rich300TgTestSend(nonce) {
  if (!rich300IsOwner_()) return { ok: false, code: 'forbidden' };
  var lock = LockService.getScriptLock(), props = PropertiesService.getScriptProperties();
  if (!lock.tryLock(5000)) return { ok: false, code: 'busy' };
  try {
    var n = null; try { n = JSON.parse(props.getProperty(RICH300_TGNONCE_KEY_) || 'null'); } catch (err) { n = null; }
    props.deleteProperty(RICH300_TGNONCE_KEY_);                                          // 1회용: 맞든 틀리든 즉시 폐기
    if (!n || !nonce || n.n !== String(nonce) || Date.now() - n.at > 600000) return { ok: false, code: 'bad-nonce' };
    var t = rich300TgTestRead_();
    if (t && (t.state === 'sent' || t.state === 'pending' || t.state === 'acked')) return { ok: false, code: 'already-' + t.state };
    if (t && (t.tries || 0) >= 3) return { ok: false, code: 'max-tries' };
    if (t && t.state === 'failed' && Date.now() - t.at < 60000) return { ok: false, code: 'cooldown' };
    var gate = typeof rich300TgGate_ === 'function' ? rich300TgGate_('sendMessage') : 'guard-missing'; if (gate) return { ok: false, code: 'blocked:' + gate };
    var env = rich300TgEnv_(), paired = RICH300_ENGINE.tgPairedUser(env); if (!paired) return { ok: false, code: 'not-paired' };
    var tries = (t && t.tries || 0) + 1; rich300TgTestWrite_({ state: 'pending', at: Date.now(), tries: tries });          // 보내기 전에 기록
    var kst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
    var r = RICH300_ENGINE.tgSendNotice(env, paired.chatId, '[RICH300 TEST]\n전송 점검 메시지 1건 · ' + kst + ' KST\nRICH300(Apps Script) 경로 확인용입니다. 추천·매매 알림이 아닙니다.\n이 메시지가 보이면 점검 화면에서 "받았음"을 눌러 주세요.');
    if (r && r.ok) { rich300TgTestWrite_({ state: 'sent', at: Date.now(), tries: tries }); return { ok: true, code: 'sent' }; }
    rich300TgTestWrite_({ state: 'failed', at: Date.now(), tries: tries, code: String(r && r.code || 'error').slice(0, 24) }); return { ok: false, code: String(r && r.code || 'error') };
  } catch (err) { return { ok: false, code: 'exception' }; }
  finally { lock.releaseLock(); }
}
function rich300TgTestAck(received) {
  if (!rich300IsOwner_()) return { ok: false, code: 'forbidden' };
  var t = rich300TgTestRead_(); if (!t || (t.state !== 'sent' && t.state !== 'pending')) return { ok: false, code: 'nothing-to-ack' };
  rich300TgTestWrite_({ state: received ? 'acked' : 'unacked', at: Date.now(), tries: t.tries || 1 }); return { ok: true, code: received ? 'acked' : 'unacked' };
}
