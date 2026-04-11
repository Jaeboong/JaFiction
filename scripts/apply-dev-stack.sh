#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"${ROOT_DIR}/scripts/check.sh"
"${ROOT_DIR}/scripts/stop-dev-stack.sh"
"${ROOT_DIR}/scripts/start-dev-web.sh"
"${ROOT_DIR}/scripts/status-dev-stack.sh"

echo "[jasojeon] Development stack applied (web only)."
echo "[jasojeon] Note: hosted runner + backend must be started separately via scripts/dev-stack.sh."
