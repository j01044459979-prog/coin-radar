// 분할 진입·익절 계획 블록을 진입 후보 메시지에 붙인다(계산 참고용, 주문 아님).
//  · 기능 플래그 RADAR_SCALE_PLAN = on 일 때만 동작(기본 off → 기존 메시지는 한 글자도 바뀌지 않는다). 평가액은 RADAR_PLAN_EQUITY(기본 300 USDT, '가정'으로 표시).
//  · 앱(RICH 300)이 [진입했어] 때 실제 평가액으로 계획을 다시 계산해 보여 주므로, 여기 숫자는 가정 평가액 기준이다.
import { escHtml } from '../format.mjs';
import { splanBuild, splanLines } from './scale.mjs';

export const scaleEnabled = (env = process.env) => String(env?.RADAR_SCALE_PLAN ?? '').trim().toLowerCase() === 'on';
export const scaleEquity = (env = process.env) => { const v = Number(String(env?.RADAR_PLAN_EQUITY ?? '').trim()); return Number.isFinite(v) && v >= 10 && v <= 1e7 ? v : 300; };

export function scalePlanFor(symbol, ev, env = process.env) {
  try { return splanBuild({ symbol, dir: ev.dir, entry: ev.entry, stop: ev.stop, equity: scaleEquity(env) }); } catch { return null; }
}
// 후보 메시지(part)에 계획을 붙인다. 원본을 바꾸지 않고, 길이 한도(4096자 여유)를 넘으면 원본 그대로 돌려준다.
export function scaleDecorate(part, symbol, ev, env = process.env) {
  if (!scaleEnabled(env) || part.kind !== 'candidate') return part;
  const plan = scalePlanFor(symbol, ev, env); if (!plan) return part;
  const full = splanLines(plan, { assumed: true }), compact = splanLines(plan, { compact: true });
  const note = '※ 목표(TP)는 위 레이더 목표와 별개로 1R 기준(1.5R·2R). 평가액은 가정값 — 앱에서 실제 평가액으로 다시 계산';
  const text = part.text + '\n\n' + full.map(escHtml).join('\n') + '\n' + escHtml(note), plain = (part.plain ?? '') + '\n\n' + full.join('\n') + '\n' + note;
  if (text.length > 3300) return part;
  return { ...part, text, plain, scale: { plan, compact: compact.join('\n') } };
}
// 사진 설명(≤1024자)에 한 줄 요약 계획을 붙인다. R9 꼬리가 뒤에 붙을 자리를 남기고, 넘치면 설명을 그대로 둔다.
export function scaleCaption(caption, part, reserve = 0) {
  if (!part.scale) return caption;
  const c = `${caption}\n${part.scale.compact}`;
  return [...c].length + reserve <= 1000 ? c : caption;
}
