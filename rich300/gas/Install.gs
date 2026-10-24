/**
 * RICH 300 — 운영 설치 한 번에(rich300Install). 엔진 번들 + 나머지 gas 파일과 같은 프로젝트에 둔다. 여러 번 실행해도 안전하다(멱등).
 *  사용자가 직접 하는 일: ① 스크립트 속성에 RICH300_TG_TOKEN(기존 운영 봇 토큰) 입력 ② 웹 앱 배포 ③ 이 함수 실행(+권한 동의) ④ 운영 승인 속성(RICH300_PROD_APPROVED=yes) 입력 후 한 번 더 실행 ⑤ 휴대폰에서 페어링 링크 1회 탭.
 *  승인 전(RICH300_PROD_APPROVED 없음): 시트·챌린지(시작 300 USDT, 일 5% 목표)·마감/백업 트리거·자동 검증만 하고 *Telegram 호출은 하나도 하지 않는다*.
 *  승인 후: 봇 확인(getMe)·웹훅 점검·폴링 트리거·페어링 링크. 이미 설정된 웹훅이 있으면 지우지 않고 멈춘다. 기존 radar·GitHub 설정은 건드리지 않는다.
 *  출력은 상태(PASS/FAIL/WAIT)뿐이다. 토큰·키·이메일·시트 ID·금액은 출력하지 않는다. 데이터·시트·백업·트리거를 삭제하지 않는다(폴링 트리거는 같은 이름 것만 교체).
 */
function rich300Install() {
  var p = PropertiesService.getScriptProperties(), steps = [], add = function (id, status, text) { steps.push({ id: id, status: status, text: text }); };
  var setup = rich300Setup_('prod');
  if (!setup.ok) { add('I1', 'FAIL', '환경 설정 실패: ' + (setup.error || 'error') + (setup.note ? ' — ' + setup.note : '')); return rich300InstallFinish_(steps, null); }
  add('I1', 'PASS', '운영 환경·소유자·시트 설정' + (setup.sheetCreated ? '(시트 새로 생성)' : '(기존 시트 사용)'));
  var se = rich300GasEnv_(p.getProperty('RICH300_SHEET_ID')); RICH300_ENGINE.storeInit(se);
  try {
    var day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), ch = RICH300_ENGINE.storeSetupChallenge(se, { startEquity: '300', startDay: day, rate: '0.05' }, { actor: 'install' });
    add('I2', 'PASS', ch.status === 'conflict' ? '챌린지는 이미 설정되어 있어 그대로 둡니다(시작 자금·시작일 보존)' : '챌린지 설정: 시작 자금 300 USDT · 일 목표 5% · 시작일 ' + day + '(KST)');
  } catch (err) { add('I2', 'FAIL', '챌린지 설정 실패: ' + String(err && (err.code || err.message) || 'error').slice(0, 60)); }
  try { rich300InstallCloseTriggers(); rich300BackupInstallTrigger(); add('I3', 'PASS', '일 마감(KST 00:00)·백업 트리거 설치(마감 알림은 꺼짐, 승인 전 발송 없음)'); } catch (err) { add('I3', 'FAIL', '트리거 설치 실패(권한 동의 필요할 수 있음)'); }
  var url = rich300AppUrl_();
  if (url) { if (p.getProperty('RICH300_UI_URL') !== url) p.setProperty('RICH300_UI_URL', url); add('I4', 'PASS', '웹 앱 주소 확인(입력 화면 링크에 사용)'); }
  else add('I4', 'WAIT', '웹 앱이 아직 배포되지 않았습니다. 배포(실행: 접속한 사용자, 접근: 나만) 후 이 함수를 다시 실행하세요');
  if (!p.getProperty('verify:startedAt')) { try { rich300VerifyStart(); add('I5', 'PASS', '자동 검증 시작(몇 분 걸림, 결과는 점검 화면에서 확인)'); } catch (err) { add('I5', 'FAIL', '자동 검증을 시작하지 못했습니다(권한 동의 필요할 수 있음)'); } }
  else add('I5', 'PASS', '자동 검증은 이미 시작되어 있습니다');
  var link = null;
  if (!p.getProperty('RICH300_TG_TOKEN')) add('I6', 'WAIT', '스크립트 속성 RICH300_TG_TOKEN(기존 운영 봇 토큰)이 없습니다');
  else if (p.getProperty('RICH300_PROD_APPROVED') !== 'yes') {
    if (p.getProperty('RICH300_TG_READONLY_OK') === 'yes') { var bc = rich300BotCheck(); add('I6a', bc.ok ? 'PASS' : 'FAIL', bc.ok ? '봇 사전 점검(읽기 전용): 토큰 유효·웹훅 없음' : '봇 사전 점검(읽기 전용)에서 문제 발견 — 점검 화면(?p=check)의 봇 사전 점검 항목 참고'); }
    add('I6', 'WAIT', '운영 승인 대기: 스크립트 속성 RICH300_PROD_APPROVED=yes 를 넣고 이 함수를 다시 실행하면 봇 연결이 시작됩니다(그 전에는 쓰기 호출 0건)'); }
  else link = rich300InstallTelegram_(p, add);
  return rich300InstallFinish_(steps, link);
}
function rich300InstallTelegram_(p, add) {
  var env = rich300TgEnv_(), me = RICH300_ENGINE.tgCall(env, 'getMe', {});
  if (!me.ok) { add('I6', 'FAIL', '봇 토큰을 확인하지 못했습니다(' + (me.code === 'auth' ? '토큰 거절' : String(me.code || 'error')) + ')'); return null; }
  var wh = RICH300_ENGINE.tgCall(env, 'getWebhookInfo', {});
  if (!wh.ok) { add('I6', 'FAIL', '웹훅 상태를 확인하지 못했습니다'); return null; }
  if (wh.result && wh.result.url) { add('I6', 'FAIL', '이 봇에는 웹훅이 설정되어 있어 폴링을 쓸 수 없습니다. 설정을 지우지 않고 멈춥니다(승인 후 별도 조치)'); return null; }
  add('I6', 'PASS', '봇 확인 완료(웹훅 없음)');
  rich300TgInstallPollTrigger(1); add('I7', 'PASS', '폴링 트리거 설치(1분 간격)');
  if (RICH300_ENGINE.tgPairedUser(env)) { add('I8', 'PASS', 'Telegram 계정이 이미 연결되어 있습니다'); return null; }
  var code = RICH300_ENGINE.tgPairCreate(env).code, user = String(me.result && me.result.username || '').replace(/[^A-Za-z0-9_]/g, '');
  add('I8', 'WAIT', '휴대폰에서 아래 링크를 한 번 탭하세요(10분 안, 1회용). 본인만 연결됩니다');
  return user ? 'https://t.me/' + user + '?start=' + code : null;
}
function rich300InstallFinish_(steps, link) {
  var fail = steps.filter(function (s) { return s.status === 'FAIL'; }).length, wait = steps.filter(function (s) { return s.status === 'WAIT'; }).length;
  Logger.log('RICH300 설치: ' + (fail ? '실패 ' + fail : wait ? '진행 중(할 일 ' + wait + ')' : '완료') + '\n' + steps.map(function (s) { return '[' + s.status + '] ' + s.id + ' ' + s.text; }).join('\n') + (link ? '\n페어링 링크: ' + link : ''));
  return { ok: fail === 0, steps: steps, pairLink: link };
}

/** 봇 사전 점검(읽기 전용): getMe·getWebhookInfo 두 호출만. 메시지 전송·getUpdates·웹훅 변경·삭제 없음. 승인 전이면 RICH300_TG_READONLY_OK=yes(또는 운영 승인)가 필요하다. 결과는 점검 화면(?p=check)에도 나온다. */
function rich300BotCheck() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('RICH300_TG_TOKEN')) { Logger.log('RICH300 봇 점검: 스크립트 속성 RICH300_TG_TOKEN 이 없습니다'); return { ok: false, error: 'no-token' }; }
  if (p.getProperty('RICH300_TG_READONLY_OK') !== 'yes' && p.getProperty('RICH300_PROD_APPROVED') !== 'yes') { Logger.log('RICH300 봇 점검: 읽기 전용 점검 승인 전입니다. 스크립트 속성 RICH300_TG_READONLY_OK=yes 를 넣고 다시 실행하세요(getMe·getWebhookInfo 두 호출만 합니다)'); return { ok: false, error: 'not-approved' }; }
  var env = rich300TgEnv_(), me = RICH300_ENGINE.tgCall(env, 'getMe', {}), wh = RICH300_ENGINE.tgCall(env, 'getWebhookInfo', {}), r = wh.result || {};
  var info = { at: Date.now(), me: { ok: !!me.ok, code: me.ok ? null : String(me.code || 'error') }, wh: { ok: !!wh.ok, hasUrl: !!r.url, pending: Number(r.pending_update_count || 0), lastErrorAt: r.last_error_date ? 1 : 0, hasAllowed: !!(r.allowed_updates && r.allowed_updates.length) } };
  p.setProperty('botcheck:last', JSON.stringify(info));
  var items = RICH300_ENGINE.checkBotItems(info);
  Logger.log('RICH300 봇 점검(읽기 전용)\n' + items.map(function (i) { return '[' + i.status + '] ' + i.id + ' ' + i.text; }).join('\n'));
  return { ok: items.every(function (i) { return i.status !== 'FAIL'; }), items: items };
}
