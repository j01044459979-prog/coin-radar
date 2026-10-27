# RICH300 추천 피드 (radar 쪽 최소 변경)

COIN RADAR 가 Telegram 으로 *전달을 확인한* 진입 후보를 RICH300 이 가져갈 수 있도록 서명된 피드로 내보낸다. 기본 꺼짐(`RADAR_RICH300_FEED`), 켜지 않으면 radar 동작은 기존과 같다. 주문·계정 API 없음.

- `radar-service/signal/feed.mjs` · `step.mjs` 훅: 전달이 확인된 후보(두 번 시도해도 불확실해 '전달된 것으로 간주'한 경우 제외)만 `state.signal.feed` 에 기록.
- `radar.yml`: 변수 1줄 + 단계 2개(`feed-artifact.mjs`, `upload-artifact`). 플래그 on · MODE=once · main · 정기/수동 실행일 때만 *이 실행의* artifact(`rich300-feed-raw`, 서명 전) 생성. Secret·쓰기 권한 없음.
- `.github/workflows/rich300-feed.yml`(`workflow_run`, main 의 성공한 radar 실행만): 그 실행의 artifact 만 받아 실행 id·브랜치·이벤트·신선도를 확인하고 `RICH300_FEED_KEY` 로 HMAC 서명해 `rich300-feed` 브랜치 `feed.json` 에 게시. 키와 `contents: write` 는 이 파일에만 있다.
- `rich300/lib/{auth,dedupe,feed}.mjs` · `rich300/client/feed-publish.mjs`: 서명 봉투(요청 인증과 동일)·검증기·서명 스크립트(순수 함수, 의존성 없음).
- 켜는 법(별도 승인): 저장소 변수 `RADAR_RICH300_FEED=on` + Secret `RICH300_FEED_KEY`(32자 이상). 확인: radar 를 `workflow_dispatch` 로 한 번 실행 → `rich300-feed` 워크플로 성공 → `rich300-feed` 브랜치의 `feed.json`.
- RICH300(Apps Script) 쪽 수신·전략 생성은 별도 PR(#47 계열)이며 이 변경 없이도 radar 는 영향이 없다.
