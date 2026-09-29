# COIN RADAR 카카오톡 알림 연결 (나에게 보내기)

중요한 시장 이상 신호가 생기면 **내 카카오톡 "나와의 채팅"** 으로 알림이 옵니다.
카카오 공식 API(카카오 로그인 + 카카오톡 메시지 "나에게 보내기")만 사용합니다.

- 처음 **한 번만** 카카오 로그인·동의를 하면, 이후에는 Worker 가 토큰을 **자동으로 갱신**합니다.
- 토큰은 Cloudflare D1 에 **암호화**되어 저장되며, GitHub·화면·로그에는 절대 나오지 않습니다.
- 알림은 데이터 상태 알림이며 투자 권유가 아닙니다.

> 카카오디벨로퍼스 화면은 2025년에 개편되었습니다. 메뉴 이름이 조금 달라도 비슷한 이름을 찾으면 됩니다.

---

## 준비물 (총 4단계, 약 15분)

| 단계 | 어디서 | 하는 일 |
|---|---|---|
| 1 | 카카오디벨로퍼스 | 앱 만들기, 카카오 로그인 켜기, 메시지 동의항목 켜기 |
| 2 | Cloudflare | Secret 3개 입력 |
| 3 | 카카오디벨로퍼스 | 리다이렉트 URI 1줄 등록 |
| 4 | COIN RADAR 설정 페이지 | "카카오 연결하기" → 로그인·동의 → "테스트 메시지" |

---

## 1단계. 카카오디벨로퍼스에서 앱 만들기

1. https://developers.kakao.com 접속 → 오른쪽 위 **로그인** (내 카카오 계정)
2. **내 애플리케이션**(또는 [앱]) → **애플리케이션 추가하기 / 앱 만들기**
   - 앱 이름: `COIN RADAR` / 회사명: 본인 이름 → 저장
3. 만든 앱을 누른 뒤 **[카카오 로그인]** 메뉴 → **사용 설정** 을 **ON**
4. **[카카오 로그인] → [동의항목]** → **카카오톡 메시지 전송 (talk_message)** 의 **설정** →
   **선택 동의**(또는 이용 중 동의) 선택 → 동의 목적에 `COIN RADAR 알림` 입력 → **저장**
5. **[앱] → [플랫폼 키] → [REST API 키]** 화면을 엽니다.
   - **REST API 키** 값을 복사해 메모장에 잠시 붙여 둡니다 (2단계에서 사용)
   - 같은 화면의 **클라이언트 시크릿** 이 **사용함(ON)** 인지 확인하고, **코드** 를 복사해 둡니다
   - (선택) **웹 도메인** 에 `https://j01044459979-prog.github.io` 추가 → 알림의 "COIN RADAR 보기" 버튼이 사이트로 연결됩니다

> REST API 키와 클라이언트 시크릿은 **비밀번호처럼** 다루세요. 채팅·GitHub·스크린샷에 올리지 마세요.

---

## 2단계. Cloudflare 에 Secret 3개 입력

Cloudflare 대시보드 → **Workers & Pages** → **coin-radar-engine** → **Settings** → **Variables and Secrets** → **Add**

| Type | Variable name | Value |
|---|---|---|
| **Secret** | `KAKAO_REST_API_KEY` | 1단계에서 복사한 REST API 키 |
| **Secret** | `KAKAO_CLIENT_SECRET` | 1단계에서 복사한 클라이언트 시크릿 코드 |
| **Secret** | `ADMIN_TOKEN` | 내가 직접 만든 긴 비밀번호 (영문·숫자 섞어 32자 이상) |

- 반드시 Type 을 **Secret** 으로 선택하세요 (Text 아님). 입력 후 **Deploy / Save** 를 누릅니다.
- `ADMIN_TOKEN` 은 COIN RADAR 설정 페이지에 들어갈 때 쓰는 **관리자 비밀번호**입니다. 잊지 않도록 비밀번호 관리 앱 등에 보관하세요.
- (예전 Telegram Secret 은 더 이상 사용하지 않습니다. 등록했다면 지워도 됩니다.)

---

## 3단계. 리다이렉트 URI 등록

1. 브라우저에서 아래 주소를 엽니다 (`<계정>` 은 내 workers.dev 주소)
   ```
   https://coin-radar-engine.<계정>.workers.dev/kakao/setup
   ```
2. 페이지의 **① 카카오 앱에 등록할 리다이렉트 URI** 상자에 나온 주소를 복사
   (예: `https://coin-radar-engine.<계정>.workers.dev/kakao/callback`)
3. 카카오디벨로퍼스 → **[앱] → [플랫폼 키] → [REST API 키] → [리다이렉트 URI]** 에 그대로 붙여 넣고 **저장**

---

## 4단계. 카카오 연결하기 + 테스트

1. 다시 `/kakao/setup` 페이지에서 **② 카카오 연결하기** 칸에 `ADMIN_TOKEN` 입력 → **카카오 연결하기**
2. 카카오 로그인 → **"카카오톡 메시지 전송"에 동의** → 계속
3. "✅ 카카오톡 연결 완료" 화면이 나오고, 카카오톡 **나와의 채팅** 에 연결 확인 메시지가 옵니다
4. **③ 테스트 메시지 보내기** 칸에 `ADMIN_TOKEN` 입력 → 버튼 → 테스트 메시지 1건 도착 확인
5. `https://coin-radar-engine.<계정>.workers.dev/api/monitor/status` 에서 확인
   - `kakao.configured: true`, `kakao.linked: true`, `kakao.ready: true`
   - `cron.healthy: true`, `d1.configured: true`

이제 끝입니다. 중요한 이상 신호가 생길 때만 알림이 옵니다 (조용한 시장에서는 몇 시간 동안 없을 수 있음).

---

## 자동 토큰 갱신 (사람이 할 일 없음)

| 토큰 | 유효기간 (카카오 기준) | COIN RADAR 처리 |
|---|---|---|
| Access Token | 약 6시간 | 만료 10분 전에 Cron 이 Refresh Token 으로 자동 갱신 |
| Refresh Token | 약 2개월 | 남은 기간이 1개월 미만이면 카카오가 새 값을 주고, 즉시 D1 에 저장 |

Cron 이 6시간마다 갱신하므로 Refresh Token 도 계속 연장됩니다.
다만 아래 경우에는 **4단계만 다시** 하면 됩니다 (`/api/monitor/status` 의 `kakao.last_error` 가 `reauth_required`).
- 카카오 계정에서 앱 연결을 끊었거나, 비밀번호 변경 등으로 토큰이 폐기된 경우
- 클라이언트 시크릿이나 REST API 키를 바꾼 경우

---

## 문제 해결

| 증상 | 해결 |
|---|---|
| 카카오 화면에 `KOE006` | 3단계 리다이렉트 URI 가 정확히 등록되지 않음 |
| "토큰 발급 실패: invalid_client" / `KOE010` | `KAKAO_REST_API_KEY` 또는 `KAKAO_CLIENT_SECRET` 값 확인 |
| "메시지 동의(talk_message) 없음" | 1단계 4번 동의항목을 켜고 4단계를 다시 |
| "ADMIN_TOKEN 이 올바르지 않습니다" | Cloudflare 에 넣은 ADMIN_TOKEN 과 같은 값인지 확인 |
| 버튼을 눌러도 사이트로 안 감 | 1단계 5번 웹 도메인 등록 |

---

## 보안 메모

- 필요한 Secret: `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`, `ADMIN_TOKEN` (선택: `KAKAO_REFRESH_TOKEN` — 보통 필요 없음)
- 설정 페이지의 연결·테스트는 `ADMIN_TOKEN` 이 맞을 때만 동작합니다. 연결 요청은 ADMIN_TOKEN 으로 서명된 10분짜리 `state` 로 보호됩니다.
- 토큰은 `KAKAO_REST_API_KEY` + `KAKAO_CLIENT_SECRET` 로 만든 키로 AES-GCM 암호화되어 D1 `kakao_auth` 표에 저장됩니다.
- 관련 코드: `worker/src/kakao.js`, `worker/src/kakao-pages.js`
