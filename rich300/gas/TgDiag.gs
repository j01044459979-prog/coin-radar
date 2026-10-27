/**
 * RICH 300 — Telegram 연결 진단과 *1회* 테스트 메시지(?p=tg). 소유자 전용. 토큰·채팅 ID·봇 이름은 화면·로그·반환값 어디에도 쓰지 않는다(존재 여부와 코드만).
 *  · 진단(기본 방문)은 속성·가드·트리거·마지막 폴링 기록만 읽는다 — 네트워크 호출 없음. &check=1 은 읽기 점검(getMe·getWebhookInfo, 메시지 없음)이며 기존 가드(읽기 승인 또는 운영 승인)를 따른다.
 *  · 테스트 메시지: 화면의 버튼 → 서버 함수 rich300TgTestSend(nonce). 중복 방지 장치: ① 화면을 열 때마다 만든 1회용 nonce(10분, 사용 즉시 폐기) ② 스크립트 락 ③ 보내기 *전에* 'pending' 기록 — 결과가 기록되지 않은 채 끝났다면 자동 재전송하지 않고 사용자 확인을 기다림 ④ 'sent'/'pending'/'acked' 상태에서는 거부.
 *    '못 받음'을 누르거나 API 실패일 때만 다시 시도할 수 있다(최대 3회). API 전송 성공('sent')과 사용자의 수신 확인('acked')은 따로 기록한다.
 *  · 전송은 기존 가드(rich300TgGate_)를 따른다. 운영 승인(RICH300_PROD_APPROVED)과 *별개*인 좁은 허용 RICH300_TG_TEST_OK=yes 는 getMe·getWebhookInfo, 이 파일의 '페어링 확인'(getUpdates 1회, 답장 없음)과 '테스트 메시지'(sendMessage 1건)만 통과시킨다 — 호출 목적은 화면의 명시적 동작 동안에만 설정된다(RICH300_GATE_PURPOSE_). 감시·폴링·추천 알림은 운영 승인 전까지 계속 차단된다.
 *  · 토큰 등록: 소유자 전용 입력창 → 서버로만 전달 → Script Properties 저장(화면·로그·반환값에 되돌려 주지 않음). 이미 토큰이 있으면 거부(교체는 편집기에서).
 */
var RICH300_TGTEST_KEY_ = 'tgdiag:test', RICH300_TGNONCE_KEY_ = 'tgdiag:nonce';
function rich300TgTestRead_() { try { var r = PropertiesService.getScriptProperties().getProperty(RICH300_TGTEST_KEY_); return r ? JSON.parse(r) : null; } catch (err) { return null; } }
function rich300TgTestWrite_(o) { PropertiesService.getScriptProperties().setProperty(RICH300_TGTEST_KEY_, JSON.stringify(o)); }
function rich300WithPurpose_(purpose, fn) { var prev = RICH300_GATE_PURPOSE_; RICH300_GATE_PURPOSE_ = purpose; try { return fn(); } finally { RICH300_GATE_PURPOSE_ = prev; } }
function rich300TgGateFor_(method, purpose) { return rich300WithPurpose_(purpose || '', function () { try { return typeof rich300TgGate_ === 'function' ? (rich300TgGate_(method) || null) : 'guard-missing'; } catch (err) { return 'error'; } }); }
function rich300TgDiagState_() {
  var props = PropertiesService.getScriptProperties(), paired = false, lastPoll = null, pairingActive = false;
  try { paired = !!RICH300_ENGINE.tgPairedUser(rich300TgEnv_()); } catch (err) { paired = false; }
  try { pairingActive = !paired && rich300TgEnv_().kv.get('pair') !== null; } catch (err) { pairingActive = false; }
  try { var l = JSON.parse(props.getProperty('tg:last') || 'null'); if (l) lastPoll = { ageMin: Math.round((Date.now() - l.at) / 60000), status: l.r && l.r.status }; } catch (err) { lastPoll = null; }
  var t = rich300TgTestRead_(), tl = null; try { var r = JSON.parse(props.getProperty('tgdiag:tokenlast') || 'null'); if (r) tl = { ageMin: Math.round((Date.now() - r.at) / 60000), code: r.code, d: r.d }; } catch (err) { tl = null; }
  return { env: props.getProperty('RICH300_ENV') || null, tokenLast: tl, tokenSet: !!props.getProperty('RICH300_TG_TOKEN'), prodApproved: props.getProperty('RICH300_PROD_APPROVED') === 'yes', testAllow: props.getProperty('RICH300_TG_TEST_OK') === 'yes',
    gateSend: rich300TgGateFor_('sendMessage', ''), gateTestSend: rich300TgGateFor_('sendMessage', 'test-send'), gateRead: rich300TgGateFor_('getMe', ''), gatePair: rich300TgGateFor_('getUpdates', 'pair-poll'), paired: paired, pairingActive: pairingActive,
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
  if (!d.gateTestSend && d.paired && d.tokenSet && (!d.test || d.test.state === 'failed' || d.test.state === 'unacked')) { nonce = Utilities.getUuid().replace(/-/g, ''); PropertiesService.getScriptProperties().setProperty(RICH300_TGNONCE_KEY_, JSON.stringify({ n: nonce, at: Date.now() })); }
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
    var gate = rich300TgGateFor_('sendMessage', 'test-send'); if (gate) return { ok: false, code: 'blocked:' + gate };
    if (!props.getProperty('RICH300_TG_TOKEN')) return { ok: false, code: 'no-token' };
    var env = rich300TgEnv_(), paired = RICH300_ENGINE.tgPairedUser(env); if (!paired) return { ok: false, code: 'not-paired' };
    var tries = (t && t.tries || 0) + 1; rich300TgTestWrite_({ state: 'pending', at: Date.now(), tries: tries });          // 보내기 전에 기록
    var kst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
    var r = rich300WithPurpose_('test-send', function () { return RICH300_ENGINE.tgSendNotice(env, paired.chatId, '[RICH300 TEST]\n전송 점검 메시지 1건 · ' + kst + ' KST\nRICH300(Apps Script) 경로 확인용입니다. 추천·매매 알림이 아닙니다.\n이 메시지가 보이면 점검 화면에서 "받았음"을 눌러 주세요.'); });      // 목적(test-send)이 설정된 동안의 이 호출 하나만 테스트 허용 가드를 통과한다
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

/**
 * 토큰 등록(소유자 전용, 토큰이 없을 때만). 값은 반환·로그·화면에 쓰지 않는다.
 *  · 붙여 넣은 글에서 `숫자:영문숫자_-` 형태의 토큰만 뽑아 쓴다(앞뒤 설명 문구·따옴표·"bot" 접두·보이지 않는 문자·줄바꿈이 있어도 됨).
 *  · 저장 자체는 어떤 가드(운영 승인·테스트 허용)에도 막히지 않는다. 가드는 저장 *후* getMe 확인 호출만 막는다.
 *  · 저장 후 다시 읽어 길이를 비교하고, 모든 시도의 결과 코드와 입력의 *구조 정보*(길이·콜론 유무·자릿수 — 값 아님)를 tgdiag:tokenlast 에 남겨 화면에 보여 준다.
 *  · 실패 코드: forbidden(소유자 아님) · busy/lock-error · already-set · bad-format(+detail) · storage-error · storage-verify-failed · token-rejected(getMe 거절 → 저장 취소)
 */
function rich300TgTokenShape_(raw) {
  var text = String(raw === null || raw === undefined ? '' : raw).replace(/[\u200B-\u200D\u2060\uFEFF\u00A0]/g, ' '), m = /(?:^|[^A-Za-z0-9_:-])(?:bot)?(\d{6,12}):([A-Za-z0-9_-]{30,80})(?![A-Za-z0-9_:-])/.exec(text), i = text.indexOf(':'), before = i >= 0 ? /(\d*)\s*$/.exec(text.slice(0, i))[1].length : 0, after = i >= 0 ? (/^\s*([A-Za-z0-9_-]*)/.exec(text.slice(i + 1))[1] || '').length : 0;
  return { token: m ? m[1] + ':' + m[2] : null, detail: { len: text.length, hasColon: i >= 0, idDigits: before, secretLen: after } };
}
function rich300TgTokenLog_(code, detail) { try { PropertiesService.getScriptProperties().setProperty('tgdiag:tokenlast', JSON.stringify({ at: Date.now(), code: code, d: detail || null })); } catch (err) { /* 기록 실패는 무시 */ } }
function rich300TgSetToken(token) {
  var out = function (ok, code, detail) { rich300TgTokenLog_(code, detail); return { ok: ok, code: code, detail: detail || null }; };
  if (!rich300IsOwner_()) return { ok: false, code: 'forbidden', detail: null };
  var props = PropertiesService.getScriptProperties(), lock, got = false;
  try { lock = LockService.getScriptLock(); got = lock.tryLock(5000); } catch (err) { return out(false, 'lock-error'); }
  if (!got) return out(false, 'busy');
  try {
    var sh = rich300TgTokenShape_(token), t = sh.token;
    if (props.getProperty('RICH300_TG_TOKEN')) return out(false, 'already-set');
    if (!t) return out(false, 'bad-format', sh.detail);
    try { props.setProperty('RICH300_TG_TOKEN', t); if (String(props.getProperty('RICH300_TG_TOKEN') || '').length !== t.length) { props.deleteProperty('RICH300_TG_TOKEN'); return out(false, 'storage-verify-failed'); } } catch (err) { return out(false, 'storage-error'); }
    t = null;
    if (rich300TgGateFor_('getMe', '')) return out(true, 'saved-unverified');       // 가드가 getMe 를 막고 있으면 저장만(허용 후 읽기 점검에서 확인)
    var me = RICH300_ENGINE.tgCall(rich300TgEnv_(), 'getMe', {});
    if (!me.ok && me.code === 'auth') { props.deleteProperty('RICH300_TG_TOKEN'); return out(false, 'token-rejected'); }
    return out(true, me.ok ? 'saved-verified' : 'saved-unverified');
  } catch (err) { return out(false, 'exception'); }
  finally { try { lock.releaseLock(); } catch (err) { /* 이미 풀림 */ } }
}
/** 테스트 전송 허용 켜기/끄기(RICH300_TG_TEST_OK). 운영 승인(RICH300_PROD_APPROVED)은 이 화면에서 절대 바꾸지 않는다. 켤 때는 확인 문구가 필요하다. */
function rich300TgSetTestAllow(on, phrase) {
  if (!rich300IsOwner_()) return { ok: false, code: 'forbidden' };
  var props = PropertiesService.getScriptProperties();
  if (!on) { props.deleteProperty('RICH300_TG_TEST_OK'); return { ok: true, code: 'off' }; }
  if (!props.getProperty('RICH300_TG_TOKEN')) return { ok: false, code: 'no-token' };
  if (String(phrase || '').trim() !== '테스트 전송 허용') return { ok: false, code: 'bad-phrase' };
  props.setProperty('RICH300_TG_TEST_OK', 'yes'); return { ok: true, code: 'on' };
}
/** 페어링 코드 만들기(10분·1회용, 해시만 저장). 텔레그램 호출 없음. */
function rich300TgPairStart() {
  if (!rich300IsOwner_()) return { ok: false, code: 'forbidden' };
  var props = PropertiesService.getScriptProperties(); if (!props.getProperty('RICH300_TG_TOKEN')) return { ok: false, code: 'no-token' }; if (props.getProperty('RICH300_TG_TEST_OK') !== 'yes' && props.getProperty('RICH300_PROD_APPROVED') !== 'yes') return { ok: false, code: 'not-allowed' };
  var env = rich300TgEnv_(); if (RICH300_ENGINE.tgPairedUser(env)) return { ok: false, code: 'already-paired' };
  var r = RICH300_ENGINE.tgPairCreate(env); return { ok: true, code: 'created', pairCode: r.code, expiresAt: r.expiresAt };
}
/** 페어링 확인: getUpdates 를 *한 번* 읽어 `/start 코드` 를 찾는다(목적 pair-poll). 답장·다른 업데이트 처리 없음. */
function rich300TgPairCheck() {
  if (!rich300IsOwner_()) return { ok: false, code: 'forbidden' };
  var lk = typeof LockService.getUserLock === 'function' ? LockService.getUserLock() : null; if (lk && !lk.tryLock(3000)) return { ok: false, code: 'busy' };
  try {
    var gate = rich300TgGateFor_('getUpdates', 'pair-poll'); if (gate) return { ok: false, code: 'blocked:' + gate };
    var x = rich300WithPurpose_('pair-poll', function () { return RICH300_ENGINE.tgPairPoll(rich300TgEnv_()); });
    return x.status === 'error' ? { ok: false, code: String(x.code || 'error') } : { ok: true, code: x.status };
  } catch (err) { return { ok: false, code: 'exception' }; }
  finally { if (lk) lk.releaseLock(); }
}
