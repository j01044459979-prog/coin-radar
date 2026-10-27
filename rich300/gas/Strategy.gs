/**
 * RICH 300 — 추천 전략 자동 추적(COIN RADAR 추천 → RICH300 전략 생성 → 종료까지 가상 추적). 주문·계정 API 없음, 사용자의 수동 등록 불필요.
 *  · 추천 전달: radar(GitHub Actions)가 서명한 피드를 저장소의 rich300-feed 브랜치에 올리고, 이 파일이 공개 주소에서 *가져온다*(읽기 전용 GET). 서명 키(RICH300_FEED_KEY)가 *필수*이며 서명·출처(main 정기/수동 실행)·신선도·되돌림이 맞아야만 받는다(아니면 새 전략·알림 없음).
 *  · 기본 OFF: 스크립트 속성 RICH300_STRATEGY 가 'on' 일 때만 전략 생성·저장·전송, 'preview' 면 계산만(저장·전송 없음), 없으면 아무것도 하지 않는다(피드 호출 0). 관리 화면(?p=ops)에서만 켜고 끈다.
 *  · 5분 트리거는 위치 감시(rich300WatchTick)와 *같은 트리거*를 쓴다: 그 안에서 위치 감시와 전략 추적이 각각 자기 설정에 따라 실행된다. 이 파일은 트리거를 만들지 않는다.
 *  · 전송은 텔레그램 환경 가드(rich300TgGate_)를 따른다: 운영 승인 전에는 'on' 이어도 미리보기로만 동작한다. 상태는 Script Properties 'w:sg:' 접두(위치 감시 'w:pos:'·텔레그램 'tg:'·COIN RADAR 와 분리).
 *  · 로그·반환값에는 개수·코드만 남긴다(키·본문·가격 없음).
 */
var RICH300_FEED_REPO_ = 'j01044459979-prog/coin-radar', RICH300_FEED_BRANCH_ = 'rich300-feed';
function rich300StrategyMode_() {
  var v = String(PropertiesService.getScriptProperties().getProperty('RICH300_STRATEGY') || '').trim().toLowerCase();
  return v === 'on' ? 'on' : v === 'preview' ? 'preview' : 'off';
}
/** 피드 가져오기(읽기 전용 GET, 최대 약 5분 캐시되는 공개 주소). 본문은 검증 전까지 신뢰하지 않는다. */
function rich300StrategyFeed_() {
  try {
    var url = 'https://raw.githubusercontent.com/' + RICH300_FEED_REPO_ + '/' + RICH300_FEED_BRANCH_ + '/feed.json?v=' + Math.floor(Date.now() / 60000);
    var res = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
    var code = res.getResponseCode();
    if (code !== 200) return { ok: false, code: 'http-' + code };
    return { ok: true, raw: res.getContentText() };
  } catch (err) { return { ok: false, code: 'fetch-exception' }; }
}
function rich300StrategyEnv_(mode) {
  var base = rich300WatchEnv_(mode), props = PropertiesService.getScriptProperties();
  base.feed = rich300StrategyFeed_;
  base.feedKey = function () { var k = props.getProperty('RICH300_FEED_KEY'); return k && String(k).length >= 32 ? String(k) : null; };      // 없거나 약하면 null → 피드 거부(서명 필수)
  base.hmacSha256 = function (key, message) { return rich300Hex_(Utilities.computeHmacSha256Signature(message, key)); };
  base.budgetMs = 150000;
  return base;
}
/** 전략 추적 한 번 실행. 겹치지 않도록 사용자 락을 잡고, 결과는 개수·코드만 속성에 남긴다. */
function rich300StrategyRun_(want) {
  var props = PropertiesService.getScriptProperties(), t0 = Date.now(), out;
  if (want === 'off') return { status: 'off' };
  var lk = typeof LockService.getUserLock === 'function' ? LockService.getUserLock() : null;
  if (lk && !lk.tryLock(500)) return { status: 'busy' };
  try {
    var mode = want === 'on' && !rich300WatchCanSend_() ? 'preview' : want;
    out = RICH300_ENGINE.strategyTick(rich300StrategyEnv_(mode)); out.requested = want; delete out.preview;
  } catch (err) { out = { status: 'exception', code: String(err && err.code || err && err.name || 'error').slice(0, 24) }; }
  finally { if (lk) lk.releaseLock(); }
  if (want !== 'preview') try { props.setProperty('strategy:last', JSON.stringify({ at: t0, ms: Date.now() - t0, status: out.status, mode: out.mode || want, requested: want, created: out.created || 0, cancelled: out.cancelled || 0, tracked: out.tracked || 0, active: out.active || 0, events: out.events || 0, sent: out.sent || 0, failed: out.failed || 0, marketFail: out.marketFail || 0, feed: out.feed || null, code: out.code || null })); } catch (err2) { /* 기록 실패는 무시 */ }
  return out;
}
/** 편집기 직접 실행용 미리보기(설정과 무관, 저장·전송 없음). */
function rich300StrategyPreview() { return rich300StrategyRun_('preview'); }
function rich300StrategyLast_() { try { var r = PropertiesService.getScriptProperties().getProperty('strategy:last'); return r ? JSON.parse(r) : null; } catch (err) { return null; } }
/** 페이지(?p=strat): 시트만 읽는다(시세·피드 호출 없음). 열기만 해서는 아무것도 바꾸지 않는다. */
function rich300PageStrat_(e) {
  var html, appUrl = rich300AppUrl_();
  try {
    var env = rich300JournalEnv_(), last = rich300StrategyLast_(), mode = rich300StrategyMode_();
    html = RICH300_ENGINE.stratRenderHtml({ m: { rows: RICH300_ENGINE.sgyList(env.storeEnv()), now: Date.now(), mode: mode, lastRun: last ? { ageMin: Math.round((Date.now() - last.at) / 60000), status: last.status } : null, feedOk: last && last.feed ? last.feed.ok : null }, appUrl: appUrl, build: RICH300_BUILD });
  } catch (err) { html = RICH300_ENGINE.shellRenderError({ title: '추천 전략', code: RICH300_ENGINE.shellErrorCode(err), appUrl: appUrl, page: 'strat' }); }
  return rich300Html_(html, 'RICH300 추천 전략');
}
