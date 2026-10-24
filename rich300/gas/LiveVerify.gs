/**
 * RICH 300 — 실제 환경 검증 하니스(테스트 프로젝트 전용). 엔진 번들 + 나머지 gas 파일과 같은 프로젝트에 둔다.
 *  사용자는 rich300LiveStart() 를 *한 번* 실행하고(권한 동의), 봇 토큰만 스크립트 속성에 입력하면 된다. 나머지(설치·자동 검증·트리거·페어링 링크·휴대폰 안내·결과 요약)는 자동이다.
 *  · 테스트 환경(RICH300_ENV=test)에서만 동작한다. 운영 환경이거나 운영 승인 플래그가 있으면 거부한다.
 *  · 봇 사용자명에 'test' 가 없으면(운영 봇 토큰을 실수로 넣은 경우) 시작을 거부한다.
 *  · 결과는 PASS/FAIL/WAIT/WARN/SKIP 요약(값 없음)으로 텔레그램 [TEST] 메시지와 실행 로그에 나온다. 토큰·시트 ID·이메일·금액은 출력하지 않는다.
 *  · 어떤 프로젝트·시트·백업·봇도 삭제하지 않는다(임시 시트와 백업은 결과 확인 뒤 정리 여부를 사용자에게 묻는다).
 */
function rich300LiveEnabled_() { return true; }
function rich300LiveProps_() { return PropertiesService.getScriptProperties(); }
function rich300LiveJson_(k, d) { try { var v = rich300LiveProps_().getProperty(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function rich300LiveIsTest_() { var p = rich300LiveProps_(); return p.getProperty('RICH300_ENV') === 'test' && p.getProperty('RICH300_PROD_APPROVED') !== 'yes'; }

/** 시험 환경 전용 카운터(이름별 횟수). 값·ID 없음. */
function rich300LiveCount_(name) {
  try { if (!rich300LiveIsTest_()) return; var p = rich300LiveProps_(), o = rich300LiveJson_('live:ct', {}); o[name] = (o[name] || 0) + 1; p.setProperty('live:ct', JSON.stringify(o)); } catch (e) { /* 카운터 실패는 무시 */ }
}
function rich300LiveEnableNotify_() {
  var p = rich300LiveProps_(); if (!rich300LiveIsTest_()) return;
  p.setProperty('RICH300_TEST_CLOSE_SEND', 'yes');
  var se = rich300GasEnv_(p.getProperty('RICH300_SHEET_ID')), E = RICH300_ENGINE, r = E.storeCreate(se, 'setting', { name: 'closeNotify', value: 'on' }, { actor: 'live' });
  if (r.status === 'conflict') E.storeRevise(se, 'setting', 'setting:closeNotify', { value: 'on' }, { actor: 'live', reason: '시험: 마감 알림 확인' });
}
function rich300LiveIo_() {
  var p = rich300LiveProps_();
  return { stats: function () { return rich300LiveJson_('tg:stats', {}); }, counters: function () { return rich300LiveJson_('live:ct', {}); }, envName: function () { return p.getProperty('RICH300_ENV'); },
    prodApproved: function () { return p.getProperty('RICH300_PROD_APPROVED') === 'yes'; }, removeTriggers: function () { rich300RemoveAllTriggers(); },
    saveHalt: function (o) { p.setProperty('live:halt', JSON.stringify(o)); }, auto: function () { return rich300LiveJson_('live:auto', []); }, halt: function () { return rich300LiveJson_('live:halt', null); } };
}
/** 폴링 한 번이 끝날 때 Telegram.gs 가 부른다(시험이 시작된 경우에만 일을 한다). */
function rich300LiveHook_(out) {
  if (!rich300LiveIsTest_() || !rich300LiveJson_('tg:live', null)) return;                 // tg:live = 시험 상태(시작 전에는 없음)
  RICH300_ENGINE.liveHookRun(rich300TgEnv_(), out, rich300LiveIo_());
}

function rich300LivePorts_() {
  var p = rich300LiveProps_(), base = rich300TgEnv_(), stamp = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace(/[-:T]/g, '');
  var scratchDrive = rich300BackupDrive_('RICH300-LIVE-SCRATCH');
  return {
    now: function () { return Date.now(); },
    hmacSha256: function (key, msg) { return rich300Hex_(Utilities.computeHmacSha256Signature(msg, key)); },
    sha256: base.sha256,
    tz: function () { return Session.getScriptTimeZone(); },
    formatKst: function (ms) { return Utilities.formatDate(new Date(ms), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'); },
    selfTest: function () { return rich300SelfTestRun_(); },
    newScratch: function (label) {
      var id = SpreadsheetApp.create('RICH300-LIVE-SCRATCH-' + label + '-' + stamp).getId();
      try { DriveApp.getFolderById(scratchDrive.ensureFolder()).addFile(DriveApp.getFileById(id)); } catch (e) { /* 폴더 정리는 선택 */ }
      var se = rich300GasEnv_(id); RICH300_ENGINE.storeInit(se); RICH300_ENGINE.deployMarkEnv(se, 'test'); return { se: se, id: id };
    },
    scratchDrive: function () { return scratchDrive; },
    realBackup: function () { return rich300BackupEnv_(); },
    tamper: function (id) { var sh = SpreadsheetApp.openById(id).getSheetByName('Fills'); sh.getRange(2, 5).setNumberFormat('@').setValue('{"tampered":"yes"}'); },
    sleep: function (ms) { Utilities.sleep(ms); },
    httpCount: function () { return (rich300LiveJson_('live:ct', {}).http || 0); }
  };
}
function rich300LiveMeasureIdle_(n) {
  var times = [];
  for (var i = 0; i < n; i++) { var t0 = Date.now(); rich300TgPoll(); times.push(Date.now() - t0); }
  times.sort(function (a, b) { return a - b; });
  var p = rich300LiveProps_(); p.deleteProperty('tg:stats'); p.deleteProperty('tg:last');
  return { median: times[Math.floor(times.length / 2)], max: times[times.length - 1] };
}
function rich300LiveFail_(msg, extra) { Logger.log('RICH300 LIVE: 시작하지 못했습니다 — ' + msg); var o = { ok: false, error: msg }; for (var k in (extra || {})) o[k] = extra[k]; return o; }

/**
 * 설치 + 자동 검증 + 시험 시작을 한 번에. 여러 번 실행해도 안전하다(이미 시작했으면 상태와 페어링 링크만 다시 보여 준다).
 * 사용자 입력: 스크립트 속성 RICH300_TG_TOKEN(테스트 봇 토큰) 한 가지뿐.
 */
function rich300LiveStart() {
  var p = rich300LiveProps_(), E = RICH300_ENGINE;
  if (p.getProperty('RICH300_ENV') && p.getProperty('RICH300_ENV') !== 'test') return rich300LiveFail_('이 프로젝트는 test 환경이 아닙니다(운영 프로젝트에서는 실행하지 않습니다)');
  if (p.getProperty('RICH300_PROD_APPROVED') === 'yes') return rich300LiveFail_('운영 승인 플래그가 있는 프로젝트입니다');
  var setup = rich300Setup_('test'); if (!setup.ok) return rich300LiveFail_('초기 설정 실패: ' + setup.error);
  if (!p.getProperty('RICH300_TG_TOKEN')) { Logger.log('RICH300 LIVE: 스크립트 속성 RICH300_TG_TOKEN 에 테스트 봇 토큰을 입력한 뒤 rich300LiveStart 를 다시 실행하세요.'); return { ok: false, need: ['RICH300_TG_TOKEN'] }; }
  p.setProperty('RICH300_TEST_TG_ALLOW', 'yes');
  if (!p.getProperty('RICH300_UI_URL')) { try { var u = ScriptApp.getService().getUrl(); if (u && /\/exec$/.test(u)) p.setProperty('RICH300_UI_URL', u); } catch (e) { /* 배포 전 */ } }
  var tg = rich300TgEnv_(), prev = E.liveGet(tg);
  if (prev && prev.phase !== 'halted') return rich300LiveStatus_(prev, tg);                            // 이미 시작됨
  var bot = E.liveBotCheck(tg); if (!bot.ok) return rich300LiveFail_('봇 확인 실패(' + bot.reason + ') — 운영 봇이 아닌 "test"가 들어간 테스트 봇의 토큰인지 확인하세요');
  var ports = rich300LivePorts_(), items = [];
  E.LIVE_FAST_SECTIONS.forEach(function (n) { items = items.concat(E.liveRunSection(n, ports)); });                       // A 호환성 · B 엔진 시간(빠름)
  var blockers = items.filter(function (i) { return /^A/.test(i.id) && i.status === 'FAIL'; });
  if (blockers.length) { p.setProperty('live:auto', JSON.stringify(items)); return rich300LiveFail_('호환성 검사 실패(' + blockers.map(function (b) { return b.id; }).join(',') + ') — 트리거를 설치하지 않았습니다', { items: items }); }
  var idle = rich300LiveMeasureIdle_(5), ch = E.liveChooseInterval(idle.median);
  items.push({ id: 'S0', status: ch.minutes ? 'PASS' : 'FAIL', text: '유휴 폴링 ' + idle.median + 'ms(최대 ' + idle.max + 'ms) → 하루 예상 ' + ch.projectedMin + '분(내부 한도 ' + E.LIVE_LIMITS.dailyBudgetMin + '분, 문서상 한도 ' + E.LIVE_LIMITS.assumedQuotaMin + '분은 미검증 가정) → 폴링 간격 ' + (ch.minutes ? ch.minutes + '분' : '설치 안 함') });
  p.setProperty('live:auto', JSON.stringify(items));
  if (!ch.minutes) return rich300LiveFail_('실행 시간 예산 초과 예상 — 트리거를 설치하지 않았습니다', { items: items });
  p.deleteProperty('live:ct'); p.deleteProperty('live:halt'); p.setProperty('live:bg', JSON.stringify({ todo: E.LIVE_SLOW_SECTIONS.slice(), startedAt: Date.now() }));
  rich300TgInstallPollTrigger(ch.minutes); rich300InstallCloseTriggers(); rich300BackupInstallTrigger();
  E.liveInit(tg, { bot: bot.username, intervalMin: ch.minutes, now: Date.now() }); rich300LiveScheduleBg_(30000);                // 느린 시험(C·G)은 30초 뒤 백그라운드에서 이어서 실행
  var pair = E.tgPairCreate(tg), link = 'https://t.me/' + bot.username + '?start=' + pair.code;
  var s = E.liveSummary(items), lines = items.filter(function (i) { return i.status !== 'PASS'; }).map(function (i) { return i.status + ' ' + i.id + ' ' + i.text; });
  Logger.log('RICH300 LIVE 설치·빠른 자동 검증 완료(느린 시험 C·G는 백그라운드에서 이어집니다): PASS ' + s.pass + ' · FAIL ' + s.fail + ' · WARN ' + s.warn + '\n' + (lines.length ? lines.join('\n') + '\n' : '') + '\n다음 한 가지: 휴대폰에서 이 링크를 열고 [시작/START]를 누르세요(10분 안에):\n' + link);
  return { ok: true, pairLink: link, interval: ch.minutes, summary: s, notPassed: lines };
}
/** 느린 자동 시험(C 시트 저장·읽기, G 백업·복원)을 구간별로 백그라운드(일회성 트리거)에서 실행한다. 한 번에 한 구간, 끝나면 다음 구간을 30초 뒤로 예약. */
function rich300LiveClearBg_() { ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'rich300LiveBackground') ScriptApp.deleteTrigger(t); }); }
function rich300LiveScheduleBg_(ms) { rich300LiveClearBg_(); ScriptApp.newTrigger('rich300LiveBackground').timeBased().after(ms).create(); }
function rich300LiveBackground() {
  if (!rich300LiveIsTest_()) return;
  rich300LiveClearBg_();
  var bg = rich300LiveJson_('live:bg', null), st = RICH300_ENGINE.liveGet(rich300TgEnv_());
  if (!bg || !bg.todo || !bg.todo.length || !st || st.phase === 'halted') return;
  var name = bg.todo[0], items = rich300LiveJson_('live:auto', []), p = rich300LiveProps_();
  try { items = items.concat(RICH300_ENGINE.liveRunSection(name, rich300LivePorts_())); }
  catch (err) { items.push({ id: 'BG-' + name, status: 'FAIL', text: '구간 ' + name + ' 실행 오류: ' + String(err && (err.code || err.message) || 'error').replace(/https?:\/\/\S+/g, '').slice(0, 80) }); }
  bg.todo.shift(); p.setProperty('live:auto', JSON.stringify(items)); p.setProperty('live:bg', JSON.stringify(bg));
  if (bg.todo.length) rich300LiveScheduleBg_(30000);
}
function rich300LiveStatus_(st, tg) {
  var out = { ok: true, phase: st.phase, step: st.step, interval: st.intervalMin };
  if (st.phase === 'unpaired') { var pair = RICH300_ENGINE.tgPairCreate(tg); out.pairLink = 'https://t.me/' + st.bot + '?start=' + pair.code; Logger.log('RICH300 LIVE: 아직 페어링 전입니다. 휴대폰에서 링크를 여세요(10분 안에):\n' + out.pairLink); }
  else Logger.log('RICH300 LIVE: 진행 중 — 단계 ' + (st.step + 1) + '/10, 상태 ' + st.phase + '. 휴대폰 [TEST] 메시지를 따라가세요.');
  return out;
}
/** 지금까지의 결과를 PASS/FAIL 요약으로 보여 준다(실행 로그). 텔레그램 발송은 하지 않는다. */
function rich300LiveReport() {
  var tg = rich300TgEnv_(), st = RICH300_ENGINE.liveGet(tg), items = RICH300_ENGINE.liveReportNow(tg, rich300LiveIo_(), st), texts = RICH300_ENGINE.liveReportTexts(items, { title: 'LIVE 결과' });
  texts.forEach(function (t) { Logger.log(t); });
  return RICH300_ENGINE.liveSummary(items);
}
/** 같은 요약을 테스트 봇 대화방(페어링된 계정)으로 보낸다. */
function rich300LiveSendReport() {
  var tg = rich300TgEnv_(), st = RICH300_ENGINE.liveGet(tg), items = RICH300_ENGINE.liveReportNow(tg, rich300LiveIo_(), st), p = RICH300_ENGINE.tgPairedUser(tg);
  if (!p) return { ok: false, error: 'not-paired' };
  RICH300_ENGINE.liveReportTexts(items, { title: 'LIVE 결과' }).forEach(function (t) { RICH300_ENGINE.tgSendMessage(tg, p.chatId, t); });
  return RICH300_ENGINE.liveSummary(items);
}
/** 안전 중단(수동): 트리거 제거 + 상태 기록. 프로젝트·시트·백업·봇은 그대로 둔다. */
function rich300LiveStop() {
  rich300RemoveAllTriggers();
  var tg = rich300TgEnv_(), st = RICH300_ENGINE.liveGet(tg);
  if (st && st.phase !== 'halted') { st.phase = 'halted'; st.halt = { reason: 'manual', text: '수동 중단', at: Date.now() }; RICH300_ENGINE.liveSet(tg, st); rich300LiveProps_().setProperty('live:halt', JSON.stringify(st.halt)); }
  return { ok: true, note: '트리거를 제거했습니다. 데이터는 그대로입니다.' };
}
