// 연구 실행기:  node radar-service/backtest/research-cli.mjs data.json.gz [--final --expect-hash HASH] [--out results.json]
// 기본은 개발·검증·이미 본 구간만 실행한다. --final은 규칙을 고정(해시 일치)한 뒤 최종 테스트 구간을 '한 번' 평가할 때만 쓴다.
import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { runResearch, VARIANTS, UNIVERSE_N } from './research.mjs';
import { jointCollector, diagnostics, engineAudit, hypothesisTables, judge, PREREG, REGIMES } from './research-report.mjs';
import { summary } from './stats.mjs';

const RULE_FILES = ['../dual/strategyA.mjs', '../dual/strategyB.mjs', '../dual/combine.mjs', '../dual/indicators.mjs', './engine.mjs', './strategies.mjs', './research.mjs', './stats.mjs'];
export function rulesHash() {
  const h = createHash('sha256');
  for (const f of RULE_FILES) h.update(f).update(readFileSync(new URL(f, import.meta.url)));
  return h.digest('hex').slice(0, 16);
}
const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : x === Infinity ? '∞' : '-');
const iso = t => (Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '∞');

export function buildReport(res, J, { final, hash }) {
  const L = [], T1 = res.trades[1];
  L.push(`# 듀얼 전략 3.0 손실 원인 분석 · 가설 검증 보고`);
  L.push(`- 규칙 해시 \`${hash}\` (전략·엔진·연구 코드 해시; 최종 테스트는 이 값을 고정한 뒤 1회만 실행) · 최종 테스트 구간 ${final ? '**포함(이번 실행이 유일한 평가)**' : '미포함(규칙 고정 전)'}`);
  L.push(`- 데이터: BTC ${res.prep.bars.toLocaleString()}봉 ${iso(res.prep.from)}~${iso(res.prep.to)} · 세그먼트 ${res.prep.symbols}개 · 구간별 유동성 유니버스 상위 ${UNIVERSE_N}종목(구간 시작 직전 30일 거래대금 기준)`);
  L.push(`| 구간 | 기간 | 유니버스 |\n|---|---|---|\n` + res.active.map(p => `| ${res.periods[p].label} | ${iso(res.periods[p].from)} ~ ${iso(res.periods[p].to)} | ${res.universe[p].length}종목 |`).join('\n'));
  L.push(`\n## 1. 백테스트 엔진 검증\n${engineAudit(res).text}`);
  L.push(`\n## 2. 손실 원인 분해\n${diagnostics(res, J)}`);
  L.push(`\n## 3. 가설 H1/H2/H3 독립 비교 (비용 1배)\n${hypothesisTables(res, 1)}`);
  // 요약표
  const names = [...VARIANTS.base, ...VARIANTS.h1, ...VARIANTS.h2, ...VARIANTS.h2x, ...(res.allow ? VARIANTS.h3 : [])];
  L.push(`\n## 4. 변형 × 구간 요약 (비용 반영, 평균 R / PF / 거래 수)\n| 변형 | ` + res.active.map(p => res.periods[p].label.split('(')[0]).join(' | ') + ` |\n|---|` + res.active.map(() => '---|').join(''));
  for (const v of names) L.push(`| ${v} | ` + res.active.map(p => { const s = summary(T1[p]?.[v] ?? []); return s.n ? `${f(s.avg)}R / ${f(s.pf, 2)} / ${s.n}${s.ci && s.ci[0] > 0 ? ' ✓' : ''}` : '-'; }).join(' | ') + ' |');
  L.push('(✓ = 주 블록 부트스트랩 95% 구간 하한 > 0)');
  // 사전 등록 판정
  const cand = ['A', 'B', 'AB', 'legacy2', 'A_H2', 'B_H1', 'AB_H1', 'AB_H2', ...(res.allow ? ['A_H3', 'B_H3', 'AB_H3'] : [])];
  const target = final ? 'final' : 'val';
  L.push(`\n## 5. 사전 등록 기준 판정 — ${res.periods[target].label}`);
  L.push(`기준: ${PREREG.minTrades}건 이상 · 비용 반영 기대값 > 0 · 95% 하한 > 0 · PF ≥ ${PREREG.pfMin} · 국면/종목 집중 없음 · 비용 ${PREREG.stress.join('·')}배 스트레스에서도 기대값 > 0. **통과해도 운영 적용 대상이 아니다.**`);
  const verdicts = cand.map(v => judge(res, v, target));
  L.push(`| 변형 | 판정 | 실패한 기준 |\n|---|---|---|\n` + verdicts.map(j => `| ${j.variant} | ${j.pass ? '✅ 통과' : '❌ 실패'} | ${j.checks.filter(c => !c.pass).map(c => c.name + ' (' + c.detail + ')').join('; ') || '-'} |`).join('\n'));
  L.push(`\n세부(전체 기준 값):\n` + verdicts.map(j => `- **${j.variant}** n=${j.n}: ` + j.checks.map(c => `${c.pass ? '✅' : '❌'} ${c.name}: ${c.detail}`).join(' / ')).join('\n'));
  L.push(`\n## 6. 시험 기록 (다중 비교 주의)\n- 평가한 변형 수: ${names.length}개 × 구간 ${res.active.length}개 × 비용 배율 ${Object.keys(res.trades).length}개 (엔진 실행 ${res.evaluated}회). 사전 등록 가설은 H1·H2·H3 세 개이고, H2의 12봉 변형(\`A_H2x12\`, \`AB_H2x12\`)과 진단용 원시 신호(\`Araw\`, \`Braw\`)는 탐색용이다.\n- 개발 구간에서만 도출한 값: H3 허용 국면. 그 밖의 파라미터(75점, 36봉 등)는 결과를 보기 전에 정한 값이고 바꾸지 않았다.`);
  return { markdown: L.join('\n'), verdicts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), file = args[0];
  if (!file || !existsSync(file)) { console.error('사용법: node research-cli.mjs data.json.gz [--final --expect-hash H] [--out results.json] [--cost-mults 1,1.5,2]'); process.exit(2); }
  const flag = k => args.includes(`--${k}`), val = k => { const i = args.indexOf(`--${k}`); return i > 0 ? args[i + 1] : null; };
  const hash = rulesHash();
  if (flag('final') && val('expect-hash') !== hash) { console.error(`최종 테스트 중단: 규칙 해시 불일치 (현재 ${hash}, 기대 ${val('expect-hash')}). 규칙을 고정한 뒤 해시를 지정하세요.`); process.exit(3); }
  const raw = readFileSync(file), data = JSON.parse((file.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8'));
  const mults = (val('cost-mults') || '1,1.5,2').split(',').map(Number);
  const t0 = Date.now(), jc = jointCollector();
  const res = runResearch(data, { final: flag('final'), costMults: mults, onSegment: jc.hook });
  const { markdown, verdicts } = buildReport(res, jc.J, { final: flag('final'), hash });
  console.log(markdown); console.log(`\n(계산 ${((Date.now() - t0) / 1000).toFixed(1)}초)`);
  const out = val('out');
  if (out) writeFileSync(out, JSON.stringify({ hash, final: flag('final'), verdicts, allow: res.allow ? Object.fromEntries(Object.entries(res.allow).map(([k, v]) => [k, { allowed: [...v.allowed], table: v.table }])) : null, universe: res.universe }));
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' });
}
