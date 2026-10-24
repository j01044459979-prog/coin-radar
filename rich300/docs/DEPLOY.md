> **최신 절차는 [INSTALL.md](INSTALL.md)(운영 설치)·[R9.md](R9.md)(통합 설계)입니다.** 아래는 R8 시점의 배포 준비 설명이며, 테스트 봇 시험 절차는 더 이상 쓰지 않습니다(별도 테스트 봇 없음).

# 배포 자동화 가능 범위와 최소 수동 절차

이 문서는 Apps Script 배포를 어디까지 자동화할 수 있는지(그리고 왜 나머지는 사람이 해야 하는지)와, 사용자 수동 작업을 최소화한 절차를 정리합니다. **운영 배포는 별도 승인 후** 진행합니다.

## A. 자동화 가능 범위 검토
| 단계 | 자동화 | 근거·제약 |
|---|---|---|
| 배포 묶음 생성(엔진+gas→`Code.gs`, HTML, 매니페스트, 해시 목록) | ✅ 완료 | `node rich300/deploy/make-bundle.mjs` (문법 검사·이름 충돌·S0 코드/비밀값 미포함 시험) |
| 프로젝트 초기 설정(환경 이름·소유자·시트 생성·환경 표식) | ✅ 편집기에서 함수 1회 | `rich300SetupTest()` / `rich300SetupProd()` (멱등) |
| 상태 점검 | ✅ 편집기에서 함수 1회 | `rich300SelfTest()` — 값 없이 상태만 출력 |
| 트리거 일괄 설치 | ✅ 편집기에서 함수 1회 | `rich300InstallAllTriggers()` (폴링 1분·일 마감 00시+매시간·주 1회 백업) |
| 코드 업로드(`clasp push`) | ⚠ 사용자 PC에서 가능 | `clasp login`(브라우저 OAuth)·Apps Script API 사용 설정(사용자 설정 페이지 토글) 필요. 이 환경(샌드박스)은 Google 접속·로그인 불가 |
| 배포 생성(웹 앱) | ⚠ 부분 | API 배포는 매니페스트 기본값으로 생성 가능. **UI 배포(접속한 사용자로 실행)는 별도 설정**이라 웹 UI에서 1회 수동(두 배포 병존은 S0 가정, 실측 진행 중) |
| OAuth 권한 동의 | ❌ 수동 | 함수를 처음 실행할 때 Google 동의 화면(자동화 불가·불가해야 안전) |
| 비밀값 입력(봇 토큰·수신 키) | ❌ 수동(의도적) | 스크립트 속성에 직접 입력. 채팅·로그·저장소에 올리지 않음 |
| GitHub Actions로 자동 배포 | ❌ 비권장 | 장기 갱신 토큰(`.clasprc.json`)을 Secret으로 두어야 하고 권한이 넓음. 위험 대비 이득이 작음 |
| BotFather 봇 생성·토큰 | ❌ 수동 | Telegram 앱에서 사용자가 수행 |

## B. 최소 수동 절차(테스트 프로젝트 → 운영 프로젝트 모두 동일, 환경만 다름)
소요 약 15~20분. 프로젝트는 **환경마다 새로 만듭니다**(`test`와 `prod` 공유 금지).
1. (PC) `node rich300/deploy/make-bundle.mjs` → `rich300/dist/apps-script/` 생성.
2. (웹) script.google.com 새 프로젝트 만들기 → 프로젝트 설정에서 "appsscript.json 매니페스트 표시" 켜기 → 생성된 `Code.gs`, `Fill.html`, `appsscript.json` 내용을 붙여 넣기. *(clasp를 쓰면 `clasp push` 한 번)*
3. 편집기에서 `rich300SetupTest`(또는 `rich300SetupProd`) 실행 → 권한 동의 1회. 시트가 새로 만들어지고 환경 표식이 기록됩니다.
4. 프로젝트 설정 → 스크립트 속성에 직접 입력(값은 어디에도 출력되지 않음): `RICH300_TG_TOKEN`(해당 환경 전용 봇), `RICH300_INGEST_KEY`(32자 이상), `RICH300_UI_URL`(배포 후 https URL).
5. 배포 ① **API**: 새 배포 → 웹 앱 → 실행: 나 / 액세스: 모든 사용자 → URL을 GitHub Secret `RICH300_GAS_URL`로(신호 수신용, R9 이후).
6. 배포 ② **UI**: 새 배포 → 웹 앱 → 실행: *웹 앱에 접속하는 사용자* / 액세스: Google 계정 보유자(또는 나만) → 이 URL을 `RICH300_UI_URL`에 입력.
7. `rich300SelfTest` 실행 → 실패 0 확인(경고 항목을 읽고 판단).
8. 소유자 확인 점검: UI URL을 본인 계정으로 열어 일지가 보이고, 시크릿 창(다른 계정)에서는 빈 화면인지 확인.
9. `rich300InstallAllTriggers` 실행 → 권한 동의. (테스트 프로젝트에서는 실제 Telegram이 필요할 때만 `RICH300_TEST_TG_ALLOW=yes`)
10. `rich300BackupRun` 1회 수동 실행 → `rich300BackupList`로 사본 확인, `rich300BackupRestoreLatest`로 복원 시험.

**운영 승인 전에는** `RICH300_PROD_APPROVED`를 만들지 않습니다(없으면 Telegram 호출이 차단됨). 알림은 추가로 설정 `closeNotify=on`과 `RICH300_CLOSE_SEND_APPROVED=yes`가 모두 필요합니다.

## C. 나중에 더 줄일 수 있는 부분(승인 시)
- `clasp`(사용자 PC) 사용: 2단계를 `clasp push`로 대체(로그인 1회).
- 두 번째 배포 설정은 S0 ④ 결과에 따라 단순화될 수 있음(예: 접근 "나만"으로 UI 배포).
