# RICH 300 — 보안 검토 (S0 전 초안)

> 전제: 저장소는 **public**. 코드·이슈·Actions 로그는 공개이며, 개인 거래·잔고·메모는 저장소·로그에 두지 않는다. 자동 주문·거래소 API 없음.

## 1. 자산과 신뢰 경계
| 자산 | 위치 | 노출 시 영향 |
|---|---|---|
| 거래·잔고·복기 데이터 | 소유자 Google 계정의 Sheets | 개인정보·전략 노출 |
| Telegram 봇 토큰 | GitHub Secret(기존) + **Apps Script Script Properties(신규 사본)** | 봇 사칭·메시지 발송·수신 탈취(주문 권한은 없음) |
| 수신 키 `RICH300_INGEST_KEY` | GitHub Secret + Script Properties | 가짜 신호 스냅샷 주입(기록 오염) |
| API 배포 URL | GitHub Secret(`RICH300_GAS_URL`) | 요청 폭주(DoS)·서명 없는 요청 시도(서명 검증으로 거부) |
| 허용 Telegram ID·이메일 | Script Properties | 식별 정보 |
공개 저장소에는 값이 하나도 들어가지 않는다(코드에는 이름만). 테스트가 소스·로그 출력에서 토큰 패턴·URL·ID를 검사한다.

## 2. 위협과 대응
| 위협 | 대응 | 잔여 위험 |
|---|---|---|
| 가짜 신호 주입/재생 (Actions→API) | 본문 HMAC-SHA256(`v.ts.nonce.정규화 body`), ts ±5분, nonce 캐시, `sid` 유일키, 서명 검증을 **최우선(저비용)** 수행 | 키 유출 시 오염 가능 → 키 회전 절차 |
| API URL 유출 후 폭주 | 서명 불일치는 즉시 거부(락·시트 접근 전), 실행 횟수 급증 시 알림 지표, 필요하면 배포 보관(archive)·재배포로 URL 폐기 | 익명 배포라 접근 자체는 막지 못함(비용은 무료 쿼터 소진) |
| Telegram 위조 | **폴링 모드(예정)**: 수신 서버가 없어 외부 위조 요청 불가. 웹훅이 채택되면 URL 비밀 쿼리 + `from.id`/`chat.id` 일치(헤더 검증 불가 약점 명시) | 웹훅 모드의 약한 인증 |
| 허용 사용자 사칭 | `from.id`가 **페어링된 ID**일 때만 처리, 비페어링 발신자는 무응답, 페어링 코드는 UI(Google 로그인 소유자)에서 생성·10분·1회용·해시 저장 | 봇을 아는 제3자가 `/pair` 시도 → 코드 없이는 실패, 시도 횟수 제한 |
| UI 무단 접근 | UI 배포는 Google 로그인 필수 + 이메일 허용 목록 + 시트는 소유자 전용 + 공유 링크 금지 | 계정 탈취 시 전체 노출(2단계 인증 권장) |
| 중복 클릭·재전송·재시도 | `update_id`·`callback_query.id` 기록, sid 유일키, 처리 후 버튼 제거, 스크립트 락 | 락 대기 초과 시 실패 응답(재시도로 복구) |
| 데이터 변조·오기입 | 추가 전용 + `Audit`(이전/이후·시각), 일 마감 무결성 점검, 수정은 리비전·삭제 없음 | 소유자가 시트를 직접 고치는 경우 탐지만 가능 |
| 데이터 유실 | 주 1회 사본(8개 보관), 구글 버전 기록, 수동 내보내기, Telegram CSV는 OFF | 같은 Google 계정 장애 시 동시 영향 |
| 비밀 노출(로그) | 로그에 토큰·URL·ID·금액 비출력, Actions 로그에는 sid 해시·성공 여부만, GAS 로그도 값 비출력 | 편집기 실행 로그는 소유자만 열람 |
| 과도한 권한 | OAuth 범위 최소화: `spreadsheets`, `script.external_request`, `script.scriptapp`, `userinfo.email`. **백업은 `drive.file` 범위의 Advanced Drive 서비스로 사본 생성(전체 Drive 권한 `DriveApp` 회피)** | 범위 동의 화면에서 확인 |
| 공급망 | GAS에 외부 라이브러리 없음, UI에 CDN·외부 스크립트 없음(인라인 SVG) | — |
| 토큰 이중 보관 | 토큰을 GAS에 두는 이유(폴링·메시지 발송에 필요)와 회전 절차 문서화: BotFather 재발급 → GitHub Secret·Script Properties 교체 → 폴링 재개 | 두 곳 중 하나가 유출되면 전체 교체 필요 |

## 3. 인증·비밀 관리 규칙
1. 토큰·키·URL은 **사용자가 직접** GitHub Secret과 Script Properties에 입력한다(채팅·코드·PR 설명·로그에 붙이지 않는다). 개발자는 값을 보지 않는다.
2. 허용 사용자: 페어링 흐름으로 ID를 *확인*해 저장(하드코딩 금지). 허용 이메일은 Script Property.
3. 모든 외부 입력은 신뢰하지 않고 검증(범위·부호·방향·길이·형식). 메모는 텍스트로만 렌더(HTML 이스케이프).
4. 쓰기 경로는 `LockService` + 유일키 + `Audit` 한 곳으로 통일.
5. 새 기능은 플래그 기본 OFF(`closeNotify`, Telegram 수신, radar 연동 `RADAR_RICH300`).

## 4. Actions → Apps Script 요청 형식 (R5)
```
POST {RICH300_GAS_URL}   Content-Type: application/json   (follow redirects)
{"v":1,"ts":<ms>,"nonce":"<uuid>","body":{...신호 스냅샷...},"sig":"hex(HMAC-SHA256(KEY, v.ts.nonce.canonical(body)))"}
```
- `canonical(body)` = 키 정렬·공백 없는 JSON(양쪽 동일 구현, 테스트 벡터 공유).
- 응답: `{ok, duplicate}`. 실패·타임아웃은 radar에 영향 없음(`catch`, 시간 제한, 플래그 OFF).
- 재전송은 안전(같은 sid는 `duplicate:true`).

## 5. 무료 운영 한계와 보안 연계
- 익명 API 배포는 URL을 아는 누구나 호출 가능 → 쿼터 소진(서비스 거부) 위험. 대응: 서명 불일치 조기 거부, 의심 급증 시 배포 교체. 데이터 기밀성에는 영향 없음.
- 폴링 트리거는 하루 약 12~36분(가정) — 보안과 무관하게 한도 모니터링 필요(S0로 실측).

## 6. 배포 전 보안 체크리스트
- [ ] S0 결과 반영(인증·수신 모드 확정)  - [ ] OAuth 동의 화면 범위 = 최소 범위
- [ ] Script Properties 값 입력 후 편집자 목록 = 소유자 1명  - [ ] UI 접근을 비허용 계정으로 시험(거부 확인)
- [ ] 서명 변조·재생·오래된 ts 시험(거부 확인)  - [ ] 비페어링 Telegram 계정 시험(무응답)
- [ ] 로그·PR·저장소에 비밀 없음(스캔)  - [ ] 백업 사본 복원 시험  - [ ] 토큰 회전 리허설
