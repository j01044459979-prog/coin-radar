# 리치 선물 레이더 운영 체크리스트

> 최초 수신 검증이 끝나기 전까지 **운영 완료 아님**. 데이터는 **OKX USDT 무기한**, Binance 데이터가 아닙니다.

## Telegram 수신 검증

1. 소유자가 개인 Telegram에서 `@coin_radar_ms_bot`에게 `/start`를 보냈는지 확인 (자동응답이 없어도 정상).
2. GitHub 저장소 **Settings → Secrets and variables → Actions**의 Repository secrets에 아래 이름 두 개가 있는지 확인 (값은 비공개).
   - `TELEGRAM_BOT_TOKEN`: BotFather에서 발급받은 봇 토큰
   - `TELEGRAM_CHAT_ID`: 수신할 소유자의 개인 숫자 chat ID (채널/그룹 ID는 사용하지 않음)
3. 본 브랜치의 `radar-service/**` 변경을 푸시하면 `.github/workflows/radar.yml`의 `push` 실행이 발생합니다. 기본 모드 `once`는 실데이터 수집 뒤 정기 보고를 Telegram으로 전송하도록 시도합니다.
4. GitHub **Actions → radar** 에서 해당 commit의 실행을 열어 Unit tests, Run radar, Save state 성공 여부를 확인합니다. Run radar 출력에 `Telegram 비밀값 미설정`, `HTTP 401/403`, `개인 Telegram token/chat ID 설정 필요`가 있는지 확인합니다.
5. 성공 로그만으로 개인 휴대폰 수신이 증명되지는 않습니다. 소유자가 Telegram에서 보고서 도착을 직접 확인해야 **실수신 검증 완료**라고 표기합니다.

## 주기적 운영 승인 조건

- 이번 브랜치는 `main`에 병합되기 전이므로 GitHub `schedule` 자동 감시는 운영되지 않습니다.
- 실제 테스트 후 명시적 승인 하에 PR을 병합해야 자동 스케줄을 시작할 수 있습니다.
- GitHub Actions `*/5` 예약 실행은 지연되거나 누락될 수 있습니다. 매시 정각과 정확히 5분 간격은 보장하지 않습니다.
- 공개 저장소 표준 러너를 사용하며 별도 결제 서비스를 생성하지 않습니다.
- 토큰이나 chat ID의 **값**을 PR/코드/문서/채팅/로그에 쓰지 마세요.
- Telegram 중복 방지 상태는 Actions cache로 보관합니다. 캐시 유실 시 1회 이상 중복 전송될 수 있으므로 운영 중 점검이 필요합니다.
- 프로그램은 주문을 전송하지 않으며 수익률/승률 보장을 하지 않습니다.

## 문제 해결

- Telegram 미수신: 개인봇과 /start 대화, secret 두 개의 이름/값, ID 숫자 여부, Actions 오류 로그 순서로 확인.
- GitHub 비밀값은 UI에서 **등록된 이름만** 확인할 수 있으며 기존 값은 다시 볼 수 없습니다. 값이 틀리면 새 값으로 업데이트하세요.
- Actions 실행 자체가 없다면 `push` 조건(브랜치명/경로)과 workflow 활성 여부를 먼저 확인.
