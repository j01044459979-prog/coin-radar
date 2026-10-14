// Telegram HTML 서식 도우미: 이스케이프, 안전한 링크, 일반 텍스트 변환, 가격 표시 자릿수.
// 지원 태그만 사용한다(<b>, <a href>). 외부 문자열(RSS 제목·종목명)은 항상 이스케이프한다.
export const escHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => escHtml(s).replace(/"/g, '&quot;');

// http(s)만 허용. 자격 증명·공백·제어문자·IP/로컬 호스트·과도하게 긴 URL은 링크로 쓰지 않는다.
export function safeHttpUrl(raw, maxLen = 800) {
  try {
    const text = String(raw ?? '').trim();
    if (!text || text.length > maxLen || /[\s<>"'\u0000-\u001f]/.test(text)) return null;
    const u = new URL(text);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    if (!u.hostname.includes('.') || /^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname) || u.hostname.startsWith('[') || /(^|\.)localhost$/.test(u.hostname)) return null;
    return u.href;
  } catch { return null; }
}
export const bold = s => `<b>${escHtml(s)}</b>`;
export const link = (url, text) => { const safe = safeHttpUrl(url); return safe ? `<a href="${escAttr(safe)}">${escHtml(text)}</a>` : escHtml(text); };
export const htmlToPlain = html => String(html).replace(/<a href="[^"]*">/g, '').replace(/<\/?(b|a)>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
export const visibleLength = html => [...htmlToPlain(html)].length;
export const clip = (text, n) => { const chars = [...String(text ?? '').replace(/\s+/g, ' ').trim()]; return chars.length <= n ? chars.join('') : chars.slice(0, n - 1).join('').trimEnd() + '…'; };

// 표시용 가격 자릿수(자산 가격대별). 계산값은 바꾸지 않고 표시만 반올림한다.
export function priceDecimals(p) {
  const a = Math.abs(Number(p));
  return a >= 1000 ? 1 : a >= 100 ? 2 : a >= 10 ? 3 : a >= 0.1 ? 4 : a >= 0.01 ? 5 : a >= 0.001 ? 6 : 8;
}
export const fmtPrice = (p, decimals = priceDecimals(p)) => Number(p).toFixed(decimals);
