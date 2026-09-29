# COIN RADAR Crypto Intelligence Engine (Phase 6A)

시장 이상징후(가격·거래 활동·OI·Funding)에 **"무슨 일이 발생했는가"** 를 붙이는 정보 레이어입니다.
거래소 공식 공지와 주요 뉴스를 수집해 같은 사건은 하나로 묶고, 관련 코인을 찾고, 현재 시장 데이터와 나란히 보여줍니다.

> ⚠️ 이 화면의 모든 점수는 **정보의 중요도**이며 상승·하락 예측이나 매수·매도 추천이 아닙니다.
> 제목·링크·시간은 출처가 돌려준 값 그대로이고, 코드나 AI 가 뉴스 내용·숫자를 만들어내지 않습니다. **LLM/AI 는 사용하지 않습니다.**

---

## 1. 구조

```
Cron */2 (별도 실행)                          Worker
 ┌──────────────────────────────┐   runIntelligence (worker/src/intel/engine.js)
 │ 출처별 실행 주기 확인 (source_health) │──▶ ① 출처별 독립 수집 (8초 timeout, 실패 격리)
 └──────────────────────────────┘        ② 정리(HTML 제거) · URL 검증 · 중복 URL 제거
                                          ③ 심볼 탐지 · 카테고리 · 기본 중요도
                                          ④ Event Cluster 묶기 · 검증 상태
                                          ⑤ Upbit 1분봉으로 시세 반응 연결
                                          ⑥ D1 저장 (+ 매시 정각 retention 정리)
브라우저 (index.html)  ◀── GET /api/intelligence/events|latest|status (CORS 허용, 읽기 전용)
   └ 카드 표시 + 이미 받은 Binance 1분봉 · 선물 OI/Funding 으로 시장 반응 계산
```

| 파일 | 역할 |
|---|---|
| `worker/src/intel/sources.js` | **Source Adapter 목록** (새 출처는 여기에 추가), 출처 상태 판정 |
| `worker/src/intel/official.js` | Binance / Upbit 공식 공지 파서 |
| `worker/src/intel/feed.js` | RSS 2.0 / Atom 파서 (의존성 없음) |
| `worker/src/intel/text.js` | HTML 제거 · URL 검증/정규화 · 시간 파싱 |
| `worker/src/intel/symbols.js` | 코인 심볼 탐지 (alias 사전 + 동적 사전) |
| `worker/src/intel/classify.js` | 카테고리 · 중요도 · 검증 상태 |
| `worker/src/intel/cluster.js` | 이벤트 클러스터링 |
| `worker/src/intel/market.js` | 이벤트 시각 전후 Upbit 시세 반응 계산 |
| `worker/src/intel/store.js` | D1 스키마 · 저장/조회 · retention |
| `worker/src/intel/engine.js` | 수집 실행 (Cron) |
| `worker/src/intel/api.js` | `/api/intelligence/*` |
| `assets/intel-core.js` | 화면용 순수 함수 (시간 표시 · 필터 · 카드 · 시장 반응 표시) |

기존 1분 Upbit 감시(`monitor.js`)와 **코드·Cron 실행이 분리**되어 있습니다. 정보 수집이 실패해도 감시에는 영향이 없습니다.

## 2. Source Tier

| Tier | 화면 표시 | 예 | 이번 Phase |
|---|---|---|---|
| 1 | **공식** | Binance 공지, Upbit 공지 (향후 프로젝트 공식 블로그) | ✅ |
| 2 | **뉴스** | BlockMedia, CoinDesk, Cointelegraph | ✅ (코드 연결, 운영 확인 필요) |
| 3 | 소셜 | X, Telegram 공개 채널 | 구조만 준비 |
| 4 | 커뮤니티 | Coinpan 등 | 구조만 준비 |

Tier 숫자는 D1(`source_tier`)에만 있고 화면에는 "공식/뉴스/소셜/커뮤니티"로 표시합니다.

## 3. 실제 사용 source 와 수집 방식

| Source | 방식 | 주기 | 비고 |
|---|---|---|---|
| Binance 공지 | `www.binance.com/bapi/composite/v1/public/cms/article/list/query` (catalog 48 신규 상장 · 161 상장폐지 · 49 최신 뉴스) | 2분 | 공개 CMS JSON. 문서화된 공식 API 는 아님. Worker 위치에 따라 451/403 차단 가능 → 그 경우 상태 "지연"으로만 표시 |
| Upbit 공지 | `api-manager.upbit.com/api/v1/announcements` | 2분 | 업비트 공지 페이지가 쓰는 공개 JSON. 공식 문서화 API 는 아님 |
| BlockMedia | `https://www.blockmedia.co.kr/feed` (RSS) | 5분 | |
| CoinDesk | `https://www.coindesk.com/arc/outboundfeeds/rss` (RSS) | 5분 | |
| Cointelegraph | `https://cointelegraph.com/rss` (RSS) | 5분 | |

- RSS/JSON 만 사용하고 **HTML 스크래핑은 하지 않습니다.** 불안정하거나 조건이 불명확한 출처는 넣지 않았습니다.
- API Key/Secret 은 없습니다. 요청에 `User-Agent: coin-radar-engine/6a (+저장소 URL)` 를 붙입니다.
- 출처 하나를 끄려면 Cloudflare 환경변수 `INTEL_DISABLED` 에 쉼표로 적습니다 (예: `coindesk,blockmedia`). 비밀값이 아니므로 wrangler.toml `[vars]` 에 써도 됩니다.
- ⚠️ 이 문서를 작성한 개발 환경은 외부 사이트 접속이 막혀 있어 **위 주소들의 실제 응답은 자동 테스트(mock)로만 검증**했습니다. 운영에서 `/api/intelligence/status` 로 확인하세요 (§13).

### 저작권
기사 전문은 저장하지 않습니다. 제목 + 공개 feed 의 짧은 설명(최대 280자, 태그 제거) + URL 만 저장하고 원문은 링크로 보냅니다.

## 4. 수집 주기 · Cloudflare 무료 플랜

- Cron 2개 사용 (계정 한도 5개): `* * * * *` (기존 Upbit 감시), `*/2 * * * *` (정보 수집).
- 정보 Cron 은 2분마다 깨어나 출처별 `last_attempt_at` 을 보고 **때가 된 출처만** 요청합니다 (공식 2분, 뉴스 5분).
  연속 실패하면 그 출처의 간격을 늘립니다 (실패 n회 → 간격 × min(1+n, 4)).
- 실행당 외부 요청: Binance 3 + Upbit 공지 1 + 뉴스 3 + Upbit 마켓 목록 1 + 시세 캔들 최대 4 = **최대 12개** (무료 한도 50개). 기존 감시는 별도 실행이라 각자 한도가 적용됩니다.
- D1 쓰기 상한: 출처당 새 항목 최대 30건/회, 시세 스냅샷 최대 12행/회, 이미 저장된 URL 은 분석하지 않고 건너뜀.
- ⚠️ 무료 플랜 CPU 는 실행당 약 10ms 입니다. 새 항목이 거의 없는 평상시에는 피드 파싱 정도만 하지만, **처음 실행(첫 수집)** 이나 항목이 많을 때 초과할 수 있습니다. Cloudflare 로그에 `exceeded CPU` 가 반복되면 `INTEL_DISABLED` 로 출처를 줄이거나 Workers Paid 로 전환하세요. 실패해도 다음 실행에서 이어서 수집합니다.

## 5. D1 스키마

`worker/migrations/0002_intelligence.sql` (참고용, Worker 가 처음 실행 때 자동 생성). 모든 시각은 **epoch milliseconds (UTC)**.

| 테이블 | 내용 | Retention |
|---|---|---|
| `intelligence_items` | 수집한 공지/기사 원본 (제목, URL, `url_key` UNIQUE, `published_at`(없으면 NULL), `collected_at`, `event_time`, 짧은 설명, `symbols`, `category`, `importance`, `verification`, `source`, `source_type`, `source_tier`, `cluster_id`) | **30일** |
| `event_clusters` | 같은 사건 묶음 (대표 제목/링크, 심볼, `importance_base` + `reaction_bonus` = `importance`, `verification`, 출처 목록, 건수, 최초 게시 `event_time`) | **60일** |
| `event_market_snapshots` | 이벤트 시각 전후 Upbit 시세 (`price_at_pub`, `change_pre5`, `change_post5`, `change_post15`, `change_5m`, `change_15m`) | 클러스터와 함께 |
| `source_health` | 출처별 마지막 시도/성공, 연속 실패, 오류 | 유지 (출처당 1행) |

- 중복 방지: `url_key`(추적 파라미터·해시·`www.`·끝 `/` 제거한 URL) UNIQUE + `INSERT OR IGNORE`, 수집 전에 기존 키를 조회해 새 항목만 분석합니다.
- 정리: 매시 정각 실행에서 `pruneIntel` (항목 30일, 클러스터 60일 + 스냅샷).

## 6. 카테고리

제목 키워드로만 분류합니다 (제목에 없는 사실은 추측하지 않음). 공식 공지는 위에서부터 첫 번째로 맞는 항목, 뉴스는 **보안/규제를 먼저** 봅니다 (예: "SEC approves ETF listing" → 상장이 아니라 규제).

`상장`(listing) · `상장폐지·거래지원 종료`(delisting) · `투자유의`(warning) · `거래지원`(trading) · `입출금`(deposit) · `네트워크`(network) · `점검`(maintenance) · `에어드롭`(airdrop) · `프로모션`(promotion) · `보안사고`(security) · `규제·정책`(regulation) · `일반`(general)

## 7. 중복 제거 · Event Cluster

같은 URL 은 저장하지 않고, 새 항목은 최근 48시간 클러스터 중 **모두** 만족하는 것에 합칩니다.

1. 클러스터 마지막 시각과 24시간 이내
2. 양쪽에 심볼이 있으면 하나 이상 겹침 (**서로 다른 코인이면 절대 묶지 않음** — "Binance Will List AAA" / "…BBB" 방지)
3. 제목 단어 유사도(Jaccard) ≥ 0.6, **또는** 같은 코인 + 같은 카테고리(일반 제외) + 코인 이름을 뺀 핵심 단어 2개 이상 공통

여러 항목이 묶이면 대표 제목/링크는 더 신뢰도 높은 출처(공식 > 뉴스)의 것을 씁니다. 언어가 다른 글(예: 한글 공지 ↔ 영문 기사)은 제목 단어가 겹치지 않아 **묶이지 않을 수 있습니다** (알려진 한계, 의도적으로 단순한 deterministic 방식).

## 8. 심볼 매칭

- 사전 = 기본 alias(주요 코인 영문/한글 이름) + **Upbit 마켓 목록**(`korean_name`/`english_name`/티커)에서 실행 때마다 동적 구성. Binance 목록은 Worker 에서 접속이 막혀 사용하지 않습니다. 마켓 목록을 못 받으면 기본 사전만 씁니다.
- 티커는 **대문자 그대로** 단어 경계에서만 매칭 (`one`, `in`, `us` 무시). 이름은 영문 단어 경계/한글 부분 문자열.
- `ONE`, `AI`, `IN`, `US`, `IT`, `ON`, `HOT`, `SUN` … 일반 단어와 겹치는 티커는 `(ONE)`, `$ONE`, `ONE/USDT`, `ONEUSDT`, `ONE token` 같은 **문맥이 있을 때만** 인정합니다.
- `ETF`, `SEC`, `USD`, `CEO` 등 금융 약어는 코인으로 보지 않습니다. `Bitcoin Cash` 는 BTC 로 오탐하지 않습니다.
- 별칭은 `worker/src/intel/symbols.js` 의 `CORE` (프로젝트명 ↔ 심볼) 에서 관리합니다.

## 9. 정보 중요도 (0~100)

투자 방향 점수가 아닌 **정보의 중요도**입니다. deterministic 합산이며 100 을 넘으면 100.

```
항목 기본 = 출처 계층 + 카테고리 + 관련 코인 규모
  출처 계층   공식 30 · 뉴스 15 · 소셜 8 · 커뮤니티 4
  카테고리    상장 30 · 상장폐지 30 · 보안사고 26 · 투자유의 22 · 규제 20 · 거래지원 16 · 네트워크 14
              · 입출금 12 · 에어드롭 8 · 점검 6 · 일반 5 · 프로모션 3
  코인 규모   BTC/ETH 12 · 주요 코인(XRP, SOL, BNB …) 8 · 그 외 탐지된 코인 4 · 없음 0
클러스터   = 묶인 항목 중 최대 기본 + 독립 출처 가점 + 시장 반응 가점
  독립 출처   출처가 하나 늘 때마다 +6 (최대 +18)
  시장 반응   Upbit 1분봉의 "게시 후 15분" 또는 "현재 15분" 변화율 절대값 ≥3% → +10, ≥1.5% → +6, ≥0.7% → +3
```

예: Binance 공식 SOL 상장 = 30 + 30 + 8 = **68**. 뉴스 1건만 있는 일반 기사(코인 없음) = 15 + 5 = **20**.

**화면 정렬(전체 레이더 "최근 중요 정보")**: `정보 중요도 − min(40, 경과 시간(시간) × 1.5)`, 48시간 지난 것 제외. 게시 시간이 없으면 수집 시각 기준.

## 10. 검증 상태

| 상태 | 조건 |
|---|---|
| **공식 확인** | 공식 출처(Binance/Upbit 공지)에서 직접 수집한 항목이 클러스터에 있음 |
| **복수 출처 확인** | 서로 다른 **뉴스 출처 2곳 이상** 이 같은 사건을 보도 (같은 출처 2건은 1곳) |
| **뉴스 보도** | 뉴스 출처 1곳 |
| **미확인** | 소셜/커뮤니티에서만 발견 (향후) |

"사실 여부"를 코드/AI 가 판정하지 않습니다. 위 규칙으로 **어디서 확인됐는지**만 표시합니다.

## 11. 시장 반응 연결

| 데이터 | 계산 위치 | 기준 |
|---|---|---|
| 가격 5분/15분 | 브라우저 (Binance 1분봉) | **지금 기준** 최근 5/15분. Binance 감시 종목(24H 거래대금 상위 + 기본 6종목)만 |
| 거래 활동 배수 | 브라우저 | 15분 구간 (기존 레이더와 같은 공식) |
| OI 5분/15분, Funding | 브라우저 (Binance Futures, 기존 선물 레이더 데이터) | 선물 감시 종목만 |
| Upbit 게시 전 5분 / 게시 후 5분·15분 | Worker (Upbit 1분봉, D1 저장) | **게시 시각 기준.** Upbit 원화 마켓이 있는 코인만 |

- Worker 는 Binance 시세 API 에 접속할 수 없어(451/403) Binance 기반 값은 브라우저가 이미 받은 데이터로 계산합니다. 그래서 **카드를 본 시점의 최근 5/15분 값**이며 게시 시점 값이 아닙니다.
- 데이터가 없으면 줄을 숨기고, 관련 코인이 감시 종목이 아니면 "Binance 감시 종목이 아니어서 시장 데이터 없음", 수집 중이면 "데이터 수집 중"으로 표시합니다. **임의 값은 넣지 않습니다.**
- 게시 시각 전후 분석 구조: `event_market_snapshots` 에 게시 시점 가격(`price_at_pub`), 게시 전 5분/후 5·15분 변화율, 현재 5·15분 변화율을 저장합니다 (게시 후 1시간 동안 갱신, 이후 고정). 게시 시각을 모르는 항목은 게시 기준 값이 NULL 입니다. Binance 기준 과거 분석은 이후 Phase 과제입니다.

## 12. 시간 처리

- DB 는 전부 epoch ms (UTC). 화면은 "방금 전 / N분 전 / N시간 전 / N일 전" + 한국 시간(KST) `MM-DD HH:mm`.
- 게시 시간이 없는 출처는 `published_at = NULL` 이며 화면에 **"게시 시간 미확인 · 수집 N분 전"** 으로 표시해 수집 시각과 혼동하지 않게 합니다. 게시 시각이 현재보다 10분 넘게 미래이면 잘못된 값으로 보고 NULL 처리합니다.
- 오래된 항목(뉴스 3일, 공식 7일 초과)은 저장하지 않습니다.

## 13. Source Health · 실패 처리

- 출처마다 독립 실행: 예외/timeout(8초)/형식 오류/깨진 피드가 다른 출처와 Worker 전체에 영향을 주지 않습니다.
- `source_health`: 마지막 시도, 마지막 성공, 마지막 오류, 연속 실패 횟수.
- 상태: **정상**(연속 실패 3회 미만이고 최근 성공이 주기의 3배 이내) / **지연**(연속 실패 3회 이상 또는 성공이 오래됨) / **수집 전**(한 번도 시도 안 함). 화면에 "Binance 공지 정상 · 2분 전", "CoinDesk 지연 · 17분 전" 형태로 표시합니다.

## 14. Worker API (GET 전용)

| 주소 | 내용 |
|---|---|
| `/api/intelligence/events` | 이벤트(클러스터) 최신순 + 시장 스냅샷 |
| `/api/intelligence/latest` | 수집 항목 원본 최신순 |
| `/api/intelligence/status` | 출처별 상태, retention |

쿼리: `limit`(1~50, 기본 20) · `symbol`(대문자/숫자 2~10자) · `source`(`all`/`official`/`news`) · `min_importance`(0~100, `events` 에만 적용. `latest` 에서는 값 검증만 하고 필터에는 쓰지 않음). 잘못된 값은 조용히 무시하지 않고 **400**. 조회 상한 50. CORS `*`(공개 읽기 전용 데이터), `cache-control: public, max-age=20`.

## 15. 보안

- 외부 텍스트는 저장 전 태그/스크립트/스타일/CDATA 제거 + 엔티티 디코딩 후 재제거, 화면에서는 전부 `esc()` 로 이스케이프. 외부 HTML 을 그대로 렌더링하지 않습니다.
- URL: http/https 만 허용 (`javascript:`, `data:`, `vbscript:`, 사용자정보 포함 URL 거부). Worker 저장 단계, API 출력 단계, 화면 단계에서 각각 검증. 링크는 `target="_blank" rel="noopener noreferrer"`.
- SQL: 모든 값 `bind`. `symbol` 필터는 정규식으로 검증한 뒤 bind (주입 시도 테스트 포함).
- 응답 크기(1.5MB) · 피드 읽기 크기(앞 600KB) · 항목 수(피드당 25) 제한. Secret 없음.

## 16. 향후 출처 추가 (Telegram / X / 커뮤니티 / AI)

1. **어댑터 추가**: `worker/src/intel/sources.js` 의 `SOURCES` 에 `{ id, label, type: 'social'|'community', intervalMs, maxAgeMs, fetchItems(fetchImpl, now) }` 를 추가합니다. `fetchItems` 는 `[{ title, url, publishedAt, summary }]` 만 돌려주면 되고, 저장·중복 제거·심볼·클러스터·상태 표시는 그대로 재사용됩니다. 화면 표시명은 `assets/intel-core.js` 의 `SOURCE_NAME` 에 추가.
2. **Telegram 공개 채널** (WeCryptoTogether, emperorcoin, enjoymyhobby, blockmedia): 공개 미리보기(`t.me/s/<채널>`) 는 HTML 이라 이용 조건 확인이 먼저 필요합니다. Bot API 는 채널 관리자 권한이 필요해 남의 채널에는 쓸 수 없습니다. → 공식 API/RSS 브리지의 이용 조건을 확인한 뒤 어댑터 작성.
3. **X**: 무료 접근이 거의 없어 유료 API 또는 대체 경로 결정이 먼저입니다.
4. **커뮤니티(Coinpan 등)**: RSS 가 있으면 `feedSource` 로 바로 추가 가능. 없으면 이용 약관/robots 확인 후 결정.
5. 소셜/커뮤니티는 Tier 3/4 라 기본 중요도가 낮고, **다른 출처 없이 이 출처에서만 발견되면 "미확인"** 으로 표시됩니다 (검증 로직은 이미 구현).
6. **AI 브리핑**: 이후 Phase 에서 `event_clusters` / `event_market_snapshots` 의 검증된 값만 입력으로 사용합니다. 이번 Phase 는 LLM 을 호출하지 않습니다.

## 17. 운영에서 확인할 것

1. `https://coin-radar-engine.j01044459979.workers.dev/api/intelligence/status` — 각 출처 `status` 가 `ok` 인지 (배포 후 2~5분 기다린 뒤).
2. 특정 출처가 `delayed` 이고 `last_error` 가 `HTTP 451/403` 이면 그 출처가 Worker 위치에서 차단된 것입니다 (Binance 공지 가능성 있음). 다른 출처에는 영향이 없습니다.
3. `/api/intelligence/events?limit=5` 에 항목이 있는지.
4. 사이트 상단 **📰 뉴스** 탭.
