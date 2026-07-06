#!/usr/bin/env bash
# Find npm on PATH, nvm, or pre-commit node cache.
set -euo pipefail

find_npm() {
  if command -v npm >/dev/null 2>&1; then
    return 0
  fi
  local candidate
  for candidate in \
    "$HOME/.nvm/versions/node/"*/bin/npm \
    "$HOME"/.cache/pre-commit/*/node_env-default/bin/npm \
    /usr/bin/npm /usr/local/bin/npm; do
    if [[ -x "$candidate" ]]; then
      export PATH="$(dirname "$candidate"):$PATH"
      return 0
    fi
  done
  echo "ERROR: npm not found. Install with: sudo apt install npm" >&2
  exit 1
}

find_npm "$@"

# Sourced by play.sh / dev-frontend*.sh — only put npm on PATH.
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  return 0 2>/dev/null || exit 0
fi

exec npm "$@"
