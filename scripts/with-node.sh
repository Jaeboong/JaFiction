#!/usr/bin/env bash
set -euo pipefail

declare -a candidates=()

if [ -n "${JASOJEON_NODE_BIN:-}" ]; then
  candidates+=("${JASOJEON_NODE_BIN}")
fi

for candidate in \
  "${HOME}/.local/bin/node" \
  "${HOME}/.nvm/versions/node/current/bin/node" \
  "/usr/bin/node" \
  "/usr/local/bin/node"
do
  if [ -x "${candidate}" ]; then
    candidates+=("${candidate}")
  fi
done

if [ -d "${HOME}/.nvm/versions/node" ]; then
  while IFS= read -r candidate; do
    candidates+=("${candidate}")
  done < <(find "${HOME}/.nvm/versions/node" -maxdepth 6 -type f -path "*/bin/node" | sort -r)
fi

if command -v node >/dev/null 2>&1; then
  candidates+=("$(command -v node)")
fi

for candidate in "${candidates[@]}"; do
  if [ ! -x "${candidate}" ]; then
    continue
  fi
  resolved_candidate="$(readlink -f "${candidate}" 2>/dev/null || printf '%s' "${candidate}")"
  if [[ "${resolved_candidate}" == *.exe ]] || [[ "${resolved_candidate}" == /mnt/* ]]; then
    continue
  fi
  if "${resolved_candidate}" -e 'process.exit(0)' >/dev/null 2>&1; then
    exec "${resolved_candidate}" "$@"
  fi
done

echo "Unable to locate a usable Linux Node.js binary." >&2
echo "Checked candidates:" >&2
for candidate in "${candidates[@]}"; do
  echo "  - ${candidate}" >&2
done
exit 1
