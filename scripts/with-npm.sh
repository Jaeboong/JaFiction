#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
declare -a candidates=()

if [ -n "${JAFICTION_NPM_CLI_JS:-}" ]; then
  candidates+=("${JAFICTION_NPM_CLI_JS}")
fi

if command -v npm >/dev/null 2>&1; then
  npm_bin="$(command -v npm)"
  npm_root="$(cd "$(dirname "${npm_bin}")/.." && pwd)"
  candidates+=("${npm_root}/lib/node_modules/npm/bin/npm-cli.js")
fi

if [ -d "${HOME}/.nvm/versions/node" ]; then
  while IFS= read -r candidate; do
    candidates+=("${candidate}")
  done < <(find "${HOME}/.nvm/versions/node" -type f -path "*/lib/node_modules/npm/bin/npm-cli.js" | sort -r)
fi

for candidate in \
  "/usr/lib/node_modules/npm/bin/npm-cli.js" \
  "/usr/local/lib/node_modules/npm/bin/npm-cli.js"
do
  if [ -f "${candidate}" ]; then
    candidates+=("${candidate}")
  fi
done

for candidate in "${candidates[@]}"; do
  if [ -f "${candidate}" ]; then
    exec "${ROOT_DIR}/scripts/with-node.sh" "${candidate}" "$@"
  fi
done

echo "Unable to locate npm-cli.js for a safe WSL invocation." >&2
echo "Use the direct harness scripts under ./scripts or set JAFICTION_NPM_CLI_JS." >&2
exit 1
