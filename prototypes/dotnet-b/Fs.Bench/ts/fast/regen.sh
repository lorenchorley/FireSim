#!/usr/bin/env bash
# T1.4b: regenerates the large fixtures of the fast tier's kernels (about 20 to 40 MB each, never committed) and the small golden files that ARE committed
# (Fs.Tests/golden/fast-k6f-900.json, fast-k6f-late.json).
#
#   source prototypes/dotnet-b/env.sh                     # the toolchain and $FIRESIM_SCRATCH
#   bash prototypes/dotnet-b/Fs.Bench/ts/fast/regen.sh [FIXTURES_DIR]      # default $FIRESIM_SCRATCH/T1.4b ; run from anywhere
#
# What it does: builds capture.ts and bench.ts with the repository's Vite (into prototypes/dotnet-b/fixtures/.build-fast, git-ignored; node_modules must be reachable from the
# repository root), runs the REAL Simulation for katoomba6-fast-4h (6 km, fast tier, 200 x 200 fire cells, seed 13), records the real calls of LevelSetCore.evaluate (with the
# real speed-request hook), LevelSetCore.reinit and PyrogenicPotential.solve in two windows (the first calls after 900 s and after 14,100 s), replays each frame on fresh real
# objects for the variants of lib.ts (plain, NaN and -0 in the field, NaN and -0 in the coefficients, a Float64 distance array), and writes FIXTURES_DIR/fx-k6f-900 and
# fx-k6f-late (header.json, data.bin, golden.json). Fs.Tests reads the fixtures through FS_FAST_FIXTURES (default $FIRESIM_SCRATCH/T1.4b) and compares with the committed
# golden files. Two runs give identical bytes (checked once by cmp).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
fix="${1:-${FIRESIM_SCRATCH:?source prototypes/dotnet-b/env.sh first}/T1.4b}"
build="$root/prototypes/dotnet-b/fixtures/.build-fast"
cd "$root"
[ -e node_modules ] || { echo "node_modules is not reachable from $root (npm ci, or a link)" >&2; exit 2; }
flock /tmp/firesim-heavy.lock node prototypes/dotnet-b/Fs.Bench/ts/build.mjs "$build" prototypes/dotnet-b/Fs.Bench/ts/fast/capture.ts prototypes/dotnet-b/Fs.Bench/ts/fast/bench.ts
export FS_REPO_ROOT="$root"
flock /tmp/firesim-heavy.lock node "$build/capture.mjs" "$fix"
cp "$fix/fx-k6f-900/golden.json" prototypes/dotnet-b/Fs.Tests/golden/fast-k6f-900.json
cp "$fix/fx-k6f-late/golden.json" prototypes/dotnet-b/Fs.Tests/golden/fast-k6f-late.json
echo "fixtures in $fix; golden files updated in Fs.Tests/golden (git diff shows whether the TypeScript's results changed)"
