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


## 추가: R4·R6 (독립 PR)
- `feature/rich300-r4-telegram`, `feature/rich300-r6-dashboard` 는 둘 다 `feature/rich300-r5-api`(PR #36) 위에서 분기한 *서로 독립* 브랜치입니다. 기반 PR이 먼저 병합되어야 합니다(스택).
- 겹치는 파일을 줄이기 위해 R5 브랜치에 공통 변경을 먼저 넣었습니다: `build.mjs`의 `ENGINE_MODULES` 한 줄 한 모듈, 번들 개수 고정 단언 제거, S0 `Engine.gs` 스냅샷 검증, `Api.gs`의 GET 라우터(`?p=fill|dash`)와 소유자 확인.
- R4는 목록 끝(`ingest` 뒤)에, R6는 `ledger` 뒤에 모듈을 추가하므로 병합 충돌이 없습니다(시뮬레이션으로 확인).
- 병합 순서: #32 ← #34 ← #35 ← #36 ← (R4, R6 임의 순서). 모든 PR은 별도 승인 전까지 병합하지 않습니다.

## R9 통합 PR (이 브랜치 `feature/rich300-r9-integration`, Draft, 병합 보류)
- **의존**: R4(#37)·R6(#38)·R7(#39)·R8(#40)와 PR #41(검증 키트)의 커밋을 모두 포함하는 *스택의 맨 위*. 신규 변경은 (1) radar 신호 메시지 버튼·ID(`radar-service/signal/rich300.mjs`, 기본 off) (2) R4 체결 입력 확장 (3) R6 숫자 중심 메인 화면 (4) 추천 기록·일지 검색·성적 탭·점검 화면 (5) 운영 설치 `rich300Install`·자동 검증 (6) 테스트 봇 시험 하니스 제거.
- **#41 과의 관계**: 이 PR은 #41 의 테스트 봇 마법사·24시간 모니터·`[TEST]` 전용 하니스를 *제거*하고 호환성·성능 자동 검증(A·B·C·G 구간)만 운영 설치 점검으로 재사용한다. 이 PR을 채택하면 #41 은 대체된다(병합·종료 여부는 사용자가 결정).
- **main 과의 충돌 시뮬레이션**: `git merge-tree origin/main <이 브랜치>` 충돌 없음. radar 쪽 변경 파일은 `radar-service/service.mjs`·`radar-service/signal/step.mjs`·`radar-service/signal/rich300.mjs`·`.github/workflows/radar.yml`(변수 한 줄)뿐이다.
- 병합 순서(승인 후): #32 ← #34 ← #35 ← #36 ← R4/R6 ← R7/R8 ← 이 PR(#41 은 건너뜀 또는 먼저 닫음). 어떤 PR도 별도 승인 전에는 병합하지 않는다.
