#!/usr/bin/env bash
# T1.4b: the timed campaign that made reports/1-fast-kernels.md, one lock per step, no step longer than about ten minutes (another builder shares the heavy-work lock; plan section 2 rule 9).
#   source prototypes/dotnet-b/env.sh
#   bash prototypes/dotnet-b/Fs.Bench/ts/fast/regen.sh                      fixtures (once; builds the TypeScript drivers into prototypes/dotnet-b/fixtures/.build-fast)
#   (under the lock) dotnet publish prototypes/dotnet-b/Fs.Wasm -c Release  Mono AOT, after deleting Fs.Wasm/obj and bin (the T1.6a gotcha)
#   bash prototypes/dotnet-b/Fs.Bench/ts/fast/measure.sh [FIXTURES_DIR]    default $FIRESIM_SCRATCH/T1.4b ; every result file is written there
# Do not edit the sources while it runs: BenchmarkDotNet builds its benchmark project from them for every session.
# Order: TypeScript run 1; BenchmarkDotNet default job in five sessions (evaluate stage 1, stage 2, reinit, pyrogenic, restore); TypeScript runs 2 and 3; the A B B A of the WebAssembly arm
# (TypeScript, Mono AOT, Mono AOT, TypeScript, each a fresh process); the thread curve (DOTNET_TieredCompilation=0, one process). Then the merge:
#   dotnet Fs.Bench.dll fast-merge BDN1,BDN2,... TS900RUNS TSLATERUNS reports/1-fast-kernels.json conditions.json threads.json > merge.md
#   python3 -I Fs.Bench/ts/fast/wasm-merge.py FIXTURES_DIR wasm-merged.json > wasm-merge.md
#   python3 -I Fs.Bench/ts/fast/finish-json.py reports/1-fast-kernels.json wasm-merged.json FIXTURES_DIR notes.txt COMMIT TESTS_PASSED
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
pd="$root/prototypes/dotnet-b"
fix="${1:-${FIRESIM_SCRATCH:?source prototypes/dotnet-b/env.sh first}/T1.4b}"
export FS_FAST_FIXTURES="$fix"
build="$pd/fixtures/.build-fast"
bench="$pd/Fs.Bench/bin/Release/net11.0/Fs.Bench.dll"
fw="$pd/Fs.Wasm/bin/Release/net11.0/publish/wwwroot/_framework"
cond="$fix/conditions.log"
: > "$cond"
cd "$pd"
timed() { # name, command...
  local name="$1"; shift
  echo "$name before: $(date -u +%H:%M:%S) $(cut -d' ' -f1-3 /proc/loadavg)" >> "$cond"
  flock /tmp/firesim-heavy.lock "$@"
  echo "$name after: $(date -u +%H:%M:%S) $(cut -d' ' -f1-3 /proc/loadavg)" >> "$cond"
}
tsrun() { # prefix n  (prefix ts: the C# comparison runs; tsw: the A and the last A of the WebAssembly A B B A)
  for w in k6f-900 k6f-late; do timed "$1-$w-$2" node "$build/bench.mjs" "$fix/fx-$w" "$fix/$1-$w-$2.json" 1000 1500; done
}
wasmrun() { # n
  for w in k6f-900 k6f-late; do timed "wasm-$w-$1" node "$here/wasm-bench.mjs" "$fw" "$fix/fx-$w" "$fix/wasm-$w-$1.json" 1000 1500; done
}
flock /tmp/firesim-heavy.lock dotnet build "$pd/Fs.Bench" -c Release
tsrun ts 1
for s in "eval1 *FastBench.EvalStage1*" "eval2 *FastBench.EvalStage2*" "reinit *FastBench.Reinit*" "pyro *FastBench.Pyro*" "restore *FastBench.Restore*"; do
  set -- $s
  timed "bdn-$1" dotnet "$bench" --filter "$2" --artifacts "$fix/bdn-$1"
done
tsrun ts 2
tsrun ts 3
tsrun tsw 1
wasmrun 1
wasmrun 2
tsrun tsw 2
timed threads env DOTNET_TieredCompilation=0 dotnet "$bench" fast-threads "$fix/threads.json"
echo "done; conditions in $cond; now merge (see the header of this file)"
