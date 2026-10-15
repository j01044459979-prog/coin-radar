// 배포된 Worker 가 어떤 코드인지 production 에서 바로 확인하기 위한 식별 정보 (/api/health, /api/intelligence/status 에 표시).
// 코드를 바꾸는 PR 마다 WORKER_VERSION / API_REVISION 을 올립니다 (테스트가 형식을 확인).
import { SCHEMA_VERSION } from './intel/store.js';

export const WORKER_VERSION = '0.7.1';
export const API_REVISION = '6B-r2'; // 6B-r2 = Phase 6B + 운영 수정(수집 CPU 안정화, 진단 분리, 배포 식별)
export const INTEL_API_VERSION = 3; // /api/intelligence/* 응답 형식 세대 (1=6A, 2=6A 운영 수정, 3=6B)
export const FEATURES = [
  'monitor.upbit',
  'intelligence.official', 'intelligence.news', 'intelligence.diagnostics.v3',
  'intelligence.telegram', 'intelligence.attention', 'intelligence.community(default-off)',
];

// env.CF_VERSION_METADATA: wrangler.toml 의 [version_metadata] 바인딩. Cloudflare 가 배포(버전)마다 id/timestamp 를 넣어줍니다.
export function deployInfo(env = {}) {
  const vm = env && env.CF_VERSION_METADATA;
  return {
    worker_version: WORKER_VERSION,
    api_revision: API_REVISION,
    intelligence: { api_version: INTEL_API_VERSION, schema_version: SCHEMA_VERSION, features: FEATURES },
    deployment: vm && typeof vm === 'object' ? { version_id: vm.id ?? null, tag: vm.tag || null, deployed_at: vm.timestamp ?? null } : null,
  };
}
