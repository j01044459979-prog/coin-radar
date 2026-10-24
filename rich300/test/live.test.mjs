import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { memEnv } from './helpers/memenv.mjs';
import { fakeDrive, liveStore } from './helpers/fakedrive.mjs';
import { storeInit, storeIntegrityCheck, storeLoadLedgerInputs } from '../lib/store.mjs';
import { deployMarkEnv } from '../lib/deploy.mjs';
import { liveSha256, liveDataset, liveCompat, liveEngine, liveSheets, liveBackup, liveAutoAll, LIVE_SHA_VECTORS, LIVE_THRESH } from '../lib/liveverify.mjs';
import { LIVE_DEC_VECTORS, LIVE_IDEAL_VECTORS, LIVE_PNL_VECTORS, LIVE_HMAC_VECTORS } from '../lib/livevectors.mjs';

const node = s => createHash('sha256').update(s, 'utf8').digest('hex');
function ports(over = {}) {
  const d = fakeDrive({ live: null }), real = liveStore(); deployMarkEnv(real.env, 'test'); const d2 = fakeDrive({ live: real }); let n = 0, clock = { t: 0, step: 0, real: true };
  const p = {
    now: () => (clock.real ? Date.now() : (clock.t += clock.step)), clock,
    hmacSha256: (k, m) => createHmac('sha256', k).update(m, 'utf8').digest('hex'), sha256: node, tz: () => 'Asia/Seoul', formatKst: ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' '),
    selfTest: () => ({ fail: 0, warn: 0, items: [] }),
    newScratch: label => { const m = memEnv({ fixedClock: true }); storeInit(m.env); deployMarkEnv(m.env, 'test'); const id = `S${++n}-${label}`; d.put(id, id, 'F0', m); return { se: m.env, id }; },
    scratchDrive: () => d.drive, realBackup: () => ({ sourceId: 'SRC', storeEnv: () => real.env, drive: d2.drive }),
    tamper: id => { d.files.get(id).mem.sheets.get('Fills')[0][4] = '{"tampered":"yes"}'; }, httpCount: () => 0, ...over };
  return { p, d, d2, real, clock };
}
const byId = items => Object.fromEntries(items.map(i => [i.id, i]));

test('JS SHA-256: 표준 벡터 일치, 시험 데이터의 해시 체인이 node crypto 와 동일, 5천 행 데이터가 빠르게 만들어지고 무결성 통과', () => {
  for (const [s, h] of LIVE_SHA_VECTORS) assert.equal(liveSha256(s), h);
  for (const s of ['a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), '한'.repeat(40), '𝒳𝒴🙂'.repeat(9)]) assert.equal(liveSha256(s), node(s), s.length);       // 패딩 경계·UTF-8 4바이트
  const a = liveDataset(300), b = liveDataset(300, { sha: node }); assert.equal(JSON.stringify(a.sheets.get('Audit')), JSON.stringify(b.sheets.get('Audit')));
  const t0 = Date.now(), big = liveDataset(5000); assert.ok(Date.now() - t0 < 3000); assert.ok(big.audit >= 5000 && big.audit <= 5012); const ic = storeIntegrityCheck(big.se); assert.equal(ic.ok, true); assert.equal(storeLoadLedgerInputs(big.se).fills.length > 1500, true);
  assert.ok(liveDataset(500).audit >= 500);
});
test('벡터 파일은 독립 기준(Python)과 고정 크기·형식: 24+34+40+30개, 큰 수는 문자열(정밀도 손실 방지)', () => {
  assert.deepEqual([LIVE_DEC_VECTORS.length, LIVE_IDEAL_VECTORS.length, LIVE_PNL_VECTORS.length, LIVE_HMAC_VECTORS.length], [24, 34, 40, 30]);
  assert.ok(LIVE_DEC_VECTORS.every(v => typeof v.mul === 'string' && typeof v.div === 'string' && typeof v.micro === 'string')); assert.ok(LIVE_IDEAL_VECTORS.every(([n, m]) => Number.isInteger(n) && typeof m === 'string'));
  const fx = JSON.parse(readFileSync(new URL('./fixtures/hmac-vectors.json', import.meta.url), 'utf8')); assert.equal(JSON.stringify(LIVE_HMAC_VECTORS[7].sig), JSON.stringify(fx[7].sig));
  const src = readFileSync(new URL('../lib/livevectors.mjs', import.meta.url), 'utf8'); assert.ok(!/\b\d{16,}\b(?![^"]*")/.test(src.replace(/"[^"]*"/g, '""')));      // 따옴표 밖의 16자리 이상 숫자 없음
});
test('A 호환성: Node 포트에서 A1~A4 모두 PASS, 포트가 틀리면 해당 항목이 FAIL(HMAC·시간대·KST 경계·자가 점검)', () => {
  const ok = byId(liveCompat(ports().p)); assert.deepEqual(['A1', 'A2', 'A3', 'A4'].map(k => ok[k].status), ['PASS', 'PASS', 'PASS', 'PASS']); assert.match(ok.A1.text, /벡터 \d+\/\d+ 일치/); assert.ok(!/\d{6}:|@/.test(JSON.stringify(ok)));
  assert.equal(byId(liveCompat(ports({ hmacSha256: () => 'bad' }).p)).A2.status, 'FAIL'); assert.equal(byId(liveCompat(ports({ sha256: () => 'bad' }).p)).A2.status, 'FAIL');
  assert.equal(byId(liveCompat(ports({ tz: () => 'UTC' }).p)).A3.status, 'FAIL'); assert.equal(byId(liveCompat(ports({ formatKst: ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') }).p)).A3.status, 'FAIL');       // 시간대가 UTC로 표시되면 경계 불일치
  assert.equal(byId(liveCompat(ports({ selfTest: () => ({ fail: 2, warn: 0, items: [{ id: 'sheet', level: 'fail' }, { id: 'env', level: 'fail' }] }) }).p)).A4.status, 'FAIL'); assert.equal(byId(liveCompat(ports({ selfTest: () => ({ fail: 0, warn: 3, items: [] }) }).p)).A4.status, 'WARN');
});
test('B 엔진 시간: 기준 이하 PASS, 3~10초 WARN(R3 최적화 검토 문구), 10초 초과 FAIL', () => {
  const r = byId(liveEngine(ports().p)); assert.deepEqual([r.B1.status, r.B2.status], ['PASS', 'PASS']); assert.match(r.B1.text, /3285체결/);
  for (const [step, want] of [[4000, 'WARN'], [12000, 'FAIL']]) { const q = ports(); q.clock.real = false; q.clock.step = step; const x = byId(liveEngine(q.p)); assert.equal(x.B1.status, want, `step ${step}`); if (want === 'WARN') assert.match(x.B1.text, /R3 읽기 최적화 검토/); }
});
test('C 실제 시트 저장·읽기: 100회 저장·중복 키·5천 행 왕복·무결성·큰 시트에서의 저장 시간이 항목으로 나오고 느리면 WARN/FAIL', () => {
  const r = byId(liveSheets(ports().p)); assert.deepEqual(['C1', 'C2', 'C3', 'C4', 'C5'].map(k => r[k].status), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS']); assert.match(r.C2.text, /감사 \d+\/\d+\/\d+행/); assert.match(r.C4.text, /duplicate.*conflict.*100건/);
  const at = step => { const q = ports(); q.clock.real = false; q.clock.step = step; return byId(liveSheets(q.p)); };
  const a = at(1200); assert.deepEqual([a.C1.status, a.C2.status, a.C5.status], ['WARN', 'PASS', 'PASS']);
  const b = at(7000); assert.deepEqual([b.C1.status, b.C2.status, b.C5.status], ['FAIL', 'WARN', 'WARN']); assert.match(b.C2.text, /R3 읽기 최적화 필요/); assert.match(b.C5.text, /R3 최적화 필요/);
  const c = at(25000); assert.deepEqual([c.C2.status, c.C5.status], ['FAIL', 'FAIL']);
});
test('G 백업·복원 리허설: 전부 PASS, 사본 생성·휴지통 권한 실패·변조 미탐지·CSV 전송은 해당 항목 FAIL', () => {
  const ok = byId(liveBackup(ports().p)); assert.deepEqual(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'].map(k => ok[k].status), Array(7).fill('PASS')); assert.match(ok.G2.text, /보관 2개.*휴지통 이동 1건/); assert.match(ok.G5.text, /탐지·전환 거부/);
  const q = ports(); q.d.st.copyFail = true; const r1 = byId(liveBackup(q.p)); assert.equal(r1.G2.status, 'FAIL'); assert.equal(r1.G3.status, 'FAIL'); assert.match(r1.G3.text, /권한 범위 조정 필요/);
  const q2 = ports(); q2.d2.st.copyFail = true; const r2 = byId(liveBackup(q2.p)); assert.equal(r2.G1.status, 'FAIL'); assert.match(r2.G1.text, /drive\.file 권한 확인 필요|copy-failed/);
  assert.equal(byId(liveBackup(ports({ tamper: () => {} }).p)).G5.status, 'FAIL'); assert.equal(byId(liveBackup(ports({ httpCount: (() => { let n = 0; return () => n++; })() }).p)).G7.status, 'FAIL');       // 외부 호출이 늘면 G7 실패
});
test('전체 자동 시험(liveAutoAll): 항목 ID 집합·값 없는 텍스트(토큰·이메일·시트 ID 없음), 비밀 토큰이 결과에 들어가지 않음', () => {
  const items = liveAutoAll(ports().p), ids = items.map(i => i.id); assert.deepEqual(ids, ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'C1', 'C4', 'C5', 'C2', 'C3', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'].sort((a, b) => ids.indexOf(a) - ids.indexOf(b)));
  assert.ok(items.every(i => ['PASS', 'FAIL', 'WARN', 'SKIP'].includes(i.status))); const dump = JSON.stringify(items); assert.ok(!/AAF|@[a-z]|SHEET|docs\.google|FOLDER|F\d+-/.test(dump), dump.slice(0, 200)); assert.ok(items.filter(i => i.status === 'FAIL').length === 0);
});
