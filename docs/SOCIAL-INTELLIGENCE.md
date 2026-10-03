# COIN RADAR Social & Community Intelligence (Phase 6B)

Telegram 공개 채널과 국내 커뮤니티(Coinpan)에서 **"사람들이 갑자기 이야기하기 시작했는가"** 를 읽어,
기존 시장 데이터(가격·거래 활동·OI·Funding)와 공식 공지/뉴스(Phase 6A)를 **같은 시간축**에 놓습니다.

> ⚠️ Telegram·커뮤니티 글은 **사실 확인의 근거가 아닙니다.** 이 화면의 점수는 **화제성(관심도)** 이며 매수/매도 신호나 가격 예측이 아닙니다.
> "Telegram 때문에 올랐다" 같은 **인과 표현을 쓰지 않습니다** (관측 순서만 표시). LLM/AI·X(Twitter) API·외부 알림 발송은 사용하지 않습니다.
> 글에서 가격/OI/Funding 숫자를 만들지 않습니다 — 시장 반응 숫자는 기존 실제 시장 데이터만 사용합니다.

## 1. 조사 결과 (문서 조사 기준 — 개발 환경이 외부 접속을 막아 **실제 접속은 확인하지 못함**)

| 대상 | 방법 | 결론 |
|---|---|---|
| Telegram 공식 RSS | 없음 | — |
| Telegram Bot API | `getUpdates` 는 새 이벤트만, 봇이 **관리자**인 채널의 글만 받음. 남의 공개 채널 과거 글은 못 읽음 | 사용 불가 |
| Telegram MTProto(사용자 API) | API ID/Hash + 로그인 세션 필요 | Worker 에 부적합, 사용 안 함 |
| **공개 웹 미리보기 `https://t.me/s/<채널>`** | 로그인 불필요, 채널이 미리보기를 켠 경우 최근 약 20개 메시지 HTML (`tgme_widget_message`, `data-post`, `<time datetime>`) | **채택** (HTML 파싱이라 구조가 바뀌면 그 채널만 "수집 오류") |
| Coinpan RSS/API/robots/이용조건 | 확인하지 못함 (검색으로도 정보 없음) | adapter 는 구현했지만 **기본 비활성** |

- 이 방식은 공식 API 가 아닌 **공개 웹 페이지의 HTML** 에 의존합니다. t.me 의 robots.txt/이용조건과 Cloudflare Worker 에서의 안정성은 **운영에서 확인**해야 합니다.
- 우선순위(공식 API → 공식 피드 → 안정적 공개 endpoint → HTML 스크래핑)를 따라 봤을 때 Telegram 은 마지막 항목밖에 없어 HTML 을 선택했고, Coinpan 은 근거를 못 찾아 꺼 둔 상태로 남겼습니다.

## 2. Telegram 수집 방식

- 채널 목록: `worker/src/intel/telegram.js` 의 `TELEGRAM_CHANNELS` — `{ id, name, username, url, enabled, reliabilityTier }`. 초기: WeCryptoTogether, emperorcoin, enjoymyhobby, blockmedia (모두 Tier 3). **채널 추가 = 배열에 한 줄.**
- 요청: `GET https://t.me/s/<username>` (타임아웃 8초, 최종 호스트가 `t.me` 가 아니면 거부, 응답 1.5MB 상한).
- 저장하는 값: `source`(채널 id), `channel`, `message_id`, `url`(`https://t.me/<채널>/<번호>`), `published_at`(UTC ms), `collected_at`, **excerpt(최대 280자)**, 관련 심볼, 카테고리, 외부 링크(최대 5개, 안전한 URL 만), 공개 조회수(있을 때). **메시지 전문·작성자·조회자 정보는 저장하지 않습니다.**
- 텍스트 없는 메시지(사진만)와 다른 채널에서 전달된 글은 제외. 빈 채널은 오류가 아니라 "0건 정상", 미리보기가 꺼진 채널/Telegram 이 아닌 페이지는 그 채널만 오류.
- HTML 은 태그·`script`·`style`·`iframe`·이벤트 핸들러 제거 후 텍스트만 쓰며 `javascript:`/`data:` 링크는 버립니다.

## 3. Coinpan(국내 커뮤니티) 수집 방식 — 기본 **비활성**

- 이용 조건/robots/RSS 를 확인하지 못해 `enabled: false`. 켜려면 Cloudflare 변수(비밀값 아님):
  - `INTEL_ENABLE=coinpan`
  - `COINPAN_BOARDS=<게시판 RSS 또는 목록 URL>[,<URL>...]` (최대 3개, **coinpan.com 호스트만** 허용 — 다른 호스트/`javascript:` 는 무시)
- 파싱 우선순위: ① RSS/Atom (기존 `parseFeed` 재사용) → ② HTML 목록(같은 사이트의 `/<게시판>/<숫자ID>` 또는 `?document_srl=<숫자>` 링크, 최후의 수단).
- 저장: 게시글 ID, 제목, 게시시간(없으면 NULL → **수집 시각을 게시 시각으로 속이지 않고** 관심도 계산에만 첫 수집 시각 사용), URL, 관련 코인, (읽을 수 있을 때만) 댓글수. **닉네임·회원 ID·IP·작성자 칸은 읽지도 저장하지도 않습니다** (테스트로 고정). 로그인 영역 접근 없음.
- 커뮤니티는 사실 검증 소스가 아니라 **관심도 센서(Tier 4)** 입니다.

## 4. 출처 신뢰도 · 검증 상태

| Tier | 출처 | 비고 |
|---|---|---|
| 1 | Binance/Upbit 공식 공지 | |
| 2 | 주요 뉴스 | |
| 3 | Telegram 공개 채널 | 공식 확인 근거 아님 |
| 4 | 국내 커뮤니티 | 공식 확인 근거 아님 |

검증 상태는 기존 4단계(공식 확인 / 복수 출처 확인 / 뉴스 보도 / 미확인)를 유지합니다.
- Telegram/커뮤니티 글만 있으면 **미확인**. 글에 "공식"이라는 단어가 있어도 변화 없음.
- **실제로 연결된 클러스터가 있을 때만** 그 클러스터의 검증을 따라갑니다 (공식 클러스터 → 공식 확인, 독립 뉴스 2곳 이상 → 복수 출처 확인, 뉴스 1곳 → 뉴스 보도).
- 링크 도메인이 공식(binance.com, upbit.com …)이어도 **같은 URL 이 이미 수집된 공식 항목과 일치**해야 승격합니다. 일치 항목이 없으면 `official_domain` 링크로만 저장하고 미확인.
- Telegram/커뮤니티는 클러스터의 **정보 중요도·독립 출처 수·검증 상태를 올리지 않습니다**(집계 `telegram_count`/`community_count` 와 관측 시각만).

## 5. 이벤트 클러스터 연결

소셜 글은 **새 클러스터를 만들지 않고**, 최근 48시간 공식/뉴스 클러스터에 아래 순서로 연결합니다 (코드: `social.js`). **Telegram 이 공식 공지보다 먼저 올라온 경우**도 공식/뉴스 항목이 나중에 수집될 때 최근 24시간의 미연결 소셜 글을 다시 연결하고(`reconcileSocial`), 클러스터 검증이 바뀌면(예: 뉴스 1곳 → 2곳) 연결된 글의 검증 상태도 함께 맞춥니다.
1. **링크 연결**: 글의 공식/뉴스 도메인 링크의 `url_key` 가 이미 수집된 항목과 같으면 그 클러스터.
2. **같은 사건 규칙**: 같은 코인이 있어야 하며 (카테고리 일치·일반 제외 + 3시간 이내) 또는 (제목 핵심 단어 3개 이상 공통 + 24시간 이내). 다른 코인/다른 카테고리/먼 시간이면 연결하지 않음(과도한 클러스터링 방지).

연결은 "같은 사건일 가능성"이며 인과관계가 아닙니다. 알려진 한계: 한글 글과 영문 공지는 단어가 겹치지 않아 카테고리 규칙(코인+카테고리+시간)에 의존합니다.

클러스터 컬럼 추가(`ALTER`, 자동·멱등): `official_count`, `news_count`, `telegram_count`, `community_count`, `official_seen_at`, `social_seen_at`, `community_seen_at` (기존 클러스터는 공식/뉴스 집계를 한 번 백필). 화면은 "관측 순서: 공식 12:01 → Telegram 12:03 → 커뮤니티 12:06" 처럼 **먼저 관측된 순서만** 보여줍니다.

## 6. 심볼 매칭 강화

기존 6A 매처(`symbols.js`)를 `detectSymbols(text, dict, { social: true })` 로 확장. 별칭은 `worker/src/intel/aliases.js` 에서 관리합니다.
- 한글 이름(비트코인, 이더리움, 솔라나, 리플 …)은 기존 사전 + Upbit 마켓 목록의 `korean_name`.
- **줄임말**: `비트→BTC, 이더→ETH, 리플→XRP, 도지→DOGE, 솔→SOL …` 은 한글 단어(+조사) 단위로만. 1글자(`솔`)는 안전한 조사(이/가/은/는/도 …) + 시장 문맥 단어(가격·상승·상장·% 등)가 **함께** 있을 때만 (`솔직히`, `솔로` 오탐 방지).
- **소문자 티커**(btc, eth, sol, doge …)는 일반 영어 단어와 겹치지 않는 목록만. `link`, `near`, `dot`, `gas`, `one`, `in`, `us`, `ai` 등은 인정하지 않음 (`(ONE)`, `$ONE`, `ONE/USDT` 같은 명확한 문맥만).
- `$sol` 같은 캐시태그 인정.

## 7. Mention Engine · Community Attention

Telegram 언급(`kind=telegram`)과 커뮤니티 게시글(`kind=community`)을 같은 규칙으로 집계합니다 (`attention.js`, 순수 함수).
- 단위: `social_mentions(item_id, symbol)` PRIMARY KEY → **같은 글을 여러 번 수집해도 언급이 늘지 않음**. 시각은 게시 시각(없으면 첫 수집 시각).
- 창: 15분 / 1시간 / 6시간 / 24시간 개수. 배수 = (창 안 시간당 개수) ÷ (직전 기준 기간의 시간당 개수):
  | 창 | 기준 기간 | 배수 계산에 필요한 최소 수집 기간 |
  |---|---|---|
  | 15분 | 직전 6시간 | 3시간 |
  | 1시간 | 직전 24시간 | 12시간 |
  | 6시간 | 직전 48시간 | 24시간 |
  | 24시간 | 개수만 | — |
  수집 기간이 모자라면 `state: insufficient` → **"데이터 축적 중"** (배수 억지 계산 안 함). 기준 기간에 0건이고 최근 3건 이상이면 `new`("새로 등장").
- **소셜 관심도 점수 0~100** (deterministic):
  - Telegram: 증가율 40(배수 1배=0, 5배 이상 만점) + 개수 20(1시간 8건 만점) + 채널 다양성 25(2개 채널부터, 4개 만점) + 최근성 15
  - 커뮤니티: 증가율 50 + 개수 30(1시간 10건 만점) + 최근성 20
  - 배수를 못 구하면 그 요소 0점이고 `partial: true`("일부 요소 수집 중").
- **정보 중요도(`importance`)와 소셜 관심도(`score`)는 별개**입니다. 공식 상장 공지는 중요도 높음·관심도 낮을 수 있고, 밈코인 커뮤니티 폭증은 관심도 높음·검증 낮음일 수 있습니다. 화면에서도 색과 라벨을 분리했습니다.

## 8. D1 스키마

`worker/migrations/0003_social.sql` (참고용, Worker 가 자동 실행: `CREATE ... IF NOT EXISTS` + `PRAGMA table_info` 로 확인한 `ALTER`; 동시 실행돼도 준비 작업은 한 번만).

| 테이블 | 내용 | Retention |
|---|---|---|
| `social_items` | 글 요약 (UNIQUE(source, message_id), excerpt, 링크, 심볼, 카테고리, 검증, cluster_id). 작성자 컬럼 없음 | Telegram **14일**, 커뮤니티 **7일** |
| `social_mentions` | 글×심볼 언급 (PK item_id+symbol, 인덱스 kind+ts / symbol+ts) | 원본과 동일 |
| `social_hourly` | 시간별 집계(개수·채널 수). 매시 정각 최근 6시간을 멱등 재계산 | **90일** |
| `event_clusters` (기존) | 집계/관측 시각 컬럼 7개 추가 | 60일 (기존) |

용량: Telegram 4채널 × 하루 수십~백여 건 × 약 0.4KB ≈ 수 MB (무료 D1 5GB 대비 미미). 쓰기: 새 글 1개당 item 1 + 심볼 수만큼 mention, 실행당 새 글 상한 8개/채널.

## 9. Cron · CPU 예산

- Cron 은 그대로 2개: `* * * * *`(Upbit 감시), `*/2 * * * *`(정보 수집). **새 Cron 을 추가하지 않았습니다.**
- 정보 Cron 은 출처마다 `last_attempt_at` 으로 주기를 판단하고, **실행당 CPU 예산(base cost 합계 4)** 안에서 공식 공지를 먼저 예약한 뒤 목표 주기를 가장 많이 넘긴 출처부터 처리합니다. 실행 도중 비용이 한계(예산×1.5)를 넘으면 남은 출처는 다음 실행으로 이월합니다. 예산은 `INTEL_BUDGET` 변수로 조정(유료 플랜이면 올릴 수 있음). 자세한 규칙·측정은 `docs/INTELLIGENCE.md` 부록.

  | 출처 | 주기 | base cost |
  |---|---|---|
  | Binance / Upbit 공지 | 2분 | 1 |
  | Telegram 채널 각각 | 10분 | 1 |
  | 뉴스 RSS 각각 | 12분 | 2 |
  | Coinpan(켰을 때) | 12분 | 2 |
- Telegram 은 **메시지 번호만 먼저 훑어(`peekMessageIds`) 이미 저장된 글은 파싱·분석하지 않고**, 첫 수집은 채널당 실행당 8개씩 나눠 처리합니다. (Node 콜드 측정, mock HTML: 20개 메시지를 전부 파싱+분석하면 약 14ms 로 무료 CPU 10ms 를 넘길 수 있었고, 이 설계에서는 평상시 번호 훑기 0.2ms + 새 글 2개 파싱·분석 약 3ms, 첫 수집 8개 약 4ms(+사전 구성 약 3ms). Cloudflare Workers 의 실제 CPU 와는 다를 수 있어 운영에서 확인해야 합니다.)
- 14일보다 오래된 글은 본문을 파싱하지 않아, 오래된 글만 있는 채널이 매 실행마다 CPU 를 쓰지 않습니다.
- 28분 안에 공식 2개 + 뉴스 3개 + Telegram 4개가 모두 시도되는지, Telegram 새 글이 가득해도 공식이 12번 중 11번 이상 매번 수집되는지 테스트로 확인(굶는 출처 없음). 한 출처가 실패해도 다른 출처는 계속 (6A 독립 실패 구조 재사용).

## 10. Worker API (GET 전용, 강제 수집 endpoint 없음)

| 주소 | 내용 |
|---|---|
| `/api/intelligence/social` | Telegram 최근 글 (excerpt) `?limit=1~50&symbol=SOL&channel=tg-blockmedia` |
| `/api/intelligence/community` | 커뮤니티 최근 글 (같은 쿼리) |
| `/api/intelligence/attention` | 코인별 관심도 `?kind=all|telegram|community&limit&symbol` → 창별 개수/배수/상태, 점수, 채널 수, **실제로 연결된** 클러스터 목록과 검증 |
| `/api/intelligence/events` | (기존) 응답에 `counts`, `timeline` 추가 — 기존 필드 호환 |
| `/api/intelligence/status` | (기존) 소셜 출처 상태 + `disabled_sources`(이유 포함) |

입력은 모두 검증(`limit` 1~50, `symbol` `[A-Z0-9]{2,10}`, `channel` `[a-z0-9-]{3,40}`, `kind`) 하고 잘못되면 400, SQL 은 전부 bind. POST 는 405.

## 11. 화면

- 상단 탭 **📣 Telegram·커뮤니티** (X Radar 는 계속 "준비 중").
- 패널: Telegram 언급 증가 코인 카드 · 최근 Telegram 글 · 국내 커뮤니티 관심 증가 코인 · 출처 상태(채널별, 비활성 이유).
- 카드: 소셜 관심도(보라색)와 검증 배지, 창별 개수/배수("데이터 축적 중"), 동시 언급 채널 수, 연결 이벤트, 시장 반응(Binance 감시 종목의 실제 가격·거래 활동·OI·Funding, 없으면 숨김/안내).
- **전체 레이더**: "최근 중요 정보"에 소셜 신호를 별도 줄로 (최대 3개). 공식 공지 연결 / 여러 채널 동시 언급 / 평소 대비 3배 이상 또는 새로 등장 / 시장 이상과 동시 — 중 하나 이상일 때만.
- **이벤트 센터 "SNS 확산"**: 같은 신호 3개까지. X 는 아직 미포함.
- 상태 구분: 첫 수집 전 "수집 준비 중", 출처 하나 실패는 그 출처만 "수집 오류", Worker API 호출 자체가 실패할 때만 "정보 서버 연결 실패".

## 12. 보안

외부 텍스트는 전부 untrusted: 저장 전 HTML/스크립트/iframe 제거, URL 은 http(s) 만(Worker 저장·API 출력·화면 3단계), `rel="noopener noreferrer"` 새 탭, 화면 렌더링은 항상 `esc()`, 텍스트 길이·응답 크기·항목 수·타임아웃·리다이렉트 호스트 제한, SQL bind, 작성자 개인정보 미저장.

## 13. 알려진 한계

- **실제 t.me / Coinpan 응답은 이 개발 환경에서 검증하지 못했습니다** (mock 테스트만). t.me 구조 변경, Cloudflare IP 차단/속도 제한, 채널의 미리보기 비활성화는 운영에서만 알 수 있습니다.
- `t.me/s/` 한 페이지(최근 약 20개)만 읽으므로, 한 채널이 10분에 20개 넘게 올리면 일부를 놓칩니다.
- 배수는 수집을 시작한 뒤 12~24시간이 지나야 계산됩니다 (그 전에는 개수만).
- 한글 ↔ 영문 제목은 단어가 겹치지 않아 클러스터 연결이 카테고리·시간 규칙에 의존합니다. 같은 코인에 대한 서로 다른 공식 공지가 3시간 안에 있으면 잘못 연결될 수 있습니다.
- 한글 줄임말/소문자 티커 인식은 오탐을 줄이려고 보수적이라 놓치는 경우가 있습니다.
- 커뮤니티 게시시간이 없는 소스는 첫 수집 시각으로 관심도를 계산합니다.

## 14. 출처 추가 방법

- **Telegram 채널**: `TELEGRAM_CHANNELS` 에 한 줄 추가 → 끝 (저장·중복 제거·심볼·연결·관심도·화면 자동). 끄려면 `enabled: false` 또는 환경변수 `INTEL_DISABLED=tg-<이름>`.
- **다른 커뮤니티**: `community.js` 의 `COMMUNITY_SOURCES` 에 항목 추가 + `sources.js` 의 어댑터(`fetchRaw`/`parse`) 연결. RSS 가 있으면 `parseCommunity` 가 그대로 처리합니다.
- **X**: 무료 접근이 사실상 없어 유료 API 여부를 먼저 결정해야 합니다 (이번 Phase 에서는 연결하지 않음).

## 15. 운영 확인 (PR merge 후)

1. `https://coin-radar-engine.j01044459979.workers.dev/api/intelligence/status` — `sources` 의 `tg-*` 4개 `status`(`ok`/`error`)와 `last_error`, `diagnostics.code`, `disabled_sources`(coinpan).
2. `…/api/intelligence/social?limit=5` — 글이 들어오는지. `…/api/intelligence/attention?kind=telegram` — 개수는 바로, **배수는 12~24시간 뒤**.
3. `last_error` 가 `HTTP 403/429` 면 Cloudflare 에서의 t.me 접근 제한, `미리보기가 꺼져` 면 그 채널이 웹 미리보기를 끈 것.
4. 사이트의 📣 Telegram·커뮤니티 탭.
