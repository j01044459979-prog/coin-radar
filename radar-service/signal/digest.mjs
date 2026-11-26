// 관심종목 관찰 알림 1시간 통합(P2). 🟡 관찰 알림(기회 레이더·돈치안·매집 감시·EMA 관찰)을 즉시 보내지 않고 모아 매 시(KST) 한 번의 메시지로 보낸다.
//  · 즉시 발송 유지: 🟢/🔴 진입 검토(버튼 포함), 🚨 포지션 관리, 장애·연속성 경고, 정기 보고(cycle) — 이 모듈을 지나지 않는다.
//  · 중복 최소화: 같은 시간대 안에서 같은 종목·방향은 최신 1건만 남기고(건수 표시), 직전 통합에서 보낸 것과 내용이 같으면 4시간 동안 다시 보내지 않는다.
//  · 플래그 RADAR_WATCH_DIGEST = off 이면 아무것도 바꾸지 않는다(기본 on). 관찰 알림은 진입 기록 버튼이 없고 RICH300 장부에 쓰지 않는다.
//  · 전송기를 감싸는 방식이라 각 분석 단계의 상태 갱신(알림 전달 가정)은 그대로다. 통합 전송이 실패하면 큐를 비우지 않고 다음 실행에서 다시 시도한다.
import { createHash } from 'node:crypto';
import { escHtml } from '../format.mjs';

export const DIGEST_HOUR_MS = 3600000, DIGEST_REPEAT_MS = 4 * 3600000, DIGEST_MAX_ITEMS = 10, DIGEST_ITEM_CHARS = 380, DIGEST_TEXT_MAX = 3800;
export const digestEnabled = (env = process.env) => String(env?.RADAR_WATCH_DIGEST ?? 'on').trim().toLowerCase() !== 'off';
const WATCH_HEAD = '🟡 관심종목 관찰';
const toPlain = s => String(s ?? '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const hash = s => createHash('sha256').update(s).digest('hex').slice(0, 12);
export const kstHourOf = ms => Math.floor((ms + 9 * DIGEST_HOUR_MS) / DIGEST_HOUR_MS);
const kstLabel = hour => { const d = new Date(hour * DIGEST_HOUR_MS); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:00`; };

// 관찰 알림인지, 그리고 종목·방향 키와 본문 요약. 사진 설명(caption)도 같은 규칙.
export function digestClassify(textOrCaption) {
  const plain = toPlain(textOrCaption).trim();
  if (!plain.startsWith(WATCH_HEAD)) return null;
  const lines = plain.split('\n').map(l => l.trim()).filter(Boolean), head = lines[0];
  const m = /\|\s*([A-Z0-9]{2,20})\s+(LONG|SHORT)\b/.exec(head) || /\|\s*([A-Z0-9]{2,20})\s*$/.exec(head);
  const dirM = /\b(LONG|SHORT)\b/.exec(head), key = m ? `${m[1]}:${dirM?.[1] ?? '-'}` : `misc:${hash(lines.slice(0, 3).join('|'))}`;
  const body = lines.slice(1).join('\n');
  return { key, head: head.replace(WATCH_HEAD, '').replace(/^\s*\|\s*/, '').trim() || '시장', body, bodyHash: hash(body) };
}

export function createDigest(state, env = process.env) {
  const on = digestEnabled(env);
  const dg = state.digest = state.digest && typeof state.digest === 'object' ? state.digest : {};
  dg.items ??= {}; dg.sent ??= {}; let dirty = false;
  const queued = { ok: true, queued: true, result: { message_id: 0 } };
  const enqueue = (c, now) => {
    const cur = dg.items[c.key], hr = kstHourOf(now);
    dg.items[c.key] = { head: c.head, body: c.body, bodyHash: c.bodyHash, count: (cur?.count ?? 0) + 1, firstAt: cur?.firstAt ?? now, lastAt: now };
    dg.hour ??= hr; dirty = true;
  };
  const wrapSend = (send, clock = Date.now) => on ? async (text, opts) => {
    const c = digestClassify(text); if (!c || opts?.markup) return send(text, opts);
    enqueue(c, clock()); return queued;
  } : send;
  const wrapPhoto = (sendPhoto, clock = Date.now) => on && sendPhoto ? async (png, caption, opts) => {
    const c = digestClassify(caption); if (!c || opts?.markup) return opts ? sendPhoto(png, caption, opts) : sendPhoto(png, caption);
    enqueue(c, clock()); return queued;
  } : sendPhoto;
  // 통합 메시지 만들기(전송 없이). 반환 { text, plain, keys, skipped } 또는 null.
  function build(now) {
    const fresh = Object.entries(dg.items).filter(([k, v]) => !(dg.sent[k] && dg.sent[k].hash === v.bodyHash && now - dg.sent[k].ts < DIGEST_REPEAT_MS));
    const skipped = Object.keys(dg.items).length - fresh.length;
    if (!fresh.length) return { text: null, keys: [], skipped };
    const shown = fresh.slice(0, DIGEST_MAX_ITEMS), more = fresh.length - shown.length, hr = kstHourOf(now);
    const lines = [`${WATCH_HEAD} | 1시간 통합`, `🕒 ${kstLabel(hr)} KST 기준 · 새 관찰 ${fresh.length}건`, '※ 진입 신호 아님 · 기록 버튼 없음 · 진입 검토는 별도 즉시 알림'];
    for (const [, v] of shown) {
      const body = v.body.split('\n').slice(0, 6).join('\n'), t = `\n▪ ${v.head}${v.count > 1 ? ` (이번 시간 ${v.count}회)` : ''}\n${body}`;
      lines.push(t.length > DIGEST_ITEM_CHARS ? t.slice(0, DIGEST_ITEM_CHARS - 1) + '…' : t);
    }
    if (more > 0) lines.push(`\n… 외 ${more}건(다음 통합에서 확인)`);
    const plain = lines.join('\n'), text = lines.map(escHtml).join('\n');
    return { text: text.length <= DIGEST_TEXT_MAX ? text : text.slice(0, DIGEST_TEXT_MAX), plain, keys: shown.map(([k]) => k), skipped, more };
  }
  // 시간이 바뀌었고 쌓인 게 있으면 한 번 보낸다. 반환 { sent, items, skipped } — 실패하면 throw 하지 않고 { error } (큐 유지).
  async function flush(send, now = Date.now(), { force = false } = {}) {
    if (!on) return { sent: false, reason: 'off' };
    const hr = kstHourOf(now);
    if (!Object.keys(dg.items).length) { if (dg.hour !== hr) { dg.hour = hr; dirty = true; } return { sent: false, reason: 'empty' }; }
    if (!force && dg.hour === hr) return { sent: false, reason: 'same-hour' };
    const b = build(now);
    if (!b.text) { dg.items = {}; dg.hour = hr; dirty = true; return { sent: false, reason: 'all-duplicate', skipped: b.skipped }; }
    try { await send(b.text, { html: true }); }
    catch (error) { return { sent: false, error: String(error?.message ?? error).slice(0, 80) }; }
    for (const k of b.keys) dg.sent[k] = { ts: now, hash: dg.items[k].bodyHash };
    for (const k of Object.keys(dg.sent)) if (now - dg.sent[k].ts > DIGEST_REPEAT_MS * 3) delete dg.sent[k];
    const left = Object.fromEntries(Object.entries(dg.items).filter(([k]) => !b.keys.includes(k) && (b.more > 0)));   // 한도 초과분만 다음 통합으로 남긴다(중복으로 건너뛴 것은 버림)
    dg.items = left; dg.hour = hr; dirty = true;
    return { sent: true, items: b.keys.length, skipped: b.skipped, more: b.more };
  }
  return { on, wrapSend, wrapPhoto, flush, build, get dirty() { return dirty; }, clean() { dirty = false; }, state: dg };
}
