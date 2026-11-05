// 테스트용 Apps Script 서비스 가짜: 시트(텍스트 서식 없으면 숫자·날짜로 자동 변환), 락, SHA-256/HMAC, 캐시(TTL·퇴출), 속성.
import { createHash, createHmac } from 'node:crypto';

// 실제 Apps Script 실측(2026-11-01 temporaryFeedDiagnostic): Utilities.computeHmacSha256Signature(문자열, 문자열) 두 인자 호출은 한글이 들어가면 UTF-8 이 아닌 결과를 낸다
// (같은 입력에 Utilities.Charset.UTF_8 를 명시하면 Node(UTF-8) 서명과 일치). 가짜도 같게 동작해야 이 결함이 테스트에서 가려지지 않는다:
// charset 이 UTF_8('utf8')일 때만 UTF-8, 생략하면 Latin-1 범위 밖 글자를 '?' 로 바꾸는 비 UTF-8 인코딩으로 계산한다.
export const gasBytes = (s, charset) => (charset === 'utf8' ? Buffer.from(String(s), 'utf8') : Buffer.from([...String(s)].map(ch => (ch.codePointAt(0) <= 0xff ? ch : '?')).join(''), 'latin1'));
const signed = buf => [...buf].map(b => (b > 127 ? b - 256 : b));
export function fakeSheetsServices() {
  const book = new Map(); let held = false;
  const mkSheet = name => ({ name, cells: [], fmt: [], frozen: 0, max: 1000,
    getLastRow() { return this.cells.length; }, getLastColumn() { return this.cells.reduce((m, r) => Math.max(m, r.length), 0); }, getMaxRows() { return this.max; }, insertRowsAfter(_, n) { this.max += n; }, setFrozenRows(n) { this.frozen = n; },
    getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); },
    getRange(r, c, nr, nc) { const sh = this; return {
      setNumberFormat(f) { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { (sh.fmt[r - 1 + i] ||= [])[c - 1 + j] = f; } return this; },
      setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => { const R = r - 1 + i, C = c - 1 + j, text = sh.fmt[R]?.[C] === '@'; (sh.cells[R] ||= [])[C] = text ? String(v) : (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v) : v); })); return this; },
      setValue(v) { return this.setValues([[v]]); },
      getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(sh.cells[r - 1 + i]?.[c - 1 + j] ?? ''); out.push(row); } return out; } }; } });
  const ss = { getSheetByName: n => book.get(n) ?? null, insertSheet: n => { const s = mkSheet(n); book.set(n, s); return s; } };
  return { book, ctx: {
    SpreadsheetApp: { openById: () => ss, flush() {} }, LockService: { getScriptLock: () => ({ tryLock: () => { if (held) return false; held = true; return true; }, releaseLock() { held = false; } }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: (a, s) => signed(createHash('sha256').update(s, 'utf8').digest()), computeHmacSha256Signature: (message, key, charset) => signed(createHmac('sha256', gasBytes(key, charset)).update(gasBytes(message, charset)).digest()) } } };
}

// CacheService 가짜: 가상 시계 기반 TTL, evictAll()로 퇴출 흉내
export function fakeCache(clock = { t: 0 }) {
  const m = new Map();
  return { clock, evictAll: () => m.clear(), size: () => m.size, service: { getScriptCache: () => ({
    get: k => { const e = m.get(k); if (!e) return null; if (clock.t >= e.exp) { m.delete(k); return null; } return e.v; },
    put: (k, v, ttl) => { m.set(k, { v: String(v), exp: clock.t + ttl * 1000 }); },
    remove: k => { m.delete(k); } }) } };
}
export const fakeProps = initial => { const m = new Map(Object.entries(initial)); return { map: m, service: { getScriptProperties: () => ({ getProperty: k => m.get(k) ?? null, setProperty: (k, v) => m.set(k, v) }) } }; };
