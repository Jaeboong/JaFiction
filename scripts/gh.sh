#!/usr/bin/env bash
# gh.sh — GitHub CLI 래퍼 (bash/WSL에서 gh.exe 경로 자동 탐색)
#
# bash PATH에는 Windows 프로그램 경로가 없으므로 gh를 직접 찾아 실행.
# 사용법: ./scripts/gh.sh run list --limit 5

GH_PATHS=(
  "/c/Program Files/GitHub CLI/gh.exe"
  "/c/Users/$USER/AppData/Local/Programs/GitHub CLI/gh.exe"
)

GH_BIN=""
for p in "${GH_PATHS[@]}"; do
  if [ -f "$p" ]; then
    GH_BIN="$p"
    break
  fi
done

if [ -z "$GH_BIN" ]; then
  echo "gh CLI를 찾을 수 없습니다. https://cli.github.com/ 에서 설치하세요." >&2
  exit 1
fi

exec "$GH_BIN" "$@"
