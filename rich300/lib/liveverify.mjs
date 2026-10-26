// 실제 Apps Script·Google Sheets·Drive 에서 돌리는 자동 검증(테스트 환경 전용). 같은 코드를 Node(가짜 포트)와 Apps Script(실제 포트)가 쓴다.
//  env 포트: { now():ms, hmacSha256(key,msg):hex, sha256(s):hex, tz():string, formatKst(ms):'yyyy-MM-dd HH:mm', selfTest():deploySelfTest 결과,
//             newScratch(label):{ se, id }  (임시 스프레드시트 + 저장소 env, 환경 표식 test), scratchDrive(): 백업 포트(임시 폴더), realBackup(): backupRun 에 넘길 env(테스트 시트·실제 백업 폴더),
//             tamper(id): 임시 복사본의 체결 셀 하나를 바꾼다, httpCount():이 하니스 어댑터의 외부 호출 누계 }
//  결과 항목: { id, status:'PASS'|'FAIL'|'WARN'|'SKIP', text, ms? } — 텍스트에는 금액·ID·토큰·이메일 없이 개수·시간·판정만 담는다.
//  원칙: 운영 데이터가 없는 테스트 환경에서만 쓰며, 임시 시트·폴더 안에서만 쓰기/삭제(휴지통 이동)를 한다. 시험 결과를 확인하기 전에는 아무것도 지우지 않는다(임시 시트는 남김).
import { dec, decMul, decDiv, decToMicro } from './decimal.mjs';
import { kstDayOf, dayStartMs, addDays } from './time.mjs';
import { compoundIdealSeries } from './compound.mjs';
import { pnlComputeTrade } from './pnl.mjs';
import { ledgerBuildDaily } from './ledger.mjs';
import { authCanonicalBody } from './auth.mjs';
import { storeInit, storeCreate, storeList, storeIntegrityCheck, storeLoadLedgerInputs } from './store.mjs';
import { dedupeCanonical } from './dedupe.mjs';
import { ENTITIES } from './schema.mjs';
import { backupRun, backupRestore, backupSwitchChecks, backupFingerprint } from './backup.mjs';
import { deployMarkEnv } from './deploy.mjs';
import { journalBuild } from './journal.mjs';
import { journalRenderHtml } from './journalview.mjs';
import { LIVE_DEC_VECTORS, LIVE_IDEAL_VECTORS, LIVE_PNL_VECTORS, LIVE_HMAC_VECTORS } from './livevectors.mjs';
import { nullishOr } from './nullish.mjs';

export const LIVE_THRESH = Object.freeze({ ledgerPassMs: 3000, ledgerWarnMs: 10000, renderPassMs: 5000, writeP50Ms: 1000, writeP90Ms: 2500, read5kPassMs: 6000, read5kWarnMs: 20000, backupPassMs: 30000 });
export const LIVE_SHA_VECTORS = Object.freeze([['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'], ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'], ['한글🙂', 'dfe2c239b4dd154b386d368f1a32320bf4d637035d973e943c9b7b3b790aa047']]);

// ── 순수 JS SHA-256(UTF-8): 시험 데이터를 메모리에서 빠르게 만들기 위한 것(운영 경로는 Utilities 사용). 벡터로 검증한다. ──
function liveUtf8(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.codePointAt(i); if (c > 0xffff) i++;
    if (c < 0x80) out.push(c); else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
const LIVE_K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
export function liveSha256(str) {
  const b = liveUtf8(str), l = b.length * 8; b.push(0x80); while (b.length % 64 !== 56) b.push(0);
  const hi = Math.floor(l / 4294967296), lo = l >>> 0; for (const v of [hi, lo]) b.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  let h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const w = new Array(64), rr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < b.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = ((b[o + 4 * i] << 24) | (b[o + 4 * i + 1] << 16) | (b[o + 4 * i + 2] << 8) | b[o + 4 * i + 3]) >>> 0;
    for (let i = 16; i < 64; i++) { const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0; }
    let [a, bb, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25), ch = (e & f) ^ (~e & g), t1 = (hh + S1 + ch + LIVE_K[i] + w[i]) >>> 0, S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22), mj = (a & bb) ^ (a & c) ^ (bb & c), t2 = (S0 + mj) >>> 0; hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0; }
    h = [h[0] + a, h[1] + bb, h[2] + c, h[3] + d, h[4] + e, h[5] + f, h[6] + g, h[7] + hh].map(x => x >>> 0);
  }
  return h.map(x => x.toString(16).padStart(8, '0')).join('');
}

// ── 메모리 저장소(시험 데이터 생성용). 시트 접근이 없어 빠르다. ──
export function liveMemStore(now0 = 1790000000000) {
  const sheets = new Map(); let t = now0, held = false;
  const env = { now: () => (t += 1000), sha256: liveSha256, lockTimeoutMs: 1, lock: { tryLock: () => { if (held) return false; held = true; return true; }, release: () => { held = false; } },
    sheets: { ensure(n) { if (!sheets.has(n)) sheets.set(n, []); }, rows: n => sheets.get(n).map(r => [...r]), append(n, rows) { for (const r of rows) sheets.get(n).push(r.map(String)); } } };
  return { env, sheets };
}
// 결정적 데이터: 하루에 신호 A/B 각 1건 + 체결 4건 + 복기·평가액을 쌓아 감사 로그가 target 행에 이를 때까지.
//  store API 로 한 건씩 저장하면 쓸 때마다 전체를 읽어 O(n²)이라 느리므로, 같은 형식(감사 해시 체인 + 엔티티 행)을 직접 만든다. 결과는 storeIntegrityCheck 로 검증된다.
export function liveDataset(targetAudit, { startDay = '2026-01-01', sha = liveSha256 } = {}) {
  const m = liveMemStore(), se = m.env; storeInit(se); const ZERO = '0'.repeat(64);
  let seq = 0, prev = ZERO, t = 1790000000000, n = 0, seed = 7; const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const add = (entity, raw) => {
    const E = ENTITIES[entity], d = E.normalize(raw), key = E.keyOf(d), after = dedupeCanonical(d); seq++; t += 1000;
    const hash = sha([prev, seq, t, entity, key, 1, 'create', 'live', after].join('|'));
    m.sheets.get('Audit').push([String(seq), String(t), entity, key, '1', 'create', 'live', '', '', after, prev, hash]); prev = hash;
    m.sheets.get(E.sheet).push([key, '1', '0', String(t), after, ...E.display(d)]);
  };
  add('challenge', { startEquity: '300', startDay }); add('rate', { from: startDay, rate: '0.05' }); let day = startDay;
  while (seq < targetAudit) {
    const ds = dayStartMs(day);
    for (const [k, strat, dir] of [[0, 'A', 'LONG'], [1, 'B', 'SHORT']]) {
      const sid = `LD${n++}`, at = ds + (9 + k * 4) * 3600000, e = 100 + Math.floor(rnd() * 50), x = dir === 'LONG' ? e + 2 : e - 2;
      add('signal', { sid, strategy: strat, symbolId: 'BTCUSDT', dir, signalAt: at - 600000, entry: String(e), stop: String(e - 2), tp1: String(e + 3) }); add('response', { sid, choice: 'entered', at: at - 300000 });
      const fl = { origin: 'real', sid, dir, qty: '1', fee: { state: 'entered', amount: '0.05' }, funding: { state: 'entered', amount: '0' } };
      add('fill', { ...fl, fillId: `${sid}i`, kind: 'entry', at, price: String(e) }); add('fill', { ...fl, fillId: `${sid}o`, kind: 'close', at: at + 3600000, price: String(x) });
      if (rnd() < 0.5) add('review', { sid, plan: 'plan_ok', mind: 'calm', savedAt: at + 7200000 });
    }
    add('equity', { day, equity: '300' }); day = addDays(day, 1);
  }
  return { se, sheets: m.sheets, lastDay: addDays(day, -1), audit: seq };
}
function liveInputs1y() {                                  // 365일 × 9체결 = 3,285체결(장부 계산 시간 측정용, 저장소 없음)
  const fills = [], start = '2026-01-01', ds = dayStartMs(start);
  for (let d = 0; d < 365; d++) for (let k = 0; k < 3; k++) { const sid = `Y${d}-${k}`, at = ds + d * 86400000 + (k + 1) * 3 * 3600000, fl = { origin: 'real', sid, dir: 'LONG', fee: { state: 'entered', amount: '0.04' }, funding: { state: 'missing' } };
    fills.push({ ...fl, fillId: `${sid}a`, kind: 'entry', at, price: '100', qty: '1' }, { ...fl, fillId: `${sid}b`, kind: 'add', at: at + 600000, price: '101', qty: '1' }, { ...fl, fillId: `${sid}c`, kind: 'close', at: at + 3600000, price: '103', qty: '2' }); }
  return { inputs: { challenge: { startEquity: '300', startDay: start, rateSchedule: [{ from: start, rate: '0.05' }] }, fills, cashflows: [], equityInputs: [], adjustments: [], openingPositions: [] }, throughDay: addDays(start, 364), count: fills.length };
}

const liveItem = (id, status, text, ms) => ({ id, status, text, ...(ms === undefined ? {} : { ms }) });
const liveMs = (env, fn) => { const t0 = env.now(); const r = fn(); return { r, ms: env.now() - t0 }; };
const livePct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
function liveBigIntExtras() {
  const ok = [BigInt(2) ** BigInt(200) % BigInt(1000003) === BigInt(973692), -BigInt(7) / BigInt(2) === -BigInt(3), -BigInt(7) % BigInt(2) === -BigInt(1), (BigInt(1) << BigInt(64)) - BigInt(1) === BigInt("18446744073709551615"), BigInt('123456789012345678901234567890') * BigInt(10) === BigInt("1234567890123456789012345678900"), typeof BigInt === 'function'];
  return ok.every(Boolean);
}

// ── A 호환성 ──
export function liveCompat(env) {
  const items = [];
  const t0 = env.now(); let bad = 0, total = 0;
  for (const v of LIVE_DEC_VECTORS) { total += 3; const a = dec(v.a), b = dec(v.b); if (String(decMul(a, b)) !== v.mul) bad++; if (String(decDiv(a, b)) !== v.div) bad++; if (String(decToMicro(a)) !== v.micro) bad++; }
  const ideal = compoundIdealSeries({ startMicro: BigInt(300000000), startDay: '2026-01-01', schedule: [{ from: '2026-01-01', rate: '0.05' }], throughDay: addDays('2026-01-01', 364) });
  for (const [n, micro] of LIVE_IDEAL_VECTORS) { total++; if (String(ideal[n].idealMicro) !== micro) bad++; }
  let events = 0;
  LIVE_PNL_VECTORS.forEach((o, i) => { const fills = o.fills.map((f, k) => ({ origin: 'real', sid: `P${i}`, dir: o.dir, at: Date.UTC(2026, 9, 24) + k * 1000, fee: { state: 'entered', amount: '0' }, funding: { state: 'entered', amount: '0' }, ...f })), t = pnlComputeTrade(fills); t.events.forEach((e, k) => { total++; events++; if (String(e.grossMicro) !== o.grossMicroPerEvent[k]) bad++; }); });
  const ext = liveBigIntExtras(); if (!ext) bad++; total++;
  items.push(liveItem('A1', bad === 0 ? 'PASS' : 'FAIL', `BigInt·고정소수점·복리·손익 벡터 ${total - bad}/${total} 일치(손익 ${LIVE_PNL_VECTORS.length}건·${events}체결)`, env.now() - t0));
  let hb = 0; for (const v of LIVE_HMAC_VECTORS) { const signed = `${v.v}.${v.ts}.${v.nonce}.${v.canonical}`; if (authCanonicalBody(v.body) !== v.canonical || env.hmacSha256(v.key, signed) !== v.sig) hb++; }
  let sb = 0; for (const [s, h] of LIVE_SHA_VECTORS) if (env.sha256(s) !== h || liveSha256(s) !== h) sb++;
  items.push(liveItem('A2', hb === 0 && sb === 0 ? 'PASS' : 'FAIL', `HMAC(한글·이모지) ${LIVE_HMAC_VECTORS.length - hb}/${LIVE_HMAC_VECTORS.length}, SHA-256 ${3 - sb}/3 일치`));
  const before = dayStartMs('2026-10-25') - 60000, at0 = dayStartMs('2026-10-25');
  const tzOk = env.tz() === 'Asia/Seoul', f1 = env.formatKst(before), f2 = env.formatKst(at0), kstOk = kstDayOf(before) === '2026-10-24' && kstDayOf(at0) === '2026-10-25' && f1 === '2026-10-24 23:59' && f2 === '2026-10-25 00:00';
  items.push(liveItem('A3', tzOk && kstOk ? 'PASS' : 'FAIL', `프로젝트 시간대 ${tzOk ? 'Asia/Seoul' : '다름'}, KST 날짜 경계 ${kstOk ? '일치' : '불일치'}`));
  const st = env.selfTest(); items.push(liveItem('A4', st.fail === 0 ? (st.warn ? 'WARN' : 'PASS') : 'FAIL', `자가 점검 실패 ${st.fail} · 경고 ${st.warn}${st.fail ? ` (${st.items.filter(i => i.level === 'fail').map(i => i.id).join(', ')})` : ''}`));
  return items;
}

// ── B 엔진 계산 시간 ──
export function liveEngine(env) {
  const items = [], w = liveInputs1y(), { r, ms } = liveMs(env, () => ledgerBuildDaily({ ...w.inputs, throughDay: w.throughDay }));
  items.push(liveItem('B1', r.rows.length === 365 ? (ms <= LIVE_THRESH.ledgerPassMs ? 'PASS' : ms <= LIVE_THRESH.ledgerWarnMs ? 'WARN' : 'FAIL') : 'FAIL', `1년 ${w.count}체결 장부 계산 ${ms}ms (기준 ≤${LIVE_THRESH.ledgerPassMs}ms${ms > LIVE_THRESH.ledgerPassMs ? ', 초과 시 R3 읽기 최적화 검토' : ''})`, ms));
  const d = liveDataset(2000), m = liveMs(env, () => journalRenderHtml(journalBuild({ now: () => dayStartMs(d.lastDay) + 20 * 3600000, storeEnv: () => d.se }, { now: dayStartMs(d.lastDay) + 20 * 3600000 })));
  items.push(liveItem('B2', m.ms <= LIVE_THRESH.renderPassMs ? 'PASS' : 'WARN', `일지 모델+렌더(감사 ${d.audit}행) ${m.ms}ms, HTML ${Math.round(m.r.length / 1024)}KB (기준 ≤${LIVE_THRESH.renderPassMs}ms)`, m.ms));
  return items;
}

function liveDump(src, dstSe) {                            // 메모리 저장소 → 실제 시트(일괄 쓰기)
  for (const [name, rows] of src.sheets) { if (name === 'Meta') continue; for (let i = 0; i < rows.length; i += 800) dstSe.sheets.append(name, rows.slice(i, i + 800)); }
}
// ── C 실제 Google Sheets 저장·읽기(두 구간으로 나눠 실행: 각각 Apps Script 실행 시간 한도 안에 끝나도록) ──
export function liveSheetsIo(env) {
  const items = [], scr = env.newScratch('io'), A = { actor: 'live' }, times = [];
  for (let i = 0; i < 100; i++) { const t0 = env.now(); storeCreate(scr.se, 'cashflow', { cfId: `lv-${i}`, at: 1790000000000 + i, amount: '1' }, A); times.push(env.now() - t0); }
  const p50 = livePct(times, 0.5), p90 = livePct(times, 0.9);
  items.push(liveItem('C1', p50 <= LIVE_THRESH.writeP50Ms && p90 <= LIVE_THRESH.writeP90Ms ? 'PASS' : p90 <= LIVE_THRESH.writeP90Ms * 2 ? 'WARN' : 'FAIL', `저장 100회 건당 p50 ${p50}ms · p90 ${p90}ms · 최대 ${Math.max(...times)}ms (기준 p50 ≤${LIVE_THRESH.writeP50Ms}, p90 ≤${LIVE_THRESH.writeP90Ms})`, p50));
  const dup = storeCreate(scr.se, 'cashflow', { cfId: 'lv-0', at: 1790000000000, amount: '1' }, A), con = storeCreate(scr.se, 'cashflow', { cfId: 'lv-0', at: 1790000000000, amount: '2' }, A);
  items.push(liveItem('C4', dup.status === 'duplicate' && con.status === 'conflict' && storeList(scr.se, 'cashflow').length === 100 ? 'PASS' : 'FAIL', `같은 키 재저장 ${dup.status}, 다른 내용 ${con.status}, 기록 ${storeList(scr.se, 'cashflow').length}건`));
  return items;
}
export function liveSheetsRead(env) {
  const items = [], A = { actor: 'live' }, reads = [], bigWrites = []; let integOk = true, integIssues = 0, coerceOk = true;
  for (const target of [500, 2000, 5000]) {
    const d = liveDataset(target), s2 = env.newScratch(`read${target}`); liveDump(d, s2.se);
    const t0 = env.now(); const inp = storeLoadLedgerInputs(s2.se); const led = ledgerBuildDaily({ ...inp, throughDay: d.lastDay }); const ms = env.now() - t0;
    reads.push({ audit: d.audit, ms, days: led.rows.length });
    if (target === 5000) { const ic = storeIntegrityCheck(s2.se); integOk = ic.ok; integIssues = ic.issues.length; coerceOk = ic.issues.every(i => i.type !== 'tampered-view'); for (let i = 0; i < 5; i++) { const w0 = env.now(); storeCreate(s2.se, 'cashflow', { cfId: `big-${i}`, at: 1790000000000 + i, amount: '1' }, A); bigWrites.push(env.now() - w0); } }
  }
  const r5 = reads[2];
  items.push(liveItem('C2', r5.ms <= LIVE_THRESH.read5kPassMs ? 'PASS' : r5.ms <= LIVE_THRESH.read5kWarnMs ? 'WARN' : 'FAIL', `전체 읽기+장부(감사 ${reads.map(r => r.audit).join('/')}행) ${reads.map(r => r.ms + 'ms').join(' / ')} (기준 5천행 ≤${LIVE_THRESH.read5kPassMs}ms${r5.ms > LIVE_THRESH.read5kPassMs ? ', 초과 시 R3 읽기 최적화 필요' : ''})`, r5.ms));
  const w50 = livePct(bigWrites, 0.5); items.push(liveItem('C5', w50 <= 5000 ? 'PASS' : w50 <= 15000 ? 'WARN' : 'FAIL', `감사 ${r5.audit}행에서 저장 1건 p50 ${w50}ms · 최대 ${Math.max(...bigWrites)}ms (쓸 때마다 시트를 읽는 R3 구조의 확장 한계 확인, 기준 ≤5000ms${w50 > 5000 ? ' — 초과 시 R3 최적화 필요' : ''})`, w50));
  items.push(liveItem('C3', integOk && coerceOk ? 'PASS' : 'FAIL', `텍스트 서식 보존·무결성(5천행 왕복) ${integOk ? 'OK' : `문제 ${integIssues}건`}`));
  return items;
}
export const liveSheets = env => [...liveSheetsIo(env), ...liveSheetsRead(env)];

// ── G 백업·복원 리허설 ──
export function liveBackup(env) {
  const items = [], A = { actor: 'live' }, DAY = 86400000;
  let g1;
  for (let k = 0; k < 4; k++) {                                // 폴링 등 다른 실행이 락을 잡고 있으면 잠시 뒤 다시 시도(최대 4회)
    try { const { r, ms } = liveMs(env, () => backupRun(env.realBackup(), { now: env.now() })); g1 = { r, ms }; break; } catch (e) { g1 = { err: String(e && e.code ? e.code : e && e.message ? e.message : e).slice(0, 60) }; if (!(e && e.code === 'LOCK')) break; if (typeof env.sleep === 'function') env.sleep(3000); }
  }
  items.push(g1.err ? liveItem('G1', 'FAIL', `테스트 시트 백업 실패: ${g1.err} (drive.file 권한 확인 필요)`) : liveItem('G1', ['ok', 'exists'].includes(g1.r.status) ? (g1.ms <= LIVE_THRESH.backupPassMs ? 'PASS' : 'WARN') : 'FAIL', `테스트 시트 백업 ${g1.r.status} ${g1.ms}ms${g1.r.verified ? ' · 사본 검증 통과' : ''}`, g1.ms));
  const scr = env.newScratch('backup'), d = liveDataset(200); liveDump(d, scr.se); deployMarkEnv(scr.se, 'test'); storeCreate(scr.se, 'setting', { name: 'backupKeep', value: '2' }, A);
  const benv = { sourceId: scr.id, storeEnv: () => scr.se, drive: env.scratchDrive() }, t1 = env.now(); let runs = [];
  try { for (let i = 0; i < 3; i++) runs.push(backupRun(benv, { now: t1 + i * 7 * DAY })); } catch (e) { runs.push({ status: `error:${String(e && e.code || e && e.message).slice(0, 40)}` }); }
  const list = benv.drive.list(benv.drive.ensureFolder()), trashed = runs.reduce((a, r) => a + (r.trashed ? r.trashed.length : 0), 0);
  items.push(liveItem('G2', runs.length === 3 && runs.every(r => r.status === 'ok') && list.length === 2 && trashed === 1 ? 'PASS' : 'FAIL', `연속 3회 백업 후 보관 ${list.length}개(기준 2), 휴지통 이동 ${trashed}건, 상태 ${runs.map(r => r.status).join('/')}`));
  items.push(liveItem('G3', runs.length === 3 && runs.every(r => r.status === 'ok') ? 'PASS' : 'FAIL', `사본 생성·휴지통 이동 권한 ${runs.every(r => r.status === 'ok') ? '정상' : '실패(권한 범위 조정 필요)'}`));
  const live0 = JSON.stringify(backupFingerprint(scr.se)); let rest = null, g4;
  try { const latest = list.sort((a, b) => (a.name < b.name ? 1 : -1))[0]; rest = backupRestore(benv, latest.id, { now: t1 + 30 * DAY }); g4 = JSON.stringify(backupFingerprint(scr.se)) === live0 && storeIntegrityCheck(benv.drive.openStore(rest.id)).ok; } catch (e) { g4 = false; }
  items.push(liveItem('G4', g4 ? 'PASS' : 'FAIL', `복원은 새 사본으로 생성·검증, 원본 불변 ${g4 ? '확인' : '실패'}`));
  let g5 = false, g6 = false;
  if (rest) { env.tamper(rest.id); const ic = storeIntegrityCheck(benv.drive.openStore(rest.id)), sw = backupSwitchChecks(benv, rest.id, { expectEnv: 'test' }); g5 = !ic.ok && !sw.ok; g6 = backupSwitchChecks(benv, nullishOr(nullishOr(list.find(x => x.id !== rest.id), {}).id, rest.id), { expectEnv: 'prod' }).issues.includes('env-mismatch'); }
  items.push(liveItem('G5', g5 ? 'PASS' : 'FAIL', `임시 복원본 변조(셀 1개) ${g5 ? '무결성 실패로 탐지·전환 거부' : '탐지 실패'}`));
  items.push(liveItem('G6', g6 ? 'PASS' : 'FAIL', `환경 표식 불일치(test 시트를 prod 기대로 점검) ${g6 ? '거부' : '통과됨(위험)'}`));
  storeCreate(scr.se, 'setting', { name: 'backupTelegramCsv', value: 'on' }, A); const h0 = env.httpCount(); let g7;
  try { const r = backupRun(benv, { now: t1 + 40 * DAY }); g7 = r.warnings.includes('telegram-csv-unsupported') && env.httpCount() === h0; } catch (e_) { g7 = false; }
  items.push(liveItem('G7', g7 ? 'PASS' : 'FAIL', `Telegram CSV 설정을 켜도 전송 0건(경고만) ${g7 ? '확인' : '실패'}`));
  return items;
}
// 구간: 빠른 것(A·B)은 시작 즉시, 느린 것(C·G)은 백그라운드로 나눠 돌린다. 한 구간은 Apps Script 실행 한도(6분) 안에 끝나는 크기.
export const LIVE_SECTIONS = Object.freeze([['A', liveCompat], ['B', liveEngine], ['C-io', liveSheetsIo], ['C-read', liveSheetsRead], ['G', liveBackup]]);
export const LIVE_FAST_SECTIONS = Object.freeze(['A', 'B']);
export const LIVE_SLOW_SECTIONS = Object.freeze(['C-io', 'C-read', 'G']);
export function liveRunSection(name, env) { const f = LIVE_SECTIONS.find(([n]) => n === name); if (!f) throw new Error(`알 수 없는 구간: ${name}`); return f[1](env); }
export function liveAutoAll(env) { return LIVE_SECTIONS.flatMap(([, f]) => f(env)); }
