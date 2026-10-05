#!/usr/bin/env bash
# 리치 베팅 장부 → Apps Script 자동 배포 (clasp 사용). Code.gs/Index.html 복붙 없이 push + 버전 생성 + 기존 배포 갱신.
#
#   bash betting-ledger/deploy/deploy.sh              # 테스트 → 원격 확인/백업 → push → 새 버전 → 기존 배포 갱신
#   bash betting-ledger/deploy/deploy.sh --dry-run    # 빌드와 원격 확인/백업까지만 (push/배포 안 함)
#   bash betting-ledger/deploy/deploy.sh --skip-tests
#   bash betting-ledger/deploy/deploy.sh --seed-inbox=<json>  # 배포 후 1회 [{payload,purchase}] 를 RICH_INBOX 에 넣고 처리(파일은 저장소 밖에 둘 것)
#   bash betting-ledger/deploy/deploy.sh --selftest     # 배포 후 1회 실환경 WDL_MULTI 자가테스트(테스트 데이터 자동 삭제)
#
# 필요한 것(저장소에 커밋하지 않음):
#   - deploy/config.local.json  { "scriptId": "...", "deploymentId": "...", "sheetId": "..." }  (config.example.json 참고)
#   - clasp 로그인: ~/.clasprc.json  또는 환경변수 CLASPRC_JSON(내용 전체. 환경 Secret 로 보관)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
CFG="${BETTING_DEPLOY_CONFIG:-$HERE/config.local.json}"
CLASP_PKG="@google/clasp@3.4.1"
DRY=0; TESTS=1
for a in "$@"; do case "$a" in --dry-run) DRY=1;; --skip-tests) TESTS=0;; --selftest) SELFTEST=1;; --seed-inbox=*) SEED="${a#--seed-inbox=}";; *) echo "알 수 없는 옵션: $a" >&2; exit 2;; esac; done

die() { echo "✖ $*" >&2; exit 1; }
[ -f "$CFG" ] || die "설정 파일이 없습니다: $CFG (config.example.json 을 복사해 채우세요)"
cfg() { node -e "const c=require(process.argv[1]); const v=c[process.argv[2]]; if(!v){process.exit(3)}; console.log(v)" "$CFG" "$1" || die "config 에 $1 가 없습니다"; }
SCRIPT_ID="$(cfg scriptId)"; DEPLOYMENT_ID="$(cfg deploymentId)"; SHEET_ID="$(cfg sheetId)"
REV="$(git -C "$ROOT" rev-parse --short HEAD)"
[ -z "$(git -C "$ROOT" status --porcelain -- . ':!deploy' 2>/dev/null)" ] || echo "⚠ 커밋되지 않은 변경이 있습니다(배포 REV=$REV 와 다를 수 있음)"

# clasp 인증: CLASPRC_JSON 환경변수가 있으면 임시 파일로 사용(디스크에 남기지 않음)
AUTH_ARGS=()
if [ -n "${CLASPRC_JSON:-}" ]; then
  AUTH_FILE="$(mktemp)"; chmod 600 "$AUTH_FILE"; trap 'rm -f "$AUTH_FILE"' EXIT
  printf '%s' "$CLASPRC_JSON" > "$AUTH_FILE"; AUTH_ARGS=(-A "$AUTH_FILE")
fi
clasp() { (cd "$WORK" && npx --yes "$CLASP_PKG" "${AUTH_ARGS[@]}" "$@"); }

if [ "$TESTS" = 1 ]; then
  echo "▶ 서버 테스트"
  RES="$(cd "$ROOT/.." && node betting-ledger/test/ledger.test.js | tail -1)"; echo "  $RES"
  echo "$RES" | grep -Eq '^([0-9]+)/\1 passed$' || die "테스트 실패 — 배포 중단"
fi

# 1) 빌드: 배포 대상 3개 파일 + Rev.gs(배포 후 1회 자동 점검용 리비전)
WORK="$HERE/dist"; rm -rf "$WORK"; mkdir -p "$WORK"
cp "$ROOT/Code.gs" "$ROOT/Index.html" "$ROOT/appsscript.json" "$WORK/"
printf "// 자동 생성(배포 스크립트). 저장소에는 없음.\nvar CODE_REV = '%s';\n" "$REV" > "$WORK/Rev.gs"
[ -n "${SEED:-}" ] && { [ -f "$SEED" ] || { echo "seed 파일 없음: $SEED" >&2; exit 2; }; printf "var CODE_SEED_INBOX = %s;\n" "$(python3 -c 'import json,sys;print(json.dumps(json.load(open(sys.argv[1])),ensure_ascii=False))' "$SEED")" >> "$WORK/Rev.gs"; }
[ "${SELFTEST:-0}" = 1 ] && printf "var CODE_SELFTEST = true;\n" >> "$WORK/Rev.gs"
printf '{"scriptId":"%s","rootDir":"."}\n' "$SCRIPT_ID" > "$WORK/.clasp.json"
echo "▶ 빌드 완료: $(ls "$WORK" | tr '\n' ' ') (REV=$REV)"

# 2) 대상 프로젝트 검증 + 백업 (다른 프로젝트를 덮어쓰지 않도록)
echo "▶ 원격 프로젝트 확인"
BK="$HERE/backup/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$BK"
PULL="$HERE/.pull"; rm -rf "$PULL"; mkdir -p "$PULL"; printf '{"scriptId":"%s","rootDir":"."}\n' "$SCRIPT_ID" > "$PULL/.clasp.json"
(cd "$PULL" && npx --yes "$CLASP_PKG" "${AUTH_ARGS[@]}" pull >/dev/null) || die "원격 프로젝트를 읽을 수 없습니다(scriptId/권한/Apps Script API 사용 설정 확인)"
cp -R "$PULL"/. "$BK"/; rm -rf "$PULL"
grep -q "$SHEET_ID" "$BK"/*.gs "$BK"/*.js 2>/dev/null || die "원격 코드에 스프레드시트 ID($SHEET_ID)가 없습니다 — 다른 프로젝트일 수 있어 중단"
clasp deployments | grep -q "$DEPLOYMENT_ID" || die "원격에 배포 ID($DEPLOYMENT_ID)가 없습니다 — 중단"
echo "  ✓ 대상 확인(스프레드시트 ID·배포 ID 일치). 백업: $BK"
[ "$DRY" = 1 ] && { echo "✔ dry-run 종료 (push/배포 없음)"; exit 0; }

# 3) push → 새 버전 → 기존 배포 갱신(/exec URL 유지)
echo "▶ push"; clasp push --force
echo "▶ 버전 생성"; OUT="$(clasp version "rev $REV $(date +%F\ %T)")"; echo "$OUT"
VER="$(echo "$OUT" | grep -Eo '[0-9]+' | tail -1)"; [ -n "$VER" ] || die "버전 번호를 읽지 못했습니다"
echo "▶ 기존 배포 갱신 (deploymentId 유지)"; clasp deploy --deploymentId "$DEPLOYMENT_ID" --versionNumber "$VER" --description "rev $REV"
clasp deployments
echo "✔ 완료: rev=$REV version=$VER. 약 1분 안에 시간 트리거가 배포 후 점검을 1회 실행하고 RICH_INBOX 에 점검 결과 1줄을 남깁니다."
