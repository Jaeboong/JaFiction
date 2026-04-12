#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER_DIR="$REPO_ROOT/packages/runner"

echo "[build-runner-binaries] Building runner binaries..."
cd "$RUNNER_DIR"
bun run build.ts
echo "[build-runner-binaries] Done. Binaries in packages/runner/dist-bin/"
