// 4.0 연구 실행기:  node radar-service/backtest/research4-cli.mjs data.json.gz [--out results.json] [--cost-mults 1,1.5,2]
// 기본은 개발·검증·이미 본 구간만 실행한다. --final 은 후보 규칙을 동결(해시 일치)하고 사용자 승인을 받은 뒤 최종 테스트 구간을 '한 번' 평가할 때만 쓴다.
import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { runResearch4 } from './research4.mjs';
import { build4 } from './research4-report.mjs';

const RULE_FILES = ['../dual/strategy4.mjs', '../dual/indicators.mjs', './engine.mjs', './strategies.mjs', './research.mjs', './research4.mjs', './stats.mjs', './stats4.mjs'];
export function rulesHash4() {
  const h = createHash('sha256');
  for (const f of RULE_FILES) h.update(f).update(readFileSync(new URL(f, import.meta.url)));
  return h.digest('hex').slice(0, 16);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), file = args[0];
  if (!file || !existsSync(file)) { console.error('사용법: node research4-cli.mjs data.json.gz [--final --expect-hash H] [--out results.json] [--cost-mults 1,1.5,2]'); process.exit(2); }
  const flag = k => args.includes(`--${k}`), val = k => { const i = args.indexOf(`--${k}`); return i > 0 ? args[i + 1] : null; };
  const hash = rulesHash4();
  if (flag('final') && val('expect-hash') !== hash) { console.error(`최종 테스트 중단: 규칙 해시 불일치 (현재 ${hash}, 기대 ${val('expect-hash')}). 후보 규칙을 동결하고 사용자 승인을 받은 뒤 해시를 지정하세요.`); process.exit(3); }
  const raw = readFileSync(file), data = JSON.parse((file.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8'));
  const mults = (val('cost-mults') || '1,1.5,2').split(',').map(Number), t0 = Date.now();
  const periods = flag('final') ? ['final'] : ['dev', 'val', 'seen'], pool = flag('final') ? ['final'] : ['val', 'seen'];
  const res = runResearch4(data, { periods, costMults: mults });
  const { markdown, verdicts } = build4(res, { hash, final: flag('final'), pool });
  console.log(markdown); console.log(`\n(계산 ${((Date.now() - t0) / 1000).toFixed(1)}초)`);
  if (val('out')) writeFileSync(val('out'), JSON.stringify({ hash, final: flag('final'), pool, verdicts, universe: res.universe }));
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' });
}
