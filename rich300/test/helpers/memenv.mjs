// 테스트용 메모리 시트 환경 + 고장 주입. Sheets의 자동 형변환(숫자·날짜 문자열)을 흉내 내는 coerce 모드로 "텍스트 서식 누락" 위험도 시험한다.
import { createHash } from 'node:crypto';
export function memEnv({ now = 1790000000000, failAppendOn = null, coerce = false, lockBusy = false, fixedClock = false } = {}) {
  const sheets = new Map(), headers = new Map(); let appends = 0, t = now, held = false;
  const env = {
    now: () => (fixedClock ? t : (t += 1000)), sha256: s => createHash('sha256').update(s).digest('hex'), lockTimeoutMs: 1,
    lock: { tryLock: () => { if (lockBusy || held) return false; held = true; return true; }, release: () => { held = false; } },
    sheets: {
      ensure(name, hdr) { if (!sheets.has(name)) { sheets.set(name, []); headers.set(name, hdr); } else if (JSON.stringify(headers.get(name)) !== JSON.stringify(hdr)) throw new Error(`헤더 불일치: ${name}`); },
      rows: name => sheets.get(name).map(r => r.map(c => (coerce && typeof c === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c) ? new Date(c) : c))),
      append(name, rows) { for (const r of rows) { appends++; if (failAppendOn !== null && appends === failAppendOn) throw new Error(`시트 쓰기 실패 주입(#${appends})`); sheets.get(name).push(r.map(c => (coerce && /^-?\d+(\.\d+)?$/.test(String(c)) ? Number(c) : String(c)))); } },
    },
  };
  return { env, sheets, headers, get appends() { return appends; }, setFail: n => { failAppendOn = n; }, setLockBusy: b => { lockBusy = b; }, reset: () => { held = false; } };
}
