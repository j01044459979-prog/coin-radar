#!/usr/bin/env bash
# RICH 300 설치(clasp): 기존 RICH300 Apps Script 프로젝트의 내용을 설치 파일 3개로 교체한다. 사용자는 Google 로그인·권한 승인만 한다(코드 복사 없음).
#  사용(Google Cloud Shell 권장 — 설치 없이 브라우저에서 열림, https://shell.cloud.google.com):
#    curl -fsSL https://raw.githubusercontent.com/j01044459979-prog/coin-radar/<커밋>/rich300/deploy/clasp-install.sh | bash -s -- [스크립트ID]
#  하는 일: ① 저장소의 설치 파일 3개를 받아 SHA-256 을 MANIFEST 와 대조 ② clasp 로그인(--no-localhost) ③ 이 프로젝트에만 push ④ 다시 내려받아 내용 일치 확인 ⑤ 로그아웃(토큰 삭제)
#  하지 않는 일: 새 프로젝트 생성, 삭제, 웹 앱 배포, Telegram 호출, 스크립트 속성 변경. 비밀값을 다루지 않는다.
#  시험용 환경 변수: RICH300_SRC_DIR(로컬 저장소 경로, 네트워크 대신 사용), RICH300_CLASP(clasp 실행 명령 대체).
set -euo pipefail
SCRIPT_ID="${1:-14pE8sbp7aNTdn78VoXe1FsuXPWzidcBaylMxwCLZyMROyrGuWgxrWvn6}"
REPO="${RICH300_REPO:-https://github.com/j01044459979-prog/coin-radar.git}"; REF="${RICH300_REF:-release/rich300-prod}"
CLASP="${RICH300_CLASP:-npx -y @google/clasp@3.3.0}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
say() { printf '%s\n' "$*"; }; fail() { say "[FAIL] $*"; say "프로젝트는 바뀌지 않았거나 일부만 바뀌었을 수 있습니다(이 프로젝트 외에는 아무것도 건드리지 않았습니다)."; exit 1; }
[[ "$SCRIPT_ID" =~ ^[A-Za-z0-9_-]{20,80}$ ]] || fail "스크립트 ID 형식이 올바르지 않습니다"
command -v node >/dev/null || fail "node 가 필요합니다(Cloud Shell 에는 기본 설치)"
# ① 설치 파일 받기·검증
if [[ -n "${RICH300_SRC_DIR:-}" ]]; then SRC="$RICH300_SRC_DIR/rich300/apps-script"
else command -v git >/dev/null || fail "git 이 필요합니다"; git clone -q --depth 1 -b "$REF" "$REPO" "$WORK/repo" || fail "저장소를 받지 못했습니다"; SRC="$WORK/repo/rich300/apps-script"; fi
for f in Code.gs Fill.html appsscript.json MANIFEST.txt; do [[ -s "$SRC/$f" ]] || fail "설치 파일이 없습니다: $f"; done
mkdir -p "$WORK/push"; for f in Code.gs Fill.html appsscript.json; do
  want="$(awk -v n="$f" '$3==n {print $1}' "$SRC/MANIFEST.txt")"; got="$(sha256sum "$SRC/$f" | cut -d' ' -f1)"
  [[ -n "$want" && "$want" == "$got" ]] || fail "$f 가 MANIFEST 와 다릅니다(잘렸거나 손상)"; cp "$SRC/$f" "$WORK/push/$f"; done
node -e "process.exit(require('fs').readFileSync('$WORK/push/Code.gs','utf8').endsWith('\n}\n')?0:1)" || fail "Code.gs 끝부분이 완결되지 않았습니다"
node -e "new (require('vm').Script)(require('fs').readFileSync('$WORK/push/Code.gs','utf8'))" 2>/dev/null || fail "Code.gs 문법 검사 실패"
node -e "const m=JSON.parse(require('fs').readFileSync('$WORK/push/appsscript.json','utf8'));const w=m.webapp||{};if(w.access!=='MYSELF'||w.executeAs!=='USER_ACCESSING'||m.runtimeVersion!=='V8')process.exit(1)" || fail "매니페스트가 '나만 접근·접속한 사용자로 실행·V8' 이 아닙니다"
say "[PASS] 설치 파일 3개: SHA-256·문법·매니페스트 확인"
# ② 로그인(이미 되어 있으면 건너뜀). 끝나면 항상 로그아웃해 토큰을 남기지 않는다.
trap '$CLASP logout >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
if [[ ! -s "$HOME/.clasprc.json" ]]; then say "Google 로그인 창의 안내를 따라 승인하세요(--no-localhost: 마지막에 나오는 주소창의 URL 전체를 복사해 여기에 붙여 넣기)."; $CLASP login --no-localhost || fail "로그인하지 못했습니다"; fi
# ③ 이 프로젝트에만 push (원격에 있고 로컬에 없는 파일은 이 프로젝트에서만 사라진다)
printf '{"scriptId":"%s","rootDir":"."}\n' "$SCRIPT_ID" > "$WORK/push/.clasp.json"
( cd "$WORK/push" && $CLASP push -f ) || fail "push 실패(Apps Script API 사용자 설정이 켜져 있는지, 같은 Google 계정인지 확인)"
# ④ 다시 내려받아 확인
mkdir -p "$WORK/pull"; printf '{"scriptId":"%s","rootDir":"."}\n' "$SCRIPT_ID" > "$WORK/pull/.clasp.json"
( cd "$WORK/pull" && $CLASP pull ) || fail "확인용 pull 실패"
for f in Code.gs Fill.html; do cmp -s "$WORK/push/$f" "$WORK/pull/$f" || fail "반영된 $f 가 설치 파일과 다릅니다"; done
node -e "const m=JSON.parse(require('fs').readFileSync('$WORK/pull/appsscript.json','utf8'));const w=m.webapp||{};if(w.access!=='MYSELF'||w.executeAs!=='USER_ACCESSING')process.exit(1)" || fail "반영된 매니페스트가 기대와 다릅니다"
say "[PASS] 반영 완료: Code.gs·Fill.html 내용 일치, 매니페스트(나만·접속한 사용자) 확인"
say "다음: Apps Script 편집기를 새로 고침 → 함수 rich300Install 실행. (로그인 토큰은 이 셸에서 삭제했습니다. 원하면 https://myaccount.google.com/permissions 에서 clasp 권한도 철회하세요.)"
