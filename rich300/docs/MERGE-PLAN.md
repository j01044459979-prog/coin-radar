# PR 의존 관계와 병합 순서 (2026-10-23 시점, 병합 보류 상태)

| PR | 브랜치 | base | 내용 | 운영 영향 |
|---|---|---|---|---|
| #31 | `claude/coin-radar-handoff-8f4oju` | main | A/B 알림 카드 + `SIGNAL-DELIVERY` 관측 로그 | **로그 줄 추가**(동작 불변, 7개 시나리오 동치 검증), 카드 모듈은 미연결 |
| #33 | `docs/radar-3-1-design` | main | 3.1·복기 설계서(문서) | 없음 |
| #32 | `feature/rich300-journal` | main | RICH 300 설계·보안·계획 + S0 키트(일회용) | 없음(S0 워크플로는 개발 브랜치 전용) |
| #34 | `feature/rich300-r2-calc` | #32 브랜치 | R2 계산 엔진 | 없음 |
| #35 | `feature/rich300-r3-store` | #34 브랜치 | R3 Sheets 저장소 | 없음 |
| (R5) | `feature/rich300-r5-api` | #35 브랜치 | R5 API 서명 검증 | 없음(미배포) |

**의존**: #34 ⊂ #35 ⊂ R5 ⊂ … 는 *스택*(위쪽이 아래쪽 커밋을 포함). #31·#33은 서로, 그리고 rich300 스택과 **파일이 겹치지 않는다**(#31: `radar-service/**` 신호 모듈·글꼴·테스트, `docs/SIGNAL.md`, `docs/ALERT-DESIGN.md`; #33: `docs/COMPOUND-3-1-DESIGN.md`, `docs/JOURNAL-3-1-DESIGN.md`; rich300 스택: `rich300/**`, `.github/workflows/rich300-s0.yml`, `.gitignore` 1줄). 이후 R9(radar 연동)는 #31(카드) + R5 + R4가 먼저 필요하다.

## 충돌 시뮬레이션 (임시 worktree, main 023e136 기준)
| 순서 | 결과 |
|---|---|
| #31 → #33 → #32 → #34 → #35 → R5 (하위→상위) | 충돌 0, 최종 트리 `184ca8d` |
| R5 먼저 → #31 → #33 | 충돌 0, 동일 트리 |
| R5 → #35 → #34 → #32 → #33 → #31 (역순) | 충돌 0, 동일 트리 |
| 일부만(예: #34 → #32 → #31) | 충돌 0 (부분 집합이라 다른 트리) |
→ **병합 순서와 무관하게 같은 결과**. 합친 트리에서 radar·scheduler·rich300 테스트 **542건 통과**, `radar.yml`·신호 판정·전이·모의 로직은 main 대비 무변경.

## 권장 병합 절차
1. 병합 방식은 **merge commit**(저장소 기존 방식)을 유지한다. **squash/rebase 병합은 스택 PR에서 이후 PR에 중복 커밋·충돌을 만든다.**
2. **스택 PR의 base 재지정이 필수**: #32 병합 후 #34의 base(`feature/rich300-journal`)는 main이 아니므로, #34를 병합하기 *전에* base를 main으로 바꾼다(GitHub는 base 브랜치를 삭제할 때만 자동 재지정). 그렇지 않고 병합하면 변경이 main이 아니라 이전 브랜치에만 들어간다. #35·R5도 같은 방식(바로 아래 PR 병합 후 base를 main으로).
3. 대안(더 단순): **최상위 PR 하나만** base를 main으로 바꿔 병합 — 아래 커밋이 모두 포함되므로 한 번에 끝나고, 나머지 PR은 "포함됨"으로 닫는다(개별 리뷰 기록은 PR에 남음).
4. 순서 제안: ① #31(승인 시, 운영 로그에 `SIGNAL-DELIVERY` 줄 추가 — 병합 후 다음 radar 실행에서 확인) → ② #33 → ③ rich300 스택(#32 → #34 → #35 → R5). #33은 `rich300/docs/*`를 링크하므로 #32 이후에 병합하면 링크가 바로 유효하다(순서를 어겨도 동작에는 영향 없음).
5. **병합 전 정리**: `rich300/s0/**`, `.github/workflows/rich300-s0.yml`, `rich300/test/s0-probe.test.mjs`는 S0 일회용이다. S0가 끝나면 삭제 커밋을 스택 끝에 얹고 병합한다(남겨 두면 `Engine.gs` 동기화 테스트가 엔진을 바꿀 때마다 재생성을 요구한다: `node rich300/build.mjs rich300/s0/Engine.gs`).
6. main 병합마다 기존 Cloudflare Workers Builds가 자동 실행되지만 `worker/`·`assets/` 불변이라 산출물은 동일하다(PR #28 때와 같음). `radar.yml`은 main push로 실행되지 않는다(스케줄·개발 브랜치 push만).
7. #31이 병합되면 `claude/coin-radar-handoff-8f4oju` 브랜치는 이후 작업을 위해 main에서 다시 시작한다(병합된 이력 위에 새 커밋을 쌓지 않는다).

## 승인·보류 상태
#31~#35·R5는 모두 **병합 보류**. 실제 Telegram 발송, Google 실제 배포, Secret 등록, radar 연동(R9)은 별도 승인 + S0 실측 이후.
