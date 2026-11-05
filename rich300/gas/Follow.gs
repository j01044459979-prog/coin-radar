/**
 * Opt-in hourly follow-up for Telegram "진입했어" signals.
 * No separate trigger: piggybacks on existing rich300WatchTick every 5 min, reports at most once each hour.
 * OFF by default until owner explicitly configures RICH300_HOURLY_FOLLOW=on.
 * Reuses RICH300 sheet, existing tg: Script Properties namespace and guarded bot transport.
 * Public OKX/Bybit market data only; no exchange orders or account reads.
 */
function rich300FollowMode_() {
  var v = String(PropertiesService.getScriptProperties().getProperty('RICH300_HOURLY_FOLLOW') || '').trim().toLowerCase();
  return v === 'on' ? 'on' : v === 'preview' ? 'preview' : 'off';
}
function rich300FollowRun_(requested) {
  var want = requested || rich300FollowMode_();
  if (want === 'off') return { status: 'off' };
  var props = PropertiesService.getScriptProperties(), t0 = Date.now(), output, lock = LockService.getUserLock();
  if (lock && !lock.tryLock(500)) return { status: 'busy' };
  try {
    var tgEnv = rich300TgEnv_();
    var paired = RICH300_ENGINE.tgPairedUser(tgEnv);
    var live = want === 'on' && rich300WatchCanSend_() && !!paired;
    var mode = live ? 'on' : 'preview';
    var env = {
      now: function () { return Date.now(); },
      mode: function () { return mode; },
      storeEnv: tgEnv.storeEnv,
      kv: tgEnv.kv,
      market: rich300WatchMarket_,
      send: function (text, sid) {
        return paired ? RICH300_ENGINE.tgSendFollow(tgEnv, paired.chatId, text, sid) : { ok: false, code: 'not-paired' };
      }
    };
    output = RICH300_ENGINE.followTick(env);
    output.requested = want;
  } catch (err) {
    output = { status: 'exception', code: String(err && err.code || err && err.name || 'error').slice(0, 30) };
  } finally { if (lock) lock.releaseLock(); }
  if (want !== 'preview') {
    try {
      props.setProperty('follow:last', JSON.stringify({ at: t0, ms: Date.now() - t0, status: output.status, requested: want,
        mode: output.mode || null, active: output.active || 0, due: output.due || 0, sent: output.sent || 0,
        failed: output.failed || 0, stale: output.stale || 0, closed: output.closed || 0, code: output.code || null }));
    } catch (err) { /* never leak market or credentials to logs */ }
  }
  return output;
}
/** Preview is read-only: calculations only, with no writes and no Telegram sends. */
function rich300FollowPreview() { return rich300FollowRun_('preview'); }
function rich300FollowState_() {
  var props = PropertiesService.getScriptProperties(), raw = props.getProperty('RICH300_HOURLY_FOLLOW'), mode = rich300FollowMode_();
  var count = ScriptApp.getProjectTriggers().filter(function (x) { return x.getHandlerFunction() === 'rich300WatchTick'; }).length;
  var canSend = rich300WatchCanSend_(), last = null;
  try { last = JSON.parse(props.getProperty('follow:last') || 'null'); } catch (err) { last = null; }
  return { property: raw === null ? 'unset' : mode, mode: mode, triggerCount: count, canSend: canSend,
    effective: mode === 'off' || count !== 1 ? 'disabled' : (canSend ? 'active' : 'preview-only'), last: last };
}
