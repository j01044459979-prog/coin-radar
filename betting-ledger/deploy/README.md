# 자동 배포 (복붙 없이)

`bash betting-ledger/deploy/deploy.sh` 한 줄이면 테스트 → 대상 프로젝트 검증/백업 → push → 새 버전 → 기존 배포 갱신(/exec URL 유지)까지 끝납니다.

- 자격증명/설정은 **저장소에 커밋하지 않습니다** (`config.local.json`, `~/.clasprc.json`, 환경변수 `CLASPRC_JSON`).
- 배포 직후 1분 안에 시간 트리거가 `postDeployCheck_()` 를 1회 실행합니다: WDL_LOG 묶음 열 추가(비파괴) + `diagnoseSetup()` 결과를 RICH_INBOX 에 감사 행(`system-deploy-<rev>`)으로 기록.
- 최초 1회만 Google 로그인 승인이 필요합니다: `npx @google/clasp login --no-localhost` → 인증 URL 승인 → 주소창의 `http://localhost:8888/?code=...` 전체를 붙여넣기.
- 새 세션에서도 자동으로 쓰려면 `~/.clasprc.json` 내용을 Claude Code 환경 Secret `CLASPRC_JSON` 으로 저장해 두세요(저장소/채팅에 붙이지 말 것).

## 처음 설정할 때 (이미 한 번 수행됨)
- 시트에 붙은 스크립트는 `clasp list`/Drive 검색에 나오지 않습니다. Script ID 는 편집기 주소 `script.google.com/home/projects/<Script ID>/edit` 에서 복사해 `deploy/config.local.json`(gitignore) 에 넣습니다.
- `deploymentId` 는 기존 웹앱 URL `/macros/s/<deploymentId>/exec` 의 값입니다. `deploy.sh` 는 기존 배포를 새 버전으로 갱신하므로 URL 이 바뀌지 않습니다.
- 접근 권한(본인 전용)은 `appsscript.json` 의 `webapp` 설정이 그대로 유지됩니다.
- 새 세션에서 로그인 승인을 반복하지 않으려면 로컬 PC 에서 `npx @google/clasp login` 후 생기는 `~/.clasprc.json` 내용을 Claude Code 환경 변수 `CLASPRC_JSON` 으로 환경 설정에 저장하세요(채팅에 붙이지 마세요).
