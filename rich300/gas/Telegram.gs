/**
 * RICH 300 — Telegram 어댑터(R4). 엔진 번들 + Adapters.gs 와 같은 프로젝트에 둔다. 운영 배포·실제 Telegram 연결은 승인 이후.
 *  · 봇 토큰: Script Properties(RICH300_TG_TOKEN)에서만 읽고, 요청 URL을 만드는 http.call 안에서만 쓴다. 엔진(tg.mjs)은 토큰을 보지 못한다. 오류 메시지(URL 포함 가능)는 버리고 상태 코드만 돌려준다.
 *  · 폴링: 1분 시간 트리거로 rich300TgPoll 을 설치한다(rich300TgInstallPollTrigger). 웹훅은 쓰지 않는다(S0: POST 302·헤더 불가).
 *  · 상태 저장소(kv): Script Properties 의 'tg:' 접두 키(페어링된 사용자, 폴링 오프셋, 10분 체결 초안, 복기 프롬프트 표시).
 *  · 로그: 개수·코드만 남긴다(금액·ID·본문·토큰 없음).
 */
function rich300TgEnv_() {
  var props = PropertiesService.getScriptProperties(), store = null, P = 'tg:';
  return {
    now: function () { return Date.now(); },
    sha256: function (s) { return rich300Hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); },
    randomId: function (n) { return Utilities.getUuid().replace(/-/g, '').slice(0, n); },
    randomInt: function (n) { return parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 8), 16) % n; },
    sleep: function (ms) { Utilities.sleep(Math.min(ms, 10000)); },
    uiUrl: props.getProperty('RICH300_UI_URL') || undefined,
    storeEnv: function () { if (!store) { store = rich300GasEnv_(props.getProperty('RICH300_SHEET_ID')); RICH300_ENGINE.storeInit(store); } return store; },
    kv: {
      get: function (k) { return props.getProperty(P + k); },
      put: function (k, v) { props.setProperty(P + k, v); },
      del: function (k) { props.deleteProperty(P + k); },
      keys: function () { return props.getKeys().filter(function (k) { return k.indexOf(P) === 0; }).map(function (k) { return k.slice(P.length); }); }
    },
    http: {
      call: function (method, payload) {
        // 환경 가드(Deploy.gs): 운영 승인 전·테스트 허용 전에는 어떤 Telegram 호출도 나가지 않는다. 가드가 없으면 차단(fail-closed).
        var gate = typeof rich300TgGate_ === 'function' ? rich300TgGate_(method) : 'guard-missing';
        if (gate) return { status: 403, body: { ok: false, description: 'blocked: ' + gate } };
        var token = props.getProperty('RICH300_TG_TOKEN'); if (!token) throw new Error('token missing');
        var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
        var body = null; try { body = JSON.parse(res.getContentText()); } catch (e) { body = null; }
        return { status: res.getResponseCode(), body: body };
      }
    }
  };
}
/**
 * 시간 트리거 진입점(1분). 겹쳐 실행되지 않도록 *사용자 락*을 잡는다(저장소가 쓰는 스크립트 락과 별개라 교착이 없다).
 * 결과는 개수만, 실행 시간은 누적 통계(tg:stats: 실행 수·총/최대 ms·느린 실행 수)로 남긴다 — 트리거 일일 실행 시간 한도 점검용(값 없음).
 */
function rich300TgPoll() {
  var props = PropertiesService.getScriptProperties(), t0 = Date.now(), out, lk = typeof LockService.getUserLock === 'function' ? LockService.getUserLock() : null;
  if (lk && !lk.tryLock(500)) return { status: 'busy', reason: 'user-lock' };
  try { var env = rich300TgEnv_(); out = RICH300_ENGINE.tgPoll(env); RICH300_ENGINE.tgGc(env); } catch (err) { out = { status: 'exception' }; } finally { if (lk) lk.releaseLock(); }
  var ms = Date.now() - t0, st = {}; try { st = JSON.parse(props.getProperty('tg:stats') || '{}'); } catch (err) { st = {}; }
  props.setProperty('tg:last', JSON.stringify({ at: t0, ms: ms, r: out }));
  props.setProperty('tg:stats', JSON.stringify({ since: st.since || t0, runs: (st.runs || 0) + 1, totalMs: (st.totalMs || 0) + ms, maxMs: Math.max(st.maxMs || 0, ms), slow: (st.slow || 0) + (ms > 30000 ? 1 : 0), busy: (st.busy || 0) + (out && out.status === 'busy' ? 1 : 0) }));
  return out;
}
function rich300TgInstallPollTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'rich300TgPoll') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('rich300TgPoll').timeBased().everyMinutes(1).create();
}
function rich300TgRemovePollTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'rich300TgPoll') ScriptApp.deleteTrigger(t); });
}
/** 소유자 UI(페어링 코드 표시)에서 호출: 10분·1회용 코드를 만든다. 소유자 이메일 확인 통과 시에만. */
function rich300TgPairCode() {
  if (!rich300IsOwner_()) return { ok: false, error: 'forbidden' };
  var r = RICH300_ENGINE.tgPairCreate(rich300TgEnv_()); return { ok: true, code: r.code, expiresAt: r.expiresAt };
}

/** 모바일 입력 화면(?p=fill). 소유자만(라우터가 확인). 값은 서버가 JSON으로 주입한다. */
function rich300PageFill_(e) {
  var t = HtmlService.createTemplateFromFile('Fill'), p = (e && e.parameter) || {};
  var pre = { sid: String(p.sid || ''), dir: p.dir === 'SHORT' ? 'SHORT' : p.dir === 'LONG' ? 'LONG' : '', entry: String(p.entry || ''), stop: String(p.stop || '') };
  t.preset = JSON.stringify(pre).replace(/</g, '\\u003c');
  return t.evaluate().setTitle('RICH300 입력').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
/** google.script.run 대상: 폼 제출이 곧 확인. 소유자 확인 실패·예외는 일반 오류로만 응답. */
function rich300FillSubmit(form) {
  if (!rich300IsOwner_()) return { ok: false, error: 'forbidden' };
  return RICH300_ENGINE.tgSubmitFillForm(rich300TgEnv_(), form, { actor: 'ui:form' });
}
