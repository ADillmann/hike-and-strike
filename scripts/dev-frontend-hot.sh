#!/usr/bin/env bash
# Vite dev server with polling (may still fail on very low ulimit).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/npm.sh"

ulimit -n 65536 2>/dev/null || true

cd "$ROOT/frontend"
echo "Dev server with hot-reload at http://0.0.0.0:5173"
exec npm run dev -- --host 0.0.0.0
