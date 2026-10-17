# 관저중로점 AI 외부활동 웹앱 (복구판)

Google Apps Script 웹앱. 기존 폐쇄 URL은 사용하지 않으며 신규 Apps Script 프로젝트로 배포한다.
이 폴더에는 비밀번호·시트 ID·배포 URL을 넣지 않는다 (Script Properties에만 보관).

## 파일
- `Code.gs` 서버(인증·세션·API), `Index.html` 모바일 UI, `appsscript.json` 매니페스트
- `test/` 로컬 모의 환경 테스트: `node --test test/app.test.mjs`

## 배포 절차 (신규 프로젝트)
1. script.google.com → 새 프로젝트. `Code.gs`, `Index.html`(HTML), `appsscript.json` 내용을 붙여넣기
   (또는 `clasp create --type standalone && clasp push`).
2. 프로젝트 설정 → 스크립트 속성: `SHEET_ID`(운영용 시트 ID), `STAFF_PASSWORD`(운영 값: 1004, 코드/저장소에는 넣지 않음).
3. 배포 → 새 배포 → 웹 앱: 실행 사용자 **나**, 액세스 **모든 사용자**. 새 Deployment ID/URL 발급.

## 권한 구조
- 별도 관리자 인증 없음. 비밀번호로 로그인한 모든 사용자가 4개 메뉴(오늘/활동기록/직원활동/분석)와 수정·삭제를 동일하게 사용한다.
- 데이터 함수는 전부 세션 토큰 검증. 공개 `doGet`은 로그인 화면만 처리 (QR 유입 기능은 제거됨; 시트의 `QR접속기록` 탭은 과거 기록 보존용으로 그대로 둔다).

## 알려진 제약
- 공용 비밀번호를 아는 사람은 누구나 직원 기능 사용 가능. 접속자 개인 식별 불가.
- 로그인 실패 제한은 클라이언트 IP를 알 수 없어 기기별(임의 기기 ID) 적용이라 다른 직원에게 영향 없음. 기기 ID는 바꿀 수 있으므로 무차별 대입 완전 방어는 아니며 대량 실패 시 틀린 시도만 지연한다. 4자리 비밀번호는 본질적으로 약하다.
