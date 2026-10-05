# 자동 배포 (복붙 없이)

`bash betting-ledger/deploy/deploy.sh` 한 줄이면 테스트 → 대상 프로젝트 검증/백업 → push → 새 버전 → 기존 배포 갱신(/exec URL 유지)까지 끝납니다.

- 자격증명/설정은 **저장소에 커밋하지 않습니다** (`config.local.json`, `~/.clasprc.json`, 환경변수 `CLASPRC_JSON`).
- 배포 직후 1분 안에 시간 트리거가 `postDeployCheck_()` 를 1회 실행합니다: WDL_LOG 묶음 열 추가(비파괴) + `diagnoseSetup()` 결과를 RICH_INBOX 에 감사 행(`system-deploy-<rev>`)으로 기록.
- 최초 1회만 Google 로그인 승인이 필요합니다: `npx @google/clasp login --no-localhost` → 인증 URL 승인 → 주소창의 `http://localhost:8888/?code=...` 전체를 붙여넣기.
- 새 세션에서도 자동으로 쓰려면 `~/.clasprc.json` 내용을 Claude Code 환경 Secret `CLASPRC_JSON` 으로 저장해 두세요(저장소/채팅에 붙이지 말 것).
