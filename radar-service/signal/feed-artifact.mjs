// RICH300 추천 피드 산출물 만들기(CLI, radar 워크플로 마지막 단계): node radar-service/signal/feed-artifact.mjs <state.json> <out/feed-raw.json>
//  · 조건(플래그 on · MODE=once · main · 정기/수동 실행)이 맞지 않으면 아무것도 쓰지 않고 정상 종료한다. Secret 을 쓰지 않는다. 로그에는 개수만 남긴다(저장소가 공개라 Actions 로그가 공개).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { feedArtifactOf } from './feed.mjs';

const [stateFile, outFile] = process.argv.slice(2); let state = null;
try { state = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { console.log('feed-artifact: no state'); process.exit(0); }
const r = feedArtifactOf(state, process.env);
if (!r.ok) { console.log(`feed-artifact: skipped (${r.reason})`); process.exit(0); }
mkdirSync(dirname(outFile), { recursive: true }); writeFileSync(outFile, JSON.stringify(r.artifact)); console.log(`feed-artifact: ${r.artifact.entries.length} entries`);
