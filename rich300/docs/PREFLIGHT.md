# 실제 운영 배포 전 점검표

모든 항목이 ✅ 이고 사용자가 배포를 **명시 승인**하기 전에는 운영 배포·실제 Telegram 발송·알림 활성화를 하지 않습니다. 증거 위치는 해당 문서·테스트 이름입니다.

## A. S0 실측(Google 실환경)
| 항목 | 상태 | 증거 |
|---|---|---|
| POST 302·본문 HMAC·UTF-8·변조/오래된 시각 거부·병렬 8건 락 | ✅ 실측 | `S0-RESULTS.md`(run #5, #7) |
| 익명 GET = 302 → 200 JSON(로그인 페이지 아님) | ✅ 실측 | `S0-RESULTS.md` |
| `s0Compat`·`s0EngineBench` 실행 | ⚠ 실행했다고 보고됨, **상세 반환값 미확인** | 사용자 보고 |
| `s0InstallTriggers`·트리거 등록 | ✅ 사용자 보고 | — |
| `s0Report` 초기 값(ticks=729, maxMs=3917, gapsOver90s=1, daily=[]) | ⚠ **초기값. 729회 자동 실행으로 확정하지 않음**(카운터 값일 뿐이며 실행 목록과 대조 전). 1시간 안정성 검증 아님 | Executions 목록과 대조 필요 |
| `daily=[]` (00시 트리거 미관측) | ❌ 미확인 → 일 마감 시각 정확도 미확정 | `s0Daily` 재확인 |
| UI 이메일 확인(두 번째 배포) | ❌ 미실측 | S0 ④ |

## B. 테스트 프로젝트 검증(운영과 별도 프로젝트·시트·봇)
- [ ] `rich300SetupTest` → `rich300SelfTest` 실패 0
- [ ] 소유자/타인/익명 접근: `?p=journal`·`?p=dash`·`?p=fill` (소유자만 표시, 나머지 빈 화면) — **UI 이메일 실측 후**
- [ ] 페어링 → 가짜 신호 1건 → 버튼 → `/fill` → `/exit` → 복기 → `/equity` (테스트 봇, `RICH300_TEST_TG_ALLOW=yes`)
- [ ] 일 마감 1회 수동 실행(`rich300CloseTick`) → `dayclose` 1건, 재실행 변화 없음
- [ ] 마감 알림은 **OFF 상태에서 미발송** 확인 → (승인 시) 테스트 봇으로 1회 시험
- [ ] `rich300BackupRun` → 사본 생성·검증 통과, 복원 시험(`rich300BackupRestoreLatest`), 8개 보관 동작
- [ ] 폴링 1시간 이상 안정성(`tg:stats`의 maxMs·slow, Executions 목록 대조), 일일 누적 실행 시간이 한도(문서상 90분/일 — 미검증 가정)에 충분히 못 미침

## C. 비밀값·권한
- [ ] 운영 봇 토큰은 운영 프로젝트 스크립트 속성에만(테스트와 다른 봇), 수신 키 32자 이상, 키는 GitHub Secret과 동일 값(채팅·로그 미노출)
- [ ] 매니페스트 권한 = 스프레드시트·트리거·외부 요청·이메일·drive.file (넓은 권한 없음). `drive.file`로 백업 사본 생성이 되는지 테스트 프로젝트에서 확인(안 되면 범위 조정 승인 필요)
- [ ] 소유자 이메일(`RICH300_OWNER_EMAIL`) 설정, 허용 Telegram ID는 페어링으로만(하드코딩 없음)
- [ ] 저장소에 비밀값 없음(`deploy.test.mjs` 비밀값 점검 통과)

## D. 데이터 안전
- [ ] 운영 시트 환경 표식 = prod, 테스트 시트 = test
- [ ] 첫 백업 성공 + 복원 시험 성공, 백업 폴더 8개 보관 확인
- [ ] 무결성 검사(`rich300SelfTest`) 통과
- [ ] 되돌리기 절차 숙지: 시트 전환은 `RICH300_SHEET_ID_PREVIOUS`로 복귀, 트리거 제거는 `rich300RemoveAllTriggers`

## E. 승인 게이트(각각 별도 승인)
1. PR 병합 순서·시점(`DEPENDENCIES.md`) — PR #31~#38 모두 승인 전 병합 금지
2. 운영 Apps Script 프로젝트 생성·배포
3. 운영 `RICH300_PROD_APPROVED=yes`(실제 Telegram 허용)
4. 알림 활성화(`closeNotify=on` + `RICH300_CLOSE_SEND_APPROVED=yes`)
5. radar 연동(R9, `RADAR_RICH300=on`) — 실제 테스트 발송 별도 승인

## F. 운영 시작 후 24시간 관찰
`tg:stats`(느린 실행·busy), `close:last`, `backup:last`, 감사 로그 증가, 중복 기록 없음, 알림 1회 확인.
