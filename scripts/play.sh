#!/usr/bin/env bash
# Single-command start: build frontend + run backend on port 7500 (best for LAN).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/npm.sh"

cd "$ROOT/frontend"
echo "Building frontend..."
npm run build

cd "$ROOT"
echo ""
echo "============================================"
echo "  Hike&strike ready at http://0.0.0.0:7500"
echo "  (use your machine IP from other devices)"
echo "============================================"
echo ""
exec make backend
