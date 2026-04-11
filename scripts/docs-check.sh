#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[jasojeon] Building harness tools..."
"${ROOT_DIR}/scripts/with-node.sh" "${ROOT_DIR}/node_modules/typescript/lib/tsc.js" -p "${ROOT_DIR}/tsconfig.tools.json"

echo "[jasojeon] Validating documentation links..."
"${ROOT_DIR}/scripts/with-node.sh" "${ROOT_DIR}/dist-tools/validate-doc-links.js"
