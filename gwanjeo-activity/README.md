# 관저중로점 AI 외부활동 웹앱 (복구판)

Google Apps Script 웹앱. 기존 폐쇄 URL은 사용하지 않으며 신규 Apps Script 프로젝트로 배포한다.
이 폴더에는 비밀번호·시트 ID·배포 URL을 넣지 않는다 (Script Properties에만 보관).

## 파일
- `Code.gs` 서버(인증·세션·API·QR), `Index.html` 모바일 UI, `appsscript.json` 매니페스트
- `test/` 로컬 모의 환경 테스트: `node --test test/app.test.mjs`

## 배포 절차 (신규 프로젝트)
1. script.google.com → 새 프로젝트. `Code.gs`, `Index.html`(HTML), `appsscript.json` 내용을 붙여넣기
   (또는 `clasp create --type standalone && clasp push`).
2. 프로젝트 설정 → 스크립트 속성: `SHEET_ID`(운영용 시트 ID), `STAFF_PASSWORD`, `ADMIN_PASSWORD`(직원용과 다른 값).
3. 배포 → 새 배포 → 웹 앱: 실행 사용자 **나**, 액세스 **모든 사용자**. 새 Deployment ID/URL 발급.
4. QR①은 `<웹앱URL>?qr=promo` 로 재생성. QR②는 `https://su.kt.co.kr/SlRIQr5` 직접.

## 권한 구조
- 직원: 오늘/활동기록(등록·조회·수정). 관리자(별도 비밀번호, 30분 승격): 직원활동·분석·삭제·아파트DB 수정.
- 데이터 함수는 전부 세션 토큰 검증. 공개 `doGet`은 로그인 화면과 `?qr=promo`만 처리.

## 알려진 제약
- 공용 비밀번호를 아는 사람은 누구나 직원 기능 사용 가능. 접속자 개인 식별 불가.
- 로그인 실패 제한은 클라이언트 IP를 알 수 없어 전역 적용(누군가 일부러 틀려 잠글 수 있음, 5분).
- Apps Script는 HTTP 302를 못 줘서 QR①은 중간 페이지에서 JS로 이동(브라우저가 막으면 "바로 이동하기" 버튼).
