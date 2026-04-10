#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[jafiction] Building shared package..."
"${ROOT_DIR}/scripts/with-node.sh" "${ROOT_DIR}/node_modules/typescript/lib/tsc.js" -p "${ROOT_DIR}/packages/shared/tsconfig.json"

echo "[jafiction] Building runner package..."
"${ROOT_DIR}/scripts/with-node.sh" "${ROOT_DIR}/node_modules/typescript/lib/tsc.js" -p "${ROOT_DIR}/packages/runner/tsconfig.json"

echo "[jafiction] Building web package..."
(
  cd "${ROOT_DIR}/packages/web"
  "${ROOT_DIR}/scripts/with-node.sh" "${ROOT_DIR}/node_modules/typescript/lib/tsc.js" -p tsconfig.json
  "${ROOT_DIR}/scripts/with-node.sh" "${ROOT_DIR}/node_modules/vite/bin/vite.js" build
)
