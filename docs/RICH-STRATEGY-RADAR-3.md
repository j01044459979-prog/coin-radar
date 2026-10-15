# RICH STRATEGY RADAR 3.0 — 연구용 프로토타입

상태: **개발 브랜치 전용 / 실전 보고 OFF / 자동 주문 OFF**.

## 구현
- `radar-service/strategies-v3.mjs`: SuperTrend(ATR14×3), UT 스타일 ATR trailing stop(독립 자체 구현), Donchian 직전 20봉 돌파 + 거래대금 1.5배, RSI14+볼린저20(2σ) 반전, EMA20/50 추세·횡보 구분.
- SuperTrend와 ATR 트레일은 상관된 같은 ATR 근거를 사용하므로 **추세 근거 1개로 묶고**, 돌파/거래대금은 별도 근거로 다룬다. 세 지표 단순 다수결 금지.
- `radar-service/strategy-backtest-v3.mjs`: 다음 봉 시가 진입, 같은 봉 손절·익절 충족시 손절 우선, 수수료 6bp/side, 슬리피지 3bp/side, 최대 24봉 보유, 포지션 중첩 방지.
- 결과에 전체/전반 70%/후반 30% 구간의 거래 수, 비용 반영 성과, profit factor, 승률, 거래 종료시점 낙폭을 구분 표시. 분할 경계에 걸친 거래는 두 개별 구간에서 제외.
- `radar-service/strategy-backtest-cli-v3.mjs`: 사전에 수집한 확정봉 JSON을 입력받아 오프라인 통계 출력(거래 키/비밀값 불필요).
- `radar-service/test/strategy-v3.test.mjs`: 신호 타당성, 미래봉 추가로 과거 신호가 달라지지 않는지, 거래 비용과 분할 검증.

## 실행
```sh
node --test radar-service/test/strategy-v3.test.mjs
node radar-service/strategy-backtest-cli-v3.mjs /path/to/okx-closed-candles.json
```

JSON은 확정봉 목록 또는 `{ "candles": [...] }` 형태. 각 원소는 `{ "t": 1790000000000, "o": 100, "h": 101, "l": 99, "c": 100.5, "q": 140000, "confirm": "1" }` 형태이며 `t`는 Unix 밀리초, `q`는 USDT 거래대금. 시간 오름차순의 **확정봉만** 입력한다.

**프로그램 실행 최소치 200봉은 통계적 신뢰도 기준이 아니다.** 운영 중 70봉 단위의 수집만으로는 6~12개월 백테스트가 불가능하다.

## 후속 Claude Code 미션
1. P1: OKX 공식 `/market/history-candles`를 이용해 5분봉 6~12개월 데이터를 페이지네이션으로 수집. 공식 기간 제한을 확인하고 rate limit, 기초자산/USDT 거래대금 단위, 미확정봉 제거, 시간 순서, 결측·중복·불연속 검증. 제한 응답 우회 금지, Binance 데이터와 이름 혼용 금지. 데이터가 불완전하면 지표 산출 거부.
2. P2: BTC/ETH/SOL와 유동성 검증된 알트 복수 종목의 추세/횡보/급락을 포괄하는 독립 표본 검증. 70/30 시계열 split 후 미래 구간에 대한 파라미터 재조정 금지. 같은 기간 기존 v2.4 신호와 비용 포함 A/B 비교. walk-forward 및 최소 2주 paper forward tracking. 갭 손절/펀딩/시장 충격 감도 테스트 추가.
3. P3: 별도 옵트인 플래그의 shadow 결과 생성. 기존 점수/텔레그램 출력은 기본값 그대로. 신규 신호의 거래소 출처, 통계 샘플 수, 거절 사유, 손익비, 리스크, 0건일 때 대기 상태를 표시.
4. P4: 성과 개선이 유지되고 회귀/운영 점검이 끝난 후 사용자 승인으로만 live 텔레그램 및 `main` 변경. 자동 주문 추가 금지.

## 제한 사항
- 이 코드는 TradingView의 독점/공개 Pine 소스 복사본이 아니다. SuperTrend는 공개 지표 정의를 자체 구현했으며 ATR 트레일도 독립 구현한 'UT 스타일'이지 공식 UT Bot Alerts와 동일함을 보장하지 않는다.
- `buildStrategySeries`는 confirm=1, 증가하는 시각 등을 확인하지만 **5분봉 연속성 검증은 별도 수집기 구현까지 미완료**다.
- 수수료/슬리피지는 임의의 보수적 기본 가정일 뿐 현재 사용자의 실제 VIP 수수료가 아니다. 강제청산, 레버리지, 포지션 마진, 펀딩, 호가 갭, 진입 불가, 차익거래 여건은 계산하지 않는다.
- 과거 수익과 전략 점수는 미래 수익 확률을 의미하지 않는다.
- 기존 `run.mjs`, `okx.mjs`, `report.mjs`, `service.mjs`, GitHub Actions schedule, Telegram 비밀값은 수정하지 않음.

## 참고
- TradingView Supertrend 정의: https://www.tradingview.com/support/solutions/43000634738-supertrend/
- TradingView Pine 백테스트 주의: https://www.tradingview.com/pine-script-docs/faq/strategies/
- OKX 공식 API: https://www.okx.com/docs-v5/en/