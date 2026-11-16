#!/bin/bash
# Builds the browser worker bundle of the whole TypeScript solver (card T1.5 d) with harness/vite.solver.config.ts into
# prototypes/dotnet-b/fixtures/.build-solver-browser/solver.worker.js (or $FS_SOLVER_OUT), a folder the repository ignores. src/ is only read.
# harness/run-solver-browser.mjs builds it by itself when it is missing or older than the sources; this script is for building it alone.
#   bash prototypes/dotnet-b/harness/build-solver.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
cd "$REPO"
[ -e node_modules/vite ] || { echo "node_modules/vite not found in $REPO (run npm ci, or symlink the main checkout's node_modules)" >&2; exit 1; }
npx vite build -c prototypes/dotnet-b/harness/vite.solver.config.ts
OUT="${FS_SOLVER_OUT:-prototypes/dotnet-b/fixtures/.build-solver-browser}/solver.worker.js"
echo "$(wc -c < "$OUT") bytes  $OUT"
sha256sum "$OUT"
