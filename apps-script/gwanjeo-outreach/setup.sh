#!/usr/bin/env bash
# 새 세션에서 clasp 사용 준비: 설치 + 로그인 정보 복원 (push는 하지 않음)
set -euo pipefail

if ! command -v clasp >/dev/null 2>&1; then
  npm install -g @google/clasp
fi

if [ -z "${CLASPRC_JSON:-}" ]; then
  echo "CLASPRC_JSON 환경 변수가 없습니다. 환경 설정에 등록 후 새 세션에서 다시 실행하세요." >&2
  exit 1
fi

umask 077
printf '%s' "$CLASPRC_JSON" > "$HOME/.clasprc.json"
echo "clasp 로그인 정보 복원 완료 ($(clasp --version))"
