// RICH 300 연동(R9): 진입 후보 메시지에 [진입했어][관망했어][놓쳤어] 버튼과 고유 ID·기계가 읽는 한 줄을 붙인다.
//  · 기능 플래그 RADAR_RICH300_BUTTONS = on 일 때만 동작(기본 off → 기존 메시지·전송 경로는 한 글자도 바뀌지 않는다).
//  · 버튼의 callback_data 는 'r1:<고유ID>:e|w|m'. 같은 봇의 getUpdates 를 읽는 RICH 300 앱(Apps Script)이 처리한다. radar 는 getUpdates 를 호출하지 않는다.
//  · 신호 상세(코인·방향·진입가·손절·목표·시각·점수)는 메시지 본문의 'R9 v1 …' 한 줄에 담긴다. 앱은 버튼을 누른 메시지에서 이 줄을 읽어 신호를 저장한다(radar → 앱 별도 통신·Secret 없음).
//  · 주문 기능 없음. 버튼은 기록용이다.
import { escHtml } from '../format.mjs';

export const R9_STRATEGY = 'S';                                   // 신호 레이더(눌림 진입 후보) 단일 규칙. 이중 전략(A/B)이 병합되면 호출 쪽에서 'A'|'B'를 넘긴다.
export const r9Enabled = (env = process.env) => String(env?.RADAR_RICH300_BUTTONS ?? '').trim().toLowerCase() === 'on';

const plainNum = v => { const n = Number(v); if (!Number.isFinite(n) || n <= 0) return null; let t = String(Number(n.toPrecision(10))); if (/e/i.test(t)) t = n.toFixed(12).replace(/0+$/, '').replace(/\.$/, ''); return t; };
export function r9Sid(symbol, ev) {
  const base = String(symbol).replace(/USDT$/, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 14);
  return `SG-${base}-${ev.dir === 'LONG' ? 'L' : 'S'}-${Math.floor(ev.triggerT / 1000).toString(36)}`;      // 코인·방향·15분봉 트리거 시각이 같으면 같은 ID(재전송에도 동일)
}
export function r9Line(symbol, ev, { strategy = R9_STRATEGY, sid = r9Sid(symbol, ev) } = {}) {
  const f = [plainNum(ev.entry), plainNum(ev.stop), plainNum(ev.t1?.price), plainNum(ev.t2?.price) ?? '-'];
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol) || (ev.dir !== 'LONG' && ev.dir !== 'SHORT') || f.slice(0, 3).some(x => x === null) || !Number.isFinite(ev.triggerT)) return null;
  const score = Number.isFinite(ev.score) ? String(Math.max(0, Math.min(100, Math.round(ev.score)))) : '-';
  return `R9 v1 ${sid} ${symbol} ${ev.dir} ${f.join(' ')} ${strategy} ${score} ${Math.round(ev.triggerT)}`;
}
export const r9Keyboard = sid => ({ inline_keyboard: [[{ text: '진입했어', callback_data: `r1:${sid}:e` }, { text: '관망했어', callback_data: `r1:${sid}:w` }, { text: '놓쳤어', callback_data: `r1:${sid}:m` }]] });

// 본문(HTML)·사진 설명(일반 텍스트) 뒤에 붙일 꼬리. 줄을 만들 수 없으면 null(그 메시지는 기존 모습 그대로 나간다).
export function r9Tail(symbol, ev, opts) {
  const line = r9Line(symbol, ev, opts); if (!line) return null;
  const sid = line.split(' ')[2];
  return { sid, line, html: `\n\n🆔 ${escHtml(sid)}\n<code>${escHtml(line)}</code>`, plain: `\n\n🆔 ${sid}\n${line}`, markup: r9Keyboard(sid) };
}

// 후보 메시지(part)에 버튼·ID 부착. 원본을 바꾸지 않고 새 part 를 돌려준다.
export function r9Decorate(part, symbol, ev, env = process.env, opts) {
  if (!r9Enabled(env) || part.kind !== 'candidate') return part;
  const t = r9Tail(symbol, ev, opts); if (!t) return part;
  const text = part.text + t.html, plain = (part.plain ?? '') + t.plain;
  if (text.length > 3900) return part;                                                              // Telegram 4096자 한도 여유(초과하면 기존 모습 유지)
  return { ...part, text, plain, markup: t.markup, r9: t };
}
// 사진 설명(≤1024자)에 꼬리 부착. 초과하면 설명을 그대로 두고 null.
export function r9Caption(caption, part) { if (!part.r9) return caption; const c = caption + part.r9.plain; return [...c].length <= 1000 ? c : null; }
