// S0 붙여 넣기 1회용 파일 생성: Code.gs(프로브) + Engine.gs(엔진 번들). 사용: node rich300/s0/make-all.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const d = new URL('./', import.meta.url);
writeFileSync(new URL('S0-All.gs', d), readFileSync(new URL('Code.gs', d), 'utf8') + '\n' + readFileSync(new URL('Engine.gs', d), 'utf8'));
console.log('S0-All.gs 생성');
