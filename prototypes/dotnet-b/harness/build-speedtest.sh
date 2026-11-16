#!/bin/bash
# Builds round 0's worker bundle from src/ui/speedTestKernels.ts (read only) into Fs.TestApp/Resources/Raw/wwwroot/speedtest.worker.js (committed: a few KB),
# then runs the node check that the bundle and the page script reproduce both frozen checksums. Run from anywhere; needs the repository's node_modules (vite).
#   bash prototypes/dotnet-b/harness/build-speedtest.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
cd "$REPO"
[ -e node_modules/vite ] || { echo "node_modules/vite not found in $REPO (run npm ci, or symlink the main checkout's node_modules)" >&2; exit 1; }
npx vite build -c prototypes/dotnet-b/harness/vite.speedtest.config.ts
OUT=prototypes/dotnet-b/Fs.TestApp/Resources/Raw/wwwroot/speedtest.worker.js
echo "$(wc -c < "$OUT") bytes  $OUT"
sha256sum "$OUT"
node prototypes/dotnet-b/harness/check-round0-js.mjs
