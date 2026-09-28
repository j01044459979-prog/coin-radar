# COIN RADAR 백엔드 설정 가이드 (Phase 0)

이 문서는 개발 경험이 없어도 따라 할 수 있도록 작성했습니다.
GitHub 저장소의 `worker/` 폴더 코드를 Cloudflare에 이미 만들어 둔 **coin-radar-engine** Worker에 연결하고,
정상 작동하는지 확인하는 방법을 설명합니다.

> Cloudflare 화면의 메뉴 이름은 가끔 바뀝니다. 이 문서와 글자가 조금 달라도 비슷한 이름의 메뉴를 찾으면 됩니다.

---

## 0. 전체 그림

```
GitHub 저장소 (coin-radar)
├── index.html            ← 기존 웹사이트 (GitHub Pages). Phase 0에서 건드리지 않음
├── coin-radar-v3.html    ← 기존 파일. 건드리지 않음
├── docs/SETUP.md         ← 지금 읽고 있는 문서
└── worker/               ← 새 백엔드 코드 (Cloudflare Worker)
    ├── wrangler.toml     ← Worker 설정 (이름: coin-radar-engine)
    ├── package.json
    ├── src/index.js      ← 주소(/api/health 등) 처리
    ├── src/reachability.js ← 거래소 접속 확인
    ├── src/response.js
    └── test/worker.test.js ← 자동 테스트
```

- GitHub 저장소에 코드가 올라가면 → Cloudflare가 자동으로 가져가서 → coin-radar-engine Worker에 배포합니다.
- 기존 웹사이트(GitHub Pages)는 이 과정과 **완전히 별개**라서 영향을 받지 않습니다.

Phase 0에서 만든 주소는 3개입니다.

| 주소 | 하는 일 |
|---|---|
| `/` | 사용 가능한 주소 목록 |
| `/api/health` | 서버가 살아 있는지 확인 |
| `/debug/reachability` | Binance 현물 / Binance 선물 / Upbit 에 실제로 접속되는지 확인 |

---

## 1. 준비물

- Cloudflare 계정 (이미 coin-radar-engine Worker를 만들어 둔 계정)
- GitHub 계정 (coin-radar 저장소 주인)
- **API Key나 토큰은 Phase 0에서 하나도 필요 없습니다.**

---

## 2. 먼저 코드를 main 브랜치에 반영하기

Worker 코드는 작업용 브랜치(`claude/...`)에 먼저 올라가 있습니다.
Cloudflare는 보통 `main` 브랜치를 기준으로 배포하므로, 먼저 Pull Request를 만들어 `main`에 합쳐(Merge) 주세요.

1. GitHub에서 coin-radar 저장소를 엽니다.
2. 위쪽에 노란 띠로 "claude/... had recent pushes" 가 보이면 **Compare & pull request** 를 누릅니다.
   (안 보이면 **Pull requests** 탭 → **New pull request** → base: `main`, compare: `claude/...` 선택)
3. 변경된 파일 목록을 확인합니다. `index.html` 과 `coin-radar-v3.html` 이 목록에 **없어야** 정상입니다.
4. **Create pull request** → **Merge pull request** → **Confirm merge** 를 누릅니다.

---

## 3. Cloudflare Worker를 GitHub 저장소에 연결하기 (권장 방법)

이 방법을 쓰면 앞으로 GitHub에 코드가 올라갈 때마다 Cloudflare가 **자동으로 배포**합니다.
컴퓨터에 아무것도 설치할 필요가 없습니다.

1. https://dash.cloudflare.com 에 로그인합니다.
2. 왼쪽 메뉴에서 **Workers & Pages** (또는 **Compute (Workers)**) 를 누릅니다.
3. 목록에서 **coin-radar-engine** 을 누릅니다.
4. 위쪽 탭에서 **Settings** 를 누릅니다.
5. **Build** (또는 **Builds**) 항목을 찾고, **Git repository** 옆의 **Connect** 를 누릅니다.
6. 처음이면 GitHub 로그인 창이 뜹니다. **Cloudflare Workers and Pages** 앱 설치를 허용합니다.
   - "Only select repositories" 를 고르고 **coin-radar** 만 선택하면 더 안전합니다.
7. 저장소 선택 화면에서 다음과 같이 입력합니다.

   | 항목 | 입력값 |
   |---|---|
   | Git account | 내 GitHub 계정 |
   | Repository | `coin-radar` |
   | Branch (Production branch) | `main` |
   | **Root directory (Path)** | `/worker` ← **가장 중요합니다** |
   | Build command | (비워 두기) |
   | Deploy command | `npx wrangler deploy` |

8. **Connect** (또는 **Save**) 를 누릅니다.
9. 연결이 끝나면 첫 배포가 자동으로 시작됩니다. **Deployments** (또는 Build history) 탭에서 진행 상황을 볼 수 있습니다.
   초록색 **Success** 가 뜨면 완료입니다. (보통 1~2분)

> ⚠️ 연결 후 첫 배포가 되면 기존 "Hello World" 코드는 GitHub의 코드로 **교체**됩니다. 정상적인 동작입니다.

> ⚠️ `wrangler.toml` 의 `name = "coin-radar-engine"` 이 Cloudflare의 Worker 이름과 다르면 배포가 실패합니다. 이름을 바꾸지 마세요.

### 배포가 실패했을 때

- **Deployments** 탭에서 실패한 항목을 누르면 로그가 보입니다.
- `Could not find wrangler.toml` / `Missing entry-point` → Root directory 가 `/worker` 로 되어 있는지 확인하세요.
- `name mismatch` 비슷한 오류 → Worker 이름이 `coin-radar-engine` 인지 확인하세요.
- 로그 전체를 복사해서 저(Claude)에게 보여 주시면 원인을 찾아 드립니다.

---

## 4. 작동 확인하기

1. Cloudflare에서 coin-radar-engine 화면의 **Settings → Domains & Routes** (또는 Overview 화면) 에서
   `https://coin-radar-engine.<내-계정-이름>.workers.dev` 형태의 주소를 찾습니다.
2. 브라우저 주소창에 아래 주소들을 하나씩 붙여 넣습니다. (`<내-계정-이름>` 부분은 실제 값으로 바꿉니다)

### 4-1. `/api/health` — 서버 살아 있는지

```
https://coin-radar-engine.<내-계정-이름>.workers.dev/api/health
```

이런 화면이 나오면 성공입니다.

```json
{
  "status": "ok",
  "message": "✅ 서버가 정상 작동 중입니다.",
  "service": "coin-radar-engine",
  "phase": 0,
  "version": "0.1.0",
  "time_utc": "2026-09-28T12:44:20.000Z",
  "time_kst": "2026-09-28 21:44:20",
  "cloudflare_datacenter": "ICN",
  "visitor_country": "KR"
}
```

- `cloudflare_datacenter` 는 내 요청을 처리한 Cloudflare 데이터센터 코드입니다. (예: `ICN` 인천, `NRT` 도쿄, `LAX` 로스앤젤레스)

### 4-2. `/debug/reachability` — 거래소 접속 확인

```
https://coin-radar-engine.<내-계정-이름>.workers.dev/debug/reachability
```

결과 예시:

```json
{
  "summary": "✅ 모든 거래소에 정상 접속됩니다. Phase 1로 진행해도 됩니다.",
  "cloudflare_datacenter": "ICN",
  "results": [
    {
      "id": "binance_spot",
      "name": "Binance Spot (현물)",
      "reachable": true,
      "http_status": 200,
      "latency_ms": 120,
      "message": "✅ 정상 접속",
      "sample": { "symbol": "BTCUSDT", "price_usdt": "65000.00" }
    }
  ]
}
```

각 항목 읽는 법:

| 항목 | 의미 |
|---|---|
| `reachable` | `true` = 접속 성공, `false` = 실패 |
| `http_status` | 거래소가 돌려준 번호. 200 = 정상, 451/403 = 지역 차단, 429 = 요청 과다 |
| `latency_ms` | 응답까지 걸린 시간 (1000 = 1초) |
| `message` | 결과를 한국어로 설명한 문장 |
| `sample` | 실제로 받아 온 BTC 가격 (실제 데이터라는 증거) |

확인하는 대상은 4개입니다.

1. `binance_spot` — Binance 현물 (api.binance.com)
2. `binance_spot_mirror` — Binance 현물 공개 미러 (data-api.binance.vision). 1번이 막힐 때 쓸 수 있는 대안입니다.
3. `binance_futures` — Binance 선물 (fapi.binance.com). OI / Funding Rate 에 필요합니다.
4. `upbit` — Upbit 원화 시장

> 💡 **여러 번 새로고침해 보세요.** Cloudflare는 요청마다 다른 데이터센터에서 실행될 수 있어서 결과가 달라질 수 있습니다.
> 결과를 캡처해서 저에게 보여 주시면 다음 단계(Phase 1) 방향을 정할 수 있습니다.

---

## 5. 접속이 막힐 때 (451 / 403)

Binance는 일부 국가(예: 미국)에서의 접속을 막습니다. Cloudflare 서버가 그 지역에서 실행되면 막힐 수 있습니다.

| 결과 | 의미 / 다음 할 일 |
|---|---|
| 4개 모두 ✅ | 문제 없음. Phase 1 진행 |
| `binance_spot` ❌, `binance_spot_mirror` ✅ | 현물 시세는 미러 주소로 해결 가능 |
| `binance_futures` ❌ | 선물(OI/Funding)은 대안이 필요 → Phase 5 전에 함께 결정 (중계 서버 등) |
| `upbit` ❌ | 드문 경우. 몇 번 새로고침 후에도 계속되면 알려 주세요 |

지금 당장 고칠 필요는 없습니다. 결과만 기록해 두면 됩니다.

---

## 6. 비밀값(Secret) 관리 규칙 — 앞으로 꼭 지킬 것

Phase 0에는 비밀값이 없습니다. Phase 4(Telegram 알림)부터 필요하며, 실제 등록 방법은 `docs/MONITOR.md` 5장을 보세요.

1. **비밀값(봇 토큰, API 키)은 절대로 GitHub 코드에 적지 않습니다.**
   - `wrangler.toml`, `src/*.js`, `index.html` 어디에도 적지 않습니다.
2. 비밀값은 Cloudflare 대시보드에만 등록합니다.
   - coin-radar-engine → **Settings** → **Variables and Secrets** → **Add**
   - Type: **Secret** 선택 (Text 가 아니라 **Secret**)
   - Variable name 예: `TELEGRAM_BOT_TOKEN`
   - Value: 실제 토큰 붙여 넣기 → **Deploy** / **Save**
   - Secret 으로 저장하면 저장 후에는 다시 보이지 않습니다. 정상입니다.
3. 컴퓨터에서 직접 테스트할 일이 생기면 `worker/.dev.vars.example` 을 복사해 `worker/.dev.vars` 를 만들고 그 안에만 적습니다.
   `.dev.vars` 는 `.gitignore` 에 들어 있어서 GitHub에 올라가지 않습니다.
4. **거래소(Binance/Upbit) API Key는 만들지 않습니다.** 시세 조회는 공개 데이터라 키가 필요 없고,
   키가 없으면 주문도 원천적으로 불가능해서 가장 안전합니다.
5. (권장) GitHub 저장소 → **Settings** → **Code security** (또는 Security & analysis) 에서
   **Secret scanning** 과 **Push protection** 을 켜 두세요. 실수로 토큰을 올리려 하면 GitHub이 막아 줍니다.

만약 실수로 토큰을 GitHub에 올렸다면: 파일에서 지우는 것만으로는 부족합니다(기록에 남음).
**즉시 해당 토큰을 폐기하고 새로 발급**한 뒤, 새 값은 Cloudflare Secret 에만 넣으세요.

---

## 7. (선택) 컴퓨터에서 직접 테스트/배포하는 방법

3번의 자동 배포를 쓰면 필요 없습니다. 개발 도구에 익숙해지면 참고하세요.

준비: [Node.js](https://nodejs.org) LTS 버전 설치

```bash
cd worker
npm install          # 처음 한 번
npm test             # 자동 테스트 (거래소에 실제로 접속하지 않음)
npm run dev          # 내 컴퓨터에서 실행 → http://localhost:8787/api/health
npx wrangler login   # Cloudflare 로그인 (브라우저 창이 열림)
npm run deploy       # coin-radar-engine 에 직접 배포
```

---

## 8. Phase 0 완료 체크리스트

- [ ] Pull Request를 `main` 에 합쳤다
- [ ] Cloudflare coin-radar-engine 을 GitHub 저장소(Root directory `/worker`)에 연결했다
- [ ] 배포가 Success 로 끝났다
- [ ] `/api/health` 에서 `"status": "ok"` 를 확인했다
- [ ] `/debug/reachability` 결과를 캡처했다 (여러 번 새로고침해서 비교)
- [ ] 기존 GitHub Pages 웹사이트가 전과 똑같이 열린다
