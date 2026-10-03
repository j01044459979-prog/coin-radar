# 리치 베팅 장부 V1 (Google Sheets + Apps Script 웹앱)

## 배포 (최초 1회, 약 3분)
1. 새 Google 스프레드시트 생성 → 확장 프로그램 → Apps Script
2. `Code.gs`, `Index.html` 내용을 그대로 붙여넣기 (`Index` 이름의 HTML 파일), 프로젝트 설정에서 "appsscript.json 표시" 후 `appsscript.json` 내용도 반영
3. 함수 `setup` 실행(권한 승인) → BET_LOG / WDL_LOG / DASHBOARD / SETTINGS 시트 생성
   (붙여넣은 뒤 `diagnoseSetup` 을 실행하면 시트/헤더/설정값을 읽기 전용으로 점검합니다)
4. 배포 → 새 배포 → 웹 앱 (실행: 나, 액세스: 나만) → URL을 모바일 홈 화면에 추가

## 테스트
- `node betting-ledger/test/ledger.test.js` — 실제 Code.gs 를 메모리 시트 목 위에서 실행
- `node betting-ledger/test/ui-smoke.mjs` — Index.html 을 Chromium 에서 구동(서버는 목)

## 집계 기준
- 사용액 = 대기 포함 모든 베팅금액(일반 + 승무패, 취소 포함)
- 확정 손익 = 확정 건 반환금 − 확정 건 베팅금액, 확정 ROI = 확정 손익 ÷ 확정 베팅액 (대기 제외)
- 적특은 실제 반환금 입력 필수, 취소는 반환금 미입력 시 원금 자동 환급(사용액에는 유지)
- 설정값(월 예산/일 최대/회차 최대)은 SETTINGS 시트에서 수정

## 기존 시트에 연결할 때 (이미 구조/DASHBOARD 수식이 있는 경우)
- 기존 DASHBOARD 는 덮어쓰지 않음(A1 이 "리치 베팅 장부 — 월" 로 시작하는 스크립트 생성본이거나 빈 시트일 때만 갱신)
- 기존 BET_LOG/WDL_LOG: 헤더가 같으면 스타일/날짜·금액·ROI 서식은 그대로 두고 ID/회차/등록일시 열만 텍스트 서식 지정
- 날짜 열은 실제 날짜 값으로 저장되어 SUMIFS(날짜 범위) 수식과 호환, ROI 는 비율(1.2 = 120%)로 저장(0.0% 서식)
- `setup()` 은 선택 사항. 반드시 `diagnoseSetup()` 으로 먼저 점검
