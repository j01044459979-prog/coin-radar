# RADAR_SIGNAL=preview 활성화 런북 · 모의매매 성과 추적

> **이 문서는 절차서다. 변수를 바꾸는 것은 사용자의 별도 승인·직접 조작 사항이며, 문서 작성자(Claude)는 저장소 변수를 바꾸지 않았다.**
> 신호는 백테스트로 우위가 입증되지 않은 **미검증 규칙**이다(`docs/SIGNAL-BACKTEST.md`: 104건, 평균 순손익비 +0.21R, 95% 신뢰구간 [−0.11, +0.53]). preview는 **Telegram을 보내지 않고** 로그만 남긴다.

## 0. 전제
- PR #28이 main에 병합되어 있을 것(병합은 별도 승인).
- `RADAR_OPPORTUNITY=on` 유지. 신호는 기회 레이더가 저장한 관찰 후보(2단계 이상)에만 15분봉을 본다. 기회 레이더가 꺼져 있으면 후보가 없어 아무것도 하지 않는다.
- 병합 직후 `RADAR_SIGNAL`·`RADAR_SIGNAL_PAPER`는 변수가 없으므로 `off`다(워크플로 기본값).

## 1. 병합 직후 점검 (변수 변경 전, 신호는 아직 off)
1. Actions → `radar` 최근 실행 2~3회가 모두 Success인지 확인.
2. 한 실행의 **Run radar** 단계 env에 `RADAR_SIGNAL: off`, `RADAR_SIGNAL_PAPER: off`, `RADAR_OPPORTUNITY: on`이 보이는지 확인.
3. 같은 로그에 `OPPORTUNITY {...}` 줄이 있고 `sendError`·`saveError`가 `null`, `timedOut`이 `false`인지 확인. 기회 레이더 Telegram 메시지가 새 형식(2단계/3단계 머리줄, 점수, 면책 문구)으로 오는지 확인.
4. Job Summary에 `corrupt-state`·`cache-stale` 같은 경고가 없는지 확인.
→ 하나라도 이상하면 신호를 켜지 말고 중단한다(신호 코드는 off에서 실행되지 않으므로 원인은 별개).

## 2. 활성화 (사용자가 직접)
저장소 → **Settings → Secrets and variables → Actions → Variables 탭 → New repository variable**
| 이름 (정확히) | 값 | 비고 |
|---|---|---|
| `RADAR_SIGNAL` | `preview` | 필수. `on`은 지금 설정하지 않는다 |
| `RADAR_SIGNAL_PAPER` | `on` | 선택이지만 권장. 모의매매 성과 추적(전송 없음) |

주의 (과거 `RADAR_OPPORTUNITY` 설정 때 반영되지 않은 사례가 있었다):
- **Secrets 탭이 아니라 Variables 탭**이어야 한다. 이름의 철자·대소문자를 정확히.
- 변수는 **다음 실행부터** 적용된다. 이미 돌고 있는 실행에는 반영되지 않는다.
- 다른 신호 변수(`RADAR_SIGNAL_VALID_MIN` 등)는 설정하지 않는다(기본값 사용).

## 3. 활성화 후 확인 (다음 radar 실행 2~3회)
`Run radar` 단계 env에 `RADAR_SIGNAL: preview`가 찍혀야 한다. 로그에서 찾을 줄:
```
SIGNAL {"mode":"preview","watching":N,"analyzed":N,"candidates":0,...,"sendError":null,"saveError":null,"sentMessages":0,"timedOut":false}
SIGNAL ETH: SHORT 관찰 — 15분봉 확정 트리거 대기(...) / ...        ← 코인별 현재 상태(WAIT/관찰/진입 후보)
SIGNAL ※ preview: 전송 없음 · 이 규칙은 백테스트로 우위가 확인되지 않은 미검증 규칙입니다
SIGNAL-PAPER [모의·미검증] 열림 0 · 종료 0 · ...                    ← RADAR_SIGNAL_PAPER=on일 때
```
정상으로 보는 것:
- `{"mode":"preview","skipped":"not-due"}` — 같은 15분 슬롯의 반복 실행(정상). 슬롯당 한 번만 일한다.
- `{"mode":"preview","skipped":"no-watchlist"}` — 기회 레이더의 2단계 이상 후보가 없음(정상, 호출 0).
- `candidates:0` — 대부분의 시간. 후보는 드물다(백테스트상 하루 약 0.8건).
- `진입 후보`가 로그에 나와도 **Telegram은 가지 않는다**. `sentMessages`는 항상 0이다.

비정상(즉시 §6 롤백 검토): `"failed":`, `"timedOut":true`, `"saveError"` 값, `"sendError"` 값(preview에서는 나오면 안 됨), 반복되는 `"skipped":"time-budget"`, 거래소 429/403, radar 실행 시간이 이전 대비 눈에 띄게 증가(신호 추가분 상한은 90초), 기회 레이더·정기 보고 알림의 누락·중복.

## 4. 관찰 기간과 중단 기준 (결과를 보기 전에 정해 둔다)
**안정성 합격 기준 (1~2일, 약 100개 15분 슬롯):**
- radar 실행이 계속 Success, 기존 정기 보고·기회 레이더 알림에 누락·중복 없음
- `failed`·`timedOut`·`saveError` 0건, 신호 호출이 제한 응답(429/403)을 유발하지 않음
- radar 실행 시간 증가가 평균 90초 이내

**중단 기준:** 위 합격 기준 중 하나라도 어기면 `RADAR_SIGNAL` 변수를 삭제(또는 `off`)하고 원인 조사.

## 5. 모의매매 성과 평가 (전향 검증)
`RADAR_SIGNAL_PAPER=on`이면 '진입 후보'가 나올 때마다 **가상 거래**를 기록하고(진입 = 신호 다음 15분봉 시가, 손절 = 구조적 무효화 가격, 목표 = 1차/2차), 이후 확정 15분봉으로 결과를 확정한다. 규칙은 백테스트와 같고 테스트로 필드 단위 동치를 확인했다. 로그 `SIGNAL-PAPER` 줄이 누적 성과를 보여 준다.

- 기록 위치: 상태 파일의 `state.signal.paper`(Actions 캐시). 최근 종료 150건 보관(가득 차도 상태 파일 증가분 약 87KB), 동시에 열린 거래 최대 40건. 이 기능은 주문·계정 API를 쓰지 않고 Telegram 메시지를 만들지 않는다.
- 읽는 법: `종료 N`(확정된 거래 수), `목표/손절/미결정`, `평균 순손익비 x [하한, 상한]`(95% 신뢰구간, 비용 왕복 15bp 반영), `MAE`(최대 역행폭), `판정`.
- **판정 규칙(사전 등록, 변경 금지):**
  | 종료 거래 수 | 판정 |
  |---|---|
  | 30 미만 | `표본 부족(결론 금지)` — 숫자를 해석하지 않는다 |
  | 30 이상 | 신뢰구간이 0을 완전히 넘으면 `양`, 완전히 아래면 `음`, 걸치면 `0과 구별되지 않음(미확정)` |
- 신호 발생이 하루 약 0.8건(백테스트 기준)이므로 **30건까지 약 5주, 100건까지 약 4개월**이 걸린다. 그 전에 결과로 판단하지 말 것.
- 임계값(트리거 8봉·거래량 ×1.2·손익비 1.5R 등)을 바꾸면 **기록을 리셋하고 새 기간으로 다시 센다**(결과에 맞춰 조정하는 것을 막기 위함).

## 6. 롤백
- **즉시:** 변수 `RADAR_SIGNAL`을 삭제하거나 `off`로(다음 실행부터 신호 코드가 아예 실행되지 않음). `RADAR_SIGNAL_PAPER`도 삭제/`off`.
- 코드 롤백은 필요 없다. 상태 파일의 `state.signal`은 비활성 동안 무시되며 무해하다. 모의 기록을 버리려면 PAPER만 끄고(보존) 또는 상태 초기화를 별도 승인으로 한다.
- `RADAR_OPPORTUNITY`는 건드리지 않는다.

## 7. `RADAR_SIGNAL=on`(실제 Telegram 신호) 전환 전 체크리스트 — 별도 승인
- [ ] preview 안정성 합격 기준 충족(§4)
- [ ] 모의 성과가 `표본 부족`이 아닌 상태에서 `양`이거나, 사용자가 "미검증이어도 켠다"를 명시적으로 승인
- [ ] 하루 상한(`RADAR_SIGNAL_MAX_PER_DAY`, 기본 20) 확인
- [ ] 레버리지 위험(역행폭 평균 2.7%·p90 5.6%)을 이해
- [ ] 메시지에 "미검증 규칙"이 계속 표시됨
→ 위 항목은 사용자가 판단·승인한다. 이 문서의 합격 기준은 켜도 된다는 보증이 아니다.
