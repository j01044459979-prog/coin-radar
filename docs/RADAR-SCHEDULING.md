# COIN RADAR 무료 5분 자동 실행 안정화

## 1. 문제 (실측)
main의 GitHub `schedule`(`*/5 * * * *`) 실제 시작 간격(2026-10-14 23:29 ~ 10-15 07:54 KST 기준 UTC, 18회·17개 간격):
**최소 15분 · 중앙값 28분 · 평균 약 30분 · 최대 44분** (목표 5분). GitHub 공식 문서도 고부하 시 schedule이 지연되거나 일부 큐가 버려질 수 있다고 안내하며 정확한 주기를 보장하지 않습니다.

## 2. 무료 실행 구조 비교
| 방식 | 무료 여부 | 5분 주기 | 판단 |
|---|---|---|---|
| GitHub `schedule` 단독 | 무료 | 실측 15~44분 지연 | 백업으로만 유지 |
| **Cloudflare Workers Cron Trigger → GitHub `workflow_dispatch`** | 무료 플랜 | 가능(분 단위 cron) | **선택** |
| Cloudflare Worker가 분석 전체를 직접 실행 | 무료 | — | 불가: 무료 CPU 10ms/호출, 서브요청 50개/호출 (분석은 OKX 약 220회 호출) |
| cron-job.org 등 외부 무료 cron | 무료 | 가능 | GitHub 토큰을 제3자 서비스에 맡겨야 해서 제외 |
| Google Apps Script 트리거 | 무료 | 1분 이상 | 토큰을 스크립트에 보관, 계정 종속 → 차선책 |
| Oracle 무료 VM 등 상시 서버 | 무료지만 | 가능 | "사용자 PC·서버 없음" 조건과 맞지 않아 제외 |

선택 이유: 이 저장소 계정에는 이미 Cloudflare Worker(`coin-radar-engine`)가 1분 cron으로 정상 동작 중이라 무료 Cron Trigger가 검증되어 있고, 분석·Telegram 전송·비밀값(Telegram)은 지금처럼 GitHub Actions 안에 그대로 두며, 디스패처는 "시작 신호"만 보냅니다.

Cloudflare 무료 플랜 한도(공식 문서): 요청 100,000/일, Cron Trigger 계정당 5개, 호출당 CPU 10ms(네트워크 대기 시간은 CPU에 불포함), 서브요청 50개/호출. 기존 Worker가 cron 2개를 쓰므로 디스패처 1개를 더해 3개. **한계**: Cloudflare cron도 시각 보증(SLA)은 없습니다. 실제 지연은 배포 후 로그로 확인해야 하며 이 PR에서는 미검증입니다(실배포 금지 조건).

## 3. 월 예상 무료 사용량
- Cloudflare: cron 288회/일 ≈ 8,640회/월(일 한도의 약 0.3%), 호출당 서브요청 2~3개(목록 조회 + dispatch), CPU는 1ms 미만 수준 예상. 기존 Worker(2,160회/일)와 합쳐도 일 한도의 약 2.5%.
- GitHub Actions: 실행 1회 약 2~3분 × 8,640 ≈ 월 21,600분(약 360시간). **공개 저장소의 표준 러너는 무료**입니다. 저장소를 비공개로 바꾸면 무료 한도(월 2,000분)를 넘으므로 비공개 전환 금지. 게이트에서 건너뛴 실행은 약 10~15초.
- GitHub API: dispatch 288회/일. 토큰 한도(시간당 5,000)에 비해 매우 적음.

## 4. 중복 실행 방지 (4겹)
1. **슬롯 번호**: 디스패처가 `slot = floor(예정시각/5분)`을 입력으로 보내고, 실행 이름에 `slot N`이 들어갑니다(`run-name`). dispatch 전에 최근 실행 목록에서 같은 슬롯이 있으면 건너뜁니다(cron 이중 발화·재시도).
2. **재시도 안전성**: dispatch 응답이 5xx/네트워크 오류여도 GitHub가 이미 접수했을 수 있으므로 재시도 전에 해당 슬롯 실행이 생겼는지 먼저 재조회합니다. 최대 3회, 짧은 Retry-After만 대기, 401/403/404/422는 재시도하지 않고 원인 힌트만 기록.
3. **대기 중 실행 확인**: 15분 이내에 대기(queued) 중인 실행이 이미 있으면 새로 보내지 않습니다(멈춘 대기 실행이 영구 차단하지 않도록 15분 초과분은 무시).
4. **워크플로 게이트**(`radar-service/gate.mjs`, 단위 테스트 포함): 캐시 복원 직후 직전 시도 시각으로 판단
   - Cloudflare 디스패치: `RADAR_SCHEDULER=cloudflare`일 때만 실행, 직전 시도 90초 이내면 중복으로 건너뜀. **`github`(롤백) 상태면 무시**.
   - GitHub schedule: 변수가 `cloudflare`면 평소엔 대기, **마지막 시도가 15분 넘게 없으면 대신 실행**(Cloudflare 장애 자동 복구).
   - 수동 실행·푸시: 항상 허용.
   - `concurrency: radar` + `cancel-in-progress: false`는 그대로(동시 실행 금지). 단, "대기 1개가 새 대기로 교체되는지" 같은 GitHub 내부 동작은 공식 문서로 확인하지 못해 **의존하지 않도록** 위 1~4번으로 설계했습니다.
5. Telegram 중복: 기존 정기 보고(시간대 1회)·긴급 알림 쿨다운·`state.partial` 재개 로직이 그대로 적용되고, 수집 자체가 슬롯당 1회로 제한되어 중복 가능성이 더 낮아집니다.

## 5. 캐시(상태) 안정성
- 복원: `key: radar-state-${run_id}`는 항상 미스 → `restore-keys: radar-state-` 접두어 중 **가장 최근에 만들어진 캐시**가 복원됩니다. `concurrency`로 실행이 직렬화되어 "최신 = 직전 실행"이 보장됩니다. 캐시는 브랜치별로 격리되어(feature 브랜치 프리뷰 캐시는 main이 읽지 않음) main의 schedule/dispatch 실행끼리만 상태를 이어받습니다. 7일 미사용·저장소 10GB 초과 시 오래된 것부터 삭제되나 5분마다 갱신되어 해당 없음.
- 수동 실행/재시도(re-run): 같은 run_id의 attempt 2는 `...-2` 키로 저장되어 충돌하지 않고 항상 최신이 복원됩니다.
- 저장 실패 대응(신규): 저장 검증이 실패하면 `-retry` 키로 다시 저장·검증하고, 그것도 실패해야 실행이 빨갛게 표시됩니다(상태가 오래된 값으로 되돌아가 보고가 중복되는 위험 감소).
- 손상 대응(신규): 상태 JSON이 깨져 있으면 이전에는 실행이 계속 실패했습니다(가장 최근 캐시가 계속 복원되므로 영구 정지). 이제 원본을 `state.corrupt-<시각>.json`으로 보존하고 새 상태로 시작하며 `::warning::`을 남깁니다(정기 보고 1회 중복 가능).
- 추적(신규): 저장마다 `seq`, `savedAt`을 기록하고 게이트 로그에 복원된 값을 출력해 어떤 캐시가 복원됐는지 확인할 수 있습니다.
- 대안 비교: ① Cloudflare KV(무료 쓰기 1,000회/일 — 288회면 가능하나 Actions에서 Cloudflare 토큰이 추가로 필요) ② 별도 `radar-state` 브랜치에 커밋(영구적이지만 5분마다 커밋 1년 10만 건, 노이즈) ③ Gist. 현재 방식(캐시+검증+재저장)이 추가 비밀값·권한 없이 충분하다고 판단해 유지하고, 캐시 유실이 실제로 반복되면 KV로 전환하는 것을 권합니다.

## 6. 전환 절차 (사용자 승인 후, 한 단계씩)
0. PR 병합(승인). 워크플로가 main에 있어야 dispatch 입력(`source`, `slot`)이 인식됩니다. 병합 직후에는 변수가 없으므로 기존 GitHub schedule 방식 그대로입니다.
1. GitHub 토큰 만들기 — https://github.com/settings/personal-access-tokens/new : Repository access = *Only select repositories* → coin-radar 하나, Permissions → **Actions: Read and write**(Metadata: Read-only 자동), 만료 90일~1년. 생성된 토큰은 채팅에 붙여넣지 않습니다.
2. Cloudflare 대시보드 → Workers & Pages → Create → 이름 `coin-radar-dispatcher` → `scheduler/worker.mjs` 내용을 붙여넣어 배포.
3. Settings → Variables and Secrets: Secret `GITHUB_DISPATCH_TOKEN`(1단계 토큰), Variable `DISPATCH_ENABLED=false`(아직 꺼 둠). Settings → Triggers → Cron `*/5 * * * *` 추가. (`scheduler/wrangler.toml`에 같은 값이 있음.)
4. 확인: 몇 분 뒤 Worker 로그에 `"decision":"disabled"`가 5분마다 찍히면 cron이 정상. 이때 GitHub는 호출하지 않습니다.
5. 전환: GitHub → Settings → Secrets and variables → Actions → Variables → `RADAR_SCHEDULER` = `cloudflare` 추가 → 이어서 Worker의 `DISPATCH_ENABLED`를 `true`로. (순서가 바뀌어도 게이트가 중복을 막습니다.)
6. 확인(15~20분): Actions 목록에 `radar · workflow_dispatch · cloudflare · slot N`이 5분 간격으로 나타나고, GitHub schedule 실행은 "건너뜀" 로그(`GATE 건너뜀`)와 함께 짧게 끝나야 합니다.
7. **롤백**: `RADAR_SCHEDULER` 변수를 `github`로 바꾸거나 삭제(즉시 적용 — 디스패치는 게이트에서 무시) + Worker `DISPATCH_ENABLED=false`. 코드 변경·재배포 불필요.
8. 유지: 토큰 만료 전에 재발급해 Secret만 교체. 만료/권한 오류는 Worker 로그에 `rejected`(401/403)로 남고, 그동안 GitHub schedule이 15분 공백 후 자동으로 대신 실행됩니다.

## 7. 미검증 사항(정직한 한계)
- 실제 Cloudflare cron 지연과 dispatch 후 러너 시작 지연은 배포 후 측정 필요(이 PR에서는 배포·실행 금지).
- GitHub 대기열 교체/60일 무활동 시 schedule 자동 비활성화 등 일부 동작은 공식 문서를 이 환경에서 직접 확인하지 못했습니다(문서 사이트 접근 불가). 설계는 이에 의존하지 않습니다.
- 5분 정확성은 보장되지 않으며 목표는 "대부분 5~7분 이내".
