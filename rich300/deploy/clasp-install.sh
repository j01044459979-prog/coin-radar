#!/usr/bin/env bash
# RICH 300 설치(clasp): 기존 RICH300 Apps Script 프로젝트의 내용을 설치 파일 3개로 교체한다. 사용자는 Google 로그인·승인과 확인 입력만 한다(코드 복사 없음).
#  사용(Google Cloud Shell 권장, https://shell.cloud.google.com). 파일로 받아 실행해야 로그인 프롬프트가 키보드 입력을 받는다('| bash' 로 실행하면 clasp 가 스크립트 자신을 입력으로 읽어 로그인이 실패한다):
#    ID=<편집기 주소의 프로젝트 ID>; C=<커밋 40자>; curl -fsSLo /tmp/r300.sh https://raw.githubusercontent.com/j01044459979-prog/coin-radar/$C/rich300/deploy/clasp-install.sh && bash /tmp/r300.sh "$ID" "$C"
#  인자 2개는 모두 필수(기본값 없음): ① 스크립트(프로젝트) ID — 편집기 주소 https://script.google.com/home/projects/<ID>/edit 의 <ID>  ② 설치 파일이 있는 커밋(40자). 스크립트도 설치 파일도 이 커밋 그대로만 쓴다.
#  순서: 인자·커밋 검증 → 설치 파일 SHA-256·문법·매니페스트 확인 → clasp 로그인 → 현재 내용 *백업*(~/rich300-backup-…, 남겨 둠) → 대상·변경 파일 표시 + 프로젝트 확인 → push → 다시 내려받아 일치 확인 → 실패하면 *백업으로 복구* → 로그아웃(토큰 삭제)
#  하지 않는 일: 새 프로젝트 생성, 프로젝트 삭제, 웹 앱 배포, Telegram 호출, 스크립트 속성 변경. 비밀값을 다루지 않는다.
#  로그인: Cloud Shell(원격)에서는 clasp 의 '--no-localhost' 방식 — 주소를 열어 승인하면 열리지 않는 페이지(localhost)로 이동하고, 그 주소창의 URL 전체(code= 포함)를 이 터미널에 붙여 넣는다(채팅에 공유하지 말 것). 내 PC(브라우저와 같은 기기)에서 실행하면 붙여 넣기 없이 자동 완료된다.
#  권한: 기본 clasp 로그인은 cloud-platform 등 넓은 범위를 요청하므로, 이 스크립트는 임시 폴더의 매니페스트로 script.projects·userinfo.email 두 범위만 요청한다(--use-project-scopes). 부족하면 RICH300_SCOPES=default 로 기본 범위 사용.
#  시험·자동화용 환경 변수: RICH300_CONFIRM(확인 값 = ID 마지막 6글자), RICH300_TTY(키보드 입력 장치 대체, 기본 /dev/tty), RICH300_LOGIN(paste|local), RICH300_SCOPES(default), RICH300_SRC_DIR(로컬 저장소 사본, 시험 전용), RICH300_REPO, RICH300_CLASP(clasp 명령 대체).
set -euo pipefail
SCRIPT_ID="${1:-}"; COMMIT="${2:-}"
REPO="${RICH300_REPO:-https://github.com/j01044459979-prog/coin-radar.git}"
CLASP="${RICH300_CLASP:-npx -y @google/clasp@3.3.0}"
WORK="$(mktemp -d)"; BACKUP=""; WE_LOGGED_IN=0; TTY_DEV="${RICH300_TTY:-/dev/tty}"; TTY_OPEN=0
cleanup() { [[ "$WE_LOGGED_IN" == 1 ]] && { $CLASP logout </dev/null >/dev/null 2>&1 || true; }; rm -rf "$WORK"; }
trap cleanup EXIT
say() { printf '%s\n' "$*"; }
fail() { say "[FAIL] $*"; [[ -n "$BACKUP" ]] && say "백업 폴더: $BACKUP"; exit 1; }
[[ -n "$SCRIPT_ID" && -n "$COMMIT" ]] || fail "사용법: bash -s -- <프로젝트ID> <커밋40자> (두 값 모두 필수, 기본값 없음). 프로젝트 ID 는 편집기 주소 https://script.google.com/home/projects/<ID>/edit 의 <ID> 입니다"
[[ "$SCRIPT_ID" =~ ^[A-Za-z0-9_-]{20,80}$ ]] || fail "프로젝트 ID 형식이 올바르지 않습니다"
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail "커밋은 40자리 16진수 전체여야 합니다"
command -v node >/dev/null || fail "node 가 필요합니다(Cloud Shell 에는 기본 설치)"
write_clasp() { printf '{"scriptId":"%s","rootDir":".","fileExtension":"gs"}\n' "$SCRIPT_ID" > "$1/.clasp.json"; }
# 디렉터리에서 이름(확장자 제외)으로 파일 찾기: Code → Code.gs 또는 Code.js
find_src() { local d="$1" n="$2"; for e in gs js; do [[ -f "$d/$n.$e" ]] && { printf '%s' "$d/$n.$e"; return 0; }; done; return 1; }
# 키보드(터미널) 입력: '| bash' 로 실행되면 stdin 은 스크립트 자신이므로, 사용자 입력은 항상 터미널(fd 3)에서만 읽고 clasp 로그인에도 fd 3 을 물려 준다.
open_tty() { [[ "$TTY_OPEN" == 1 ]] && return 0; { exec 3<"$TTY_DEV"; } 2>/dev/null || return 1; TTY_OPEN=1; }
# ① 설치 파일: 지정한 커밋 그대로
if [[ -n "${RICH300_SRC_DIR:-}" ]]; then SRC="$RICH300_SRC_DIR/rich300/apps-script"
else
  command -v git >/dev/null || fail "git 이 필요합니다"
  git init -q "$WORK/repo" && git -C "$WORK/repo" remote add origin "$REPO" && git -C "$WORK/repo" fetch -q --depth 1 origin "$COMMIT" && git -C "$WORK/repo" checkout -q FETCH_HEAD || fail "커밋 $COMMIT 을 받지 못했습니다"
  [[ "$(git -C "$WORK/repo" rev-parse HEAD)" == "$COMMIT" ]] || fail "받은 커밋이 지정한 커밋과 다릅니다"
  SRC="$WORK/repo/rich300/apps-script"
fi
for f in Code.gs Fill.html appsscript.json MANIFEST.txt; do [[ -s "$SRC/$f" ]] || fail "설치 파일이 없습니다: $f"; done
mkdir -p "$WORK/push"; for f in Code.gs Fill.html appsscript.json; do
  want="$(awk -v n="$f" '$3==n {print $1}' "$SRC/MANIFEST.txt")"; got="$(sha256sum "$SRC/$f" | cut -d' ' -f1)"
  [[ -n "$want" && "$want" == "$got" ]] || fail "$f 가 MANIFEST 와 다릅니다(잘렸거나 손상)"; cp "$SRC/$f" "$WORK/push/$f"; done
node -e "process.exit(require('fs').readFileSync('$WORK/push/Code.gs','utf8').endsWith('\n}\n')?0:1)" || fail "Code.gs 끝부분이 완결되지 않았습니다"
node -e "new (require('vm').Script)(require('fs').readFileSync('$WORK/push/Code.gs','utf8'))" 2>/dev/null || fail "Code.gs 문법 검사 실패"
node -e "const m=JSON.parse(require('fs').readFileSync('$WORK/push/appsscript.json','utf8'));const w=m.webapp||{};if(w.access!=='MYSELF'||w.executeAs!=='USER_ACCESSING'||m.runtimeVersion!=='V8')process.exit(1)" || fail "매니페스트가 '나만 접근·접속한 사용자로 실행·V8' 이 아닙니다"
say "[PASS] 설치 파일 3개(커밋 ${COMMIT:0:12}): SHA-256·문법·매니페스트 확인"
# ② 로그인(이미 되어 있으면 건너뜀)
if [[ -s "$HOME/.clasprc.json" ]]; then say "(이미 clasp 로그인 상태입니다 — 기존 로그인을 사용하며 끝나도 지우지 않습니다)"
else
  open_tty || fail "터미널 입력을 사용할 수 없습니다. 안내된 대로 파일로 받아 'bash /tmp/r300.sh \"\$ID\" \"\$C\"' 형태로 실행하세요('| bash' 는 로그인 입력을 받을 수 없습니다). 아무것도 바꾸지 않았습니다"
  MODE="${RICH300_LOGIN:-}"; [[ -n "$MODE" ]] || { [[ -n "${CLOUD_SHELL:-}" || -n "${SSH_CONNECTION:-}" ]] && MODE=paste || MODE=local; }
  LOGIN_ARGS=(); [[ "$MODE" == paste ]] && LOGIN_ARGS+=(--no-localhost)
  mkdir -p "$WORK/login"; write_clasp "$WORK/login"
  if [[ "${RICH300_SCOPES:-}" == default ]]; then say "(경고: clasp 기본 권한 범위 사용 — cloud-platform 등 넓은 범위가 포함됩니다)"
  else printf '{"timeZone":"Asia/Seoul","runtimeVersion":"V8","oauthScopes":["https://www.googleapis.com/auth/script.projects","https://www.googleapis.com/auth/userinfo.email"]}\n' > "$WORK/login/appsscript.json"; LOGIN_ARGS+=(--use-project-scopes); fi
  say ""; say "Google 로그인: 아래에 나오는 주소를 열어 승인하세요(요청 권한: Apps Script 프로젝트 관리 + 이메일 확인)."
  if [[ "$MODE" == paste ]]; then say "승인하면 '사이트에 연결할 수 없음' 같은 페이지가 뜨는 것이 정상입니다. 그 페이지의 주소창에서 http://localhost:8888/?code=… 로 시작하는 URL 전체를 복사해 아래 프롬프트에 붙여 넣으세요. 이 URL 에는 일회용 승인 코드가 들어 있으니 채팅·메신저에 공유하지 마세요."; fi
  ( cd "$WORK/login" && $CLASP login ${LOGIN_ARGS[@]+"${LOGIN_ARGS[@]}"} <&3 ) || fail "로그인하지 못했습니다(붙여 넣은 URL 에 code= 가 있어야 합니다. 같은 명령을 다시 실행하세요)"
  WE_LOGGED_IN=1
fi
# ③ 현재 내용 백업(남겨 둠) + 대상 확인
BACKUP="$HOME/rich300-backup-$(date +%Y%m%d-%H%M%S)-${SCRIPT_ID: -6}"; mkdir -p "$BACKUP"; write_clasp "$BACKUP"
( cd "$BACKUP" && $CLASP pull </dev/null ) || fail "현재 내용을 백업하지 못했습니다(프로젝트 ID·Google 계정 확인) — 아무것도 바꾸지 않았습니다"
RCODE="$(find_src "$BACKUP" Code || true)"
[[ -n "$RCODE" ]] || fail "대상 프로젝트에서 Code 파일을 찾지 못했습니다 — 프로젝트 ID 를 확인하세요. 아무것도 바꾸지 않았습니다"
if [[ "${RICH300_FORCE:-}" != 1 ]]; then
  grep -qE 'rich300Bootstrap|rich300Install' "$RCODE" && ! grep -qE 's0Compat|s0Tick|s0EngineBench|s0InstallTriggers' "$RCODE" || fail "이 프로젝트는 RICH300 부트스트랩/설치 상태가 아닙니다(다른 프로젝트일 수 있음). 아무것도 바꾸지 않았습니다"
fi
say ""; say "대상 프로젝트 ID: $SCRIPT_ID"; say "현재 원격 파일(백업됨: $BACKUP):"
( cd "$BACKUP" && for f in $(ls -A | grep -v '^\.clasp\.json$'); do printf '  - %s (%s바이트)\n' "$f" "$(wc -c < "$f")"; done )
say "변경 계획:"
for n in Code:Code.gs Fill:Fill.html appsscript:appsscript.json; do b="${n%%:*}"; f="${n##*:}"; if ls "$BACKUP/$b."* >/dev/null 2>&1; then say "  - 교체: $f"; else say "  - 추가: $f"; fi; done
( cd "$BACKUP" && for f in $(ls -A | grep -v '^\.clasp\.json$'); do case "${f%.*}" in Code|Fill|appsscript) ;; *) say "  - 삭제(이 프로젝트에서만): $f";; esac; done )
EXPECT="${SCRIPT_ID: -6}"
if [[ "${RICH300_CONFIRM:-}" == "$EXPECT" ]]; then say "(확인 값이 환경 변수로 전달됨)"
else
  ANS=""; open_tty || fail "확인을 입력받을 수 없습니다(터미널 없음). 아무것도 바꾸지 않았습니다"
  printf '%s' "이 프로젝트가 맞으면 ID 의 마지막 6글자 [$EXPECT] 를 입력하세요(그 밖의 입력은 중단): "; read -r ANS <&3 || fail "확인을 입력받을 수 없습니다. 아무것도 바꾸지 않았습니다"
  [[ "$ANS" == "$EXPECT" ]] || fail "확인 값이 다릅니다 — 중단했습니다. 아무것도 바꾸지 않았습니다"
fi
# ④ push → 확인 → 실패 시 복구
verify_equal() {  # $1=기준 디렉터리 $2=확인 디렉터리 (Code·Fill 내용 비교, 매니페스트는 접근 설정만)
  local a b n; for n in Code Fill; do a="$(find_src "$1" "$n" || ls "$1/$n".html 2>/dev/null || true)"; b="$(find_src "$2" "$n" || ls "$2/$n".html 2>/dev/null || true)"; [[ -n "$a" && -n "$b" ]] && cmp -s "$a" "$b" || return 1; done
  node -e "const m=JSON.parse(require('fs').readFileSync('$2/appsscript.json','utf8'));const o=JSON.parse(require('fs').readFileSync('$1/appsscript.json','utf8'));if(JSON.stringify((m.webapp||{}))!==JSON.stringify((o.webapp||{})))process.exit(1)"
}
restore() {
  say "[복구] 백업으로 되돌립니다: $BACKUP"
  if ( cd "$BACKUP" && $CLASP push -f </dev/null ) && { rm -rf "$WORK/check"; mkdir -p "$WORK/check"; write_clasp "$WORK/check"; ( cd "$WORK/check" && $CLASP pull </dev/null ); } && cmp -s "$(find_src "$BACKUP" Code)" "$(find_src "$WORK/check" Code)"; then say "[복구 완료] 프로젝트를 설치 전 상태로 되돌리고 확인했습니다."
  else say "[복구 실패] 자동 복구가 끝나지 않았습니다. 백업 폴더: $BACKUP — 그 폴더에서 'npx -y @google/clasp@3.3.0 push -f' 로 수동 복구하거나, 편집기의 버전 기록에서 되돌리세요."; fi
}
write_clasp "$WORK/push"
if ! ( cd "$WORK/push" && $CLASP push -f </dev/null ); then say "[FAIL] push 실패(Apps Script API 사용자 설정·같은 Google 계정인지 확인)"; restore; exit 1; fi
mkdir -p "$WORK/pull"; write_clasp "$WORK/pull"
if ! ( cd "$WORK/pull" && $CLASP pull </dev/null ) || ! verify_equal "$WORK/push" "$WORK/pull"; then say "[FAIL] 반영 결과가 설치 파일과 다릅니다"; restore; exit 1; fi
say "[PASS] 반영 완료: Code.gs·Fill.html 내용 일치, 매니페스트(나만·접속한 사용자) 확인. 이전 내용 백업: $BACKUP"
say "다음: Apps Script 편집기를 새로 고침 → 함수 rich300Install 실행. (로그인 토큰은 이 셸에서 삭제합니다. 원하면 https://myaccount.google.com/permissions 에서 clasp 권한도 철회하세요.)"
