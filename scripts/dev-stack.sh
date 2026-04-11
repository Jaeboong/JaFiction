#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/harness-common.sh"

skip_check=0
no_infra=0
no_backend=0
no_runner=0
no_web=0

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-check)  skip_check=1 ;;
    --no-infra)    no_infra=1; no_backend=1 ;;
    --no-backend)  no_backend=1 ;;
    --no-runner)   no_runner=1 ;;
    --no-web)      no_web=1 ;;
    *)
      echo "[jasojeon] Unknown argument: $1" >&2
      exit 1
      ;;
  esac
  shift
done

ensure_harness_dirs

if [ "${skip_check}" -eq 0 ]; then
  "${ROOT_DIR}/scripts/check.sh"
fi

"${ROOT_DIR}/scripts/stop-dev-stack.sh"

if [ "${no_backend}" -eq 0 ]; then
  "${ROOT_DIR}/scripts/start-dev-backend.sh"
fi

if [ "${no_runner}" -eq 0 ]; then
  "${ROOT_DIR}/scripts/start-dev-runner.sh"
fi

if [ "${no_web}" -eq 0 ]; then
  "${ROOT_DIR}/scripts/start-dev-web.sh"
fi

"${ROOT_DIR}/scripts/status-dev-stack.sh"

echo "[jasojeon] Dev stack ready."
