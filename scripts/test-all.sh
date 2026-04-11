#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[jafiction] Running shared tests..."
(
  cd "${ROOT_DIR}/packages/shared"
  "${ROOT_DIR}/scripts/with-node.sh" "${ROOT_DIR}/node_modules/typescript/lib/tsc.js" -p tsconfig.json
  "${ROOT_DIR}/scripts/with-node.sh" --test --test-force-exit dist/test/*.test.js
)

echo "[jafiction] Running runner tests..."
(
  cd "${ROOT_DIR}/packages/runner"
  "${ROOT_DIR}/scripts/with-node.sh" "${ROOT_DIR}/node_modules/typescript/lib/tsc.js" -p tsconfig.json
  "${ROOT_DIR}/scripts/with-node.sh" --test --test-force-exit dist/test/*.test.js
)

echo "[jafiction] Running web tests..."
(
  cd "${ROOT_DIR}/packages/web"
  "${ROOT_DIR}/scripts/with-node.sh" "${ROOT_DIR}/node_modules/.bin/vitest" run
)

echo "[jafiction] Running backend tests..."
(
  cd "${ROOT_DIR}/packages/backend"
  "${ROOT_DIR}/scripts/with-node.sh" "${ROOT_DIR}/node_modules/typescript/lib/tsc.js" -p tsconfig.json
  "${ROOT_DIR}/scripts/with-node.sh" --test --test-force-exit dist/test/*.test.js
)
