#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"${ROOT_DIR}/scripts/test-all.sh"

echo "[jafiction] Building web package for deterministic validation..."
(
  cd "${ROOT_DIR}/packages/web"
  "${ROOT_DIR}/scripts/with-node.sh" "${ROOT_DIR}/node_modules/typescript/lib/tsc.js" -p tsconfig.json
  "${ROOT_DIR}/scripts/with-node.sh" "${ROOT_DIR}/node_modules/vite/bin/vite.js" build
)

"${ROOT_DIR}/scripts/docs-check.sh"

echo "[jafiction] Deterministic checks passed."
