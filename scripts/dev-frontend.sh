#!/usr/bin/env bash
# Serve built frontend (no file watchers — works with low open-file limits).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/npm.sh"

cd "$ROOT/frontend"

if [[ ! -d dist ]]; then
  echo "Building frontend (first run)..."
  npm run build
fi

echo "Serving frontend at http://0.0.0.0:5173 (no hot-reload)"
echo "Make sure 'make backend' is running on port 7500"
exec npm run preview -- --host 0.0.0.0
