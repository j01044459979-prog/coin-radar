// Cloudflare 디스패처 배포 검증 (읽기 전용 API 호출). 토큰은 환경변수로만 받고 출력하지 않는다.
//  node scheduler/verify-deploy.mjs snapshot   → 기존 웹사이트 Worker의 수정 시각을 기록
//  node scheduler/verify-deploy.mjs verify     → 디스패처가 '꺼진 상태'로 올바르게 배포됐고 웹사이트 Worker가 그대로인지 확인
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const DISPATCHER = 'coin-radar-dispatcher';
export const WEBSITE_WORKER = 'coin-radar-engine';   // 기존 웹사이트 Worker — 절대 수정하지 않는다
const API = 'https://api.cloudflare.com/client/v4';

async function cf(fetchImpl, token, path) {
  const res = await fetchImpl(`${API}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  let body = null; try { body = await res.json(); } catch { /* 본문 없음 */ }
  return { status: res.status, ok: res.ok && body?.success !== false, result: body?.result ?? null };
}

// 순수 판정: API 응답 묶음 → 항목별 결과. 하나라도 fail이면 배포 검증 실패.
export function evaluateDeploy({ schedules, settings, subdomain, scripts, engineBefore }) {
  const checks = [];
  const add = (name, ok, detail, level = ok ? 'pass' : 'fail') => checks.push({ name, ok: level !== 'fail', level, detail });
  const cron = (schedules?.schedules ?? []).map(s => s.cron);
  add('Cron Trigger */5 등록', cron.includes('*/5 * * * *'), `등록된 cron: ${cron.join(', ') || '없음'}`);
  add('Cron Trigger 개수 1개(무료 한도 보호)', cron.length === 1, `${cron.length}개`);
  const bindings = settings?.bindings ?? [];
  const get = n => bindings.find(b => b.name === n);
  add('DISPATCH_ENABLED=false (dispatch 꺼짐)', get('DISPATCH_ENABLED')?.type === 'plain_text' && String(get('DISPATCH_ENABLED').text) === 'false', `값: ${get('DISPATCH_ENABLED')?.text ?? '없음'}`);
  add('GITHUB_DISPATCH_TOKEN Secret 등록(값은 조회 불가)', get('GITHUB_DISPATCH_TOKEN')?.type === 'secret_text', `종류: ${get('GITHUB_DISPATCH_TOKEN')?.type ?? '없음'}`);
  add('Telegram·D1 바인딩 없음', !bindings.some(b => /TELEGRAM|^DB$/i.test(b.name) || b.type === 'd1'), `바인딩: ${bindings.map(b => b.name).join(', ')}`);
  if (subdomain) add('workers.dev 공개 URL 꺼짐', subdomain.enabled === false, `enabled=${subdomain.enabled}`);
  else add('workers.dev 공개 URL 꺼짐', true, '확인 API 응답 없음(코드가 fetch에서 404를 반환하므로 정보 노출 없음)', 'warn');
  const names = (scripts ?? []).map(s => s.id);
  const engine = (scripts ?? []).find(s => s.id === WEBSITE_WORKER);
  add('웹사이트 Worker 존재', Boolean(engine), engine ? '존재' : '없음');
  add('웹사이트 Worker 수정 안 됨', Boolean(engine) && Boolean(engineBefore) && engine.modified_on === engineBefore, `전 ${engineBefore ?? '?'} / 후 ${engine?.modified_on ?? '?'}`);
  add('디스패처 스크립트 존재', names.includes(DISPATCHER), names.includes(DISPATCHER) ? '존재' : '없음');
  return { ok: checks.every(c => c.ok), checks };
}

export async function run(mode, { env = process.env, fetchImpl = fetch, readText = p => readFile(p, 'utf8'), writeText = (p, t) => writeFile(p, t) } = {}) {
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, RUNNER_TEMP = '.' } = env;
  if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID 가 필요합니다');
  const base = `/accounts/${account}/workers/scripts`;
  const snapshotFile = `${RUNNER_TEMP}/engine-modified-on.txt`;
  const list = await cf(fetchImpl, token, base);
  if (!list.ok) throw new Error(`Worker 목록 조회 실패(HTTP ${list.status}) — 토큰 권한(Workers Scripts 읽기)과 계정 ID를 확인하세요`);
  if (mode === 'snapshot') {
    const engine = list.result.find(s => s.id === WEBSITE_WORKER);
    await writeText(snapshotFile, engine?.modified_on ?? '');
    return { mode, engineModifiedOn: engine?.modified_on ?? null, scripts: list.result.map(s => s.id) };
  }
  const [schedules, settings, subdomain] = await Promise.all([cf(fetchImpl, token, `${base}/${DISPATCHER}/schedules`), cf(fetchImpl, token, `${base}/${DISPATCHER}/settings`), cf(fetchImpl, token, `${base}/${DISPATCHER}/subdomain`)]);
  const engineBefore = (await readText(snapshotFile).catch(() => '')).trim();
  return { mode, ...evaluateDeploy({ schedules: schedules.ok ? schedules.result : null, settings: settings.ok ? settings.result : null, subdomain: subdomain.ok ? subdomain.result : null, scripts: list.result, engineBefore }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const out = await run(process.argv[2] === 'snapshot' ? 'snapshot' : 'verify');
    if (out.mode === 'snapshot') console.log(`기존 Worker 목록: ${out.scripts.join(', ')} · 웹사이트 Worker 수정 시각 기록: ${out.engineModifiedOn ?? '(없음)'}`);
    else {
      const icon = { pass: '✅', warn: '⚠️', fail: '❌' };
      const lines = out.checks.map(c => `${icon[c.level]} ${c.name} — ${c.detail}`);
      console.log(lines.join('\n'));
      if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### 디스패처 배포 검증 (dispatch 꺼짐 상태)\n${lines.map(l => `- ${l}`).join('\n')}\n`);
      if (!out.ok) { console.log('::error title=배포 검증 실패::위 ❌ 항목을 확인하세요'); process.exit(1); }
    }
  } catch (error) { console.log(`::error title=배포 검증 오류::${String(error.message).replace(/[\r\n]+/g, ' ').slice(0, 200)}`); process.exit(1); }
}
