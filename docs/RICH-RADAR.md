# 리치 선물 레이더 서버 실행 모듈

상태: 개발·로컬 테스트 단계. 서버 배포 및 실제 Telegram 수신 확인 전에는 운영 중이 아닙니다.

## 기존 시스템과의 관계

기존 웹사이트, Upbit Worker, D1, 정보 수집 Cron은 그대로 유지합니다.
`assets/futures-engine.js`의 마크가격/OI 응답 검증과 15분 OI 계산을 재사용합니다.
별도 Node 22 프로세스가 브라우저 없이 실행됩니다. 거래 주문/API 키는 사용하지 않습니다.

2026-10-13 18:49 KST 기존 Worker `/debug/reachability` 점검에서 Binance Futures HTTP 403,
Upbit HTTP 200을 확인했습니다. 따라서 기존 Cloudflare Cron에 Binance 호출만 붙여서는
작동하지 않습니다. 서비스 이용 조건에 맞으며 공식 API 접속이 허용된 실행 환경이 필요합니다.
차단 시 프록시/미러/우회 없이 수집 장애로 처리합니다.

## 현재 구현

- 5분 경계 직후 감시, 정각 이후 첫 정상 주기에 시간당 보고 1회.
- 실제 TRADING USDT 무기한 계약만 선택. BTC/ETH 및 24시간 거래대금 상위 최대 12종목.
- 완료된 5분봉만 사용. 직전 20봉 고저점 돌파, 12/48봉 단순평균 방향, 거래대금 2배,
  15분 OI +1% 이상, 펀딩 절댓값 0.05% 이하, 기준선과 마크가격 거리 1 ATR 이내를 모두 확인.
- BTC 15분 변동이 반대 방향 0.5%를 넘거나 BTC 데이터가 없으면 강한 신호 차단.
- 기준선과 14봉 ATR 기반 무효화 참고선을 숫자로 표시. 지지/저항 재확인은 사용자가 해야 하며
  자동 진입 신호나 백테스트로 검증된 수익 확률이 아닙니다.
- 시간당 보고 상위 2개, 시간 사이 신규 조건 최대 2개. 종목/방향별 1시간 중복 억제.
- 캔들 누락, 가격/OI 지연, 펀딩 미확인 시 해당 종목 제외. 전체 실패 시 가격을 만들지 않고 장애 알림.
- 403/451은 1시간 대기, 429는 Retry-After 준수. Telegram 전송 성공 이후만 기록.
- 재시작 후 상태 유지, 단일 프로세스로 중첩 실행 방지. Telegram 전송 직후 저장 전 강제 종료되면
  1회 중복 가능(외부 API에 idempotency key 없음). 복수 인스턴스 실행 금지.
- 첫 버전은 규칙 기반 수치 분석입니다. LLM 분석·뉴스 원인 연결은 아직 구현하지 않았습니다.

## 운영 전 필요한 검증

1. 승인된 상시 실행 서버에서 `RADAR_STATE_DIR=/tmp/radar-preview node radar-service/run.mjs --preview`.
   공식 Binance API 수집 성공, 현재 가격/시각 확인. 프리뷰는 Telegram 전송/운영 상태 저장 없음.
2. 기존 봇의 비밀 토큰을 서버 비밀 환경에 설정하고 수신자가 소유자의 개인 chat ID인지 확인.
   토큰을 GitHub, 보고서, 채팅 또는 로그에 쓰지 않기.
3. 저장소 루트 기준 `docker compose -f radar-service/compose.yaml up -d --build`.
   `.env.example`은 안내용이며 실제 `.env`는 커밋 금지.
4. 시간당 보고 실수신, 강한 조건 알림, 서버 재시작 후 중복 억제, 장애 알림 확인.

운영 상태는 영구 볼륨 `/data/state.json`에서 lastAttempt/lastSuccess/lastError를 확인합니다.
봇 토큰·chat ID는 상태 파일에 저장하지 않습니다. 중단은 compose stop으로 가능합니다.
새 서버 생성/유료 계약/Telegram 비밀값 설정은 아직 수행하지 않았습니다.

## 검증 명령

`node --test radar-service/test/*.test.mjs`

기존 회귀: `node --test worker/test/*.test.js tests/futures-engine.test.js`

API 출처: Binance `/fapi/v1/exchangeInfo`, `/fapi/v1/ticker/24hr`, `/fapi/v1/klines`,
`/fapi/v1/premiumIndex`, `/fapi/v1/openInterest`, `/futures/data/openInterestHist`.
Telegram 공식 Bot API `sendMessage`를 사용합니다.

## 무료 실행 환경 검증 결과 (2026-10-13 19:40 KST)

- 공개 저장소의 GitHub Actions 표준 러너(ubuntu-24.04, Azure centralus)에서 실제 호출:
  `fapi.binance.com` ping / klines / openInterestHist 모두 **HTTP 451**, `api.telegram.org`는 도달 가능(302).
  기존 Cloudflare Worker는 403, Work 실행 환경은 451. 즉 무료 후보 3곳 모두 Binance Futures 지역 차단.
- 프록시/미러/VPN 우회는 하지 않으며, 다른 거래소 가격을 Binance 가격으로 표기하지 않습니다.
- 따라서 Binance 데이터 기반 자동 보고는 현재 무료 환경에서 운영 불가. 운영 완료 아님.
- 남은 선택지: (1) 사용자 본인 PC/휴대폰 등 Binance 접속이 허용된 네트워크에서 실행(상시 PC 없음 → 부분적),
  (2) 데이터 출처를 접근 가능한 거래소(Upbit 원화 마켓 등 기존 Worker 데이터)로 바꾸고 "Binance 아님"을 명시,
  (3) 무료 티어이면서 허용 지역 리전을 선택할 수 있는 실행 환경을 사용자가 약관 확인 후 직접 선택.
