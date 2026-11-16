#!/usr/bin/env bash
# T1.4a: regenerates the large fixtures of the air kernels (about 5 MB and 25 MB, never committed) and the small golden files that ARE committed
# (Fs.Tests/golden/air-k3std.json, air-k6high.json, about 15 KB each).
#
#   source prototypes/dotnet-b/env.sh                     # the toolchain and $FIRESIM_SCRATCH
#   bash prototypes/dotnet-b/Fs.Bench/ts/air/regen.sh [FIXTURES_DIR]      # default $FIRESIM_SCRATCH/T1.4a ; run from anywhere
#
# What it does: builds capture.ts and bench.ts with the repository's Vite (into prototypes/dotnet-b/fixtures/.build-air, git-ignored; node_modules must be reachable from the
# repository root), runs the REAL Simulation for katoomba3-standard (3 km, standard tier, seed 13, 900 s of 3-D spin-up then 900 s of fire) and for the 6 km high tier on the
# standard 30 m fire grid, takes the real state of the atmosphere, runs the REAL unmodified TypeScript kernels (EllipticSolver.gradient/divergence/relax, dynamics.advect)
# on it and on NaN and -0 variants, and writes FIXTURES_DIR/fx-k3std and fx-k6high (header.json, data.bin, golden.json). Fs.Tests reads the fixtures through the
# FS_AIR_FIXTURES environment variable (default $FIRESIM_SCRATCH/T1.4a) and compares with the committed golden files. Two runs give identical bytes (checked once by cmp).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
fix="${1:-${FIRESIM_SCRATCH:?source prototypes/dotnet-b/env.sh first}/T1.4a}"
build="$root/prototypes/dotnet-b/fixtures/.build-air"
cd "$root"
[ -e node_modules ] || { echo "node_modules is not reachable from $root (npm ci, or a link)" >&2; exit 2; }
flock /tmp/firesim-heavy.lock node prototypes/dotnet-b/Fs.Bench/ts/build.mjs "$build" prototypes/dotnet-b/Fs.Bench/ts/air/capture.ts prototypes/dotnet-b/Fs.Bench/ts/air/bench.ts
export FS_REPO_ROOT="$root"
flock /tmp/firesim-heavy.lock node "$build/capture.mjs" "$fix/fx-k3std"
flock /tmp/firesim-heavy.lock node "$build/capture.mjs" "$fix/fx-k6high" --extent 6000 --tier high --tier-only
cp "$fix/fx-k3std/golden.json" prototypes/dotnet-b/Fs.Tests/golden/air-k3std.json
cp "$fix/fx-k6high/golden.json" prototypes/dotnet-b/Fs.Tests/golden/air-k6high.json
echo "fixtures in $fix; golden files updated in Fs.Tests/golden (git diff shows whether the TypeScript's results changed)"
