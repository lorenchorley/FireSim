#!/usr/bin/env bash
# T1.4b: the timed runs, every one under the heavy-work lock, with the load average (uptime) written before and after each. Run from anywhere after
#   source prototypes/dotnet-b/env.sh ; bash prototypes/dotnet-b/Fs.Bench/ts/fast/regen.sh      (fixtures, once)
#   dotnet build prototypes/dotnet-b/Fs.Bench -c Release                                         (under the lock)
#   bash prototypes/dotnet-b/Fs.Bench/ts/fast/measure.sh [OUT_DIR]                              default $FIRESIM_SCRATCH/T1.4b/measure
# To hold the lock once for the whole session: flock /tmp/firesim-heavy.lock env FS_HAVE_LOCK=1 bash .../measure.sh
# Order: TypeScript run 1, the BenchmarkDotNet session (default job, out of process, all 34 cases), TypeScript runs 2 and 3, the thread curve (DOTNET_TieredCompilation=0, one process),
# then the merge into reports/1-fast-kernels.json (conditions.json holds every uptime line). Each TypeScript run is its own process.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
pd="$root/prototypes/dotnet-b"
fix="${FIRESIM_SCRATCH:?source prototypes/dotnet-b/env.sh first}/T1.4b"
out="${1:-$fix/measure}"
mkdir -p "$out"
build="$pd/fixtures/.build-fast"
bench="$pd/Fs.Bench/bin/Release/net11.0/Fs.Bench.dll"
export FS_FAST_FIXTURES="$fix"
cond="$out/conditions.log"
: > "$cond"
timed() { # name, command...
  local name="$1"; shift
  echo "$name before: $(date -u +%H:%M:%S) $(cut -d' ' -f1-3 /proc/loadavg)" >> "$cond"
  if [ "${FS_HAVE_LOCK:-0}" = 1 ]; then "$@"; else flock /tmp/firesim-heavy.lock "$@"; fi   # FS_HAVE_LOCK=1: the caller already holds the lock for the whole session
  local rc=$?
  echo "$name after: $(date -u +%H:%M:%S) $(cut -d' ' -f1-3 /proc/loadavg)" >> "$cond"
  return $rc
}
tsrun() { # n
  for w in k6f-900 k6f-late; do
    timed "ts-$w-run$1" node "$build/bench.mjs" "$fix/fx-$w" "$out/ts-$w-$1.json" 1000 1500 | tee "$out/ts-$w-$1.txt"
  done
}
tsrun 1
timed bdn dotnet "$bench" --filter "*FastBench*" --artifacts "$out/bdn"
tsrun 2
tsrun 3
timed threads env DOTNET_TieredCompilation=0 dotnet "$bench" fast-threads "$out/threads.json" > "$out/threads.md"
python3 - "$cond" "$out/conditions.json" <<'EOF'
import json, sys
lines = [l.strip() for l in open(sys.argv[1]) if l.strip()]
json.dump({"loadAverageLog": lines, "columns": "name before|after: UTC time, load average over 1, 5 and 15 minutes (/proc/loadavg)"}, open(sys.argv[2], "w"), indent=1)
EOF
bdnjson="$(ls "$out"/bdn/results/*FastBench*-report-full.json | head -1)"
dotnet "$bench" fast-merge "$bdnjson" "$out/ts-k6f-900-1.json,$out/ts-k6f-900-2.json,$out/ts-k6f-900-3.json" "$out/ts-k6f-late-1.json,$out/ts-k6f-late-2.json,$out/ts-k6f-late-3.json" \
  "$pd/reports/1-fast-kernels.json" "$out/conditions.json" "$out/threads.json" > "$out/merge.md"
echo "done; tables in $out/merge.md and $out/threads.md; $pd/reports/1-fast-kernels.json written"
